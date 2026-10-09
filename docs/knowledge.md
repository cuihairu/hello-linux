# 知识点整理

研究篇用四步回答了「权威来源讲了什么、本仓覆盖了多少、差的部分怎么办」（见[知识调查总览](./research/README.md)）。这一页把四步产出收拢成一张知识点网：调研文档是取证记录，这里是取证之后值得留下的结论。每条知识点都带来源标注，分级沿用调研口径——A 级为本机实取（2026-10-08/09）、B 级为仓库既有外链核验轮的记录、查无实据的标「来源未考」。想知道一条结论是怎么查出来的，走条目里的链接回调研原文或对应页面。

## 核心概念

### 学习骨架：概念、命令、服务、排错

鸟哥两篇给出的顺序至今站得住：先建概念（磁盘、权限、进程），再逐条命令上手，然后是服务搭建，最后落到排错。本仓沿这条骨架走，改了两处——把 Debian/Ubuntu、RHEL 系、Arch 三系命令并排对照，把 CentOS 7 时代的操作坐标更新到 systemd 时代。骨架本身不挑发行版，挑的是写作时心里有没有放着另外两个发行版（来源：[权威书籍调研](./research/authoritative-books.md) §1、§3，A 级）。

### 包管理三模型

APT 按发行版节奏发布，DNF 强调事务性与依赖解析，pacman 是滚动更新，日常动作收敛为 `pacman -Syu` 一条。三系差异不在命令拼写，在更新模型：滚动发行版没有「版本号升级」这回事，也就没有大版本迁移；固定发行版反过来，跨版本要靠发行方提供的迁移工具。哪条路都得整库一起动，零散装包是乱的起点（来源：[覆盖核对与差异表](./research/coverage-matrix.md) §1 第二十二章、[Pacman 包管理](./basic/packages/pacman.md)，A 级）。

### systemd 是当前的服务坐标

单元（unit）与 cgroup 是 systemd 的两个支点：服务、挂载、定时器都是单元，进程组按 cgroup 归拢，`systemctl status` 看到的进程树因此是完整的。定时器能顶掉一部分 crontab 的活，日志进 journal。systemd.io 的设计文档与 BOOT 页是官方口径（来源：[官方文档调研](./research/official-docs.md) §3、[systemd 服务与程序管理](./system-management/services-systemd.md)，A 级）。

### 存储栈：分层是主线，XFS 不能缩

分区、RAID、LUKS、LVM、文件系统各占一层，排栈顺序决定谁能在不停机的前提下动。LVM 的价值在逻辑卷与物理盘解耦：扩容在线做，ext4 与 XFS 都能扩；缩容只有 ext4 支持，XFS 只能备份重建。快照与 `pvmove` 换盘是这套栈给的日常保险（来源：[LVM 逻辑卷管理](./system-management/lvm.md)，B 级页面 + 本轮复核）。

### 虚拟化与容器分工

KVM 是内核里的虚拟化模块，QEMU 负责设备模拟，libvirt 把两者收拢成统一的管理面，`virsh` 是这层的日常入口。容器不是虚拟机：共享内核、靠命名空间与 cgroup 做隔离，启动以毫秒计。选型的一句话判据是要不要另一颗内核——要就虚拟机，不要就容器（来源：[KVM 虚拟化](./server/virtualization/kvm.md)，B 级页面 + Arch 官方包数据核验）。

### 两套 MAC：标签与路径

SELinux 给每个对象打标签，策略围绕标签写；AppArmor 直接挂在可执行文件路径上，profile 是一段段可读的配置。RHEL 系默认 SELinux，Debian 与 SUSE 系多用 AppArmor。两套模型没有谁取代谁，运维要的是认清自己机器上跑的是哪套、日志去哪里看（来源：[覆盖核对与差异表](./research/coverage-matrix.md) §3「8.20 安全」、[AppArmor 实战](./security/apparmor.md)，B 级页面 + aa-status 实测）。

### 账号一致性：目录、缓存、接线

十台机器共享账号的解法是一台目录服务器（OpenLDAP）持有唯一真相，客户端由 SSSD 统一对接，向下走 NSS 与 PAM 两个标准接口。Kerberos 管认证、LDAP 管目录数据的分工是大规模方案（FreeIPA、Active Directory）的底座。改了目录没生效，先想客户端缓存（`sss_cache -E`），再查配置（来源：[应用场景调研](./research/application-scenarios.md) §1.4、[LDAP 统一账号管理](./server/ldap.md)，B 级页面 + RHEL 包仓库核验）。

### TLS 是生产前置条件，不是加分项

