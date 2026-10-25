# Boot Process and Boot Troubleshooting

Boot is the one stage where an administrator cannot "log in first and take a look": the server sitting at a black screen after a reboot in a midnight machine room gives you neither SSH nor journalctl. This page focuses on the hang scene, rescue entry points, and boot performance analysis; the firmware -> bootloader -> kernel/initramfs -> systemd -> login chain and the three-family configuration basics are in [Basics: Boot Process](../basic/boot.md). The two pages keep different angles: the basics page explains what the boot is made of and how to configure it, this page records how an administrator locates and handles a fault from on-scene signals; systemd service-management details are in [systemd Services and Programs](./services-systemd.md).

> Content adapted from the Arch Wiki and the systemd official documentation (conceptual framework from Bird's Private Recipes (Lin's Linux Administration Guide)); see the references at the end.

## What This Page Covers

- Break the boot into a five-leg relay, naming each leg's handoff and typical hang scene
- Use the GRUB menu to change kernel parameters on the fly for an emergency (drop quiet, nomodeset, drop to an initramfs shell)
- Tell apart the three families' initramfs tools (initramfs-tools / dracut / mkinitcpio)
- Diagnose systemd-stage hung jobs and the 90-second timeout, tell rescue from emergency
- Use systemd-analyze's three-axe method to locate the real culprit behind a slow boot, without being misled by blame

## 1. Boot Is a Relay Race

### 1.1 Five Legs and Their Handoffs

```text
Power on ─▶ Firmware POST/UEFI ─▶ Bootloader GRUB ─▶ Kernel + initramfs ─▶ systemd ─▶ Login prompt
            NVRAM entry           grub.cfg           mount root+switch_root  default.target  getty / SDDM
```

| Leg | Stage | Handoff | Typical hang scene |
|-----|-------|---------|--------------------|
| 1 | Firmware | Find the boot medium by BootOrder (the .efi in the ESP, or MBR code) | No output at all; drops straight into the firmware setup screen |
| 2 | Bootloader | Load the kernel image and command line (vmlinuz, initramfs, root=UUID...) | A grub> prompt, or black screen after picking a menu entry |
| 3 | Kernel and initramfs | Mount the real root filesystem and switch_root | Kernel panic (VFS: Unable to mount root fs) |
| 4 | systemd | Pull up services per default.target | "A start job is running for..." with a 90-second countdown |
| 5 | Login | getty or a display manager brings up the login box | Black screen with a mouse cursor, no login interface |

The master rule of troubleshooting hides in this table: **first pin down which leg you are stuck on, then look up that leg's handling**. Every leg has its own observation window -- the firmware's self-test screen and beeps, the GRUB menu and prompt, the kernel's scrolling output after decompression, systemd's green `[ OK ]` lines; hunting for the first leg's disease inside the fourth leg's journal is the most common wrong turn. The judgment is "what last appeared on screen": nothing at all is leg one, a stop at grub> is leg two, a printed panic is leg three, a job countdown is leg four, output but no login box is leg five.

### 1.2 One Discipline You Will Reuse

The earlier a problem among the five legs, the "harder" it is -- in the firmware and bootloader stages there are no logs to consult (journald is not up yet), only the screen and the serial port; the later the problem, the "softer" it is -- everything in the systemd stage leaves a journal, one `journalctl -b -p err` grabs it. So the troubleshooting posture is inverted: if you can get into the system, work backwards from the logs; if you cannot, sweep the scenes forward along the five legs. This is also why this page spreads the "escape hatches" (temporary parameter edits, initramfs shell, rescue mode) across the leg subsections instead of collecting them at the end -- wherever you are trapped, that is where you pick up the tools.

## 2. The Firmware Stage

### 2.1 What the Firmware Does

The first leg after power-on does exactly three things: initialize CPU and memory, enumerate hardware (POST self-test), and find the boot program per the BootOrder in NVRAM. The essential difference between UEFI and Legacy BIOS lies in that last step -- Legacy reads 512 bytes of MBR code from the disk's first sector, whereas UEFI turns booting into "run a program": it loads `shx64.efi` -> `grubx64.efi` by path from the FAT32 ESP partition. How to tell which mode you are in (whether `/sys/firmware/efi` exists, whether `efibootmgr` errors out) is fully demonstrated in [Basics](../basic/boot/bios_uefi.md) and is not repeated here.

