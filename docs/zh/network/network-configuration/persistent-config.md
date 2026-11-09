# 持久配置：三系对照

> 本文属于[网络配置基础](../network-configuration.md)——
> 四种配置入口的对照。
> 动手前先用[谁在管理你的网卡](manager-detection.md)确认管理者。

## Netplan（Debian/Ubuntu，Ubuntu 默认）

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

## systemd-networkd（Arch 常用）

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

## NetworkManager / nmcli（RHEL/CentOS/Rocky）

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

## ifcfg 脚本（仅 RHEL 7/8 遗留系统）

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
判断依据仍是[管理者检测](manager-detection.md)——
**配置入口只有一个，是铁律**。

地址持久化之后，接下来的两层是
[路由配置](routing.md)
与 [DNS 配置与解析路径](dns.md)。
