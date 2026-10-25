# System Management

When a Linux machine goes wrong,
your value is not in "how many commands you remember"
but in **whether you can answer three questions within two minutes**:
what configuration is this machine running,
who is consuming the resources right now,
and what just happened.
This chapter is organized around those three questions --
identity and hardware first (system information),
then what is running (processes),
then how much resource is left (memory and disk),
then continuous observation (monitoring tools),
and finally solidifying repeated checks into configuration management.
Get that chain working and
"the server is slow" stops being a complaint with nowhere to start,
and becomes a set of hypotheses you can rule out one by one.

> This chapter's tools come mostly from the GNU/procps ecosystem and systemd,
> and work largely the same across **Debian/Ubuntu,
> Arch,
> and RHEL/CentOS/Rocky**;
> differences concentrate in log entry points, default monitoring packages, and how configuration-management tools are installed, and each is called out in the text.

## Why System Management Is the First Scene of Troubleshooting

Many people troubleshoot in the wrong order:
restart first,
then Google,
and only at the end think of reading the logs.
The order should be reversed --
**gather evidence first,
then form hypotheses,
and only then take action**.
Every tool in this chapter,
at bottom, serves "gathering evidence":

1. **`ps`/`top` answer "who is running"**.
   With CPU at 100%,
   sorting `top` by `P` picks out the culprit process within a second;
   `ps aux --sort=-%mem` lists the top memory consumers.
   Without this step,
   any "optimization" is blind.
2. **`free`/`df`/`du` answer "how much is left"**.
   `No space left on device` does not mean the disk is truly full --
   `df -h` for partitions,
   `du -sh *` for big directories,
   `df -i` for inode exhaustion (common with lots of small files),
   and you have the location in three steps.
3. **`journalctl`/`dmesg` answer "what just happened"**.
   Why was a process killed by the OOM killer?
   `dmesg | grep -i oom` has the answer.
   Why will a service not come up?
   `systemctl status` + `journalctl -u service -e` has the answer.
4. **Solidify repeated actions into configuration management**.
   When you need to install the monitoring agent on 50 machines,
   and change the sshd config uniformly,
   typing it 50 times by hand will fail eventually;
   a tool like Ansible upgrades "commands" into "auditable code".

Bird's Private Recipes (Lin's Linux Administration Guide) repeats in its older material:
system-management ability = observation ability x triage order.
The commands themselves are a lookup table away,
but the observation order needs deliberate practice,
which is why this chapter's five sub-pages are arranged in the order "observe -> analyze -> solidify".

> Example output comes from a real Ubuntu 26.04 environment; see the references at the end.

## What This Chapter Covers

- **Fast profiling**:
  with `uname -a`,
  `hostnamectl`,
  `lscpu`,
  `lsblk`,
  and `df -h`, describe a machine's kernel,
  distro,
  CPU,
  disk,
  and mounts within 30 seconds.
- **Processes under control**:
  fluent with `ps` (the `aux` and `-ef` styles),
  `top`/`htop` interactive use,
  signal choice with `kill`/`killall`/`pkill` (`TERM` first, then `KILL`),
  and foreground/background with `jobs`/`fg`/`bg`.
- **Reading memory correctly**:
  read `total/used/available` and buff/cache in `free -h`,
  know that `available` is the "memory actually allocatable",
  and do not mistake cache for a memory leak.
- **Pinpointing bottlenecks**:
  use `vmstat`,
  `iostat`,
  `mpstat`,
  and `pidstat` (the sysstat package) to judge whether the bottleneck is CPU,
  memory,
  or disk I/O,
  and use `sar` to look back at historical data.
- **Automating configuration**:
  understand Ansible's "agentless + SSH + YAML playbook" model,
  and write a minimal playbook that installs packages and edits a config file.
- **Three-family differences**:
  know that journalctl and
  systemctl work on all three families,
  while `yum` vs `dnf`,
  `iptables` vs `firewalld`,
  and the default log file locations must switch by distro.

## Reading the Subpages

