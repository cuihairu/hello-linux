# Logging System Management

The first scene of any troubleshooting is always the logs: a service that healed itself at 3am, a disk that filled overnight, a stranger IP trying passwords again and again -- the answers lie in a few log lines. But "the system is writing logs" and "you can find them" are two different things: with the wrong combination of filter dimensions you are doing a full table scan on an unindexed table; without persistence turned on, one reboot erases the scene; and application logs sitting in their own files, never wired into the bus, will never turn up no matter how long you page through journalctl. The basics page's [System Logs](../basic/log/syslog.md) covers the journald/rsyslog division of labor and the facility/severity vocabulary, and [Log Rotation](../basic/log/rotation.md) handles file lifecycle; this page fills in the remaining three skills on the administrator side: **query fast** (journalctl combined filtering), **keep them** (persistence and quotas), and **ship them out** (rsyslog ingestion, splitting, and central forwarding), closing with the three high-frequency failure classes "not arriving / gone / written twice".

> Content adapted from the systemd/rsyslog official documentation and the Arch Wiki (conceptual framework from Bird's Private Recipes (Lin's Linux Administration Guide)); see the references at the end.

## What This Page Covers

- Combine journalctl's four filter dimensions -- service, time, priority, and field -- to translate a troubleshooting question into one query
- Tell apart volatile and persistent journal storage, and independently enable persistence, set quotas, and reclaim by hand
- Use rsyslog's imfile to ingest application file logs into the bus, split by program and date, and forward to a central collector with a queue
- The rsyslogd -N1 and journalctl self-check chain, to locate the three failure classes "logs not arriving / gone / written twice"

## 1. Logs Are the First Scene of Troubleshooting

First the division of labor, to avoid repeating the basics page: the journald/rsyslog concepts and facility/severity live in the basics page's [System Logs](../basic/log/syslog.md) and are not restated here. The administrator side focuses on two kinds of action: **querying** (filter by time, service, and severity) and **piping** (ingest application logs, cap their footprint, forward to a center). When querying, set the time window first, then stack filter dimensions on top, and only then choose follow, export, or structured output; skipping the time window and paging through everything full-volume routinely turns troubleshooting into a full table scan in the middle of a long night.

Once you are fluent with this method, you will find that log-side failures come down to three sentences: **logs not arriving** (the collection layer is broken -- the app does not run under systemd, the file is not watched by imfile, the forwarding queue is backing up), **logs gone** (the retention layer deleted them -- volatile journald storage, quota-triggered vacuum, rotation clearing files), and **logs written twice** (the rules layer missed a stop, and the same message is written once by each of two rules). Section 2 of this page solves "query fast", section 3 solves "keep them", sections 4 and 5 solve "ship them out", and section 6 lists the typical faces of each failure class as a pitfall checklist -- every pitfall you read there has a corresponding handling paragraph earlier on the page.

## 2. journalctl: Translate the Problem into a Query

### 2.1 Four Filter Dimensions

All of journalctl's retrieval power reduces to four dimensions, stacked one by one like so many AND conditions:

| Dimension | Syntax | What it matches |
|-----------|--------|-----------------|
| Service | `-u nginx` (or the full name `-u nginx.service`) | All messages produced under that unit name |
| Time | `--since "2026-10-02 03:00" --until "03:30"` | A time window; also accepts colloquial forms like `today`, `-1h` |
| Priority | `-p err`, `-p err..alert` | A single value means "that level and worse"; a range is a closed interval |
| Field | `_COMM=sshd`, `_PID=2811`, `_UID=0` | Metadata fields carried by the messages; several may be listed together |

```bash
# Everything from nginx on this machine since the last boot
$ journalctl -u nginx -b --no-pager | tail -5
Oct  2 09:01:22 web01 systemd[1]: Started A high performance web server.
Oct  2 09:01:23 web01 nginx[1289]: nginx/1.24.0 configuration file /etc/nginx/nginx.conf test is successful

# All sources at err and worse since midnight today
$ journalctl -p err --since today
Oct  2 03:14:08 web01 systemd[1]: Failed to start My Application.

# The traces left by one process number (pinning down "what did this PID actually say")
$ journalctl _PID=2811
```

