# NTP Time Service (chrony)

A desktop PC running a few minutes off, and most people never notice; a server running a few minutes off, and everything breaks: TLS certificate validity windows no longer line up and handshakes simply fail; a 3 a.m. scheduled job is skipped or run twice after a clock jump; when troubleshooting across several machines, log timestamps do not align and the chain of cause and effect falls apart. NTP (Network Time Protocol) is the protocol that "gets every machine's watch to the same second", and chrony is the mainstream implementation on modern Linux -- it works as a client calibrating itself and also as an intranet time server, so a few dozen machines no longer each keep their own time. This page is organized as "why the clock must not drift -> installation on the three distro families and the current default client situation -> chrony.conf -> observing and verifying with chronyc -> the old ntpd server as a comparison -> common traps"; serving time to the outside world requires opening UDP port 123, which is covered on the [Firewall](../security/firewall.md) page instead.

> Content draws on the official chrony documentation and the Arch Wiki (conceptual framework from "Vbird's Linux Cabinet"); see the references at the end.

## What This Page Covers

- Telling apart the three kinds of time: RTC, the system clock, and the monotonic clock
- Installing and enabling on the three distros (apt / pacman / dnf), and understanding the hierarchy between timesyncd and chrony
- Reading pool/server, allow, local stratum, makestep, and rtcsync in chrony.conf
- Using chronyc tracking and sources to judge synchronization health, and getting makestep's stepping discipline right
- Debugging the high-frequency traps: reach stuck at 0, two clients fighting, timezone misconfiguration, and intranet synchronization failures

## 1. Why a Server's Clock Must Not Drift

### 1.1 Four Real Scenarios of What a Wrong Time Breaks

The first is **timed judgment in authentication and encryption**. Kerberos tolerates only about five minutes of clock skew by default and rejects authentication outright beyond it -- in a domain environment where "suddenly everyone fails to log in", the investigation often ends at "some machine's clock drifted". TLS certificates carry notBefore/notAfter validity windows; a client clock running ahead keeps trusting a certificate that should have expired and gone offline, while a clock set back misjudges a certificate that has not yet taken effect as being inside the window -- the two errors point in opposite directions but break things identically.

The second is **the trigger semantics of scheduled tasks**. Whether cron and systemd timers fire depends entirely on readings of the system clock; one step (moving the time straight across) can jump 02:59:58 to 03:00:40, so the task scheduled for exactly 03:00 misses, while stepping backward can make it run twice. This is also why chrony defaults to "never step unless it must" -- see the makestep trade-off in section 3.

The third is **log chronology**. journald and rsyslog both take their timestamps from the system clock (see [System Logging](../basic/log/syslog.md)); with a machine drifting two minutes, the order of events across machines can no longer be reconstructed -- and security incident reconstruction and root-cause analysis rely on exactly this timeline.

The fourth is **distributed consistency**. DNSSEC signatures carry validity windows of their own; falling out of step with NTP makes every signature "expired", and this repo's DNS chapter already lists that as one of the SERVFAIL investigation items (see the [DNS Server (BIND)](./dns/bind.md) page); the same applies to database master/slave commit ordering and repository commit timestamps -- in distributed systems, the clock is the basis of ordering, and when the ordering is a mess, consistency is out of reach.

### 1.2 Three Clocks: RTC, System Clock, Monotonic Clock

The RTC (Real-Time Clock) is the hardware clock on the motherboard, kept ticking across power-off by a button cell. Its only job: give the kernel a starting point at boot. The system clock is the software clock the kernel maintains -- it is what `date` and every application see; it is read from the RTC at boot and then continuously corrected by NTP, with far higher precision than the RTC itself. The monotonic clock only ever moves forward and is unaffected by any time correction: systemd's boot timing and internal timeout timers all use it -- when NTP steps the system clock, an in-flight sleep is neither stretched nor shortened. The two clocks' "personalities" can be compared at a glance:

```bash
$ date && cat /proc/uptime
Fri Oct  2 15:04:05 CST 2026
512345.67 2012345.00     # the first number is the monotonic clock: seconds since boot; NTP cannot touch it
```

When troubleshooting, first pin down "which clock is wrong": a dead RTC battery drifts slowly, an unsynchronized system clock free-runs, and a wrong display timezone means the clock is actually right -- the three cases need entirely different handling.

