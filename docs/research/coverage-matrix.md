# 覆盖核对与差异表

本页是四步里的第③步：把前三页调研出的来源主题，逐条对到本仓页面，判定「已覆盖 / 部分覆盖 / 缺口 / 不覆盖」。判据是页面里有没有对应主题的实质内容，不是标题像不像。

判定分四档：

| 判定 | 含义 |
|------|------|
| 已覆盖 | 本仓有专门页面或章内独立小节，讲透了操作与机制 |
| 部分覆盖 | 主题在别处被提到，但没有独立落点，读者得自己拼 |
| 缺口 | 权威来源列为必讲，本仓没有 |
| 不覆盖 | 有意识不写：属于设备适配、应用软件目录或其它项目范畴，与本仓「学 Linux 系统本身」的定位不同 |

## 1. 按鸟哥基础学习篇（25 章）核对

来源目录见[权威书籍调研](./authoritative-books.md) 第 1.1 节。

| 鸟哥章节 | 主题 | 本仓落点 | 判定 |
|---------|------|---------|------|
| 第零章 | 计算机概论 | [技术概论](../basic/overview.md) | 已覆盖 |
| 第一章 | Linux 是什么与如何学习 | [Linux 简介](../basic/introduction.md) | 已覆盖 |
| 第二章 | 主机规划与磁盘分割 | [安装前的准备](../basic/installation/preparation.md)、[存储设备](../hardware/storage.md) | 已覆盖 |
| 第三章 | 安装 CentOS 7.x | [安装过程](../basic/installation/process.md) | 已覆盖（三系并写） |
| 第四章 | 首次登录与在线求助 | [基本命令](../commands/basic.md) | 已覆盖 |
| 第五章 | 文件权限与目录配置 | [文件权限](../basic/filesystem/permissions.md) | 已覆盖 |
| 第六章 | 文件与目录管理 | [文件操作](../commands/basic/file.md)、[目录操作](../commands/basic/directory.md) | 已覆盖 |
| 第七章 | 磁盘与文件系统管理 | [文件系统](../basic/filesystem.md)、[存储设备](../hardware/storage.md)、新页 [LVM 逻辑卷管理](../system-management/lvm.md) | 已覆盖（LVM 实操本轮补页） |
| 第八章 | 压缩、打包与备份 | [压缩与归档](../commands/compression.md)、[备份与恢复](../system-management/backup-and-recovery.md) | 已覆盖 |
| 第九章 | vim 程序编辑器 | [文本编辑和查看工具](../commands/text/editors.md) | 已覆盖 |
| 第十章 | 认识与学习 BASH | [Bash 基础](../script/bash-basics.md) | 已覆盖 |
| 第十一章 | 正规表示法与文档格式化 | [正则表达式](../script/regex.md) | 已覆盖（格式化处理未单列） |
| 第十二章 | 学习 Shell Scripts | [脚本篇](../script/README.md) 全篇 | 已覆盖 |
| 第十三章 | 帐号管理与 ACL 权限设置 | [账号管理](../basic/users/account_management.md)、[ACL 权限控制](../basic/users/acl_permissions.md) | 已覆盖 |
| 第十四章 | 磁盘配额与高端文件系统 | [磁盘配额](../basic/users/disk_quotas.md) | 已覆盖 |
| 第十五章 | 例行性工作调度（crontab） | [例行性工作排程](../system-management/scheduled-tasks.md) | 已覆盖 |
| 第十六章 | 进程管理与 SELinux 初探 | [进程管理](../commands/system/process.md)、[SELinux 概念](../basic/security/concept.md) | 已覆盖 |
| 第十七章 | 认识系统服务（daemons） | [系统服务管理](../basic/services/system_services.md)、[systemd 服务与程序管理](../system-management/services-systemd.md) | 已覆盖 |
| 第十八章 | 认识与分析日志 | [系统日志](../basic/log/syslog.md)、[日志系统管理](../system-management/logging.md) | 已覆盖 |
| 第十九章 | 开机流程、模块管理与 Loader | [开机流程](../basic/boot.md)、[开机流程与引导排错](../system-management/boot-process.md) | 已覆盖 |
| 第二十章 | 基础系统设置与备份策略 | [系统配置工具](../basic/services/configuration_tools.md)、[备份与恢复](../system-management/backup-and-recovery.md) | 已覆盖 |
| 第二十一章 | 软件安装：源代码与 Tarball | 新页 [源码编译与 Tarball 安装](../basic/packages/tarball.md)（2026-10-10） | 部分覆盖→已补页 |
| 第二十二章 | 软件安装 RPM、SRPM 与 YUM | [APT 包管理](../basic/packages/apt.md)、[YUM/DNF 包管理](../basic/packages/yum.md)、新页 [Pacman 包管理](../basic/packages/pacman.md) | 已覆盖（三系齐，Arch 系本轮补页） |
| 第二十三章 | X Window 设置介绍 | 新页 [桌面图形栈](../hardware/desktop-stack.md) | 缺口→本轮补页 |
| 第二十四章 | Linux 内核编译与管理 | [源码篇](../source/README.md)、[内核编译与模块开发](../source/build-and-modules.md) | 已覆盖 |

