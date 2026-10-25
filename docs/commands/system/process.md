# Process Management Commands

In Linux a "program" sits on disk; a "process" is what a program looks like after it runs: it has a PID, a parent process, it occupies CPU and memory, and it can be disturbed by signals. Process management does not answer "what commands exist" — it answers three things: **who is running, which tool to look at it with, and which signal to stop it with**.

> Content is drawn from Bird's Private Recipes (Lin's Linux Administration Guide), the Arch Wiki, and the official systemd documentation; see the references at the end.

## What This Chapter Covers

- Distinguish when to use ps, top, and htop, and know how to choose
- The semantics of SIGTERM/SIGKILL/SIGHUP and the order to use them
- Understand why zombie processes arise and why kill cannot remove them
- The relationship between systemd units, process trees, and cgroups

## 1. What a Process Is: Why It Needs Management

When the shell runs a command, the kernel `fork`s a child process and then `exec`s it into the target program — so what you see is a running entity with a PID. Each process records its parent PID (PPID), open files, address space, and state. Most troubleshooting eventually lands on processes: a service will not start (the process was never launched or exited immediately), the box is stuck (some process is eating all the CPU), a file is occupied (a process holds the fd) ... So "find that process, see its state clearly, and intervene the right way" is a basic skill of Linux ops.

The most frequently asked about process states are `R` (running/ready), `S` (sleeping, waiting for an event), `D` (uninterruptible sleep, mostly waiting on IO), `Z` (zombie), and `T` (stopped). The meanings of `Z` and `D` get their own sections later; when using `ps`/`top` daily, being able to tell "running" from "waiting" is enough to explain most `load` and `iowait` phenomena.

## 2. ps vs top vs htop: How to Choose Among the Three Views

These three tools look at the same set of processes; the differences lie in the **time dimension** and **interactivity**. Picking the wrong one will not cause an incident, but it wastes troubleshooting time.

### 2.1 ps — A Single Snapshot

`ps` is an instant snapshot: it prints the process list at the moment of execution and exits, which suits scripts, tickets, and a single freeze-frame. The two major styles are equivalent; remember one set and you are fine:

```bash
$ ps aux | head -5
USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.2 168924 11608 ?        Ss   08:15   0:02 /sbin/init
root           2  0.0  0.0      0     0 ?        S    08:15   0:00 [kthreadd]
www-data    1102  0.1  0.4 214500 18236 ?        Ss   08:15   0:04 nginx: master process /usr/sbin/nginx
```

- `aux`: BSD style, `%CPU`/`%MEM` are directly available, the `STAT` column is the state letter.
- `-ef`: System V style, adds a PPID column, good for tracing up the tree to find the parent.
- `auxf` / `-ef --forest`: tree indentation, parent-child relationships at a glance.
- `ps aux --sort=-%cpu | head`: top N by CPU descending, equivalent to a "top snapshot".

In the `STAT` column, `Z` is zombie, `S+` is foreground sleeping, `Rl` is multithreaded running — for letters you do not recognize, check `man ps` under "STANDARD FORMAT SPECIFIERS" first.

### 2.2 top — A Refreshing Dashboard

`top` redraws every few seconds, answering "**who is busiest right now**", and can send signals on the side. All three families ship it (Debian/Arch use procps or procps-ng, the RHEL family uses procps-ng):

```bash
$ top
top - 10:30:41 up 12 days,  3:21,  2 users,  load average: 1.20, 0.95, 0.70
Tasks: 182 total,   1 running, 181 sleeping,   0 stopped,   1 zombie
%Cpu(s):  3.2 us,  1.1 sy,  0.0 ni, 95.4 id,  0.2 wa,  0.0 hi,  0.1 si,  0.0 st
MiB Mem :   7800.0 total,   1200.0 free,   3100.0 used,   3500.0 buff/cache
MiB Swap:   2048.0 total,   2048.0 free,      0.0 used.   4400.0 avail Mem

    PID USER      PR  NI    VIRT    RES  %CPU  %MEM     TIME+ COMMAND
   2041 mysql     20   0   12.2g   1.8g   8.5  23.1   120:34.1 mysqld
```

