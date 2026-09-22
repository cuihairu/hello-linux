# Linux 的历史

从 Unix 到 GNU/Linux，理解这段历史有助于理解 Linux 的设计哲学和文化。这不是为了考据而考据：AT&T 把 Unix 闭源商业化，才有了 Stallman 的自由软件运动；自由软件运动缺一个内核，才有了 1991 年那个"业余爱好"项目；而早期发行版各自为政的局面，直接决定了今天 Debian、RHEL、Arch 三大家族截然不同的脾气——固定发布的保守、企业版的超长支持、滚动更新的激进，都能在历史里找到因果。读完本页，你再看任何一个发行版的公告，都能大致推断它背后的立场与取舍。

> 内容参考自官方文档和历史文献，见文末参考资料。

## 学习目标

- 了解 Unix 的诞生、分裂及其对后来系统设计的影响
- 理解 GNU 项目的起源、GPL 的意义与 Linux 内核登场的历史时机
- 掌握 Linux 发展的重要里程碑与现代发行版谱系
- 理解三大家族（Debian / RHEL / Arch）的历史定位差异，以及 `pacman` 与滚动更新的由来
- 识别历史类话题中的常见误区（如 CentOS 的身份、内核版本与发行版年份的混淆）

## 1. Unix 时代（1969-1983）

### 1.1 诞生

1969 年，贝尔实验室的 Ken Thompson 和 Dennis Ritchie 在 DEC PDP-7 上开发了 Unix。**为什么这个项目值得记住**：它做了几个在当时看来离经叛道、后来却成为行业标准的选择——用分层结构取代大一统的单体内核堆砌、提供层次化的文件系统、让一切（包括硬件）都以文件的形式暴露给用户。更关键的一步发生在 1973 年：Dennis Ritchie 用刚发明的 C 语言重写 Unix。C 代码接近硬件又易于移植，Unix 从此可以跟着机器走，而不是绑死在某一台小型机上。今天你在终端里敲的 `ls`、`cd`、`chmod`，名字和概念几乎原封不动地来自那个年代。

| 年份 | 事件 |
|------|------|
| 1969 | Unix 在贝尔实验室诞生 |
| 1971 | Unix 第一版发布，用汇编语言编写 |
| 1973 | 用 C 语言重写 Unix（划时代之举） |
| 1975 | Unix 第六版发布，广泛分发到大学 |
| 1977 | BSD（Berkeley Software Distribution）诞生 |
| 1979 | Unix 第七版，商业化的开始 |
| 1983 | AT&T 发布 System V |

Unix 第六版进入大学后被广泛研读和改造，BSD 就是加州大学伯克利分校在 Unix 基础上加入网络能力（TCP/IP 实现的早期关键贡献）后的产物。也就是说，后来统治互联网的网络协议栈和统治学术界的 Unix 血统，在 1970 年代末就已经交织在一起了。

### 1.2 Unix 的分裂

1979 年，AT&T 在 Unix 第七版之后明确转向商业化授权，大学不能再自由使用源码——这道禁令直接催生了两件事：BSD 项目加速从自有代码重构出可用系统，以及整个行业对"下一个自由 Unix"的渴望。Unix 逐渐分裂为两大流派：

```
                    Unix
                     │
        ┌────────────┴────────────┐
        │                         │
    AT&T System V              BSD
    (商业版)                  (学术版)
        │                         │
   ┌────┴────┐              ┌────┴────┐
   │ Solaris │              │ FreeBSD │
   │ HP-UX   │              │ NetBSD  │
   │ AIX     │              │ OpenBSD │
   └─────────┘              └─────────┘
```

**对今天的实际影响**：你偶尔还会看到命令风格的"南北之争"——`ifconfig`（BSD 传统）与 `ip`（Linux 现代接口）、System V 的 `init` 脚本与如今统一的 `systemd`。分清一个设计源自哪一派，查文档时就知道该往哪个传统里找线索。Linux 本身在接口上更靠近 POSIX/SysV 一脉，但网络管理等处早已走出自己的路。

### 1.3 POSIX 标准

1988 年，IEEE 发布 POSIX（Portable Operating System Interface）标准，统一 Unix 系统调用接口。**为什么需要标准**：厂商各自分叉后，为 Solaris 写的程序未必能在 HP-UX 上编译。POSIX 规定了进程、信号、文件 I/O 等接口的统一行为，应用程序才有了跨平台的可能。Linux 从一开始就以兼容 POSIX 为目标，这正是大量 Unix 软件能相对顺利移植过来的原因——也是为什么 `getconf`、`grep`、`awk` 这些工具在三系发行版上行为基本一致。

```bash
# 查看系统是否遵循 POSIX
$ getconf _POSIX_VERSION
200809L
```

