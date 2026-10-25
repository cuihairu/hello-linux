# The Hardware Chapter

Many of the "mystical problems" I have hunted down ended up living in the machine itself: CPU throttling, overheating, or hyperthreading contention; page cache making the numbers in `free` look artificially low; SMART already reporting disk anomalies; a NIC link that negotiated down to half duplex. This chapter maps hardware state to the Linux observation interfaces -- the relevant `/proc`, `/sys` nodes and diagnostic commands.

The division of labor with [the Basics chapter](../basic/README.md) is this: the Basics chapter records filesystems, mounts, and permissions; this chapter records devices, slots, and interrupt paths. Storage and networking topics cross-reference each other; switch between them by troubleshooting scenario.

> This chapter primarily cross-references the **Debian/Ubuntu, Arch, and RHEL/CentOS/Rocky** distro families. Tool installation and behavior differences are noted with their family; Arch uses `pacman -S`. The three families share the same kernel interfaces (`/proc`, `/sys`, `lscpu`, `ethtool`); the differences are mainly in **package names** and **whether tools are preinstalled**.

## Why Operations Needs Hardware Knowledge

**First, fault isolation is a bottom-up, layer-by-layer elimination, and hardware is the foundation of every layer.** An application reports "request timeout"; you may check the code first, then the network, then the disk -- but if the disk SMART counters already show `Reallocated_Sector_Ct` climbing, all that software-layer triage was wasted time. Someone who does not know hardware keeps spinning in the software layers; someone who does will spend two minutes running `smartctl -H`, `sensors`, and `ethtool` to rule out the bottom layer before going up. Bird's Private Recipes (Lin's Linux Administration Guide) insists on "understand the principle before issuing the command" -- nowhere is that more literal than in the hardware chapter: every diagnostic command corresponds to a physical fact.

**Second, many "false faults" can only be read correctly with hardware context.** A low `free` column does not mean memory is running out; that is Linux taking idle memory and making it into page cache by design. High CPU usage does not mean the code is badly written; the scheduler may have stacked tasks onto a single SMT thread, or the power policy may be holding the frequency down. Sudden write slowdowns may mean the disk's write cache was turned off and it dropped into write-through mode. The numbers do not speak for themselves; hardware knowledge is the piece that adds context.

**Third, purchasing, scaling, and virtualization choices all presuppose hardware concepts.** Memory modules must go into the correct channels to form dual channel; the PCIe lane count decides how many NVMe drives and how many 10 GbE cards you can use at once; before enabling a KVM VM you must confirm the CPU exposes `vmx` (Intel) or `svm` (AMD). These decisions have no recourse -- buy the wrong thing, install it in the wrong slot, and no amount of software tuning will save it.

**Fourth, the cloud and virtualization era did not retire hardware knowledge; it just pushed it to the host side.** Your VM "mysteriously stutters" because the host is oversold or a noisy neighbor shows up (`steal` time rises); your container's memory "mysteriously gets killed" because of a cgroup limit, not a physical shortage. Being able to separate "guest problem" from "underlying hardware problem" also gives you evidence the cloud vendor cannot wave off when you file a ticket.

**Fifth, the security baseline is written into the CPU's flags.** SMEP, SMAP, NX, the virtualization flags, IOMMU capability -- these are both a performance topic and a security topic, and compliance checks often begin by confirming whether these capabilities are enabled. This chapter is the prerequisite knowledge for the "firmware and boot chain trust" section of the later [Security chapter](../security/README.md).

## Table of Contents

The five chapters are ordered "build the overall map first, then drill into each device class," each stage depending on the one before it:

| Stage | Chapter | Why it is here |
|------|------|----------------|
| 1. Build the overall map | [Computer Architecture](./architecture.md) | First learn what the big pieces of a machine are and how to use the two master entry points `lscpu`/`dmidecode`; every later chapter unfolds on this map |
| 2. The processor view | [CPU](./cpu.md) | The first scene of every performance problem: topology, flags, throttling, and virtualization capability all come from it |
| 3. The memory view | [Memory](./memory.md) | The second scene: virtual memory, OOM, `free` readings, NUMA -- the alarm type most easily misjudged |
| 4. Where data lands | [Storage Devices](./storage.md) | The only layer that can cause **irreversible data loss**; the block layer, SMART, and partition relationships must be mastered |
| 5. The connectivity foundation | [Network Devices](./network.md) | NICs, drivers, and links from the hardware side, complementing the protocol-stack view in the [Networking chapter](../network/README.md) |