Common interactive keys: `P` sort by CPU, `M` sort by memory, `1` expand per core, `k` kill a process, `r` change nice, `q` quit. In scripts use `top -bn1 | head` for a one-shot snapshot (note that `-b` batch mode is what makes it pipe-friendly).

The first few lines are the "system overview": load, task counts (including the zombie count), CPU breakdown (`wa` high = waiting on IO, `st` high = being stolen by the host), and memory and swap — for how to read these and abnormal thresholds see [Monitoring Tools](./monitoring.md).

### 2.3 htop — The Interactive Upgrade

`htop` is the community's modernization of `top`: a color UI, mouse support, horizontal scrolling to see full command lines, one-click tree view, and a menu-driven signal dialog at `F9`. It is not preinstalled on the three families, and the install command must be chosen per family:

```bash
sudo apt install htop      # Debian/Ubuntu
sudo pacman -S htop        # Arch
sudo dnf install htop      # RHEL/CentOS/Rocky
```

On Arch, if the system has not been upgraded for a while, run `sudo pacman -Syu` first and then install, to avoid a partial upgrade. The shortcut bar at the bottom shows: `F3` search, `F4` filter, `F5` tree, `F6` sort, `F9` signal, `F10` quit.

### 2.4 How to Choose: One Table to Make It Clear

| Scenario | First Choice | Reason |
|------|------|------|
| Script/ticket needs fixed output | `ps aux --sort=-%cpu` | non-interactive, pipeable, results are diff-able |
| Just noticed high load, want to catch it in the act | `top` or `htop` | refreshes every few seconds, see who keeps eating CPU |
| Need to sort out master/worker parent-child relationships | `ps auxf`, `htop -t`, `pstree` | a tree is more intuitive than a flat list |
| Daily patrol on a server | `htop` | high interactive efficiency, needs installing first |
| Only care about one service's processes | `pgrep -a nginx` / `systemctl status` | done in one step |

All three draw from the same data source (`/proc`); the percentages in `top`/`htop` are averages **over the sampling interval**, so millisecond spikes may be smoothed away — to catch millisecond-level hotspots turn to `pidstat` and `perf` (see [Monitoring](./monitoring.md)). Also, `%MEM` in `top` is based on RSS, so shared libraries are counted repeatedly across processes and summing each process's `%MEM` often exceeds 100% — for whole-machine memory, `free` remains the source of truth.

## 3. Finding Processes: pgrep and pidof

When you know the name and need the PID, stop doing `ps aux | grep xxx` — grep sometimes matches its own line, forcing a second `grep -v` filter:

```bash
$ pgrep -a nginx
1102 nginx: master process /usr/sbin/nginx
1103 nginx: worker process

$ pidof nginx
1103 1102

$ pgrep -u www-data -f "php-fpm"   # filter by user and full command line
```

`pgrep` prints plain PIDs, ready to feed straight to `kill`; `-f` matches the full command line (beware accidentally hitting processes that share the same substring). `pkill` is its counterpart, sending a signal by name. `pstree -p` shows the whole system process tree with PIDs, and `pstree -p 1102` expands downward from a given process.

## 4. kill and Signals: How to Choose TERM / KILL / HUP

Despite the name, `kill` is essentially about **sending a signal** (`kill -l` lists them all). The default signal is `SIGTERM` (15), not `SIGKILL` (9) — this is the first dividing line between casual and experienced users.

### 4.1 Three Categories of Core Signals

| Signal | Number | Catchable | Semantics and typical use |
|------|------|-----------|----------------|
| SIGHUP | 1 | yes | the traditional "hang up"; by daemon convention it means **reread config** (reload) |
| SIGINT | 2 | yes | Ctrl+C, interrupts the foreground process from the terminal |
| SIGTERM | 15 | yes | **default termination**, giving the process a chance to clean up temp files, flush buffers, and release locks |
| SIGKILL | 9 | **no** | the kernel removes it outright, no cleanup, last resort |
| SIGSTOP/SIGCONT | 19/18 | STOP is not catchable | pause/resume, used for debugging |

**Selection order**: `kill PID` (i.e. TERM) first → observe for a few seconds → if it is truly stuck or ignoring, then `kill -9 PID`. The cost of going straight to `-9`: buffers not flushed, lock files left behind, a database that may need recovery; and the killed process only disappears from the table once the parent reaps it (see the zombie section).

