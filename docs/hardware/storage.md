# 存储设备

存储是唯一可能造成**不可逆数据损失**的一层：CPU 调错了顶多慢，内存换错了顶多抖，盘坏了或分区写错了，丢的是数据本身。本章从 Linux 块层的视角讲清"一次写入到底经过了什么"，再覆盖 HDD/SSD/NVMe 的硬件差异、`lsblk`/`smartctl` 这两把体检工具、分区与挂载的栈式关系，最后给出性能测试的正确姿势。与[基础篇 · 文件系统](../basic/filesystem.md)的分工是：**本篇讲"盘"（块设备本身），那篇讲"盘上的数据组织"（mkfs、fstab、权限）**——两篇在分区与挂载处交叉引用，不重复教程。

> 内容参考自 Linux 内核文档、Arch Wiki 与厂商规范，见文末参考资料。

## 学习目标

- 理解 Linux 块层在 I/O 路径中的位置，能区分文件系统问题与块层/设备问题
- 分清 HDD、SATA SSD、NVMe SSD 的硬件与协议差异，选型时不再只看"是不是固态"
- 熟练使用 `lsblk` 盘点设备树，用 `smartctl`/`nvme` 判断盘的健康
- 说清"磁盘 → 分区 → 文件系统 → 挂载点"的栈式关系，知道每层各自归谁管
- 掌握 RAID 与 fio/dd 测试的正确用法，避开毁数据、测 page cache 的经典陷阱

## 1. Linux 块层：一次写入的旅程

### 1.1 I/O 栈的分层

进程调用 `write()` 并不等于数据到了盘上。一次写入自上而下经过：**应用 → VFS（虚拟文件系统）→ 具体文件系统（ext4/XFS/Btrfs）→ 块层（bio 提交与 I/O 调度）→ 设备驱动（nvme/ahci/sd）→ 物理设备**。每层都可能出问题，而它们的排障入口完全不同——文件系统层的故障在 `dmesg` 里常报 `EXT4-fs error`，块层问题表现为请求堆积（`vmstat` 的 `b` 列、`iostat` 的 `await`），设备层则看 SMART 与链路（`smartctl`、SATA 错误计数）。

| 层 | 职责 | 典型观察入口 |
|----|------|-------------|
| VFS | 统一文件访问接口 | `strace`、`/proc/<pid>/io` |
| 文件系统 | inode/目录/页缓存 | `dmesg`、`tune2fs`/`xfs_info`、[基础篇](../basic/filesystem.md) |
| 块层 | 请求合并、调度、限速 | `/sys/block/*/queue/`、`iostat -x` |
| 驱动 | 与具体控制器对话 | `lsblk`、`dmesg`、`lspci -k` |
| 设备 | 介质与固件 | `smartctl`、`nvme smart-log` |

块层的 I/O 调度器负责给请求排队合并，可通过 `cat /sys/block/sda/queue/scheduler` 查看当前选择（常见取值有 `mq-deadline`、`kyber`、`bfq`，NVMe 常用 `none` 直通）——**默认值随内核版本与设备类型变化，以你机器的读取结果为准**，没有普适的"最优调度器"；切换前先查内核文档，日常多数场景默认即可。设备在内核中的化身是 `/dev` 下的节点，编号信息在 `/proc/partitions`：

```bash
$ cat /proc/partitions
major minor  #blocks  name
   8        0  500107608 sda
 253        0   52428800 dm-0        ← device-mapper 设备（LVM/加密卷都挂这层）
```

**device-mapper** 是块层之上的虚拟化层：LVM 卷、LUKS 加密、RAID1 镜像都可以把多个物理盘"捏"成一个虚拟块设备（`/dev/dm-*`、`/dev/mapper/*`）。理解它才能看懂 `lsblk` 里 `sda3 → vg0-lvroot → /` 这种多层结构——LVM 的实操归[基础篇与系统管理篇](../system-management/README.md)，本篇只需认出层级关系。

