# 例行性工作排程（at、cron 与 systemd timer）

备份要在凌晨跑、证书要在到期前续、日志要按周归档、报表要每周一早上出现在老板邮箱里——这些事的共同点是"到点就该发生，与人是否在场无关"。靠人手敲命令既不可靠也不可扩展，于是有了排程系统：at 负责"只跑一次"，cron 负责"按表循环"，anacron 与 systemd timer 的 `Persistent=true` 负责"关机错过后补上"。这三种语义覆盖了服务器上几乎全部定时需求，也是本页的主线索：先讲三个工具的安装与提交语法，再拆开 cron 的环境变量与日志这两个最大坑源，然后给出 systemd timer 的完整可跑对例与选型建议，最后是排错清单。排程的一切前提是时钟准确，时钟漂移的治理见[时间服务篇](../server/ntp.md)；timer 用到的 unit 概念入门见[系统服务管理](../basic/services/system_services.md)，任务运行结果的日志检索见[系统日志](../basic/log/syslog.md)。

> 内容参考自 man 手册、systemd 官方文档与 Arch Wiki（概念框架参考鸟哥的私房菜），见文末参考资料。

## 学习目标

- 用"一次性 / 周期性 / 错过补跑"三分法为每个任务选对工具
- 会提交、查看、撤销 at 任务，理解 at.allow / at.deny 的裁决顺序
- 分清用户级 crontab 与 /etc/crontab、/etc/cron.d 两套体系及其用户字段差异
- 能为一个周期任务写出防重叠、有日志、可验证的 crontab 行或 timer 对
- 按"调度器有没有触发 → 任务环境对不对 → 输出去哪了"三段定位排程故障

## 1. 为什么需要排程：三种"不在场"语义

### 1.1 一次性、周期性与错过补跑

把服务器上所有"到点该发生的事"摊开看，只有三种语义。**一次性**：今晚 23:00 重启一次 nginx，跑完即弃，再无下一次——这是 at 的领地。**周期性**：每 5 分钟采集一次健康指标、每天 3:17 做备份——cron 的五字段时间表为此而生。**错过补跑**：笔记本周末合盖两天，周一开机后上周五该跑的日志轮转要不要补？cron 的回答是"错过就错过"，anacron 与 systemd timer 的 `Persistent=true` 的回答是"开机后补一次"——注意补跑的粒度天然是天级起步，"错过的那 5 分钟采集"补跑毫无意义，这个语义只对备份、清理、报告类任务有价值。

```text
一次性 ─────▶ at（atd 按时刻执行一次即弃）
周期性 ─────▶ cron（分/时/日/月/周 五字段循环触发）
错过补跑 ───▶ anacron（天级补跑）/ timer 的 Persistent=true（任意粒度补跑）
```

这个三分法比"记住一堆工具"更值钱，因为选型错误几乎都发生在语义层：用 cron 挂了一个只该跑一次的迁移脚本结果每晚重复执行、给秒级监控任务套上 anacron 语义、以为 timer 天生会补跑却没写 `Persistent=true`——每一种都源于没先问"这个任务到底是三种语义里的哪一种"。工具的语法查手册就行，语义判断错了却是静默事故：排程系统的报错永远迟到，等到人发现时往往已经跑歪了一周。

### 1.2 时间从哪来

排程器自己不计时，它读系统时钟。系统时钟由 NTP 服务校准（chrony 的 `makestep` 会在偏差大时直接步进），如果时钟被一次跳了半小时，依赖"当前时刻"的 cron 与 timer 的触发点会跟着跳，依赖"经过时长"的 `OnUnitActiveSec` 类单调钟定时器则不受影响——排查"定时任务时间乱了"时，先看 `journalctl -u chronyd` 有没有大步进，再怀疑自己的语法，这条顺序能省掉大量弯路。时钟校准的完整配置见[时间服务篇](../server/ntp.md)。

## 2. at：一次性任务

### 2.1 安装与启用（三系对照）

at、cron、anacron 在三个发行版里的包名与服务名各自独立，先把这张表立起来，后面所有章节都从它出发：

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 一次性任务 | `apt install at` | `sudo pacman -S at` | `dnf install at` |
| at 服务单元 | `atd` | `atd` | `atd` |
| 周期任务 | `apt install cron` | `sudo pacman -S cronie` | `dnf install cronie` |
| cron 服务单元 | `cron` | `cronie` | `crond` |
| 错过补跑 | `apt install anacron` | 随 `cronie` 主包自带 | `dnf install cronie-anacron`（通常默认已装） |

