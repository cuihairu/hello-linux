# Cross-Compilation and Embedded

The workflow in [Kernel Build and Module Development](./build-and-modules.md) carries a hidden assumption:
compiling, running, and verifying all happen on the same machine.
That assumption breaks the moment the target is not x86_64 --
by default a compiler emits machine code for the host architecture,
so a kernel image built with a plain `make` is simply not recognized by an aarch64 board;
conversely, running a target-machine program on the development machine gets you `Exec format error` from the kernel.
The gap between an embedded device and a desktop goes beyond the instruction set:
no graphical interface, with the serial port as the main console;
storage counted in MBs to GBs, too small for a desktop distribution;
a boot chain that runs from the SoC's Boot ROM to U-Boot rather than UEFI to GRUB
(the relay race in
[Boot Process and Boot Management](../system-management/boot-process.md) swaps its first two runners here);
hardware described by a device tree instead of being auto-discovered through ACPI and PCI enumeration as on x86
(see Section 3 of [Computer Architecture](../hardware/architecture.md)).
This page extends kernel building to "building for a different machine":
toolchain, configuration, artifacts, transfer, verification --
the whole chain without real hardware, because QEMU can walk it end to end on the development machine.

> Content draws on the kernel's official documentation (Kernel Build System, devicetree) and on the U-Boot and QEMU documentation; see the references at the end.

## What This Part Covers

- The triple naming convention, and installing and verifying an aarch64 cross toolchain
- Cross-compiling the kernel with `ARCH=` and `CROSS_COMPILE=`, producing the Image, the dtb, and a module tree, and installing them into the target rootfs
- Reading the three-layer relationship of dts/dtsi/dtb
- Assembling a minimal rootfs by hand with BusyBox and reaching a shell in QEMU with the cross-compiled kernel
- Comparing the division of labor between U-Boot and the desktop boot chain
- Debugging foreign-architecture code with gdb-multiarch plus the QEMU gdbstub or gdbserver, and anticipating five classes of high-frequency failures

## 1. The Cross Toolchain: Matching a Compiler to the Target Architecture

Cross-compilation in essence makes the compiler emit "machine code another CPU can execute" --
`gcc` compiles for the host architecture by default (it builds whatever `uname -m` reports),
so producing aarch64 code requires a gcc configured for the aarch64 target,
plus the matching binutils (as/ld/objdump and friends that work on the target architecture)
and the target architecture's C library and headers.
That combination is a cross toolchain.

A toolchain prefix uses the four-part triple `arch-vendor-os-libc`:
architecture, vendor, OS, C library.
Distribution-provided toolchains usually drop the vendor segment --
`aarch64-linux-gnu-` is architecture aarch64, OS Linux, C library glibc;
the same scheme carries more facts:
the `hf` in `arm-linux-gnueabihf-` means the hard-float ABI, and it is binary-incompatible with the soft-float `arm-linux-gnueabi-`;
RISC-V is `riscv64-linux-gnu-`.
Each prefix is followed by the tool names --
`aarch64-linux-gnu-gcc`, `aarch64-linux-gnu-ld` --
and the kernel build system invokes them one by one precisely via this prefix.

Side-by-side install for the three families:

| Action | Debian/Ubuntu | RHEL/Rocky | Arch |
|------|---------------|------------|------|
| Cross gcc | `apt install gcc-aarch64-linux-gnu` | `dnf install gcc-aarch64-linux-gnu` | `pacman -S aarch64-linux-gnu-gcc` |
| Cross binutils | pulled in automatically with the gcc package | `dnf install binutils-aarch64-linux-gnu` | pulled in automatically with the gcc package |
| Device tree compiler dtc | `apt install device-tree-compiler` | `dnf install dtc` (in AppStream on EL9; older releases get it via EPEL) | `pacman -S dtc` |

You must verify after installing; two pieces of evidence, one job each.
First, compile a trivial program and check the output architecture with `file` --
and feel the meaning of "cross" while you are at it:

```bash
$ printf 'int main(){return 0;}\n' > t.c
$ aarch64-linux-gnu-gcc t.c -o a.out
$ file a.out
a.out: ELF 64-bit LSB executable, ARM aarch64, version 1 (GNU/Linux), ...
$ ./a.out
bash: ./a.out: cannot execute binary file: Exec format error  # it does not run, which is exactly the proof it is installed correctly
```

Second, confirm the C library headers are in place --
compiling any program that uses system calls means finding files like `stdio.h` in the sysroot:

