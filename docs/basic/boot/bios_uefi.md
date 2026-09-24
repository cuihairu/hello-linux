# BIOS 与 UEFI

按下电源键的第一件事，是让一段"比操作系统还早"的程序接管硬件：它要初始化 CPU、内存控制器、显卡，再决定从磁盘的哪个位置把控制权交给引导加载器。这段程序今天有两代实现——传统的 **BIOS**（Basic Input/Output System）与现代的 **UEFI**（Unified Extensible Firmware Interface）。两者看似只差一个字母，背后却是两套完全不同的分区约定、引导路径与安全模型：BIOS 把引导代码塞进 MBR 前 446 字节、最多认 4 个主分区和 2 TB 磁盘；UEFI 则要求磁盘上有一个专门的 FAT 分区（ESP），由固件按路径直接执行 `.efi` 文件，并把"从哪启动"记进主板 NVRAM。选错模式的代价很具体：装完系统找不到启动项、Windows 更新后 Linux 从启动菜单消失、或者 3 TB 硬盘只有 2 TB 可用——这些问题几乎都能追溯到"固件模式与磁盘布局不匹配"。本页把两种模式的机制讲透，并给出三系发行版的分区建议。

> 内容参考自 Arch Wiki、RHEL 官方文档与鸟哥的私房菜，见文末参考资料。

## 学习目标

- 分清 BIOS 与 UEFI 在分区表、引导路径、安全启动上的本质差异
- 理解 **UEFI + NVRAM + ESP** 三位一体机制为什么缺一不可
- 会用 `lsblk`、`fdisk -l`、`efibootmgr` 判断当前启动模式并定位 ESP
- 掌握三系（Debian/Ubuntu、Arch、RHEL/CentOS/Rocky）的分区建议与挂载惯例
- 规避 CSM/Legacy-on-UEFI 混合模式的典型陷阱

## 1. BIOS 的历史包袱

BIOS 诞生于 1975 年的 IBM PC，设计目标是在 16 位实模式、1 MB 寻址空间内完成自检并引导。它的引导流程简单到几乎可以背下来：

1. 上电自检（POST），初始化显卡、内存；
2. 按 CMOS 里保存的启动顺序，读取目标磁盘的 **MBR**（主引导记录，512 字节）；
3. 检查 MBR 末尾的 `0x55AA` 魔数，把前 446 字节的引导代码加载到内存 `0x7C00` 并跳转执行；
4. 引导代码（如 GRUB 的 `boot.img`）再找到分区中的后续部分（`core.img`），最终加载内核。

这套流程有几个今天看来致命的限制：

| 限制 | 数值 | 后果 |
|------|------|------|
| 分区表 | MBR（32 位扇区号） | 最大 2 TiB 磁盘（2^32 × 512B） |
| 主分区数 | 4 个 | 超过必须用扩展分区 + 逻辑分区绕行 |
| 引导代码空间 | 446 字节 | 只够放一段极简的 stub，真正的引导逻辑要另找地方 |
| 安全性 | 无签名验证 | 任何能写 MBR 的代码都会在下次开机被执行 |

446 字节的限制解释了为什么 GRUB 要设计成两段：MBR 里的 `boot.img` 只负责加载 `core.img`，后者才包含文件系统驱动与菜单逻辑。也解释了为什么 `grub-install` 既要写 MBR、又要往分区里塞一堆模块文件——单靠那 446 字节根本装不下完整引导器。

## 2. UEFI：把引导变成"运行一个程序"

UEFI 抛弃了"读 MBR 前 446 字节"的隐式约定，改用一套显式的、基于文件的引导协议。理解它只需要抓住三个关键词：**GPT**、**ESP**、**NVRAM**。

### 2.1 GPT 分区表

GUID 分区表用 64 位扇区号，理论支持 9.4 ZB 磁盘，并且每个分区都有全局唯一 GUID，分区类型不再靠"4 个主分区"这种资源位表示。Linux 下可用 `fdisk -l` 查看：

```bash
$ sudo fdisk -l /dev/sda
Disklabel type: gpt          ← GPT；若是 MBR 会显示 dos
Disk identifier: 7A3C9E2F-...

Device       Start       End   Sectors  Size Type
/dev/sda1     2048    105062    103015   50M EFI System
/dev/sda2   105063  ...

Number  Start (sector)    End (sector)       Code  Name
       1            2048          105062    EF00  EFI system partition
```

