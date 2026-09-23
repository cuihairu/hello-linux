# 日志轮转

日志文件不会自己变小：一个不停写日志的服务，一个月就能把 `/var/log` 撑满，进而拖垮数据库、让 `grep` 假死、把采集器压垮。轮转不是"可选的优化"，而是所有会产生日志的系统的必答题——logrotate 用一套声明式配置回答四个问题：**多久转一次、多大就转、转完留几份、旧文件怎么压**。本页从"不轮转会怎样"讲起，拆解 `/etc/logrotate.conf` 与 `/etc/logrotate.d/` 的分工、`postrotate` 与 `copytruncate` 在"程序握着旧句柄"场景下的选择依据，并给出为自研服务写一条可用规则、用 `logrotate -d` 验证的完整流程；同时厘清 logrotate 管文本文件、journal 空间回收走 journald 这条容易混淆的边界。

> 内容参考自 logrotate 手册与 Arch Wiki，见文末参考资料。

## 学习目标

- 说清为什么日志必须轮转，以及不轮转的两种典型事故（写满磁盘、查询变慢）
- 读懂 logrotate 配置结构：全局段、应用段、每行选项各解决什么问题
- 掌握 postrotate 与 copytruncate 的选择依据，知道程序握着旧句柄时怎么办
- 会为自研服务写一条可用的轮转规则，并用 `logrotate -d` 验证
- 分清 logrotate 管文本文件、journal 空间回收走 journald 的边界

## 1. 为什么必须轮转

一个不停写日志的文件会带来三个确定无疑的故障：

1. **磁盘写满**：`/var/log` 通常与 `/` 或独立分区同在，写满后数据库拒绝写入、系统无法记录任何事件，业务直接停摆。
2. **工具失速**：`grep`、`less` 打开一个 8 GB 的文本文件会耗尽内存或让终端假死，"查日志"这个动作本身变得不可行。
3. **采集过载**：Filebeat/Fluentd 等采集器按文件尾部读取，超大文件重启采集时的定位开销会成倍增加。

logrotate 的策略本质是回答四个问题：**多久转一次？（时间）多大就转？（大小）转完留几份？（保留）旧文件怎么压？（压缩）** 这四个问题对应四组配置项，下面逐个说明为什么这样选，而不是简单罗列选项。

## 2. 配置文件结构

```bash
/etc/logrotate.conf          # 主配置：全局默认值 + include 指令
/etc/logrotate.d/            # 应用片段（包管理器安装的服务自动投放在此）
/var/lib/logrotate/status    # 状态文件：记录每个文件上次轮转时间（不要手改）
```

主配置负责 `include /etc/logrotate.d/*.conf` 和全局默认（如 `rotate 4`、`compress`），应用专属规则写在 `/etc/logrotate.d/` 下的独立文件里，升级包时不会被覆盖。Debian/Ubuntu、RHEL/CentOS/Rocky 安装 rsyslog/nginx 等包时会自动投放对应片段；Arch 需确认 `logrotate.timer` 在跑：

```bash
$ systemctl status logrotate.timer
● logrotate.timer - Daily log rotation
     Loaded: loaded (/usr/lib/systemd/system/logrotate.timer; enabled; ...)
     Active: waiting since Mon 2026-09-21 00:00:00 CST; 1 day 11h ago
    Trigger: Tue 2026-09-23 00:00:00 CST; 12h left
```

Debian/Ubuntu 与 RHEL 系默认通过 cron 每日执行 `/etc/cron.daily/logrotate`；Arch 用上面这个 systemd timer。无论哪种触发方式，**手动 `logrotate -f` 只是临时补一次，下次仍按计划任务跑**。

## 3. 配置示例与逐行解释

