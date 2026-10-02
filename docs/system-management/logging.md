# 日志系统管理

排障的第一现场永远是日志：服务凌晨自愈、磁盘半夜塞满、陌生 IP 反复试密码，答案都躺在日志的某几行里。但"系统在记日志"和"你查得到日志"是两回事——检索维度没组合对，等于在没建索引的表里全表扫描；持久化没打开，重启一次现场就没了；应用日志躺在自己的文件里没接进总线，你在 journalctl 里翻到天亮也翻不到。基础篇的[系统日志](../basic/log/syslog.md)讲清了 journald 与 rsyslog 的链路分工以及 facility/severity 的概念词汇，[日志轮转](../basic/log/rotation.md)管的是文件生命周期，本页补齐管理员侧剩下的三块武功：**查得快**（journalctl 组合检索）、**留得住**（持久化与配额）、**送得走**（rsyslog 接入切分与集中转发），最后以"没来 / 没了 / 写重了"三类高频故障收口。

> 内容参考自 systemd/rsyslog 官方文档与 Arch Wiki（概念框架参考鸟哥的私房菜），见文末参考资料。

## 学习目标

- 把 journalctl 的服务、时间、优先级、字段四个过滤维度组合起来，将排障问题翻译成一条查询
- 分清易失与持久两种 journal 存储，独立完成持久化开启、配额限制与手动回收
- 用 rsyslog 的 imfile 把应用的文件日志接进总线，按程序与日期切分，并带队列转发到中心收集器
- 掌握 rsyslogd -N1 与 journalctl 自检链路，定位"日志没来 / 没了 / 写重了"三类故障

## 1. 排障时日志是第一现场

先交代分工，避免与基础篇重复：journald 是 systemd 自带的二进制日志总线，所有 systemd 服务与内核消息默认先落进它；rsyslog 是传统的文本日志路由器，负责把消息按规则写进 `/var/log/` 下的文本文件并做远程转发——两者为什么并存、facility/severity 怎么读，见基础篇[系统日志](../basic/log/syslog.md)，本页不再复述概念。管理员真正每天用的动作只有两类：一是**检索**（在几 GB 的日志里把某个时间窗内、某个服务、某个严重级别以上的行捞出来），二是**管线**（把应用自己写的日志文件接进统一通道、限制日志占用、把日志送离本机）。这两类动作的共同方法论是"先定时间窗、再定过滤维度、最后选输出形态"——像写 SQL 一样：先把 WHERE 的时间列钉死，再 AND 上服务与级别，最后决定 SELECT 出来是跟随滚动、导出文件还是结构化 JSON。跳过时间窗直接全量翻页，是排障变成长夜里全表扫描的第一原因。

把这套方法用熟之后，你会发现日志侧的故障其实只有三句话能概括：**日志没来**（采集层断了——应用没走 systemd、文件没被 imfile 盯上、转发队列堆积），**日志没了**（保留层删了——journald 易失存储、配额触发回收、轮转清档），**日志写重了**（规则层漏了 stop，同一条消息被两条规则各写一次）。本页第 2 节解决"查得快"，第 3 节解决"留得住"，第 4、5 节解决"送得走"，第 6 节把三类故障各自的典型面孔列成坑清单——读到哪条坑，都能在前面找到对应的处置段落。

## 2. journalctl：把问题翻译成查询

### 2.1 四个过滤维度

journalctl 的全部检索能力可以归成四个维度，逐个叠加就像逐个 AND 条件：

| 维度 | 写法 | 匹配什么 |
|------|------|----------|
| 服务 | `-u nginx`（或全名 `-u nginx.service`） | 该 unit 名下产生的全部消息 |
| 时间 | `--since "2026-10-02 03:00" --until "03:30"` | 时间窗，也接受 `today`、`-1h` 这类口语 |
| 优先级 | `-p err`、`-p err..alert` | 单值是"该级及更糟"，区间是闭区间 |
| 字段 | `_COMM=sshd`、`_PID=2811`、`_UID=0` | 消息自带的元数据字段，可多个并列 |

