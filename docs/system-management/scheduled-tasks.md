# Scheduled Tasks (at, cron, and systemd timer)

Backups should run in the dead of night, certificates should renew before they expire, logs should be archived weekly, and reports should land in the boss's inbox every Monday morning -- these share one trait: "it should happen on time, with or without anyone there". Typing commands by hand is neither reliable nor scalable, so scheduling systems exist: `at` handles "run once", `cron` handles "loop on a schedule", and `anacron` plus `Persistent=true` on systemd timers handle "catch up after a missed run". These three semantics cover nearly all scheduling needs on a server, and they are the main thread of this page: first the install and submission syntax of the three tools, then the two biggest pitfall sources of cron -- environment variables and logs -- then a complete working example and selection advice for systemd timers, and finally a troubleshooting checklist. Everything in scheduling presupposes an accurate clock; clock drift governance is in [Time Services](../server/ntp.md); the unit concepts used by timers are introduced in [System Service Management](../basic/services/system_services.md), and log retrieval for task results is in [System Logging](../basic/log/syslog.md).

> Content draws on the man pages, systemd official documentation, and the Arch Wiki (concept framework after Bird's Private Recipes / Lin's Linux Administration Guide); see the references at the end.

## What This Page Covers

- Pick the right tool for each task using the "one-time / periodic / catch up on missed runs" trichotomy
- Submit, view, and cancel at jobs
- Distinguish user-level crontab from the /etc/crontab and /etc/cron.d/ systems, and their user-field difference
- Write a crontab line or timer pair for a periodic task that is overlap-proof, logged, and verifiable
- Locate scheduling failures in three stages: "did the scheduler fire -> is the task environment right -> where did the output go"

## 1. Why Scheduling Is Needed: Three "Away" Semantics

### 1.1 One-Time, Periodic, and Catching Up on Missed Runs

Lay out every "should happen on time" thing on a server and there are only three semantics. **One-time**: restart nginx once at 23:00 tonight, done and discarded, no next time -- this is at's territory. **Periodic**: collect health metrics every 5 minutes, back up at 3:17 every day -- cron's five-field schedule was born for this. **Catch up on missed runs**: you closed your laptop for two days over the weekend; when you boot Monday, should the log rotation that was supposed to run Friday catch up? cron's answer is "if you missed it, you missed it"; `anacron` and `Persistent=true` on systemd timers answer "run it once after boot" -- note that catch-up granularity is naturally day-level at minimum; catching up "the 5 minutes of metrics you missed" is meaningless, and this semantic is only valuable for backup, cleanup, and report tasks.

```text
One-shot ─────▶ at (atd runs once at the set time, then discards)
Periodic ─────▶ cron (minute/hour/day/month/week, five fields, looping)
Catch-up ─────▶ anacron (day-level) / timer Persistent=true (any granularity)
```

This trichotomy is worth more than "memorizing a pile of tools", because selection errors almost always happen at the semantic layer: hooking a migration script that should only run once into cron so it repeats every night, wrapping a sub-second monitoring task in anacron semantics, or assuming a timer catches up by default without writing `Persistent=true` -- every one of these stems from not first asking "which of the three semantics is this task actually". Tool syntax is a man page away, but a semantic judgment error is a silent incident: scheduling errors always arrive late, and by the time someone notices it has usually been running wrong for a week.

### 1.2 Where Time Comes From

