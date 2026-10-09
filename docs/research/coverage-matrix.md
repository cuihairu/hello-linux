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
| 第二十一章 | 软件安装：源代码与 Tarball | [压缩与归档](../commands/compression.md) 涉及 tarball | 部分覆盖（源码编译安装无独立小节） |
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
| 6.12 服务器 / 6.3.2 邮件服务器 | [服务器篇](../server/README.md) 15 页、[邮件](../server/mail/postfix.md) | 已覆盖 |
| 8.8 文件系统 | [文件系统](../basic/filesystem.md)、新页 [LVM 逻辑卷管理](../system-management/lvm.md) | 已覆盖 |
| 8.12 内核 | [源码篇](../source/README.md) 11 页 | 已覆盖 |
| 8.18 软件包管理 | [软件安装](../basic/packages.md)、新页 [Pacman 包管理](../basic/packages/pacman.md)、[包管理命令](../commands/package/package.md) | 已覆盖 |
| 8.20 安全 | [安全篇](../security/README.md)、[SELinux 概念](../basic/security/concept.md)、新页 [AppArmor 实战](../security/apparmor.md) | 已覆盖（两套 MAC 齐） |
| 8.23 虚拟化 | [容器](../server/container/docker.md)、新页 [KVM 虚拟化](../server/virtualization/kvm.md) | 已覆盖 |
| 8.6 视觉美化 / 8.10 图形用户界面 / 8.14 本地化 | 新页 [桌面图形栈](../hardware/desktop-stack.md) | 缺口→本轮补页 |
| 8.1 备份 / 8.2 引导过程 / 8.15 日志 / 8.16 监控 | [备份与恢复](../system-management/backup-and-recovery.md)、[开机流程与引导排错](../system-management/boot-process.md)、[日志系统管理](../system-management/logging.md)、[系统监控工具](../commands/system/monitoring.md) | 已覆盖 |

明确不跟的类目：4.9 笔记本电脑（按厂商列 33 个子类）、2.x 开发工具链、6.10 点对点与 6.13 流媒体、6.15 VoIP——这些是设备适配与应用软件目录，判定为**不覆盖**而非缺口。

## 4. 按应用场景核对

场景要求见[应用场景调研](./application-scenarios.md) 第 2 节。

| 场景 | 关键要求 | 本仓现状 | 判定 |
|------|---------|---------|------|
| 服务器与云 | 三系命令并排、存量系统迁移视角、多架构 | 服务器篇 19 页 + 系统管理篇 9 页，三系对照贯穿全仓 | 已覆盖 |
| 边缘与嵌入式 | 交叉编译、设备树、启动链路、无图形界面 | 此前设备树仅在[设备驱动框架](../source/driver-framework.md)提及 | 缺口→已补页 [交叉编译与嵌入式](../source/cross-compile.md) |
| 桌面与开发 | Xorg/Wayland、显示管理器、桌面环境、输入法与字体 | 零散提及 | 缺口→本轮补页 |
| 运维自动化 | 调度、编排、监控、备份、账号一致性 | 自动化、监控、备份、排程四条主线已有；账号一致性已补 | 缺口→已补页 [LDAP 统一账号管理](../server/ldap.md) |
| 安全合规 | MAC 强制访问控制在两套发行版上的差异 | SELinux 成体系，AppArmor 此前只有对照表一行 | 缺口→本轮补页 |

## 5. 差异汇总

| 类型 | 数量 | 明细 |
|------|------|------|
| 缺口→已补页 | 9 | Arch 包管理（Pacman）、LVM 实操、桌面图形栈、KVM 虚拟化、AppArmor、应用场景页；后续增量补齐：交叉编译与嵌入式、LDAP 统一账号（2026-10-09）、SSH 远程登录（2026-10-10） |
| 缺口→登记后补齐 | 2 | 嵌入式交叉编译专题、LDAP 统一账号（首轮登记、次轮补页，已并入上行） |
| 部分覆盖→本轮修订 | 3 | 存储篇 LVM 指向落地、基础篇软件安装章目录补第三系、systemd 官方文档引用补链（services-systemd、boot-process 两页） |
| 不覆盖（有意） | 4 类 | 笔记本适配、开发工具链、点对点/流媒体、VoIP |

本轮补页与修订的执行记录见[缺口补全与核对修订](./gap-fill.md)。