```bash
$ aarch64-linux-gnu-gcc --print-sysroot   # should print a non-empty path; on Debian/Ubuntu it is usually just /
$ ls /usr/aarch64-linux-gnu/include/stdio.h   # where Debian/Ubuntu put the target architecture's C library headers
```

Sysroot layout differs across distributions, so do not insist on exact names;
there is a single criterion:
`file` reports the target architecture, the sysroot is non-empty, and its include directory holds headers.
Without the last one, the "header file not found" failure of Section 7 is already waiting for you.

## 2. Kernel Cross-Compilation: Image, dtb, and the Module Tree

The kernel build system supports cross-compilation natively, expressed entirely through two variables:
`ARCH=` tells it which architecture's directory to take configuration and code from (arm64 maps to `arch/arm64/`),
and `CROSS_COMPILE=` gives the toolchain prefix.
The full configure-and-build round:

```bash
$ export ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu-   # one export; every later make in this terminal inherits it
$ make O=build-arm64 defconfig        # take arm64's default configuration as the baseline, artifacts in a separate output directory
$ make O=build-arm64 menuconfig       # trim as needed
$ make O=build-arm64 -j$(nproc)       # parallel build; artifacts listed below
$ make O=build-arm64 dtbs             # explicitly build the device trees
```

The configuration mindset continues Section 5 of
[Kernel Build and Module Development](./build-and-modules.md) --
"start from a known baseline" --
but the baseline changes:
a native build takes the distribution config as its baseline and makes incremental changes,
while a cross build takes the target architecture's `defconfig`
(arm64's lives at `arch/arm64/configs/defconfig`).
The trimming direction is reversed as well --
a desktop config is "add whatever is missing",
whereas the embedded approach is "defconfig guarantees a boot, then remove hardware that does not exist".
The kernel an arm64 defconfig produces is an order of magnitude smaller than a distribution kernel,
and what room remains is mostly in drivers and filesystems:
drop the config options for NICs, GPUs, and SATA controllers that are not on the board;
keep the mmc subsystem if the storage is eMMC;
keep the NIC driver and root on NFS if the root is mounted over NFS.

There are three kinds of artifacts, each with a different destination:

- **The kernel image** `arch/arm64/boot/Image` -- arm64's uncompressed image (32-bit ARM produces zImage instead). `file` on it should report `ARM aarch64`; this is the preventive move against Section 7's first failure.
- **The device tree blob** `arch/arm64/boot/dts/<vendor>/*.dtb` -- such as `broadcom/bcm2711-rpi-4-b.dtb` for a Raspberry Pi 4; one per target board, expanded in Section 3.
- **The module tree** -- installed separately. `INSTALL_MOD_PATH` points at a directory where the target rootfs is mounted (or simply the directory you plan to package), and the modules are laid out following the `/lib/modules/<kernel version>/` structure:

```bash
$ make O=build-arm64 kernelrelease    # ask this build's version string first
6.12.7
$ make O=build-arm64 INSTALL_MOD_PATH=../rootfs modules_install   # laid out under ../rootfs/lib/modules/6.12.7/
```

Two disciplines matter more than the commands themselves.
First, `ARCH` and `CROSS_COMPILE` must be present for every single make invocation --
miss the variables on one command midway and the build system falls back to the host architecture,
mixing artifacts of two architectures into the same source tree;
this is a common root of Section 7's first failure.
Either export once or pass in full every time; do not trust memory.
Second, do not share an output directory between cross and native builds:
`O=` isolates the artifacts in a separate directory,
keeps the source tree clean,
and prevents the two builds from overwriting each other.

## 3. The Device Tree: Writing Hardware Facts Down for the Kernel

When an x86 machine boots, the firmware describes the hardware to the kernel through ACPI tables,
and PCIe devices appear on their own via bus enumeration.
An embedded SoC has no such mechanism:
memory-mapped peripherals, interrupt numbers, clocks, pin multiplexing --
these "hardware facts" are handed to the kernel as data structures by the Device Tree.
The three file layers:

- **dtsi** -- the shared, included layer. The chip vendor writes one per SoC (CPU core count, peripheral controllers, default addresses); boards in the same family share it.
- **dts** -- the board layer. It `#include`s the matching dtsi and adds only this board's differences from the shared layer (what is wired, what is enabled, how the pins run).
- **dtb** -- the binary compiled by dtc, delivered alongside the kernel image and passed from the bootloader to the kernel at boot.

After parsing the dtb, the kernel registers each device on its bus,
and then the three-part model of the
[Device Driver Framework](./driver-framework.md) takes over:
the `compatible` string in the driver's `of_match_table` is matched against the device tree node,
and only on a match does `probe` get its turn.
The device tree is where "the facts on the device side" of that page come from in the embedded world.

The most direct way to study a real device is to decompile it.
Any dtb you have lying around will do (a distribution kernel package, a board vendor's disc, a kernel-tree build artifact):

```bash
$ dtc -I dtb -O dts -o extracted.dts bcm2711-rpi-4-b.dtb   # binary back to readable source
$ grep -A3 'serial@' extracted.dts                          # look at a UART controller node
```

The decompiled dts is excellent reading material:
how many UARTs a board has, which controller the SD card hangs off, how the clock tree is configured -- all of it is in there.
On a running ARM machine there is a live counterpart --
`/sys/firmware/devicetree/base/` is the dtb the kernel received, unfolded into directories
([Computer Architecture](../hardware/architecture.md) mentions this path).
Incremental board-level changes do not require rebuilding the whole device tree:
write the differences as an overlay (`.dtbo`) and layer it on top of the base dtb at load time.
Who loads it and when (U-Boot or the running system) varies by board;
check the board's documentation when you use it.

## 4. rootfs and initramfs: The Minimal Root Filesystem

The last step of kernel startup is mounting the root filesystem and running the init inside it --
on a desktop this step goes through the initramfs
(the "transitional apartment" of
[Boot Process and Boot Management](../system-management/boot-process.md)),
where mkinitcpio/dracut probe the hardware and stuff in udev and the storage drivers,
running to tens or hundreds of MB.
The embedded approach assembles it by hand:
what hardware the board has is a fully known list,
so the rootfs can be as small as it needs to be -- a few MB suffice.

The classic recipe for a minimal usable rootfs is BusyBox --
a single statically linked binary implementing `sh`, `ls`, `mount`, `insmod`, and a hundred other commands (applets),
with every other command a symlink pointing at it:

```bash
$ tar xf busybox-*.tar.bz2 && cd busybox-*/
$ make defconfig
$ make -j$(nproc) CONFIG_STATIC=y     # static linking: no dependency on a C library in the target rootfs
$ make CONFIG_PREFIX=../rootfs install   # generate the directory skeleton and fill it with symlinks: bin/ sbin/ usr/
$ cd ../rootfs
$ mkdir -p dev proc sys etc
$ sudo mknod -m 622 dev/console c 5 1    # mandatory in an initramfs; without it the kernel has no console to print to
```

On the initramfs path the kernel looks for `/init`, and an ordinary shell script is enough:

```bash
# rootfs/init -- the entry the kernel executes after unpacking the initramfs
#!/bin/sh
mount -t proc none /proc
mount -t sysfs none /sys
exec /bin/sh          # drop straight into a shell: the shortest possible loop
```

Remember `chmod +x init`.
Finally pack it into the cpio format the kernel recognizes:

```bash
$ find . | cpio -o -H newc | gzip > ../rootfs.cpio.gz
```

The difference from mkinitcpio/dracut is worth spelling out:
the desktop tools solve the problem "you only learn what hardware this machine has at boot time", so they must probe;
a hand-built rootfs solves the problem "the hardware list is known and it must be small", so you write it yourself.
Both do the same thing --
build the initial user-space environment for the kernel once it is up --
they differ only in scale and automation.
If the rootfs lives on a disk partition instead of an initramfs,
the kernel looks for `/sbin/init` (BusyBox's install already created it; pair it with `/etc/inittab`), and the thinking does not change.

## 5. The Boot Chain: Where U-Boot Stands in the Relay

Take the relay race of
[Boot Process and Boot Management](../system-management/boot-process.md) and compare:
a desktop is firmware (UEFI) → GRUB → kernel → initramfs → systemd;
a typical embedded board is Boot ROM inside the SoC → SPL (secondary loader, optional) → U-Boot → kernel + dtb → mount rootfs.
U-Boot plays GRUB's part but works more directly:
it moves the image from eMMC, an SD card, or the network into memory,
prepares the kernel command line (bootargs),
and jumps.
No menu, no multi-OS selection --
most boards' U-Boot environment is a handful of `setenv` commands and a countdown.

A typical manual boot over the serial console:

```bash
# U-Boot serial session (variable names vary per board; run printenv first to see the current state)
setenv bootargs 'console=ttyAMA0 root=/dev/vda rw'   # kernel command line, GRUB's arguments in equivalent form
tftpboot ${kernel_addr_r} Image                      # fetch the kernel from the dev machine's TFTP server into memory
tftpboot ${fdt_addr_r} board.dtb                     # the device tree likewise goes to memory first
booti ${kernel_addr_r} - ${fdt_addr_r}               # the "-" stands for "no initramfs"; bootz is the 32-bit zImage counterpart
```

`booti` and `bootz` divide by image format:
`booti` loads arm64's Image,
`bootz` loads 32-bit ARM's zImage (the uImage format goes through `bootm`).
When the format does not match, U-Boot refuses to load --
this check is a good thing;
errors are usually caught before the kernel is entered at all.
The most valuable posture during development iteration is network booting:
U-Boot's `dhcp`/`tftpboot` fetches the freshly built kernel straight from a TFTP server on the development machine,
and with the kernel parameters `root=/dev/nfs nfsroot=<host>:<directory>` the rootfs is also mounted from an NFS directory on the network --
change a kernel version, restart, and see the result, with no more repeated SD card flashing.

## 6. Verifying with QEMU: The Whole Chain Without Hardware

On the development machine you can start an aarch64 virtual machine directly to validate all of the artifacts above.
The [KVM Virtualization](../server/virtualization/kvm.md) page runs same-architecture VMs with KVM hardware acceleration;
here, without acceleration flags, QEMU falls back to TCG (binary translation) and emulates aarch64 on x86_64 --
one to two orders of magnitude slower,
but booting the kernel to a shell still takes a few dozen seconds, more than enough for verification:

```bash
$ qemu-system-aarch64 -M virt -cpu cortex-a57 -nographic -m 512M \
    -kernel build-arm64/arch/arm64/boot/Image \
    -initrd rootfs.cpio.gz \
    -append "console=ttyAMA0"     # the virt machine's serial port is a PL011, i.e. ttyAMA0
```

Where the flags come from:
`-M virt` is QEMU's built-in generic aarch64 machine, which generates a device tree dynamically at startup and hands it to the kernel,
so `-dtb` is normally unnecessary --
only pass it explicitly to reproduce a real board's dtb;
the `-kernel`/`-initrd`/`-append` combination is equivalent to U-Boot's image-moving and bootargs steps.
Once it runs, the kernel log scrolls past, the initramfs's `/init` executes,
and the BusyBox shell prompt appears --
the chain is closed.
Exit with `Ctrl-A` then `x`.
To verify the disk-rootfs path instead of the initramfs,
attach a virtio disk with `-drive if=none,file=rootfs.ext4,format=raw,id=hd0 -device virtio-blk-device,drive=hd0`
and change bootargs correspondingly to `root=/dev/vda`.

## 7. Cross-Debugging: Attaching gdb to a Foreign Architecture

The debugger has to cross architectures too.
The gdb program itself supports multiple targets;
distributions just package it differently:
Debian/Ubuntu and Arch ship `gdb-multiarch`,
while RHEL-family gdb is built with `--enable-targets` for multiple targets (one binary handles everything), so nothing extra is needed.
Two common routes:

Attaching the kernel -- via QEMU's gdbstub.
`-s` makes QEMU open a gdb service on port 1234, and `-S` freezes the CPUs at startup;
open one terminal on each side:

```bash
$ qemu-system-aarch64 -M virt -cpu cortex-a57 -nographic -m 512M \
    -kernel build-arm64/arch/arm64/boot/Image -initrd rootfs.cpio.gz \
    -append "console=ttyAMA0" -s -S        # frozen and waiting; continue once gdb is connected
```

```bash
$ gdb-multiarch build-arm64/vmlinux        # use vmlinux with debug info, not the compressed Image
(gdb) target remote :1234
(gdb) b start_kernel                       # break at the kernel entry
(gdb) c
```

`vmlinux` is the kernel tree's uncompressed, symbol-bearing ELF
(complete debug info requires `CONFIG_DEBUG_INFO`);
`Image` is its compressed shell, and gdb only understands the former.
Once attached, stepping, breakpoints, and inspecting variables work just as they do on a native kernel --
it is the tool that locates early-boot problems one step earlier than printk.

Debugging user-space programs -- via gdbserver on the target:
on the board run `gdbserver :1234 /bin/app`,
on the host `gdb-multiarch app` and then `target remote <board IP>:1234`.
gdbserver itself must be cross-compiled with the same toolchain (the gdb source tree ships it),
and on the host side remember `set sysroot` pointing at the target architecture's sysroot,
or symbols and shared libraries will be matched against the wrong counterparts.
Lighter observation tools (strace and ftrace on the target) are covered in
[Kernel Tracing Tools](./tracing-tools.md);
their cross-scenario usage is identical to the native case.

## Common Failures

**The board shows no reaction to the flashed kernel -- check the image architecture with `file` first.** An x86_64 kernel on an ARM board shows up as U-Boot reporting `Wrong Image Format` and refusing to load,
or as no output at all.
Most often some make invocation missed `ARCH=`/`CROSS_COMPILE=`,
mixing artifacts of two architectures into one tree (the Section 2 discipline).
Verification in one line:
`file arch/arm64/boot/Image` must report `ARM aarch64`;
prevention comes from `O=` isolating output directories so cross and native builds are physically separate.

**A cross-compiled application reports missing headers -- the sysroot does not match.** The configure stage scrolling past `checking for xxx.h... no` usually has two causes:
the header really is not under the directory `--print-sysroot` points to (the C library development package is incomplete),
or the configure script ran a runtime test that executes a target-architecture program, which the host cannot run
(with cross-compilation such tests must be given explicit answers through cache variables; the autoconf manual has a chapter on this).
Do not bring the development machine's `/usr/include` into the sysroot --
inline assembly and macros smuggled inside host-architecture headers will lead the build into deeper trouble.

**insmod on the board reports Invalid module format -- vermagic does not match.** The cross variant of the same failure as
[Kernel Build and Module Development](./build-and-modules.md) Section 7:
compare `modinfo -F vermagic xxx.ko` character by character with the board's `uname -r`.
Cross scenarios add one more possibility:
the kernel running on the board and the source tree the module was built against are not the same,
or the module was put into the wrong version directory under `/lib/modules/`.
Once the version string matches, check SMP, preemption, and the other fields; every one must agree.

**A device never probes, or boot hangs -- the dtb and the kernel are not a pair.** The dtb is "the hardware facts for this kernel";
upgrade the kernel while keeping the old dtb and the node's `compatible` string may no longer match the new kernel driver's match table,
so `probe` silently never fires
(the matching step is in Section 3.3 of the
[Device Driver Framework](./driver-framework.md));
an earlier mismatch stalls outright in early boot.
The discipline is to upgrade the kernel and the dtb as a pair;
in the QEMU `-M virt` scenario QEMU generates the device tree itself, so this risk does not exist there.

**The kernel panics partway up with `Cannot open root device` -- the root= in bootargs is wrong.** The root in U-Boot's `setenv bootargs` points at a device node that does not exist:
an SD card should be named like `root=/dev/mmcblk0p2`,
a QEMU virtio disk is `root=/dev/vda`,
and the desktop-habit `/dev/sda1` simply is not found by the kernel.
The kernel accepts the parameter as given and panics when the mount fails,
so start debugging from the parameter itself:
in U-Boot, `printenv bootargs` to confirm what was passed,
then check it against the board's real device names.

## Division of Labor with the Other Pages of This Part

This page owns "building the kernel for another architecture":
toolchain, configuration baseline, artifact transfer, hardware-free verification.
[Kernel Build and Module Development](./build-and-modules.md) owns the same-machine build and module loop;
headers installation, menuconfig details, and boot-entry management defer to that page.
[Device Driver Framework](./driver-framework.md) owns the kernel-internal bus/device/driver model,
and this page's device trees are its source of "hardware-side facts".
Together the three pages form the complete path:
get the source → run it locally → build it for another machine.

## References

- The kernel build system (Kbuild) documentation -- [docs.kernel.org/kbuild/](https://docs.kernel.org/kbuild/index.html) (including the kbuild and kconfig syntax)
- The kernel device tree documentation -- [docs.kernel.org/devicetree/](https://docs.kernel.org/devicetree/index.html) (`Documentation/devicetree/` in the kernel tree)
- The official U-Boot documentation -- [docs.u-boot.org](https://docs.u-boot.org/) (booti/bootz and environment variables)
- BusyBox -- [busybox.net](https://busybox.net/) (building, CONFIG_STATIC, CONFIG_PREFIX)
- QEMU documentation -- [www.qemu.org/docs/master/](https://www.qemu.org/docs/master/) (the aarch64 virt machine and the gdbstub)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [tarball](/basic/packages/tarball.md)
- [knowledge](/knowledge.md)
- [README](/research/README.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [README](README.md)
