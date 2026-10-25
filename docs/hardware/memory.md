# Memory

"Out of memory" is the most easily misjudged alert class: a small `free` column in `free` does not mean the box is about to die, a few MB of swap movement does not mean something big broke, and a process getting `Killed` is not necessarily caused by a shortage of physical memory. The memory page tackles exactly these three things — first understand how the kernel uses page tables to organize physical DRAM into the virtual memory a process sees, then learn to read the real meaning of `free`/`vmstat`, and only then move on to the advanced topics of Swap, huge pages, and NUMA. With the concepts right, alert numbers mean something; with them wrong, you will spin in needless panic on a perfectly calm machine.

> Content is drawn from Bird's Private Recipes (Lin's Linux Administration Guide), the Arch Wiki, JEDEC standards, and Linux kernel documentation; see the references at the end.

## What This Page Covers

- How DRAM refreshes and how it is organized
- Building a mental model of virtual memory and page tables, and telling apart page faults, swap, and OOM — three different things
- Reading every field of `free` and `vmstat` precisely
- Locating OOM Killer in logs and tuning `oom_score_adj`
- Configuring Swap and huge pages, and getting a working first view of NUMA memory allocation (topology concepts in [the CPU page](./cpu.md))

## 1. How Memory Works

### 1.1 DRAM Basics

DRAM (Dynamic Random-Access Memory) is the mainstream technology for computer main memory, and three properties decide all of its behavior: each bit lives in a **capacitor that leaks charge**, so it needs periodic **refresh**; reads are **destructive**, so every read must be written back; random access is fast (about 100 ns) but two orders of magnitude slower than SRAM cache (see the memory hierarchy in [the architecture page](./architecture.md)). Refreshing means DRAM carries a fixed background overhead, and it also means "a DIMM losing one bit" is an event that really happens — ECC exists for exactly this reason (section 5).

### 1.2 How a DIMM Is Organized

```text
┌─────────────────────────────────┐
│          DIMM (module)          │
│  ┌─────┐ ┌─────┐ ┌─────┐        │
│  │Rank0│ │Rank1│ │Rank2│        │
│  └──┬──┘ └──┬──┘ └──┬──┘        │
│  ┌──┴───────┴───────┴──┐        │
│  │  Memory chips (DRAM) │       │
│  └─────────────────────┘        │
└─────────────────────────────────┘
```

| Concept | Description | Why it matters for troubleshooting |
|------|------|---------|
| Rank | A group of chips on the DIMM working together | Wrong slotting downclocks the module; rank count affects compatibility |
| Bank | The storage arrays inside a chip | Depth relates to row hit rate; everyday ops need not dig deeper |
| Row/Column | Row and column addresses within a bank | Row activation overhead is part of latency |
| CL (CAS Latency) | Column strobe latency | Together with frequency it forms the "timings"; used for spec-sheet comparisons |

### 1.3 Reading DIMM Specs

```bash
# Firmware view: capacity, type, speed, ECC or not (needs root)
sudo dmidecode -t memory | grep -E "Size:|Type:|Speed:|Error Correction" | head -8
# Error Correction Type: Multi-bit ECC   ← common on servers; None = non-ECC
# Size: 16 GB / Type: DDR4 / Speed: 3200 MT/s
```

Hardware-level DIMM information belongs in this section; the software view of "how much the system has left" belongs in section 6 — the two are constantly conflated, and pulling them apart is the first job of this page.

## 2. DDR Generations and Bandwidth

### 2.1 Generation Comparison

| Parameter | DDR3 | DDR4 | DDR5 |
|------|------|------|------|
| Voltage | 1.5 V | 1.2 V | 1.1 V |
| Frequency range (MT/s) | 800-2133 | 2133-5333 | 4800-8400+ |
| Prefetch | 8n | 8n | 16n |
| Max capacity per module | 16 GB | 64 GB | 128 GB |
| Year introduced | 2007 | 2014 | 2020 |

Generations are **physically incompatible** (the notch sits in a different place); a module of the wrong generation simply will not seat — before buying memory, confirm the current generation with `dmidecode -t memory`. Watch the frequency unit: the "3200" on a memory label is really MT/s (millions of transfers per second); when converting to bandwidth, think of it as 3200×10⁶ transfers/s × 64 bit.