```bash
# /etc/logrotate.d/myapp
/var/log/myapp/*.log {
    daily                  # 时间条件：每天最多轮一次
    rotate 14              # 保留 14 份历史，第 15 份开始删除
    compress               # 旧文件用 gzip 压成 .gz
    delaycompress          # 延迟到下一轮再压（配合 postrotate，见下文）
    size 100M              # 另一条触发线：单文件超过 100M 就转（与 daily 并存时看谁先满足）
    missingok              # 文件不存在时跳过不报错
    notifempty             # 空文件不轮转
    create 0640 root adm   # 轮转后立即以指定属主/权限创建新文件
    sharedscripts          # 通配符匹配多个文件时，postrotate 只跑一次
    postrotate
        systemctl reload nginx > /dev/null 2>&1 || true
    endscript
}
```

几个容易被忽略的设计点：

- **`create` 的权限必须与原文件一致**。漏写 `create` 时新文件以 logrotate 进程 umask 创建，常见变成 `root:root 0600`，nginx 的 worker（`www-data`）再也没法写日志——症状是"轮转之后日志静默停止"，极难一眼看出。
- **`size` 与时间条件的关系**：手册明确 `size` 与 `daily/weekly/monthly/yearly` 互斥——同时写时**后写的那个生效**（后写覆盖先写）。想要"每天至少转一次、但超过 100M 提前转"的语义，应使用 `daily` + `maxsize 100M`（达到 maxsize 就提前转，否则等时间到）；`minsize` 则相反：时间到了但不足阈值就不转。把 `size` 误当 `maxsize` 是最常见的配置错误。
- **`notifempty`**：日志服务重启后常产生 0 字节文件，轮转它没有意义还会污染序号。

## 4. postrotate 与 copytruncate：程序还握着旧文件怎么办

轮转的默认动作是把 `app.log` **改名**为 `app.log.1` 再新建 `app.log`。问题是：正在运行的程序仍持有对 `app.log.1` 的文件描述符，会继续往改名后的文件里写，而新建的 `app.log` 永远是空的——直到进程重启。

两种解法，二选一：

**方案 A：postrotate 发信号让程序重新打开文件**（推荐，无丢失窗口）

```bash
/var/log/myapp/app.log {
    daily
    rotate 7
    delaycompress          # 上一轮的文件延迟压缩，保证信号处理期间仍是明文可读
    postrotate
        systemctl kill -s USR1 myapp.service > /dev/null 2>&1 || true
    endscript
}
```

程序收到信号后重新打开路径 `app.log`（此时已是新文件）。**`delaycompress` 必须与之配合**：若立刻压缩，程序重开前可能还在写旧文件，压缩会导致写入失败或数据损坏；延迟一轮压缩让"交接期"的文件保持未压缩状态。

**方案 B：`copytruncate`**（程序不支持重开文件时的退路）

```bash
/var/log/myapp/app.log {
    daily
    copytruncate          # 先复制内容到 .log.1，再把原文件截断为 0
    compress
    rotate 7
}
```

原理是不改文件名，程序继续持有同一 inode，复制完成后原地截断。代价：**复制与截断之间有一个微小窗口可能丢最后几行**；且 `create`/`postrotate` 在此模式下失效（原文件始终存在）。只在程序完全不支持 reload/重开时使用。

选择口诀：**能 reload 就 postrotate + delaycompress；不能 reload 才 copytruncate**。

## 5. 常用选项速查

