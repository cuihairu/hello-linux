# DHCP 服务器（dhcpd / Kea）

静态 IP 适合服务器，但局域网里的笔记本、手机、打印机不可能挨个手工配地址——DHCP（Dynamic Host Configuration Protocol）就是把这层分配自动化的协议：机器插上网线发一嗓子广播，DHCP 服务器应答一个带网关、DNS、租约期限的完整网络参数包，客户机配置即告完成。自建一台 DHCP 的典型场景：家庭或办公室内网想统一管理地址段与 DNS 出口；虚拟化/实验环境里一批虚机频繁增删，手工登记根本追不上；或者现有路由器内置的 DHCP 段要重划、要给打印机做固定地址保留。本页以 ISC dhcpd 为主线（Debian/Ubuntu 的 `isc-dhcp-server`、RHEL 系的 `dhcp-server`、Arch 的 `dhcp` 包），按"为什么 → 安装 → 服务端配置 → 客户端与租约验证 → Kea → 排错"展开；DHCP 下发的 DNS 选项指自建 BIND 时见[DNS 服务器](./dns/bind.md)，跨网段组网与 NAT 见[路由与 NAT](./routing-nat.md)。

> 内容参考自 ISC 官方文档与 Arch Wiki（概念框架参考鸟哥的私房菜），见文末参考资料。

## 学习目标

- 讲清 DORA 四步为什么全程广播、租约为什么必须有期限
- 掌握三发行版安装与 unit 名差异，装完能验证服务真的在监听
- 独立写出完整可跑的 `dhcpd.conf`：地址池、选项、固定地址保留
- 会从两端验证一次成功分配：服务端读租约账本，客户端看实际下参数
- 了解 ISC DHCP 停维护后的接班人 Kea，知道何时该选它
- 排查服务起不来、拿到地址没网关、地址冲突等高频坑

## 1. DHCP 解决什么问题

### 1.1 DORA：四步全广播的握手

客户机在拿到地址之前没有 IP 可用，所以整个协商只能靠广播完成，这就是 DORA 四步：**Discover**（客户端广播"这里有 DHCP 服务器吗"）、**Offer**（服务器广播"我提议 192.168.56.101，网关 DNS 如下"）、**Request**（客户端广播"我要用刚才那台提议的地址"——广播是顺便告诉其他服务器"你们的提议我没采纳"）、**ACK**（服务器广播"成交，租约 600 秒"）。协议端口是 UDP 67（服务端）与 68（客户端），全程链路层广播，任何一步丢了就靠客户端重试，协议本身没有重传协调者。

| 步骤 | 谁发 | 报文要点 |
|------|------|----------|
| Discover | 客户端 | 源地址 0.0.0.0，目标 255.255.255.255，带 MAC 与主机名 |
| Offer | 服务端 | 提议 IP/掩码/网关/DNS/租期，多台服务器各发各的 |
| Request | 客户端 | 广播确认选中的服务器与地址，落选者回收提议 |
| ACK | 服务端 | 正式发放，客户端此后可以配置网卡上线 |

四步里最容易忽略的是第三步为什么也要广播：内网若有多台 DHCP 服务器（迁移期间很常见），客户端用广播公开"我选了谁"，落选的服务器才能把刚才 Offer 的地址放回池子。理解这一点，就明白为什么排错时抓包比看日志直观——DORA 是否走完、走到第几步断了，一次 `tcpdump` 全部摊开。

### 1.2 租约：一本会过期的账

DHCP 不是"发完就完"，而是租借模型：每个分配出去的地址都记在服务端的租约文件里，带起止时间；租期过半（0.5 × T1）客户端会主动找原服务器续租，租期过 7/8（0.875 × T2）还没续上就广播向任何服务器求救，全部失败则到期退租、地址回池。这本账的类比对象就是包管理器的安装数据库：`/var/lib/dhcp/dhcpd.leases` 之于 dhcpd，正如 `/var/lib/dpkg/status` 之于 dpkg——都是"我发出去/装上去的东西"的单一真相源，服务重启不丢、可以离线审阅。租约期限是调优手段而非常量：办公网短租期（如 1 小时）让地址快速回收，适合设备频繁来去；服务器所在的固定段则应该用保留地址而非长租期来兜底——期限解决"回收"，保留解决"这台机器永远是这个地址"，两件事别混。

