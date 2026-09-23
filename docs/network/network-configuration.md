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

> 内容参考自 Netplan、systemd-networkd、
> NetworkManager 官方手册与 Arch Wiki，
> 见文末参考资料。

## 学习目标

- 判断一台机器当前由哪个网络管理器接管，
  避免多套体系打架
- 掌握 Netplan、systemd-networkd、
  `nmcli`、ifcfg 四种配置方式的适用场景
- 理解 DNS 从 `getaddrinfo()`
  到 `/etc/resolv.conf` 的完整解析路径
- 会配置静态地址、路由、bonding、VLAN
  与基础内核调优
- 认识配置管理中的高频坑
  （重启丢失、resolv.conf 被覆盖、
  route cache 幻觉）

## 1. 先回答：谁在管理你的网卡

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

# RHEL/CentOS 上 NetworkManager 的连接配置
$ ls /etc/NetworkManager/system-connections/
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

判断当前格局的命令组合如下，
换新机器时先跑一遍再动手：

```bash
systemctl is-active NetworkManager systemd-networkd
ls /etc/netplan/ 2>/dev/null
nmcli -t -f NAME,DEVICE connection show --active
networkctl list 2>/dev/null
```

输出里谁是 `active`、
谁列出了你的网卡，
谁就是实际管理者——
**以输出为准，不以发行版印象为准**。

## 2. 查看当前网络状态

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

# 查看收发计数与错误
$ ip -s link show eth0
3: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> ...
    RX:  bytes packets errs drop fifo frame compressed multicast
         1048576    8234    0    0    0     0     0        0
    TX:  bytes packets errs drop fifo colls carrier compressed
         524288     6102    0    0    0     0    0        0
```

`ip link` 的 `state` 字段容易误读：
`UP` 表示管理状态开启，
`LOWER_UP` 表示已检测到载波（网线插好）。
虚拟接口或未插线时常出现 `UP`
但缺少 `LOWER_UP`，
此时"接口开着"却不可能通。
`ip -s` 的 `errs`/`drop` 持续增长
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

# 移除
sudo ip addr del 192.168.1.100/24 dev eth0
sudo ip route del default via 192.168.1.1
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

## 3. 永久配置：三系对照

### 3.1 Netplan（Debian/Ubuntu，Ubuntu 默认）

Netplan 用一份 YAML
同时描述地址、路由与 DNS，
语法与后端无关，
是 Ubuntu 上最省心的入口。
文件放在 `/etc/netplan/`，
按文件名顺序加载：

```yaml
# /etc/netplan/01-netcfg.yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    eth0:
      dhcp4: false
      addresses:
        - 192.168.1.100/24
      routes:
        - to: default
          via: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
        search: [example.com]
```

`renderer: networkd`
用于无桌面的服务器；
桌面改用 `NetworkManager`。
两者的行为差异主要体现在
Wi-Fi、移动宽带与连接优先级管理上，
静态有线地址的最终效果基本一致。

写完先做语法校验，再应用——
Netplan 的 YAML 对缩进敏感，
写错会在 apply 时直接报错并保持旧配置：

```bash
$ sudo netplan generate     # 仅生成后端配置
$ sudo netplan try           # 试应用，60 秒无确认自动回滚
$ sudo netplan apply         # 正式应用
```

`netplan try` 是被低估的安全网：
它会在倒计时内监听你的确认输入，
超时自动还原，
专为"我没有带外管理口"的场景设计。
**远程改网络配置，
永远先 `try` 再 `apply`**。
如果 `apply` 把你锁在门外，
云主机还能靠控制台 VNC 救援，
物理机可能就要跑机房了——
一次 `try` 能省下这趟路。

只想查看将要生成的结果时，
用 `netplan get`
（0.106+ 版本提供）
或直接看
`/run/systemd/generator/`
下的产物即可。
YAML 里 `addresses` 是带前缀的列表
（`192.168.1.100/24`），
不要写成旧式 `netmask`；
网关用 `routes` 列表表达，
这是 Netplan 与后端配置最大的语法差异。

### 3.2 systemd-networkd（Arch 常用）

systemd-networkd
是 systemd 自带的轻量网络守护进程，
配置分三类文件：
`.network`（接管网卡）、
`.netdev`（创建虚拟设备）、
`.link`（udev 级参数），
统一存放于
`/etc/systemd/network/`。
它不依赖 NetworkManager，
适合服务器与容器宿主机：

```ini
# /etc/systemd/network/10-eth0.network
[Match]
Name=eth0

