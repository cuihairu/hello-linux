# 选择合适的发行版

选发行版不是选"最好的"，而是选"和你的用途、维护意愿、团队环境最匹配的"。选错的代价很具体：装了 Arch 却只想拿来写作业，会陷在每次升级都要读变更日志的循环里；上了滚动更新的系统当生产服务器，会遇到某个 `pacman -Syu` 之后依赖树不兼容的夜晚；而选了过于小众的发行版，出问题时连 Stack Overflow 上都没有类似报错。本节先讲决策框架，再给可直接照抄的推荐表。

> 内容参考自 DistroWatch、各发行版官方文档与 Arch Wiki，见文末参考资料。

## 学习目标

- 理解发行版之间真正的差异点（打包格式、更新节奏、支持周期）
- 能按角色（桌面新手 / 开发者 / 服务器运维 / 学习目的）做出合理选择
- 掌握国内镜像下载与 ISO 校验方法

## 1. 三个核心差异维度

在看具体推荐之前，先理解所有发行版差异的三个根来源。它们决定了你日后 90% 的使用体验。

### 1.1 打包格式与包管理器

这决定了你日常敲什么命令、软件从哪里来：

| 家族 | 包格式 | 包管理器 | 典型命令 | 软件仓库风格 |
|------|--------|---------|---------|-------------|
| Debian/Ubuntu | `.deb` | APT / dpkg | `sudo apt install nginx` | 官方仓库 + PPA |
| Arch | `.pkg.tar.zst` | pacman | `sudo pacman -S nginx` | 官方仓库 + AUR（用户贡献） |
| RHEL/CentOS/Rocky | `.rpm` | DNF / yum | `sudo dnf install nginx` | 官方仓库 + EPEL |

三者的日常操作高度相似，但生态差异不小：**Arch 的 AUR** 是其他两家难以比拟的优势——几乎任何冷门开源项目都有社区维护的 PKGBUILD；**Ubuntu 的 PPA** 让第三方软件接入很轻量；**RHEL 系的 EPEL** 则是企业服务器扩展软件的标准来源。选发行版时，想一想你要用的软件在这三家的哪里最容易装上。

### 1.2 更新节奏

| 类型 | 代表 | 特点 | 适合 |
|------|------|------|------|
| 固定发布 + LTS | Ubuntu LTS、Debian stable、Rocky/Alma | 每 2~5 年一个大版本，期间软件版本基本冻结，安全补丁回移 | 生产服务器、不想频繁折腾 |
| 滚动更新 | Arch | 无版本号，软件永远最新，升级即升级，没有"大版本迁移" | 桌面极客、愿意跟踪上游、学习目的 |
| 快节奏固定发布 | Fedora Workstation、Ubuntu 非 LTS | 半年/九个月一版，软件较新但需要定期跨版本升级 | 桌面尝鲜、开发者 |

滚动更新的隐性成本是**你必须理解升级的连带影响**。Arch 官方明确声明不支持部分升级（partial upgrades）：只升单个包而不带依赖是未测试的状态，出问题不在支持范围。正确姿势永远是整体升级：

```bash
# Arch：正确姿势是带 -Syu 完整升级
sudo pacman -Syu

# 错误姿势：只装一个包而不升级整个系统（官方明确不支持）
sudo pacman -S package    # 若同步数据库后直接装，等价于制造部分升级
```

而 Debian/Ubuntu/Rocky 在 LTS 周期内基本没有这个烦恼——`apt upgrade` 或 `dnf update` 就是全部。**如果你不想学习包依赖细节，固定发布 + LTS 是更省心的选择。**

### 1.3 支持周期与安全策略

- **Ubuntu LTS**：5 年标准安全维护，可选 Ubuntu Pro 延长至 10 年
- **Debian stable**：约 3 年全支持 + 2 年仅安全补丁（LTS）
- **Rocky/AlmaLinux**：对齐 RHEL，约 10 年支持——三者中最长
- **Arch**：滚动更新，无"版本支持期"概念，每个包当前版本即是支持版本

