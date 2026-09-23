# VPN

VPN（虚拟专用网络）做的事情
可以用一句话概括：
**在不可信的网络上，
伪造出一条可信的私有链路**。
远程办公要访问内网系统、
两个办公室要互通、
出差员工要安全上网，
背后都是同一个需求——
把原本必须拉专线的场景，
用加密隧道跑在公网上。

本页先讲清隧道与路由如何协作
（这决定了 90% 的配置问题），
再给出 WireGuard 与 OpenVPN
两套可落地的配置，
最后补充 IPsec 的概念定位与安全实践。

> 内容参考自 WireGuard、OpenVPN、
> Libreswan 官方文档与 Arch Wiki，
> 见文末参考资料。

## 学习目标

- 理解 VPN 隧道的工作原理：
  封装、加密、路由三者如何配合
- 掌握 WireGuard 的密钥体系、
  配置语法与 `AllowedIPs` 语义
- 能部署 OpenVPN（证书模式）
  并理解其适用场景
- 了解 IPsec/IKE 的概念
  与站点互联中的位置
- 识别 VPN 高发故障：
  路由未放行、NAT 穿越、MTU 分片、
  防火墙挡 UDP

## 1. VPN 为什么存在

### 1.1 三个典型场景

**远程访问**：
员工在家或咖啡厅，
需要像坐在办公室一样
访问内网的 Git、跳板机、测试环境。
与其给每个内网服务都开公网入口，
不如让员工先"进入"内网——
入口收敛成一个，
审计与限流也只需要做一处。

**站点到站点**：
总部与分支各有完整内网，
需要像一根网线一样互通，
两边的 192.168.x.x 可以直接互访。
业务系统按内网地址部署、
不改动任何配置，
是这类场景最大的价值。

**安全上公网**：
公共 Wi-Fi 上的流量
可能被中间人嗅探，
隧道把出口收敛到可信网关再转发。
咖啡厅场景里，
VPN 保护的不是"机密性"本身，
而是"你以为在直连、
实际有人在中间"的错觉。

三者的共同点是
**用隧道替代专线**，
代价则是引入了加密、认证、
密钥管理与隧道自身路由
这三个新的故障域。
收益与复杂度一起到账——
理解这一点，
就不会对"VPN 半通不通"感到意外。

### 1.2 隧道、加密与路由的分工

一次 VPN 通信包含三个正交的机制，
理解它们的分工是排障的前提。

**隧道（封装）**：
把原始包整个塞进另一个包里，
源/目的地址变成隧道两端，
像信封套信封。
对原始包而言，中间网络完全透明。

**加密与认证**：
保证只有持有密钥/证书的对端能解封，
且内容未被篡改。
WireGuard 用 Noise 协议握手后
以 ChaCha20 加密；
OpenVPN 基于 TLS；
IPsec 用 IKE 协商 + ESP 加密。

**路由**：
隧道接口（`wg0`、`tun0`、`ipsec0`）出现后，
内核必须知道
"哪些目标地址走这条隧道"。
**加密正常不代表路由正确**——
这正是"VPN 连上了却 ping 不通内网"
的根源。

流程示意：

```text
内网包 10.0.0.5 → 判断：属于 AllowedIPs/路由表
        → 进入隧道接口 → 加密封装为 UDP
        → 走物理网卡发往对端公网地址
        → 对端解封装 → 转发进内网
```

注意最后一步：
**对端也必须愿意转发并回程**，
包括内核 `ip_forward`、
NAT 规则、
以及对端路由表里有回程条目。
VPN 单侧配置完美而对端缺一条回程路由，
是站点互联中最常见的"半通"现象——
A 能 ping 到 B，B 的响应回不来。
排查时永远先画出双向路径，
再看单侧配置。

## 2. 选型：WireGuard、OpenVPN、IPsec

| 维度 | WireGuard | OpenVPN | IPsec（IKEv2/ESP） |
|------|-----------|---------|---------------------|
| 协议 | UDP（默认 51820），自研 Noise 握手 | UDP/TCP 1194，基于 TLS | UDP 500/4500，IKE + ESP |
| 代码量 | 内核模块，约数千行 | 用户态，数十万行 | 内核/用户态混合，实现复杂 |
| 配置复杂度 | 极低（两段密钥 + AllowedIPs） | 高（PKI、证书、策略文件） | 高（SA、策略、证书） |
| 典型场景 | 个人组网、容器互联、现代服务器互联 | 需要穿透严格代理、兼容老客户端 | 与硬件防火墙/既有设备互通 |
| 认证模型 | 静态公钥（按公钥识别对端） | X.509 证书 | 证书或 PSK |

