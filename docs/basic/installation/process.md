# 安装过程

安装本质上是一连串**不可逆决策**的执行：用哪块盘、分几个区、引导装到哪、装什么桌面。每一步安装器都会弹出选项，但很少告诉你"选错了会发生什么"。本节按真实装机顺序展开——从按电源键选引导介质开始，到装完系统第一次成功重启为止——重点讲清每个决策的后果，并分别覆盖 Debian/Ubuntu 图形安装器、RHEL/Rocky 的 Anaconda，以及 Arch 的 archinstall 与手动安装（pacstrap）思路。

> 内容参考自 Arch Wiki Installation guide、Debian 安装手册与 Ubuntu 官方教程，见文末参考资料。

## 学习目标

- 理解 UEFI 与 Legacy 两条引导路径的差异及其对分区方案的约束
- 能解释每个分区（ESP、/boot、swap、/home、btrfs 子卷）为什么存在
- 走通 Ubuntu/Debian/Rocky 图形安装流程与 Arch 的 archinstall、手动安装思路
- 掌握装完必做的三件事：装 bootloader、配网络、做首次全量更新

## 1. 引导安装程序

插上启动盘开机，按启动热键（常见为 `F12`、`F2`、`Del`，台式机多为 `F12` 调出一次性启动菜单）选择从 USB 启动。这一步的判断依据来自准备篇：**当前固件是 UEFI 还是 Legacy**，决定你该选带 "UEFI" 字样的启动项还是普通条目。选错通常也能进安装器，但后续分区和引导安装会埋雷——安装器有时会静默按错误模式分区，重启才发现进不去系统。

多数发行版的 ISO 会提供 "Try / Install" 两种入口。**先进 Try（试用）模式确认网络、显卡、硬盘都能正常识别，再点 Install**，可以把"装到一半才发现驱动有问题"的浪费降到最低。试用模式下顺手跑一遍准备篇的 `lsblk` 和 `ls /sys/firmware/efi`，把结论记下来。

## 2. UEFI vs Legacy：为什么这个判断贯穿全程

两种引导模式的差异不止在"怎么开机"，而是决定了整块盘的布局方式：

| 环节 | UEFI | Legacy BIOS |
|------|------|-------------|
| 分区表 | GPT | MBR（最多 4 主分区，或 3 主 + 1 扩展） |
| 引导文件 | ESP 分区（FAT32）中的 `/EFI/<厂商>/grubx64.efi` 等 | MBR 开头 446 字节引导代码 + 活动分区的引导扇区 |
| 是否需要独立引导分区 | 是（通常 512 MB，挂 `/boot/efi`） | 否（引导代码直接写进 MBR） |
| 大盘支持 | 可用 >2TB 的盘 | MBR 上限 2TB |
| Secure Boot | 支持（需签名引导器） | 不支持 |
| 双系统共存 | 与 Windows 10/11 天然一致 | 新机器上越来越少见 |

**决策后果**：如果你在准备阶段确认了 `ls /sys/firmware/efi` 有输出（UEFI），那么分区第一步必须建一个 FAT32 的 ESP，且安装器要把引导文件写进这个 ESP；反之 Legacy 模式下不需要 ESP，bootloader 会写进 MBR。混用的典型症状是"装完重启显示 no bootable device"或直接掉回固件设置界面。

现代机器（近十年的笔记本、品牌台式机、所有预装 Windows 10/11 的设备）基本都是 UEFI + GPT，本节默认按 UEFI 讲解，Legacy 只在差异处标注。

## 3. 分区方案：每个分区为什么这样分

分区不是仪式，而是三件事的物理隔离：**引导、系统、数据**。隔离的收益很具体——重装系统时只格式化根分区就能保住 `/home` 里的数据；`/boot` 单独分区能让不同文件系统的加密/非加密布局下引导器都有地方安身；swap 独立则方便日后调整大小。

### 3.1 UEFI 最小可用方案

| 分区 | 大小 | 文件系统 | 挂载点 | 为什么需要 |
|------|------|---------|--------|-----------|
| ESP | 512 MB | FAT32 | `/boot/efi` | UEFI 固件唯一认得的分区，放 bootloader 和内核的 EFI 存根；512MB 足够放多发行版的引导文件 |
| root | 20 GB+ | ext4 / XFS / Btrfs | `/` | 系统本体；桌面建议 50 GB 起 |
| swap | = 内存 或 2~8 GB | swap | 无挂载点 | 内存不足时的溢出区；也用于休眠（休眠需要 swap ≥ 内存） |
| home | 剩余全部 | 同 root 或任意 | `/home` | 用户数据独立，重装系统时可选择不格式化 |