| Subpage | One-line guide |
|------|------------|
| [System Information](./system/system_info.md) | Verify the machine's identity: `uname`, `hostnamectl`, `lscpu`, `lspci`, `lsusb`, `lsblk`, `df`, `uptime`, answering "what system is this, what hardware, how is the disk split". |
| [Process Management](./system/process.md) | The stars of runtime: both `ps` output styles, `top`/`htop` interaction, `pgrep` locating, `kill` signal semantics, `nohup`/`&`/`jobs` foreground and background control, plus how zombies and orphan processes arise. |
| [Memory Management](./system/memory.md) | Reading the memory ledger: what each `free` column means, `vmstat`/`slabtop`/`/proc/meminfo` in depth, the role of cache and buffers, and OOM killer trigger conditions and diagnosis. |
| [Configuration Management Tools](./system/configuration-management.md) | From commands to code: Ansible inventory/playbook/role core concepts with examples, where Puppet, Chef, and SaltStack sit relative to it, and the test for "when is configuration management worth it". |
| [System Monitoring Tools](./system/monitoring.md) | The eyes of continuous observation: `top`/`htop`/`atop` real-time monitoring, `vmstat`/`iostat`/`nload` performance analysis, `sar` historical replay, and the reasoning path from a metric to a bottleneck conclusion. |

Suggested route:
`system_info` -> `process` -> `memory` -> `monitoring` (the three acts of observation),
then read `configuration-management` last to solidify the manual steps above.
Self-check after reading:
given an unfamiliar machine,
report within two minutes "distro,
kernel,
CPU core count,
total memory,
disk usage,
and the three top CPU processes",
and this chapter counts as passed.

## Three-Family Differences at a Glance

| Scenario | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Service management | `systemctl` (systemd) | `systemctl` (systemd) | `systemctl` (systemd) |
| Log queries | `journalctl -u service` | same as left | same as left |
| Text log locations | `/var/log/syslog`, `/var/log/auth.log` | `/var/log/messages` (read the journal for details) | `/var/log/messages`, `/var/log/secure` |
| Package manager | `apt`/`dpkg` | `pacman` | `dnf` (`yum` on CentOS 7) |
| Default process viewer | `ps` (procps-ng) | `ps` (procps-ng) | `ps` (procps-ng) |
| Install `htop` | `sudo apt install htop` | `sudo pacman -S htop` | `sudo dnf install htop` |
| Install `sysstat` (iostat/sar) | `sudo apt install sysstat` (collection may not be enabled by default) | `sudo pacman -S sysstat` | `sudo dnf install sysstat` (set `ENABLED=true` by hand) |
| Firewall command | `ufw` (iptables/nftables underneath) | your own choice of `nftables`/`iptables` | `firewall-cmd` (firewalld) |
| Kernel log | `dmesg` (may need sudo) | `dmesg` | `dmesg` (the RHEL family restricts non-root reads by default) |

One detail that is easy to miss:
on Debian/Ubuntu, `sysstat` does **not start collecting** after install (`ENABLED=false` in `/etc/default/sysstat`),
so `sar` has no historical data;
Arch and the RHEL family are usually enabled by default.
If you want `sar` historical lookback,
confirm the collection switch first.

## Common Pitfalls

1. **Treating buff/cache as "memory being eaten up"**.
   The `used` column in `free -h` excludes cache,
   while Linux will happily take idle memory and use it as cache;
   to judge whether memory is genuinely short, look at the `available` column (or `free` with `-m`).
   Before adding memory blindly
   or tuning `vm.swappiness`,
   confirm that `available` is persistently low.
2. **Treating `kill -9` as the universal key**.
   `SIGKILL` (`-9`) cannot be caught,
   so the process has no chance to release locks,
   finish writing logs,
   or clean up temp files,
   which can cause data corruption or resource leaks.
   Correct practice:
   `kill PID` first (the default `SIGTERM`),
   and only `kill -9` a few seconds later if it still will not exit.
3. **The columns in `ps aux` and `ps -ef` mean different things**.
   Both list processes,
   but the positions and order of the `USER`/`PID`/`%CPU` columns differ,
   so before writing `awk '{print $2}'` to grab the PID, make sure which style you are in,
   or you will pull the wrong column.
4. **Reading the wrong metric in `top`**.
   High `%us` (user mode) is an application problem,
   high `%sy` (kernel mode) may mean too many syscalls or a driver problem,
   high `%wa` (I/O wait) is a disk bottleneck --
   all three count as "high CPU",
   but the conclusions are completely different.
