# 安装 Linux

安装是进入 Linux 世界的第一道门槛，也是最容易"一失足成千古恨"的一步：选错发行版会让后续两年都在与不适合自己的工具搏斗，分错区可能丢数据，引导装错则开机就进不去系统。本章不追求背下安装器的每一个按钮，而是帮你建立一套可迁移的决策框架——理解每个步骤**为什么**这么做之后，面对 Ubuntu 的图形安装器、Arch 的 archinstall 脚本或是 Rocky 的 Anaconda，你都能看懂它们在问什么。

> 内容参考自 Arch Wiki Installation guide、Debian 安装手册与鸟哥的私房菜，见文末参考资料。

## 学习目标

- 理解三大发行版家族的定位差异，能按用途而非流行度选择发行版
- 掌握安装前的硬件确认、启动模式判断和数据备份方法
- 吃透分区方案的取舍逻辑（EFI、swap、/home、btrfs 子卷），能解释每一块分区存在的理由
- 走完 UEFI/Legacy 两条引导路径，理解 bootloader、网络、首更这三件"装完必做"的事
- 知道 Arch 的 archinstall 与手动安装（pacstrap）分别适合什么人

## 子页导读

| 章节 | 一句话导读 | 适合带着什么问题去读 |
|------|-----------|---------------------|
| [选择合适的发行版](./installation/choose_distribution.md) | 按角色、更新策略和包管理生态做决策，附三系对比与镜像下载校验 | "我到底该装 Ubuntu、Arch 还是 Rocky？" |
| [安装前的准备](./installation/preparation.md) | 查硬件、判 UEFI/Legacy、做启动盘、备份数据，把不可逆操作的前置条件全部确认 | "为什么安装器看不到我的硬盘 / 装完开不了机？" |
| [安装过程](./installation/process.md) | 从引导到分区、装 bootloader、配网络、首更的完整流程，覆盖图形安装器与 Arch 手动思路 | "每一步在做什么？分区为什么这样分？" |

阅读顺序建议按上表依次进行。若你已经选定发行版，也可以直接跳到第三篇对照操作，但**第二篇的启动模式判断和备份清单不要跳过**——绝大多数"装机事故"都源于这里。

## 安装前检查清单

无论用哪个发行版的安装器，进安装界面前先在 Live 环境（或现有系统）里跑完这份清单。三件事没确认就点"下一步"，是最常见的翻车原因：**启动模式不匹配、磁盘认不出、数据没备份**。

```bash
# 1. 确认启动模式：有输出 = UEFI，无输出 = Legacy/CSM
ls /sys/firmware/efi && echo "UEFI 模式" || echo "Legacy 模式"

# 2. 确认磁盘与分区表：安装器里看不到硬盘多半在这里露馅
lsblk -f
sudo fdisk -l          # 或 parted -l
# 注意磁盘是 GPT 还是 MBR，与启动模式是否匹配

# 3. 确认网络（联网安装器需要）
ip addr                # 或 ip link
ping -c 3 8.8.8.8      # 基础连通性
ping -c 3 archlinux.org  # 能否解析域名（DNS）

# 4. 确认内存与架构（archinstall/部分安装器对内存有要求）
free -h
uname -m               # x86_64 还是 aarch64，决定下哪个镜像

# 5. 确认要装的磁盘上没有需要保留的数据
sudo wipefs -l /dev/sda  # 只读查看签名，不会改动
```

决策要点先记三条：**UEFI 机器用 GPT + EFI 系统分区（ESP，建议 ≥ 512 MB，fat32）**；**Legacy 机器用 MBR + BIOS boot 分区（BIOS+GPT 时才需要）**；**双系统务必先确认现有分区表类型和 Windows 占用的磁盘**，别在安装器里手滑选"清除整个磁盘"。备份原则更简单：`/home` 和桌面上的文件在重装前必须已复制到外部介质——安装器的"保留数据"选项不等于零风险。

## 三系安装方式速览

三大发行版家族的安装体验差异，本质是"谁替你做决定"的差异：

