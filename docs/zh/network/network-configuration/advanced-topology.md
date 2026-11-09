# 绑定、VLAN 与性能调优

> 本文属于[网络配置基础](../network-configuration.md)——
> 高级拓扑（bonding、VLAN）、
> 内核与接口调优，
> 以及容器/虚拟网络与本篇的边界。

## 网卡绑定（bonding）

绑定把多块物理网卡
聚合成一个逻辑接口，
目标是**冗余**或**带宽叠加**。
最常用的 `active-backup` 模式
提供主备切换：
主网卡故障时流量自动切到备卡，
对上层完全无感。

```bash
sudo modprobe bonding

# Debian/Ubuntu 的 /etc/network/interfaces 片段
auto bond0
iface bond0 inet static
    address 192.168.1.100
    netmask 255.255.255.0
    gateway 192.168.1.1
    bond-slaves eth0 eth1
    bond-mode active-backup
    bond-miimon 100
```

`bond-miimon 100`
表示每 100ms 检测一次链路状态，
是切换速度与开销的平衡点。
查看绑定状态：

```bash
$ cat /proc/net/bonding/bond0
Ethernet Channel Bonding Driver: v5.15.0
Bonding Mode: fault-tolerance (active-backup)
Primary Slave: eth0
Currently Active Slave: eth0
```

`Currently Active Slave`
直接告诉你流量正走哪根线，
割接与排障时经常需要确认
它是否如预期切换。
bonding 与 team（`teamd`）、
网桥（bridge）概念不同：
bond 在链路层聚合，
bridge 连接多个 L2 域
（容器/虚拟机场景），
team 已逐渐被 bonding 与
SwitchDev 取代，
新项目不必优先选 team。

bonding 与交换机侧的配合也要对齐：
`active-backup` 对交换机无特殊要求，
而 `802.3ad`（LACP）
要求对端交换机开启链路聚合，
否则两根线只有一根通——
症状是"绑定了却只看到一张卡有流量"。
换模式前先确认对端能力，
比在 Linux 侧反复调参有用。

## VLAN

VLAN 在一根物理链路上
划分多个广播域，
交换机侧需配置 trunk。
Linux 侧创建子接口即可加入指定 VLAN：

```bash
sudo modprobe 8021q
sudo ip link add link eth0 name eth0.100 type vlan id 100
sudo ip addr add 192.168.100.1/24 dev eth0.100
sudo ip link set eth0.100 up
```

命名习惯是 `父接口.VLAN-ID`
（如 `eth0.100`），
便于一眼看出归属。
持久化方式同样随管理器变化：
Netplan 用 `vlans:` 段，
networkd 用 `.netdev` 文件加 `[VLAN]`，
`nmcli` 则 `type vlan` 创建连接。

**VLAN ID 必须与交换机侧一致**，
否则子接口虽 `UP`
却收不到任何帧——
症状与网线未插类似，
可用 `tcpdump -i eth0 -e vlan`
观察帧是否带预期的 tag。
多 VLAN 环境还要注意
父接口本身通常不配 IP，
地址全部挂在子接口上，
避免"父接口地址与 VLAN 地址冲突"
的隐性路由问题。

## 内核参数

调优前务必先量化问题——
`ss -s` 看连接数，
`nstat` 看 TCP 错误计数，
再决定改哪个参数。
盲目抄写"优化模板"
往往适得其反，
因为缓冲区放大也会推高内存占用：

```bash
# /etc/sysctl.d/99-network.conf
# 示例，按业务压测结果调整
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_tw_reuse = 1
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
```

用独立文件放在
`/etc/sysctl.d/` 下，
比直接追加 `/etc/sysctl.conf`
更易管理与回滚。
应用改动执行 `sudo sysctl --system` 即可。

`tcp_fin_timeout` 与 `tcp_tw_reuse`
只影响主动关闭连接的回收节奏，
对被大量 TIME_WAIT 困扰的
代理类服务有帮助；
但在 NAT 后面的客户端主机上，
盲目开启复用可能撞上
还在 TIME_WAIT 的旧连接，
需结合具体场景评估。
**没有压测数据支撑的调优，
一律视为猜测**。

调优顺序建议是：
先确认问题指标（丢包、握手失败、队列溢出），
再选对应参数，
改完复测同一指标。
一次性改十个参数，
即使症状消失也无法归因，
下次故障还会再来一遍。

## 接口参数

```bash
# 查看当前协商结果
$ ethtool eth0
Settings for eth0:
    Speed: 1000Mb/s
    Duplex: Full
    Auto-negotiation: on

# 查看/调整 Ring Buffer（丢包排查时常用）
$ sudo ethtool -G eth0 rx 4096 tx 4096
```

现代网卡与交换机
**强烈建议保持自协商**，
手动强制 `speed 1000 duplex full`
反而可能造成双工不匹配与间歇丢包——
这种问题的典型特征是
"小流量正常、大流量丢包"，
极难凭感觉定位，
`ethtool -S eth0`
里的错误计数器才是证据。

Ring Buffer 偏小会在高 PPS 场景下丢包，
`ip -s link` 的 `drop`
计数是第一证据；
调整后再观察计数是否停止增长，
形成"测量—调整—复测"的闭环。
改完记得写进 networkd 的
`.link` 文件或 udev 规则，
否则重启后又回到默认值。

## 容器与虚拟网络的边界

容器网络常常被误当成"另一套网络"，
其实它复用的仍是本篇讲过的全部原语：
veth 对、网桥、路由、NAT，
只是多封装了一层运行时自动管理。
理解这一点之后，
排障思路可以直接迁移，
不必在容器世界里重新发明一套方法论。

Docker 默认创建
`docker0` 网桥并为每个容器
挂一对 veth 端点，
容器出口地址经 MASQUERADE 转换。
当你看到容器"能上外网、宿主机访问不到容器端口"，
九成是发布端口（port mapping）
与网桥路由混为一谈：
前者是 DNAT，
后者是容器网段的可达性，
两者解决的问题不同，
排查路径也不同。

Kubernetes 的情形类似，
只是把静态的 docker0
换成了按 CNI 动态创建的网桥与路由规则。
无论上层编排多复杂，
回到内核视角永远只有
"谁创建了接口、谁写了路由、谁做了 NAT"。
所以[路由配置](routing.md)的路由知识
在容器场景里不仅适用，
而且是定位跨节点 Service 不通时的唯一可靠线索——
先 `ip route` 确认封装网段怎么走，
再查 iptables/nft 的转发规则，
最后才怀疑应用端口。

虚拟机网络则多一层虚拟交换机，
宿主机上的 `vnet` 接口
与虚拟机内部网卡通过桥接或 NAT 相连。
迁移虚拟机、克隆模板之后，
MAC 地址漂移、
桥接网卡选错、
宿主机防火墙误伤转发路径，
都是高发问题。
判断顺序依然是同一套：
先看宿主机侧接口与桥的状态，
再看虚拟机内部配置，
最后用抓包确认包究竟丢在宿主机还是客户机——
分层取证的纪律在虚拟化场景里同样成立。
