# 什么是 Linux

"Linux" 这个词在不同语境下有不同含义：严格来说它只是内核，但在日常使用中通常指代完整的操作系统。本章厘清这些概念——这不只是咬文嚼字，而是决定了你以后读文档、提问题、搜报错的方式。一个把 `/proc` 当成"某个软件的配置目录"的人，和一个知道那是内核导出的虚拟文件系统的人，面对同样的报错会走向完全不同的排查路径。本页先讲清楚内核与操作系统的边界，再讲 GNU 与 Linux 的拼合关系，最后落到"发行版由什么组成、用什么工具管理软件"，并给出三系终端上的验证方法。

> 内容参考自 GNU 项目文档和 Linux 内核文档，见文末参考资料。

## 学习目标

- 理解内核与操作系统的区别，并能在真实终端上分别验证
- 了解 GNU 项目与 Linux 的关系，理解 GNU/Linux 命名争议的实质
- 掌握发行版的组成结构，知道每一层换掉会怎样
- 认识三大包管理器（`apt`、`dnf`、`pacman`）的分工与差异

## 1. 内核 vs 操作系统

### 1.1 内核（Kernel）

内核是操作系统的核心程序，负责管理硬件资源和提供基础服务。**为什么需要它**：应用程序不能直接操作磁盘、网卡和内存条——那样每个程序都要自己写驱动，而且互相冲突。内核把这些危险且排他的操作收拢到一处，通过系统调用接口暴露给外界，应用程序于是只需要说"我要读这个文件"，而不用关心数据从哪个扇区、经过哪个总线到达自己手里。

Linux 内核只是一个用 C 写的程序，通常压缩后存放在 `/boot` 下面，运行时占据内存中受保护的"内核空间"。它本身不包含 `ls`、`bash`、浏览器——这些东西在"用户空间"，靠系统调用与内核对话：

```text
┌──────────────────────────────────────┐
│           用户空间 (User Space)        │
│  ┌────────┐ ┌────────┐ ┌────────┐   │
│  │  Bash  │ │  Vim   │ │  Nginx │   │
│  └───┬────┘ └───┬────┘ └───┬────┘   │
├──────┼──────────┼──────────┼─────────┤
│      │     系统调用接口      │         │
│  ┌───┴──────────────────────┴────┐   │
│  │          内核空间              │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐  │   │
│  │  │进程  │ │内存  │ │文件  │  │   │
│  │  │调度  │ │管理  │ │系统  │  │   │
│  │  ├──────┤ ├──────┤ ├──────┤  │   │
│  │  │网络  │ │设备  │ │安全  │  │   │
│  │  │协议栈│ │驱动  │ │模块  │  │   │
│  │  └──────┘ └──────┘ └──────┘  │   │
│  └───────────────────────────────┘   │
└──────────────────────────────────────┘
```

Linux 内核的职责：

| 子系统 | 功能 | 你以后会在哪里遇到它 |
|--------|------|----------------------|
| 进程调度 | 进程创建、调度、终止 | `ps`、`top`、CPU 占用排查 |
| 内存管理 | 虚拟内存、页面交换、内存分配 | `free`、OOM Killer 杀进程 |
| 文件系统 | VFS 抽象层、具体文件系统实现 | 挂载、`df`、inode 耗尽 |
| 网络协议栈 | TCP/IP 协议实现 | `ss`、抓包、连接状态 |
| 设备驱动 | 硬件设备的软件接口 | `lsmod`、新硬件不识别 |
| 安全模块 | SELinux、AppArmor、capabilities | "权限对却拒绝访问"类报错 |

**在三系上验证**。`uname -r` 输出的内核版本在三系上形态各异，但它们都来自同一个上游项目：

```bash
# Ubuntu 24.04 LTS
$ uname -r
6.8.0-45-generic
# Rocky Linux 9.4
$ uname -r
5.14.0-427.13.1.el9_4.x86_64
# Arch Linux（滚动更新，版本号随升级变化）
$ uname -r
6.8.9-arch1-1
```

注意 Rocky 的输出里带着 `.el9_4`——这是 Red Hat 系给自家内核加的构建标记，一眼就能看出"这个内核为 EL9 定制过"。Arch 的输出则是 `arch1` 标记，且每次 `sudo pacman -Syu` 升级内核后数字都会变。再看编译这些内核的元信息：

