# 网络基础

Linux 网络基础知识，包括 IP 地址、子网、路由和 DNS。

> 内容参考自 Arch Wiki 和 RFC 文档，见文末参考资料。

## 1. IP 地址

### IPv4

```
格式：点分十进制
示例：192.168.1.100

私有地址范围：
A类：10.0.0.0 - 10.255.255.255
B类：172.16.0.0 - 172.31.255.255
C类：192.168.0.0 - 192.168.255.255
```

### 子网掩码

```bash
# CIDR 表示法
192.168.1.0/24    # 掩码 255.255.255.0
192.168.0.0/16    # 掩码 255.255.0.0
```

## 2. 网络配置

### 临时配置

```bash
# 配置 IP
sudo ip addr add 192.168.1.100/24 dev eth0

# 启用接口
sudo ip link set eth0 up

# 添加路由
sudo ip route add default via 192.168.1.1
```

### 永久配置

Netplan（Ubuntu）：`/etc/netplan/*.yaml`
NetworkManager：`nmcli` 或 `/etc/sysconfig/network-scripts/`

## 3. DNS

```bash
# 查看 DNS 配置
cat /etc/resolv.conf

# 查询域名
dig example.com
nslookup example.com
```

## 4. 网络诊断

```bash
ping 8.8.8.8              # 连通性测试
traceroute 8.8.8.8        # 路由追踪
mtr 8.8.8.8               # 实时诊断
ss -tlnp                  # 查看监听端口
```

## 参考资料

- Arch Wiki - Network configuration — [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration)
- RFC 791 (IP)、RFC 793 (TCP)
