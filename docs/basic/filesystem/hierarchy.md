# Directory Hierarchy

Linux defines its directory structure according to the FHS (Filesystem Hierarchy Standard). The point of the FHS is not rote memorization of "which file goes where"; it answers a set of engineering questions: **which directories change across distribution upgrades, which belong to users, which get wiped at boot, and which must be available before the root filesystem is even mounted.** Once you understand *why* each top-level directory exists, you can jump straight to the right directory when triaging "disk full," "config changed but did not take effect," or "will a reinstall wipe my data" — instead of `find`-ing the whole disk.

> Content adapted from FHS 3.0, the Arch Wiki, and the Debian manual; see the references at the end.

## What This Chapter Covers

- Explain the existence rationale and mutability (is it wiped on reboot) of every FHS top-level directory
- The three-family differences and typical files in `/etc`, `/usr`, `/var`, and `/proc`
- Why usr-merge (`/bin` -> `usr/bin`) became the common choice for all three families

## 1. Directory Structure at a Glance

```text
/
├── bin -> usr/bin        # basic commands (after usr-merge this is a symlink to /usr/bin)
├── sbin -> usr/sbin      # system administration commands (same)
├── lib -> usr/lib        # shared libraries (same)
├── boot                  # boot files: kernel, initramfs, GRUB config
├── dev                   # device files (block devices, character devices)
├── etc                   # machine-specific configuration files
├── home                  # user home directories
├── media                 # auto-mount points for removable media (optical, USB)
├── mnt                   # temporary manual mount points
├── opt                   # third-party large software
├── proc                  # process and kernel info (virtual FS, uses no disk)
├── root                  # root user's home directory
├── run                   # runtime data since this boot (cleared on reboot)
├── srv                   # data exposed by services (website content, etc.)
├── sys                   # kernel object model / device model (virtual FS)
├── tmp                   # temporary files (may be cleared on reboot)
├── usr                   # system programs and data (read-only, changes with upgrades)
└── var                   # mutable data: logs, caches, package database
```

Below, each directory is expanded by *why it exists* rather than reciting its name.

## 2. Why Each Top-Level Directory Exists

### 2.1 `/etc` — The Sole Authority for Local Configuration

**Why it exists**: the same `/usr` binaries may sit on a thousand machines, but each machine's hostname, IP, timezone, and service toggles will inevitably differ. The FHS dumps everything "that varies per machine" into `/etc`, so `/usr` can stay shareable/read-only across machines.

- `/etc/passwd`, `/etc/shadow`, `/etc/group` — user and password databases
- `/etc/fstab` — the boot-time mount table (a mistake here affects boot)
- `/etc/ssh/sshd_config` — the SSH service configuration
- `/etc/hostname`, `/etc/hosts`, `/etc/resolv.conf` — hostname and name resolution
- `/etc/os-release` — the distribution identifier (all three families ship it; the generic entry point for scripts to detect the distro)