```bash
$ cat /proc/version
Linux version 6.8.0-45-generic (buildd@lcy02-amd64-116) (x86_64-linux-gnu-gcc-13)
#45-Ubuntu SMP PREEMPT_DYNAMIC ... GNU/Linux
```

`/proc/version` 是内核在运行时生成的虚拟文件，不是磁盘上编辑出来的配置——这一点正是"一切皆文件"的体现（详见[技术概论](../overview.md)）。

### 1.2 操作系统

你安装、登录、每天敲命令的那个东西，远不止内核。一个可用的操作系统 = **内核 + 用户空间工具 + 系统库 + 包管理系统 + 配置框架**。从外到内大致是四层：应用软件与桌面环境 → 包管理与配置框架 → 系统库（glibc、openssl）→ 内核。内核只占最底下一层，上面每一层都可以独立更换而不必重编内核——这正是发行版得以百花齐放的结构基础。

这个区分有实际意义：**内核版本相同，操作系统可以完全不同**。Ubuntu 和 Debian 可能跑着同一个 `6.8` 内核，但一个装着 GNOME 46 和 `snap`，另一个默认是 Xfce 和纯 APT 仓库；反过来，同一个 Ubuntu 上换内核（比如装 HWE 内核）则完全不改变你已有的用户空间。理解了这一层，你就能明白为什么"升级内核"和"升级系统"是两件不同的事，也能理解发行版升级（如 Ubuntu 22.04 → 24.04）到底在换什么。

## 2. GNU 与 Linux

### 2.1 GNU 项目

1983 年，Richard Stallman 发起 GNU（GNU's Not Unix）项目，目标是创建一个完全自由的类 Unix 操作系统。**动机来自真实挫折**：当时实验室的打印机驱动源代码被厂商以商业机密为由拒绝提供，Stallman 无法修复一个反复卡纸的 bug，由此认定"用户没有源代码就永远受制于人"，决定用自由软件重建整个系统。

到 1991 年，GNU 已完成大部分组件：

| 组件 | 说明 | 状态 |
|------|------|------|
| GCC | GNU 编译器套件 | 已完成 |
| glibc | C 标准库 | 已完成 |
| coreutils | 基本命令（ls, cp, mv...） | 已完成 |
| Bash | Shell | 已完成 |
| Emacs | 文本编辑器 | 已完成 |
| **内核** | Hurd | **未完成** |

Hurd 基于微内核设计，技术上雄心勃勃却屡屡延期——这就是历史的缺口所在。

### 2.2 Linux 的加入

1991 年，Linus Torvalds 发布了 Linux 内核，填补了 GNU 项目缺失的最后一块拼图——**GNU 项目（用户空间工具）+ Linux 内核 = GNU/Linux 操作系统**。

换句话说：你用 `ls`、`bash`、`gcc` 时在运行 GNU 的代码，你读 `/proc`、加载模块、被内核调度时在运行 Linux 的代码。两者通过 POSIX 风格的接口咬合在一起，缺了谁都不成系统。

### 2.3 命名争议

- **GNU/Linux**：强调 GNU 项目的贡献（自由软件基金会立场）
- **Linux**：更简洁，被大多数人使用

这场争论在社区里持续多年，但对用户的实际影响几乎为零——无论你叫它什么，`uname -r` 返回的都是内核版本，`ls --version` 显示的都是 coreutils 版本。知道争议存在即可，不必站队。

```bash
# 查看 GNU 工具版本
$ ls --version | head -1
ls (GNU coreutils) 9.4
$ bash --version | head -1
GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)
```

GNU 工具版本和内核版本**各自独立演化**：同一台机器上 coreutils 可以是 9.x，内核可以是 5.14 或 6.8。看到任何"Linux 版本 = 9.4"之类的说法，都可以立刻判断它在混用两套编号体系。

## 3. 发行版的组成

一个完整的 Linux 发行版包含以下层次。**为什么要有发行版**：内核和 GNU 工具本身只是零件，普通用户不可能自己从源码编译出一套可用系统并持续跟踪安全补丁。发行版的工作就是把经过测试的内核、库、软件打包成仓库，选定一套默认配置，再提供包管理器让你一条命令完成安装与升级。

