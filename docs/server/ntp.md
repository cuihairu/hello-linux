# NTP 时间服务（chrony）

个人电脑的时间差几分钟，多数人毫无感觉；服务器差这几分钟则全线出事：TLS 证书的生效窗口对不上，握手直接失败；凌晨三点的例行任务因时钟跳变被跳过或跑两遍；多机排障时日志时间戳对不齐，因果链拼不起来。NTP（Network Time Protocol）就是"把所有机器的表对到同一秒"的那套协议，chrony 则是现代 Linux 上的主力实现——它既做客户端把自己校准，也能做内网时间服务器，让几十台机器不再各自为政。本页按"时钟为什么不能漂 → 三系安装与默认客户端现状 → chrony.conf 配置 → chronyc 观察验证 → ntpd 老服务器对照 → 常见坑"展开；对外提供时间服务需要放行 UDP 123 端口，不在本页展开，见[防火墙篇](../security/firewall.md)。

> 内容参考自 chrony 官方文档与 Arch Wiki（概念框架参考鸟哥的私房菜），见文末参考资料。

## 学习目标

- 分清 RTC、系统时钟与单调钟三种时间，说清 UTC 与时区的分工
- 掌握三发行版安装与启用（apt / pacman / dnf），理清 timesyncd 与 chrony 的层级关系
- 读懂 chrony.conf 的 pool/server、allow、local stratum、makestep、rtcsync
- 会用 chronyc tracking 与 sources 判断同步健康度，掌握 makestep 的步进纪律
- 排查 reach 为 0、双客户端打架、时区错位、内网同步失败等高频坑

## 1. 为什么服务器的时钟不能漂

### 1.1 时间错会坏什么：四个真实场景

第一是**认证与加密的时效判断**。Kerberos 默认只容忍约 5 分钟的时钟偏差，超过就直接拒绝认证——域环境里"突然全员登录失败"的排查走到最后，常常是某台机器的钟漂了。TLS 证书带 notBefore/notAfter 有效期，客户端时间超前会让本该过期下线的证书继续被信任，时间倒退则会把尚未生效的证书误判在窗口内，两类错的方向不同，坏法相同。

第二是**例行任务的触发语义**。cron 与 systemd timer 是否触发，完全取决于系统时钟读数；一次步进（把时间直接拨过去）可能让 02:59:58 跳到 03:00:40，计划在 03:00 整点跑的任务就此错过，反向拨针则可能重复执行。这也是 chrony 默认"能不步进就不步进"的原因，见第 3 节 makestep 的取舍。

第三是**日志时序**。journald 与 rsyslog 的时间戳都取自系统时钟（见[系统日志](../basic/log/syslog.md)）；一台机器漂两分钟，多机事件的先后关系就拼不回去——安全事件重建与故障因果分析最依赖的就是这条时间轴。

第四是**分布式一致性**。DNSSEC 签名自带有效期，与 NTP 失步会让一切签名"过期"，本仓 DNS 章节已把这条列为 SERVFAIL 的排查项之一（见[DNS 服务器（BIND）](./dns/bind.md)）；数据库主从提交顺序、版本库提交时间同理——分布式系统里，时钟就是排序的依据，排序一乱，一致性无从谈起。

### 1.2 三种钟：RTC、系统时钟、单调钟

RTC（Real-Time Clock）是主板上的硬件钟，靠纽扣电池在断电时维持走时，职责只有一个：开机时给内核一个起点。系统时钟是内核维护的软件钟——`date` 与所有应用看到的时间都是它，开机从 RTC 读取，之后由 NTP 持续校准，精度远高于 RTC 本身。单调钟（monotonic clock）只向前走、不受任何校时影响，systemd 的启动耗时统计、程序内部的超时计时用的都是它——NTP 步进系统时钟时，正在计时的 sleep 不会被拉长或截短。两个时钟的"性格差异"可以一眼对照：

```bash
$ date && cat /proc/uptime
Fri Oct  2 15:04:05 CST 2026
512345.67 2012345.00     # 第一个数是单调钟：自开机起的秒数，NTP 动不了它
```

排障先分清"哪个钟错了"：RTC 电池没电会慢慢漂、系统时钟没同步会自由奔跑、显示层时区配错则钟其实是准的，三者处置完全不同。

### 1.3 UTC 与时区：系统存的是 UTC

