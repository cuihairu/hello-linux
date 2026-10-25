# CPU

The CPU is the first scene of every performance problem: when a machine "got slower," the first place to look is here -- is the frequency being held down, are tasks all squeezed onto one core, is this machine a VM, do the flags support the software you want to run. This chapter covers the CPU's internal structure, topology, flags, frequency management, and virtualization capability, along with how to observe and adjust them under Linux. By the end you can use these notes to break vague symptoms like "CPU usage is high/low but it is just slow" into specific, verifiable hypotheses.

> Content is drawn from Intel/AMD official manuals, the Arch Wiki, and the Linux kernel documentation; see the references at the end.

## What This Chapter Covers

- CPU internal structure and hyperthreading
- How to read the flags in `/proc/cpuinfo`
- How frequency scaling and throttling work
- The check path for hardware virtualization (`vmx`/`svm` -> `/dev/kvm`), and a first look at NUMA
- Classic traps where "the numbers themselves can lie" (`nproc` vs cgroups, VMs without cpufreq)

## 1. CPU Internal Structure

### 1.1 Core Components

```text
┌─────────────────────────────────────────────┐
│                    CPU                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Core 0   │  │ Core 1   │  │ Core N   │   │
│  │ ALU+Ctrl │  │ ALU+Ctrl │  │ ALU+Ctrl │   │
│  │  L1d/L1i │  │  L1d/L1i │  │  L1d/L1i │   │
│  │    L2    │  │    L2    │  │    L2    │   │
│  └──────────┘  └──────────┘  └──────────┘   │
│               ┌──────────┐                  │
│               │L3(shared)│                  │
│               └──────────┘                  │
│  ┌───────────────┐   ┌──────────────┐       │
│  │  Memory Ctrl │   │ PCIe Ctrl   │       │
│  └───────────────┘   └──────────────┘       │
└─────────────────────────────────────────────┘
```

| Component | Function | Troubleshooting significance |
|------|------|---------|
| ALU + Control Unit | Executes operations, decodes instructions | The source of `us` time |
| Register file | High-speed data storage | The snapshot at a crash site (core dump) |
| L1/L2/L3 cache | Reduces memory access latency | Cache-line contention slows multithreaded programs |
| Memory controller | Manages memory reads/writes | Integrated into modern CPUs; the root of NUMA |
| PCIe controller | Manages high-speed devices | Where NICs/NVMe attach; see [the Architecture chapter](./architecture.md) |

### 1.2 Pipelining, Superscalar, and What They Mean Here

**Pipelining** splits instruction execution into overlapping stages, and a **superscalar** design issues multiple instructions per cycle to different execution units; modern Intel/AMD CPUs run pipelines roughly ten to twenty-plus stages deep. For day-to-day operations these concepts only need to support one conclusion: **"busy" comes in several flavors** -- running user code (`us`), trapping into the kernel on behalf of a process (`sy`), waiting on I/O (`wa`), stolen by the hypervisor (`st`). When you see those columns in `mpstat` or `top`, what is underneath is the cost of the pipeline switching between instructions from different sources -- details in [System Management - Performance Tuning](../system-management/performance.md).

## 2. Core Topology: socket, core, thread

### 2.1 Physical Cores and Hyperthreading (SMT)

Each physical core is an independent compute unit with its own ALU, registers, and L1/L2 cache. Intel Hyper-Threading and AMD SMT let one physical core present two logical cores that share execution resources -- two logical cores are not two full cores; they **contend for the same execution units and L1/L2**.

Why topology deserves its own section: core pinning, license accounting (much commercial software charges by physical core, hyperthreads cost nothing extra), and performance attribution all depend on it. Planning task density around 16 `nproc` as if they were 16 physical cores is the classic mistake on a hyperthreaded machine.

```bash
lscpu | grep -E "^CPU\(s\)|Core\(s\)|Thread\(s\)|Socket\(s\)"
# CPU(s): 16              <-- logical CPUs (with hyperthreading); plan tasks on this
# Core(s) per socket: 8   Thread(s) per core: 2   <-- 2 = hyperthreading enabled
# Socket(s): 1            <-- physical CPU count (licensing, NUMA affinity)
nproc   # CPUs available to this process (may be affected by taskset/cgroup; see the gotchas in section 8)
```

### 2.2 Reading the lscpu -e Topology Table

`lscpu -e` flattens the ancestry of each logical CPU; it is the table to read before pinning cores:

