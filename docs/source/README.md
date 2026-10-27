# Kernel Source

A command manual tells you how `write` is used,
and the system documentation tells you what the kernel provides,
but some questions can only be answered by the source code:
why is `epoll` faster than `select`?
After `fork`, how does the child's view of memory relate to the parent's?
Who exactly is waiting on whom in TIME_WAIT?
This part brings those "why" questions back to the place where they were implemented --
the Linux kernel source,
plus the source of a few core user-space components (coreutils, glibc, systemd).
Reading source code is not a monopoly of kernel developers;
it is the shortest path for operations and backend engineers to upgrade
**experience** into **mechanism**:
look one level deeper while troubleshooting,
and you act with that much more confidence.

> The content draws on the kernel's own Documentation/,
> the official kernel.org documentation,
> and the real books listed below;
> see the Further Reading section of each chapter.

## How This Part Is Organized: By Module, One Complete Path per Chapter

The Kernel Source part is not organized by "teaching chapters"
but by **kernel modules** --
process management/scheduling,
memory management,
VFS and ext4,
the network stack,
interrupts and clocks,
IPC,
the device driver framework,
and system calls,
one chapter per module.
Every chapter follows the same structure,
so reading any chapter takes you along the same complete path:

| Structural section | Question it answers |
|--------|-----------|
| Core data structures | Who is the "main character" of this module (`task_struct`, `struct page`, `struct file`, ...), what does it look like, and which header file hides it |
| Key function call paths | How one piece of work makes its way through the kernel (from the entry function to the exit, function name by function name) |
| Source reading order | Which file to read first and which one next, so you do not get lost in 30 million lines of code |
| Hands-on tracing | Trace a real path with strace/ftrace/bpftrace/gdb and turn static code into a live scene |
| Further reading | The relevant chapters of the corresponding books -- books are cited as they really are, and version mismatches are stated explicitly |

Before the module chapters come three prerequisites:
get the source and learn to read the directory layout
([Getting the Source and Reading the Tree](./source-tree.md)),
build the kernel and get your first module running
([Kernel Build and Module Development](./build-and-modules.md)),
and get familiar with the tracing toolbox
([Tracing Tools](./tracing-tools.md)).
With those three in place you cannot get lost in the module chapters,
in whatever order you enter them;
the recommended order is still top-down --
system calls are the entry point of every module,
processes and memory are the foundation of every module,
and VFS and the network stack are the two areas application engineers touch most often.

## Reading List: A Real Inventory and How to Use It

All the books cited in the Further Reading sections of this part really exist,
and each has a different role -- mixing them beats reading just one:

| Book | Author | Baseline version | When to read it |
|------|------|---------|---------------|
| *Linux Kernel Development* | Robert Love | 2.6 | The first book for each module: short, gives you the framework; read it before entering the source |
| *Understanding the Linux Kernel* | Bovet & Cesati | 2.6 | Once the framework is set, fill in the detailed map: dense with data-structure relationship diagrams |
| *Scenario-Based Analysis of the Linux Kernel Source* | Mao Decao, Hu Ximing | 2.4 | Learn the "scenario analysis" method: walk the kernel end to end along one system call or interrupt |
| *Professional Linux Kernel Architecture* | Wolfgang Mauerer | 2.6.24 | Use as a reference manual: field-level detail of a given module's data structures |
| *Understanding the Linux Virtual Memory Manager* | Mel Gorman | 2.6 | Memory management module only: the deepest single volume on buddy/slab |
| *Linux Device Drivers*, 3rd ed. | Corbet, Rubini, Kroah-Hartman | 2.6 | Device driver module only: the classic on writing drivers (the English LDD3 is free to read online) |

