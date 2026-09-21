# 技术概论

本章从宏观角度介绍操作系统原理和 Linux 的设计思想，为后续学习建立知识框架。

## 学习目标

- 理解操作系统的核心职责和工作原理
- 掌握 Linux 的设计哲学
- 了解内核架构和版本命名规则
- 区分 Shell、内核、文件系统的关系

## 1. 操作系统基础

### 1.1 什么是操作系统

操作系统（Operating System, OS）是管理计算机硬件与软件资源的系统软件，为上层应用程序提供统一的抽象接口。

```
┌─────────────────────────────────────┐
│            应用程序                   │  用户态
├─────────────────────────────────────┤
│            系统调用                   │  内核态
├─────────────────────────────────────┤
│   进程管理 │ 内存管理 │ 文件系统     │
│   设备驱动 │ 网络协议 │ 安全控制     │
├─────────────────────────────────────┤
│            硬件                      │
└─────────────────────────────────────┘
```

核心职责：

| 职责 | 说明 | 示例 |
|------|------|------|
| 进程管理 | 创建、调度、终止进程 | `ps`、`top` |
| 内存管理 | 分配、回收虚拟内存 | `free`、`vmstat` |
| 文件系统 | 组织和管理磁盘数据 | `df`、`mount` |
| 设备管理 | 控制硬件设备 | `/dev`、`lsmod` |
| 网络协议 | 实现网络通信 | `ip`、`ss` |
| 安全控制 | 用户权限和访问控制 | `chmod`、`SELinux` |

### 1.2 内核态与用户态

CPU 运行在两个特权级别上：

| 模式 | 权限 | 用途 |
|------|------|------|
| **内核态（Ring 0）** | 完全访问硬件 | 内核代码、驱动程序 |
| **用户态（Ring 3）** | 受限访问 | 应用程序 |

应用程序需要访问硬件时，必须通过**系统调用（System Call）**陷入内核态：

```bash
# 查看系统调用
strace ls /tmp 2>&1 | head -20

# 统计系统调用次数
strace -c ls /tmp 2>&1
```

### 1.3 中断机制

中断是 CPU 响应外部事件的机制：

- **硬件中断**：网卡收到数据、磁盘完成读写
- **软件中断**：系统调用、异常处理

```bash
# 查看中断统计
cat /proc/interrupts

# 查看软中断
cat /proc/softirqs
```

## 2. Linux 设计哲学

### 2.1 一切皆文件

Linux 将几乎所有资源抽象为文件，通过统一的文件接口操作：

| 资源类型 | 文件路径 | 说明 |
|---------|---------|------|
| 普通文件 | `/home/user/file.txt` | 存储数据 |
| 目录 | `/home/user/` | 容器 |
| 设备 | `/dev/sda`、`/dev/tty` | 硬件设备 |
| 进程 | `/proc/1/` | 进程信息 |
| 网络 | `/proc/net/` | 网络状态 |
| 管道 | `\|` | 进程间通信 |
| 套接字 | `/var/run/docker.sock` | 网络通信 |

```bash
# 一切皆文件的体现
ls -la /dev/sda        # 块设备
ls -la /dev/tty        # 终端设备
ls -la /proc/1/cmdline # 进程信息
ls -la /proc/net/tcp   # 网络连接
```

### 2.2 小工具组合

每个命令只做一件事，通过管道组合完成复杂任务：

```bash
# 统计当前登录用户数
who | wc -l

# 查找占用磁盘最多的前 5 个目录
du -sh /* 2>/dev/null | sort -hr | head -5

# 查看最近登录失败的用户
lastb | awk '{print $1}' | sort | uniq -c | sort -rn | head -10
```

### 2.3 纯文本配置

配置文件采用纯文本格式，便于版本控制和自动化管理：

```bash
# 网络配置（Ubuntu Netplan）
cat /etc/netplan/01-netcfg.yaml

# SSH 配置
cat /etc/ssh/sshd_config | grep -v "^#" | grep -v "^$"

# 用户信息
cat /etc/passwd | head -5
```

## 3. Linux 内核

### 3.1 内核架构

```
┌───────────────────────────────────────────────┐
│                   用户空间                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐         │
│  │  应用1   │ │  应用2   │ │  应用3   │         │
│  └────┬────┘ └────┬────┘ └────┬────┘         │
├───────┼──────────┼──────────┼─────────────────┤
│       │        系统调用接口     │                │
│  ┌────┴────────────────────────┴────┐         │
│  │            内核空间               │         │
│  │  ┌─────────────────────────┐     │         │
│  │  │     进程调度子系统       │     │         │
│  │  ├─────────────────────────┤     │         │
│  │  │     内存管理子系统       │     │         │
│  │  ├─────────────────────────┤     │         │
│  │  │     虚拟文件系统(VFS)    │     │         │
│  │  ├─────────────────────────┤     │         │
│  │  │     网络协议栈           │     │         │
│  │  ├─────────────────────────┤     │         │
│  │  │     设备驱动框架         │     │         │
│  │  └─────────────────────────┘     │         │
│  └──────────────────────────────────┘         │
└───────────────────────────────────────────────┘
```