### 1.3 authoritative：权威与非权威的姿态

`dhcpd.conf` 顶层的 `authoritative;` 声明本服务器是本网段的正式 DHCP。差别体现在"拒绝"上：客户端带着从别的网段带来的旧租约来续租，权威服务器直接回 NAK，逼它重新走一遍 DORA 拿本网段的正确参数；非权威服务器选择沉默，客户端就吊死在旧租约上反复重试，表现为"换了网段后一直上不了网"。只有迁移期间的临时服务器才应该保持非权威姿态，正式环境一律加 `authoritative;`——这条漏配是新手配置里最经典的"看起来都对就是不通"。

## 2. 安装（三发行版对照）

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装（服务端） | `apt install isc-dhcp-server` | `pacman -S dhcp` | `dnf install dhcp-server` |
| 服务单元 | `isc-dhcp-server` | `dhcpd4` | `dhcpd` |
| 主配置 | `/etc/dhcp/dhcpd.conf` | `/etc/dhcpd.conf` | `/etc/dhcp/dhcpd.conf` |
| 指定监听网卡 | `/etc/default/isc-dhcp-server` 的 `INTERFACESv4` | `systemctl edit dhcpd4` 覆写 ExecStart | `/etc/sysconfig/dhcpd` 的 `DHCPDARGS` |
| 租约文件 | `/var/lib/dhcp/dhcpd.leases` | `/var/lib/dhcp/dhcpd.leases` | `/var/lib/dhcpd/dhcpd.leases` |
| 客户端工具 | `dhclient`（isc-dhcp-client，默认已有） | 包内自带 `dhclient` | `dhclient`（dhcp-client 包） |

三系的差异集中在包名、unit 名与配置路径三个维度，配置语法完全一致。一个容易混淆的点：Arch 的 `dhcp` 包同时装进服务端 `dhcpd` 与 ISC 客户端 `dhclient`，而 `dhcpcd` 是另一个独立项目的客户端（Arch 默认联网用的就是它）——名字只差一个字母，前者 dhcpd 是"发地址的"，后者 dhcpcd 是"要地址的"，排错时先 `systemctl status` 对准 unit 再往下走，别把客户端的日志当成服务端的问题查。

### 2.1 Debian/Ubuntu

```bash
$ sudo apt install isc-dhcp-server
$ systemctl status isc-dhcp-server | head -3
     isc-dhcp-server.service - ISC DHCP IPv4 server
     Active: failed (Result: exit-code) ...
```

装完直接 `status` 大概率看到 failed——这不是安装坏了，而是 Debian 的默认配置还没有任何 subnet 声明，dhcpd 拒绝空跑（原因见第 6 节第一个坑）。配置补齐并写好 `/etc/default/isc-dhcp-server` 里的 `INTERFACESv4` 后再启动，是 Debian 系的标准顺序：先配后启，而不是装完就 start。

### 2.2 Arch

```bash
$ sudo pacman -S dhcp
$ sudo touch /var/lib/dhcp/dhcpd.leases      # 首次运行前确保租约文件存在
$ sudo systemctl enable --now dhcpd4 && systemctl is-active dhcpd4
active
```

Arch 的配置在上游默认路径 `/etc/dhcpd.conf`（注意没有 `/etc/dhcp/` 这层目录），unit 名 `dhcpd4` 明确标注只跑 IPv4——想要 IPv6 PD 对应 `dhcpd6`。首次启动若报租约文件相关错误，就是上面第二行没做：dhcpd 不会自己创建租约文件，这本"账本"必须先落盘。要限定监听某块网卡，用 `systemctl edit dhcpd4` 写一段 drop-in 覆写 `ExecStart`，在命令行末尾追加网卡名。

