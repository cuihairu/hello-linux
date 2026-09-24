# 网络管理命令

对服务器而言，网络就是生命线：SSH 连不上、DNS 解析失败、端口没监听——这些占了日常排障的一大半。网络问题之所以让人害怕，是因为它看起来"玄学"：明明配置没错，就是不通。实际上，网络排障有一条非常固定的推理链——**本机配置对不对 → 本机能不能出去 → 中间路径通不通 → 目标服务活没活**——每一环都有对应的命令。本页的任务，就是把这条链上"本机状态"这一段的命令钉死：`ip` 看接口与路由、`ss` 看端口与连接、三系配置入口决定"改哪里"、DNS 解析路径决定"域名怎么变成 IP"。跨机器传输、HTTP 测试、抓包等工具场景放在[网络工具](./network-tools.md)，防火墙规则本身见[网络篇 · 防火墙](../../network/firewall.md)，本页只保留"端口是否在监听"这一层的判断，避免与那两处大段重复。

> 本页命令 `ip`、`ss`、`resolvectl` 在 **Debian/Ubuntu、Arch、RHEL/CentOS/Rocky** 三系上通用；差异集中在**持久化配置写在哪、用哪个守护进程管理网络、DNS 谁在代答**，文中会逐处标注。输出均来自真实终端（Ubuntu 26.04 + systemd-networkd + systemd-resolved 环境），你机器上的地址与进程名会不同，格式一致即可对照。

## 学习目标

- 理解为什么现代发行版用 `ip`/`ss` 取代 `ifconfig`/`netstat`，能在新系统上直接上手新命令
- 用 `ip link`/`ip addr`/`ip route`/`ip neigh` 回答"接口开着吗、地址是什么、包从哪走、邻居是谁"
- 用 `ss` 按状态/端口/进程过滤连接，读懂 `Recv-Q`/`Send-Q` 与 TIME-WAIT
- 分清三系持久化入口：Netplan、systemd-networkd、NetworkManager（nmcli），知道"临时改"和"重启还在"的区别
- 画出本机 DNS 解析路径：`nsswitch.conf` → `/etc/hosts` → systemd-resolved stub → 上游 DNS，并会用 `resolvectl` 排查

## 1. 为什么用 ip/ss 替代 ifconfig/netstat

`ifconfig` 和 `netstat` 来自 1980 年代的 net-tools 包，长期缺乏维护：接口统计语义含糊、不支持策略路由与网络命名空间等内核新特性、在高连接数机器上扫 `/proc` 极慢。iproute2（`ip`、`ss`）是内核 netlink 接口的直接封装，功能超集、三系默认预装，且与 `nftables`、cgroup、network namespace 同一时代。Arch 官方仓库已不再默认提供 net-tools；Debian/Ubuntu 上 `ifconfig` 往往要手动 `sudo apt install net-tools` 才出现——你在老教程里看到的命令，在新装的服务器上可能根本不存在。

同一件事的对照，一目了然：

| 你要做的事 | 旧命令（net-tools） | 新命令（iproute2） | 说明 |
|------------|---------------------|--------------------|------|
| 看所有接口 | `ifconfig -a` | `ip -br link` | `-br` 一行一个接口，适合扫一眼 |
| 看 IP 地址 | `ifconfig eth0` | `ip addr show eth0` | `ip addr` 即 `ip a` |
| 开/关接口 | `ifconfig eth0 up/down` | `ip link set eth0 up/down` | 对应链路层状态 |
| 看路由表 | `route -n` | `ip route show` | `ip r` 是等价简写 |
| 看 ARP/邻居 | `arp -n` | `ip neigh show` | 不再只有 IPv4 |
| 看监听端口 | `netstat -tlnp` | `ss -tlnp` | `ss` 直接读 netlink，快一个数量级 |
| 看连接状态 | `netstat -an` | `ss -ant` | 可再加状态过滤 |

```bash
$ ip -br link
lo               UNKNOWN        00:00:00:00:00:00 <LOOPBACK,UP,LOWER_UP>
ens18            UP             bc:24:11:c2:af:88 <BROADCAST,MULTICAST,UP,LOWER_UP>

$ ip -br addr
lo               UNKNOWN        127.0.0.1/8 ::1/128
ens18            UP             192.168.5.188/24 metric 100 fe80::be24:11ff:fec2:af88/64
ztksetoehl       UNKNOWN        10.147.19.84/24 fe80::40f:3dff:feb1:93f0/64
```

