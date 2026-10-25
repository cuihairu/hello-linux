# Log Management

When a service goes wrong, I usually start with the logs: confirm whether the process started, what the startup errors were, and what anomalies occurred at runtime. On Linux, logs are collected by journald and written to disk by rsyslog; this page records the path logs travel from generation to disk, and the query entry points across the three distributions.

> Content adapted from the Arch Wiki, the rsyslog documentation, and Bird's Private Recipes (Lin's Linux Administration Guide); see the references at the end.

## What This Page Covers

- Explain the two-layer division of labor between journald collecting and rsyslog writing to disk
- Compare the three distributions' log file locations (`auth.log` / `secure` / journal)
- Become fluent with `journalctl -u` for per-service log queries, and get used to time-range and priority filtering
- Why journal persistence matters
- Reading traditional text logs

## 1. Why the Log Path Has Two Layers

The SysV era had only one daemon, rsyslog: every program wrote messages to `/dev/log`, and rsyslog split them into the various files under `/var/log` by rule. After systemd became widespread, `systemd-journald` became the first receiver, for very practical reasons:

- **A service's stdout/stderr lands in the journal naturally**. A service started with `Type=simple` has its standard output captured by journald even if it never writes a log file at all, without relying on the program implementing syslog itself.
- **Structured fields**. Every record carries fields such as `_SYSTEMD_UNIT`, `_PID`, `_COMM`, and priority, so a single `journalctl -u nginx` filter gets you exactly what you need, without grepping through tens of thousands of lines of text.
- **Kernel messages come free**. `/dev/kmsg` goes straight into the journal, and `journalctl -k` shows it.

But journald does not replace rsyslog; the two divide the work:

```text
app/kernel ──stdout, /dev/log──▶ systemd-journald ──(imjournal or ForwardToSyslog)──▶ rsyslog ──▶ /var/log/*.log
                                    │
                                    └──▶ /var/log/journal/ (binary, read by journalctl)
```

The default shape of modern distributions is: **journald handles collection and structured queries, rsyslog handles writing out text files by traditional rules** (for logrotate, grep, and third-party collectors to consume). A minimal system with only journald installed (such as some Arch servers) can have no rsyslog at all; then the `syslog` and `messages` files under `/var/log` do not exist, and all logs are kept in journal form.

## 2. Three-Family Log File Locations

The on-disk filenames below journald are decided by rsyslog rules, and the three families are not the same:

| Log content | Debian/Ubuntu | Arch (with rsyslog installed) | RHEL/CentOS/Rocky |
|-------------|---------------|-------------------------------|-------------------|
| General system logs | `/var/log/syslog` | `/var/log/messages` | `/var/log/messages` |
| Auth / login | `/var/log/auth.log` | `/var/log/audit/audit.log` (auditd) | `/var/log/secure` |
| Kernel | `/var/log/kern.log` | `/var/log/kern.log` (or the journal) | `/var/log/messages` (including the kernel section) |
| Package management | `/var/log/apt/` | `/var/log/pacman.log` | `/var/log/dnf.rpm.log` |
| Journal persistence | `/var/log/journal/` | `/var/log/journal/` | `/var/log/journal/` |

Arch does not install rsyslog by default, and logs are journal-centric; when you need traditional text files, `pacman -S rsyslog` and `systemctl enable --now rsyslog` is enough, but you have to configure imjournal or `ForwardToSyslog` as the Arch Wiki describes, otherwise rsyslog will not receive any data. Debian/Ubuntu and the RHEL family ship with rsyslog out of the box, with no extra install needed.

## 3. journalctl: Query Logs by Service

`journalctl` is the main tool for diagnosing service problems. Remember one rule of thumb: **when a service just failed to start, look at the unit logs first, then the configuration file**.

```bash
# Show a specific service's logs (the .service suffix can be omitted)
$ journalctl -u nginx -n 20 --no-pager
Sep 22 10:01:12 web01 nginx[2043]: nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)
Sep 22 10:01:12 web01 systemd[1]: Failed to start A high performance web server and reverse proxy server.

# Follow in real time (for tracking "errors while running")
journalctl -u nginx -f

# This boot / the previous boot (the key command for "a reboot caused a service outage")
journalctl -b -u nginx
journalctl -b -1 -u nginx

# By time window
journalctl -u nginx --since "2026-09-22 09:00" --until "2026-09-22 10:30"
journalctl -u nginx --since "10 min ago"

# By priority (warnings and above only)
journalctl -u nginx -p warning..alert

# Content search (more efficient than piping to grep, uses the index directly)
journalctl -u nginx --grep "bind\(\) to"
```

The output formats are worth learning too: `-o short-precise` adds microsecond timestamps, `-o json-pretty` is convenient for scripts to parse, and `-x` attaches the explanation text from the message catalog (do not use `-x` when filing a bug).