## 2. 设备类型：HDD、SATA SSD 与 NVMe

### 2.1 HDD（机械硬盘）

HDD 靠磁头在旋转盘片上寻道，机械延迟决定了它"随机小 I/O 差、顺序大 I/O 尚可"的特性：

| 参数 | 说明 | 典型值 |
|------|------|--------|
| 转速 | 盘片旋转速度 | 5400/7200/10000/15000 RPM |
| 寻道时间 | 磁头移动到目标磁道 | 3-12 ms |
| 接口 | 连接总线 | SATA / SAS |
| 顺序吞吐 | 大块连续读写 | 约 100-280 MB/s（受转速与密度限制） |

台式机 7200 RPM 与监控盘 5400 RPM 的随机 I/O 能力差距明显；而**SMR（叠瓦式）盘**在持续写入时会因重写磁道显著掉速——采购监控/备份盘时若看到 SMR 字样且场景是持续写入，务必再三确认固件与机型评测。

### 2.2 SSD 的 NAND 类型

SSD 无机械部件，随机性能远超 HDD；寿命与速度由 NAND 每单元存储位数决定：

| 类型 | 每单元位数 | 寿命 | 速度 | 成本 | 备注 |
|------|-----------|------|------|------|------|
| SLC | 1 bit | 最长 | 最快 | 最贵 | 多见于企业级缓存区 |
| MLC | 2 bits | 较长 | 较快 | 较贵 | 消费级已少见 |
| TLC | 3 bits | 中等 | 中等 | 中等 | 当前消费级主流 |
| QLC | 4 bits | 较短 | 较慢 | 较低 | 大容量低价盘，写密集场景注意 DWPD |

消费级盘的实际寿命还取决于**掉速缓存（SLC cache）大小**与 **DWPD/ TBW 指标**——写满缓存后的直写速度可能只有标称的几分之一，这也是"新盘跑分漂亮、拷大文件却掉速"的硬件根源，用 `smartctl` 的 `Percentage Used`/`Data Units Written` 可以长期跟踪（第 4 节）。

### 2.3 NVMe：为闪存设计的接口

AHCI 是为机械硬盘时代的命令队列设计的；NVMe 走 PCIe 直连，为闪存并行性而生：

| 对比 | SATA SSD | NVMe SSD |
|------|----------|----------|
| 接口/总线 | SATA | PCIe |
| 协议 | AHCI | NVMe |
| 理论带宽 | 600 MB/s（SATA III） | PCIe 4.0 x4 约 8 GB/s（双向） |
| 队列 | 1 个队列，32 条命令 | 最多 64K 队列，每队列 64K 命令 |
| 设备名 | `/dev/sdX` | `/dev/nvmeXnY` |

对运维的直接含义：**设备名与工具链都变了**——`hdparm` 对 NVMe 无效（第 3.3 节的坑），SMART 要走 `nvme smart-log` 或 `smartctl` 的 NVMe 路径，`lsblk` 里 `TRAN` 列会标 `nvme` 而非 `sata`。多队列也意味着中断模型不同（每队列一个中断，见[网络设备章](./network.md)的多队列一节），NVMe 的 I/O 压力天然能摊到多核。

## 3. 盘点设备：lsblk 与配套工具

### 3.1 lsblk：一棵树看懂存储拓扑

```bash
$ lsblk
NAME        MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
sda           8:0    0 465.8G  0 disk
├─sda1        8:1    0     1G  0 part /boot/efi
├─sda2        8:2    0     2G  0 part /boot
└─sda3        8:3    0 462.8G  0 part
  ├─vg0-root 253:0   0    50G  0 lvm  /
  └─vg0-home 253:1   0  412G  0 lvm  /home
nvme0n1     259:0    0 931.5G  0 disk
└─nvme0n1p1 259:1    0   931G  0 part /srv/data

# 关键列一次看全：文件系统、挂载点、是否旋转、传输协议
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS,ROTA,TRAN,SERIAL
# ROTA=1 机械盘；ROTA=0 固态；TRAN=nvme/sata/usb
```