**Key constraint**: `/etc` should **not hold program binaries**, only configuration; and it should **not hold large data that changes frequently** (that is `/var`'s job).

### 2.2 `/usr` — The "System Proper" That Rides Along With Distro Upgrades

**Why it exists**: the historical baggage of the name (user — originally the "user" of "multi-user system resources," not "the user's"), today's meaning is: **every program, library, and document installed by default lives here, and it should be treated as read-only, maintained solely by the package manager.**

- `/usr/bin` — regular commands (`ls`, `gcc`, `python3`)
- `/usr/sbin` — administrative commands (`sshd`, `reboot`; some distros have merged these into `bin`)
- `/usr/lib` — shared libraries and kernel modules
- `/usr/share` — architecture-independent data (help docs, icons, static resources outside the timezone tree)
- `/usr/local` — software **installed manually by an administrator**, kept isolated from the package manager's `/usr` so a system package upgrade will not accidentally damage it

**Decision consequences**: `pacman -Syu` / `apt upgrade` / `dnf update` replace `/usr` files in bulk. So **never hand-edit configuration under `/usr`** (the next upgrade overwrites it), and never `cp` a binary you compiled directly into `/usr/bin` (that fights the package manager over file ownership) — put it in `/usr/local` or install it through the package manager.

### 2.3 `/var` — Everything That Changes

**Why it exists**: as the counterpart to read-only `/usr`, `/var` holds data that grows and is overwritten at runtime. Separating the two lets `/usr` be deployed as a read-only snapshot, and lets `/var`'s growth fail to blow past the system disk quota (on servers, giving `/var` its own partition is routine).

- `/var/log/` — logs (`syslog`, `messages`, `journal/`)
- `/var/cache/` — package manager and application caches
- `/var/lib/` — **persistent state databases for services**; this layer deserves special memorization:

| Distribution | Package database | Package cache |
|--------|-------------|--------|
| Debian/Ubuntu | `/var/lib/dpkg/` | `/var/cache/apt/archives/` |
| **Arch** | **`/var/lib/pacman/`** | **`/var/cache/pacman/pkg/`** |
| RHEL/CentOS/Rocky | `/var/lib/rpm/` | `/var/cache/dnf/` |

Arch's `pacman -Q` queries the installed-package records in `/var/lib/pacman/local/`; if you clear `/var/cache/pacman/pkg/` while reclaiming disk, what you lose is the ability to "downgrade back to an older version" (the `pacman -U` local package cache) — the database itself must never be deleted.

### 2.4 `/home` — Separating User Data from the System

**Why it exists**: to decouple the lifecycle of "personal files" from "system files." On a reinstall, format `/` but keep `/home`, and your documents and configs (`~/.bashrc`, SSH keys, browser profiles) survive; on servers, a separate `/home` partition also enables differentiated quota and backup policy.

- One subdirectory per regular user: `/home/alice/`
- root's home directory is **not** in `/home` but in `/root` — guaranteeing that an administrator can still log in to repair the system even if `/home` is on a separate partition that failed to mount

### 2.5 `/boot` — The Minimal Set Needed to Boot

**Why it exists**: the bootloader runs before the operating system is even up, so it needs to independently read the kernel image and initramfs. Managing this separately (or at least under its own directory) lets the bootloader still find the files under complex layouts such as an encrypted root or Btrfs.

- `/boot/vmlinuz-*` — the kernel
- `/boot/initramfs-*` (called `initramfs` on the RHEL family, `initrd.img` on Debian/Arch) — early user space
- `/boot/grub/` — GRUB configuration and fonts
- `/boot/efi/` — the ESP mount point under UEFI (some distros mount `/efi` directly)

**Gotcha**: a full `/boot` is what breaks `apt upgrade`/`dnf update` — a pile of stale kernels is the most common cause, so clean out old versions from `/boot` periodically.

### 2.6 `/dev` — Devices as Files

**Why it exists**: to implement "everything is a file." Without a file representation of devices, user programs could not operate on them uniformly via `open()`/`read()`/`write()`.

- Block devices: `/dev/sda`, `/dev/nvme0n1`, `/dev/loop0` (`b` type)
- Character devices: `/dev/tty`, `/dev/null`, `/dev/zero`, `/dev/random` (`c` type)
- Created dynamically by **udev**, not statically laid down at install time — which is why a hot-plugged USB stick shows up as a new `/dev/sdb`

### 2.7 `/proc` and `/sys` — Windows Into the Kernel

Both are virtual filesystems that use no disk space; they are the interface through which the kernel exposes state to user space:

```bash
cat /proc/cpuinfo       # CPU details
cat /proc/meminfo       # memory details
cat /proc/version       # kernel version
cat /proc/<PID>/status  # a single process's state
ls /sys/block/          # block devices
ls /sys/class/net/      # network interfaces
```

**Why they exist**: rather than inventing a dedicated system call for every kind of state, make everything a file — then the ready-made tools `cat`, `grep`, and pipes become immediately usable. This is the most thorough realization of the "everything is a file" philosophy.

### 2.8 `/run` and `/tmp` — The Two Shortest-Lived Layers

- **`/tmp`**: temporary files writable by any user. On systemd distros (Arch, Ubuntu, RHEL 8+), it may well be a **tmpfs (RAM disk)** by default and wiped on reboot — putting important files here is the same as not saving at all.
- **`/run`**: runtime data for this boot session (PID files, locks, sockets). `/var/run` is a compatibility symlink to it. **It is guaranteed to be cleared after reboot**, which is why daemon pid files go here: a stale pid left over from a previous crashy exit cannot interfere with this boot.

Together they answer one FHS question: **"which data should automatically disappear after a reboot?"** — keeping them apart from `/var` means you never have to rely on manual `rm` to sweep away garbage.

### 2.9 The Remaining Directories

| Directory | Reason for existing |
|------|---------|
| `/bin`, `/sbin`, `/lib*` | Historically "the commands needed for a minimal system to self-rescue," kept independent of `/usr` so repairs remain possible before the root partition is fully mounted; after usr-merge they degrade into symlinks to `/usr/*` (see section 3) |
| `/media` | Where the desktop environment **automatically** mounts removable media (the icon that appears when you plug in a USB stick points here) |
| `/mnt` | The convention of empty directories for **administrator-initiated manual** mounts (temporarily mounting a data disk or network storage) |
| `/opt` | Self-contained directories for third-party proprietary/large software (certain commercial databases, `/opt/google/chrome`), kept separate from the package manager's `/usr` |
| `/srv` | Data this machine exposes to the outside world (`/srv/www`, `/srv/ftp`); recommended by the FHS, though in practice many distros' Apache/Nginx still use `/var/www` |
| `/root` | root's home directory, isolated from `/home` so login still works if the `/home` mount fails |

## 3. usr-merge: Three Families, One Road

On a freshly installed Debian/Ubuntu, Arch (since 2023), or RHEL 9, run:

```bash
ls -ld /bin /sbin /lib
# lrwxrwxrwx 1 root root 7 ... /bin -> usr/bin
# lrwxrwxrwx 1 root root 8 ... /sbin -> usr/sbin
# lrwxrwxrwx 1 root root 7 ... /lib -> usr/lib
```

**Why merge them**: historically `/bin` and `/usr/bin` duplicated each other (both had `ls`), and independent partitions plus independent upgrade paths produced countless consistency bugs. usr-merge makes `/usr` the only real thing, with `/bin` merely a compatibility symlink for old scripts — this supports a deployment model where "all of `/usr` is read-only and upgrades happen via atomic swap."

**Impact on you**: almost none; paths work exactly as before. The one thing to note is **do not manually delete symlinks like `/bin`**, and do not stuff private stuff into `/bin` thinking it is a standalone directory — it *is* `/usr/bin`.

## 4. Differences Across the Three Families

The FHS only fixes the skeleton; the flesh on the skeleton differs by family:

| Directory | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Network config | `/etc/netplan/*.yaml` | `/etc/systemd/network/` or NetworkManager | NetworkManager (network-scripts removed since RHEL 9) |
| Apache config | `/etc/apache2/` | `/etc/httpd/` (official repos) | `/etc/httpd/` |
| Main log file | `/var/log/syslog` | `/var/log/messages` (or journald) | `/var/log/messages` |
| Package database | `/var/lib/dpkg/` | `/var/lib/pacman/` | `/var/lib/rpm/` |
| Source config | `/etc/apt/sources.list*` | `/etc/pacman.conf` + `/etc/pacman.d/mirrorlist` | `/etc/yum.repos.d/` |
| Extra-repo mechanism | `sources.list.d/` + PPA | AUR (user repos, PKGBUILD) | EPEL and other `.repo` files |

When writing scripts, do not guess paths to detect the distro — read `/etc/os-release` (all three families ship it; source it with `. ` and use `$ID` and `$VERSION_ID`; Arch has no version number, `ID=arch`, and is rolling).

## 5. /etc and /var Quick Reference

```bash
# User, group, and distro info (the generic entry point for scripts to detect the distro)
cat /etc/passwd | head -3
grep wheel /etc/group
sudo cat /etc/shadow | head -2
cat /etc/hostname
. /etc/os-release && echo "$ID $VERSION_ID"
# ubuntu 24.04
# arch  rolling      ← Arch has no version number, ID=arch
# rocky 9.4

# First stop when the disk is full: logs and caches
du -sh /var/log/* | sort -hr | head
ls /var/cache/apt/archives | wc -l    # number of cached debs on Debian/Ubuntu
du -sh /var/cache/pacman/pkg          # size of the Arch package cache
```

## 6. Common Pitfalls

- **Hand-editing configuration under `/usr`** — the next `pacman -Syu`/`apt upgrade` overwrites it outright. Configuration lives in `/etc`; third-party software goes in `/opt` or `/usr/local`.
- **Writing important data into `/tmp`** — on systemd distros, a reboot may clear the tmpfs; code that is not saved is gone.
- **Treating logs as part of `/usr` and cleaning accordingly** — logs live in `/var/log`; when a `/var` full condition is crashing services, check the log directory first, then `/var/lib/<service>`.
- **Deleting `/var/lib/pacman` or `/var/lib/dpkg`** — this is the package manager's ledger. Deleting it means total amnesia about "what the system has installed," with an extremely high repair cost. To clear caches use `pacman -Scc` / `apt clean` — they touch only `cache`, never `lib`.
- **Believing `/bin` is a standalone directory** — after usr-merge it is a symlink; operations like "back up `/bin`" must recognize that it and `/usr/bin` are the same data.
- **Editing `/etc/resolv.conf` and seeing no effect** — many distros have NetworkManager/systemd-resolved take over this file and overwrite manual edits; change it in the NetworkManager connection config or in `resolved.conf` instead.
- **Wrong mount point order in fstab** — mount `/` before `/home`/`/var`; a subdirectory must always come after its parent. Reversed ordering causes the boot mount to fail.

## References

- FHS 3.0 — [refspecs.linuxfoundation.org](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html)
- Arch Wiki - File system hierarchy — [wiki.archlinux.org](https://wiki.archlinux.org/title/Filesystem_Hierarchy_Standard)
- Arch Wiki - pacman / local database — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Debian Reference - Filesystem hierarchy — [debian.org](https://www.debian.org/doc/debian-reference/ch02.zh-cn.html)
- `man hier`, `man 7 file-hierarchy` (systemd)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [filesystem](/basic/filesystem.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