`Code` 列的 `EF00`（fdisk）或 `EF00`/`c12a7328-...` 就是分区类型 GUID，标识这是 ESP。

### 2.2 EFI 系统分区（ESP）

UEFI 不读引导代码，它**按路径找可执行文件**：固件会枚举所有被标记为"EFI System"的分区，挂上 FAT 文件系统，寻找形如 `\EFI\<厂商名或 bootloader 名>\xxx.efi` 的文件并执行它。这个分区就是 ESP（EFI System Partition）。

关键约束：

- **必须是 FAT32**（多数固件只认 FAT12/16/32，不认 ext4/NTFS——这是跨平台兼容的代价）；
- 常见容量 100–512 MB，需容纳所有操作系统的 `.efi` 文件及 `EFI/BOOT/BOOTX64.EFI` 回退路径；
- 三系默认挂载点：Debian/Ubuntu 与 RHEL/CentOS/Rocky 通常挂 `/boot/efi`，**Arch Wiki 推荐直接把 ESP 挂为 `/boot`**（内核、initramfs 也放进去，简化引导路径）。

在 Linux 下定位 ESP：

```bash
# 方法一：按分区类型 GUID 过滤（GPT 上 ESP 的 PARTTYPE）
$ lsblk -o NAME,PARTTYPE,FSTYPE,MOUNTPOINT
sda1  c12a7328-f81f-11d2-ba4b-00a0c93ec93b  vfat  /boot/efi
# ↑ 这个 GUID 是 UEFI 规范里 ESP 的固定类型标识，三系通用

# 方法二：直接看已挂载点
$ mount | grep -i efi
/dev/sda1 on /boot/efi type vfat (rw,relatime,fmask=0077,dmask=0077,codepage=437,iocharset=ascii,shortname=mixed,utf8,errors=remount-ro)
```

`c12a7328-f81f-11d2-ba4b-00a0c93ec93b` 是需要背下来的常量——救援时分区表乱了，靠它才能从一堆分区里认出"哪个是 ESP"。

### 2.3 NVRAM 启动项

BIOS 时代"从哪启动"只存在于 CMOS 设置菜单里；UEFI 把它做成了一张可以被操作系统读写的表——**NVRAM 启动项**。每个条目记录"名称 + EFI 文件路径 + 可选的可移动介质标志"，固件按序执行。Linux 下用 `efibootmgr` 操作：

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

解读几行关键信息：

- `BootCurrent: 0002`——本次开机实际启动的条目；
- `BootOrder`——固件尝试顺序，第一项失败才尝试第二项；
- 每个 `Boot000X*` 后的 `HD(1,GPT,...)` 是分区唯一标识（用 PARTUUID 而非 `/dev/sda1`，避免设备名漂移），`File(\EFI\ubuntu\shimx64.efi)` 是分区内的相对路径。

常见操作：

```bash
# 调整启动顺序（参数是条目编号列表）
sudo efibootmgr -o 0002,0001,0000

# 删除某个启动项（如清掉旧的 USB 引导残留）
sudo efibootmgr -b 0003 -B

# 新增一条（通常由 grub-install 自动完成，不必手敲）
sudo efibootmgr -c -d /dev/sda -p 1 -L "Arch Linux" -l '\EFI\arch\grubx64.efi'
```

NVRAM 是掉电保存的，所以"拔了硬盘换机器"或"主板电池没电"都会让启动项重置——这也是双系统用户常遇到"Windows 更新后 Linux 消失"的物理层原因：Windows 的更新程序会重写 BootOrder，把 `Windows Boot Manager` 挪到第一位，若 Linux 条目还在只是顺序变了，用 `efibootmgr -o` 调回来即可；若条目真没了，需要进 Live USB chroot 重新 `grub-install`。

### 2.4 Secure Boot

UEFI 规范还定义了 Secure Boot：固件只执行签名验证通过的 `.efi` 文件。发行版的应对策略是引入二级信任链——Microsoft 签名的 `shimx64.efi` 作为第一级，再由它验证发行版自己的 `grubx64.efi`（后者持有发行版密钥）。所以你在 ESP 里常看到：

```text
EFI/ubuntu/shimx64.efi      ← Microsoft OEM 密钥签名，固件直接信任
EFI/ubuntu/grubx64.efi      ← 发行版自签，由 shim 验证
EFI/BOOT/BOOTX64.EFI        ← 可移动介质回退路径（常是 shim 的副本）
```