The most underrated of the four is the field dimension: `_COMM` matches by executable name, with no dependence on the service being under systemd, so hand-started background processes and one-shot cron scripts can all be fished out by name; `_UID=0` is the audit viewpoint's entry -- "which programs did root get talking today" is one command away. The colloquial time forms (`--since "-2h"`, `--since yesterday`) are much faster than typing full timestamps in an emergency and worth burning into muscle memory; history across boots needs `-b`, where `-b` is this boot, `-b -1` the previous one, and `journalctl --list-boots` lists the boot indexes first so you can look them up instead of guessing "how many days ago was the last crash":

```bash
$ journalctl --list-boots
IDX  BOOT ID  FIRST ENTRY                 LAST ENTRY
-2   9f8e7d…  Wed 2026-09-30 08:11:02    Wed 2026-09-30 21:44:10
-1   1c2b3a…  Thu 2026-10-01 08:03:47    Thu 2026-10-01 22:10:45
 0   7e6d5c…  Fri 2026-10-02 07:58:19    Fri 2026-10-02 09:12:33
```

There is also a regex dimension, `--grep`, which pushes the filtering down inside the journal files, faster and lighter on memory than a grep in a pipe; if your distro compiled systemd without PCRE2 support, journalctl will say so explicitly, and falling back to `journalctl … | grep -E` works just as well, only slower:

```bash
$ journalctl -u myapp --since today --grep "connection refused"
Oct  2 08:44:19 web01 myapp[3120]: connection refused: 127.0.0.1:6379
Oct  2 08:59:41 web01 myapp[3120]: connection refused: 127.0.0.1:6379
```

### 2.2 Output Formats and Volume

The right query still needs the right exit format. The default paged output suits human eyes; `-f` follow-scroll is the standard posture for "watch the scene after a config change"; `-o short-iso` swaps timestamps for ISO form -- the default `Oct 2 09:12:33` carries no year, which misleads when paging across New Year and is a real trap for scripts; `-o json` / `-o json-pretty` outputs structured fields, the front door for external analysis tools; `-e` jumps straight to the tail, paired with `--no-pager` to grab "the last few screens" in a pipeline. On the volume side, two commands should become reflexes: `journalctl --disk-usage` to see how much disk logs occupy, and `journalctl --vacuum-size=500M` to immediately squeeze archived logs under the target cap (it touches only archived files, never the active one being written), see section 3.3:

```bash
$ journalctl -u myapp --since today -o short-iso --no-pager | tail -2
2026-10-02T09:58:07+0800 web01 myapp[3120]: listening on :8080
2026-10-02T09:59:41+0800 web01 myapp[3120]: ready in 1.2s
$ journalctl -u myapp -n 3 -o json-pretty | head -8
{
	"__CURSOR" : "s=7e6d5c…;i=4f2b;m=1a2b…;t=17…",
	"__REALTIME_TIMESTAMP" : "1761867587000000",
	"_COMM" : "myapp",
	"MESSAGE" : "listening on :8080",
	"PRIORITY" : "6",
	"_SYSTEMD_UNIT" : "myapp.service"
}
```

The field names in the json output are the raw material for the filter dimensions in section 2.1 -- `_COMM`, `_SYSTEMD_UNIT`, and `PRIORITY` both explain why the query parameters are written the way they are and mark which columns you can get when plugging into an external analysis tool.

### 2.3 Three Combined Drills

**Drill one: the service "healed itself" at 3am.** The morning patrol finds nginx's restart counter up, but nobody admits touching the machine. Pin the time window on the service itself first, then look at who touched it inside the same window:

