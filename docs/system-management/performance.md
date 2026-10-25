# Performance

"The server is slow" is the vaguest complaint in operations and the core problem this page solves:
turn a vague feeling into **an evidence-backed conclusion** (is the bottleneck CPU, memory, or disk IO),
and only then talk about tuning.
The page's stance is stated up front: **observation comes before tuning** --
"optimization" without a baseline, without a control, and without a reproduction path
is essentially running random experiments on production.

> The methodology draws on Brendan Gregg's USE method, the Arch Wiki,
> and RHEL performance documentation; see the references at the end;
> single-command syntax and output column meanings are in
> [Commands: System](../commands/system.md) and are not repeated here.

## What This Page Covers

- Understand why "observe first, hypothesize second, act last" matters, and the cost of doing it backwards
- Get familiar with the decision path for the "load / memory / IO" triangle
- Correct common misreadings: `load average` is not CPU%, and `available` is the memory answer
- Walk through every resource with the USE method and turn "feels slow" into a filled-in table
- Tune only after the evidence exists, and know which "classic tweaks" are actually pitfalls
- Know the installation differences for observation tools across the three distro families (Debian/Ubuntu, Arch, RHEL/CentOS/Rocky)

## 1. Why Observation Comes Before Tuning

Tuning failures almost always trace back to the same wrong order:
**change the parameter first, then see if it worked, and finally (too late) figure out what the original problem was**.
A common pattern is changing `vm.swappiness` from 60 to 10, switching the I/O scheduler to `deadline`,
killing a few services, and then declaring "much faster".
Each of those operations may be correct on its own, but without measurement
you cannot answer three questions: is the bottleneck really memory, is the improvement from the parameter or from the traffic dip,
and did the change introduce a new problem.

Observation first is a discipline, not just a technique, because it solves three things at once:

1. **Localization**. The causes of a slow system are extremely wide --
   a background dpkg/apt process left behind by an incomplete `apt upgrade`,
   a log that filled the disk, an NFS mount timeout,
   even a kernel OOM kill stuck in a reboot loop;
   they all present as "stuck". Only measurement narrows the hypothesis to a single troubleshooting path.
2. **Baseline**. If you do not know whether your normal CPU peak is 30% or 70%,
   you cannot judge whether today's 80% is abnormal.
   The baseline is also the only basis for capacity planning and alert thresholds.
3. **Verification and rollback**. Any tuning is an experiment:
   only before-and-after data can prove the change worked;
   and if it gets worse, you can quantify the degradation and roll back decisively.

Brendan Gregg summarized this order in one sentence:
use cheap tools first to answer "which kind of resource is the problem" (the USE method, see section 5),
then drill down to the specific code path with expensive tools (perf, bcc tracing),
and only lastly consider changing configuration or code.
The chapter order on this page follows that path.

## 2. Load, Memory, IO: The Triangle of Performance Diagnosis

Most "machine is slow" cases end up in one of three directions.
They are interrelated (IO wait raises load, memory exhaustion triggers paging that drags IO down),
so troubleshooting must **cross-validate** rather than convict on a single metric:

- **High load**: means tasks are queueing or blocked.
  But high load does not mean CPU is the bottleneck -- it can also be disk waiting
  (see the misreading analysis in section 4).
- **Tight memory**: check whether `available` is persistently low and
  whether `vmstat`'s `si/so` is persistently non-zero.
  Once paging is sustained, the system enters thrashing, and the feeling is "nothing will open".
- **Busy IO**: check `iostat -x` for `%util`, `await`, and queue length.
  A disk that handles sequential reads fine can be saturated by random small IO -- the classic bottleneck for database workloads.

A quick triage only takes three steps, in a fixed order:

```bash
# Step 1: look at load and CPU distribution -- when load is high, first tell compute from waiting
$ uptime
 10:30:00 up 12 days,  3:21,  1 user,  load average: 6.52, 4.10, 3.05

$ mpstat -P ALL 1
10:31:05  CPU    %usr   %nice    %sys %iowait    %irq   %soft  %steal   %idle
10:31:06  all  45.10    0.00    3.20   28.50    0.00    0.50    0.00   22.70
10:31:06   0  44.00    0.00    3.00   30.00    0.00    1.00    0.00   22.00
10:31:06   1  46.20    0.00    3.40   27.00    0.00    0.00    0.00   23.40
```

`%iowait` at two or three tenths means a significant share of the "CPU idle" is actually waiting on disk;
at that point the arrow should point at IO; only if `%usr` is pegged and `%iowait` is near 0 is it a CPU bottleneck.

