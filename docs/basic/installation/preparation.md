# Pre-installation Preparation

Very little of what goes wrong during installation is genuinely "technical"; the overwhelming majority of losses happen **before** the install: formatting a whole disk without backing up, a boot mode that does not match the partition table leaving the machine unbootable afterward, or dd writing to the wrong device name and wiping an external drive. The goal of this section is to walk the complete checklist that precedes every irreversible action — by the time you press "Start installation", hardware, boot mode, installation media, and data backup should all be confirmed.

> Content adapted from Arch Wiki Installation guide#Pre-installation, the Debian installation manual, and Bird's Private Recipes (Lin's Linux Administration Guide); see the references at the end.

## What This Page Covers

- Using `lscpu`, `free -h`, and `lsblk` to quickly assess whether the hardware is sufficient
- Distinguishing UEFI from Legacy BIOS, and determining which mode the current machine actually runs in
- Creating a bootable USB on Windows/macOS/Linux
- Building the muscle memory of "back up before touching a disk"

## 1. Hardware Check: Why Look at Specs First

Linux itself has modest hardware requirements — a minimal server install boots with 512 MB of memory. But the **desktop environment** is the memory hog: GNOME 3 can eat over 1.5 GB at idle. Measure the hardware first, so you can settle the prior decision of "desktop or server install".

Run this on an existing system (or after booting a Live USB into try mode):

```bash
lscpu | head -15
free -h
lsblk -o NAME,SIZE,TYPE,MOUNTPOINT
```

A real output excerpt (`lsblk` shown; you can see the typical ESP/swap/root layout):

```bash
$ lsblk -o NAME,SIZE,TYPE,MOUNTPOINT
sda    476.9G disk
├─sda1   512M part /boot/efi
├─sda2    16G part [SWAP]
└─sda3 460.4G part /
```

Reference thresholds:

| Component | Minimum (server / minimal install) | Recommended (daily desktop use) |
|-----------|------------------------------------|---------------------------------|
| CPU | 1 GHz single core (64-bit) | 2 GHz dual core+ |
| Memory | 1 GB (no desktop) | 4 GB+ (8 GB suggested for GNOME/KDE) |
| Disk | 10 GB | 25 GB+ (desktop plus common software) |
| Network | Internet-capable (downloads updates during install) | Wired is more reliable; configure Wi-Fi after install |

One point often overlooked: **check whether the disk already holds data, an existing Windows, or another Linux**. If `lsblk` shows mounted partitions, the disk is in use by the current system, and choosing "erase disk" during install will wipe those partitions.

## 2. Determine Boot Mode: UEFI or Legacy

This is the **single most critical judgment** before installing, because it decides the partition table type (GPT or MBR) and whether a boot partition exists at all. The consequence of getting the mode wrong is not "cannot install" but "installs fine, then cannot boot" — BIOS firmware cannot read MBR boot code that a GPT disk lacks, and UEFI firmware cannot read the boot sector of a Legacy partition.

### 2.1 The Essential Difference Between the Two Modes

| Mode | Partition table | Boot location | Boot partition | Typical firmware setting names |
|------|-----------------|---------------|----------------|--------------------------------|
| UEFI | GPT | `.efi` files in the EFI system partition (ESP) | Required, FAT32, usually 512 MB mounted at `/boot/efi` | "UEFI", "Windows Boot Manager" |
| Legacy BIOS | MBR | Master boot record (MBR) at the head of the disk + partition boot records | No separate partition needed | "Legacy", "CSM", "BIOS" |

### 2.2 Determining the Current Mode

From an existing Linux system or a live environment:

```bash
# Current mode: output present = UEFI, "No such file" = Legacy
ls /sys/firmware/efi

# Disk partition table type: Disklabel type: gpt pairs with UEFI, dos with Legacy
sudo fdisk -l /dev/sda | head -3
```

On Windows, `msinfo32` shows whether "BIOS mode" is UEFI or Legacy, and Disk Management shows whether a disk is "GPT" or "MBR". **Key principle: a fresh install should stay consistent with the disk's existing partition table and the firmware mode.** Installing a GPT disk in Legacy mode (or the reverse) is possible but adds confusion, and Windows 11 additionally mandates UEFI + GPT + Secure Boot.

### 2.3 Secure Boot

UEFI machines usually also carry a Secure Boot toggle. The distribution bootloaders of Ubuntu, Fedora, and Rocky are signed with Microsoft keys, so Secure Boot **can stay on** during install; but the Arch official ISO's bootloader is unsigned by default, and self-compiled kernels also require registering your own keys — at the beginner stage it is advisable to disable Secure Boot for the install, then study how to re-enable it afterward.

## 3. Back Up Data: The Last Confirmation Before Touching a Disk

If the disk you are about to install to holds any data you cannot afford to lose — documents, photos, SSH keys, browser bookmarks, project repositories — **back it up before continuing**. "Erase the entire disk" and "let me think again" cannot coexist.

- Full backup: `tar`/`rsync` the entire home directory or partition to an external drive or network storage
- Repository backup: confirm every git working tree has been pushed to its remote
- Browser/mail: export bookmarks, take mail offline
- Dual-boot scenario: note that Windows "Fast Startup" locks the NTFS partition; shut Windows down properly once before entering Linux, otherwise Linux cannot mount that disk and it is easily mistaken for a dead drive