`-br`（brief）把每个接口压成一行：名称、状态、MAC、IP。排障时先跑这一条，比逐行读 `ifconfig` 快得多。`UNKNOWN` 不表示故障，只表示该接口当前没有"运营中"的二层语义（回环、点到点隧道常如此），真正要看的是有没有 `UP` 标志和 IP。很多新手看到 `UNKNOWN` 就以为网卡坏了，其实隧道、veth、回环几乎永远显示 `UNKNOWN`，只要能 `ip addr` 看到地址、能通信，就不用管这个状态词。

另一行 `ztksetoehl` 是典型的点到点/隧道设备（名字不是 `ens`/`enp` 前缀），它没有全局 IPv4 网段里的"广播域"语义，所以也常显示 `UNKNOWN`。读 `-br addr` 时按三问走：**状态是不是 UP、有没有 IPv4、有没有默认路由**（路由看下一节）。三问里缺哪一问，就只在对应层深挖，不要一上来怀疑 DNS 或防火墙。

谁提供了这些命令，三系略有差别，但结论一致——**优先学 iproute2，net-tools 只在读老文档时需要**。在 Ubuntu 上 `dpkg -S` 显示 `ip`/`ss` 来自 `iproute2`、`ping` 来自 `iputils-ping`，而 `net-tools` 是后装的旧工具集（Version 2.10-2ubuntu1）。判断某台机器有没有 net-tools，比 `command -v ifconfig` 更准的是查包数据库——有些精简镜像会预置同名 shell 函数或 busybox applet，造成"命令在、包不在"的假象。

- **Debian/Ubuntu**：`ip`/`ss` 由 `iproute2` 提供，默认已装；`ifconfig`/`netstat`/`route` 来自 `net-tools`，本机是显式安装过的，干净系统可能没有。
- **Arch**：`iproute2` 为 base 依赖，`pacman -S iproute2` 几乎总显示已安装；net-tools 不在默认安装集里，需要时 `sudo pacman -S net-tools`。
- **RHEL/CentOS/Rocky**：同样默认带 `iproute2`；最小化安装若缺 `ping`，用 `sudo dnf install iputils`。

三系结论一样：**新文档、新脚本一律写 iproute2**；只有维护十年前的运维手册时才需要临时补装 net-tools。若你必须在两套之间混写（不推荐），至少保证同一段自动化里只用一套，避免把 `route -n` 的输出格式误喂给解析 `ip route` 的脚本。

从 `ifconfig` 迁移到 `ip` 时，最容易不适应的是**语法结构**：`ifconfig eth0 192.168.1.10/24` 把对象和动作揉在一起，而 `ip` 统一成 `ip 对象 动作`——地址归 `address`，链路状态归 `link`，别指望 `ip addr up`。官方迁移文档（`ip-cref`）里有一张速查长表，日常只需记住本节表格那七行；其余生僻用法（`ip link add type veth`、`ip netns exec`）等真需要建虚拟设备时再查手册即可。

## 2. ip 命令族：接口、地址、路由、邻居

`ip` 的语法是 `ip [选项] 对象 命令`，对象包括 `link`（二层）、`address`（三层地址）、`route`（路由表）、`neigh`（邻居/ARP）、`netns`（网络命名空间）等。对象可以简写：`ip a` = `ip addr`，`ip r` = `ip route`。

### 2.1 ip link —— 链路层状态

`ip link` 回答"网卡存在吗、驱动加载了吗、是不是 UP"。`<BROADCAST,MULTICAST,UP,LOWER_UP>` 里的 `UP` 是管理员手动拉起，`LOWER_UP` 是物理载波检测到（网线/链路正常）。只有 `LOWER_UP` 没有 `UP`，说明物理通但管理员把接口关了；两个都没有，先查线缆或虚拟设备是否被创建。

单接口详情里字段很多，日常抓四个就够：`mtu`（是否被隧道/PPPoE 改小）、`state`（内核视角 UP/DOWN）、`link/ether` MAC、`inet` 与 `inet6` 地址及前缀。`altname` 是 predictable name 的别名（`ens18` 与 `enp6s18` 指同一设备），旧脚本写死接口名时能帮你对上号。`valid_lft forever` 表示地址永不过期——若是 DHCP 租约，这里会显示剩余时间，租约快到期却没续上时，这一行能直接看出"地址快没了"而不是"网断了"。`scope global` 与 `scope link` 的区别也要分清：全局地址可路由出网段，链路本地只能本网段用，IPv6 通信故障时若只有 `fe80` 没有全局地址，多半是 RA/SLAAC 或 DHCPv6 没配好。