## 2. 按鸟哥服务器架设篇（12 章）核对

来源目录见[权威书籍调研](./authoritative-books.md) 第 1.2 节。

| 鸟哥章节 | 主题 | 本仓落点 | 判定 |
|---------|------|---------|------|
| 第零章 | 应用与服务器学习 | [服务器篇](../server/README.md) | 已覆盖 |
| 第一章 | 主机安全强化流程 | [安全加固](../security/hardening.md)、[防火墙](../security/firewall.md) | 已覆盖 |
| 第二章 | 虚拟机的安装与调整 | 新页 [KVM 虚拟化](../server/virtualization/kvm.md) | 缺口→本轮补页 |
| 第三章 | SELinux 初探 | [SELinux 实战](../security/selinux.md)、[SELinux 概念](../basic/security/concept.md) | 已覆盖 |
| 第四章 | 网络基础学习 | [网络基础](../network/basics.md) | 已覆盖 |
| 第五章 | 创建与检查网络连接 | [网络配置基础](../network/network-configuration.md)、[网络管理命令](../commands/network/network.md) | 已覆盖 |
| 第六章 | 局域网整体环境规划 | [网络参数配置](../server/network-parameters.md)、[路由与 NAT](../server/routing-nat.md) | 已覆盖 |
| 第七章 | Linux 防火墙设置 | [防火墙](../network/firewall.md)、[防火墙（安全篇）](../security/firewall.md) | 已覆盖 |
| 第八章 | 领域名称服务器 DNS | [DNS](../server/dns/bind.md) | 已覆盖 |
| 第九章 | DHCP、NTP | [DHCP 服务器](../server/dhcp.md)、[NTP 时间服务](../server/ntp.md) | 已覆盖 |
| 第十章 | 远程连接服务器 SSH / X / VNC | 新页 [SSH 远程登录](../server/ssh.md)（2026-10-10），客户端用法见[网络工具](../commands/network/network-tools.md) | 缺口→已补页 |
| 第十一章 | 使用 LDAP 统一管理帐号 | 新页 [LDAP 统一账号管理](../server/ldap.md) | 缺口→已补页 |

## 3. 按 ArchWiki 八大类核对

类目结构与条目数见[官方文档调研](./official-docs.md) 第 2 节。下表只列与本仓定位相关的类目。

| ArchWiki 类目 | 本仓落点 | 判定 |
|--------------|---------|------|
| 1.3 安装过程 | [安装 Linux](../basic/installation.md) | 已覆盖 |
| 4.2 CPU / 4.16 存储 | [CPU](../hardware/cpu.md)、[存储设备](../hardware/storage.md) | 已覆盖 |
| 4.6 显卡图形 / 4.15 声音 | 新页 [桌面图形栈](../hardware/desktop-stack.md) | 缺口→本轮补页（声音未单列） |
| 6.4 防火墙 / 6.7 网络配置 / 6.8 网络监控 | [防火墙](../network/firewall.md)、[网络配置基础](../network/network-configuration.md)、[网络监控](../network/network-monitoring.md) | 已覆盖 |
| 6.12 服务器 / 6.3.2 邮件服务器 | [服务器篇](../server/README.md) 21 页、[邮件](../server/mail/postfix.md) | 已覆盖 |
| 8.8 文件系统 | [文件系统](../basic/filesystem.md)、新页 [LVM 逻辑卷管理](../system-management/lvm.md) | 已覆盖 |
| 8.12 内核 | [源码篇](../source/README.md) 14 页 | 已覆盖 |
| 8.18 软件包管理 | [软件安装](../basic/packages.md)、新页 [Pacman 包管理](../basic/packages/pacman.md)、[包管理命令](../commands/package/package.md) | 已覆盖 |
| 8.20 安全 | [安全篇](../security/README.md)、[SELinux 概念](../basic/security/concept.md)、新页 [AppArmor 实战](../security/apparmor.md) | 已覆盖（两套 MAC 齐） |
| 8.23 虚拟化 | [容器](../server/container/docker.md)、新页 [KVM 虚拟化](../server/virtualization/kvm.md) | 已覆盖 |
| 8.6 视觉美化 / 8.10 图形用户界面 / 8.14 本地化 | 新页 [桌面图形栈](../hardware/desktop-stack.md) | 缺口→本轮补页 |
| 8.1 备份 / 8.2 引导过程 / 8.15 日志 / 8.16 监控 | [备份与恢复](../system-management/backup-and-recovery.md)、[开机流程与引导排错](../system-management/boot-process.md)、[日志系统管理](../system-management/logging.md)、[系统监控工具](../commands/system/monitoring.md) | 已覆盖 |

