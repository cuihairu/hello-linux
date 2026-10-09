# 交叉编译与嵌入式

[内核编译与模块开发](./build-and-modules.md)那套流程有一个隐含前提：编译、运行、验证发生在同一台机器上。目标机不是 x86_64 时这个前提就断了——编译器默认产出宿主架构的机器码，直接 `make` 出来的内核镜像，aarch64 的板子根本不认；反过来在开发机上运行目标机程序，内核会回一句 `Exec format error`。嵌入式设备与桌面机的差距不止指令集：没有图形界面，串口是主控制台；存储以 MB 到 GB 计，装不下桌面发行版；启动链路是 SoC 内的 Boot ROM 到 U-Boot，而非 UEFI 到 GRUB（[开机流程与引导管理](../system-management/boot-process.md)的接力赛在这里换了前两棒选手）；硬件靠设备树描述，而不像 x86 那样由 ACPI 与 PCI 枚举自动发现（见[计算机体系结构](../hardware/architecture.md)第 3 节）。本页把内核构建延伸到"做给别的机器"：工具链、配置、产出、搬运、验证，全程不依赖真实硬件——QEMU 能在开发机上把这条链完整走一遍。

> 内容参考自内核官方文档（Kernel Build System、devicetree）、U-Boot 与 QEMU 文档，见文末参考资料。

## 学习目标

- 说清三元组命名规则，装好并验证一套 aarch64 交叉工具链
- 用 `ARCH=` 与 `CROSS_COMPILE=` 完成内核交叉编译，产出 Image、dtb 与模块树并装进目标 rootfs
- 读懂 dts/dtsi/dtb 三层关系，会用 dtc 反编译一块现成设备的设备树
- 用 BusyBox 手工组一个最小 rootfs，连同交叉编译的内核一起在 QEMU 里跑到 shell
- 对比 U-Boot 与桌面机引导链的分工，会写一组 bootargs 让内核挂上根文件系统
- 用 gdb-multiarch 加 QEMU gdbstub 或 gdbserver 调试异架构代码，预判五类高频故障

## 1. 交叉工具链：给目标架构配编译器

交叉编译的本质是让编译器产出"另一种 CPU 能执行的机器码"——`gcc` 默认按宿主架构编译（`uname -m` 报什么就编什么），要产出 aarch64 代码就需要一个配置为 aarch64 目标的 gcc，以及配套的 binutils（as/ld/objdump 等按目标架构工作的二进制工具）和目标架构的 C 库与头文件。这套组合就是交叉工具链。

工具链前缀的三元组命名是 `arch-vendor-os-libc` 四段：架构、厂商、系统、C 库。发行版自带的工具链通常省掉厂商段，`aarch64-linux-gnu-` 即架构 aarch64、系统 Linux、C 库 glibc；同一段式里还能读出更多事实——`arm-linux-gnueabihf-` 的 `hf` 表示硬浮点 ABI，与 `arm-linux-gnueabi-` 的软浮点二进制互不兼容；RISC-V 则是 `riscv64-linux-gnu-`。前缀后面跟的是各工具的名字：`aarch64-linux-gnu-gcc`、`aarch64-linux-gnu-ld`，内核构建系统就靠这个前缀逐个调用它们。

三系安装对照：

| 操作 | Debian/Ubuntu | RHEL/Rocky | Arch |
|------|---------------|------------|------|
| 交叉 gcc | `apt install gcc-aarch64-linux-gnu` | `dnf install gcc-aarch64-linux-gnu` | `pacman -S aarch64-linux-gnu-gcc` |
| 交叉 binutils | 随 gcc 包自动带入 | `dnf install binutils-aarch64-linux-gnu` | 随 gcc 包自动带入 |
| 设备树编译器 dtc | `apt install device-tree-compiler` | `dnf install dtc`（EL9 已在 AppStream；更老版本若缺则经 EPEL） | `pacman -S dtc` |

装完必须验证，两条证据各管一件事。其一，编译一个空程序并用 `file` 看产出架构——顺手体会一下"交叉"的含义：

```bash
$ printf 'int main(){return 0;}\n' > t.c
$ aarch64-linux-gnu-gcc t.c -o a.out
$ file a.out
a.out: ELF 64-bit LSB executable, ARM aarch64, version 1 (GNU/Linux), ...
$ ./a.out
bash: ./a.out: cannot execute binary file: Exec format error  # 跑不起来，反而说明装对了
```