One fact must be stated up front:
the baseline of all the books above is the 2.4-2.6 era,
while the source we follow in this part is based on 6.x.
Over ten-plus years the scheduler went from O(n) to CFS to EEVDF,
and locking and memory management were rewritten on a large scale.
**The mechanism ideas in those books mostly still hold,
but the concrete function names, file locations, and data-structure fields often no longer match.**
The discipline of this part is therefore:
cite the books for concepts and ideas,
and look up functions and line numbers in the current source
([elixir.bootlin.com](https://elixir.bootlin.com/linux/latest/source) online cross-reference is the daily tool).
Where the two conflict, the current source wins,
and the version difference is marked in the text.
This is exactly how the "scenario analysis" method is used today --
the method does not age; the code does.

## Environment Preparation

- Any mainstream distribution (commands for the Debian/Ubuntu, Arch, and RHEL/Rocky families are given side by side throughout this part), with 20GB or more of disk reserved
- Kernel headers and a compilation toolchain ([Chapter 2](./build-and-modules.md) gives the side-by-side install commands for all three families)
- **Running every experiment in a virtual machine is strongly recommended**: a kernel module bug panics the whole machine rather than crashing a process, and snapshot rollback is the only undo
- Tracing experiments (ftrace/bpftrace) are also safe on bare metal; the BPF verifier guarantees the probes will not hang the machine

## Relation to the Other Parts

- [Commands · Process Management](../commands/system/process.md) and [Hardware · Memory](../hardware/memory.md) give the user's-eye concepts; this part gives the implementation-side mechanisms. Reading the two against each other produces the deepest understanding
- System Administration's [systemd Services and Program Management](../system-management/services-systemd.md) and [Log System Administration](../system-management/logging.md) cover the management plane; this part's [Selected User-Space Source](./userland.md) lifts a corner of systemd
- The Networking part ([TCP/IP Essentials](../network/tcpip-essentials.md)) covers protocol behavior; this part's [Network Stack](./network-stack.md) covers the exact lines of code where that behavior happens

## Chapter Guide

| Chapter | Contents | Reading advice |
|------|------|---------|
| [Getting the Source and Reading the Tree](./source-tree.md) | Getting the source from kernel.org/git, the directory map, the Kbuild system, online browsing | Step 1 of this part |
| [Kernel Build and Module Development](./build-and-modules.md) | menuconfig, build and install, a hello-world module actually running | Step 2 of this part, the entry point with the fastest positive feedback |
| [Cross-Compilation and Embedded](./cross-compile.md) | Cross toolchains, ARCH/CROSS_COMPILE, device trees, a BusyBox rootfs, U-Boot and QEMU verification | For anyone building the kernel for a non-x86 architecture |
| [Tracing Tools](./tracing-tools.md) | The four-layer observation system: strace/ftrace/bpftrace/gdb+QEMU | Step 3 of this part; every hands-on exercise in the module chapters depends on it |
| [System Calls](./syscall-path.md) | One write() from user space all the way into the kernel | Starting point of the module chapters: the entry of every path |
| [Process Management/Scheduling](./process-scheduling.md) | task_struct, the fork path, CFS→EEVDF, context switching | Core module |
| [Memory Management](./memory-management.md) | buddy/slab, the page-fault path, mmap, copy-on-write | Core module |
| [VFS and ext4](./vfs-ext4.md) | The five major objects, the open/read call chains, the page cache | Core module, most frequent for application engineers |
| [Network Stack](./network-stack.md) | The two paths of packet receive and transmit, the sock structures, softirq | Core module, read alongside the Networking part |
| [Interrupts and Timers](./interrupt-timers.md) | irq_desc, softirq/workqueue, hrtimer | Understanding "when does the kernel get a chance to do work" |
| [Device Driver Framework](./driver-framework.md) | The bus-device-driver model, cdev, a second real module | The main reference for writing drivers |
| [IPC](./ipc.md) | Signals, pipes, System V/POSIX mechanisms | How cooperating processes inside a service work together |
| [Selected User-Space Source](./userland.md) | coreutils, glibc's syscall wrappers, selected systemd code | The finale: the source world outside the kernel |

## References

- The Linux kernel archives -- [kernel.org](https://www.kernel.org/)
- Official kernel documentation -- [docs.kernel.org](https://docs.kernel.org/)
- Online source cross-reference -- [elixir.bootlin.com](https://elixir.bootlin.com/linux/latest/source)
- Robert Love. *Linux Kernel Development*, 3rd ed.
- Daniel P. Bovet & Marco Cesati. *Understanding the Linux Kernel*, 3rd ed.
- Mao Decao, Hu Ximing. *Scenario-Based Analysis of the Linux Kernel Source*
- Wolfgang Mauerer. *Professional Linux Kernel Architecture*
- Mel Gorman. *Understanding the Linux Virtual Memory Manager*
- Jonathan Corbet, Alessandro Rubini, Greg Kroah-Hartman. *Linux Device Drivers*, 3rd ed. -- [lwn.net/Kernel/LDD3](https://lwn.net/Kernel/LDD3/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [coverage-matrix](/research/coverage-matrix.md)