明确不跟的类目：4.9 笔记本电脑（按厂商列 33 个子类）、2.x 开发工具链、6.10 点对点与 6.13 流媒体、6.15 VoIP——这些是设备适配与应用软件目录，判定为**不覆盖**而非缺口。

## 4. 按 USAH 5e 核对（31 章）

来源目录见[权威书籍调研](./authoritative-books.md) 第 2.1 节（admin.com 官方样张 TOC，A 级）。USAH 面向职业运维，逐章判定如下。

| USAH 章节 | 主题 | 本仓落点 | 判定 |
|----------|------|---------|------|
| 第 1 章 | Where to Start | [技术概论](../basic/overview.md)、[Linux 简介](../basic/introduction.md) | 已覆盖 |
| 第 2 章 | Booting and System Management Daemons | [开机流程](../basic/boot.md)、[开机流程与引导排错](../system-management/boot-process.md)、[systemd 服务与程序管理](../system-management/services-systemd.md) | 已覆盖 |
| 第 3 章 | Access Control and Rootly Powers | [PAM 与 sudo](../security/pam-sudo.md)、[账号管理](../basic/users/account_management.md) | 已覆盖 |
| 第 4 章 | Process Control | [进程管理](../commands/system/process.md) | 已覆盖 |
| 第 5 章 | The Filesystem | [文件系统](../basic/filesystem.md)、[文件权限](../basic/filesystem/permissions.md) | 已覆盖 |
| 第 6 章 | Software Installation and Management | [软件安装](../basic/packages.md) 章（APT、YUM/DNF、Pacman、Tarball 四页） | 已覆盖 |
| 第 7 章 | Scripting and the Shell | [脚本篇](../script/README.md) | 已覆盖 |
| 第 8 章 | User Management | [账号管理](../basic/users/account_management.md)、[ACL 权限控制](../basic/users/acl_permissions.md)、[磁盘配额](../basic/users/disk_quotas.md) | 已覆盖 |
| 第 9 章 | Cloud Computing | 新页 [云计算与 cloud-init](../server/cloud-computing.md)（2026-10-10） | 缺口→已补页 |
| 第 10 章 | Logging | [系统日志](../basic/log/syslog.md)、[日志系统管理](../system-management/logging.md) | 已覆盖 |
| 第 11 章 | Drivers and the Kernel | [设备驱动框架](../source/driver-framework.md)、[内核编译与模块开发](../source/build-and-modules.md) | 已覆盖 |
| 第 12 章 | Printing | 打印属桌面办公外围，与服务器运维主线弱相关；CUPS 仅在 [systemd 服务与程序管理](../system-management/services-systemd.md) 作单元示例出现 | 不覆盖（登记） |
| 第 13 章 | TCP/IP Networking | [网络基础](../network/basics.md)、[TCP/IP 要点](../network/tcpip-essentials.md) | 已覆盖 |
| 第 14 章 | Physical Networking | [网络设备](../hardware/network.md) | 已覆盖 |
| 第 15 章 | IP Routing | [路由与 NAT](../server/routing-nat.md) | 已覆盖 |
| 第 16 章 | DNS | [DNS](../server/dns/bind.md) | 已覆盖 |
| 第 17 章 | Single Sign-On | [LDAP 统一账号管理](../server/ldap.md) 衔接 Kerberos 与 FreeIPA 概念；完整 SSO 部署需要 KDC 与域环境，超出单机学习定位 | 部分覆盖→登记不补 |
| 第 18 章 | Electronic Mail | [邮件服务器 Postfix](../server/mail/postfix.md) | 已覆盖 |
| 第 19 章 | Web Hosting | [Nginx](../server/web/nginx.md)、[Apache](../server/web/apache.md) | 已覆盖 |
| 第 20 章 | Storage | [存储设备](../hardware/storage.md)、[LVM 逻辑卷管理](../system-management/lvm.md) | 已覆盖 |
| 第 21 章 | The Network File System | [NFS](../server/nfs.md) | 已覆盖 |
| 第 22 章 | SMB | [Samba](../server/samba.md) | 已覆盖 |
| 第 23 章 | Configuration Management | [自动化运维](../system-management/automation.md)（脚本 vs Ansible 选型与 playbook 实练） | 已覆盖 |
| 第 24 章 | Virtualization | [KVM 虚拟化](../server/virtualization/kvm.md) | 已覆盖 |
| 第 25 章 | Containers | [容器](../server/container/docker.md) | 已覆盖 |
| 第 26 章 | Continuous Integration and Delivery | 新页 [CI/CD 与持续交付](../server/ci-cd.md)（2026-10-10） | 缺口→已补页 |
| 第 27 章 | Security | [安全篇](../security/README.md)（加固、SELinux 与 AppArmor 两套 MAC） | 已覆盖 |
| 第 28 章 | Monitoring | [Prometheus 监控](../server/monitoring/prometheus.md)、[系统监控工具](../commands/system/monitoring.md) | 已覆盖 |
| 第 29 章 | Performance Analysis | [性能优化](../system-management/performance.md) | 已覆盖 |
| 第 30 章 | Data Center Basics | 机房设施与带外管理属数据中心运维范畴，超出「学 Linux 系统本身」定位 | 不覆盖 |
| 第 31 章 | Methodology, Policy, and Politics | 组织流程与软技能主题，非系统技术 | 不覆盖 |

