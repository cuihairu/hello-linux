# 日志管理

服务出问题时，第一个动作永远是看日志：进程有没有启动、启动时报了什么错、运行中又抛出了什么异常。Linux 上这套日志由 journald 收集、rsyslog 落盘，两者分工明确；本章讲清楚日志从产生到落盘的完整链路，以及三发行版下该去哪里找日志。

> 内容参考自 Arch Wiki、rsyslog 文档与鸟哥的私房菜，见文末参考资料。

## 1. 为什么日志链路有两层

SysV 时代只有 rsyslog 一个守护进程：所有程序往 `/dev/log` 写消息，rsyslog 按规则拆分到 `/var/log` 下的各个文件。systemd 普及后，`systemd-journald` 成为第一接收者，原因很实际：

- **服务的 stdout/stderr 天然进 journal**。用 `Type=simple` 起的服务，哪怕从不写日志文件，它的标准输出也会被 journald 捕获，不依赖程序自己实现 syslog。
- **结构化字段**。每条记录自带 `_SYSTEMD_UNIT`、`_PID`、`_COMM`、优先级等字段，`journalctl -u nginx` 一个过滤条件就能精准取数，不需要在几万行文本里 grep。
- **内核消息免费获得**。`/dev/kmsg` 直接进入 journal，`journalctl -k` 即可查看。

但 journald 并不取代 rsyslog，而是分工：

```
应用/内核 ──stdout、/dev/log──▶ systemd-journald ──(imjournal 或 ForwardToSyslog)──▶ rsyslog ──▶ /var/log/*.log
                                    │
                                    └──▶ /var/log/journal/（二进制，journalctl 读取）
```

现代发行版的默认形态是：**journald 负责收集与结构化查询，rsyslog 负责按传统规则落盘成文本文件**（给 logrotate、grep、第三方采集器消费）。只装了 journald 的最小系统（如部分 Arch 服务器）可以没有 rsyslog，此时 `/var/log` 下的 `syslog`、`messages` 文件不存在，全部日志以 journal 形式保存。

## 2. 三发行版日志文件位置

journald 之下的落盘文件名由 rsyslog 规则决定，三系并不相同：

| 日志内容 | Debian/Ubuntu | Arch（装 rsyslog 时） | RHEL/CentOS/Rocky |
|---------|---------------|----------------------|-------------------|
| 通用系统日志 | `/var/log/syslog` | `/var/log/messages` | `/var/log/messages` |
| 认证/登录 | `/var/log/auth.log` | `/var/log/audit/audit.log`（auditd） | `/var/log/secure` |
| 内核 | `/var/log/kern.log` | `/var/log/kern.log`（或 journal） | `/var/log/messages`（含内核段） |
| 包管理 | `/var/log/apt/` | `/var/log/pacman.log` | `/var/log/dnf.rpm.log` |
| journal 持久化 | `/var/log/journal/` | `/var/log/journal/` | `/var/log/journal/` |

Arch 默认不装 rsyslog，日志以 journal 为主；需要传统文本文件时 `pacman -S rsyslog` 并 `systemctl enable --now rsyslog` 即可，但要按 Arch Wiki 的说明配置 imjournal 或 `ForwardToSyslog`，否则 rsyslog 读不到数据。Debian/Ubuntu 与 RHEL 系开箱即带 rsyslog，无需额外安装。

## 3. journalctl：按服务查日志

`journalctl` 是排查服务问题的主力工具。记住一条经验：**服务刚启动失败，先看 unit 日志，再看配置文件**。

```bash
# 查看指定服务的完整日志（.service 后缀可省略）
$ journalctl -u nginx -n 20 --no-pager
Sep 22 10:01:12 web01 systemd[1]: Starting A high performance web server...
Sep 22 10:01:12 web01 nginx[2043]: nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)
Sep 22 10:01:12 web01 systemd[1]: nginx.service: Main process exited, code=exited, status=1/FAILURE
Sep 22 10:01:12 web01 systemd[1]: Failed to start A high performance web server and reverse proxy server.

# 实时跟踪（排查"边跑边报错"）
journalctl -u nginx -f

# 只看本次开机（排除历史启动的干扰）
journalctl -b -u nginx

# 上一次开机的日志（排查"重启导致业务中断"时的关键命令）
journalctl -b -1 -u nginx

# 按时间窗口
journalctl -u nginx --since "2026-09-22 09:00" --until "2026-09-22 10:30"
journalctl -u nginx --since "10 min ago"

# 按优先级过滤（只看警告及以上）
journalctl -u nginx -p warning..alert

# 内容检索（比管道 grep 高效，直接利用索引）
journalctl -u nginx --grep "bind\(\) to"
```

输出格式也值得掌握：`-o short-precise` 带微秒时间戳，`-o json-pretty` 方便脚本解析，`-x` 附带消息目录里的解释文字（提交 bug 时不要用 `-x`）。

## 4. 持久化：为什么以及怎么做