`lsblk` 读的是 udev/内核的块设备关系，天然覆盖 LVM、md RAID 的多层结构——**盘点"数据到底落在哪块物理盘"时它是第一入口**，比 `df` 高一截：`df` 只能告诉你挂载点用了哪个虚拟设备，`lsblk` 才能把虚拟设备一路展开到 `sda3`/`nvme0n1`。`-f` 选项补上文件系统与 UUID（`fs`、`uuid` 列），fstab 排错时与 `findmnt` 配合使用（fstab 教程见[基础篇 · 文件系统概念](../basic/filesystem/concept.md)）。

### 3.2 分区表与识别工具

```bash
sudo fdisk -l              # 列出所有盘的分区表（GPT/MBR 一并显示）
sudo parted -p /dev/sda print   # parted 对 GPT/大盘更直观
sudo hdparm -I /dev/sda | head -20   # SATA 识别信息（型号、序列号、特性）
sudo hdparm -Tt /dev/sda             # -T 缓存吞吐 / -t 设备吞吐

# NVMe 专用工具（三系包名一致：nvme-cli，安装见 README 速览表）
nvme list                      # 控制器与命名空间一览
nvme id-ctrl /dev/nvme0 | head -20   # 控制器能力（型号、固件、队列数）
```

MBR/GPT 两种分区表的原理、选型与 `fdisk`/`gdisk`/`parted` 的交互命令，归[基础篇 · 文件系统概念](../basic/filesystem/concept.md)与[BIOS 与 UEFI](../basic/boot/bios_uefi.md)；本篇只要求记住硬件约束：**MBR 上限 2 TB、4 个主分区，GPT 面向 UEFI 与大盘**——超过 2 TB 的盘必须 GPT，而 GPT 又要求 UEFI 引导，两件事在装机时必须一起定。

### 3.3 hdparm/dd 只认 SATA

`hdparm` 的 IDENTIFY 命令基于 ATA 规范，对 NVMe 设备会直接报错或给出无意义输出；`dd` 裸测又会受页缓存干扰（第 7 节）。正确组合：SATA 用 `hdparm -Tt`，NVMe 用 `nvme` 工具+`fio`，通用场景一律 `fio`。

## 4. SMART 健康监控

### 4.1 为什么要在"坏之前"看 SMART

SMART（Self-Monitoring, Analysis and Reporting Technology）是盘自己记录的体检报告：坏道重映射、通电时间、温度、剩余寿命。等到系统报 I/O error 时，数据可能已经丢了；**巡检的价值在于趋势**——`Reallocated_Sector_Ct` 从 0 爬到两位数、`Percentage Used` 快速逼近 100%，都是换盘的提前量。服务器把 `smartctl -q error` 类检查写进监控，是比 RAID 更早的一道防线。

### 4.2 smartctl 实战

```bash
# 三系安装（包名一致）：apt install smartmontools / pacman -S smartmontools / dnf install smartmontools
sudo smartctl -a /dev/sda          # 全量报告（SATA/NVMe 通吃，-d auto 识别）
sudo smartctl -H /dev/sda          # 只看健康结论（巡检常用）→ result: PASSED
sudo smartctl -t short /dev/sda    # 自检 1-2 分钟；long 数小时，业务低峰再跑
sudo smartctl -l selftest /dev/sda # 自检历史
sudo nvme smart-log /dev/nvme0     # NVMe 原生路径（与 smartctl 二选一）
#   percentage_used: 3%    ← 寿命消耗
#   media_errors: 0        ← 介质错误，非零要盯
```

