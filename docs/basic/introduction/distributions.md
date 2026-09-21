# Linux 发行版简介

## 学习目标

- 理解 Linux 发行版的概念
- 掌握 Debian/Ubuntu 和 RHEL/CentOS/Fedora 两系的特点
- 学会选择适合自己的发行版

## 1. 什么是发行版

Linux 发行版（Distribution）是在 Linux 内核基础上，集成了各种软件包、工具和配置的完整操作系统。

一个典型的发行版包含：
- **Linux 内核**：系统的核心
- **GNU 工具**：基本的命令行工具
- **包管理系统**：软件的安装、更新和卸载
- **桌面环境**：图形用户界面（可选）
- **预装软件**：常用的应用程序

## 2. 两大主流系列

### 2.1 Debian/Ubuntu 系列

#### Debian

- **特点**：稳定性优先，软件包经过严格测试
- **包管理**：APT（Advanced Package Tool）
- **包格式**：.deb
- **适用场景**：服务器、追求稳定的用户
- **官网**：https://www.debian.org/

```bash
# Debian 版本
cat /etc/debian_version

# 更新软件源
sudo apt update

# 升级系统
sudo apt upgrade
```

#### Ubuntu

- **特点**：基于 Debian，用户友好，社区活跃
- **发布周期**：每 6 个月一个常规版本，每 2 年一个 LTS 版本
- **适用场景**：桌面、服务器、开发
- **官网**：https://ubuntu.com/

```bash
# Ubuntu 版本
lsb_release -a

# 或
cat /etc/os-release
```

#### 其他衍生版

| 发行版 | 基于 | 特点 |
|--------|------|------|
| Linux Mint | Ubuntu | 适合新手，界面友好 |
| Kali Linux | Ubuntu | 安全测试专用 |
| Pop!_OS | Ubuntu | 面向开发者和创作者 |
| Elementary OS | Ubuntu | 注重设计美学 |
| Deepin | Debian | 国产发行版，界面美观 |

### 2.2 RHEL/CentOS/Fedora 系列

#### RHEL（Red Hat Enterprise Linux）

- **特点**：企业级发行版，商业支持
- **包管理**：YUM/DNF
- **包格式**：.rpm
- **适用场景**：企业服务器、关键业务系统
- **官网**：https://www.redhat.com/

```bash
# RHEL 版本
cat /etc/redhat-release

# 或
rpm -q redhat-release
```

#### CentOS

- **特点**：RHEL 的社区克隆版（已转向 CentOS Stream）
- **现状**：CentOS 8 已停止维护，CentOS Stream 成为 RHEL 的上游
- **替代品**：Rocky Linux、AlmaLinux

#### Fedora

- **特点**：RHEL 的上游，技术前沿
- **发布周期**：每 6 个月一个新版本
- **适用场景**：开发者、技术爱好者
- **官网**：https://fedoraproject.org/

#### 其他衍生版

| 发行版 | 基于 | 特点 |
|--------|------|------|
| Rocky Linux | RHEL | CentOS 的替代品 |
| AlmaLinux | RHEL | CentOS 的替代品 |
| Oracle Linux | RHEL | Oracle 公司支持 |
| Amazon Linux | RHEL/CentOS | AWS 优化 |

## 3. 两系对比

| 特性 | Debian/Ubuntu | RHEL/CentOS/Fedora |
|------|---------------|-------------------|
| 包管理 | APT | YUM/DNF |
| 包格式 | .deb | .rpm |
| 软件源 | 丰富，更新快 | 稳定，经过测试 |
| 配置方式 | 配置文件分散 | 集中管理 |
| 适用场景 | 桌面、开发 | 企业服务器 |
| 社区支持 | Ubuntu 社区活跃 | Red Hat 商业支持 |

## 4. 如何选择

### 4.1 按用途选择

- **学习 Linux**：Ubuntu（资料多，社区活跃）
- **企业服务器**：RHEL 或 Rocky Linux
- **开发环境**：Ubuntu 或 Fedora
- **嵌入式开发**：Debian（稳定）

### 4.2 按经验选择

- **新手**：Ubuntu 或 Linux Mint
- **有经验**：Debian 或 Fedora
- **专家**：Arch Linux 或 Gentoo

## 参考资料

- [鸟哥的私房菜 - Linux 发行版](https://linux.vbird.org/linux_basic/0110whatislinux.php#distributions)
- [Arch Wiki - Distribution](https://wiki.archlinux.org/title/Distribution)
- [DistroWatch](https://distrowatch.com/)