服务器选型时，支持周期直接决定你多久被迫做一次大版本迁移。10 年支持的 Rocky 和 5 年的 Ubuntu LTS，运维节奏完全不同。

## 2. 快速决策

把上面三个维度收敛成一张决策表：

```text
你是谁？→ 选什么？
─────────────────────────────────────────
学生/新手        → Ubuntu Desktop LTS
开发者           → Ubuntu LTS / Fedora Workstation
企业服务器       → Rocky Linux / AlmaLinux / Debian
个人 VPS 小项目  → Debian minimal / Ubuntu Server
容器/云原生       → Ubuntu Server（K8s/Docker 生态一等公民）
喜欢折腾/学原理   → Arch Linux
老电脑（<4GB内存）→ Xubuntu / Lubuntu / Debian minimal
安全测试         → Kali Linux（不建议当日常系统）
```

注意最后两行的措辞：轻量桌面选 Xubuntu/Lubuntu 是因为 Xfce/LXQt 桌面环境本身省资源，而非发行版"更瘦"；Kali 是为渗透测试场景定制的发行版，预装大量安全工具且默认配置偏激进，**不适合当日常学习或生产系统**——学 Linux 基础用 Kali 反而会被它的定制行为干扰。

## 3. 桌面用户推荐

| 需求 | 推荐 | 理由 | 代价 |
|------|------|------|------|
| 刚接触 Linux | Ubuntu LTS | 资料最多、社区最活跃、硬件兼容性好 | Canonical 会推自家 Snap 商店，介意者可换 Debian |
| 电脑配置较低 | Xubuntu / Lubuntu | Xfce / LXQt 桌面占用低 | 软件默认版本偏旧 |
| 喜欢折腾、学原理 | Arch Linux | 从零构建，理解分区/引导/包管理全链路；AUR 生态丰富 | 滚动更新需自己承担升级风险，无官方技术支持 |
| 追求软件最新又不想全滚 | Fedora Workstation | 上游技术激进（Wayland、Btrfs 试点），半年一版 | 需要定期跨版本升级，支持期仅约 13 个月 |
| 想要 macOS 式体验 | Ubuntu + GNOME | GNOME 手势/工作区接近 macOS | GNOME 内存占用较高 |

**Arch 特别说明**：Arch 适合两类人——想通过"亲手装一遍"真正理解 Linux 启动链路的学习者，以及愿意持续跟踪上游、需要 AUR 里某个冷门软件的开发者。如果你只是想"快点用上 Linux 写代码"，Ubuntu/Fedora 会让你少走很多弯路。Arch 官方 Wiki 质量极高，即使最终不装 Arch，把它当参考手册读也极有价值。

## 4. 服务器用户推荐

| 需求 | 推荐 | 理由 |
|------|------|------|
| 企业生产、要求长期稳定 | Rocky Linux / AlmaLinux | RHEL 兼容、10 年支持、与 CentOS 同源的免费方案（CentOS 8 已于 2021 年底停止） |
| 追求极致稳定、不追新软件 | Debian stable | 社区驱动、无商业绑定、Docker 基础镜像主流之一 |
| 个人项目、快速起步 | Ubuntu Server LTS | 文档多、云厂商镜像全、云原生工具链默认支持好 |
| 容器 / Kubernetes | Ubuntu Server | Docker、kubeadm、各云厂商节点镜像对 Ubuntu 支持最完整 |
| 想学"最裸的 Linux" | Arch（服务器版安装） | 可控性最高，但需自行解决所有运维细节 |

