# Computer Architecture

Architecture is often skipped as "history class," but it is actually the map you use when troubleshooting: how the CPU "sees" a NIC, why a page fault stalls a process, how interrupts can saturate a single core -- the answers to all of these are drawn on the same picture. This chapter organizes the textbook concepts of the Von Neumann model, instruction execution, buses, and interrupts, and hangs each one on a Linux observation interface (`lscpu`, `dmidecode`, `/proc/interrupts`, `lspci`), laying the foundation for the later chapters on CPU, memory, storage, and other concrete hardware. After reading this chapter you can form a habit: when you see any hardware problem, first ask "which layer of the architecture is this on," then pick the command.

> Content is drawn from classic textbooks, Intel/AMD official manuals, and the Linux kernel documentation; see the references at the end.

## What This Chapter Covers

- Understanding the Von Neumann architecture, and how "stored program" maps to the per-process memory view under `/proc`
- The basic concepts of instruction execution and the instruction set architecture (ISA)
- The real topology of buses and PCIe on a modern machine
- How to classify interrupts and read `/proc/interrupts`
- `lscpu` and `dmidecode`, the two master hardware information entry points

## 1. Von Neumann Architecture and Linux

In 1945, John von Neumann proposed the "stored program" design: instructions are stored in memory just like data, and the CPU fetches and executes them in sequence. To this day it remains the foundation of almost every computer -- and precisely because of that, in Linux there is no natural boundary between "program" and "data" in memory, which directly shapes process isolation, the permission model, and a large set of security mechanisms.

### 1.1 The Five Components

```text
                     ┌──────────────┐
                     │ Control Unit │
                     │    (CU)      │
                     └──────┬───────┘
                            │
           ┌────────────────┼────────────────┐
           │                │                │
    ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐
    │     ALU     │  │   Memory    │  │     I/O     │
    │ (Arithmetic)│  │             │  │             │
    └─────────────┘  └─────────────┘  └─────────────┘
```

| Component | Function | What to observe in Linux |
|------|------|---------------------------|
| ALU (Arithmetic) | Performs arithmetic and logic operations | Model, frequency, flags reported by `lscpu` (vector units like AVX) |
| Control Unit | Coordinates components, decodes instructions | Instruction pointer, pipeline state (branch events in `perf`) |
| Memory | Stores programs and data | `free`, `/proc/meminfo`, page tables |
| Input devices | Feed data into the computer (keyboard, NIC, disk) | `/dev/input`, `/proc/interrupts` |
| Output devices | Deliver results to the outside (display, disk, NIC) | `/sys/block`, `ip -s link` |

Read this table row by row and you will see every later chapter in this book answers the same question: "for a given component's state, which Linux entry point do you look at."

### 1.2 Why the Stored-Program Principle Matters for Troubleshooting

The core idea is that program instructions and data both live in memory, and the CPU fetches and executes instructions from memory in order. This seemingly abstract principle has three direct consequences when troubleshooting:

1. **A program must be loaded into memory before it can run.** The binary and shared libraries on disk and the in-memory image at runtime are two different things. When a process crashes you look at the in-memory image (core dump, `/proc/<pid>/maps`), not the file on disk -- so "the file on disk is clearly the new one, but the process still behaves like the old one" usually means the process has not been restarted, or a shared library was loaded from a stale cache.
2. **Instructions and data share the same addressable memory, so isolation requires hardware plus the kernel.** Without isolation, one process could overwrite another process's instructions -- that is why the NX bit, SMEP/SMAP, and page-table permission bits exist, and it is the architectural root of features like "non-executable stack." These capabilities all surface as flags in `/proc/cpuinfo`; see [the CPU chapter](./cpu.md).
3. **Every step of "fetch-decode-execute" can fail, and failures show up as exceptions.** Page fault (vector 14), illegal instruction (vector 0), segmentation fault -- all are broken links in this chain. When you see `SIGSEGV`, you can use these records to confirm it maps to an address translation failure at the memory-access stage, rather than a vague "the program is buggy."

```bash
# Process memory layout: r-x segments are instructions, r--/rw- segments are data (visualization of the stored-program structure)
cat /proc/self/maps | head -2
```

