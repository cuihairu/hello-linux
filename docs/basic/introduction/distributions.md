# Linux 发行版简介

Linux 发行版有数百种，但主要分为两大阵营：Debian/Ubuntu 系和 RHEL/CentOS 系。本章介绍它们的特点和适用场景。

> 内容参考自各发行版官方文档和 DistroWatch，见文末参考资料。

## 学习目标

- 理解发行版的分类和特点
- 掌握 Debian/Ubuntu 和 RHEL/CentOS 两系的差异
- 学会根据需求选择合适的发行版

## 1. 发行版分类

### 1.1 按更新策略分类

| 类型 | 特点 | 代表 |
|------|------|------|
| 固定发布 | 定期发布新版本，版本间有较大变化 | Debian、Ubuntu、RHEL |
| 滚动更新 | 持续更新，无版本概念 | Arch Linux、Gentoo |

### 1.2 按用途分类

| 类型 | 特点 | 代表 |
|------|------|------|
| 桌面版 | 用户友好，预装桌面环境 | Ubuntu Desktop、Fedora Workstation |
| 服务器版 | 稳定优先，长期支持 | Ubuntu Server、RHEL、Debian |
| 最小化版 | 最小安装，按需添加 | Ubuntu Minimal、CentOS Stream |
| 安全版 | 安全测试工具 | Kali Linux、Parrot OS |
| 嵌入式版 | 资源占用小 | Alpine Linux、Buildroot |

## 2. Debian/Ubuntu 系

### 2.1 Debian

- **创立**：1993 年，Ian Murdock
- **理念**：稳定性优先，自由软件
- **发布周期**：约 2-3 年
- **支持周期**：约 5 年（LTS 更长）
- **包管理**：APT / dpkg
- **官网**：https://www.debian.org/

```bash
# 查看 Debian 版本
cat /etc/debian_version

# 更新系统
sudo apt update && sudo apt upgrade
```

**三个分支**：

| 分支 | 说明 |
|------|------|
| stable | 稳定版，适合生产环境 |
| testing | 测试版，下一个稳定版 |
| unstable | 开发版，代号 always "sid" |

### 2.2 Ubuntu

- **创立**：2004 年，Mark Shuttleworth（Canonical）
- **基础**：基于 Debian unstable
- **发布周期**：每 6 个月，偶数年 4 月发布 LTS
- **支持周期**：普通版 9 个月，LTS 5 年（可扩展至 10 年）
- **官网**：https://ubuntu.com/

```bash
# 查看 Ubuntu 版本
lsb_release -a
cat /etc/os-release
```

**版本命名规则**：

```
Ubuntu 24.04 LTS
      │    │  │
      │    │  └── Long Term Support（长期支持）
      │    └───── 04 = 4月发布
      └────────── 24 = 2024年
```

**Ubuntu 衍生版**：

| 衍生版 | 桌面环境 | 特点 |
|--------|---------|------|
| Ubuntu Desktop | GNOME | 官方默认 |
| Kubuntu | KDE | KDE 桌面 |
| Xubuntu | XFCE | 轻量级 |
| Lubuntu | LXQt | 最轻量 |
| Ubuntu MATE | MATE | 传统布局 |
| Linux Mint | Cinnamon | 用户友好 |
| Pop!_OS | GNOME | 面向开发者 |

### 2.3 两系关系

```
Debian (1993)
    ├── Ubuntu (2004)
    │   ├── Linux Mint
    │   ├── Pop!_OS
    │   ├── Kali Linux
    │   └── Elementary OS
    └── 直接使用 Debian
```

## 3. RHEL/CentOS/Fedora 系

### 3.1 RHEL（Red Hat Enterprise Linux）

- **创立**：2000 年（从 Red Hat Linux 分离）
- **理念**：企业级稳定性，商业支持
- **发布周期**：约 3 年
- **支持周期**：10 年（可扩展至 13 年）
- **包管理**：YUM/DNF / RPM
- **官网**：https://www.redhat.com/

```bash
# 查看 RHEL 版本
cat /etc/redhat-release
```

### 3.2 Fedora

- **创立**：2003 年
- **定位**：RHEL 的上游，技术前沿
- **发布周期**：每 6 个月
- **支持周期**：约 13 个月
- **官网**：https://fedoraproject.org/

