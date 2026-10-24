# The Installation Process

Installation is essentially the execution of a chain of **irreversible decisions**: which disk, how many partitions, where the bootloader goes, which desktop. The installer pops up options at every step but rarely tells you "what happens if you choose wrong". This section follows the real-world order — from pressing the power button and picking the boot medium, to the first successful reboot after the install — focusing on the consequences of each decision, and separately covering the Debian/Ubuntu graphical installer, RHEL/Rocky's Anaconda, and both of Arch's paths: archinstall and manual installation (pacstrap).

> Content adapted from the Arch Wiki Installation guide, the Debian installation manual, and the official Ubuntu documentation; see the references at the end.

## What This Page Covers

- The differences between the UEFI and Legacy boot paths, and how they constrain the partitioning scheme
- Being able to explain why each partition exists (ESP, /boot, swap, /home, btrfs subvolumes)
- Walking through the Ubuntu/Debian/Rocky graphical install flows plus Arch's archinstall and manual approaches
- Getting familiar with the three post-install musts: install the bootloader, configure the network, run the first full update

## 1. Booting the Installer

Plug in the bootable USB and power on, press the boot hotkey (commonly `F12`, `F2`, `Del`; on desktops usually `F12` to bring up the one-time boot menu) and choose to boot from USB. The judgment here comes from the preparation section: **whether the firmware is UEFI or Legacy** decides whether you pick the entry labeled "UEFI" or the plain one. Picking wrong usually still gets you into the installer, but the later partitioning and bootloader steps are now primed to fail — the installer sometimes silently partitions in the wrong mode, and you only discover at reboot that the system will not start.

Most distribution ISOs offer both a "Try / Install" entry. **Enter Try mode first to confirm that network, graphics, and disks are all detected properly, then click Install** — this minimizes the waste of "discovering a driver problem halfway through the install". While in try mode, run the preparation section's `lsblk` and `ls /sys/firmware/efi` and write the conclusions down.

## 2. UEFI vs Legacy: Why This Judgment Runs Through Everything

The difference between the two boot modes goes beyond "how the machine starts" — it decides how the whole disk is laid out:

| Aspect | UEFI | Legacy BIOS |
|--------|------|-------------|
| Partition table | GPT | MBR (at most 4 primary partitions, or 3 primary + 1 extended) |
| Boot files | `/EFI/<vendor>/grubx64.efi` and friends in the ESP partition (FAT32) | 446 bytes of boot code at the head of the MBR + the active partition's boot sector |
| Separate boot partition needed | Yes (usually 512 MB, mounted at `/boot/efi`) | No (boot code is written straight into the MBR) |
| Large disk support | Disks > 2 TB usable | MBR caps at 2 TB |
| Secure Boot | Supported (signed bootloader required) | Not supported |
| Dual-boot coexistence | Naturally consistent with Windows 10/11 | Increasingly rare on new machines |

**Consequences**: if you confirmed in the preparation stage that `ls /sys/firmware/efi` produces output (UEFI), then the first partitioning step must create a FAT32 ESP, and the installer must write its boot files into that ESP; conversely, in Legacy mode there is no ESP and the bootloader goes into the MBR. The classic symptom of mixing them up is "after install, reboot shows no bootable device", or dropping straight back into the firmware setup screen.

Modern machines (laptops and branded desktops of the last decade, anything shipped with Windows 10/11) are almost all UEFI + GPT; this section explains things in UEFI terms by default and marks Legacy only where it differs.

## 3. Partitioning Schemes: Why Each Partition Is What It Is

Partitioning is not a ritual — it is the physical separation of three things: **boot, system, data**. The payoff is concrete: when reinstalling the system you can format only the root partition and keep everything under `/home`; a separate `/boot` gives the bootloader a home regardless of how encrypted/unencrypted filesystems are arranged; a standalone swap makes resizing later easy.

### 3.1 A Minimal Working UEFI Layout

| Partition | Size | Filesystem | Mount point | Why it is needed |
|-----------|------|------------|-------------|------------------|
| ESP | 512 MB | FAT32 | `/boot/efi` | The only partition UEFI firmware recognizes; holds the bootloader and the kernel's EFI stubs; 512 MB comfortably fits several distributions' boot files |
| root | 20 GB+ | ext4 / XFS / Btrfs | `/` | The system proper; 50 GB or more recommended for desktops |
| swap | = RAM or 2-8 GB | swap | no mount point | Overflow area when memory runs short; also used for hibernation (hibernation needs swap ≥ RAM) |
| home | all remaining space | same as root, or any | `/home` | User data stays independent; on a reinstall you can choose not to format it |