```bash
# 本机 nginx 自上次启动以来的全部日志
$ journalctl -u nginx -b --no-pager | tail -5
Oct  2 09:01:22 web01 systemd[1]: Started A high performance web server.
Oct  2 09:01:23 web01 nginx[1289]: nginx/1.24.0 configuration file /etc/nginx/nginx.conf test is successful

# 今天零点以来、err 及更糟的所有来源
$ journalctl -p err --since today
Oct  2 03:14:08 web01 systemd[1]: Failed to start My Application.

# 某个进程号留下的痕迹（定位"这个 PID 到底报了什么"）
$ journalctl _PID=2811
```

四个维度里最容易被轻视的是字段维：`_COMM` 按可执行名匹配，不依赖服务是否纳入 systemd，手工起的后台进程、一次性的 cron 脚本都能按名捞出来；`_UID=0` 则是审计视角的入口——"root 今天让哪些程序开口说过话"，一条命令就有答案。时间维的口语写法（`--since "-2h"`、`--since yesterday`）在应急时比敲完整时间戳快得多，值得形成肌肉记忆；跨启动的历史要配合 `-b` 使用，`-b` 是本次开机、`-b -1` 是上一次，`journalctl --list-boots` 先把启动序号列出来再按图索骥，比盲猜"上次挂是几天前"可靠：

```bash
$ journalctl --list-boots
IDX  BOOT ID  FIRST ENTRY                 LAST ENTRY
-2   9f8e7d…  Wed 2026-09-30 08:11:02    Wed 2026-09-30 21:44:10
-1   1c2b3a…  Thu 2026-10-01 08:03:47    Thu 2026-10-01 22:10:45
 0   7e6d5c…  Fri 2026-10-02 07:58:19    Fri 2026-10-02 09:12:33
```

还有一个正则维 `--grep`，它把过滤下推到 journal 文件内部，比管道 grep 快且省内存；若发行版编译 systemd 时没带 PCRE2 支持，journalctl 会明确报错，届时退回 `journalctl … | grep -E` 一样能用，只是慢些：

```bash
$ journalctl -u myapp --since today --grep "connection refused"
Oct  2 08:44:19 web01 myapp[3120]: connection refused: 127.0.0.1:6379
Oct  2 08:59:41 web01 myapp[3120]: connection refused: 127.0.0.1:6379
```

### 2.2 输出形态与体量

查询对了，还要选对出口形态。默认的分页输出适合人眼；`-f` 跟随滚动是"改完配置盯现场"的标准姿势；`-o short-iso` 把时间戳换成 ISO 形态——默认的 `Oct 2 09:12:33` 不带年份，翻跨年日志时会误判先后，交给脚本处理更是坑；`-o json` / `-o json-pretty` 输出结构化字段，是接进外部分析工具的正门；`-e` 直接跳到尾部，配合 `--no-pager` 在管道里取"最后几屏"。体量侧两个命令要形成条件反射：`journalctl --disk-usage` 看日志占了多少磁盘，`journalctl --vacuum-size=500M` 立即把归档日志压到目标额度以内（只动已归档文件，不动正在写的活动文件），见第 3.3 节：

```bash
$ journalctl -u myapp --since today -o short-iso --no-pager | tail -2
2026-10-02T09:58:07+0800 web01 myapp[3120]: listening on :8080
2026-10-02T09:59:41+0800 web01 myapp[3120]: ready in 1.2s
$ journalctl -u myapp -n 3 -o json-pretty | head -8
{
	"__CURSOR" : "s=7e6d5c…;i=4f2b;m=1a2b…;t=17…",
	"__REALTIME_TIMESTAMP" : "1761867587000000",
	"_COMM" : "myapp",
	"MESSAGE" : "listening on :8080",
	"PRIORITY" : "6",
	"_SYSTEMD_UNIT" : "myapp.service"
}
```

