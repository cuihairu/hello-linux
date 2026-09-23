# 系统服务

装完系统之后，真正让这台机器"有用"的，是跑在后台的那批程序：sshd 让你远程登录，nginx 对外提供网页，cron 按时执行脚本。这些常驻后台、由系统统一拉起和看护的程序就是**系统服务**。一台服务器能否在断电重启后自动恢复业务，取决于服务是否被正确"启用"；一个服务出问题时能否快速定位，取决于你是否会查它的日志；一台新机器能否顺利上线，取决于你用对了哪套配置工具。本章把服务管理、日志排查、基础配置这三件高频事讲清楚，帮你建立 systemd 时代标准的运维操作流。

> 内容参考自 Arch Wiki、鸟哥的私房菜和各发行版官方文档，见文末参考资料。

## 本章导语

系统服务管理是 Linux 运维的日常主战场：`systemctl` 启停服务、`journalctl` 查日志、Netplan/nmcli 配网络——这些命令贯穿从装机到排障的全流程。本章分三节展开：**系统服务管理**讲 systemd 如何取代 SysV init、unit 文件结构、`enable` 与 `start` 的区别；**日志管理**讲服务日志的查看入口与 journald/rsyslog 分工；**系统配置工具**讲三发行版在文本配置哲学下的网络、时间、主机名配置差异。读完本章，你将能独立完成一台新服务器的基础配置与日常服务维护。

## 为什么先学服务管理

很多人被 Linux 坑的第一课不是命令敲错，而是搞混了"服务现在跑没跑"和"重启后还会不会跑"。你在机器上执行 `systemctl start nginx`，网页立刻能访问；晚上机器一重启，nginx 没起来，报警响成一片——服务确实启动过，但你从未让它**开机自启**。这类问题的根源在于：服务管理有"当下状态"和"持久化意图"两个维度，SysV init 时代用两套互不相通的机制（`service` 管当下、`chkconfig` 管开机），systemd 虽然把它们统一进了 `systemctl`，但 `start` 和 `enable` 依然是两个独立动作。

另一个动机是依赖关系。Web 服务依赖网络就绪，数据库依赖磁盘挂载；若还靠 SysV 脚本开头几行注释约定顺序，并行开机根本无从谈起。systemd 用 unit 文件里的声明式依赖把顺序交给框架处理，运维只需要读懂声明。

日志与配置是同一枚硬币的另外两面：服务出问题时，第一时间要能从 journald 或 `/var/log` 里找到线索；机器初始化时，三发行版的网络、时间、主机名配置方式各不相同，选错工具会走很多弯路。本章的另外两节分别解决这两个问题。

> 内容参考自 systemd 手册与 Arch Wiki，见各章节参考资料。

## 学习目标

- 理解 systemd 取代 SysV init 的动机，读懂一个 unit 文件的结构与依赖声明
- 熟练使用 `systemctl`，并能准确说出 `enable` 与 `start` 的区别（最高频的坑）
- 掌握 `journalctl` 查服务日志的常用姿势，理解 journald 与 rsyslog 的分工以及日志持久化的意义
- 了解 Debian/Ubuntu、Arch、RHEL/CentOS/Rocky 三系在默认防火墙、网络配置与服务来源上的差异
- 建立"文本配置优先"的运维习惯，会用 Netplan / systemd-networkd / nmcli 完成基础网络配置

## 子页导读

| 章节 | 回答什么问题 | 建议阅读时机 |
|------|-------------|--------------|
| [系统服务管理](./services/system_services.md) | systemd 为何取代 SysV；`systemctl` 操作；enable 与 start 的区别；unit 依赖与 timer | 第一次系统学习 systemd，或被"服务起不来、重启后消失"困扰时 |
| [日志管理](./services/log_management.md) | 服务日志在哪里、`journalctl` 怎么查、journald 与 rsyslog 如何分工、为什么要持久化 | 服务异常但不知道日志去哪找时 |
| [系统配置工具](./services/configuration_tools.md) | 文本配置哲学 vs GUI；三系网络配置（Netplan / systemd-networkd / nmcli）对照；时间与主机名 | 系统装好后的第一次基础配置 |