三行的信息量比看上去大：Debian 的 cron 守护进程来自经典的 `cron` 包、服务名就叫 `cron`；Arch 与 RHEL 用的是 Red Hat 系的 `cronie`（vixie-cron 的维护分支），但 Arch 的服务名沿用包名 `cronie`，RHEL 的服务名却叫 `crond`——包名、服务名、配置路径是三个独立维度，这与 [DNS 篇](../server/dns/bind.md)里"bind9 与 named 的命名分裂"是同一种历史包袱，排错时永远先 `systemctl status` 对准 unit 名再谈别的。装完的验收动作是让服务跑起来并确认开机自启：

```bash
$ sudo systemctl enable --now atd && systemctl is-active atd
active
```

### 2.2 提交、查看与撤销

at 的交互是"输入命令、Ctrl+D 结束"，任务内容被存进队列，到点由 atd 以提交者身份执行：

```bash
$ at 23:00
warning: commands will be executed using /bin/sh
at> /usr/local/bin/reload-nginx.sh >> /var/log/reload.log 2>&1
at> <EOT>                                    # 此处按 Ctrl+D
job 3 at Thu Oct  2 23:00:00 2026
$ at now +10 minutes                         # 相对时间同样可用
$ echo "/usr/local/bin/cleanup.sh" | at now +30 minutes   # 管道方式适合脚本内提交
$ atq                                        # 查看队列；等价 at -l
3   Thu Oct  2 23:00:00 2026 a cui
4   Fri Oct  3 08:30:00 2026 a root
$ atrm 3                                     # 撤销 3 号任务；等价 at -d 3
$ at -c 4 | head -20                         # 查看任务将被执行的完整脚本
```

`atq` 输出的第一列是任务号、末列是提交者，中间夹着执行时刻与队列字母——队列 `a` 是普通 at，`b` 是 batch。`at -c` 值得专门一提：它打印的不是一个命令而是一整段 shell 脚本，里面能看到 atd 注入的环境变量与 ulimit，任务"到点没跑对"时先看这段展开，比盯着当初敲的一行命令有用得多。时间语法上 `23:00`、`now +10 minutes`、`teatime`（16:00）都合法，跨天语义（`1:00` 在已过 1:00 的当天表示明天凌晨）用 `at -c` 的展开时刻核对一次最稳妥。

### 2.3 权限控制与 batch

谁能提交 at 任务由两个文件裁决：`/etc/at.allow` 存在则只有列出的用户可用；否则看 `/etc/at.deny`，不在名单者可用；两者都不存在时现代实现只允许 root——这个"allow 优先、deny 兜底、都没有则最严"的顺序与 sudoers 的裁决思路一致，记一套即可。Debian/RHEL 默认发放一个列着系统账号的 at.deny（即放行普通用户），Arch 两个文件都不发，开箱即 root 专用，多用户机上想放行就手工建 at.deny。另外 `batch` 命令是 at 的变体：任务提交后不按时钟、而是等系统负载降到 1.5 以下（atd 的 `-b` 参数可调）再执行，适合塞压缩、索引这类"不着急但吃 CPU"的活，负载联动的语义与 cron/timer 都不同，别混用。

## 3. cron：周期性任务

### 3.1 两套 crontab：用户级与系统级

cron 的第一大概念分水岭是"谁的 crontab"。**用户级**通过 `crontab -e` 编辑，存放在 `/var/spool/cron/`（Debian 在 `crontabs/` 子目录、RHEL/Arch 直接按用户名落文件），属主即执行身份，格式是"五字段 + 命令"。**系统级**是 `/etc/crontab` 与 `/etc/cron.d/` 下的片段文件，比用户级多第六个字段——执行用户，且通常由配置管理工具或软件包投放（`/etc/cron.d/` 里的文件名只能用字母、数字、下划线与连字符，**带点的文件名如 `backup.sh` 会被 cron 整个忽略**，这是包管理时代最常见的静默事故之一）。同一个格式两种载体，分工逻辑很清晰：用户管自己的活用 `crontab -e`（不用 root、互不干扰），机器级的活进 `/etc/cron.d/`（随仓库走、可 diff、可审计）——与"个人 dotfiles 不进 /etc，系统配置不散落家目录"是同一条边界。

