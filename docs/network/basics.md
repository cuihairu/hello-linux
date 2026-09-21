# 网络基础

## 学习目标

- 理解网络协议栈
- 掌握 IP 地址和子网划分
- 了解常见网络协议

## 1. 网络协议栈

### 1.1 OSI 七层模型

| 层 | 名称 | 说明 | 协议示例 |
|----|------|------|---------|
| 7 | 应用层 | 用户接口 | HTTP、FTP、SMTP |
| 6 | 表示层 | 数据格式 | SSL/TLS |
| 5 | 会话层 | 会话管理 | NetBIOS |
| 4 | 传输层 | 端到端通信 | TCP、UDP |
| 3 | 网络层 | 路由寻址 | IP、ICMP |
| 2 | 数据链路层 | 帧传输 | Ethernet |
| 1 | 物理层 | 比特传输 | 光纤、双绞线 |

### 1.2 TCP/IP 四层模型

| 层 | 名称 | 协议示例 |
|----|------|---------|
| 4 | 应用层 | HTTP、FTP、SMTP |
| 3 | 传输层 | TCP、UDP |
| 2 | 网际层 | IP、ICMP |
| 1 | 网络接口层 | Ethernet |

## 2. IP 地址

### 2.1 IPv4

```
格式：点分十进制
示例：192.168.1.100

分类：
A类：1.0.0.0 - 126.255.255.255
B类：128.0.0.0 - 191.255.255.255
C类：192.0.0.0 - 223.255.255.255
D类：224.0.0.0 - 239.255.255.255（组播）
E类：240.0.0.0 - 255.255.255.255（保留）

私有地址：
A类：10.0.0.0 - 10.255.255.255
B类：172.16.0.0 - 172.31.255.255
C类：192.168.0.0 - 192.168.255.255
```

### 2.2 子网划分

```bash
# 子网掩码
255.255.255.0 = /24
255.255.0.0 = /16
255.0.0.0 = /8

# CIDR 表示法
192.168.1.0/24

# 计算网络地址
IP: 192.168.1.100
掩码: 255.255.255.0
网络地址: 192.168.1.0
广播地址: 192.168.1.255
```

### 2.3 IPv6

```
格式：冒号十六进制
示例：2001:0db8:85a3:0000:0000:8a2e:0370:7334

简化：
2001:db8:85a3::8a2e:370:7334

特殊地址：
::1 = 本地回环
fe80:: = 链路本地地址
```

## 3. 常见协议

### 3.1 TCP

- **特点**：面向连接、可靠传输
- **三次握手**：SYN → SYN+ACK → ACK
- **四次挥手**：FIN → ACK → FIN → ACK

### 3.2 UDP

- **特点**：无连接、不可靠传输
- **应用**：DNS、DHCP、视频流

### 3.3 HTTP/HTTPS

```bash
# HTTP 方法
GET：获取资源
POST：提交数据
PUT：更新资源
DELETE：删除资源

# 状态码
200：成功
301：永久重定向
302：临时重定向
404：未找到
500：服务器错误
```

### 3.4 DNS

```bash
# DNS 查询过程
客户端 → 本地DNS → 根DNS → 顶级DNS → 权威DNS

# DNS 记录类型
A：IPv4 地址
AAAA：IPv6 地址
CNAME：别名
MX：邮件服务器
NS：域名服务器
```

## 4. 网络配置

### 4.1 临时配置

```bash
# 配置 IP 地址
sudo ip addr add 192.168.1.100/24 dev eth0

# 添加默认网关
sudo ip route add default via 192.168.1.1

# 配置 DNS
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
```

### 4.2 永久配置

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

## 5. 网络诊断

### 5.1 ping - 连通性测试

```bash
# 测试连通性
ping 8.8.8.8

# 指定次数
ping -c 4 8.8.8.8
```

### 5.2 traceroute - 路由追踪

```bash
# 追踪路由
traceroute 8.8.8.8
```

### 5.3 mtr - 网络诊断

```bash
# 实时诊断
mtr 8.8.8.8
```

## 6. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 网络配置 | Netplan | NetworkManager |
| DNS 配置 | /etc/resolv.conf | /etc/resolv.conf |

## 参考资料

- [鸟哥的私房菜 - 网络基础](https://linux.vbird.org/linux_server/0110networkbasic.php)
- [Arch Wiki - Network configuration](https://wiki.archlinux.org/title/Network_configuration)
- [RFC 文档](https://www.rfc-editor.org/)