[Network]
Address=192.168.1.100/24
Gateway=192.168.1.1
DNS=8.8.8.8
DNS=8.8.4.4
Domains=example.com
```

启用与观测：

```bash
sudo systemctl enable --now systemd-networkd
networkctl status eth0
networkctl list
```

`[Match]` 支持 `Name`（支持通配符）、
`MACAddress`、`Path` 等多种条件。
**用 MAC 而非设备名匹配**
是云与虚拟化环境的最佳实践——
`eth0`/`ens33` 这类名字
在克隆、热插或改 BIOS 设置后可能漂移，
配置会静默失效。
`networkctl status`
还会显示 DHCP 租约、DNS 来源与链路速率，
是排查 networkd 问题的第一入口。

多个 `.network` 文件按文件名顺序应用，
第一个匹配成功的生效，
因此习惯用数字前缀
（`10-`、`20-`）控制优先级。
改动后 `networkctl reload`
即可重载，无需重启服务。
把"按 MAC 匹配 + 数字前缀"两条习惯
合在一起，
就能覆盖绝大多数服务器场景。

### 3.3 NetworkManager / nmcli（RHEL/CentOS/Rocky）

RHEL 9 起 NetworkManager
是唯一的官方网络管理器，
`network-scripts`（ifcfg）包已彻底移除，
`nmcli` 是事实标准。
它的优势是连接（connection）抽象：
一份连接可被多设备复用，
支持 profile、优先级、自动重连
与区域绑定（与 firewalld 联动）。

```bash
# 查看状态
$ nmcli general status
STATE      CONNECTIVITY  WIFI-HW  WIFI     ETH-HW  VPN-HW
connected  full          enabled  enabled  enabled  enabled

$ nmcli device status
DEVICE  TYPE      STATE      CONNECTION
eth0    ethernet  connected  ens160
lo      loopback  unmanaged  --

# 创建静态连接
$ sudo nmcli connection add type ethernet con-name office ifname eth0 \
    ipv4.method manual ipv4.addresses 192.168.1.100/24 \
    ipv4.gateway 192.168.1.1 ipv4.dns "8.8.8.8 8.8.4.4"