json 输出里的字段名就是第 2.1 节过滤维度的"原料库"——`_COMM`、`_SYSTEMD_UNIT`、`PRIORITY` 既解释了查询参数为什么那样写，也标定了接外部分析工具时能拿到哪些列。

### 2.3 三个组合实战

**实战一：服务凌晨三点自己"好"了。** 现象是早巡发现 nginx 的重启计数涨了，但没人承认动过机器。先钉时间窗看服务本体，再看同窗内谁动了它：

```bash
$ journalctl -u nginx -b --since "02:50" --until "03:30" -o short-iso
2026-10-02T03:14:09+0800 web01 systemd[1]: Stopping A high performance web server...
2026-10-02T03:14:09+0800 web01 systemd[1]: nginx.service: Deactivated successfully.
2026-10-02T03:14:10+0800 web01 systemd[1]: Started A high performance web server.
```

Stopping 是谁发起的？同窗内扩到全量 warning 以上，答案通常就在旁边几行——凌晨三点最常见的是 cron 触发的证书续期脚本 reload 失败升级成了 restart，或 OOM killer 杀掉了 worker（见实战二）。判读顺序永远是：先本服务的时间线，再同窗的全量上下文，最后才去翻应用自己的日志。

**实战二：OOM 事件溯源。** 内存被杀的进程不会给自己留遗言，遗言在内核和 systemd 那里：

```bash
$ journalctl -k --since "03:10" --until "03:20" | grep -iE "out of memory|killed process"
Oct  2 03:14:08 web01 kernel: Out of memory: Killed process 4321 (java) total-vm:8123456kB, anon-rss:7654321kB, file-rss:0kB, shmem-rss:0kB
$ journalctl -b --since "03:14" --until "03:15" -p warning
Oct  2 03:14:08 web01 systemd[1]: myapp.service: A process of this unit has been killed by the OOM killer.
Oct  2 03:14:09 web01 systemd[1]: myapp.service: Scheduled restart job, restart counter is at 1.
```

`-k` 只看内核消息，OOM 的第一行就在这里；随后 `A process of this unit has been killed by the OOM killer` 把内核事件映射回具体 unit，`restart counter` 说明它是被 systemd 拉起来的——三段拼起来，"凌晨三点服务自愈"与"内存不足"就在同一个时间戳上对齐了。这两个实战一是同一晚的同一件事，这也正是日志排障的常态：现象在服务侧，根因在隔壁。

**实战三：SSH 登录审计。** 谁在什么时候从哪个 IP 登录、谁在爆破：

```bash
$ journalctl _COMM=sshd --since today | grep -E "Accepted|Failed"
Oct  2 09:12:33 web01 sshd[2811]: Accepted publickey for ops from 192.168.56.11 port 51344 ssh2: ED25519 SHA256:Qk3…
Oct  2 09:40:02 web01 sshd[3390]: Failed password for invalid user admin from 203.0.113.7 port 40122 ssh2
```

按 `_COMM=sshd` 匹配比按 unit 匹配更稳——Debian 系的 unit 叫 `ssh`、RHEL 系叫 `sshd`，而进程名三系一致。爆破检测把 Failed 按来源 IP 聚合计数即可；要不要进一步自动封禁，属入侵检测话题，见安全篇。

## 3. 持久化与配额：日志要留得住

### 3.1 /run 与 /var 的两种命运

journald 有两个候选落盘位置：`/run/log/journal/` 与 `/var/log/journal/`。前者在内存文件系统上，**易失**——重启即清零；后者在磁盘上，跨重启保留。默认策略是 `Storage=auto`：`/var/log/journal/` 目录存在就走持久，不存在就退回易失。这解释了一个高频困惑："昨天明明看到的日志，今天 `journalctl -b -1` 说什么都没有"——不是查询写错了，是这台机器从来就没把日志写进磁盘，重启的那一刻现场已经蒸发。区别一眼可辨：`journalctl --list-boots` 只有一行（编号 0），说明历史启动从未落盘。

### 3.2 打开持久化

打开持久化是几条命令的事，三发行版一致：

