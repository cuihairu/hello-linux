# 权威书籍调研

调研目的：弄清同类书把哪些主题当成必讲内容，再拿这些主题逐条对照本仓目录。本页给出的两份鸟哥目录与三本英文书（The Linux Command Line、USAH、Debian Handbook）的章节结构均为实取（A 级），其余英文书只给书目信息（C 级），不含任何未经取回的章节细节。

## 1. 鸟哥的 Linux 私房菜（A 级，2026-10-08 实取）

官方站点 `linux.vbird.org` 本轮不可达，目录取自镜像 `vbird.org.cn` 的目录总览页，逐章标题照录。镜像与官方站可能存在版本时差，条目以镜像为准。

### 1.1 基础学习篇（CentOS 7 版，25 章）

来源：[vbird.org.cn/linux_basic/centos7/ 目录总览](https://vbird.org.cn/linux_basic/centos7/)

| 部分 | 章节 |
|------|------|
| 规划与安装 | 第零章 计算机概论；第一章 Linux 是什么与如何学习；第二章 主机规划与磁盘分割；第三章 安装 CentOS 7.x；第四章 首次登录与在线求助 |
| 文件、目录与磁盘格式 | 第五章 文件权限与目录配置；第六章 文件与目录管理；第七章 磁盘与文件系统管理；第八章 压缩、打包与备份 |
| Shell 与脚本 | 第九章 vim 程序编辑器；第十章 认识与学习 BASH；第十一章 正规表示法与文档格式化处理；第十二章 学习 Shell Scripts |
| 用户管理 | 第十三章 帐号管理与 ACL 权限设置；第十四章 磁盘配额与高端文件系统管理 |
| 系统管理员 | 第十五章 例行性工作调度（crontab）；第十六章 进程管理与 SELinux 初探；第十七章 认识系统服务（daemons）；第十八章 认识与分析日志；第十九章 开机流程、模块管理与 Loader；第二十章 基础系统设置与备份策略 |
| 其他 | 第二十一章 软件安装：源代码与 Tarball；第二十二章 软件安装 RPM、SRPM 与 YUM；第二十三章 X Window 设置介绍；第二十四章 Linux 内核编译与管理 |

镜像站的版本索引显示，这一篇还有 CentOS 5、Fedora Core 4、Mandrake 9、Red Hat 6.1 四个历史版本，另有独立的「基础训练教材」系列（CentOS 8.x、CentOS 7.x）。

> 2026-10-09 复测：官方站 `linux.vbird.org` 恢复可达，基础学习篇 24 个章标题与镜像逐条一致（服务器架设篇 12 章同样一致），本节两份目录升级为官方直取。复测记录见[缺口补全与核对修订](./gap-fill.md)。

### 1.2 服务器架设篇（RockyLinux 9 版，12 章）

来源：[vbird.org.cn/linux_server/rocky9/ 目录总览](https://vbird.org.cn/linux_server/rocky9/)

| 部分 | 章节 |
|------|------|
| 虚拟化、网络与防火墙 | 第零章 笑谈 Linux 应用与服务器学习；第一章 小型云系统与主机安全强化流程；第二章 第一个虚拟机的安装与调整；第三章 SELinux 初探；第四章 网络基础学习；第五章 创建与检查网络连接；第六章 局域网路整体环境规划；第七章 Linux 防火墙设置 |
| 局域网内的常见服务 | 第八章 领域名称服务器 DNS；第九章 局域网路参数供应者 DHCP、NTP；第十章 远程连接服务器 SSH / X / VNC；第十一章 使用 LDAP 统一管理帐号 |

服务器篇的版本索引另有 CentOS 6/5/4、Red Hat 9、Red Hat 6.1 等旧版，以及「服务器篇训练教材」入口。新版把重头放在虚拟机、安全强化、防火墙与目录服务，而传统 Web/邮件/文件服务在旧版章节里，本仓的服务器篇对这一段的覆盖更完整。

### 1.3 两篇目录对本仓的要求

- 基础篇 25 章里，第二十一章（源代码与 Tarball）已由[源码编译与 Tarball 安装](../basic/packages/tarball.md)（2026-10-10）落点；第二十三章（X Window）已由[桌面图形栈](../hardware/desktop-stack.md)落点；磁盘分割、备份、内核编译等主题分别落在硬件篇、系统管理篇与源码篇。
- 服务器篇 12 章里，第一、二章（虚拟机）已由 [KVM 虚拟化](../server/virtualization/kvm.md)、第十一章（LDAP）已由 [LDAP 统一账号管理](../server/ldap.md)、第十章的 SSH 已由 [SSH 远程登录](../server/ssh.md)（2026-10-10）落点。
- 逐条对照见 [覆盖核对与差异表](./coverage-matrix.md)。

## 2. 英文权威书籍（三本 A 级、两本 C 级）

英文系统管理领域流通最广的四本书加 Debian Handbook 在此登记，供后续补课用。首轮境外链路中断，只登记了书目信息；2026-10-09 出口恢复后按登记续办 C→A 升级：The Linux Command Line 与 USAH 的官方目录原文已实取，连同 Debian Handbook 的官方在线目录一并升为 A 级；How Linux Works 与 The Linux Bible 的官方页面拿不到目录，维持 C 级。

### 2.1 目录已实取（A 级，2026-10-09）

| 书名 | 作者 / 出版方 | 实取来源与结论 |
|------|--------------|---------------|
| The Linux Command Line | William Shotts（印刷版 No Starch Press） | 作者自发布，CC BY-NC-ND。[书目页](https://linuxcommand.org/tlcl.php)与官方免费 PDF `TLCL-25.12A`（[SourceForge 官方项目](https://sourceforge.net/projects/linuxcommand/)）实取：第 7 网络版（PDF 版权页 © 2026，533 页），4 部 36 章 |
| UNIX and Linux System Administration Handbook | Evi Nemeth、Garth Snyder、Trent R. Hein、Ben Whaley、James Ma，Addison-Wesley | [官方站 admin.com](https://www.admin.com/) 自述第五版，[样张目录 PDF](https://www.admin.com/samples/TOC.pdf) 实取：4 篇 31 章 |
| The Debian Handbook | Raphaël Hertzog、Roland Mas | [官方在线版目录页](https://debian-handbook.info/browse/stable/)实取：stable 即 Debian 11 Bullseye 版，16 章 |

**The Linux Command Line**（4 部 36 章，章题照录自 PDF 目录）：

| 部 | 章 |
|----|----|
| Part 1: Learning the Shell（第 1–10 章） | What Is the Shell?；Navigation；Exploring the System；Manipulating Files and Directories；Working with Commands；Redirection；Seeing the World as the Shell Sees It；Advanced Keyboard Tricks；Permissions；Processes |
| Part 2: Configuration and the Environment（第 11–13 章） | The Environment；A Gentle Introduction to vi(m)；Customizing the Prompt |
| Part 3: Common Tasks and Essential Tools（第 14–23 章） | Package Management；Storage Media；Networking；Searching for Files；Archiving and Backup；Regular Expressions；Text Processing；Formatting Output；Printing；Compiling Programs |
| Part 4: Writing Shell Scripts（第 24–36 章） | Writing Your First Script；Starting a Project；Top-Down Design；Flow Control: Branching with if；Reading Keyboard Input；Flow Control: Looping with while/until；Troubleshooting；Flow Control: Branching with case；Positional Parameters；Flow Control: Looping with for；Strings and Numbers；Arrays；Exotica |

**UNIX and Linux System Administration Handbook**（4 篇 31 章，章题照录自官方样张目录）：

| 篇 | 章 |
|----|----|
| Section One: Basic Administration（第 1–12 章） | Where to Start；Booting and System Management Daemons；Access Control and Rootly Powers；Process Control；The Filesystem；Software Installation and Management；Scripting and the Shell；User Management；Cloud Computing；Logging；Drivers and the Kernel；Printing |
| Section Two: Networking（第 13–19 章） | TCP/IP Networking；Physical Networking；IP Routing；DNS: The Domain Name System；Single Sign-On；Electronic Mail；Web Hosting |
| Section Three: Storage（第 20–22 章） | Storage；The Network File System；SMB |
| Section Four: Operations（第 23–31 章） | Configuration Management；Virtualization；Containers；Continuous Integration and Delivery；Security；Monitoring；Performance Analysis；Data Center Basics；Methodology, Policy, and Politics |

**The Debian Handbook**（16 章，章题照录自官方在线目录）：The Debian Project；Presenting the Case Study；Analyzing the Existing Setup and Migrating；Installation；Packaging System: Tools and Fundamental Principles；Maintenance and Updates: The APT Tools；Solving Problems and Finding Relevant Information；Basic Configuration: Network, Accounts, Printing…；Unix Services；Network Infrastructure；Network Services: Postfix, Apache, NFS, Samba, Squid, LDAP, SIP, XMPP, TURN；Advanced Administration；Workstation；Security；Creating a Debian Package；Conclusion: Debian's Future

对照含义：TLCL 第 14 章（Package Management）、第 19–20 章（Regular Expressions、Text Processing）等与命令篇、脚本篇逐条对应；两书全部章节已逐条对照进[覆盖核对与差异表](./coverage-matrix.md)（USAH 见 §4、TLCL 见 §5），Cloud Computing 与 Continuous Integration and Delivery 已由 2026-10-10 补页落点。

### 2.2 维持 C 级（官方页无目录可取）

| 书名 | 作者 / 出版方 | 获取入口 | 处置原因 |
|------|--------------|---------|---------|
| How Linux Works | Brian Ward，No Starch Press | 出版方 [nostarch.com](https://nostarch.com/how-linux-works-3rd-edition) | 产品页实取：无目录区块，也无样章 PDF 链接，无处取章节结构 |
| The Linux Bible | Christopher Negus，Wiley | 出版方 Wiley 产品页（ISBN 9781119909792） | 产品页实取：仅书目字段，目录由前端脚本渲染，静态抓取拿不到 |

引用纪律：2.2 两本在本仓正文中只允许以「书名 + 出版方 + 入口」形态出现，不得引用具体章节、页码或版本年份，直到取回目录原文；2.1 三本可引用其章节结构（分部与章题），目录之外的正文细节仍不引用。

## 3. 与鸟哥的分工

鸟哥两篇是本仓 README 明示的参考（B 级，`linux.vbird.org` 在仓库既有外链核验轮通过，引用 100 处、覆盖 94 个页面，是仅次于 ArchWiki 的第二来源）。它提供的骨架是「基础概念 → 逐条命令 → 服务搭建 → 排错」，本仓在同一个骨架上做了两件事：把三系发行版（Debian/Ubuntu、Arch、RHEL 系）并排对照，把每个服务的落点从 CentOS 7 时代更新到 systemd 时代。差距主要在上一节列出的三处，已按 [缺口补全与核对修订](./gap-fill.md) 补齐。
