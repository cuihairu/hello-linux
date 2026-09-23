# Linux 简介

## 本章导语

"Linux 是什么"看起来是一个可以一句话回答的问题，实际上却藏着三层需要分别理解的东西：**内核**、**操作系统**、**发行版**。日常口语里说"我装了个 Linux"，指的通常是某个发行版；严格意义上说"Linux"，指的只是 Linus Torvalds 维护的那份内核源码；而你真正每天在敲命令、装软件的那套东西，是 GNU 工具链、系统库、包管理器和内核拼在一起的完整系统。分不清这三层，后面的一切都会别扭——你会对着 Arch Linux 报"我的 Linux 版本号是多少"这样的问题困惑（Arch 是滚动更新的，`cat /etc/os-release` 里根本没有 `VERSION_ID`），也会把 Debian 的 `apt` 命令复制到 Rocky 上然后看到 `command not found`。

理解"是什么"之外，还需要知道它**从哪里来**。Unix 的商业分裂催生了自由软件运动，GNU 项目补齐了用户空间却唯独缺一个内核，1991 年一个学生写的"业余爱好"项目恰好填上了这块拼图。这段历史不是八卦：GPL 许可证解释了为什么 Linux 衍生品必须开源，"一切皆文件"的设计哲学解释了为什么 `/proc` 里能看到进程，滚动更新与固定发布两种节奏的分歧，也能在发行版家谱里找到源头。知道来龙去脉，遇到陌生发行版时你能快速判断它的脾气，而不是把它当成一个全新的系统从零摸索。

最后要解决的是**选型**问题。发行版有数百种，但对绝大多数人来说，真正需要认真考虑的只有三大家族：Debian/Ubuntu 系（APT、`.deb` 包）、RHEL/CentOS/Rocky 系（DNF、`.rpm` 包）、Arch 系（`pacman`、滚动更新）。三者在包管理、防火墙、SELinux 默认策略、发布模型上差异显著，选错的后果轻则频繁踩坑，重则生产环境稳定性事故。本章的第三页会给出完整的对照与决策建议——请务必在动手安装之前读完它。

> 内容参考自 Arch Wiki、鸟哥的私房菜与 Linux 官方文档，见文末参考资料。

## 学习目标

学完本章三页内容后，你应当能够：

1. **区分四个层次**：内核（kernel）、GNU 用户空间、完整操作系统、发行版（distribution），并在真实终端上用命令验证任何一个。
2. **解释命名由来**：说清为什么 Stallman 主张叫 GNU/Linux 而大多数人只说 Linux，以及这个争议今天为什么基本不再影响使用。
3. **画出至少两张家谱**：Debian 与 RHEL 的衍生关系，以及 Arch 在三大家族中的位置（独立家族、滚动更新、`pacman` 管理）。
4. **描述发行版组成**：从内核、GNU 工具、系统库到包管理和桌面环境，知道每一层的职责，以及换一层会带来什么变化。
5. **独立完成选型**：给定"新手入门 / 企业服务器 / 想深入学习"三种场景，能给出合理推荐并说明理由（含"为什么不选另一个"）。
6. **避开概念坑**：不把内核版本当发行版版本、不把某一家的包管理命令当成 Linux 标准、不在错误的发行版上追求错误的特性。

## 子页导读

本章由三页构成，建议按顺序阅读，每页约 10–15 分钟：

- **[什么是 Linux](./introduction/what_is_linux.md)** — 概念边界页。从 `uname -r` 和 `cat /proc/version` 的真实输出出发，拆解内核与操作系统的区别，讲清 GNU 项目与 Linux 的拼合关系，给出发行版的分层结构，并介绍三大包管理器（`apt`、`dnf`、`pacman`）的分工。本页解决"别人说 Linux 时到底在说什么"。

- **[Linux 的历史](./introduction/history.md)** — 来龙去脉页。从 1969 年 Unix 诞生讲到今天的 Top 500 超算，重点是三段因果：AT&T 商业化如何把 Unix 撕成 System V 与 BSD 两派，Stallman 的打印机事件如何催生 GNU 与 GPL，以及 1991 年那封著名的 Usenet 帖子如何开启了发行版的百花齐放。本页解决"Linux 为什么长成今天这样"。

- **[Linux 发行版简介](./introduction/distributions.md)** — 选型决策页。逐一剖析 Debian/Ubuntu、RHEL/CentOS/Rocky、Arch 三大家族的定位、发布模型与包管理（含 `pacman` 的完整实战对照），给出按用途和按经验两张决策表，以及国内镜像下载地址。本页解决"我该装哪一个"。

