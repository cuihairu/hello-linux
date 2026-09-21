# 防火墙

防火墙用于控制网络流量，保护系统安全。

> 内容参考自 Arch Wiki 和各工具文档，见文末参考资料。

## 1. ufw（Ubuntu）

```bash
# 启用
sudo ufw enable

# 查看状态
sudo ufw status

# 允许端口
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# 拒绝端口
sudo ufw deny 23/tcp

# 删除规则
sudo ufw delete allow 22/tcp

# 允许特定 IP
sudo ufw allow from 192.168.1.100
```

## 2. firewalld（RHEL/CentOS）

```bash
# 启动
sudo systemctl start firewalld

# 查看状态
sudo firewall-cmd --state

# 允许端口
sudo firewall-cmd --add-port=80/tcp --permanent

# 允许服务
sudo firewall-cmd --add-service=http --permanent

# 重新加载
sudo firewall-cmd --reload

# 查看规则
sudo firewall-cmd --list-all
```

## 3. iptables

```bash
# 查看规则
sudo iptables -L

# 允许端口
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT

# 拒绝端口
sudo iptables -A INPUT -p tcp --dport 23 -j DROP

# 保存规则
sudo iptables-save > /etc/iptables/rules.v4
```

## 两系对比

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 工具 | ufw | firewalld |
| 底层 | iptables | iptables/nftables |

## 参考资料

- Arch Wiki - ufw — [wiki.archlinux.org](https://wiki.archlinux.org/title/Ufw)
- Arch Wiki - iptables — [wiki.archlinux.org](https://wiki.archlinux.org/title/Iptables)
- `man ufw`、`man firewall-cmd`