返回 `200809L` 表示实现的是 POSIX.1-2008 版本，这个输出在 Debian、Rocky、Arch 上都一样——接口标准的统一，是"学会一个发行版能触类旁通"的底层保证。

## 2. GNU 运动（1983-1991）

### 2.1 起源

1983 年，Richard Stallman 在 MIT 发起 GNU（GNU's Not Unix）项目，目标是创建一个完全自由的类 Unix 操作系统。

Stallman 的动机：
- 打印机驱动的源代码被厂商拒绝分享（无法修复一个反复卡纸的 bug）
- 软件私有化阻碍了技术进步
- 希望建立一个自由软件社区

**为什么 GNU 的故事重要**：它奠定了 Linux 世界两个至今仍在生效的规则——代码必须可获得，修改必须可再分发。今天你能理直气壮地要求厂商提供驱动源码、能自由 fork 一个发行版，权利依据都可以追溯到这套理念。

### 2.2 自由软件定义

自由软件的四项基本自由：

| 自由 | 说明 |
|------|------|
| 自由 0 | 运行程序的自由（无论出于什么目的） |
| 自由 1 | 研究和修改源代码的自由 |
| 自由 2 | 重新分发副本的自由 |
| 自由 3 | 分发修改版本的自由（可回馈社区） |

注意自由 1 的前提是"能拿到源码"——这正是私有软件剥夺的那一环。对使用者而言，最直接的收益是安全审计与自主定制：Heartbleed 漏洞爆发后，任何发行版都能立即审计并修补 OpenSSL，而不用等某一家厂商"决定"是否发布补丁。

### 2.3 GPL 许可证

1989 年，Stallman 创建了 GNU 通用公共许可证（GPL），确保软件的自由传播。GPL 的核心武器是**传染性（copyleft）**：任何基于 GPL 代码的衍生作品再分发时，必须同样以 GPL 开源。这防止了"拿走自由软件、改成闭源"的套利行为——厂商可以基于 Linux 内核做商业产品，但分发时必须提供完整源码。Linux 内核采用的是 GPLv2，这一选择在 1990 年代末还引发过与 GPL v3 的著名分歧，最终内核社区决定停留在 v2。

```bash
# 查看 GPL 许可证文本（Debian/Ubuntu 随 common-licenses 包提供）
$ head -5 /usr/share/common-licenses/GPL-3
                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.
```

RHEL 与 Arch 系统上该路径可能不存在（许可证通常放在 `/usr/share/licenses/<包名>/` 下），但每个安装的软件包都带许可证信息这一惯例是三系通用的——查询某个包的许可证，`pacman -Qi nginx`、`dnf info nginx`、`apt show nginx` 的输出里都有 `License` 字段。

### 2.4 GNU 项目成果

| 年份 | 项目 | 说明 |
|------|------|------|
| 1984 | GNU Emacs | 文本编辑器 |
| 1987 | GCC 0.9 | GNU 编译器 |
| 1988 | GNU Make | 构建工具 |
| 1990 | glibc | C 标准库 |
| 1990 | GNU Hurd | 内核（未完成） |

到 1991 年，GNU 已经有了除内核以外的几乎所有组件。**历史的巧合与必然**：Hurd 拖延不决，一个芬兰学生在 Minix 教学系统上写的实验内核却迅速能跑——GNU 缺内核、Linux 缺用户空间工具，两者拼合几乎是顺理成章的。这也解释了为什么 `ls`、`bash` 这些"最 Linux 的命令"其实全是 GNU 的代码。

## 3. Linux 的诞生（1991）

### 3.1 Linus Torvalds

1991 年，芬兰赫尔辛基大学的学生 Linus Torvalds 开始编写一个操作系统内核。起点是学术性的：他在课程中接触到了当时的 UNIX，并希望在自己的 386 机器上体验类似能力，而教学用的 Minix 又有诸多限制。他的第一封公开信写得很谦虚，甚至说这"只是个业余爱好，不会像 GNU 那样庞大和专业"——历史的幽默在于，这个"业余项目"后来成了全球数字基础设施的地基。

### 3.2 著名的 Usenet 帖子

1991 年 8 月 25 日，Linus 在 comp.os.minix 新闻组发表了著名的帖子：

```
From: torvalds@klaava.Helsinki.FI (Linus Benedict Torvalds)
Newsgroups: comp.os.minix
Subject: What would you like to see most in minix?
Date: 25 Aug 91 23:19:35 GMT

Hello everybody out there using minix -

I'm doing a (free) operating system (just a hobby, won't be big and
professional like gnu) for 386(486) AT clones...
```

帖子标题问的是"你们最希望 minix 有什么功能"，正文却宣布自己在做一个新系统——两个月后 0.01 版发布，邮件列表上愿意测试和贡献的人迅速增加。开源协作的飞轮在还没有 GitHub 的年代，靠新闻组和邮件列表就转了起来。

