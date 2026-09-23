# Linux 发行版简介

Linux 发行版有数百种，但对绝大多数使用场景，真正需要认真考虑的是三大阵营：**Debian/Ubuntu 系**（APT、`.deb`）、**RHEL/CentOS/Rocky 系**（DNF、`.rpm`）、**Arch 系**（`pacman`、滚动更新）。本章介绍它们的来龙去脉、包管理差异和适用场景——这不是简单的"哪个更好"的排名，而是"什么节奏匹配你的需求"的匹配问题。在一台要求五年不中断的生产服务器上追新内核，和在一台每天折腾的个人机上锁死三年前的软件版本，都会带来真实的痛苦。选型做对了，后面所有章节的操作都能对号入座；选错了，你将一直与自己的工具链搏斗。

> 内容参考自各发行版官方文档、Arch Wiki 和 DistroWatch，见文末参考资料。

## 学习目标

- 理解发行版的分类维度（发布模型、用途）及其背后的运维含义
- 掌握 Debian/Ubuntu、RHEL 系、Arch 三大家族的特点、谱系与包管理差异
- 能在真实终端上区分三系并执行对应的软件安装/升级操作（`apt` / `dnf` / `pacman`）
- 学会根据用途与经验选择发行版，并识别常见选型误区

## 1. 发行版分类

### 1.1 按更新策略分类

| 类型 | 特点 | 代表 | 运维含义 |
|------|------|------|----------|
| 固定发布 | 定期发布新版本，版本间有较大变化 | Debian、Ubuntu、RHEL | 升级要走大版本迁移流程，日常以安全补丁为主 |
| 滚动更新 | 持续更新，无版本号概念 | Arch Linux、Gentoo | 需要定期（通常每周）做完整升级，否则越拖越难升 |

**为什么这是最重要的分类维度**：它决定了你未来的日常动作。固定发布系的日常是"等新 LTS 再迁移"，滚动更新系的日常是"这周先 `pacman -Syu` 再干活"。下面这段真实输出能直观看到两种模型的差别：

```bash
# Ubuntu 24.04（固定发布）：列出可升级的包，数量有限且受控
$ apt list --upgradable 2>/dev/null | head -5
Listing...
linux-image-6.8.0-45-generic/noble-updates 6.8.0-45.45 amd64 [upgradable from: 6.8.0-44.44]
...

# Arch（滚动更新）：升级前先看"这次要动多少东西"
$ pacman -Qu | wc -l        # 统计待升级包数量
27
$ sudo pacman -Syu          # 标准做法：一条命令完成同步+升级
:: Synchronizing package databases...
 core is up to date
 extra                    1785.4 KiB  3.12 MiB/s 00:00 [######################] 100%
:: Starting full system upgrade...
resolving dependencies...
looking for conflicting packages...

Packages (9) glibc-2.39-4  linux-6.8.9.arch1-1  ...

Total Download Size:  12.40 MiB
:: Proceed with installation? [Y/n]
```

### 1.2 按用途分类

| 类型 | 特点 | 代表 |
|------|------|------|
| 桌面版 | 用户友好，预装桌面环境 | Ubuntu Desktop、Fedora Workstation |
| 服务器版 | 稳定优先，长期支持 | Ubuntu Server、RHEL、Debian |
| 最小化版 | 最小安装，按需添加 | Ubuntu Minimal、Debian netinst、CentOS Stream Minimal |
| 安全版 | 预装安全测试工具 | Kali Linux、Parrot OS |
| 嵌入式版 | 资源占用小 | Alpine Linux、Buildroot、OpenWrt |

同一内核可以服务从路由器到超算的跨度，差别全在用户空间的裁剪与预装策略——这是"发行版"三个字的字面含义：把内核**发行**出去时附带的整套配套。

## 2. Debian/Ubuntu 系

### 2.1 Debian

- **创立**：1993 年，Ian Murdock
- **理念**：稳定性优先、自由软件、社区治理
- **发布周期**：约 2-3 年一个 stable
- **支持周期**：由安全团队提供（历史上的 LTS 由单独项目延续，官方当前策略见其官网）
- **包管理**：APT / dpkg，包格式 `.deb`
- **官网**：https://www.debian.org/

Debian 在三大家族里以"保守得令人安心"著称：进入 stable 的软件版本基本冻结，只接受安全与重要修复。代价是仓库里的软件往往比上游旧一年半载——想用新工具，要么等 Ubuntu/Fedora 那样的快节奏发行版，要么自行使用 backports 或容器。