With the common "erase entire disk" choice, modern installers (Ubuntu, Debian, Anaconda) slice this structure automatically — you only confirm the swap size. **The value of a separate /home partition only shows up at the first reinstall**: the root partition gets formatted and rebuilt while documents, configuration, and SSH keys sit untouched.

### 3.2 Why Some People Carve Out a Separate /boot

`/boot` holds the kernel and the initramfs. When the root partition is an encrypted volume, or a filesystem the bootloader cannot read directly (Btrfs/XFS and the like), a small independent partition (ext4 or XFS, around 1 GB) that the bootloader can reach is needed to carry the kernel. With an unencrypted ext4 root, the kernel can simply live in the root partition's `/boot` directory — splitting it out is **not** required; more partitions does not mean more professional, only more mount points to maintain.

### 3.3 Btrfs Subvolume Layout (Optional)

Users who pick Btrfs are usually not showing off snapshots — they are buying the safety line of **snapshot before upgrade + rollback**. The Arch and Ubuntu installers both offer a Btrfs option; a common layout:

| Subvolume | Mount point | Why separate |
|-----------|-------------|--------------|
| `@` | `/` | The root system proper; the target of snapshots/rollback |
| `@home` | `/home` | User data independent of system snapshots |
| `@var_log` (optional) | `/var/log` | Logs survive system rollbacks |
| `@tmp`, `@snapshots` | `/tmp`, `.snapshots` | Scratch space and snapshot storage |

Note that with Btrfs, `/boot` usually still lives on a separate ext4 partition — GRUB's Btrfs support works but the paths are more roundabout; keeping the boot files on a simple filesystem is the safe play.

### 3.4 Manual Partitioning in Practice (Universal)

Whichever installer's "manual partitioning" page you use, the underlying toolset is the same. Taking Arch as the example (graphical installers embed the same `cfdisk`/`fdisk` logic):

```bash
# Partition with cfdisk (GPT); in the interactive UI, in order: New → 512M → change type to EFI System;
# New → most of the remaining space → Linux filesystem; (optional) New → 8G → change type to Linux swap; Write → Quit
sudo cfdisk /dev/nvme0n1

# Format and mount in order (root first, then mount the other mount points into it; same for a /home partition)
sudo mkfs.fat -F32 /dev/nvme0n1p1 && sudo mkfs.ext4 /dev/nvme0n1p2
sudo mkswap /dev/nvme0n1p3 && sudo swapon /dev/nvme0n1p3
sudo mount /dev/nvme0n1p2 /mnt
sudo mkdir -p /mnt/boot/efi && sudo mount /dev/nvme0n1p1 /mnt/boot/efi

# Generate fstab — persist the mount table to disk; skip this step and after reboot "all disks are gone"
sudo genfstab -U /mnt >> /mnt/etc/fstab
# UUID=xxxx-xxxx  /boot/efi vfat  umask=0077 0 2
# UUID=abcd-...   /         ext4  defaults   0 1
```

`genfstab -U` uses UUIDs instead of names like `/dev/sda1` — device names can drift after unplugging or adding disks (sdb becoming sdc), while a UUID never changes; this is the first line of defense against "rebooting into an emergency shell".

## 4. Installation Paths of the Three Families

### 4.1 Ubuntu Desktop (Graphical Wizard)

The flow is linear; three choices matter:

1. **Installation type**: erase entire disk / coexist with Windows / manual partitioning. Before choosing "coexist" for a dual boot, confirm the backup and boot-mode checks from the preparation section are done.
2. **Timezone and keyboard**: pick Shanghai; leave the keyboard at the default English (US) — a Chinese keyboard layout under Linux actually interferes with terminal input.
3. **User and computer name**: keep the hostname short, lowercase letters and digits only (networking, certificates, and scripts all depend on it); the first user is automatically added to the `sudo` group.

The installer pulls language packs and updates with `apt` in the background; when the progress bar finishes, reboot. Ubuntu's GRUB auto-detects Windows and builds the dual-boot menu.

### 4.2 Debian/Rocky (Server Scenarios)

- **Debian net-installer**: a text-mode wizard; the partitioning step offers LVM, encryption, or software RAID. After selecting Chinese as the language, it is advisable to **skip enabling a mirror for now** (most default mirrors are slow on domestic networks) and switch to TUNA after install.
- **Rocky/Anaconda**: the graphical "Installation Summary" on the left is a to-do list — you must click into each item and configure it (date and language, disk partitioning, network, software selection, root password). The server minimal install defaults to **no graphical interface**, and that is deliberate — a server's attack surface and resource footprint should both be minimal. In the network pane, remember to flip the NIC switch on (it defaults to off), otherwise the installed system has no network.

### 4.3 Arch: archinstall and Manual Installation

The Arch official ISO offers two install paths; see the corresponding sections of this page for the concrete steps.

**Route A: archinstall (guided, for getting up and running fast)**