```bash
$ journalctl -u nginx -b --since "02:50" --until "03:30" -o short-iso
2026-10-02T03:14:09+0800 web01 systemd[1]: Stopping A high performance web server...
2026-10-02T03:14:09+0800 web01 systemd[1]: nginx.service: Deactivated successfully.
2026-10-02T03:14:10+0800 web01 systemd[1]: Started A high performance web server.
```

Who initiated the Stopping? Widen the same window to everything at warning and above, and the answer is usually a few lines away -- at 3am the most common cause is a cron-triggered certificate-renewal script whose failed reload escalated into a restart, or the OOM killer taking out a worker (see drill two). The reading order is always: the service's own timeline first, then the full context of the same window, and only last the application's own logs.

**Drill two: tracing an OOM event.** A memory-killed process leaves no last words of its own; the last words are with the kernel and systemd:

```bash
$ journalctl -k --since "03:10" --until "03:20" | grep -iE "out of memory|killed process"
Oct  2 03:14:08 web01 kernel: Out of memory: Killed process 4321 (java) total-vm:8123456kB, anon-rss:7654321kB, file-rss:0kB, shmem-rss:0kB
$ journalctl -b --since "03:14" --until "03:15" -p warning
Oct  2 03:14:08 web01 systemd[1]: myapp.service: A process of this unit has been killed by the OOM killer.
Oct  2 03:14:09 web01 systemd[1]: myapp.service: Scheduled restart job, restart counter is at 1.
```

`-k` shows only kernel messages, and the first OOM line is right there; then `A process of this unit has been killed by the OOM killer` maps the kernel event back to the concrete unit, and `restart counter` shows it was systemd that pulled it back up -- put the three pieces together and "the service self-healed at 3am" and "memory ran short" line up on the same timestamp. These two drills are the same event on the same night, which is exactly the norm of log troubleshooting: the symptom on the service side, the root cause next door.

**Drill three: SSH login audit.** Who logged in when from which IP, and who is brute-forcing:

```bash
$ journalctl _COMM=sshd --since today | grep -E "Accepted|Failed"
Oct  2 09:12:33 web01 sshd[2811]: Accepted publickey for ops from 192.168.56.11 port 51344 ssh2: ED25519 SHA256:Qk3…
Oct  2 09:40:02 web01 sshd[3390]: Failed password for invalid user admin from 203.0.113.7 port 40122 ssh2
```

Matching by `_COMM=sshd` is steadier than matching by unit -- the Debian family's unit is called `ssh`, the RHEL family's `sshd`, while the process name is identical across all three families. Brute-force detection is just aggregating Failed counts by source IP; whether to go further and auto-ban is an intrusion-detection topic, see the Security section.

## 3. Persistence and Quotas: Logs Have to Stay

### 3.1 The Two Destinies of /run and /var

journald has two candidate on-disk locations: `/run/log/journal/` and `/var/log/journal/`. The former lives on an in-memory filesystem and is **volatile** -- wiped on reboot; the latter lives on disk and survives reboots. The default policy is `Storage=auto`: if the `/var/log/journal/` directory exists it goes persistent, otherwise it falls back to volatile. This explains a frequent confusion: "I clearly saw those logs yesterday, and today `journalctl -b -1` says there is nothing" -- the query was not wrong; the machine never wrote logs to disk in the first place, and the scene evaporated the moment it rebooted. The distinction is visible at a glance: if `journalctl --list-boots` shows a single line (index 0), no historical boot was ever persisted.

### 3.2 Turning Persistence On

Enabling persistence is a few commands, identical across the three distro families:

```bash
$ sudo mkdir -p /var/log/journal
$ sudo systemd-tmpfiles --create --prefix /var/log/journal/
$ sudo systemctl restart systemd-journald
$ journalctl --flush          # Pour the backlog still sitting in /run into /var
$ journalctl --list-boots     # After one reboot, historical boots should start accumulating here
```