31 章判定小计：已覆盖 25、缺口→已补页 2（云计算、CI/CD）、部分覆盖→登记不补 1（SSO）、不覆盖 3（打印、数据中心、组织流程）。

## 5. 按 TLCL 核对（36 章）

来源目录见[权威书籍调研](./authoritative-books.md) 第 2.1 节（TLCL-25.12A 官方 PDF 目录，A 级）。TLCL 是命令行与脚本写作的深度基准，4 部 36 章逐章判定如下。

| TLCL 章节 | 主题 | 本仓落点 | 判定 |
|----------|------|---------|------|
| 第 1 章 | What Is the Shell? | [Bash 基础](../script/bash-basics.md) | 已覆盖 |
| 第 2 章 | Navigation | [目录操作](../commands/basic/directory.md) | 已覆盖 |
| 第 3 章 | Exploring the System | [文件操作](../commands/basic/file.md)、[目录结构](../basic/filesystem/hierarchy.md) | 已覆盖 |
| 第 4 章 | Manipulating Files and Directories | [文件操作](../commands/basic/file.md)、[目录操作](../commands/basic/directory.md) | 已覆盖 |
| 第 5 章 | Working with Commands | [基本命令](../commands/basic.md)（type、alias 与 man 求助） | 已覆盖 |
| 第 6 章 | Redirection | [Bash 基础](../script/bash-basics.md)（重定向）、[文件操作](../commands/basic/file.md) | 已覆盖 |
| 第 7 章 | Seeing the World as the Shell Sees It | [Bash 基础](../script/bash-basics.md)（展开与引用）、[变量与数据类型](../script/variables.md) | 已覆盖 |
| 第 8 章 | Advanced Keyboard Tricks | 任务控制见[进程管理](../commands/system/process.md)（jobs/fg/bg）；readline 键绑定与 history 扩展属终端使用习惯，不单列 | 部分覆盖→登记不补 |
| 第 9 章 | Permissions | [文件权限](../basic/filesystem/permissions.md) | 已覆盖 |
| 第 10 章 | Processes | [进程管理](../commands/system/process.md) | 已覆盖 |
| 第 11 章 | The Environment | [变量与数据类型](../script/variables.md)（环境变量与启动文件）、[Bash 基础](../script/bash-basics.md) | 已覆盖 |
| 第 12 章 | A Gentle Introduction to vi(m) | [文本编辑和查看工具](../commands/text/editors.md) | 已覆盖 |
| 第 13 章 | Customizing the Prompt | PS1 提示符定制全仓零落点；属终端个人配置，不影响系统管理主线 | 不覆盖（登记） |
| 第 14 章 | Package Management | [APT 包管理](../basic/packages/apt.md)、[YUM/DNF 包管理](../basic/packages/yum.md)、[Pacman 包管理](../basic/packages/pacman.md) | 已覆盖 |
| 第 15 章 | Storage Media | [文件系统](../basic/filesystem.md)（挂载与卸载）、[存储设备](../hardware/storage.md) | 已覆盖 |
| 第 16 章 | Networking | [网络管理命令](../commands/network/network.md) | 已覆盖 |
| 第 17 章 | Searching for Files | [查找与定位](../commands/find-and-locate.md) | 已覆盖 |
| 第 18 章 | Archiving and Backup | [压缩与归档](../commands/compression.md)、[备份与恢复](../system-management/backup-and-recovery.md) | 已覆盖 |
| 第 19 章 | Regular Expressions | [正则表达式](../script/regex.md) | 已覆盖 |
| 第 20 章 | Text Processing | [文本处理](../commands/text/text_processing.md) | 已覆盖 |
| 第 21 章 | Formatting Output | printf 与 fmt 见[文本处理](../commands/text/text_processing.md)；nl、fold、pr 等排版小工具不单列 | 部分覆盖→登记不补 |
| 第 22 章 | Printing | 同 USAH 第 12 章判定 | 不覆盖（登记） |
| 第 23 章 | Compiling Programs | [源码编译与 Tarball 安装](../basic/packages/tarball.md)、[内核编译与模块开发](../source/build-and-modules.md) | 已覆盖 |
| 第 24 章 | Writing Your First Script | [Bash 基础](../script/bash-basics.md) | 已覆盖 |
| 第 25 章 | Starting a Project | [脚本篇](../script/README.md)、[实战案例](../script/examples.md) | 已覆盖 |
| 第 26 章 | Top-Down Design | [函数](../script/functions.md) | 已覆盖 |
| 第 27 章 | Flow Control: Branching with if | [条件判断](../script/conditionals.md) | 已覆盖 |
| 第 28 章 | Reading Keyboard Input | [条件判断](../script/conditionals.md)、[循环](../script/loops.md)（read 交互输入） | 已覆盖 |
| 第 29 章 | Flow Control: Looping with while and until | [循环](../script/loops.md) | 已覆盖 |
| 第 30 章 | Troubleshooting | [脚本调试](../script/debugging.md) | 已覆盖 |
| 第 31 章 | Flow Control: Branching with case | [条件判断](../script/conditionals.md) | 已覆盖 |
| 第 32 章 | Positional Parameters | [函数](../script/functions.md)、[脚本调试](../script/debugging.md)（位置参数） | 已覆盖 |
| 第 33 章 | Flow Control: Looping with for | [循环](../script/loops.md) | 已覆盖 |
| 第 34 章 | Strings and Numbers | [变量与数据类型](../script/variables.md)（算术展开）、[正则表达式](../script/regex.md) | 已覆盖 |
| 第 35 章 | Arrays | [变量与数据类型](../script/variables.md)、[实战案例](../script/examples.md)（数组） | 已覆盖 |
| 第 36 章 | Exotica | heredoc 与进程替换散见[循环](../script/loops.md)、[实战案例](../script/examples.md)；余下杂项技巧不系统化单列 | 部分覆盖→登记不补 |