临时启停可以记四句：链路开关 `ip link set dev 网卡 up|down`，地址增删 `ip addr add|del 地址/前缀 dev 网卡`，**全部重启即失**。`metric` 是路由优先级，数字越小越优先。同一接口上 DHCP 常带 `metric 100`，手工加地址时若不指定 metric，可能与默认路由优先级冲突，导致"地址加了却不通"。远程操作时把 `down` 当成"最后手段"，它和拔网线在会话眼里没有区别。

### 2.2 ip route —— 包往哪走

路由表决定每个目的地址从哪个网卡、哪个网关出去。排障顺序固定：先看默认路由在不在，再用 `ip route get` 验证内核对特定目标的实际选择。

```bash
$ ip route show
default via 192.168.5.11 dev ens18 proto dhcp src 192.168.5.188 metric 100
10.147.19.0/24 dev ztksetoehl proto kernel scope link src 10.147.19.84
192.168.5.0/24 dev ens18 proto kernel scope link src 192.168.5.188 metric 100
192.168.5.0/24 via 10.147.19.17 dev ztksetoehl proto static metric 5000

$ ip route get 8.8.8.8
8.8.8.8 via 192.168.5.11 dev ens18 src 192.168.5.188 uid 1000
```

`default via 192.168.5.11` 是默认网关；`proto dhcp` 表示这条路由来自 DHCP，重跑 DHCP 可能改写它；`metric 5000` 的静态路由优先级低，不会抢默认出口。`ip route get` 的输出是"如果现在发一个去 8.8.8.8 的包，内核实际怎么走"——当 `ip route show` 里有多条重叠路由时，只有这条命令能给出最终答案。

本机路由表里有一个很好的教学案例：`192.168.5.0/24` 同时出现在两条路由里，一条是 `dev ens18 ... metric 100`（本直连），一条是 `via 10.147.19.17 dev ztksetoehl metric 5000`（经隧道的静态路由）。内核选 metric 更小的那条，所以访问同网段走物理网卡；若你把静态路由 metric 改成 10，流量会立刻改走隧道——**同网段"忽快忽慢"或"明明直连却绕远"，八成是 metric 或重叠前缀在打架**。排障时不要只看有没有 default，要看**目标网段匹配到了哪一条、metric 是多少**。

还要区分 `proto dhcp`、`proto kernel`、`proto static` 三种来源：`kernel` 是接口配置自动生成的直连路由，`dhcp` 随租约刷新可能整段重写，`static` 来自配置文件或手工命令。改配置时若预期是 static 却看到 proto dhcp，说明管理器还没接管、或手工命令被 DHCP 回收——这能解释"地址在、路由被冲掉"的诡异现象。

临时加删路由（重启或接口重置后消失）记三句：默认网关 `ip route add default via 网关`，特定网段 `ip route add 目标/前缀 via 网关`，删除把 `add` 换成 `del`。生产上更推荐在配置管理器里声明路由，临时命令只用于救火。

策略路由（`ip rule`）在多网卡/多出口服务器上很常见，默认三条规则即可看懂优先级：数字小的先匹配，`local` 表处理本机地址，`main` 是 `ip route show` 那张表，`default` 通常为空。需要按源地址或 fwmark 分流时才添加自定义规则——那是进阶话题，日常排障先确认 `main` 表正确即可。

### 2.3 ip neigh —— 二层邻居

同网段通信靠 ARP/ND 把 IP 解析成 MAC。网关 ping 不通但链路层看起来正常时，先看邻居表：

```bash
$ ip neigh show
192.168.5.11 dev ens18 lladdr 04:0e:3c:2f:c5:a9 REACHABLE
192.168.5.125 dev ens18 FAILED
192.168.5.5  dev ens18 lladdr bc:24:11:7d:b8:44 STALE
192.168.5.1  dev ens18 lladdr 94:28:6f:bf:d1:35 REACHABLE
fe80::5 dev ens18 lladdr 94:28:6f:bf:d1:35 router STALE
```

`REACHABLE`/`STALE` 是正常的邻居状态（STALE 只是缓存过期、会在用时刷新）；**`FAILED` 表示 ARP 解析持续失败**——常见原因：IP 配错网段、对端关机、交换机端口安全/VLAN 不匹配。`lladdr` 即解析到的 MAC，可与交换机 MAC 表核对。

邻居表排障有一个非常实用的对照手法：在对端机器上跑 `ip neigh show | grep 你的IP`，看**双方是否都学到了对方 MAC**；再 `arping -I 网卡 对端IP` 主动发一次 ARP（需要 `arping`/`iputils-arping`，三系包名略有差异）。单边有、另一边没有，问题在单向链路、VLAN 或防火墙的 ARP 过滤；两边都 FAILED 且同网段，则优先怀疑 IP 冲突或子网掩码不一致。`ip neigh flush dev 网卡` 可以清掉陈旧条目再测，但它是**清缓存不是修根因**，flush 完仍失败就别再 flush 了。