```bash
# 查看 Debian 版本（返回如 12.7 的版本号）
$ cat /etc/debian_version
12.7

# 更新索引 && 升级已装软件
$ sudo apt update
Hit:1 http://deb.debian.org/debian bookworm InRelease
Get:2 http://security.debian.org/debian-security bookworm-security InRelease [48.0 kB]
...
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
12 packages can be upgraded. Run 'apt list --upgradable' to see them.

$ sudo apt upgrade
Reading package lists... Done
Building dependency tree... Done
Calculating upgrade... Done
The following packages will be upgraded:
  ...
```

**三个分支**：

| 分支 | 说明 |
|------|------|
| stable | 稳定版，代号如 `bookworm`，适合生产环境 |
| testing | 测试版，下一个稳定版的候选 |
| unstable | 开发版，代号永远是 `sid` |

三者的取舍很直白：stable 求稳，sid 求新，testing 是中间态。普通用户和服务器应停留在 stable；只有明确知道自己在做什么的人，才应该把日常系统指向 sid。

### 2.2 Ubuntu

- **创立**：2004 年，Mark Shuttleworth（Canonical）
- **基础**：基于 Debian unstable 整合
- **发布周期**：每 6 个月，偶数年 4 月发布 LTS
- **支持周期**：普通版 9 个月，LTS 5 年（可付费扩展至 10 年）
- **包管理**：APT / dpkg，另引入 snap 作为补充打包格式
- **官网**：https://ubuntu.com/

```bash
# 查看 Ubuntu 版本
$ lsb_release -a
No LSB modules are available.
Distributor ID:	Ubuntu
Description:	Ubuntu 24.04.1 LTS
Release:	24.04
Codename:	noble

$ cat /etc/os-release | head -3
PRETTY_NAME="Ubuntu 24.04.1 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
```

**版本命名规则**：

```text
Ubuntu 24.04 LTS
      │    │  │
      │    │  └── Long Term Support（长期支持）
      │    └───── 04 = 4月发布
      └────────── 24 = 2024年
```

为什么 LTS 是默认推荐：普通版只支持 9 个月，意味着你每半年就要做一次系统迁移；LTS 给你两年一个迁移窗口，插件与第三方仓库也更愿意跟进支持 LTS。服务器和不想折腾的桌面用户，认准 LTS 即可。

**Ubuntu 衍生版**：

| 衍生版 | 桌面环境 | 特点 |
|--------|---------|------|
| Ubuntu Desktop | GNOME | 官方默认 |
| Kubuntu | KDE Plasma | KDE 桌面 |
| Xubuntu | XFCE | 轻量级 |
| Lubuntu | LXQt | 最轻量 |
| Ubuntu MATE | MATE | 传统布局 |
| Linux Mint | Cinnamon | 用户友好，适合从 Windows 迁移 |
| Pop!_OS | GNOME | 面向开发者，显卡切换友好 |

衍生版的价值在于"预配置"：底层仍是 Ubuntu 的 APT 仓库，你换到的主要是默认桌面、驱动策略和少量自有工具。这意味着 Debian/Ubuntu 系的经验在这些衍生版上几乎 100% 迁移。

### 2.3 家谱

```text
Debian (1993)
    ├── Ubuntu (2004)
    │   ├── Linux Mint
    │   ├── Pop!_OS
    │   ├── Kali Linux
    │   └── Elementary OS
    └── 直接使用 Debian
```

## 3. RHEL/CentOS/Rocky 系

### 3.1 RHEL（Red Hat Enterprise Linux）

- **创立**：2000 年（从 Red Hat Linux 分离出商业产品线）
- **理念**：企业级稳定性、认证生态、商业订阅支持
- **发布周期**：约 3 年一个大版本
- **支持周期**：10 年（可扩展）
- **包管理**：DNF / RPM（历史上为 YUM），包格式 `.rpm`
- **官网**：https://www.redhat.com/

RHEL 的价值不在软件新旧，而在**可预期性**：内核与关键组件长期只收补丁不换代，大量商业软件（数据库、虚拟化、安全产品）以它为认证基准，运维团队的自动化脚本也因此可以多年不变。这也是为什么"企业服务器"推荐表里它总是常客。

