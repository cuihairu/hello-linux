# 什么是 Linux

"Linux" 这个词在不同语境下有不同含义：严格来说它只是内核，但在日常使用中通常指代完整的操作系统。本章厘清这些概念。

> 内容参考自 GNU 项目文档和 Linux 内核文档，见文末参考资料。

## 学习目标

- 理解内核与操作系统的区别
- 了解 GNU 项目与 Linux 的关系
- 掌握发行版的组成结构

## 1. 内核 vs 操作系统

### 1.1 内核（Kernel）

内核是操作系统的核心程序，负责管理硬件资源和提供基础服务。

```
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

| 子系统 | 功能 |
|--------|------|
| 进程调度 | 进程创建、调度、终止 |
| 内存管理 | 虚拟内存、页面交换、内存分配 |
| 文件系统 | VFS 抽象层、具体文件系统实现 |
| 网络协议栈 | TCP/IP 协议实现 |
| 设备驱动 | 硬件设备的软件接口 |
| 安全模块 | SELinux、AppArmor、capabilities |

```bash
# 查看内核版本
uname -r

# 查看内核详细信息
cat /proc/version
```

### 1.2 操作系统

操作系统 = 内核 + 用户空间工具 + 系统库 + 包管理系统 + 配置框架

```
┌─────────────────────────────────────────┐
│              操作系统                     │
│  ┌────────────────────────────────────┐ │
│  │         用户空间工具                │ │
│  │  coreutils, util-linux, procps... │ │
│  ├────────────────────────────────────┤ │
│  │         系统库                      │ │
│  │  glibc, libstdc++, openssl...      │ │
│  ├────────────────────────────────────┤ │
│  │         内核                        │ │
│  │  Linux Kernel                      │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

## 2. GNU 与 Linux

### 2.1 GNU 项目

1983 年，Richard Stallman 发起 GNU（GNU's Not Unix）项目，目标是创建一个完全自由的类 Unix 操作系统。

到 1991 年，GNU 已完成大部分组件：

| 组件 | 说明 | 状态 |
|------|------|------|
| GCC | GNU 编译器套件 | 已完成 |
| glibc | C 标准库 | 已完成 |
| coreutils | 基本命令（ls, cp, mv...） | 已完成 |
| Bash | Shell | 已完成 |
| Emacs | 文本编辑器 | 已完成 |
| **内核** | Hurd | **未完成** |

### 2.2 Linux 的加入

1991 年，Linus Torvalds 发布了 Linux 内核，填补了 GNU 项目缺失的最后一块拼图。

```
GNU 项目（用户空间工具） + Linux 内核 = GNU/Linux 操作系统
```

### 2.3 命名争议

- **GNU/Linux**：强调 GNU 项目的贡献（自由软件基金会立场）
- **Linux**：更简洁，被大多数人使用

```bash
# 查看 GNU 工具版本
ls --version        # GNU coreutils
gcc --version       # GNU Compiler Collection
bash --version      # GNU Bash

# 查看内核版本
uname -r
```

## 3. 发行版的组成

一个完整的 Linux 发行版包含以下层次：

```
┌─────────────────────────────────────────┐
│              发行版                       │
│  ┌────────────────────────────────────┐ │
│  │         应用层                      │ │
│  │  浏览器、编辑器、服务器软件...       │ │
│  ├────────────────────────────────────┤ │
│  │         桌面环境（可选）             │ │
│  │  GNOME, KDE, XFCE...              │ │
│  ├────────────────────────────────────┤ │
│  │         包管理系统                   │ │
│  │  APT (deb) / YUM/DNF (rpm)        │ │
│  ├────────────────────────────────────┤ │
│  │         系统库                      │ │
│  │  glibc, openssl, zlib...          │ │
│  ├────────────────────────────────────┤ │
│  │         GNU 工具                    │ │
│  │  coreutils, bash, gcc...          │ │
│  ├────────────────────────────────────┤ │
│  │         内核                        │ │
│  │  Linux Kernel                     │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

| 层次 | 说明 | 示例 |
|------|------|------|
| 内核 | 硬件抽象和资源管理 | Linux 6.8 |
| GNU 工具 | 基本命令和编译工具 | coreutils, bash |
| 系统库 | 程序运行的基础库 | glibc |
| 包管理 | 软件安装和更新 | APT / YUM |
| 桌面环境 | 图形用户界面（可选） | GNOME / KDE |
| 应用软件 | 用户使用的程序 | Firefox, Nginx |

## 4. "一切皆文件"

Linux 遵循 Unix 的设计哲学，将大多数资源抽象为文件接口：

```bash
# 普通文件
cat /etc/passwd

# 目录
ls /home/

# 设备文件
ls -la /dev/sda        # 块设备
ls -la /dev/tty        # 字符设备
ls -la /dev/null       # 空设备

# 进程信息
cat /proc/1/status     # PID 1 的状态
cat /proc/cpuinfo      # CPU 信息
cat /proc/meminfo      # 内存信息

# 网络
cat /proc/net/tcp      # TCP 连接

# 管道
echo "hello" | cat     # 管道是特殊的文件
```

## 5. 查看系统信息

```bash
# 内核版本
uname -r

# 发行版信息
cat /etc/os-release

# GNU 工具版本
ls --version | head -1

# 系统架构
uname -m

# 主机名
hostname
```

## 参考资料

- GNU Project — [gnu.org](https://www.gnu.org/gnu/linux-and-gnu.html)
- The Linux Kernel Archives — [kernel.org](https://www.kernel.org/)
- Linus Torvalds 原始公告 — [groups.google.com](https://groups.google.com/g/comp.os.minix/c/dlNtH7RRrGA)
- Arch Wiki - Linux — [wiki.archlinux.org](https://wiki.archlinux.org/title/Linux)
- Wikipedia: GNU/Linux naming controversy — [wikipedia.org](https://en.wikipedia.org/wiki/GNU/Linux_naming_controversy)