36 章判定小计：已覆盖 31、部分覆盖→登记不补 3（readline/history、排版输出、shell 杂项）、不覆盖 2（提示符定制、打印）。

## 6. 按 The Debian Handbook 核对（16 章）

来源目录见[权威书籍调研](./authoritative-books.md) 2.1 节（debian-handbook.info 官方在线版目录，A 级，Bullseye 版）。此书是 Debian 系的入门到精通主线，逐章判定如下。

| Debian Handbook 章节 | 主题 | 本仓落点 | 判定 |
|----------------------|------|---------|------|
| 第 1 章 | The Debian Project | [选择合适的发行版](../basic/installation/choose_distribution.md)、[Linux 简介](../basic/introduction.md) | 已覆盖 |
| 第 2 章 | Presenting the Case Study | 书的连贯叙事载体（虚构主机 rolala 的安装与演进），非独立技术主题 | 不覆盖 |
| 第 3 章 | Analyzing the Existing Setup and Migrating | [安装前的准备](../basic/installation/preparation.md)（硬件盘点与备份）、[备份与恢复](../system-management/backup-and-recovery.md)、存量迁移视角见[应用场景调研](./application-scenarios.md) §1.1 | 已覆盖 |
| 第 4 章 | Installation | [安装 Linux](../basic/installation.md)（三页，三系并写） | 已覆盖 |
| 第 5 章 | Packaging System: Tools and Fundamental Principles | [软件安装](../basic/packages.md)、[包管理命令](../commands/package/package.md)（dpkg/rpm/pacman 底层工具对照） | 已覆盖 |
| 第 6 章 | Maintenance and Updates: The APT Tools | [APT 包管理](../basic/packages/apt.md) | 已覆盖 |
| 第 7 章 | Solving Problems and Finding Relevant Information | [基本命令](../commands/basic.md)（man 求助）、[网络故障排除](../network/troubleshooting.md) 等各篇排错节 | 已覆盖 |
| 第 8 章 | Basic Configuration: Network, Accounts, Printing… | [网络配置基础](../network/network-configuration.md)、[账号管理](../basic/users/account_management.md)；打印部分同 USAH 第 12 章判定 | 已覆盖（打印不覆盖登记） |
| 第 9 章 | Unix Services | [系统服务管理](../basic/services/system_services.md)、[systemd 服务与程序管理](../system-management/services-systemd.md) | 已覆盖 |
| 第 10 章 | Network Infrastructure | [DNS](../server/dns/bind.md)、[DHCP 服务器](../server/dhcp.md)、[NTP 时间服务](../server/ntp.md)、[路由与 NAT](../server/routing-nat.md) | 已覆盖 |
| 第 11 章 | Network Services: Postfix, Apache, NFS, Samba, Squid, LDAP, SIP, XMPP, TURN | Postfix、Apache、NFS、Samba、LDAP 均有独立页；Squid 代理与 SIP/XMPP/TURN 实时通信协议无落点 | 部分覆盖→登记不补 |
| 第 12 章 | Advanced Administration | [LVM 逻辑卷管理](../system-management/lvm.md)、[备份与恢复](../system-management/backup-and-recovery.md)、[性能优化](../system-management/performance.md) | 已覆盖 |
| 第 13 章 | Workstation | [桌面图形栈](../hardware/desktop-stack.md) | 已覆盖 |
| 第 14 章 | Security | [安全篇](../security/README.md)（加固、防火墙、两套 MAC、加密） | 已覆盖 |
| 第 15 章 | Creating a Debian Package | Debian 打包工作流（`dpkg-buildpackage`、debhelper）全仓零落点；源码编译安装已由[源码编译与 Tarball 安装](../basic/packages/tarball.md)覆盖 | 部分覆盖→登记不补 |
| 第 16 章 | Conclusion: Debian's Future | 社区展望，非系统技术主题 | 不覆盖 |