```bash
# 查看 Fedora 版本
cat /etc/fedora-release
```

### 3.3 CentOS

- **创立**：2004 年
- **定位**：RHEL 的社区克隆版
- **现状**：CentOS 8 已于 2021 年底停止维护
- **替代品**：Rocky Linux、AlmaLinux

### 3.4 CentOS Stream

- **定位**：RHEL 的上游（介于 Fedora 和 RHEL 之间）
- **特点**：滚动更新，提前获得 RHEL 的新功能

### 3.5 两系关系

```
Fedora (2003)
    └── RHEL (2000)
        ├── CentOS (2004, 已转型为 CentOS Stream)
        ├── Rocky Linux (2021)
        ├── AlmaLinux (2021)
        └── Oracle Linux
```

## 4. 两系对比

### 4.1 包管理

| 操作 | Debian/Ubuntu | RHEL/CentOS/Fedora |
|------|---------------|-------------------|
| 更新源 | `apt update` | `dnf makecache` |
| 升级系统 | `apt upgrade` | `dnf upgrade` |
| 安装软件 | `apt install pkg` | `dnf install pkg` |
| 卸载软件 | `apt remove pkg` | `dnf remove pkg` |
| 搜索软件 | `apt search kw` | `dnf search kw` |
| 包格式 | .deb | .rpm |

### 4.2 系统配置

| 方面 | Debian/Ubuntu | RHEL/CentOS/Fedora |
|------|---------------|-------------------|
| 网络配置 | Netplan | NetworkManager |
| 防火墙 | ufw | firewalld |
| SELinux | 默认关闭 | 默认开启（RHEL） |
| 服务管理 | systemd | systemd |
| 默认 Shell | bash | bash |

### 4.3 软件源

| 方面 | Debian/Ubuntu | RHEL/CentOS/Fedora |
|------|---------------|-------------------|
| 官方源 | 官方仓库 | 官方仓库 |
| 第三方源 | PPA | EPEL、RPM Fusion |
| 国内镜像 | 清华、阿里、中科大 | 清华、阿里、中科大 |

## 5. 如何选择

### 5.1 按用途选择

| 用途 | 推荐 | 理由 |
|------|------|------|
| 学习入门 | Ubuntu | 资料多，社区活跃 |
| 桌面开发 | Ubuntu / Fedora | 软件新，工具丰富 |
| 企业服务器 | RHEL / Rocky Linux | 长期支持，商业保障 |
| Web 服务器 | Ubuntu Server / Debian | 稳定，软件丰富 |
| 安全测试 | Kali Linux | 预装安全工具 |
| 嵌入式 | Debian / Alpine | 轻量稳定 |

### 5.2 按经验选择

| 经验 | 推荐 | 理由 |
|------|------|------|
| 完全新手 | Ubuntu Desktop | 图形界面友好 |
| 有 Windows 经验 | Linux Mint | 界面类似 Windows |
| 想深入学习 | Debian / Fedora | 接近上游 |
| 追求极简 | Arch Linux | 从零构建 |
| 企业运维 | RHEL / Rocky Linux | 行业标准 |

### 5.3 下载地址

| 发行版 | 官方下载 | 国内镜像 |
|--------|---------|---------|
| Ubuntu | https://ubuntu.com/download | https://mirrors.tuna.tsinghua.edu.cn/ubuntu-releases/ |
| Debian | https://www.debian.org/distrib/ | https://mirrors.tuna.tsinghua.edu.cn/debian-cd/ |
| Fedora | https://fedoraproject.org/ | https://mirrors.tuna.tsinghua.edu.cn/fedora/releases/ |
| Rocky Linux | https://rockylinux.org/ | https://mirrors.tuna.tsinghua.edu.cn/rocky/ |

## 参考资料

- Debian Handbook — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Ubuntu Documentation — [help.ubuntu.com](https://help.ubuntu.com/)
- RHEL Documentation — [docs.redhat.com](https://docs.redhat.com/)
- Fedora Documentation — [docs.fedoraproject.org](https://docs.fedoraproject.org/)
- Arch Wiki - Linux — [wiki.archlinux.org](https://wiki.archlinux.org/title/Linux)
- DistroWatch — [distrowatch.com](https://distrowatch.com/)