### 2.4 统计与细节

看丢包、错包，判断是应用问题还是驱动/线路问题时，用 `ip -s link show 网卡`。关注三列增长速率：`errors`（校验/帧错，多为线缆双工）、`dropped`/`missed`（内核来不及收，中断亲和或 ring buffer）、TX 的 `carrier`（对端链路闪断）。**看统计前先记下当前数值，等复现问题后再看增量**，而不是盯着累计总量焦虑——`bytes` 从开机起一直累加，几 TB 的 RX 字节数完全正常。真正值得设阈值告警的是前三列的**增长速率**，以及 `carrier` 的跳变。云主机上若这三列长期为 0，网络层基本可以排除，该往应用和 DNS 方向查了。`ip -s` 可与 `ethtool -S` 对照定位驱动层计数。

## 3. ss：端口、连接与队列

`ss` 是 `netstat` 的现代替代：直接向内核要 socket 信息，不需要扫描 `/proc/net`。最常用的组合是 `-tlnp`：TCP 监听 + 数字端口 + 显示进程。真实输出里最有教学价值的三行是：`0.0.0.0:22` 全接口监听的 SSH；`127.0.0.1:3306` 只绑回环的 MySQL（外部连不上是设计，不是防火墙故障）；`127.0.0.53%lo:53` systemd-resolved 的 stub（不是你的应用抢端口）。`Process` 列需要 root 或同用户才完整，普通用户常为空。

"外部连不上"的完整判定链建议固定为：**先 `ss -tlnp` 看监听地址 → 再 `ss -ant | grep 目标` 看有没有 SYN 到达并进入 ESTABLISHED → 最后才开防火墙和应用日志**。只监听回环时，正确修法是改应用的 `bind` 地址或加反代，而不是在防火墙里疯狂放行——包根本没到 netfilter 的 PREROUTING 之外的目标 socket。反之监听正常、有 SYN 无 ACK，问题在路径/防火墙/对端未响应，正好转到防火墙页与 `tcpdump`。

常用过滤可以把五行命令背成一句话：**听端口用 `-tln`，查进程加 `p`，看长连接用 `-ant state established`，看堆积用 `-o state time-wait`，看总量用 `-s`**。实际敲的时候再按需 `| grep :80` 或 `| grep pid` 收窄。`ss -s` 输出适合快速判断"连接是不是炸了"：`estab` 持续上涨且业务无增长，查泄漏；`timewait` 数万但 `estab` 正常，多数只是短连接模式，不必恐慌（可结合 `ss -o state time-wait` 看计时）。`orphaned` 非零要查未 `close` 的进程。

读法要点已足够支撑 90% 的端口类工单。值得再展开的是 **Recv-Q 与 Send-Q 在不同状态下的语义**：LISTEN 时 `Recv-Q` 是等待 accept 的连接数、`Send-Q` 是 backlog 上限，前者贴近后者说明应用来不及 accept，应加大 backlog 或修应用；ESTABLISHED 时它们才是收发缓冲区待处理字节。很多"服务卡住"的事故，根因就是 accept 队列打满，而这个信号只在 `ss -tlnp` 里一闪而过——排障时对可疑端口多停留两秒看这两列，往往比翻十页日志更快。

另一个是 **UDP**：`ss -ulnp` 格式相同，但 UDP 没有三次握手，"LISTEN 正常"不代表对端能收到，得靠业务日志或抓包。DNS、SNMP、syslog 的疑难杂症常卡在这里——`ss` 只能证明本地 socket 在，不能证明报文出去了、回包回来了。

| 含义 | netstat | ss |
|------|---------|-----|
| TCP 监听 + 进程 | `netstat -tlnp` | `ss -tlnp` |
| 所有 TCP 连接 | `netstat -ant` | `ss -ant` |
| UDP 监听 | `netstat -ulnp` | `ss -ulnp` |
| 连接统计 | `netstat -s` | `ss -s` |
| 按进程过滤 | `netstat -anp \| grep pid` | `ss -antp \| grep pid` |

