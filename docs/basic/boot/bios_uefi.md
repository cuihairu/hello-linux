# BIOS and UEFI

The very first thing that happens when you press the power button is a program that runs "even earlier than the operating system" taking control of the hardware: it initializes the CPU, memory controller, and graphics, then decides where on disk to hand control to the bootloader. This program has two generations of implementation today — the traditional **BIOS** (Basic Input/Output System) and modern **UEFI** (Unified Extensible Firmware Interface). The two look like they differ by a single letter, but behind them sit two completely different sets of partition conventions, boot paths, and security models: BIOS stuffs boot code into the first 446 bytes of the MBR, recognizes at most 4 primary partitions and 2 TB disks; UEFI requires a dedicated FAT partition (the ESP) on disk, executes `.efi` files directly by path, and records "what to boot" in the motherboard's NVRAM. The cost of picking the wrong mode is concrete: no boot entry found after install, Linux vanishing from the boot menu after a Windows update, or a 3 TB drive exposing only 2 TB — nearly all of these trace back to "firmware mode and disk layout do not match." This page explains both modes thoroughly and gives the three families' partitioning recommendations.

> Content adapted from the Arch Wiki, official RHEL documentation, and Bird's Private Recipes (Lin's Linux Administration Guide); see the references at the end.

## What This Chapter Covers

- Distinguish the essential differences between BIOS and UEFI in partition table, boot path, and Secure Boot
- Why the **UEFI + NVRAM + ESP** trinity works only as a unit — none of the three can go missing
- Use `lsblk`, `fdisk -l`, and `efibootmgr` to determine the current boot mode and locate the ESP
- Know the partitioning recommendations and mount conventions of the three families (Debian/Ubuntu, Arch, RHEL/CentOS/Rocky)
- Avoid the typical pitfalls of CSM/Legacy-on-UEFI hybrid modes

## 1. BIOS's Historical Baggage

BIOS was born in 1975 with the IBM PC, designed to complete self-testing and booting within a 16-bit real mode with a 1 MB address space. Its boot flow is simple enough to recite:

1. POST (power-on self test) — initialize graphics and memory;
2. Follow the boot order stored in CMOS and read the target disk's **MBR** (Master Boot Record, 512 bytes);
3. Check the `0x55AA` magic number at the end of the MBR, load the first 446 bytes of boot code into memory at `0x7C00`, and jump to execute;
4. The boot code (such as GRUB's `boot.img`) then finds the follow-on stage in a partition (`core.img`), which ultimately loads the kernel.

This flow has several limits that look fatal today:

| Limit | Value | Consequence |
|------|------|------|
| Partition table | MBR (32-bit sector numbers) | max 2 TiB disk (2^32 × 512B) |
| Primary partitions | 4 | anything beyond requires the detour of an extended partition + logical partitions |
| Boot code space | 446 bytes | room for only a minimal stub; the real boot logic must live elsewhere |
| Security | no signature verification | any code able to write the MBR runs at the next boot |

The 446-byte limit explains why GRUB is designed in two stages: the `boot.img` in the MBR only loads `core.img`, which is where the filesystem drivers and menu logic live. It also explains why `grub-install` must both write the MBR and cram a pile of module files into a partition — 446 bytes cannot possibly hold a complete bootloader.

## 2. UEFI: Making Booting "Run a Program"

UEFI throws out the implicit "read the first 446 bytes of the MBR" convention in favor of an explicit, file-based boot protocol. Understanding it only requires three keywords: **GPT**, **ESP**, **NVRAM**.

### 2.1 The GPT Partition Table

The GUID Partition Table uses 64-bit sector numbers, supports 9.4 ZB disks in theory, and gives every partition a globally unique GUID — partition type is no longer expressed by counting "4 primary partitions." On Linux you can inspect it with `fdisk -l`:

```bash
$ sudo fdisk -l /dev/sda
Disklabel type: gpt          ← GPT; an MBR disk shows dos instead
Disk identifier: 7A3C9E2F-...

Device       Start       End   Sectors  Size Type
/dev/sda1     2048    105062    103015   50M EFI System
/dev/sda2   105063  ...

Number  Start (sector)    End (sector)       Code  Name
       1            2048          105062    EF00  EFI system partition
```

The `EF00` in the `Code` column (fdisk) or `EF00`/`c12a7328-...` is the partition type GUID, identifying this as an ESP.

### 2.2 The EFI System Partition (ESP)

UEFI does not read boot code — it **looks up an executable file by path**: the firmware enumerates every partition marked "EFI System," mounts it as a FAT filesystem, and looks for files of the form `\EFI\<vendor name or bootloader name>\xxx.efi` to execute. That partition is the ESP (EFI System Partition).

The key constraints:

- **It must be FAT32** (most firmware only recognizes FAT12/16/32, not ext4/NTFS — the price of cross-platform compatibility);
- A common size of 100–512 MB must hold every OS's `.efi` files plus the `EFI/BOOT/BOOTX64.EFI` fallback path;
- Default mount points for the three families: Debian/Ubuntu and RHEL/CentOS/Rocky typically mount `/boot/efi`, while **the Arch Wiki recommends mounting the ESP directly as `/boot`** (kernel and initramfs go in there too, shortening the boot path).

Locating the ESP on Linux:

```bash
# Method one: filter by partition type GUID (the PARTTYPE of an ESP on GPT)
$ lsblk -o NAME,PARTTYPE,FSTYPE,MOUNTPOINT
sda1  c12a7328-f81f-11d2-ba4b-00a0c93ec93b  vfat  /boot/efi
# ↑ this GUID is the fixed type identifier for an ESP in the UEFI spec; identical across the three families

# Method two: look at the mounted points directly
$ mount | grep -i efi
/dev/sda1 on /boot/efi type vfat (rw,relatime,fmask=0077,dmask=0077,codepage=437,iocharset=ascii,shortname=mixed,utf8,errors=remount-ro)
```

`c12a7328-f81f-11d2-ba4b-00a0c93ec93b` is a constant worth memorizing — when the partition table is a mess during a rescue, this is what lets you spot "which one is the ESP" out of a pile of partitions.

### 2.3 NVRAM Boot Entries

In the BIOS era, "what to boot" existed only in the CMOS setup menu; UEFI turns it into a table the operating system can read and write — the **NVRAM boot entries**. Each entry records a "name + EFI file path + optional removable-media flag," and the firmware executes them in order. On Linux, `efibootmgr` is the tool:

```bash
$ efibootmgr -v
BootCurrent: 0002
Timeout: 0 seconds
BootOrder: 0002,0000,0001,0003
Boot0000* ubuntu    HD(1,GPT,7a3c...,0x800,0x100000)/File(\EFI\ubuntu\shimx64.efi)
Boot0001* Windows Boot Manager  HD(1,GPT,...)/File(\EFI\Microsoft\Boot\bootmgfw.efi)
Boot0002* UEFI: NVMe SSD 1TB  PciRoot(0x0)/Pci(0x1f,0x2)/Sata(0x0,0x0,0x0)/HD(1,GPT,...)/File(\EFI\BOOT\BOOTX64.EFI)..BO
Boot0003* LAN  PciRoot(0x0)/Pci(0x1c,0x0)/Pci(0x0,0x0)/MAC(...)/IPv4(...)
```

Reading the key lines:

- `BootCurrent: 0002` — the entry actually used for this boot;
- `BootOrder` — the firmware's attempt order; only if the first fails does it try the second;
- The `HD(1,GPT,...)` after each `Boot000X*` is the partition's unique identifier (PARTUUID rather than `/dev/sda1`, to avoid device-name drift), and `File(\EFI\ubuntu\shimx64.efi)` is the path within that partition.

Common operations:

```bash
# Reorder the boot sequence (the argument is a list of entry numbers)
sudo efibootmgr -o 0002,0001,0000

# Delete a boot entry (for example, clearing stale USB boot leftovers)
sudo efibootmgr -b 0003 -B

# Add one (usually done automatically by grub-install; no need to type it)
sudo efibootmgr -c -d /dev/sda -p 1 -L "Arch Linux" -l '\EFI\arch\grubx64.efi'
```

NVRAM survives power loss, so "pull the disk and move it to another machine" or "the motherboard battery died" both reset the boot entries — this is also the physical-layer reason dual-boot users so often hit "Linux vanished after a Windows update": the Windows updater rewrites BootOrder and moves `Windows Boot Manager` to first place. If the Linux entry still exists, it is only an ordering problem and `efibootmgr -o` brings it back; if the entry is truly gone, a Live USB chroot and a re-run of `grub-install` are required.

### 2.4 Secure Boot

The UEFI spec also defines Secure Boot: the firmware only executes `.efi` files that pass signature verification. The distribution answer is a secondary chain of trust — a Microsoft-signed `shimx64.efi` acts as the first stage, which then validates the distribution's own `grubx64.efi` (which holds the distribution key). So on the ESP you will commonly see:

```text
EFI/ubuntu/shimx64.efi      ← signed with a Microsoft OEM key; trusted by firmware directly
EFI/ubuntu/grubx64.efi      ← distro self-signed; verified by shim
EFI/BOOT/BOOTX64.EFI        ← removable-media fallback path (often a copy of shim)
```

Debian/Ubuntu and RHEL/CentOS/Rocky support Secure Boot out of the box by default; Arch is unsigned by default, so with Secure Boot enabled on the motherboard you must configure `sbsigntools` yourself or switch to `sbctl` — the common advice is to turn Secure Boot off in the BIOS setup first.

## 3. Side-by-Side Comparison

| Feature | BIOS (Legacy) | UEFI |
|------|---------------|------|
| Partition table | MBR | GPT (compatibility mode also supports MBR) |
| Maximum disk | 2 TiB | 9.4 ZB |
| Primary partition limit | 4 | theoretically unlimited (usually 128) |
| Boot code location | first 446 bytes of the MBR + `core.img` in a partition | `.efi` files on the ESP |
| Boot entry management | CMOS menu; hard for the OS to rewrite | NVRAM; `efibootmgr` can read and write |
| Secure Boot | none | Secure Boot signature verification |
| Mode switching | - | CSM/Legacy can emulate BIOS (see Common Pitfalls) |
| Partition tool marker | no special type | `EF00` / PARTTYPE `c12a7328-...` |

## 4. Determining the Current Boot Mode

The first step before installing or troubleshooting is always confirming the firmware mode — three independent methods corroborate each other:

```bash
# Method one (most reliable): does the kernel expose an EFI interface
$ ls /sys/firmware/efi
config_table  efi  esrt  fw_vendor  runtime  runtime-map  systab
# ↑ the directory exists = booted in UEFI mode; absent (No such file) = Legacy BIOS

# Method two: does efibootmgr work
$ efibootmgr
# UEFI: prints BootCurrent/BootOrder normally
# Legacy: reports "EFI variables are not supported"

# Method three: cross-check partition table against mount points
$ lsblk -o NAME,PARTTYPE,FSTYPE,MOUNTPOINT | head
# GPT + a vfat ESP mount at the same time → almost certainly a UEFI install
```

**Common pitfall**: the install medium itself has modes — the same USB stick usually shows up as two entries in the boot menu, the one prefixed "UEFI" taking the UEFI path and the one without it forcing Legacy. If the disk already has a GPT+ESP layout but you chose the Legacy entry to start the installer, the installer reports "EFI partition not found" or installs the bootloader into the MBR where the firmware cannot see it. Before installing, use method one above to confirm the Live environment's mode and keep it consistent with the target.

## 5. The Three Families' Partitioning Recommendations

Whichever family, a minimal usable UEFI/GPT layout includes these pieces:

| Partition | Filesystem | Typical size | Purpose |
|------|---------|---------|------|
| ESP | FAT32 | 100–512 MB | holds every OS's `.efi` files |
| `/boot` | ext4 (or folded into the ESP) | around 1 GB | kernel, initramfs, GRUB modules |
| `/` | ext4/xfs/btrfs | whatever remains | the root filesystem |
| swap (optional) | swap | at least the size of RAM (or as needed) | swap space |

Differences in the three families' conventions:

- **Debian/Ubuntu**: the installer creates the ESP automatically (usually 512 MB at `/boot/efi`), with the rest defaulting to an ext4 root partition plus swap. When partitioning manually, keeping the ESP mounted at `/boot/efi` matches installer behavior.
- **RHEL/CentOS/Rocky**: the same `/boot/efi` convention; servers commonly use XFS as the root filesystem (default since RHEL 7), with logical volumes carved out on top of LVM.
- **Arch**: the Wiki explicitly recommends **mounting the ESP directly as `/boot`** (no separate `/boot` partition then needed), putting the kernel and initramfs on the ESP's FAT partition — the advantage is the shortest boot path and no need to puzzle over "where is the kernel" during a rescue; the cost is that FAT supports neither symlinks nor permission bits, and some tools assume `/boot` is not FAT. With this layout, the output paths for `grub-mkconfig -o` and `mkinitcpio` both need adjusting to the ESP mount point.

Installing GRUB on Arch also goes through `pacman` (the corresponding equivalents are `apt install grub` / `dnf install grub2` on the other two families):

```bash
# Arch: install GRUB and the EFI support components
sudo pacman -S grub efibootmgr

# Debian/Ubuntu (usually already installed during system install; on a reinstall)
sudo apt install grub-efi-amd64

# RHEL/CentOS/Rocky
sudo dnf install grub2-efi-x64 grub2-tools
```

## 6. CSM and Hybrid Mode Pitfalls

CSM (Compatibility Support Module) is the compatibility layer inside UEFI firmware that emulates Legacy BIOS. Its existence creates several easily-tripped combinations:

1. **A GPT disk booted in Legacy mode** — GRUB's `i386-pc` flavor can boot from GPT (it needs a BIOS Boot partition to hold `core.img`), but many installers will simply error out or fail to boot. Keeping the mode and the partition table consistent is the least headache-prone rule.

2. **Secure Boot enabled with an unsigned bootloader installed** — the firmware silently refuses at execution time, and the symptom is "the machine drops straight into firmware setup / a black screen," with no error message at all. Go into BIOS, turn Secure Boot off, or switch to a shim-based boot chain.

3. **`efibootmgr` fails while CSM is enabled** — some motherboards disable the EFI variable interface when CSM permits Legacy boot, making `efibootmgr` unusable. Check the CSM state before troubleshooting.

4. **Boot entries rewritten when Windows and Linux coexist** — under UEFI, Windows manages its own entries with `bcdedit` and will not proactively delete Linux entries, but "start-up repair" or a firmware update can reset BootOrder. When the Linux entry vanishes, run `efibootmgr -v` first to distinguish an ordering problem from a lost entry; the former is solved with `efibootmgr -o`, and only the latter requires a chroot and a GRUB reinstall.

## 7. Common Pitfalls

1. **Rebooting after install drops straight into BIOS / the old OS, with no Linux boot entry**. In nine out of ten cases the boot medium mode was chosen wrongly at install time (a UEFI USB vs a Legacy USB), or the installer never wrote the `.efi` into the ESP. Mount the ESP from a Live USB and check whether the `EFI/` directory has a subdirectory for the relevant distro; if not, chroot and run `grub-install --target=x86_64-efi`.

2. **`efibootmgr` reports `EFI variables are not supported`**. Two possibilities: you booted in Legacy mode (`ls /sys/firmware/efi` does not exist), or the kernel lacks `efivarfs` compiled in (rare). Confirm the mode with method one first.

3. **A 3 TB/4 TB hard disk only shows 2 TB**. The disk is still MBR. Convert it to GPT with `gdisk`/`fdisk` (note: the conversion rebuilds the partition table, so back up the data first; an existing in-use system converted this way also needs a BIOS Boot partition added, or a switch to UEFI boot).

4. **The ESP was formatted as ext4**. UEFI firmware cannot read it, and the file the boot entry points at is unreachable. During a rescue, reformat the ESP with `mkfs.fat -F32` and re-run `grub-install` (which also rebuilds the `\EFI\...` directory structure).

5. **A Windows update "eats" the Linux boot entry in a dual-boot**. See section 2.3: run `efibootmgr -v` first to distinguish an ordering problem from a lost entry, then handle each separately.

6. **A dead motherboard battery resets the boot order every time**. The symptom is that every cold boot returns to the default order. Replace the CR2032 battery, or as a stopgap move the Linux entry to first place with `efibootmgr -o`.

## References

- Arch Wiki - UEFI — [wiki.archlinux.org](https://wiki.archlinux.org/title/UEFI)
- Arch Wiki - EFI system partition — [wiki.archlinux.org](https://wiki.archlinux.org/title/EFI_system_partition)
- Arch Wiki - Unified Extensible Firmware Interface (includes `efibootmgr` usage) — [wiki.archlinux.org](https://wiki.archlinux.org/title/Unified_Extensible_Firmware_Interface)
- Arch Wiki - the partitioning section of the Install guide — [wiki.archlinux.org](https://wiki.archlinux.org/title/Installation_guide)
- RHEL 9 documentation - Installing the bootloader under UEFI — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/interactively_installing_rhel_from_installation_media/)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Boot process analysis (includes a BIOS/UEFI comparison) — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0510osloader.php)
- UEFI Forum spec — [uefi.org](https://uefi.org/)
- `man efibootmgr`, `man fdisk`, `man gdisk`, `man lsblk`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [boot](/basic/boot.md)
- [glossary](/glossary.md)
- [storage](/hardware/storage.md)
- [boot-process](/system-management/boot-process.md)