```bash
# 查看 RHEL/Rocky 版本
$ cat /etc/redhat-release
Rocky Linux release 9.4 (Blue Onyx)

# 安装软件（DNF 是 YUM 的下一代实现，命令高度兼容）
$ sudo dnf install -y nginx
Last metadata expiration check: 0:00:42 ago on Tue 17 Sep 2024 10:12:01 AM CST.
Dependencies resolved.
===============================================================================
 Package       Arch        Version              Repository      Size
===============================================================================
Installing:
 nginx         x86_64      1.20.1-9.el9         appstream       56 k
...

Complete!
```

### 3.2 Fedora

- **创立**：2003 年
- **定位**：RHEL 的上游试验场，技术前沿
- **发布周期**：每 6 个月
- **支持周期**：约 13 个月
- **官网**：https://fedoraproject.org/

```bash
$ cat /etc/fedora-release
Fedora Linux 40 (Workstation Edition)
```

Fedora 与 RHEL 的关系是"提案—孵化—毕业"：新特性先在 Fedora 验证，成熟后进入 RHEL。对个人开发者，Fedora 意味着较新的工具链又不至于像滚动发行版那样随时可能破坏环境。

### 3.3 CentOS 与 CentOS Stream

- **CentOS**：2004 年诞生，对 RHEL 源码去品牌化重建，曾是"免费 RHEL"的代名词
- **转折**：2020 年底 Red Hat 宣布 CentOS 8 提前终止（原定 2029 年），CentOS 8 于 **2021 年底**停止维护
- **现状**：CentOS 项目重心转向 **CentOS Stream**——位于 RHEL **上游**、介于 Fedora 与 RHEL 之间的滚动发行版
- **下游替代**：需要"RHEL 兼容下游"的社区选择是 **Rocky Linux** 与 **AlmaLinux**（均于 2021 年成立）

CentOS Stream 不是 CentOS 的改名延续，而是**方向反了**：旧 CentOS 是 RHEL 发布后的重建（下游），Stream 是 RHEL 开发的预览（上游）。还在按"CentOS = 免费 RHEL"理解的人，会在选型时做出过时的判断——这是当前最常见的历史遗留误区之一。

### 3.4 家谱

```text
Fedora (2003, 上游试验)
    └── RHEL (2000, 商业产品)
        ├── CentOS Stream (上游滚动, 原 CentOS 已转型)
        ├── Rocky Linux (2021, 下游重建)
        ├── AlmaLinux (2021, 下游重建)
        └── Oracle Linux (下游重建)
```

## 4. Arch Linux 系

### 4.1 定位与哲学

- **创立**：2002 年，Judd Vinet
- **理念**：极简主义、用户自主、KISS（Keep It Simple, Stupid）
- **发布模型**：**滚动更新**，`/etc/os-release` 中没有 `VERSION_ID`，只有 `BUILD_ID=rolling`
- **包管理**：`pacman`，包格式 `.pkg.tar.zst`
- **官网**：https://archlinux.org/

Arch 常被贴上"高手专属"的标签，其实它更准确的定位是**教学系统**：安装过程要求你亲手分区、挂载、配引导、装 `pacman` 引导出的基础系统，等于把发行版的组装过程在你面前拆开演示一遍。Arch Wiki 对这些步骤的文档质量极高，以至于 Debian 和 RHEL 用户也经常去查——这是 Arch 对整个 Linux 社区最大的隐性贡献。

```bash
$ cat /etc/os-release
NAME="Arch Linux"
PRETTY_NAME="Arch Linux"
ID=arch
BUILD_ID=rolling
HOME_URL="https://archlinux.org/"
DOCUMENTATION_URL="https://wiki.archlinux.org/"
```

### 4.2 pacman 实战

`pacman`（package manager 的缩写）是 Arch 的唯一官方包管理器。命令以单字母选项组合，`-S`（sync，从仓库同步）是最高频入口：