The second tmpfiles command is not a dispensable ritual -- it applies systemd's own tmpfiles rules to fix the directory owner to `root:systemd-journal` and mode 2755; the default owner a manual mkdir produces leaves ordinary users unable to read a single line (journal read access is group-based: members of `systemd-journal` read everything, ordinary users only their own messages -- both a convenience and an audit boundary). After the change, verify owner and mode with one `ls` line; that is far cheaper than digging through a permissions pitfall afterwards:

```bash
$ ls -ld /var/log/journal /var/log/journal/*/
drwxr-xr-x 3 root root           4096 Oct  2 10:00 /var/log/journal
drwxr-xr-x 2 root systemd-journal 4096 Oct  2 10:00 /var/log/journal/7e6d5c…/
```

The other route is writing `Storage=persistent` in `/etc/systemd/journald.conf` and restarting journald; the effect is the same, and the explicit declaration has the benefit that the config file itself is traceable.

### 3.3 Quotas and Reclamation

Once persistence is on, logs start competing with business data for disk, so set a quota at the same time. journald supports paired constraints by capacity and by retention period, with the stricter one winning:

```text
# /etc/systemd/journald.conf (excerpt)
[Journal]
Storage=persistent
SystemMaxUse=500M        # Total cap on journal size
SystemKeepFree=1G        # Free space at least left for the filesystem
MaxRetentionSec=1month   # Maximum retention time
```

```bash
$ sudo systemctl restart systemd-journald
$ journalctl --disk-usage
Archived and active journals take up 812.0M in the file system.
$ sudo journalctl --vacuum-size=500M
Vacuuming done, freed 312M of archived journals from /var/log/journal/7e6d….
```

`--vacuum-size` is the "takes effect immediately" manual reclaim; run it once after changing a quota to squeeze the backlog inside the new cap. It cleans only archived journal files and leaves the active file alone, so a post-run usage slightly above the target is normal. `SystemKeepFree` is often ignored yet is precisely the accident-preventing one -- it speaks for the filesystem: "whatever my cap is, leave at least 1G for the others", preventing logs from blowing up `/var` so badly that even their own quota files cannot be written. Capacity governance of rsyslog-side text files is not journald's business; that goes through logrotate, see the basics page's [Log Rotation](../basic/log/rotation.md).

### 3.4 Where journald and rsyslog Meet

With both logging systems coexisting, rsyslog's message sources come by two roads: the old road, `imuxsock`, listens on the traditional `/dev/log` socket, with journald forwarding a copy on its behalf; the new road, `imjournal`, consumes straight from the journal. The RHEL family defaults to imjournal, and Debian's traditional setup leans on imuxsock -- which road your machine takes is decided by which module `/etc/rsyslog.conf` actually loads; there is no need to memorize a distro comparison table. This junction explains one "duplicate" phenomenon: the same sshd message is visible both in `journalctl -u ssh` and in `/var/log/auth.log` (Debian) or `/var/log/secure` (RHEL); it is not written twice, it is the bus and the router each doing their job and each keeping a copy -- and the two copies therefore have independent retention policies: the journal reclaims under the section 3.3 quotas, the text files clean up under the rotation policy.

## 4. rsyslog Engineering: Ingest, Split, Forward

The journal solves "messages inside the systemd ecosystem", but plenty of applications (the JVM family and third-party closed-source services especially) will only write to their own log files. Bringing those files into the unified pipeline is the job of rsyslog's imfile module. Install the package first, three families side by side:

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------|---------------|------|-------------------|
| Install | `apt install rsyslog` | `sudo pacman -S rsyslog` | `dnf install rsyslog` |
| Service name | `rsyslog.service` | `rsyslog.service` | `rsyslog.service` |
| Snippet directory | `/etc/rsyslog.d/` (included by default) | Confirm the main config has the include | `/etc/rsyslog.d/` (included by default) |
| Syntax check | `rsyslogd -N1` | `rsyslogd -N1` | `rsyslogd -N1` |

### 4.1 imfile: Wire Application File Logs into the Bus

A complete, runnable ingestion config that brings `/opt/app/log/app.log` in under the program name `myapp`, split by day on disk:

```text
# /etc/rsyslog.d/30-app.conf -- application file log ingestion and daily split
global(workDirectory="/var/spool/rsyslog")   # Landing directory for disk queues, mandatory

module(load="imfile")

template(name="appdaily" type="string"
         string="/var/log/app/%PROGRAMNAME%/%$YEAR%-%$MONTH%-%$DAY%.log")

input(type="imfile"
      File="/opt/app/log/app.log"    # The file the application is writing
      Tag="myapp"                    # The programname once inside syslog
      Facility="local1"
      Severity="info")

if $programname == 'myapp' then {
    action(type="omfile" dynaFile="appdaily")
    stop                             # Already on disk; do not flow into later rules
}
```

The four parts each do one job: `global(workDirectory=…)` names where queue files live -- leave it out and every disk-queue parameter later in the file silently does nothing, the number-one invisible pitfall in imfile engineering; `input(type="imfile")` watches the file: the app appends a line, imfile reads a line, and after rotation renames the file, imfile follows to the new one automatically (with the copytruncate rotation scheme, mind the lost-line window during the instant of rotation, see [Log Rotation](../basic/log/rotation.md)); `Tag` decides the message's identity inside the pipeline, and all later filtering checks credentials against `$programname`; the `dynaFile` template expands `%$YEAR%-%$MONTH%-%$DAY%` into the path, effectively having rsyslog do the daily split for you -- splitting granularity and rotation policy are either/or, no need for both belts. To ingest multiple files, imfile's `File` parameter supports globs (`File="/opt/app/log/*.log"`), one input watching a set of rolling files; but messages coming through a glob share the same Tag, so when destinations must differ per file, split into multiple inputs each with its own Tag -- identity is fixed at the entrance, the first principle of the whole pipeline. The trailing `stop` is rainer script's "thus far and no farther" -- without it the message keeps flowing into the next rule and eventually appears once more in `/var/log/syslog`, which is the canonical cause of "written twice".

After changing the config, the fixed motion is validate-then-restart, the same discipline as running `named-checkconf` before a DNS reload:

```bash
$ sudo rsyslogd -N1
rsyslogd: version 8.2312.0, config validation run (level 1), master config /etc/rsyslog.conf
rsyslogd: End of config validation run. Exit.
$ sudo systemctl restart rsyslog
$ logger -p local1.info -t myapp "manual smoke test"   # Smoke test: forge one message through the pipeline
$ tail -1 /var/log/app/myapp/2026-10-02.log
Oct  2 10:02:11 web01 myapp: manual smoke test
```

`logger` is the best acceptance tool for this pipeline -- it injects one message with the specified facility and tag into the bus, and it should appear in the end file immediately; the closed loop "change config -> validate syntax -> restart -> inject -> see result" finishes inside a minute, far faster than waiting for the application to really write logs and then digging through files.

### 4.2 Forwarding and Queue Buffering

Getting logs off the local machine is the premise of centralization. Forwarding has an old and a new syntax with the same semantics: the old form is a one-liner (double @ is TCP, single @ is UDP):

```text
# /etc/rsyslog.d/40-forward-legacy.conf -- old syntax: runs, but no way to configure a queue
*.* @@192.168.56.20:514     # TCP
*.err @192.168.56.20:514    # UDP: only err and above
```

The old form wins at being writable in ten seconds and loses at having no buffering semantics whatsoever -- when the center becomes unreachable, the sending side either blocks or drops; in production, go straight to the new form, parameterized and queue-capable:

```text
# /etc/rsyslog.d/40-forward.conf -- forward to the central collector (TCP + disk queue buffering)
action(type="omfwd"
       target="192.168.56.20"
       port="514"
       protocol="tcp"
       queue.type="LinkedList"          # In-memory linked-list queue
       queue.filename="fwd_central"     # Filename prefix spilled to disk on overflow (depends on workDirectory)
       queue.maxDiskSpace="100m"        # Disk queue cap
       queue.saveOnShutdown="on")       # rsyslog saves the queue on exit and resumes after restart
```