## 30 秒了解 Linux

如果只记住一段话，希望是下面这段：

> Linux 是一个**内核**的名字，也常被用来指代"Linux 内核 + GNU 工具 + 包管理 + 配置"组成的整套**操作系统**。它 1991 年由 Linus Torvalds 开源发布，今天驱动着全球几乎全部超级计算机、绝大多数云服务器和绝大多数 Android 手机。你实际安装使用的是某个**发行版**——Debian/Ubuntu 系用 `apt` 装软件、RHEL/Rocky 系用 `dnf`、Arch 用 `pacman`；三者内核都是 Linux，差在软件仓库、默认配置和更新节奏。服务器与超算上 Linux 占绝对主导，桌面端约 4% 左右，主要用户是开发者和技术爱好者。

对应到终端，三个命令就能把这段话验证一遍：

```bash
# 我用的内核是？—— 三系都会返回类似 6.8.0-45-generic 的真实版本号
uname -r

# 我用的发行版是？—— 注意三系输出格式差异很大
cat /etc/os-release

# 我的系统里有 GNU 工具吗？—— 返回 coreutils 版本即说明有
ls --version | head -1
```

在 Ubuntu 24.04 上，`uname -r` 返回 `6.8.0-45-generic`；在 Rocky Linux 9.4 上返回 `5.14.0-427.13.1.el9_4.x86_64`；在 Arch 上返回形如 `6.8.9-arch1-1` 的滚动版本号。三个内核主版本不同，但都是 Linux——这正是"内核是内核，发行版是发行版"的直观证据。

## 常见误解澄清

新手最常掉进的五个概念陷阱，先在这里集中排掉，详细展开见各子页：

1. **误解："Linux 就是 Ubuntu"**。Ubuntu 只是一个发行版，基于 Debian；Rocky 基于 RHEL 的源码重建；Arch 则是独立起点。内核都是 Linux，用户空间和生态完全不同。把"Ubuntu 的经验"直接平移到另一系上，最常见的翻车点是包管理命令和网络配置文件路径。

2. **误解："Linux 版本号就是 `uname -r` 的输出"**。`uname -r` 返回的是**内核**版本。发行版版本要看 `/etc/os-release`：Ubuntu 是 `24.04`，Rocky 是 `9.4`，而 Arch 是 `rolling`（没有版本号）。给 Arch 用户问"你的 Linux 是几号版本"，正确的问题是"你上次 `pacman -Syu` 是什么时候"。

3. **误解："`apt` 是 Linux 自带的包管理器"**。`apt` 属于 Debian/Ubuntu 家族，RHEL 系用 `dnf`（旧称 `yum`），Arch 用 `pacman`，三者互不兼容，包格式（`.deb` / `.rpm` / `.pkg.tar.zst`）也不通用。判断该用哪个，先跑 `cat /etc/os-release` 看 `ID=` 字段，这是本章要求养成的第一个习惯。

4. **误解："发行版越多，内核就越多"**。内核只有一份（kernel.org 上的主线），发行版做的是挑选内核版本、打补丁、配置编译选项，再配上各自的用户空间。所以 `uname -r` 的输出在 Ubuntu 和 Debian 上会不同，但它们共享同一个上游项目。

5. **误解："开源 = 免费 = 没有商业支持"**。RHEL 是开源软件的商业发行版，卖的是订阅（订阅包含认证、支持与长期维护）；Rocky 和 AlmaLinux 则是社区提供的 RHEL 兼容选择。开源说的是代码可得性，和你是否付费买服务是两回事——企业选型时这一点尤其容易被混淆。

## 参考资料

- GNU 项目：Linux 与 GNU 的关系 — [gnu.org](https://www.gnu.org/gnu/linux-and-gnu.html)
- The Linux Kernel Archives — [kernel.org](https://www.kernel.org/)
- Arch Wiki - Linux — [wiki.archlinux.org](https://wiki.archlinux.org/title/Linux)
- Arch Wiki - pacman — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Debian 手册 — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Red Hat 文档 — [docs.redhat.com](https://docs.redhat.com/)
- DistroWatch — [distrowatch.com](https://distrowatch.com/)
- 鸟哥的私房菜 - 基础篇首章 — [linux.vbird.org](https://linux.vbird.org/linux_basic/)