其二，确认 C 库头文件就位——编译任何用到系统调用的程序都要在 sysroot 里找 `stdio.h` 这类文件：

```bash
$ aarch64-linux-gnu-gcc --print-sysroot   # 应打印非空路径，Debian/Ubuntu 上通常就是 /
$ ls /usr/aarch64-linux-gnu/include/stdio.h   # Debian/Ubuntu 的目标架构 C 库头文件位置
```

sysroot 的目录布局各发行版不同，不必对名，判断标准只有一条：`file` 报出目标架构、sysroot 非空且其下 include 目录有头文件。缺了后者，第 7 节的"头文件找不到"故障就在前面等你。

## 2. 内核交叉编译：Image、dtb 与模块树

内核构建系统原生支持交叉编译，全部通过两个变量表达：`ARCH=` 告诉它按哪个架构的目录取配置与代码（arm64 对应 `arch/arm64/`），`CROSS_COMPILE=` 给出工具链前缀。配置与编译的完整一轮：

```bash
$ export ARCH=arm64 CROSS_COMPILE=aarch64-linux-gnu-   # 一次 export，本终端后续 make 都生效
$ make O=build-arm64 defconfig        # 以 arm64 的默认配置为基线，产物放进独立输出目录
$ make O=build-arm64 menuconfig       # 按需裁剪
$ make O=build-arm64 -j$(nproc)       # 并行编译，产出见下
$ make O=build-arm64 dtbs             # 显式编译设备树
```

配置的思路与[内核编译与模块开发](./build-and-modules.md)第 5 节"从已知基线出发"一脉相承，但基线换了：本机构建以发行版 config 为基线做增量，交叉构建以目标架构的 `defconfig`（arm64 在 `arch/arm64/configs/defconfig`）为基线。裁剪方向也相反——桌面机配置是"缺什么补什么"，嵌入式是"defconfig 保证能启动，然后按需去掉不存在的硬件"。arm64 defconfig 产出的内核比发行版内核小一个量级，再往下裁的空间主要在驱动与文件系统：板子上没有的网卡、显卡、SATA 控制器对应的配置项去掉，用的存储是 eMMC 就保住 mmc 子系统，用 NFS 挂根就保住网卡驱动与 root on NFS。

产物有三类，去向各不相同：

- **内核镜像** `arch/arm64/boot/Image`——arm64 的未压缩镜像（32 位 ARM 产出的是 zImage）。`file` 检查它应报 `ARM aarch64`，这是第 7 节故障一的预防动作。
- **设备树二进制** `arch/arm64/boot/dts/<厂商>/*.dtb`——如树莓派 4 的 `broadcom/bcm2711-rpi-4-b.dtb`，与目标板一一对应，第 3 节展开。
- **模块树**——单独安装。`INSTALL_MOD_PATH` 指向一个挂载了目标 rootfs 的目录（或干脆是准备打包的目录），模块按 `/lib/modules/<内核版本>/` 的结构铺进去：

```bash
$ make O=build-arm64 kernelrelease    # 先问这份构建的版本号
6.12.7
$ make O=build-arm64 INSTALL_MOD_PATH=../rootfs modules_install   # 铺进 ../rootfs/lib/modules/6.12.7/
```

两条纪律比命令本身重要。其一，`ARCH` 与 `CROSS_COMPILE` 必须贯穿每一轮 make——中途一条命令漏掉变量，构建系统就回退到本机架构，在同一棵源码树里混出两种架构的产物，这是第 7 节故障一的常见根源；`export` 一次或每次都带全，别凭记忆。其二，交叉构建与本机构建不要共用输出目录：`O=` 把产物隔离到独立目录，源码树保持干净，两种构建互不覆盖。

## 3. 设备树：把硬件事实写给内核

x86 机器开机时，固件通过 ACPI 表向内核描述硬件，PCIe 设备靠总线枚举自动出现；嵌入式 SoC 上没有这套机制，内存映射的外设、中断号、时钟、引脚复用这些"硬件事实"由设备树（Device Tree）以数据结构的形式交给内核。三层文件的关系：

- **dtsi**——被包含的公共层。芯片厂商为 SoC 写一份（CPU 核数、外设控制器、默认地址），同系列开发板共享；
- **dts**——板级层。`#include` 对应的 dtsi，只补这块板子与公共层的差异（接了什么、使能了什么、引脚怎么走）；
- **dtb**——dtc 编译出的二进制，与内核镜像一起交付，由 bootloader 在启动时传给内核。

