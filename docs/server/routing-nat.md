# 路由器与 NAT

两台机器插进同一台交换机就能互 ping，中间隔了一台路由器，很多人第一次配就卡在"网关能通、外网不通"。本页把一台 Linux 主机真正变成路由器：打开内核转发、读懂并增删路由表、用 nftables 做源地址转换让私有网段上网、做端口映射把内网服务发布出去，最后按分跳法验证整条链路。假设你已经会给三系配静态地址并持久化（见[网络配置基础](../network/network-configuration.md)），本页专注"包在这台机器内部被如何转发、地址被如何改写"；防火墙策略的完整设计不在本页展开，见[安全篇](../security/firewall.md)。

> 内容参考自 nftables 官方 Wiki 与 Arch Wiki（概念框架参考鸟哥的私房菜），见文末参考资料。

## 学习目标

- 说清"同网段走 ARP、跨网段走网关"的分界，以及 `ip_forward` 在其中的角色
- 会判读 `ip route` 每一列，临时增删静态路由，并知道去哪里做持久化
- 理解 snat 与 masquerade 的取舍，独立写出一个可跑的 nftables NAT 网关配置
- 掌握 DNAT 端口映射及其转发放行，理解非对称路由为什么会断
- 按"网关 → 外网 IP → 域名"的分跳顺序定位 NAT 网关故障

## 1. 为什么需要一台路由器

### 1.1 同网段靠 ARP，跨网段靠路由

判断两个地址是否同网段，主机用自己的地址与前缀长度做一次按位与：目标落在网段内，先发 ARP 广播把目标 IP 解析成 MAC 地址，帧在二层直接投递；目标落在网段外，ARP 就无能为力了——广播出不了本网段，主机转而把包交给路由表指点的下一跳（next hop），这个"替你把包送出去的邻居"就是网关。整个决策流程可以画成一张图：

```text
本机发包决策
目标与本机同网段？ ──是──▶ ARP 解析目标 IP 的 MAC ──▶ 帧二层直投
        │否
        ▼
查路由表（最长前缀匹配，default 兜底）
        │
        ▼
ARP 解析"下一跳"的 MAC ──▶ 帧发给网关，IP 头里写的仍是最终目标地址
```

图里藏着一条对理解 NAT 至关重要的事实：**帧的二层地址逐跳改变，IP 头的三层地址端到端不变**——每一跳路由器只换 MAC、转口，不改 IP。NAT 是这条规则唯一的破坏者：它存在的目的就是改写三层地址（第 4 节）。网关本身没有任何魔法，它只是一台"愿意替别的机器做三层转发"的主机，而 Linux 出于安全默认拒绝这个角色：`net.ipv4.ip_forward = 0` 时，内核收到"目标 IP 不是本机"的包会直接丢弃。打开这个开关，主机才成为路由器——这是本页一切配置的第一步，也是"网关能 ping 通但客户端上不了网"排障清单里排第一位的检查项。

### 1.2 什么时候用 Linux 做路由

家用场景买个成品路由器最省事，但实验室里隔离一个测试网段、给虚拟化或容器环境做受控出口、在内网边界做发布与审计时，一台 Linux 网关比商用路由器透明得多：转发的每一步都能用 `ip`、`nft`、`tcpdump` 看见，策略就是几行文本配置，可版本化、可 diff。更实际的原因是——你早就在用 Linux 路由器了：Docker 的 bridge 网络、libvirt 的 default 网、Kubernetes 节点上的转发规则，本质都是"内核转发 + NAT 规则"的组合（见[容器页](./container/docker.md)）。在裸机上把这套机制手工搭一遍，是理解那些自动化工具在替你做什么的最短路径；出了问题也才知道往哪一层看。

## 2. 内核转发：从一台主机到一台路由器

### 2.1 临时打开