```bash
$ kill 1102          # TERM, default
$ kill -TERM 1102    # equivalent form
$ kill -HUP 1102     # ask the service to reread its config (whether it supports this depends on the service)
$ kill -9 1102       # last resort
```

For batches of same-named processes, `pkill nginx` targets by name; `pkill -f "pattern"` targets the full command line — **use `-f` with care in production**, a pattern that is too wide will kill the wrong thing. To batch-TERM by PID list, use something like `kill $(pgrep -d' ' nginx)`.

### 4.2 Service Scenarios: The Relationship Between HUP and systemd reload

Old-style daemons (nginx, sshd, etc.) use `kill -HUP` to reload config; under systemd management, this is preferred instead:

```bash
sudo systemctl reload nginx    # sends the right signal as defined by the unit's ExecReload
sudo systemctl kill -s HUP nginx
sudo systemctl restart nginx   # process restarts from scratch, PID changes
```

`reload` does not kill the process or interrupt connections (the service must support it); `restart` changes the PID. Whether to reload or restart after a config change depends on whether the service supports hot reload — when unsure, `systemctl cat nginx | grep ExecReload` shows how the unit is written. Service management details are in [System Service Management](../../basic/services/system_services.md).

## 5. Zombie Processes: Why kill Cannot Remove Them

When `top`'s header shows `1 zombie`, or `ps` shows a state of `Z`, there is a process that **has died but has not yet been reaped by its parent**.

### 5.1 How Zombies Come to Be

When a process exits it leaves behind a "last message" such as its exit code, which the parent must read via `wait()`/`waitpid()` before the kernel fully reclaims that PID. If the parent forgets to reap it (a busy loop that never waits, a bug, a signal that interrupts the reap logic and never resumes it), the child is stuck in `Z` state — **consuming no CPU or memory**, leaving only a single entry in the process table. It is not a "zombie still running", it is a "corpse awaiting sign-off".

### 5.2 Why kill Cannot Kill It

`kill` sends the signal to an execution entity that no longer exists, so no one receives it; `kill -9` is equally ineffective. The only way out is to have the **parent** reap the corpse:

```bash
$ ps -eo pid,ppid,stat,cmd | awk '$3 ~ /Z/'
    PID    PPID STAT CMD
   2041    1873 Z    [nginx] <defunct>

$ ps -p 1873 -o pid,cmd
    PID CMD
   1873 nginx: master process /usr/sbin/nginx
```

How to handle it: first check who the PPID is. If the parent is a normal service, restarting that service (`systemctl restart`) usually clears it too; if the parent is behaving abnormally, TERM the parent as appropriate — once the parent exits, orphaned zombies are taken over and reclaimed by PID 1 (or systemd). A few occasional zombies are generally harmless; **continuous accumulation** is the bug, and it will exhaust PIDs. On a systemd system, services are launched by systemd, so long-lived zombies usually point to the service's own code not waiting, which should be fixed by the application side.

## 6. The Relationship Between systemd Units and Processes

All three families default to systemd as PID 1. Understanding its relationship with processes is what lets you read the tree inside `systemctl status`.

### 6.1 One Unit Maps to One Process Tree and One cgroup

The output of `systemctl status` states the relationship quite plainly:

```bash
$ systemctl status nginx
● nginx - A high performance web server
     Loaded: loaded (/lib/systemd/system/nginx.service; enabled)
     Active: active (running) since Mon 2026-09-21 08:15:03 CST; 1 day ago
   Main PID: 1102 (nginx)
      Tasks: 5 (limit: 4612)
     Memory: 12.4M
        CPU: 1.234s
     CGroup: /system.slice/nginx.service
             ├─1102 nginx: master process /usr/sbin/nginx
             ├─1103 nginx: worker process
             └─1104 nginx: worker process
```

Key points:

- **Main PID**: the unit's main process; `Type=` determines how systemd identifies it (`simple` recognizes the first process directly launched by `ExecStart`; `forking` recognizes the parent forking and exiting while the background process takes over; `oneshot` runs and exits; `notify` waits for the process to report readiness).
- **CGroup**: all processes under a unit are placed in the same control group. `systemctl stop`/`kill` means **kill the entire cgroup**, sweeping away even the workers that slipped through — this is why systemd is more reliable than a bare `kill` on the main process: killing only the master can leave orphaned workers still holding the port.
- **Tasks**: the current number of threads/processes inside the unit; a sudden spike may mean a fork storm or a thread leak.