The boot entries themselves are the only thing an administrator regularly handles at this leg. After entries are lost or the order scrambled (common with a dead motherboard battery, a firmware flash, or a dual-boot installer hijacking NVRAM), the machine skips your GRUB and lands straight in a USB stick or the firmware screen:

```bash
$ efibootmgr -v | head -4        # Show current entries and order (details in the basics page)
BootCurrent: 0001
Timeout: 0 seconds
BootOrder: 0001,0000,0003
Boot0001* Linux Boot Manager ...
$ sudo efibootmgr -o 0001,0000,0003   # Reorder: promote the correct entry to the front
```

When entries are gone entirely, the fallback is the firmware's default path `\EFI\BOOT\BOOTX64.EFI` -- `grub-install` lays down a copy of it along the way, so "reinstalling the bootloader" is often less work than "hand-editing NVRAM"; the concrete steps are in the rescue section of the [GRUB page](../basic/boot/grub.md).

Secure Boot deserves a few words at this leg: it requires every link that gets loaded to carry a trusted signature, at the cost that unsigned kernel modules (a self-compiled DKMS graphics driver, classically) are refused, leaving `Key was rejected by service` or a Lockdown-related hint in the log -- when a "module is installed but will not load", think of this first. To keep Secure Boot on and still load self-built modules, the standard procedure is to register the module's signature into the machine owner key (MOK): `mokutil --import driver.der` sets a one-time password, and after reboot shim brings up the blue enrollment screen; once confirmed, that signature stays valid on this machine long-term -- two minutes more than "just turn Secure Boot off", in exchange for keeping every other security benefit intact; Arch users have no distro-managed shim trust chain and usually self-manage keys with `sbctl` or explicitly turn it off.

### 2.2 Reading the Hang Scene

Fault exclusion at this leg is clean: **try a known-bootable medium (Live USB)**. If the Live boots, the firmware is innocent and the disease is in the on-disk boot chain; if the Live does not light up either, it is a hardware or display-output-layer matter, nothing to do with the operating system. Servers add two more roads: first, adding `console=ttyS0,115200` to the kernel command line routes both firmware and kernel output to the serial port, so no monitor is needed in the machine room -- many "black screens" are simply the display output plugged into the wrong thing; second, a server with BMC/IPMI can virtualize a "monitor + keyboard" over the out-of-band port (redirecting the serial console with something like `ipmitool sol activate`), letting you see the leg-one scene from your desk -- a perspective no log from leg five onward can ever recover.

## 3. The Bootloader Stage

### 3.1 The Menu Does Not Appear

A GRUB menu that flashes by or does not appear is usually not a fault but a config effect: in `/etc/default/grub` either `GRUB_TIMEOUT=0` or `GRUB_TIMEOUT_STYLE=hidden` hides the menu. The key to summon it temporarily depends on the boot mode: hold `Shift` on Legacy, hammer `Esc` on UEFI. To show the menu permanently, change `/etc/default/grub` and regenerate the config per your distro -- `update-grub` on Debian/Ubuntu, `grub-mkconfig -o /boot/grub/grub.cfg` on Arch, and the RHEL family uses a `2` in both command and path (`grub2-mkconfig -o /boot/grub2/grub.cfg`); the three-family differences and grub.cfg's three-layer generation structure are fully compared on the [GRUB page](../basic/boot/grub.md), not expanded here.

### 3.2 The Menu Is a First-Aid Bench: Temporary Parameter Edits

Pressing `e` at the GRUB menu edits a boot entry on the fly; Ctrl+X applies and it is gone on reboot -- the lifeline you can reach for without changing anything. The [GRUB page](../basic/boot/grub.md) has already shown appending `systemd.unit=rescue.target` for single-user mode; this page adds the three most-used edits for troubleshooting scenes:

| What to change | Where to change it | What it rescues |
|----------------|--------------------|-----------------|
| Drop `quiet splash` | End of the linux line | Makes all the kernel's scrolling output visible, so the hang line is obvious |
| Append `nomodeset` | End of the linux line | Black screen from a graphics driver taking over before login; light it up on VESA first |
| Append the initramfs shell parameter | End of the linux line | A shell before the real root is mounted, for fsck, checking drivers, changing passwords |

