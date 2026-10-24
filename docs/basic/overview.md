# Technology Overview

Before you type your first command, build a mental map of what an operating system actually manages: how processes get scheduled, how memory gets allocated, how files on disk get organized into paths. The answers to those questions determine whether you can trace the right layer when you later hit "the process won't start", "not enough memory", or "permission denied" -- or whether you'll just retry blindly in front of the terminal. Linux's answers compress into three design philosophies: **everything is a file** (devices, processes, and network state all map to paths), **small tools combined** (each command does one thing, chained into a pipeline with pipes), and **plain-text configuration** (config is human-readable, diffable, scriptable). This chapter records operating system principles, the Linux kernel, and the shell, and sets up the knowledge framework for every later chapter.

> This page compares the **Debian/Ubuntu, Arch, and RHEL/CentOS/Rocky** distro families side by side. The principles layer is identical across all three; the differences concentrate in the default shell, package management, and kernel version. See the comparison tables and hands-on commands below. Content draws on Bird's Private Recipes (Lin's Linux Administration Guide), the Arch Wiki, and the kernel documentation -- see the references at the end.

## What This Chapter Covers

- Understand the core duties and working principles of an operating system
- Linux's design philosophy
- Know the kernel architecture and version naming rules
- Distinguish the relationship between shell, kernel, and filesystem

## 1. Operating System Fundamentals

### 1.1 What Is an Operating System

An operating system (OS) is system software that manages hardware and software resources, providing a unified abstraction layer for applications above it.

```text
┌───────────────────────────────────┐
│           Applications            │  User mode
├───────────────────────────────────┤
│           System calls            │  Kernel mode
├──────────┬──────────┬─────────────┤
│ Process  │  Memory  │ File system │
├──────────┼──────────┼─────────────┤
│ Drivers  │ Network  │  Security   │
├──────────┴──────────┴─────────────┤
│             Hardware              │
└───────────────────────────────────┘
```

Core responsibilities:

| Responsibility | Description | Example |
|----------------|-------------|---------|
| Process management | Create, schedule, terminate processes | `ps`, `top` |
| Memory management | Allocate and reclaim virtual memory | `free`, `vmstat` |
| Filesystem | Organize and manage data on disk | `df`, `mount` |
| Device management | Control hardware devices | `/dev`, `lsmod` |
| Network protocols | Implement network communication | `ip`, `ss` |
| Security control | User privileges and access control | `chmod`, `SELinux` |

### 1.2 Kernel Mode and User Mode

The CPU runs at two privilege levels:

| Mode | Privileges | Used for |
|------|------------|----------|
| **Kernel mode (Ring 0)** | Full hardware access | Kernel code, drivers |
| **User mode (Ring 3)** | Restricted access | Applications |

When an application needs to touch hardware, it must trap into kernel mode through a **system call**. `strace` is the microscope for that boundary:

```bash
$ strace ls /tmp 2>&1 | head -5      # print each system call ls triggers
$ strace -c ls /tmp 2>&1             # summarize counts and time per system call type
```

### 1.3 Interrupts

An interrupt is how the CPU responds to external events, split by origin into **hardware interrupts** (a NIC receives data, a disk finishes a read/write) and **software interrupts** (system calls, exception handling). Both have live counters under `/proc`:

```bash
$ cat /proc/interrupts      # hardware interrupt counts (one column per CPU)
$ cat /proc/softirqs        # software interrupt counts (bottom-half work like network I/O)
```

## 2. Linux Design Philosophy

### 2.1 Everything Is a File

Linux abstracts nearly every resource as a file, manipulated through one uniform file interface:

| Resource type | File path | Description |
|---------------|-----------|-------------|
| Regular file | `/home/user/file.txt` | Stores data |
| Directory | `/home/user/` | Container |
| Device | `/dev/sda`, `/dev/tty` | Hardware device |
| Process | `/proc/1/` | Process information |
| Network | `/proc/net/` | Network state |
| Pipe | `\|` | Inter-process communication |
| Socket | `/var/run/docker.sock` | Network communication |

```bash
$ ls -la /dev/sda          # block device: the same ls output as any regular file
$ ls -la /proc/1/cmdline   # command line of PID 1: reading a file is reading a process
$ ls -la /proc/net/tcp     # state of established TCP connections
```

