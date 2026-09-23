# 网络故障排除

"网络不通"是运维生涯里最含糊的一句话——
它可能意味着网线松了、IP 配错了、
网关挂了、DNS 污染了、对端服务崩了，
也可能只是防火墙多写了一行规则。
面对模糊的描述，
唯一高效的办法是
**把它拆成有顺序的若干个是/否问题**，
从最确定的本地事实开始，
逐跳向外推进：
本机 → 网关 → DNS → 远端。
每一步只验证一个假设，
用命令输出当证据，而不是凭感觉。

> 内容参考自 tcpdump、traceroute、ss 手册
> 与实际排障经验，见文末参考资料。

## 学习目标

- 掌握"本机→网关→DNS→远端"四段推理链，
  任何故障都能找到切入点
- 学会读懂 `traceroute`、`tcpdump`、`ss`
  的真实输出并据此下结论
- 分清"配置错"、"被拦截"、"路径坏"
  三类问题的取证方式
- 建立可复用的诊断脚本与记录习惯

## 1. 方法论：为什么是这个顺序

排障的本质是**缩小未知区间**。
一次成功的通信需要同时满足四段路径：
本机协议栈、到网关的链路、
名字解析、端到端可达。
它们串行依赖——
任一段失败，后续都不会发生。
因此按依赖顺序检查，
能保证每一步的输入
都是上一步已验证的前提。

1. **本机**：接口、地址、路由、监听是否正确。
   这一段完全可控，证据最容易获取。
2. **网关**：内网出口是否可达。
   它把问题一分为二：
   不通则是内网/本机问题，
   通则是更外层问题。
3. **DNS**：名字能否变成 IP。
   必须放在 ping IP 之后，
   否则无法区分"网络断"与"解析断"。
4. **远端**：目标主机与目标端口是否响应。
   用 IP 和域名各测一次，
   用抓包确认包是否真的出门、是否回来。

这个顺序还有一个心理学优势：
大多数故障发生在前两段
（配置与本地链路占比最高），
先查它们命中率高、反馈快。
跳过前面直接抓包或重启服务，
是新手最常见的浪费时间方式——
你可能抓了一堆包，
却发现本机地址压根没配上。

判断标准要提前统一，
避免每步都重新解读：

- **ping 成功**：
  网际层双向可达
  （ICMP 请求与应答都通）。
- **ping 目标 IP 成功、ping 域名失败**：
  问题在 DNS，不在网络。
- **traceroute 中途出现 `* * *`**：
  该跳不回 ICMP 超时或被过滤，
  可能是防火墙，
  也可能只是目标对 ICMP 不响应——
  需结合其他证据。
- **tcpdump 看得到入站 SYN、
  无出站响应**：
  责任在本机或本机策略；
  看不到入站 SYN，责任在上游路径。

把这四条写在值班手册首页，
排障时不必每次重新发明判断标准。
推理链的价值不在于命令多新鲜，
而在于**顺序稳定**——
越是深夜越要依赖固定流程，
而不是临场灵感。

## 2. 第一段：本机

### 2.1 接口与地址

从最不可争议的事实开始——
接口是否 UP、有没有拿到地址：

```bash
$ ip -br addr
lo   UNKNOWN 127.0.0.1/8 ::1/128
eth0 UP      192.168.1.100/24 fe80::216:3eff:fe12:3456/64
```

三种常见异常各有明确指向：
接口 `state DOWN`
是管理状态没开
（`ip link set eth0 up`
或配置文件 `ONBOOT`/`dhcp4` 问题）；
接口 UP 却没有 IPv4 地址，
多为 DHCP 失败或静态配置未应用；
`ip -s link show eth0` 的 `errs`/`drop`
持续增长则指向链路层质量，
此时上层一切正常也会丢包——
先修链路（双工、环路、驱动），
再谈上层配置。

回环自检只需一条，
确认协议栈本身没崩：

```bash
$ ping -c 2 127.0.0.1
PING 127.0.0.1 (127.0.0.1) 56(84) bytes of data.
64 bytes from 127.0.0.1: icmp_seq=1 ttl=64 time=0.031 ms
64 bytes from 127.0.0.1: icmp_seq=2 ttl=64 time=0.045 ms
```

