# 系统日志

"服务起不来先看日志"是共识，但真正打开 `/var/log` 的人往往会被两个问题绊住：日志到底是谁写进去的？`auth`、`daemon`、`kern` 这些facility 又是从哪冒出来的？答案是一条固定链路——应用把消息丢给 `/dev/log` 或直接写 stdout，**journald** 作为 systemd 自带的采集器先落一份结构化二进制 journal，再由 **rsyslog** 按 `/etc/rsyslog.conf` 的规则分流成 `/var/log/syslog`、`messages`、`secure` 等文本文件。本页讲清这条链路的上下游关系、syslog 协议的 severity/facility 分类、rsyslog 规则与远程转发，以及 Arch 默认只装 journald 时的差异；同时覆盖 `journalctl` 的常用查询与 journal 持久化——不理解持久化，断电后你连昨晚的日志都找不到。

> 内容参考自 rsyslog 文档、Arch Wiki 与鸟哥的私房菜，见文末参考资料。

## 学习目标

- 画出 journald → rsyslog → 文本文件的日志链路，说清两者是上下游而非竞争
- 掌握 syslog 的 severity（0–7）与 facility 分类，能读懂 rsyslog 规则
- 会配置 rsyslog 分流、远程转发，并知道 Arch 默认只装 journald 的差异
- 熟练使用 `journalctl` 按 unit、时间、优先级、内容检索
- 理解 journal 持久化的意义，会开启、限大小、清理

## 1. 日志链路：journald 与 rsyslog 的分工

先回答最容易困惑的问题：**journald 和 rsyslog 是竞争关系吗？不是，是上下游关系。**

```text
应用写 /dev/log ─┐
服务 stdout/stderr ┼─▶ systemd-journald ──┬─▶ /var/log/journal/（二进制，journalctl 读）
内核 /dev/kmsg   ─┘         │             └─▶ rsyslog ──▶ /var/log/syslog、messages 等文本
                            │                      ▲
                            └── ForwardToSyslog / imjournal ──┘
```

- **systemd-journald**：systemd 自带的采集器，监听 `/dev/kmsg` 和 `/dev/log`，把每条消息连同 `_SYSTEMD_UNIT`、`_PID`、优先级等结构化字段一起存入二进制 journal 文件。它默认不依赖任何外部日志程序就能工作。
- **rsyslog**：传统 syslog 实现的现代版本，从 journald 拉取（imjournal 模块）或被 journald 推送（`ForwardToSyslog=yes`），再按 `/etc/rsyslog.conf` 的规则分流写入文本文件。它还负责远程转发（`@host`）、更复杂的条件过滤。
- **syslog-ng**：rsyslog 的同类替代品，配置语法不同（用 `destination`/`log` 语句），功能定位相似。三发行版默认都不装 syslog-ng，需要时自行安装并与 journald 对接。

默认情况下（Debian/Ubuntu、RHEL 系）：**journald 是第一落点，rsyslog 是落盘执行者**。Arch 默认只有 journald，文本文件 `/var/log/messages` 等需安装 rsyslog 后才有：

```bash
# Arch 按需安装并启用 rsyslog
$ sudo pacman -S rsyslog
$ sudo systemctl enable --now rsyslog
```