### 1.3 UTC and Timezones: the System Stores UTC

Linux maintains the system clock in UTC internally and converts for display according to the timezone `/etc/localtime` points to -- in `timedatectl` output, Local time and Universal time are always the same instant written two ways. The least troublesome server posture is "both the system clock and the RTC store UTC; set the timezone on demand". With a dual boot alongside Windows, be aware: Windows by default has the RTC store local time, so the two sides interpret the same hardware clock differently, and alternating booting makes them "correct" each other by eight hours; `timedatectl` warns about this with "RTC in local TZ". Changing the timezone never touches the clock itself -- `timedatectl set-timezone Asia/Shanghai` swaps only the display skin.

## 2. Installation and the Current Situation Across the Three Families

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install | `apt install chrony` | `sudo pacman -S chrony` | `dnf install chrony` |
| Search | `apt search chrony` | `pacman -Ss chrony` | `dnf search chrony` |
| Show package info | `apt show chrony` | `pacman -Qi chrony` | `dnf info chrony` |
| List files | `dpkg -L chrony` | `pacman -Ql chrony` | `rpm -ql chrony` |
| Upgrade | `apt upgrade` | `sudo pacman -Syu` | `dnf upgrade` |
| Remove | `apt remove chrony` | `sudo pacman -R chrony` | `dnf remove chrony` |
| Observation tool | chronyc ships with the main package | chronyc ships with the main package | chronyc ships with the main package |

Before getting started, clarify one hierarchy: systemd-timesyncd is the SNTP client that ships with systemd -- SNTP only "moves the hands into place"; it does not compute the clock's rate, does no frequency compensation, and cannot serve time to others. For a pure client with loose precision needs, a desktop, it is plenty; but as soon as you need to serve time to others (a server, a cluster), run in a VM (drift is fast and frequency compensation is required), or face an intermittent network (chrony adapts far better to intermittency), you should switch to chrony. A fresh install of the three families lands in three different places: Debian/Ubuntu enable timesyncd by default, RHEL/Rocky have chronyd preinstalled and enabled by default since 7, and an Arch base system enables no time-sync client at all -- installing chrony is often among the first things Arch users do after installing the system.

Machines that decide to stay on timesyncd for now should at least know where its switches are: upstream addresses go in `NTP=`/`FallbackNTP=` in `/etc/systemd/timesyncd.conf`, effective after `systemctl restart systemd-timesyncd`; `timedatectl set-ntp true/false` is systemd's master switch, and `timedatectl show-timesync` shows who it is currently synced to -- a machine that "only syncs, never serves" has that boundary written on it, and you should think it through before chasing intranet time problems.

```bash
$ timedatectl set-ntp true && systemctl restart systemd-timesyncd
$ timedatectl show-timesync | grep -E 'ServerName|Offset'
ServerName=time.cloudflare.com
Offset=+52.3ms
```

The unit name and the config path are three independent dimensions: on Debian the service unit is called `chrony`, while Arch and RHEL both call it `chronyd`; Debian's config lives in `/etc/chrony/chrony.conf` (a directory-based layout, with the source list split off into `/etc/chrony/sources.d/`), while Arch and RHEL use the single file `/etc/chrony.conf`. When troubleshooting, line the unit up first with `systemctl status`, and only then talk config files -- the same class of trap as bind9/named naming differences on the DNS page.

### 2.1 Debian/Ubuntu

```bash
$ sudo apt install chrony
$ systemctl is-active systemd-timesyncd
inactive                     # chrony's wrapper script disables timesyncd automatically; verifying once by hand is safer
$ sudo systemctl enable --now chrony && systemctl is-active chrony
active
```

Debian's chrony.conf uses sourcedir to split the address sources out into directories such as `/etc/chrony/sources.d/` -- the same philosophy as BIND splitting its config into `named.conf.options` snippets, so local changes are not easily clobbered by package upgrades. chronyc ships with the main package, so you can observe synchronization state right after installing; to switch sources, drop a file into sources.d and restart the service, without touching the main config.

### 2.2 Arch

```bash
$ sudo pacman -S chrony
$ sudo systemctl enable --now chronyd
$ chronyc tracking | head -2
Reference ID    : A29FC87B (time.cloudflare.com)
Stratum         : 3
```