**经验法则**：
新项目默认 WireGuard，
除非你需要 TCP 443 伪装
（OpenVPN 的优势）、
或必须与厂商网络设备
做标准 IPsec 互通。
三者可以共存于同一台网关，
用不同端口区分。

TCP 模式的现实意义常被低估：
某些酒店网络只放行 443，
OpenVPN over TCP 才能建立连接，
而 WireGuard 的纯 UDP
在此直接宣告失败。
出差频繁的团队
把 OpenVPN 作为兜底通道，
是成熟做法。

三发行版安装
（Arch 一律 `pacman -S`）：

```bash
# WireGuard：Debian/Ubuntu
sudo apt install wireguard
# Arch：内核已含模块，仅需用户态工具
sudo pacman -S wireguard-tools
# RHEL/CentOS/Rocky 8/9
sudo dnf install wireguard-tools

# OpenVPN + 证书工具
sudo apt install openvpn easy-rsa      # Debian/Ubuntu
sudo pacman -S openvpn easy-rsa        # Arch
sudo dnf install openvpn easy-rsa      # RHEL/CentOS（easy-rsa 也在 EPEL）
```

## 3. WireGuard

### 3.1 密钥体系

WireGuard 不需要证书体系，
每台机器一对曲线密钥
（私钥 + 公钥），
对端之间交换公钥即可建立信任。
这把 PKI 的复杂度压成了两条命令：

```bash
# 生成服务器密钥
wg genkey | tee server_private.key | wg pubkey > server_public.key

# 生成客户端密钥
wg genkey | tee client_private.key | wg pubkey > client_public.key
```

私钥权限必须是 `600`
且绝不离开服务器；
公钥可以随意分发。
WireGuard 没有"吊销列表"——
踢掉一个客户端的方式
是在服务器配置里删除其
`[Peer]` 段并重载接口。
因此**私钥泄露的应急处置
就是换密钥并更新所有对端**，
没有更优雅的中间状态。

密钥的存放也有讲究：
不要提交进 Git，
不要塞进共享目录。
把公钥交换走线下发
（或经配置管理系统的加密通道），
私钥只在目标机器上生成——
一旦私钥经过聊天工具传过一轮，
就应视为需要轮换。

### 3.2 服务器配置

```ini
# /etc/wireguard/wg0.conf（服务器）
[Interface]
PrivateKey = <server_private_key>
Address = 10.0.0.1/24
ListenPort = 51820
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

[Peer]
PublicKey = <client_public_key>
AllowedIPs = 10.0.0.2/32
```

`PostUp`/`PostDown`
在接口起停时执行，
负责两件关键事：
**允许转发**
（否则隧道流量进得来出不去）
与 **NAT**
（让内网回包知道怎么回隧道地址）。
若服务器只做点对点、
不转发第三方流量，
可以省略这两行。

IP 转发本身还需内核参数放行
（`net.ipv4.ip_forward = 1`，
写入 `/etc/sysctl.d/`
后 `sysctl --system`），
忘了这步的表现是
客户端能连上、`wg show` 握手正常，
却 ping 不通服务器内网——
**握手成功 ≠ 转发开启**，
两者是完全独立的开关。
用 NFT 的系统同理，
PostUp 里的 iptables 规则
可换成等价 nft 语法，
但 FORWARD 钩子的 policy
必须是 accept 或有明确放行。

### 3.3 客户端配置

```ini
# /etc/wireguard/wg0.conf（客户端）
[Interface]
PrivateKey = <client_private_key>
Address = 10.0.0.2/24
DNS = 10.0.0.1

[Peer]
PublicKey = <server_public_key>
Endpoint = 203.0.113.5:51820
AllowedIPs = 10.0.0.0/24
PersistentKeepalive = 25
```

**`AllowedIPs`
是 WireGuard 最容易被误解的字段**：
它同时承担两个语义——
(1) 允许对端发来哪些源地址的包
（安全白名单），
(2) 把哪些目标地址的路由
指向这条隧道（路由表）。
因此客户端若写
`AllowedIPs = 0.0.0.0/0`，
就是"全流量进隧道"的全局 VPN 模式；
只写 `10.0.0.0/24`
则是内网访问模式。
服务器端对每个 `[Peer]`
通常写 `/32` 的客户端地址，
表示只接收该客户端自己的流量。