判读纪律：**看趋势不看单点**（温度今天 45℃ 没问题，一周内从 35 涨到 55 才要查风道）；`PASSED` 只说明"当前自检没挂"，不保证寿命余量——换盘决策综合 `percentage_used`、重映射计数与上机年限；外置 USB 硬盘盒可能不透传 SMART（`smartctl` 报 `Unknown USB bridge`），需要 `-d sat` 或换支持 UASP 的盒体，这属于桥接芯片限制而非盘坏了。

## 5. 分区、文件系统与挂载的关系

### 5.1 栈式关系：五层各管各的

一块数据从裸盘到能被 `open()`，要依次经过五层，每层工具与责任人都不同——把这张栈印在脑子里，"挂载失败"立刻能定位到是哪一层：

```text
物理盘 /dev/sda（或 nvme0n1）          ← 硬件层：本篇，SMART/lsblk
  └─ 分区 /dev/sda1（GPT/MBR 表）       ← 分区层：fdisk/parted，表坏=全盘丢
       └─（可选）PV → VG → LV /dev/vg0/root  ← 块虚拟层：LVM/mdadm
            └─ 文件系统 ext4/XFS/Btrfs   ← 文件系统层：mkfs，详见基础篇
                 └─ 挂载点 /            ← 挂载层：mount/fstab，把设备接到目录树
```

记忆方法：**分区决定"盘怎么切"，文件系统决定"切出来的块怎么记账"，挂载决定"记账本挂在目录树的哪根枝上"**。三者独立可重建——分区表还在就能找回分区（`testdisk`），fs 元数据坏了还能挂到别的系统抢救，但每往下一层，修复难度指数上升。反过来说，`mount: wrong fs type` 九成是文件系统层问题，而不是盘坏了；`/dev/sda1 not found` 才要怀疑分区层。

### 5.2 与基础篇的分工

`mkfs.ext4`/`mkfs.xfs` 的参数选择、`mount` 选项语义、`/etc/fstab` 的字段与 UUID 写法、卸载时 `target is busy` 的处理，全部归[基础篇 · 文件系统](../basic/filesystem.md)（含[文件系统概念](../basic/filesystem/concept.md)的 ext4/XFS/Btrfs 特性对比与 fstab 实战），本篇不重复。此处仅保留与**硬件选型**直接相关的一行结论：

| 文件系统 | 硬件视角的适配点 | 详见 |
|---------|------------------|------|
| ext4 | 通用默认，HDD/SSD 均稳 | [基础篇 · 文件系统概念](../basic/filesystem/concept.md) |
| XFS | 大文件/并行 I/O 友好，RHEL 系默认 | 同上 |
| Btrfs | 快照/校验，**swapfile 创建有特殊要求**（见[内存章](./memory.md)第 7.2 节） | 同上 |
| ZFS | 企业级特性，吃内存与 CPU，硬件要求明确 | 官方文档 |

格式化与挂载的最小闭环（细节以基础篇为准）：`sudo mkfs.ext4 /dev/sdb1 && echo '/dev/sdb1 /data ext4 defaults 0 2' | sudo tee -a /etc/fstab && sudo mount -a`——每加一行 fstab 就 `mount -a` 验证一次，是防开不了机的铁律。

## 6. RAID

### 6.1 级别速查

| 级别 | 最少盘数 | 冗余 | 可用容量 | 读 | 写 | 适用场景 |
|------|---------|------|---------|----|----|---------|
| RAID 0 | 2 | 无 | N×盘 | 高 | 高 | 临时/可重建数据 |
| RAID 1 | 2 | 镜像 | 1×盘 | 高 | 中 | 系统盘 |
| RAID 5 | 3 | 单校验 | (N-1)×盘 | 高 | 中 | 通用存储（大容量下重建风险高） |
| RAID 6 | 4 | 双校验 | (N-2)×盘 | 高 | 中 | 大容量冷数据 |
| RAID 10 | 4 | 镜像+条带 | N/2×盘 | 很高 | 高 | 数据库 |