### 2.2 Small Tools Combined

Each command does one thing; complex jobs fall out of piping them together. This is the power you buy with composability:

```bash
$ who | wc -l                                  # count currently logged-in users
$ du -sh /* 2>/dev/null | sort -hr | head -5   # the 5 directories using the most disk
```

A longer pipeline is just more words strung together, e.g. ranking failed logins: `lastb | awk '{print $1}' | sort | uniq -c | sort -rn | head -10` -- read as "pull the usernames from the failure records, then dedupe and count, then sort by count descending".

### 2.3 Plain-Text Configuration

Config files are plain text, which makes them easy to version-control and automate. If you break something you can look back with `diff`, and you can batch-edit with a single `sed`:

| Config file | Purpose | Typical operation |
|-------------|---------|-------------------|
| `/etc/netplan/01-netcfg.yaml` | Ubuntu networking (YAML) | `sudo netplan apply` to take effect |
| `/etc/ssh/sshd_config` | SSH server | edit fields after `grep -v '^#'`, verify with `sshd -t` |
| `/etc/passwd` | Users and home directory listing | `head -5 /etc/passwd` to view |

## 3. The Linux Kernel

### 3.1 Kernel Architecture

```text
┌──────────────────────────────────────┐
│             User space               │
│    App 1     App 2      App 3        │
├─────────── System call interface ────┤
│              Kernel space            │
│ Process sched │ Memory mgmt │  VFS   │
│   Network stack   │   Device drivers │
└──────────────────────────────────────┘
```

The three applications in user space each own an independent address space and must detour through the kernel to reach each other. The only legal channel between them and the kernel is that "system call interface" horizontal line -- which is exactly what section 1.2's `strace` lists item by item.

### 3.2 Kernel Subsystems

| Subsystem | Responsibility | Related files |
|-----------|----------------|---------------|
| Process scheduling | Process creation, scheduling, communication | `/proc/sched*` |
| Memory management | Virtual memory, paging | `/proc/meminfo` |
| Filesystem | VFS abstraction layer, concrete implementations | `/proc/filesystems` |
| Network protocols | TCP/IP protocol stack | `/proc/net/` |
| Device drivers | Hardware abstraction | `/proc/modules` |

### 3.3 Kernel Modules

Kernel modules are kernel code loaded dynamically, so you don't rebuild the whole kernel for one filesystem or one NIC:

```bash
$ lsmod                  # list loaded modules (readable from /proc/modules)
$ modinfo ext4           # module info: author, parameters, dependencies
$ sudo modprobe vfat     # load a module (pulls in dependencies automatically)
$ sudo modprobe -r vfat  # unload a module (fails if it is in use)
```

### 3.4 Kernel Version Naming

The naming rule is `major.minor.revision[-stability-flag]`: Ubuntu 24.04 ships `6.8.0-generic` by default, while RHEL/Rocky 9 ships `5.14.0-362.el9` -- the extra `-362.el9` is the distro's own patch set and build suffix, and it is the fastest tell for "community kernel" versus "vendor kernel".

```bash
$ uname -r           # kernel version only
6.8.0-generic
$ uname -a           # full string: hostname, version, arch, build info
Linux dev 6.8.0-generic #31-Ubuntu SMP PREEMPT_DYNAMIC x86_64 GNU/Linux
$ cat /proc/version  # where the kernel was built from (build host, gcc version)
Linux version 6.8.0-31-generic (buildd@lcy02) ... x86_64 GNU/Linux
```

## 4. Shell

### 4.1 What Is a Shell

The shell is the command interpreter between you and the kernel. It is responsible for:
- Parsing the commands you type
- Locating and executing the matching program
- Handling input/output redirection
- Managing environment variables

### 4.2 Comparing Common Shells

| Shell | Default on | Traits | Config file |
|-------|-----------|--------|-------------|
| **Bash** | Most distros | Good compatibility, rich features | `~/.bashrc` |
| **Zsh** | macOS, Kali | Autocomplete, rich theming | `~/.zshrc` |
| **Fish** | -- | Syntax highlighting, autosuggest | `~/.config/fish/` |
| **Dash** | Debian/Ubuntu `/bin/sh` | Lightweight and fast | -- |