### 3.2 内核子系统

| 子系统 | 职责 | 相关文件 |
|--------|------|---------|
| 进程调度 | 进程创建、调度、通信 | `/proc/sched*` |
| 内存管理 | 虚拟内存、页面交换 | `/proc/meminfo` |
| 文件系统 | VFS 抽象层、具体实现 | `/proc/filesystems` |
| 网络协议 | TCP/IP 协议栈 | `/proc/net/` |
| 设备驱动 | 硬件抽象 | `/proc/modules` |

### 3.3 内核模块

内核模块是可动态加载的内核代码：

```bash
# 查看已加载模块
lsmod

# 查看模块信息
modinfo ext4

# 加载模块
sudo modprobe vfat

# 卸载模块
sudo modprobe -r vfat
```

### 3.4 内核版本命名

```
主版本.次版本.修订版本[-稳定标记]
  6      8      0      -generic

# 例如
6.8.0-generic     # Ubuntu 24.04 默认内核
5.14.0-362.el9    # RHEL 9 默认内核
```

```bash
# 查看内核版本
uname -r

# 查看内核详细信息
uname -a

# 查看内核发布信息
cat /proc/version
```

## 4. Shell

### 4.1 什么是 Shell

Shell 是用户与内核之间的命令解释器，负责：
- 解析用户输入的命令
- 查找并执行对应程序
- 处理输入输出重定向
- 管理环境变量

### 4.2 常见 Shell 对比

| Shell | 默认发行版 | 特点 | 配置文件 |
|-------|-----------|------|---------|
| **Bash** | 大多数发行版 | 兼容性好，功能丰富 | `~/.bashrc` |
| **Zsh** | macOS、Kali | 自动补全、主题丰富 | `~/.zshrc` |
| **Fish** | — | 语法高亮、自动建议 | `~/.config/fish/` |
| **Dash** | Debian/Ubuntu `/bin/sh` | 轻量快速 | — |

```bash
# 查看当前 Shell
echo $SHELL

# 查看可用 Shell
cat /etc/shells

# 切换 Shell
chsh -s /bin/zsh
```

### 4.3 登录 Shell 与非登录 Shell

| 类型 | 触发方式 | 配置文件加载顺序 |
|------|---------|----------------|
| 登录 Shell | 终端登录、`ssh` | `/etc/profile` → `~/.bash_profile` |
| 非登录 Shell | 图形终端、`bash` | `~/.bashrc` |
| 交互式 Shell | 手动输入命令 | 加载提示符和历史 |
| 非交互式 Shell | 脚本执行 | 仅加载必要环境 |

```bash
# 判断当前 Shell 类型
shopt login_shell  # Bash
[[ -o login ]] && echo "登录 Shell"
```

## 5. Linux 与 Unix/Windows 对比

| 特性 | Linux | Unix | Windows |
|------|-------|------|---------|
| 源代码 | 开源（GPL） | 闭源（多数） | 闭源 |
| 内核 | Linux 内核 | 各厂商内核 | NT 内核 |
| 文件系统 | ext4/XFS/Btrfs | UFS/ZFS | NTFS |
| 包管理 | APT/YUM/DNG | 各厂商工具 | MSI/EXE |
| Shell | Bash/Zsh | Bourne/Korn | CMD/PowerShell |
| 权限模型 | DAC + MAC（SELinux） | DAC | ACL |
| 配置方式 | 纯文本文件 | 纯文本文件 | 注册表 |
| 适用场景 | 服务器/嵌入式/桌面 | 企业服务器 | 桌面/企业 |
| 典型成本 | 免费 | 商业授权 | 商业授权 |

## 6. 实战：查看系统信息

```bash
# 系统概览
uname -a                    # 内核信息
lsb_release -a              # 发行版信息（Debian/Ubuntu）
cat /etc/os-release         # 发行版信息（通用）
hostnamectl                 # 主机名和系统信息

# 硬件信息
lscpu                       # CPU 信息
free -h                     # 内存信息
lsblk                       # 块设备信息
lspci                       # PCI 设备
lsusb                       # USB 设备

# 内核信息
cat /proc/version           # 内核版本
cat /proc/cpuinfo           # CPU 详情
cat /proc/meminfo           # 内存详情
```

## 参考资料

- [鸟哥的私房菜 - 基础篇](https://linux.vbird.org/linux_basic/)
- [Arch Wiki - General recommendations](https://wiki.archlinux.org/title/General_recommendations)
- [The Linux Kernel documentation](https://www.kernel.org/doc/html/latest/)
- [Linux man pages](https://man7.org/linux/man-pages/)
