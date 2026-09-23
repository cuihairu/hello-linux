# 日志系统

## 本章导语

故障排查、容量告警、安全审计——运维工作中最常见的三类问题，最终都要落到日志上才能定位。Linux 的日志体系由三块拼成：**journald** 负责收集结构化日志并提供 `journalctl` 查询，**rsyslog/syslog-ng** 负责按规则把消息落盘成 `/var/log` 下的文本文件，**logrotate** 负责在文件长得太大之前完成轮转、压缩和清理。本章把日志协议、优先级/facility 分类、rsyslog 配置和轮转策略讲透，帮你建立"日志从产生到落盘、再到过期回收"的完整链路认知。

"服务起不来"、"凌晨磁盘满了"、"有人试图爆破 SSH"——这些场景的共同点是：没有日志，你只能靠猜。本章不重复[系统服务](./services.md)章已讲过的 `journalctl -u` 服务排查流程，而是聚焦日志体系本身的结构与维护：日志协议如何定义消息的来源与严重程度，rsyslog 如何按规则把消息分流到不同文件，logrotate 如何在文件撑爆磁盘之前完成轮转。理解这三层分工后，无论换哪个发行版、哪种日志工具，你都能快速判断"日志去哪了"和"该看哪里"。

> 内容参考自 Arch Wiki、鸟哥的私房菜与各工具官方文档，见文末参考资料。

## 为什么需要单独学日志

两个真实场景说明问题：

**场景一：断电后查不到昨晚的日志。** journald 默认可能只把日志放在 `/run/log/journal/`（内存文件系统），重启即清空。不知道"持久化"这个概念，故障排查会在第一步就断线。

**场景二：日志把磁盘写满，服务集体失败。** 某个应用每分钟写 10 MB 日志，没人轮转，一个月后 `/var/log` 占满分区，数据库拒绝写入。logrotate 的存在就是为了解决"日志无限增长"这个必然会发生的物理问题——但默认的 `daily` 策略对高流量应用往往不够，需要理解大小、时间、压缩、postrotate 各自解决什么问题，才能写出正确的配置。

日志体系还有一层历史包袱：syslog 协议（RFC 5424）诞生于 1980 年代，定义了 facility（谁说的）和 severity（多严重）两套分类，今天的 journald 和 rsyslog 仍然沿用这套词汇。不理解这两套分类，就看不懂 `/etc/rsyslog.conf` 里 `authpriv.*  /var/log/secure` 这类规则，也用不好 `journalctl -p err`。

> 内容参考自 systemd/journald、syslog 与 Arch Wiki，见各章节参考资料。

## 学习目标

- 理解 journald 与 rsyslog/syslog-ng 的分工：谁收集、谁落盘、为什么两者常常并存
- 掌握 syslog 的 facility 与 severity 分类，能读懂 rsyslog 配置规则
- 熟练使用 `journalctl` 的常用查询：按 unit、按时间、按优先级、按内容检索
- 理解 journal 持久化的意义，知道如何开启、限制大小和手动清理
- 掌握 logrotate 的轮转策略设计：为什么需要大小/时间双条件、压缩与 delaycompress 的取舍、postrotate 的正确用法

## 子页导读

| 章节 | 回答什么问题 | 建议阅读时机 |
|------|-------------|--------------|
| [系统日志](./log/syslog.md) | 日志从产生到落盘的链路；facility/severity 分类；rsyslog 配置规则；journald 与 syslog 的关系；journalctl 查询与持久化 | 想系统理解"日志去哪了"、需要配置 rsyslog 规则时 |
| [日志轮转](./log/rotation.md) | 为什么要轮转；logrotate 配置项各自解决什么问题；postrotate/copytruncate 的选择；journal 的空间回收 | 日志文件过大、轮转不生效、或要为自研服务写轮转规则时 |

两页与[系统服务/日志管理](./services/log_management.md)的分工：后者面向"**排查某个服务为什么挂了**"的日常流程，本章面向"**日志体系本身如何工作与维护**"。防火墙日志与安全审计不在此章，见[网络篇 · 防火墙](../network/firewall.md)与[安全基础](./security.md)。

## 三系差异速览

| 对比项 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------|---------------|------|--------------------|
| 默认日志守护 | systemd-journald + rsyslog | systemd-journald（rsyslog 可选，默认不装） | systemd-journald + rsyslog |
| 通用日志文件 | `/var/log/syslog` | 多为 journal，装 rsyslog 后常见 `/var/log/messages` | `/var/log/messages` |
| 认证日志 | `/var/log/auth.log` | journal + auditd | `/var/log/secure` |
| journal 持久化 | 通常默认开启 | systemd 包含 `/var/log/journal/`，默认 persistent | 通常默认开启 |
| logrotate 触发 | cron 每日任务 | `logrotate.timer`（systemd timer） | cron 每日任务 / `logrotate.timer` |
| 包安装 | `apt install rsyslog` | `pacman -S rsyslog`（按需） | `dnf install rsyslog`（默认已装） |

注意 Arch 的差异：官方基线里 rsyslog 不是必装组件，**默认只有 journald**。这不影响 `journalctl` 使用，但意味着 `/var/log/syslog` 这类文件可能根本不存在——从 Debian/RHEL 迁移过来的管理员第一反应"日志丢了"，其实只是查看入口不同。

## 常见问题

**Q：`journalctl` 和 `tail -f /var/log/syslog` 应该用哪个？**
日常查服务优先 `journalctl -u <unit>`，结构化字段过滤更准；需要跨服务自由 grep、或给只认文本的采集器（Filebeat 等）用 `/var/log` 文件。两者数据同源（rsyslog 通常从 journald 获取），不是竞争关系。

**Q：日志目录该设多大上限？**
`journald.conf` 的 `SystemMaxUse` 给 journal 设上限（小分区建议显式设，如 500M）；文本日志交给 logrotate 按大小+保留份数控制。两层都要设，只设一层会在另一层翻车。

**Q：为什么轮转后新日志是空的/程序不写新文件了？**
程序握着旧文件句柄不放。要么在 postrotate 里发 HUP/USR1 让它重新打开，要么对不能重开句柄的程序用 `copytruncate`。详见轮转页的"常见坑"。

**Q：`logrotate -d` 显示会轮转，但系统里实际没转？**
手动 `-d` 只是调试；真正执行的是 cron 或 `logrotate.timer`。检查 `systemctl status logrotate.timer`（或对应 cron 条目）是否启用，以及 `/var/lib/logrotate.status` 里该文件上次轮转时间。

**Q：防火墙拒绝、SELinux 拒绝的日志也在这里看吗？**
不冲突但入口不同：防火墙日志多在 `/var/log/messages`/`journalctl -k` 或 firewalld 自身日志；SELinux 拒绝在 `/var/log/audit/audit.log`，用 `ausearch` 查，见[安全基础](./security.md)。本章聚焦通用日志链路与轮转，不重复安全篇内容。

## 参考资料

- 鸟哥的私房菜 - 认识与分析登录档 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0570syslog.php)
- Arch Wiki - systemd/Journal — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Journal)
- Arch Wiki - Rsyslog — [wiki.archlinux.org](https://wiki.archlinux.org/title/Rsyslog)
- Arch Wiki - Logrotate — [wiki.archlinux.org](https://wiki.archlinux.org/title/Logrotate)
- `man journalctl`、`man rsyslog.conf`、`man logrotate`
- journalctl 手册页 — [man7.org](https://man7.org/linux/man-pages/man1/journalctl.1.html)
- logrotate 手册页 — [man7.org](https://man7.org/linux/man-pages/man5/logrotate.conf.5.html)