```bash
$ sudo mkdir -p /var/log/journal
$ sudo systemd-tmpfiles --create --prefix /var/log/journal/
$ sudo systemctl restart systemd-journald
$ journalctl --flush          # 把 /run 里还没搬走的存量灌进 /var
$ journalctl --list-boots     # 重启一次后，这里应开始累积历史启动
```

第二条 tmpfiles 命令不是可有可无的仪式——它按 systemd 自带的 tmpfiles 规则把目录属主修成 `root:systemd-journal`、模式 2755；手工 mkdir 出来的默认属主会让普通用户一条日志都读不到（journal 的读权限按组控制：`systemd-journal` 组成员可读全部，普通用户只能读自己产生的消息，这既是便利也是审计边界）。改完用一行 `ls` 核验属主与模式，比事后翻权限坑便宜得多：

```bash
$ ls -ld /var/log/journal /var/log/journal/*/
drwxr-xr-x 3 root root           4096 Oct  2 10:00 /var/log/journal
drwxr-xr-x 2 root systemd-journal 4096 Oct  2 10:00 /var/log/journal/7e6d5c…/
```

改配置的另一条路是在 `/etc/systemd/journald.conf` 里写 `Storage=persistent` 再重启 journald，效果等同，显式声明的好处是配置文件本身可追溯。

### 3.3 配额与回收

持久化打开后，日志开始与业务数据抢磁盘，必须同时给配额。journald 支持按容量与按保留期双约束，取更严者生效：

```text
# /etc/systemd/journald.conf（片段）
[Journal]
Storage=persistent
SystemMaxUse=500M        # journal 总量上限
SystemKeepFree=1G        # 至少给文件系统留出的空闲
MaxRetentionSec=1month   # 最长保留时间
```

```bash
$ sudo systemctl restart systemd-journald
$ journalctl --disk-usage
Archived and active journals take up 812.0M in the file system.
$ sudo journalctl --vacuum-size=500M
Vacuuming done, freed 312M of archived journals from /var/log/journal/7e6d….
```

`--vacuum-size` 是"立即生效"的手动回收，改完配额后跑一次可以把存量压到新额度内；它只清理已归档的 journal 文件，活动文件不动，所以跑完的占用量略高于目标值是正常的。`SystemKeepFree` 常被忽略但恰恰是防事故的那条——它站在文件系统的立场说"不管我的上限是多少，至少留 1G 给别人"，避免日志把 `/var` 撑爆连自己的配额文件都写不进去。rsyslog 侧文本文件的容量治理不归 journald 管，走 logrotate，见基础篇[日志轮转](../basic/log/rotation.md)。

### 3.4 journald 与 rsyslog 的衔接

两套日志系统并存时，rsyslog 的消息来源有两条路：老路 `imuxsock` 监听传统 `/dev/log` 套接字，journald 会代为转发一份；新路 `imjournal` 直接从 journal 里消费。RHEL 系默认走 imjournal，Debian 传统装法以 imuxsock 为主——本机走哪条，看 `/etc/rsyslog.conf` 实际加载了哪个模块，不必背发行版对照表。这个衔接解释了一个"重复"现象：同一条 sshd 消息既能在 `journalctl -u ssh` 看到、又能在 `/var/log/auth.log`（Debian）或 `/var/log/secure`（RHEL）看到，不是写重了，而是总线与路由器各司其职各存一份；两份的保留策略也因此各自独立——journal 按第 3.3 节的配额回收，文本文件按轮转策略清理。

## 4. rsyslog 工程化：接入、切分、转发

journal 解决了"systemd 生态内的消息"，但大量应用（尤其是 JVM 系与第三方闭源服务）只肯往自己的日志文件里写。让这些文件也进统一管线，是 rsyslog 的 imfile 模块的本职。先装包，三系对照：

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 | `apt install rsyslog` | `sudo pacman -S rsyslog` | `dnf install rsyslog` |
| 服务名 | `rsyslog.service` | `rsyslog.service` | `rsyslog.service` |
| 片段目录 | `/etc/rsyslog.d/`（默认包含） | 需确认主配置有 include | `/etc/rsyslog.d/`（默认包含） |
| 语法检查 | `rsyslogd -N1` | `rsyslogd -N1` | `rsyslogd -N1` |

