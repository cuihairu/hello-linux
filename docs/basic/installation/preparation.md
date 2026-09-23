# 安装前的准备

安装事故里真正"技术性"的部分很少，绝大多数损失发生在安装**之前**：没备份数据就格式化了整个盘、启动模式和分区表对不上导致装完开不了机、dd 写错了设备名把移动硬盘抹了。这一节的目标是把所有不可逆动作之前的检查清单走完——当你按下"开始安装"时，应当已经确认了硬件、启动模式、安装介质和数据备份四件事都就绪。

> 内容参考自 Arch Wiki Installation guide#Pre-installation、Debian 安装手册与鸟哥的私房菜，见文末参考资料。

## 学习目标

- 会用 `lscpu`、`free -h`、`lsblk` 快速评估硬件是否够用
- 能区分 UEFI 与 Legacy BIOS，并判断当前机器实际运行在哪种模式
- 掌握 Windows/macOS/Linux 三种环境下的启动盘制作方法，理解 `dd` 写错设备的严重性
- 建立"动盘之前先备份"的肌肉记忆

## 1. 硬件确认：为什么先看配置

Linux 本身对硬件要求不高——服务器上跑的最小化安装 512MB 内存都能启动。但**桌面环境**是内存大户：GNOME 3 在空载时就可能吃掉 1.5GB 以上。先量硬件，才能定"装桌面还是装服务器版本"这个前置决策。

在现有系统上（或 Live USB 进入试用模式后）执行：

```bash
lscpu | head -15
free -h
lsblk -o NAME,SIZE,TYPE,MOUNTPOINT
```

真实输出片段（`lsblk` 为例，能看出 ESP、swap、根分区的典型布局）：

```text
$ lsblk -o NAME,SIZE,TYPE,MOUNTPOINT
sda    476.9G disk
├─sda1   512M part /boot/efi
├─sda2    16G part [SWAP]
└─sda3 460.4G part /
```

参考标准：

| 配置 | 最低（服务器/最小安装） | 推荐（桌面日常使用） |
|------|------------------------|---------------------|
| CPU | 1 GHz 单核（64 位） | 2 GHz 双核+ |
| 内存 | 1 GB（无桌面） | 4 GB+（GNOME/KDE 建议 8 GB） |
| 磁盘 | 10 GB | 25 GB+（含桌面与常用软件） |
| 网络 | 可联网（安装时下载更新） | 有线更稳，装完再配 Wi-Fi |

一个常被忽略的点：**确认磁盘上是否已有数据、是否已存在 Windows 或其他 Linux**。`lsblk` 输出里如果看到已挂载的分区，说明这块盘正在被当前系统使用，安装时选择了"清除磁盘"会把这些分区全部抹掉。

## 2. 判断启动模式：UEFI 还是 Legacy

这是安装前**最关键的一步判断**，因为它决定了分区表类型（GPT 还是 MBR）和引导分区的有无。装错模式的后果不是"装不上"，而是"装上了重启进不去"——BIOS 固件读不懂 GPT 上没有的 MBR 引导代码，UEFI 固件也读不懂 Legacy 分区的引导扇区。

### 2.1 两种模式的本质差异

| 模式 | 分区表 | 引导位置 | 引导分区 | 典型固件设置名 |
|------|--------|---------|---------|---------------|
| UEFI | GPT | EFI 系统分区（ESP）中的 `.efi` 文件 | 需要，FAT32 格式，通常 512 MB 挂载于 `/boot/efi` | "UEFI"、"Windows Boot Manager" |
| Legacy BIOS | MBR | 磁盘开头的主引导记录（MBR）+ 分区引导记录 | 不需要独立分区 | "Legacy"、"CSM"、"BIOS" |

### 2.2 判断当前模式

在已有的 Linux 系统或 Live 环境里：

```bash
# 当前模式：有输出 = UEFI，报 No such file = Legacy
ls /sys/firmware/efi

# 磁盘分区表类型：Disklabel type: gpt 配 UEFI，dos 配 Legacy
sudo fdisk -l /dev/sda | head -3
```

Windows 下可以用 `msinfo32` 查看"BIOS 模式"是 UEFI 还是传统，也可以在磁盘管理里看磁盘是"GPT"还是"MBR"。**关键原则：新装系统应与磁盘现有分区表和固件模式保持一致**。一块已经是 GPT 的盘在 Legacy 模式下安装（或反之）是可行的但徒增混乱，Windows 11 还强制要求 UEFI + GPT + Secure Boot。

### 2.3 Secure Boot

UEFI 机器上通常还有一个 Secure Boot 开关。Ubuntu、Fedora、Rocky 的发行版引导器都签了 Microsoft 的密钥，安装时**可以不关** Secure Boot；但 Arch 官方 ISO 的引导器默认未签名，且自编译内核也需要自行注册密钥，初学阶段建议安装时先关闭 Secure Boot，装完再研究如何启用。

## 3. 备份数据：动盘之前的最后确认

如果要安装的磁盘上有任何不愿丢失的数据——文档、照片、SSH 密钥、浏览器书签、项目仓库——**先备份再继续**。"清除整个磁盘"和"我再想想"不能同时存在。

- 全盘备份：把整个 home 目录或整个分区 `tar`/`rsync` 到移动硬盘或网盘
- 仓库备份：确认所有 git 工作区都已 push 到远程
- 浏览器/邮件：导出书签、离线邮件
- 双系统场景：注意 Windows 的"快速启动"会锁定 NTFS 分区，进 Linux 前最好在 Windows 里正常关机一次，否则 Linux 挂载不了那块盘，容易误判为"盘坏了"

