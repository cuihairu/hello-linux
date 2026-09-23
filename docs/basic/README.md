# 基础篇

基础篇是整套教程的地基。Linux 的世界里有大量"想当然就会"的陷阱：把内核版本当发行版版本、把 `apt` 当成 Linux 标准命令、装完系统不知道为什么重启后网络就没了——这些都不是操作不熟练，而是概念没搭稳。本篇的目标不是让你背下几十条命令，而是先把"Linux 是什么、一台 Linux 机器由哪些东西组成、出了问题该往哪里看"这三件事讲清楚。概念对了，后面命令篇、服务器篇的每个操作你都能自己推导出来；概念错了，抄再多命令也只是碰运气。

> 本篇以 **Debian/Ubuntu、Arch、RHEL/CentOS/Rocky** 三大发行版家族为主线进行对照讲解，凡涉及具体操作或行为差异的地方都会标注所属家族，避免你拿着 APT 的命令去 Arch 上执行。

## 为什么先学基础

很多初学者的路径是：装系统 → 背命令 → 遇到报错 → 百度 → 照抄别人的发行版命令 → 报错更严重。根本原因在于跳过了基础篇要解决的三个问题：

1. **概念问题**：Linux 到底指内核还是整套系统？"一切皆文件"意味着什么？不理解这些，读文档时会把 `/proc`、`/dev` 当成普通目录，遇到 `sudo` 权限问题也只会反复重试。
2. **选型问题**：Debian 的稳定、Arch 的滚动更新、Rocky 的企业兼容，是三种完全不同的运维节奏。在错误的发行版上追求错误的目标（比如在 RHEL 上追最新软件，或在 Arch 上追求五年不重启），后面会一直痛苦。
3. **结构问题**：文件系统层次、开机流程、服务与日志，这三者串起来就是一台机器的"生命周期"。排障能力本质上就是沿着这条链走一遍的能力。

所以本篇的顺序刻意是：先概念（概论、简介），再落地（安装、文件系统），再深入机器内部（开机、服务、日志、安全）。请不要跳读。

## 学习路线（建议顺序）

推荐按下面的顺序学习，每一环都依赖上一环：

| 阶段 | 章节 | 为什么放在这里 |
|------|------|----------------|
| 1. 建立概念 | 技术概论 → Linux 简介 | 先分清内核/发行版/包管理，再谈任何操作 |
| 2. 落地一台机器 | 安装 Linux | 有了选型概念，安装时才知道每个选项的后果 |
| 3. 认识磁盘上的世界 | 文件系统 | 安装的本质就是分区和写入文件系统 |
| 4. 认识启动过程 | 开机流程 | 懂开机，才知道为什么改了 `/etc/fstab` 会开不了机 |
| 5. 让机器有用起来 | 软件安装 → 用户管理 → 系统服务 | 从"能开机"到"能干活" |
| 6. 让机器可靠起来 | 日志系统 → 安全基础 | 最后补上观测与防护能力 |

一个可操作的自检标准：学完本篇后，你应该能在一台全新的虚拟机上回答——"这台机器是什么发行版、什么内核、磁盘怎么分的、开机经过了哪几步、装软件用哪个工具、服务挂了去哪看日志"。六个问题都能答上来，基础篇就算过关。

> 内容参考自 Arch Wiki、鸟哥的私房菜与各发行版官方文档，见各章节参考资料。

## 学习目标

- 理解内核、GNU、发行版与包管理之间的关系，能分清"内核版本"和"发行版版本"
- 掌握 FHS 目录结构与 rwx 权限模型，能解释 `/etc`、`/var`、`/usr` 的职责并排查权限拒绝问题
- 能独立完成三系发行版的选型与安装，说清 Debian/Ubuntu、Arch、RHEL 系发布模型的差异
- 掌握 APT、pacman、dnf 三套包管理器的基本操作，避开把 `apt` 当成 Linux 标准命令的坑
- 理解开机流程与 systemd 服务模型，能用 `systemctl`、`journalctl` 回答"服务为什么起不来、日志去哪看"
- 理解 SELinux 等强制访问控制的定位，知道三系默认差异，避开"权限对却被拒绝"的误判

## 子页导读

本篇的十余个章节可以归入三块，按块理解比按目录死记更省力：

### 概念块：这台机器"是什么"

对应章节：技术概论、Linux 简介。回答的是身份问题——内核与操作系统的区别、GNU 与 Linux 的命名关系、发行版家族的谱系。这一块几乎没有需要执行的命令，但决定了你后面读文档的速度。例如看到 Arch Wiki 写 `pacman -Syu` 时，你能立刻明白：`-S` 是 sync（从仓库同步安装），`-yu` 是 upgrade 加 refresh，这背后是滚动更新发行版"仓库永远只有一个当前版本"的哲学。

### 安装块：这台机器"怎么来的"