```bash
$ echo $SHELL          # the shell used for the current login
$ cat /etc/shells      # shells the system allows you to switch to
$ chsh -s /bin/zsh     # change your default shell (takes effect next login)
```

### 4.3 Login Shells and Non-Login Shells

| Type | Triggered by | Config load order |
|------|--------------|-------------------|
| Login shell | Terminal login, `ssh` | `/etc/profile` then `~/.bash_profile` |
| Non-login shell | GUI terminal, `bash` | `~/.bashrc` |
| Interactive shell | Commands typed by hand | Loads prompt and history |
| Non-interactive shell | Script execution | Loads only the necessary environment |

To tell which kind the current session is: in Bash run `shopt login_shell` (output `on` means it is a login shell), or use `[[ -o login ]] && echo "login shell"` as a conditional check -- that is the first step whenever you are debugging "I clearly edited `.bashrc`, why has it not taken effect?".

## 5. Linux vs Unix and Windows

| Feature | Linux | Unix | Windows |
|---------|-------|------|---------|
| Source code | Open source (GPL) | Closed source (mostly) | Closed source |
| Kernel | Linux kernel | Vendor kernels | NT kernel |
| Filesystem | ext4/XFS/Btrfs | UFS/ZFS | NTFS |
| Package management | APT/DNF | Vendor tools | MSI/EXE |
| Shell | Bash/Zsh | Bourne/Korn | CMD/PowerShell |
| Permission model | DAC + MAC (SELinux) | DAC | ACL |
| Configuration | Plain-text files | Plain-text files | Registry |
| Typical use | Server/embedded/desktop | Enterprise server | Desktop/enterprise |
| Typical cost | Free | Commercial license | Commercial license |

### 5.1 Differences Between the Three Distro Families

All three are Linux, but the gap in "which tools you reach for" is far wider than the gap in the kernel itself. Every command comparison in later chapters anchors on this table:

| Scenario | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|----------|---------------|------|-------------------|
| Package management | `apt` / `dpkg` | `pacman` | `dnf` / `rpm` |
| Third-party extensions | PPA | AUR (`yay`/`paru`) | EPEL, RPM Fusion |
| Update model | Fixed release + point upgrades | Rolling release | Fixed release + minor upgrades |
| Typical kernel naming | `6.8.0-generic` | `6.x.x-arch1-1` | `5.14.0-362.el9` |
| `/bin/sh` implementation | `dash` | `bash` | `bash` |
| Default mandatory access control | AppArmor | No default config | SELinux (enforcing) |

## 6. In Practice: Inspecting System Information

The commands below cover everything you look at first when you pick up an unfamiliar machine. File them by category; every output is short and readable as-is:

| Category | Command | What to read |
|----------|---------|--------------|
| Kernel | `uname -r` / `uname -a` | Version, architecture, hostname, build info |
| Distro | `cat /etc/os-release` | `ID=`, `VERSION_ID=` (common to all three families) |
| Distro | `lsb_release -a` | Debian/Ubuntu only, not always preinstalled |
| Host | `hostnamectl` | Hostname, uptime, virtualization type |
| CPU | `lscpu` | Cores, threads, virtualization flags |
| Memory | `free -h` | Total, available, cache (raw values in `/proc/meminfo`) |
| Block devices | `lsblk` | Disks, partitions, mount points |
| Hardware inventory | `lspci` / `lsusb` | PCI devices / USB devices |

Run `uname -a && cat /etc/os-release | head -3` first and you get the two most important answers -- kernel and distro -- in one shot. Look up the rest as needed; there is no reason to dump everything every time.

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - Volume 1 -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/)
- Arch Wiki - General recommendations -- [wiki.archlinux.org](https://wiki.archlinux.org/title/General_recommendations)
- The Linux Kernel documentation -- [kernel.org](https://www.kernel.org/doc/html/latest/)
- Linux man pages -- [man7.org](https://man7.org/linux/man-pages/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [what_is_linux](/basic/introduction/what_is_linux.md)
- [coverage-matrix](/research/coverage-matrix.md)
