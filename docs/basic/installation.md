# Installing Linux

Installation is the first threshold on the way into the Linux world, and also the step where one wrong move costs the most: pick the wrong distribution and you spend the next two years wrestling with tools that do not fit you; partition badly and you may lose data; botch the bootloader and the machine will not boot at all. This chapter does not aim to make you memorize every button of every installer — it lays out a transferable decision framework. Once you understand **why** each step exists, you can read what Ubuntu's graphical installer, Arch's archinstall script, or Rocky's Anaconda is asking, no matter which one is on screen.

> Content adapted from the Arch Wiki Installation guide, the Debian installation manual, and Bird's Private Recipes (Lin's Linux Administration Guide); see the references at the end.

## What This Chapter Covers

- Understanding the positioning differences among the three major distribution families
- Getting familiar with pre-install hardware checks, boot mode determination, and data backup methods
- Mastering the trade-offs of partitioning schemes (EFI, swap, /home, btrfs subvolumes)
- Walking through both the UEFI and Legacy boot paths
- Knowing who Arch's archinstall and manual installation (pacstrap) each suit

## Sub-page Guide

| Section | One-line summary | Questions to bring when reading |
|---------|------------------|---------------------------------|
| [Choosing a Suitable Distribution](./installation/choose_distribution.md) | Decide by role, update cadence, and package ecosystem, with a three-family comparison and mirror download verification | "Should I install Ubuntu, Arch, or Rocky after all?" |
| [Pre-installation Preparation](./installation/preparation.md) | Check hardware, determine UEFI/Legacy, build the bootable USB, back up data — confirm every precondition before irreversible operations | "Why can't the installer see my disk / why won't the machine boot after install?" |
| [The Installation Process](./installation/process.md) | The complete flow from booting the installer through partitioning, bootloader, network configuration, and the first update, covering graphical installers and the Arch manual approach | "What is each step doing? Why partition this way?" |

The table above is ordered as: choosing, preparing, installing. If you have already settled on a distribution, jump straight to its installation flow; boot mode and data backup remain the key pre-install checkpoints either way, and a large share of failed installs traces back to exactly those two spots.

## Pre-installation Checklist

Whichever distribution's installer you use, run through this checklist in the live environment (or your existing system) before entering the installer. Clicking "Next" without confirming these three things is the most common way to wreck an install: **boot mode mismatch, disk not recognized, no data backup**.

```bash
# 1. Confirm boot mode: output present = UEFI, no output = Legacy/CSM
ls /sys/firmware/efi && echo "UEFI mode" || echo "Legacy mode"

# 2. Confirm disks and partition tables: a disk the installer cannot see usually shows up here
lsblk -f
sudo fdisk -l          # or parted -l
# Note whether the disk is GPT or MBR, and whether that matches the boot mode

# 3. Confirm network (needed by installers that download packages)
ip addr                # or ip link
ping -c 3 8.8.8.8      # basic connectivity
ping -c 3 archlinux.org  # whether domain names resolve (DNS)

# 4. Confirm memory and architecture (archinstall and some installers have memory requirements)
free -h
uname -m               # x86_64 or aarch64 — decides which image to download

# 5. Confirm the target disk holds no data you need to keep
sudo wipefs -l /dev/sda  # read-only view of signatures, changes nothing
```

Three decision points to memorize up front: **on UEFI machines use GPT + an EFI system partition (ESP, 512 MB or larger recommended, fat32)**; **on Legacy machines use MBR + a BIOS boot partition (only needed for BIOS+GPT)**; **on dual-boot machines, always confirm the existing partition table type and the disks Windows occupies first** — do not let your hand slip onto "erase entire disk" inside the installer. The backup principle is simpler still: files in `/home` and on the desktop must already be copied to external media before a reinstall — an installer's "keep data" option is not a zero-risk guarantee.

## Installation Methods: The Three Families at a Glance

The differences in install experience across the three distribution families come down to one question: "who makes the decisions for you":

