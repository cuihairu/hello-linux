# 网络配置基础

网络配置是 Linux 系统管理的基础技能，涵盖网络接口、路由、DNS 等配置。

> 内容参考自 NetworkManager、systemd-networkd 手册和实际运维经验，见文末参考资料。

## 学习目标

- 掌握网络接口配置
- 学会路由和网关配置
- 了解 DNS 配置和故障排除
- 掌握 NetworkManager 和 systemd-networkd

## 1. 网络接口配置

### 1.1 查看网络接口

```bash
# 查看所有接口
ip link show

# 查看特定接口
ip link show eth0

# 查看接口详细信息
ip -s link show eth0

# 查看接口地址
ip addr show

# 查看特定接口地址
ip addr show eth0
```

### 1.2 配置 IP 地址

```bash
# 临时配置 IP 地址
sudo ip addr add 192.168.1.100/24 dev eth0

# 删除 IP 地址
sudo ip addr del 192.168.1.100/24 dev eth0

# 设置接口状态
sudo ip link set eth0 up
sudo ip link set eth0 down
```

### 1.3 永久配置

```bash
# Debian/Ubuntu - /etc/network/interfaces
auto eth0
iface eth0 inet static
    address 192.168.1.100
    netmask 255.255.255.0
    gateway 192.168.1.1
    dns-nameservers 8.8.8.8 8.8.4.4

# RHEL/CentOS - /etc/sysconfig/network-scripts/ifcfg-eth0
DEVICE=eth0
BOOTPROTO=static
ONBOOT=yes
IPADDR=192.168.1.100
NETMASK=255.255.255.0
GATEWAY=192.168.1.1
DNS1=8.8.8.8
DNS2=8.8.4.4
```

## 2. NetworkManager

### 2.1 基本操作

```bash
# 查看连接状态
nmcli general status

# 查看所有连接
nmcli connection show

# 查看活动连接
nmcli connection show --active

# 查看设备状态
nmcli device status
```

### 2.2 配置连接

```bash
# 创建新连接
nmcli connection add type ethernet con-name my-connection ifname eth0

# 修改连接
nmcli connection modify my-connection ipv4.addresses 192.168.1.100/24
nmcli connection modify my-connection ipv4.gateway 192.168.1.1
nmcli connection modify my-connection ipv4.dns "8.8.8.8 8.8.4.4"
nmcli connection modify my-connection ipv4.method manual

# 启用连接
nmcli connection up my-connection

# 禁用连接
nmcli connection down my-connection

# 删除连接
nmcli connection delete my-connection
```

### 2.3 配置文件

```bash
# 连接配置文件
/etc/NetworkManager/system-connections/

# 示例配置
[connection]
id=my-connection
type=ethernet
interface-name=eth0

[ipv4]
method=manual
address1=192.168.1.100/24,192.168.1.1
dns=8.8.8.8;8.8.4.4;

[ipv6]
method=auto
```

## 3. systemd-networkd

### 3.1 配置文件

```bash
# 网络配置文件
/etc/systemd/network/

# 示例配置 - /etc/systemd/network/10-eth0.network
[Match]
Name=eth0

[Network]
Address=192.168.1.100/24
Gateway=192.168.1.1
DNS=8.8.8.8
DNS=8.8.4.4
```

### 3.2 管理命令

```bash
# 启用服务
sudo systemctl enable systemd-networkd
sudo systemctl start systemd-networkd

# 查看状态
networkctl status

# 查看连接
networkctl list

# 查看特定接口
networkctl status eth0
```

## 4. 路由配置

### 4.1 查看路由

```bash
# 查看路由表
ip route show

# 查看特定路由
ip route get 192.168.1.100

# 查看路由缓存
ip route show cache
```

### 4.2 配置路由

```bash
# 添加静态路由
sudo ip route add 10.0.0.0/24 via 192.168.1.1

# 删除路由
sudo ip route del 10.0.0.0/24

# 添加默认网关
sudo ip route add default via 192.168.1.1

# 修改默认网关
sudo ip route change default via 192.168.1.1
```

### 4.3 永久路由

```bash
# Debian/Ubuntu - /etc/network/interfaces
up route add -net 10.0.0.0/24 gw 192.168.1.1

# RHEL/CentOS - /etc/sysconfig/network-scripts/route-eth0
10.0.0.0/24 via 192.168.1.1

# 使用 NetworkManager
nmcli connection modify my-connection +ipv4.routes "10.0.0.0/24 192.168.1.1"
```

## 5. DNS 配置

### 5.1 配置文件

```bash
# /etc/resolv.conf
nameserver 8.8.8.8
nameserver 8.8.4.4
search example.com

# /etc/hosts
127.0.0.1 localhost
192.168.1.100 myserver.example.com myserver

# /etc/nsswitch.conf
hosts: files dns
```