RAID **不等于备份**：镜像坏两块、重建期间再坏一块（大容量 HDD 的重建窗口长达十几小时），数据照样没。RAID 5/6 在 10 TB+ 盘上的重建风险是老生常谈——重要数据永远要"RAID + 异地备份"双保险。

### 6.2 软件 RAID（mdadm）

```bash
# 三系安装（包名一致）
sudo apt install mdadm     # Debian/Ubuntu
sudo pacman -S mdadm       # Arch
sudo dnf install mdadm     # RHEL/CentOS/Rocky

# 创建 RAID 1（示例：两块盘镜像；生产建议先 dry-run 确认目标盘）
sudo mdadm --create /dev/md0 --level=1 --raid-devices=2 /dev/sdb /dev/sdc
cat /proc/mdstat            # 状态与重建进度（[UU] 与 resync 百分比）
sudo mdadm --detail /dev/md0

# 持久化（路径因发行版而异，以你的版本核实）
sudo mdadm --detail --scan | sudo tee -a /etc/mdadm/mdadm.conf   # Debian/Ubuntu 常见
```

硬件 RAID 卡则有自己的 BIOS/CLI（MegaCLI、StorCLI、ssacli 等），逻辑盘会以单个虚拟块设备出现，`lsblk` 看不到内部结构——遇到 `PERC`/`Smart Storage` 之类的设备名，先找对应 CLI 再谈 Linux 层操作。

## 7. 性能测试：dd 与 fio 的正确姿势

### 7.1 dd：只适合粗测顺序吞吐，且必须绕开页缓存

```bash
# 写测试（oflag=direct 绕过页缓存，conv=fsync 落盘）
sudo dd if=/dev/zero of=./testfile bs=1M count=1024 oflag=direct conv=fsync status=progress
# 读测试（1M 块保证对齐）
sudo dd if=./testfile of=/dev/null bs=1M iflag=direct status=progress
```

没有 `oflag=direct` 的 `dd` 测的是**内存到内存**——页缓存几 GB/s 的假成绩会让你以为买了高速盘（见[体系结构章](./architecture.md)的存储层次）。`dd` 也不报 IOPS、不控队列深度，**正式评估一律用 fio**；测试完记得 `rm ./testfile`，别把 1 GB 垃圾留在生产分区上。

### 7.2 fio：可复现的基准

```bash
# 三系安装（包名一致）
sudo apt install fio       # Debian/Ubuntu
sudo pacman -S fio         # Arch
sudo dnf install fio       # RHEL/CentOS/Rocky

# 4K 随机读 IOPS（数据库核心指标）；1M 顺序写把 rw/bs 换掉即可复用
fio --name=rand_read --filename=/data/testfile --size=1G \
    --rw=randread --bs=4k --numjobs=4 --runtime=60 --time_based \
    --ioengine=libaio --direct=1
```

`--direct=1` 是 fio 版的"绕过页缓存"；`--filename` 指向**待测的真实文件系统**（测哪块盘就在哪个挂载点下建文件），否则测的还是根分区。压测会真实消耗盘寿命与带宽，生产环境先确认窗口期；跑完对比厂商标称（4K 随机读 IOPS、顺序写 MB/s）即可定位"盘不行"还是"上层栈不行"。

## 8. 三系差异与工具对照

| 方面 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 默认文件系统 | ext4 | ext4（安装器可选 Btrfs/XFS） | XFS（RHEL 8 起；7 及以前 ext4） |
| 分区工具 | fdisk/gdisk/parted | 同左 | 同左 |
| LVM 包 | `lvm2` | `pacman -S lvm2` | `lvm2` |
| RAID 包 | `mdadm` | `pacman -S mdadm` | `mdadm` |
| NVMe 工具 | `nvme-cli` | `pacman -S nvme-cli` | `nvme-cli` |
| SMART 工具 | `smartmontools` | `pacman -S smartmontools` | `smartmontools`（无则启用 EPEL） |
| 基准测试 | `fio` | `pacman -S fio` | `fio` |