注意回环的边界：
它通了只说明本机 TCP/IP 栈没崩，
不说明任何对外连通性——
有人拿 `ping 127.0.0.1` 通过
宣布"网络正常"，
下一秒就撞上 DNS 故障。
回环是推理链的第 0 步，
不是终点。

### 2.2 路由

地址正确不代表能出去，
还要看路由表把包指向哪里：

```bash
$ ip route show
default via 192.168.1.1 dev eth0 proto dhcp src 192.168.1.100 metric 100
192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.100 metric 100
```

缺少 `default via ...` 是高发问题，
症状是"同网段能通、外网全不通"，
常见于 DHCP 续租失败
或手工配置漏了网关。
`ip route get 1.1.1.1`
直接给出这台机器实际选用的出口，
比通读整张表更快。
若这一步已经错误，
后续 ping 公网必失败，
不必再往下查——
**推理链允许提前终止**，
这是它节省时间的关键。

多网卡机器还要留意
**策略路由**：
`ip rule show`
若存在
`from <本机IP> lookup <表>`，
说明去往特定目标
根本不走主表，
只看 `ip route show` 会得出错误结论。
云主机、多线机房
常用这套机制做分流，
排障时先 `ip rule`
再查对应表，
顺序不能颠倒。

### 2.3 监听与本地端口

"我访问自己的服务都不通"时，
先确认服务真的在监听，
并且绑在预期地址上：

```bash
$ ss -tlnp | grep :80
LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=812,fd=6))
```

绑定在 `127.0.0.1:80` 的服务，
从外部访问必然失败，
而且防火墙完全无关——
这类"假防火墙问题"占比很高。
`ss` 的 `-p`
需要 root 权限才能看到进程名，
普通用户看不到不代表没有进程。

回环绑定的典型来源是配置里写了
`listen 127.0.0.1:80`
或框架默认值。
确认方法就是上面这条 `ss`：
`Local Address:Port`
显示 `0.0.0.0:80`
或 `*:80` 才对所有接口开放，
显示 `127.0.0.1:80`
则只有本机能连。
改完记得 reload 服务，
`ss` 输出没变说明配置根本没被加载。

## 3. 第二段：网关

### 3.1 为什么网关是分水岭

网关同时站在内网与外网两侧，
它是本机可控范围的边界。
ping 网关把故障域干净地切成两半：

```bash
$ ping -c 3 192.168.1.1
PING 192.168.1.1 (192.168.1.1) 56(84) bytes of data.
64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=1.24 ms
64 bytes from 192.168.1.1: icmp_seq=2 ttl=64 time=1.18 ms
64 bytes from 192.168.1.1: icmp_seq=3 ttl=64 time=1.31 ms
```

- **通**：本机到出口的链路、地址、ARP 都正常，
  问题在网关之后
  （上游运营商、对端、DNS 或防火墙转发）。
- **不通**：问题锁定在本机到网关之间——
  ARP 解析失败、VLAN 配错、
  网关 IP 配错、物理链路故障、
  本机防火墙拦了 ICMP。

不通时立即查邻居表，
区分"链路层找不到人"
与"网络层有人但不应答"：

```bash
$ ip neigh
192.168.1.1 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE
192.168.1.50 dev eth0 FAILED
```

`FAILED` 说明 ARP 请求
没有得到回应：
网关可能宕机、VLAN 不匹配、
或同网段存在 IP 冲突
（冲突方回应了错误 MAC 后被内核标记）。
`STALE`/`DELAY`/`PROBE`
是正常状态机迁移，不必惊慌；
持续 `FAILED` 才是故障信号。

同一网段若有两台机器配了相同 IP，
症状往往诡异：
时通时断、或始终通向错误的机器。
`ip neigh` 里看到
同一个 IP 对应两个不同 MAC
（先 `ip neigh flush all` 再观察）
即可实锤地址冲突。
这类问题用 traceroute 根本看不出来，
邻居表三秒钟就能定位。

### 3.2 出口 IP 通不通

网关通了之后，
用公网 IP 测试网际层，
跳过 DNS 干扰：