The third one differs per family and is worth memorizing on its own -- the "interrupt" keyword for initramfs is defined by each family's generator tool:

```text
rd.break            # RHEL family (dracut): stop before mounting the real root, shell inside initramfs
break=premount      # Shared spelling for Arch (mkinitcpio) and Debian (initramfs-tools)
init=/bin/bash      # Universal across the three: skip systemd, hand you bash once the real root is mounted
```

`init=/bin/bash` is the most extreme and most used (the textbook fix for a forgotten root password), at the cost of an environment with no systemd: the filesystem is read-only and there is no job control (you get `can't access tty; job control turned off`); after entering, first `mount -o remount,rw /` before working, and when done `exec /sbin/init` or just reboot.

### 3.3 Persisting the Change

A parameter proven useful on the fly must land in `/etc/default/grub` to last: `GRUB_CMDLINE_LINUX` applies to every boot entry, `GRUB_CMDLINE_LINUX_DEFAULT` only to the default one (special entries like recovery mode stay unaffected) -- put troubleshooting parameters (such as `nomodset`) in DEFAULT so rescue mode does not carry them too. After editing, regenerate with the three-family commands as usual; the discipline here is the same as BIND's "checkconf before reload": the generator does syntax and path checks, and hand-editing an auto-generated file like `/boot/grub2/grub.cfg` gets silently overwritten at the next kernel update, the number-one cause of "changed it and bricked it".

The kernel parameters you reach for again and again while troubleshooting collapse into this quick-reference table; edit them temporarily at the menu with `e`, and once proven effective, come back to this section to persist them:

| Parameter | Effect | Typical scenario |
|-----------|--------|------------------|
| `quiet splash` (drop it) | Show the kernel's full scrolling output | The last line before the black screen is the key evidence |
| `nomodeset` | Disable early KMS, fall back to VESA | Black screen after a driver/kernel swap |
| `loglevel=7` | Raise kernel log verbosity | When you need earlier, finer output |
| `console=ttyS0,115200` | Redirect output to the serial port | Server troubleshooting with no monitor |
| `systemd.unit=rescue.target` | Enter single-user repair mode | Password change, config change |
| `systemd.unit=emergency.target` | Enter minimal first-aid mode | fsck, fixing fstab |
| `rd.break` / `break=premount` | Stop at an initramfs shell | Problems before the real root mounts |
| `init=/bin/bash` | Bypass systemd straight to bash | Textbook fix for a forgotten root password |

### 3.4 Reading the Hang Scene

A stop at the `grub>` or `grub rescue>` prompt means GRUB's core code was found but the config or modules did not follow -- `grub rescue>` is worse (prefix modules lost); manual recovery for both (the `normal` command, set root/insmod paths) and the full rescue procedure are on the [GRUB page](../basic/boot/grub.md). A black screen with no output after picking a menu entry points first at the kernel parameters: `quiet splash` swallows the errors, drop it and look again; on a machine that just got a new graphics driver or kernel, try `nomodeset` first.

When you really are stuck at the `grub>` prompt, the shortest path is often "bring the system up by hand" -- no reinstall, no config repair: use three commands first to prove the kernel and real root are still healthy, and the repair can wait until you are inside the system:

```text
grub> ls                                    # Enumerate partitions, find the root or /boot (e.g. (hd0,gpt2))
grub> set root=(hd0,gpt2)
grub> linux /vmlinuz-linux root=UUID=xxxx-… rw    # Arch path; for Debian/RHEL use /boot/vmlinuz-version
grub> initrd /initramfs-linux.img                 # Same as above; adjust the filename per distro
grub> boot
```

Confirm the UUID with `ls (hd0,gpt2)/` to make sure the disk designation is right -- the most valuable thing here is not the commands themselves but the on-the-spot discrimination between a dead disk and a dead config: three lines that boot means the problem is only in grub.cfg; an `ls` that cannot read any partition means check the disk and firmware first.

