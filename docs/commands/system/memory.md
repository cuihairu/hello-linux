# Memory Management Commands

"Out of memory" is the most easily misjudged alert: a small `free` column in `free` does not mean the box is about to die, and a few MB of swap used does not mean something is seriously wrong. The first lesson of memory management is **understanding where the kernel actually put the bytes**; tuning parameters and troubleshooting come second.

> Content is drawn from Bird's Private Recipes (Lin's Linux Administration Guide), the Arch Wiki (Memory/Swap/OOM Killer), and kernel.org documentation; see the references at the end.

## What This Chapter Covers

- Distinguishing `available` from `free` in `free`
- Reading swap usage and si/so
- OOM Killer trigger conditions, locating it in logs, and tuning oom_score_adj
- Persisting kernel parameters with sysctl (including three-family path differences) and doing advanced analysis with pmap/valgrind/perf/bpftrace

## 1. free -h: Why available and free Differ So Much

### 1.1 Look at Real Output First

```bash
$ free -h
               total        used        free      shared  buff/cache   available
Mem:            15Gi       8.2Gi       1.2Gi       512Mi       6.1Gi       6.3Gi
Swap:          2.0Gi          0B       2.0Gi
```

The first reaction many people have is "15G of memory with only 1.2G free, it is almost full" — this is the classic case of reading the wrong column. The columns mean:

| Column | Meaning | How to use it |
|----|------|----------|
| total | total physical memory | the base for capacity planning |
| used | pages already occupied by processes/kernel (excluding reclaimable page cache) | a rough read of occupancy |
| free | pages that are **completely idle and on no LRU list** | reference only; low does not mean danger |
| shared | shared pages such as tmpfs/shared memory | check whether `/dev/shm` is ballooning |
| buff/cache | page cache and block device buffers, **reclaimable on demand** | a healthy system should be "full" |
| available | the kernel's estimate of memory **able to start a new process** ≈ free + reclaimable cache − low-watermark reserve | **this is the column to judge whether there is enough memory** |

### 1.2 Why the Kernel Does Not Keep Memory as free

Turning idle memory into disk page cache lets repeated file reads hit memory, and this is one of the cornerstones of Linux performance. The cache is only reclaimed when a process actually requests memory — so on a long-running server, a low `free` and a high `buff/cache` is **by design**, not a leak. `available` (mapped to `MemAvailable` in `/proc/meminfo`) is the estimate the kernel does for you: how much of that cache can become usable memory immediately.

Older versions of `free` printed a `-/+ buffers/cache:` line giving "used/free after subtracting cache"; the newer procps expresses the same idea directly with the `available` column. Therefore:

- **Is there enough**: look at `available`; only worry once it drops below the safety watermark you leave for your business (such as 10%–15% of total).
- **Is there a leak**: watch the trend of `used` and specific processes' RSS, rather than fretting about whether `free` hits zero.
- **Containers/VMs**: the host's `free` is the whole-machine view; inside a container look at the cgroup's `memory.max`/`memory.current` (`/sys/fs/cgroup/`).

Common `free` options: `-h` human-readable, `-m`/`-g` set the unit, `-s 2` refresh every 2 seconds, `-t` adds a swap total row. For a more professional way to watch memory pressure continuously, use `vmstat 1` to look at `si/so`, or `sar -r` for history, see [Monitoring Tools](./monitoring.md).

### 1.3 /proc/meminfo — When You Need Finer Detail

```bash
$ grep -E 'MemTotal|MemAvailable|Cached|Dirty|SwapTotal|SwapFree' /proc/meminfo
MemTotal:       15769904 kB
MemAvailable:    6553600 kB
Cached:         4200448 kB
Dirty:             1024 kB
SwapTotal:       2097148 kB
SwapFree:        2097148 kB
```

`Dirty` is data waiting to be written back to disk; a continuous surge means writes cannot keep up (network disk copies, database flushing). `CommitLimit`/`Committed_AS` relate to the overcommit policy and only warrant deep study in virtualization and large-memory scenarios. For daily work, `free` plus per-process RSS is still the primary tool.

## 2. Per-Process Memory: pmap, smaps, and RSS

