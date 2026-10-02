# 常用网络命令实操演练

命令字典解决"这条命令有哪些参数"，方法论页解决"按什么顺序想"，本页解决第三件事：**跟着敲一遍，把命令、判读与结论连成肌肉记忆**。每个场景都是一个可以三分钟走完的闭环——先说目标，给出带真实感输出的命令序列，逐行判读"这行输出证明了什么"，最后指明下一步该去哪。八条链路从本机配置一路走到抓包与带宽实测，覆盖日常排障九成的动作；逐命令的参数全集不在本页展开，见[网络管理命令](../commands/network/network.md)与[网络工具](../commands/network/network-tools.md)，分层推理的方法论见[网络故障排除](./troubleshooting.md)。

> 内容参考自 man 手册与鸟哥的私房菜（概念框架），见文末参考资料。

## 本页怎么用

每个场景都按"目标 → 命令 → 判读 → 下一步"组织，建议真的开一台虚拟机跟着敲：输出里的 IP、主机名换成你自己的，结构不变。判读一栏是本页的核心——**命令谁都会敲，值钱的是从输出里读出结论**；每段输出后的"下一步"告诉你正常时收工、异常时转向哪条支线（或哪一页）。

场景之间是递进关系：场景 1-3 走的是"本机 → 网关 → 远端"的连通性链，对应故障排除页的前半段；场景 4-6 从端口、DNS 到抓包，是"通了但服务不可用"的深挖；场景 7-8 处理"通但慢"与"通但路径不对"两类进阶问题。总览如下：

| 场景 | 回答的问题 | 核心命令 |
|------|-----------|----------|
| 1. 本机配置 | 这台机器网络配置对不对 | `ip -br addr`、`ip route`、`cat /etc/resolv.conf` |
| 2. 网关可达 | 我能到网关吗 | `ping`、`ip neigh` |
| 3. 远端可达 | 网关之外呢，哪一段丢包 | `ping`、`traceroute`、`mtr` |
| 4. DNS 解析 | IP 通但域名不通 | `dig`、`resolvectl` |
| 5. 端口存活 | 这个端口活着吗 | `ss`、`nc`、`curl -v` |
| 6. 抓包取证 | 线上到底发生了什么 | `tcpdump` |
| 7. 时延带宽 | 通但慢，数字怎么读 | `ping -c`、`iperf3` |
| 8. 实际选路 | 我的流量走哪条路 | `ip route get`、`ip rule` |

工具先行一次装齐，免得排障中途停下来补包。三系包名对照（`ip`/`ss` 同属 iproute2，`ping` 属 iputils，多数发行版默认已装）：

| 工具 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| ip/ss | `iproute2` | `iproute2` | `iproute2` |
| ping/arping | `iputils-ping` | `iputils`（含 arping 则装 `iputils-arping`） | `iputils` |
| traceroute | `traceroute` | `traceroute` | `traceroute` |
| mtr | `mtr-tiny`（或 `mtr`） | `mtr` | `mtr` |
| dig | `dnsutils` | `bind`（自带） | `bind-utils` |
| resolvectl | `systemd`（自带） | `systemd`（自带） | `systemd-resolved`（自带） |
| nc | `netcat-openbsd` | `openbsd-netcat` | `nmap-ncat` |
| tcpdump | `tcpdump` | `tcpdump` | `tcpdump` |
| iperf3 | `iperf3` | `iperf3` | `iperf3` |

## 1. 这台机器网络配置对不对

**目标**：三十秒内确认本机地址、路由、DNS 三个基本事实。三板斧先行，怀疑物理层时再补一刀看收发计数器：