```text
# /etc/crontab（Debian 默认骨架节选）：多一个用户字段
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

17 *    * * *   root    cd / && run-parts --report /etc/cron.hourly
```

```bash
$ crontab -l                                 # 列出当前用户的 crontab
17 3 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1
*/5 * * * * /usr/local/bin/check_health.sh
$ sudo crontab -u www-data -l                # 管理员查看指定用户
```

### 3.2 五个字段与两个高频错误

字段顺序是"分 时 日 月 周"，每个字段独立匹配当前时刻，全匹配才触发。两个错误占掉新手问题的大半：其一，`*/5` 与 `5` 天壤之别——`*/5 * * * *` 是每 5 分钟一次，`5 * * * *` 是"每小时的第 5 分钟"各跑一次，想写前者敲成后者的任务会安静地每小时才跑一次；其二，"日"与"周"在两者都被限定（都不是 `*`）时是**或**不是与——`0 0 13 * 5` 的本意常是"每月 13 号且是周五"，实际却是"每月 13 号零点以及每个周五零点都会跑"，crontab(5) 对此有明文。写完一条规则后用 `crontab.guru` 这类解析器心算复核一遍语义，或在测试机上把频率调成 `* * * * *` 先观察一分钟，都是低成本的防呆手段。

| 意图 | 写法 | 说明 |
|------|------|------|
| 每天 3:17 | `17 3 * * *` | 分钟故意避开整点，见 §6 错峰一条 |
| 每 15 分钟 | `*/15 * * * *` | 分钟字段步进 |
| 每周二 3:17 | `17 3 * * 2` | 周字段 0 与 7 都是周日 |
| 每月 1 号与每周日 | `0 3 1 * 0` | 两者都被限定 → 或语义，双触发 |

### 3.3 环境变量陷阱：cron 的世界没有你的 dotfiles

cron 执行任务时的环境是一套刻意精简的默认值：`SHELL=/bin/sh`、`PATH=/usr/bin:/bin`（Debian 的 /etc/crontab 骨架会放宽一些但用户级 crontab 不会）、`HOME` 与 `LOGNAME` 取自 /etc/passwd，没有 tty，不加载 `.bashrc` 与 `.profile`。这意味着交互 shell 里敲得好好的命令，进了 cron 就可能 `command not found`（二进制在 /usr/local/bin 之类不在精简 PATH 里的路径）或行为不同（`~` 展开正常但相对路径以 HOME 起算而非你预期的目录；别名全失效）。纪律只有两条却要当成肌肉记忆：**命令一律绝对路径，脚本内部第一件事是显式设 PATH**。另一个冷门但致命的坑是 `%`——crontab 命令字段里的百分号被解释为换行，`date +%F` 会把 `%F` 之后的内容截成"标准输入"，必须转义成 `date +\%F`；这个符号在交互 shell 里毫无特殊含义，所以格外容易漏。

```bash
#!/bin/sh
# /usr/local/bin/backup.sh —— 给 cron 用的脚本开头范式
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
cd /srv/data || exit 1
tar czf /backup/data-$(date +\%F).tar.gz .
```

上面脚本里 `date +\%F` 的转义只在 crontab 行内需要；脚本文件内部 `%` 并不特殊，可以不转义——但统一写转义无害且省一次心智负担。`cd ... || exit 1` 是另一条防线：cron 任务的工作目录是 HOME，不 cd 先行的话相对路径全部落错位置，失败时还常常连报错都写进了你没看的地方。

### 3.4 日志与 MAILTO：输出去了哪

任务没跑和跑了没看见，是两类故障，分界就在日志。调度器侧：RHEL/Rocky 的 cronie 把日志写进 `/var/log/cron`，Debian/Ubuntu 默认不单独落 cron.log 而是进 syslog 与 journal，`journalctl -t CRON -t CROND --since today` 一句能同时过滤两系的任务执行行（Debian 的标签是 `CRON`、cronie 是 `CROND`）。任务侧：cron 默认把任务的 stdout/stderr 用邮件发给任务属主，前提是装了 MTA——没装 MTA 的 Debian 上会看到一行 `(CRON) info (No MTA installed, discarding output)`，输出就此蒸发，这也是"日志证明跑了但结果不对"的头号嫌疑人。工程上二选一：要么 `MAILTO=""` 关掉邮件并把输出显式重定向到日志文件，要么正经配好本地 MTA 让告警邮件能出门。检索任务输出的通用方法见[系统日志](../basic/log/syslog.md)。