When the whole machine is fine but a single process keeps getting fatter, drill into the process's address space:

```bash
$ pmap -x 2041 | tail -5
2041:   mysqld
Address           Kbytes   RSS   Dirty Mode  Mapping
...
 total kB        12500000 1843200  812000

$ ps -o pid,rss,vsz,cmd -p 2041
    PID    RSS     VSZ CMD
   2041 1800000 12500000 mysqld

$ cat /proc/2041/smaps_rollup
Rss:            1800000 kB
Pss:            1100000 kB
Swap:                 0 kB
```

How to read it: **VSZ is the virtual address space** (including mappings not actually occupied), **RSS is the resident physical pages**; use RSS when talking about "how much memory a process uses". `Pss` (proportional set size) splits shared libraries across the processes sharing them, so when many processes share glibc, Pss better reflects the "exclusive cost". `smaps_rollup` is the summary version of `smaps`; `smaps` can be tens of thousands of lines per segment, so read the rollup first.

## 3. swap: How to Read Usage

### 3.1 Check the Current State First

```bash
$ swapon --show
NAME       TYPE      SIZE USED PRIO
/swapfile  file      2.0G   0B   -2

$ free -h
...
Swap:          2.0Gi          0B       2.0Gi
```

**swap usage = used / total** (0% in the example above). How to judge "abnormal":

1. **used stays 0 and available is ample**: healthy, no problem.
2. **used is non-zero but stable (such as 50M–300M used of 2G) and `vmstat`'s si/so is near 0**: normal. Under the default swappiness, the kernel actively swaps out **cold pages** to free memory for cache — this is optimization, not a fault.
3. **si/so persistently above 0, available keeps dropping, the system feels laggy**: it is **thrashing**, which is real pressure.
4. **swap 100% full + available extremely low**: OOM is about to trigger, see section 5.

Judging si/so:

```bash
$ vmstat 1 5
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
  r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
  1  0      0 120000  50000 600000    0    0    10    20  200  400  2  1 97  0  0
```

`si` (swap in) / `so` (swap out) are in KB per second. The first row is the **average since boot**, and only from the second row onward do you get the real instantaneous values for the sampling interval — drawing conclusions from the first row is the most common misread.

### 3.2 Creating and Persisting swap

A memory-tight machine can add a swap file (the partition approach is similar, omitted):