```bash
$ sudo sysctl -w net.ipv4.ip_forward=1
net.ipv4.ip_forward = 1
$ cat /proc/sys/net/ipv4/ip_forward
1
```

`/proc/sys/` 是内核参数的运行时真相：`sysctl -w` 改的就是它，验证也直接读它。要转发 IPv6 流量，对应开关是 `net.ipv6.conf.all.forwarding = 1`，与 IPv4 相互独立，双栈网关两个都要开。临时开关适合验证"转发是不是瓶颈"：客户端不通时先 `sysctl -w` 补一刀再测，通了就说明问题在配置缺失而不是链路——定位手段与结果本身同样有价值。

### 2.2 持久化（三系一致）

```text
# /etc/sysctl.d/30-forward.conf
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
```

```bash
$ sudo sysctl --system | grep forwarding
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
```

三系都由 systemd-sysctl 在开机时按序读取 `/etc/sysctl.d/`，这套写法跨发行版通用。要记住的对应关系是：`sysctl -w` 改"当下状态"，`/etc/sysctl.d/` 写"开机意图"——与 `systemctl start` 和 `enable` 的二元区分一模一样（见[系统服务管理](../basic/services/system_services.md)），只做前者忘了后者，就会出现"当场好了、重启还原"的经典事故。改完用 `sysctl --system` 应用并肉眼确认输出，重启后再 `cat /proc/sys/net/ipv4/ip_forward` 复验一次，两道都绿才算持久化完成。

## 3. 路由表判读与添加

### 3.1 读懂每一列

```bash
$ ip route show
default via 203.0.113.1 dev ens36 proto dhcp src 203.0.113.10 metric 100
192.168.56.0/24 dev ens33 proto kernel scope link src 192.168.56.1 metric 100
198.51.100.0/24 via 192.168.56.20 dev ens33 proto static metric 20
```

三行分别是三种最常见的路由来源。第一列是目标：`default`（即 `0.0.0.0/0`）是兜底，其它条目都不匹配时才走它；匹配遵循**最长前缀优先**，一条 /24 永远压过一条 /16，与默认路由无关。`via` 指下一跳地址，`dev` 指出口接口——`scope link` 标记的直连路由没有 `via`，因为目标就在本网段，ARP 后直接投递。`proto` 说明这条路由谁写的：`kernel` 是配地址时内核自动挂的直连路由，`dhcp` 是客户端学来的，`static` 是手工加的——排错时先用它判断"这条路由该不该存在、是谁放进来的"。`src` 是本机从该网段发包时优先选用的源地址，多地址场景下它解释了"为什么对端看到的 IP 是这个"；`metric` 是同目标多条路由时的优先级，数值小的先用。判读路由表是网关排错的基本功：客户端的包进不来或者出不去，先在这张表上走一遍"按目的地址查表会命中哪一条"，比抓包更快锁定配置层问题。每一列的排障含义汇总如下：

| 列 | 含义 | 排障时关注什么 |
|---|------|---------------|
| 目标前缀 | 匹配范围，`default` 即 0.0.0.0/0 | 与预期网段是否吻合；最长前缀优先 |
| via | 下一跳地址 | 直连路由没有此列，有 via 却不通先查下一跳可达性 |
| dev | 出口接口 | 是否与地址所在的网卡对得上 |
| proto | 谁安装的：kernel / dhcp / static | 该路由该不该存在、是谁放进来的 |
| scope | 作用域，`link` 为本链路 | link 范围内不跨路由，ARP 直投 |
| src | 发包优先源地址 | 多地址/NAT 场景解释"对端看到的是谁" |
| metric | 路由优先级，小者先用 | 同目标多条路由时谁在真正生效 |

### 3.2 增删静态路由

```bash
$ sudo ip route add 198.51.100.0/24 via 192.168.56.20 dev ens33
$ sudo ip route del 198.51.100.0/24
$ ip route get 198.51.100.8
198.51.100.8 via 192.168.56.20 dev ens33 src 192.168.56.1
```