## 2. Instruction Execution and Instruction Sets

### 2.1 The Classic Five-Stage Pipeline

A CPU executes an instruction in five stages: fetch, decode, execute, memory access, write back; pipelining overlaps multiple instructions, and superscalar design issues several instructions per cycle to different execution units. Modern CPU pipelines are actually far deeper than five stages (Intel/AMD typically run ten to twenty-plus), but the five-stage model is enough to explain the thing you most often ask while troubleshooting: **why a slow fetch or memory-access stage drags down the whole pipeline** -- fetch depends on the instruction cache, memory access depends on the data cache and main-memory latency, and the hierarchy of both is covered in section 6, foreshadowing the cache section of [the CPU chapter](./cpu.md).

| Stage | English | Function | What failure looks like |
|------|------|------|--------------|
| Fetch | Instruction Fetch (IF) | Read an instruction from memory | Instruction page not in memory -> page fault (major fault) |
| Decode | Instruction Decode (ID) | Parse the instruction | Unrecognized encoding -> `SIGILL` (illegal instruction) |
| Execute | Execute (EX) | ALU performs the operation | Divide by zero -> `SIGFPE` |
| Memory access | Memory Access (MEM) | Read/write memory data | Invalid address -> `SIGSEGV` |
| Write back | Write Back (WB) | Write result to a register | -- |

```bash
# View CPU model, ISA extensions, and architecture (flags explained in the CPU chapter)
lscpu | grep -E "Model name|Flags" | cut -c1-100
uname -m   # x86_64 = 64-bit x86; aarch64 = 64-bit ARM
```

### 2.2 Instruction Set Architecture (ISA): The Contract Between Software and Hardware

The instruction set architecture is the interface specification between software and hardware. Which ISA a piece of source code is compiled to decides which machines it can run on:

| Architecture | Representative vendors | Traits | Troubleshooting relevance |
|------|---------|------|-----------|
| x86/x86-64 | Intel, AMD | CISC, desktop/server mainstream | `uname -m` shows `x86_64`; 32-bit programs need multilib support |
| ARM | ARM Holdings | RISC, mobile/embedded/cloud (Graviton etc.) | `uname -m` shows `aarch64`; many x86 tools need different packages on ARM |
| RISC-V | Open source | RISC, emerging architecture | Mostly seen on dev boards; toolchain still maturing |

`uname -m` is the first command for determining the current machine's architecture: `x86_64` means 64-bit x86, `aarch64` means 64-bit ARM -- run it before copying binaries across architectures or looking up package names; it is more reliable than memorizing the "supported platforms" page in distro docs.

The practical significance of ISA for troubleshooting is that it explains a classic error: **`Illegal instruction`**. Its root cause is almost always "the binary uses instructions this CPU does not support" -- either the program was compiled on a newer machine (using AVX-512 that this machine lacks), or the distro's binary baseline is above this older machine (for example RHEL 9 requires x86-64-v2 and above, which pre-2010 CPUs cannot run). The way to confirm is to compare against the flags in `/proc/cpuinfo`; see [the CPU chapter - flags](./cpu.md).

## 3. Buses and PCIe: Why Devices "Go Missing"

A bus is the shared pathway that carries data between a computer's components. Understanding its evolution explains many of the "relics" you see in `lspci` output.

### 3.1 From Northbridge/Southbridge to the Modern Topology

```text
┌──────────┐    Memory channel (direct)    ┌──────────┐
│   CPU    │────────────────────────────────│  Memory  │
│ (int.MC) │                                └──────────┘
└─────┬────┘
      │UPI/QPI (multi-socket) or DMI (to chipset)
┌─────┴────┐
│  Chipset │──── SATA / USB / low-speed PCIe
└─────┬────┘
      │ PCIe root port
┌─────┴──────────────────────┐
│ PCIe devices: NVMe/NIC/GPU │
└────────────────────────────┘
```