```bash
# Step 2: look at memory -- only trust available, not free
$ free -h
               total        used        free      shared  buff/cache   available
Mem:            15Gi       6.2Gi       512Mi       256Mi       8.6Gi       8.5Gi
Swap:          2.0Gi       128Mi       1.9Gi

$ vmstat 1 3
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd     free    buff   cache   si   so    bi    bo   in   cs us sy id wa st
 2  1  131072  524288  102400 8808448    0   12    10   120  850 1600 45  3 22 30  0
 3  0  131072  518144  102400 8812672   48    0   512   980  920 1750 48  3 19 30  0
 2  2  131072  515072  102400 8815104   52    0   540  1024  940 1780 47  4 18 31  0
```

Only sustained non-zero `si/so` is real paging pressure; an occasional batch is normal cold-page eviction.
The `available` decision criterion and common misreadings are in section 4.

```bash
# Step 3: look at disk -- high %util means the disk is busy, high await means every request is slow
$ iostat -x 1
Device  r/s     w/s    rkB/s    wkB/s  await aqu-sz  %util
sda     12.00  320.00   48.00  4096.00  8.50   2.84  65.20
nvme0n1  0.00    0.00    0.00     0.00  0.00   0.00   0.00
```

Column names vary slightly across sysstat versions: `aqu-sz` and `avgqu-sz` are two spellings of the same column,
meaning the average request queue length; go by what `iostat -x` actually prints on your machine.

Once you walk the triangle, the conclusion usually narrows to one of three:
"CPU batch processing is too aggressive",
"memory is starting to page", or "this disk is pegged";
then use `pidstat`, `iotop`, and `top` to pin it to a specific process.
Network-side observation (`iftop`, `nethogs`, `ss -s`)
has its own pages in the Network and Commands sections and is not expanded here.

## 3. Observation Tools at a Glance

The tools themselves are a lookup table; here I only emphasize what question each one answers:

| Question | Go-To Tool | Notes |
|----------|------------|-------|
| How long has it been queueing? | `uptime`, `top` first line | the load three-line trend matters more than a single point |
| Where is CPU going? | `mpstat -P ALL 1` | split us/sy/wa/hi; see step 1 in section 2 |
| Who is eating CPU/memory? | `top`/`htop`, `ps aux --sort=-%mem` | use `top -b -n 1` for batch capture |
| Is memory still enough? | `free -h` for `available`; `vmstat` for si/so | column meanings in [Memory Management](../commands/system/memory.md) |
| Which disk is busy? | `iostat -x 1`, `iotop` | high `%util` and high `await` are two different diseases |
| What happened historically? | `sar -u`, `sar -q`, `sar -d` | depends on sysstat collection being enabled; see section 6 |
| Network traffic and connections | `iftop`, `nethogs`, `ss -s` | see [Network Monitoring](../network/network-monitoring.md) |
| Drill down to a specific call | `perf top`, bcc tools (`execsnoop` etc.) | expensive, has overhead; use after the triangle triage |

`mpstat`, `iostat`, `pidstat`, and `sar` all come from the same package **sysstat**;
three-family installation comparison is in section 6;
when you need "which syscall is actually spending the time",
install the bcc dynamic tracing tools (Debian-family tool names carry the `-bpfcc` suffix).

## 4. Common Misreadings

### 4.1 load average Is Not CPU Usage

`load average` counts the number of tasks in **running + uninterruptible sleep** (state D),
most of the latter waiting on IO. It therefore naturally mixes "CPU queueing" and "disk queueing" causes,
so converting it directly to "CPU percentage" will inevitably mislead:

- 8-core machine, load 6.5: within bounds, not necessarily a problem;
  sustained above the core count is when tasks are queueing.
- load 20 while `mpstat`'s `%us` is only 40% and `%iowait` is high:
  the bottleneck is disk; adding CPU will not help.
- The side-by-side reading of load vs CPU%, and what the three-line trend means,
  are fully derived in the FAQ at [Commands: System](../commands/system.md);
  here I only give the conclusion: **load answers "how many tasks are waiting", CPU% answers "where is the compute going",
  and the two must be read side by side**.

### 4.2 available Is the Memory Answer, Not free

In `free -h`, a persistently low `free` column is **healthy**:
Linux turns temporarily unused memory into page cache to speed up disk reads and writes,
and the cache yields immediately when a process asks for memory. The "is it still enough" question is answered by `available` --
the kernel's estimate of "memory that can be allocated to a new process right now".
The column-by-column breakdown of `available` vs `free`, the real meaning of swappiness,
and the OOM trigger chain are all in
[Commands: Memory Management](../commands/system/memory.md) in their own section,
which is not repeated here. The only decision rule that stays is:

> Only when `available` is persistently below your safety floor for the workload (say 10%--15% of total)
> **and** `vmstat`'s `si/so` is persistently non-zero should you consider adding memory or chasing a leak;
> if only `free` is low and `buff/cache` is high, do nothing.

### 4.3 top's %MEM Adding Up Above 100% Is Normal

Shared libraries are counted into every process's RSS separately, so the per-process view is fine;
whole-machine memory is always judged by `free`'s `available`.
Similarly, in `top` high `%us` is an application problem, high `%sy` is too many syscalls,
and high `%wa` is a disk bottleneck -- all called "high CPU", but the conclusions are completely different.

### 4.4 "Clearing Cache to Improve Performance" Is a False Need

Casually running `echo 3 > /proc/sys/vm/drop_caches` only creates a cold-cache storm,
making the next set of accesses slower. It is meaningful in only two scenarios:
eliminating hot/cold differences before a benchmark test, or confirming that an IO test is not being disturbed by cache.
Treating it as an "optimization lever" in production is treating the symptom as the disease.

## 5. The USE Method: Walk Through Every Resource

USE (Utilization, Saturation, Errors)
is the checklist-style method Brendan Gregg recommends:
ask the same three questions of every resource, and any non-zero value must be explainable.
It is not a new tool, but a **process that guarantees nothing is missed**:

| Resource | Utilization | Saturation | Errors |
|----------|-------------|------------|--------|
| CPU | `mpstat` us+sy+st | `vmstat`'s `r` column (run queue) | anomalies in `perf`, `dmesg` |
| Memory | `free` used fraction | `vmstat`'s `si/so` (paging) | OOM records in `dmesg` |
| Disk | `iostat -x` `%util` | `aqu-sz` (queue length) | `smartctl -a`, I/O errors in `dmesg` |
| Network | `ip -s link` rx/tx rates | `ss -s` retransmits/backlog | errors/drops in `ip -s link` |

The recommended hands-on order: first do a quick triage with the section 2 triangle,
lock the suspect resource, then fill in the USE table for that resource,
and only then pull out `pidstat -d 1` and bcc tools to drill down to processes and functions.
The common pitfall is skipping the first two steps and going straight to `perf top` --
the flame graph is beautiful, but it does not explain "why are we looking at this process right now".

## 6. Three-Family Tool Installation

Observation tools differ significantly in package name and "is it working after install" state across the three families,
and this is the easiest place to trip on this page:

| Tool | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| sysstat (iostat/sar/mpstat) | `sudo apt install sysstat` | `sudo pacman -S sysstat` | `sudo dnf install sysstat` |
| bcc dynamic tracing toolset | `sudo apt install bpfcc-tools` (commands carry the `-bpfcc` suffix) | `sudo pacman -S bcc bcc-libbpf-tools` | `sudo dnf install bcc-tools`; verify the package name with `dnf search bcc` before installing |
| bpftrace advanced tracing | `sudo apt install bpftrace` | `sudo pacman -S bpftrace` | `sudo dnf install bpftrace` |
| htop / iotop real-time viewing | `sudo apt install htop iotop` | `sudo pacman -S htop iotop` | `sudo dnf install htop iotop` |
| cpupower (frequency scaling) | `sudo apt install linux-tools-common linux-tools-$(uname -r)` | `sudo pacman -S cpupower` | `sudo dnf install kernel-tools` |

Three details you must know:

**Installing sysstat does not mean `sar` has history**.
Debian/Ubuntu writes `ENABLED="false"` in `/etc/default/sysstat` by default;
change it to `true` and run `sudo systemctl enable --now sysstat` before collection starts;
Arch's collection config is in `/etc/conf.d/sysstat`, and the RHEL family's is in `/etc/sysconfig/sysstat`;
confirm the switch after installing on all three.
The data directory also differs: Debian/Ubuntu uses `/var/log/sysstat/`,
Arch and the RHEL family use `/var/log/sa/`;
when `sar -q` and `sar -u` return nothing, first figure out which family you are on.

**bcc tool names are not uniform across the three families**.
Debian/Ubuntu uses `bpfcc` naming with suffixed commands (`execsnoop-bpfcc`);
Arch splits it into the `bcc` library and the `bcc-libbpf-tools` toolset;
the RHEL family historically calls it `bcc-tools`.
Search once with `pacman -Ss bcc`, `apt search bpfcc`, and `dnf search bcc` before installing --
that is a habit valid across all three families;
never type a package name from memory when unsure, search on the spot.

