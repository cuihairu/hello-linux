# 防火墙

## 学习目标

- 理解防火墙的工作原理
- 掌握 ufw 和 firewalld 的使用方法
- 学会配置网络安全策略

## 1. 防火墙基础

### 1.1 什么是防火墙

防火墙是网络安全系统，用于监控和控制网络流量。

### 1.2 防火墙类型

| 类型 | 说明 |
|------|------|
| 包过滤 | 基于 IP、端口过滤 |
| 状态检测 | 跟踪连接状态 |
| 应用层 | 基于应用协议过滤 |

## 2. iptables

### 2.1 iptables 概述

iptables 是 Linux 内核内置的防火墙工具。

```bash
# 查看规则
sudo iptables -L

# 查看详细规则
sudo iptables -L -v

# 查看 NAT 规则
sudo iptables -t nat -L
```

### 2.2 基本操作

```bash
# 允许 TCP 端口 80
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT

# 允许 UDP 端口 53
sudo iptables -A INPUT -p udp --dport 53 -j ACCEPT

# 拒绝 TCP 端口 23
sudo iptables -A INPUT -p tcp --dport 23 -j DROP

# 允许特定 IP
sudo iptables -A INPUT -s 192.168.1.100 -j ACCEPT

# 拒绝所有其他流量
sudo iptables -A INPUT -j DROP
```

### 2.3 保存规则

```bash
# Debian/Ubuntu
sudo iptables-save > /etc/iptables/rules.v4

# RHEL/CentOS
sudo service iptables save
```

## 3. ufw（Ubuntu）

### 3.1 基本操作

```bash
# 启用防火墙
sudo ufw enable

# 禁用防火墙
sudo ufw disable

# 查看状态
sudo ufw status

# 查看详细状态
sudo ufw status verbose
```

### 3.2 规则管理

```bash
# 允许端口
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 允许端口范围
sudo ufw allow 1000:2000/tcp

# 拒绝端口
sudo ufw deny 23/tcp

# 删除规则
sudo ufw delete allow 22/tcp

# 允许特定 IP
sudo ufw allow from 192.168.1.100

# 允许特定 IP 访问特定端口
sudo ufw allow from 192.168.1.100 to any port 22
```

### 3.3 应用配置

```bash
# 查看可用应用
sudo ufw app list

# 允许应用
sudo ufw allow 'OpenSSH'
sudo ufw allow 'Apache Full'
```

## 4. firewalld（RHEL/CentOS）

### 4.1 基本操作

```bash
# 启动服务
sudo systemctl start firewalld

# 停止服务
sudo systemctl stop firewalld

# 查看状态
sudo firewall-cmd --state

# 重新加载规则
sudo firewall-cmd --reload
```

### 4.2 区域管理

```bash
# 查看默认区域
sudo firewall-cmd --get-default-zone

# 查看所有区域
sudo firewall-cmd --get-zones

# 查看区域规则
sudo firewall-cmd --zone=public --list-all

# 设置默认区域
sudo firewall-cmd --set-default-zone=public
```

### 4.3 规则管理

```bash
# 允许端口
sudo firewall-cmd --add-port=80/tcp --permanent
sudo firewall-cmd --add-port=443/tcp --permanent

# 删除端口
sudo firewall-cmd --remove-port=80/tcp --permanent

# 允许服务
sudo firewall-cmd --add-service=http --permanent
sudo firewall-cmd --add-service=https --permanent

# 删除服务
sudo firewall-cmd --remove-service=http --permanent

# 重新加载
sudo firewall-cmd --reload
```

### 4.4 端口转发

```bash
# 启用端口转发
sudo firewall-cmd --add-forward-port=port=80:proto=tcp:toport=8080 --permanent

# 重新加载
sudo firewall-cmd --reload
```

## 5. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 防火墙工具 | ufw | firewalld |
| 底层实现 | iptables | iptables/nftables |
| 配置方式 | 命令行 | 命令行/图形界面 |

## 6. 最佳实践

1. **最小权限原则**：只开放必要的端口
2. **定期审查规则**：删除不需要的规则
3. **备份规则**：保存防火墙配置
4. **监控日志**：查看防火墙日志

## 参考资料

- [鸟哥的私房菜 - 防火墙](https://linux.vbird.org/linux_server/0250simple_firewall.php)
- [Arch Wiki - iptables](https://wiki.archlinux.org/title/Iptables)
- [Arch Wiki - ufw](https://wiki.archlinux.org/title/Ufw)
- [RHEL 文档 - firewalld](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_networking/using-and-configuring-firewalld_configuring-and-managing-networking)