Linux 内部以 UTC 维护系统时钟，显示时按 `/etc/localtime` 指向的时区换算——`timedatectl` 输出里 Local time 与 Universal time 永远是同一时刻的两种写法。服务器保持"系统时钟与 RTC 都存 UTC、按需设时区"最省心；与 Windows 双系统共存时要留意：Windows 默认让 RTC 存本地时间，两边对同一块硬件钟的解释不一致，轮流启动会互相"改错"八小时，`timedatectl` 会以 "RTC in local TZ" 警告提示。改时区不碰时钟本身——`timedatectl set-timezone Asia/Shanghai` 换的只是显示这一层皮。

## 2. 安装与三系现状对照

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 | `apt install chrony` | `sudo pacman -S chrony` | `dnf install chrony` |
| 搜索 | `apt search chrony` | `pacman -Ss chrony` | `dnf search chrony` |
| 查看包信息 | `apt show chrony` | `pacman -Qi chrony` | `dnf info chrony` |
| 查看文件列表 | `dpkg -L chrony` | `pacman -Ql chrony` | `rpm -ql chrony` |
| 升级 | `apt upgrade` | `sudo pacman -Syu` | `dnf upgrade` |
| 卸载 | `apt remove chrony` | `sudo pacman -R chrony` | `dnf remove chrony` |
| 观察工具 | chronyc 随主包 | chronyc 随主包 | chronyc 随主包 |

动手前先理清一个层级关系：systemd-timesyncd 是 systemd 自带的 SNTP 客户端——SNTP 只做"把指针拨到位"，不测算时钟快慢、不做频率补偿，也不能对外提供时间服务。纯客户端、精度要求不高的桌面机用它足够；一旦要对外供时（服务器、集群）、跑在虚拟机上（漂移快，需要频率补偿）、或网络时断时续（chrony 对间歇网络适应更好），就该换 chrony。三系裸装后的默认状态各不相同：Debian/Ubuntu 默认启用 timesyncd，RHEL/Rocky 从 7 起默认预装并启用 chronyd，Arch 基础系统默认不启用任何校时客户端——Arch 用户装完系统的第一件事里往往就有装 chrony。

决定暂时停在 timesyncd 的机器，也该知道它的开关在哪：上游地址写在 `/etc/systemd/timesyncd.conf` 的 `NTP=`/`FallbackNTP=`，改完 `systemctl restart systemd-timesyncd` 生效；`timedatectl set-ntp true/false` 是 systemd 侧的总开关，`timedatectl show-timesync` 能看到它当前同步到了谁——这台机器"只对表、不供时"的边界，在排内网时间问题时要先想清楚。

```bash
$ timedatectl set-ntp true && systemctl restart systemd-timesyncd
$ timedatectl show-timesync | grep -E 'ServerName|Offset'
ServerName=time.cloudflare.com
Offset=+52.3ms
```

unit 名与配置路径是三个独立维度：Debian 的服务单元叫 `chrony`，Arch 与 RHEL 都叫 `chronyd`；Debian 的配置在 `/etc/chrony/chrony.conf`（目录式布局，地址源另拆在 `/etc/chrony/sources.d/`），Arch 与 RHEL 是单文件 `/etc/chrony.conf`。排错时先 `systemctl status` 对准 unit，再谈配置文件——与 DNS 篇 bind9/named 的命名差异是同一类坑。

### 2.1 Debian/Ubuntu

```bash
$ sudo apt install chrony
$ systemctl is-active systemd-timesyncd
inactive                     # chrony 的包装脚本会自动停用 timesyncd，手动确认一遍更稳
$ sudo systemctl enable --now chrony && systemctl is-active chrony
active
```

Debian 的 chrony.conf 用 sourcedir 把地址源拆进 `/etc/chrony/sources.d/` 等目录——与 BIND 把配置拆进 `named.conf.options` 片段是同一哲学，升级包时本地改动不易被覆盖。chronyc 随主包带来，装完即可观察同步状态；换地址源时往 sources.d 里加文件、restart 服务即可，不必改主配置。

### 2.2 Arch

```bash
$ sudo pacman -S chrony
$ sudo systemctl enable --now chronyd
$ chronyc tracking | head -2
Reference ID    : A29FC87B (time.cloudflare.com)
Stratum         : 3
```

