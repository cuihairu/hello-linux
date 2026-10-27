# Glossary

Chinese-English pairings, one-sentence definitions, authoritative sources and related pages for this repository's core terms. Sources are always official documentation, specifications (RFCs), official manuals or authoritative encyclopedias; links to related pages are given at the end of each entry. Maintenance rule: every new entry must carry a clickable authoritative source; if none can be found, write "no authoritative source found (pending verification)" -- never invent a link from memory.

## Filesystems and VFS

### VFS (Virtual File System)
An abstract file-interface layer provided by the kernel: it achieves polymorphism through five objects -- super_block, inode, dentry, file, address_space -- plus a table of function pointers, so regular files, pipes, devices and pseudo-files all go through the same set of system calls.
**Source**: [Linux Kernel Documentation - Virtual File System](https://www.kernel.org/doc/html/latest/filesystems/vfs.html)
**Related pages**: [VFS and ext4](/source/vfs-ext4.md), [Filesystem Concepts](/basic/filesystem/concept.md)

### inode
The metadata carrier of a filesystem object: size, permissions, timestamps and data block locations, unique within the filesystem by inode number; the name does not belong to the inode but to the dentry.
**Source**: [man7 - inode(7)](https://man7.org/linux/man-pages/man7/inode.7.html)
**Related pages**: [VFS and ext4](/source/vfs-ext4.md), [Filesystem Concepts](/basic/filesystem/concept.md)

### dentry (Directory Entry)
The cache that maps path-name components to inodes: all dentries together form the dcache; path resolution consults the cache first and only falls back to the concrete filesystem's lookup callback on a miss.
**Source**: [Wikipedia - Dentry](https://en.wikipedia.org/wiki/Dentry)
**Related pages**: [VFS and ext4](/source/vfs-ext4.md)

### super_block
The global state of one mounted filesystem instance: block size, total inode count, dirty-page writeback thresholds, filled in by the concrete filesystem at mount time.
**Source**: [Linux Kernel Documentation - Virtual File System](https://www.kernel.org/doc/html/latest/filesystems/vfs.html)
**Related pages**: [VFS and ext4](/source/vfs-ext4.md)

### page cache
The in-memory ledger of file pages (an address_space organized by page index): a read hit skips disk I/O entirely, and a write lands in the cache first and is flushed to disk by the writeback thread -- this is why a second read is far faster.
**Source**: [Wikipedia - Page cache](https://en.wikipedia.org/wiki/Page_cache)
**Related pages**: [VFS and ext4](/source/vfs-ext4.md), [Performance](/system-management/performance.md)

### ext4 (Fourth Extended Filesystem)
Linux's mainstream journaling filesystem: it describes file block mappings with extent trees, pairs with the jbd2 journal to guarantee metadata consistency, and supports delayed allocation to reduce fragmentation.
**Source**: [ext4 official wiki](https://ext4.wiki.kernel.org/)
**Related pages**: [VFS and ext4](/source/vfs-ext4.md)

### extent tree
The tree structure ext4 uses to describe "file logical block range -> physical disk block range", replacing the indirect block tables of ext2/3; ext4_map_blocks bisects along the tree to translate offsets.
**Source**: [ext4 official wiki](https://ext4.wiki.kernel.org/)
**Related pages**: [VFS and ext4](/source/vfs-ext4.md)

### Delayed Allocation
ext4's write strategy: data enters the page cache first, and disk blocks are deferred until close/writeback time, so the fuller picture of contiguous blocks is visible and fragmentation is reduced.
**Source**: [ext4 official wiki](https://ext4.wiki.kernel.org/)
**Related pages**: [VFS and ext4](/source/vfs-ext4.md)

### JBD2 (Journaling Block Device)
ext4's journaling layer: metadata changes are written to the journal before hitting the disk, then replayed after a crash to guarantee consistency; the three settings data=ordered/writeback/journal control whether data goes into the journal as well.
**Source**: [ext4 official wiki](https://ext4.wiki.kernel.org/)
**Related pages**: [VFS and ext4](/source/vfs-ext4.md)

### procfs (the /proc pseudo filesystem)
The kernel's on-the-spot snapshot interface for data structures: reading is querying (e.g. /proc/meminfo, /proc/slabinfo), assembled on the fly as text by mechanisms such as seq_file, with no disk blocks behind it.
**Source**: [Linux Kernel Documentation - procfs](https://www.kernel.org/doc/html/latest/filesystems/proc.html)
**Related pages**: [VFS and ext4](/source/vfs-ext4.md), [Userland Source Readings](/source/userland.md)

### sysfs (the /sys pseudo filesystem)
A unified view of the kernel's device, driver and bus objects, mirroring the kobject model; it is the window through which user space inspects and configures kernel objects.
**Source**: [Linux Kernel Documentation - sysfs](https://www.kernel.org/doc/html/latest/filesystems/sysfs.html)
**Related pages**: [VFS and ext4](/source/vfs-ext4.md)

### Hard Link
Several dentries pointing at the same inode: inode->i_nlink is incremented, rm only removes the name, and the inode is released only when the count reaches zero.
**Source**: [man7 - inode(7)](https://man7.org/linux/man-pages/man7/inode.7.html)
**Related pages**: [Filesystem Concepts](/basic/filesystem/concept.md)

### Symbolic Link
A special file that stores the target path string: it is followed during path resolution, can cross filesystems, and is fundamentally different from a hard link's "shared inode".
**Source**: [Wikipedia - Symbolic link](https://en.wikipedia.org/wiki/Symbolic_link)
**Related pages**: [Filesystem Concepts](/basic/filesystem/concept.md)

### Mount
The act of attaching a filesystem's super_block to the global VFS tree so its paths become reachable; journaling modes such as data=ordered are mount attributes, and changing one requires remounting.
**Source**: [man7 - mount(2)](https://man7.org/linux/man-pages/man2/mount.2.html)
**Related pages**: [Filesystem Concepts](/basic/filesystem/concept.md), [VFS and ext4](/source/vfs-ext4.md)

## Kernel and System Calls

### System Call
The controlled entry point from user space into the kernel: dispatched through the system call table to a kernel implementation; strace/ftrace can observe its surface and depth.
**Source**: [man7 - syscall(2)](https://man7.org/linux/man-pages/man2/syscall.2.html)
**Related pages**: [System Calls: The Full Path of a write()](/source/syscall-path.md), [Userland Source Readings](/source/userland.md)

### File Descriptor
The kernel handle a process holds after opening a file/pipe/socket: it points at a struct file and records the read cursor and the operation table; after fork, parent and child share the same file structure.
**Source**: [Wikipedia - File descriptor](https://en.wikipedia.org/wiki/File_descriptor)
**Related pages**: [Inter-Process Communication (IPC)](/source/ipc.md), [Userland Source Readings](/source/userland.md)

### Process
An abstraction of resources and execution context: an independent address space, a file descriptor table and a scheduling entity, switched between CPUs by the scheduler.
**Source**: [Wikipedia - Process (computing)](https://en.wikipedia.org/wiki/Process_(computing))
**Related pages**: [Process Management and Scheduling](/source/process-scheduling.md), [Process Management Commands](/commands/system/process.md)

### CFS (Completely Fair Scheduler)
Linux's default CPU scheduler: it accounts with virtual run time and runs the leftmost node of a red-black tree, aiming to distribute the CPU proportionally and fairly.
**Source**: [Linux Kernel Documentation - CFS design](https://www.kernel.org/doc/html/latest/scheduler/sched-design-CFS.html)
**Related pages**: [Process Management and Scheduling](/source/process-scheduling.md)

### Interrupt
The mechanism by which hardware/timers asynchronously notify the kernel: dispatched through the interrupt descriptor table to a handler, split into a top half and a bottom half; the foundation of device drivers and clocks.
**Source**: [Linux Kernel Documentation - generic IRQ](https://www.kernel.org/doc/html/latest/core-api/genericirq.html)
**Related pages**: [Interrupts and Timers](/source/interrupt-timers.md)

### Kernel Module
A code unit (.ko) that can be loaded into the kernel dynamically: registered through insmod/modprobe, it extends kernel functionality without a reboot.
**Source**: [Linux Kernel Documentation - modules](https://www.kernel.org/doc/html/latest/kbuild/modules.html)
**Related pages**: [Kernel Build and Module Development](/source/build-and-modules.md)

### Device Driver
The adapter layer between the kernel and hardware: it registers operation tables with the VFS/block layer/network stack, exposing device capabilities as file interfaces.
**Source**: [Linux Kernel Documentation - Driver API](https://www.kernel.org/doc/html/latest/driver-api/index.html)
**Related pages**: [Device Driver Framework](/source/driver-framework.md)

### Block Layer
The middle layer between filesystems and disk drivers: it merges/orders I/O requests, performs I/O scheduling, and submits BIOs to the disk.
**Source**: [Linux Kernel Documentation - block layer](https://www.kernel.org/doc/html/latest/block/index.html)
**Related pages**: [VFS and ext4](/source/vfs-ext4.md)

### Network Stack
The layered structure that implements the TCP/IP protocol family in the kernel: socket layer -> TCP/UDP -> IP -> link layer, encapsulating and dispatching layer by layer.
**Source**: [Linux Kernel Documentation - networking](https://www.kernel.org/doc/html/latest/networking/index.html)
**Related pages**: [Network Stack](/source/network-stack.md), [TCP/IP Essentials](/network/tcpip-essentials.md)

### TCP/IP Protocol Suite (Internet Protocol Suite)
The collection of protocols the Internet is built on: IP addressing and routing, reliable TCP streams, UDP datagrams, and supporting application protocols such as DNS and DHCP.
**Source**: [Wikipedia - Internet protocol suite](https://en.wikipedia.org/wiki/Internet_protocol_suite)
**Related pages**: [TCP/IP Essentials](/network/tcpip-essentials.md), [Network Basics](/network/basics.md)

### Pipe and IPC
An inter-process communication mechanism: pipes provide a one-way byte stream (man pipe(7)) and, together with signals, shared memory and sockets, form the IPC family.
**Source**: [man7 - pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html)
**Related pages**: [Inter-Process Communication (IPC)](/source/ipc.md)

### Signal
An asynchronous event notification sent by the kernel to a process: default action / catch / ignore, three states; the kill command corresponds to the semantics in signal(7).
**Source**: [man7 - signal(7)](https://man7.org/linux/man-pages/man7/signal.7.html)
**Related pages**: [Inter-Process Communication (IPC)](/source/ipc.md)

### strace (System Call Tracer)
A tool for tracing a process's system calls and signals: -e trace=openat,read filters, -c summarizes; the first-hand tool for observing what a program really does.
**Source**: [man7 - strace(1)](https://man7.org/linux/man-pages/man1/strace.1.html)
**Related pages**: [Tracing Tools](/source/tracing-tools.md)

### ftrace / bpftrace (kernel function-level tracing)
ftrace is the kernel's built-in function tracing framework (function_graph draws the call tree); bpftrace aggregates statistics in kernel space with eBPF, finishing observations such as per-process counting in a single line.
**Source**: [Linux Kernel Documentation - ftrace](https://www.kernel.org/doc/html/latest/trace/ftrace.html), [bpftrace official repository](https://github.com/bpftrace/bpftrace)
**Related pages**: [Tracing Tools](/source/tracing-tools.md)

## System Administration and Services

### systemd and service management
The init system and service manager of modern Linux: services, mounts and timers are declared as unit files, with unified start/stop, dependencies and logging (journald).
**Source**: [systemd.io](https://systemd.io/)
**Related pages**: [Advanced systemd Services and Program Management](/system-management/services-systemd.md), [System Service Management](/basic/services/system_services.md)

### Daemon
A service process that runs in the background, detached from any terminal: its lifecycle is managed by the init system (systemd nowadays).
**Source**: [Wikipedia - Daemon (computing)](https://en.wikipedia.org/wiki/Daemon_(computing))
**Related pages**: [System Service Management](/basic/services/system_services.md)

### syslog / journald (system logging)
The system logging stack: traditional syslog writes to files classified by facility/severity, while journald stores structured binary data queried through journalctl.
**Source**: [systemd.io](https://systemd.io/)
**Related pages**: [System Logs](/basic/log/syslog.md), [Logging System Management](/system-management/logging.md)

### LVM (Logical Volume Manager)
A storage layer that abstracts volume groups and logical volumes on top of physical volumes: it supports online growth and snapshots, lifting the constraint that "partition size is fixed".
**Source**: [Wikipedia - Logical Volume Manager (Linux)](https://en.wikipedia.org/wiki/Logical_Volume_Manager_(Linux))
**Related pages**: [LVM Logical Volume Management](/system-management/lvm.md)

### GRUB (GRand Unified Bootloader)
Linux's mainstream bootloader: it loads the kernel and initramfs and hands over control; the configuration is generated by grub-mkconfig.
**Source**: [GNU GRUB manual](https://www.gnu.org/software/grub/manual/grub/html_node/)
**Related pages**: [The GRUB Bootloader](/basic/boot/grub.md)

### UEFI (Unified Extensible Firmware Interface)
The modern firmware interface that replaces legacy BIOS: it defines boot services, the ESP partition and boot entries, with Secure Boot as its security extension.
**Source**: [Wikipedia - Unified Extensible Firmware Interface](https://en.wikipedia.org/wiki/Unified_Extensible_Firmware_Interface)
**Related pages**: [BIOS and UEFI](/basic/boot/bios_uefi.md)

### BIOS (Basic Input/Output System)
Legacy PC firmware: power-on self test, hardware initialization, then hand-over to the boot sector; limited in capacity and capability, and being replaced by UEFI.
**Source**: [Wikipedia - BIOS](https://en.wikipedia.org/wiki/BIOS)
**Related pages**: [BIOS and UEFI](/basic/boot/bios_uefi.md)

### Permission model (rwx / setuid / setgid / sticky)
The Unix file permission bit system: three rwx triplets for owner/group/other plus three special bits -- setuid executes as the owner, setgid inherits the group, sticky restricts deletion and renaming inside a directory.
**Source**: [man7 - inode(7)](https://man7.org/linux/man-pages/man7/inode.7.html)
**Related pages**: [File Permissions](/basic/filesystem/permissions.md)

### ACL (Access Control List)
A fine-grained permission mechanism that appends entries for specific users/groups on top of the three rwx triplets, read and written with setfacl/getfacl.
**Source**: [man7 - acl(5)](https://man7.org/linux/man-pages/man5/acl.5.html)
**Related pages**: [ACL Permission Control](/basic/users/acl_permissions.md)

### PAM (Pluggable Authentication Modules)
Linux's authentication framework: policies such as passwords, fingerprints and two-factor are implemented by stacking pluggable modules, and programs such as sudo and login authenticate through it.
**Source**: [man7 - pam(8)](https://man7.org/linux/man-pages/man8/pam.8.html)
**Related pages**: [PAM and sudo](/security/pam-sudo.md)

### x86-64 ABI (psABI)
The application binary interface specification for the x86-64 architecture: calling convention, register usage, stack layout and the system call ABI -- the contract that assembly and compilers both obey.
**Source**: [x86-64 psABI official repository](https://gitlab.com/x86-psABIs/x86-64-ABI)
**Related pages**: [Computer Architecture](/hardware/architecture.md)

### Shell / Bash
The command interpreter and scripting language: it parses user input into commands to execute, supports variables, control flow and functions, and is the entry point for system automation.
**Source**: [GNU Bash manual](https://www.gnu.org/software/bash/manual/)
**Related pages**: [Bash Basics](/script/bash-basics.md)

## Networking and Services

### DNS (Domain Name System)
The distributed database system that resolves domain names to IPs, with the message format defined by RFC 1035; BIND is the mainstream server implementation in the Unix world.
**Source**: [RFC 1035 - Domain Names - Implementation and Specification](https://www.rfc-editor.org/rfc/rfc1035)
**Related pages**: [DNS](/server/dns/bind.md)

### DHCP (Dynamic Host Configuration Protocol)
The protocol by which hosts automatically obtain an IP address and network parameters, defined by RFC 2131; together with DNS it is usually listed as a foundational network service.
**Source**: [RFC 2131 - Dynamic Host Configuration Protocol](https://www.rfc-editor.org/rfc/rfc2131)
**Related pages**: [DHCP Servers](/server/dhcp.md)

### netfilter / nftables (firewall framework)
The Linux kernel's packet filtering framework: netfilter provides hooks and connection tracking, and nftables is its next-generation rule engine (replacing iptables).
**Source**: [netfilter.org](https://www.netfilter.org/), [nftables official wiki](https://wiki.nftables.org/)
**Related pages**: [Firewall](/network/firewall.md), [Firewall](/security/firewall.md)

### SELinux (Security-Enhanced Linux)
The mandatory access control (MAC) implementation started by the NSA and merged into the mainline kernel: policy rules over security-context labels constrain what a process may do to files and ports.
**Source**: [SELinux Project official repository](https://github.com/SELinuxProject/selinux)
**Related pages**: [SELinux in Practice](/security/selinux.md), [concept](/basic/security/concept.md)

### Docker (container runtime)
The de facto standard for containerization: packages an application and its dependencies as an image, shares the host kernel, starts in seconds, and sits somewhere between bare metal and virtual machines.
**Source**: [Docker official documentation](https://docs.docker.com/)
**Related pages**: [Containers](/server/container/docker.md)

### KVM (Kernel-based Virtual Machine)
The virtualization solution built into the Linux kernel: it executes guest instructions with CPU VT-x/AMD-V hardware assistance, and together with QEMU and libvirt forms a complete virtualization stack.
**Source**: [linux-kvm.org](https://www.linux-kvm.org/page/Main_Page)
**Related pages**: [KVM Virtualization](/server/virtualization/kvm.md)

### oplock (Opportunistic Lock)
SMB's client-side caching acceleration: the server grants a lock so the client can cache reads and writes locally, and revokes it on disconnect or concurrency; one source of "file is in use" symptoms.
**Source**: [Samba official documentation](https://www.samba.org/samba/docs/)
**Related pages**: [Samba File Sharing](/server/samba.md)

### passdb (Samba account database)
Samba's password ledger, independent of system accounts (tdbsam backend by default): share access is verified against it, and it is a different book from /etc/shadow.
**Source**: [Samba official documentation](https://www.samba.org/samba/docs/)
**Related pages**: [Samba File Sharing](/server/samba.md)

---

**Maintenance rule**: every new entry must carry a clickable authoritative source (official documentation / specification / official manual / authoritative encyclopedia); if none can be found, write "no authoritative source found (pending verification)" -- never invent a link from memory.

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](knowledge.md)