`PersistentKeepalive = 25`
解决 NAT 后的映射过期问题：
客户端在家用路由器后面，
不主动发包时 NAT 会话会被回收，
对端便无法反向发起连接。
**纯客户端侧发起流量的场景可以不设，
一旦服务器要主动访问客户端
（推送配置、内网互访），
这个 keepalive 就是必须的**。
判断方法很简单：
单向 curl 正常、
服务器主动 push 失败——
先查 keepalive 再查别的。

`DNS = 10.0.0.1`
会在连接建立时
临时接管系统解析
（wg-quick 通过 resolvconf
或 systemd-resolved 设置），
断开后恢复。
客户端不写 DNS，
隧道内网的短名可能解析失败，
这也是
"能 ping IP、打不开内网域名"
的常见原因。

### 3.4 启动与验证

```bash
$ sudo wg-quick up wg0
$ sudo wg show
interface: wg0
  public key: 3L4x8K...=
  listening port: 51820

peer: 9Zc1wQ...
  endpoint: 198.51.100.23:54321
  allowed ips: 10.0.0.2/32
  latest handshake: 12 seconds ago
  transfer: 48.21 KiB received, 51.06 KiB sent

$ sudo systemctl enable --now wg-quick@wg0
```

验证遵循与
[网络故障排除](./troubleshooting.md)
相同的推理链，
只是在最前面加一步隧道状态：
`latest handshake`
是否在最近一分钟内更新。
握手停在几分钟前说明隧道已断，
此时 ping 隧道内地址毫无意义，
应先恢复握手
（查 UDP 端点可达性、NAT、防火墙）。

握手正常但隧道内不通，
再依次查
`AllowedIPs`、`ip route`、
对端转发与 NAT——
顺序与第 1.2 节的三个机制一一对应。
`wg show` 里 `transfer`
双向都有增长
说明数据面真的在跑；
只有 handshake 没有 transfer，
则路由或防火墙在半路拦住了流量。

### 3.5 常见坑

- **`wg-quick up` 后路由缺失**。
  `AllowedIPs` 决定
  `wg-quick` 是否自动加路由；
  手工 `wg set` 不会加路由，
  需自己 `ip route add`。
- **服务器与客户端 AllowedIPs 不对称**。
  服务器允许 `10.0.0.2/32`，
  客户端却声明 `0.0.0.0/0`
  并被其他流量顶掉默认路由，
  导致全网瘫痪——
  改配置前先想清楚要的是哪种模式。
- **UDP 51820 被出口防火墙/云安全组拦截**。
  症状：本地 `wg show` 无握手、无报错。
  用 `tcpdump -ni eth0 udp port 51820`
  看有没有双向流量，
  再对照[防火墙](./firewall.md)一节取证。
- **MTU 导致"小包通、大包断"**。
  隧道叠加头部后有效 MTU 变小，
  ping 通但 SSH 卡死、网页打不开，
  典型症状是
  `ping -M do -s 1400` 失败
  而 `-s 1000` 成功。
  解决方式是在隧道接口设更小 MTU
  （`MTU = 1280` 起步），
  或在 TCP 层用 TCPMSS 钳制。
- **只配了一侧的回程路由**。
  服务器能 ping 客户端隧道地址
  却 ping 不回客户端内网，
  因为回程没有指向隧道的条目——
  按拓扑把双向都写进配置。

## 4. OpenVPN

### 4.1 证书模型与 PKI

OpenVPN 的信任基于 X.509 证书，
需要先搭一套最小 PKI
（证书颁发机构），
用 `easy-rsa` 完成：

```bash
$ cd /etc/openvpn
$ sudo make-cadir easy-rsa && cd easy-rsa
$ sudo ./easyrsa init-pki
$ sudo ./easyrsa build-ca nopass
$ sudo ./easyrsa gen-req server nopass
$ sudo ./easyrsa sign-req server server
$ sudo ./easyrsa gen-req client1 nopass
$ sudo ./easyrsa sign-req client client1
$ sudo ./easyrsa gen-dh
$ sudo openvpn --genkey secret /etc/openvpn/ta.key
```

PKI 的运维成本
明显高于 WireGuard 的两把密钥，
但换来的是完整的签发/吊销链条
（配合 CRL），
适合"人员流动频繁、
要按角色发证书"的企业环境。
`build-ca nopass`
省去了每次交互输密码，
自动化友好，
但 CA 私钥因此无口令保护——
**生产 CA 请加密码并离线备份**，
这里仅为演示简化。