```bash
$ lscpu -e | head -4
CPU NODE SOCKET CORE L1d:L1i:L2:L3 ONLINE
 0    0      0    0  0:0:0:0       yes
 2    0      0    0  0:0:0:0       yes   <-- same core as CPU 0 (hyperthread sibling)
```

The usage follows directly: CPU 0 and CPU 2 share L1/L2 and the execution units, so **do not put two single-core-saturating jobs on 0 and 2** -- that is using one physical core as if it were two. The pinning tools are `taskset` or `numactl` (see section 7 and [the Memory chapter - NUMA](./memory.md)). On multi-socket servers, also watch the `NODE` column: cross-NUMA-node memory access is slower; details in section 7.

## 3. The Cache Hierarchy and Cache Lines

### 3.1 Cache Levels

| Cache | Location | Latency | Typical capacity | Shared across |
|------|------|------|---------|---------|
| L1d | Inside the core | ~1 ns | 32-48 KB | Private to the core |
| L1i | Inside the core | ~1 ns | 32-64 KB | Private to the core |
| L2 | Inside the core | ~3 ns | 256 KB-2 MB | Private to the core |
| L3 | Shared between cores | ~10 ns | a few MB to tens of MB | Shared by cores in the same socket |

A cache miss has to go all the way to memory (~100 ns; see the storage hierarchy in [the Architecture chapter](./architecture.md)), two orders of magnitude slower -- that is the physical root of "memory-bound workloads are slow," and also why hyperthreads sharing L1/L2 interfere with each other.

### 3.2 Cache Lines and False Sharing

The cache reads and writes in units of **cache lines**, typically 64 bytes on x86-64. When two threads frequently write **different variables on the same cache line**, the line "ping-pongs" between cores and performance falls off a cliff -- this is called false sharing. It is the common hardware explanation for "fast single-threaded, slower with two threads"; locate it with `perf c2c`, fix it with padding/alignment (the industry norm is 64-byte padding). For now just remember the concept; when you hit a multithreaded performance anomaly, it is on the suspect list.

```bash
getconf LEVEL1_DCACHE_LINESIZE   # Cache line size; 64 is the common x86-64 output
lscpu -C                         # Capacity and type of each cache level
```

For the underlying raw data, sysfs's `index*/` directories (the `level`, `type`, `size` files) map directly to each cache level -- `lscpu -C` is essentially just pretty-printing those files; only when the two disagree do you need to go `cat` them one by one.

## 4. flags: The CPU Capability List

### 4.1 Why Operations People Must Be Able to Read flags

flags are the **capability list** the CPU announces to software; three classes of questions can be answered from flags alone:

1. **`illegal instruction`**: the binary uses instructions this machine lacks. Either it was compiled with too new a `-march`, or the distro baseline is too high -- for example **RHEL 9 requires x86-64-v2 and above** (SSE4.2, SSSE3, CMPXCHG16B, etc.), which pre-2010 CPUs cannot run; Arch's official repos have a looser baseline but AUR packages depend on the build machine.
2. **Virtualization unavailable**: without `vmx`/`svm` you cannot run KVM (see section 6).
3. **Security baseline**: flags like SMEP/SMAP/NX determine kernel hardening capability and are commonly checked in compliance audits.

### 4.2 Common flags Cheat Sheet

| flag | Meaning | Why you care |
|------|------|-------------|
| `lm` | Long mode (64-bit) | Without it this is not a 64-bit CPU |
| `sse4.2` / `ssse3` | SIMD extensions | Part of the x86-64-v2 baseline |
| `avx` / `avx2` | Advanced vector extensions | Scientific computing, compiler optimization, some crypto libraries |
| `avx512f` | AVX-512 foundation set | Only on servers/newer designs; older distro binaries do not rely on it |
| `aes` | AES-NI hardware crypto | Massive throughput difference for encrypt/decrypt; VPN/disk encryption depend on it |
| `vmx` | Intel VT-x hardware virtualization | The prerequisite for KVM on an Intel machine |
| `svm` | AMD-V hardware virtualization | The prerequisite for KVM on an AMD machine |
| `hypervisor` | Running under a hypervisor | Its presence = this is a VM; think oversubscription first when performance jitters |
| `smep` / `smap` | Restrictions on kernel executing/accessing user pages | Kernel security baseline |