The official extra repository installs everything in one go; the `chronyd.service` unit name matches RHEL and differs from Debian, so line this up first when writing cross-distro scripts. `pacman -Ql chrony` shows which files and units the package laid down, the same action as `dpkg -L` on Debian and `rpm -ql` on RHEL. A base system runs no time-sync client by default, so the `enable --now` step cannot be skipped.

### 2.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install chrony        # usually already preinstalled
$ sudo systemctl enable --now chronyd && systemctl is-active chronyd
active
$ chronyc sources | tail -3
```

The default config on the RHEL family already contains `makestep 1.0 3` and `rtcsync`, so the client works out of the box, and the usual remaining task for an intranet time server is adding an `allow` line (see section 3). chrony has been the default time-sync implementation since RHEL 7; for a comparison with the ntpd of older material see section 5. SELinux generally does not block chronyd -- the logs and time files are inside the package's default context, and only a path change requires attention.

## 3. Configuring chrony.conf

### 3.1 Client Baseline

```text
# /etc/chrony/chrony.conf (Debian) or /etc/chrony.conf (Arch/RHEL)
pool 2.debian.pool.ntp.org iburst   # Arch uses 2.arch.pool.ntp.org, RHEL uses 2.rhel.pool.ntp.org
driftfile /var/lib/chrony/drift
makestep 1.0 3
rtcsync
```

Line by line: `pool` resolves one domain into several NTP servers and uses them with redundancy, far more failure-resistant than hard-coding a single point; only use a `server` line when you want to specify a definite upstream (say, an intranet time server). `iburst` makes the initial handshake send a burst of packets, compressing first synchronization from tens of seconds to a few, at negligible cost, and by convention is always included. `driftfile` records "how many seconds per day this machine's clock runs fast or slow" -- like a dossier on your watch that says "five seconds fast per day", so calibration after a reboot resumes from the record instead of relearning from zero; the file is maintained by chronyd itself, do not edit it by hand. The semantics of `makestep 1.0 3` are "within the first three updates after startup, step directly if the offset exceeds 1 second; from then on only ever fine-tune the rate" -- stepping is moving the hands, while slewing is correcting the rate; cron and databases are afraid of jumps, which is why chrony by default never steps unless it must. `rtcsync` makes the kernel periodically write the corrected system clock back to the RTC, so that after a shutdown and reboot the starting point is correct.

chrony has no standalone syntax check like `nginx -t`: a wrong directive reports straight into `journalctl -u chronyd` at restart time -- backing up before editing and glancing at the log after is this page's "check first, reload second". Changes fall into two tiers: adjusting server/pool sources does not interrupt time correction, and `chronyc reload sources` makes chronyd reread the sourcedir directory (where Debian's directory layout shows its convenience -- drop a file into sources.d and reload); only touching behavioral directives such as allow, makestep, or local requires a full `systemctl restart chronyd`, during which the kernel holds the clock itself and the learned driftfile experience is not lost.

### 3.2 As an Intranet Time Server

```text
# appended to chrony.conf
allow 192.168.56.0/24        # serve only this intranet segment
local stratum 10             # when every upstream is unreachable, keep serving as stratum 10
cmdallow 192.168.56.0/24     # let this segment query this host's state with chronyc (on demand)
```

Stratum is NTP's "seniority" system, extending one level down at a time:

```text
Stratum 0   atomic clocks / GPS receivers (reference clocks; not on the network themselves)
Stratum 1   servers directly connected to Stratum 0 (primary time sources)
Stratum 2   synchronized to Stratum 1 ... and so on, valid up to 15
```

Credibility drops one level per hop, and clients always weight toward the lowest-stratum, best-quality sources; the local Stratum in `chronyc tracking` is the level of the best upstream plus one. `allow` is the master switch for serving time -- a chronyd without an `allow` line is a pure client and answers not a single UDP packet from outside, which makes it safer by default than the old ntpd. `local stratum 10` solves "the upstream dies and the whole intranet falls apart": after losing every real upstream, this host keeps serving as stratum 10, so intranet machines at least stay consistent with each other -- accuracy gives way to consistency, which is often the more important property for a cluster. `cmdallow` governs the chronyc command channel (which by default listens on localhost only); open it by segment when you need remote status checks, and keep it closed otherwise. The last link in serving time externally is opening UDP 123 in the firewall, covered on the [Firewall](../security/firewall.md) page.

Assembled into a complete intranet time-server config, with each directive in its place:

```text
# /etc/chrony.conf -- intranet time server (path per section 3.1 for all three families)
server time.cloudflare.com iburst     # a specified upstream; extra server lines add redundancy instead of pool
server ntp.aliyun.com iburst
driftfile /var/lib/chrony/drift
makestep 1.0 3
rtcsync
allow 192.168.56.0/24                 # the segment served
local stratum 10                      # keep the intranet consistent when every upstream dies
bindcmdaddress 127.0.0.1              # keep the command channel on localhost (the default; written out explicitly for review)
cmdallow 127.0.0.1
```

Read top to bottom, this config states a complete job description: set the watch against two public upstreams (iburst accelerates the first sync) and record the learned rate in the driftfile; serve one intranet segment, and even if every upstream dies, keep order as stratum 10; keep the chronyc command channel on localhost, leaving no remote way for any intranet machine to issue commands. Restart after editing, then write `server 192.168.56.10 iburst` on another intranet machine -- the last link of the loop is seeing this server show up in the client's `chronyc sources` as `*` or `+`.

## 4. Observing and Verifying

### 4.1 chronyc tracking: How Well Is This Machine Synchronized

```bash
$ chronyc tracking
Reference ID    : A29FC87B (time.cloudflare.com)
Stratum         : 3
Ref time (UTC)  : Thu Oct 02 07:15:41 2026
System time     : 0.000000842 seconds slow of NTP time
Last offset     : -0.000001234 seconds
RMS offset      : 0.000002345 seconds
Frequency       : 3.541 ppm slow
Residual freq   : +0.000 ppm
Skew            : 0.012 ppm
Root delay      : 0.018765432 seconds
Root dispersion : 0.000987654 seconds
Update interval : 130.2 seconds
Leap status     : Normal
```

Look at three lines first: `Leap status` should be Normal -- Not synchronised means it has not synchronized yet, go back and check sources; `System time` tells you how far ahead or behind NTP time you currently are, with microseconds belonging to health and milliseconds indicating you just started or the network is jittering; `Stratum` is this machine's current level, equal to the best upstream plus one. `Frequency` is what the driftfile has learned about "how many ppm this clock runs fast or slow", and over the long run it can even forecast the hardware clock's aging trend. `Ref time (UTC)` is the last calibration moment; if it is stuck several hours ago, first check whether sources have all dropped off.

### 4.2 chronyc sources: How Good Are the Upstreams

```bash
$ chronyc sources -v
.-- Source mode  '|' indicates the local clock acts as a source of time
   '^' indicates a server, '=' indicates a peer, '#' indicates a local clock
 .-- Source state '*' indicates current best, '+' indicates combined,
 |                '-' indicates not combined, 'x' indicates time may be in error,
 |                '?' indicates unreachable, 'o' indicates PPS signal
                                                          ||====================