**CentOS 的位置**需要澄清：经典的 CentOS Linux 已于 2021 年底终止，继任者 CentOS Stream 是 RHEL 的上游开发分支（"滚动的、比 RHEL 早看到变更"），定位与过去的 CentOS（RHEL 下游复刻、更稳定）相反。企业场景的等价替代是 Rocky Linux 或 AlmaLinux——两者都是从 RHEL 源码重建的下游发行版，二选一皆可，没有实质优劣之分。

## 5. 下载与校验

确定发行版后，从官网或国内镜像站下载 ISO。直接下官网在跨国链路上经常跑不满带宽，用教育网镜像能快很多：

| 发行版 | 官网 | 国内镜像（清华大学 TUNA） |
|--------|------|--------------------------|
| Ubuntu | https://ubuntu.com/download | https://mirrors.tuna.tsinghua.edu.cn/ubuntu-releases/ |
| Debian | https://www.debian.org/distrib/ | https://mirrors.tuna.tsinghua.edu.cn/debian-cd/ |
| Rocky | https://rockylinux.org/download | https://mirrors.tuna.tsinghua.edu.cn/rocky/ |
| Arch | https://archlinux.org/download/ | https://mirrors.tuna.tsinghua.edu.cn/archlinux/iso/ |
| Fedora | https://fedoraproject.org/workstation/download | https://mirrors.tuna.tsinghua.edu.cn/fedora/ |

**下载后务必校验**——损坏的 ISO 可能导致安装到一半失败，甚至写入错误的系统状态。以 Ubuntu 24.04 为例：

```bash
# 下载与 ISO 同目录的官方 SHA256SUMS 后校验
sha256sum -c SHA256SUMS 2>&1 | grep ubuntu
# 输出应为 ubuntu-24.04.2-desktop-amd64.iso: OK
# 若只有哈希值可手动比对：
sha256sum ubuntu-24.04.2-desktop-amd64.iso
```

Arch 的 ISO 还提供 GPG 签名验证（`archlinux-*.iso.sig`），用发布者公钥验证能防篡改，命令见 Arch Wiki 的 [Installation guide](https://wiki.archlinux.org/title/Installation_guide#Download_and_verify)。多数新手跳过校验，但当你用这个 U 盘装了三台机器之后就会明白：花两分钟校验，比装到 90% 报错省一小时。

## 6. 常见误区

- **误区：发行版越多越好，多装几个对比。** 实际：同时维护多个发行版会让你的配置文件（shell、vim、tmux）散落各处，不如先在一个发行版上深入。
- **误区：Arch 更"高级"，所以该从 Arch 开始学。** 实际：Arch 教的是"组装"，Ubuntu/Debian 教的是"使用"。多数人需要的是后者；等你能读懂 `pacman -Syu` 的输出时，随时可以转 Arch。
- **误区：新版本一定比旧版本好。** 实际：LTS 的价值恰恰在于"不追新"。生产环境追新 = 主动给自己制造兼容性问题。
- **误区：Kali 适合当学习用的 Linux。** 实际：Kali 面向渗透测试从业者，工具链与默认用户（kali/kali）配置不适合通用学习，学基础请用 Ubuntu 或 Debian。
- **误区：CentOS 还能继续用。** 实际：CentOS Linux 8 已于 2021-12-31 停止，CentOS 7 已于 2024-06-30 EOL。新装请选 Rocky/Alma 或 CentOS Stream（注意 Stream 定位不同）。

## 参考资料

- [DistroWatch](https://distrowatch.com/) — 发行版热度与基本信息查询
- [Ubuntu 下载](https://ubuntu.com/download)
- [Debian 下载](https://www.debian.org/distrib/)
- [Rocky Linux 下载](https://rockylinux.org/download)
- [Arch Linux 下载](https://archlinux.org/download/)
- [Arch Wiki - Arch Linux](https://wiki.archlinux.org/title/Arch_Linux) — 理解 Arch 设计哲学
- [鸟哥的私房菜 - 选择合适的 Linux 发行版](https://linux.vbird.org/linux_basic/centos7/0110whatislinux.php)