16 章判定小计：已覆盖 12、部分覆盖→登记不补 2（实时通信与代理服务、Debian 打包工作流）、不覆盖 2（案例叙事章、社区展望章）。

## 7. 按 How Linux Works 3e 核对（17 章）

来源目录见[权威书籍调研](./authoritative-books.md) 2.1 节（nostarch.com 官方产品页 + 详细目录 PDF，A 级，2026-10-10 实取）。此书讲内核与系统机制的「how/why」，逐章判定如下。

| How Linux Works 章节 | 主题 | 本仓落点 | 判定 |
|----------------------|------|---------|------|
| 第 1 章 | The Big Picture | [技术概论](../basic/overview.md)、[Linux 简介](../basic/introduction.md) | 已覆盖 |
| 第 2 章 | Basic Commands and Directory Hierarchy | [基本命令](../commands/basic.md)、[目录结构](../basic/filesystem/hierarchy.md) | 已覆盖 |
| 第 3 章 | Devices | 设备文件一行见[目录结构](../basic/filesystem/hierarchy.md)，sysfs 语义散见源码篇与[存储设备](../hardware/storage.md)；用户态的设备文件、udev 规则、sysfs 查询无独立落点 | 部分覆盖→登记不补 |
| 第 4 章 | Disks and Filesystems | [文件系统](../basic/filesystem.md)、[存储设备](../hardware/storage.md)、[LVM 逻辑卷管理](../system-management/lvm.md) | 已覆盖 |
| 第 5 章 | How the Linux Kernel Boots | [开机流程](../basic/boot.md)、[开机流程与引导排错](../system-management/boot-process.md) | 已覆盖 |
| 第 6 章 | How User Space Starts | [开机流程与引导排错](../system-management/boot-process.md)、[systemd 服务与程序管理](../system-management/services-systemd.md) | 已覆盖 |
| 第 7 章 | System Configuration: Logging, System Time, Batch Jobs, and Users | [日志系统管理](../system-management/logging.md)、[例行性工作排程](../system-management/scheduled-tasks.md)、[NTP 时间服务](../server/ntp.md)、[账号管理](../basic/users/account_management.md)、[PAM 与 sudo](../security/pam-sudo.md) | 已覆盖 |
| 第 8 章 | A Closer Look at Processes and Resource Utilization | [进程管理](../commands/system/process.md)、[系统监控工具](../commands/system/monitoring.md)、[性能优化](../system-management/performance.md)；cgroups 见容器与 KVM 页 | 已覆盖 |
| 第 9 章 | Understanding Your Network and Its Configuration | [网络配置基础](../network/network-configuration.md)、[TCP/IP 要点](../network/tcpip-essentials.md)、[路由与 NAT](../server/routing-nat.md)、[防火墙](../network/firewall.md) | 已覆盖 |
| 第 10 章 | Network Applications and Services | [SSH 远程登录](../server/ssh.md)（fail2ban 衔接[入侵检测](../security/intrusion-detection.md)）、[网络工具](../commands/network/network-tools.md) | 已覆盖 |
| 第 11 章 | Introduction to Shell Scripts | [脚本篇](../script/README.md) 全篇 | 已覆盖 |
| 第 12 章 | Network File Transfer and Sharing | rsync 见[备份与恢复](../system-management/backup-and-recovery.md)、[NFS](../server/nfs.md)、[Samba](../server/samba.md)；SSHFS 未单列 | 已覆盖（SSHFS 未单列） |
| 第 13 章 | User Environments | [变量与数据类型](../script/variables.md)（环境变量与启动文件）；提示符部分沿用 TLCL 第 13 章登记 | 已覆盖 |
| 第 14 章 | A Brief Survey of the Linux Desktop and Printing | [桌面图形栈](../hardware/desktop-stack.md)；打印部分同 USAH 第 12 章判定 | 已覆盖（打印不覆盖登记） |
| 第 15 章 | Development Tools | gcc/make/lex/yacc 开发工具链，ArchWiki 核对轮已判 2.x 开发工具链不覆盖，沿用 | 不覆盖（登记） |
| 第 16 章 | Introduction to Compiling Software from C Source Code | [源码编译与 Tarball 安装](../basic/packages/tarball.md) | 已覆盖 |
| 第 17 章 | Virtualization | [KVM 虚拟化](../server/virtualization/kvm.md)、[容器](../server/container/docker.md)；章内 Kubernetes 小节同 Linux Bible 第 31 章判定 | 已覆盖 |

17 章判定小计：已覆盖 15、部分覆盖→登记不补 1（设备文件与 udev）、不覆盖 1（开发工具链，沿用既有判定）。

## 8. 按 The Linux Bible 11e 核对（31 章）

来源目录见[权威书籍调研](./authoritative-books.md) 2.1 节（Wiley 官方产品页 + TOC PDF，A 级，2026-10-10 实取）。此书面向入门到中级的发行版实操，逐章判定如下。

