# 谁在管理你的网卡

> 本文属于[网络配置基础](../network-configuration.md)——
> 覆盖管理者识别与当前状态查看。
> 如何把改动固化为持久配置见
> [持久配置：三系对照](persistent-config.md)。

在编辑任何配置文件之前，
先确认当前的管理者。
这一步能避免"改了 A 却被 B 覆盖"
的经典事故：

```bash
# 是否运行 NetworkManager
$ systemctl is-active NetworkManager
active

# 是否运行 systemd-networkd
$ systemctl is-active systemd-networkd
active

# Ubuntu 上是否用 Netplan
$ ls /etc/netplan/
00-installer-config.yaml
```

两个管理器同时 `active` 是危险状态：
NetworkManager 与 systemd-networkd
都会写地址和 `resolv.conf`，
后写者覆盖先写者，
重启后结果取决于 systemd 启动顺序，
表现为"偶发性配置回滚"。
判断谁真正持有设备，
再看 `nmcli device status`
与 `networkctl status` 的输出即可分辨。

三发行版的默认格局大致如下，
这是选型的出发点：

| 发行版 | 默认管理者 | 配置入口 | 备注 |
|--------|-----------|----------|------|
| Debian/Ubuntu | NetworkManager（桌面）或 systemd-networkd（服务器） | Netplan（`/etc/netplan/*.yaml`） | Netplan 生成配置后交给 NM 或 networkd 后端 |
| Arch | 多为 systemd-networkd 或 NetworkManager | `/etc/systemd/network/*.network` 或 `nmcli` | 无统一前端，取决于安装时选择的组件 |
| RHEL/CentOS/Rocky 9+ | NetworkManager | `nmcli` 或 keyfile | `network-scripts`（ifcfg）已移除，仅历史版本保留 |

**Netplan 不是管理器，而是翻译层**。
它读取 YAML，
渲染成 NetworkManager 或 systemd-networkd
能理解的后端配置。
因此在 Ubuntu 上编辑
`/etc/netplan/*.yaml`
后必须执行 `sudo netplan apply`，
改动才会生效；
直接去改后端文件则可能在下次
`netplan apply` 时被覆盖。
理解这层关系，
就不会再纠结"我到底该改哪个文件"。

选型可以先记三条经验法则。

**桌面与移动场景选 NetworkManager**。
它处理 Wi-Fi、VPN、漫游与连接优先级
最成熟，桌面发行版默认就是它。
**无头服务器选 systemd-networkd**。
依赖少、启动早、与 systemd 生态贴合，
容器宿主机尤其合适。
**存量 RHEL 一律用 `nmcli`**。
9 之后 ifcfg 已移除，
继续照老文档改
`/etc/sysconfig/network-scripts/`
只会得到"改了没反应"。

判断当前格局，
换新机器时先跑一遍本节开头的检测命令再动手——
输出里谁是 `active`、
谁列出了你的网卡，
谁就是实际管理者：
**以输出为准，不以发行版印象为准**。

## 查看当前网络状态

无论用哪套体系，
观测命令都是同一套——
`ip` 来自 `iproute2`，
三大发行版通用
（Arch 下用 `pacman -S iproute2`
安装或升级，
Debian/Ubuntu 用 `apt install iproute2`，
RHEL 系用 `dnf install iproute`，
通常默认已存在）。

```bash
# 查看所有接口的链路状态
$ ip link show
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 ...
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 ...

# 查看地址（含前缀长度）
$ ip -br addr
lo   UNKNOWN 127.0.0.1/8 ::1/128
eth0 UP      192.168.1.100/24 fe80::216:3eff:fe12:3456/64
```

`ip link` 的 `state` 字段容易误读：
`UP` 表示管理状态开启，
`LOWER_UP` 表示已检测到载波（网线插好）。
虚拟接口或未插线时常出现 `UP`
但缺少 `LOWER_UP`，
此时"接口开着"却不可能通。
收发计数用 `ip -s link show eth0` 查看，
其 `errs`/`drop` 持续增长
则指向链路层问题
（双工不匹配、环路、驱动 bug），
此时应先修链路，再谈上层配置。

需要临时改配置做验证时，
`ip` 命令是最快路径，
但**它不持久**，重启即失效：

```bash
sudo ip addr add 192.168.1.100/24 dev eth0
sudo ip link set eth0 up
sudo ip route add default via 192.168.1.1
```

临时与永久的分界要牢记：
**验证用 `ip`，固化用配置文件**。
反过来，
先改配置文件再 `apply`/`reload`
才是生产做法。
很多"昨天还好好的、今天重启就没了"的工单，
根因就是有人只用了 `ip addr add`。

另外注意接口命名：
现代发行版默认使用
可预测命名（`ens`、`enp`、`eno`），
而不是清一色 `eth0`。
以 `ip -br addr` 的实际输出为准，
不要照抄文档里的 `eth0`——
名字不对时所有命令都会
`Cannot find device`。

各家的配置入口对照见
[持久配置：三系对照](persistent-config.md)；
这里看到路由的深入解读在
[路由配置](routing.md)。