MS Name/IP address         Stratum Poll Reach LastRx Last sample
===============================================================
^* time.cloudflare.com           3  10   377   432  -134us[ -289us] +/- 8732us
^+ ntp1.example.com              2  10   377   512   +52us[  +52us] +/-   11ms
^? 203.0.113.10                  0  10     0     -     +0ns[   +0ns] +/-    0ns
```

The M column is the source type (`^` server, `=` peer, `#` local clock) and the S column is the health verdict: `*` current best, `+` usable and participating in the combination, `-` available but not combined, `?` completely unreachable, `x` suspected of disagreeing with the group (falseticker). `Reach` is an octal hit map of the last eight probes -- 377 means every probe answered, 0 means none did (the third line above is a dead source blocked by a firewall); intermediate values like 177 mean it comes and goes, and network quality problems show up in this column first. The `Poll` column is an exponent to the base 2: 6 means on average one query every 64 seconds, 10 means 1024 seconds -- chrony stretches and shrinks between limits based on link stability, asking less often on stable links and more often on jittery ones, which explains why updates are frequent right after startup and `Update interval` gradually lengthens once things settle. `LastRx` is how long ago the last reply arrived, and `Last sample` gives the offset together with its error bound (the `+/-` column). A healthy machine should show at least one `*` or `+` with Reach stable at 377. `chronyc sourcestats` adds a "what has been learned" view (per-source frequency estimates and scatter); for daily inspection, sources is enough.