Debian/Ubuntu、RHEL/CentOS/Rocky 默认都支持 Secure Boot 开箱即用；Arch 默认不签名，若主板开着 Secure Boot 需自行配置 `sbsigntools` 或改用 `sbctl`，新手建议先在 BIOS 设置里关掉 Secure Boot。

## 3. 对照总表

| 特性 | BIOS（Legacy） | UEFI |
|------|---------------|------|
| 分区表 | MBR | GPT（兼容也支持 MBR） |
| 最大磁盘 | 2 TiB | 9.4 ZB |
| 主分区上限 | 4 个 | 理论无限制（通常 128） |
| 引导代码位置 | MBR 前 446 字节 + 分区中的 `core.img` | ESP 内的 `.efi` 文件 |
| 启动项管理 | CMOS 菜单，OS 难以改写 | NVRAM，`efibootmgr` 可读写 |
| 安全启动 | 无 | Secure Boot 签名验证 |
| 模式切换 | - | CSM/Legacy 可模拟 BIOS（见常见坑） |
| 分区工具标记 | 无特殊类型 | `EF00` / PARTTYPE `c12a7328-...` |

## 4. 判断当前启动模式

装系统、排障前的第一步永远是确认固件模式，三种独立方法互为印证：

```bash
# 方法一（最可靠）：内核是否暴露了 EFI 接口
$ ls /sys/firmware/efi
config_table  efi  esrt  fw_vendor  runtime  runtime-map  systab
# ↑ 目录存在 = UEFI 模式启动；不存在（No such file）= Legacy BIOS

# 方法二：efibootmgr 能否工作
$ efibootmgr
# UEFI：正常输出 BootCurrent/BootOrder
# Legacy：报 "EFI variables are not supported"

# 方法三：分区表与挂载点交叉验证
$ lsblk -o NAME,PARTTYPE,FSTYPE,MOUNTPOINT | head
# 同时看到 GPT + vfat ESP 挂载 → 几乎确定是 UEFI 安装
```

**常见坑**：安装介质也分模式——同一个 U 盘在启动菜单里通常会出现两份条目，带 "UEFI" 前缀的走 UEFI 路径，不带的强制 Legacy。若磁盘已按 GPT+ESP 布局，却选了 Legacy 条目启动安装程序，安装器会报"找不到 EFI 分区"或把引导装进 MBR 导致固件认不到。安装前用上面方法一确认 Live 环境的模式，与目标模式保持一致。

## 5. 三系分区建议

无论哪系，最小可用的 UEFI/GPT 布局都包含这几块：

| 分区 | 文件系统 | 典型大小 | 用途 |
|------|---------|---------|------|
| ESP | FAT32 | 100–512 MB | 存放所有 OS 的 `.efi` 文件 |
| `/boot` | ext4（或并入 ESP） | 1 GB 左右 | 内核、initramfs、GRUB 模块 |
| `/` | ext4/xfs/btrfs | 余下空间 | 根文件系统 |
| swap（可选） | swap | ≥ 内存大小（或按需） | 交换空间 |

三系惯例差异：

- **Debian/Ubuntu**：安装器自动建 ESP（通常 512 MB，`/boot/efi`），其余默认 ext4 根分区 + swap。手动分区时保持 ESP 挂 `/boot/efi` 即可与安装器行为一致。
- **RHEL/CentOS/Rocky**：同样是 `/boot/efi` 惯例；服务器场景常用 XFS 作为根文件系统（RHEL 7 起默认），LVM 之上再分逻辑卷。
- **Arch**：Wiki 明确推荐 **ESP 直接挂为 `/boot`**（此时不再需要单独的 `/boot` 分区），内核与 initramfs 放进 ESP 的 FAT 分区——优点是引导路径最短、救援时不用纠结"内核在哪"；代价是 FAT 不支持符号链接与权限位，且部分工具对 `/boot` 是 FAT 有兼容性假设。若采用此布局，`grub-mkconfig -o` 与 `mkinitcpio` 的输出路径都要按 ESP 挂载点调整。

Arch 上安装 GRUB 本身也要经由 `pacman`（对应另两系的 `apt install grub` / `dnf install grub2`）：