三系的块层、`lsblk`、`smartctl` 用法完全一致，差异集中在**默认文件系统**与**扩展仓库**上——RHEL 若 `dnf install smartmontools` 报无匹配，先启用 EPEL（`dnf install epel-release`）再试，这是三系对照里少数需要动仓库的地方。完整工具安装清单见[硬件篇速览表](./README.md)。

## 9. 常见坑

1. **`hdparm` 拿去测 NVMe。** ATA 命令对 NVMe 无意义，结果是报错或误导（第 3.3 节）；SATA 用 `hdparm -Tt`，NVMe 用 `nvme`/`fio`。
2. **不加 `direct` 的性能测试，测的是内存。** `dd`/`fio` 忘了绕过页缓存，得到几 GB/s 的假象（第 7 节）——所有结论必须来自 `oflag=direct`/`--direct=1` 的输出。
3. **在生产分区随手 `dd of=testfile` 测速，把根分区写满。** 测试文件要规划容量、用完删除；`conv=fsync`+`status=progress` 是好习惯（第 7.1 节）。
4. **`lsblk` 的 `ROTA=0` 就断言是内置 SSD。** USB 闪存、部分存储卡也报 `ROTA=0`，还要看 `TRAN`（usb/nvme/sata）与 `SUSPENDED` 等列，综合判断介质类型（第 3.1 节）。
5. **fstab/脚本里写 `/dev/sda3` 这类不稳定名。** 插盘顺序变化后设备名漂移（sda↔sdb），开机挂错或挂不上——**永远用 UUID/LABEL**（`lsblk -f` 查看），基础篇 fstab 一节有完整写法。
6. **`smartctl -H` 显示 PASSED 就以为盘很健康。** 自检通过≠寿命充足，`Percentage Used`、重映射计数、温度趋势要一起看；USB 桥接盘还可能根本不支持 SMART（第 4.2 节）。
7. **虚拟机/云盘上跑 SMART 找不到数据。** 虚拟磁盘没有真实介质统计，`smartctl` 常报不支持——那不是坏了，是本来就没有盘（hypervisor 那层的健康由云厂商负责）。你的 SMART 巡检应跑在**物理机**上，或改用云厂商的磁盘指标 API。
8. **RAID 用完不写配置文件。** Debian/Ubuntu 的 mdadm 配置路径与 Arch/RHEL 不同，数组配置丢了重启后不自动组装（第 6.2 节）；`mdadm --scan` 输出务必落到对应发行版的配置文件。

## 参考资料

- Arch Wiki - Partitioning — [wiki.archlinux.org](https://wiki.archlinux.org/title/Partitioning)
- Arch Wiki - File systems — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_systems)
- Arch Wiki - LVM — [wiki.archlinux.org](https://wiki.archlinux.org/title/LVM)
- Arch Wiki - RAID — [wiki.archlinux.org](https://wiki.archlinux.org/title/RAID)
- Arch Wiki - S.M.A.R.T. — [wiki.archlinux.org](https://wiki.archlinux.org/title/S.M.A.R.T.)
- Arch Wiki - fio（性能测试注意事项） — [wiki.archlinux.org](https://wiki.archlinux.org/title/Fio)
- Linux Kernel Documentation - Block layer — [kernel.org](https://www.kernel.org/doc/html/latest/block/index.html)
- NVM Express Specification — [nvmexpress.org](https://nvmexpress.org/specifications/)
- smartmontools Documentation — [smartmontools.org](https://www.smartmontools.org/)
- 鸟哥的私房菜 - 磁盘与文件系统管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0210disk.php)
- Red Hat - RHEL 9 存储管理 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html-single/managing_storage_devices/index)