Arch 官方 extra 仓库一步装齐；`chronyd.service` 这个 unit 名与 RHEL 一致、与 Debian 不一致，写跨发行版脚本时先在这里对表。`pacman -Ql chrony` 可看清包铺了哪些文件与 unit，与 Debian 用 `dpkg -L`、RHEL 用 `rpm -ql` 是同一动作。基础系统默认没有任何校时客户端在跑，`enable --now` 这一步不能省。

### 2.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install chrony        # 通常已预装
$ sudo systemctl enable --now chronyd && systemctl is-active chronyd
active
$ chronyc sources | tail -3
```

RHEL 系默认配置已含 `makestep 1.0 3` 与 `rtcsync`，客户端开箱即用，要做的往往只是内网供时补 `allow` 行（见第 3 节）。chrony 是 RHEL 7 起的默认校时实现，老资料里的 ntpd 对照见第 5 节；SELinux 一般不拦 chronyd，日志与时间文件都在包默认上下文内，改路径时才需要留意。

## 3. chrony.conf 配置

### 3.1 客户端基线

```text
# /etc/chrony/chrony.conf（Debian）或 /etc/chrony.conf（Arch/RHEL）
pool 2.debian.pool.ntp.org iburst   # Arch 用 2.arch.pool.ntp.org，RHEL 用 2.rhel.pool.ntp.org
driftfile /var/lib/chrony/drift
makestep 1.0 3
rtcsync
```

逐行拆开：`pool` 把一个域名解析出多台 NTP 服务器冗余使用，比写死单点抗故障；要指定确定的上游（比如内网时间服务器）时才用 `server` 行。`iburst` 让初次握手发一组突发包，把首同步从几十秒压到几秒，代价可忽略，习惯上永远带上。`driftfile` 记录"这台机器的钟每天快/慢多少"——就像给表建一份"每天快五秒"的档案，重启后校准从档案续起，不必从零重新学习；文件由 chronyd 自己维护，不要手工编辑。`makestep 1.0 3` 的语义是"启动后前三次更新中，偏差超过 1 秒就直接拨针，此后永远只微调快慢"——步进（step）是拨指针，斜率校正（slew）是修快慢，cron 与数据库怕跳变，所以 chrony 默认能不步进就不步进。`rtcsync` 让内核周期性地把校准后的系统时钟写回 RTC，这样关机再开机，起点才是准的。

chrony 没有 `nginx -t` 那样的独立语法检查命令，指令写错会在 restart 时直接报进 `journalctl -u chronyd`——改前备份、改后看一眼日志再离场，就是这里的"先 check 再 reload"。改动分两档：调整 server/pool 地址源不必中断校时，`chronyc reload sources` 会让 chronyd 重读 sourcedir 目录（Debian 的目录式布局这时显出便利，往 sources.d 丢一个文件再 reload 即可）；动了 allow、makestep、local 这类行为指令，才需要完整的 `systemctl restart chronyd`，重启间隙时钟由内核自己维持，已学到的 driftfile 经验不丢。

### 3.2 作为内网时间服务器

```text
# 追加到 chrony.conf
allow 192.168.56.0/24        # 只对内网网段提供时间服务
local stratum 10             # 上游全部失联时，仍以第 10 层身份对外供时
cmdallow 192.168.56.0/24     # 允许该网段用 chronyc 远程查询本机状态（按需）
```

stratum 是 NTP 的"辈分"制度，一层一层往下延伸：

```text
Stratum 0   原子钟 / GPS 接收器（参考时钟，本身不上网）
Stratum 1   直连 Stratum 0 的服务器（一级时间源）
Stratum 2   同步自 Stratum 1 …… 依次下延，有效最大 15
```

每往下一层可信度降一级，客户端总是挑 stratum 最小、质量最好的源加权使用；`chronyc tracking` 里看到的本机 Stratum，就是最佳上游的层数加一。`allow` 是供时的总开关——不写 allow 的 chronyd 只做客户端，一个 UDP 包都不对外应答，这让它比老 ntpd 的默认姿态更安全。`local stratum 10` 解决"上游断了、内网跟着散伙"的问题：失去所有真实上游后，本机以第 10 层的身份继续供时，内网各机之间至少保持一致——准头让位给一致性，对集群往往更重要。`cmdallow` 管的是 chronyc 指令通道（默认只听本机），需要远程看状态时再按网段开口，平时不必开。对外供时的最后一环是防火墙放行 UDP 123，见[防火墙篇](../security/firewall.md)。

拼成一份完整的内网时间服务器配置，把这些指令各就各位：

```text
# /etc/chrony.conf —— 内网时间服务器（三系路径同第 3.1 节）
server time.cloudflare.com iburst     # 指定上游，不用 pool 也可多写两行冗余
server ntp.aliyun.com iburst
driftfile /var/lib/chrony/drift
makestep 1.0 3
rtcsync
allow 192.168.56.0/24                 # 供时网段
local stratum 10                      # 上游全断时保内网一致
bindcmdaddress 127.0.0.1              # 指令通道只留本机（默认行为，显式写出便于审阅）
cmdallow 127.0.0.1
```

这份配置读下来是一句完整的供职说明：向公网两台上游对表（iburst 加速首同步），把学习到的快慢记进 driftfile；对内网一个网段供时，纵使上游全断也以第 10 层身份维持秩序；chronyc 指令通道收在本机，不给内网任何机器远程下指令的口子。改完 restart，然后在另一台内网机器上把它写成 `server 192.168.56.10 iburst`——闭环的最后一步是用客户端的 `chronyc sources` 看到这台服务器拿到 `*` 或 `+`。

## 4. 观察与验证

### 4.1 chronyc tracking：本机同步得怎么样

```bash
$ chronyc tracking
Reference ID    : A29FC87B (time.cloudflare.com)
Stratum         : 3
Ref time (UTC)  : Thu Oct 02 07:15:41 2026
System time     : 0.000000842 seconds slow of NTP time
Last offset     : -0.000001234 seconds
RMS offset      : 0.000002345 seconds
Frequency       : 3.541 ppm slow
Residual freq   : +0.000 ppm
Skew            : 0.012 ppm
Root delay      : 0.018765432 seconds
Root dispersion : 0.000987654 seconds
Update interval : 130.2 seconds
Leap status     : Normal
```

先看三行：`Leap status` 应为 Normal——Not synchronised 说明还没同步上，回去查 sources；`System time` 告诉你当前比 NTP 时间快/慢多少，微秒级属于健康，毫秒级说明刚起步或网络在抖；`Stratum` 是本机当前层级，等于最佳上游加一。`Frequency` 记录的就是 driftfile 学到的"这块钟快慢多少 ppm"，长期跑下来它还能预告硬件钟的老化趋势。`Ref time (UTC)` 是最后一次校准时刻，若停在几小时前，同样先去查 sources 是不是全掉了。

### 4.2 chronyc sources：上游质量怎么样

```bash
$ chronyc sources -v
.-- Source mode  '|' indicates the local clock acts as a source of time
   '^' indicates a server, '=' indicates a peer, '#' indicates a local clock
 .-- Source state '*' indicates current best, '+' indicates combined,
 |                '-' indicates not combined, 'x' indicates time may be in error,
 |                '?' indicates unreachable, 'o' indicates PPS signal
                                                          ||====================