### 4.3 timedatectl and Manual Stepping

```bash
$ timedatectl
               Local time: Fri 2026-10-02 15:04:05 CST
           Universal time: Fri 2026-10-02 07:04:05 UTC
                 RTC time: Fri 2026-10-02 07:04:05
                Time zone: Asia/Shanghai (CST, +0800)
System clock synchronized: yes
              NTP service: active
          RTC in local TZ: no
```

The `System clock synchronized` and `NTP service` lines are systemd's verdict, and it accepts both timesyncd and chrony -- on a machine with chrony installed, yes/active on both lines means the link is up. When a large offset shows up at runtime and waiting for the slew is not acceptable, use `chronyc makestep` to move the hands once manually. The discipline: **on a machine running chrony, hand-setting the time with `date -s` should be treated as forbidden** -- the change you make gets treated as drift and "fixed" back by chrony; the two wrestle and the clock jumps back and forth. If manual intervention is truly needed, `systemctl stop chronyd` (chrony on Debian) first, make the change, then start it again, or go through chronyc's own channel.

### 4.4 Chaining Verification into One Smoke Test

Each command alone has blind spots; during inspection, chaining three things together is what counts: the verdict at the systemd layer (is the service running), the verdict at the chrony layer (synchronized to whom, and at what quality), and cross-validation at the hardware layer (how far apart the RTC and system clock are). `chronyc activity` is an often-overlooked quick check -- it directly reports how many sources are online and offline, easier to parse in scripts than the sources table:

```bash
$ chronyc activity
200 OK
2 sources online
0 sources offline
0 sources doing burst (return to online)
0 sources doing burst (return to offline)
0 sources with unknown address
$ sudo hwclock --show                    # cross-check of the RTC against the system clock
2026-10-02 15:04:07.312345+08:00
$ journalctl -u chronyd --since "1 hour ago" | tail -3
```

When all three are green -- activity shows online sources, `hwclock --show` agrees with `date` (evidence that rtcsync is doing its job), and the journal has no errors -- this machine's time health has a complete loop; when any one is red, go back to the column-by-column readings in 4.1/4.2 to locate which layer is at fault. Putting these three commands into a boot-time self-check or inspection script catches a silently drifting clock one step earlier than reading logs after the fact.

## 5. The Old ntpd Server and Troubleshooting Comparison

```bash
$ ntpq -p
     remote           refid      st t when poll reach   delay   offset  jitter
==============================================================================
*ntp1.example.org  10.10.0.1      2 u   48   64  377   0.421   -0.312   0.201
+ntp2.example.org  10.10.0.2      2 u   12   64  377   1.002   +0.455   0.331
```

The classic ntpd's observation entry is `ntpq -p`: the leading symbols come from the same lineage as chrony's S column (`*` currently synchronized source, `+` alternate), and the four columns reach, delay, offset, and jitter are enough to locate the vast majority of problems -- reach not reaching 377 is a network problem, a large offset is an offset problem, and large jitter is an unstable link. Where you still meet ntpd today: legacy production machines from the CentOS 6/7 era, some network device firmware, and old baseline documentation in certain industries. For new installs, chrony across the board -- RHEL has defaulted to it for years, and the Debian/Arch repositories likewise promote it. The two must never be installed and run together: both daemons slew the system clock, and each pulling the rate its own way leaves the clock jittering over the long term. The correct migration order is to disable the old one (`systemctl disable --now ntp`), confirm chronyd is up and synchronized, and only then remove the old package -- stand up the new before tearing down the old, leaving one step in between for observation.

Two more familiar faces from old documentation are worth matching up. `ntpdate`, the one-shot time-setting tool, has long been officially deprecated -- its successor in the chrony world is `chronyd -q` (set once and leave, without staying resident), suitable for the first alignment after installing a system; in the ntp world it is `sntp`. The other is `ntpd -g`'s "allow a large offset at startup" flag, which corresponds to `makestep` in section 3 on the chrony side -- translate these two terms when reading old material and the reasoning carries over to chrony, without needing to install another set of ntp.

## 6. Troubleshooting and Common Traps