The textbook model of "northbridge handles memory and graphics, southbridge handles slow peripherals" is the correct historical picture, but note the annotation in the diagram above -- **modern CPUs have integrated the memory controller and a large number of PCIe root ports on-die, and the northbridge has disappeared as a separate chip**. This changes two practical things about troubleshooting: memory bandwidth no longer passes through the "front-side bus" bottleneck (the FSB is gone); and on multi-socket servers, the CPU-to-CPU interconnect (Intel UPI / AMD Infinity Fabric) has become the new "bus," and is also what gave rise to NUMA (see [the CPU chapter](./cpu.md)).

| Bus type | Role | Bandwidth reference |
|---------|------|---------|
| Front-side bus (FSB) | CPU to chipset communication | Obsolete, only on old hardware |
| Memory bus | CPU to memory channels | DDR5-6400 dual channel roughly 102 GB/s (theoretical) |
| UPI / Infinity Fabric | Multi-socket CPU interconnect | Determines NUMA cross-node latency |
| PCIe | High-speed device interface | PCIe 5.0 x16 roughly 64 GB/s (bidirectional, before encoding overhead) |
| SATA | Storage device interface | SATA III caps at 6 Gbps (about 600 MB/s) |
| USB | General peripheral interface | USB 3.2 Gen2 x2 theoretical 20 Gbps |

### 3.2 Why PCIe Directly Affects Linux Troubleshooting

For operations work, PCIe is not a bandwidth number but three concrete things:

1. **Is the device there.** `lspci` listing the device means PCIe enumeration succeeded; if the card you want is simply not in the list, the problem is physical seating, slot power, or firmware (BIOS/passthrough config), and chasing drivers at that point is going the wrong way.
2. **Is the driver bound.** The same `lspci` entry with the `-k` flag shows `Kernel driver in use`. A device with no driver bound will not produce nodes like `/dev/nvme0` or `eth1` -- this is the standard path for "the card is plugged in but the system can't see it."
3. **Which path the device sits on.** PCIe devices participate in DMA through IOMMU mappings; virtualization passthrough (VFIO) and the NUMA affinity of NIC interrupts both depend on "which CPU/PCIe domain the device hangs off"; see [the CPU chapter](./cpu.md) and [the Network Devices chapter](./network.md) for the advanced material.

```bash
lspci -tv    # PCIe device tree (hierarchy and bandwidth x1/x4/x16)
lspci -k | grep -A3 -i ethernet   # Driver binding (first thing to check when troubleshooting)
# 03:00.0 Ethernet controller: Intel I350 Gigabit Network Connection
#         Kernel driver in use: igb   <-- this line missing = driver not loaded
lsusb        # USB bus
```

On all three distro families, `lspci` comes from `pciutils` and `lsusb` from `usbutils`, both preinstalled by default; if a minimal install stripped them: Debian/Ubuntu uses `apt install pciutils usbutils`, Arch uses `pacman -S pciutils usbutils`, RHEL/CentOS/Rocky uses `dnf install pciutils usbutils`.

## 4. Registers: The CPU's Workbench

Registers are the CPU's internal high-speed storage cells, first in the storage hierarchy (see section 6). For day-to-day troubleshooting you do not need to memorize every register, but two scenarios use them: the register snapshot in a core dump when a program crashes, and reconstructing the scene when locating a problem with GDB/`perf`.

### 4.1 x86-64 General-Purpose Registers (Cheat Sheet)

| Register | 64-bit name | Purpose |
|--------|---------|------|
| RAX | rax | Return value, accumulator |
| RBX | rbx | Base register |
| RCX | rcx | Counter |
| RDX | rdx | Data register |
| RSI | rsi | Source index register |
| RDI | rdi | Destination index register |
| RBP | rbp | Stack base pointer |
| RSP | rsp | Stack top pointer |
| R8-R15 | r8-r15 | Extended general-purpose registers |
| RIP | rip | Instruction pointer (program counter), points to the next instruction to execute |
| RFLAGS | rflags | Flags register (carry, zero, direction, etc.) |

The practical payoff of registers in daily troubleshooting is at the crash site: core dump plus `gdb`'s `info registers` (snapshot) and `bt` (backtrace) together are what let you pin a `SIGSEGV` to a specific instruction and call chain -- a single register value in isolation is of limited use; the backtrace is what makes it a conclusion. Compile with `-g` or you have no symbols to work with.