```bash
$ ip -br addr
lo               UNKNOWN        127.0.0.1/8 ::1/128
eth0             UP             192.168.56.101/24 fe80::215:5dff:fe00:1001/64
$ ip route
default via 192.168.56.1 dev eth0 proto static metric 100
192.168.56.0/24 dev eth0 proto kernel scope link src 192.168.56.101 metric 100
$ cat /etc/resolv.conf
# 由 systemd-resolved 生成，请勿手工编辑
nameserver 127.0.0.53
options edns0 trust-ad
search example.lan
$ ip -s link show eth0
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT
    link/ether 08:00:27:c0:1a:2d brd ff:ff:ff:ff:ff:ff
    RX:  bytes    packets errors dropped overrun mcast
    RX:  1.2GiB     920k     0       3       0     12k
    TX:  bytes    packets errors dropped carrier collsns
    TX:  340MiB     610k     0       0       0       0
```

**判读**：`ip -br addr` 看三件事——状态列必须是 `UP`（`UNKNOWN` 常见于无载波或虚拟接口，不代表配好）、地址必须带**前缀长度**（写成 `/24` 才是网络号，缺了它 `ip` 会拒绝）、多网卡时哪些接口有地址。`ip route` 里必须有一行 `default via`，`via` 后面就是网关 IP，`dev` 是出接口，两者要在同一块"活的"网卡上。`resolv.conf` 若指向 `127.0.0.53`，说明本机有 systemd-resolved 兜底，真正的上游要进 `resolvectl status` 看（见场景 4）；若是被 NetworkManager 或手工写死的老式 `nameserver 8.8.8.8`，则解析行为完全由这行决定。`ip -s link` 的两列计数器是物理层的体检单：`errors` 非零多为线缆/光模块/驱动问题，`dropped` 增长常见于小环缓冲被打满（虚拟机与高 PPS 场景）——数字只增不减，与开机时间对照出增速才有意义。

**下一步**：三行全对，直接跳场景 2；没有默认路由，去[网络配置基础](./network-configuration.md)查持久化配置（NetworkManager/Netplan/networkd 三选一）；接口 `DOWN` 先 `ip link set eth0 up`，再回头看物理层。

## 2. 我能到网关吗

**目标**：确认二层（同一广播域）正常——网关不通时，后面所有"外网不通"的结论都不成立。

```bash
$ ping -c 3 192.168.56.1
PING 192.168.56.1 (192.168.56.1) 56(84) bytes of data.
64 bytes from 192.168.56.1: icmp_seq=1 ttl=64 time=0.412 ms
64 bytes from 192.168.56.1: icmp_seq=2 ttl=64 time=0.389 ms
64 bytes from 192.168.56.1: icmp_seq=3 ttl=64 time=0.401 ms

--- 192.168.56.1 ping statistics ---
3 packets transmitted, 3 received, 0% packet loss, time 2003ms
rtt min/avg/max/mdev = 0.389/0.401/0.412/0.010 ms
$ ip neigh show
192.168.56.1 dev eth0 lladdr 08:00:27:c0:1a:2d REACHABLE
```

**判读**：同网段网关的 `ttl=64` 与亚毫秒时延说明二层直达；`ip neigh` 出现网关 MAC 且状态 `REACHABLE`，证明 ARP 已完成——**ping 通的隐藏前提是邻居表里有这一条**。邻居表的状态列本身就是一台小型状态机：`INCOMPLETE` 是 ARP 请求刚发出还没人应，`REACHABLE` 是近期确认可达，`STALE` 是过了确认期但条目还在（下次用前会先验证），`FAILED` 是问了若干轮全部无人应答。排障时按语义对号入座——`FAILED` 或长期 `INCOMPLETE` 指向 IP 写错、网关接口没开、同网段但被 VLAN 隔开这类二层问题；`STALE` 则完全正常，不代表故障。多看一眼 `ttl`：`ttl=64` 直连、`ttl=63` 说明中间已过一跳——ping 的其实不是你以为的那个地址。

**下一步**：通了进场景 3；不通先 `ip route get <网关IP>` 确认它走的出接口与源地址，再核对本机 IP 是否真与网关同网段（场景 8 的命令此时就能派上用场）。

## 3. 网关之外呢

**目标**：区分"远端挂了"与"路径上某一段丢了"，用两层工具交叉验证。