**Every source in sources shows ?, and Reach is 0.** The most common root causes are an enterprise firewall blocking outbound UDP 123, or the pool domain being unreachable. The investigation order: `chronyc -N sources` to see whether the domain resolves to addresses at all (DNS layer) -> swap the pool for hand-written `server time.cloudflare.com iburst` and `server ntp.aliyun.com iburst` (redundancy layer) -> confirm on the gateway side whether outbound port 123 is allowed (firewall layer). Reach is an octal counter that climbs from 1, 3, 7 all the way to 377 before it is at full health -- watching it climb is itself direct evidence of the link recovering.

**The offset is large and it takes forever to catch up.** By default at runtime chrony only slews, protecting cron and databases by never stepping again, so even a dozen seconds of offset are chased "a little each second". The emergency channel is `chronyc makestep` to move the hands immediately; to change the default policy, widen the `makestep 1.0 3` window -- changing the third number to `-1` (as in `makestep 1.0 -1`) allows stepping whenever the offset exceeds 1 second, at the cost of jump risk: after one step, any scheduled job falling inside the jump window may be missed.

**VM clocks drift fast.** A VM gets a virtualized clock from its host, so host load fluctuations carry over, and a pause plus resume opens seconds of offset outright. Three countermeasures: install the guest additions (open-vm-tools for VMware, qemu-guest-agent for KVM) so the host participates in time correction; widen the makestep window to tolerate a one-time step after a resume; or accept a denser update cadence. Containers are a different matter -- a container has no clock of its own and sees the host's system clock, so installing an NTP client inside a container is the wrong direction entirely; the host is what needs fixing.

**Two clients fighting: timesyncd and chrony both enabled.** The symptom is chronyc tracking looking perfectly healthy while the time is still being dragged elsewhere by another process, or `timedatectl`'s NTP service status flapping back and forth. Both systemd-timesyncd and chronyd make a living correcting the clock, so running them together is bound to overwrite each other's work. The handling order: `timedatectl set-ntp false` to switch off the systemd-side auto-sync switch, then `systemctl disable --now systemd-timesyncd` to make it decisive, then confirm chronyd is running alone. Debian/Ubuntu's wrapper scripts usually handle this automatically; on Arch and hand-modified machines you have to do it yourself.

**The time "looks" eight hours wrong while the system clock is actually right.** In `timedatectl` the gap between Local time and Universal time is wrong, or log timestamps are all shifted: this is a timezone-layer problem, not a clock-layer one, and adjusting NTP will not fix it. One command does it -- `timedatectl set-timezone Asia/Shanghai` (essentially repointing the `/etc/localtime` symlink to the corresponding file under `/usr/share/zoneinfo/`), with `timedatectl list-timezones` to look up available names. On machines dual-booted with Windows, watch for the "RTC in local TZ" warning -- the two sides disagree on whether the hardware clock holds UTC or local time, and alternating booting makes them keep correcting each other.

**Intranet machines cannot reach a self-hosted time server.** Debug in three layers: on the server, `ss -ulnp | grep :123` to confirm chronyd is listening, and `chronyc tracking` to confirm its own Leap status is Normal -- clients reject a source that has not synchronized itself; at the config layer, confirm the `allow` segment has been written and the service restarted -- a chronyd without allow answers not a single packet from outside, which is a feature, not a failure; at the network layer, confirm the intranet firewall allows UDP 123. If that source shows `x` in the client's sources, it strongly disagrees with the rest; when the two sides' clocks are far apart, manually align once with `chronyc makestep` on the client and observe, and it usually recovers.

## References

- Official chrony documentation -- [chrony-project.org/documentation.html](https://chrony-project.org/documentation.html)
- Arch Wiki: Chrony -- [wiki.archlinux.org/title/Chrony](https://wiki.archlinux.org/title/Chrony)
- Arch Wiki: System time -- [wiki.archlinux.org/title/System_time](https://wiki.archlinux.org/title/System_time)
- NTP Pool project -- [www.ntppool.org](https://www.ntppool.org/)
- "Vbird's Linux Cabinet" - NTP server -- [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0440ntp.php)
- Man pages -- [chrony.conf(5)](https://man.archlinux.org/man/chrony.conf.5.en), [chronyc(1)](https://man.archlinux.org/man/chronyc.1.en)
- timedatectl(1) -- [freedesktop.org](https://www.freedesktop.org/software/systemd/man/timedatectl.html)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [network-parameters](network-parameters.md)
- [logging](/system-management/logging.md)
- [scheduled-tasks](/system-management/scheduled-tasks.md)