新手"清除整个磁盘"时，现代安装器（Ubuntu、Debian、Anaconda）会自动按上述结构切好，你只需确认 swap 大小。**把 /home 单独分区的价值在第一次重装时才会显现**：根分区格式化重来，文档、配置、SSH 密钥原封不动。

### 3.2 为什么有人分出独立 /boot

`/boot` 放内核和 initramfs。当根分区是加密卷或 Btrfs/XFS 等引导器不能直接读的文件系统时，需要一个引导器"够得着"的独立小分区（ext4 或 XFS，1 GB 左右）承载内核。非加密 + ext4 根分区的场景下，内核直接放根分区的 `/boot` 目录即可，**不必**强行拆分——多分区不等于更专业，只等于更多需要维护的挂载点。

### 3.3 Btrfs 子卷布局（可选）

选 Btrfs 的用户通常不是为了快照炫技，而是为了**升级前快照 + 回滚**这条保险绳。Arch 和 Ubuntu 的安装器都提供 Btrfs 选项，常见布局：

| 子卷 | 挂载点 | 为什么独立 |
|------|--------|-----------|
| `@` | `/` | 根系统本体，快照/回滚对象 |
| `@home` | `/home` | 用户数据独立于系统快照 |
| `@var_log`（可选） | `/var/log` | 日志不随系统回滚而丢失 |
| `@tmp`、`@snapshots` | `/tmp`、`.snapshots` | 临时文件和快照存放区 |

注意 Btrfs 的 `/boot` 一般仍用 ext4 独立分区——GRUB 对 Btrfs 的支持可用但路径更绕，稳妥起见把引导文件放在简单文件系统上。

### 3.4 手工分区实操（通用）

无论用哪家安装器的"手工分区"页，底层都是同一套工具。以 Arch 为例（图形安装器里也内嵌了同样的 `cfdisk`/`fdisk` 逻辑）：

```bash
# 用 cfdisk 划分区（GPT），交互界面里依次：新建 → 512M → 类型改 EFI System；
# 新建 → 剩余大部分 → Linux filesystem；（可选）新建 → 8G → 类型改 Linux swap；Write → Quit
sudo cfdisk /dev/nvme0n1

# 格式化并按顺序挂载（先根，再把其他挂载点挂进去；/home 分区同理）
sudo mkfs.fat -F32 /dev/nvme0n1p1 && sudo mkfs.ext4 /dev/nvme0n1p2
sudo mkswap /dev/nvme0n1p3 && sudo swapon /dev/nvme0n1p3
sudo mount /dev/nvme0n1p2 /mnt
sudo mkdir -p /mnt/boot/efi && sudo mount /dev/nvme0n1p1 /mnt/boot/efi

# 生成 fstab——挂载表落盘，漏了这步重启后"盘全丢"
sudo genfstab -U /mnt >> /mnt/etc/fstab
# UUID=xxxx-xxxx  /boot/efi vfat  umask=0077 0 2
# UUID=abcd-...   /         ext4  defaults   0 1
```

`genfstab -U` 用 UUID 而非 `/dev/sda1` 这种名字——设备名在插拔或加盘后可能漂移（sdb 变 sdc），UUID 终身不变，这是防止"重启进 emergency shell"的第一道保险。

## 4. 三家发行版的安装路径

### 4.1 Ubuntu Desktop（图形向导）

流程线性，重点在三处选择：

1. **安装类型**：清除整个磁盘 / 与 Windows 共存 / 手工分区。双系统选"共存"前先确认准备篇里的备份和启动模式判断已完成。
2. **时区与键盘**：选 Shanghai，键盘默认 English (US) 即可——中文键盘布局在 Linux 下反而会干扰终端输入。
3. **用户与计算机名**：hostname 建议简短且只含小写字母数字（后续网络、证书、脚本都依赖它），首用户会自动进 `sudo` 组。

安装器会在后台 `apt` 拉取语言包和更新，进度条走完点重启即可。Ubuntu 的 GRUB 会自动探测 Windows 并生成双系统菜单。

### 4.2 Debian/Rocky（服务器场景）

- **Debian 网络安装器**：文本界面向导，可在分区步骤选 LVM、加密或软 RAID；语言选中文后建议**暂不启用 mirror**（国内网络下多数默认镜像慢），装完再换 TUNA。
- **Rocky/Anaconda**：图形界面左侧 Installation Summary 是一张"待办清单"，需手动点进每项配置（日期语言、磁盘分区、网络、软件选择、root 密码）。服务器最小化安装默认**不装图形界面**，这是刻意的——服务器的攻击面和资源占用都应最小化。网络界面里记得打开网卡开关（默认是关的），否则装完没网。

### 4.3 Arch：archinstall 与手动安装

Arch 官方 ISO 提供两条路，对应两种学习目标。

**路线 A：archinstall（引导式，适合快速用上）**