```bash
$ ping -c 3 223.5.5.5
64 bytes from 223.5.5.5: icmp_seq=1 ttl=49 time=12.4 ms
...
--- 223.5.5.5 ping statistics ---
3 packets transmitted, 3 received, 0% packet loss
$ traceroute -n 223.5.5.5
traceroute to 223.5.5.5 (223.5.5.5), 30 hops max, 60 byte packets
 1  192.168.56.1     0.389 ms  0.356 ms  0.341 ms
 2  10.0.0.1         3.156 ms  3.104 ms  3.071 ms
 3  223.5.5.5       12.402 ms 12.381 ms 12.360 ms
$ mtr --report -c 20 223.5.5.5
HOST: dev01                    Loss%   Snt   Last   Avg  Best  Wrst StDev
  1.|-- 192.168.56.1            0.0%    20    0.4   0.4   0.3   0.7   0.1
  2.|-- 10.0.0.1                0.0%    20    3.2   3.3   3.0   4.1   0.3
  3.|-- 223.5.5.5               0.0%    20   12.4  12.5  12.2  13.0   0.2
```

**判读**：`ping` 的 `ttl=49` 比网关那一跳小了十几个，说明已穿过若干路由器——先用它确认"远端活着、整体通"。`traceroute` 每行一跳、每跳三列是三次探测的时延，逐跳时延**阶跃**的位置就是延迟开始产生的链路；出现 `*` 只代表该设备不回 ICMP 超时，不代表断。ICMP 整段被限时换探测协议：`traceroute -T -p 443 223.5.5.5` 改发 TCP SYN（目标端口挑一个对端真开放的），路径上对 ICMP 沉默的设备对 TCP 往往正常应答；同理 `-I` 显式用 ICMP、`-U` 用 UDP。瞬时丢包不可靠，定位丢包段用 `mtr --report -c 20`：`Loss%` 列是该跳的探测丢包率，**只有末端行的 Loss% 才代表端到端结果**——中间某跳 100% 而末行 0%，是中间设备对 ICMP 限速，链路本身没坏。

**下一步**：全程通，进场景 4；末行丢包非零，按[网络故障排除](./troubleshooting.md)的分段法定位责任段——本地段与网关段已由场景 1-2 排除，责任在运营商路径或对端；对端是自己服务器时上服务器端看 `nstat`/`ss -s` 与网卡计数器。

## 4. IP 通但域名不通

**目标**：把"上不了网"精确切分为解析问题与连通问题，隔离变量只问一次：

```bash
$ dig @223.5.5.5 www.example.com
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 41235
;; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1

;; ANSWER SECTION:
www.example.com. 86400 IN A 93.184.216.34

;; Query time: 18 msec
;; SERVER: 223.5.5.5#53(223.5.5.5)
$ dig www.example.com | grep -A1 'SERVER:'
;; SERVER: 127.0.0.53#53(127.0.0.53) (UDP)
$ getent hosts www.example.com
93.184.216.34   www.example.com
$ resolvectl status
Link 2 (eth0)
    Current Scopes: DNS
         DNS Servers: 192.168.56.1
          DNS Domain: example.lan
```

**判读**：`@223.5.5.5` 绕开本机直接问公共解析器——`ANSWER SECTION` 有 IP 且 `status: NOERROR`，说明域名与出站 53 都没问题，病灶一定在本机解析链；`SERVER:` 行确认这次应答的来源，排障时永远先核对它。第二条不带 `@` 的查询里 `SERVER` 落在 `127.0.0.53`，说明本机查询被 systemd-resolved 接管，用 `resolvectl status` 看它转发给了哪台上游、`DNS Domain` 的路由域是否把你的域名引去了内网解析器。注意 `dig` 与 `getent` 的分工：**dig 只走 DNS 协议，getent 才走 nsswitch 全链**——`/etc/hosts` 里的条目、`files` 优先于 `dns` 的次序，dig 一概看不见；应用"解析结果和 dig 不一样"时，先用 `getent hosts` 复现应用视角，再看 `/etc/hosts` 与 `/etc/nsswitch.conf`。确认是缓存层的问题后，`resolvectl flush-caches` 清掉本机缓存重测一轮即可收口。

