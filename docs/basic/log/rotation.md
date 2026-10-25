# Log Rotation

Log files do not shrink on their own: a service that logs nonstop can fill `/var/log` within a month, which then drags down the database, makes `grep` hang, and overwhelms the collectors. Rotation is not an "optional optimization" -- it is a mandatory question for every system that produces logs, and logrotate answers it with one set of declarative configuration covering four things: **how often to rotate, at what size, how many copies to keep, and how to compress the old ones**. This page starts from "what happens without rotation," breaks down the division of labor between `/etc/logrotate.conf` and `/etc/logrotate.d/` and the decision criteria between `postrotate` and `copytruncate` when "the program still holds the old handle," and walks through the complete workflow of writing a working rule for your own service and validating it with `logrotate -d`; it also draws the easily confused boundary that logrotate manages text files while journal space is reclaimed through journald.

> Content adapted from the logrotate manual and the Arch Wiki; see the references at the end.

## What This Page Covers

- Explain why logs must be rotated, and the two classic incidents when they are not (disk full, queries grinding to a halt)
- Read logrotate configuration structure: what the global section, the application section, and each individual option solve
- The decision criteria between postrotate and copytruncate
- Write a working rotation rule for your own service and validate it with `logrotate -d`
- Tell apart the boundary: logrotate manages text files, journal space is reclaimed through journald

## 1. Why Rotation Is Mandatory

A file that gets written to nonstop brings three guaranteed failures:

1. **Disk fills up**: `/var/log` usually shares a partition with `/` or lives on its own; once it is full, databases refuse writes, the system can no longer record any events, and the service simply stops.
2. **Tools stall**: `grep` and `less` opening an 8 GB text file exhaust memory or hang the terminal; "checking the logs" as an action itself becomes infeasible.
3. **Collectors overload**: Filebeat/Fluentd and the like tail files; with a huge file, the seek overhead when the collector restarts multiplies.

logrotate's strategy is essentially answering four questions: **how often to rotate? (time) at what size? (size) how many copies to keep? (retention) how to compress the old files? (compression)** These four questions map to four groups of options; the sections below explain why you would choose each setting, rather than simply listing options.

## 2. Configuration File Layout

```bash
/etc/logrotate.conf          # main configuration: global defaults + include directives
/etc/logrotate.d/            # application snippets (services installed by the package manager are dropped here automatically)
/var/lib/logrotate/status    # state file: records when each file was last rotated (do not edit by hand)
```

The main configuration handles `include /etc/logrotate.d/*.conf` and the global defaults (such as `rotate 4`, `compress`), while application-specific rules live in their own files under `/etc/logrotate.d/` so package upgrades never overwrite them. Debian/Ubuntu and RHEL/CentOS/Rocky drop the matching snippet automatically when you install packages such as rsyslog/nginx; on Arch, confirm that `logrotate.timer` is running:

```bash
$ systemctl status logrotate.timer
● logrotate.timer - Daily log rotation
     Loaded: loaded (/usr/lib/systemd/system/logrotate.timer; enabled; ...)
     Active: waiting since Mon 2026-09-21 00:00:00 CST; 1 day 11h ago
    Trigger: Tue 2026-09-23 00:00:00 CST; 12h left
```

Debian/Ubuntu and the RHEL family run `/etc/cron.daily/logrotate` daily through cron by default; Arch uses the systemd timer above. Whichever trigger is in play, **a manual `logrotate -f` only forces one extra run; the next run still follows the schedule**.

## 3. A Worked Example, Line by Line

```bash
# /etc/logrotate.d/myapp
/var/log/myapp/*.log {
    daily                  # time condition: at most one rotation per day
    rotate 14              # keep 14 generations; from the 15th on, delete
    compress               # compress old files to .gz with gzip
    delaycompress          # delay compression by one cycle (pairs with postrotate, see below)
    size 100M              # second trigger: rotate once a single file exceeds 100M (alongside daily, whichever is satisfied first wins)
    missingok              # skip silently when the file does not exist
    notifempty             # do not rotate empty files
    create 0640 root adm   # recreate the new file with this owner/permissions immediately after rotation
    sharedscripts          # when a glob matches several files, postrotate runs only once
    postrotate
        systemctl reload nginx > /dev/null 2>&1 || true
    endscript
}
```

A few design points that are easy to overlook:

- **The permissions on `create` must match the original file.** If you omit `create`, the new file is created with the logrotate process's umask, which usually lands on `root:root 0600`, and nginx's workers (`www-data`) can no longer write logs -- the symptom is "logging silently stops after rotation," which is very hard to spot at a glance.
- **How `size` relates to the time conditions**: the manual is explicit that `size` and `daily/weekly/monthly/yearly` are mutually exclusive -- when both are written, **the later one wins** (later overrides earlier). For the semantics "rotate at least once a day, but early once it exceeds 100M," use `daily` + `maxsize 100M` (rotate early when maxsize is reached, otherwise wait for the time); `minsize` is the opposite: when the time arrives but the file is below the threshold, do not rotate. Mistaking `size` for `maxsize` is the most common configuration error.
- **`notifempty`**: a logging service often produces a 0-byte file after a restart; rotating it is pointless and pollutes the sequence numbers.

## 4. postrotate and copytruncate: What If the Program Still Holds the Old File

The default rotation action is to **rename** `app.log` to `app.log.1` and then create a fresh `app.log`. The problem: the running program still holds the file descriptor for what is now `app.log.1` and keeps writing into the renamed file, while the newly created `app.log` stays empty forever -- until the process restarts.

Two fixes, pick one:

**Option A: postrotate signals the program to reopen the file** (recommended, no loss window)