| Linux Bible 章节 | 主题 | 本仓落点 | 判定 |
|------------------|------|---------|------|
| 第 1 章 | Starting with Linux | [Linux 简介](../basic/introduction.md)、[技术概论](../basic/overview.md)、[选择合适的发行版](../basic/installation/choose_distribution.md) | 已覆盖 |
| 第 2 章 | Creating the Perfect Linux Desktop | [桌面图形栈](../hardware/desktop-stack.md) | 已覆盖 |
| 第 3 章 | Using the Shell | [Bash 基础](../script/bash-basics.md)、[基本命令](../commands/basic.md) | 已覆盖 |
| 第 4 章 | Moving Around the Filesystem | [目录操作](../commands/basic/directory.md)、[文件操作](../commands/basic/file.md) | 已覆盖 |
| 第 5 章 | Working with Text Files | [文本编辑和查看工具](../commands/text/editors.md)、[文本处理](../commands/text/text_processing.md) | 已覆盖 |
| 第 6 章 | Managing Running Processes | [进程管理](../commands/system/process.md) | 已覆盖 |
| 第 7 章 | Writing Simple Shell Scripts | [Bash 基础](../script/bash-basics.md)、[脚本篇](../script/README.md) | 已覆盖 |
| 第 8 章 | Learning System Administration | [系统管理篇](../system-management/README.md) 全篇 | 已覆盖 |
| 第 9 章 | Installing Linux | [安装 Linux](../basic/installation.md)（三系并写） | 已覆盖 |
| 第 10 章 | Getting and Managing Software | [软件安装](../basic/packages.md) 章四页、[包管理命令](../commands/package/package.md) | 已覆盖 |
| 第 11 章 | Managing User Accounts | [账号管理](../basic/users/account_management.md) | 已覆盖 |
| 第 12 章 | Managing Disks and Filesystems | [文件系统](../basic/filesystem.md)、[存储设备](../hardware/storage.md)、[LVM 逻辑卷管理](../system-management/lvm.md) | 已覆盖 |
| 第 13 章 | Understanding Server Administration | [服务器篇](../server/README.md)、[SSH 远程登录](../server/ssh.md)、[系统监控工具](../commands/system/monitoring.md) | 已覆盖 |
| 第 14 章 | Administering Networking | [网络配置基础](../network/network-configuration.md)、[网络管理命令](../commands/network/network.md) | 已覆盖 |
| 第 15 章 | Starting and Stopping Services | [systemd 服务与程序管理](../system-management/services-systemd.md) | 已覆盖 |
| 第 16 章 | Configuring a Print Server | 同 USAH 第 12 章判定 | 不覆盖（登记） |
| 第 17 章 | Configuring a Web Server | [Nginx](../server/web/nginx.md)、[Apache](../server/web/apache.md) | 已覆盖 |
| 第 18 章 | Configuring an FTP Server | [FTP 服务器](../server/ftp.md) | 已覆盖 |
| 第 19 章 | Configuring a Windows File Sharing (Samba) Server | [Samba](../server/samba.md) | 已覆盖 |
| 第 20 章 | Configuring an NFS File Server | [NFS](../server/nfs.md) | 已覆盖 |
| 第 21 章 | Troubleshooting Linux | [网络故障排除](../network/troubleshooting.md)、[脚本调试](../script/debugging.md)、[开机流程与引导排错](../system-management/boot-process.md) | 已覆盖 |
| 第 22 章 | Configuring an Artificial Intelligence Chatbot | LLM 本地部署与应用配置，属应用软件范畴，与「学 Linux 系统本身」定位不同 | 不覆盖 |
| 第 23 章 | Understanding Basic Linux Security | [安全加固](../security/hardening.md)、[防火墙](../security/firewall.md) | 已覆盖 |
| 第 24 章 | Understanding Advanced Linux Security | [加密与证书](../security/encryption.md)、[PAM 与 sudo](../security/pam-sudo.md) | 已覆盖 |
| 第 25 章 | Enhancing Linux Security with SELinux | [SELinux 实战](../security/selinux.md)、[SELinux 概念](../basic/security/concept.md) | 已覆盖 |
| 第 26 章 | Securing Linux on a Network | [防火墙](../network/firewall.md)、[SSH 远程登录](../server/ssh.md)（加固节） | 已覆盖 |
| 第 27 章 | Shifting to Clouds and Containers | [云计算与 cloud-init](../server/cloud-computing.md)、[容器](../server/container/docker.md) | 已覆盖 |
| 第 28 章 | Using Linux for Cloud Computing | [云计算与 cloud-init](../server/cloud-computing.md)（IaaS 模型、实例与镜像、安全组与 VPC） | 已覆盖 |
| 第 29 章 | Deploying Linux to the Cloud | 云厂商（AWS 等）控制台与特定平台实操，超出单机学习定位；本仓云计算页只到概念与跨云通用机制 | 部分覆盖→登记不补 |
| 第 30 章 | Automating Apps and Infrastructure with Ansible | [自动化运维](../system-management/automation.md) | 已覆盖 |
| 第 31 章 | Deploying Applications as Containers with Kubernetes | 多节点编排无独立落点；[容器](../server/container/docker.md) Compose 节已写明「超出单机范围后再评估 Kubernetes」的边界判断 | 部分覆盖→登记不补 |