The TCP-versus-UDP choice is a reliability-versus-overhead trade: UDP is light but drops silently, suited to low-value streams on the LAN; TCP is ordered and reliable, but when the central collector is unreachable it pushes back -- the queue buffer exists precisely for that unreachable window: the in-memory queue holds first, spills to disk when it cannot hold, and resumes when the collector returns, while `saveOnShutdown` also covers the window where rsyslog itself gets restarted. The costs are that the disk queue depends on the workDirectory stressed in section 4.1, and that queueing masks the fact that "the center actually died long ago" -- queue monitoring (the `impstats` module) is worth adding in production but is beyond this page; knowing that the queue is a buffer, not a get-out-of-jail card, is enough.

### 4.3 Noise Control: The Ordering Semantics of stop

The rsyslog rule table executes **in order**, the same mental model as firewall rule chains: messages flow top to bottom, a match fires the action, and `stop` is the explicit "match terminated". The routine noise-control move is to stop explicitly unwanted sources as early as possible -- an access log at one line every ten seconds from a health check, or a component's debug firehose during development; the only effect of letting them into `/var/log/messages` is diluting the useful signal:

```text
# /etc/rsyslog.d/31-noise.conf -- noise sources to drop early
if $programname == 'healthcheck' then stop
if $syslogfacility-text == 'local0' and $syslogseverity-text == 'debug' then stop
```

Two disciplines: stop belongs in a snippet file whose number sorts early (rsyslog.d executes in 00-99 numeric order; a stop placed late cannot save a message already written to disk by an earlier rule); and stop is discarding, not filtering -- only stop when you are sure you never want it; when unsure, use the section 4.1 template to split it into a separate file, where keeping it harms nothing.

## 5. Centralized Logging: Local Logs Cannot Be Trusted in a Failure

Logs live and die with the machine -- the structural defect of local logging: the disk burns, the kernel panics, the cloud VM is reclaimed, and the only witness that explains the incident disappears together with it. The centralized idea is plain -- ship the logs out while the machine is still alive and treat the local copy as a mere buffer. The minimal implementation is section 4.2's omfwd forwarding plus one central rsyslog; on the central side, sorting the incoming stream into per-host directories is likewise one template away:

```text
# Central collector /etc/rsyslog.d/50-receive.conf -- receive remote and split by host
module(load="imtcp")
input(type="imtcp" port="514")

template(name="byhost" type="string"
         string="/var/log/remote/%HOSTNAME%/%$YEAR%-%$MONTH%-%$DAY%.log")

*.* ?byhost
```

At larger scale, dedicated collectors from the modern stack such as vector or fluent-bit are handier at parsing, routing, and multiple destinations, but the topology -- light local forwarding, central consolidated storage -- does not change; only the parts are swapped. After centralizing, three boundaries must be kept in mind: first, **timestamp trustworthiness decides log comparability** -- two machines two minutes apart put the event order at the center wrong, so get NTP right first (see [Time Service](../server/ntp.md)) before talking about cross-machine correlation; second, **forwarding is asynchronous** -- the last second of logs before a machine's sudden death may still sit unsent in the queue, and you must tolerate that truncation to read "the last log stops at 03:14:08" correctly; third, **retention policy and compliance are a pair of constraints** -- when a security audit demands 180 days while the disk budget says 7, the compromise is tiered retention (full stream short-term, alert stream long-term); how to configure the rotation parameters for text files is in [Log Rotation](../basic/log/rotation.md).

## 6. Common Gotchas

**Journal history disappears after a reboot.** `journalctl -b -1` reporting "Data from the specified boot(s) is not available" and `--list-boots` showing a single line are the same fact: journald runs in volatile mode (`/run/log/journal/`), wiped on every reboot. Turn on persistence per section 3.2 (mkdir + tmpfiles owner fix + restart + flush) and confirm `/var/log/journal/<machine-id>` is owned `root:systemd-journal` with mode 2755.