simple bind 的密码明文进网，这是协议层事实。加密两条路：ldaps（636 端口，握手起全程密文）与 StartTLS（389 端口，先明文再升级）。新部署建议 ldaps 单通道，防火墙只放 636。证书的 CN/SAN 必须与客户端实际连接用的主机名一致（来源：[LDAP 统一账号管理](./server/ldap.md) §4，B 级页面）。

### 网络命令主线换成了 iproute2

`ip` 与 `ss` 取代 ifconfig/netstat 是既成事实：新内核特性（多路由表、策略路由、网络命名空间）只在 iproute2 里有接口。老命令的输出格式还留在大量脚本与教材里，读得懂，新东西别再往上写（来源：[网络管理命令](./commands/network/network.md)，B 级页面）。

### 桌面栈是分层结构，服务器不装

从 DRM/KMS 出像素，往上分 Xorg 与 Wayland 两条显示协议路线，再往上是显示管理器、桌面环境或窗口管理器。服务器场景没有这一整层的位置，最小化安装反而少一类攻击面。桌面栈的组名与包名随大版本变动，动手前用 `dnf group list` 之类实测（来源：[应用场景调研](./research/application-scenarios.md) §1.3、[桌面图形栈](./hardware/desktop-stack.md)，A 级调研 + 页内降级复核）。

### 嵌入式的门槛在工具链与启动链

交叉编译的三元组（arch-vendor-os-libc）、`ARCH`/`CROSS_COMPILE` 两个变量、设备树描述硬件、BusyBox 拼 rootfs、U-Boot 负责引导——这条链上的每一环都和桌面机习惯不同。验证手段是 QEMU 异架构仿真加 gdb-multiarch 远程调试，不碰真板也能走通大半流程（来源：[交叉编译与嵌入式](./source/cross-compile.md)，B 级页面 + EL9 包仓库核验）。

### 源码阅读靠现查坐标

市面内核书停在 2.6 时代，函数名与文件路径以 elixir 检索的当前树为准。书给结构与方法，树给坐标，两者配合使用；直接读树则从 Documentation/ 目录起步（来源：[官方文档调研](./research/official-docs.md) §3、[源码篇](./source/README.md)，B 级）。

## 权威书籍要点

七本书的定位与实测目录见[权威书籍调研](./research/authoritative-books.md)。前五本目录原文已实取（A 级），后两本只有书目信息（C 级，目录未取回，不引章节细节）。

| 书名 | 作者 / 出版方 | 级别 | 对应知识点 |
|------|--------------|------|-----------|
| 鸟哥的 Linux 私房菜·基础学习篇（CentOS 7 版，25 章） | 鸟哥 | A | 磁盘与文件系统、BASH 与脚本、账号与 ACL、例行调度、服务与日志、开机流程、软件安装、内核编译——基础篇主骨架 |
| 鸟哥的 Linux 私房菜·服务器架设篇（RockyLinux 9 版，12 章） | 鸟哥 | A | 虚拟机、安全强化、网络规划、防火墙、DNS/DHCP/NTP、SSH、LDAP——服务器篇主骨架 |
| The Linux Command Line（第 7 网络版，4 部 36 章） | William Shotts（自发布，CC BY-NC-ND；印刷版 No Starch Press） | A | shell 用法到脚本工程：变量、流程控制、位置参数、数组——命令篇与脚本篇的深度基准 |
| UNIX and Linux System Administration Handbook（第 5 版，4 篇 31 章） | Evi Nemeth、Garth Snyder、Trent R. Hein、Ben Whaley、James Ma（Addison-Wesley） | A | 基础管理、网络、存储、运维四篇；Containers 已由[容器](./server/container/docker.md)、Cloud Computing 与 Continuous Integration and Delivery 已由[云计算与 cloud-init](./server/cloud-computing.md)、[CI/CD 与持续交付](./server/ci-cd.md)（2026-10-10）落点 |
| The Debian Handbook（Bullseye 版，16 章） | Raphaël Hertzog、Roland Mas | A | Debian 项目、安装、APT、服务、安全——Debian 系的权威坐标 |
| How Linux Works | Brian Ward（No Starch Press） | C | 定位是机制解释基准；产品页无目录可取，只有书名与出版方可用 |
| The Linux Bible | Christopher Negus（Wiley） | C | 定位是发行版广度基准；产品页目录由脚本渲染，静态抓取拿不到 |

两本鸟哥对本仓的核对结论各有三条落点（源代码与 Tarball、X Window、虚拟机、LDAP 等），逐条表在[覆盖核对与差异表](./research/coverage-matrix.md) §1、§2。USAH 5e 未单页的三章（Cloud Computing、Containers、Continuous Integration and Delivery）已于 2026-10-10 由[云计算与 cloud-init](./server/cloud-computing.md)、[CI/CD 与持续交付](./server/ci-cd.md)两页落点；USAH 的全章逐条核对尚未展开，差异表目前按鸟哥与 ArchWiki 核对。