A stop at the `grub>` or `grub rescue>` prompt means GRUB's core code was found but the config or modules did not follow -- `grub rescue>` is worse (prefix modules lost); manual recovery for both (the `normal` command, set root/insmod paths) and the full rescue procedure are on the [GRUB page](../basic/boot/grub.md). A black screen with no output after picking a menu entry points first at the kernel parameters: `quiet splash` swallows the errors, drop it and look again; on a machine that just got a new graphics driver or kernel, try `nomodeset` first.

## 4. The Kernel and initramfs Stage

### 4.1 initramfs Is a Transitional Home

After decompressing, the kernel holds only a tiny in-memory root -- initramfs. Its one mission is to finish everything before "mounting the real root": load the storage drivers (nvme, raid, filesystem modules), decrypt LUKS, activate LVM, find and check the real root per `root=UUID=...`, then `switch_root` to move the process root onto the disk and exec the real init (systemd). The analogy is moving house: the real root is the new home, initramfs is the demolition-period transitional home -- you do not stay long, but without it you cannot move in; if the transitional home lacks enough furniture (drivers), no matter how good the new home is you cannot carry it in.

This explains a high-frequency discipline: **you must rebuild initramfs after changing the kernel or adding storage drivers**. Kernel modules match strictly by version -- the version magic string printed by `modinfo -F vermagic module name` must match the running kernel exactly; the RAID-card driver you installed for the current kernel only lands in the real root's `/lib/modules/$(uname -r)/`, while initramfs is a packaged snapshot from the moment it was generated and knows nothing installed later. Without a rebuild, the card is "installed but invisible at boot", followed by the familiar panic. The three-family tools and rebuild commands:

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------|---------------|------|-------------------|
| Tool | initramfs-tools | mkinitcpio | dracut |
| Rebuild current kernel | `update-initramfs -u` | `mkinitcpio -P` | `dracut -f` |
| Config file | `/etc/initramfs-tools/` | `/etc/mkinitcpio.conf` + `.d/` | `/etc/dracut.conf.d/` |
| Extra drivers to stuff in | `/etc/initramfs-tools/modules` | `MODULES+=(xxx)` | `add_drivers+=" xxx "` |
| List image contents | `lsinitramfs /boot/initrd.img-…` | `lsinitcpio -a` | `lsinitrd /boot/initramfs-…` |

The "list contents" row is hard currency when troubleshooting: suspect the driver never made it into the image, one command shows the truth, no guessing. Paired with it is "how the encrypted disk gets unlocked" -- on a machine using LUKS, initramfs must also decrypt before mounting the real root, and the three families differ in parameter habits on this path: Arch says it all in one parameter, `cryptdevice=UUID=…:cryptroot root=/dev/mapper/cryptroot`; RHEL/dracut uses `rd.luks.uuid=luks-…`; Debian relies on `/etc/crypttab` being packed in by initramfs-tools. You do not need to memorize them, but know that "the password prompt hangs early in boot" belongs to this leg and not systemd -- change crypttab or the dracut config and forget to rebuild the initramfs, and the encrypted disk will be waiting for you on the reboot where you thought it was fixed.

### 4.2 Three Causes of Kernel Panic, Quick Reference

The last frame at this leg's failure is almost always `Kernel panic - not syncing: VFS: Unable to mount root fs on unknown-block(0,0)`, but behind it are three diseases with entirely different handling. **One, wrong root device location**: the `root=` UUID was mis-copied, or the partition was re-partitioned -- go into the initramfs shell and verify each with `blkid`, then fix the source grub.cfg derives from. **Two, missing driver**: the initramfs lacks the module for that storage controller -- same symptom as above but `ls /dev/nvme*` (or the corresponding device nodes) is empty; rebuild the initramfs and confirm the driver made it in. **Three, filesystem corruption**: fsck/superblock-related errors appear in the output rather than a pure VFS error -- in the initramfs shell, `fsck -y /dev/…` fix it, then continue booting. The boundary between all three is on the panic's last screen; photographing it or archiving it over serial is standard machine-room practice. The third disease's full handling in the initramfs shell looks like this:

```bash
$ fsck -y /dev/vda2                  # -y answers "yes" to every interactive question, repair log scrolls line by line
/dev/vda2: UNEXPECTED INCONSISTENCY; RUN fsck MANUALLY.
        ... fixed a few inode/log entries ...
/dev/vda2: ***** FILE SYSTEM WAS MODIFIED *****
$ exit                               # Exit the shell, initramfs continues the original boot flow
```