MS Name/IP address         Stratum Poll Reach LastRx Last sample
===============================================================
^* time.cloudflare.com           3  10   377   432  -134us[ -289us] +/- 8732us
^+ ntp1.example.com              2  10   377   512   +52us[  +52us] +/-   11ms
^? 203.0.113.10                  0  10     0     -     +0ns[   +0ns] +/-    0ns
```

M 列是源的类型（`^` 服务器、`=` 对等体、`#` 本机时钟），S 列是健康判词：`*` 当前最佳、`+` 可用且参与加权、`-` 备而未合、`?` 完全够不着、`x` 疑似与群体矛盾（falseticker）。`Reach` 是最近 8 次探测的八进制命中表——377 为全中，0 为全空（上面第三行就是一台被防火墙拦掉的死源）；出现 177 之类的中间值说明时通时断，网络质量问题会先在这一列露头。`Poll` 列是以 2 为底的指数：6 表示平均 64 秒问一次，10 表示 1024 秒——chrony 根据链路稳定度在上下限之间自动伸缩，链路越稳问得越稀、越抖缩得越密，这解释了为什么刚启动时更新频繁、稳定后 `Update interval` 慢慢拉长。`LastRx` 是最近一次应答距今多久，`Last sample` 给出偏差与误差界（`+/-` 列）。一台健康的机器应看到至少一个 `*` 或 `+`，且 Reach 稳定在 377。`chronyc sourcestats` 再补一层"学习结果"视角（每源的频率估计与散布），日常巡检看 sources 已够。

