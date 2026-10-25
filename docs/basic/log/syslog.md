# System Logs

"When a service will not start, check the logs first" is common wisdom, but people who actually open `/var/log` tend to trip over two questions: who exactly writes the logs in there? And where do facilities like `auth`, `daemon`, and `kern` come from? The answer is one fixed pipeline: applications drop messages to `/dev/log` or write straight to stdout, **journald**, the collector that ships with systemd, stores a structured binary journal first, then **rsyslog** routes it by the rules in `/etc/rsyslog.conf` into text files such as `/var/log/syslog`, `messages`, and `secure`. This page maps the upstream/downstream relationships of that pipeline, the syslog protocol's severity/facility classification, rsyslog rules and remote forwarding, and how Arch differs by shipping only journald; it also covers everyday `journalctl` queries and journal persistence -- without understanding persistence, after a power loss you cannot even find last night's logs.

> Content adapted from the rsyslog documentation, the Arch Wiki, and Bird's Private Recipes (Lin's Linux Administration Guide); see the references at the end.

## What This Page Covers

- Map the journald -> rsyslog -> text-file log pipeline
- syslog severity levels (0-7) and the facility classification
- Configure rsyslog routing and remote forwarding, and know how Arch differs by shipping only journald
- Use `journalctl` fluently to search by unit, time, priority, and content
- Why journal persistence matters

## 1. The Log Pipeline: How journald and rsyslog Divide the Work

First, the question that confuses people most: **are journald and rsyslog competitors? No -- they sit in an upstream/downstream relationship.**

```text
app writes /dev/log  ─┐
service stdout/stderr ┼─▶ systemd-journald ──┬─▶ /var/log/journal/ (binary, read by journalctl)
kernel /dev/kmsg     ─┘                      │             └─▶ rsyslog ──▶ /var/log/syslog, messages, etc. (text)
                                             │                       ▲
                                             └── ForwardToSyslog / imjournal ──┘
```

- **systemd-journald**: the collector that ships with systemd; it listens on `/dev/kmsg` and `/dev/log` and stores every message in binary journal files together with structured fields such as `_SYSTEMD_UNIT`, `_PID`, and priority. It works without depending on any external logging program.
- **rsyslog**: the modern version of the traditional syslog implementation; it pulls from journald (the imjournal module) or gets pushed by journald (`ForwardToSyslog=yes`), then routes messages into text files by the rules in `/etc/rsyslog.conf`. It also handles remote forwarding (`@host`) and more complex conditional filtering.
- **syslog-ng**: a peer alternative to rsyslog with a different configuration syntax (using `destination`/`log` statements) but a similar role. None of the three families install it by default; install it yourself and wire it to journald if you need it.

By default (Debian/Ubuntu, the RHEL family): **journald is the first stop, rsyslog is the one that writes files to disk**. Arch ships only journald by default; text files such as `/var/log/messages` only appear after you install rsyslog:

```bash
# Arch: install and enable rsyslog on demand
$ sudo pacman -S rsyslog
$ sudo systemctl enable --now rsyslog
```