```bash
$ ping -c 3 1.1.1.1
PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data.
64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=12.4 ms
```

`ttl=57`
（初始通常 64 或 128，逐跳递减）
说明中间经过了若干跳路由，
数据包确实出了内网。
若 ping 网关通、ping 公网 IP 不通，
候选原因包括：
出口 NAT 配置、运营商故障、
本机/网关的出向防火墙、
或目标 IP 被上游阻断。
此时用 `traceroute`
看断在哪一跳（见第 5 节）。

选公网目标也有讲究：
优先用 `1.1.1.1`、`8.8.8.8`
这类**保证回 ICMP 的任播地址**，
而不是随便一台服务器——
很多主机禁 ping，
会造成"网络不通"的假象。
通了两个任播地址
就足以证明出口路由正常，
剩下的问题在 DNS 或应用层。

## 4. 第三段：DNS

### 4.1 先分清是断网还是断解析

很多人在
`ping example.com` 失败时
就宣布"网络挂了"，
但这个命令同时依赖网络与 DNS。
拆开测：
`ping -c 2 1.1.1.1` 通（网络层正常），
`ping -c 2 example.com` 却报
`ping: example.com: Name or service not known`。

只要 IP 通、域名失败，
就可以确定问题在解析链路，
与链路、路由无关。
解析链路的完整路径
（`nsswitch.conf` → `hosts:` 顺序 →
`resolv.conf`/systemd-resolved）
在[网络配置基础](./network-configuration.md)
有专门章节，
这里只给出取证动作。

### 4.2 逐层取证

```bash
# 1. 配置文件有没有 nameserver
$ cat /etc/resolv.conf
nameserver 192.168.1.1

# 2. 解析顺序是否把 files 排在 dns 前
$ grep '^hosts' /etc/nsswitch.conf
hosts:          files dns myhostname

# 3. 直接问一个已知可用的上游，绕开本机配置
$ dig +short example.com @1.1.1.1
93.184.216.34

# 4. 走本机默认配置对比
$ dig +short example.com
# 若第 3 步有结果、这一步没有，
# 问题锁定在本机 DNS 配置
```

`dig @服务器` 是最重要的分界工具：
它直接把查询发给你指定的上游，
绕过 `resolv.conf`。
第 3 步成功而默认查询失败，
说明网络与上游都好，
坏的只是本机配置
（`resolv.conf` 被覆盖、
resolved 没跑、nameserver 写错）。
反之若第 3 步也失败，
才是出口被拦或上游故障。

启用 systemd-resolved 的系统
还应查它的状态与缓存——
`resolvectl status` 看归属与上游，
`resolvectl query example.com` 单独验证一条解析，
`resolvectl flush-caches` 清缓存。
缓存污染的典型表现是
"刚才还行、突然不行"，
`flush-caches` 后立即恢复即可确认。
若 `resolvectl` 报
`Unit systemd-resolved.service not found`，
说明系统没启用 resolved，
`resolv.conf` 应是真实文件，
直接修改即可。
`search` 域也要顺手核对——
错误的搜索域会把短名
拼到无关后缀上，
表现为
"某些短名解析到奇怪的地址"。

## 5. 第四段：远端

### 5.1 traceroute：断点定位

当网关与 DNS 都正常，
就要看路径上具体哪一跳出问题。
`traceroute`
通过递增 TTL
触发沿途路由器返回 ICMP 超时，
从而逐跳绘制路径：

```bash
$ traceroute -n -m 15 93.184.216.34
traceroute to 93.184.216.34 (93.184.216.34), 15 hops max, 60 byte packets
 1  192.168.1.1    1.182 ms  1.104 ms  1.098 ms
 2  100.64.0.1     4.215 ms  4.180 ms  4.142 ms
 3  72.14.204.33   8.542 ms  8.498 ms  8.455 ms
 4  * * *
 5  93.184.216.34 12.481 ms 12.402 ms 12.377 ms
```

解读要点：
第 1 跳必须是你的网关，
不是的话说明默认路由指错了地方；
`* * *` 表示该跳
在超时前没回 ICMP——
中间设备过滤 ICMP、
或对探测包无响应都很常见，
**单独一跳 `*` 不代表故障**；
若从某一跳开始后续全部 `* * *`
且最终无响应，
才提示该方向可能被阻断。
跨运营商路径上第 4、5 跳丢星是常态，
不必深究。