需要把 socket 反查到"打开它的文件描述符/命令行"时，`lsof` 仍有一席之地（`lsof -i :3306`），但它比 `ss` 慢，且不是三系都默认安装；日常以 `ss -tlnp` 为主。当你需要**已建立连接对端是哪个进程**、或者要 `lsof` 看某进程打开的全部文件（不只是网络）时，它才不可替代。`lsof -i -P` 的 `-P` 禁止把端口号反解成服务名，排障时能避免 `https`/`443` 混淆，管道里几乎总该加上；输出里 `LISTEN` 与 `ESTABLISHED` 并列，正好把"谁在听"和"谁连着谁"一次看清。

## 4. 三系网络配置入口差异

`ip`/`ss` 管的是"现在"，重启后如何恢复地址，三系走的是完全不同的入口。把 A 系的配置文件拷到 B 系不但不生效，还可能让机器彻底失联——**远程改网络前先确认发行版，并保留控制台/带外回滚手段**。

| 家族 | 默认管理器 | 配置入口 | 应用方式 | 常用命令 |
|------|-----------|----------|----------|----------|
| Debian/Ubuntu（桌面/服务器常见） | Netplan（后端 networkd 或 NM） | `/etc/netplan/*.yaml` | `sudo netplan try`（120 秒自动回滚）或 `netplan apply` | `netplan status`、`netplan get all` |
| Debian 精简/容器 | ifupdown | `/etc/network/interfaces` | `ifup`/`ifdown` 或重启 ` networking ` | `ifquery --list` |
| Arch（服务器常见） | systemd-networkd | `/etc/systemd/network/*.network` | `sudo systemctl reload systemd-networkd` | `networkctl status`、`networkctl list` |
| Arch（桌面常见） | NetworkManager | `/etc/NetworkManager/system-connections/` | `nmcli connection up 名称` | `nmcli`、`nm-online` |
| RHEL/CentOS/Rocky 7 | ifcfg 脚本 | `/etc/sysconfig/network-scripts/ifcfg-*` | `nmcli connection reload` 或重启网络服务 | `nmcli`、`ifup` |
| RHEL/CentOS/Rocky 8+ / Fedora | NetworkManager（keyfile） | `/etc/NetworkManager/system-connections/`（`.nmconnection`） | `nmcli connection up 名称` | `nmcli`、`nmcli device` |

表读完再补两条与第 3 节呼应的事实，避免把"配置入口"和"当下状态"混为一谈：上表管的是**重启后如何恢复地址**，`ss`/`ip` 管的是**现在谁在听、谁连着谁**——远程改网络前先用 `ss -tlnp` 记下当前监听，改完再对照一次，才能确认变更只动了该动的接口。

两个必须记住的版本事实：

1. **RHEL 9 起不再提供 `network-scripts` 包**，老教程里的 `/etc/sysconfig/network-scripts/ifcfg-eth0` 写法在新系统上没有落点，统一改用 `nmcli`/NetworkManager keyfile。
2. **Netplan 本身不配置网卡，只生成后端配置**。`netplan status` 里 `ens18 ... (networkd: ens18)` 就表示 YAML 由 netplan 生成、实际由 systemd-networkd 执行；同一台 Ubuntu 也可能看到 `NetworkManager` 字样，取决于 `renderer` 设置。

本机（Ubuntu + networkd）的真实状态可以归纳为三句话：回环与隧道由内核/其他组件管理，Netplan 不碰；物理网卡 `ens18` 状态 UP、地址来自 DHCP、默认路由经 `192.168.5.11`；DNS 下发了四条（含链路本地），所以 `resolvectl dns` 会看到多个 nameserver。`Online state: online` 只说明管理器认为配置已满足，**不等于业务连通**——它是"配置层健康"，连通性仍要靠 ping/curl 验证。把这两种健康分开，是避免"状态明明 online 却上不了网"式困惑的关键。

`unmanaged` 表示 Netplan/该管理器不接管这个设备（隧道、容器 veth 常见）；`managed` 且带 `(dhcp)`/`(networkd)` 才是"由声明式配置管着"的接口。改 YAML 后先 `sudo netplan try`，倒计时内不确认会自动回滚，这是 Ubuntu 上防踢线最实用的安全网。

`netplan status` 还有一处值得盯：`Online state: online` 与每个 link 的 `DNS Addresses`、`Routes` 是否和你写进 YAML 的一致。YAML 写了静态 IP 但状态里仍是 `(dhcp)`，说明设备匹配名（`match:` MAC/名称）没写对、文件没 apply、或被 NM 抢走；`DNS Addresses` 为空而你能上网，多半是 DNS 走了另一条 link 或手动 `resolv.conf`，不要和第 5 节的解析路径搞混——**netplan 显示的是"管理器下发了什么"，`resolvectl dns` 显示的是"resolved 实际在用什么"**，两者都该看一眼。