31 章判定小计：已覆盖 27、部分覆盖→登记不补 2（云厂商控制台部署、Kubernetes 编排）、不覆盖 2（打印服务器、AI Chatbot）。

## 9. 按应用场景核对

场景要求见[应用场景调研](./application-scenarios.md) 第 2 节。

| 场景 | 关键要求 | 本仓现状 | 判定 |
|------|---------|---------|------|
| 服务器与云 | 三系命令并排、存量系统迁移视角、多架构 | 服务器篇 21 页 + 系统管理篇 9 页，三系对照贯穿全仓 | 已覆盖 |
| 边缘与嵌入式 | 交叉编译、设备树、启动链路、无图形界面 | 此前设备树仅在[设备驱动框架](../source/driver-framework.md)提及 | 缺口→已补页 [交叉编译与嵌入式](../source/cross-compile.md) |
| 桌面与开发 | Xorg/Wayland、显示管理器、桌面环境、输入法与字体 | 零散提及 | 缺口→本轮补页 |
| 运维自动化 | 调度、编排、监控、备份、账号一致性 | 自动化、监控、备份、排程四条主线已有；账号一致性已补 | 缺口→已补页 [LDAP 统一账号管理](../server/ldap.md) |
| 安全合规 | MAC 强制访问控制在两套发行版上的差异 | SELinux 成体系，AppArmor 此前只有对照表一行 | 缺口→本轮补页 |
| 虚拟化 | KVM/libvirt 建机与网络，与容器的分工 | 硬件篇给了安装命令，服务器篇此前只有容器页 | 缺口→已补页 [KVM 虚拟化](../server/virtualization/kvm.md) |

## 10. 差异汇总

| 类型 | 数量 | 明细 |
|------|------|------|
| 缺口→已补页 | 11 | Arch 包管理（Pacman）、LVM 实操、桌面图形栈、KVM 虚拟化、AppArmor、应用场景页；后续增量补齐：交叉编译与嵌入式、LDAP 统一账号（2026-10-09）、SSH 远程登录、云计算与 cloud-init、CI/CD 与持续交付（USAH，2026-10-10） |
| 缺口→登记后补齐 | 2 | 嵌入式交叉编译专题、LDAP 统一账号（首轮登记、次轮补页，已并入上行） |
| 部分覆盖→本轮修订与补页 | 4 | 存储篇 LVM 指向落地、基础篇软件安装章目录补第三系、systemd 官方文档引用补链（services-systemd、boot-process 两页）；源码编译与 Tarball 补页（2026-10-10） |
| 不覆盖（有意） | 4 类 | 笔记本适配、开发工具链、点对点/流媒体、VoIP |
| 按 USAH/TLCL 逐章核对登记（2026-10-10） | 不补 6 类 | 打印 CUPS（USAH 第 12 章 / TLCL 第 22 章，桌面办公外围）、SSO 完整部署（USAH 第 17 章，需 KDC 与域环境）、readline 键绑定与 history 扩展（TLCL 第 8 章）、排版小工具（TLCL 第 21 章）、提示符个性化（TLCL 第 13 章）、shell 杂项技巧（TLCL 第 36 章）；另 USAH 第 30 章（机房设施）、第 31 章（组织流程）判不覆盖 |
| 按 Debian Handbook 逐章核对登记（2026-10-10） | 不补 2 类 | 实时通信与代理服务（第 11 章的 Squid、SIP/XMPP/TURN——企业专用协议栈，与单机学习主线弱相关，Postfix/Apache/NFS/Samba/LDAP 五项已有独立页）、Debian 打包工作流（第 15 章，`dpkg-buildpackage` 属发行版打包者技能，非系统管理主线，源码编译已由 Tarball 页覆盖）；另第 2 章（案例叙事）、第 16 章（社区展望）判不覆盖 |
| 按 How Linux Works / Linux Bible 逐章核对登记（2026-10-10 次轮） | 不补 4 类 | 设备文件与 udev（HLW 第 3 章，机制散见存储、systemd 与源码篇，规则细节属设备适配）、云厂商控制台部署（Linux Bible 第 29 章，特定平台实操）、Kubernetes 编排（Linux Bible 第 31 章与 HLW 第 17 章小节，容器页已有单机/多节点边界判断）、AI Chatbot 部署（Linux Bible 第 22 章，应用软件范畴）；另 HLW 第 15 章（开发工具链）沿用不覆盖判定，Linux Bible 第 16 章（打印服务器）沿用打印登记 |

本轮补页与修订的执行记录见[缺口补全与核对修订](./gap-fill.md)。
