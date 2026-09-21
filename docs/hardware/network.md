# 网络设备

## 学习目标

- 了解常见网络设备的类型
- 掌握网络设备信息的查看方法
- 学会网络设备管理和配置

## 1. 网络设备类型

### 1.1 有线网络

| 设备 | 说明 | 常见接口 |
|------|------|---------|
| 网卡（NIC） | 网络接口卡 | RJ45、光纤 |
| 交换机 | 二层网络设备 | RJ45、SFP |
| 路由器 | 三层网络设备 | RJ45、光纤 |

### 1.2 无线网络

| 设备 | 说明 | 标准 |
|------|------|------|
| Wi-Fi 网卡 | 无线网络接口 | 802.11ac/ax |
| 蓝牙适配器 | 短距离无线通信 | Bluetooth 5.0 |

## 2. 网络设备信息查看

### 2.1 lspci - PCI 设备

```bash
# 查看网络设备
lspci | grep -i network

# 查看详细信息
lspci -v | grep -A 10 -i network
```

### 2.2 lsusb - USB 设备

```bash
# 查看 USB 网络设备
lsusb | grep -i network
```

### 2.3 ip 命令

```bash
# 查看网络接口
ip link show

# 查看 IP 地址
ip addr show

# 查看特定接口
ip addr show eth0

# 查看接口统计
ip -s link show eth0
```

### 2.4 ethtool - 网卡参数

```bash
# 安装 ethtool
sudo apt install ethtool    # Debian/Ubuntu
sudo yum install ethtool    # RHEL/CentOS

# 查看网卡信息
sudo ethtool eth0

# 查看网卡驱动信息
sudo ethtool -i eth0

# 查看网卡统计信息
sudo ethtool -S eth0

# 测试网卡连接
sudo ethtool eth0 | grep Link
```

## 3. 网络设备配置

### 3.1 临时配置

```bash
# 启用接口
sudo ip link set eth0 up

# 禁用接口
sudo ip link set eth0 down

# 配置 IP 地址
sudo ip addr add 192.168.1.100/24 dev eth0

# 删除 IP 地址
sudo ip addr del 192.168.1.100/24 dev eth0
```

### 3.2 永久配置

#### Netplan（Ubuntu）

```yaml
# /etc/netplan/01-netcfg.yaml
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: true
      addresses:
        - 192.168.1.100/24
      gateway4: 192.168.1.1
      nameservers:
        addresses:
          - 8.8.8.8
          - 8.8.4.4
```

#### NetworkManager（RHEL/CentOS）

```bash
# 查看连接
nmcli connection show

# 创建连接
nmcli connection add type ethernet con-name my-connection ifname eth0

# 修改连接
nmcli connection modify my-connection ipv4.addresses 192.168.1.100/24

# 启用连接
nmcli connection up my-connection
```

## 4. 无线网络配置

### 4.1 iw - 无线工具

```bash
# 查看无线接口
iw dev

# 扫描无线网络
sudo iw dev wlan0 scan

# 连接无线网络
sudo iw dev wlan0 connect "SSID"
```

### 4.2 wpa_supplicant

```bash
# 配置文件
/etc/wpa_supplicant/wpa_supplicant.conf

# 添加网络
wpa_passphrase "SSID" "password" | sudo tee -a /etc/wpa_supplicant/wpa_supplicant.conf

# 启动 wpa_supplicant
sudo wpa_supplicant -B -i wlan0 -c /etc/wpa_supplicant/wpa_supplicant.conf
```

## 5. 网络诊断

### 5.1 网络连通性

```bash
# 测试连通性
ping 8.8.8.8

# 追踪路由
traceroute 8.8.8.8

# 网络诊断
mtr 8.8.8.8
```

### 5.2 端口检查

```bash
# 查看监听端口
ss -ltnp

# 查看特定端口
ss -tlnp | grep :80
```

## 6. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 网络配置 | Netplan | NetworkManager |
| 工具包 | iproute2 | iproute2 |
| ethtool | ethtool | ethtool |

## 参考资料

- [鸟哥的私房菜 - 网络配置](https://linux.vbird.org/linux_server/0110networkbasic.php)
- [Arch Wiki - Network configuration](https://wiki.archlinux.org/title/Network_configuration)
- [Arch Wiki - Wireless](https://wiki.archlinux.org/title/Network_configuration/Wireless)