临时验证同一台机器时，可以并行开两个终端：一个改 YAML + `netplan try`，另一个持续 `watch -n1 'ip -br addr; ip route'`。倒计时内确认无误再回车保存；一旦路由消失立刻什么都不做，120 秒后自动回滚——这个流程比"改完 apply 然后祈祷 SSH 还在"可靠一个数量级，也是我们坚持把 Ubuntu 入口写进总表的原因。

Arch 上对应的一眼对比：配置是 INI 风格而非 YAML——

```ini
# /etc/systemd/network/10-eth0.network（Arch / systemd-networkd 示例）
[Match]
Name=eth0

[Network]
Address=192.168.1.100/24
Gateway=192.168.1.1
DNS=8.8.8.8
DNS=8.8.4.4
```

RHEL 系日常不要手改 keyfile 二进制/INI，优先 `nmcli`，它会同时改配置并激活连接：

```bash
nmcli connection show                    # 列连接
nmcli device status                     # 列设备
nmcli connection modify 已有连接 ipv4.addresses 192.168.1.100/24
nmcli connection up 已有连接
```

**临时 vs 持久**的判断标准很简单：`ip addr add` 加的地址、`ip route add` 加的路由，进程重启/机器重启即消失；写进 Netplan YAML、`*.network`、`nmcli connection modify` 的才会由守护进程在开机时重建。排障时若"重启后又坏了"，几乎一定是只做了临时修改。

选入口时还有三条实践建议。第一，**服务器优先选声明式、可进 Git 的配置**（Netplan YAML、`*.network`、keyfile），桌面/NM 环境则优先 `nmcli`，避免手改二进制或易漂移的文件。第二，**一次只动一个接口**，改完立刻从第二条路径验证（新开 SSH、看 `ip -br addr`、看网关 ping），不要一口气把三张网卡的 YAML 都改完再测。第三，**容器与云镜像里上述入口可能全部不存在**——网络由 veth/云厂商注入，此时只读 `ip`/`ss` 即可，别在容器里找 `/etc/netplan`。

防火墙不在本页展开：Ubuntu `ufw`、RHEL `firewalld`、Arch 自选 `nftables` 的规则语法与放行清单见[网络篇 · 防火墙](../../network/firewall.md)。本页与它的分工是——先用 `ss -tlnp` 确认**进程有没有监听**，再用防火墙页确认**包有没有被放行**。

## 5. DNS 解析路径：从域名到 IP

`ping 域名` 失败时，先分清是"链路不通"还是"解析失败"：`ping 8.8.8.8` 通而 `ping example.com` 不通，问题在 DNS；两者都不通，先回到第 2、3 节查地址和路由。DNS 在本机内部还要经过一条固定流水线。

### 5.1 谁先看、谁后看：nsswitch 与 hosts

glibc 的 `getaddrinfo()` 不直接读 `/etc/resolv.conf`，而是先看 `/etc/nsswitch.conf` 的 `hosts:` 行，典型值是 `hosts: files dns`：先查 `/etc/hosts`（`files`），没有再走名称服务（`dns`）。因此本地开发时把 `10.0.0.5 myapp.local` 写进 `/etc/hosts` 立刻生效，**不需要**碰 DNS 服务器；反过来，若 `hosts:` 被改成 `dns files`，`/etc/hosts` 会失效，表现像"改了 hosts 没反应"。三系默认都是 `files dns`，但容器镜像或加固脚本可能改过，排障时第一行就该 `grep hosts /etc/nsswitch.conf`。

`hosts:` 里还可能看到 `myhostname`、`mymachines`、`resolve` 等 systemd-nss 模块：`resolve` 会把解析直接转给 systemd-resolved，**跳过传统 `dns` 后端的语义**；有的加固镜像为"防泄漏"删掉 `dns`，结果所有域名解析失败。改这一行要极其小心，改完用 `getent hosts example.com` 和业务程序双验证，不要只信一次 `ping`——ping 有时会走不同的地址族或缓存路径。

```bash
$ cat /etc/hosts
127.0.0.1 localhost
127.0.1.1 cui
::1     ip6-localhost ip6-loopback
```

### 5.2 systemd-resolved 与 stub 127.0.0.53

现代 Ubuntu、Fedora、Arch 默认启用 systemd-resolved。它在本机 `127.0.0.53:53` 起一个 stub 解析器，聚合各网卡下发的 DNS、做缓存，再向上游转发。`/etc/resolv.conf` 往往是指向 `../run/systemd/resolve/stub-resolv.conf` 的**符号链接**，文件里 `nameserver 127.0.0.53` 与 `options edns0 trust-ad` 属正常内容，不是"DNS 只会问本机自己"的字面意思。