### 4.2 Segment Registers and 64-bit Mode

| Register | Purpose |
|--------|------|
| CS | Code segment |
| DS | Data segment |
| SS | Stack segment |
| ES/FS/GS | Extra data segments (in x86-64, FS/GS are commonly used for thread-local storage) |

> In 64-bit mode the role of segment registers has been greatly simplified: segment bases are mostly ignored and segmentation gives way to paging -- memory protection is really done by page tables; see [the Memory chapter](./memory.md).

## 5. Interrupts: How Hardware "Calls Out" to the CPU

Interrupts are how the CPU responds to external or internal events. Without them the CPU would have to poll devices -- and that is exactly the key to understanding "how a NIC can process a million packets per second without high CPU usage": the device notifies the CPU through an interrupt (and the later NAPI/poll hybrid), rather than the CPU repeatedly asking.

### 5.1 Three Categories of Events

| Type | Source | Examples | Where to observe |
|------|------|------|----------|
| Hardware IRQ | External hardware | NIC receives a packet, disk finishes I/O, timer | `/proc/interrupts` |
| Softirq | Kernel deferred bottom half | `NET_RX`/`NET_TX` (network receive/send), `TIMER`, `TASKLET` | `/proc/softirqs` |
| Exception | Triggered while the CPU executes an instruction | Divide-by-zero, page fault, illegal instruction | Kernel log, core dump |

> A note on terminology: everyday speech calls system calls "soft interrupts" too, but in Linux documentation **softirq specifically refers to the kernel's deferred execution mechanism** (the entries in `/proc/softirqs`), not vector 0x80. Distinguish them by context when reading docs; do not conflate the two "softs."

### 5.2 The Interrupt Handling Flow

Handling a hardware interrupt roughly goes: the CPU detects the interrupt signal -> saves the current execution state (registers, program counter) -> looks up the interrupt vector table for the handler entry -> jumps to the interrupt handler (complex work is often deferred into a softirq bottom half) -> restores the previous state and resumes the interrupted program. The operational takeaway: **interrupt handling itself consumes CPU time**. When a CPU's `us+sy` is high but you cannot find a user process to blame, open `/proc/interrupts` and check whether one device's interrupts are all piled on a single core -- multi-queue NICs and `irqbalance` exist precisely for this; see [the Network Devices chapter](./network.md).

```bash
grep -E "eth|nvme|timer|TLB" /proc/interrupts   # One column per CPU, check for skew
#            CPU0       CPU1       CPU2       CPU3
# 40:  152039452          0          0          0  IR-PCI-MSI-edge  nvme0q0
grep -E "NET_RX|TIMER" /proc/softirqs   # Softirqs (NET_RX spiking = receive pressure)
```

### 5.3 The Interrupt Vector Table

The interrupt vector table (and the IDT) stores the entry addresses of the various interrupt handlers. Linux's typical x86 allocation:

| Vector | Type | Notes |
|--------|------|------|
| 0 | Exception | Divide-by-zero |
| 13 | Exception | General protection fault |
| 14 | Exception | Page fault (the core of paging; see the Memory chapter) |
| 32-255 | Hardware IRQ | Programmable hardware interrupts are allocated from 32 up (0-31 reserved for exceptions) |
| 128 (0x80) | Legacy trap | The legacy **system call** entry on Linux x86 (modern x86-64 code mainly uses the `syscall` instruction) |

> 0x80 is the syscall trap triggered by software explicitly executing `int 0x80`; it is an event in the "soft interrupt/trap" sense, **not** the softirqs counted in `/proc/softirqs`, and not a hardware IRQ either. Keeping the three straight is what stops kernel logs and performance docs from blurring together.

## 6. The Memory Hierarchy and Linux's View of "Memory"

Storage forms a hierarchy by speed and capacity -- this is not a ladder you memorize for an exam, it is the theoretical basis for "why Linux deliberately refuses to leave memory free":

