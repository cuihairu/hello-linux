# Logging System

## Chapter Introduction

Troubleshooting, capacity alerts, and security audits all come back to the logs in the end. The Linux logging system is built from three pieces: **journald** collects structured logs and serves them up through `journalctl`, **rsyslog/syslog-ng** writes messages to text files under `/var/log` according to rules, and **logrotate** handles rotation, compression, and cleanup. This chapter documents the logging protocols, the severity/facility classification, rsyslog configuration and rotation policy, and the path a message travels from creation to reclamation.

"The service will not start", "the disk filled up at 3 a.m.", "someone is brute-forcing SSH" -- the thing these scenarios have in common is that without logs you can only guess. This chapter does not repeat the `journalctl -u` service-debugging flow already covered in [System Services](./services.md); instead it focuses on the structure and maintenance of the logging system itself: how the logging protocols define a message's origin and severity, how rsyslog routes messages into different files according to rules, and how logrotate rotates them before the files blow out the disk. Once you understand this three-way division of labor, whatever distro or logging tool you move to, you can quickly work out "where did the logs go" and "where should I look".

> Content draws on the Arch Wiki, Bird's Private Recipes (Lin's Linux Administration Guide), and each tool's official documentation -- see the references at the end.

## Why Learn Logging as a Separate Topic

Two real scenarios make the point:

**Scenario one: after a power loss, last night's logs are gone.** By default journald may keep its logs only in `/run/log/journal/` (an in-memory filesystem), which is cleared on every reboot. Not knowing the concept of "persistence" means your troubleshooting dead-ends at the very first step.

**Scenario two: logs fill the disk and services fail together.** Some application writes 10 MB of logs a minute, nobody rotates them, and a month later `/var/log` fills the partition and the database refuses writes. logrotate exists precisely to solve the inevitable physical problem of "logs grow without bound" -- but the default `daily` policy is often not enough for high-traffic applications, and you need to understand what size, time, compression, and postrotate each solve before you can write a correct configuration.

The logging world also carries a layer of historical baggage: the syslog protocol (RFC 5424) dates from the 1980s and defined two classifications -- facility (who is speaking) and severity (how severe) -- that today's journald and rsyslog still use. Without understanding these two classifications you cannot read a rule like `authpriv.*  /var/log/secure` in `/etc/rsyslog.conf`, nor use `journalctl -p err` well.

> Content draws on systemd/journald, syslog, and the Arch Wiki -- see the references in each section.

## What This Page Covers

- The division of labor between journald and rsyslog/syslog-ng: who collects, who writes to disk, and why the two usually coexist
- The syslog facility and severity classifications
- Fluent use of the common `journalctl` queries: by unit, by time, by priority, and by content search
- What journal persistence buys you
- Designing logrotate rotation policy: why you need both size and time conditions, the compression-versus-delaycompress trade-off, and the correct use of postrotate

## Reading the Subpages

| Chapter | What it answers | When to read it |
|------|-------------|--------------|
| [System Logs](./log/syslog.md) | The path a message takes from creation to disk; the facility/severity classifications; rsyslog rule configuration; how journald relates to syslog; journalctl queries and persistence | When you want a systematic understanding of "where the logs go", or need to configure rsyslog rules |
| [Log Rotation](./log/rotation.md) | Why rotation is needed; what each logrotate option solves; choosing between postrotate/copytruncate; reclaiming journal space | When log files grow too large, rotation is not firing, or you need to write rotation rules for your own service |

How these two pages split with [System Services/Log Management](./services/log_management.md): that page covers the day-to-day flow of "**debugging why a particular service died**", while this page covers "**how the logging system itself works and is maintained**". The administrator side -- combined queries, quotas, and centralized forwarding -- is in [System Management · Logging System Administration](../system-management/logging.md); this page keeps the log pipeline, classification, and rotation model. Firewall logs and security auditing are in [Networking · Firewall](../network/firewall.md) and [Security Basics](./security.md).

## Three Families at a Glance

| Aspect | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------|---------------|------|--------------------|
| Default logging daemons | systemd-journald + rsyslog | systemd-journald (rsyslog optional, not installed by default) | systemd-journald + rsyslog |
| General log file | `/var/log/syslog` | Mostly the journal; `/var/log/messages` is common after installing rsyslog | `/var/log/messages` |
| Authentication log | `/var/log/auth.log` | journal + auditd | `/var/log/secure` |
| journal persistence | Usually on by default | The systemd package ships `/var/log/journal/`, persistent by default | Usually on by default |
| logrotate trigger | Daily cron job | `logrotate.timer` (a systemd timer) | Daily cron job / `logrotate.timer` |
| Package install | `apt install rsyslog` | `pacman -S rsyslog` (on demand) | `dnf install rsyslog` (installed by default) |

Note Arch's difference: in the official baseline rsyslog is not a required component -- **by default there is only journald**. This does not affect using `journalctl`, but it means files like `/var/log/syslog` may simply not exist. An administrator migrating from Debian/RHEL instinctively concludes "the logs are lost", when really only the place to look at them has changed.

## FAQ

**Q: Should I use `journalctl` or `tail -f /var/log/syslog`?**
For day-to-day service checks prefer `journalctl -u <unit>`; the structured field filtering is more precise. Use the `/var/log` files when you need to grep freely across services, or when feeding a text-only collector such as Filebeat. The two share the same source data (rsyslog usually reads from journald); they are not competitors.

**Q: How large a cap should the log directory have?**
`SystemMaxUse` in `journald.conf` caps the journal (on small partitions set it explicitly, e.g. 500M); leave text logs to logrotate, controlled by size plus the number of retained copies. Set both layers -- set only one and you get burned at the other.

**Q: Why is the new log empty after rotation, or why has the program stopped writing to the new file?**
The program is still holding the old file handle. Either send HUP/USR1 in postrotate so it reopens, or use `copytruncate` for programs that cannot reopen handles. See "Common Pitfalls" on the rotation page.

**Q: `logrotate -d` says it would rotate, but nothing actually rotated on the system?**
A manual `-d` run is debugging only; what really executes the rotation is cron or `logrotate.timer`. Check whether `systemctl status logrotate.timer` (or the matching cron entry) is enabled, and when this file last rotated according to `/var/lib/logrotate.status`.

**Q: Do I also read firewall denials and SELinux denials here?**
They do not conflict, but the entry points differ: firewall logs mostly land in `/var/log/messages`/`journalctl -k`, or in firewalld's own logs; SELinux denials live in `/var/log/audit/audit.log` and are queried with `ausearch` -- see [Security Basics](./security.md). This chapter focuses on the general logging pipeline and rotation and does not repeat the security chapters.

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - Understanding and Analyzing Log Files -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0570syslog.php)
- Arch Wiki - systemd/Journal -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Journal)
- Arch Wiki - Rsyslog -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Rsyslog)
- Arch Wiki - Logrotate -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Logrotate)
- `man journalctl`, `man rsyslog.conf`, `man logrotate`
- journalctl man page -- [man7.org](https://man7.org/linux/man-pages/man1/journalctl.1.html)
- logrotate man page -- [man7.org](https://man7.org/linux/man-pages/man5/logrotate.conf.5.html)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [services](services.md)
- [README](/security/README.md)
- [firewall](/security/firewall.md)
- [intrusion-detection](/security/intrusion-detection.md)
- [docker](/server/container/docker.md)