想要区分
"UDP 探测被拦"与"ICMP 被拦"，
换协议或端口再试：
`traceroute -T -p 443`
用 TCP SYN 探测 443，
能穿透只放行 TCP 的设备；
`traceroute -I`
则改用 ICMP echo 探测。

`-T` 的价值在于：
如果 TCP 443 能通
而 UDP/ICMP 到不了，
说明中间存在协议级过滤，
而不是路由黑洞——
这直接把嫌疑引向防火墙
而非链路。
排查"只有网页能开、其他都不行"时，
这一招能把问题瞬间分层。

traceroute 还有一个常见误读：
**耗时最高的那一跳不一定是罪魁**。
中间路由器对 ICMP 的响应优先级
通常很低，
高延迟往往只是它"懒得理你"。
只有当该跳**之后**的全部跳
都同步变慢时，
才应怀疑它转发性能有问题。
看趋势，不看单点。

### 5.2 tcpdump：把猜测变成证据

`tcpdump` 是排障的终审法官。
前面所有命令都是
"我方视角的推断"，
抓包能看到**线上真实发生了什么**。
三发行版安装：
Debian/Ubuntu `apt install tcpdump`，
Arch `pacman -S tcpdump`，
RHEL/CentOS/Rocky `dnf install tcpdump`。

诊断"TCP 连接建立不了"的经典抓包：

```bash
$ sudo tcpdump -ni eth0 port 80 -c 10
tcpdump: verbose output suppressed, use -v or -vv for full protocol decode
listening on eth0, link-type EN10MB (Ethernet), capture size 262144 bytes
14:22:01.183421 IP 192.168.1.50.51234 > 192.168.1.100.80: Flags [S], seq 1829345678, win 64240, options [mss 1460,sackOK], length 0
14:22:02.184561 IP 192.168.1.50.51234 > 192.168.1.100.80: Flags [S], seq 1829345678, win 64240, options [mss 1460], length 0
14:22:03.185702 IP 192.168.1.50.51234 > 192.168.1.100.80: Flags [S], seq 1829345678, win 64240, options [mss 1460], length 0
```

三个相同 `seq` 的 `[S]`
是客户端的三次重传，
说明 SYN 到了本机、
但没有任何 `Flags [S.]`（SYN-ACK）返回。
结合 `ss -tlnp`
若端口在 `LISTEN`，
几乎可以断定是
**本机防火墙在 INPUT 方向丢弃了 SYN
或 OUTPUT 方向丢弃了响应**——
这正是[防火墙](./firewall.md)
一节所描述的取证流程。

另一个方向：
如果 `sudo tcpdump -ni eth0 port 80`
长时间无输出，
而客户端坚持认为"连不上"，
说明包根本没到这台机器，
问题在客户端到本机之间的路径
（客户端路由、上游设备、
或客户端访问的是错误 IP）。
此时在本机抓包抓再多也没用，
应到路径上游或客户端侧取证——
**抓包无输出本身也是重要证据**。

常用过滤表达式
（tcpdump 使用 BPF 语法）：
`'host 192.168.1.50 and port 443'`
限定主机与端口，
`'tcp[tcpflags] & (tcp-syn|tcp-fin) != 0'`
只看握手与挥手包
（判断连接建立质量的最快路径），
加 `-w /tmp/cap.pcap`
则保存文件供 Wireshark 分析。
**永远加 `-n`**——
默认反查 DNS 在解析故障时
既拖慢输出又引入误导。

### 5.3 端口级验证

端口通不通用 `ss` 观察本机视角，
用 `nc`/`curl` 从客户端视角验证：

```bash
# 服务端：确认监听
$ ss -tlnp | grep :443
LISTEN 0 511 *:443 *:* users:(("nginx",pid=812,fd=8))

# 客户端：三次握手是否成功
$ nc -zv 192.168.1.100 443
Connection to 192.168.1.100 443 port [tcp/https] succeeded!

$ curl -svI https://example.com 2>&1 | grep -E 'Connected|HTTP/'
* Connected to example.com (93.184.216.34) port 443 (#0)
< HTTP/2 200
```