### 3.3 版本里程碑

| 版本 | 日期 | 重要变化 |
|------|------|---------|
| 0.01 | 1991.09.17 | 首次公开发布 |
| 0.02 | 1991.10.05 | 支持 bash 和 gcc |
| 0.12 | 1991.11 | 支持虚拟内存 |
| 1.0 | 1994.03.14 | 首个正式版本 |
| 2.0 | 1996.06.09 | 支持多架构 |
| 2.6 | 2003.12.17 | 内核模式抢占 |
| 3.0 | 2011.07.21 | 版本号变更（无颠覆性重写） |
| 4.0 | 2015.04.12 | Live patching |
| 5.0 | 2019.03.03 | Energy Aware Scheduling 等 |
| 6.0 | 2022.10.02 | 支持更多新硬件 |

**读懂版本号的两件事**：其一，3.0、4.0 这类大版本跳跃主要是编号策略调整，并不代表系统被重写——不要把内核大版本号当成"代际革命"的标志。其二，版本号递增与"你的机器上是哪个版本"是两回事：Ubuntu 24.04 带的是 6.8 内核，Rocky 9.4 则停留在经过大量回移补丁的 5.14——后者是企业发行版的刻意选择，稳定与硬件支持周期优先于追新。

```bash
# 查看当前内核版本
$ uname -r
6.8.0-45-generic

# 查看内核包的变更日志（Debian/Ubuntu 例）
$ zgrep -m1 "^linux" /usr/share/doc/linux-image-$(uname -r)/changelog.Debian.gz 2>/dev/null || true
```

三系查看内核信息的方式略有差异：Debian/Ubuntu 上内核及其文档由 `linux-image-*` 包提供；RHEL/Rocky 上对应 `kernel` 包，可用 `rpm -q kernel` 查询；Arch 上内核就是 `linux` 包本身，`pacman -Qi linux` 即可看到版本与构建信息。同一个 `uname -r`，背后的打包者和补丁策略完全不同。

## 4. 发行版的兴起（1992-至今）

### 4.1 早期发行版

为什么需要发行版：内核源码和 GNU 工具都能免费下载，但把它们组装成"插上就能用"的系统、持续数年提供安全更新，需要组织化的工作。发行版就是承担这项工作的团队与其产出的软件仓库。

| 年份 | 发行版 | 说明 |
|------|--------|------|
| 1992 | SLS | 最早的发行版之一 |
| 1993 | Slackware | 最古老的仍活跃的发行版 |
| 1993 | Debian | Ian Murdock 创立，强调自由软件与社区治理 |
| 1994 | Red Hat | 后来演化出商业化的 RHEL |
| 1994 | SUSE | 德国发行版，源自 Slackware |

### 4.2 现代发行版

| 年份 | 发行版 | 说明 |
|------|--------|------|
| 2002 | Arch Linux | 极简 + 滚动更新，同年随发行版推出 `pacman` 包管理器 |
| 2004 | Ubuntu | 基于 Debian，推动桌面普及 |
| 2004 | CentOS | RHEL 的社区重建版（后于 2021 转型） |
| 2009 | Chrome OS | 基于 Gentoo |
| 2020 | Rocky Linux | CentOS 停更后的社区替代品之一 |

Arch 与 `pacman` 的出现值得单独说：2002 年之前的主流叙事是"固定周期发布 + 保守选包"，Arch 反其道而行——仓库里永远只保留每个软件的**当前最新版**，用户通过 `sudo pacman -Syu` 持续同步，没有 22.04、24.04 这样的版本号。`pacman` 的命令设计也体现了这种哲学：`-S`（sync）是最高频操作，全系统升级被简化为一条不可分割的日常命令。今天你在 Arch Wiki 上看到的"永远做完整升级"的铁律，源头就是 2002 年确立的这套发布模型。它与 Debian 的"stable 几乎不动、改动走 backports"、RHEL 的"十年支持、只收补丁不追新"构成了三系节奏的三个极端。

### 4.3 发行版家谱

```
Slackware (1993)
    └── SUSE (1994)

Debian (1993)
    ├── Ubuntu (2004)
    │   ├── Linux Mint
    │   ├── Pop!_OS
    │   └── Kali Linux
    └── Knoppix

Red Hat (1994)
    ├── RHEL (2000)
    │   ├── CentOS (2004, 2021 起转型为 CentOS Stream)
    │   ├── Rocky Linux (2021)
    │   └── AlmaLinux (2021)
    └── Fedora (2003)

独立家族：Arch Linux (2002, 滚动更新 + pacman)
```