证书发放流程本身也是治理工具：
谁离职就吊销谁的证书，
审计日志按 CN 归因，
比"共享一个 PSK"清晰得多。
代价是每次新增客户端
都要走一遍签发流程——
规模超过几十个客户端时，
要么上自动化签发，
要么认真考虑换 WireGuard。

### 4.2 服务器与客户端配置

```bash
# /etc/openvpn/server.conf（节选，路径按你的 PKI 实际位置调整）
port 1194
proto udp
dev tun

ca   /etc/openvpn/easy-rsa/pki/ca.crt
cert /etc/openvpn/easy-rsa/pki/issued/server.crt
key  /etc/openvpn/easy-rsa/pki/private/server.key
dh   /etc/openvpn/easy-rsa/pki/dh.pem

server 10.8.0.0 255.255.255.0
push "redirect-gateway def1 bypass-dhcp"
push "dhcp-option DNS 10.8.0.1"

keepalive 10 120
tls-auth /etc/openvpn/ta.key 0
cipher AES-256-GCM
auth SHA256

user nobody
group nogroup
persist-key
persist-tun
verb 3
```

`server` 指令一行同时完成三件事：
划出隧道网段、
生成服务端隧道地址、
给连入客户端分 DHCP 风格的地址。
`push "redirect-gateway"`
让客户端把默认路由改道进隧道
（全局 VPN），
不需要全局模式时删除该行即可——
**很多"VPN 一连家里断网"的投诉，
就是客户端不该被推默认路由却推了**。

客户端 `client.ovpn` 侧对应写
`remote <服务器IP> 1194`、
证书/私钥路径与 `cipher`
（须与服务端一致），
并同样设置 `persist-tun`、`nobind`。
管理与排障命令：

```bash
$ sudo systemctl start openvpn@server
$ sudo systemctl enable openvpn@server
$ sudo journalctl -u openvpn@server -f
$ sudo cat /var/log/openvpn/status.log
```

新版本 OpenVPN 日志默认进 journald，
不再总是写
`/var/log/openvpn/openvpn.log`——
按 unit 查日志最稳妥。
常见握手失败原因依次是：
时钟偏差过大、
CA/cipher 与客户端不匹配、
UDP 端口被拦、
证书过期（`easyrsa renew` 轮换）。
其中时钟问题最隐蔽：
TLS 对证书有效期与
NotBefore/NotAfter 敏感，
虚拟机休眠唤醒后时间漂移，
会直接导致握手失败——
排障时 `chronyc tracking`
值得排进前五条命令。

### 4.3 站点到站点

两台网关各起一份 OpenVPN，
把对方内网写进路由即可。
服务端声明对端网段，
客户端声明回程网段：

```bash
# 站点 A（服务端）：把去往站点 B 内网的流量交给隧道
route 192.168.2.0 255.255.255.0

# 站点 B（客户端）：回程
route 192.168.1.0 255.255.255.0
```

双向路由 + 双向防火墙放行 +
两边 `ip_forward=1`，
三者缺一即"单向通"。
拓扑一旦超过两个站点，
建议改用动态路由
（如在隧道上跑 OSPF/BGP）
或直接考虑 mesh 方案，
静态路由的手工维护成本
会随站点数平方增长——
三站点还好，
三十站点就该上控制面了。

站点互联还要对齐 MTU 与 MSS：
两层封装叠加后，
内网大包容易在隧道里分片。
若发现"文件传输慢、
小请求正常"，
优先在隧道两侧
做 TCPMSS 钳制，
而不是调应用超时。
这条经验对 WireGuard、
OpenVPN、IPsec 一视同仁。

## 5. IPsec 概念

IPsec 是 IETF 标准的网络层加密框架，
**不是单一协议**，
而是两组协议的组合。

**IKE（Internet Key Exchange）**，
UDP 500/4500：
负责身份认证与密钥协商，
IKEv2 相比 v1 更简洁、
支持移动性（MOBIKE），
是当前推荐版本。

**ESP（Encapsulating Security Payload）**：
负责实际的数据加密与完整性保护，
可选择传输模式
（只加密载荷，主机到主机）
或隧道模式
（整个包再包一层，站点互联常用）。

Linux 上的实现有 Libreswan
（RHEL/CentOS 系默认）
与 StrongSwan
（Arch/Debian 常见），
配置核心是 **policy**
（哪些流量要加密、和谁加密）
与 **SA**（安全关联，
协商出的密钥状态）。