A scheduler does not keep time itself; it reads the system clock. The system clock is calibrated by the NTP service (chrony's `makestep` jumps directly when the drift is large). If the clock jumps by half an hour, the trigger points of cron and timer tasks that depend on "current time" jump with it, while monotonic-clock timers like `OnUnitActiveSec` that depend on "elapsed duration" are unaffected. When troubleshooting "the scheduled task time is messed up", first check `journalctl -u chronyd` for a large step, and only then suspect your own syntax -- this order saves a lot of detours. Full clock calibration config is in [Time Services](../server/ntp.md).

## 2. at: One-Time Tasks

### 2.1 Installation and Enabling (Three-Family Comparison)

at, cron, and anacron have independent package names and service names across the three families; set this table up first, and every section that follows starts from it:

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------|---------------|------|-------------------|
| One-time tasks | `apt install at` | `sudo pacman -S at` | `dnf install at` |
| at service unit | `atd` | `atd` | `atd` |
| Periodic tasks | `apt install cron` | `sudo pacman -S cronie` | `dnf install cronie` |
| cron service unit | `cron` | `cronie` | `crond` |
| Catch up on missed runs | `apt install anacron` | Ships with the `cronie` main package | `dnf install cronie-anacron` (usually installed by default) |

These three rows carry more information than they look: Debian's cron daemon comes from the classic `cron` package, and the service name is simply `cron`; Arch and RHEL use Red Hat's `cronie` (the maintained fork of vixie-cron), but Arch's service name follows the package name `cronie`, while RHEL's service name is `crond` -- package name, service name, and config path are three independent dimensions, the same kind of historical baggage as the "bind9 vs named naming split" in the [DNS page](../server/dns/bind.md), and during troubleshooting always run `systemctl status` to line up the unit name before discussing anything else. The acceptance action after installing is to get the service running and confirm it starts at boot:

```bash
$ sudo systemctl enable --now atd && systemctl is-active atd
active
```

### 2.2 Submitting, Viewing, and Cancelling

at's interaction is "type the commands, Ctrl+D to finish"; the task content is stored in a queue and executed by atd as the submitter at the appointed time:

```bash
$ at 23:00
warning: commands will be executed using /bin/sh
at> /usr/local/bin/reload-nginx.sh >> /var/log/reload.log 2>&1
at> <EOT>                                    # Ctrl+D here
job 3 at Thu Oct  2 23:00:00 2026
$ at now +10 minutes                         # relative time works too
$ echo "/usr/local/bin/cleanup.sh" | at now +30 minutes   # piping suits submission from inside a script
$ atq                                        # view the queue; equivalent to at -l
3   Thu Oct  2 23:00:00 2026 a cui
4   Fri Oct  3 08:30:00 2026 a root
$ atrm 3                                     # cancel job 3; equivalent to at -d 3
$ at -c 4 | head -20                         # view the full script the job will execute
```

The first column of `atq` output is the job number and the last is the submitter, with the execution time and queue letter in between -- queue `a` is ordinary at, `b` is batch. `at -c` deserves a special mention: it prints not one command but a whole shell script, and inside you can see the environment variables and ulimit injected by atd. When a task "did not run correctly on time", read this expansion first -- far more useful than staring at the one line you originally typed. For time syntax, `23:00`, `now +10 minutes`, and `teatime` (16:00) are all valid; for cross-day semantics (a `1:00` on a day past 1:00 means tomorrow at 1:00), verifying once with `at -c`'s expanded time is the safest.

### 2.3 Permission Control and batch

Who can submit at jobs is decided by two files: if `/etc/at.allow` exists, only listed users may use it; otherwise check `/etc/at.deny` -- anyone not on the list may use it; if neither exists, modern implementations allow only root. This "allow first, deny as fallback, strictest if neither" order matches sudoers' adjudication logic, so learn one and you have both. Debian/RHEL ship a default at.deny listing system accounts (i.e. letting ordinary users through); Arch ships neither file, so it is root-only out of the box -- on a multi-user machine, create at.deny manually if you want to open it up. Also, the `batch` command is a variant of at: the job is not run on the clock but waits until system load drops below 1.5 (adjustable via atd's `-b` flag) before executing, suitable for stuffing in compression, indexing, and other "not urgent but CPU-hungry" work. Its load-linked semantic is different from cron/timer -- do not mix them.

## 3. cron: Periodic Tasks

### 3.1 Two Kinds of crontab: User-Level and System-Level

cron's first major conceptual divide is "whose crontab". **User-level** is edited with `crontab -e`, stored in `/var/spool/cron/` (Debian under a `crontabs/` subdirectory, RHEL/Arch drop files directly by username), owned by and executed as the owner, formatted as "five fields + command". **System-level** consists of `/etc/crontab` and snippet files under `/etc/cron.d/`, which add a sixth field compared to user-level -- the executing user -- and are typically dropped in by configuration management tools or software packages (filenames under `/etc/cron.d/` may only use letters, digits, underscores, and hyphens; **a dotted filename like `backup.sh` is ignored entirely by cron**, one of the most common silent incidents in the package-management era). Same format, two carriers, and the division of labor is clear: manage your own jobs with `crontab -e` (no root, no interference), machine-level jobs go in `/etc/cron.d/` (travel with the repo, diffable, auditable) -- the same boundary as "personal dotfiles do not go in /etc, system config does not scatter into home directories".

