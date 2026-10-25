# System Information Commands

Picking up a stranger's Linux box, the first thing you do is not change config or install software — it is **see what it actually is**: how new the kernel is, how many cores the CPU has, how much memory, how the disk is partitioned, who has logged in. Reading system information is the "inspection" step before troubleshooting and change — diagnose first, prescribe second.

> Content is drawn from Bird's Private Recipes (Lin's Linux Administration Guide), the Arch Wiki, and the man pages of each tool; see the references at the end.

## What This Chapter Covers

- Understanding the habit of "check system info before touching anything"
- How to read the core commands: uname, lscpu, lsblk, df, ip, and others
- Telling apart the three distro families (Debian/Ubuntu, Arch, RHEL/CentOS/Rocky) and their tool differences
- Building a quick system profile from load, logs, and login records

## 1. Why System Information Comes First

The two most common mistakes in production incidents are **wrong assumptions** (thinking it is a 4-core box when it is 2, thinking memory is 8G when it is only 2G) and **changing the wrong target** (typing `dnf` on Debian, formatting `/dev/sda` thinking it is the data disk). `uname`, `/etc/os-release`, `lsblk` — these commands take under a minute, yet they block eighty percent of the low-level errors that follow.

System information falls roughly into four layers, inner to outer: **kernel and distro identity → hardware resources → mounts and network → runtime state**. The sections below follow that order; each one starts with "why look at this" and then gives the commands and real output.

## 2. System Identity: uname and os-release

### 2.1 uname — the kernel view

The kernel version decides which features you can use: the eBPF toolchain, cgroup v2, and io_uring all have hard requirements on the kernel version. When troubleshooting "this command does not exist or behaves differently on this box", look at the kernel first:

```bash
$ uname -a
Linux web01 6.8.0-45-generic #45-Ubuntu SMP PREEMPT_DYNAMIC x86_64 GNU/Linux

$ uname -r
6.8.0-45-generic
```

`-s` returns the kernel name (Linux), `-n` the hostname, `-m` the hardware architecture (`x86_64`, `aarch64`). For daily use, remembering `-r` and `-m` is enough; the full `-a` string is good to paste into a ticket.

**Note**: `uname -r` is the **kernel** version, not the distro version. On Arch, this number changes after every `pacman -Syu` kernel upgrade, while on Ubuntu the trailing `-generic` in `6.8.0-45-generic` is a kernel flavor marker.

### 2.2 /etc/os-release — the distro identity

What actually answers "which distro is this" is `/etc/os-release`. The output shape differs a lot across the three mainstream families, so it is worth comparing them first:

```bash
$ cat /etc/os-release
PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"
NAME="Debian GNU/Linux"
VERSION_ID="12"
VERSION="12 (bookworm)"
ID=debian
```

Arch's file usually has only `ID=arch` and `BUILD_ID=rolling`, with **no** `VERSION_ID` — a rolling-release distro has no "version number" by design. Rocky writes `VERSION_ID="9.4"` and carries `ID_LIKE="rhel centos fedora"`. To decide which package manager to use, look at the `ID` field: `debian`→`apt`, `arch`→`pacman`, `rhel` family→`dnf`.

`hostnamectl` works on all three families and shows hostname, kernel, and virtualization in one go:

```bash
$ hostnamectl
 Static hostname: web01.example.com
      Chassis: vm
Operating System: Debian GNU/Linux 12 (bookworm)
          Kernel: Linux 6.8.0-45-generic
    Architecture: x86-64
```

How to **change** the hostname (`hostnamectl set-hostname`) and the three families' network/time entry points live in [Configuration Management Tools](./configuration-management.md); this page only reads.

### 2.3 uptime — uptime and load

In the one line of `uptime`, the most useful part is not "how many days up" but the trailing **load average** (1/5/15 minute averages):

```bash
$ uptime
 10:30:41 up 12 days,  3:21,  2 users,  load average: 0.15, 0.10, 0.08
```

Load is the "average number of tasks in runnable or uninterruptible state". **The threshold is not the absolute value but the comparison against CPU core count**: on a 4-core box, a load persistently above 4 means tasks are queueing; on a 1-core box, load 0.8 is already busy. A 15-minute value that keeps climbing while the 1-minute value falls often means the spike has passed but the system is still tight. For the finer per-process view see [Process Management](./process.md) and [Monitoring Tools](./monitoring.md).

## 3. Hardware Information

### 3.1 lscpu — the CPU picture

CPU count directly drives performance judgment: load thresholds, `make -j` parallelism, and database connection pools all key off it.

