# 技术概论

## 学习目标

- 理解 Linux 在操作系统中的定位
- 了解 Linux 与 Unix 的关系
- 掌握 Linux 的核心组成部分

## 1. 操作系统基础

### 1.1 什么是操作系统

操作系统（Operating System, OS）是管理计算机硬件与软件资源的程序，是计算机系统的核心与基石。

主要职责：
- **进程管理**：管理程序的运行、调度和终止
- **内存管理**：分配和回收内存空间
- **文件系统**：管理磁盘上的数据存储
- **设备管理**：控制和管理硬件设备
- **用户接口**：提供用户与系统交互的界面

### 1.2 Linux 的定位

Linux 是一个**类 Unix 操作系统**，遵循 POSIX 标准，属于自由和开源软件。

与 Unix 的关系：
- Linux 受 Unix 启发，但并非 Unix 的直接派生
- Linux 遵循 Unix 的设计哲学
- 大多数 Unix 命令在 Linux 中同样适用

## 2. Linux 的核心组成

### 2.1 内核（Kernel）

内核是操作系统的核心，负责：
- 进程调度
- 内存管理
- 文件系统管理
- 设备驱动
- 网络协议栈

```bash
# 查看内核版本
uname -r
# 或
cat /proc/version
```

### 2.2 Shell

Shell 是用户与内核之间的接口，常见的 Shell 包括：
- **Bash**：大多数 Linux 发行版的默认 Shell
- **Zsh**：功能更强大的 Shell
- **Fish**：用户友好的现代 Shell

### 2.3 文件系统

Linux 采用**一切皆文件**的设计哲学：
- 普通文件
- 目录
- 设备文件
- 符号链接
- 管道和套接字

## 3. 发行版简介

### 3.1 Debian/Ubuntu 系列

- **Debian**：稳定性优先，软件包经过严格测试
- **Ubuntu**：基于 Debian，用户友好，社区活跃
- **Linux Mint**：基于 Ubuntu，适合新手
- **Kali Linux**：专注于安全测试

### 3.2 RHEL/CentOS/Fedora 系列

- **RHEL**：企业级发行版，商业支持
- **CentOS**：RHEL 的社区克隆版（已转向 CentOS Stream）
- **Fedora**：RHEL 的上游，技术前沿
- **Rocky Linux**：CentOS 的替代品

## 4. 学习路径建议

1. **入门**：熟悉基本命令和文件系统
2. **进阶**：掌握 Shell 脚本和系统管理
3. **深入**：学习内核原理和网络配置
4. **专业**：专注于特定领域（安全、运维、开发等）

## 参考资料

- [鸟哥的私房菜 - 基础篇](https://linux.vbird.org/linux_basic/)
- [Arch Wiki - General recommendations](https://wiki.archlinux.org/title/General_recommendations)