# 启用/禁用/删除
$ sudo nmcli connection up office
$ sudo nmcli connection down office
$ sudo nmcli connection delete office
```

`nmcli` 支持按属性过滤（`-f`）
与字段名自动补全，适合脚本化。
修改已有连接用
`nmcli connection modify`，
`+`/`-` 前缀可以在不覆盖原值的
前提下增删列表项
（如 `+ipv4.routes`、`-ipv4.dns`）——
直接写 `ipv4.dns "8.8.8.8"`
会替换全部 DNS，
先 `+` 后 `-` 才是安全的增量改法。

连接配置的磁盘形态有两种：
传统 `ifcfg-*` 文本（RHEL 7/8 常见）
与 keyfile
（`/etc/NetworkManager/system-connections/`，
9+ 默认）。
后者权限为 `600`，
属 root 私有，
避免了明文密码外泄。
keyfile 是 INI 风格，
字段名与 ifcfg 不完全同名，
迁移时建议用
`nmcli connection show`
导出后重建，
而不是手工翻译每一行。

### 3.4 ifcfg 脚本（仅 RHEL 7/8 遗留系统）

若维护的是老系统，
仍会见到
`/etc/sysconfig/network-scripts/ifcfg-eth0`。
理解它的字段有助于读懂迁移前的旧配置：

```bash
# RHEL 7/8；9 起已移除
DEVICE=eth0
BOOTPROTO=static
ONBOOT=yes
IPADDR=192.168.1.100
NETMASK=255.255.255.0
GATEWAY=192.168.1.1
DNS1=8.8.8.8
DNS2=8.8.4.4
```

修改后需重启网络服务或该接口
才能生效。
迁移到 RHEL 9 时，
建议用 `nmcli` 导出现有连接再重建，
而不是手工翻译 ifcfg——
`DEFROUTE`、`PEERDNS`
这类开关在 keyfile 中
并不一一对应，
漏一个就可能表现为
"地址对了但 DNS 没生效"。

Debian 传统上也有
`/etc/network/interfaces` 写法
（`auto eth0` / `iface eth0 inet static`），
但在启用了 NetworkManager
或 Netplan 的系统上**不应**
再往里加条目，
两套来源会互相覆盖。
判断依据仍是第 1 节的管理者检测——
**配置入口只有一个，是铁律**。

## 4. 路由配置

### 4.1 查看与解读

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

### 4.2 添加与持久化

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

## 5. DNS 配置与解析路径

### 5.1 解析链路全景

DNS 出问题时，
很多人只会反复
`vi /etc/resolv.conf`，
却发现"改了又被改回去"。
要避免这种徒劳，
必须先看清完整链路。

1. 应用调用 `getaddrinfo()`（glibc）。
2. glibc 读取 `/etc/nsswitch.conf`
   的 `hosts:` 行，
   常见为 `files dns`
   或 `files resolve dns`，
   决定先查 `/etc/hosts`
   还是直接走 DNS；
   启用 `resolve` 时
   还会经 systemd-resolved
   的 D-Bus 接口。
3. 若走 DNS，
   查询被发往
   `/etc/resolv.conf`
   里列出的 `nameserver`。
4. 在启用了 systemd-resolved 的系统上，
   `/etc/resolv.conf`
   是指向 `127.0.0.53:53`
   的符号链接，
   真正的上游 DNS 配置在
   `/etc/systemd/resolved.conf`，
   由 resolved 汇聚后再对外查询。
5. NetworkManager 也可能托管
   `resolv.conf`
   （`PEERDNS=yes` 时），
   DHCP 下发的 DNS 会直接写进去。

因此 `resolv.conf`
既可能是真实文件，也可能是 symlink；
改错对象就会出现
"保存成功但立刻被还原"。
确认归属：

```bash
$ ls -l /etc/resolv.conf
lrwxrwxrwx 1 root root 39 ... /etc/resolv.conf -> ../run/systemd/resolve/stub-resolv.conf

$ resolvectl status
Link 2 (eth0)
    Current DNS Server: 192.168.1.1
       DNS Servers: 8.8.8.8 8.8.4.4
```

Ubuntu 22.04+ 与多数新发行版
默认走 stub 模式（`127.0.0.53`）；
RHEL 默认不用 resolved，
由 NetworkManager 直接写
`/etc/resolv.conf` 真实文件。
**先用 `ls -l` 看清链接关系，
再决定改哪里**。

链路里最容易被忽略的是第 2 步：
`nsswitch.conf` 决定了
`files` 与 `dns` 谁先谁后。
有人在 `/etc/hosts`
加了条目却不生效，
原因往往是这台机器的
`hosts:` 行把 `dns` 排在了前面，
或者中间插了 `mymachines`、`resolve`
之类模块改变了顺序。
**改 hosts 不生效时，
先 `grep '^hosts' /etc/nsswitch.conf`**，
再怀疑缓存或权限。

### 5.2 配置文件与生效方式

```bash
# /etc/resolv.conf 基本条目
nameserver 8.8.8.8
nameserver 8.8.4.4
search example.com
options timeout:2 attempts:3

# /etc/hosts 本地静态映射
127.0.0.1   localhost
192.168.1.100 myserver.example.com myserver