```text
# /etc/crontab (excerpt of the Debian default skeleton): one extra user field
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

17 *    * * *   root    cd / && run-parts --report /etc/cron.hourly
```

```bash
$ crontab -l                                 # list the current user's crontab
17 3 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1
*/5 * * * * /usr/local/bin/check_health.sh
$ sudo crontab -u www-data -l                # administrator views a specific user's crontab
```

### 3.2 The Five Fields and Two High-Frequency Errors

The field order is "minute hour day-of-month month day-of-week", each field independently matching the current time, and a trigger fires only when all match. Two errors account for most of the common problems: first, `*/5` and `5` are worlds apart -- `*/5 * * * *` is every 5 minutes, while `5 * * * *` is "at the 5th minute of every hour", and a task meant to be the former but typed as the latter will quietly run only once an hour. Second, "day-of-month" and "day-of-week" are **OR**, not AND, when both are restricted (neither is `*`) -- `0 0 13 * 5` usually intends "on the 13th of every month AND it is a Friday", but actually means "at midnight on the 13th of every month as well as at midnight every Friday"; crontab(5) states this explicitly. After writing a rule, mentally re-check the semantics with a parser like `crontab.guru`, or set the frequency to `* * * * *` on a test machine and observe for a minute -- both are cheap fail-safes.

| Intent | Expression | Notes |
|--------|------------|-------|
| Every day at 3:17 | `17 3 * * *` | The minute deliberately avoids the top of the hour; see the stagger note in section 6 |
| Every 15 minutes | `*/15 * * * *` | Step in the minute field |
| Every Tuesday at 3:17 | `17 3 * * 2` | In the day-of-week field, 0 and 7 are both Sunday |
| 1st of every month and every Sunday | `0 3 1 * 0` | Both are restricted -> OR semantics, double trigger |

### 3.3 The Environment Variable Trap: cron's World Has No dotfiles