### 4.1 imfile：把应用的文件日志接上总线

一个完整可跑的接入配置，把 `/opt/app/log/app.log` 以程序名 `myapp` 接入，并按天切分落盘：

```text
# /etc/rsyslog.d/30-app.conf —— 应用文件日志接入与按天切分
global(workDirectory="/var/spool/rsyslog")   # 磁盘队列的落地目录，必配

module(load="imfile")

template(name="appdaily" type="string"
         string="/var/log/app/%PROGRAMNAME%/%$YEAR%-%$MONTH%-%$DAY%.log")

input(type="imfile"
      File="/opt/app/log/app.log"    # 应用正在写的那份文件
      Tag="myapp"                    # 进入 syslog 后的 programname
      Facility="local1"
      Severity="info")

if $programname == 'myapp' then {
    action(type="omfile" dynaFile="appdaily")
    stop                             # 已落盘，不再流向后续规则
}
```

四个构件各司其职：`global(workDirectory=…)` 指定队列文件的存放地，不配它，后面任何磁盘队列参数都静默失效——这是 imfile 工程化里排名第一的隐形坑；`input(type="imfile")` 盯住文件，应用追加一行、imfile 读走一行，文件被轮转改名后 imfile 会自动跟到新文件（配合轮转的 copytruncate 方案时注意轮转瞬间的丢行窗口，见[日志轮转](../basic/log/rotation.md)）；`Tag` 决定这条消息在管线里的身份，后续所有过滤都按 `$programname` 对暗号；`dynaFile` 模板把 `%$YEAR%-%$MONTH%-%$DAY%` 展开进路径，等于让 rsyslog 替你做了一份按天切分，切分粒度与轮转策略二选一即可，不必双保险。要接多个文件时，imfile 的 `File` 参数支持通配（`File="/opt/app/log/*.log"`），一个 input 盯住一组滚动文件；但通配进来的消息共用同一个 Tag，需要按文件区分去向时就得拆成多个 input 各给各的 Tag——身份在入口处定，是整条管线的第一原则。结尾的 `stop` 是 rainer 脚本的"到此为止"——没有它，这条消息还会继续流向下一条规则，最终在 `/var/log/syslog` 里再出现一次，这就是"写重了"的标准成因。

改完配置的固定动作是先验后启，与改 DNS 先 `named-checkconf` 同一纪律：

```bash
$ sudo rsyslogd -N1
rsyslogd: version 8.2312.0, config validation run (level 1), master config /etc/rsyslog.conf
rsyslogd: End of config validation run. Exit.
$ sudo systemctl restart rsyslog
$ logger -p local1.info -t myapp "manual smoke test"   # 冒烟：伪造一条走管线
$ tail -1 /var/log/app/myapp/2026-10-02.log
Oct  2 10:02:11 web01 myapp: manual smoke test
```

`logger` 是这条管线最好的验收工具——它向总线注入一条带指定 facility 与 tag 的消息，末端文件里立刻应该出现；一分钟内完成"改配置 → 验语法 → 重启 → 注入 → 见结果"的闭环，比等应用真实写日志再翻文件快得多。

### 4.2 转发与队列缓冲

把日志送离本机是集中化的前提。转发有新旧两种写法，语义相同：老写法一行流（两个 @ 是 TCP，单个 @ 是 UDP）：

```text
# /etc/rsyslog.d/40-forward-legacy.conf —— 老写法：能跑，但无从配队列
*.* @@192.168.56.20:514     # TCP
*.err @192.168.56.20:514    # UDP：只送 err 及以上
```

老写法胜在十秒能写完，输在没有任何缓冲语义——中心一不可达，发送端要么阻塞要么丢弃；生产上建议直接用新写法，参数化并允许配置队列：