### 4.3 timedatectl 与手动步进

```bash
$ timedatectl
               Local time: Fri 2026-10-02 15:04:05 CST
           Universal time: Fri 2026-10-02 07:04:05 UTC
                 RTC time: Fri 2026-10-02 07:04:05
                Time zone: Asia/Shanghai (CST, +0800)
System clock synchronized: yes
              NTP service: active
          RTC in local TZ: no
```

`System clock synchronized` 与 `NTP service` 两行是 systemd 视角的结论，它既认 timesyncd 也认 chrony——装了 chrony 的机器上这两行为 yes/active 即链路通。运行中发现偏差大、等不及斜率校正时，用 `chronyc makestep` 手动拨一次针。纪律是：**在跑 chrony 的机器上 `date -s` 手工改时间应视为禁区**——你改的那一下会被 chrony 当成漂移去"修"回来，两人拔河，时钟反复横跳。确要手工干预，先 `systemctl stop chronyd`（Debian 为 chrony）改完再 start，或统一走 chronyc 自己的通道。

### 4.4 把验证串成一条冒烟链

单条命令各有盲区，巡检时把三样串起来看才算数：systemd 层的结论（服务在不在跑）、chrony 层的结论（同步到谁、质量如何）、硬件层的交叉验证（RTC 与系统时钟差多少）。`chronyc activity` 是一条常被忽略的快查——它直接报告在线/离线源各几台，写脚本判断时比解析 sources 表省事：

```bash
$ chronyc activity
200 OK
2 sources online
0 sources offline
0 sources doing burst (return to online)
0 sources doing burst (return to offline)
0 sources with unknown address
$ sudo hwclock --show                    # RTC 与系统时钟的交叉对照
2026-10-02 15:04:07.312345+08:00
$ journalctl -u chronyd --since "1 hour ago" | tail -3
```

三处全绿——activity 有在线源、`hwclock --show` 与 `date` 读数一致（rtcsync 在起作用的证据）、journal 无报错——这台机器的时间健康度就有了完整闭环；任何一处发红，再回到 4.1/4.2 的逐列解读定位是哪一层的问题。把这三条写进开机自检或巡检脚本，比出事后翻日志更早一步发现时钟悄悄漂了。

## 5. ntpd 老服务器与排错对照

```bash
$ ntpq -p
     remote           refid      st t when poll reach   delay   offset  jitter
==============================================================================
*ntp1.example.org  10.10.0.1      2 u   48   64  377   0.421   -0.312   0.201
+ntp2.example.org  10.10.0.2      2 u   12   64  377   1.002   +0.455   0.331
```

经典 ntpd 的观察入口是 `ntpq -p`：行首符号与 chrony 的 S 列同源（`*` 当前同步源、`+` 备选），reach、delay、offset、jitter 四列足以定位绝大多数问题——reach 凑不满 377 是网络问题，offset 大是偏差问题，jitter 大是链路不稳。今天还会遇到 ntpd 的场景：CentOS 6/7 时代的遗留生产机、部分网络设备固件、以及一些行业的老基线文档。新装机器一律 chrony——RHEL 已默认多年，Debian/Arch 仓库同样主推。两者绝不能同装同跑：两个守护进程都会对系统时钟做斜率校正，各修各的会把频率来回拉扯，时钟反而长期抖动。迁移的正确顺序是停用旧的（`systemctl disable --now ntp`）、确认 chronyd 起来并同步、再卸载旧包——先立新、再拆旧，中间留一步观察。

老文档里还有两个常见身影值得对上号。`ntpdate` 这个一次性校时工具早已被官方弃用——它的继承者在 chrony 世界里是 `chronyd -q`（校一次就走，不驻留），适合装系统后的第一次对表；在 ntp 世界里是 `sntp`。另一个是 `ntpd -g` 的"允许大偏差启动"参数，对应 chrony 侧就是第 3 节的 `makestep`——读老资料时把这两个词翻译过来，思路就能平移到 chrony，不必按旧文档再装一套 ntp。

## 6. 排错与常见坑