Mind the ordering: on Arch, if you `start rsyslog` before `enable`, it can fail on a missing `syslog.service` symlink dependency; `systemctl enable --now rsyslog` does both in one step and avoids that. Configure either imjournal or `ForwardToSyslog` -- one of the two is enough for rsyslog to get data; see [Arch Wiki - Rsyslog](https://wiki.archlinux.org/title/Rsyslog).

## 2. Severity Levels

syslog defines eight urgency levels, 0-7; the smaller the number, the more severe. `journalctl -p` and rsyslog rules both speak this vocabulary:

| Level | Value | Meaning | Typical examples |
|------|------|------|---------|
| emerg | 0 | System is unusable | Kernel crash, systemd core dump |
| alert | 1 | Action must be taken immediately | Critical subsystem failure, risk of data loss |
| crit | 2 | Critical conditions | Main program crash, core dump |
| err | 3 | Error conditions | Non-fatal failures: port binding failed, disk read-only |
| warning | 4 | Warning | Partition almost full, certificate about to expire |
| notice | 5 | Normal but significant | Mount point not empty, mounting anyway |
| info | 6 | Informational messages | Service started successfully, logical volume activated |
| debug | 7 | Debug messages | Only emitted when explicitly enabled |

Mnemonic (from 7 down to 0): **D**o **I** **N**otice **W**hen **E**vents **C**ome **A**round **E**arly.

`journalctl -p err` means "err and higher (numerically smaller)," i.e. err/crit/alert/emerg are all shown; the range form `warning..alert` takes only the closed interval.

## 3. Facility: Who Produced the Log

Severity says "how bad," facility says "who said it." Only the combination pinpoints a message; the first column of an rsyslog rule is the facility:

| facility | Meaning | Common destination |
|----------|------|---------|
| kern | Kernel messages | `kern.log` (Debian) or the journal |
| auth / authpriv | Authentication and authorization | `auth.log` (Debian) / `secure` (RHEL) |
| daemon | System daemons | `messages` / `syslog` |
| cron | Scheduled tasks | Separate file or messages |
| mail | Mail system | `mail.log` |
| local0–local7 | Reserved for custom use | Application-defined routing |

RHEL/CentOS/Rocky routes authentication logs through `authpriv`, Debian/Ubuntu through `auth` -- that is the historical reason the two families' `/etc/rsyslog` rules differ; do not hard-code facility names when porting scripts.

## 4. rsyslog Configuration

The configuration entry point is the same across the three families:

```bash
/etc/rsyslog.conf        # main configuration
/etc/rsyslog.d/*.conf    # snippets (recommended, plays well with package management)
```

Rule syntax: `facility.severity  action`, where `.` means "and," `*` means "all," and multiple values are comma-separated:

```bash
# /etc/rsyslog.d/50-default.conf (excerpt, portable across all three families)
auth,authpriv.*          /var/log/auth.log     # Debian/Ubuntu auth logs
# authpriv.*             /var/log/secure       # RHEL/CentOS/Rocky equivalent

*.emerg                  :msg:omusrmsg:*       # broadcast emergency messages to all logged-in users
cron.*                   /var/log/cron
mail.*                   -/var/log/maillog     # the - prefix means no flush on write (better performance)

# Collect only err and above into a separate file
*.err;auth.none          /var/log/errors.log

# Forward to a remote collector (TCP 514): *.*   @192.168.10.20:514
```

After editing, reload the configuration (do not restart, to avoid losing messages):

```bash
$ sudo systemctl reload rsyslog
# or
$ sudo kill -HUP $(pidof rsyslogd)
```

**Note**: rsyslog only writes files when journald's data actually reaches it. Debian/Ubuntu and RHEL ship this configured; on Arch you must configure imjournal or `ForwardToSyslog=yes` yourself (after editing `/etc/systemd/journald.conf`, run `systemctl restart systemd-journald`).

## 5. Viewing and Searching

### 5.1 Text Logs (After rsyslog Writes Them Out)

```bash
# Debian/Ubuntu
$ sudo tail -f /var/log/syslog
Sep 22 11:02:44 web01 systemd[1]: Started Daily apt download activities.

# RHEL/CentOS/Rocky
$ sudo tail -f /var/log/messages
Sep 22 11:02:44 web01 systemd[1]: Started Daily log rotation.

# Search (applying the classification mindset from sections 2 and 3)
$ sudo grep -E 'error|fail' /var/log/syslog | tail -20
$ sudo grep 'sshd' /var/log/auth.log | tail -5    # Debian
$ sudo grep 'sshd' /var/log/secure | tail -5      # RHEL
```

### 5.2 journalctl (Structured Queries)

```bash
journalctl                          # all logs (paged, q to quit)
journalctl -b                        # this boot; -b -1 is the previous boot
journalctl -u nginx                 # a specific service
journalctl -f                       # follow in real time
journalctl -p err                   # err and above; warning..alert is a closed interval
journalctl --since "1 hour ago"     # time window (absolute times also work)
journalctl -k                       # kernel only (equivalent to dmesg)
journalctl --grep "bind\(\) to"     # content search (PCRE)
journalctl -o json-pretty -u nginx  # structured output, easy for scripts
```

## 6. Journal Persistence: Why You Must Care

Where the journal is stored decides whether logs survive a reboot:

| Storage setting | Actual path | After a reboot |
|--------------|---------|--------|
| `auto` (one of the defaults) | Written to disk if `/var/log/journal` exists, otherwise `/run/log/journal` | May be lost |
| `persistent` | `/var/log/journal/` | Kept |
| `volatile` | `/run/log/journal/` | Lost |

**Why persistence matters**: the most common triage timeline is "something broke last night, discovered this morning." If the journal lives only in `/run` (tmpfs), one reboot empties `-b -1`, and the last logs before a kernel panic evaporate too. Persistence is strongly recommended on servers; volatile is acceptable on memory-constrained embedded devices.

How to enable it (works on all three families):

```bash
$ sudo mkdir -p /var/log/journal
$ sudo systemctl restart systemd-journald
$ journalctl --disk-usage     # confirm it has started using disk
```

Or write this in `/etc/systemd/journald.conf` (a drop-in `/etc/systemd/journald.conf.d/*.conf` is recommended):

```ini
[Journal]
Storage=persistent
SystemMaxUse=400M
```

`SystemMaxUse` must be set: the default is about 10% of the filesystem's capacity (soft cap 4 GiB), which can still fill a small disk. Run `systemctl restart systemd-journald` after changing it for it to take effect. Manual cleanup:

```bash
$ sudo journalctl --vacuum-size=200M
$ sudo journalctl --vacuum-time=14days
```

## 7. Common Pitfalls

1. **Cannot find `/var/log/syslog`**: Arch does not install rsyslog by default, or the distribution simply uses a different filename (RHEL uses `messages`). Confirm the entry point with `ls /var/log/` + `journalctl -b -1` first instead of concluding "the logs are gone."
2. **`journalctl -b -1` is empty**: the journal is not persistent and the previous boot's records were wiped with `/run`. Enable it per section 6.
3. **rsyslog configuration changes do not take effect**: use `reload` instead of blindly `restart`; also confirm that journald's data is actually reaching rsyslog (on Arch it is common to install rsyslog but never configure imjournal/ForwardToSyslog).
4. **The rule is right but the file never grows**: wrong facility (e.g. writing `auth.*` on RHEL when traffic actually goes through `authpriv`), or no messages of that facility are being produced at all. Cross-check with `journalctl --facility=authpriv`.
5. **An ordinary user running journalctl sees only their own logs**: reading system logs needs root, or membership in the `systemd-journal`/`adm` group.
6. **Flipping through security events as ordinary logs**: SELinux/audit denials live in `/var/log/audit/audit.log`, read them with `ausearch`; firewall drops are in the firewalld/nftables logs. Out of scope here -- see [Security Basics](../security.md) and [Networking: Firewalls](../../network/firewall.md).
7. **Scrambled timelines**: an inaccurate system clock makes log timestamps jump around (journalctl reports clock jumped). Run `timedatectl` to confirm NTP synchronization before interpreting log times.

## References

- `man rsyslog.conf`, `man journalctl`, `man syslog`
- Arch Wiki - rsyslog -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Rsyslog)
- Arch Wiki - systemd/Journal -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Journal)
- Bird's Private Recipes - Recognizing and analyzing login logs -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0570syslog.php)
- journalctl man page -- [man7.org](https://man7.org/linux/man-pages/man1/journalctl.1.html)
- journald.conf man page -- [man7.org](https://man7.org/linux/man-pages/man5/journald.conf.5.html)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [log](/basic/log.md)
- [glossary](/glossary.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [pam-sudo](/security/pam-sudo.md)
- [ntp](/server/ntp.md)
- [logging](/system-management/logging.md)
- [scheduled-tasks](/system-management/scheduled-tasks.md)
- [services-systemd](/system-management/services-systemd.md)
