# What Is Linux

The word "Linux" means different things in different contexts. Strictly, it is only a kernel, but in everyday use it usually means the complete operating system. This chapter sorts out those concepts -- which is not pedantry, because it decides how you read documentation, ask questions, and search for errors from now on. Someone who treats `/proc` as "some program's config directory" and someone who knows it is a virtual filesystem exported by the kernel will take completely different debugging paths for the same error. This page first draws the boundary between kernel and operating system, then explains how GNU and Linux fit together, and finally lands on "what a distribution is made of and which tools it uses to manage software", with verification commands for all three families.

> Content draws on GNU Project documentation and Linux kernel documentation -- see the references at the end.

## What This Chapter Covers

- Understand the difference between a kernel and an operating system
- The relationship between the GNU Project and Linux
- Become familiar with the layered structure of a distribution
- Recognize the division of labor and differences among the three big package managers (`apt`, `dnf`, `pacman`)

## 1. Kernel vs Operating System

### 1.1 The Kernel

The kernel is the core program of an operating system, responsible for managing hardware resources and providing basic services. **Why you need one**: applications cannot touch disks, NICs, and RAM directly -- every program would have to write its own drivers, and they would fight each other. The kernel funnels those dangerous, mutually exclusive operations into one place and exposes them through a system call interface, so an application only ever has to say "I want to read this file" without caring which sector the data came from or which bus it crossed.

The Linux kernel is just a C program, usually compressed and stored under `/boot`, and at runtime it occupies the protected "kernel space" in memory. It does not contain `ls`, `bash`, or a browser -- those live in "user space" and talk to the kernel through system calls:

```text
┌──────────────────────────────────────┐
│              User space              │
│  ┌────────┐ ┌────────┐ ┌────────┐    │
│  │  Bash  │ │  Vim   │ │  Nginx │    │
│  └───┬────┘ └───┬────┘ └───┬────┘    │
├──────┼──────────┼──────────┼─────────┤
│      │        System calls        │  │
│  ┌───┴─────────────────────┴──────┐  │
│  │          Kernel space          │  │
│  │┌────────┐ ┌────────┐ ┌────────┐│  │
│  ││Process │ │Memory  │ │File sys││  │
│  ││sched   │ │mgmt    │ │system  ││  │
│  │├────────┤ ├────────┤ ├────────┤│  │
│  ││Network │ │Device  │ │Security││  │
│  ││protocol│ │drivers │ │modules ││  │
│  │└────────┘ └────────┘ └────────┘│  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

The kernel's duties:

| Subsystem | Function | Where you will meet it |
|-----------|----------|------------------------|
| Process scheduling | Create, schedule, terminate processes | `ps`, `top`, CPU usage debugging |
| Memory management | Virtual memory, paging, allocation | `free`, the OOM killer killing processes |
| Filesystem | VFS abstraction layer, concrete filesystem implementations | Mounting, `df`, inode exhaustion |
| Network protocol stack | TCP/IP implementation | `ss`, packet captures, connection state |
| Device drivers | Software interfaces to hardware | `lsmod`, new hardware not recognized |
| Security modules | SELinux, AppArmor, capabilities | "Permissions look right but access is denied" |

**Verify on all three families**. `uname -r` output looks different across the three families, but they all come from the same upstream project:

```bash
# Ubuntu 24.04 LTS
$ uname -r
6.8.0-45-generic
# Rocky Linux 9.4
$ uname -r
5.14.0-427.13.1.el9_4.x86_64
# Arch Linux (rolling release, the version number changes with every upgrade)
$ uname -r
6.8.9-arch1-1
```

Note the `.el9_4` in Rocky's output -- that is the build tag the Red Hat family adds to its own kernel, so you can tell at a glance "this kernel was customized for EL9". Arch's output carries the `arch1` tag instead, and the number changes after every `sudo pacman -Syu` kernel upgrade. Now look at the build metadata behind those kernels:

```bash
$ cat /proc/version
Linux version 6.8.0-45-generic (buildd@lcy02-amd64-116) (x86_64-linux-gnu-gcc-13)
#45-Ubuntu SMP PREEMPT_DYNAMIC ... GNU/Linux
```

`/proc/version` is a virtual file the kernel generates at runtime, not a configuration you edited on disk -- which is exactly what "everything is a file" means (see [Technology Overview](../overview.md)).

### 1.2 The Operating System

What you install, log into, and type commands at every day is far more than a kernel. A usable operating system = **kernel + user space tools + system libraries + package management + a configuration framework**. From the outside in, roughly four layers: applications and desktop environment, then package management and configuration frameworks, then system libraries (glibc, openssl), then the kernel. The kernel is only the bottom layer, and every layer above it can be swapped independently without recompiling the kernel -- which is the structural basis for why there are so many distros.

This distinction matters practically: **the same kernel version can produce completely different operating systems**. Ubuntu and Debian may run the same `6.8` kernel, yet one ships GNOME 46 and `snap` while the other defaults to Xfce and plain APT repositories. Conversely, swapping the kernel on one Ubuntu install (say, installing the HWE kernel) changes nothing about your existing user space. Once you understand that, you can see why "upgrade the kernel" and "upgrade the system" are two different operations, and what a distro upgrade (Ubuntu 22.04 to 24.04) is actually replacing.

## 2. GNU and Linux

### 2.1 The GNU Project

In 1983, Richard Stallman launched the GNU (GNU's Not Unix) project, aiming to create a completely free Unix-like operating system. **The motivation came from a real frustration**: at the time the lab's printer driver source code was refused by the vendor as a trade secret, and Stallman could not fix a bug that made the machine jam repeatedly. From that he concluded "without source code, users are always held hostage", and resolved to rebuild the whole system with free software.

By 1991, GNU had completed most of its components:

| Component | Description | Status |
|-----------|-------------|--------|
| GCC | GNU Compiler Collection | Complete |
| glibc | C standard library | Complete |
| coreutils | Basic commands (ls, cp, mv...) | Complete |
| Bash | Shell | Complete |
| Emacs | Text editor | Complete |
| **Kernel** | Hurd | **Incomplete** |

Hurd was built on a microkernel design -- technically ambitious and chronically delayed. That is the gap history left behind.

### 2.2 Linux Fills the Gap

In 1991, Linus Torvalds released the Linux kernel, filling the one missing piece of the GNU project -- **GNU Project (user space tools) + Linux kernel = GNU/Linux operating system**.

In other words: when you run `ls`, `bash`, or `gcc` you are running GNU code; when you read `/proc`, load modules, or get scheduled by the kernel you are running Linux code. The two mesh together through a POSIX-style interface, and neither works as a system without the other.

### 2.3 The Naming Dispute

- **GNU/Linux**: emphasizes the GNU Project's contribution (the Free Software Foundation's position)
- **Linux**: shorter, used by most people

The argument went on for years, but its practical effect on users is near zero -- whatever you call it, `uname -r` returns the kernel version and `ls --version` shows the coreutils version. Knowing the dispute exists is enough; you do not have to pick a side.

```bash
# Check GNU tool versions
$ ls --version | head -1
ls (GNU coreutils) 9.4
$ bash --version | head -1
GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)
```

GNU tool versions and the kernel version **evolve independently**: on one machine coreutils can be 9.x while the kernel is 5.14 or 6.8. Whenever you see a claim like "Linux version 9.4", you can immediately tell it is mixing two numbering schemes.

## 3. What Makes Up a Distribution

A complete Linux distribution contains the layers below. **Why distros exist**: the kernel and GNU tools are only parts; no ordinary user could build a usable system from source themselves and keep up with security patches forever. A distro's job is to package tested kernels, libraries, and software into repositories, pick a default configuration, and then hand you a package manager so one command installs and upgrades everything.

| Layer | Description | Example |
|-------|-------------|---------|
| Kernel | Hardware abstraction and resource management | Linux 6.8 (Ubuntu) / 5.14 (Rocky) / rolling (Arch) |
| GNU tools | Basic commands and build tools | coreutils, bash |
| System libraries | Libraries programs need to run | glibc |
| Package management | Installing and updating software | APT / DNF / pacman |
| Desktop environment | Graphical user interface (optional) | GNOME / KDE |
| Applications | Programs the user runs | Firefox, Nginx |

**What happens when you swap a layer**: swapping glibc for musl (as Alpine does) yields a tiny image, but some closed-source software will not run directly; swapping GNOME for the i3 window manager and the kernel never notices; swapping APT for pacman means you have replaced the entire distro. Once you understand the layering, problems like "this software will not install on my machine" can quickly be pinned down to a package, a library, or a kernel version.

### 3.1 The Three Package Managers

The package management layer is where the three families differ most and where the most footguns live. **Why the difference is this deep**: a package manager is tightly bound to the software repositories, the package format, and the dependency resolver -- it is core to a distro's identity, not a swappable part. How each camp works:

| Operation | Debian/Ubuntu (`apt`) | RHEL/CentOS/Rocky (`dnf`) | Arch (`pacman`) |
|-----------|----------------------|---------------------------|-----------------|
| Refresh index | `sudo apt update` | `sudo dnf makecache` | `sudo pacman -Sy` (usually combined with `-Su`) |
| Upgrade system | `sudo apt upgrade` | `sudo dnf upgrade` | `sudo pacman -Su` |
| Refresh + upgrade | `sudo apt full-upgrade` | `sudo dnf upgrade --refresh` | `sudo pacman -Syu` |
| Install | `sudo apt install nginx` | `sudo dnf install nginx` | `sudo pacman -S nginx` |
| Remove | `sudo apt remove nginx` | `sudo dnf remove nginx` | `sudo pacman -R nginx` |
| Search | `apt search nginx` | `dnf search nginx` | `pacman -Ss nginx` |
| Package info | `apt show nginx` | `dnf info nginx` | `pacman -Si nginx` |
| Which package owns a file | `dpkg -S /usr/sbin/nginx` | `rpm -qf /usr/sbin/nginx` | `pacman -Qo /usr/bin/nginx` |
| Package format | `.deb` | `.rpm` | `.pkg.tar.zst` |

One thing about Arch's `pacman` deserves special emphasis: **a rolling-release distro has no two-step "update the index first, then upgrade" split**. `-Syu` is atomic -- it refreshes the repository database and upgrades all installed packages in one go. Running `sudo pacman -Sy` without `-Su` (called a "partial upgrade" in the community) leaves newly upgraded libraries incompatible with the packages that were not upgraded. It is the most classic Arch outage. The Arch Wiki has warned about it at length:

```bash
# Arch: the correct everyday upgrade (one command, do not split it)
$ sudo pacman -Syu
:: Synchronizing package databases...
 core is up to date
 extra                   868.7 KiB  1.63 MiB/s 00:00 [######################] 100%
:: Starting full system upgrade...
resolving dependencies...
looking for conflicting packages...

Packages (12) linux-6.8.9.arch1-1  glibc-2.39-4  ...
Total Download Size:   45.32 MiB
:: Proceed with installation? [Y/n]
```

Debian/Ubuntu and the RHEL family can safely split it into two steps (`apt update` only refreshes the index; `apt upgrade` is what actually changes packages), because their repositories are fixed version sets and a partial mismatch between the index and installed packages cannot break dependencies. This is not a matter of command style -- it is a **direct consequence of the release model**.

## 4. "Everything Is a File" in Brief

Linux carries on Unix's design philosophy, abstracting devices, processes, and network connections all into file interfaces, so `cat /proc/meminfo` can read memory and `ls -l /dev/sda` can see a disk. Since [Technology Overview](../overview.md) expands on this idea fully (with a resource-type table and example commands), this page does not repeat it -- just remember the core corollary: **when you meet an unfamiliar piece of system state, look for where it lives in the filesystem**. To check NIC state, go to `/sys/class/net/`; to see what a process is doing, go to `/proc/<pid>/`.

```bash
# A quick feel for it (details in Technology Overview)
$ ls -la /dev/sda
brw-rw---- 1 root disk 8, 0 ... /dev/sda
$ cat /proc/1/comm
systemd
```

## 5. Inspecting System Information

Before troubleshooting or asking for help, figure out "what system am I on". This is the set of commands this page most wants you to have as muscle memory:

```bash
# Kernel version (common to all three families)
$ uname -r
6.8.0-45-generic

# Distro information (common to all three families, the most reliable primary source)
$ cat /etc/os-release
PRETTY_NAME="Ubuntu 24.04.1 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
ID=ubuntu
ID_LIKE=debian

# GNU tool versions and host information
$ ls --version | head -1
ls (GNU coreutils) 9.4
$ hostnamectl | head -3
 Static hostname: ubuntu-lab
       Icon name: computer-vm
         Chassis: vm
```

The `os-release` output differs sharply across the three families, so it is worth going through on paper first: Debian 12 writes `PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"` and `ID=debian`; Rocky 9.4 writes `VERSION_ID="9.4"` and includes `ID_LIKE="rhel centos fedora"`; Arch has only `ID=arch` and `BUILD_ID=rolling` and **no** `VERSION_ID` at all -- a rolling-release distro simply has no such thing as a version number. `hostnamectl` works on all three families (Arch needs the relevant `systemd` packages installed, which is normally the default), and the RHEL family often uses it to check the kernel and virtualization info as well.

**A practical decision chain**: `cat /etc/os-release`, read `ID`, determine the family (debian / rhel / arch), and only then decide whether to use `apt`, `dnf`, or `pacman`. On any machine you are unsure about, run this step before executing any package management or firewall command.

## 6. Common Pitfalls and Misconceptions

1. **Treating a kernel version as a distro version**. `uname -r` prints `6.8.0-45-generic`; that is **not** the full identity of "a Linux 6.8 system" -- it does not tell you whether it is Ubuntu or Debian. The distro version must come from `/etc/os-release`. When describing a problem to someone, include both (distro plus kernel) and responses will be much faster.

2. **Treating one family's commands as the Linux standard**. Typing `apt install` on Arch gives `bash: apt: command not found`; looking for PPAs on Rocky comes up empty, because that is a Debian-family concept. Conversely, running commands from documentation that does not name a distro is the main way people create "broken configurations".

3. **Doing a partial upgrade on Arch (`pacman -Sy package`)**. Refreshing the index and installing a single package leaves that package's newer library dependencies mismatched against the rest of the older system, producing bizarre failures like `error while loading shared libraries`. The correct Arch move is always a full `sudo pacman -Syu` first, everything else second.

4. **Assuming "sudo exists = everything is a root problem"**. Permissions, SELinux/AppArmor context, and read-only filesystem mounts all cause "looks like I have permission but access is denied". This is especially common on the RHEL family: `ls -l` shows the permissions are fine and it is actually SELinux in enforcing mode blocking you -- see [Security Basics](../security.md).

5. **Confusing "kernel modules" with "user space programs"**. `lsmod` lists loaded kernel modules, `apt list --installed` lists user space packages, and each has its own repositories and upgrade path. When a Wi-Fi driver install fails, first work out which side the thing you are installing lives on.

6. **Ignoring the `ID_LIKE` field in `/etc/os-release`**. Some derivatives (Linux Mint's `ID_LIKE=ubuntu`, for example) state who they descend from, which tells you directly which documentation to read: `ID_LIKE=debian` means read Debian/Ubuntu material, not RHEL's.

## References

- GNU Project -- [gnu.org](https://www.gnu.org/gnu/linux-and-gnu.html)
- The Linux Kernel Archives -- [kernel.org](https://www.kernel.org/)
- Linus Torvalds' original announcement -- [groups.google.com](https://groups.google.com/g/comp.os.minix/c/dlNtH7RRrGA)
- Arch Wiki - Linux -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Linux)
- Arch Wiki - pacman / partial upgrade warning -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Wikipedia: GNU/Linux naming controversy -- [wikipedia.org](https://en.wikipedia.org/wiki/GNU/Linux_naming_controversy)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [introduction](/basic/introduction.md)
- [packages](/basic/packages.md)