```bash
archinstall
# Four menu items deserve attention: Profile (presets such as desktop/gnome), Filesystem
# (ext4/btrfs with subvolumes and compression/xfs/zfs), Mirror (pick the China region
# first to avoid pacstrap timeouts), Bootloader (systemd-boot or grub)
```

archinstall essentially wraps Route B's steps into dialogs — **only by understanding Route B do you know what it is doing for you at each step** — which is also its value as a learning tool: every time you press Enter, you can match it against a manual command.

**Route B: manual installation (worth following at least once)**

The full chain is: get network → partition and mount → install the base system with `pacstrap` → enter the new system with `arch-chroot` → configure timezone/locale/network → install the bootloader → reboot. Core commands:

```bash
# 1. Get network (iwctl in the live environment; nmcli only exists once the system is installed)
iwctl   # device list → station wlan0 scan → get-networks → connect YourSSID → exit
ping -c 3 mirrors.tuna.tsinghua.edu.cn

# 2. (Continuing from above: after partitioning, mounting, and genfstab)

# 3. Install the base system — pacstrap is Arch's version of "pour a whole system into the mount point";
#    base linux linux-firmware is the minimal set; do not leave out networkmanager and sudo
sudo pacstrap -K /mnt base linux linux-firmware networkmanager sudo

# 4. Enter the new system (equivalent to chroot + mounting the essential virtual filesystems)
sudo arch-chroot /mnt

# 5. Inside the chroot: timezone, locale, hostname
ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && hwclock --systohc
echo "en_US.UTF-8 UTF-8" >> /etc/locale.gen && locale-gen
echo "archlinux" > /etc/hostname

# 6. Install the bootloader (grub route)
pacman -S grub efibootmgr
grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=GRUB
grub-mkconfig -o /boot/grub/grub.cfg

# 7. Set the root password, enable sudo, create a regular user (the wheel group is the Arch convention)
passwd
echo "%wheel ALL=(ALL:ALL) ALL" >> /etc/sudoers
useradd -m -G wheel yourname && passwd yourname

# 8. Leave the chroot, unmount, and reboot
exit && sudo umount -R /mnt && sudo reboot
```

The payoff of a manual install is knowing **what was added to each directory, and why**: `pacstrap` merely unpacks repository packages into `/mnt`; `arch-chroot` switches the scope of subsequent commands into the new system; `genfstab` turns the mount relationships into the boot script. The three steps interlock — miss any one and the system "exists but will not boot".

## 5. Three Must-Dos After Installation

Whichever distribution, three things after rebooting into the new system are "skip them and it will bite you":

### 5.1 Install/Confirm the Bootloader

Most graphical installers finish this automatically, but a manual install or a wrong "bootloader installation location" choice needs remediation:

```bash
# Debian/Ubuntu: reinstall GRUB, then rebuild the menu (it will print Found Windows Boot Manager)
sudo grub-install /dev/sda && sudo update-grub
# RHEL/CentOS/Rocky: rebuild the config; on UEFI machines also run efibootmgr -v to confirm the boot entry
sudo grub2-mkconfig -o /boot/grub2/grub.cfg
# Arch (grub route); for systemd-boot use bootctl install instead
sudo grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=GRUB
sudo grub-mkconfig -o /boot/grub/grub.cfg
```

To verify: `efibootmgr -v` shows your own entry, or pressing F12 at reboot lets you pick the new system from the boot menu.

### 5.2 Configure the Network

Being online during installation does not mean being online at boot — confirm who manages the connection:

On Debian/Ubuntu, desktop and server are managed by NetworkManager and Netplan respectively: the former via `nmcli device status` / `nmcli device connect wlan0`; the latter needs `sudo netplan apply` after editing `/etc/netplan/*.yaml`, then `ip a` to confirm an address was obtained. Rocky/RHEL needs `ONBOOT=yes` in the NIC configuration (on RHEL 8 and earlier, `/etc/sysconfig/network-scripts/ifcfg-eth0`; from RHEL 9 onward it is handled uniformly by NetworkManager — check with `nmcli connection show`). On Arch, if you picked the NetworkManager package during install, you also need `systemctl enable --now` to bring the service up, otherwise no one manages the NIC after reboot. All three families end at the same acceptance test: `ip a` shows an address and `ping -c 3 223.5.5.5` goes through — there is no need to deliberately memorize these three commands; remember "who manages it" and "what the acceptance test is".

```bash
sudo netplan apply                            # Debian/Ubuntu (Netplan)
nmcli device connect wlan0                    # NetworkManager route
sudo systemctl enable --now NetworkManager    # Arch (that package was chosen at install)
ping -c 3 223.5.5.5                           # universal acceptance test
```

### 5.3 First Full Update + Switch to Domestic Mirrors