### 5.2 systemd-resolved

```bash
# 启用服务
sudo systemctl enable systemd-resolved
sudo systemctl start systemd-resolved

# 查看状态
resolvectl status

# 查看统计
resolvectl statistics

# 配置 DNS
# /etc/systemd/resolved.conf
[Resolve]
DNS=8.8.8.8 8.8.4.4
FallbackDNS=8.8.4.4
```

### 5.3 DNS 故障排除

```bash
# 测试 DNS 解析
nslookup example.com
dig example.com

# 使用特定 DNS 服务器
nslookup example.com 8.8.8.8
dig @8.8.8.8 example.com

# 查看 DNS 缓存
resolvectl show-cache

# 清除 DNS 缓存
resolvectl flush-caches
```

## 6. 防火墙基础

### 6.1 iptables 基础

```bash
# 查看规则
sudo iptables -L -n -v

# 允许 SSH
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# 允许 HTTP/HTTPS
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# 拒绝其他连接
sudo iptables -A INPUT -j DROP

# 保存规则
sudo iptables-save > /etc/iptables/rules.v4
```

### 6.2 firewalld 基础

```bash
# 查看状态
sudo firewall-cmd --state

# 查看规则
sudo firewall-cmd --list-all

# 添加服务
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https

# 添加端口
sudo firewall-cmd --permanent --add-port=8080/tcp

# 重新加载
sudo firewall-cmd --reload
```

## 7. 网络绑定

### 7.1 配置绑定

```bash
# 安装 bonding 模块
sudo modprobe bonding

# 配置绑定接口
# /etc/network/interfaces
auto bond0
iface bond0 inet static
    address 192.168.1.100
    netmask 255.255.255.0
    gateway 192.168.1.1
    bond-slaves eth0 eth1
    bond-mode active-backup
    bond-miimon 100
```

### 7.2 查看绑定状态

```bash
# 查看绑定信息
cat /proc/net/bonding/bond0

# 查看接口状态
ip link show bond0
```

## 8. VLAN 配置

### 8.1 创建 VLAN

```bash
# 加载 8021q 模块
sudo modprobe 8021q

# 创建 VLAN 接口
sudo ip link add link eth0 name eth0.100 type vlan id 100

# 配置 IP 地址
sudo ip addr add 192.168.100.1/24 dev eth0.100

# 启用接口
sudo ip link set eth0.100 up
```

### 8.2 永久配置

```bash
# /etc/network/interfaces
auto eth0.100
iface eth0.100 inet static
    address 192.168.100.1
    netmask 255.255.255.0
    vlan-raw-device eth0
```

## 9. 网络性能调优

### 9.1 内核参数

```bash
# /etc/sysctl.conf
# TCP 优化
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_tw_reuse = 1

# 网络缓冲区
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216

# 应用配置
sudo sysctl -p
```

### 9.2 网络接口调优

```bash
# 查看接口参数
ethtool eth0

# 设置接口参数
sudo ethtool -s eth0 speed 1000 duplex full

# 设置 Ring Buffer
sudo ethtool -G eth0 rx 4096 tx 4096
```

## 10. 实战案例

### 10.1 静态 IP 配置

```bash
#!/bin/bash
# 静态 IP 配置脚本

INTERFACE="eth0"
IP_ADDRESS="192.168.1.100"
NETMASK="255.255.255.0"
GATEWAY="192.168.1.1"
DNS="8.8.8.8 8.8.4.4"

# 配置接口
sudo ip addr add $IP_ADDRESS/24 dev $INTERFACE
sudo ip link set $INTERFACE up
sudo ip route add default via $GATEWAY

# 配置 DNS
echo "nameserver $DNS" | sudo tee /etc/resolv.conf

echo "网络配置完成"
```

### 10.2 网络诊断脚本

```bash
#!/bin/bash
# 网络诊断脚本

echo "=== 网络诊断 ==="

# 检查接口状态
echo "1. 接口状态:"
ip link show | grep -E "^[0-9]+:"

# 检查 IP 地址
echo "2. IP 地址:"
ip addr show | grep "inet "

# 检查路由
echo "3. 路由表:"
ip route show

# 检查 DNS
echo "4. DNS 配置:"
cat /etc/resolv.conf

# 检查连通性
echo "5. 连通性测试:"
ping -c 2 8.8.8.8
```

## 参考资料

- `man ip`, `man nmcli`, `man networkctl`, `man iptables`
- [NetworkManager 文档](https://networkmanager.dev/docs/)
- [systemd-networkd 文档](https://www.freedesktop.org/software/systemd/man/systemd.network.html)
- [Linux 网络配置](https://www.kernel.org/doc/Documentation/networking/)