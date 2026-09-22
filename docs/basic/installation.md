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
- 鸟哥的私房菜 - 安装多重引导与开机管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0130installlinux/)