There is no "undo a format" command. This point cannot be overstated.

## 4. Creating a Bootable USB

### 4.1 Windows: Rufus or balenaEtcher

[Rufus](https://rufus.ie/) is the most hassle-free choice on Windows; mind two options:

- **Partition type**: choose GPT (for UEFI) or MBR (for Legacy), consistent with the determination from the previous step
- **Target system**: UEFI (non CSM) or BIOS
- Write mode: choose **ISO image mode** (the default); some old machines with poor compatibility need DD image mode instead

[balenaEtcher](https://www.balena.io/etcher/) is cross-platform with a simple interface; the drawback is that you cannot choose the partition table type (it writes according to the ISO structure by default, which usually still boots).

### 4.2 Linux: dd

Writing with `dd` on Linux is the most direct route, but **one wrong device name and the disk you destroy is that one**. Three steps: first `lsblk` to confirm the USB stick's device name and capacity, then write, then `sync` to flush.

```bash
# 1. After plugging in the USB stick, confirm the device name — read the capacity, do not guess:
#    sda 476.9G is the system disk, leave it alone; sdb 7.3G is the USB stick
lsblk

# 2. Unmount auto-mounted partitions, then write. of= takes the whole-disk device (/dev/sdb);
#    writing /dev/sdb1 only writes into the partition, and in most cases it will not boot
sudo umount /dev/sdb1
sudo dd if=ubuntu-24.04-desktop-amd64.iso of=/dev/sdb bs=4M status=progress conv=fsync

# 3. Make sure every write buffer has hit the disk
sync
```

`status=progress` shows write progress and speed in real time; `conv=fsync` forces a flush at the end. After the write completes, run `lsblk` again — seeing the USB stick's partition show up as an ISO9660 filesystem means success.

### 4.3 macOS

macOS ships `dd` with the same syntax, but balenaEtcher is the better recommendation — graphical, and it auto-ejects when done. Note that macOS may mount the USB stick as `/dev/diskN` rather than `/dev/sdN`; confirm with `diskutil list`, then `diskutil unmountDisk /dev/diskN` and `dd of=/dev/rdiskN` (the raw device is faster).

### 4.4 Verifying the Write

The verification idea is the same on all three platforms: unplug and replug, confirm the partition mounts and its contents match the ISO layout; if you can, boot the ISO once in a virtual machine first — it saves the trial-and-error time on real hardware.

## 5. Network and Mirror Sources (Worth Preparing in Advance)

Most installers download updates over the network; wired is the least trouble. Under domestic network conditions, deciding on a mirror in advance makes the first post-install update an order of magnitude faster:

- **Debian/Ubuntu**: you can skip the network mirror selection inside the installer, then switch `/etc/apt/sources.list` (on Ubuntu 24.04+, `/etc/apt/sources.list.d/ubuntu.sources`) to the TUNA/USTC mirrors after install
- **Arch**: during installation, configure `/etc/pacman.d/mirrorlist` to domestic mirrors **before** `pacstrap` pulls packages, otherwise the database sync may time out
- **RHEL/Rocky**: the official sources require registration by default (from Rocky 8 onward, `/etc/yum.repos.d/rocky.repo` works directly with the free official sources, no subscription manager needed); the TUNA mirror is another option

## 6. Common Pitfalls

- **dd writing to the wrong device** — the most classic and most painful pitfall. Always `lsblk` and match capacities first; `of=` takes the whole-disk device (`/dev/sdb`), not a partition (`/dev/sdb1`).
- **Boot mode mismatching the partition table** — UEFI with MBR, or Legacy with GPT, may raise no error in the installer and only blow up at reboot. Double-check with `ls /sys/firmware/efi` and `fdisk -l` before installing.
- **Not unplugging other disks** — on a desktop with several disks, the installer may put the bootloader on the wrong one, or format a disk it should not touch. Unplugging irrelevant disks before installing is the safest move.
- **Forgetting BitLocker / a locked BitLocker** — disks with Windows BitLocker enabled cannot be read or written normally under Linux; in dual-boot scenarios, suspend BitLocker in Windows first.
- **Using a phone USB hotspot as the install network** — most installers cannot handle hotspots that require authentication, and a mid-install disconnect is worse; go wired, or use a router that can provide a hotspot.
- **Pulling the USB stick before the write truly finishes** — pulling it out when `dd` was run without `sync`/`conv=fsync` and before progress reached 100% yields a stick that looks written but is missing the tail of the data.

## References

- Arch Wiki - Installation guide (Pre-installation) — [wiki.archlinux.org](https://wiki.archlinux.org/title/Installation_guide)
- Arch Wiki - USB flash installation media — [wiki.archlinux.org](https://wiki.archlinux.org/title/USB_flash_installation_media)
- Arch Wiki - UEFI, Secure Boot — [wiki.archlinux.org](https://wiki.archlinux.org/title/UEFI)
- Debian Installation Manual — [debian.org](https://www.debian.org/releases/stable/installmanual)
- Ubuntu installation tutorial — [ubuntu.com](https://ubuntu.com/tutorials/install-ubuntu-desktop)
- Bird's Private Recipes (Lin's Linux Administration Guide) - preparing to install Linux — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0157installcentos7.php)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [installation](/basic/installation.md)
- [coverage-matrix](/research/coverage-matrix.md)