```bash
/var/log/myapp/app.log {
    daily
    rotate 7
    delaycompress          # keep the previous generation uncompressed so it stays plaintext-readable while the signal is handled
    postrotate
        systemctl kill -s USR1 myapp.service > /dev/null 2>&1 || true
    endscript
}
```

After receiving the signal, the program reopens the path `app.log` (which by then is the new file). **`delaycompress` must accompany this**: if you compress immediately, the program may still be writing the old file before it reopens, and compression causes write failures or data corruption; delaying compression by one cycle keeps the file in its "handover period" uncompressed.

**Option B: `copytruncate`** (the fallback when the program cannot reopen files)

```bash
/var/log/myapp/app.log {
    daily
    copytruncate          # copy the contents to .log.1 first, then truncate the original to 0
    compress
    rotate 7
}
```

The trick is that the file is never renamed: the program keeps the same inode, and after the copy the original is truncated in place. The cost: **there is a tiny window between copy and truncate where the last few lines can be lost**, and `create`/`postrotate` are ineffective in this mode (the original file always exists). Use it only when the program supports no reload/reopen at all.

Rule of thumb: **if it can reload, use postrotate + delaycompress; only fall back to copytruncate when it cannot reload**.

## 5. Common Options Quick Reference

| Option | What it does | When to use |
|------|------|--------|
| `daily/weekly/monthly` | Rotate on a time schedule | The default scenario |
| `hourly` | By the hour | Needs a timer/cron that runs logrotate hourly; with the default once-a-day run, `hourly` never actually rotates hourly |
| `size 100M` | Rotate immediately above 100M (mutually exclusive with time conditions, last one written wins) | Size-only control |
| `maxsize 100M` | Time condition + rotate early when over 100M before the time is up | "Once a day, but early when too big" |
| `minsize 100M` | Time reached but below 100M means no rotation | Low-traffic logs, to avoid piles of tiny fragmented files |
| `rotate N` | Keep N generations, delete the rest | Total volume = single-file size x N |
| `compress` / `nocompress` | gzip old files | Recommended on by default |
| `delaycompress` | Wait one cycle before compressing | Always on when paired with postrotate |
| `olddir` | Move old files into a subdirectory | When you want a tidy log directory |
| `missingok` | No error when the file is missing | Mandatory in glob scenarios |
| `notifempty` | Skip empty files | Add it almost always |
| `dateext` | Date suffix `.20260922` instead of `.1` | Easy archiving and lookup by date |
| `su user group` | Declare the owner/group used during rotation | **Mandatory** when the logs sit in a directory not writable by root (e.g. `/home`), otherwise you get "parent directory has insecure permission" |

## 6. Management Commands

```bash
# Dry run: only prints what would be done, touches no files, updates no state
$ sudo logrotate -d /etc/logrotate.conf

# Force one rotation (immediate, for validating configuration)
$ sudo logrotate -f /etc/logrotate.conf

# Target a single snippet only
$ sudo logrotate -f /etc/logrotate.d/myapp

# Check state: when each file was last rotated
$ cat /var/lib/logrotate.status
"/var/log/myapp/app.log" 2026-9-22-0:0:0
"/var/log/syslog" 2026-9-22-0:0:0
```

For debugging prefer `-d`: it prints the glob expansion results and the decision process for every matched file, so "why was it not rotated" is plain at a glance.

## 7. Journal Space Reclaim Is Outside logrotate's Scope

Do **not** put the binary files under `/var/log/journal/` into logrotate -- journald manages its own rotation and retention:

```bash
$ journalctl --disk-usage
$ sudo journalctl --vacuum-size=300M
$ sudo journalctl --vacuum-time=30days
```

Handing journal files to logrotate for renaming scrambles journald's indexes. Two separate systems: **text logs belong to logrotate, the journal belongs to vacuum**.

## 8. Common Pitfalls

1. **New logs are empty after rotation**: the program holds the old handle. Use postrotate + reload, or `copytruncate`; also check that the `create` permissions still let the logging user create the file.
2. **Writing `size` and `daily` and expecting an "or"**: `size` is mutually exclusive with time conditions and the later one wins, so the result usually bears no resemblance to expectations. For "time + early size threshold" use `maxsize`.
3. **`hourly` does nothing**: logrotate is only invoked once a day by cron/timer by default; real hourly rotation needs your own hourly timer/cron.
4. **The glob re-matches already-rotated files**: `/var/log/*.log` does not match `.log.1`, but `/var/log/*` will rotate `.log.1.gz` all over again. Use a precise suffix (`*.log`) or isolate old files with `olddir`.
5. **Rotating logs under `/home` reports insecure permission**: for safety logrotate refuses to operate in world-writable directories without the sticky bit; add `su user group` to that section.
6. **State out of sync after manually deleting `.1.gz`**: the state file still believes the rotation happened; one forced `logrotate -f` realigns it.
7. **The timer is not enabled on Arch**: if `logrotate.timer` is disabled, no amount of correct configuration will ever run; start with `systemctl enable --now logrotate.timer`.
8. **Handing journal files to logrotate**: see section 7; the journal can only be reclaimed with `--vacuum-*`.

## References

- `man logrotate`, `man logrotate.conf`
- logrotate man page -- [man7.org](https://man7.org/linux/man-pages/man5/logrotate.conf.5.html)
- Arch Wiki - Logrotate -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Logrotate)
- Arch Wiki - systemd/Journal (journal space management) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Journal)
- Bird's Private Recipes - Recognizing and analyzing login logs -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0570syslog.php)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [log](/basic/log.md)
- [debugging](/script/debugging.md)
- [examples](/script/examples.md)
- [logging](/system-management/logging.md)