三页的分工可以这样记：**先用系统服务管理把服务跑起来，出问题去日志管理查日志，装机初始化看系统配置工具**。日志的协议细节与轮转策略另见[日志系统](./log.md)章节，防火墙与安全上下文分别见[网络篇](../network/README.md)与[安全基础](./security.md)。

## 三系差异速览

三个发行版都以 systemd 为初始化系统，`systemctl` 命令本身没有差别；差别集中在出厂默认值上：

| 对比项 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------|---------------|------|--------------------|
| 初始化系统 | systemd | systemd | systemd |
| 默认防火墙 | Ubuntu 默认启用 ufw；Debian 服务器通常不预开防火墙 | 无默认防火墙，由用户自选 nftables/ufw 等 | firewalld 默认启用并运行 |
| SSH 服务单元 | `ssh.service`（兼容 `sshd` 别名） | `sshd.service` | `sshd.service` |
| 默认网络组件 | Netplan（后端渲染到 systemd-networkd 或 NetworkManager） | 桌面常用 NetworkManager，服务器常用 systemd-networkd | NetworkManager |
| 强制访问控制 | AppArmor 默认启用 | 默认不启用 SELinux 也不启用 AppArmor | SELinux 默认 Enforcing |
| 服务来源 | `apt` 安装，包内自带 unit 文件 | `pacman` 安装，包内自带 unit 文件 | `dnf` 安装，包内自带 unit 文件 |

注意最后一行的共性：无论哪个发行版，**用包管理器安装服务后，unit 文件会随包部署，但"部署"不等于"启用"**——Arch 上用 `pacman` 装完 nginx 并不会让它开机自启，仍需手动 `systemctl enable --now nginx`。这一点三系完全一致，详见[系统服务管理](./services/system_services.md)。

## 常见问题

**Q：`systemctl start` 之后服务在跑，为什么重启就没了？**
`start` 只改变"当下"状态，没有创建开机自启链接。需要 `systemctl enable`，或一步到位 `systemctl enable --now`。这是本章最高频的坑。

**Q：改了 unit 文件，`systemctl status` 显示的还是旧配置？**
unit 文件被编辑后必须执行 `systemctl daemon-reload` 重新读取；已经运行的进程还要 `systemctl restart` 才会用上新配置。`daemon-reload` 只刷新 systemd 的认知，不会重启服务。

**Q：三系的防火墙命令为什么完全不一样？**
因为默认栈不同：Ubuntu/Debian 常用 ufw（前端），Arch 不预装防火墙，RHEL 系用 firewalld。防火墙规则本身属于网络与安全篇的内容，本章只交代默认差异，具体配置见[网络篇](../network/firewall.md)与[安全篇](../security/README.md)。

**Q：timer 和 cron 该用哪个？**
系统级定时任务优先用 systemd timer，它能继承服务依赖、日志直接进 journal；用户个人的零散任务继续用 crontab 也很正常。两者并存，不必强行迁移。

**Q：日志到底该看 `/var/log` 还是 `journalctl`？**
现代 systemd 发行版两者通常并存：journald 收集结构化日志（含内核与服务标准输出），rsyslog 负责落盘为 `/var/log` 下的文本文件。排查服务问题优先 `journalctl -u <unit>`，需要 grep 旧日志或给第三方工具读取时再看文件，详见[日志管理](./services/log_management.md)。

## 参考资料

- Arch Wiki - systemd — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd)
- Arch Wiki - systemd timers — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Timers)
- 鸟哥的私房菜 - 认识系统服务 (daemons) — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0560daemons.php)
- 鸟哥训练教材 - 服务管理与开机流程管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic_train/centos8/unit13.php)
- `man systemctl`、`man systemd.unit`
- Red Hat 文档 - 配置基本系统设置 (含 systemd 服务管理) — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_basic_system_settings/index)