After fixing, `exit` to let the flow continue instead of hard-resetting buys you a verification chance: if the filesystem is fixed but the kernel still panics, a second disease remains; a hard reset zeroes everything and starts over.

### 4.3 Two Escape Hatches

There are two doors into the initramfs environment, different tools but the same entrance (both the kernel command line): RHEL uses `rd.break`, Arch and Debian use `break=premount` (see the table in 3.2). Inside, the root is at `/sysroot` and usually read-only; `mount -o remount,rw /sysroot` and you can edit files and run fsck. The complete sequence for the textbook scenario (lost root password):

```bash
switch_root:/(initramfs)# mount -o remount,rw /sysroot
switch_root:/(initramfs)# chroot /sysroot                  # After switching root, paths and passwd follow the real root
bash-5.2# passwd root
New password: ...
passwd: password updated successfully
bash-5.2# touch /.autorelabel                            # Mandatory on RHEL family with SELinux on, relabel the files
bash-5.2# exit; exit                                     # Two exits, the flow continues booting normally
```

For a full repair (reinstalling GRUB, rebuilding initramfs), the standard posture is to keep going: mount the ESP and virtual filesystems, then chroot -- the full command sequence is in the rescue section of the [GRUB page](../basic/boot/grub.md), not repeated here. `init=/bin/bash` is the nuclear option that skips everything after the initramfs, suited to "I only want to change one file".

## 5. The systemd Stage

### 5.1 The default.target Resolution Chain

Once the real root is mounted and systemd is up, the first thing it reads is `/etc/systemd/system/default.target` -- usually a symlink pointing at `multi-user.target` (the server norm) or `graphical.target` (desktop). This resolution chain has two intervention points: at the persistent layer, `systemctl set-default multi-user.target` changes the link; at the temporary layer, adding `systemd.unit=rescue.target` to the kernel command line overrides it once. For daily checking use `systemctl get-default`; for problems like "I clearly installed the desktop edition, why does it boot to a command line on a black background", nine times out of ten the answer is this link.

### 5.2 Hung Jobs and the 90-Second Countdown

The screen stopping at `A start job is running for xxx` and counting down 90 seconds is this leg's signature fault. See what is running first:

```bash
$ systemctl list-jobs
JOB UNIT                             TYPE  STATE
2334 NetworkManager-wait-online.service start running
2340 dev-disk-by\x2duuidxxxx.device  start running     # A device is waiting

2 jobs listed.
$ journalctl -b -p err --no-pager | tail -5   # Cross-check the error log at the same moment
```

The countdown's culprits fall into two families. **Waiting on network**: `NetworkManager-wait-online.service`'s judgment of "network ready" is stricter than most services need (it waits the full timeout if any NIC has no address); the handling is `systemctl disable NetworkManager-wait-online.service` -- unless a service genuinely depends on the boot order (mounting network storage, say), it is pure ceremony on a server. **Waiting on a device**: the device behind an fstab mount point never appears (USB stick unplugged, drive letter changed); the handling is adding `nofail` to the fstab options (boot continues even if the wait fails) and `x-systemd.device-timeout=5s` (compresses the 90 seconds to 5), plus `_netdev` for network storage. Both families share "the timeout is only a symptom; the thing being waited on is the disease" -- the countdown ends in emergency mode, and that is where the real scene is. One real example of the device family's fix: the USB backup mount in fstab that stopped existing long ago, making the whole shop wait 90 seconds with it on every boot:

```text
# /etc/fstab -- before and after
UUID=xxxx-xxxx  /mnt/backup  ext4  defaults                 0 2    # Before: stuck 90 seconds if it cannot be found
UUID=xxxx-xxxx  /mnt/backup  ext4  nofail,x-systemd.device-timeout=5s  0 2   # After: passes in 5 seconds
```

`systemctl daemon-reload` makes the edited fstab take effect, and one `journalctl -b -u dev-disk-…` confirms the device unit no longer waits forever. A side note: besides `nofail` there is also `noauto` (do not auto-mount at all), and both suit "optional either way" media like a backup disk; for network storage you also need `_netdev` to declare the network-ready dependency, otherwise it gets rushed to mount before the network is up and waits for nothing.