### 2.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install dhcp-server
$ sudo systemctl enable --now dhcpd && systemctl is-active dhcpd
active
$ sudo ss -ulnp | grep :67
udp   UNCONN 0  0  0.0.0.0:67  0.0.0.0:*  users:(("dhcpd",pid=1248,fd=7))
```

RHEL 8 起把老 `dhcp` 包拆成了 `dhcp-server` 与 `dhcp-client`，照旧文档敲 `dnf install dhcp` 会装不上。`ss -ulnp | grep :67` 是三系通用的最终验收：unit 显示 active 只说明进程活着，UDP 67 真正挂上广播 socket 才说明服务在收包——这与 BIND 验收要看 `dig` 应答而不是 `systemctl` 绿灯是同一条纪律。防火墙放行 DHCP 服务（UDP 67/68）不在本页展开，见[防火墙篇](../security/firewall.md)。

## 3. 服务端配置

### 3.1 地址池与全局选项

以下是一份针对 `192.168.56.0/24` 内网的完整可跑配置，注释逐条对应语义：

```text
# /etc/dhcp/dhcpd.conf（Arch 为 /etc/dhcpd.conf）
authoritative;                       # 本机是本网段的正式 DHCP（见 1.3 节）
option domain-name "lan.example.com";
option domain-name-servers 192.168.56.10, 192.168.56.2;
default-lease-time 3600;             # 默认租约 1 小时
max-lease-time 7200;                 # 客户端请求再长也只给 2 小时

subnet 192.168.56.0 netmask 255.255.255.0 {
    option routers 192.168.56.2;     # 网关：跨网段与 NAT 的出口，见路由与 NAT 一页
    range 192.168.56.100 192.168.56.200;   # 动态池：101 个地址可供租借
}
```

三件事值得停下来想清楚。第一，`subnet` 块必须与服务器某块网卡的实际网段匹配——dhcpd 靠它判断"这个广播该不该我应答"，网卡是 `192.168.56.0/24` 而配置只写了 `10.0.0.0/8`，服务直接起不来。第二，`domain-name-servers` 放在全局而 `routers` 放在 subnet 里，是刻意示范两种作用域：全局选项对所有 subnet 生效，subnet 内选项只对本段生效——多网段时网关各段不同、DNS 全网统一，正是这个分工的典型用法。第三，`range` 划定动态池，池外的地址留给保留与静态设备，"池"与"保留区"的边界要在规划时一次画清，后文冲突坑的根源多数是这条边界没画。

服务器插两块网卡、各接一个网段时，两个 subnet 并排声明即可，dhcpd 按广播进入的接口选用对应网段的池，全局选项两侧共享：

```text
# 双网卡双网段：第 3.1 节配置之外再追加一段
subnet 192.168.57.0 netmask 255.255.255.0 {
    option routers 192.168.57.2;           # 本段网关与 56 段不同
    range 192.168.57.100 192.168.57.150;   # 池大小按段内设备数估
}
```

这是"一台服务器服务多个网段"的最简形态（物理直连）；网段之间隔着路由器时的中继做法见第 6 节。注意每段各自画清池与保留区的边界，两段的地址空间互不重叠是硬前提。

### 3.2 固定地址保留（host）

打印机、NAS、需要端口映射的内网服务，认 MAC 不认租期：

```text
# 追加到 dhcpd.conf —— 保留地址放在 range 之外（.50 不在 .100-.200 内）
host laserjet {
    hardware ethernet 08:00:27:aa:bb:cc;
    fixed-address 192.168.56.50;
    option host-name "laserjet";
}
```

保留的本质是"永远 Offer 同一个地址"——客户端流程仍是标准 DORA，只是 Offer 被钉死，因此客户端视角这是一台"每次都拿到同一地址的 DHCP 客户端"，与手工静态配置有微妙差别（后者根本不参与 DHCP）。保留地址务必划在 `range` 之外：dhcpd 发 Offer 前默认会 ping 候选地址探活，但目标机器防火墙丢弃 ICMP 时探测失效，池内地址被"Ping 不通但其实有人用"地重复分配，正是保留区与动态池重叠时的经典事故。若内网已自建 BIND，保留地址应同时在 DNS 里登记 A 与 PTR 记录，做到"名字、MAC、地址"三处一致——DHCP 管发放、DNS 管命名，两本账各记各的但要对得上账。

### 3.3 监听网卡与语法检查

dhcpd 默认尝试服务所有广播接口，生产上应显式圈定。三系入口不同但语义一致：

```text
# /etc/default/isc-dhcp-server（Debian/Ubuntu）
INTERFACESv4="enp3s0"