5. **Use `top -b -n 1` in non-interactive/script environments**.
   Interactive `top` cannot be redirected directly for analysis;
   for batch collection use batch mode:
   `top -b -n 1 | head -20`.
6. **`dmesg` denied or rate-limited**.
   The RHEL family defaults to `kernel.dmesg_restrict=1`,
   so non-root `dmesg` reports `Operation not permitted`;
   use `sudo dmesg` or read `/var/log/dmesg`.
7. **Going full configuration-management toolchain on day one**.
   Ansible is a good start at 5-10 machines;
   Puppet/Chef carry higher learning and maintenance cost.
   First get the manual workflow smooth,
   script it,
   and only then consider tooling;
   otherwise you fall into "writing automation for the sake of automation".
8. **Forgetting the three families use different package managers**.
   When a monitoring command is missing:
   Debian/Ubuntu `sudo apt install package`,
   Arch `sudo pacman -S package`,
   RHEL/CentOS/Rocky `sudo dnf install package`;
   do not mix them.

## Common Questions

**Q: Does a `load average` above the CPU core count always mean trouble?**

Not necessarily.
Linux load covers both **running + uninterruptible sleep** (D state, usually waiting on I/O).
On a 16-core machine a load of 20 paired with `%util` near 100% in `iostat -x`
means the bottleneck is disk, not CPU;
the reverse -- load 18 but `%us` saturated and I/O idle --
is what CPU starvation looks like.
The judging order is always:
`top`/`mpstat` for the CPU split -> `iostat` for I/O -> `pidstat`/`ps` to locate the process;
do not conclude from the load number alone.

**Q: `available` and `free` are so far apart in `free -h` -- is memory enough or not?**

Look at **`available`**.
Linux takes memory it does not need right now and uses it as page cache (buff/cache) to speed disk I/O;
that memory is handed back the moment a process asks for it, so it is not counted as "free" but is available on demand.
The `free` column is only memory "never touched at all",
and it being persistently low on a modern system is **normal**.
Only when `available` stays below 5%-10% of total memory
and `swap used` in `free -h` keeps climbing
do you really need to add memory or hunt a leak.

**Q: What is the difference between `systemctl enable` and `start`?**

`start`/`stop` govern whether it runs **this one time now**;
`enable`/`disable` govern whether it starts automatically **at the next boot**.
The two are independent:
`enable` without `start` means the service waits for a reboot to take effect;
`start` without `enable` means the service is gone after a reboot.
The common "I changed the config and it did not take effect" in containers and cloud images
is half "forgot `systemctl daemon-reload` (the unit file changed)"
and half "only `start`ed without `enable` (or the reverse)".
`is-active`/`is-enabled` verify each state separately.

**Q: Which signal does `kill` send by default, and why must `kill -9` not be used casually?**

The default is **SIGTERM (15)**,
which a process can catch, and use to clean up temp files, close connections, and release locks.
`kill -9` sends **SIGKILL**,
where the kernel reclaims directly and the process gets no chance to clean up --
a database may leave transactions unflushed,
and leftover lock files may make the next start fail.
The troubleshooting order should be:
`kill` (TERM) and wait a few seconds -> if that fails, `kill -HUP` or the graceful-exit signal the app's docs recommend -> only then `-9`.
For a process that will not die, what really needs checking is which syscall it is stuck in (`strace -p`), not repeated follow-up shots.

## References

- `man ps`, `man top`, `man free`, `man systemctl`, `man journalctl`, `man vmstat`, `man iostat`
- Bird's Private Recipes (Lin's Linux Administration Guide) - observing programs and job management -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0440processcontrol.php)
- Arch Wiki - Process management -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Process)
- Arch Wiki - systemd -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd)
- Arch Wiki - Btop/Htop (monitoring tools) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- procps-ng project page -- [gitlab.com](https://gitlab.com/procps-ng/procps)
- sysstat manual (iostat/vmstat/sar) -- [sebastien.godard.pagesperso-orange.fr](https://github.com/sysstat/sysstat)
- Red Hat documentation - Monitoring and managing system status and performance -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/index)
- Ansible official documentation -- [docs.ansible.com](https://docs.ansible.com/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [README](/system-management/README.md)
- [performance](/system-management/performance.md)