The environment when cron executes a task is a deliberately minimal set of defaults: `SHELL=/bin/sh`, `PATH=/usr/bin:/bin` (Debian's /etc/crontab skeleton is slightly more generous, but user-level crontab is not), `HOME` and `LOGNAME` come from /etc/passwd, there is no tty, and `.bashrc` and `.profile` are not loaded. This means a command that works perfectly in an interactive shell may `command not found` inside cron (the binary lives under /usr/local/bin or similar, outside the trimmed PATH) or behave differently (`~` expands fine but relative paths resolve from HOME rather than the directory you expect; all aliases are dead). The discipline is only two rules but must be muscle memory: **always use absolute paths for commands, and the first thing inside a script is to set PATH explicitly**. Another obscure but lethal pitfall is `%` -- in crontab the percent sign in the command field is interpreted as a newline, so `date +%F` truncates everything after `%F` into "standard input"; it must be escaped as `date +\%F`. This symbol has no special meaning in an interactive shell, which makes it especially easy to miss.

```bash
#!/bin/sh
# /usr/local/bin/backup.sh -- standard opening for a script used by cron
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
cd /srv/data || exit 1
tar czf /backup/data-$(date +\%F).tar.gz .
```

The escaping of `date +\%F` above is only needed inside the crontab line; inside a script file `%` is not special and does not need escaping -- but writing the escape uniformly is harmless and saves a mental step. `cd ... || exit 1` is another line of defense: a cron task's working directory is HOME, and without cd-ing first, every relative path lands in the wrong place, and on failure the error message often ends up somewhere you never look.

### 3.4 Logs and MAILTO: Where Output Goes

The task did not run and the task ran but you did not see it are two different failures, and the dividing line is logs. Scheduler side: cronie on RHEL/Rocky writes logs to `/var/log/cron`; Debian/Ubuntu does not write a separate cron.log by default but sends to syslog and the journal, and `journalctl -t CRON -t CROND --since today` filters both families' task execution lines at once (Debian's tag is `CRON`, cronie's is `CROND`). Task side: cron sends the task's stdout/stderr to the task owner by email, provided an MTA is installed -- on Debian without an MTA you will see a line `(CRON) info (No MTA installed, discarding output)`, and the output evaporates; this is also the prime suspect for "logs prove it ran but the result is wrong". Pick one of two approaches: either `MAILTO=""` to disable email and redirect output explicitly to a log file, or properly configure a local MTA so alert mail can actually leave. General log retrieval for task output is in [System Logging](../basic/log/syslog.md).

```bash
$ journalctl -t CRON -t CROND --since today | tail -3
Oct 02 03:17:01 web01 CRON[2811]: (root) CMD (/usr/local/bin/backup.sh)
```

### 3.5 anacron and /etc/cron.{hourly,daily,weekly,monthly}

The four directories like `/etc/cron.daily/` are another registration mechanism for "day-level and above" tasks: drop an executable script in, and `run-parts` runs them in batch on a rhythm -- no crontab line needed, managed per file, and software packages love using it (you will find scripts dropped in by logrotate, dpkg, certbot). What actually runs them is not cron's schedule but anacron: `/etc/anacrontab` declares in four fields "period (days), delay (minutes), job identifier, command", and anacron uses the timestamp in `/var/spool/anacron/<identifier>` to decide "has this run today / this week?" -- if not, it catches up after boot or trigger, with a delay of several minutes. On the RHEL family the trigger chain is `/etc/cron.d/0hourly` running `run-parts /etc/cron.hourly` every hour -> the `0anacron` inside it pulling `anacron -s`; on Debian, cron periodically pulls anacron. `RANDOM_DELAY` and `START_HOURS_RANGE` control catch-up staggering and the time window:

```text
# /etc/anacrontab (excerpt of the RHEL/Rocky default)
SHELL=/bin/sh
PATH=/sbin:/bin:/usr/sbin:/usr/bin
RANDOM_DELAY=45
START_HOURS_RANGE=3-22
1   5    cron.daily      nice run-parts /etc/cron.daily
7   25   cron.weekly     nice run-parts /etc/cron.weekly
@monthly 45  cron.monthly   nice run-parts /etc/cron.monthly
```

Two disciplines must be remembered: anacron is only meaningful for day-level tasks (the hourly-level `/etc/cron.hourly` is actually driven directly by cron, with no catch-up semantic); and run-parts is extremely picky about filenames and permissions -- a dot in the name, an anomalous writable bit, or missing execute permission all get silently skipped. When a "script that was dropped in has never run", first `run-parts --test /etc/cron.daily` to see if it will even be selected.

## 4. systemd timer: The Modern Alternative

### 4.1 Tradeoffs with cron

A timer is not "another cron"; it folds scheduled tasks into systemd's declarative system: a `.timer` unit activates a paired `.service` unit on time. In return you get what cron cannot give -- logs naturally aggregated in `journalctl -u <name>`, declarable dependencies (backups wait for the database to be ready), second-level granularity, built-in staggering via `RandomizedDelaySec`, catch-up on missed runs at any granularity with `Persistent=true`, and unit files distributed with packages and configuration management. The cost is one more abstraction layer and the `daemon-reload` mental step: changing a line in the schedule means "edit file -> daemon-reload -> restart timer", unlike `crontab -e` which takes effect on save.

| Dimension | cron | systemd timer |
|-----------|------|---------------|
| Logs | syslog/journal, search by tag | `journalctl -u backup.service` naturally aggregated |
| Dependencies | None, the script waits on its own | Declared via `After=`/`Requires=` |
| Granularity | Minute | Second |
| Staggering | Hand-pick the minute | `RandomizedDelaySec=10m` |
| Catch up on missed runs | anacron (day-level only) | `Persistent=true` (any granularity) |
| Taking effect | Effective on save | `daemon-reload` + restart the timer |
| Distribution | Maintain a crontab per machine | Unit files travel with packages/Ansible |

### 4.2 A Complete Timer Pair

Taking "back up every Tuesday at 3:17, catch up on misses, stagger within a random 10 minutes" as the example, put two files in `/etc/systemd/system/`:

```text
# /etc/systemd/system/backup.service
[Unit]
Description=Weekly data backup

[Service]
Type=oneshot
ExecStart=/usr/local/bin/backup.sh
```

```text
# /etc/systemd/system/backup.timer
[Unit]
Description=Run backup every Tuesday 03:17

[Timer]
OnCalendar=Tue *-*-* 03:17:00
Persistent=true
RandomizedDelaySec=10m
AccuracySec=1min
Unit=backup.service

[Install]
WantedBy=timers.target
```

`Type=oneshot` expresses the foreground task semantic of "run and exit" (echoing at's "one-time", but this is once per trigger); on the timer side, `Unit=` pairs explicitly (when omitted it defaults to looking for a same-named .service, but writing it out is more resilient to rename accidents). Unit file syntax and dependency basics are in [System Service Management](../basic/services/system_services.md). Enabling and verifying:

```bash
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now backup.timer
$ systemctl list-timers backup.timer
NEXT                        LEFT  LAST PASSED UNIT          ACTIVATES
Tue 2026-10-06 03:27:00 CST 3d    n/a  n/a    backup.timer  backup.service
```

The NEXT column of `list-timers` is the next trigger time (the 03:27 above is 03:17 plus the random delay), and LAST/PASSED is the observation window for catch-up semantics. You do not have to wait for the trigger to manually verify the task body: `sudo systemctl start backup.service` runs it once directly, and after checking that `journalctl -u backup.service` output is as expected, hang the timer on it -- verify the task first, then trust the schedule, the same change discipline as running `named-checkconf` before reloading DNS.

### 4.3 OnCalendar Syntax Cheat Sheet

The basic form of a calendar event is `day-of-week year-month-day hour:minute:second`, with omitted parts expressed as `*` or ranges. Two high-frequency forms to memorize: every Tuesday at 3:17 is `Tue *-*-* 03:17:00`; the 0/15/30/45 minutes of every hour is `*:0/15`. Weekdays at 9am is `Mon..Fri *-*-* 09:00:00`; month-end is hard to express (calendar syntax has no direct "last day" form), so for those use `OnUnitActiveSec` with an in-script date check for less pain. **The timezone defaults to the system's local timezone**; to pin UTC, append the timezone name at the end: `OnCalendar=*-*-* 03:17:00 UTC` -- when a server changes timezone or a DST switch happens, timers without a pinned timezone follow the local clock, and if you want cross-datacenter jobs unified, write UTC explicitly everywhere. The other family is relative time: `OnBootSec=5min` (5 minutes after boot) and `OnUnitActiveSec=6h` (6 hours after the last activation) are based on the monotonic clock and unaffected by wall-clock jumps, suitable for "refresh a token every 6 hours" rhythms that have nothing to do with the wall clock; both families can coexist in the same timer, and any single condition firing triggers it. For any expression you are unsure of, `systemd-analyze calendar` tells you the next trigger time directly:

```bash
$ systemd-analyze calendar "Tue *-*-* 03:17:00"
  Original form: Tue *-*-* 03:17:00
  Normalized form: Tue *-*-* 03:17:00
    Next elision: Tue 2026-10-06 03:17:00 CST
       (in UTC): Mon 2026-10-05 19:17:00 UTC
```

## 5. Selection and Engineering Discipline

The plain rule for selection: single machine, a handful of traditional tasks, cron is plenty and least surprising; tasks that need dependency declarations, centralized distribution, second-level granularity, or catch-up at any granularity, or environments where systemd is already a first-class citizen (fleet, container hosts), go timer. Mixing is not forbidden but requires a registry -- when cron and timer coexist on the same machine, "where is this task registered" must be answerable at a glance, otherwise it is the breeding ground for section 6's "ran twice".

Regardless of carrier, three engineering disciplines apply universally. **Idempotency**: assume the task runs back-to-back twice and the result must still be correct -- backups use date-stamped target filenames, cleanup scripts tolerate missing files (`rm -f`), renewal scripts check remaining days -- catch-up semantics (anacron, Persistent=true) naturally turn "the same window runs twice" into a normal path rather than an incident. **Mutual exclusion**: a task that runs longer than its own period self-overlaps (a 5-minute collection that takes 8 minutes); `flock -n` exiting when the lock cannot be acquired is the cheapest three-line solution:

```text
# crontab line: no lock means the previous round has not finished, so abandon this one outright
*/5 * * * * flock -n /run/lock/health.lock /usr/local/bin/check_health.sh >> /var/log/health.log 2>&1
```

**Make output destination explicit**: every task either redirects stdout/stderr to its own log file or hands it to the timer system to go into the journal, never relying on "default behavior"; on the cron side also configure `MAILTO=""` or a working MTA, so that "output lost" is architecturally impossible. Timezone is the fourth implicit discipline: cron follows the system local timezone, timer can pin per-line, so for machines across timezones register uniformly in UTC and convert to local at the display layer -- this saves an entire class of "an hour early/late" weird failures at the twice-yearly DST switches.

## 6. Troubleshooting and Common Pitfalls

**The task never ran at all.** First prove "did the scheduler fire" before investigating the task itself: if you cannot find that CMD line in `grep CMD /var/log/cron` (RHEL) or `journalctl -t CRON -t CROND --since today` (works for both), it is a registration-layer problem -- crontab syntax errors (`*/5` typed as `5`, day/week OR semantics putting the trigger where you did not expect it), a dotted filename under `/etc/cron.d/` being ignored entirely, the script lacking execute permission and not being invoked as `sh script`, and the classic "edited /etc/crontab but thought I changed the crontab -e one". Only when logs show the CMD but the task has no effect does the next question arise.

**The same task ran twice.** Check the registration surface, not the script: double registration of cron and timer (forgetting to delete the crontab line after migrating to timer) is the number-one source; next is anacron catch-up and cron's schedule both triggering a day-level task in the same window; in multi-machine environments you must also confirm "this one should run, and that one also has it configured". A registry system (each task has a single registration point) is the cure.

**Logs prove it ran, but the result is wrong.** Almost always an environment difference: a `/usr/local/bin` binary not found in PATH, relative paths resolving from HOME, aliases and shell functions not existing, or `%` unescaped truncating the command. Use the `at -c` approach for contrast -- print out the task's expanded environment and read it once; adding an explicit PATH and `cd` pattern at the top of the script (section 3.3) prevents this entire class.

**Everyone wakes up at the top of the hour.** Lots of tasks are written as `0 * * * *` or `0 3 * * *`, and at every top-of-hour/top-of-midnight they all wake collectively, putting CPU and downstream APIs under pressure at once. cron's answer is manual staggering -- pick non-round minutes like 17, 23, 41 (note that the `H` "hash stagger" notation is Jenkins syntax, system cron does not recognize it, and copying it will not work); timer's answer is `RandomizedDelaySec`. Library polling storms at the top of the hour (certificate checks, DNS TTL) follow the same rule; staggering is discipline, not optimization.

**anacron does not trigger.** The chain is "cron pulls anacron -> anacron checks timestamps -> run-parts selects scripts"; verify link by link: are the fields in `/etc/anacrontab` correct, is the timestamp in `/var/spool/anacron/<identifier>` already today (if it is, "already ran" -- not running is correct behavior), did the script pass `run-parts --test`'s filter (a dot in the name or missing execute permission gets silently skipped). On RHEL, also confirm cronie-anacron is installed and `/etc/cron.d/0hourly` is still there.

**MAILTO mail piles up.** The task has output and cron tries to email root daily: with MTA configured, mail piles up in `/var/mail/root` and nobody reads it for ages; without MTA, output is discarded (Debian leaves a `No MTA installed, discarding output` info line). Handling: useless output gets `MAILTO=""` plus redirection to a log; output with alerting value goes through a proper notification channel (a timer task with an `OnFailure=` unit sending notifications is the more modern form), and clean `/var/mail` periodically. Same root as the [DNS page](../server/dns/bind.md) lesson of "leaving only a vague error line in the logs": a scheduled task's output must have someone responsible for catching it, otherwise it is as good as no output at all.

## References

- at(1) manual -- [man.archlinux.org/man/at.1.en](https://man.archlinux.org/man/at.1.en)
- crontab(5) manual -- [man7.org/linux/man-pages/man5/crontab.5.html](https://man7.org/linux/man-pages/man5/crontab.5.html)
- systemd.timer official documentation -- [freedesktop.org/software/systemd/man/systemd.timer.html](https://www.freedesktop.org/software/systemd/man/systemd.timer.html)
- systemd.time (OnCalendar syntax) -- [freedesktop.org/software/systemd/man/systemd.time.html](https://www.freedesktop.org/software/systemd/man/systemd.time.html)
- Arch Wiki: Cron -- [wiki.archlinux.org/title/Cron](https://wiki.archlinux.org/title/Cron)
- Bird's Private Recipes (Lin's Linux Administration Guide) -- scheduled tasks -- [linux.vbird.org](https://linux.vbird.org/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