```bash
# View the ISA extensions you care about; vmx = Intel VT-x, svm = AMD-V
grep -o -w "sse4_2\|avx2\|avx512f\|aes\|vmx\|svm" /proc/cpuinfo | sort -u
# vmx
# Spot a VM at a glance (hypervisor bit set = this is a VM)
grep -q "^flags.*hypervisor" /proc/cpuinfo && echo "VM" || echo "bare metal or not exposed"
```

The full flags list is very long per line; first narrow it with `grep "^flags" /proc/cpuinfo | head -1 | cut -c1-200`, and when you need the complete list, redirect it to a file and compare item by item. Note there is **no** flag named `vt-x`/`VT-x` in `/proc/cpuinfo` -- Intel's official marketing name is VT-x, but the flag is called `vmx`; grepping by the marketing name is guaranteed to come up empty.

> An earlier version of this document mislabeled the virtualization flag as `vt-x` -- corrected. **The rule: Intel is vmx, AMD is svm, marketing pages say VT-x/AMD-V, and `/proc/cpuinfo` only recognizes the first two.**

### 4.3 Fewer flags Inside a VM

A VM's flags are curated by the hypervisor and then passed through or emulated; typical differences: the `hypervisor` bit is set, some extensions are stripped, and `vmx`/`svm` are **not** passed through by default (nested virtualization is required to run KVM inside a VM). So "software that runs on the host reports illegal instruction in the VM" is a legitimate outcome -- comparing the flags output of the two machines confirms it; the host-side comparison entry point is section 7 of [the Architecture chapter](./architecture.md).

## 5. CPU Frequency Management and Throttling

### 5.1 Why a CPU "Gets Slower"

CPU frequency is not a constant. Approaching the thermal limit, power caps, battery mode, and power-saving policies all make it clock down; on a laptop that is normal thermal management, but it looks like "the code suddenly got slower." Recommended attribution order: check frequency first (this section), then scheduling (section 2 topology), and only then suspect the code. On servers it is the opposite -- a power policy stuck at a conservative level throws away benchmark and latency for nothing, which is why you set the governor to `performance` before going to production.

### 5.2 Frequency Scaling Policies (governor)

| Policy | Behavior | Good for |
|------|------|---------|
| `performance` | Lock at maximum frequency | Servers, latency-sensitive workloads |
| `powersave` | Bias toward minimum frequency | Power saving, thermally constrained environments |
| `ondemand` | Ramp up quickly with load | The traditional default, aggressive response |
| `schedutil` | Frequency driven directly by the scheduler | Kernel-recommended, cooperates with CFS/EAS |

```bash
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor            # Current policy
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors # Available policies
# performance / performance powersave schedutil (ondemand depends on the driver)
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq            # Current frequency in kHz
```

When you suspect "one core is being held at a low frequency and dragging everything down," read all the `cpu[0-9]*/cpufreq/scaling_cur_freq` values and compare (a `for` loop plus `paste` is enough); values far below `cpuinfo_max_freq` with a powersave/ondemand governor are direct evidence that throttling is in play.

### 5.3 Switching Policies with cpupower (Three-Family Install)

`cpupower` is the kernel's companion frontend for frequency scaling, and the three families install it under completely different package names -- it is the easiest tool on this page to mis-install:

```bash
# Install cpupower (different package names per family; the most mis-installed tool on this page)
sudo apt install linux-tools-common linux-tools-$(uname -r)   # Debian/Ubuntu
sudo pacman -S linux-tools                                    # Arch
sudo dnf install kernel-tools                                 # RHEL/CentOS/Rocky
# Switch policy (temporary, lost on reboot): performance for servers/load tests, powersave to save power
sudo cpupower frequency-set -g performance
sudo cpupower frequency-set -g powersave
```

Persistence has no unified home across the three families: on Debian/Ubuntu desktops it has historically been managed by `cpufrequtils`/system settings (newer releases hand it to the power-management components; verify against your desktop environment); **RHEL/CentOS/Rocky recommends `tuned`** (`sudo dnf install tuned`, then `sudo tuned-adm profile throughput-performance`; the profile bundles frequency and I/O settings); Arch users usually write their own systemd unit calling `cpupower frequency-set`, or use the `cpupower` service unit. Before changing settings in production, run `cpupower idle-info` to confirm the current state, and the day after, verify it stuck with `tuned-adm active` (RHEL) or by re-reading sysfs -- **a temporary setting lost on reboot is the most common "I tuned it but it didn't take."**

### 5.4 VMs May Not Have cpufreq at All