```bash
# 日常完整升级：同步数据库 + 升级全部软件，一条命令不可拆
$ sudo pacman -Syu
:: Synchronizing package databases...
 core                    156.5 KiB   412 KiB/s 00:00 [######################] 100%
 extra                   868.7 KiB  1.63 MiB/s 00:00 [######################] 100%
:: Starting full system upgrade...
resolving dependencies...
looking for conflicting packages...

Packages (3) linux-firmware-20240809-1  nginx-1.26.2-1  ...

Total Download Size:    4.15 MiB
Total Installed Size:  18.32 MiB
Net Upgrade Size:       0.45 MiB

:: Proceed with installation? [Y/n] y
(3/3) checking keys in keyring               [######################] 100%
(3/3) checking package integrity             [######################] 100%
(3/3) loading package files                  [######################] 100%
(3/3) checking for file conflicts            [######################] 100%
(3/3) checking available disk space          [######################] 100%
:: Processing package changes...
(1/3) upgrading linux-firmware               [######################] 100%
(2/3) upgrading nginx                        [######################] 100%
(3/3) upgrading linux                        [######################] 100%
```

常用操作一览（对照记，右列是 APT/DNF 的对应物）：

| 操作 | Arch (`pacman`) | Debian/Ubuntu | RHEL/Rocky |
|------|-----------------|---------------|------------|
| 完整升级 | `sudo pacman -Syu` | `sudo apt update && sudo apt upgrade` | `sudo dnf upgrade --refresh` |
| 安装 | `sudo pacman -S nginx` | `sudo apt install nginx` | `sudo dnf install nginx` |
| 卸载 | `sudo pacman -R nginx` | `sudo apt remove nginx` | `sudo dnf remove nginx` |
| 同时清配置卸载 | `sudo pacman -Rns nginx` | `sudo apt purge nginx` | `sudo dnf remove nginx` |
| 搜索仓库 | `pacman -Ss nginx` | `apt search nginx` | `dnf search nginx` |
| 搜已安装 | `pacman -Qs nginx` | `apt list --installed \| grep nginx` | `dnf list installed \| grep nginx` |
| 查看包信息 | `pacman -Si nginx` | `apt show nginx` | `dnf info nginx` |
| 查文件归属 | `pacman -Qo /usr/bin/nginx` | `dpkg -S /usr/bin/nginx` | `rpm -qf /usr/bin/nginx` |
| 清理缓存 | `sudo pacman -Scc` | `sudo apt clean` | `sudo dnf clean all` |

几个只有 Arch 才需要刻在脑子里的细节：

1. **`-Syu` 不要拆**。`sudo pacman -Sy 包名` 只刷新索引并安装单个包，会让新包依赖的新版库与系统里其余旧软件不匹配，引发 `error while loading shared libraries` 类故障——这在 Arch 社区被称为"部分升级"（partial upgrade），属于明确不支持的操作。正确姿势永远是先完整升级。
2. **`-Ss` 与 `-Qs` 要分清**。`-S` 系列查**仓库**，`-Q` 系列查**本地已装数据库**。刚装完系统 `pacman -Ss` 能搜到但 `-Qs` 搜不到，是正常现象，不代表安装失败（用 `pacman -Qi` 看详情）。
3. **AUR 不是 `pacman` 的一部分**。Arch User Repository 里是社区维护的构建脚本（PKGBUILD），`pacman` 不会直接安装它，需要 `yay`、`paru` 这类 AUR 助手。把 AUR 当官方仓库信任，等于放弃发行版的质量把关——这是 Arch 选型时必须知道的责任边界。
4. **内核升级后要更新引导**。Arch 单独维护 `/boot` 下的内核镜像，重大内核升级后若使用 GRUB，通常需要 `sudo grub-mkconfig -o /boot/grub/grub.cfg`（或对应 EFI 路径）。RHEL/Ubuntu 一般会自动处理，这是操作习惯上的真实差异。

### 4.3 Arch 的适用与不适用

- **适合**：想彻底理解系统组装过程的学习者、追求极简与最新软件的个人机、愿意每周花十分钟做完整升级的用户
- **不适合**：要求三年不动的生产服务器（官方明确不提供长期支持的稳定分支）、不打算碰命令行的桌面新手、依赖商业认证软件的企业环境

## 5. 三系横向对比

### 5.1 包管理

| 操作 | Debian/Ubuntu (`apt`) | RHEL/CentOS/Rocky (`dnf`) | Arch (`pacman`) |
|------|----------------------|---------------------------|-----------------|
| 更新源索引 | `apt update` | `dnf makecache` | `pacman -Sy`（通常并入 `-Syu`） |
| 升级系统 | `apt upgrade` / `full-upgrade` | `dnf upgrade` | `pacman -Su`（并入 `-Syu`） |
| 安装软件 | `apt install pkg` | `dnf install pkg` | `pacman -S pkg` |
| 卸载软件 | `apt remove pkg` | `dnf remove pkg` | `pacman -R pkg` |
| 搜索软件 | `apt search kw` | `dnf search kw` | `pacman -Ss kw` |
| 包格式 | `.deb` | `.rpm` | `.pkg.tar.zst` |
| 底层工具 | `dpkg` | `rpm` | `pacman` 一体 |