## 官方文档要点

各来源的可达性与反爬判定见[官方文档调研](./research/official-docs.md)。全仓外链 965 条、160 个域名，前四位是 `wiki.archlinux.org`（238 条 / 111 页）、`linux.vbird.org`（100 条 / 94 页）、`man7.org`（49 条 / 29 页）、`docs.redhat.com`（40 条 / 40 页）——引用密度与调研结论一致。

| 来源 | 入口 | 要点 | 级别 |
|------|------|------|------|
| ArchWiki | [wiki.archlinux.org](https://wiki.archlinux.org/title/Table_of_contents) | 8 大类、337 条编号条目（2026-10-09 官方直取）；与服务器运维相关的类目逐条对到了本仓页面 | A |
| 鸟哥官方站 | [linux.vbird.org](https://linux.vbird.org/) | 两篇目录共 36 个章标题，2026-10-09 官方直取与镜像逐条一致 | A |
| Debian 手册 | [debian.org/doc/manuals/debian-handbook](https://www.debian.org/doc/manuals/debian-handbook/) | 29 条站内引用；章级目录（Bullseye 版 16 章）已经由官方在线版实取 | 入口 A / 正文未取 |
| 内核文档 | [docs.kernel.org](https://docs.kernel.org/) | 源码篇的坐标来源；文档分区未逐条取回 | C |
| systemd 文档 | [systemd.io](https://systemd.io/) | 设计文档门户与 [BOOT 启动流程](https://systemd.io/BOOT)官方说明，两个系统管理页已补链 | A |
| Red Hat 文档 | [docs.redhat.com](https://docs.redhat.com/) | 40 条引用；对 curl 返回 403 反爬，靠仓库既有双通道仲裁记录支撑 | B |
| GNU 手册 | [www.gnu.org](https://www.gnu.org/) | coreutils、bash、findutils、tar 等 36 条引用；出口对该域连接层失败持续，维持既有核验 | B |
| man 页 | [man7.org](https://man7.org/)、[man.archlinux.org](https://man.archlinux.org/) | 49 条与 40 条引用，系统调用与命令语义的第一落点 | B |
| 内核源码检索 | [elixir.bootlin.com](https://elixir.bootlin.com/) | 带 UA 实测 200；此前的不可达判定属反爬假阳性 | B |

## 应用场景

四类场景的调研事实（openEuler 的场景与架构表述、Anolis 的 CentOS 兼容自述、ArchWiki 桌面类目、本仓外链反推的运维工具面）见[应用场景调研](./research/application-scenarios.md)。六条要求经补页后全部落地：

| 场景 | 关键要求 | 本仓落点 |
|------|---------|---------|
| 服务器与云 | 三系命令并排、存量迁移视角、多架构 | 服务器篇 + 系统管理篇，三系对照贯穿全仓 |
| 边缘与嵌入式 | 交叉编译、设备树、启动链路、无图形界面 | [交叉编译与嵌入式](./source/cross-compile.md) |
| 桌面与开发 | Xorg/Wayland、显示管理器、输入法与字体 | [桌面图形栈](./hardware/desktop-stack.md) |
| 运维自动化 | 调度、编排、监控、备份、账号一致性 | [LDAP 统一账号管理](./server/ldap.md) 补齐最后一环 |
| 安全合规 | 两套 MAC 的发行版差异 | [AppArmor 实战](./security/apparmor.md) 与 SELinux 五页成两套 |
| 虚拟化 | KVM/libvirt 建机与网络、与容器分工 | [KVM 虚拟化](./server/virtualization/kvm.md) |

阅读路径按场景各给一条（从装机到进阶），完整版在[应用场景调研](./research/application-scenarios.md) §4：

- 服务器与云：安装 → [网络参数](./server/network-parameters.md) → [SSH 远程登录](./server/ssh.md) → [Nginx](./server/web/nginx.md) → [性能优化](./system-management/performance.md) → [安全加固](./security/hardening.md)
- 边缘与嵌入式：[体系结构](./hardware/architecture.md) → [驱动框架](./source/driver-framework.md) → [交叉编译](./source/cross-compile.md) → [内核编译](./source/build-and-modules.md)
- 桌面与开发：[选发行版](./basic/installation/choose_distribution.md) → [安装过程](./basic/installation/process.md) → [桌面图形栈](./hardware/desktop-stack.md) → [KVM](./server/virtualization/kvm.md)
- 运维自动化：[自动化运维](./system-management/automation.md) → [CI/CD 与持续交付](./server/ci-cd.md) → [排程](./system-management/scheduled-tasks.md) → [监控](./server/monitoring/prometheus.md) → [备份](./system-management/backup-and-recovery.md) → [LDAP](./server/ldap.md)

## 常见坑与误区

技术坑是从补页与复核里拣出来的高频问题，展开都在对应页面：

| 坑 | 事实 | 展开页 |
|----|------|--------|
| `pacman -Sy` 部分升级 | 只刷数据库不升级系统，新包配旧依赖，库里和盘上版本错位；日常只有 `-Syu` | [Pacman 包管理](./basic/packages/pacman.md) |
| RHEL 8 起 `openldap-servers` 移出自家仓库 | Red Hat 官方指向 Directory Server 或 IdM；Rocky 在 plus 仓库放回了这个包 | [LDAP 统一账号管理](./server/ldap.md) |
| 包组名随大版本变 | `base-x` 这类组名无法从公开 comps 源确证，装前先 `dnf group list` 看实测输出 | [桌面图形栈](./hardware/desktop-stack.md) |
| XFS 只能扩不能缩 | 缩容仅 ext4 支持；动 XFS 前先备份 | [LVM 逻辑卷管理](./system-management/lvm.md) |
| nsswitch 里 sss 写到 files 前 | 目录一抖，本地 root 都解析不出，sudo 与登录连锁罢工；永远 files 在前 | [LDAP 统一账号管理](./server/ldap.md) |
| 证书 CN/SAN 与连接名不符 | ldaps 报 Can't contact；签证书时 SAN 覆盖所有接入名 | [LDAP 统一账号管理](./server/ldap.md) |
| SSSD 缓存脏数据 | 目录侧改了、客户端没反应，先 `sss_cache -E` 再查配置，顺序反了白查半天 | [LDAP 统一账号管理](./server/ldap.md) |
| olcAccess 方向是默认拒绝 | 访问规则配错会把自己也锁在外面；改前留一个已登录会话 | [LDAP 统一账号管理](./server/ldap.md) |

调研方法上的坑同样值得留档，核对记录见[缺口补全与核对修订](./research/gap-fill.md) §4：

- **镜像站有时差。** ArchWiki 官方 337 条对镜像 336 条，个别类目计数 ±1 属正常；两份鸟哥目录官方与镜像逐条一致。镜像取的结构要回头对官方。
- **出版方页面未必给目录。** Wiley 产品页由前端脚本渲染，静态抓取只剩 ISBN；No Starch 产品页没有目录区块。书目标 C 级不是偷懒，是拿不到。
- **反爬表现各不一样。** docs.redhat.com 403、freedesktop man 页 418、elixir 带 UA 就 200（假阳性）、gnu.org 连接层 000 且重试仍败。判定可达性要带 UA、多通道交叉，别被单一 curl 结果带偏。
- **文案数字别照抄。** TLCL 站点文案写 596 页，官方 PDF 实测 533 页（同一第 7 网络版）。引用以到手版本实测为准。
- **查无实据就降级。** 页内标「随版本核实」的条目，核实得了就撤标记写肯定句，核实不了就改措辞留档，不硬写。

## 来源与口径

- **A 级**：2026-10-08/09 本机实取。书籍目录（两份鸟哥、TLCL、USAH、Debian Handbook）、ArchWiki 类目结构、openEuler/Anolis 场景表述、systemd.io、TLCL 官方 PDF。
- **B 级**：仓库既有外链核验轮的记录。Red Hat、GNU、man 页、elixir 的可达性结论出自 README 维护备注。
- **C 级 / 来源未考**：How Linux Works 与 The Linux Bible 的章节结构（目录未取回，正文不得引用）；docs.kernel.org 的文档分区（未逐条取）；Debian 手册正文（入口与章目录已取，内容未逐章读）；Red Hat 与 GNU 的正文细节（反爬与出口受限）。
- 复测记录与「随版本核实」条目的逐条处置在[缺口补全与核对修订](./research/gap-fill.md) §4、§4.1。

## 参考资料

- [知识调查总览](./research/README.md)——四步方法与来源分级
- [权威书籍调研](./research/authoritative-books.md)——七本书的目录原文与引用纪律
- [官方文档调研](./research/official-docs.md)——九类官方来源与引用密度
- [应用场景调研](./research/application-scenarios.md)——四类场景事实与完整阅读路径
- [覆盖核对与差异表](./research/coverage-matrix.md)——四档判定逐条表
- [缺口补全与核对修订](./research/gap-fill.md)——补页修订执行与复测记录