KVM/VMware guests usually do **not** expose the `cpufreq` subsystem -- the absence of `/sys/devices/system/cpu/cpu0/cpufreq/` is normal there; frequency is decided by the host and cannot be adjusted from inside the VM. Same for cloud hosts: the "frequency" you see is usually a host-side conversion. When troubleshooting performance in these environments, watching `steal` time (the `st` column of `mpstat`/`top`) is far more productive than tuning the governor.

## 6. Hardware Virtualization: vmx and svm

### 6.1 Checking the Prerequisites

KVM turns Linux into a Type-1 style hypervisor, on the condition that the CPU exposes hardware virtualization extensions: `vmx` (VT-x) on Intel, `svm` (AMD-V) on AMD. The check has three steps, all required:

```bash
grep -o -w "vmx\|svm" /proc/cpuinfo | sort -u   # Step 1: vmx (Intel) / svm (AMD)
# vmx
lsmod | grep -E "^kvm"       # Step 2: kvm_intel/kvm_amd loaded
ls -l /dev/kvm               # Step 3: device node exists; re-login after usermod -aG kvm
```

Only with all three green can `virsh`/`virt-manager` create VMs; when step 3 permissions fall short, virt-manager reports "connection failed" or opens extremely slowly -- **after adding the group you must log in again**; `newgrp` only affects the current shell. This is the most time-consuming flavor of "clearly installed but cannot connect."

### 6.2 Installing the Virtualization Stack (Comparison)

If you only want to verify capability, step 1's `grep vmx` is already enough; to actually create VMs, the three-family comparison is as follows (all with official repos): Debian/Ubuntu uses `sudo apt install qemu-kvm virt-manager`; Arch uses `sudo pacman -S qemu-desktop libvirt virt-manager`, plus `sudo systemctl enable --now libvirtd` (and `virtlogd`/`virtlockd`; the exact units depend on your libvirt version) -- **the enable-services step is the one most often skipped on Arch**; without it virt-manager's connection list is blank; RHEL/CentOS/Rocky uses `sudo dnf install qemu-kvm libvirt virt-manager`.

Nested virtualization (running KVM inside a VM) needs the kernel module parameter `nested=1` (`kvm_intel` on Intel, `kvm_amd` on AMD); whether a cloud host allows nesting is up to the vendor -- when unsure, read the host documentation first and do not assume it is on by default.

## 7. A First Look at NUMA

### 7.1 What NUMA Is

NUMA (Non-Uniform Memory Access) divides CPUs and memory into multiple nodes, where **accessing local-node memory is faster than accessing remote-node memory** -- it is the natural consequence of the memory controller moving into the CPU (section 1): each socket has its own memory channels, and cross-socket traffic goes over UPI/Infinity Fabric.

```text
┌─────────────────┐     ┌─────────────────┐
│   NUMA Node 0   │     │   NUMA Node 1   │
│  ┌─────┐ ┌────┐ │     │ ┌─────┐ ┌────┐  │
│  │CPU  │ │Mem │ │     │ │CPU  │ │Mem │  │
│  │0,1  │ │    │ │     │ │2,3  │ │    │  │
│  └─────┘ └────┘ │     │ └─────┘ └────┘  │
└────────┬────────┘     └────────┬────────┘
         │      UPI/IF          │
         └───────────┬───────────┘
```

A single-socket machine has only one node and everything is "local"; dual-socket and beyond is when you actually need to care. For memory-intensive workloads like databases, JVMs, and high-frequency trading, the extra cross-node latency lands directly in the P99.

```bash
numactl --hardware   # NUMA topology: node count, each node's CPUs and memory
numactl --cpunodebind=0 --membind=0 ./your_app   # Pin to node 0 (policies in the Memory chapter)
```

`numactl` installs under the same name on all three families: `apt install numactl`, `pacman -S numactl`, `dnf install numactl`. **The memory-allocation view of NUMA policy (local/interleave, reading `numastat`) is in [the Memory chapter - NUMA](./memory.md)** -- this section only builds the topology concept; the two pages together are the complete NUMA introduction.

## 8. Information Lookup Summary and Three-Family Tools

The daily triage command sequence is worth memorizing: `lscpu` for the big picture (topology, flags, Hypervisor) -> `lscpu -e` for pinning ancestry -> `lscpu -C` for cache details -> `cat /proc/cpuinfo` to go back to raw flags and check item by item -> `sudo dmidecode -t processor` only when you need firmware/physical inventory (inside a VM those are simulated values) -> add `numactl --hardware` on multi-socket machines -> `sensors` for temperature (only some motherboards expose CPU temperature, and `sudo sensors-detect` must run once first). These commands work identically on all three families; only the package names differ -- map them against the table below and [the hardware chapter overview table](./README.md):