```bash
archinstall
# 交互菜单重点四项：Profile（desktop/gnome 等预设）、Filesystem
# （ext4/btrfs 含子卷与压缩/xfs/zfs）、Mirror（先选 China 区避免 pacstrap 超时）、
# Bootloader（systemd-boot 或 grub）
```

archinstall 本质是把下面路线 B 的步骤打包成对话框，**理解了路线 B 才知道它每一步在替你做什么**——这也是它作为学习工具的价值：每按一次回车，心里都能对上一条手动命令。

**路线 B：手动安装（推荐至少跟做一次）**

完整链条是：联网 → 分区挂载 → `pacstrap` 安装基础系统 → `arch-chroot` 进入新系统 → 配置时区/locale/网络 → 装 bootloader → 重启。核心命令：

```bash
# 1. 联网（Live 环境用 iwctl，装完系统才有 nmcli）
iwctl   # device list → station wlan0 scan → get-networks → connect YourSSID → exit
ping -c 3 mirrors.tuna.tsinghua.edu.cn

# 2.（承接上文：分区、挂载、genfstab 之后）

# 3. 安装基础系统——pacstrap 是 Arch 版的"往挂载点里灌一套系统"；
#    base linux linux-firmware 是最小集合，networkmanager 和 sudo 别漏
sudo pacstrap -K /mnt base linux linux-firmware networkmanager sudo

# 4. 进入新系统（等价于 chroot + 挂载必要虚拟文件系统）
sudo arch-chroot /mnt

# 5. chroot 内：时区、locale、主机名
ln -sf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && hwclock --systohc
echo "en_US.UTF-8 UTF-8" >> /etc/locale.gen && locale-gen
echo "archlinux" > /etc/hostname

# 6. 装 bootloader（grub 方案）
pacman -S grub efibootmgr
grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=GRUB
grub-mkconfig -o /boot/grub/grub.cfg

# 7. 设 root 密码、开 sudo、建普通用户（wheel 组是 Arch 惯例）
passwd
echo "%wheel ALL=(ALL:ALL) ALL" >> /etc/sudoers
useradd -m -G wheel yourname && passwd yourname

# 8. 退出 chroot，卸载并重启
exit && sudo umount -R /mnt && sudo reboot
```

手动安装的收获是**每个目录里多了什么、为什么多了**都心中有数：`pacstrap` 只是把仓库包解开到 `/mnt`，`arch-chroot` 让后续命令的作用域切换到新系统，`genfstab` 负责把挂载关系写成开机脚本。三步环环相扣，缺任何一步系统都"存在但开不了机"。

## 5. 安装后必做三件事

无论哪家发行版，重启进系统后都有三件事是"不做就会出问题"的：

### 5.1 装/确认 bootloader

多数图形安装器已自动完成，但手动安装或选错"引导器安装位置"时需要补救：

```bash
# Debian/Ubuntu：重装 GRUB 后重建菜单（会输出 Found Windows Boot Manager）
sudo grub-install /dev/sda && sudo update-grub
# RHEL/CentOS/Rocky：重建配置，UEFI 机器顺带 efibootmgr -v 确认引导项
sudo grub2-mkconfig -o /boot/grub2/grub.cfg
# Arch（grub 方案）；systemd-boot 则改用 bootctl install
sudo grub-install --target=x86_64-efi --efi-directory=/boot/efi --bootloader-id=GRUB
sudo grub-mkconfig -o /boot/grub/grub.cfg
```

验证方式：`efibootmgr -v` 里能看到自家条目，或重启时按 F12 能从启动菜单选到新系统。

### 5.2 配网络

安装阶段联网不等于开机联网，确认托管方式：

Debian/Ubuntu 桌面与服务器分别由 NetworkManager 和 Netplan 托管：前者用 `nmcli device status` / `nmcli device connect wlan0`，后者改完 `/etc/netplan/*.yaml` 后执行 `sudo netplan apply` 再 `ip a` 确认拿到了地址。Rocky/RHEL 需确认网卡配置里 `ONBOOT=yes`（RHEL 8 及以前在 `/etc/sysconfig/network-scripts/ifcfg-eth0`），RHEL 9 起则统一交给 NetworkManager，用 `nmcli connection show` 查看。Arch 安装时若选了 NetworkManager 这个包，还需要 `systemctl enable --now` 把服务拉起来，否则重启后网卡无人管理。三家最后都用同一个验收标准：`ip a` 有地址、`ping -c 3 223.5.5.5` 通——这三条命令不必刻意背，记住"托管方是谁"和"验收标准是什么"即可。

```bash
sudo netplan apply                            # Debian/Ubuntu（Netplan）
nmcli device connect wlan0                    # NetworkManager 方案
sudo systemctl enable --now NetworkManager    # Arch（安装时选了该包）
ping -c 3 223.5.5.5                           # 统一验收
```