```bash
sudo fallocate -l 4G /swapfile     # or dd if=/dev/zero of=/swapfile bs=1M count=4096
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

`chmod 600` is not optional — a swapfile with too-open permissions will be refused outright by `swapon` (a security restriction). Persist it in `/etc/fstab`:

```text
/swapfile none swap sw 0 0
```

Before rebooting, confirm with `swapon --show`, or verify the mount with `findmnt -rn -S /swapfile`. To turn it off temporarily use `swapoff /swapfile` (this reads the swapped-out pages back into memory, and **when memory cannot fit them, swapoff can trigger OOM** — check available first).

### 3.3 swappiness Is Not a "Disable swap" Switch

```bash
$ cat /proc/sys/vm/swappiness
60
$ sudo sysctl vm.swappiness=10
```

swappiness ranges from 0 to 200 (most distro docs describe it as 0 to 100). The larger the value, the more **aggressive** the kernel is about swapping out anonymous pages and leaning swap in reclaim; the smaller, the more it leans toward reclaiming only page cache. Three clarifications:

1. **swappiness=0 does not mean never swap**. Modern kernels still swap out when idle memory is extremely low, just with a harsher threshold; to "protect critical workloads from being swapped" rely on mlock/cgroups, not on 0.
2. **The default 60 is a compromise**. Desktop/server 10 to 60 is generally fine; latency-sensitive services such as databases often drop to 10 to observe, but **make sure physical memory has headroom first**, otherwise you are only postponing the thrashing.
3. **A change only counts if persisted**, see the sysctl paths in the next section; a bare `sysctl -w` is lost on reboot.

The sibling parameter `vm.vfs_cache_pressure` controls how aggressively the kernel reclaims dentry/inode cache, default 100; when a directory of small files puts metadata pressure on, you can lower it slightly (such as 50) so the directory cache stays longer — provided memory is not under pressure.

## 4. Kernel Parameter Persistence: Three-Family sysctl Path Differences

### 4.1 A Two-Layer Effect Model

Kernel parameters (sysctl) have two layers:

- **Runtime**: `sysctl -w vm.swappiness=10` or `sysctl vm.swappiness=10`, takes effect immediately and is lost on reboot.
- **Persistent**: write to a config file, loaded at boot by **systemd-sysctl.service**.

All three families load from the same directory at boot: **`/etc/sysctl.d/*.conf`** (plus the distro's own `/usr/lib/sysctl.d/`, where `/etc` overrides same-named files in `/usr`). Recommend one file per topic, for easier RPM/DEB package management and diffing:

```bash
# /etc/sysctl.d/99-memory-tuning.conf
vm.swappiness=10
vm.vfs_cache_pressure=50
```

Loading and verification:

```bash
$ sudo sysctl --system | grep swappiness     # list the merged result by priority
$ sudo sysctl -p /etc/sysctl.d/99-memory-tuning.conf   # trial-load a specific file immediately
$ sudo reboot                                  # or reboot then re-check with sysctl vm.swappiness
```

### 4.2 Three-Family Path Convention Comparison

| Item | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Recommended persistence location | `/etc/sysctl.d/*.conf` | `/etc/sysctl.d/*.conf` (Wiki recommended) | `/etc/sysctl.d/*.conf` |
| Legacy entry `/etc/sysctl.conf` | still present; `sysctl -p` reads it by default | generally not used, prefer `.d` | heavy legacy baggage, common in old material |
| Bare `sysctl -p` | reads `/etc/sysctl.conf` | same as left | same as left |
| Boot loader | systemd-sysctl | systemd-sysctl | systemd-sysctl |

**Gotcha**: much old material writes `echo "vm.swappiness=10" >> /etc/sysctl.conf`. On a system that only honors `/etc/sysctl.d/`, that line **will not take effect at boot**, and the parameter reverts after reboot. The safe approach is to write `/etc/sysctl.d/99-*.conf` uniformly and confirm with `sysctl --system` that it appears in the output. Security-hardening parameters (`kernel.kptr_restrict`, `net.ipv4.tcp_syncookies`, etc.) follow the same rule, see [Security Hardening](../../security/hardening.md).

### 4.3 drop_caches: Usable, But Not a Daily Operation

```bash
sync
sudo sh -c 'echo 1 > /proc/sys/vm/drop_caches'   # page cache
sudo sh -c 'echo 2 > /proc/sys/vm/drop_caches'   # dentry/inode
sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'   # both
```

It drops only **clean** cache and cannot reclaim dirty pages; run `sync` first for it to have any effect. Its use is limited to unifying a cold cache before a benchmark, or verifying "how much the cache is taking up". Do **not** write a cron job to drop caches periodically in production — after clearing the cache the next round of IO all hits source, business gets mysteriously slower, and memory fills up with cache again shortly after, so it is like paying money to buy jitter. If you really feel memory is short, either add a stick or find out who is holding `used`.

## 5. OOM Killer: The Kernel's Last Resort When Memory Is Exhausted

### 5.1 Why It Triggers

When a process requests memory, the kernel tries reclaiming page cache, compression (zram), and swap in turn; if all fail, the allocation fails. If a **global** request has nowhere to go, the kernel's OOM Killer steps in: it picks the process it considers "most deserving of death" by score and sends `SIGKILL` to free space and keep the system alive — the design philosophy is "sacrifice one to save the whole machine".

Note the distinction from cgroup OOM: when a container/systemd unit hits its `memory.max` ceiling, what dies is a process **inside that cgroup**, not necessarily the global OOM Killer.

### 5.2 How to Confirm It Happened

```bash
$ dmesg -T | grep -i -E 'out of memory|oom-kill'
[Thu Sep 18 03:12:44 2026] oom-kill:constraint=CONSTRAINT_NONE,...
[Thu Sep 18 03:12:44 2026] Out of memory: Killed process 3021 (java) total-vm:8043120kB, anon-rss:4096000kB ...

$ journalctl -k --since "3 days ago" | grep -i 'out of memory'
```

The log explicitly names the killed process and its PID. To dig through history you can also use `journalctl -k | grep -i oom`. The process that gets killed is often not the one with the "worst name", but the one with **large RSS and a high oom_score** — Java and Python data processes often get the blame even when they are not the root cause (the root cause may be another process's burst leak that ate up global memory).

### 5.3 oom_score and oom_score_adj

```bash
$ cat /proc/3021/oom_score
1023
$ cat /proc/3021/oom_score_adj
0
```

`oom_score` rises with memory consumption; `oom_score_adj` (-1000 to 1000) is an administrator bias: -1000 means "never kill under any circumstance" (kernel daemons, critical management processes), positive means "kill preferentially". Tuning:

```bash
echo -1000 | sudo tee /proc/$PID/oom_score_adj          # temporary
# or write OOMScoreAdjust=-1000 in a systemd unit, persisted with the service
```

**Use with restraint**: if you set every important service to -1000, at OOM the kernel can only kill a smaller process or let the allocation fail entirely, and the system may hang overall. The correct approach is to first solve the problem of where the memory went (leak? capacity? swap policy?), and use the bias only for the very few processes that are "worse dead than alive" (such as a database master-node management agent). `panic_on_oom` (reboot/panic at OOM) suits only specific high-availability cluster strategies; do not turn it on for ordinary servers.

### 5.4 A Checklist of Mitigation Ideas

1. Use `ps aux --sort=-rss | head` to find the big RSS consumers and confirm whether it is a business peak or a leak (watch the trend with `pidstat -r` or periodic `free -m` sampling).
2. Check whether swap is disabled or too small — a machine with no swap at all OOMs earlier and more suddenly at peak.
3. Application-level rate limiting/cache ceilings (database `innodb_buffer_pool_size`, JVM `-Xmx`) — **setting the JVM heap larger than the cgroup ceiling** is the number one cause of container OOM.
4. systemd services can set `MemoryMax=` to confine the blast radius inside the unit, avoiding taking down the whole machine.
5. Make sure you are not misreading `available` as "there is still lots of free" and keep applying pressure.

## 6. Memory Leaks and Performance Analysis Tools

### 6.1 valgrind — User-Space Leak Detection

When you suspect a program **you wrote** is leaking, use valgrind instrumentation (it slows things down significantly, so do not point it straight at a production hot path):

```bash
# install on all three families
sudo apt install valgrind    # Debian/Ubuntu
sudo pacman -S valgrind      # Arch
sudo dnf install valgrind    # RHEL/CentOS/Rocky

$ valgrind --leak-check=full --show-reachable=yes ./myprog
==1234== LEAK SUMMARY:
==1234==   definitely lost: 1,024 bytes in 4 blocks
```

`definitely lost` is what is worth chasing most; `still reachable` means the program still holds it before exit, which may be an intentional global cache. The call stacks in the output point straight to source lines (compile with `-g`).

### 6.2 perf — Cache and Page Fault Hotspots

```bash
# install on all three families (Debian picks the tools package by kernel version)
sudo apt install linux-tools-common linux-tools-$(uname -r)   # Debian/Ubuntu
sudo pacman -S perf                                           # Arch
sudo dnf install perf                                         # RHEL/CentOS/Rocky

$ perf stat -e cache-misses,cache-references,page-faults ./myprog
$ perf record -g ./myprog && perf report
```

`perf stat` is good for comparing "cache hit rate before and after a parameter change"; `perf record/report` shows which functions time is spent in. Inside containers, perf is often restricted by `perf_event_paranoid` and needs root or tuning that sysctl.

### 6.3 bpftrace — Dynamic Tracing (Advanced)

For dynamic questions like "who is allocating memory and which code path burns the most pages", the eBPF toolchain fits production better than valgrind/perf (low overhead, no recompile needed). Install on the three families:

```bash
sudo apt install bpftrace     # Debian/Ubuntu (needs a newer kernel)
sudo pacman -S bpftrace       # Arch
sudo dnf install bpftrace     # RHEL/CentOS/Rocky
```

Minimal example (counting syscall occurrences, run as root):

```bash
$ sudo bpftrace -e 'tracepoint:syscalls:sys_enter_* { @[comm] = count(); }'
```

The kernel needs BPF-related config enabled (available by default on mainstream distros); the Arch Wiki and the bpftrace manual have more one-liners. This page only requires **knowing how to install it and what class of problem it solves**; go deeper via the references.

### 6.4 mtrace — glibc-Level Tracing

For programs using glibc malloc, you can also set `MALLOC_TRACE=/tmp/mtrace.log` at runtime and then analyze with `mtrace prog /tmp/mtrace.log` (the program needs to be compiled with support such as `-gm32`). In practice, valgrind has higher coverage, so mtrace is good to know about.

## 7. Three-Family Comparison

| Item | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Package for free/ps | procps | procps-ng | procps-ng |
| Default swappiness | 60 | 60 | 60 (RHEL family docs also say 60) |
| sysctl persistence | `/etc/sysctl.d/*.conf` | `/etc/sysctl.d/*.conf` | `/etc/sysctl.d/*.conf` (plus legacy `/etc/sysctl.conf`) |
| valgrind | `apt install valgrind` | `pacman -S valgrind` | `dnf install valgrind` |
| perf | `linux-tools-$(uname -r)` | `pacman -S perf` | `dnf install perf` |
| bpftrace | `apt install bpftrace` | `pacman -S bpftrace` | `dnf install bpftrace` |
| zram/swap file | tools and docs in `zram-tools`/wiki | Arch Wiki has a full zram solution | `dnf install zram-generator` (RHEL 9 generation) |

The "install" columns above are the minimal three-family comparison: same capability, different front ends. Switching distros, run `cat /etc/os-release` first and then pick the package manager. Arch users should keep the system upgraded before installing the above packages, to avoid dependency library mismatches from a partial upgrade.

## 8. Common Gotchas

1. **Low `free` column in `free` means out of memory**. Read `available`; `buff/cache` is a reclaimable accelerator.
2. **Panic the moment swap is used**. Swapping out cold pages is normal; watch whether si/so stay non-zero and whether available is dropping, rather than whether used is 0.
3. **swappiness=0 as a silver bullet against swapping**. Under extreme memory pressure it still swaps; for critical memory use mlock/cgroups.
4. **Appending to `/etc/sysctl.conf` then finding it did not take effect after reboot**. Write `/etc/sysctl.d/99-*.conf` uniformly and verify with `sysctl --system`.
5. **Periodic drop_caches to "clean memory"**. It only creates IO spikes, and memory fills up with cache again right after.
6. **Blaming only the killed process at OOM**. What got killed was the "scapegoat" with the high oom_score at that moment; trace back who ate up global memory (`dmesg` + post-hoc `journalctl` + monitoring curves).
7. **Running swapoff when available is extremely low**. It tries to read all of swap back into memory and directly induces OOM; expand capacity or stop the business first.
8. **Reporting VSZ as memory usage**. VSZ includes huge virtual mappings; report with RSS/Pss.
9. **A container OOM Killer that only reads host dmesg**. cgroup OOM appears in container logs and the cgroup records in `journalctl`; first confirm whether `memory.max` and the JVM `-Xmx` are fighting each other.

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - Memory and swap management - [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0610hardware.php)
- Arch Wiki - Memory management / Swap / OOM Killer - [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- Arch Wiki - Sysctl - [wiki.archlinux.org](https://wiki.archlinux.org/title/Sysctl)
- kernel.org - cgroup v1/v2 and OOM documentation - [kernel.org](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
- proc(5) /proc/meminfo - [man7.org](https://man7.org/linux/man-pages/man5/procfs.5.html)
- `man free`, `man vmstat`, `man sysctl`, `man swapon`, `man pmap`
- bpftrace reference guide - [github.com/bpftrace/bpftrace](https://github.com/bpftrace/bpftrace)
- valgrind manual - [valgrind.org](https://valgrind.org/docs/manual/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/commands/README.md)
- [system](/commands/system.md)
- [configuration-management](configuration-management.md)
- [monitoring](monitoring.md)
- [process](process.md)
- [system_info](system_info.md)
- [memory](/hardware/memory.md)
- [performance](/system-management/performance.md)