注意启用顺序：Arch 上若先 `start rsyslog` 再 `enable`，可能因缺少 `syslog.service` 符号链接而依赖失败；`systemctl enable --now rsyslog` 一步完成可避开。配置 imjournal 或 `ForwardToSyslog` 二选一即可让 rsyslog 拿到数据，详见 [Arch Wiki - Rsyslog](https://wiki.archlinux.org/title/Rsyslog)。

## 2. 日志级别（severity）

syslog 定义了 0–7 共八个紧急程度，数字越小越严重。`journalctl -p` 和 rsyslog 规则都使用这套词汇：

| 级别 | 数值 | 说明 | 典型例子 |
|------|------|------|---------|
| emerg | 0 | 系统不可用 | 内核崩溃、systemd 核心转储 |
| alert | 1 | 需要立即处理 | 关键子系统失效、数据丢失风险 |
| crit | 2 | 严重条件 | 主程序崩溃、核心转储 |
| err | 3 | 错误条件 | 非致命失败：端口绑定失败、磁盘只读 |
| warning | 4 | 警告 | 分区剩余不足、证书即将过期 |
| notice | 5 | 正常但重要 | 挂载点非空仍继续挂载 |
| info | 6 | 信息性消息 | 服务启动成功、逻辑卷激活 |
| debug | 7 | 调试消息 | 需显式开启才输出 |

记忆口诀（从 7 到 0）：**D**o **I** **N**otice **W**hen **E**vents **C**ome **A**round **E**arly。

`journalctl -p err` 表示"err 及更高（数值更小）"，即 err/crit/alert/emerg 全部显示；范围写法 `warning..alert` 只取闭区间。

## 3. facility：谁产生的日志

severity 说"多严重"，facility 说"谁说的"。两者组合才能精确定位，rsyslog 规则的第一列就是 facility：

| facility | 含义 | 常见去向 |
|----------|------|---------|
| kern | 内核消息 | `kern.log`（Debian）或 journal |
| auth / authpriv | 认证与授权 | `auth.log`（Debian）/ `secure`（RHEL） |
| daemon | 系统守护进程 | `messages` / `syslog` |
| cron | 计划任务 | 独立文件或 messages |
| mail | 邮件系统 | `mail.log` |
| local0–local7 | 自定义留白 | 应用自定义分流 |

RHEL/CentOS/Rocky 认证日志走 `authpriv`，Debian/Ubuntu 走 `auth`——这是两系 `/etc/rsyslog` 规则不一致的历史原因，迁移脚本时别写死 facility 名。

## 4. rsyslog 配置

配置入口三系一致：

```bash
/etc/rsyslog.conf        # 主配置
/etc/rsyslog.d/*.conf    # 片段（推荐放这里，便于包管理）
```

规则语法：`facility.severity  动作`，`.` 表示"和"，`*` 表示"全部"，多个值用逗号分隔：

```bash
# /etc/rsyslog.d/50-default.conf（节选，三系通用写法）
auth,authpriv.*          /var/log/auth.log     # Debian/Ubuntu 认证日志
# authpriv.*             /var/log/secure       # RHEL/CentOS/Rocky 对应

*.emerg                  :msg:omusrmsg:*       # 紧急消息广播给所有登录用户
cron.*                   /var/log/cron
mail.*                   -/var/log/maillog     # - 前缀表示写入时不 flush（提高性能）

# 只收集 err 及以上到单独文件
*.err;auth.none          /var/log/errors.log

# 转发到远程收集器（TCP 514）：*.*   @192.168.10.20:514
```

修改后重载配置（不要 restart，避免丢消息）：

```bash
$ sudo systemctl reload rsyslog
# 或
$ sudo kill -HUP $(pidof rsyslogd)
```

**注意**：rsyslog 只有在 journald 的数据能到达它时才会写文件。Debian/Ubuntu 与 RHEL 出厂已配好；Arch 需自行配置 imjournal 或 `ForwardToSyslog=yes`（改 `/etc/systemd/journald.conf` 后要 `systemctl restart systemd-journald`）。

## 5. 查看与检索

### 5.1 文本日志（rsyslog 落盘后）

```bash
# Debian/Ubuntu
$ sudo tail -f /var/log/syslog
Sep 22 11:02:44 web01 systemd[1]: Started Daily apt download activities.

# RHEL/CentOS/Rocky
$ sudo tail -f /var/log/messages
Sep 22 11:02:44 web01 systemd[1]: Started Daily log rotation.

# 搜索（配合第 2、3 节的分类思维）
$ sudo grep -E 'error|fail' /var/log/syslog | tail -20
$ sudo grep 'sshd' /var/log/auth.log | tail -5    # Debian
$ sudo grep 'sshd' /var/log/secure | tail -5      # RHEL
```

### 5.2 journalctl（结构化查询）

```bash
journalctl                          # 全部日志（分页，q 退出）
journalctl -b                        # 本次启动；-b -1 为上次启动
journalctl -u nginx                 # 指定服务
journalctl -f                       # 实时跟踪
journalctl -p err                   # err 及以上；warning..alert 为闭区间
journalctl --since "1 hour ago"     # 时间窗口（也支持绝对时间）
journalctl -k                       # 仅内核（等价 dmesg）
journalctl --grep "bind\(\) to"     # 内容检索（PCRE）
journalctl -o json-pretty -u nginx  # 结构化输出便于脚本处理
```

## 6. journal 持久化：为什么必须关心

journal 的存储位置决定日志能否活过重启：

| Storage 设置 | 实际路径 | 重启后 |
|--------------|---------|--------|
| `auto`（默认之一） | 有 `/var/log/journal` 则落盘，否则用 `/run/log/journal` | 可能丢失 |
| `persistent` | `/var/log/journal/` | 保留 |
| `volatile` | `/run/log/journal/` | 丢失 |

**为什么需要持久化**：排障最常见的时间线是"昨晚出事，今早发现"。若 journal 只在 `/run`（tmpfs），重启一次 `-b -1` 就空了，内核 panic 前的最后日志也全部蒸发。服务器强烈建议持久化；内存受限的嵌入式设备可以接受 volatile。

开启方法（三系通用）：

```bash
$ sudo mkdir -p /var/log/journal
$ sudo systemctl restart systemd-journald
$ journalctl --disk-usage     # 确认开始占用磁盘
```

或在 `/etc/systemd/journald.conf`（推荐用 drop-in `/etc/systemd/journald.conf.d/*.conf`）写：

```ini
[Journal]
Storage=persistent
SystemMaxUse=400M
```

`SystemMaxUse` 必须配：默认约为文件系统容量的 10%（软上限 4 GiB），小盘仍可能被写满。改完 `systemctl restart systemd-journald` 生效。手动清理：

```bash
$ sudo journalctl --vacuum-size=200M
$ sudo journalctl --vacuum-time=14days
```

## 7. 常见坑

1. **找不到 `/var/log/syslog`**：Arch 默认未装 rsyslog，或该发行版本来就用别的文件名（RHEL 是 `messages`）。先 `ls /var/log/` + `journalctl -b -1` 确认入口，不要断定"日志丢了"。
2. **`journalctl -b -1` 为空**：journal 未持久化，上一次启动的记录已随 `/run` 清空。按第 6 节开启。
3. **改了 rsyslog 配置不生效**：用 `reload` 而非盲目 `restart`；且确认 journald 的数据真的到了 rsyslog（Arch 上常见只装了 rsyslog 却没配 imjournal/ForwardToSyslog）。
4. **规则写对了但文件不增长**：facility 写错（如 RHEL 上写 `auth.*` 而实际走 `authpriv`），或该 facility 的消息根本没有产生。用 `journalctl --facility=authpriv` 对照验证。
5. **普通用户执行 journalctl 只看到自己的日志**：系统日志需 root，或将用户加入 `systemd-journal`/`adm` 组。
6. **把安全事件当普通日志翻**：SELinux/audit 拒绝在 `/var/log/audit/audit.log`，用 `ausearch`；防火墙丢包见 firewalld/nftables 日志。本篇不展开，见[安全基础](../security.md)与[网络篇 · 防火墙](../../network/firewall.md)。
7. **时间线错乱**：系统时钟不准会导致日志时间戳穿越（journalctl 会提示 clock jumped）。先 `timedatectl` 确认 NTP 同步，再解读日志时间。

## 参考资料

- `man rsyslog.conf`、`man journalctl`、`man syslog`
- Arch Wiki - rsyslog — [wiki.archlinux.org](https://wiki.archlinux.org/title/Rsyslog)
- Arch Wiki - systemd/Journal — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Journal)
- 鸟哥的私房菜 - 认识与分析登录档 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0570syslog.php)
- journalctl 手册页 — [man7.org](https://man7.org/linux/man-pages/man1/journalctl.1.html)
- journald.conf 手册页 — [man7.org](https://man7.org/linux/man-pages/man5/journald.conf.5.html)