# /etc/sysconfig/dhcpd（RHEL 系）
DHCPDARGS="enp3s0"
```

```bash
# 改完配置的固定前奏：语法检查，通过再重启
$ sudo dhcpd -t -cf /etc/dhcp/dhcpd.conf
Internet Systems Consortium DHCP Server 4.4.3-P1
...
If you did not get this output, there may be errors in your config.   # 无 error 即通过
$ sudo systemctl restart isc-dhcp-server    # Arch: dhcpd4；RHEL: dhcpd
```

`dhcpd -t` 之于 dhcpd，正是 `nginx -t`、`named-checkconf` 之于各自服务：把语法错误拦在重启之前。它检查语法与结构，但不检查"subnet 是否匹配网卡"这类运行时事实——后者只有真正启动时才暴露，所以验收仍以 `systemctl is-active` 加 `ss -ulnp | grep :67` 双绿为准。

## 4. 客户端与租约验证

### 4.1 服务端视角：读租约账本

```bash
$ sudo cat /var/lib/dhcp/dhcpd.leases
lease 192.168.56.101 {
  starts 3 2026/10/01 09:12:44;
  ends 3 2026/10/01 10:12:44;
  binding state active;
  next binding state free;
  hardware ethernet 08:00:27:9f:3a:c1;
  client-hostname "desk-01";
}
```

`binding state active` 表示租约在册，`starts/ends` 是租期窗口，`hardware ethernet` 是承租人身份——一台新设备上网后最先该来这里确认"它真的从我这里拿过地址、拿到的是哪个"。续租成功时文件的 `ends` 会前移，排查"地址快到期没续上"就是盯着这本账的时间戳看。

续租在服务端日志里也有清晰足迹，可以现场验证第 1.2 节的 T1 时刻：租期过半时客户端只发单播的 REQUEST（不再 Discover），服务端回 ACK，两步了结：

```bash
$ sudo journalctl -u isc-dhcp-server --since "2 hours ago" | grep 9f:3a:c1
... DHCPREQUEST for 192.168.56.101 from 08:00:27:9f:3a:c1 via enp3s0   # 单播续租，无 Discover
... DHCPACK on 192.168.56.101 to 08:00:27:9f:3a:c1 via enp3s0
```

日志里频繁出现完整 DORA（带 Discover）说明客户端在反复重拿地址——租约总续不上、或客户端网卡在反复重连，这两种病根都要往"环境"而不是 dhcpd 配置里查。

### 4.2 客户端视角：请求并核对下发参数

```bash
# 一次性手动请求（验证场景最直接）
$ sudo dhclient -v -r && sudo dhclient -v enp3s0
Listening on LPF/enp3s0/08:00:27:9f:3a:c1
DHCPDISCOVER on enp3s0 to 255.255.255.255 port 67 interval 1
DHCPOFFER of 192.168.56.101 from 192.168.56.5
DHCPREQUEST of 192.168.56.101 on enp3s0 to 255.255.255.255 port 67
DHCPACK of 192.168.56.101 from 192.168.56.5
$ ip -4 addr show enp3s0 | grep inet
    inet 192.168.56.101/24 brd 192.168.56.255 scope global dynamic enp3s0
$ ip route | head -1
default via 192.168.56.2 dev enp3s0       # option routers 是否生效，看这一行
```

NetworkManager 管理的桌面机对应做法是 `nmcli con mod <连接名> ipv4.method auto && nmcli con up <连接名>`（静态/动态切换的完整对照见[网络配置基础](../network/network-configuration.md)）。验证不止看"拿到地址"：网关、DNS、域名后缀都要逐一核对，因为它们分别对应配置里不同的 option——"有地址没网关"这类半残分配，正是第 6 节的高频坑：

```bash
$ resolvectl status enp3s0 | grep -A2 "DNS Server"
Current DNS Server: 192.168.56.10
       DNS Servers: 192.168.56.10 192.168.56.2
        DNS Domain: lan.example.com      # option domain-name 与 domain-name-servers 都已下发