**Dynamic tracing needs kernel cooperation**.
bcc/bpftrace depend on kernel BPF support and the matching headers/kernel parameters;
containers and some cloud VM images may have stripped the relevant configuration;
when you get `Operation not permitted` or missing headers,
first confirm that the kernel headers for `uname -r` are installed, then suspect the code.

## 7. After the Evidence: Basic Discipline of Tuning

The following operations all belong to the "after the bottleneck is confirmed" stage; order matters more than the parameter itself:

### CPU Frequency Scaling

```bash
# Check the current policy (powersave/schedutil/performance vary by distro and driver)
$ cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
schedutil

# Switch to performance only when you need sustained full frequency (e.g. a bare-metal database)
$ sudo cpupower frequency-set -g performance
```

The `schedutil` or `powersave` default on laptops and cloud VMs is usually the right choice;
pinning a workstation to `performance` permanently only buys fan noise,
it will not make compilation faster in a scenario where the bottleneck is already disk.

### Memory Parameters

`vm.swappiness` means "how much reclaim prefers evicting anonymous pages", not "whether swap is used",
and 0 does not mean never evict.
Only when `si/so` is persistently non-zero and `available` is confirmed chronically low is it worth adjusting;
persist the change in `/etc/sysctl.d/99-*.conf` rather than appending to `/etc/sysctl.conf` from old write-ups,
and verify with `sysctl --system` after changing --
column-by-column explanation and full derivation are in [Memory Management](../commands/system/memory.md).

### Disk and Scheduler

```bash
# Check the current scheduler
$ cat /sys/block/sda/queue/scheduler
[mq-deadline] kyber bfq none
```

On SSD/NVMe the default `mq-deadline` or `none` (multi-queue passthrough) usually needs no change;
`bfq` is better suited to desktop interactive workloads.
Switching schedulers is a **low-risk operation you can roll back at runtime**,
but the benefit is often close to zero -- first prove with `iostat` that queueing exists before acting.
Filesystem selection (XFS for large-file pipelines, ext4 for general use) is a deployment-time decision;
switching filesystems at runtime is outside this page's scope.

## 8. Common Gotchas

1. **Drawing a conclusion from a single sample point**.
   The moment you hit `top` might land exactly on a GC, backup, or apt-update spike;
   look at at least 1 minute of trend (`mpstat 1 10`) or the 15-minute load line before judging.
2. **Translating high load directly to "not enough CPU"**.
   Check `%iowait` and `iostat` first; see section 4.1 --
   this is one of the two classic misreadings collected here; the other is treating `free` as the memory answer.
3. **Changing kernel parameters/schedulers without a backup**.
   Tuning is a rollback-capable experiment, but only if you know how to roll back;
   rollback capability comes from [Backup and Recovery](./backup-and-recovery.md);
   the two disciplines are paired in this section.
4. **Installed sysstat but no history to query**.
   Collection is not switched on (Debian family defaults to off);
   turning it on during live troubleshooting only starts accumulating from now, and you cannot look back at "what happened last night".
   Opening collection should be the first thing done on a new machine; see section 6.
5. **Batch-copying a parameter list from a blog**.
   swappiness, scheduler, read-ahead, NR_OPEN...
   behavior differs greatly across kernel versions and hardware;
   every item must be able to answer "which measured problem does this solve",
   and if you cannot answer, do not change it.
6. **The observation tools themselves slow the machine down**.
   `iostat 0.1`, excessive `sar` sampling, and resident high-overhead tracing all cost something;
   in production start with a 1-second sampling interval,
   and turn off dynamic tracing tools as soon as you are done.

## References

- Brendan Gregg - Linux Performance (USE method, methodology) -- [brendangregg.com](https://www.brendangregg.com/linuxperf.html)
- Arch Wiki - Improving performance -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- Red Hat - Monitoring and managing system status and performance -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/index)
- sysstat official docs (iostat/mpstat/pidstat/sar) -- [github.com](https://github.com/sysstat/sysstat)
- BCC tools (dynamic tracing) -- [github.com](https://github.com/iovisor/bcc)
- bpftrace -- [github.com](https://github.com/bpftrace/bpftrace)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Process observation and management -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0440processcontrol.php)
- [Commands: System](../commands/system.md) (command syntax and output column quick reference)
- [Commands: Memory Management](../commands/system/memory.md) (available/swappiness/OOM section)
- `man mpstat`, `man iostat`, `man vmstat`, `man sar`, `man pidstat`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [cpu](/hardware/cpu.md)
- [knowledge](/knowledge.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [ipc](/source/ipc.md)
- [memory-management](/source/memory-management.md)
- [README](README.md)
- [boot-process](boot-process.md)
