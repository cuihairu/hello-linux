# VPN

VPN（虚拟专用网络）用于在公共网络上建立安全的加密隧道。

> 内容参考自 OpenVPN、WireGuard 官方文档和实际运维经验，见文末参考资料。

## 学习目标

- 理解 VPN 工作原理
- 掌握 OpenVPN 和 WireGuard 配置
- 了解 VPN 安全最佳实践

## 1. VPN 基础

### 1.1 工作原理

```
客户端 → 加密隧道 → VPN 服务器 → 目标服务器
         ↑
    数据加密传输
```

### 1.2 VPN 类型

| 类型 | 说明 | 适用场景 |
|------|------|---------|
| 远程访问 VPN | 员工远程访问公司网络 | 远程办公 |
| 站点到站点 VPN | 连接两个办公地点 | 多分支机构 |
| 移动 VPN | 移动设备安全访问 | 移动办公 |

## 2. OpenVPN

### 2.1 安装

```bash
# Debian/Ubuntu
sudo apt update
sudo apt install openvpn easy-rsa

# RHEL/CentOS
sudo dnf install openvpn easy-rsa
```

### 2.2 证书管理

```bash
# 初始化 PKI
cd /etc/openvpn
sudo make-cadir easy-rsa
cd easy-rsa

# 初始化 PKI
sudo ./easyrsa init-pki

# 构建 CA
sudo ./easyrsa build-ca

# 生成服务器证书
sudo ./easyrsa gen-req server nopass
sudo ./easyrsa sign-req server server

# 生成客户端证书
sudo ./easyrsa gen-req client1 nopass
sudo ./easyrsa sign-req client client1

# 生成 Diffie-Hellman 参数
sudo ./easyrsa gen-dh

# 生成 TLS 认证密钥
sudo openvpn --genkey secret /etc/openvpn/ta.key
```

### 2.3 服务器配置

```bash
# /etc/openvpn/server.conf
port 1194
proto udp
dev tun

ca /etc/openvpn/easy-rsa/pki/ca.crt
cert /etc/openvpn/easy-rsa/pki/issued/server.crt
key /etc/openvpn/easy-rsa/pki/private/server.key
dh /etc/openvpn/easy-rsa/pki/dh.pem

server 10.8.0.0 255.255.255.0

push "redirect-gateway def1 bypass-dhcp"
push "dhcp-option DNS 8.8.8.8"
push "dhcp-option DNS 8.8.4.4"

keepalive 10 120
tls-auth /etc/openvpn/ta.key 0

cipher AES-256-GCM
auth SHA256

user nobody
group nogroup

persist-key
persist-tun

status /var/log/openvpn/status.log
log-append /var/log/openvpn/openvpn.log
verb 3
```

### 2.4 客户端配置

```bash
# client.ovpn
client
dev tun
proto udp

remote your-server-ip 1194

resolv-retry infinite
nobind

persist-key
persist-tun

ca ca.crt
cert client1.crt
key client1.key

tls-auth ta.key 1

cipher AES-256-GCM
auth SHA256

verb 3
```

### 2.5 管理命令

```bash
# 启动服务
sudo systemctl start openvpn@server
sudo systemctl enable openvpn@server

# 查看状态
sudo systemctl status openvpn@server

# 查看日志
sudo tail -f /var/log/openvpn/openvpn.log

# 查看连接
sudo cat /var/log/openvpn/status.log
```

## 3. WireGuard

### 3.1 安装

```bash
# Debian/Ubuntu
sudo apt update
sudo apt install wireguard

# RHEL/CentOS
sudo dnf install wireguard-tools
```

### 3.2 密钥生成

```bash
# 生成服务器密钥
wg genkey | tee server_private.key | wg pubkey > server_public.key

# 生成客户端密钥
wg genkey | tee client_private.key | wg pubkey > client_public.key
```

### 3.3 服务器配置

```bash
# /etc/wireguard/wg0.conf
[Interface]
PrivateKey = <server_private_key>
Address = 10.0.0.1/24
ListenPort = 51820
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

[Peer]
PublicKey = <client_public_key>
AllowedIPs = 10.0.0.2/32
```

### 3.4 客户端配置

```bash
# client.conf
[Interface]
PrivateKey = <client_private_key>
Address = 10.0.0.2/24
DNS = 8.8.8.8

[Peer]
PublicKey = <server_public_key>
Endpoint = your-server-ip:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
```

### 3.5 管理命令

```bash
# 启动接口
sudo wg-quick up wg0

# 关闭接口
sudo wg-quick down wg0

# 查看状态
sudo wg show

# 设置开机自启
sudo systemctl enable wg-quick@wg0
```

## 4. 安全最佳实践

### 4.1 证书安全

```bash
# 使用强密钥
# RSA 4096 位或 ECDSA 256 位

# 定期轮换证书
# 建议每 1-2 年轮换一次

# 保护私钥权限
chmod 600 /etc/openvpn/easy-rsa/pki/private/*
```

### 4.2 网络安全

```bash
# 限制 VPN 访问
# 只允许特定 IP 段访问

# 启用防火墙
# 只开放必要端口

# 监控 VPN 日志
# 定期检查异常连接
```

### 4.3 性能优化

```bash
# 选择合适的协议
# UDP 性能更好，TCP 更可靠

# 调整 MTU
# 避免分片，提高性能

# 启用压缩
# 注意：可能影响安全性
```

## 5. 实战案例

### 5.1 远程访问 VPN

```bash
#!/bin/bash
# 远程访问 VPN 安装脚本

# 安装 OpenVPN
sudo apt update
sudo apt install -y openvpn easy-rsa

# 初始化 PKI
cd /etc/openvpn
sudo make-cadir easy-rsa
cd easy-rsa
sudo ./easyrsa init-pki
sudo ./easyrsa build-ca nopass
sudo ./easyrsa gen-req server nopass
sudo ./easyrsa sign-req server server
sudo ./easyrsa gen-dh

# 生成客户端证书
sudo ./easyrsa gen-req client1 nopass
sudo ./easyrsa sign-req client client1

# 复制证书
sudo cp /etc/openvpn/easy-rsa/pki/ca.crt /etc/openvpn/
sudo cp /etc/openvpn/easy-rsa/pki/issued/server.crt /etc/openvpn/
sudo cp /etc/openvpn/easy-rsa/pki/private/server.key /etc/openvpn/
sudo cp /etc/openvpn/easy-rsa/pki/dh.pem /etc/openvpn/

# 启动服务
sudo systemctl start openvpn@server
sudo systemctl enable openvpn@server
```

### 5.2 站点到站点 VPN

```bash
# 站点 A 配置
# /etc/openvpn/server.conf
port 1194
proto udp
dev tun

ca /etc/openvpn/ca.crt
cert /etc/openvpn/server.crt
key /etc/openvpn/server.key
dh /etc/openvpn/dh.pem

server 10.8.0.0 255.255.255.0

# 站点 B 网段
route 192.168.2.0 255.255.255.0

# 站点 B 配置
# /etc/openvpn/client.conf
client
dev tun
proto udp

remote site-a-ip 1194

ca /etc/openvpn/ca.crt
cert /etc/openvpn/client.crt
key /etc/openvpn/client.key

# 站点 A 网段
route 192.168.1.0 255.255.255.0
```

## 参考资料

- [OpenVPN 文档](https://openvpn.net/community-resources/)
- [WireGuard 文档](https://www.wireguard.com/)
- [VPN 最佳实践](https://www.sans.org/white-papers/vpn/)