```bash
$ lscpu
Architecture:          x86_64
CPU op-mode(s):        32-bit, 64-bit
CPU(s):                8
On-line CPU(s) list:   0-7
Thread(s) per core:    2
Core(s) per socket:    4
Socket(s):             1
Model name:            Intel(R) Core(TM) i7-8550U CPU @ 1.80GHz
```

How to read it: `Socket(s) × Core(s) × Thread(s) = CPU(s)`. Here 1×4×2=8, i.e. **4 physical cores, 8 threads**. When talking about "how many cores" say whether you mean logical CPUs or physical cores, or your capacity planning will be off by a factor of two.

`nproc` returns only the CPUs **available to the current process**: in a container with cgroup CPU limits it may be smaller than `lscpu`'s `CPU(s)` — when running a perf test inside a container, the two numbers not matching is normal, not a bug.

`/proc/cpuinfo` is more granular (one block per logical CPU). Quick extraction of model and core count:

```bash
$ grep -m1 "model name" /proc/cpuinfo
model name	: Intel(R) Core(TM) i7-8550U CPU @ 1.80GHz
$ grep -c ^processor /proc/cpuinfo
8
```

### 3.2 lsblk — block devices and the partition tree

Before formatting a disk you must confirm the device name. `lsblk` shows the disk → partition → mountpoint relationship as a tree, more intuitive than `fdisk -l`:

```bash
$ lsblk
NAME   MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
sda      8:0    0 238.5G  0 disk
├─sda1   8:1    0   512M  0 part /boot/efi
└─sda2   8:2    0 238.0G  0 part /
sr0     11:0    1  1024M  0 rom
```

`lsblk -f` additionally shows filesystem type and UUID — when writing `/etc/fstab`, copying the UUID from here is the least-effort path. **`vda`/`xvda` on cloud servers and `sda` on local machines are only different names** — do not assume "sda is always the system disk"; always cross-check the `MOUNTPOINTS` column.

### 3.3 lspci / lsusb — bus devices

When a driver misbehaves, first confirm the hardware exists and is recognized:

```bash
$ lspci | grep -i network
03:00.0 Ethernet controller: Realtek Semiconductor Co., Ltd. RTL8111/1681/8411 PCI Express Gigabit Ethernet Controller

$ lsusb
Bus 002 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub
```

`lspci -v` / `lsusb -v` show driver binding status; a wireless NIC that does not appear is more often missing firmware than a dead slot. PCI category cheat sheet: `VGA`/`3D` are GPUs, `Network` are NICs, ` SATA`/`NVMe` are storage controllers.

### 3.4 lshw — the full hardware inventory

When you need a complete hardware report use `lshw`, which aggregates CPU, memory, NIC, and motherboard among other categories:

```bash
$ sudo lshw -short          # short table, good for pasting into a ticket
$ sudo lshw -class disk     # only one category
$ sudo lshw -class network
```

`lshw` is in the repos of all three distro families (`apt install lshw`, `pacman -S lshw`, `dnf install lshw`). For nine out of ten daily cases `lscpu`/`lsblk`/`lspci` is enough; keep `lshw` for writing hardware inventory or chasing weird compatibility problems.

## 4. Memory Information

For a quick look at memory use `free`. The column meanings (especially the difference between `available` and `free`) get their own section in [Memory Management](./memory.md); here is only the minimal reading:

```bash
$ free -h
               total        used        free      shared  buff/cache   available
Mem:            15Gi       8.2Gi       1.2Gi       512Mi       6.1Gi       6.3Gi
Swap:          2.0Gi          0B       2.0Gi
```

To judge "is there enough memory" look at **`available`**, not `free` — Linux spends idle memory as disk cache, so a low `free` is the normal state of a healthy system. `/proc/meminfo` provides finer fields (`MemAvailable`, `Cached`, `Dirty`, etc.); turn to it when you need page-level precision.

## 5. Disk Information

### 5.1 df — filesystem usage

`df` reports the usage of **mounted filesystems** and is the first data source for disk alerts:

```bash
$ df -hT
Filesystem     Type   Size  Used Avail Use% Mounted on
/dev/sda2      ext4   234G   87G  136G  40% /
tmpfs          tmpfs  7.8G     0  7.8G   0% /dev/shm
```

`-h` is human-readable, `-T` adds filesystem type (`-Th` combined). Two common misreads:

1. **`/dev/shm` is a tmpfs**, so it filling up does not mean the disk is full, but a full `/dev/shm` will make programs that rely on shared memory (browsers, some databases) throw errors.
2. **`df` and `du` numbers do not match** is usually because deleted-but-still-held files still occupy space (`du` cannot see them, `df` can). Use `lsof +L1` to find these "ghost files"; do not rush to reinstall.