`ip route get` 是被低估的排错利器：它回答"发往这个地址的包会从哪个口、交给谁、用什么源地址发出去"，把最长前缀匹配的结果直接摊开。对网关上"这个网段怎么走"的疑问，先 `get` 再 `show`，比对着整表人肉匹配快得多。改默认网关有一个专用技巧值得单独记：`add` 遇到已存在的 default 会报 `File exists`，用 `ip route replace default via 新网关 dev ens36` 一步完成"删旧加新"，避免两条命令之间出现无默认路由的空窗——切网关的那一刻恰恰最怕空窗。

```bash
$ sudo ip route replace default via 203.0.113.254 dev ens36
```

注意 `ip route add` 同样只改运行时，重启即失；持久化要写进所属发行版的网络配置体系——Netplan、NetworkManager 或 systemd-networkd 的写法在[网络配置基础](../network/network-configuration.md)第 4 节有三系对照，本页不重复。

### 3.3 策略路由：按"谁发的"选表

传统路由只看目的地址；要让"来自不同源、去同一目的地"的包走不同出口，就需要策略路由。`main` 其实只是编号 254 的一张普通表，内核真正的查表顺序由 `ip rule` 策略列表决定，按优先级从小到大匹配：

```bash
$ echo '100 second' | sudo tee -a /etc/iproute2/rt_tables
$ sudo ip route add default via 198.51.100.1 dev ens37 table second
$ sudo ip rule add from 192.168.57.0/24 lookup second priority 100
$ ip rule show
0:	from all lookup local
100:	from 192.168.57.0/24 lookup second
32766:	from all lookup main
32767:	from all lookup default
```

这个例子让 192.168.57.0/24 的流量查 `second` 表（走 ens37 出口），其余流量照旧查 `main`。两个易错点提前记下：策略的 `priority` 必须小于 32766，否则排在查 `main` 之后永远轮不到；`second` 表里必须有完整可用的路由（至少一条 default），空表等于把该来源的流量引进黑洞。另外 `ip rule` 与自定义表的内容都不落盘，重启即失——要么写进网卡配置体系，要么自建 systemd 单元在开机时执行这两条命令，属于"当下状态 vs 开机意图"的又一处翻版。

## 4. NAT：私有地址如何上网

### 4.1 NAT 在内核里改了什么

RFC 1918 私有地址（如 192.168.0.0/16）在公网不可路由，内网主机的包想上公网，出口网关必须在 postrouting 阶段把源地址改写成自己的外网口地址，同时在 conntrack 表登记这条映射；回包进入内核时按登记反向还原，再转给内网主机。所以 NAT 从来不是独立功能，它的两个前提是转发已开（第 2 节）与连接跟踪在工作——理解这一点，"转发开了还是上不了网"的第一怀疑对象自然就是"还没配 NAT"，而不是去重启什么服务。dnat 则是镜像操作：prerouting 阶段改写目的地址，用于把外网口上的端口映射给内网服务器。一次 masquerade 的完整往返如下：

```text
请求  192.168.56.50:51728 ──▶ 网关 ens33 收包 ──▶ postrouting 改 src ──▶ 203.0.113.10:51728 ──▶ 公网服务器
回包  93.184.216.34:443    ──▶ 网关 ens36 收包 ──▶ conntrack 查到映射 ──▶ dst 还原为 192.168.56.50 ──▶ 原客户端
```

注意回包方向内核做的事：目的地址被"还原"回内网——这不是查配置文件，而是查 conntrack 登记簿。于是推论也很直接：conntrack 记录丢了（表满被挤出、重启、或压根没开转发），回包就找不到登记，直通的只会是"有去无回"。

### 4.2 snat 与 masquerade 的取舍