对应章节：安装 Linux（含发行版选择、安装前准备、安装过程）。安装是把概念变成现实的过程：分区方案对应文件系统章节，引导器对应开机流程章节，时区与语言对应后续的本地化配置。三系发行版在安装环节差异巨大——Debian/Ubuntu 有成熟的图形安装器和 Subiquity/Calamares，Arch 提供交互式 `archinstall` 但默认要求你手动分区挂载，RHEL/Rocky 则通过 Anaconda 强调 Kickstart 自动化安装。安装时偷的懒，都会在后面几章变成债。

### 系统组件块：这台机器"怎么运转"

对应章节：文件系统、开机流程、软件安装、用户管理、系统服务、日志系统、安全基础。这是本篇的重心，也是日常运维 90% 的场景所在。三系的对应关系在这里分化最明显：装软件时 Debian 用 `apt`、Rocky 用 `dnf`、Arch 用 `pacman`；防火墙 Debian/Ubuntu 默认是 `ufw`，RHEL 系是 `firewalld`，Arch 则通常自行选择 `nftables` 或 `iptables`；SELinux 在 RHEL 系默认 enforcing，Debian/Ubuntu 默认不启用，Arch 默认不带强制访问控制框架。命令可以查，但"为什么这台机器上没有这个命令"必须靠概念回答。

## 本篇章节目录

以下是基础篇的完整目录，每章附一句话导读，方便你按需跳转：

- [技术概论](./overview.md) — 操作系统原理与 Linux 设计哲学（一切皆文件、系统调用、内核子系统）的总纲，读简介前先扫一遍。
- [Linux 简介](./introduction.md) — 回答"Linux 到底是什么"的三连问：内核还是系统、从哪来、发行版怎么选。
  - [什么是 Linux](./introduction/what_is_linux.md) — 厘清内核/操作系统/GNU/Linux/发行版四个概念的边界，附真实终端验证方法。
  - [Linux 的历史](./introduction/history.md) — 从 Unix 分裂到 GNU 运动再到 1991 年那封 Usenet 帖子，理解设计哲学的来历。
  - [Linux 发行版简介](./introduction/distributions.md) — Debian、RHEL、Arch 三大家族的谱系、包管理差异与选型建议。
- [安装 Linux](./installation.md) — 从选发行版到完成安装的完整流程，含三系安装方式对照。
  - [选择合适的发行版](./installation/choose_distribution.md) — 按用途和经验做决策，避免"装了三天就重装"。
  - [安装前的准备](./installation/preparation.md) — 分区、引导模式、网络与镜像源的预先规划。
  - [安装过程](./installation/process.md) — 三系安装器的实际步骤与关键选项含义。
- [文件系统](./filesystem.md) — 磁盘上的数据如何组织，Linux 目录树为什么这样设计。
  - [文件系统概念](./filesystem/concept.md) — inode、块、挂载点等核心概念，回答"为什么 U 盘要挂载才能用"。
  - [目录层次结构](./filesystem/hierarchy.md) — FHS 标准下 `/etc`、`/var`、`/usr` 各自的职责。
  - [文件权限](./filesystem/permissions.md) — rwx、属主属组、SUID/SGID/ Sticky 位的实际含义与排查。
- [开机流程](./boot.md) — 从按下电源到登录提示符之间发生了什么。
  - [BIOS 与 UEFI](./boot/bios_uefi.md) — 两种固件模式的差异，以及为什么磁盘分区表要跟着变。
  - [GRUB 引导程序](./boot/grub.md) — 引导器如何找到内核，引导失败如何抢救。
- [软件安装](./packages.md) — 三系包管理器（APT / DNF / pacman）的原理与操作对照。
  - [APT 包管理](./packages/apt.md) — Debian/Ubuntu 的 `apt` 与 `dpkg`，仓库、依赖与源配置。
  - [YUM/DNF 包管理](./packages/yum.md) — RHEL/CentOS/Rocky 的 `dnf` 与 RPM，模块流与 EPEL。
- [用户管理](./users.md) — 账号、组、权限如何构成多用户系统的第一道防线。
  - [账号管理](./users/account_management.md) — 用户与组的增删改查，`/etc/passwd` 等关键文件解读。
  - [ACL 权限控制](./users/acl_permissions.md) — 当 rwx 三位不够用时的精细授权。
  - [磁盘配额](./users/disk_quotas.md) — 限制单个用户占用的磁盘空间。
- [系统服务](./services.md) — systemd 时代的服务、启动单元与配置管理。
  - [系统服务管理](./services/system_services.md) — `systemctl` 核心用法，服务为何起不来的排查路径。
  - [日志管理](./services/log_management.md) — journald 与传统 syslog 的分工。
  - [系统配置工具](./services/configuration_tools.md) — 三系各自的配置入口（Netplan、NetworkManager 等）。