# systemd-resolved 的持久配置
# /etc/systemd/resolved.conf
[Resolve]
DNS=8.8.8.8 8.8.4.4
FallbackDNS=1.1.1.1
```

`options timeout`/`attempts`
控制单次查询超时与重试，
弱网环境下适当放宽
可减少解析假失败。
修改 resolved 配置后需
`sudo systemctl restart systemd-resolved`；
修改 `nsswitch.conf`
则影响全局解析顺序，
动之前先确认没有应用依赖特定顺序。

NetworkManager 场景下，
正确做法是改连接的 DNS 属性
而不是直接编辑文件——
后者会在下次 DHCP 续租时被覆盖：

```bash
$ sudo nmcli connection modify office ipv4.dns "8.8.8.8 8.8.4.4"
$ sudo nmcli connection up office
```

每个 `nameserver`
必须单独占一行，
写成
`nameserver 8.8.8.8 8.8.4.4`
只会解析第一个、
甚至整行报错——
这是从脚本 `echo`
拼配置时最常见的低级错误。

### 5.3 观测与排障

```bash
# 看缓存与查询状态
$ resolvectl statistics
$ resolvectl query example.com

# 强制绕过缓存测试
$ dig +norecurse example.com @192.168.1.1

# 清缓存
$ sudo resolvectl flush-caches
```

`dig @服务器`
可以直接指定上游，
用来区分
"本地配置错"与"上游 DNS 坏"：
若 `dig @8.8.8.8`
能解析而默认查询失败，
问题一定在本机的
resolv.conf/resolved 配置；
两者都失败则是上游或出口问题。
这条分界与
[网络故障排除](./troubleshooting.md)
中的推理链完全一致。

解析类问题还有一类是**搜索域副作用**：
配了 `search example.com` 后，
访问短名 `myserver`
会先拼成 `myserver.example.com` 查询。
多区域环境里，
搜索域顺序不同可能解析到
错误的同名主机——
"ping 通了却是另一台机器"
往往就是它干的。
排查时用 `dig +short FQDN.`
（注意末尾带点）绕过搜索域，
即可确认是不是这个问题。

## 6. Bonding 与 VLAN

### 6.1 网卡绑定（bonding）

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

### 6.2 VLAN

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

## 7. 网络性能调优

### 7.1 内核参数

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
应用改动：

```bash
$ sudo sysctl --system
```

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

### 7.2 接口参数

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

## 8. 实战案例

### 8.1 一键诊断脚本

把第 2、4、5 节的观测命令串起来，
形成最小诊断集，
任何网络工单先跑一遍：

```bash
#!/bin/bash
echo "=== 1. 接口状态 ==="
ip -br addr
echo "=== 2. 路由 ==="
ip route show
echo "=== 3. DNS 来源 ==="
ls -l /etc/resolv.conf
grep -E '^hosts' /etc/nsswitch.conf
echo "=== 4. 连通性 ==="
ping -c 2 -W 2 192.168.1.1 >/dev/null && echo "网关: OK" || echo "网关: FAIL"
ping -c 2 -W 2 8.8.8.8      >/dev/null && echo "公网: OK" || echo "公网: FAIL"
ping -c 2 -W 2 example.com   >/dev/null && echo "DNS : OK" || echo "DNS : FAIL"
```

脚本的价值在于**顺序固定**：
先看配置（1-2），
再看解析来源（3），
最后分层探测（4）。
任何一步 FAIL
都能把范围收窄到对应层，
避免上来就抓包的低效。
把网关地址与目标域名
提成脚本头部变量，
换环境时只改两行即可复用。

### 8.2 迁移检查清单

跨发行版迁移或重装后，
按清单核对可避免多数配置丢失：

1. 确认新系统的网络管理器
   （第 1 节命令），选对配置入口。
2. 导出旧机地址、路由、DNS
   （`ip addr`、`ip route`、
   `cat /etc/resolv.conf`），
   对照写入新配置。
3. 用 `netplan try` / `nmcli con up` /
   `networkctl reload` 应用，
   并保留回滚窗口。
4. 验证三层连通
   （网关、公网 IP、域名），
   再验证业务端口。
5. 确认配置写在了持久层，
   而不是仅用 `ip` 临时改过——
   重启一次做终检。

清单的第 5 步最容易被跳过，
却正是"上午配好、下午重启就丢"
的唯一防线。
把重启验证写进变更流程，
比记住每个管理器的细节更省心。

## 9. 常见坑

- **改了 resolv.conf 立刻被还原**。
  多半是它由 systemd-resolved
  或 NetworkManager 托管。
  按 5.1 节先 `ls -l` 判断归属，
  改管理器暴露的配置项，
  而不是直接编辑文件。
- **Netplan apply 后失联**。
  YAML 缩进错误或
  `renderer` 与实际后端不匹配
  会导致 apply 失败或接口消失。
  远程操作务必用 `netplan try`，
  给系统留 60 秒自动回滚。
- **两个管理器同时 active**。
  NetworkManager 与 networkd 并存
  会互相覆盖地址与 DNS，
  表现为配置"随机"回滚。
  用 `systemctl disable`
  停掉不需要的那个，
  只保留单一管理者。
- **设备名漂移导致配置失效**。
  克隆虚拟机或调整硬件后
  `eth0` 可能变成 `ens192`，
  基于名字的匹配全部落空。
  改用 MACAddress 匹配，
  或启用 `net.ifnames=0`
  统一命名
  （需评估对既有运维脚本的影响）。
- **把 `ip route show cache`
  当排障依据**。
  新版内核已移除路由缓存，
  该命令无输出是正常现象，
  不是"缓存丢了"。
- **强制网卡速率/双工**。
  除非交换机侧也显式配置，
  否则保持自协商；
  双工不匹配的症状是
  "半通不通、大量 retrans"，
  在 `ethtool` 与交换机端口两侧
  都要核对。
- **VLAN 子接口 UP 但收不到流量**。
  检查交换机 trunk
  是否放行该 VLAN，
  以及父接口是否处于正确模式；
  用 `tcpdump -e`
  看帧 tag 是否匹配。
- **永久路由写进了临时脚本**。
  `rc.local` 或运维临时命令里的
  `ip route add`
  重启即失。
  按第 4.2 节改回管理器配置。

## 10. 容器与虚拟网络的边界

容器网络常常被误当成"另一套网络"，
其实它复用的仍是本页讲过的全部原语：
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
所以本页第 4 节的路由知识
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

## 11. 与本篇其他页的关系

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
先确认地址与路由（本页），
再确认路径与解析（排障页），
最后确认策略（防火墙页）——
顺序反过来，就会长时间在错误的层里打转。

这三页的共同方法可以概括成一句话：
**先证明内核里发生了什么，
再讨论应用为什么没响应**。
配置页教你读地址与路由的事实，
排障页教你读包与连接的事实，
防火墙页教你读丢包决策的事实——
三者拼起来，
才构成对"网络"这一层完整的观察力。
缺少其中任何一页，
你的视角都会出现一块固定的盲区，
而故障恰好最爱藏在盲区里。

## 参考资料

配置类文档的通病是"看完就忘"，
因为缺少与真实机器的对照。
建议每读完一节，
就在一台测试机上完整跑一遍该节命令，
把输出与文中示例并排比较：
一致说明理解到位，
不一致则正好把差异追下去。
差异往往比一致更有教学价值——
它要么指向发行版差异，
要么指向你机器上多出来的管理器，
两者都会在后续运维中反复出现。
把差异记录进自己的环境笔记，
半年后你会得到一份
比任何通用教程都准确的"这台机器怎么组网"的档案。

- Netplan 官方文档：<https://netplan.readthedocs.io/>
- systemd.network(5)、networkctl(1)、
  systemd-resolved.service(8)
- Arch Wiki - systemd-networkd：
  <https://wiki.archlinux.org/title/Systemd-networkd>
- Arch Wiki - Network configuration：
  <https://wiki.archlinux.org/title/Network_configuration>
- NetworkManager 手册：<https://networkmanager.dev/docs/>
- RHEL 9 配置与管理网络：
  <https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_networking/>
- 鸟哥的私房菜 - 网络配置：
  <https://linux.vbird.org/linux_server/0110networkbasic.php>
- `man ip`、`man nmcli`、`man netplan`、
  `man sysctl`、`man ethtool`