```

### 4.3 抓包看 DORA 与读日志

```bash
# 服务端网卡上观察完整的四步（dhcpcd/dhclient 重启触发）
$ sudo tcpdump -i enp3s0 -n port 67 or port 68
09:12:43.112341 IP 0.0.0.0.68 > 255.255.255.255.67: BOOTP/DHCP, Request from 08:00:27:9f:3a:c1
09:12:43.114902 IP 192.168.56.5.67 > 255.255.255.255.68: BOOTP/DHCP, Reply from 08:00:27:aa:bb:cc   # Offer
09:12:43.118760 IP 0.0.0.0.68 > 255.255.255.255.67: BOOTP/DHCP, Request from 08:00:27:9f:3a:c1
09:12:43.121577 IP 192.168.56.5.67 > 255.255.255.255.68: BOOTP/DHCP, ACK from 08:00:27:aa:bb:cc
$ sudo journalctl -u isc-dhcp-server --since "10 min ago" | grep dhcpd
... dhcpd[1248]: DHCPDISCOVER from 08:00:27:9f:3a:c1 via enp3s0
... dhcpd[1248]: DHCPOFFER on 192.168.56.101 to 08:00:27:9f:3a:c1 (desk-01) via enp3s0
... dhcpd[1248]: DHCPACK on 192.168.56.101 to 08:00:27:9f:3a:c1 (desk-01) via enp3s0
```

Discover 有、Offer 无，问题在服务端配置或权限；Discover 都没有，问题在链路或客户端；Request 之后没有 ACK，多半是租约账本写入失败——抓包把故障切在三段里的哪一段，比翻日志猜快得多。Debian 系还可 `apt install dhcpdump` 获得逐字段解码的视图，本质与 tcpdump 相同，只是把 DORA 各字段翻译成了人话。

## 5. Kea：ISC 的新一代 DHCP

ISC 已于 2022 年底宣布 ISC DHCP 结束维护（最后的 4.4.3-P1 之后不再有修复），接班人是同为 ISC 开发的 Kea。 dhcpd 目前各发行版仍在广泛使用、配置生态成熟，存量部署短期没有迁移压力；但新项目值得直接评估 Kea，尤其需要这几样能力时：租约存进 MySQL/PostgreSQL 以支撑大规模与多机共享、内置 HA 双机热备（premium hook）、REST API 管理接口、原生的 IPv6 与前缀委派支持。

```bash
$ sudo apt install kea-dhcp4-server       # Debian/Ubuntu；RHEL 系在 EPEL：dnf install kea；Arch 需从 AUR 构建
$ sudo systemctl enable --now kea-dhcp4-server
$ keactrl status
kea-dhcp4: active                         # keactrl 统一管理 kea-dhcp4/-6 各进程状态
```

```json
// /etc/kea/kea-dhcp4.conf —— 与第 3 节等价的最小配置（JSON）
{
  "Dhcp4": {
    "interfaces-config": { "interfaces": ["enp3s0"] },
    "lease-database": { "type": "memfile" },
    "valid-lifetime": 3600,
    "subnet4": [{
      "subnet": "192.168.56.0/24",
      "pools": [{ "pool": "192.168.56.100 - 192.168.56.200" }],
      "option-data": [
        { "name": "routers", "data": "192.168.56.2" },
        { "name": "domain-name-servers", "data": "192.168.56.10, 192.168.56.2" }
      ],
      "reservations": [{
        "hw-address": "08:00:27:aa:bb:cc",
        "ip-address": "192.168.56.50",
        "hostname": "laserjet"
      }]
    }]
  }
}
```

概念一一对应：`pools` 是 range，`option-data` 是 option 行，`reservations` 是 host 保留，`valid-lifetime` 是 default-lease-time——换的是载体（文本变 JSON），不变的是 DORA 与租约模型。

| 维度 | ISC dhcpd | Kea |
|------|-----------|-----|
| 维护状态 | 2022 年底停止维护，存量广泛 | ISC 现役项目，持续更新 |
| 配置载体 | 纯文本 `dhcpd.conf` | JSON，机器友好 |
| 租约后端 | 本地文件 | memfile / MySQL / PostgreSQL |
| 高可用 | 主备各自为政，需外部协调 | HA hook（premium）原生双机 |
| API/自动化 | 无 | REST 控制接口（CA） |
| IPv6 前缀委派 | 支持，配置繁琐 | 原生支持 |

选型口径：学习与小规模内网继续用 dhcpd，资料多、排错直观；地址量上千、要数据库租约后端或 API 自动化时上 Kea；两者都是 ISC 出品，DORA 报文层面客户端无感知，迁移可以逐网段灰度进行。

## 6. 排错与常见坑

**服务起不来：No subnet declaration。** `journalctl -u dhcpd -e` 看到 `No subnet declaration for enp3s0 (no address yet.)` 或 `Not configured to listen on any interfaces!`，根因是配置里没有任何 subnet 与网卡实际网段匹配——网卡还没拿到地址（本机自己也在等 DHCP）、或 subnet 写错了网段。处置顺序：`ip addr` 确认网卡已有静态地址 → 核对 `dhcpd.conf` 的 subnet/netmask 与之一致 → `dhcpd -t` 过了再起。给 DHCP 服务器本机配静态地址是前置条件，一台自己都没有稳定地址的机器没法给别人发租约。

**客户端拿到地址却没有网关/DNS。** 地址有了、`ping 8.8.8.8` 不通或域名解析失败，先 `ip route` 看 default 是否存在、`resolvectl status` 看 DNS 是否下发。九成是 `option routers` / `option domain-name-servers` 漏配或写错了作用域（subnet 内拼写笔误时全局选项不会兜底）。对照第 3.1 节检查两个 option 的位置与拼写即可；抓包看 ACK 报文里实际带了哪些 option，是最终裁决。

**IP 地址冲突。** 症状是两台机器间歇性抢线、MAC 地址在交换机表里来回跳。先查 `range` 是否与手工静态配置的机器或 host 保留区重叠——dhcpd 对池内地址默认有 ping 探活，但目标防火墙丢 ICMP 时形同虚设，边界规划（池外保留、静态区单独划段）才是根治。已经冲突的地址在租约文件里删掉对应 lease 块并重启 dhcpd 可强制回收，再让受害机器重新 DORA。

**跨网段客户端拿不到地址。** DHCP 广播过不了路由器，中央 DHCP 要服务远端网段，需在远端网段放一台中继：`dhcrelay -i <内网口> <DHCP 服务器 IP>`，它把广播转成单播发给服务器、应答再转回广播，报文里的 giaddr 字段告诉服务器"该从哪个 subnet 的池子里挑地址"。没有中继就只有两个选择：每个网段本地一台 DHCP，或三层交换机上配 DHCP relay——拓扑决定方案，配置只是执行。

**内网出现第二台 DHCP 抢答。** 症状是同一台客户端时快时慢地换地址段、网关 DNS 跟着漂移，租约账本里出现"不属于你规划"的地址。家庭/实验室最常见的来源：路由器自带 DHCP 与你新起的服务器并存、虚拟化软件（VirtualBox/VMware host-only、libvirt 默认网络）给桥接段又架了一套。处置先取证后拆弹：两端同时抓 67/68 端口，看 Offer 各来自哪个 MAC，确认抢答者后关掉路由器内置 DHCP 或把 libvirt 网络改成 `forward dev=...` 的隔离模式，让每个广播域只有一个应答者——DORA 的第三步本来就靠广播"落选声明"，但它只协调协议内并发，管不住两套互不知情的配置。

**改了配置不生效。** 三步自查：`dhcpd -t` 是否真的跑过（语法红会直接起不来）；是否 `systemctl restart`（dhcpd 没有 reload 语义，改配置必须整进程重启）；客户端是否还攥着旧租约（租期未到不会重新 DORA，验证时手动 `dhclient -r && dhclient -v` 或断开重连）。与 BIND"改完必须 rndc reload"同一条纪律：配置生效链路上每一环都要亲眼看到绿灯。

## 参考资料

- ISC DHCP 官方文档 — [isc.org/dhcp](https://isc.org/dhcp/)
- Kea 官方文档（Kea ARM） — [kea.readthedocs.io](https://kea.readthedocs.io/)
- Arch Wiki: dhcpd — [wiki.archlinux.org/title/Dhcpd](https://wiki.archlinux.org/title/Dhcpd)
- 鸟哥的私房菜 - DHCP 服务器 — [linux.vbird.org](https://linux.vbird.org/linux_server/)
- man dhcpd.conf — 配置语法权威来源
- man dhcpd.leases — 租约文件格式