| 项 | snat | masquerade |
|---|------|-----------|
| 改写后的源地址 | 配置里写死的地址 | 每次取出口接口的当前地址 |
| 适用外网口地址 | 静态、长期稳定 | DHCP / PPPoE 动态获取 |
| 典型场景 | 机房固定公网 IP | 家宽、实验室、云主机弹性 IP |

两者的规则语义完全同构，选择只看外网口地址是否固定：固定地址用 snat 省去每次查接口地址的开销；动态地址必须用 masquerade，否则地址一变规则就成了"改写成旧地址"的错误配置。snat 还支持写一段地址池做简易负载分担（`snat ip to 203.0.113.10-203.0.113.12`），公网 IP 富余时是免设备的出口扩容手段。家宽与实验室环境几乎总是 masquerade——本页后续示例也以它为准。顺带一个常被问到的事实：masquerade 改源地址时会尽量保留原始源端口，只在冲突时才重新分配——所以"内网两台机器恰好用同一源端口访问同一目标"并不罕见，conntrack 会处理好，无需人为干预。

### 4.3 完整可跑的网关配置

场景设定：ens33 是内网口，地址 192.168.56.1/24，内网客户端（如 192.168.56.50）把它当网关；ens36 是外网口，DHCP 动态获取地址与默认路由。目标有二：内网整段能上网；外网口 8080 端口映射给内网 Web 服务器 192.168.56.20 的 80 端口。拓扑如下：

```text
  内网客户端                Linux 网关（本页主角）               公网
┌─────────────┐      ┌───────────────────────────┐
│ 192.168.56.50│      │ ens33: 192.168.56.1/24    │      ┌──────────────┐
│  gw → .1     │──────│                           │──────│ 任意目标      │
└─────────────┘      │ ens36: DHCP（如 203.0.113.10）│      └──────────────┘
┌─────────────┐      │ 职责：转发 + masquerade +  │
│ Web 服务器    │──────│ 8080→.20:80 端口映射       │
│ 192.168.56.20│      └───────────────────────────┘
└─────────────┘
```

```text
#!/usr/sbin/nft -f
# /etc/nftables.conf —— 内网 192.168.56.0/24 出 ens36 上网 + 8080 映射到内网 Web

flush ruleset

table inet filter {
    chain input {
        type filter hook input priority filter; policy accept;
        iifname "lo" accept
        ip protocol icmp accept
        tcp dport 22 accept                                # 运维 SSH，先放行再收紧
    }
    chain forward {
        type filter hook forward priority filter; policy drop;
        ct state established,related accept                # 回包与关联流放行
        ip saddr 192.168.56.0/24 oifname "ens36" accept    # 内网出口
        iifname "ens36" ip daddr 192.168.56.20 \
            tcp dport 80 accept                            # DNAT 目标的入站白名单
    }
}

table inet nat {
    chain prerouting {
        type nat hook prerouting priority dstnat; policy accept;
        iifname "ens36" tcp dport 8080 dnat ip to 192.168.56.20:80
    }
    chain postrouting {
        type nat hook postrouting priority srcnat; policy accept;
        ip saddr 192.168.56.0/24 oifname "ens36" masquerade
    }
}
```

```bash
$ sudo nft -c -f /etc/nftables.conf    # 语法检查，不生效
$ sudo nft -f /etc/nftables.conf       # 确认无误后载入
$ sudo nft list ruleset                # 验证内核里的完整规则
```

几个事实先说清：inet 族里写 NAT 需要 kernel 4.18 以上，三系现行版本都远超，老内核才需要退回 `table ip nat`；DNAT 只改目的地址，转发放行是 forward 链的职责——上例 forward 里那条 `ip daddr 192.168.56.20 tcp dport 80 accept` 就是给映射流量开的门，漏了它会出现"外口 SYN 到了、conntrack 有记录、Web 服务器毫无动静"的典型断链。改配置的纪律是先 `nft -c` 再载入，与 DNS 页先 `named-checkconf` 再 `rndc reload` 是同一条纪律：语法错误拦在生效之前，永远比"半死不活再回滚"便宜。最后一句重要提醒：**装了 Docker 的机器慎用 `flush ruleset`**——它会把 Docker 依赖的链一并清掉，容器网络当场断掉，这种机器请逐表逐链增删（见[容器页](./container/docker.md)）。