```bash
$ journalctl -t CRON -t CROND --since today | tail -3
Oct 02 03:17:01 web01 CRON[2811]: (root) CMD (/usr/local/bin/backup.sh)
```

### 3.5 anacron 与 /etc/cron.{hourly,daily,weekly,monthly}

`/etc/cron.daily/` 这四个目录是"天级及其以上"任务的另一种注册方式：放一个可执行脚本进去，由 `run-parts` 按节奏批量执行——不用写 crontab 行、按文件粒度管理，软件包也爱用它（你会在里面发现 logrotate、dpkg、certbot 投放的脚本）。真正执行它们的不是 cron 的时刻表而是 anacron：`/etc/anacrontab` 按"周期（天）、延迟（分钟）、任务标识、命令"四字段声明，anacron 用 `/var/spool/anacron/<标识>` 里的时间戳判断"今天/这周跑过没有"，没跑过就在开机或被触发后延迟若干分钟补跑。RHEL 系的触发链是 `/etc/cron.d/0hourly` 每小时 `run-parts /etc/cron.hourly` → 其中的 `0anacron` 拉起 `anacron -s`；Debian 系由 cron 定期拉起 anacron。`RANDOM_DELAY` 与 `START_HOURS_RANGE` 控制补跑的错峰与时段窗口：

```text
# /etc/anacrontab（RHEL/Rocky 默认节选）
SHELL=/bin/sh
PATH=/sbin:/bin:/usr/sbin:/usr/bin
RANDOM_DELAY=45
START_HOURS_RANGE=3-22
1   5    cron.daily      nice run-parts /etc/cron.daily
7   25   cron.weekly     nice run-parts /etc/cron.weekly
@monthly 45  cron.monthly   nice run-parts /etc/cron.monthly
```

两个纪律必须记住：anacron 只对天级任务有意义（小时级目录 `/etc/cron.hourly` 实际由 cron 直接驱动，没有补跑语义）；run-parts 对文件名与权限极其挑剔——名字带点、有可写位异常、缺执行权都会被静默跳过，"放进去的脚本从来没跑过"先 `run-parts --test /etc/cron.daily` 看它到底会不会被选中。

## 4. systemd timer：现代替代

### 4.1 与 cron 的取舍

timer 不是"又一个 cron"，它把定时任务纳入 systemd 的声明式体系：一个 `.timer` unit 到点激活配对的 `.service` unit。换来的是 cron 给不了的东西——日志天然聚合在 `journalctl -u <name>`、可声明依赖（备份等数据库先就绪）、秒级粒度、`RandomizedDelaySec` 内建错峰、`Persistent=true` 任意粒度的错过补跑、unit 文件随包与配置管理分发。代价是多一层抽象与 `daemon-reload` 的心智：改一行时间表要经历"改文件 → daemon-reload → restart timer"三步，不像 `crontab -e` 保存即生效。

| 维度 | cron | systemd timer |
|------|------|---------------|
| 日志 | syslog/journal 按标签检索 | `journalctl -u backup.service` 天然聚合 |
| 依赖关系 | 无，靠脚本自己等 | `After=`/`Requires=` 声明 |
| 粒度 | 分钟 | 秒 |
| 错峰 | 手选分钟数 | `RandomizedDelaySec=10m` |
| 错过补跑 | anacron（仅天级） | `Persistent=true`（任意粒度） |
| 生效方式 | 保存即生效 | `daemon-reload` + 重启 timer |
| 分发 | 每机维护 crontab | unit 文件随包/Ansible 走 |

### 4.2 一个完整的 timer 对

以"每周二 3:17 备份，错过补跑，随机延迟 10 分钟内错峰"为例，两个文件放进 `/etc/systemd/system/`：

```text
# /etc/systemd/system/backup.service
[Unit]
Description=Weekly data backup

[Service]
Type=oneshot
ExecStart=/usr/local/bin/backup.sh
```

```text
# /etc/systemd/system/backup.timer
[Unit]
Description=Run backup every Tuesday 03:17

[Timer]
OnCalendar=Tue *-*-* 03:17:00
Persistent=true
RandomizedDelaySec=10m
AccuracySec=1min
Unit=backup.service

[Install]
WantedBy=timers.target
```