| Dimension | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|-----------|---------------|------|-------------------|
| Installer | Subiquity (Ubuntu Server/new desktop), Debian net-installer in graphical/text mode | archinstall guided script, or fully manual (partition → pacstrap → chroot) | Anaconda (graphical, or automated via Kickstart) |
| Partitioning granularity | The graphical wizard can "erase disk" in one click; manual partitioning also supported | Almost entirely manual — you create partitions, format, and mount yourself | Custom partitioning supported; LVM/software RAID common in server scenarios |
| Boot default | GRUB 2, auto-detects Windows | Install GRUB or systemd-boot yourself, no auto-detection | GRUB 2 (`grub2-mkconfig`) |
| First update | `sudo apt update && sudo apt upgrade` | `sudo pacman -Syu` (full upgrade mandatory, partial upgrades forbidden) | `sudo dnf update` |
| Desktop environment | GNOME by default, selectable in the installer | Bare command line after install; desktops assembled one by one with `pacman -S gnome` | Minimal install by default; desktops need an extra group install |
| Learning curve | Gentle, and the most help available online when things break | Steep, but one pass teaches you the whole chain from partitioning to boot | Moderate, centered on SELinux, LVM, and other enterprise features |

All three end up as the same kind of system — "kernel + GNU tools + package manager" — and everyday commands are nearly interchangeable; the differences concentrate in **package format** (deb / pacman packages / rpm), **upgrade cadence** (fixed LTS releases / rolling updates / slow enterprise pace), and **community support orientation**. Understanding those three points is worth more than memorizing installer menu orders.

Right after the first boot into a finished install, each family has its own "three must-dos" — the order is nearly identical, the commands differ slightly:

| Step | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 1. First full update | `sudo apt update && sudo apt upgrade -y` | `sudo pacman -Syu` (full upgrade mandatory) | `sudo dnf update -y` |
| 2. Confirm network services | `systemctl status NetworkManager` or `netplan status` | `systemctl status systemd-networkd` / `dhcpcd` | `systemctl status NetworkManager` |
| 3. Confirm SSH works (servers) | `sudo apt install openssh-server && sudo systemctl enable --now ssh` | `sudo pacman -S openssh && sudo systemctl enable --now sshd` | `sudo dnf install openssh-server && sudo systemctl enable --now sshd` |

Note Arch's `pacman -Syu`: a rolling distribution **forbids partial upgrades** (`-Sy` without `-u`), otherwise you easily land in a half-upgraded state with mismatched library versions — one of Arch's most classic pitfalls. On the RHEL family, also mind the semantic difference between `dnf update` and `dnf upgrade` on older CentOS; in Rocky/newer RHEL the two have converged.

## Common Problems Preview

Help-wanted posts around installation are the same few categories over and over; we register them here and expand the details in the sub-pages:

1. **After install the machine drops straight into BIOS/GRUB rescue** — usually a mismatch between UEFI/Legacy mode and the disk partition table, or the bootloader written to the wrong disk/mode. The test is whether `ls /sys/firmware/efi` produces output.
2. **The installer shows no disk at all** — on old machines possibly RAID/Intel RST mode; on new machines the disk may be unpartitioned or occupied by a previous system's LVM volume group.
3. **Dual boot left with only Linux or only Windows** — a GRUB detection-order issue, or the bootloader written to the wrong place during install (into Windows's ESP instead of managing it independently).
4. **System boots but has no network** — server installs often ship without NetworkManager; you need to bring up `dhcpcd`/`systemd-networkd` or nmcli by hand.
5. **Arch reports missing operating system after the post-install reboot** — `grub-install` was forgotten during the manual install, or on EFI the boot files never made it into the ESP.
6. **Ubuntu hangs on a black screen saying "installation complete, please restart"** — often related to NVIDIA proprietary drivers or Secure Boot; try unchecking "install third-party drivers" in the installer first.

The root cause of every one of these traces back to a knowledge point in this chapter — which is exactly why we insist on "the why first".

## References

- Arch Wiki - Installation guide — [wiki.archlinux.org](https://wiki.archlinux.org/title/Installation_guide)
- Arch Wiki - archinstall — [wiki.archlinux.org](https://wiki.archlinux.org/title/Archinstall)
- Debian Release - Installation manuals — [debian.org](https://www.debian.org/releases/stable/installmanual)
- Ubuntu Desktop installation tutorial — [ubuntu.com](https://ubuntu.com/tutorials/install-ubuntu-desktop)
- Rocky Linux installation guide — [docs.rockylinux.org](https://docs.rockylinux.org/guides/installation/)
- Bird's Private Recipes (Lin's Linux Administration Guide) - multi-boot installation and boot management — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0157installcentos7.php)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