**下一步**：上游通、本机不通 → 修 resolved 配置（`resolvectl query` 逐级复现）；上游也不通 → 是出站 UDP 53 被拦（换 `@1.1.1.1`、换 TCP 复测 `dig +tcp @223.5.5.5`），自建解析的内网问题深入 [DNS 服务器（BIND）](../server/dns/bind.md)；域名解析对但网站打不开 → 直接跳场景 5。

## 5. 这个端口活着吗

**目标**：服务端确认监听、客户端确认可达，两个视角各问一次，避免"我这边没监听却去对端找原因"。

```bash
$ ss -tlnp
State  Recv-Q Send-Q Local Address:Port   Peer Address:PortProcess
LISTEN 0      511          0.0.0.0:80        0.0.0.0:*    users:(("nginx",pid=812,fd=6))
LISTEN 0      128          0.0.0.0:22        0.0.0.0:*    users:(("sshd",pid=640,fd=3))
$ ss -uln | head -3          # UDP 监听另查：无连接概念，-t 看不到
State   Recv-Q SendQ Local Address:Port  Peer Address:Port
UNCONN  0      0     127.0.0.53%lo:53         0.0.0.0:*
$ ss -s                     # 全局概览一行
TCP:   12 (estab 4, closed 6, orphaned 0, timewait 2)
$ nc -vz web.example.com 443
Connection to web.example.com (93.184.216.34) 443 port [tcp/https] succeeded!
$ nc -vz db.internal 5432
nc: connect to db.internal (192.168.56.201) port 5432 (tcp) failed: Connection refused
$ curl -v https://web.example.com/ -o /dev/null 2>&1 | grep -E 'subject:|SSL certificate|HTTP/'
*  subject: CN=web.example.com
*  SSL certificate verify ok.
< HTTP/1.1 200 OK
```

**判读**：服务端 `ss -tlnp` 三要素——`LISTEN` 状态、地址:端口格式（`0.0.0.0` 是全网卡监听，`127.0.0.1` 只本机）、`Process` 列的进程名（需要权限才能看到）。UDP 服务要换 `-uln` 才能看到（DNS、DHCP、QUIC 都在这张表里，状态列是 `UNCONN` 而非 `LISTEN`——UDP 无连接语义）；`ss -s` 的全局行适合快速看"这台机器连接数是否异常"。客户端两种失败语义截然不同：`Connection refused` 是**对端主动回了 RST**——端口没进程监听，问题在服务本身；**卡住直到超时**则是包被中间丢弃——防火墙、ACL 或路由黑洞。`curl -v` 在握手成功后继续走到 TLS 与 HTTP 层，它同时回答"端口通、证书对、HTTP 有响应"三件事。

**下一步**：`refused` → 服务端查进程与监听地址；超时 → 查防火墙（见[防火墙](../security/firewall.md)）与安全组；`nc` 通但浏览器报错 → 证书/Host 头问题，看 `curl -v` 的证书与响应行；TCP 状态机与 RST 的来龙去脉见 [TCP/IP 要点](./tcpip-essentials.md)。

## 6. 抓一次真实会话

**目标**：当判读工具都给不出答案时，抓包是最终证据——先过滤、少量抓、存文件回放。