### 6.2 The Difference From Manual Processes

A process you start with `nginx &` does not belong to any service unit: `systemctl stop` cannot touch it, it will not start on boot, and its logs may bypass the journal entirely. When troubleshooting "why is the service still running", tell apart the cgroup processes claimed by `systemctl status` from the wild ones in your terminal (in `ps`, a `TTY` of `pts/` rather than `?` usually explains it).

Related commands at a glance:

```bash
systemctl status nginx       # see the tree and Main PID
systemctl cat nginx          # see the unit definition (ExecStart/Reload)
systemctl kill nginx         # send a signal to the whole cgroup (default TERM)
pgrep -a nginx               # list all nginx processes
```

## 7. Process Priority: nice and renice

The kernel schedules CPU contention using the nice value: the range is **-20 (most greedy) to 19 (most courteous)**, default 0. Ordinary users can only adjust their own processes in the "courteous" direction (increase the number); negative values require root.

```bash
$ nice -n 10 tar cf /backup.tar /data    # low-priority archive, does not starve online services
$ sudo nice -n -20 mysqld                 # raise priority (use with care)

$ renice 10 -p 2041                       # adjust a running process
$ ps -o pid,ni,cmd -p 2041
    PID  NI COMMAND
   2041  10 mysqld
```

The `PR`/`NI` columns in `htop`/`top` are real-time priority information. Nice only affects CPU contention and **does not directly limit IO or memory**; for hard quotas you need cgroups (systemd's `CPUWeight=`, `MemoryMax=`, etc.). Lowering nice for batch offline tasks (backups, compiles) is a good habit; before changing to a negative value in production, think carefully about whether it will starve system processes.

## 8. Foreground, Background, and Job Control

For small-scale control in an interactive shell, use the job mechanism:

```bash
$ long_command &          # send to background
$ Ctrl+Z                  # suspend the foreground task
$ jobs                    # list jobs, gives you %1
$ bg %1                   # resume in background
$ fg %1                   # bring back to foreground
```

After closing an SSH window, both foreground and ordinary background jobs receive SIGHUP and die. To keep something alive after closing the terminal:

```bash
$ nohup ./run.sh > run.log 2>&1 &
```

`nohup` ignores SIGHUP and redirects output to `run.out` or a specified file. For short scripts this is enough; **long-running services should go to systemd** (auto-start, restart policy, logging, and dependency management all in one place), not a pile of `nohup` — this is the dividing line between "can use the shell" and "can run a server".

## 9. Pipes and Redirection: The Process Interface

The most common collaboration between processes is the pipe: the previous process's standard output is fed into the next process's standard input, with both running simultaneously and the kernel's pipe buffer bridging them:

```bash
$ ps aux | grep nginx | awk '{print $2}'   # three processes form a pipeline
$ ps aux --sort=-%mem | head -n 10 > /tmp/top-mem.txt
```

Redirection governs the relationship between a process and a file: `>` overwrites, `>>` appends, `2>` captures errors, `2>&1` merges, `>/dev/null` discards. When troubleshooting, sending a service's standard output into a file is the first move; shell-level details are in [Text Processing and Redirection](../../script/bash-basics.md). Here just remember: **each stage of a pipe is an independent process**, `kill` can only hit precisely by PID, and a pipe as a whole has no "process number".

## 10. Scheduled Tasks: cron and at

Periodically launching processes is the scheduler's job, the other side of the same coin as manual kill:

```bash
$ crontab -e          # edit current user's jobs
$ crontab -l          # list
# format: minute hour day month weekday command
# 0 2 * * * /usr/local/bin/backup.sh

$ at now + 30 minutes   # one-shot task
at> /usr/local/bin/report.sh
at> Ctrl+D
$ atq                  # view the queue
$ atrm 1                # delete
```

System-level cron goes in `/etc/crontab` or `/etc/cron.d/` (with a username field); user-level uses only `crontab`. On systemd you can also use timer units to replace cron (`systemctl list-timers`); on Arch many packages (such as sysstat) collect via timers by default. When a task does not run, check first: the time expression, absolute paths, whether environment variables are fewer than in an interactive shell, and whether logs are redirected — cron's `PATH` is usually only `/usr/bin:/bin`, so `mysql`, `docker`, and the like need full paths.

## 11. Three-Family Tool Comparison (Including pacman)

| Task | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Process snapshot | `ps` (procps) | `ps` (procps-ng) | `ps` (procps-ng) |
| Real-time monitoring | `top` built in | `top` built in | `top` built in |
| Enhanced UI | `sudo apt install htop` | `sudo pacman -S htop` | `sudo dnf install htop` |
| Process tree | `pstree` (psmisc, usually installed) | `pacman -S psmisc` | `dnf install psmisc` |
| Kill by name | `pkill`/`killall` | same as left | same as left |
| Dynamic tracing | `sudo apt install bpftrace` | `sudo pacman -S bpftrace` | `sudo dnf install bpftrace` |
| Service-process relationship | `systemctl` (systemd) | same as left | same as left |
| Scheduled tasks | cron preinstalled | `pacman -S cronie` and enable | `dnf install cronie` (or systemd timer) |

Note: a minimal Arch install does not include cron; to get cron-like capability, install `cronie` and run `systemctl enable --now crond`. The RHEL family commonly has `crond` enabled by default. `bpftrace` is for kernel-space dynamic tracing (who is reading which file, which function is hottest) and needs a newer kernel plus root; for entry-level monitoring, familiarizing yourself with top/vmstat/iostat is enough — bpftrace is an advanced weapon. The package name is the same across the three families, and the install command switches with the package manager.

## 12. Common Gotchas

1. **Habitually using `kill -9`**. TERM first to give it a chance to clean up; KILL is a nuclear option, not the default. If the process still shows after KILL, it is usually waiting for the parent to reap it; see the zombie section.
2. **`ps aux | grep nginx` killing itself**. The grep in the pipe is also a line; `kill` errors on a non-number; use `pgrep -f` or `pgrep nginx`.
3. **`pkill -f` pattern too wide**. `pkill -f python` may take down everything Python inside jupyter or supervisor; preview with `pgrep -af` before `pkill`.
4. **Killing only the master and ignoring workers**. A manual kill can leave orphaned workers still holding the port; for service processes use `systemctl stop/restart` so the cgroup is cleared together.
5. **Treating zombies as malicious processes and repeatedly killing them**. It is ineffective; find the PPID and restart the parent service or fix the parent's wait logic.
6. **Reload does not take effect**. If the service has no `ExecReload` configured or does not support hot reload at all, `systemctl reload` is a no-op; after a config change use a syntax check such as `nginx -t` and restart when you should.
7. **Cannot find "system processes" inside a container**. Container PID namespaces are isolated, so `ps` only sees processes inside the container; to see host processes you must enter the host namespace, and do not rush to blame broken monitoring.
8. **Thinking `nice` can limit IO/memory**. It only affects CPU scheduling weight; for hard resource limits use cgroup or systemd unit properties.
9. **Using nohup as a service manager**. No restarts, no logging conventions, no dependencies; move long-running tasks to a systemd unit.

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - Program observation and job control - [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0440processcontrol.php)
- Arch Wiki - Process management - [wiki.archlinux.org](https://wiki.archlinux.org/title/Process)
- Arch Wiki - systemd - [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd)
- systemd.service(5) man page (Type= and cgroup semantics) - [man7.org](https://man7.org/linux/man-pages/man5/systemd.service.5.html)
- `man ps`, `man top`, `man kill`, `man pgrep`, `man nice`
- signals(7) - [man7.org](https://man7.org/linux/man-pages/man7/signal.7.html)
- For memory and OOM see [Memory Management](./memory.md); for monitoring readings see [Monitoring Tools](./monitoring.md)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/commands/README.md)
- [system](/commands/system.md)
- [monitoring](monitoring.md)
- [system_info](system_info.md)
- [glossary](/glossary.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [README](/source/README.md)
- [ipc](/source/ipc.md)
- [process-scheduling](/source/process-scheduling.md)