### 4.4 三系安装与启用

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 | `apt install nftables` | `sudo pacman -S nftables` | `dnf install nftables` |
| 搜索 | `apt search nftables` | `pacman -Ss nftables` | `dnf search nftables` |
| 查看包信息 | `apt show nftables` | `pacman -Qi nftables` | `dnf info nftables` |
| 查看文件列表 | `dpkg -L nftables` | `pacman -Ql nftables` | `rpm -ql nftables` |
| 升级 | `apt upgrade` | `sudo pacman -Syu` | `dnf upgrade` |
| 卸载 | `apt remove nftables` | `sudo pacman -R nftables` | `dnf remove nftables` |
| 连接跟踪工具 | `apt install conntrack` | `pacman -S conntrack-tools` | `dnf install conntrack-tools` |

三系的包名与服务单元完全一致：包叫 `nftables`，配置都在 `/etc/nftables.conf`，服务都是 `nftables.service`——`sudo systemctl enable --now nftables` 后开机自动载入这份文件。唯一要注意的是 RHEL 系默认装着 firewalld，它自己管理一套 nftables 表：**两套防火墙二选一**，要么继续用 `firewall-cmd` 管策略（别手写 nft），要么 `systemctl disable --now firewalld` 后接管 `/etc/nftables.conf`，混管的结局是两边互相看不见对方的规则，排障时谁也说不清哪条在生效。

### 4.5 iptables-nft 兼容层

三系的 `iptables` 命令如今默认走 iptables-nft 后端，规则最终进同一个内核 nftables 引擎，`nft list ruleset` 里能看到它们变成的链。所以老教程里的 `iptables -t nat -A POSTROUTING -j MASQUERADE` 照抄能用；但两套语法混管同一张表，很快就说不清"这条规则谁加的、归谁删"，新配置建议直接用 nft 原生语法，把 iptables 只当作读老资料的翻译层。

## 5. 防火墙最小基线

上例 forward 链的骨架就是服务器网关的最小可用基线：`policy drop` 默认拒绝，放行 `ct state established,related`（先让回包能进），放行内网出口（出站信任内网），需要发布的服务逐条白名单（如 DNAT 目标那一条）。这个"默认拒绝、按需开口"的形状适用于任何网关，差别只在条目多少。zone 模型、富规则、日志与限速这些策略设计层面的内容在[安全篇](../security/firewall.md)有完整展开，本页不再重复——先把转发与 NAT 的机制跑通，策略自然知道往哪加。

## 6. 验证与排错

### 6.1 客户端分跳验证

```bash
$ ping -c3 192.168.56.1        # 第一跳：网关内网口，验证二层与地址
$ ping -c3 223.5.5.5           # 第二跳：公网 IP，绕开 DNS 验证转发+MASQUERADE
$ dig example.com @223.5.5.5   # 第三跳：域名，验证 DNS 可用
```

三跳各排除一层：第一跳不通，问题在客户端自身配置或交换机；第一跳通、第二跳不通，问题锁定在网关（转发、NAT、forward 放行三选一）；第二跳通、第三跳不通，只剩 DNS——检查客户端 `/etc/resolv.conf` 是否拿到可用的 nameserver（内网客户端的地址与 DNS 统一下发属于 DHCP 服务器的职责，见服务器篇 DHCP 一章）。这套分跳法与[网络故障排除](../network/troubleshooting.md)的方法论同源，只是把"本机 → 网关"细化到了 NAT 网关内部。汇总成速查表：