内核解析 dtb 后，把其中的设备逐一注册到对应总线，随后进入[设备驱动框架](./driver-framework.md)的三元模型：驱动侧 `of_match_table` 里的 `compatible` 字符串与设备树节点匹配，匹配成功才轮到 `probe`。设备树是那个页面上"设备一侧的事实"在嵌入式世界的来源。

看现成设备最直接的办法是反编译。手头有任何一个 dtb（发行版内核包、开发板资料光盘、内核树编译产物）都可以：

```bash
$ dtc -I dtb -O dts -o extracted.dts bcm2711-rpi-4-b.dtb   # 二进制还原为可读源码
$ grep -A3 'serial@' extracted.dts                          # 找 UART 控制器节点看看
```

反编译出来的 dts 是绝佳的阅读材料：某块板子上有几个 UART、SD 卡挂在哪个控制器、时钟树怎么配，全在里面。运行中的 ARM 机器上还有活的对照物——`/sys/firmware/devicetree/base/` 就是内核收到的 dtb 按目录展开的形态（[计算机体系结构](../hardware/architecture.md)提过这条路径）。板级差异的增量修改不必重编整份设备树：把差异写成 overlay（`.dtbo`），加载时叠加在基础 dtb 之上即可，何时由谁加载（U-Boot 或系统运行期）各板不同，用的时候随板子文档核实。

## 4. rootfs 与 initramfs：最小根文件系统

内核启动到最后一步是挂载根文件系统并执行其中的 init——桌面机这一步由 initramfs 过渡（[开机流程与引导管理](../system-management/boot-process.md)的"过渡房"），mkinitcpio/dracut 会探测硬件、塞进 udev 与存储驱动，体积几十上百 MB。嵌入式场景的做法是手工组装：板子上有什么硬件是完全已知的清单，rootfs 按需做小，几个 MB 就够。

最小可用 rootfs 的经典配方是 BusyBox——一个静态链接的二进制实现了 `sh`、`ls`、`mount`、`insmod` 等上百个命令（applet），其余命令是指向它的符号链接：

```bash
$ tar xf busybox-*.tar.bz2 && cd busybox-*/
$ make defconfig
$ make -j$(nproc) CONFIG_STATIC=y     # 静态链接：不依赖目标 rootfs 里有 C 库
$ make CONFIG_PREFIX=../rootfs install   # 生成目录骨架并装满符号链接：bin/ sbin/ usr/
$ cd ../rootfs
$ mkdir -p dev proc sys etc
$ sudo mknod -m 622 dev/console c 5 1    # initramfs 里必须有它，否则内核无控制台可输出
```

initramfs 路径下内核找的是 `/init`，一个普通 shell 脚本即可：

```bash
# rootfs/init —— 内核解包 initramfs 后执行的入口
#!/bin/sh
mount -t proc none /proc
mount -t sysfs none /sys
exec /bin/sh          # 直接落到 shell，闭环最短
```

记得 `chmod +x init`。最后打成内核认得的 cpio 格式：

```bash
$ find . | cpio -o -H newc | gzip > ../rootfs.cpio.gz
```

与 mkinitcpio/dracut 的差别值得说透：桌面机工具解决的是"启动时才知道这台机器有什么硬件"的问题，所以要做探测；手工 rootfs 解决的是"硬件清单已知且必须小"的问题，所以自己写。两者做的是同一件事——给内核起来之后搭出初的用户态环境，规模与自动化程度不同而已。rootfs 若放在磁盘分区而非 initramfs，内核找的则是 `/sbin/init`（BusyBox install 已生成，配 `/etc/inittab` 工作），思路不变。

## 5. 引导链：U-Boot 站在哪一棒

把[开机流程与引导管理](../system-management/boot-process.md)的接力赛搬来对照：桌面机是固件（UEFI）→ GRUB → 内核 → initramfs → systemd；典型的嵌入式板是 SoC 内的 Boot ROM → SPL（二级加载，可选）→ U-Boot → 内核 + dtb → 挂 rootfs。U-Boot 扮演 GRUB 的角色但干得更直接：从 eMMC、SD 卡或网络把镜像搬到内存，准备好内核命令行（bootargs），然后跳转。没有菜单、没有多系统选择，多数板的 U-Boot 环境就是几条 `setenv` 加一个倒计时。

串口里一次典型的手动引导：