```bash
# Arch：安装 GRUB 与 EFI 支持组件
sudo pacman -S grub efibootmgr

# Debian/Ubuntu（通常安装系统时已装好，重装时）
sudo apt install grub-efi-amd64

# RHEL/CentOS/Rocky
sudo dnf install grub2-efi-x64 grub2-tools
```

## 6. CSM 与混合模式陷阱

CSM（Compatibility Support Module）是 UEFI 固件里模拟 Legacy BIOS 的兼容层。它的存在制造了几种容易踩坑的组合：

1. **磁盘是 GPT，却以 Legacy 模式启动**——GRUB 的 `i386-pc` 版本能从 GPT 引导（需要 BIOS Boot 分区存放 `core.img`），但很多安装器会直接报错或引导失败。保持模式与分区表一致是最省心的规则。

2. **Secure Boot 开着却装了未签名的 bootloader**——固件在执行阶段静默拒绝，症状是"开机直接进固件设置/黑屏"，没有任何错误提示。进 BIOS 关掉 Secure Boot 或换 shim 引导链。

3. **CSM 开启时 `efibootmgr` 报错**——某些主板在 CSM 允许 Legacy 启动时会禁用 EFI 变量接口，导致 `efibootmgr` 不可用。排障前先确认 CSM 状态。

4. **Windows 与 Linux 混装时启动项被改写**——UEFI 下 Windows 用 `bcdedit` 管理自己的条目，不会主动删除 Linux 条目，但"启动修复"或主板固件更新可能重置 BootOrder。遇到 Linux 项消失，先 `efibootmgr -v` 看是"顺序问题"还是"条目丢失"，前者 `efibootmgr -o` 解决，后者才需要 chroot 重装 GRUB。

## 7. 常见坑

1. **装完系统重启直接进 BIOS/旧系统，找不到 Linux 启动项**。九成是安装时选错了启动介质模式（UEFI U盘 vs Legacy U盘），或安装器没把 `.efi` 写进 ESP。用 Live USB 挂载 ESP 检查 `EFI/` 目录下有没有对应发行版的子目录，没有就 chroot 后 `grub-install --target=x86_64-efi`。

2. **`efibootmgr` 报 `EFI variables are not supported`**。两种可能：当前是 Legacy 模式启动（`ls /sys/firmware/efi` 不存在），或内核未编译 `efivarfs`（罕见）。先用方法一确认模式。

3. **3 TB/4 TB 硘盘只识别出 2 TB**。磁盘还是 MBR。用 `gdisk`/`fdisk` 转成 GPT（注意：转换会重建分区表，必须先备份数据；已在用的旧系统转换后还要补装 BIOS Boot 分区或改用 UEFI 引导）。

4. **ESP 被格式化成 ext4**。UEFI 固件认不了，启动项指向的文件读不出来。救援时 `mkfs.fat -F32` 重格式化 ESP 并重新 `grub-install`（会连带重建 `\EFI\...` 目录结构）。

5. **双系统下 Windows 更新"吃掉"Linux 启动项**。见 2.3 节：先 `efibootmgr -v` 区分顺序问题与条目丢失，再分别处理。

6. **主板电池没电导致启动顺序每次重置**。症状是每次冷启动都回到默认顺序。换 CR2032 电池，或临时把 Linux 条目 `efibootmgr -o` 调到第一位作为过渡。

## 参考资料

- Arch Wiki - UEFI — [wiki.archlinux.org](https://wiki.archlinux.org/title/UEFI)
- Arch Wiki - EFI system partition — [wiki.archlinux.org](https://wiki.archlinux.org/title/EFI_system_partition)
- Arch Wiki - Unified Extensible Firmware Interface（含 `efibootmgr` 用法） — [wiki.archlinux.org](https://wiki.archlinux.org/title/Unified_Extensible_Firmware_Interface)
- Arch Wiki - Install guide 的分区章节 — [wiki.archlinux.org](https://wiki.archlinux.org/title/Installation_guide)
- RHEL 9 文档 - 在 UEFI 模式下安装引导装载程序 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/installing_rhel_9/index)
- 鸟哥的私房菜 - 开机流程分析（含 BIOS/UEFI 对比） — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0510osloader.php)
- UEFI Forum 规范 — [uefi.org](https://uefi.org/)
- `man efibootmgr`、`man fdisk`、`man gdisk`、`man lsblk`