| Aspect | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| `cpupower` package | `linux-tools-common` + `linux-tools-$(uname -r)` | `pacman -S linux-tools` | `dnf install kernel-tools` |
| Temperature tool `sensors` | `apt install lm-sensors` (hyphen) | `pacman -S lm_sensors` (underscore) | `dnf install lm_sensors` |
| Persistent tuning | Desktop power management / cpufrequtils (verify per environment) | Hand-rolled systemd unit calling cpupower | `tuned` (`tuned-adm profile`) |
| Virtualization group | `qemu-kvm` + libvirt | `pacman -S qemu-desktop libvirt` + enable libvirtd | `qemu-kvm` + `libvirt` |

When taking over an unfamiliar machine, run this first to grab the CPU-side key facts in one minute:

```bash
lscpu | grep -E "^CPU\(s\)|Model name|Core\(s\)|Thread\(s\)|Socket|Hypervisor"
command -v numactl >/dev/null && numactl --hardware   # Only useful multi-socket; single-socket reports 1 node
```

`lscpu` answers "how many cores, is this a VM"; pinning plans and attribution both start there (sections 2 and 4); `numactl --hardware` is only worth a close look when `Socket(s) > 1` -- on a single-socket box confirming one node and moving on is fine. For a field-by-field deep dive, come back to the corresponding section.

## 9. Common Gotchas

1. **Treating the marketing name as a flag.** `/proc/cpuinfo` has only `vmx`/`svm`, not `vt-x`/`VT-x`; grepping for VT-x is guaranteed to come up empty (see the correction in section 4.2).
2. **`nproc` and `lscpu`'s CPU(s) disagree, so the system must be broken.** `nproc` reflects the CPUs **available to the current process**: it shrinks under `taskset`/cpuset/container CPU pinning, while `lscpu` always shows the whole-machine topology. Conversely, a cgroup CPU quota (`cpu.max`, CFS quota) does **not** show up in `nproc` -- `nproc` reporting 16 inside a container does not mean you can saturate 16 cores; check the cgroup files for the quota.
3. **No `cpufreq` directory inside a VM, so the driver must be broken.** Most VMs do not emulate the frequency-scaling interface, which is normal (section 5.4); there is no governor to tune, and host-side jitter shows up as the VM's `steal` time.
4. **Adding the `kvm` group without logging in again, then reinstalling the software repeatedly.** Group membership refreshes at login; if `id` does not show the `kvm` group it has not taken effect yet (section 6.1).
5. **Scheduling tasks against 16 "cores" that are really 8 physical x 2 hyperthreads.** Plan compute-dense workloads by physical cores (`Core(s) x Socket(s)`) and treat hyperthreads as headroom, not capacity (section 2.1).
6. **Seeing fewer flags and declaring "the CPU is broken/downgraded."** First rule out: is it a VM (the `hypervisor` bit), did the BIOS disable AVX/virtualization (a common reason `vmx` disappears), did the container trim the `/proc/cpuinfo` view. All three are configuration differences, not hardware faults.

## References

- Patterson, D. A., & Hennessy, J. L., Computer Organization and Design: The Hardware/Software Interface
- Intel(R) 64 and IA-32 Architectures Software Developer Manuals -- [intel.com](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html)
- AMD64 Architecture Programmer's Manual -- [developer.amd.com](https://www.amd.com/en/support/tech-docs)
- Arch Wiki - CPU frequency scaling -- [wiki.archlinux.org](https://wiki.archlinux.org/title/CPU_frequency_scaling)
- Arch Wiki - KVM (vmx/svm and nested virtualization) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/KVM)
- Arch Wiki - NUMA -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- Red Hat - RHEL 9 hardware compatibility and the x86-64-v2 requirement -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/considerations_adopting_rhel-9/assembly_hardware-requirements_considerations-adopting-rhel-9)
- Linux Kernel Documentation - CPU scheduler utilization clamps / cpufreq -- [kernel.org](https://www.kernel.org/doc/html/latest/admin-guide/pm/cpufreq.html)
- cpupower(1) manual -- [man7.org](https://man.archlinux.org/man/cpupower-frequency-set.1)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [architecture](architecture.md)
- [memory](memory.md)
- [coverage-matrix](/research/coverage-matrix.md)