```text
        Speed ↑          Capacity ↓
        ┌──────────┐
        │ Registers │  ~1 ns       few hundred bytes
        ├──────────┤
        │    L1    │  ~1 ns       32-64 KB/core
        ├──────────┤
        │    L2    │  ~3 ns       256 KB-2 MB/core
        ├──────────┤
        │    L3    │  ~10 ns      few MB to tens of MB (shared)
        ├──────────┤
        │  Memory  │  ~100 ns     few GB to few TB
        ├──────────┤
        │    SSD   │  ~100 us     hundreds of GB to few TB
        ├──────────┤
        │    HDD   │  ~10 ms      few TB to tens of TB
        └──────────┘
```

| Level | Medium | Speed | Capacity | Cost/GB |
|------|------|------|------|---------|
| L1/L2 cache | SRAM | ~1-3 ns | a few hundred KB per core | Very high |
| L3 cache | SRAM | ~10 ns | a few MB to tens of MB | High |
| Main memory | DRAM | ~100 ns | a few GB to a few TB | Moderate |
| Solid-state drive | NAND Flash | ~100 us | hundreds of GB to a few TB | Low |
| Mechanical drive | Disk | ~10 ms | a few TB to tens of TB | Lowest |

Memory is about three orders of magnitude faster than an SSD, and an SSD about two orders faster than an HDD -- and precisely because the gap is so large, the kernel takes temporarily idle memory and turns it into **page cache**: repeated reads of the same file hit memory. That is why a long-running machine showing low `free` and high `buff/cache` is by design, not a leak; whether memory is enough is judged from the `available` column -- see [the Memory chapter](./memory.md). By the same token, data "written into" the filesystem has not necessarily reached the platters yet; write caching and flush policy are in [the Storage Devices chapter](./storage.md).

```bash
lscpu -C 2>/dev/null || lscpu | grep -i cache   # Cache size per level
free -h && lsblk -d -o NAME,SIZE,ROTA           # Memory and disk capacity, whether mechanical
# For advanced parameters like cache line size, ask libc directly with macros such as getconf LEVEL1_DCACHE_LINESIZE
```

## 7. In Practice: lscpu and dmidecode as the Two Master Entry Points

The map built by the previous six sections boils down operationally to two entry points: **`lscpu` answers "CPU and topology," `dmidecode` answers "this machine's physical inventory."** Run these two first in daily troubleshooting and nine out of ten "what kind of machine is this" questions are solved.

### 7.1 lscpu: The CPU-Side Entry Point

`lscpu` reads topology from `/proc/cpuinfo` and `/sys` and formats it into a table; it is the first entry point that needs no root:

```bash
$ lscpu | grep -E "^CPU\(s\)|Model name|Thread|Core|Socket|Hypervisor"
CPU(s):                   8
Model name:               Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz
Thread(s) per core:       2
Core(s) per socket:       4
Hypervisor vendor:        KVM   <-- has a value = VM; bare metal usually shows None
```

The most troubleshooting-relevant lines in the output are `Hypervisor vendor` (tells you bare metal vs VM, which directly changes how you attribute jitter) and `Thread(s) per core` (tells you whether hyperthreading is on, which affects core-pinning strategy). The full reading of topology and flags is in [the CPU chapter](./cpu.md).

### 7.2 dmidecode: The Physical Hardware Inventory

`dmidecode` reads hardware information from the BIOS/SMBIOS tables and can report memory module specs, motherboard model, chassis serial number, and other physical details `lscpu` cannot see. It **must run as root**, and the information comes from the firmware:

```bash
# Three-family install: apt install dmidecode / pacman -S dmidecode / dnf install dmidecode
sudo dmidecode -t memory | grep -E "Size|Speed|Type:" | head -8
sudo dmidecode -t baseboard   # Motherboard model; -t processor shows the CPU in the socket
```

When you need `lshw` for a more complete hardware tree: `apt install lshw`, `pacman -S lshw`, `dnf install lshw`, then `sudo lshw -short` for a one-page overview. ARM dev boards have no traditional BIOS; read the device tree instead: `ls /sys/firmware/devicetree/base/`.

## 8. Three-Family Differences at a Glance

The commands on this page work identically across the three families; the differences are only in package names and preinstall status:

| Scenario | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| `lscpu` | Preinstalled (`util-linux`) | Preinstalled | Preinstalled |
| `dmidecode` | `apt install dmidecode` | `pacman -S dmidecode` | `dnf install dmidecode` |
| `lshw` | `apt install lshw` | `pacman -S lshw` | `dnf install lshw` |
| `lspci`/`lsusb` | Preinstalled (may be missing on minimal installs) | `pacman -S pciutils usbutils` | `dnf install pciutils usbutils` |
| `sensors` | `apt install lm-sensors` (hyphen) | `pacman -S lm_sensors` (underscore) | `dnf install lm_sensors` |

Kernel interfaces (`/proc`, `/sys`) and output formats are the same across the three families; only package names differ -- the `lm-sensors`/`lm_sensors` hyphen-vs-underscore distinction is the most common trap. For the full base see [README - Three-Family Diagnostic Tool Overview](./README.md).

## 9. Common Gotchas

1. **What `dmidecode` reads inside a VM/cloud host is "fake" hardware.** Serial numbers and motherboard models are simulated or injected by the hypervisor; do not use them as procurement evidence. The memory module count may also not match what you ordered. Trust the hypervisor console or the cloud vendor's docs; in these environments `dmidecode` is only good for seeing "what spec the VM was configured as."
2. **`/proc/interrupts` and `/sys` inside a container are the host's namespace view.** The interrupt counters and PCIe devices you see inside the container belong to the host, not to your container's "hardware." Container-level resource limits live in cgroup (`/sys/fs/cgroup/`); do not troubleshoot host problems against the container's `lspci`.
3. **`lspci` prints nothing or a device is missing -- check enumeration before drivers.** The default VM machine type (e.g. i440fx) may simply not emulate the device you want; add it in the VM configuration. On physical machines, check the slot, power, and BIOS settings. `lspci` shows the device but no `Kernel driver in use` -- that is when it is a driver problem; see section 3.2.
4. **Copying x86 commands verbatim onto ARM machines.** When `uname -m` says `aarch64`, there is no `dmidecode` information source to read (use the device tree/`/sys/firmware` instead), and the register names in GDB are completely different. Run `uname -m` before any cross-architecture work.
5. **Treating "soft interrupt," 0x80, and hardware IRQ as the same thing.** Their observation entry points are `/proc/softirqs`, syscall tracing (`strace`), and `/proc/interrupts` respectively; mixing them up will send your conclusions completely off course (see the terminology note in section 5.1).
6. **Applying the old textbook's "northbridge/FSB" model directly to modern machines.** The memory controller has long been inside the CPU; conclusions from old hardware ("upgrade the northbridge for more bandwidth") do not hold on modern platforms. For bandwidth problems check channel count, DIMM placement, and NUMA -- see [the Memory chapter](./memory.md).

## References

- Patterson, D. A., & Hennessy, J. L., Computer Organization and Design: The Hardware/Software Interface (RISC-V edition), China Machine Press
- Bryant, R. E., & O'Hallaron, D. R., Computer Systems: A Programmer's Perspective (CSAPP), China Machine Press
- Bird's Private Recipes (Lin's Linux Administration Guide) - Getting to Know Computer Hardware -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0105computers.php)
- Arch Wiki - Hardware category -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Category:Hardware)
- Arch Wiki - dmidecode -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Category:Hardware)
- Intel(R) 64 and IA-32 Architectures Software Developer Manuals -- [intel.com](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html)
- AMD64 Architecture Programmer's Manual -- [developer.amd.com](https://www.amd.com/en/support/tech-docs)
- Linux Kernel Documentation -- [kernel.org](https://www.kernel.org/doc/html/latest/)
- dmidecode project homepage -- [git.kernel.org](https://git.kernel.org/pub/scm/utils/dmidecode/dmidecode.git)
- Wikipedia: Von Neumann architecture -- [en.wikipedia.org](https://en.wikipedia.org/wiki/Von_Neumann_architecture)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [README](README.md)
- [cpu](cpu.md)
- [desktop-stack](desktop-stack.md)
- [memory](memory.md)
- [storage](storage.md)
- [knowledge](/knowledge.md)
- [application-scenarios](/research/application-scenarios.md)
- [cross-compile](/source/cross-compile.md)