```bash
$ sudo tcpdump -i any -n host 93.184.216.34 and port 80 -c 20
tcpdump: listening on any, link-type LINUX_SLL2 (Linux cooked v2), capture size 262144 bytes
21:14:03.101245 eth0 In  IP 93.184.216.34.80 > 192.168.56.101.51234: Flags [S.], seq 1829301769, ack 3445189732, win 65483, length 0
21:14:03.101312 eth0 Out IP 192.168.56.101.51234 > 93.184.216.34.80: Flags [.], ack 1, win 501, length 0
21:14:03.101398 eth0 Out IP 192.168.56.101.51234 > 93.184.216.34.80: Flags [P.], seq 1:76, ack 1, length 75
$ sudo tcpdump -i any -n host 93.184.216.34 and port 80 -w capture.pcap -c 200
$ tcpdump -r capture.pcap -nn | head
$ tcpdump -r capture.pcap -nn 'tcp[tcpflags] & tcp-syn != 0'   # 回放时再过滤：只看 SYN
reading from file capture.pcap, link-type LINUX_SLL2 (Linux cooked v2)
21:14:03.101201 eth0 Out IP 192.168.56.101.51234 > 93.184.216.34.80: Flags [S], seq 3445189731, win 64240, length 0
```

**判读**：`Flags [S.]` 是 SYN-ACK、`[.]` 是纯 ACK、`[P.]` 带数据——方向列 `In`/`Out` 配合握手标志，一次正常会话的头三行就能看出"我先发起（或对方先发起）且对方应答了"。**只有 Out 的 `[S]` 没有 In 的 `[S.]`，就是 SYN 被丢**：与场景 5 的超时互相印证，责任在路径而非服务。过滤表达式 `host A and port 80` 务必先写，抓全量再筛在生产上既危险又低效；BPF 过滤器在**抓取时和回放时各生效一次**——`-w` 前用粗条件圈范围，`-r` 回放时用 `tcp[tcpflags] & tcp-syn != 0` 这类精细条件再筛，同一份 pcap 可以反复换角度审。存文件后拷回本地用 Wireshark 看（图形界面分析 HTTP 分片、重传、窗口比命令行舒服得多），命令行做快速取证、Wireshark 做深度复盘。

**下一步**：看到握手成功但 HTTP 无响应 → 上服务器看应用日志；看到重复的 `[S]` 重传 → 结合场景 7 判断链路质量；抓不到任何包 → 先确认 `-i` 选对了接口（`ip -br addr` 复查），隧道与虚拟接口的流量不走物理口。

## 7. 时延与带宽到底多少

**目标**：把"好卡"变成可对比的数字——时延归 ping，带宽归 iperf3，两者测的是不同的东西。

```bash
$ ping -c 10 223.5.5.5
--- 223.5.5.5 ping statistics ---
10 packets transmitted, 10 received, 0% packet loss
rtt min/avg/max/mdev = 11.982/12.410/13.015/0.312 ms
$ iperf3 -s                      # 服务端（对端机器上执行）
$ iperf3 -c 192.168.56.200 -P 4  # 客户端，4 条并行流
[SUM]   0.00-10.00  sec  4.98 GBytes  4.28 Gbits/sec  sender
        4.89 GBytes  4.20 Gbits/sec  receiver
$ iperf3 -c 192.168.56.200 -u -b 100M   # UDP 指定 100M 发包率
[  5]  0.00-10.00  sec   119 MBytes   100 Mbits/sec  0.047 ms  0/12800 (0%)
$ ping -c 3 -M do -s 1472 223.5.5.5   # MTU 探测：1500 头部 28 = 1472 载荷且禁分片
ping: local error: Message too long, mtu=1500        # 说明路径某段 MTU 小于 1500
```

**判读**：ping 的四元组里 `min` 是物理下限、`avg` 是常态、`mdev` 是抖动——**抖动比均值更早暴露问题**（Wi-Fi 抖、队列排队都会先体现在 mdev 上）。iperf3 默认 TCP 模式测的是"应用层能榨出多少吞吐"，受拥塞窗口与带宽时延积限制，`-P 4` 并行多流才能逼近链路上限；UDP 模式 `-u -b 100M` 则问另一个问题"以 100M 速率打过去丢不丢"，`0/12800 (0%)` 的丢包行是唯一要盯的指标。两工具结论天然不同：ping 时延低不代表带宽大（低速链路照样毫秒级回包），iperf3 跑满也不代表时延健康（拥塞队列会把延迟顶高）——各测一维，交叉看。末尾的 `-M do -s 1472` 是顺手的 MTU 探测：载荷加 28 字节头正好 1500 且禁止分片，路径 MTU 不够时本机直接报 `Message too long, mtu=...`，二分载荷大小即可定位路径 MTU——"小包通大包死"的玄学故障（VPN、隧道、PPPoE 场景高发）用它一测便知，原理见 [TCP/IP 要点](./tcpip-essentials.md)的 MTU 一节。