三个高频误区：

1. **手工编辑 `resolv.conf` 写 `nameserver 8.8.8.8` 后重启被还原**——因为文件是 stub 链接，或被 resolved 重新生成。正确做法是改网络管理器的 DNS（Netplan `nameservers`、`nmcli ... ipv4.dns`、NetworkManager keyfile），让 resolved 自动感知。
2. **看到 `127.0.0.53:53` 在监听就以为有应用抢端口**——那是 resolved 自己的 stub（`ss -ulnp | grep :53` 可见），与 dnsmasq/unbound 的 53 不同；后者若要接管，需先处理与 resolved 的端口关系。
3. **容器/精简系统没有 resolved**，此时才直接由 dhclient/dhcd 写静态 `resolv.conf`。判断方法：`systemctl is-active systemd-resolved`。

为什么会有 stub 这一层？多网卡、多 VPN、容器 veth 各自会下发不同 DNS；没有统一聚合器时，`resolv.conf` 只能写死一组，切换网络就失效。resolved 把"选哪组上游、缓存多久、mDNS/LLMNR 要不要答"收拢到一个守护进程，应用只看到稳定的 `127.0.0.53`。代价是排障多了一跳：**看到的 `nameserver` 是 stub，不是真实上游**，永远再执行 `resolvectl dns` 或 `resolvectl status` 才能拿到真相。

自建 dnsmasq/unbound 与 resolved 共存时，常见正确姿势是：resolved 保持 stub，把上游指到 `127.0.0.1` 的自定义端口（如 5353），或反过来让自建服务监听 53 并把 resolved 的 DNS 转发指过去。**不要让两个进程抢同一个 53**，先到先得，另一个绑定失败后日志里才会慢慢报错，现场表现为"解析时灵时不灵"。

真实查询输出（`Data from: network` 表示现场向上游查，`cache` 表示命中本地缓存）：

```bash
$ resolvectl query example.com
example.com: 198.18.0.47                                    -- link: ens18

-- Information acquired via protocol DNS in 2.9ms.
-- Data is authenticated: no; Data was acquired via local or encrypted transport: no
-- Data from: cache network

$ resolvectl dns
Global:
Link 2 (ens18): 192.168.5.1 223.5.5.5 192.168.5.11 fe80::5
Link 3 (ztksetoehl):
```

真实查询输出可以抓住三个字段讲透：`Data from: cache network` 说明既有缓存又有现场网络查询（顺序上缓存命中则很快）；`-- link: ens18` 表示这条应答绑定在哪个接口的 DNS 下发上，多网卡时能直接看出"问错口"；`Information acquired via protocol DNS in 2.9ms` 是协议层耗时，突然涨到几百毫秒通常是上游 RTT 变差或超时重试。`resolvectl status` 还能看到每个 link 的 DNS scope 与是否为默认路由来源；`resolvectl flush-caches` 在"改了上游 DNS 但一直返回旧结果"时清缓存。应用层 `getent` 与 `python socket` 走的是同一条路径，结果应对得上。

若 `dig example.com`（直接问 stub/上游）能通而 `python`/`getent` 不通，问题在 `nsswitch`/`hosts` 或 glibc 插件；若两者都失败，再查 `resolvectl status` 与上游连通性（`ping` 上游 IP）。命令级的 DNS 诊断技巧（`dig +trace`、指定 `@服务器`、MX/NS 记录）见[网络工具](./network-tools.md)。

把整条链路串起来，日常排障可以按这个固定顺序走，几乎不会漏层：先 `ip -br addr` 确认有地址、`ip route` 确认有默认网关；再 `ping -c 3 网关`、`ping -c 3 公网 IP`，区分"出不去"和"解析不了"；若是域名问题，`grep hosts /etc/nsswitch.conf` + `resolvectl query` + `dig @上游` 三步定位在哪一环；应用层面 `ss -tlnp` 看监听、`curl -w` 看分段耗时。每一步都只回答一个问题，答不上来就停在当前层深挖，不要跳到下一条命令碰运气。

## 6. 常见坑

常见坑按"改配置前、改配置中、改完验证"三个时段记，比按命令背更不容易漏。

**改配置前**：先确认发行版与管理器（第 4 节），先开带外/控制台或第二条 SSH，先 `netplan try` 而不是直接 `apply`，先记录 `ip -br addr` 与 `ip route` 的基线以便回滚对照。没有基线的"优化"等于在没有备份的情况下删库。