`nc` 成功而 `curl` 失败，
说明传输层没问题、
故障在应用层
（TLS、HTTP、SNI、证书链）；
`nc` 就失败，
则回到网络层继续查。
这个二分比盲目重启 Web 服务有效得多——
**分层取证的终点，
永远是"哪一层先失败"**。

## 6. 实战案例

### 6.1 完整推理链示例

一次真实排障的日志式记录，
可作为模板：

现象：用户报告 `https://app.example.com` 打不开，
但办公网其他人正常。

1. 本机检查（用户机器）：
   `ip -br addr` → 地址正常 `192.168.1.50/24`；
   `ip route get 1.1.1.1` → `via 192.168.1.1`，路由正常；
   `ping -c 2 127.0.0.1` → 通，协议栈正常。
2. 网关：
   `ping -c 2 192.168.1.1` → 通；
   `ping -c 2 1.1.1.1` → 通，出口 OK。
3. DNS：
   `ping -c 2 app.example.com` → Name or service not known；
   `dig +short app.example.com @1.1.1.1` → 有结果；
   `cat /etc/resolv.conf` → nameserver 指向已下线的旧服务器。
   结论：网络正常，DNS 配置指向失效服务器。
   处理：改为 1.1.1.1 / 8.8.8.8，`flush-caches` 后恢复。

整个过程没有重启任何服务、
没有改防火墙，四步之内定位。
这就是推理链的价值：
**每一步都在排除一类可能，
而不是同时怀疑所有层**。
把这份记录贴进工单，
下一个值班的人
可以直接从第 3 步接手，
不必重走前两步。

### 6.2 无线网络排障

无线多一层射频与关联状态，
工具与有线不同
（`iw` 替代已过时的 `iwconfig`，
后者属 `wireless-tools` 包）：

```bash
$ iw dev wlan0 link
Connected to aa:bb:cc:dd:ee:ff (on wlan0)
        SSID: Office-WiFi
        freq: 5180
        signal: -52 dBm
        tx bitrate: 433.3 MBit/s

$ iw dev wlan0 station dump | grep -E 'signal|connected time'
        signal:  -52 [-53, -56, -59] dBm
        connected time: 3604 seconds
```

信号低于 -75 dBm
通常开始不稳，
漫游与重传会明显增加延迟；
`signal` 波动大、
`tx bitrate` 频繁降速，
先排除信道拥塞与
微波炉/蓝牙干扰，
再查驱动与省电设置。
关联正常但拿不到 IP，
回到第 2、3 节查 DHCP 与 DNS——
无线特有问题往往只存在于关联阶段，
一旦连上，
后续推理与有线完全一致。

### 6.3 VPN 故障

VPN 是叠加在物理网络之上的逻辑隧道，
排障顺序仍是同一套推理链，
只是多了一层
"隧道接口是否建立"：

```bash
$ sudo wg show
interface: wg0
  public key: 3L4x...=
  listening port: 51820

peer: 9Zc1...
  endpoint: 203.0.113.5:51820
  allowed ips: 10.0.0.2/32
  latest handshake: 42 seconds ago
  transfer: 1.24 MiB received, 2.51 MiB sent
```

`latest handshake`
停留在很久之前说明隧道已断，
优先查 UDP 51820
是否被出口防火墙拦截
（`tcpdump -ni eth0 udp port 51820`
看是否有双向流量）。
握手正常但隧道内 ping 不通，
查 `AllowedIPs`
是否覆盖目标网段、
本机 `ip route`
是否把该网段指向 `wg0`——
这是 WireGuard 最常见的配置盲点，
详见[VPN](./vpn.md)。

### 6.4 自动化巡检

把四段检查固化成脚本，
适合放进巡检或告警前的预检：