### 5.2 系统配置

| 方面 | Debian/Ubuntu | Arch | RHEL/CentOS/Fedora |
|------|---------------|------|-------------------|
| 网络配置 | Netplan（`/etc/netplan/*.yaml`） | 通常 `systemd-networkd` 或 NetworkManager | NetworkManager / ifcfg 脚本 |
| 防火墙 | `ufw`（底层 iptables/nftables） | 无默认，自行选 `nftables`/`iptables` | `firewalld` |
| 强制访问控制 | AppArmor（默认开启） | 默认未配置 | SELinux（RHEL 默认 **enforcing**） |
| 服务管理 | systemd | systemd | systemd |
| 默认 Shell | bash | bash | bash |
| 配置风格 | 官方集成、有 `debconf` 问答回放 | 手写配置文件为主 | 官方集成，强调 `firewall-cmd`/`nmcli` 等工具 |

表中每一行都对应一类真实故障：把 RHEL 教程里的 `firewall-cmd` 跑到 Ubuntu 上会提示找不到命令；在 Rocky 上遇到"权限对却 502"，第一嫌疑人常是 SELinux 而不是应用本身；Arch 上网络不通，先确认你到底配了 `systemd-networkd` 还是 NetworkManager——它俩都装着但只能一个在管事。

### 5.3 软件源

| 方面 | Debian/Ubuntu | Arch | RHEL/CentOS/Fedora |
|------|---------------|------|-------------------|
| 官方源配置 | `/etc/apt/sources.list` + `sources.list.d/` | `/etc/pacman.conf` + `/etc/pacman.d/mirrorlist` | `/etc/yum.repos.d/*.repo` |
| 第三方扩展 | PPA、backports | AUR（需 `yay`/`paru` 等助手） | EPEL、RPM Fusion |
| 国内镜像 | 清华、中科大、阿里 | 清华、中科大、archlinuxcn | 清华、中科大、阿里 |

三方源的信任模型各不相同：PPA 由个人/团队发布但有 Launchpad 打包流程，EPEL 是 Fedora 官方特别兴趣小组维护，AUR 则是用户投稿的构建脚本——**信任链条最终落到"你是否审计过 PKGBUILD"**。生产环境原则上尽量只用官方仓库加知名第三方源。

## 6. 如何选择

### 6.1 按用途选择

| 用途 | 推荐 | 理由 |
|------|------|------|
| 学习入门 | Ubuntu Desktop (LTS) | 资料最多，社区活跃，踩坑容易搜到答案 |
| 桌面开发 | Ubuntu LTS / Fedora Workstation | 工具链较新，容器生态友好 |
| 企业服务器 | RHEL / Rocky Linux / AlmaLinux | 长期支持、认证生态、可预期的升级路径 |
| Web / 通用服务器 | Ubuntu Server / Debian stable | 稳定、软件仓库丰富、文档完善 |
| 深入理解系统 | Arch Linux | 安装即教学，Arch Wiki 质量极高 |
| 安全测试 | Kali Linux | 预装安全工具（基于 Debian） |
| 嵌入式 / 极小镜像 | Alpine / Debian minimal | 体积小或生态全，按需取舍 |

### 6.2 按经验选择

| 经验 | 推荐 | 理由 |
|------|------|------|
| 完全新手 | Ubuntu Desktop LTS | 图形安装器 + 自动分区 + 默认可用的桌面 |
| 有 Windows 经验 | Linux Mint | 界面布局类似 Windows，底层仍是 Ubuntu 仓库 |
| 想深入学习 | Arch（动手型）/ Debian·Fedora（上游型） | 前者拆开给你看，后者接近上游开发节奏 |
| 追求极简 | Arch Linux | 从零构建，无强加的桌面与厂商工具 |
| 企业运维 | RHEL / Rocky Linux | 行业标准，技能可直接迁移 |

### 6.3 下载地址