```bash
# U-Boot 串口会话（变量名随板而异，printenv 先看现状）
setenv bootargs 'console=ttyAMA0 root=/dev/vda rw'   # 内核命令行，等价 GRUB 的传参
tftpboot ${kernel_addr_r} Image                      # 从开发机的 TFTP 服务器取内核到内存
tftpboot ${fdt_addr_r} board.dtb                     # 设备树同样先取到内存
booti ${kernel_addr_r} - ${fdt_addr_r}               # "-" 占位"没有 initramfs"；bootz 对应 32 位 zImage
```

`booti` 与 `bootz` 的分工按镜像格式分：`booti` 加载 arm64 的 Image，`bootz` 加载 32 位 ARM 的 zImage（uImage 格式则走 `bootm`）。格式对不上时 U-Boot 会拒绝加载，这层检查是好事——错误往往在进内核之前就被拦住了。开发迭代期间最有价值的姿势是网络启动：U-Boot 的 `dhcp`/`tftpboot` 直接从开发机上的 TFTP 服务器取新编译的内核，配合内核参数 `root=/dev/nfs nfsroot=<主机>:<目录>` 让 rootfs 也挂在网络的 NFS 目录上，改一版内核重启即见效，省去反复烧写 SD 卡。

## 6. 用 QEMU 验证：没有硬件也走完整链

开发机上可以直接起一个 aarch64 虚拟机来验收上面的全部产物。[KVM 虚拟化](../server/virtualization/kvm.md)一页的 QEMU 用 KVM 硬件加速跑同架构虚机；这里不带加速参数，QEMU 退回 TCG（二进制翻译）在 x86_64 上仿真 aarch64，速度慢一到两个数量级，但把内核引导到 shell 也就几十秒，做验证绰绰有余：

```bash
$ qemu-system-aarch64 -M virt -cpu cortex-a57 -nographic -m 512M \
    -kernel build-arm64/arch/arm64/boot/Image \
    -initrd rootfs.cpio.gz \
    -append "console=ttyAMA0"     # virt 机的串口是 PL011，对应 ttyAMA0
```

几处参数的来历：`-M virt` 是 QEMU 内置的通用 aarch64 机型，启动时由 QEMU 动态生成一份设备树传给内核，所以一般不需要 `-dtb`——要复现真实板子的 dtb 时才显式传入；`-kernel`/`-initrd`/`-append` 的组合等价于 U-Boot 搬镜像加传 bootargs 的那几步。跑起来后内核日志滚过、initramfs 的 `/init` 执行、BusyBox 的 shell 提示符出现，这条链就算闭环了；退出用 `Ctrl-A` 然后 `x`。想验证磁盘 rootfs 路径而不是 initramfs，用 `-drive if=none,file=rootfs.ext4,format=raw,id=hd0 -device virtio-blk-device,drive=hd0` 挂一块 virtio 磁盘，bootargs 对应改成 `root=/dev/vda`。

## 7. 交叉调试：gdb 挂上异架构

调试器同样要跨架构。gdb 主程序本身支持多目标，发行版把它拆装在不同包里：Debian/Ubuntu 与 Arch 都是 `gdb-multiarch`，RHEL 系的 gdb 构建时即以 `--enable-targets` 开启多目标（一个二进制通吃），无需另装。两条常用路径：

挂内核——用 QEMU 的 gdbstub。`-s` 让 QEMU 在 1234 端口开一个 gdb 服务，`-S` 让 CPU 开机即冻结，两边各起一个终端：

```bash
$ qemu-system-aarch64 -M virt -cpu cortex-a57 -nographic -m 512M \
    -kernel build-arm64/arch/arm64/boot/Image -initrd rootfs.cpio.gz \
    -append "console=ttyAMA0" -s -S        # 冻结等待，gdb 连上后继续
```

```bash
$ gdb-multiarch build-arm64/vmlinux        # 用带调试信息的 vmlinux，不是压缩后的 Image
(gdb) target remote :1234
(gdb) b start_kernel                       # 在内核入口下断
(gdb) c
```

`vmlinux` 是内核树里未经压缩、带符号的 ELF（开了 `CONFIG_DEBUG_INFO` 才有完整调试信息），`Image` 是它的压缩壳，gdb 只认前者。挂上之后单步、断点、看变量与调试本机内核无异，比 printk 早一步定位启动早期问题的手段就是它。