```text
# /etc/rsyslog.d/40-forward.conf —— 转发到中心收集器（TCP + 磁盘队列缓冲）
action(type="omfwd"
       target="192.168.56.20"
       port="514"
       protocol="tcp"
       queue.type="LinkedList"          # 内存链表队列
       queue.filename="fwd_central"     # 满溢后落盘的文件名前缀（依赖 workDirectory）
       queue.maxDiskSpace="100m"        # 磁盘队列上限
       queue.saveOnShutdown="on")       # rsyslog 退出时把队列存盘，重启续传
```

TCP 与 UDP 的选择是可靠性与开销的取舍：UDP 轻量但丢包无声，适合内网低价值流；TCP 保序可靠，但中心收集器不可达时会反压——队列缓冲正是为这段不可达窗口准备的：内存队列先顶，顶不住落磁盘，收集器恢复后续传，`saveOnShutdown` 再把"rsyslog 自己被重启"这个窗口也兜住。代价是磁盘队列依赖 4.1 节强调的 workDirectory，且排队会掩盖"中心其实早挂了"的事实——队列监控（`impstats` 模块）在生产上值得加，但已超出本页范围，知道队列是缓冲不是免死金牌即可。

### 4.3 防噪声：stop 的次序语义

rsyslog 的规则表是**顺序执行**的，与防火墙规则链同一心智模型：消息从上往下流，命中就执行动作，`stop` 是显式的"匹配终止"。防噪声的常规手法是把明确不要的来源尽早 stop 掉——健康检查每十秒一条的 access 日志、调试期某组件的 debug 流量，放行它们进 `/var/log/messages` 的唯一效果是把有用信号稀释掉：

```text
# /etc/rsyslog.d/31-noise.conf —— 尽早丢弃的噪声源
if $programname == 'healthcheck' then stop
if $syslogfacility-text == 'local0' and $syslogseverity-text == 'debug' then stop
```

两条纪律：stop 要放在文件名靠前的片段里（rsyslog.d 按 00-99 的序号排序执行，晚放的 stop 救不回已经被前一条规则写盘的消息）；stop 是丢消息不是过滤消息——确定永远不要才 stop，拿不准就用第 4.1 节的模板切到独立文件，留着不碍事。

## 5. 集中式日志：单机日志在故障时不可信

日志与机器同生共死，是单机日志的结构性缺陷：磁盘烧了、内核 panic 了、云主机被回收了，解释事故的唯一证人与事故一起消失。集中式的思路很朴素——在机器还活着的时候就把日志送走，本机只当缓冲。最小实现就是第 4.2 节的 omfwd 转发加一台中心 rsyslog；中心侧收下来按来源主机分目录，也是一段模板的事：

```text
# 中心收集器 /etc/rsyslog.d/50-receive.conf —— 接收远端并按主机分目录
module(load="imtcp")
input(type="imtcp" port="514")

template(name="byhost" type="string"
         string="/var/log/remote/%HOSTNAME%/%$YEAR%-%$MONTH%-%$DAY%.log")

*.* ?byhost
```

规模再往上，现代栈的 vector、fluent-bit 这类专用采集器在解析、路由、多目的地上更顺手，但"本机轻量转发、中心集中存储"的拓扑不变，换的只是零件。集中化之后有三条边界要心里有数：其一，**时间戳的可信度决定日志的可比性**——两台机器时钟差两分钟，中心里的事件顺序就是错的，先保证 NTP 到位（见[时间服务](../server/ntp.md)）再谈跨机关联；其二，**转发是异步的**，机器猝死前最后一秒的日志可能还在队列里没送出，能容忍这截断口才能正确解读"最后一条日志停在 03:14:08"的含义；其三，**保留策略与合规是一对约束**——安全审计要求留 180 天与磁盘预算要求只留 7 天冲突时，折中方案是分级保留（完整流短期、告警流长期），文本文件的轮转参数怎么配见[日志轮转](../basic/log/rotation.md)。

## 6. 常见坑