**改配置中**：一次只动一个接口或一项（地址、路由、DNS 分三次改），每改一次立刻从新连接验证；不要在同一窗口里把网卡 down 掉再改同网卡的 YAML——你会在配置生效前失去唯一会话。临时命令（`ip addr add`）只用于验证目的，验证通过马上翻译成持久化配置，否则你是在给未来的自己埋雷。

**改完验证**：重启网络服务或整机一次，确认地址、默认路由、DNS 三条都还在；再跑业务冒烟（SSH、HTTP、内部依赖）。很多"低级事故"不是命令敲错，而是**只验证了敲命令的那一刻，没验证重启之后**。

按现象反查的速查顺序：SSH 断了但物理链路还在 → 控制台进，`ip -br addr` 是否还有地址，没有则检查持久化是否写错、DHCP 是否续租失败；能 ping 网关但上不了公网 → `ip route get 1.1.1.1` 看是否走错口、默认路由 metric 是否被抢占；能 IP 访问但域名不行 → 进第 5 节 DNS 链路；应用端口外部连不上 → `ss -tlnp` 监听地址、再转防火墙页。把这四条写进值班手册首页，能覆盖日常一半以上的网络工单。

1. **在新系统上找不到 `ifconfig`/`netstat`**。它们不是"Linux 必备命令"，是 net-tools 包。要么 `sudo apt install net-tools`（Debian/Ubuntu）、`sudo pacman -S net-tools`（Arch）、`sudo dnf install net-tools`（RHEL），要么直接改用 `ip`/`ss`——本页第 1 节的对照表足够替换日常用法。

2. **远程机器上 `ip link set eth0 down` 把自己踢下线**。链路 down 会立刻失效 SSH。务必改持久化配置并用 `netplan try`/先开新连接验证，或走控制台。`ifdown` 同样危险。

3. **改了 `/etc/resolv.conf` 重启无效**。先 `ls -l /etc/resolv.conf` 看是不是 symlink 到 resolved；是的话改网络管理器或用 `resolvectl`，不要覆盖链接。

4. **`ss -tlnp` 看不到进程名**。需要权限：`sudo ss -tlnp`，或确认目标进程与当前用户相同。三系行为一致。

5. **多网卡时默认路由走错口**。`ip route show` 看 `metric`，`ip route get 目标` 看最终决策；临时修正可 `ip route change default via 网关 dev 网卡`，长期修正改 Netplan/NM/networkd 的 `metric`/`route` 字段。

6. **接口名不再是 eth0**。现代发行版用 predictable naming（`ens18`、`enp3s0`）。用 `ip -br link` 确认，不要照抄教程里的 `eth0`；容器/云镜像里常见 `eth0`，KVM/物理机多半不是。

7. **把 127.0.0.53 当故障**。它是 systemd-resolved 的本地 stub；`127.0.0.54` 则是 mDNS/LLMNR 相关回环。二者同时监听属正常，除非你在自建权威 DNS 并需要独占 53。

8. **只改临时路由就写进运维手册**。`ip route add` 重启即失。生产变更必须落到 Netplan YAML、`.network` 或 `nmcli connection modify`，并在变更后 `reboot` 或重启网络服务验证一次。

9. **在脚本里把接口名写死为 `eth0`**。predictable naming 下物理机几乎不会叫 eth0；脚本开头应 `ip -br link` 探测，或用 `match: MAC/驱动`（Netplan/`*.network` 的 `Match` 段）而不是硬编码名字，否则换卡/换槽位后脚本静默失效。

10. **改 DNS 只改 `resolv.conf`，改路由只 `ip route add`**。两者都是"临时层"操作，和第 4 节的持久化入口脱节。统一原则：**验证用临时命令，落地用配置文件 + 守护进程**，不要反着来。

## 参考资料

- `man ip`, `man ss`, `man ip-rule`, `man resolvectl`, `man nsswitch.conf`, `man systemd-resolved`
- 鸟哥的私房菜 - 网络基础 — [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0110network_basic.php)
- Arch Wiki - iproute2 — [wiki.archlinux.org](https://wiki.archlinux.org/title/Iproute2)
- Arch Wiki - Network configuration — [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration)
- Arch Wiki - systemd-resolved — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd-resolved)
- iproute2 手册（ss/ip） — [man7.org](https://man7.org/linux/man-pages/man8/ip.8.html)
- Ubuntu - Netplan 文档 — [netplan.io](https://netplan.io/)
- systemd-resolved / resolvectl 手册 — [freedesktop.org](https://www.freedesktop.org/software/systemd/man/latest/resolvectl.html)
- Red Hat 文档 - Configuring and managing networking — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_networking/index)