- [安全基础](./security.md) — 以 SELinux 为主的强制访问控制概念与实践。
  - [SELinux 概念](./security/concept.md) — 为什么 DAC 之外还需要 MAC，策略与标签模型。
  - [SELinux 模式](./security/modes.md) — enforcing/permissive/disabled 的选择与切换。
  - [SELinux 基本命令](./security/commands.md) — 排查"权限明明对却被拒绝"的常用命令。
  - [SELinux 策略配置](./security/policy_configuration.md) — 自定义布尔值与策略模块。
- [日志系统](./log.md) — 系统事件的记录、查询与轮转。
  - [系统日志](./log/syslog.md) — `journalctl` 与 `/var/log` 的阅读方法。
  - [日志轮转](./log/rotation.md) — 日志为什么必须轮转，logrotate 如何配置。

## 三系发行版对应关系

本篇所有涉及操作的章节，都按下表对号入座。这是阅读时最重要的索引：

| 主题 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 包格式 | .deb | .pkg.tar.zst | .rpm |
| 包管理器 | `apt` / `dpkg` | `pacman` | `dnf` / `rpm` |
| 软件源配置 | `/etc/apt/sources.list` | `/etc/pacman.conf` + `/etc/pacman.d/mirrorlist` | `/etc/yum.repos.d/*.repo` |
| 第三方扩展 | PPA、backports | AUR（`pacman` 不直接支持，用 `yay`/`paru` 等助手） | EPEL、RPM Fusion |
| 网络配置 | Netplan（`/etc/netplan/*.yaml`） | 通常直接用 `systemd-networkd` 或 NetworkManager | NetworkManager / ifcfg 脚本 |
| 防火墙 | `ufw`（底层 iptables/nftables） | 自选 `nftables`/`iptables`，无默认方案 | `firewalld` |
| 强制访问控制 | AppArmor（默认） | 无默认配置 | SELinux（默认 enforcing） |
| 发布模型 | 固定周期（Ubuntu LTS 每两年） | 滚动更新，无版本号 | 固定周期（约 3 年，支持 10 年） |
| 典型场景 | 桌面入门、通用服务器 | 学习、极简定制、滚动尝鲜 | 企业生产、认证生态 |

需要注意两处本篇的覆盖范围：软件安装章目前以 APT 和 DNF 为主线展开，Arch 的 `pacman` 系统用法在[发行版简介](./introduction/distributions.md)中有完整对照；安全基础章的 SELinux 内容对 Debian/Ubuntu 和 Arch 同样适用，但那两个家族默认不启用，阅读时请把命令标注视为"启用后可用"。

## 前置建议

开始本篇之前，建议做好以下准备，可以少走很多弯路：

1. **准备一台可牺牲的实验机**。虚拟机（VirtualBox、QEMU/KVM、VMware 均可）加三块快照最稳妥：一块停在刚装完系统，一块停在做完基础配置。直接在主力机上练习 `chmod 777 /` 或改 `/etc/fstab`，恢复成本远高于装一台虚拟机。
2. **三系各装一台**。只学 Debian 会让你误以为 `apt` 是 Linux 标准，只学 Arch 会让你低估发行版的稳定性工作。最低配置建议：Ubuntu LTS（或 Debian stable）一台、Rocky Linux 一台、Arch Linux 一台，哪怕 Arch 只装在 20 GB 的测试盘里。
3. **学会查官方文档，而不是只搜博客**。优先级建议：发行版官方文档 → Arch Wiki（对三系都有很高参考价值）→ 鸟哥的私房菜 → 通用博客。Arch Wiki 的可贵之处在于它写的是"Linux 如何工作"，很多条目对 Debian/RHEL 用户同样正确。
4. **保持网络与镜像可用**。国内环境下提前配置好国内镜像源（清华、中科大、阿里均有三系镜像），否则 `apt update`、`pacman -Sy`、`dnf makecache` 会慢到让你怀疑人生，这也是新手劝退的第一大原因。
5. **准备一个随时能记笔记的终端会话**。建议从第一天起养成习惯：执行的重要命令、报错原文、自己的猜测，都原样记下来。排障能力是靠"报错—假设—验证"的循环喂出来的，不是靠背诵。

## 参考资料

- 鸟哥的私房菜 - 基础篇 — [linux.vbird.org](https://linux.vbird.org/linux_basic/)
- Arch Wiki — [wiki.archlinux.org](https://wiki.archlinux.org/)
- Arch Wiki - pacman — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Debian 手册 — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Ubuntu 官方文档 — [help.ubuntu.com](https://help.ubuntu.com/)
- Red Hat 文档中心 — [docs.redhat.com](https://docs.redhat.com/)
- Rocky Linux 文档 — [docs.rockylinux.org](https://docs.rockylinux.org/)
- Fedora 文档 — [docs.fedoraproject.org](https://docs.fedoraproject.org/)
- Linux 内核文档 — [kernel.org](https://www.kernel.org/doc/html/latest/)
- DistroWatch — [distrowatch.com](https://distrowatch.com/)
