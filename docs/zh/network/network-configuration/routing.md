# 路由配置

> 本文属于[网络配置基础](../network-configuration.md)——
> 路由的查看、添加与持久化。
> 静态地址先行，见
> [持久配置：三系对照](persistent-config.md)。

## 查看与解读

```bash
$ ip route show
default via 192.168.1.1 dev eth0 proto dhcp src 192.168.1.100 metric 100
10.0.0.0/24 via 192.168.1.254 dev eth0
192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.100 metric 100

# 查询特定目标的出口
$ ip route get 10.0.0.5
10.0.0.5 via 192.168.1.254 dev eth0 src 192.168.1.100 uid 0
```

`proto dhcp`
表示该条目由 DHCP 下发，
`proto kernel`
表示内核在配置地址时
自动生成的直连路由。
手工添加的静态路由通常显示
`proto static`，
便于与动态条目区分。
**旧文档里的 `ip route show cache`
已失效**——
Linux 4.x 之后取消了路由缓存，
该命令无输出属正常，
判断转发性能应看连接跟踪与 neigh 表，
而不是"路由缓存"。
这篇文档的老版本若还留着这条命令，
照抄只会让你怀疑人生。

## 添加与持久化

临时添加立即生效但不持久：

```bash
sudo ip route add 10.0.0.0/24 via 192.168.1.254
sudo ip route del 10.0.0.0/24
```

持久化方式随管理器而变，
这也是三系差异最明显的地方：

```bash
# Netplan（Ubuntu）
# routes: [{to: 10.0.0.0/24, via: 192.168.1.254}]

# systemd-networkd
# [Route]
# Destination=10.0.0.0/24
# Gateway=192.168.1.254

# NetworkManager（nmcli）
$ sudo nmcli connection modify office \
    +ipv4.routes "10.0.0.0/24 192.168.1.254"

# 遗留 ifcfg：/etc/sysconfig/network-scripts/route-eth0
10.0.0.0/24 via 192.168.1.254
```

生产环境中，
静态路由更推荐通过管理器下发
而非写进 `rc.local`——
管理器会在链路抖动时按需重放路由，
`rc.local` 只在开机执行一次，
接口重连后路由可能消失。
"多网段互通却偶发性中断"
的排查里，
这类一次性脚本是常客。

添加路由时还要分清
**主路由与策略路由**：
普通 `ip route add`
进的是主表，
多租户、多出口场景
会用到 `ip rule` 与自定义表
（`table 100` 之类）。
日常单网关服务器用不到后者，
但看到
`ip rule show`
输出里有 `from all lookup main`
以外的条目时，
说明这台机器做了策略路由，
排障就不能只看主表了。

在这些路由之上搭完整 NAT 与转发见
[路由与 NAT](../../server/routing-nat.md)；
在刚验证过的路径上跑名字解析是下一步的
[DNS 配置与解析路径](dns.md)。