The first round of updates on a freshly installed system picks up the kernel and security patches released after the installation media was cut — **no exceptions here, all three families must do it** — but the pitfalls behind the commands differ:

```bash
# Debian/Ubuntu — Ubuntu 24.04+ uses the deb822 format; older releases edit /etc/apt/sources.list
sudo sed -i 's|http://archive.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g' \
  /etc/apt/sources.list.d/ubuntu.sources
sudo apt update && sudo apt upgrade -y

# RHEL/CentOS/Rocky
sudo dnf update -y

# Arch — a full -Syu is mandatory; after a kernel upgrade, confirm that the new
# vmlinuz-linux and initramfs-linux.img appear under /boot
sudo pacman -Syu
```

Arch's `pacman -Syu` here is semantically equivalent to Debian's `apt update && apt upgrade` (sync database + full upgrade), but Arch's tolerance for "`-S` without `-Syu`" is **zero** — the broken symlinks and library mismatches caused by partial upgrades are outside official support, and the very first action after installing the system should be exactly this. Switching mirrors (putting the TUNA mirror at the top of `/etc/pacman.d/mirrorlist`) should happen before pacstrap; if you did not get to it during install, change it now and force a refresh with `pacman -Syyu`.

The commands to round out common tools and Chinese fonts, one line per family: Debian/Ubuntu uses `sudo apt install -y vim git curl wget htop fonts-wqy-zenhei`, Arch uses `sudo pacman -S --needed vim git curl wget htop ttf-wqy-zenhei`, RHEL/Rocky uses `sudo dnf install -y vim git curl wget htop`. Do not skip the Chinese font package — without it, a desktop's browser renders nothing but tofu blocks.

## 6. Dual-Boot Notes

After installing Linux, the GRUB menu is the only entry point; get familiar with two high-frequency operations:

```bash
# Debian/Ubuntu regenerate the menu (after installing Windows or a new kernel):
sudo update-grub
# RHEL/CentOS/Rocky:
sudo grub2-mkconfig -o /boot/grub2/grub.cfg
```

If a reboot lands straight in Windows with no GRUB in sight — most likely a Windows update rewrote the EFI boot order; go into the firmware settings and move the "ubuntu"/"GRUB"/"rocky" entry above Windows Boot Manager. No reinstall needed. The pitfall in the other direction: if Windows was not "shut down properly" before installing Linux (Fast Startup hibernates and locks the disk), the Linux installer cannot read NTFS — in dual-boot scenarios, do one full shutdown first.

## 7. Common Pitfalls

- **Partition table type mismatching the firmware mode** — a Legacy bootloader installed on a UEFI machine (or the reverse) leaves no bootable entry afterward. Before installing, `ls /sys/firmware/efi` is the gold standard.
- **fstab not generated, or generated with device names** — the most commonly missed step of manual installs; without fstab, the root partition does not mount after reboot and you drop straight into rescue.
- **Bootloader installed to the wrong disk** — on multi-disk machines, `grub-install /dev/sda` aimed at the wrong target. Run `lsblk` first to identify the boot disk; under UEFI, check `efibootmgr`'s `BootOrder`.
- **Arch installed with no regular user, and no sudo for wheel** — only root can log in, and SSH disables root password login by default for security — you have locked yourself out of your own machine.
- **Incomplete updates** — on Arch this shows up as installing packages right after `pacman -Sy`; on Ubuntu, as `apt install` running while the kernel never gets upgraded. The first update is always "sync + full upgrade".
- **NIC left off in the installer** — Anaconda and some text installers default the NIC to off; you only discover the missing network after the install, and have to go back and flip it on.
- **Expecting hibernation without swap configured** — `hibernate` cannot work when the swap partition is smaller than memory; either grow the swap, or give up hibernation and keep using suspend.

## References

- Arch Wiki - Installation guide — [wiki.archlinux.org](https://wiki.archlinux.org/title/Installation_guide)
- Arch Wiki - archinstall — [wiki.archlinux.org](https://wiki.archlinux.org/title/Archinstall)
- Arch Wiki - General recommendations (System maintenance) — [wiki.archlinux.org](https://wiki.archlinux.org/title/General_recommendations)
- Ubuntu installation tutorial — [ubuntu.com](https://ubuntu.com/tutorials/install-ubuntu-desktop)
- Debian Installation Manual - Partitioning — [debian.org](https://www.debian.org/releases/stable/installmanual)
- Rocky Linux Installation Guide — [docs.rockylinux.org](https://docs.rockylinux.org/guides/installation/)
- Bird's Private Recipes (Lin's Linux Administration Guide) - multi-boot installation — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0157installcentos7.php)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [installation](/basic/installation.md)
- [knowledge](/knowledge.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