```bash
#!/bin/bash
GW=${GW:-192.168.1.1}
TARGET=${TARGET:-1.1.1.1}
DOMAIN=${DOMAIN:-example.com}

check() {
  if eval "$2" >/dev/null 2>&1; then
    echo "OK    $1"
  else
    echo "FAIL  $1"
  fi
}

check "本机回环"  "ping -c1 -W1 127.0.0.1"
check "默认路由"  "ip route | grep -q default"
check "网关"      "ping -c1 -W1 $GW"
check "公网 IP"   "ping -c1 -W2 $TARGET"
check "DNS"       "ping -c1 -W2 $DOMAIN"
check "监听端口"  "ss -tlnn | grep -q ':22'"
```

脚本只做判定、不做修复——
修复需要人工
根据 FAIL 的位置决定。
把 `OK/FAIL` 输出接入监控系统，
可以在用户报障前发现异常；
对连续 FAIL 的阶段
自动附上对应的深入诊断命令
（如 `ip neigh`、`dig @上游`），
减少值班人员的重复劳动。

巡检与实时排障的差别在于
**时间维度**：
巡检关心"今天是否和昨天一样"，
排障关心"此刻哪一步失败"。
脚本里每个 `check`
都对应推理链的一段，
告警时直接报出
"FAIL 网关"，
比报"网络异常"有用一个数量级。

## 7. 性能类问题：慢但通得了

"通，但很慢"需要另一组证据。
先量化再下结论：

```bash
# 丢包与延迟的持续观测
$ mtr -r -c 50 1.1.1.1
                            Loss%   Snt   Last   Avg  Best  Wrst StDev
  1.|-- 192.168.1.1          0.0%    50    1.1   1.2   0.9   2.1   0.3
  2.|-- 100.64.0.1           0.0%    50    4.2   4.3   3.9   6.0   0.5
  3.|-- ???                 100.0%    50    0.0   0.0   0.0   0.0   0.0
  4.|-- 1.1.1.1              2.0%    50   12.4  13.1  11.9  22.7   2.8

# 带宽验证（服务端 iperf3 -s，客户端压测）
$ iperf3 -c 192.168.1.200 -t 10
[  5]   0.00-1.00   sec   112 MBytes   941 Mbits/sec    0 sender
```

`mtr` 输出比单次 `ping` 有价值得多：
它同时给出每一跳的丢包率，
能区分"全路径丢"
与"某跳之后才丢"。
最后一跳丢包、中间路径干净，
通常是对端或其接入层的问题；
中间某跳开始持续丢包，
则问题在该设备或其下联。
**中间星号跳（`???`）不算证据**，
只要末跳 Loss 低即可。

本机侧的软丢包同样要看：
`ip -s link show eth0` 的 `drop` 计数、
`ss -s` 的连接汇总、
`nstat -az` 里的监听溢出与重传计数。

`ip -s` 的 `drop`
增长说明网卡或内核缓冲区
来不及处理
（Ring Buffer、中断亲和性、pps 超限）；
`nstat` 的 `TcpExtListenOverflows`
增长则说明应用 `accept`
队列满了——
此时网络层毫无问题，
扩容应用或调 `somaxconn` 才对症，
相关内容见
[网络配置基础](./network-configuration.md)
的调优一节。

性能问题还要区分
**带宽打满**与**延迟劣化**：
前者 `iperf3` 直接见分晓，
后者要看 mtr 的 RTT 曲线
是否随时间抖动。
两者混为一谈，
会把扩容决策做在错误的方向上。

## 8. 常见坑

- **跳过 `ip route get` 直接 ping**。
  路由表缺默认条目时
  ping 公网必然失败，
  先看路由能省下一半时间。
- **用 `ping 域名`
  同时检验网络和 DNS**。
  失败时无法归因，
  必须 IP、域名各测一次。
- **把 traceroute 中间的 `*`
  当成故障**。
  ICMP 过滤是常态，
  只有"从此跳起后续全灭"
  才值得怀疑。
- **在错误的机器上抓包**。
  本机抓不到入站 SYN，
  说明包没到本机，
  此时应去客户端或中间设备抓。
- **忘记 `-n` 参数**。
  `tcpdump`/`traceroute`
  默认会做反向 DNS，
  DNS 故障时输出会卡顿甚至被误导，
  排障时一律加 `-n`。
- **依赖 `netstat` 而机器没装**。
  `netstat` 属 `net-tools`
  （Debian 系 `apt install net-tools`，
  Arch `pacman -S net-tools`，
  RHEL 新版默认不带），
  新系统直接用 `ss`。
