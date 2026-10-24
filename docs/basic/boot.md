# The Boot Process

## Chapter Introduction

From the moment you press the power button to the moment you see a login prompt, far more happens than "the screen lights up": the firmware (BIOS or UEFI) first runs self-tests and decides which sector of which disk to read code from; then the bootloader (GRUB) takes the stage — it has to locate the kernel, load the kernel and initramfs into memory, and start the kernel with the parameters you left on the kernel command line; the kernel finishes initializing drivers and mount points, then brings up PID 1 (systemd), which pulls in networking, logging, SSH, and the other services in dependency order; finally a `login:` appears on the tty. If any link in this chain breaks, the machine stops partway: the GRUB menu is gone, the kernel panics, a bad fstab entry leaves the root filesystem unmounted — each symptom corresponds to a different position on the chain, and troubleshooting skill is essentially the ability to walk the chain backwards and locate the break.

This chapter has two pages: [BIOS and UEFI](./boot/bios_uefi.md) explains the differences between the two firmware modes, with the focus on why the **UEFI + NVRAM + EFI System Partition (ESP)** trinity is the default on modern machines; [GRUB Bootloader](./boot/grub.md) explains GRUB's configuration hierarchy (source files -> the generated `grub.cfg`), the differences between the three families' update commands, and the full rescue procedure for a failed boot (Live USB + chroot). Together the two pages cover the two big themes of "why won't it boot" and "what to do when it won't boot." For a sysadmin's view — bottleneck diagnosis, rescue scenes, and boot performance analysis — see [System Management · Boot Process and Boot Troubleshooting](../system-management/boot-process.md).

> This page is explained with **Debian/Ubuntu, Arch, and RHEL/CentOS/Rocky**, the three major distribution families, as the running comparison. At the kernel and systemd layer the three families are nearly identical; the real divergence is concentrated in the **default bootloader** and the **boot partition layout** — see the quick-reference table below. Content adapted from the Arch Wiki and the GNU GRUB manual; see the references at the end.

## What This Chapter Covers

What this chapter records, spread across the two pages, is:

1. **Draw the full boot chain**: firmware -> bootloader -> kernel -> initramfs -> PID 1 — what goes in and comes out of each step, and what the typical failure symptom looks like.
2. **Tell BIOS and UEFI apart**: the respective roles of MBR/GPT, boot code location, NVRAM boot entries, and the ESP partition, and why new machines have converged almost unanimously on UEFI.
3. **Read the disk layout**: use `lsblk`, `fdisk -l`, and `efibootmgr` on a real machine to determine whether you are in UEFI or Legacy mode, find the ESP, and confirm it is mounted at `/boot/efi`.
4. **Modify GRUB configuration**: know that you do not edit `grub.cfg` directly — change `/etc/default/grub` and `/etc/grub.d/`, then regenerate with the command matching your family (`update-grub` / `grub2-mkconfig` / `grub-mkconfig`).
5. **Complete a boot rescue**: when the GRUB menu is lost or the system will not start, get into a chroot from a Live USB, run `grub-install` (with different target arguments for BIOS and UEFI) plus a config rebuild, and restore boot.
6. **Understand the three families' bootloader differences**: Debian/Ubuntu and RHEL/CentOS/Rocky default to GRUB2, Arch leaves the choice to the user (GRUB, systemd-boot, or rEFInd), and know how those choices shape the ESP layout.

## Sub-Page Guide

The chapter's two pages are ordered along the boot flow (each page roughly 12–15 minutes):

- **[BIOS and UEFI](./boot/bios_uefi.md)** — the firmware-layer choice. It starts from "why BIOS's 2 TB / 4-partition limits are a problem today," contrasts BIOS and UEFI on partition table (MBR vs GPT), boot method (boot code embedded in the MBR vs NVRAM pointing at an `.efi` file inside the ESP), and Secure Boot support; the focus is why the **NVRAM boot entry table** (what `efibootmgr` reads and edits) and the **EFI System Partition** (must be FAT32, usually 100–512 MB, mounted at `/boot/efi`) are both indispensable; it closes with the three families' partitioning recommendations at install time and the common pitfalls of hybrid modes (CSM/Legacy-on-UEFI). This page answers "which mode should I install in, and why is the boot entry missing after install."

- **[GRUB Bootloader](./boot/grub.md)** — the bootloader itself. It first walks GRUB's two-stage structure (`boot.img`/`core.img` or `grubx64.efi` -> reads `grub.cfg` -> loads the kernel and initramfs), breaks down the three sources of configuration (`/etc/default/grub` defines variables, `/etc/grub.d/*` generates menu entries, and everything is aggregated into `grub.cfg`), gives the per-family regeneration command differences, demonstrates temporarily editing kernel parameters from the GRUB menu with `e` (the standard entry into rescue mode / single-user mode), and finishes with the full rescue script for a failed boot: Live USB -> mount partitions -> `chroot` -> `grub-install` (distinguishing BIOS's `--target=i386-pc` from UEFI's `--target=x86_64-efi`) -> rebuild configuration -> reboot. This page answers "GRUB menu is gone / boot error — how do I rescue it."

## Three-Family Differences at a Glance

The boot flow itself (firmware -> kernel -> systemd) is identical across the three families; the differences concentrate in bootloader default choice and configuration paths:

| Topic | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Default bootloader | GRUB2 | **user's choice** (commonly GRUB / systemd-boot) | GRUB2 |
| Boot config source | `/etc/default/grub`, `/etc/grub.d/` | same as left (GRUB); systemd-boot uses `loaderentries/` | `/etc/default/grub`, `/etc/grub.d/` |
| Generated config | `/boot/grub/grub.cfg` | `/boot/grub/grub.cfg` | `/boot/grub2/grub.cfg` |
| Regeneration command | `sudo update-grub` | `sudo grub-mkconfig -o /boot/grub/grub.cfg` | `sudo grub2-mkconfig -o /boot/grub2/grub.cfg` |
| Install to disk | `grub-install /dev/sda` | `grub-install --target=x86_64-efi ...` | `grub2-install /dev/sda` |
| Typical ESP mount point | `/boot/efi` | `/boot` (the ESP used directly as `/boot`; the Arch Wiki recommendation) | `/boot/efi` |
| Dual-boot menu refresh | `update-grub` auto-detects Windows | `grub-mkconfig` or os-prober | `grub2-mkconfig` |

The three differences most worth internalizing:

1. **Arch hands the bootloader choice to the user**. There is no "install GRUB by default" step on the install media — you may pick GRUB (the most full-featured, dual-boot friendly), systemd-boot (minimalist; only recognizes kernels on the EFI partition, configured as plain-text entry files), or rEFInd (auto-scanning, macOS-style). This directly shapes the ESP layout: under systemd-boot the ESP is often mounted directly as `/boot`, whereas the Debian/RHEL convention is a separate `/boot/efi` mount point — when the same disk moves between distros, "cannot find the EFI partition" usually traces back to this.

2. **Both the regeneration command and the output path differ**. Debian/Ubuntu wraps it in the `update-grub` script (essentially a shortcut for `grub-mkconfig -o /boot/grub/grub.cfg`); the RHEL family's binary names carry a `2` (`grub2-mkconfig`, `grub2-install`), and configuration lives under `/boot/grub2/`. Copying the other family's path gets you `No such file or directory` — during a rescue, first `ls /boot/` to see whether it is actually `grub` or `grub2` before typing the command.

3. **The location of the kernel and initramfs determines what to do after chroot**. All three families put the kernel in `/boot` (or on the ESP, depending on layout); the initramfs generation tools are `update-initramfs`/`mkinitcpio`/`dracut` respectively. During a rescue, if the kernel itself is damaged, fixing the menu with `grub-install` still leaves the system unbootable — the initramfs needs rebuilding too, and the GRUB page gives the per-family commands.

## Common Questions

The four questions most often asked before entering the sub-pages:

**Q: How do I know whether the machine booted via UEFI or Legacy BIOS?**
The most reliable runtime check is whether the `/sys/firmware/efi` directory exists: present means UEFI mode, absent means Legacy. Another verification is `efibootmgr -v` — if it lists boot entries normally, you are on UEFI; if it reports `EFI variables are not supported`, you are on Legacy. Confirm this before installing, otherwise you waste effort on GPT/MBR and ESP configuration. See [BIOS and UEFI](./boot/bios_uefi.md) for details.

**Q: Does UEFI really require a separate EFI system partition?**
Yes, and it must be FAT32 (most firmware only recognizes FAT). UEFI does not read boot code from the first 446 bytes of the MBR the way BIOS does; it looks up a path — `\EFI\<vendor or bootloader name>\xxx.efi` — inside a **FAT-formatted partition** and executes it. That partition is the ESP (EFI System Partition). A common size of 100–512 MB is plenty (it must hold every OS's `.efi` files plus backups); the installer usually creates and mounts it at `/boot/efi` automatically.

**Q: Why did my `/etc/default/grub` change leave the menu unchanged?**
Because what GRUB actually reads is the generated `grub.cfg`. After changing the source files you must run the regeneration command for your family (see the "Regeneration command" row in the table above). Never edit `grub.cfg` directly — its own header says "Do not edit this file," and the next regeneration overwrites it.

**Q: After installing Windows alongside, the Linux boot entry vanished — what now?**
Windows updates routinely grab the NVRAM boot order and put Windows Boot Manager back in first place. The fix has two layers: first use `efibootmgr` to check whether the Linux entry still exists (if it does, reorder with `efibootmgr -o`); if it is gone, get into a Live USB chroot and re-run `grub-install` so GRUB rewrites NVRAM. Under UEFI, GRUB itself is just an `.efi` file on the EFI partition — reinstalling it never touches your system partitions.

## References

- Arch Wiki - UEFI — [wiki.archlinux.org](https://wiki.archlinux.org/title/UEFI)
- Arch Wiki - GRUB — [wiki.archlinux.org](https://wiki.archlinux.org/title/GRUB)
- Arch Wiki - systemd-boot (a common alternative on Arch) — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd-boot)
- Arch Wiki - the partitioning and booting sections of the Install guide — [wiki.archlinux.org](https://wiki.archlinux.org/title/Installation_guide)
- GNU GRUB manual — [gnu.org](https://www.gnu.org/software/grub/manual/grub/)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Boot process analysis — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0510osloader.php)
- RHEL 9 - Installing GRUB under UEFI — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/interactively_installing_rhel_from_installation_media/)
- Debian manual - System boot — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- `man efibootmgr`, `man grub-install`, `man grub-mkconfig`, `man dracut`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [coverage-matrix](/research/coverage-matrix.md)