### 5.3 The Difference Between rescue and emergency

The two degraded modes are often conflated; the boundary is simple: **rescue.target is "single-user repair mode"** -- local filesystems mounted as usual, network and other multi-user services stopped, a sulogin shell for root, suited to config changes and password fixes where "the system itself is healthy and I need a quiet environment"; **emergency.target is "minimal first-aid mode"** -- only the root mounted and usually read-only, nothing else pulled up, the passive landing spot when a filesystem check fails or systemd itself errors, suited to fsck and fstab repair where "the system is already unhealthy". Entry is symmetric: `systemd.unit=rescue.target` and `systemd.unit=emergency.target` on the kernel command line, or the traditional `1` and `emergency`. The rule for choosing: if mounting works, use rescue; if mounting itself is the problem, use emergency.

### 5.4 Leg Five: The Login Prompt

After systemd finishes pulling targets it hands off to the login layer: on servers that is getty (`getty@tty1.service` and its template instances, backed by agetty + login), on desktop distros the display manager (`display-manager.service`, one of sddm/gdm/lightdm). This leg's fault signature is very recognizable: **the system is actually running** -- the NIC light blinks, SSH connects, `systemctl status` is all green, yet the local screen is black or has no login box. The discriminating move is Ctrl+Alt+F2 to a bare tty: a bare tty that shows a login prompt means the kernel and getty are healthy and the problem is locked into the graphics stack (display manager or graphics driver), look for evidence in `journalctl -b -u display-manager`; a bare tty that is also black means go back and check the earlier legs. From a remote-management perspective this leg is nearly invisible -- it only affects "the person sitting in front of the machine", so on server provisioning, confirming `systemctl enable getty@tty1` and the SSH service's auto-start is two lines of insurance that keep leg five from ever costing you time.

## 6. Boot Performance Analysis

### 6.1 The Three Axes

`systemd-analyze`'s three axes line up exactly with the five-leg relay to give an evidence chain. The first axe looks at the totals:

```bash
$ systemd-analyze
Startup finished in 2.3s (firmware) + 3.1s (loader) + 8.9s (kernel)
                      + 12.6s (initrd) + 24.5s (userspace) = 51.4s
```

The five segments of the output correspond one by one to the five legs in section 1 -- slow firmware and loader are firmware-side matters (hardware self-test, ESP reading) that the operating system cannot help with; first identify which seconds are not yours to fix before acting. The second axe looks at individuals: `systemd-analyze blame` lists each service's initialization time; the third axe looks at the path: `systemd-analyze critical-chain multi-user.target` gives the critical chain holding up the target.

### 6.2 Do Not Be Fooled by blame

blame is the most misread of the three axes: systemd pulls services in parallel, so a service at the top of the blame ranking may merely be "unlucky enough to be blocked on the road by someone else" -- it is quick itself but waited a long time. The real answer is always in critical-chain: the services on the chain are the serial bottlenecks, and only optimizing them pays. Look at a typical output:

```bash
$ systemd-analyze critical-chain --no-pager | head -8
The time when unit became active or started is printed after the "@" character.
The time the unit took to start is printed after the "+" character.
multi-user.target +0.0s
└─NetworkManager-wait-online.service @21.3s +2.1s
  └─NetworkManager.service @1.8s +0.4s
    └─basic.target @1.7s
      └─...
```

The `NetworkManager-wait-online` on the chain only finished waiting at second 21.3 -- that is the old friend from section 5.2; after disabling it, critical-chain names a new head, go optimize that one next. Two other common payoff points: clean out services that do not need to be enabled (the inventory mindset is on the [Services page](./services-systemd.md)), and strip purely decorative overhead like `plymouth-quit-wait`; to see the full timeline, `systemd-analyze plot > boot.svg` produces a zoomable SVG, and scanning for abnormal segments visually is very intuitive. The bigger pie of system-level performance tuning (CPU/IO tuning) is in [Performance](./performance.md).

## 7. Troubleshooting and Common Gotchas

**Black screen, no output.** First tell apart "no backlight" from "output present but black": the former is a hardware/power layer, the latter is a boot-chain matter. Exclude by elimination -- a Live USB that lights up means the firmware is innocent; on a server, route the scene out over serial with `console=ttyS0,115200`. A black screen right after installing a graphics driver or upgrading the kernel: add `nomodeset` at the GRUB menu to light it up first, then uninstall the driver and roll back.