| 现象 | 断在哪层 | 下一步 |
|------|---------|--------|
| ping 网关不通 | 客户端地址/二层链路 | 核对地址前缀、网卡与交换机/虚拟网络 |
| 通网关、不通公网 IP | 网关转发/NAT/放行 | 按 6.2 → 6.3 → 6.4 逐层看 |
| 通公网 IP、dig 不通 | DNS | 客户端 resolv.conf 与 DNS 下发 |
| 时通时不通、高峰断流 | conntrack 容量 | 见常见坑最后一条 |

### 6.2 网关侧验证

```bash
$ cat /proc/sys/net/ipv4/ip_forward
1
$ sudo nft list table inet nat
table inet nat {
	chain prerouting {
		type nat hook prerouting priority dstnat; policy accept;
		iifname "ens36" tcp dport 8080 dnat ip to 192.168.56.20:80
	}
	chain postrouting {
		type nat hook postrouting priority srcnat; policy accept;
		ip saddr 192.168.56.0/24 oifname "ens36" masquerade
	}
}
```

网关侧按"开关 → 规则 → 生效痕迹"三层验：`ip_forward` 是 1 吗；`nft list ruleset` 里 nat 表在吗、字面与预期一致吗（`nft -f` 载入成功只说明语法对，不说明内容是你想要的那份）；最后看第 6.3 节的 conntrack，确认改写真的在发生。

### 6.3 conntrack：确认改写在发生

```bash
$ sudo conntrack -L -p tcp --dport 443
ipv4 2 tcp      6 431872 ESTABLISHED \
        src=192.168.56.50 dst=93.184.216.34 sport=51728 dport=443 \
        src=93.184.216.34 dst=203.0.113.10 sport=443 dport=51728 [ASSURED] mark=0 use=2
```

一条 conntrack 记录分两半读：前半段是请求方向（内网 192.168.56.50 发起），后半段是内核期待的应答方向——注意应答的目标已经被改成了外网口地址 203.0.113.10，这正是 masquerade 命中的直接证据；`[ASSURED]` 表示双向都通过包。客户端"上不了网"时在网关上跑 `conntrack -L`，有前半没后半说明回包没进来（出口或对端问题），一条记录都没有说明包根本没被转发（转发或 forward 放行问题）。没装 conntrack 工具时，`sudo cat /proc/net/nf_conntrack` 输出同构，只是没有过滤参数。

### 6.4 tcpdump 看包的去向

```bash
$ sudo tcpdump -ni any icmp or tcp port 8080
```

最后的手段是抓包：`-n` 关掉域名反解（否则每个包都触发一次 DNS，越抓越乱），`-i any` 同时看两个口。"SYN 有去无回"是最高频的观测结果，对应三种病因：forward 没放行（包进了内核就被丢，conntrack 无记录）、masquerade 没配（包出去了但回包找不到家）、非对称路由（回包从别的路走了，见下节）。tcpdump 的用法在[网络工具命令](../commands/network/network-tools.md)有整页展开。

### 6.5 最小实验环境：两台虚机跟跑

本页所有配置都可以在笔记本上复现，拓扑只需要两台虚机：gw 一块 NAT 网卡（外网口，DHCP 拿地址）加一块 Host-Only 网卡（内网口，手工 192.168.56.1/24）；client 只挂 Host-Only 网卡。VirtualBox 与 libvirt 的 default 网都天然提供这样一个与宿主机隔离的网段，云上等价物是 VPC 私网段 + 一台双网卡实例。gw 侧做完第 2、4 节后，client 侧三条命令即可开始第 6 节的分跳验证：

```bash
# client 侧（三系通用，均为临时配置，重启即失——正好便于反复实验）
$ sudo ip addr add 192.168.56.50/24 dev ens3
$ sudo ip route add default via 192.168.56.1
$ echo 'nameserver 223.5.5.5' | sudo tee /etc/resolv.conf
```