**看家谱的实用价值**：衍生版通常继承上游的包格式和大量工具习惯——`ID_LIKE=ubuntu` 的系统基本可以照搬 APT 命令，Rocky 的 `dnf` 操作与 Fedora 几乎一致，而 Arch 系（如 Manjaro）仍以 `pacman` 为核心、只是加了封装。判断一台陌生机器该怎么管，看家谱比看 logo 有用得多。

## 5. Linux 的今天

### 5.1 应用领域

| 领域 | 份额 | 说明 |
|------|------|------|
| 服务器 | 绝大多数 | Web、云计算、数据库的主流选择 |
| 超级计算机 | 100% | Top 500 长期全部运行 Linux |
| 移动设备 | 绝大多数 | Android 基于 Linux 内核（用户空间是 Android 而非 GNU） |
| 嵌入式 | 广泛 | 路由器、智能家居、汽车 |
| 桌面 | 约 4% | 开发者、技术爱好者为主 |

两个容易混淆的点：**Android 虽然用 Linux 内核，却不含 GNU 工具链**，你在 Android 上看到的 shell 和工具是另一套用户空间，所以严格说它不是 GNU/Linux 发行版；**桌面份额低不等于影响力低**——开发者桌面、构建服务器、CI 集群几乎全是 Linux，你在桌面端用的工具链最终也部署在它上面。

### 5.2 主要贡献者

Linux 内核早已不是个人爱好者的独角戏，而是大公司与社区共同维护的公共基础设施：

| 贡献者 | 说明 |
|--------|------|
| Intel | 硬件支持和驱动 |
| Red Hat | 内核核心开发（长期位居前列） |
| Google | 容器、调度器（如 EAS、cgroup 相关） |
| Meta | 性能优化 |
| ARM | 架构支持 |
| 社区个人 | 大量贡献者 |

商业公司重金投入开源内核，是因为它们的产品（云、芯片、手机）都跑在上面——这与 GPL 的规则叠加，形成了"竞争者在同一代码库上协作"的独特生态。想看具体统计，可参考 Linux Foundation 与 LWN 的发布报告。

## 6. 常见坑与误区

1. **把 CentOS 当成"免费的 RHEL"而不看现状**。CentOS 8 已于 2021 年底停止维护，CentOS 项目转向了位于 RHEL **上游**的 CentOS Stream；需要 RHEL 兼容的下游选择，今天社区主流是 Rocky Linux 与 AlmaLinux。看到还在指导"生产环境装 CentOS 7/8"的文章，先核对发布年份。

2. **拿发行版年份当内核年份**。Ubuntu 24.04 不代表内核是 2024 年的全部功能——它可能只带 6.8 且大量回移补丁；Rocky 9.4 的内核更是 5.14 系。讨论"某特性我的系统有没有"，查 `uname -r` 与发行版发行说明，不要按公历年份推断。

3. **以为"Linux 1.0 之后才有人用"**。0.x 时代已有大量测试者和早期发行版在分发内核；1.0 是稳定接口的里程碑，不是用户从无到有的起点。

4. **把 GNU 与 Linux 当成互相竞争的项目**。它们是互补关系：GNU 提供用户空间，Linux 提供内核。命名争议只影响措辞，不影响你用的任何软件。

5. **认为滚动更新"永远最新所以更好"**。Arch 的新意味着你自己要承担升级回归风险（所以有 `/etc/pacman.d/hooks`、完整升级纪律和 AUR 软件的维护责任）；固定发布系则相反，稳定但可能几年都拿不到新特性。没有优劣，只有与场景的匹配——详见[发行版简介](./distributions.md)。

6. **在 Arch 上把"历史经验"照搬到包管理命令**。其他发行版教程里 `apt update && apt upgrade` 的两步式习惯，在 Arch 上对应的是**一条** `sudo pacman -Syu`；刻意拆成"只更新索引"在 Arch 上会制造部分升级事故。迁移经验时，先迁移概念，再重新查命令。

## 参考资料

- The Unix Heritage Society — [tuhs.org](https://www.tuhs.org/)
- GNU Project History — [gnu.org](https://www.gnu.org/gnu/gnu-history.html)
- GPL 许可证全文 — [gnu.org](https://www.gnu.org/licenses/gpl-3.0.en.html)
- Linus Torvalds 原始 Usenet 帖子 — [groups.google.com](https://groups.google.com/g/comp.os.minix/c/dlNtH7RRrGA)
- Linux Kernel Archives — [kernel.org](https://www.kernel.org/)
- LWN.net Kernel Newbies / Linux Versions — [kernelnewbies.org](https://kernelnewbies.org/LinuxVersions)
- Arch Wiki - pacman（滚动更新与部分升级） — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- CentOS 项目说明（Stream 转型） — [centos.org](https://www.centos.org/)
- DistroWatch — [distrowatch.com](https://distrowatch.com/)