### 5.3 首次全量更新 + 换国内镜像

新装系统的第一轮更新能修掉安装介质发布后的内核与安全补丁，**这一步没有例外，三家都要做**，但命令背后的"坑"各不相同：

```bash
# Debian/Ubuntu —— Ubuntu 24.04+ 为 deb822 格式；旧版改 /etc/apt/sources.list
sudo sed -i 's|http://archive.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g' \
  /etc/apt/sources.list.d/ubuntu.sources
sudo apt update && sudo apt upgrade -y

# RHEL/CentOS/Rocky
sudo dnf update -y

# Arch —— 必须完整的 -Syu；内核升级后确认 /boot 下出现新的
# vmlinuz-linux 与 initramfs-linux.img
sudo pacman -Syu
```

Arch 这里的 `pacman -Syu` 与 Debian 的 `apt update && apt upgrade` 语义等价（同步数据库 + 全量升级），但 Arch 对"只 `-S` 不 `-Syu`"的容忍度是**零**——部分升级导致的符号链接断裂和库版本不匹配不在官方支持范围，装完系统后的第一次操作就该是它。换镜像源（`/etc/pacman.d/mirrorlist` 放清华源到顶部）应在 pacstrap 之前做，若装的时候没来得及，现在改完再 `pacman -Syyu` 强制刷新。

补齐常用工具与中文字体的命令按家族各一行：Debian/Ubuntu 用 `sudo apt install -y vim git curl wget htop fonts-wqy-zenhei`，Arch 用 `sudo pacman -S --needed vim git curl wget htop ttf-wqy-zenhei`，RHEL/Rocky 用 `sudo dnf install -y vim git curl wget htop`。中文字体包别省——桌面环境缺字体时浏览器满屏豆腐块。

## 6. 双系统注意事项

装完 Linux 后 GRUB 菜单是唯一入口，掌握两个高频操作：

```bash
# Debian/Ubuntu 重新生成菜单（装了 Windows 或新内核后）：
sudo update-grub
# RHEL/CentOS/Rocky：
sudo grub2-mkconfig -o /boot/grub2/grub.cfg
```

若重启直接进了 Windows 而没看到 GRUB——多半是 Windows 更新改写了 EFI 引导顺序，进固件设置把 "ubuntu"/"GRUB"/"rocky" 条目调到 Windows Boot Manager 之前即可，不必重装。另一个方向的坑：安装 Linux 前 Windows 没有"正常关机"（快速启动休眠锁盘），会导致 Linux 安装器读不了 NTFS，双系统场景先彻底关机一次。

## 7. 常见坑

- **分区表类型与固件模式不匹配**——UEFI 机器装了 Legacy 引导（或反之），装完找不到启动项。安装前 `ls /sys/firmware/efi` 是金标准。
- **fstab 没生成或用了设备名**——手动安装最常漏的一步；没有 fstab，重启后根分区不挂载直接掉 rescue。
- **bootloader 装到了错误的盘**——多硬盘机器上 `grub-install /dev/sda` 写错目标。先 `lsblk` 确认哪块是启动盘，UEFI 下看 `efibootmgr` 的 `BootOrder`。
- **Arch 装完没建普通用户、也没给 wheel 开 sudo**——只剩 root 可登录，SSH 出于安全又默认禁 root 密码登录，等于把自己锁在门外。
- **更新不彻底**——Arch 上表现为 `pacman -Sy` 后直接装包；Ubuntu 上表现为 `apt install` 后内核一直不升。首更永远是"同步 + 全量升级"。
- **安装器里没开网卡**——Anaconda/部分文本安装器网卡默认 off，装完才发现没网，还得回去开。
- **休眠没配 swap 就指望休眠**——swap 分区小于内存时 `hibernate` 无法工作，要么加大 swap，要么放弃休眠只用挂起。

## 参考资料

- Arch Wiki - Installation guide — [wiki.archlinux.org](https://wiki.archlinux.org/title/Installation_guide)
- Arch Wiki - archinstall — [wiki.archlinux.org](https://wiki.archlinux.org/title/Archinstall)
- Arch Wiki - General recommendations (System maintenance) — [wiki.archlinux.org](https://wiki.archlinux.org/title/General_recommendations)
- Ubuntu installation tutorial — [ubuntu.com](https://ubuntu.com/tutorials/install-ubuntu-desktop)
- Debian Installation Manual - Partitioning — [debian.org](https://www.debian.org/releases/stable/installmanual)
- Rocky Linux Installation Guide — [docs.rockylinux.org](https://docs.rockylinux.org/guides/installation/)
- 鸟哥的私房菜 - 安装多重引导 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0130installlinux/)