实验顺序建议：先只做第 2 节（开转发）验证"仍上不了网"，再补 masquerade 看"通了"，最后故意删掉 forward 放行那条规则看"又断了"——三次断/通把转发、NAT、放行三层各自的因果钉死，比一次配齐更有教学价值。改完每个状态都在 client 上跑一遍三跳、在 gw 上看一眼 conntrack，把"现象 → 层 → 证据"的对应关系亲手建立起来。

## 7. 常见坑

**转发开了但客户端仍上不了网——忘配 masquerade 或 DNS。** 最高频的两大根因。用 6.1 的分跳法拆开：ping 公网 IP 通而 dig 不通是 DNS，客户端 resolv.conf 里没有可用 nameserver；ping 公网 IP 不通而 ping 网关通，才是 NAT 层——`nft list table inet nat` 看规则在不在，`conntrack -L` 看改写有没有发生。两个症状混在一起时，永远先用"公网 IP + dig @公网DNS"把变量隔离开。

**策略路由不生效——rule 忘加或优先级不对。** `ip rule show` 里策略排在 32766（查 main 表）之后永远轮不到执行，priority 必须比它小；规则加了但 `second` 表是空的，流量直接进黑洞——`ip route show table second` 必须与 `ip rule show` 成对检查，缺一不可。还要记得 rule 与表内容都不落盘，重启即失，验证时机放在重启之后而不是配置当时。

**DNAT 通了但回包走默认路由——非对称路由。** 外网访问映射端口正常，说明 DNAT、放行都对；此时若内网服务器访问另一个外部目标异常，或换一批客户端就不通，先查内网服务器的默认网关是不是这台 Linux 网关——回包若走了别的出口，源地址对不上 conntrack 映射，被静默丢弃。抓包特征是"去程两跳都在、回程只在服务器侧出现"。另一个变体是发夹场景：内网客户端直接访问外网口地址的 8080，DNAT 后服务器回包直达客户端（同网段不走网关），源地址不是客户端期待的外网口 IP——需要为这类流量补一条内网口方向的 masquerade。

**重启后转发丢失——sysctl 没持久化。** `sysctl -w` 只改运行时，当场验证通过不等于重启后还在。写进 `/etc/sysctl.d/` 后 `sysctl --system` 看输出确认，重启后再 `cat /proc/sys/net/ipv4/ip_forward` 复验——"改当下"与"改开机"是两件事，这坑与 systemctl 只 start 不 enable 完全同构。

**nft 规则重启消失——没 enable nftables.service。** `nft -f` 载入的规则只存在于内存里的规则集，重启即清空。规则写在 `/etc/nftables.conf` 并 `systemctl enable --now nftables` 才会开机载入；部署完当场 `nft list ruleset` 验证的是"现在对"，重启后再验一次才是"一直对"。

**conntrack 表满，高并发时段批量断流。** `dmesg` 里出现 `nf_conntrack: table full, dropping packet` 就是它：每条连接占一条跟踪记录，表满后新连接被丢。网关类机器先用 `sysctl net.netfilter.nf_conntrack_max` 看上限，按连接规模调大并在 `/etc/sysctl.d/` 持久化；同时核对 `net.netfilter.nf_conntrack_buckets`（哈希桶数）。这个坑的特点是"低峰一切正常、压测或业务高峰才炸"，排障时要把时间维度算进去。

## 参考资料

- nftables 官方 Wiki — [wiki.nftables.org](https://wiki.nftables.org/)
- Arch Wiki: nftables — [wiki.archlinux.org/title/nftables](https://wiki.archlinux.org/title/nftables)
- Arch Wiki: Router — [wiki.archlinux.org/title/Router](https://wiki.archlinux.org/title/Router)
- 鸟哥的私房菜 — 路由器与 NAT — [linux.vbird.org](https://linux.vbird.org/linux_server/)
- man ip-route（路由表操作）/ man ip-rule（策略路由）/ man sysctl.d（内核参数持久化）