与 WireGuard 的静态公钥模型不同，
IPsec 的策略由"源/目的子网对"声明，
非常适合与硬件防火墙、NAS、
路由器等标准设备互通——
这也是它在企业存量环境中
不可替代的原因。
新建 Linux 内部互联仍首推 WireGuard，
需要与厂商设备对通时才上 IPsec。

理解层面只需记住三点：
IPsec 站点互联等价于
"先建立可信 SA，
再按策略圈定哪些流量进隧道"；
NAT 环境下依赖
NAT-Traversal（UDP 4500）；
排障时先看 IKE 是否协商成功
（`ip xfrm state` / `ipsec status`），
再看数据面
（`tcpdump` 抓 ESP 或 4500 端口）、
最后看策略是否覆盖目标子网
（`ip xfrm policy`）。
这与 WireGuard 的
"先握手、再路由"完全同构，
可直接迁移推理链。

## 6. 安全实践

- **最小暴露面**。
  只开放必需的 VPN 端口
  （UDP 51820 / 1194 / 500,4500），
  并限定来源 IP；
  公网全开放的管理端口
  是扫描器的首要目标。
  对无固定出口的客户端，
  至少用速率限制与密钥轮换兜底。
- **密钥与证书轮换**。
  WireGuard 私钥、
  OpenVPN CA 与服务器证书
  都应有更换计划；
  OpenVPN 至少每年轮换服务器证书，
  人员离职及时重签客户端并更新 CRL。
- **不做"全流量"除非真的需要**。
  `AllowedIPs = 0.0.0.0/0`
  与 `redirect-gateway`
  会把所有 Internet 流量导入隧道，
  放大服务器带宽与单点故障影响；
  仅访问内网时用内网网段即可。
- **敏感文件权限**。
  `/etc/wireguard/*.key`、
  `/etc/openvpn/**/private/*`
  全部 `600 root:root`，
  配置目录避免进入版本库明文提交。
- **记录与审计**。
  WireGuard 看 `latest handshake`
  与 transfer 统计，
  OpenVPN 开 `verb 3`
  并保留 journald 日志；
  异常时间的握手、
  异常大的 transfer 都值得告警，
  可接入[网络监控](./network-monitoring.md)体系。
- **防火墙协同**。
  VPN 放行属于连通性配置，
  放行后仍要确认
  没有被更宽泛的 DROP 规则覆盖，
  见[防火墙](./firewall.md)。

安全与可用性在这里有一次刻意的权衡：
WireGuard 未握手的流量
是静默丢弃的（不回 ICMP），
外人看到的是"端口不存在"，
自己人配置错时看到的也是
"什么都没有"——
安静既是防护，也是排障障碍。
所以隧道类故障
更依赖主动的握手状态检查，
而不是等连接超时报错。

## 7. 常见坑速查

| 症状 | 优先检查 |
|------|----------|
| 连不上、无握手日志 | UDP 端口是否被云安全组/本机防火墙拦（`tcpdump -ni eth0 udp port 51820`） |
| 握手成功但 ping 不通隧道地址 | 双方 `AllowedIPs`/路由、`ip_forward`、NAT 规则 |
| 只有小包通大包断 | MTU/MSS 分片，隧道接口降 MTU 或 clamp MSS |
| VPN 一连全家断网 | 误推默认路由（`redirect-gateway` / `0.0.0.0/0`） |
| 连上后内网域名解析失败 | `DNS=` 未设或内网 DNS 未被推给客户端 |
| OpenVPN 频繁掉线 | `keepalive` 参数、NAT 会话超时、双方时钟偏差 |

每一行都可以回到本文对应小节
与[网络故障排除](./troubleshooting.md)
的推理链继续下钻。
速查表的正确用法是
**先定位到表里的哪一行，
再回头读那一行对应的原理段**——
只背表会在遇到变种症状时失灵。

## 参考资料

- WireGuard 官方站点与白皮书 — [wireguard.com](https://www.wireguard.com/)
- Arch Wiki - WireGuard — [wiki.archlinux.org](https://wiki.archlinux.org/title/WireGuard)
- OpenVPN 社区文档 — [openvpn.net](https://openvpn.net/community-resources/)
- Arch Wiki - OpenVPN — [wiki.archlinux.org](https://wiki.archlinux.org/title/OpenVPN)
- strongSwan 文档 — [docs.strongswan.org](https://docs.strongswan.org/)
- Libreswan 文档 — [libreswan.org](https://libreswan.org/wiki/Documentation)
- RFC 7296（IKEv2）、
  RFC 4301/4303（IPsec 架构与 ESP）
- `man wg`、`man wg-quick`、`man openvpn`
