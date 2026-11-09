# 网络配置基础

给 Linux 机器配一个能用的 IP，
看似是入门操作，
实际却横跨四套互不相同的配置体系：
Netplan、systemd-networkd、
NetworkManager（`nmcli`）、传统 ifcfg 脚本。
选错体系、改错文件、
重启后配置"消失"，
几乎都源于同一个原因——
**不清楚当前到底由谁在管理网卡**。

本页先讲清这套选型逻辑，
再对照三发行版给出可落地的配置方法，
最后把 DNS 解析这条最容易被忽视的链路
完整走一遍。
本页按"先回答：谁在管理你的网卡 →
查看当前网络状态 → 永久配置：三系对照 →
路由配置 → DNS 配置与解析路径 →
Bonding 与 VLAN → 网络性能调优 →
实战案例 → 常见坑 →
容器与虚拟网络的边界 →
与本篇其他页的关系"展开。

> 内容参考自 Netplan、systemd-networkd、
> NetworkManager 官方手册与 Arch Wiki，
> 见文末参考资料。

## 本篇覆盖

- 判断一台机器当前由哪个网络管理器接管，
  避免多套体系打架
- Netplan、systemd-networkd、
  `nmcli`、ifcfg 四种配置方式的适用场景
- DNS 从 `getaddrinfo()`
  到 `/etc/resolv.conf` 的完整解析路径
- 会配置静态地址、路由、bonding、VLAN
  与基础内核调优
- 认识配置管理中的高频坑
  （重启丢失、resolv.conf 被覆盖、
  route cache 幻觉）

全篇拆为六个子页；可以按顺序读，
也可以直接跳到需要的那一篇：

1. [谁在管理你的网卡](network-configuration/manager-detection.md)——
   三发行版的管理者识别，
   与用 `ip` 查看当前状态
2. [持久配置：三系对照](network-configuration/persistent-config.md)——
   Netplan、systemd-networkd、`nmcli` 与遗留 ifcfg
3. [路由配置](network-configuration/routing.md)——
   读懂 `ip route`、添加并持久化路由、
   主表与策略路由
4. [DNS 配置与解析路径](network-configuration/dns.md)——
   从 `getaddrinfo()` 到 `resolv.conf` 的完整链路，
   以及怎么改 DNS 才不会被覆盖
5. [绑定、VLAN 与性能调优](network-configuration/advanced-topology.md)——
   高级拓扑、内核/接口调优、
   容器与虚拟网络的边界
6. [实战案例与常见坑](network-configuration/troubleshooting-playbook.md)——
   一键诊断脚本、迁移检查清单、
   经典故障形态

## 与本篇其他页的关系

配置只解决"地址对不对"，
不保证"通不通"。
配置完成后若仍有问题，请转向：

- 分层推理定位：
  [网络故障排除](./troubleshooting.md)
- 规则是否拦截：
  [防火墙](./firewall.md)
- 分层模型与命令语义回顾：
  [网络基础](./basics.md)

三者构成"配置 → 连通 → 边界"的完整闭环，
缺一环都会让排障陷入循环猜测。
先确认地址与路由（本篇），
再确认路径与解析（排障页），
最后确认策略（防火墙页）——
顺序反过来，就会长时间在错误的层里打转。

这三页的共同方法可以概括成一句话：
**先证明内核里发生了什么，
再讨论应用为什么没响应**。
配置篇记录读地址与路由的事实，
排障页记录读包与连接的事实，
防火墙页记录读丢包决策的事实——
三者拼起来，
才构成对"网络"这一层完整的观察力。
缺少其中任何一页，
你的视角都会出现一块固定的盲区，
而故障恰好最爱藏在盲区里。

## 参考资料

配置类文档的通病是"看完就忘"，
因为缺少与真实机器的对照。
建议每读完一个子页，
就在一台测试机上完整跑一遍该子页命令，
把输出与文中示例并排比较：
一致说明理解到位，
不一致则正好把差异追下去。
差异往往比一致更有教学价值——
它要么指向发行版差异，
要么指向你机器上多出来的管理器，
两者都会在后续运维中反复出现。
把差异记录进自己的环境笔记，
半年后你会得到一份
比任何通用文档都准确的"这台机器怎么组网"的记录。

- Netplan 官方文档 — [netplan.readthedocs.io](https://netplan.readthedocs.io/)
- systemd.network(5)、networkctl(1)、
  systemd-resolved.service(8)
- Arch Wiki - systemd-networkd — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd-networkd)
- Arch Wiki - Network configuration — [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration)
- NetworkManager 手册 — [networkmanager.dev](https://networkmanager.dev/docs/)
- RHEL 9 配置与管理网络 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_networking/)
- 鸟哥的私房菜 - 网络配置 — [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0110network_basic.php)
- `man ip`、`man nmcli`、`man netplan`、
  `man sysctl`、`man ethtool`

<!-- BACKLINKS-AUTO -->
## 相关页面

- [configuration-management](/zh/commands/system/configuration-management.md)
- [system_info](/zh/commands/system/system_info.md)
- [network](/zh/hardware/network.md)
- [README](README.md)
- [basics](basics.md)
- [commands-practice](commands-practice.md)
- [tcpip-essentials](tcpip-essentials.md)
- [troubleshooting](troubleshooting.md)
- [coverage-matrix](/zh/research/coverage-matrix.md)
- [dhcp](/zh/server/dhcp.md)
- [network-parameters](/zh/server/network-parameters.md)
- [routing-nat](/zh/server/routing-nat.md)
- [network-stack](/zh/source/network-stack.md)
