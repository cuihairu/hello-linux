# System Monitoring Tools

The point of monitoring is not "collect more numbers" but answering three questions before the business gets slow: **how much CPU headroom is left, is memory paging, and which becomes the bottleneck first, disk or NIC**. The tools themselves are highly consistent across the three families; the real dividing line is whether you know what each number means and **what counts as abnormal when you see it**.

> Content drawn from the procps-ng and sysstat manuals, Brendan Gregg's methodology, and the Arch Wiki; see the references at the end.

## What This Page Covers

- Tell top/htop (real-time interactive), vmstat/iostat/mpstat (sampling), and sar (historical) apart
- Read the key columns of vmstat, iostat, mpstat, and sar, and build an "abnormal threshold" intuition
- Installing sysstat and enabling collection across the three families (including Arch's pacman and systemd timer)
- Running a full checkup in the order "load -> CPU -> memory -> IO"

## 1. Selection: Instantaneous, Sampling, or Historical

Arrange the tools into three tiers by time capability, and when troubleshooting pick the tier first, then the command:

| Tier | Tools | The question it answers | Limits |
|------|------|-----------|------|
| Instantaneous interactive | `top`, `htop` | who is busiest right now | no history; gone when you quit |
| Periodic sampling | `vmstat`, `iostat`, `mpstat`, `pidstat` | is each subsystem saturated over a window | only covers the window you are watching |
| Persistent history | `sar` (sysstat) | what did memory look like at 3pm yesterday | must be installed and enabled beforehand |
| Dynamic tracing | `bpftrace`/perf | which function/call path causes the hotspot | steep bar; use carefully in production |

Typical troubleshooting order: `uptime`/`top` for load -> `vmstat 1` to split CPU/memory/IO into broad categories -> `iostat -x 1`/`mpstat -P ALL 1` to pin down a device or a single core -> `pidstat`/`htop` to drop down to the process when needed -> flip through `sar` to find "when did it start getting bad".

## 2. top: Real-Time Processes and Header Overview

### 2.1 Why Read the top Header First

Five lines of system overview sit before the process list, and **most misdiagnosis dies in not reading the header**:

```bash
$ top
top - 14:02:11 up 12 days,  1 load average: 6.52, 4.10, 3.05
Tasks: 182 total,   2 running, 180 sleeping,   0 stopped,   0 zombie
%Cpu(s): 25.0 us, 10.5 sy,  0.0 ni, 55.2 id,  8.9 wa,  0.0 hi,  0.4 si,  0.0 st
MiB Mem :   7800.0 total,   400.0 free,   6100.0 used,   1300.0 buff/cache
MiB Swap:   2048.0 total,   1024.0 free,   1024.0 used.    900.0 avail Mem
```

How to read it and the abnormal signals:

- **load average**: 1/5/15 minutes. Compare against `CPU(s)` core count -- on 8 cores, 6.5 is still within bounds; sustained above the core count = tasks are queueing. All three lines rising together is sustained pressure; only the 1-minute line high is usually a spike.
- **%Cpu(s)**: high `us` (user mode) -> the application is crunching; high `sy` -> too heavy on syscalls/kernel mode (frequent `sy` + low `us` means check `strace`/lock contention); `wa` sustained high with busy disk -> IO bottleneck; `st` sustained above 0 -> the VM is being preempted by the host; find the cloud vendor or reduce oversubscription.
- **Memory lines**: low `free` is not a panic, look at `avail Mem`; only sustained growth in swap used, judged together with si/so, matters (see section 4 and [Memory Management](./memory.md)).
- **zombie**: long above 0 means find the parent and have it reap; see [Process Management](./process.md).

Common keys: `P` sort by CPU, `M` sort by memory, `1` expand per core, `k` send a signal, `q` quit. For script collection use `top -bn1` (only `-b` batch mode is suitable for `grep`/`awk`).

### 2.2 The Limits of top

`top` averages over its sampling interval by default, so a spike of a few seconds can be smoothed out; `%MEM` is RSS-based and double-counts shared libraries. For cross-machine comparison and reports, the machine-readable output of `vmstat`/`pidstat`/`sar` is preferable.

## 3. htop: Interactive Enhancement and Installation

`htop` offers colored bars, mouse, tree view (`F5`), filter (`F4`), and an `F9` menu to send signals; the inspection experience beats `top`, but it is **not preinstalled**:

```bash
sudo apt install htop      # Debian/Ubuntu
sudo pacman -S htop        # Arch
sudo dnf install htop      # RHEL/CentOS/Rocky
```

On Arch install only after a full system upgrade (`sudo pacman -Syu`) to avoid a partial upgrade. The two bars at the top correspond to CPU and memory, with color as status (green = normal, red = danger); same data source as `top`, so the choice is pure interactive preference. Install it on a server as the default inspection entry point, but scripts should still use the pipeable `top -bn1` or `ps`.

## 4. vmstat: CPU / Memory / IO in One Line

### 4.1 Usage and the First-Line Trap

```bash
$ vmstat 1 5
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
  r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
  2  0 512000 400000 100000 800000  10   50   200   400  1500 3000 20  5 60 10  0
  0  0 512000 398000 100000 802000   0    0    10    20  1200 2500  8  2 90  0  0
```

Syntax is `vmstat [interval seconds] [count]`. **The first line's numbers are the average since boot**; from the second line onward are the real per-interval samples -- start drawing conclusions from the second line.

### 4.2 Column Meanings and "What Counts as Abnormal"

| Area | Column | Meaning | Abnormal reading |
|------|----|------|----------|
| procs | r | processes waiting to run | **sustained above CPU core count** -> CPU queueing, scheduler saturated |
| procs | b | uninterruptible sleep (mostly waiting on IO) | **sustained at or above 1** -> processes stuck on disk/driver |
| memory | swpd | swap used (KB) | meaningless alone; combine with si/so |
| memory | free/buff/cache | free and cache | low free is not abnormal by itself |
| swap | si / so | KB swapped in/out per second | **sustained non-zero** -> memory pressure, possible thrashing |
| io | bi / bo | block device read/write KB per second | compare against business expectations; check whether a burst of writes is a scheduled backup |
| system | in / cs | interrupts/context switches per second | abnormally high `cs` (hundreds of thousands) with high CPU `sy` -> over-switching (thread model/lock contention) |
| cpu | us / sy / id / wa / st | user/system/idle/waiting on IO/preempted | `id` long below 5% with `r` above core count -> CPU full; sustained high `wa` -> IO; `st` above 0 -> host interference |

A "healthy vs sick" intuition: a healthy machine most of the time has `r` at or below core count, `si/so` near 0, `b=0`, and headroom in `id`; during a database backup window `bo` and `wa` rising together is explainable, and it only counts as an incident if they stay high **outside the window**.

## 5. iostat: Is Disk the Bottleneck

### 5.1 Installation (sysstat across the three families)

`iostat`/`mpstat`/`sar` all belong to the **sysstat** package; the install command differs per family, and these three are the ones this monitoring page requires you to remember:

```bash
sudo apt install sysstat     # Debian/Ubuntu (apt)
sudo pacman -S sysstat       # Arch (pacman)
sudo dnf install sysstat     # RHEL/CentOS/Rocky (dnf)
```

On Arch, the package's **systemd timer** (`sysstat-collect.timer`, etc.) handles periodic collection after install; `systemctl status sysstat-collect.timer` should be active. On Debian/Ubuntu you must also set `ENABLED="true"` in `/etc/default/sysstat`, otherwise `sar` has no historical data. After installing, verify the command exists with `iostat -x 1 3`.

### 5.2 Usage and Output

```bash
$ iostat -x 1 3
Linux 6.8.0-45-generic (web01) 	09/22/2026 	_x86_64_	(4 CPU)

avg-cpu:  %user   %nice %system %iowait  %steal   %idle
           3.10    0.00    1.20    4.50    0.00   91.20

Device            r/s     w/s    rkB/s    wkB/s   rareq-sz  wareq-sz  await  %util
sda              5.00   20.00    80.00   400.00     16.00     20.00   2.50  15.00
nvme0n1         80.00   10.00  1200.00   100.00     15.00     10.00   0.40  25.00
```

Without `-x` you only get basic throughput: `tps`, `kB_read/s`, `kB_wrtn/s`; always add **`-x`** for troubleshooting. Same caveat: without an interval argument, or for the **first report**, the output includes the average since boot; for continuous observation read the second section onward.

### 5.3 Key Columns and Anomalies

| Column | Meaning | Abnormal reading |
|----|------|----------|
| r/s, w/s (tps) | read/write requests per second | compare against application behavior; high with no business load -> background jobs/log storm |
| rareq-sz / wareq-sz | average request size (sector/byte range) | many tiny random writes -> small IO fragmentation; consider merging or switching to SSD |
| await / r_await / w_await | average wait time including queue (ms) | mechanical disk sustained above 20-30ms, SSD sustained above a few ms and clearly above baseline -> watch it |
| aqu-sz (newer iostat) | average queue length | sustained at or above 1-2 with rising await -> the device is queueing |
| %util | fraction of time the device had requests | near 100% on a **single-queue** device -> saturated; a very high %util on **NVMe/multi-queue** devices may still be far from saturated, so read it with await and queue length |

`%util` is the most misunderstood column: it is the fraction of time at least one IO is in flight, not bandwidth being full. On RAID, NVMe, and multi-queue devices, reading %util alone leads to misjudgment; both Brendan Gregg and the iostat manual stress reading it together with await and aqu-sz. `avg-cpu`'s `%iowait` is the same source as `vmstat`'s `wa`, so interpret it just as conservatively -- iowait can read high when there are many idle cores, and **whether the disk is slow is judged by the device columns**.

## 6. mpstat: Checkup Every CPU Individually

`vmstat`/`top` give whole-machine CPU aggregates; when **a single-threaded application saturates one core**, the aggregate still looks idle -- `mpstat` breaks it down per core:

```bash
$ mpstat -P ALL 1 3
14:05:01  CPU    %usr   %sys  %iowait   %irq  %soft  %steal  %guest  %idle
14:05:02  all   12.50   3.00     1.00   0.00   0.50    0.00    0.00   83.00
14:05:02    0   45.00   8.00     2.00   0.00   1.00    0.00    0.00   44.00
14:05:02    1    2.00   1.00     0.00   0.00   0.00    0.00    0.00   97.00
14:05:02    2    3.00   2.00     2.00   0.00   1.00    0.00    0.00   92.00
14:05:02    3    1.00   1.00     0.00   0.00   0.00    0.00    0.00   97.00
```

(Installation is the same as `iostat`, both in sysstat; sampling starts after the first line.)

How to read it and the anomalies:

- **One core's `%idle` sustained near 0 while the others have lots of idle** -> a single-thread bottleneck or CPU affinity pinning; the application layer needs horizontal splitting, or check `taskset`/cgroup core limits for misconfiguration.
- **`%iowait` concentrated on a few cores**: cross-check disk with `iostat`.
- **Sustained high `%soft` (softirq)** -> NIC packet reception/clock interrupts eating CPU, common in high-pps scenarios; consider multi-queue/RPS tuning (advanced).
- **High `%steal`** -> the same problem as `vmstat`'s `st`: virtualization contention.
- **High `%sys` across all cores with low `%usr`** -> too many syscalls or a kernel path problem; next step is `perf`/`strace -c`.

`mpstat -P ALL 1` is the fastest command for deciding "is the load whole-machine or one-core", and it is strongly recommended as standard checkup equipment on machines with four or more cores.

## 7. sar: Turning Monitoring into History

### 7.1 Why sar Is Needed

Every tool above works only "while you happen to be there". When a user says "it got slow starting yesterday afternoon" and there is no historical data, you can only guess. **sar collects and retains system metrics, the time machine for post-hoc review** (the data also comes from the sysstat package).

Install and enable differences across the three families:

| Item | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install | `sudo apt install sysstat` | `sudo pacman -S sysstat` | `sudo dnf install sysstat` |
| Collection mechanism | cron (`/etc/cron.d/sysstat`) | **systemd timer** (`sysstat-collect.timer`, etc.) | cron/service script (`sysstat`) |
| Enable/configure | `ENABLED="true"` in `/etc/default/sysstat` | confirm the timer: `systemctl enable --now sysstat-collect.timer` | set `HISTORY=28` in `/etc/sysconfig/sysstat` (retention days, etc.) |
| Data directory | `/var/log/sysstat/` | `/var/log/sysstat/` | `/var/log/sysstat/` |
| Filename | `sa21` (binary, read directly by sar) / `sar21` (text) | same as left | same as left |

The most common Debian case of "installed sar but no history" is forgetting `ENABLED="true"`; on Arch confirm the timer is running. Verify collection works: `ls -l /var/log/sysstat/` should show today's `saDD` file.

```bash
$ sudo systemctl status sysstat-collect.timer    # Arch/RHEL family timer depends on distro
$ ls /var/log/sysstat/
sa21  sa22  sar21  sar22
```

### 7.2 Common Ways to Read It

```bash
sar -u 1 5           # CPU real-time, equivalent to continuous sampling
sar -u               # CPU history for today (or the current hour)
sar -r               # memory
sar -b               # IO summary
sar -d               # per-disk
sar -n DEV 1 5       # NIC throughput
sar -n EDEV          # NIC errors/drops
sar -q               # run queue and load
sar -u -f /var/log/sysstat/sa21        # specify a date (the 21st)
sar -u -s 14:00:00 -e 15:00:00         # specify a time window
```

`-u`'s `%usr/%sys/%iowait/%steal/%idle` is structurally the same as mpstat; `-r`'s `%memused` varies in algorithm across versions and is not fully the same metric as the `free` columns, so reconcile by trend rather than exact value across tools. Sustained `err/s`/`drop/s` in `-n EDEV` -> cable/switch/driver/buffer problem.

### 7.3 "What Counts as Abnormal" (the sar View)

- `%idle` long below 10% during working hours, matching the load curve -> tight CPU capacity.
- `%iowait` sustained above 5-10% outside the backup window -> check disk and `iostat -x`.
- `%steal` above 0 and stable -> virtualization contention; evaluate migration or file a complaint.
- `kbmemfree` monotonically falling while `kbswpused` rises -> memory leak or insufficient capacity; cross-check [Memory Management](./memory.md).
- `rxpck/s` spikes with `drop/s` rising in step -> traffic attack or insufficient NIC buffering.

No baseline means no anomaly: enable sar in the first week of going live, accumulate "what normal looks like", and only then does a later `sar -u -f ...` comparison carry meaning.

## 8. Auxiliary Commands: free, df, du, lsof, strace

The "quick three-strike set" used alongside subsystem-specific tools; detailed principles are in [Memory Management](./memory.md) and [Viewing System Information](./system_info.md):

```bash
free -h                          # memory: look at available
df -hT && df -i                  # disk: capacity + inode
du -sh /var/log/* | sort -hr | head
lsof -p PID                      # files/ports a process has open
lsof +L1                         # deleted files still held open (the df/du gap)
strace -c -p PID                 # syscall counts (pin down which call class is stuck)
```

`strace -p` slows the target process significantly; in production attach only briefly and notify the business side. For questions a level above "what is the process doing", use `perf top`/`bpftrace`.

## 9. bpftrace: Dynamic Tracing for Beginners (with three-family install)

When a problem narrows from "which subsystem is slow" to **which function, which call path** is slow, and sampling tools are not enough, the eBPF ecosystem's `bpftrace` observes in kernel space with a one-liner of a few dozen characters, no kernel rebuild needed:

```bash
sudo apt install bpftrace     # Debian/Ubuntu (needs a reasonably new kernel and root)
sudo pacman -S bpftrace       # Arch
sudo dnf install bpftrace     # RHEL/CentOS/Rocky
```

An illustration (count syscalls per process, `Ctrl+C` to finish):

```bash
$ sudo bpftrace -e 'tracepoint:syscalls:sys_enter_* { @[comm] = count(); }'
```

Or trace process file opens and measure time deltas across probes; the official `tools/*.bt` has ready-made scripts. Bar to entry: kernel roughly 4.9 or newer with BPF enabled, root required, and usually extra privileges inside a container. **Always start with top/vmstat/iostat to narrow the range to a subsystem**; bpftrace is the last magnifying glass, not the first screwdriver.

## 10. Hands-On: A Five-Minute Checkup Script

String the high-frequency commands together in the order "load -> CPU -> memory -> disk -> process"; the output can be pasted straight into a ticket (each command is a single-line snapshot, usable by both cron collection and manual runs):

```bash
#!/bin/bash
# health-check.sh -- single system checkup snapshot
echo "===== $(date) ====="
uptime
echo; echo "--- CPU (vmstat 1 3, lines 2-3 are samples) ---"
vmstat 1 3
echo; echo "--- per-CPU ---"
mpstat -P ALL 1 2 | tail -n +4
echo; echo "--- Memory ---"
free -h
echo; echo "--- Disk ---"
df -hT -x tmpfs -x devtmpfs
iostat -x 1 2 | tail -n +4
echo; echo "--- Top CPU ---"
ps aux --sort=-%cpu | head -6
echo; echo "--- Top MEM ---"
ps aux --sort=-%mem | head -6
```

For continuous watching, do not spin a `while true` polling loop on top -- use `sar` for history plus alert thresholds (disk above 90%, `available` too low, `sar -q` load sustained above core count). Alert channels (email/webhook) depend on whether the distro ships `mail`, `bc`, and similar tools; minimal images often lack them, so confirm with `command -v` before writing the script, or hand collection to Prometheus and similar (see [Monitoring Systems](../../server/monitoring/prometheus.md)). Thresholds have no global standard, so **go by your own machine's baseline plus the business SLO**, collecting for a week before drawing the line.

## 11. Common Gotchas

1. **Drawing conclusions from the first line of vmstat/iostat/mpstat**. The first line is the average since boot; read at least the second line, or use `vmstat 1 5` and take the last four lines.
2. **Assuming high %util means the disk is full or broken**. High util on a multi-queue device is normal; look at `await`/`aqu-sz` against baseline.
3. **Blaming the mechanical disk whenever iowait is high**. The iowait metric is affected by scheduling and idle accounting; confirm with `iostat -x` device columns.
4. **Installed sysstat but no sar data**. On Debian check `ENABLED="true"`; on Arch check whether `sysstat-collect.timer` is active; on Rocky check `/etc/sysconfig/sysstat`.
5. **On Arch running only `pacman -Sy` before installing sysstat**. A partial upgrade can produce mismatched dependencies; use `pacman -Syu sysstat` or do a full upgrade first.
6. **Adding CPU whenever load is high**. Check `vmstat` for `r` and `wa` first -- IO saturation also raises load, and adding CPU does nothing.
7. **top's %MEM adding up above 100%**. Shared libraries are double-counted by RSS, which is normal; for whole-machine memory look at `free`'s available.
8. **Treating any swap use as an incident**. Evicting cold pages is normal; look at whether si/so is sustained non-zero (see [Memory Management](./memory.md)).
9. **Ignoring `st` when it is non-zero**. Sustained steal on a VM means host oversubscription or a down-spec; no amount of application tuning makes it up.
10. **Monitoring without keeping a baseline**. Without sysstat you cannot answer "when did it change"; collection and alerting must go live on the same day.

## References

- sysstat manual and sar guide -- [sysstat.github.io](https://sysstat.github.io/)
- procps-ng (top/free/vmstat) -- [gitlab.com/procps-ng/procps](https://gitlab.com/procps-ng/procps)
- Brendan Gregg - Linux Performance Methods / USE Method -- [brendangregg.com](https://www.brendangregg.com/linuxperf.html)
- Arch Wiki - Process management / BPFTrace -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- iostat(1), mpstat(1), sar(1), vmstat(8), top(1) man pages -- [man7.org](https://man7.org/linux/man-pages/)
- Finding bottlenecks with the USE Method (Brendan Gregg) -- [brendangregg.com/usemethod.html](https://www.brendangregg.com/usemethod.html)
- Prometheus monitoring system (long-term solution) -- [server/monitoring/prometheus.md](../../server/monitoring/prometheus.md)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/commands/README.md)
- [system](/commands/system.md)
- [memory](memory.md)
- [process](process.md)
- [system_info](system_info.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [automation](/system-management/automation.md)
- [backup-and-recovery](/system-management/backup-and-recovery.md)
