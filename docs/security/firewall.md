# 防火墙

防火墙是网络安全的第一道防线，用于控制网络流量。

> 内容参考自 iptables 手册、nftables 文档和实际运维经验，见文末参考资料。

## 学习目标

- 掌握 iptables 基本配置
- 学会使用 nftables 和 firewalld
- 了解防火墙规则设计和优化

## 1. iptables

### 1.1 基本概念

```bash
# 四个表
filter    # 过滤表（默认）
nat       # 网络地址转换
mangle    # 数据包修改
raw       # 原始数据包

# 五个链
INPUT     # 入站流量
OUTPUT    # 出站流量
FORWARD   # 转发流量
PREROUTING  # 路由前
POSTROUTING # 路由后
```

### 1.2 基本命令

```bash
# 查看规则
sudo iptables -L -n -v

# 查看特定链
sudo iptables -L INPUT -n -v

# 清除所有规则
sudo iptables -F

# 设置默认策略
sudo iptables -P INPUT DROP
sudo iptables -P FORWARD DROP
sudo iptables -P OUTPUT ACCEPT
```

### 1.3 添加规则

```bash
# 允许 SSH
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# 允许 HTTP/HTTPS
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# 允许本地回环
sudo iptables -A INPUT -i lo -j ACCEPT

# 允许已建立的连接
sudo iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# 允许 ICMP (ping)
sudo iptables -A INPUT -p icmp --icmp-type echo-request -j ACCEPT
```

### 1.4 删除规则

```bash
# 按规则号删除
sudo iptables -D INPUT 3

# 按规则内容删除
sudo iptables -D INPUT -p tcp --dport 22 -j ACCEPT
```

### 1.5 保存规则

```bash
# Debian/Ubuntu
sudo iptables-save > /etc/iptables/rules.v4
sudo ip6tables-save > /etc/iptables/rules.v6

# 恢复规则
sudo iptables-restore < /etc/iptables/rules.v4

# 安装持久化工具
sudo apt install iptables-persistent
```

## 2. nftables

### 2.1 基本概念

```bash
# nftables 是 iptables 的替代品
# 更简洁的语法，更好的性能

# 查看规则
sudo nft list ruleset
```

### 2.2 基本配置

```bash
#!/usr/sbin/nft -f

# 清除所有规则
flush ruleset

# 定义表和链
table inet filter {
    chain input {
        type filter hook input priority 0; policy drop;
        
        # 允许本地回环
        iif lo accept
        
        # 允许已建立的连接
        ct state established,related accept
        
        # 允许 SSH
        tcp dport 22 accept
        
        # 允许 HTTP/HTTPS
        tcp dport { 80, 443 } accept
        
        # 允许 ICMP
        ip protocol icmp accept
        ip6 nexthdr icmpv6 accept
    }
    
    chain forward {
        type filter hook forward priority 0; policy drop;
    }
    
    chain output {
        type filter hook output priority 0; policy accept;
    }
}
```

### 2.3 常用命令

```bash
# 启动 nftables
sudo systemctl start nftables
sudo systemctl enable nftables

# 加载配置
sudo nft -f /etc/nftables.conf

# 查看规则
sudo nft list ruleset

# 添加规则
sudo nft add rule inet filter input tcp dport 80 accept
```

## 3. firewalld

### 3.1 基本概念

```bash
# 区域（zones）
# trusted    # 允许所有流量
# home       # 家庭网络
# internal   # 内部网络
# work       # 工作网络
# public     # 公共网络（默认）
# external   # 外部网络
# dmz        # 非军事区
# block      # 阻止所有流量
# drop       # 丢弃所有流量
```

### 3.2 常用命令

```bash
# 查看状态
sudo firewall-cmd --state

# 查看默认区域
sudo firewall-cmd --get-default-zone

# 查看所有区域
sudo firewall-cmd --get-zones

# 查看区域规则
sudo firewall-cmd --zone=public --list-all

# 添加服务
sudo firewall-cmd --zone=public --add-service=http --permanent
sudo firewall-cmd --zone=public --add-service=https --permanent

# 添加端口
sudo firewall-cmd --zone=public --add-port=8080/tcp --permanent

# 重新加载规则
sudo firewall-cmd --reload

# 移除服务
sudo firewall-cmd --zone=public --remove-service=http --permanent
```

### 3.3 高级配置

```bash
# 端口转发
sudo firewall-cmd --zone=public --add-forward-port=port=80:proto=tcp:toport=8080 --permanent

# 富规则（Rich Rules）
sudo firewall-cmd --zone=public --add-rich-rule='rule family="ipv4" source address="192.168.1.0/24" port port="22" protocol="tcp" accept' --permanent

# 伪装（Masquerade）
sudo firewall-cmd --zone=public --add-masquerade --permanent
```

## 4. 防火墙策略设计

### 4.1 默认拒绝策略

```bash
#!/bin/bash

# 清除规则
iptables -F

# 设置默认策略
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# 允许本地回环
iptables -A INPUT -i lo -j ACCEPT

# 允许已建立的连接
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# 允许 SSH（限制来源）
iptables -A INPUT -p tcp --dport 22 -s 192.168.1.0/24 -j ACCEPT

# 允许 HTTP/HTTPS
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# 允许 ICMP
iptables -A INPUT -p icmp --icmp-type echo-request -j ACCEPT

# 记录被拒绝的流量
iptables -A INPUT -j LOG --log-prefix "iptables-dropped: "

# 保存规则
iptables-save > /etc/iptables/rules.v4
```

### 4.2 速率限制

```bash
# 限制 SSH 连接速率
iptables -A INPUT -p tcp --dport 22 -m state --state NEW -m recent --set --name SSH
iptables -A INPUT -p tcp --dport 22 -m state --state NEW -m recent --update --seconds 60 --hitcount 4 --name SSH -j DROP

# 限制 ICMP 速率
iptables -A INPUT -p icmp --icmp-type echo-request -m limit --limit 1/s --limit-burst 4 -j ACCEPT
```

## 5. 实战案例

### 5.1 Web 服务器防火墙

```bash
#!/bin/bash
# Web 服务器防火墙配置

# 清除规则
iptables -F

# 默认策略
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# 允许本地回环
iptables -A INPUT -i lo -j ACCEPT

# 允许已建立的连接
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# 允许 SSH（限制来源）
iptables -A INPUT -p tcp --dport 22 -s 管理员IP -j ACCEPT

# 允许 HTTP/HTTPS
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# 允许 ICMP
iptables -A INPUT -p icmp --icmp-type echo-request -j ACCEPT

# 保存规则
iptables-save > /etc/iptables/rules.v4
```

### 5.2 数据库服务器防火墙

```bash
#!/bin/bash
# 数据库服务器防火墙配置

# 清除规则
iptables -F

# 默认策略
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# 允许本地回环
iptables -A INPUT -i lo -j ACCEPT

# 允许已建立的连接
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# 允许 SSH（限制来源）
iptables -A INPUT -p tcp --dport 22 -s 管理员IP -j ACCEPT

# 允许 MySQL（限制来源）
iptables -A INPUT -p tcp --dport 3306 -s 192.168.1.0/24 -j ACCEPT

# 保存规则
iptables-save > /etc/iptables/rules.v4
```

## 参考资料

- `man iptables`, `man nft`, `man firewall-cmd`
- [iptables 手册](https://www.netfilter.org/documentation/)
- [nftables 文档](https://www.netfilter.org/projects/nftables/)
- [firewalld 文档](https://firewalld.org/documentation/)