| 维度 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装器 | Subiquity（Ubuntu Server/桌面新版）、Debian 网络安装器的图形/文本模式 | archinstall 引导脚本，或纯手动（分区→pacstrap→chroot） | Anaconda（图形或 Kickstart 自动化） |
| 分区粒度 | 图形向导可一键"清除磁盘"，也支持手工分区 | 几乎全手工，必须自己建分区、格式化、挂载 | 支持自定义分区，服务器场景常用 LVM/软 RAID |
| 引导默认 | GRUB 2，自动探测 Windows | 需自行安装 GRUB 或 systemd-boot，无自动探测 | GRUB 2（`grub2-mkconfig`） |
| 首次更新 | `sudo apt update && sudo apt upgrade` | `sudo pacman -Syu`（必须完整升级，禁止部分升级） | `sudo dnf update` |
| 桌面环境 | 默认 GNOME，安装器可选 | 装完是纯命令行，桌面逐个 `pacman -S gnome` 装出来 | 最小化安装为主，桌面需额外组安装 |
| 学习曲线 | 平缓，出错时网络资料最多 | 陡峭，但走一遍就理解 Linux 从分区到引导的全部环节 | 中等，重在 SELinux、LVM 等企业特性 |

三者最终得到的都是"内核 + GNU 工具 + 包管理器"的同一类系统，日常命令几乎通用；差别集中在**软件打包格式**（deb / pacman 包 / rpm）、**升级节奏**（LTS 固定发布 / 滚动更新 / 企业级慢节奏）和**社区支持取向**。理解这三点，比记住安装器的菜单顺序更有价值。

装完后的第一次进入，三系也有各自的"必做三件事"，顺序基本一致，命令略有差别：

| 步骤 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 1. 首次全量更新 | `sudo apt update && sudo apt upgrade -y` | `sudo pacman -Syu`（必须完整升级） | `sudo dnf update -y` |
| 2. 确认网络服务 | `systemctl status NetworkManager` 或 `netplan status` | `systemctl status systemd-networkd` / `dhcpcd` | `systemctl status NetworkManager` |
| 3. 确认 SSH 可用（服务器） | `sudo apt install openssh-server && sudo systemctl enable --now ssh` | `sudo pacman -S openssh && sudo systemctl enable --now sshd` | `sudo dnf install openssh-server && sudo systemctl enable --now sshd` |

注意 Arch 的 `pacman -Syu`：滚动发行版**禁止部分升级**（只 `-Sy` 不 `-u`），否则容易出现库版本不一致导致的半升级状态——这是 Arch 新手最经典的第一个坑。RHEL 系还要留意 `dnf update` 与 `dnf upgrade` 在旧版 CentOS 上的语义差异，Rocky/新 RHEL 中两者已趋于一致。

## 常见问题预览

安装环节的求助帖翻来覆去就是那几类，先在这里挂个号，细节在各子页展开：

1. **装完直接进 BIOS/GRUB rescue**——多半是 UEFI 与 Legacy 模式和磁盘分区表不匹配，或 bootloader 装到了错误的磁盘/模式上。判断依据是 `ls /sys/firmware/efi` 是否有输出。
2. **安装器里根本看不到硬盘**——老机器可能是 RAID/Intel RST 模式，新机器可能是磁盘还没分区或被前一个系统的 LVM 卷组占用。
3. **双系统只剩 Linux 或只剩 Windows**——GRUB 探测顺序问题，或安装时选错了引导写入位置（写进 Windows 的 ESP 而非独立管理）。
4. **装完能进系统但没网**——服务器安装常默认不装 NetworkManager，需要手工启用 `dhcpcd`/`systemd-networkd` 或 nmcli。
5. **Arch 装完重启后提示 missing operating system**——手动安装时忘记 `grub-install`，或 EFI 环境下没把引导文件放进 ESP。
6. **Ubuntu 装完卡在"安装完成，请重启"黑屏**——常与 NVIDIA 专显驱动或 Secure Boot 有关，可先在安装器中不勾选"安装第三方驱动"。

每一类问题的根因都能回溯到本章的某个知识点，这也是我们坚持"先讲为什么"的原因。

## 参考资料

- Arch Wiki - Installation guide — [wiki.archlinux.org](https://wiki.archlinux.org/title/Installation_guide)
- Arch Wiki - archinstall — [wiki.archlinux.org](https://wiki.archlinux.org/title/Archinstall)
- Debian Release - Installation manuals — [debian.org](https://www.debian.org/releases/stable/installmanual)
- Ubuntu Desktop installation tutorial — [ubuntu.com](https://ubuntu.com/tutorials/install-ubuntu-desktop)
- Rocky Linux installation guide — [docs.rockylinux.org](https://docs.rockylinux.org/guides/installation/)
- 鸟哥的私房菜 - 安装多重引导与开机管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0157installcentos7.php)