**sources 里全是 ？，Reach 为 0。** 企业防火墙拦掉 UDP 123 出站或 pool 域名不可达是最常见根因。排查顺序：`chronyc -N sources` 看域名有没有解析出地址（DNS 层）→ 换成手写的 `server time.cloudflare.com iburst`、`server ntp.aliyun.com iburst` 替代 pool（冗余层）→ 在网关侧确认 123 端口出站是否放行（防火墙层）。Reach 是八进制计数，从 1、3、7 一路爬到 377 才算满血——盯着它爬升的过程，本身就是链路恢复的直观证据。

**时间差很大，半天校不回来。** chrony 运行期默认只做斜率校正，出于对 cron 与数据库的保护不再步进，十几秒的偏差也要按"每秒修一点"的节奏追。急救通道是 `chronyc makestep` 立即拨针；要改默认策略，把 `makestep 1.0 3` 的窗口放宽——第三个数字改成 `-1`（如 `makestep 1.0 -1`）表示任何时刻偏差超 1 秒都允许步进，代价是跳变风险自负：步过一次针，恰好在跳变窗口里的定时任务就可能漏跑。

**虚拟机的时钟漂得快。** 虚拟机拿到的是宿主机虚拟出来的时钟，宿主负载一波动跟着漂，暂停再恢复更是直接拉开秒级偏差。三层对策：装 guest 增强工具（VMware 的 open-vm-tools、KVM 的 qemu-guest-agent），让宿主参与校时；放宽 makestep 窗口，容忍恢复后的大偏差一次步进；接受更密的更新节奏。容器是另一回事——容器没有独立时钟，看到的就是宿主的系统时钟，在容器里装 NTP 客户端属于方向性错误，该修的是宿主。

**双客户端打架：timesyncd 与 chrony 同时启用。** 症状是 chronyc tracking 明明健康，时间却仍被另一个进程拽走，或 `timedatectl` 的 NTP service 状态反复横跳。systemd-timesyncd 与 chronyd 都以校准时钟为业，同跑必然互相覆盖。处置顺序：`timedatectl set-ntp false` 关掉 systemd 侧的自动校时开关，再 `systemctl disable --now systemd-timesyncd` 做绝，最后确认 chronyd 单独在跑。Debian/Ubuntu 的包装脚本通常会自动处理这层，Arch 与手工改装过的机器要自己补上这一步。

**时间"显示"错了八小时，其实系统时钟是对的。** `timedatectl` 里 Local time 与 Universal time 的差值不对、日志时间戳集体偏移——这是时区层的问题，不是时钟层的问题，动 NTP 修不着。`timedatectl set-timezone Asia/Shanghai` 一步修正（本质是把 `/etc/localtime` 符号链接指向 `/usr/share/zoneinfo/` 下的对应文件），`timedatectl list-timezones` 查可用名。与 Windows 双系统共存的机器，留意 "RTC in local TZ" 警告——两边对硬件钟存 UTC 还是本地时间解释不一致，轮流启动会互相改错。

**内网机器同步不到自建时间服务器。** 按三层排查：服务端 `ss -ulnp | grep :123` 确认 chronyd 在监听、`chronyc tracking` 确认自己 Leap status 为 Normal——一个自己都没同步好的源，客户端会拒用；配置层确认 `allow 网段` 已写且重启过服务——没写 allow 的 chronyd 对外一个包都不应答，这是特性不是故障；网络层确认内网防火墙放行了 UDP 123。若客户端 sources 里该源标成 `x`，说明它与其余源矛盾得厉害，两侧时钟差得太远时先在客户端手动 `chronyc makestep` 对齐一次再观察，通常即恢复。

## 参考资料

- chrony 官方文档 — [chrony-project.org/doc](https://chrony-project.org/doc/)
- Arch Wiki: Chrony — [wiki.archlinux.org/title/Chrony](https://wiki.archlinux.org/title/Chrony)
- Arch Wiki: System time — [wiki.archlinux.org/title/System_time](https://wiki.archlinux.org/title/System_time)
- NTP Pool 项目 — [www.ntppool.org](https://www.ntppool.org/)
- 鸟哥的私房菜 - NTP 服务器 — [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0440ntp.php)
- man 手册 — [chrony.conf(5)](https://man.archlinux.org/man/chrony.conf.5.en)、[chronyc(1)](https://man.archlinux.org/man/chronyc.1.en)
- timedatectl(1) — [freedesktop.org](https://www.freedesktop.org/software/systemd/man/timedatectl.html)