| 选项 | 作用 | 何时用 |
|------|------|--------|
| `daily/weekly/monthly` | 按时间轮转 | 默认场景 |
| `hourly` | 按小时 | 需配合 logrotate 每小时运行的 timer/cron，默认每日执行一次时 `hourly` 不会真正按小时转 |
| `size 100M` | 超过 100M 立即转（与时间条件互斥，后写优先） | 只想按大小控制 |
| `maxsize 100M` | 时间条件 + 未到时间但超 100M 提前转 | "每天一次，但太大就提前" |
| `minsize 100M` | 时间到了但不足 100M 就不转 | 低流量日志，避免产生大量小碎文件 |
| `rotate N` | 保留 N 份后删除 | 控制总量 = 单份大小 × N |
| `compress` / `nocompress` | gzip 压缩旧文件 | 默认建议开 |
| `delaycompress` | 延迟一轮再压缩 | 配合 postrotate 必开 |
| `olddir` | 旧文件移到子目录 | 希望日志目录整洁 |
| `missingok` | 文件不存在不报错 | 通配符场景必加 |
| `notifempty` | 空文件不转 | 几乎总是加上 |
| `dateext` | 用日期后缀 `.20260922` 而非 `.1` | 便于按日期归档查找 |
| `su user group` | 声明轮转时使用的属主/组 | 日志在非 root 可写目录（如 `/home`）时**必须**加，否则报 "parent directory has insecure permission" |

## 6. 管理命令

```bash
# 调试：只打印将执行的动作，不改动任何文件、不更新状态
$ sudo logrotate -d /etc/logrotate.conf

# 强制轮转一次（立即生效，用于验证配置）
$ sudo logrotate -f /etc/logrotate.conf

# 只针对某个片段
$ sudo logrotate -f /etc/logrotate.d/myapp

# 查看状态：每个文件上次轮转时间
$ cat /var/lib/logrotate.status
"/var/log/myapp/app.log" 2026-9-22-0:0:0
"/var/log/syslog" 2026-9-22-0:0:0
```

调试时优先 `-d`：它会把通配符展开结果、每个匹配文件的判定过程全部打印出来，"为什么没轮转"一目了然。

## 7. journal 的空间回收不在 logrotate 范围

`/var/log/journal/` 下的二进制文件**不要**加进 logrotate——journald 自己管理轮转与保留，用：

```bash
$ journalctl --disk-usage
$ sudo journalctl --vacuum-size=300M
$ sudo journalctl --vacuum-time=30days
```

把 journal 文件交给 logrotate 改名会造成 journald 索引错乱。两套体系：**文本日志归 logrotate，journal 归 vacuum**。

## 8. 常见坑

1. **轮转后新日志为空**：程序握着旧句柄。用 postrotate + reload，或 `copytruncate`；同时检查 `create` 权限是否让写日志的用户还能创建文件。
2. **写了 `size` 又写 `daily` 以为是"或"关系**：`size` 与时间条件互斥且后写优先，结果往往完全不符合预期。要"时间 + 提前阈值"用 `maxsize`。
3. **`hourly` 不生效**：logrotate 默认每天只被 cron/timer 调一次；要真正按小时轮转，需自建每小时触发的 timer/cron。
4. **通配符把已轮转的文件再次匹配**：`/var/log/*.log` 不会匹配 `.log.1`，但 `/var/log/*` 会把 `.log.1.gz` 再转一遍。用精确后缀（`*.log`）或 `olddir` 隔离。
5. **`/home` 下日志轮转报 insecure permission**：logrotate 出于安全拒绝在非 sticky 的世界可写目录操作，需在该段加 `su 用户 组`。
6. **手动删了 `.1.gz` 后状态错乱**：状态文件仍认为已轮转；用 `logrotate -f` 强制一次即可对齐。
7. **Arch 上 timer 没启用**：`logrotate.timer` 若为 disabled，配置写得再对也不会自动跑，先 `systemctl enable --now logrotate.timer`。
8. **把 journal 文件交给 logrotate**：见第 7 节，journal 只能用 `--vacuum-*` 回收。

## 参考资料

- `man logrotate`、`man logrotate.conf`
- logrotate 手册页 — [man7.org](https://man7.org/linux/man-pages/man5/logrotate.conf.5.html)
- Arch Wiki - Logrotate — [wiki.archlinux.org](https://wiki.archlinux.org/title/Logrotate)
- Arch Wiki - systemd/Journal（journal 空间管理） — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Journal)
- 鸟哥的私房菜 - 认识与分析登录档 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0570syslog.php)