**Stuck at "A start job is running for..." for 90 seconds.** Triage per section 5.2's two families: `systemctl list-jobs` to see whether it waits on network or a device; disable wait-online directly, and for devices check fstab and add `nofail` plus `x-systemd.device-timeout=5s`. The emergency mode the countdown ends in is not the fault itself -- it is the scene that got detained.

**Kernel panic: VFS: Unable to mount root fs.** Triage per section 4.2's three causes: mis-copied UUID / changed partition, initramfs missing the driver, filesystem corruption. Archive the last screen, get into an initramfs shell (`rd.break` or `break=premount`) and use `blkid` and `ls /dev/…` to tell "cannot find the disk" from "disk present but cannot mount", then handle accordingly.

**Hand-edited grub.cfg, bricked on reboot.** Files like `/boot/grub2/grub.cfg` are produced by the generator and overwritten at every kernel update; the correct persistence entry point is `/etc/default/grub` (or a custom script under `/etc/grub.d/`) plus the three families' respective mkconfig commands. Already bricked? Reinstall following the [GRUB page](../basic/boot/grub.md)'s Live USB + chroot procedure.

**initramfs rebuild fails.** Most commonly the `/boot` partition is full -- each kernel's image plus initramfs runs to hundreds of MB, and a few years of old kernels overflows it. Clear old kernels: Debian `apt autoremove --purge`, RHEL `dnf remove kernel-…` (keep current and previous), Arch `paccache -rk2`. Next most common is missing kernel headers or a firmware package interrupting generation; look at the mkinitcpio/dracut error line and install the missing package.

**Installed the driver, rebooted, disk not recognized.** The driver only went into the real root; the initramfs snapshot has no idea (section 4.1). The three families' fixes: Arch edits `MODULES` in `mkinitcpio.conf` then `mkinitcpio -P`; RHEL adds `add_drivers` in the dracut config then `dracut -f`; Debian writes `/etc/initramfs-tools/modules` then `update-initramfs -u`. To judge "is the driver in the initramfs", `lsinitrd`/`lsinitcpio` can list the contents directly.

**Screen fully black but the system is actually running.** Feel the symptoms before acting: NIC light blinking, ping working, SSH logging in -- the classic leg-five scene (section 5.4); Ctrl+Alt+F2 to a tty to separate the graphics stack from the kernel; only when even ping fails go back and sweep legs one through four. On servers provisioned without display output, configure `console=ttyS0` and keep the out-of-band port handy, and this class of "black-screen panic" never happens in the first place.

**Changed the default target but it does not take effect.** `systemctl set-default` changes the symlink, and the kernel command line's `systemd.unit=` outranks it -- a leftover temporary parameter from the last troubleshooting session, if it was written into `GRUB_CMDLINE_LINUX`, will keep overriding your setting. `systemctl get-default` to check the link, `cat /proc/cmdline` to check the actually effective command line, and the two side by side settle it immediately.

## References

- Arch Wiki: Boot process -- [wiki.archlinux.org/title/Boot_process](https://wiki.archlinux.org/title/Boot_process)
- Arch Wiki: GRUB -- [wiki.archlinux.org/title/GRUB](https://wiki.archlinux.org/title/GRUB)
- Arch Wiki: Mkinitcpio -- [wiki.archlinux.org/title/Mkinitcpio](https://wiki.archlinux.org/title/Mkinitcpio)
- systemd-analyze man page -- [freedesktop.org](https://www.freedesktop.org/software/systemd/man/systemd-analyze.html)
- systemd official boot process documentation -- [systemd.io/BOOT](https://systemd.io/BOOT) (the official account from firmware to userspace)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Boot and shutdown process -- [linux.vbird.org](https://linux.vbird.org/)
- man dracut / man mkinitcpio / man initramfs-tools (man pages for the three families' initramfs tools)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [pam-sudo](/security/pam-sudo.md)
- [build-and-modules](/source/build-and-modules.md)
- [cross-compile](/source/cross-compile.md)
- [README](README.md)
- [lvm](lvm.md)