## 4. Persistence: Why and How

journald has two storage locations, which determine "are the logs still there after a power loss":

| Storage | Path | Characteristics |
|---------|------|-----------------|
| Volatile | `/run/log/journal/` | Only in memory/tmpfs, cleared on reboot |
| Persistent | `/var/log/journal/` | Written to disk, still queryable after reboot |

**The default behavior follows the distribution's configuration**: RHEL/CentOS/Rocky and Debian/Ubuntu usually default to persistent; Arch's systemd package includes the `/var/log/journal/` directory, and the default `Storage=persistent` also leans toward writing to disk. The most direct way to judge the current state is to see whether the directory exists and what `journald.conf` says:

```bash
$ ls -d /var/log/journal 2>/dev/null || echo "no persistent directory"
/var/log/journal

$ systemctl status systemd-journald | head -3
● systemd-journald.service - Journal Service
     Active: active (running) since Mon 2026-09-21 08:14:58 CST; 1 day 2h ago
```

Why persistence is mandatory: the most common server triage scenario is "everything was fine last night, the service is down this morning." If the journal lives only in memory, then after a reboot `-b -1` finds nothing, and the failure becomes an open case. Once persistent, the last few seconds of kernel messages before the power loss and the service crash stacks are still there.

Turning on persistence only requires the directory to exist, then restart journald (or `journalctl --flush`):

```bash
sudo mkdir -p /var/log/journal
sudo systemctl restart systemd-journald
```

You can also edit `/etc/systemd/journald.conf` (or a drop-in):

```ini
[Journal]
Storage=persistent
SystemMaxUse=500M
```

`SystemMaxUse` must be set. The default cap is about 10% of the containing filesystem's capacity (soft cap 4 GiB), and on a small partition logs can still fill the disk. After adjusting, restart systemd-journald to apply; for emergency slimming use:

```bash
$ journalctl --disk-usage                  # show current usage
$ sudo journalctl --vacuum-size=200M       # compress archived logs to under 200M
$ sudo journalctl --vacuum-time=2weeks     # keep only the last two weeks
```

## 5. Reading Traditional Text Logs

Files written out by rsyslog work with ordinary text tools; the commands are identical across the three families, only the file paths differ:

```bash
# Debian/Ubuntu
$ sudo tail -f /var/log/syslog
Sep 22 10:15:03 web01 systemd[1]: Started Daily apt download activities.

# RHEL/CentOS/Rocky
$ sudo tail -f /var/log/messages
Sep 22 10:15:03 web01 systemd[1]: Started Daily log rotation.

# Full-text search
$ sudo grep -n "error" /var/log/syslog
```

Recommendation: **use `journalctl -u` for online triage (structured, with fields), and the `/var/log` text files for offline forensics or tools that do not understand the journal**. The two are broadly the same source, not two independent log systems.

## 6. Common Pitfalls

1. **No permission to see the logs**: an ordinary user can only see their own user journal by default; reading system logs requires root, or membership in the `systemd-journal`, `adm`, or `wheel` group (depending on the distribution).
2. **`-b -1` is empty after a reboot**: this means the journal is not persistent, and the previous boot's logs were cleared with `/run`. Turn on persistence per section 4.
3. **Editing `journald.conf` has no effect**: you must `systemctl restart systemd-journald`; put drop-ins in `/etc/systemd/journald.conf.d/*.conf` to avoid an upgrade overwriting the main file.
4. **Assuming Arch must install rsyslog**: it does not. Arch's journal by default satisfies the vast majority of triage; only install `pacman -S rsyslog` when you need text files like `/var/log/messages` or want to feed a traditional syslog pipeline.
5. **Manually deleting log files**: removing `/var/log/journal/*/system.journal` breaks historical queries right there; shrink with `--vacuum-*`, not `rm`.
6. **`journalctl -f` appears stuck**: `-f` shows only the last 10 lines by default and then enters follow mode; when combining it with `-u`, confirm the unit name is spelled correctly, or you will just keep seeing "no output."
7. **Grepping for firewall/security events in the wrong file**: this page only covers the service log path; for firewall rules and rejection logs see the [Networking chapter, Firewall](../../network/firewall.md) and the [Security chapter](../../security/README.md), and for audit and SELinux denials see [Security Basics](../security.md).

## References

- `man journalctl`, `man journald.conf`, `man rsyslog.conf`
- Arch Wiki - systemd/Journal -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Journal)
- Arch Wiki - rsyslog -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Rsyslog)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Recognizing and analyzing login logs -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0570syslog.php)
- journalctl man page -- [man7.org](https://man7.org/linux/man-pages/man1/journalctl.1.html)
- journald.conf man page -- [man7.org](https://man7.org/linux/man-pages/man5/journald.conf.5.html)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [log](/basic/log.md)
- [services](/basic/services.md)
- [system_info](/commands/system/system_info.md)