**-u finds no old logs.** Three sources: the logs themselves were already reclaimed by `--vacuum-size` or quotas (cross-check with `--disk-usage`); the query implicitly carried `-b` and only looked at this boot (add `-b -1` explicitly or drop it); or the unit name does not match -- the `.service` suffix is optional, but `-u` matches exactly the unit name recorded at message time, so history from before a service rename still hangs under the old name, and aliases equally miss; `systemctl status <old name>` helps you confirm the recorded name.

**The disk is stuffed full of logs.** First tell apart who owns it: `journalctl --disk-usage` for the journal, `du -sh /var/log/* | sort -h | tail` for the text files; the two disposal paths are entirely different:

```bash
$ journalctl --disk-usage
Archived and active journals take up 3.9G in the file system.
$ sudo journalctl --vacuum-size=500M      # Emergency: squeeze back under the cap immediately
Vacuuming done, freed 3.4G of archived journals from /var/log/journal/7e6d….
$ sudo du -sh /var/log/* | sort -h | tail -3
4.0K    /var/log/remote
412M    /var/log/journal
2.1G    /var/log/app                    # The application directory split out by imfile, governed by rotation
```

On the journal side, check whether `SystemMaxUse` is missing and whether `/var/log/journal` permissions are right, and use `--vacuum-size` for an emergency immediate reclaim; the files imfile splits by day are outside journald's quotas and governed by logrotate (add a rotation snippet for `/var/log/app`, see [Log Rotation](../basic/log/rotation.md)). The root-cure item for quotas is `SystemKeepFree` -- it guarantees the logs always leave the filesystem a way out.

**Changed rsyslog config but it does not take effect.** Two typical forms: you restarted without running `rsyslogd -N1`, and a syntax error keeps the service down (`systemctl status rsyslog` + `journalctl -u rsyslog -e` for the red lines); or the syntax passes but the snippet file is in the wrong place -- the rsyslog.d directory only takes effect through the main config's include, and on Arch the main config does not necessarily include that directory by default; `rsyslogd -N1` validates "the config that was loaded", and a file that is not included is neither validated nor ever executed.

**Application logs never reach the journal.** systemd only collects the stdout/stderr of service processes it started itself: an application started by hand with nohup, or one writing its own files without touching standard output, naturally has nothing in the journal. Pick one of two roads: bring the application under systemd (its output enters the journal automatically), or use section 4.1's imfile to wire the file side into the rsyslog pipeline; the fastest way to settle ownership is one lookup by executable name with `journalctl _COMM=<process name>`.

**The same message is written twice.** The scene is almost always on the rsyslog side: two rules both matched with no stop (the `if` block in section 4.1 missing its trailing stop); or the snippet file's number sorts after the generic rules, so the dedicated file writes and then `/var/log/messages` writes it again. The search order: trace backwards from the message to see which `omfile` actions it hit (`rsyslogd -N1` validates syntax, not logic; the logic you walk by hand, treating the rule table like a firewall chain), then add the stop at the right place; the journal and the text files each keeping a copy is not a duplicate (see the junction note in section 3.4) -- do not turn off either side over it.

## References

- systemd journalctl man page -- [freedesktop.org](https://www.freedesktop.org/software/systemd/man/journalctl.html)
- systemd journald.conf man page -- [freedesktop.org](https://www.freedesktop.org/software/systemd/man/journald.conf.html)
- rsyslog official documentation -- [rsyslog.com](https://www.rsyslog.com/doc/)
- Arch Wiki: systemd/Journal -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Journal)
- Bird's Private Recipes (Lin's Linux Administration Guide) -- [linux.vbird.org](https://linux.vbird.org/)
- man journalctl / man rsyslog.conf -- local man pages

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [selinux](/security/selinux.md)
- [README](/source/README.md)
- [driver-framework](/source/driver-framework.md)
- [README](README.md)