**重启后 journal 历史消失。** `journalctl -b -1` 报 "Data from the specified boot(s) is not available"、`--list-boots` 只有一行，都是同一个事实：journald 在易失模式（`/run/log/journal/`）下运行，重启即清零。按第 3.2 节打开持久化（mkdir + tmpfiles 修属主 + restart + flush），并确认 `/var/log/journal/<machine-id>` 属主是 `root:systemd-journal`、模式 2755。

**-u 查不到老日志。** 三个来源：日志本体已被 `--vacuum-size` 或配额回收（`--disk-usage` 对照）；查询隐含了 `-b` 只看本次开机（显式加 `-b -1` 或去掉）；unit 名对不上——`.service` 后缀可省，但 `-u` 按消息记录时的单元名精确匹配，服务改名后的历史日志仍挂在旧名下，别名同样对不上，`systemctl status <旧名>` 能帮你确认记录名。

**磁盘被日志塞满。** 先分清是谁占的：`journalctl --disk-usage` 看 journal，`du -sh /var/log/* | sort -h | tail` 看文本文件，两者处置路径完全不同：

```bash
$ journalctl --disk-usage
Archived and active journals take up 3.9G in the file system.
$ sudo journalctl --vacuum-size=500M      # 应急：立即压回额度内
Vacuuming done, freed 3.4G of archived journals from /var/log/journal/7e6d….
$ sudo du -sh /var/log/* | sort -h | tail -3
4.0K    /var/log/remote
412M    /var/log/journal
2.1G    /var/log/app                    # imfile 切出来的应用目录，归轮转管
```

journal 侧查 `SystemMaxUse` 是否缺配、`/var/log/journal` 权限是否正确，应急用 `--vacuum-size` 立即回收；imfile 按天切出来的文件不在 journald 配额范围内，归 logrotate 管（给 `/var/log/app` 补一份轮转片段，见[日志轮转](../basic/log/rotation.md)）。配额的治本项是 `SystemKeepFree`——它保证日志永远给文件系统留出退路。

**rsyslog 改了配置不生效。** 两种典型：没跑 `rsyslogd -N1` 直接 restart，语法错导致服务起不来（`systemctl status rsyslog` + `journalctl -u rsyslog -e` 看红行）；语法过了但片段文件放错了位置——rsyslog.d 目录靠主配置的 include 生效，Arch 上主配置未必默认包含该目录，`rsyslogd -N1` 验的是"加载到的配置"，没被 include 的文件验不到也永远不执行。

**应用日志没进 journal。** systemd 只代收自己拉起的服务进程的 stdout/stderr：应用由 nohup 手工起、或自己写文件不碰标准输出，journal 里自然没有。两条路二选一：把应用纳入 systemd（输出自动入 journal），或用第 4.1 节的 imfile 把文件侧接进 rsyslog 管线；判断归属最快的办法是 `journalctl _COMM=<进程名>` 按可执行名查一次。

**同一条消息写了两次。** 场景几乎总在 rsyslog 侧：两条规则都命中且没有 stop（4.1 节的 `if` 块结尾漏写）；或片段文件序号排在通用规则之后，专用文件写完 `/var/log/messages` 又写一遍。排查顺序：从消息反查它命中了哪些 `omfile`（`rsyslogd -N1` 只验语法不验逻辑，逻辑要靠把规则表当防火墙链逐条走），然后在恰当位置补 stop；journal 与文本文件各存一份不算重复（见第 3.4 节的衔接说明），不要为此关掉任何一边。

## 参考资料

- systemd journalctl 手册 — [freedesktop.org](https://www.freedesktop.org/software/systemd/man/journalctl.html)
- systemd journald.conf 手册 — [freedesktop.org](https://www.freedesktop.org/software/systemd/man/journald.conf.html)
- rsyslog 官方文档 — [rsyslog.com](https://www.rsyslog.com/doc/)
- Arch Wiki: systemd/Journal — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Journal)
- 鸟哥的私房菜 — [linux.vbird.org](https://linux.vbird.org/)
- man journalctl / man rsyslog.conf — 本机手册