| 层次 | 说明 | 示例 |
|------|------|------|
| 内核 | 硬件抽象和资源管理 | Linux 6.8（Ubuntu）/ 5.14（Rocky）/ 滚动（Arch） |
| GNU 工具 | 基本命令和编译工具 | coreutils, bash |
| 系统库 | 程序运行的基础库 | glibc |
| 包管理 | 软件安装和更新 | APT / DNF / pacman |
| 桌面环境 | 图形用户界面（可选） | GNOME / KDE |
| 应用软件 | 用户使用的程序 | Firefox, Nginx |

**换掉一层会怎样**：把 glibc 换成 musl（如 Alpine）可得到极小的镜像，但部分闭源软件无法直接运行；把 GNOME 换成 i3 窗口管理器，内核毫无感知；把 APT 换成 pacman，你换掉的是整个发行版。理解分层之后，"某软件在我机器上装不上"这类问题就能快速定位到是包、库还是内核版本的锅。

### 3.1 三大包管理器分工

包管理层是三系差异最大、也最容易踩坑的一层。**为什么差异这么大**：包管理器与软件仓库、包格式、依赖解析器深度绑定，属于发行版的核心身份，不是可以随意互换的零件。三大阵营各自的用法：

| 操作 | Debian/Ubuntu (`apt`) | RHEL/CentOS/Rocky (`dnf`) | Arch (`pacman`) |
|------|----------------------|---------------------------|-----------------|
| 同步索引 | `sudo apt update` | `sudo dnf makecache` | `sudo pacman -Sy`（常与 `-Su` 合写） |
| 升级系统 | `sudo apt upgrade` | `sudo dnf upgrade` | `sudo pacman -Su` |
| 同步+升级 | `sudo apt full-upgrade` | `sudo dnf upgrade --refresh` | `sudo pacman -Syu` |
| 安装 | `sudo apt install nginx` | `sudo dnf install nginx` | `sudo pacman -S nginx` |
| 卸载 | `sudo apt remove nginx` | `sudo dnf remove nginx` | `sudo pacman -R nginx` |
| 搜索 | `apt search nginx` | `dnf search nginx` | `pacman -Ss nginx` |
| 查包信息 | `apt show nginx` | `dnf info nginx` | `pacman -Si nginx` |
| 查文件属于哪个包 | `dpkg -S /usr/sbin/nginx` | `rpm -qf /usr/sbin/nginx` | `pacman -Qo /usr/bin/nginx` |
| 包格式 | `.deb` | `.rpm` | `.pkg.tar.zst` |

Arch 的 `pacman` 有一处必须单独强调：**滚动更新发行版没有"先 update 索引再 upgrade"的两段式区分**，`-Syu` 是原子操作——同步仓库数据库并升级全部已装软件。只执行 `sudo pacman -Sy` 而不跟 `-Su`（社区称为 "partial upgrade"，部分升级）会导致已升级的库与未升级的软件不兼容，是 Arch 上最经典的新手事故。Arch Wiki 用醒目的篇幅警告过这一点：

```bash
# Arch：正确的日常升级姿势（一条命令，不要拆开）
$ sudo pacman -Syu
:: Synchronizing package databases...
 core is up to date
 extra                   868.7 KiB  1.63 MiB/s 00:00 [######################] 100%
:: Starting full system upgrade...
resolving dependencies...
looking for conflicting packages...

Packages (12) linux-6.8.9.arch1-1  glibc-2.39-4  ...
Total Download Size:   45.32 MiB
:: Proceed with installation? [Y/n]
```

Debian/Ubuntu 与 RHEL 系则可以安全地分两步执行（`apt update` 只是刷新索引，`apt upgrade` 才动软件），因为它们的仓库是固定版本集合，索引与已装包之间的部分升级不会破坏依赖。这个差异不是命令风格问题，而是**发布模型的直接结果**。

## 4. "一切皆文件"简述

Linux 沿用 Unix 的设计哲学，把设备、进程、网络连接等资源统统抽象成文件接口，于是 `cat /proc/meminfo` 能读内存，`ls -l /dev/sda` 能看到磁盘。由于[技术概论](../overview.md)已对这一思想做了完整展开（含资源类型对照表和示例命令），本页不再重复——只需记住核心推论：**遇到不认识的系统状态，先找它在文件系统里的位置**。想知道网卡状态，去 `/sys/class/net/`；想知道进程在干什么，去 `/proc/<pid>/`。