### 2.2 Bandwidth Calculation

```text
Theoretical bandwidth = effective rate × bus width × channels ÷ 8

DDR4-3200 dual channel:
= 3200 MT/s × 64 bit × 2 / 8
= 51.2 GB/s
```

What this means for ops: bandwidth-hungry workloads (big data shuffles, some database full-table scans) lose roughly half their bandwidth on a **single channel**. When upgrading memory, **slotting is deadlier than capacity** — two 8 GB modules in dual channel beat one 16 GB module in single channel, and on a four-slot board you must also follow the manual's priority slots (usually A2/B2 first; the manual is authoritative). To confirm the topology use `hwloc`'s `lstopo` (Debian/Ubuntu `apt install hwloc`, Arch `pacman -S hwloc`, RHEL `dnf install hwloc`; the install comparison is in section 10): on a machine without graphics, `lstopo-no-graphics` prints a text topology tree showing which cores and memory hang off each NUMA node — an intuitive tool for checking that "channels/nodes are as expected".

## 3. Virtual Memory and Page Tables

### 3.1 Why Virtual Memory Exists

In the von Neumann architecture instructions and data share the same memory (see [the architecture page](./architecture.md)), but a modern OS does not let processes touch physical addresses directly: each process gets its own **virtual address space**, and the kernel maintains the virtual-to-physical translation table — the **page table**. This layer brings three fundamental capabilities: process isolation (each process's page tables are invisible to the others), address relocation (a program need not care which physical memory it was loaded into), and sharing (many processes map the same shared library or file pages). ASLR, shared memory, `mmap`, core dumps — everything you see today is built on this translation layer.

### 3.2 Pages, Multi-Level Page Tables, and the TLB

On x86-64 the base page size is **4 KB**; a virtual address is split into multi-level indexes (the classic 4 levels, newer hardware can enable 5), and each level is consulted until a physical page is hit. To avoid storing a full mapping for every 4 KB, the kernel saves page-table space with multi-level tables plus on-demand population; hardware accelerates lookups with the **TLB** (translation lookaside buffer) — a TLB hit costs nearly zero, a miss must walk the multi-level tables (and may trigger a page fault).

**Page faults** therefore come in two kinds, corresponding to two fields in `vmstat` (section 6.2):

- **minor fault**: the page is actually already in memory (a shared library another process loaded, say); only the page-table entry needs filling. Cheap.
- **major fault**: the page is not in memory and must be read back from disk (swap or a file). Expensive — a common source of rising `wa` and laggy applications.

```bash
# Per-process virtual memory overview (page-table cost in VmPTE, resident set in VmRSS)
grep -E "VmSize|VmRSS|VmPTE|VmSwap" /proc/self/status
# VmSize: 13428 kB  ← total virtual address space (large ≠ physically resident)
# VmRSS:   3684 kB  ← actually resident in physical memory; judge usage by this
# VmPTE:     28 kB  ← the page tables' own footprint
```

To confirm whether the whole system is taking heavy page faults, watch how fast `pgmajfault` in `/proc/vmstat` grows — it answers "is the whole machine thrashing or just one process" faster than reading `status` process by process.

`VmSize` being far larger than physical memory is normal (the JVM reserving address space, `mmap` of a large file — neither occupies physical pages immediately). **Judge usage by `VmRSS` and `free`'s `available`, never by `VmSize`** — the first discipline of reading numbers through the virtual-memory lens.

### 3.3 The Overlay Layer: zRAM and Compression

Some distros and desktops put swap by default on a compressed block device in memory (zRAM) instead of a disk partition: swapped-out pages are compressed first, saving disk I/O at a CPU cost. Do not panic when `zram0` shows up in `swapon --show` — that is by design. It also adds a layer to interpreting "swap usage": heavy zRAM activity may just mean compression is doing its job, see section 7.

## 4. OOM Killer: Why the Kernel Kills Processes

### 4.1 Trigger Logic

When free pages drop below the watermark, reclaiming cannot keep up, and some process is still requesting memory, the kernel's **OOM Killer** (Out-Of-Memory) picks the process with the "highest score" and kills it to keep the system as a whole alive. The score blends RSS, runtime, `oom_score_adj`, and other factors — the result often looks "unreasonable": an innocent daemon dies while the memory-hungry JVM lives. Understanding this is what turns "a process vanished mysteriously" from a paranormal event into a log search.

Modern systems have a **second wall: cgroup limits**. In container and virtualized environments, physical memory may be plentiful yet processes still get killed — because the cgroup's `memory.max` tripped first (that is cgroup OOM, whose logs differ from a global OOM). When troubleshooting, first work out which wall you are standing under (section 4.3).

### 4.2 Locating It: Logs and Scores

```bash
# The standard log lines of a global OOM (dmesg and the journal share a source)
sudo dmesg -T | grep -iE "out of memory|oom-kill" | tail -5
# Out of memory: Killed process 21873 (java) ...
cat /proc/$(pidof java)/oom_score        # OOM score 0-1000; higher = more likely to be killed
# Protection: echo -500 > /proc/<pid>/oom_score_adj (range -1000 to 1000)
```

`oom_score_adj` is an emergency lever, not routine configuration: setting every critical service to -1000 concentrates the consequences of OOM onto "the one unlucky service you forgot to protect". The correct long-term fix is to **give services a memory cap** (cgroup/systemd `MemoryMax=`) so that overruns happen inside their own quota instead of a global OOM storm. Container scenarios in section 4.3; how the process-level observation tools (`pmap`, `smaps`) pair with the numbers in this section is covered in [Commands · Memory Management Commands](../commands/system/memory.md).

### 4.3 cgroup Limits: The "Fake OOM" Inside Containers

```bash
# cgroup v2: a container/process group's limit and current usage (max = unlimited)
cat /sys/fs/cgroup/<group>/memory.max
cat /sys/fs/cgroup/<group>/memory.current
systemctl show sshd -p MemoryMax   # a systemd service's limit comes from the unit's MemoryMax=
```

Host `free` looks perfectly fine + the process still gets Killed + `Memory cgroup out of memory` appears in the journal — that is the cgroup wall, not exhausted physical memory. This distinction is the watershed of memory troubleshooting in cloud-native environments: for the former you adjust the limit or fix the leak; only the latter calls for adding memory.

## 5. ECC Memory

ECC (Error-Correcting Code) memory detects and corrects single-bit errors and reports multi-bit errors. Standard on servers, usually absent on desktops — lacking ECC does not mean unusable; it only means silent bit flips from cosmic rays or aging may quietly corrupt data (database pages, keys held in memory), which is exactly why critical workloads insist on ECC.

| Type | Detection | Correction | Where it fits |
|------|------|------|---------|
| Non-ECC | none | none | ordinary desktops |
| ECC | yes | single bit | workstations / entry-level servers |
| Registered ECC (RDIMM) | yes | single bit | high-capacity servers (buffered, supports more modules stably) |

```bash
sudo dmidecode -t memory | grep -i "error correction" | head -1   # whether ECC is configured
cat /sys/devices/system/edac/mc/mc0/ce_count   # correctable error count (single bit, self-healed)
cat /sys/devices/system/edac/mc/mc0/ue_count   # uncorrectable error count (data corrupted, replace now)
```

Slow growth of `ce_count` suggests aging DIMMs and deserves a place in routine inspections; **a non-zero `ue_count` is a replace-now signal** — keeping it running means gambling with your data. VMs usually expose no EDAC nodes at all (error handling is the host's job), so do not misread "no edac" as "ECC not enabled"; check what `dmidecode` declares first.

## 6. Reading the Numbers: free and vmstat

### 6.1 free: available Is the Answer

```bash
$ free -h
               total        used        free      shared  buff/cache   available
Mem:            15Gi       8.2Gi       1.2Gi       512Mi       6.1Gi       6.3Gi
Swap:          2.0Gi          0B       2.0Gi
```

| Field | Meaning | How to use it |
|------|------|----------|
| total | total physical memory | the base for capacity planning |
| used | pages already held by processes/kernel | a rough read of occupancy |
| free | pages completely idle and on no reclaim list | **reference only**; low ≠ danger |
| shared | tmpfs/shared memory and the like | shows up here when `/dev/shm` balloons |
| buff/cache | page cache and block buffers, **reclaimable on demand** | a healthy system should "fill it up" |
| available | the kernel's estimate of memory able to start new processes ≈ free + reclaimable cache − reserve | **this is the column that answers "enough or not"** |

Linux spending idle memory on disk page cache is a performance cornerstone (see section 6 of [the architecture page](./architecture.md)); the cache only gives way when a process actually requests memory. So on a long-running machine, low `free` with high `buff/cache` is **by design**. There are only three rules of reading: whether there is enough — look at `available` (worry only once it drops below the safety watermark you reserve); whether there is a leak — watch the **trend** of `used` and per-process RSS; inside a container — ignore the host's `free` and read the cgroup's `memory.current` (section 4.3). The full `free` variants (`-s` refresh, `-t` totals) and per-process digging are in [Commands · Memory Management Commands](../commands/system/memory.md).

### 6.2 vmstat: Where the Pressure Comes From

`free` is a snapshot; `vmstat` is a **per-second dynamic ledger** that shows which way pressure is heading — above all whether paging is happening right now:

```bash
$ vmstat 1 3
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
 2  0      0 124508   2104 6230104    0    0    12    24  1830  3400  5  2 92  1  0
 1  0      0 118204   2104 6238108    0    0     0   116  1612  2985  8  3 89  0  0
```

| Section | Field | How to read it |
|------|------|------|
| procs | `r` | run queue length; persistently > CPU count = not enough CPU |
| procs | `b` | uninterruptible-sleep (D state) processes; stuck here usually means I/O waits, see [the storage page](./storage.md) |
| memory | `free/buff/cache` | same source as `free`; trends matter more than single points |
| swap | `si`/`so` | **KB read in from / written out to swap per second**; persistently non-zero = paging is happening, direct evidence of memory pressure |
| io | `bi`/`bo` | block device read/write throughput (KB/s); `so` and `bo` rising together suggests swap-out is hammering the disk |
| system | `in`/`cs` | interrupt and context-switch rates; for abnormal spikes see [the architecture page](./architecture.md) and the network page |
| cpu | `us sy id wa st` | user/system/idle/I/O wait/time stolen from the VM; high `st` = the host is oversold |

The reading rule: **look at `si/so` first, then `free`**. When `si/so` is 0, a low `free` is usually just cache giving way — no action needed; only a sustained climb in `si/so` means anonymous pages are being squeezed out — then combine with `available` to decide between lowering `swappiness` (section 7.3), fixing a leak, or adding memory outright. `r` and `wa` route your problem toward the CPU page and the storage page respectively, which makes `vmstat` the shared triage point across the three hardware pages.

## 7. Swap Management

### 7.1 What Swap Is and When You Need It

Swap is swap space on disk (or zRAM): when physical memory runs tight, the kernel moves inactive pages out to make room. It is a **pressure buffer**, not "second memory" — a workload betting its life on swap gets killed by latency first (disk is five orders of magnitude slower than memory). The traditional server rule of thumb follows; treat it as a starting point and let load testing and `si/so` observation have the final say:

| Physical memory | Suggested swap |
|---------|-----------|
| ≤ 2 GB | 1-2x memory |
| 2-8 GB | equal to memory, or 4 GB |
| 8-64 GB | 4-8 GB is enough |
| ≥ 64 GB | a small amount (a few GB) for emergency dumps, or per application needs |

### 7.2 Creating and Enabling

```bash
# Create a 4G swap file (the universal way; reliable on any filesystem)
sudo dd if=/dev/zero of=/swapfile bs=1M count=4096 status=progress
sudo chmod 600 /swapfile          # permissions must be tightened first; mkswap checks
sudo mkswap /swapfile && sudo swapon /swapfile && swapon --show

# Make it permanent: write /etc/fstab (use the absolute path, not a drifting /dev/sdX)
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo mount -a && swapon -a        # verify the fstab has no typos before rebooting
```

> **Do not preallocate a swapfile with `fallocate` on btrfs**: `swapon` refuses it over CoW/fragmentation/compression issues (`Invalid argument`) — on btrfs use the full `dd` write above (and confirm the prerequisites per the Arch Wiki: `NOCOW`, no subvolume compression, etc.). XFS swapfiles created with `fallocate` have also been refused on some versions; when unsure, standardize on `dd` — slower once, spares you one midnight firefight.

### 7.3 swappiness: Controlling the Swap-Out Urge

```bash
# View and set temporarily (0-100; 0 = swap out as little as possible, not the same as disabling swap)
cat /proc/sys/vm/swappiness        # default 60
sudo sysctl vm.swappiness=10
# Persist: write sysctl.d (same path on systemd distros of all three families)
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf
```

Two semantics that are easy to mix up: **`swappiness=0` does not mean swap is off** — under emergency watermarks the kernel may still swap out, and the only way to truly disable it is `swapoff` (make sure memory can hold everything first). Conversely, for workloads such as databases that manage their own page cache in memory, lowering it reduces the major-fault jitter caused by anonymous pages being swapped out needlessly. After changing, watch `si/so` with `vmstat 1` to verify the effect — do not change and walk away.

## 8. Huge Pages

With the default 4 KB pages, a huge memory working set crushes the TLB (every 2 MB costs 512 entries). **Huge Pages** use 2 MB (or 1 GB) pages to cut TLB entry counts, with clear gains for latency-sensitive workloads such as JVMs, databases, and DPDK — Redis/MongoDB `transparent_hugepage` tuning and the JVM's `-XX:+UseLargePages` are both built on this:

```bash
# View the current huge page config; Hugepagesize is commonly 2048 kB (2MB)
grep -i huge /proc/meminfo
echo 1024 | sudo tee /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages  # reserve 2GB
echo 'vm.nr_hugepages = 1024' | sudo tee /etc/sysctl.d/99-hugepages.conf     # persist
```

Two connected facts: reserved memory is **carved out of the available pool** — `free` shrinking after the change is normal accounting, not a leak; with transparent huge pages (THP) on by default, occasional "hiccup" latency jitter appears, and latency-sensitive services often disable THP outright in favor of explicit huge pages — whether to disable is up to your application's official documentation; when unsure, leave the global default alone.

The THP entry point lives in sysfs:

```bash
# View/switch THP temporarily: [always] madvise never (brackets mark the current value; reverts on reboot)
cat /sys/kernel/mm/transparent_hugepage/enabled
echo madvise | sudo tee /sys/kernel/mm/transparent_hugepage/enabled
# Persist: kernel parameter transparent_hugepage=madvise; explicit huge pages hugepages=1024 hugepagesz=2M
```

The division of labor: **THP** assembles 2 MB pages automatically — invisible to the app but it can jitter; **explicit huge pages** carve a pool at boot that the application actively uses (JVM `UseLargePages`). After changing, reconcile with `grep -i huge /proc/meminfo`.

## 9. Memory Allocation Under NUMA

The topology facts (how many nodes, how much CPU/memory per node) are in [the CPU page · NUMA](./cpu.md); this section answers the other half of the question from the memory side: **which node a process's pages land on**.

NUMA's basic policies are just three: **default** (local first, remote as fallback), **interleave** (round-robin across nodes to flatten bandwidth), and **bind** (lock to specified nodes). The default local policy is usually best; consider interleave/bind only when allocation is badly skewed (one node nearly full, another half empty) or for bandwidth-sensitive streaming workloads. Cross-node access latency is only in the hundreds of nanoseconds, but P99 on database-class workloads is very sensitive to it.

```bash
numastat                    # NUMA memory stats: look for signs of "high remote-hit ratio"
numastat -p <pid>           # single-process view
numactl --cpunodebind=0 --membind=0 ./db_server   # bind to node 0 (see the CPU page, section 7)
numactl --interleave=all ./db_server              # interleave at startup (defer to the application docs)
```

```bash
$ numactl --hardware
available: 2 nodes (0-1)   # a single-socket box reports 1 node; policies make no difference
node distances: 0: 10 21   # 10 = local; 21 = cross-node cost

$ numastat
            Node 0  Node 1
numa_hit   1284531  1198774   # hit this node
numa_miss       12        9   # spilled to the peer — only a sustained rise deserves attention
```

`numa_hit` far exceeding `numa_miss` is healthy; only a persistently rising `numa_miss` justifies considering `interleave`/`membind` — run it once before and once after the change to compare.

On a single-socket machine `numactl --hardware` reports just 1 node and these options make no practical difference — **confirm the topology before debating policy**, and spare yourself the exercise of copying a dual-socket server's tuning checklist onto a single-socket VM.

## 10. Three-Family Tool and Configuration Differences

| Aspect | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| `free`/`vmstat`/`swapon` | `procps` (preinstalled by default) | `pacman -S procps` (if missing) | `procps-ng` (preinstalled by default) |
| Historical sampling `sar` | `apt install sysstat` | `pacman -S sysstat` | `dnf install sysstat` |
| NUMA tools | `apt install numactl` | `pacman -S numactl` | `dnf install numactl` |
| Topology visualization | `apt install hwloc` | `pacman -S hwloc` | `dnf install hwloc` |
| Persistent kernel parameters | `/etc/sysctl.d/*.conf` | same as left (systemd) | same as left; `tuned` can manage memory-related profiles |
| ECC counter entry point | `/sys/.../edac/` (only with the hardware) | same as left | same as left + `edac-utils` optionally installed |

`sysctl` persistence is written the same way on all three families (`/etc/sysctl.d/`); the difference is only who owns the "official recommended profiles" — RHEL-family `tuned` ships profiles such as `virtual-guest`/`throughput-performance`, while Debian/Ubuntu/Arch usually manage it themselves. For a first tuning pass, write a single `sysctl.d` file so an `rm` rolls it back cleanly; do not keep appending history's garbage into `/etc/sysctl.conf` forever.

## 11. Common Gotchas

1. **Treating `free` as available memory.** The danger line is `available`; a machine with low `free`, high `buff/cache`, and `si/so` at 0 is perfectly healthy (section 6.1).
2. **Building swap with `fallocate`, and swap vanishing after reboot.** `swapon` errors out on a fallocate swapfile on CoW filesystems, and that fstab line fails silently at boot (section 7.2); standardize on `dd` and always test with `swapon -a` after writing.
3. **Reading `swappiness=0` as "never use swap".** It only means swap out as little as possible; `swapoff -a` is the actual disable. And if you change the sysctl but forget to write `sysctl.d`, a reboot returns it to the default 60 (section 7.3).
4. **Staring at the host's `free` when a container OOMs.** Check the cgroup's `memory.max`/`memory.current` and the cgroup OOM lines in the journal first; no amount of host memory stops a limit from killing the process (section 4.3).
5. **Reading a huge `VmSize` as a memory hog.** The JVM/browsers reserve address space without occupying physical pages; judge usage by `VmRSS` and the whole machine by `available` (section 3.2).
6. **Adding huge pages / disabling THP without verifying.** An `nr_hugepages` reservation directly reduces `free`, and if the application never configured `UseLargePages` that reservation is pure waste; after changing, reconcile with `grep -i huge /proc/meminfo` and check the application logs to confirm it really uses huge pages (section 8).
7. **Suspecting ECC is off because EDAC is missing inside a VM.** VMs usually do not pass EDAC counters through; trust the `dmidecode` declaration and the hypervisor configuration (section 5).

## References

- Bryant, R. E., & O'Hallaron, D. R., *Computer Systems: A Programmer's Perspective* (CSAPP), China Machine Press
- Bird's Private Recipes (Lin's Linux Administration Guide) - Physical memory and virtual memory — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0610hardware.php)
- Arch Wiki - Memory (including OOM and swap semantics) — [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- Arch Wiki - Btrfs swapfile caveats — [wiki.archlinux.org](https://wiki.archlinux.org/title/Btrfs#Swap_file)
- Arch Wiki - NUMA — [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- JEDEC DDR4 Standard — [jedec.org](https://www.jedec.org/standards-documents)
- JEDEC DDR5 Standard — [jedec.org](https://www.jedec.org/standards-documents/docs/jesd79-5)
- Linux Kernel Documentation - Memory Management — [kernel.org](https://www.kernel.org/doc/html/latest/mm/index.html)
- Linux Kernel Documentation - OOM Killer — [kernel.org](https://www.kernel.org/doc/html/latest/admin-guide/mm/concepts.html)
- Red Hat - RHEL 9 memory management and tuning — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/index)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [architecture](architecture.md)
- [cpu](cpu.md)
- [storage](storage.md)
- [README](/source/README.md)