- **无线排障还在用 `iwconfig`**。
  `wireless-tools` 已过时，
  `iw` 才是内核 nl80211 接口的正统工具，
  `iwconfig` 看不到
  5GHz/6GHz 与现代关联状态。
- **改完配置不验证持久性**。
  `ip addr add` 重启就没了，
  临时验证后必须落到
  Netplan/nmcli/networkd 配置，
  否则"昨天还好好的"会再次上演。
- **无记录地修好问题**。
  写下现象、证据、假设、处理四栏，
  三个月后同类故障复现时，
  这份记录比任何记忆都可靠。
- **第一反应是重启服务**。
  重启可能让问题暂时消失，
  但也抹掉了现场——
  至少先跑完推理链的前两段，
  再决定要不要重启。
- **把"偶发"当成"无法复现"从而放弃**。
  偶发故障同样有模式：
  是否固定在整点出现、
  是否与批量任务或备份窗口重合、
  是否只在特定出口链路上发生。
  用监控历史曲线对齐时间轴，
  比等待它下一次撞上更主动。
- **在多人协作时口头同步结论**。
  没有落盘的中间结论会在交接中走样，
  "网关是通的"可能被传成"网络没问题"。
  关键判断请写进工单或值班频道，
  附上原始命令输出，
  让证据跟着结论一起传递。
- **忽略时区与时间戳**。
  跨机器比对日志时，
  时钟偏差会让"先后顺序"判断完全颠倒，
  隧道、TLS、日志关联类问题尤其如此。
  先 `chronyc tracking` 确认同步状态，
  再比较时间线。

## 9. 记录、复盘与交接

排障的终点不是"修好了"，
而是下一次同类故障能更快被修好。
把过程记录下来，
不是为了写文档而写文档，
而是为了在下一次深夜报警时
能直接复用上次验证过的推理路径。

一份最小但够用的记录
只需要四个字段：
现象（谁在什么环境下报的什么）、
证据（每一步命令与关键输出）、
假设（当前怀疑什么、依据是什么）、
处理（改了什么、如何验证生效）。
四栏写满，
交接就不再依赖口述——
下一个值班的人能从任意中间状态继续，
而不必从头重走前两步。

复盘关注的不是"谁的责任"，
而是推理链在哪一步变得低效：
是缺少前置检查脚本，
是抓包晚了一步，
还是告警没有给出足够上下文。
把这三类短板分别补进巡检、
工具链与告警文案，
比开一次冗长的事后会更有效。

时间盒也很重要：
给自己设定每个阶段的上限
（例如两分钟看本机、
一分钟看网关、
三分钟看 DNS），
超时就升级或换人。
排障容易陷入"再试一个命令就好"的沉没成本陷阱，
时间盒强迫你在效率下降之前切换视角——
这是团队排障比个人排障更稳定的结构性原因。

## 参考资料

最后补一句实践建议：
把本文的推理链与你所在环境的实际地址
（网关、上游 DNS、关键业务 IP）
做成一页值班卡片，
贴在监控大盘旁边或写进工单模板。
工具会换、网络会变，
但"从最确定的事实逐跳向外"这个顺序
不会因为换机房或换云厂商而失效——
它值得被固化成团队的默认动作，
而不是每个人凭经验各自发挥。

- `man tcpdump`、`man traceroute`、
  `man mtr`、`man ss`、`man ip`、
  `man nmap`、`man nc`
- tcpdump 官方手册 — [tcpdump.org](https://www.tcpdump.org/manpages/)
- Arch Wiki - Network troubleshooting — [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_troubleshooting)
- Red Hat - Troubleshooting network connectivity — [redhat.com](https://www.redhat.com/sysadmin/troubleshoot-network)
- Cisco - 路由与连通性排查思路（方法论可迁移） — [cisco.com](https://www.cisco.com/c/en/us/support/docs/ip/routing-protocols/21284-troubleshooting-guide.html)
- 鸟哥的私房菜 - 网络除错 — [linux.vbird.org](https://linux.vbird.org/linux_server/0110networkbasic.php)