To check whether inodes are exhausted use `df -i` — directories with huge numbers of small files (mail queues, cache dirs) often run out of inodes while byte space is still free.

### 5.2 du — directory usage

`df` tells you "which partition is full"; `du` tells you "who is taking it":

```bash
$ sudo du -sh /var/log/* | sort -hr | head
2.1G	/var/log/journal
412M	/var/log/sysstat
88M	/var/log/apt
```

`-s` summarizes, `-h` is human-readable; `sort -hr` sorts by human-readable size descending (more reliable than `sort -h`, which only sorts strings). Deep scans can take tens of seconds, so run `du -sh /var` first and drill down layer by layer, which is much faster than jumping straight to `du -ah /`.

### 5.3 fdisk — the partition table

When you need the disk-level partition table (including unmounted partitions):

```bash
$ sudo fdisk -l /dev/sda
Disk /dev/sda: 238.47 GiB, 256060514304 bytes, 500118192 sectors
```

On modern systems prefer `lsblk` to see structure and `blkid` to get UUIDs; `fdisk` is the main tool only when **modifying the partition table** (changing a table risks data loss, so practice in a VM). Large GPT disks can also use `gdisk`/`parted`; not covered here.

## 6. Network Information

### 6.1 ip — the modern standard

`ip` is the successor to `net-tools` (`ifconfig`/`route`/`arp`); all three families ship `iproute2` by default:

```bash
$ ip -br addr show
lo               UNKNOWN        127.0.0.1/8 ::1/128
enp3s0           UP             192.168.10.5/24 fe80::216:3eff:fe01:2a3b/64

$ ip route show
default via 192.168.10.1 dev enp3s0 proto dhcp src 192.168.10.5 metric 100
192.168.10.0/24 dev enp3s0 proto kernel scope link src 192.168.10.5
```

`-br` gives a compact table: interface name, state, and address on one line. To check "is it reachable", first `ip addr` for an address, then `ip route` for a default route, and only then `ping` — reversing the order turns a routing problem into a misdiagnosed firewall problem.

### 6.2 ifconfig — why it is being retired

`ifconfig` is deeply rooted, but minimal fresh installs often **never install** `net-tools` at all, so typing it gives a straight `command not found`. Even when installed, it does not support `ip addr`-style extended syntax (secondary addresses, policy routing). You will still see it in old docs and demo environments; in real ops standardize on `ip`. **Persistent** interface configuration goes through Netplan/nmcli/networkd per distro, see [Configuration Management Tools](./configuration-management.md) and [Network Configuration Basics](../../network/network-configuration.md).

## 7. System State and Logs at a Glance

The full methodology for processes and performance lives in [Process Management](./process.md) and [Monitoring Tools](./monitoring.md) respectively; this section keeps only the three tools a "system information profile" actually uses.

### 7.1 top / htop — who is consuming resources

```bash
$ top
# keys: P sort by CPU, M sort by memory, 1 expand per core, k send signal, q quit

$ htop
```

`top` is out of the box on all three families; `htop` needs installing, with a different command per family:

```bash
sudo apt install htop      # Debian/Ubuntu
sudo pacman -S htop        # Arch
sudo dnf install htop      # RHEL/CentOS/Rocky
```

### 7.2 vmstat / iostat — system-level sampling

```bash
$ vmstat 1 5      # once per second, 5 times total
$ iostat -x 1 5   # extended disk stats (from the sysstat package)
```

`vmstat` belongs to `procps`/`procps-ng` and is generally preinstalled on all three families; `iostat` belongs to the **sysstat** package — `pacman -S sysstat` on Arch, `apt install sysstat` on Debian, `dnf install sysstat` on Rocky. Column meanings and "what counts as abnormal" are in [Monitoring Tools](./monitoring.md).

### 7.3 journalctl / dmesg — logs

```bash
$ journalctl -b --no-pager | tail -20   # tail of this boot's log
$ journalctl -u nginx -n 50             # last 50 entries for a service
$ journalctl -f                         # follow new logs

$ dmesg --level=err,warn                # kernel warnings/errors (permissions depend on config)
```

All three families use the systemd journal as the primary entry point. `dmesg` shows kernel-space messages (disk failures, OOM, USB plug/unplug); `journalctl -u` shows user-space services. During an install self-check, run `journalctl -b -p err` to filter this boot's error-level logs — you will often spot a missing driver or a read-only mount at a glance. The logging system in detail is in [Log Management](../../basic/services/log_management.md).

## 8. Users and Login Records

