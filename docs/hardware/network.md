# 网络设备

网络设备是计算机接入网络的硬件基础。本章介绍网卡、交换机等网络设备的工作原理和 Linux 下的管理方法。

> 内容参考自经典教材和厂商文档，见文末参考资料。

## 学习目标

- 理解网卡的工作原理
- 掌握网络设备信息的查看方法
- 了解网络设备驱动和性能调优

## 1. 网卡（NIC）

### 1.1 网卡结构

```
┌───────────────────────────────────────┐
│                 网卡                    │
│  ┌─────────┐  ┌─────────┐  ┌───────┐ │
│  │ RJ45/SFP│  │ PHY     │  │ MAC   │ │
│  │ 接口    │  │ 物理层  │  │ 控制器│ │
│  └─────────┘  └─────────┘  └───┬───┘ │
│                               │       │
│  ┌────────────────────────────┴────┐  │
│  │         DMA 引擎                 │  │
│  └────────────────────────────┬────┘  │
│                               │       │
│  ┌────────────────────────────┴────┐  │
│  │         PCIe 接口                │  │
│  └─────────────────────────────────┘  │
└───────────────────────────────────────┘
```

| 组件 | 功能 |
|------|------|
| PHY | 物理层信号收发 |
| MAC 控制器 | 帧的封装和解封 |
| DMA 引擎 | 直接内存访问，减少 CPU 参与 |
| PCIe 接口 | 与主机通信 |

### 1.2 网卡类型

| 类型 | 速率 | 接口 | 适用场景 |
|------|------|------|---------|
| 千兆网卡 | 1 Gbps | RJ45 | 普通桌面/服务器 |
| 万兆网卡 | 10 Gbps | RJ45/SFP+ | 服务器 |
| 25G 网卡 | 25 Gbps | SFP28 | 数据中心 |
| 100G 网卡 | 100 Gbps | QSFP28 | 高性能计算 |
| 无线网卡 | 变化 | 天线 | 移动设备 |

## 2. 网络设备信息查看

### 2.1 lspci

```bash
# 查看网络设备
lspci | grep -i network
lspci | grep -i ethernet

# 查看详细信息
lspci -v | grep -A 10 -i network
```

### 2.2 ip 命令

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

### 2.3 ethtool

```bash
# 安装
sudo apt install ethtool

# 查看网卡信息
sudo ethtool eth0

# 关键输出
# Speed: 1000Mb/s
# Duplex: Full
# Link detected: yes

# 查看驱动信息
sudo ethtool -i eth0

# 查看统计信息
sudo ethtool -S eth0

# 查看支持的功能
sudo ethtool -k eth0
```

## 3. 网卡驱动

### 3.1 查看驱动信息

```bash
# 查看网卡驱动
sudo ethtool -i eth0

# 输出示例
# driver: e1000e
# version: 3.2.6-k
# firmware-version: 0.5-4
# bus-info: 0000:00:1f.6

# 查看已加载的网络驱动模块
lsmod | grep -i "e1000\|ixgbe\|i40e\|mlx5"
```

### 3.2 常见网卡驱动

| 驱动 | 支持的网卡 | 说明 |
|------|-----------|------|
| e1000e | Intel 千兆 | 桌面/服务器通用 |
| igb | Intel 千兆 | 服务器级 |
| ixgbe | Intel 万兆 | 10GbE |
| i40e | Intel 25G/40G | 服务器级 |
| mlx5_core | Mellanox 25G/100G | 高性能计算 |
| r8169 | Realtek 千兆 | 消费级 |

```bash
# 加载驱动
sudo modprobe e1000e

# 卸载驱动
sudo modprobe -r e1000e
```

## 4. 网络性能调优

### 4.1 中断亲和性

将网卡中断绑定到特定 CPU 核心，减少缓存失效：

```bash
# 查看中断号
cat /proc/interrupts | grep eth0

# 设置中断亲和性
echo 1 | sudo tee /proc/irq/32/smp_affinity
# 将中断 32 绑定到 CPU 0

# 使用 irqbalance 自动平衡
sudo systemctl enable irqbalance
sudo systemctl start irqbalance
```

### 4.2 Ring Buffer

调整网卡接收/发送缓冲区大小：

```bash
# 查看当前 Ring Buffer 大小
sudo ethtool -g eth0

# 设置 Ring Buffer 大小
sudo ethtool -G eth0 rx 4096 tx 4096
```

### 4.3 Offload 功能

将网络处理卸载到网卡硬件：

```bash
# 查看 Offload 功能状态
sudo ethtool -k eth0

# 启用 TSO（TCP Segmentation Offload）
sudo ethtool -K eth0 tso on

# 启用 GSO（Generic Segmentation Offload）
sudo ethtool -K eth0 gso on

# 启用 GRO（Generic Receive Offload）
sudo ethtool -K eth0 gro on
```

### 4.4 多队列

现代网卡支持多队列，可并行处理网络流量：

```bash
# 查看队列数
sudo ethtool -l eth0

# 设置队列数
sudo ethtool -L eth0 combined 8
```

## 5. 网络诊断

### 5.1 链路状态

```bash
# 查看链路状态
ip link show eth0

# 使用 ethtool 查看
sudo ethtool eth0 | grep "Link detected"
```

### 5.2 流量监控

```bash
# 查看接口统计
ip -s link show eth0

# 实时监控
iftop

# 按进程查看
sudo nethogs eth0
```

### 5.3 抓包分析

```bash
# 安装 tcpdump
sudo apt install tcpdump

# 抓取特定接口的包
sudo tcpdump -i eth0

# 抓取特定端口
sudo tcpdump -i eth0 port 80

# 保存到文件
sudo tcpdump -i eth0 -w capture.pcap
```

## 6. 无线网络

### 6.1 查看无线网卡

```bash
# 查看无线接口
iw dev

# 查看无线网卡信息
iw phy phy0 info

# 扫描无线网络
sudo iw dev wlan0 scan | grep SSID
```

### 6.2 连接无线网络

```bash
# 使用 NetworkManager
nmcli device wifi list
nmcli device wifi connect "SSID" password "password"

# 使用 wpa_supplicant
wpa_passphrase "SSID" "password" | sudo tee /etc/wpa_supplicant/wpa_supplicant.conf
sudo wpa_supplicant -B -i wlan0 -c /etc/wpa_supplicant/wpa_supplicant.conf
sudo dhclient wlan0
```

## 7. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 网络配置 | Netplan | NetworkManager |
| 防火墙 | ufw | firewalld |
| 网络工具 | iproute2 | iproute2 |
| 无线工具 | wpasupplicant | wpa_supplicant |

## 参考资料

- Arch Wiki - Network configuration — [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration)
- Arch Wiki - Wireless — [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration/Wireless)
- Linux Kernel Networking Documentation — [kernel.org/doc](https://www.kernel.org/doc/html/latest/networking/)
- ethtool man page — [man7.org](https://man7.org/linux/man-pages/man8/ethtool.8.html)
- Red Hat - Network Performance Tuning — [redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html-single/monitoring_and_managing_system_status_and_performance/index)