journald 有两种存储位置，决定了"断电后日志还在不在"：

| 存储 | 路径 | 特点 |
|------|------|------|
| 易失性（volatile） | `/run/log/journal/` | 只在内存/tmpfs，重启即清空 |
| 持久化（persistent） | `/var/log/journal/` | 落盘，重启后仍可查 |

**默认行为以发行版配置为准**：RHEL/CentOS/Rocky 与 Debian/Ubuntu 通常默认持久化；Arch 的 systemd 包带 `/var/log/journal/` 目录，默认 `Storage=persistent` 也倾向落盘。判断当前状态最直接的办法是看目录存不存在、`journald.conf` 怎么写：

```bash
$ ls -d /var/log/journal 2>/dev/null || echo "无持久化目录"
/var/log/journal

$ systemctl status systemd-journald | head -4
● systemd-journald.service - Journal Service
     Loaded: loaded (/usr/lib/systemd/system/systemd-journald.service; static)
     Active: active (running) since Mon 2026-09-21 08:14:58 CST; 1 day 2h ago
```

为什么必须持久化：服务器最常见的排障场景是"昨晚上还好好的，今早业务挂了"。如果 journal 只在内存里，重启后 `-b -1` 什么也查不到，故障直接变成悬案。持久化之后，断电前最后几秒的内核消息、服务崩溃栈都还在。

开启持久化只需让目录存在，然后重启 journald（或 `journalctl --flush`）：

```bash
sudo mkdir -p /var/log/journal
sudo systemctl restart systemd-journald
```

也可以编辑 `/etc/systemd/journald.conf`（或 drop-in）：

```ini
[Journal]
Storage=persistent
SystemMaxUse=500M
```

`SystemMaxUse` 必须设置。默认上限约为所在文件系统容量的 10%（软上限 4 GiB），小分区上仍可能被日志吃满磁盘。调整后重启 systemd-journald 生效；紧急瘦身用：

```bash
$ journalctl --disk-usage
Archived and active journals take up 312.4M in the file system.

$ sudo journalctl --vacuum-size=200M    # 归档日志压到 200M 以内
$ sudo journalctl --vacuum-time=2weeks  # 只保留最近两周
```

## 5. 查看传统文本日志

rsyslog 落盘后的文件用普通文本工具即可，三系命令一致，只是文件路径不同：

```bash
# Debian/Ubuntu
$ sudo tail -f /var/log/syslog
Sep 22 10:15:03 web01 systemd[1]: Started Daily apt download activities.

# RHEL/CentOS/Rocky
$ sudo tail -f /var/log/messages
Sep 22 10:15:03 web01 systemd[1]: Started Daily log rotation.

# 全文检索
$ sudo grep -n "error" /var/log/syslog
```

选择建议：**在线排查用 `journalctl -u`（结构化、带字段），离线取证或给不认 journal 的工具用 `/var/log` 文本**。两者内容大体同源，不是两套独立日志。

## 6. 常见坑

1. **权限不足看不到日志**：普通用户默认只能看自己的用户 journal；读系统日志需 root，或加入 `systemd-journal`、`adm`、`wheel` 组（视发行版而定）。
2. **重启后 `-b -1` 为空**：说明 journal 未持久化，上一次启动的日志已随 `/run` 清空。按第 4 节开启持久化。
3. **改了 `journald.conf` 不生效**：必须 `systemctl restart systemd-journald`；drop-in 放在 `/etc/systemd/journald.conf.d/*.conf`，避免升级覆盖主文件。
4. **以为 Arch 必须装 rsyslog**：不必。Arch 默认 journal 即可满足绝大多数排查；只有需要 `/var/log/messages` 这类文本文件、或要接入传统 syslog 管道时才 `pacman -S rsyslog`。
5. **日志文件被手工删除**：删 `/var/log/journal/*/system.journal` 会让历史查询直接断档；收缩请用 `--vacuum-*`，不要 `rm`。
6. **`journalctl -f` 卡住不动**：`-f` 默认只显示最近 10 行后进入跟踪；结合 `-u` 使用时请确认 unit 名拼写正确，否则会一直"没有输出"。
7. **在错误的文件里 grep 防火墙/安全事件**：本文只讲服务日志链路；防火墙规则与拒绝日志见[网络篇](../../network/firewall.md)与[安全篇](../../security/README.md)，审计与 SELinux 拒绝见[安全基础](../../security.md)。

## 参考资料

- `man journalctl`、`man journald.conf`、`man rsyslog.conf`
- Arch Wiki - systemd/Journal — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Journal)
- Arch Wiki - rsyslog — [wiki.archlinux.org](https://wiki.archlinux.org/title/Rsyslog)
- 鸟哥的私房菜 - 认识与分析登录档 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0570syslog.php)
- journalctl 手册页 — [man7.org](https://man7.org/linux/man-pages/man1/journalctl.1.html)
- journald.conf 手册页 — [man7.org](https://man7.org/linux/man-pages/man5/journald.conf.5.html)