```bash
$ whoami
root

$ id
uid=0(root) gid=0(root) groups=0(root)

$ who
root     pts/0        2026-09-22 10:12 (192.168.10.20)

$ last -n 5
```

`whoami`/`id` answer "who am I, what privileges do I have" — when `sudo` fails in a script, run these two first; usually the user is not in the `sudo`/`wheel` group. `who` shows **current** online sessions, `last` shows login history (data from `/var/log/wtmp`). For security investigations, `last` + `journalctl -u sshd` cross-verifies suspicious IPs; account management commands are in [User Management](../../basic/users.md).

## 9. Three-Family Comparison and Tool Installation

The same "check system information" job, the three families' default tools are basically identical (all from util-linux, procps, iproute2); the differences concentrate in **whether a few enhancement tools are preinstalled**:

| Task | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Distro identity | `cat /etc/os-release` | same as left | same as left |
| Kernel version | `uname -r` | same as left | same as left |
| CPU/disk/bus | `lscpu`/`lsblk`/`lspci` | same as left | same as left |
| Memory | `free` (procps) | `free` (procps-ng) | `free` (procps-ng) |
| Network | `ip` | `ip` | `ip` |
| Live processes | `top` built in | `top` built in | `top` built in |
| Enhanced process UI | `sudo apt install htop` | `sudo pacman -S htop` | `sudo dnf install htop` |
| Full hardware inventory | `sudo apt install lshw` | `sudo pacman -S lshw` | `sudo dnf install lshw` |
| Disk I/O stats | `sudo apt install sysstat` | `sudo pacman -S sysstat` | `sudo dnf install sysstat` |
| Logs | `journalctl` | `journalctl` | `journalctl` |

Arch note: under a rolling release, **make sure the whole system is up to date first** before installing, to avoid a partial upgrade — `sudo pacman -Syu htop` does it in one shot, rather than only `pacman -S htop` while the system has gone long without an upgrade. RHEL 8/9 and Rocky repos generally ship `lshw`/`sysstat`; very old CentOS 7 needs EPEL for some tools, and new projects should not be based on an EOL system.

When you are not sure whose machine it is, make it a fixed routine: `cat /etc/os-release` → identify the family → then pick `apt`/`pacman`/`dnf`.

## 10. Common Gotchas

1. **Treating `uname -r` as the distro version**. It is the kernel version; the distro is in `/etc/os-release`. When asking an Arch user for a version, the right question is "when did you last run `pacman -Syu`".
2. **A low `free` column in `free` means not enough memory**. A healthy system turns idle memory into buff/cache, so read `available`; the judging standard is in [Memory Management](./memory.md).
3. **`df` and `du` disagree, so you suspect a dead disk**. First run `lsof +L1` to check for deleted-but-unreleased files; container overlay layers also cause the gap.
4. **`ifconfig` not found means the network driver is dead**. Usually it is just that `net-tools` is not installed; `ip -br addr` is enough, and an interface that does not appear is the driver/hardware problem.
5. **Alerting on load average without checking core count**. Load 3 on an 8-core box is perfectly normal; the threshold should track `lscpu`'s `CPU(s)`, and watch the 1/5/15 trend together.
6. **Guessing `vda`/`nvme0n1` is the data disk on a cloud host**. Always cross-confirm with `lsblk`'s `MOUNTPOINTS` and `df -hT` before acting.
7. **`lscpu` CPU count disagrees with `nproc`**. Under containers/cgroup limits this is expected; on bare metal a mismatch means checking `taskset`/`isolcpus`.
8. **Changing network/timezone but only running the read commands**. `hostnamectl` and `ip addr` are both "look"; "change" goes through the persistent entry points in [Configuration Management Tools](./configuration-management.md), and after changing you must verify it took effect (open a new shell, re-check with `ip addr`).

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - Boot process, programs and software installation - [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)
- Arch Wiki - System maintenance - [wiki.archlinux.org](https://wiki.archlinux.org/title/System_maintenance)
- Arch Wiki - General recommendations - [wiki.archlinux.org](https://wiki.archlinux.org/title/General_recommendations)
- `man uname`, `man lscpu`, `man lsblk`, `man df`, `man du`, `man ip`
- uname(1) man page - [man7.org](https://man7.org/linux/man-pages/man1/uname.1.html)
- lscpu(1) man page - [man7.org](https://man7.org/linux/man-pages/man1/lscpu.1.html)
- /proc filesystem documentation - [kernel.org](https://www.kernel.org/doc/html/latest/filesystems/proc.html)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/commands/README.md)
- [system](/commands/system.md)
- [monitoring](monitoring.md)