| 发行版 | 官方下载 | 国内镜像 |
|--------|---------|---------|
| Ubuntu | https://ubuntu.com/download | https://mirrors.tuna.tsinghua.edu.cn/ubuntu-releases/ |
| Debian | https://www.debian.org/distrib/ | https://mirrors.tuna.tsinghua.edu.cn/debian-cd/ |
| Fedora | https://fedoraproject.org/ | https://mirrors.tuna.tsinghua.edu.cn/fedora/releases/ |
| Arch | https://archlinux.org/download/ | https://mirrors.tuna.tsinghua.edu.cn/archlinux/ |
| Rocky Linux | https://rockylinux.org/download/ | https://mirrors.tuna.tsinghua.edu.cn/rocky/ |

下载后务必校验哈希（官网提供 SHA256SUMS），这是镜像分发的基本卫生习惯：

```bash
$ sha256sum ubuntu-24.04.2-desktop-amd64.iso
f4c5431b6d4b1e4e7e3f6c8c0a9f...  ubuntu-24.04.2-desktop-amd64.iso
# 与官网公布的 SHA256 比对一致后再写入 U 盘
```

## 7. 常见坑与误区

1. **选错更新模型**。想要"五年不用管"却装了 Arch，或者想要最新工具却选了 Debian stable——两者都会在一周内让你想换系统。先回答"我多久愿意做一次系统升级、我能接受软件旧多久"，再选阵营。

2. **把 APT/DNF 的习惯平移成"Linux 标准"**。`apt update && apt upgrade` 在 Debian/Ubuntu 正确，在 Arch 上正确对应物是单条 `sudo pacman -Syu`；`sudo yum install` 到了 Arch 上直接 command not found。执行任何教程命令前，先 `cat /etc/os-release` 确认 `ID`。

3. **认为 CentOS 还是免费 RHEL**。CentOS 8 已于 2021 年底停止维护，项目转向上游的 CentOS Stream；要下游兼容请用 Rocky Linux 或 AlmaLinux。新部署照抄旧教程装 CentOS，会拿到一个不再收安全更新的系统。

4. **在 RHEL/Debian 之外的机器上找 SELinux/AppArmor 救命**。SELinux 在 RHEL 系默认 enforcing，Debian/Ubuntu 默认启用的是 AppArmor，Arch 默认两者都不配。排障时先确认"这台机器到底有没有强制访问控制在拦你"，否则会在权限位上空转半天。

5. **低估 Arch 的维护责任**。滚动更新意味着升级回归（某个包新版本破坏兼容）风险由你承担；AUR 软件的构建脚本质量参差。把 Arch 当"免维护的最新系统"装到生产机，是选型层面的错位，不是技术问题。

6. **只看"份额"和"排名"选型**。DistroWatch 的页面浏览量反映的是好奇程度，不是稳定性或适用性。服务器选型应看支持周期、认证与团队熟悉度；桌面选型看驱动与日常软件（微信、办公套件等）的可用方案。

7. **忽略国内镜像与安装介质校验**。默认源在境内往往慢到超时，`apt update`、`pacman -Sy`、`dnf makecache` 卡住会被误判为"系统坏了"；不校验哈希直接写盘，则可能把损坏镜像带来的诡异问题当成安装器 bug 排查。

## 参考资料

- Debian Handbook — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Ubuntu Documentation — [help.ubuntu.com](https://help.ubuntu.com/)
- Ubuntu LTS 生命周期 — [ubuntu.com](https://ubuntu.com/about/release-cycle)
- RHEL Documentation — [docs.redhat.com](https://docs.redhat.com/)
- Fedora Documentation — [docs.fedoraproject.org](https://docs.fedoraproject.org/)
- Rocky Linux Documentation — [docs.rockylinux.org](https://docs.rockylinux.org/)
- CentOS 项目（Stream 说明） — [centos.org](https://www.centos.org/)
- Arch Linux — [archlinux.org](https://archlinux.org/)
- Arch Wiki - pacman — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Arch Wiki - Arch as a beginner? — [wiki.archlinux.org](https://wiki.archlinux.org/title/Arch_Linux_as_a_beginner)
- AUR — [wiki.archlinux.org](https://wiki.archlinux.org/title/Arch_User_Repository)
- 清华大学开源软件镜像站 — [mirrors.tuna.tsinghua.edu.cn](https://mirrors.tuna.tsinghua.edu.cn/)
- DistroWatch — [distrowatch.com](https://distrowatch.com/)