```bash
# 快速感受（细节见技术概论）
$ ls -la /dev/sda
brw-rw---- 1 root disk 8, 0 ... /dev/sda
$ cat /proc/1/comm
systemd
```

## 5. 查看系统信息

排障和提问前，先弄清"我在什么系统上"。这是本页最该形成肌肉记忆的一组命令：

```bash
# 内核版本（三系通用）
$ uname -r
6.8.0-45-generic

# 发行版信息（三系通用，最可靠的一手来源）
$ cat /etc/os-release
PRETTY_NAME="Ubuntu 24.04.1 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
ID=ubuntu
ID_LIKE=debian

# GNU 工具版本与主机信息
$ ls --version | head -1
ls (GNU coreutils) 9.4
$ hostnamectl | head -3
 Static hostname: ubuntu-lab
       Icon name: computer-vm
         Chassis: vm
```

三系的 `os-release` 输出形态差别很大，值得先在纸上对一遍：Debian 12 会写 `PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"`、`ID=debian`；Rocky 9.4 会写 `VERSION_ID="9.4"` 并带 `ID_LIKE="rhel centos fedora"`；Arch 则只有 `ID=arch` 和 `BUILD_ID=rolling`，**没有** `VERSION_ID`——滚动更新发行版本来就不存在"版本号"。`hostnamectl` 在三系上均可使用（Arch 需确保安装了 `systemd` 相关包，一般默认具备），RHEL 系常拿它一并查看内核与虚拟化信息。

**一个实用判断链**：`cat /etc/os-release` 看 `ID` → 确定家族（debian / rhel 系 / arch）→ 再决定用 `apt`、`dnf` 还是 `pacman`。在不确定的机器上执行任何包管理或防火墙命令之前，都先走这一步。

## 6. 常见坑与误区

1. **把内核版本当发行版版本**。`uname -r` 输出 `6.8.0-45-generic`，这**不是**"Linux 6.8 系统"的完整身份——它没告诉你这是 Ubuntu 还是 Debian。发行版版本必须查 `/etc/os-release`。向别人描述问题时两个都带上（发行版 + 内核），响应速度会快很多。

2. **把某一系的命令当成 Linux 标准**。在 Arch 上敲 `apt install` 会得到 `bash: apt: command not found`；在 Rocky 上找 PPA 会一无所获，因为那是 Debian 系的概念。反过来说，看到教程没标发行版就直接执行，是新手制造"配置损坏"的主要方式。

3. **在 Arch 上执行部分升级（`pacman -Sy 包名`）**。只刷新索引并安装单个包，会让这个包依赖的库版本与系统中其他旧软件不匹配，出现 `error while loading shared libraries` 之类的诡异错误。Arch 的正确做法永远是先 `sudo pacman -Syu` 全系统升级，再谈其他。

4. **认为"有 sudo = 一切都是 root 的问题"**。权限、SELinux/AppArmor 上下文、文件系统只读挂载，都会造成"看起来权限够却拒绝访问"。RHEL 系尤其常见：`ls -l` 显示权限没问题，实际是 SELinux 在 enforcing 模式拦截——详见[安全基础](../security.md)。

5. **混淆"内核模块"与"用户空间程序"**。`lsmod` 列出的是已加载的内核模块，`apt list --installed` 列出的是用户空间软件包，两者各有各的仓库和升级路径。给无线网卡装驱动失败时，先分清你装的东西属于哪一边。

6. **忽略 `/etc/os-release` 的 `ID_LIKE` 字段**。一些衍生版（如 Linux Mint 的 `ID_LIKE=ubuntu`）会标明自己继承自谁，这直接告诉你该参考哪一家的文档：`ID_LIKE=debian` 就查 Debian/Ubuntu 资料，而不是 RHEL 的。

## 参考资料

- GNU Project — [gnu.org](https://www.gnu.org/gnu/linux-and-gnu.html)
- The Linux Kernel Archives — [kernel.org](https://www.kernel.org/)
- Linus Torvalds 原始公告 — [groups.google.com](https://groups.google.com/g/comp.os.minix/c/dlNtH7RRrGA)
- Arch Wiki - Linux — [wiki.archlinux.org](https://wiki.archlinux.org/title/Linux)
- Arch Wiki - pacman / 部分升级警告 — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Wikipedia: GNU/Linux naming controversy — [wikipedia.org](https://en.wikipedia.org/wiki/GNU/Linux_naming_controversy)
