# DNS 服务器（BIND）

BIND（Berkeley Internet Name Domain）是最广泛使用的 DNS 服务器软件。

> 内容参考自 BIND 官方文档和鸟哥的私房菜，见文末参考资料。

## 学习目标

- 理解 DNS 解析流程
- 掌握 BIND 安装和配置
- 学会配置正向/反向解析
- 了解主从 DNS 配置

## 1. DNS 基础

### 1.1 解析流程

```
客户端 → 本地 DNS → 根 DNS → 顶级域 DNS → 权威 DNS → 返回 IP
```

### 1.2 记录类型

| 类型 | 说明 | 示例 |
|------|------|------|
| A | 域名 → IPv4 | example.com → 192.168.1.100 |
| AAAA | 域名 → IPv6 | example.com → 2001:db8::1 |
| CNAME | 别名 | www.example.com → example.com |
| MX | 邮件服务器 | example.com → mail.example.com |
| NS | 域名服务器 | example.com → ns1.example.com |
| PTR | IP → 域名（反向） | 192.168.1.100 → example.com |
| TXT | 文本记录 | SPF、DKIM 等 |

## 2. 安装

```bash
# Debian/Ubuntu
sudo apt update
sudo apt install bind9 bind9utils bind9-doc

# RHEL/CentOS/Fedora
sudo dnf install bind bind-utils

# 启动并设置开机自启
# Debian/Ubuntu 服务名为 bind9，RHEL/CentOS 服务名为 named
sudo systemctl start bind9      # Debian/Ubuntu
sudo systemctl enable bind9
# sudo systemctl start named     # RHEL/CentOS
# sudo systemctl enable named
```

## 3. 配置文件

### 3.1 文件位置

| 文件 | 说明 |
|------|------|
| /etc/bind/named.conf | 主配置（Debian/Ubuntu） |
| /etc/named.conf | 主配置（RHEL/CentOS） |
| /etc/bind/named.conf.options | 全局选项 |
| /etc/bind/named.conf.local | 本地区域配置 |
| /var/cache/bind/ | 区域文件目录 |

### 3.2 主配置

```bash
# /etc/bind/named.conf.options
options {
    directory "/var/cache/bind";

    # 允许查询的客户端
    allow-query { localhost; 192.168.1.0/24; };

    # 转发器（上游 DNS）
    forwarders {
        8.8.8.8;
        8.8.4.4;
    };

    # DNSSEC
    dnssec-validation auto;

    # 隐藏版本号
    version "not available";

    # 监听地址
    listen-on { 127.0.0.1; 192.168.1.100; };
    listen-on-v6 { any; };
};
```

## 4. 正向解析

### 4.1 配置区域

```bash
# /etc/bind/named.conf.local
zone "example.com" {
    type master;
    file "/etc/bind/zones/db.example.com";
    allow-transfer { 192.168.1.101; };    # 允许从服务器传输
};
```

### 4.2 区域文件

```bash
# /etc/bind/zones/db.example.com
$TTL    86400
@       IN      SOA     ns1.example.com. admin.example.com. (
                        2024010101      ; Serial（YYYYMMDDNN 格式）
                        3600            ; Refresh（1 小时）
                        1800            ; Retry（30 分钟）
                        604800          ; Expire（1 周）
                        86400           ; Minimum TTL（1 天）
                        )

; 域名服务器
        IN      NS      ns1.example.com.
        IN      NS      ns2.example.com.

; A 记录
        IN      A       192.168.1.100
ns1     IN      A       192.168.1.100
ns2     IN      A       192.168.1.101
www     IN      A       192.168.1.100
mail    IN      A       192.168.1.102
db      IN      A       192.168.1.103

; CNAME 记录
ftp     IN      CNAME   www.example.com.

; MX 记录
        IN      MX 10   mail.example.com.
```

## 5. 反向解析

### 5.1 配置区域

```bash
# /etc/bind/named.conf.local
zone "1.168.192.in-addr.arpa" {
    type master;
    file "/etc/bind/zones/db.192.168.1";
};
```

### 5.2 反向区域文件

```bash
# /etc/bind/zones/db.192.168.1
$TTL    86400
@       IN      SOA     ns1.example.com. admin.example.com. (
                        2024010101      ; Serial
                        3600            ; Refresh
                        1800            ; Retry
                        604800          ; Expire
                        86400           ; Minimum
                        )

; 域名服务器
        IN      NS      ns1.example.com.
        IN      NS      ns2.example.com.

; PTR 记录
100     IN      PTR     example.com.
100     IN      PTR     www.example.com.
101     IN      PTR     ns2.example.com.
102     IN      PTR     mail.example.com.
103     IN      PTR     db.example.com.
```

## 6. 主从 DNS

### 6.1 主服务器配置

```bash
# /etc/bind/named.conf.local
zone "example.com" {
    type master;
    file "/etc/bind/zones/db.example.com";
    allow-transfer { 192.168.1.101; };
    also-notify { 192.168.1.101; };
};
```

### 6.2 从服务器配置

```bash
# 安装 BIND
sudo apt install bind9

# /etc/bind/named.conf.local
zone "example.com" {
    type slave;
    file "/var/cache/bind/db.example.com";
    masters { 192.168.1.100; };
};
```

## 7. 测试和调试

```bash
# 测试配置文件
sudo named-checkconf
sudo named-checkzone example.com /etc/bind/zones/db.example.com

# 使用 nslookup 测试
nslookup example.com localhost
nslookup www.example.com 192.168.1.100

# 使用 dig 测试
dig @localhost example.com
dig @192.168.1.100 example.com A
dig @192.168.1.100 -x 192.168.1.100    # 反向解析

# 查看日志
sudo journalctl -u named -f
```

## 参考资料

- BIND 9 官方文档 — [bind9.readthedocs.io](https://bind9.readthedocs.io/)
- 鸟哥的私房菜 - DNS — [linux.vbird.org](https://linux.vbird.org/linux_server/0350dns.php)
- RFC 1034/1035 — DNS 规范