**下一步**：UDP 有丢包 → 降 `-b` 二分定位链路承载；TCP 单流跑不满但多流跑满 → 属正常（窗口/BDP 限制，不是故障）；时延抖动大 → 先排除本机高负载（`mpstat`）与软中断（`/proc/interrupts`），再按场景 3 用 mtr 分段；方法论回[网络故障排除](./troubleshooting.md)的性能节。

## 8. 我的流量在走哪条路

**目标**：多网卡、多出口机器上，"配了路由"不等于"走了这条路"——直接问内核它此刻的选路结论。

```bash
$ ip route get 1.1.1.1
1.1.1.1 via 192.168.56.1 dev eth0 src 192.168.56.101 uid 1000
$ ip rule show
0:      from all lookup local
32766:  from all lookup main
32767:  from all lookup default
$ ip route get 1.1.1.1 from 192.168.57.10 iif eth1
1.1.1.1 from 192.168.57.10 iif eth1 lookup 100 via 192.168.57.1 dev eth1
```

**判读**：`ip route get` 的输出同时给出三件事——出接口 `dev`、下一跳 `via`、**内核为这次通信选的源地址 `src`**。第三件最常被忽略：同机多地址时，应用看到的"我从哪发出去"由它决定，SNAT 规则、对端白名单对不上时，第一嫌疑就是这里的 `src` 不是你以为的那个。带 `from` 与 `iif` 的复测能精确复现"某一来源、从某网卡进来的包"的选路结果——第二条命令里 `lookup 100` 说明命中了策略路由表而非 `main`，这类"进包选路"行为只有显式指定 `from`/`iif` 才能探到，裸的 `ip route get` 永远只答本机发起的流。`ip rule show` 列出选路策略的优先级表：数字越小越优先，`local` 表兜住本机地址，绝大多数机器到此为止——若列表里有自定义条目，说明这台机器有策略路由，`main` 之外还有别的路由表在起作用。

**下一步**：`src` 不对 → 查该出接口的地址配置与 `ip rule` 的优先级顺序；确认非默认出口的走向 → `ip route get` 带上 `from <源IP>` 参数复现；策略路由与多表的完整玩法见[路由与 NAT](../server/routing-nat.md)。

## 一页速查

收工前把八个场景压成一张表，排障时从症状反查第一跳：

| 症状 | 第一命令 | 第二命令 |
|------|----------|----------|
| 地址/路由是否配对 | `ip -br addr` | `ip route` |
| 网关不可达 | `ping <网关>` | `ip neigh show` |
| 外网不通 | `ping <公网IP>` | `mtr --report -c 20 <公网IP>` |
| 域名不通 IP 通 | `dig @8.8.8.8 域名` | `getent hosts 域名` |
| 服务拒绝连接 | `ss -tlnp`（服务端） | `nc -vz 主机 端口` |
| 看不到包在不在 | `tcpdump -i any -n` | `-w` 存文件回放 |
| 通但慢 | `ping -c 10` | `iperf3 -c -P 4` / `-u -b` |
| 流量走向存疑 | `ip route get <目标>` | `ip rule show` |

## 常见坑

**ip addr 看到的 IP 不等于在用——多网卡源地址选择。** `ip -br addr` 只罗列配置，不承诺某条流真用它：内核按路由表与源地址规则选路后才定 `src`。多网卡机器上验证一律用 `ip route get <目标>`（场景 8），SNAT、防火墙规则、对端白名单写错源地址，根因多在这里。