没有"事后恢复格式化"的命令。这一条怎么强调都不过分。

## 4. 制作启动盘

### 4.1 Windows：Rufus 或 balenaEtcher

[Rufus](https://rufus.ie/) 是 Windows 下最省心的选择，注意两个选项：

- **分区类型**：选 GPT（对应 UEFI）或 MBR（对应 Legacy），与上一步的判断一致
- **目标系统**：UEFI（非 CSM）或 BIOS
- 写入模式选 **ISO 镜像模式**（默认）；有些老机器兼容性差可改 DD 镜像模式

[balenaEtcher](https://www.balena.io/etcher/) 跨平台、界面简单，缺点是不能选分区表类型（默认按 ISO 结构写入，一般也能引导）。

### 4.2 Linux：dd

在 Linux 下用 `dd` 写入最直接，但**设备名一旦写错，毁掉的就是那块盘**。三步走：先 `lsblk` 确认 U 盘的设备名和容量，再写入，再 `sync` 落盘。

```bash
# 1. 插入 U 盘后确认设备名——看容量，别猜：
#    sda 476.9G 是系统盘别动，sdb 7.3G 才是 U 盘
lsblk

# 2. 卸载自动挂载的分区后写入。of= 后面是整盘设备（/dev/sdb）；
#    写成 /dev/sdb1 只会写进分区表，多数情况无法引导
sudo umount /dev/sdb1
sudo dd if=ubuntu-24.04-desktop-amd64.iso of=/dev/sdb bs=4M status=progress conv=fsync

# 3. 确保写入缓冲全部落盘
sync
```

`status=progress` 会实时显示写入进度和速度；`conv=fsync` 确保结束时强制刷盘。写入完成后重新 `lsblk`，能看到 U 盘分区变成了 ISO9660 文件系统即为成功。

### 4.3 macOS

macOS 自带的 `dd` 语法相同，但更推荐用 balenaEtcher——图形操作且会自动弹出识别。注意 macOS 可能把 U 盘挂载为 `/dev/diskN` 而非 `/dev/sdN`，用 `diskutil list` 确认后再 `diskutil unmountDisk /dev/diskN`、`dd of=/dev/rdiskN`（raw 设备更快）。

### 4.4 写入后验证

三个平台通用的验证思路：拔掉重插，确认分区能被挂载且内容是 ISO 结构；有条件的话在虚拟机里先用这个 ISO 引导一次，能省下真机试错的时间。

## 5. 网络与镜像源（可提前准备）

安装器大多会联网下载更新，有线网络最省心。国内环境下提前想好镜像源能让安装后的首更提速一个数量级：

- **Debian/Ubuntu**：安装器里可跳过网络镜像选择，装完再改 `/etc/apt/sources.list`（Ubuntu 24.04+ 是 `/etc/apt/sources.list.d/ubuntu.sources`）为 TUNA/USTC 镜像
- **Arch**：安装过程中 `pacstrap` 拉包之前就应该把 `/etc/pacman.d/mirrorlist` 配成国内源，否则同步数据库可能超时
- **RHEL/Rocky**：默认走官方源需要注册（Rocky 8 之后 `/etc/yum.repos.d/rocky.repo` 可直接用官方免费源，无需订阅管理器），也可换清华 TUNA 镜像

## 6. 常见坑

- **`dd` 写错设备**——最经典也最惨的坑。永远先 `lsblk` 对照容量，`of=` 写整盘设备（`/dev/sdb`）而不是分区（`/dev/sdb1`）。
- **启动模式与分区表不匹配**——UEFI 配 MBR 或 Legacy 配 GPT，安装器阶段可能没报错，重启才暴露。安装前用 `ls /sys/firmware/efi` 和 `fdisk -l` 双重确认。
- **没拔掉其他硬盘**——台式机插了多块盘时，安装器可能把引导装到错误的那块，或格式化了不该动的盘。装系统前拔掉无关硬盘是最稳妥的做法。
- **忘记关 BitLocker/BitLocker 锁定**——Windows 开了 BitLocker 的盘在 Linux 下无法正常读写，双系统场景先在 Windows 里暂停 BitLocker。
- **用手机 USB 热点当安装网络**——大多数安装器识别不了需要认证的热点，安装中断更麻烦；要么用有线，要么先用能开热点的路由器。
- **U 盘没真正写完就拔**——`dd` 没加 `sync`/`conv=fsync` 且没等待进度 100% 就拔出，会得到一个看似写入成功、实际缺尾部数据的坏盘。

## 参考资料

- Arch Wiki - Installation guide (Pre-installation) — [wiki.archlinux.org](https://wiki.archlinux.org/title/Installation_guide)
- Arch Wiki - USB flash installation media — [wiki.archlinux.org](https://wiki.archlinux.org/title/USB_flash_installation_media)
- Arch Wiki - UEFI, Secure Boot — [wiki.archlinux.org](https://wiki.archlinux.org/title/UEFI)
- Debian Installation Manual — [debian.org](https://www.debian.org/releases/stable/installmanual)
- Ubuntu installation tutorial — [ubuntu.com](https://ubuntu.com/tutorials/install-ubuntu-desktop)
- 鸟哥的私房菜 - 安装 Linux 前的准备 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0130installlinux/)