`Type=oneshot` 表达"跑完即退"的前台任务语义（与 at 的"一次性"遥相呼应，但这是每次触发执行一次）；timer 侧 `Unit=` 显式配对（省略时默认找同名 .service，写出来更抗重命名事故）。unit 文件的语法与依赖入门见[系统服务管理](../basic/services/system_services.md)。启用与验证：

```bash
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now backup.timer
$ systemctl list-timers backup.timer
NEXT                        LEFT  LAST PASSED UNIT          ACTIVATES
Tue 2026-10-06 03:27:00 CST 3d    n/a  n/a    backup.timer  backup.service
```

`list-timers` 的 NEXT 列是下一次触发时刻（上面 03:27 正是 03:17 加上随机延迟的结果），LAST/PASSED 则是补跑语义的观察窗口。手动验证任务本体不必等到点，`sudo systemctl start backup.service` 直接跑一次，看 `journalctl -u backup.service` 的输出符合预期后再把 timer 挂上——先验证任务、再信任排程，这个顺序与改 DNS 先 `named-checkconf` 再 reload 是同一条变更纪律。

### 4.3 OnCalendar 语法速记

日历事件的基本形是 `星期 年-月-日 时:分:秒`，缺省部分用 `*` 或区间表达，两个高频写法先记牢：每周二 3:17 写 `Tue *-*-* 03:17:00`；每小时的 0/15/30/45 分写 `*:0/15`。工作日早 9 点是 `Mon..Fri *-*-* 09:00:00`，月末不好表达（calendar 语法没有"最后一天"直接写法），这类用 `OnUnitActiveSec` 配合脚本内日期判断更省心。**时区默认取系统本地时区**，需要钉死 UTC 时在末尾追加时区名：`OnCalendar=*-*-* 03:17:00 UTC`——服务器改时区或夏令时切换时，没钉时区的 timer 触发点会跟着本地钟走，跨机房任务想统一就全部显式写 UTC。另一族是相对时间：`OnBootSec=5min`（开机后 5 分钟）与 `OnUnitActiveSec=6h`（上次激活后 6 小时）基于单调钟，不受墙上时钟跳变影响，适合"每 6 小时刷新一次令牌"这种与墙钟无关的节奏；两类可以共存于同一 timer，任一条件满足即触发。任何拿不准的表达式，`systemd-analyze calendar` 直接告诉你下次触发时刻：

```bash
$ systemd-analyze calendar "Tue *-*-* 03:17:00"
  Original form: Tue *-*-* 03:17:00
  Normalized form: Tue *-*-* 03:17:00
    Next elision: Tue 2026-10-06 03:17:00 CST
       (in UTC): Mon 2026-10-05 19:17:00 UTC
```

## 5. 选型与工程纪律

选型的朴素法则：单机、少数几个传统任务，cron 完全够用且最少惊讶；任务需要依赖声明、集中分发、秒级粒度或任意粒度补跑，或者环境里 systemd 已是一等公民（ fleet、容器宿主机），一律 timer。混用不禁止但要有清册——同一台机上 cron 与 timer 并存时，"这任务在哪儿注册的"必须能一眼答出，否则就是 §6 里"跑了两次"的温床。

无论哪种载体，三条工程纪律通用。**幂等**：假设任务会连续跑两次，结果必须仍然正确——备份用带日期的目标文件名、清理脚本容忍文件不存在（`rm -f`）、续期脚本判断剩余天数——补跑语义（anacron、Persistent=true）天然会把"同一窗口跑两次"变成正常路径而非事故。**互斥**：跑超一个周期的任务会自我重叠（每 5 分钟的采集跑了 8 分钟），`flock -n` 拿不到锁就退出是最便宜的三行解：

```text
# crontab 行：拿不到锁说明上一轮还没跑完，直接放弃本轮
*/5 * * * * flock -n /run/lock/health.lock /usr/local/bin/check_health.sh >> /var/log/health.log 2>&1
```

**输出去向显式化**：每个任务要么把 stdout/stderr 重定向到自己的日志文件，要么交给 timer 体系进 journal，绝不依赖"默认行为"；cron 侧再配 `MAILTO=""` 或可用的 MTA，让"输出丢失"在架构上不可能发生。时区是第四条隐性纪律：cron 走系统本地时区、timer 可逐条钉时区，跨时区机器群统一用 UTC 注册、展示层再转本地，能在春秋两次夏令时切换时省掉整类"提前/推迟一小时"的诡异故障。