**ping 通≠端口通——ICMP 与 TCP 是两条路。** ICMP 是网络层协议，TCP 是传输层端口服务，前者通只证明路由可达，不证明对端进程存在，更不证明防火墙放行了 TCP。验服务永远走场景 5 的 `ss`/`nc`/`curl` 三件套。

**traceroute 最后一跳 "*" 不代表不通——中间设备限速 ICMP。** 中间路由器限速或不回超时报文时该跳显示 `*`，甚至中间全 `*` 而末跳正常也是常态。判通断只看目的回显（ping 或 traceroute 末跳），判丢包段用 `mtr --report` 看末行 `Loss%`。

**nc -z 只测握手不测数据层。** `-z` 建立连接后立即关闭，能过不代表应用能用：TLS 证书错、HTTP Host 错、认证失败都会在 `-z` 之后才暴露。所以 `nc` 通了之后还要 `curl -v` 走完整条应用链。

**iperf3 单线程跑不满——-P 多流与默认窗口。** TCP 单流受拥塞窗口与带宽时延积限制，高带宽长延迟链路上单流只能跑出一部分容量。下结论前先 `-P 4` 多流复测，仍跑不满才怀疑链路或对端性能；UDP 模式别忘了 `-b` 显式指定速率，否则默认小速率测不出上限。

**dig 查的是 DNS 不是 CDN 缓存——看到的 IP 因地点而异。** 权威 DNS 返回的结果与 CDN 调度相关，你在内网 dig 到的 A 记录和公网用户拿到的不同属正常；判定"解析是否正确"要用 `@权威` 直查（见 [DNS 服务器（BIND）](../server/dns/bind.md)），并核对 `dig` 输出 `SERVER:` 行确认问的是谁。

**ping 127.0.0.1 通不代表网卡通——lo 不走物理层。** 回环接口在内核里直接折返，网卡 down、网线拔了它照样通。判断物理链路必须 `ping` 对端真实地址并回看场景 1 的接口状态与计数器；"本机服务自己能访问、别的机器访问不了"的排查也应从"换个地址再 ping"开始，别被回环的成功骗过。

**resolv.conf 手工改完被覆盖。** NetworkManager、systemd-resolved、netplan 都可能在重启或重连后回写 `/etc/resolv.conf`，手工编辑的成就感撑不过一次 `systemctl restart`。正确的持久化入口分别是连接配置（`nmcli`/netplan YAML）与 `systemd-resolved` 配置，改完用场景 4 的链路再验一遍——文件头部的"请勿手工编辑"注释不是装饰。

## 动手验证

学过的命令只有"见过失败长什么样"才算掌握——在自己搭的实验环境里故意制造一次故障再修好它：

1. **配错网关**：把虚拟机的默认路由改成一个不存在的 IP（`ip route replace default via 192.168.56.254`），按场景 1-3 走一遍，确认邻居表 `INCOMPLETE`、外网不通但网关所在网段仍通的现象，再改回来。
2. **停掉服务**：`systemctl stop nginx` 后从另一台机器 `nc -vz` 对比 `Connection refused` 与防火墙 DROP 时的超时——两种失败在 tcpdump 里分别是"回了 RST"与"石沉大海"。
3. **制造 MTU 黑洞**：两台虚拟机之间加一层 VXLAN 或把接口 MTU 调到 1400，用场景 7 的 `-M do -s` 二分出路径 MTU，再验证 SSH 能登录但 `scp` 大文件卡死的现象与它的关系。

## 参考资料

- man 手册：[ip(8)](https://man7.org/linux/man-pages/man8/ip.8.html)、[ss(8)](https://man7.org/linux/man-pages/man8/ss.8.html)
- man 手册：[ping(1)](https://man7.org/linux/man-pages/man1/ping.1.html)、[mtr(8)](https://man7.org/linux/man-pages/man8/mtr.8.html)
- iperf3 官方 — [iperf.fr](https://iperf.fr/)
- tcpdump 官方 — [tcpdump.org](https://www.tcpdump.org/)
- 鸟哥的私房菜 — 网络侦错 [linux.vbird.org](https://linux.vbird.org/)