When taking inventory of a machine, I check the physical and logical core counts, the virtualization state, the memory spec and ECC, which disk holds the root partition and its health, and the NIC driver and PCIe slot. The relevant commands and information entry points are consolidated in [Computer Architecture](./architecture.md).

## Reading the Subpages

| Chapter | One-line guide | What question to bring |
|------|-----------|---------------------|
| [Computer Architecture](./architecture.md) | Von Neumann, interrupts, why PCIe belongs on the troubleshooting map, the two master entry points `lscpu`/`dmidecode` | "How does the CPU see a device in the system?" |
| [CPU](./cpu.md) | Topology and hyperthreading, the real meaning of flags (`vmx`/`svm`), frequency throttling, hardware virtualization | "Why did the machine slow down? Can this box even run VMs?" |
| [Memory](./memory.md) | Virtual memory and page tables, the OOM Killer, `free`/`vmstat` readings, Swap and huge pages, NUMA basics | "Is there actually enough memory? Why was the process Killed?" |
| [Storage Devices](./storage.md) | The block layer and I/O path, HDD/SSD/NVMe, `lsblk`/`smartctl`, the stacked relationship of partitions and mounts | "What did the data go through on the way down? How long will this disk last?" |
| [Desktop Graphics Stack](./desktop-stack.md) | The layered path from kernel DRM/KMS to screen pixels, Xorg vs Wayland, drivers and fonts/input methods | "Why is the screen black after installing a desktop? Does a server even need a GUI?" |
| [Network Devices](./network.md) | NIC internals, driver binding, `ethtool`, interrupts and multi-queue, link negotiation | "What went wrong on the hardware before the packet even entered the stack?" |

The cross-references between subpages have a clear division of labor; remember these three boundaries before you read, so you do not repeat work:

- **Storage page vs the Basics chapter**: this chapter covers only "the disk itself" (block layer, interfaces, health, partition tables). The operational details of `mkfs`, `mount`, and `/etc/fstab` belong to [the Basics chapter - Filesystem](../basic/filesystem.md); the relevant sections here give only relationship diagrams and cross-links, not duplicated documentation.
- **Network page vs the Networking chapter**: this chapter covers the hardware path "before a packet enters the protocol stack" -- NICs, drivers, DMA, interrupts, link negotiation. For how to assign IP addresses, how to set up routing, and how to inspect the firewall, go to the [Networking chapter](../network/README.md).
- **The CPU page and the Memory page meet at NUMA**: the CPU page explains "what a NUMA node is" (a topology fact); the Memory page explains "which node's memory a process should bind to" (an allocation strategy). Each page covers half, and they link to each other.

> Content references Arch Wiki, Bird's Private Recipes (Lin's Linux Administration Guide), and the kernel documentation; see the references at the end of each chapter.

## What This Chapter Covers

- Understanding the Von Neumann architecture and PCIe topology
- CPU topology, flags, and throttling mechanisms
- Correctly interpreting `free`/`vmstat` readings
- Working with the block layer and SMART health checks
- Using `ethtool` to check link negotiation and driver state, and separating hardware problems "before the packet enters the stack" from protocol-stack problems
- Knowing the package-name differences in the three families' diagnostic tools (such as `lm-sensors` vs `lm_sensors`)

## Three-Family Diagnostic Tool Overview

The same tool carries a **different package name and preinstall status** across the three distro families. The table below is the "installation base" this chapter keeps coming back to; later pages will not re-explain package-name differences for each tool -- install the tools from this table and the rest of the reading goes much more smoothly:

| Task (command) | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------------|---------------|------|-------------------|
| CPU overview `lscpu` | Preinstalled (`util-linux`) | `pacman -S util-linux` | Preinstalled (`util-linux`) |
| Hardware overview `lshw` | `apt install lshw` | `pacman -S lshw` | `dnf install lshw` |
| Motherboard/memory `dmidecode` | `apt install dmidecode` | `pacman -S dmidecode` | `dnf install dmidecode` |
| Temperature/voltage `sensors` | `apt install lm-sensors` | `pacman -S lm_sensors` | `dnf install lm_sensors` |
| Frequency scaling `cpupower` | `apt install linux-tools-common linux-tools-$(uname -r)` | `pacman -S linux-tools` | `dnf install kernel-tools` |
| Live load `htop` | `apt install htop` | `pacman -S htop` | `dnf install htop` |
| NUMA `numactl` | `apt install numactl` | `pacman -S numactl` | `dnf install numactl` |
| Memory topology `lstopo` | `apt install hwloc` | `pacman -S hwloc` | `dnf install hwloc` |
| Historical sampling `sar` | `apt install sysstat` | `pacman -S sysstat` | `dnf install sysstat` |
| Buses `lspci`/`lsusb` | `apt install pciutils usbutils` | `pacman -S pciutils usbutils` | `dnf install pciutils usbutils` |
| Disk health `smartctl` | `apt install smartmontools` | `pacman -S smartmontools` | `dnf install smartmontools` |
| NVMe `nvme` | `apt install nvme-cli` | `pacman -S nvme-cli` | `dnf install nvme-cli` |
| NIC attributes `ethtool` | `apt install ethtool` | `pacman -S ethtool` | `dnf install ethtool` |

Three package-name traps are worth memorizing in advance; they are the usual cause of "I cannot install this command": Debian/Ubuntu's temperature tool is named **`lm-sensors` (hyphen)**, while Arch and RHEL call it **`lm_sensors` (underscore)** -- installing it under the other family's name fails with "package not found"; Debian's frequency tooling requires the `linux-tools-$(uname -r)` matching **your current kernel version** -- installing only `linux-tools-common` leaves you without `cpupower`; on RHEL-family systems, if a diagnostic package appears to be missing, first confirm that extension repos such as EPEL are enabled.

Once the tools are installed, use one command to quickly check this machine's diagnostic capability:

```bash
for t in lscpu dmidecode sensors smartctl ethtool lspci nvme numactl; do
  command -v "$t" >/dev/null && echo "OK   $t" || echo "MISS $t"
done
```

Install whatever is missing, per the table above. `lscpu` and `lspci` are part of the base system packages and should not be absent on a normal distro install -- if even those are missing, suspect that your minimal install stripped too much, or that PATH is misconfigured, rather than a dead piece of hardware.

## Conventions and Common Misconceptions

This chapter follows the book-wide convention: every section first explains "why this concept matters," then gives the command; sample output comes from a typical x86_64 host, so your numbers will differ -- that is normal, and the point is the field structure; version differences I am unsure about are either omitted or explicitly marked "verify against your version." For three-family installation, the overview table above is authoritative; the prose will not repeat each entry.

Before you start, four high-frequency misconceptions, each of which will be corrected repeatedly in the corresponding chapter:

1. **A low `free` column = memory is nearly gone** -- wrong; look at `available`; see [Memory](./memory.md).
2. **`hdparm` can test any disk** -- wrong; `hdparm` is only meaningful for SATA/PATA, use the `nvme` tool or `fio` for NVMe; see [Storage Devices](./storage.md).
3. **What `dmidecode` shows inside a VM is real hardware** -- wrong; you are reading firmware information simulated by the hypervisor; see the common gotchas in [Computer Architecture](./architecture.md).
4. **`ethtool` changes are permanent** -- wrong; most runtime parameters are lost on reboot, and persistence belongs to the network configuration layer; see [Network Devices](./network.md).

Walk into the chapter with these four alarms ringing and you save a lot of the frustration of "I copied the command and got an unexpected result."

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - Getting to Know Computer Hardware -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0105computers.php)
- Bird's Private Recipes (Lin's Linux Administration Guide) - System Administration Tools -- [linux.vbird.org](https://linux.vbird.org/linux_server/)
- Arch Wiki - Hardware category -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Category:Hardware)
- Arch Wiki - System requirements before installation (includes the CPU flags baseline) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Arch_Linux)
- Linux Hardware Database -- [linux-hardware.org](https://linux-hardware.org/)
- Linux Kernel Documentation -- [kernel.org](https://www.kernel.org/doc/html/latest/)
- Patterson & Hennessy, *Computer Organization and Design: The Hardware/Software Interface*
- Bryant & O'Hallaron, *Computer Systems: A Programmer's Perspective* (CSAPP)
- Intel(R) 64 and IA-32 Architectures Software Developer Manuals -- [intel.com](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html)
- AMD64 Architecture Programmer's Manual -- [developer.amd.com](https://www.amd.com/en/support/tech-docs)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [architecture](architecture.md)
- [cpu](cpu.md)
- [network](network.md)
- [storage](storage.md)