调用户态程序——用目标机上的 gdbserver：板上 `gdbserver :1234 /bin/app`，主机 `gdb-multiarch app` 后 `target remote <板子IP>:1234`。gdbserver 本身也要用同一工具链交叉编译（gdb 源码树自带它），主机侧记得 `set sysroot` 指向目标架构的 sysroot，否则符号与共享库会对错对象。更轻量的观察手段（strace、ftrace 在目标机上的用法）见[内核跟踪工具](./tracing-tools.md)，两者在交叉场景的用法与同架构一致。

## 常见故障

**烧进去的内核板子没反应——先 `file` 检查镜像架构。** x86_64 内核进 arm 板的表现是 U-Boot 报 `Wrong Image Format` 拒绝加载，或干脆无输出。根源多数是某条 make 漏了 `ARCH=`/`CROSS_COMPILE=`，同一棵树里混出了两种架构的产物（第 2 节纪律）。验证一行：`file arch/arm64/boot/Image` 必须报 `ARM aarch64`；预防靠 `O=` 隔离输出目录，让交叉与本机构建物理上分开。

**交叉编译应用时报头文件找不到——sysroot 没对上。** configure 阶段刷出一排 `checking for xxx.h... no`，通常是两个原因：头文件确实不在 `--print-sysroot` 指向的目录下（C 库开发包没装全），或者 configure 脚本跑了目标架构程序在主机上无法执行的运行期测试（交叉编译时这类测试必须用缓存变量显式给出答案，autoconf 手册有对应章节）。别把开发机的 `/usr/include` 拷进 sysroot——主机架构的头文件里夹带的内联汇编与宏会把构建带进更深的坑。

**板上 insmod 报 Invalid module format——vermagic 不匹配。** 与[内核编译与模块开发](./build-and-modules.md)第 7 节同款故障的交叉变体：`modinfo -F vermagic xxx.ko` 与板上 `uname -r` 逐字对比。交叉场景多一种可能——板上跑的内核与编译模块时针对的源码树不是同一份，或模块拷错了 `/lib/modules/` 下的版本目录。版本串对上了再看 SMP、抢占等字段，逐项都要一致。

**设备 probe 不上或启动卡死——dtb 与内核不配套。** dtb 是"给这份内核的硬件事实"，内核升级了而 dtb 还是旧的，节点的 `compatible` 字符串可能与新内核驱动的匹配表对不上，probe 静默不触发（匹配环节见[设备驱动框架](./driver-framework.md)第 3.3 节）；更早的错位直接卡在启动初期。纪律是内核与 dtb 成对升级；QEMU `-M virt` 场景让 QEMU 自动生成设备树，这层风险天然不存在。

**内核起一半 panic `Cannot open root device`——bootargs 的 root= 写错。** U-Boot `setenv bootargs` 里的 root 指向了不存在的设备节点：SD 卡应是 `root=/dev/mmcblk0p2` 这类命名，QEMU virtio 磁盘是 `root=/dev/vda`，写成本机习惯的 `/dev/sda1` 内核找不到。内核把参数原样收下、挂载失败即 panic，所以排查从参数本身入手：U-Boot 里 `printenv bootargs` 确认传了什么，再按目标板的真实设备名核对。

## 与本篇其它页的分工

本页管"把内核做给别的架构"：工具链、配置基线、产出搬运与无硬件验证。[内核编译与模块开发](./build-and-modules.md)管同一台机器上的构建与模块闭环，headers 安装、menuconfig 细节与引导项管理以那一页为准；[设备驱动框架](./driver-framework.md)管内核内部的 bus/device/driver 模型，本页的设备树是它"硬件一侧事实"的来源。三页合起来，是"拿到源码 → 本机跑通 → 做给别的机器"的完整路径。

## 参考资料

- 内核构建系统（Kbuild）文档 — [docs.kernel.org/kbuild/](https://docs.kernel.org/kbuild/index.html)（含 kbuild与 kconfig 语法）
- 内核设备树文档 — [docs.kernel.org/devicetree/](https://docs.kernel.org/devicetree/index.html)（内核树内 `Documentation/devicetree/`）
- U-Boot 官方文档 — [docs.u-boot.org](https://docs.u-boot.org/)（booti/bootz 与环境变量）
- BusyBox — [busybox.net](https://busybox.net/)（构建与 CONFIG_STATIC、CONFIG_PREFIX）
- QEMU 文档 — [www.qemu.org/docs/master/](https://www.qemu.org/docs/master/)（aarch64 virt 机型与 gdbstub）