## 6. 排错与常见坑

**任务压根没跑。** 先证明"调度器是否触发"再查任务本身：`grep CMD /var/log/cron`（RHEL）或 `journalctl -t CRON -t CROND --since today`（两系通用）里找不到那行 CMD，就是注册层的问题——crontab 语法错（`*/5` 写成 `5`、日/周或语义导致触发点不在你以为的时刻）、`/etc/cron.d/` 文件名带点被整个忽略、脚本无执行权且不是以 `sh script` 方式调用、以及最经典的"编辑了 /etc/crontab 却以为改的是 crontab -e"。日志里能看到 CMD 但任务没效果，才轮到下一问。

**同一任务跑了两次。** 排查注册面而不是脚本：cron 与 timer 双注册（迁移到 timer 后忘了删 crontab 行）是头号来源；其次是 anacron 补跑与 cron 时刻表在同一个窗口内都触发了天级任务；多机环境里还要确认"这台该跑、那台也配了"。清册制度（每个任务唯一注册点）是根治手段。

**日志证明跑了，结果却不对。** 几乎都是环境差异：PATH 里找不到 `/usr/local/bin` 的二进制、相对路径以 HOME 起算、别名与 shell 函数不存在、`%` 未转义导致命令被截断。用 `at -c` 的思路对照——把任务的展开环境打出来看一遍；给脚本开头加显式 PATH 与 `cd` 的范式（§3.3）能预防这一整类。

**整点扎堆。** 大量任务都写 `0 * * * *`、`0 3 * * *`，每到整点/零点集体苏醒，CPU 与下游 API 同时承压。cron 的做法是人为错峰——分钟选 17、23、41 这类非整数值（注意 `H` 这种"哈希错峰"写法是 Jenkins 的语法，系统 cron 不认识，照抄不会生效）；timer 的做法是 `RandomizedDelaySec`。库轮询类的整点风暴（证书检查、DNS TTL）同理，错峰是纪律不是优化。

**anacron 不触发。** 链条是"cron 拉起 anacron → anacron 查时间戳 → run-parts 选中脚本"，逐环验证：`/etc/anacrontab` 的字段写对没有、`/var/spool/anacron/<标识>` 的时间戳是否已是今天（已是今天则"跑过了"、不跑是正确行为）、脚本有没有过 `run-parts --test` 的筛选（名字带点、缺执行权都会被静默跳过）。RHEL 上还要确认 cronie-anacron 装了、`/etc/cron.d/0hourly` 还在。

**MAILTO 邮件堆积。** 任务有输出、cron 天天试图发邮件给 root：MTA 配好时邮件在 `/var/mail/root` 里堆成山，很久没人看；MTA 没配时输出被丢弃（Debian 会留 `No MTA installed, discarding output` 一行 info）。处置：无价值的输出 `MAILTO=""` + 重定向到日志；有告警价值的走正经通知通道（timer 任务配 `OnFailure=` 单元发通知是更现代的形态），并定期清 `/var/mail`。与本仓 [DNS 篇](../server/dns/bind.md)"日志里只留一句含糊错误"的教训同源：排程任务的输出必须有人负责接住，否则等于没有输出。

## 参考资料

- at(1) 手册 — [man7.org/linux/man-pages/man1/at.1.html](https://man7.org/linux/man-pages/man1/at.1.html)
- crontab(5) 手册 — [man7.org/linux/man-pages/man5/crontab.5.html](https://man7.org/linux/man-pages/man5/crontab.5.html)
- systemd.timer 官方文档 — [freedesktop.org/software/systemd/man/systemd.timer.html](https://www.freedesktop.org/software/systemd/man/systemd.timer.html)
- systemd.time（OnCalendar 语法） — [freedesktop.org/software/systemd/man/systemd.time.html](https://www.freedesktop.org/software/systemd/man/systemd.time.html)
- Arch Wiki: Cron — [wiki.archlinux.org/title/Cron](https://wiki.archlinux.org/title/Cron)
- 鸟哥的私房菜 — 例行性工作排程 — [linux.vbird.org](https://linux.vbird.org/)
