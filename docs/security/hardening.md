# 安全加固

安全加固是通过配置和优化系统来减少攻击面的过程。

> 内容参考自 CIS Benchmarks、安全厂商文档和实际运维经验，见文末参考资料。

## 学习目标

- 掌握系统加固最佳实践
- 学会最小权限原则配置
- 了解安全审计和合规检查

## 1. 系统加固

### 1.1 最小安装原则

```bash
# 只安装必要的软件包
# 删除不需要的服务
sudo apt purge telnet rsh-client rsh-server

# 禁用不需要的服务
sudo systemctl disable avahi-daemon
sudo systemctl disable cups
```

### 1.2 内核加固

```bash
# /etc/sysctl.conf
# 禁用 IP 转发
net.ipv4.ip_forward = 0

# 禁用 ICMP 重定向
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0

# 启用 SYN Cookie
net.ipv4.tcp_syncookies = 1

# 禁用源路由
net.ipv4.conf.all.accept_source_route = 0

# 启用反向路径过滤
net.ipv4.conf.all.rp_filter = 1

# 应用配置
sudo sysctl -p
```

### 1.3 文件系统加固

```bash
# 设置重要文件权限
sudo chmod 600 /etc/shadow
sudo chmod 600 /etc/gshadow
sudo chmod 644 /etc/passwd
sudo chmod 644 /etc/group

# 设置不可变属性
sudo chattr +i /etc/passwd
sudo chattr +i /etc/shadow

# 检查 SUID/SGID 文件
find / -type f \( -perm -4000 -o -perm -2000 \) -exec ls -l {} \;
```

## 2. 用户安全

### 2.1 密码策略

```bash
# /etc/login.defs
PASS_MAX_DAYS 90
PASS_MIN_DAYS 7
PASS_MIN_LEN 12
PASS_WARN_AGE 14

# 安装密码质量检查
sudo apt install libpam-pwquality

# /etc/security/pwquality.conf
minlen = 12
dcredit = -1
ucredit = -1
ocredit = -1
lcredit = -1
```

### 2.2 账户锁定

```bash
# /etc/pam.d/common-auth
auth required pam_tally2.so deny=5 unlock_time=900

# 查看锁定账户
sudo pam_tally2 --user username

# 解锁账户
sudo pam_tally2 --user username --reset
```

### 2.3 sudo 配置

```bash
# /etc/sudoers.d/custom
# 限制 sudo 命令
username ALL=(ALL) /usr/bin/systemctl, /usr/bin/apt

# 要求密码
Defaults timestamp_timeout=0

# 记录 sudo 日志
Defaults logfile="/var/log/sudo.log"
```

## 3. 网络安全

### 3.1 防火墙配置

```bash
# 默认拒绝策略
sudo iptables -P INPUT DROP
sudo iptables -P FORWARD DROP
sudo iptables -P OUTPUT ACCEPT

# 只允许必要端口
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```

### 3.2 网络服务加固

```bash
# SSH 加固
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
Port 2222
MaxAuthTries 3
AllowUsers username

# 禁用不需要的服务
sudo systemctl disable rpcbind
sudo systemctl disable nfs-server
```

### 3.3 网络监控

```bash
# 安装入侵检测
sudo apt install fail2ban
sudo apt install aide

# 监控网络连接
sudo netstat -tulnp
sudo ss -tulnp
```

## 4. 服务加固

### 4.1 Web 服务器

```bash
# Nginx 安全配置
# 隐藏版本信息
server_tokens off;

# 安全 Headers
add_header X-Frame-Options "SAMEORIGIN";
add_header X-Content-Type-Options "nosniff";
add_header X-XSS-Protection "1; mode=block";

# 限制请求大小
client_max_body_size 10m;
```

### 4.2 数据库服务器

```bash
# MySQL 安全配置
# 删除匿名用户
DELETE FROM mysql.user WHERE User='';

# 禁止远程 root 登录
DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');

# 删除测试数据库
DROP DATABASE IF EXISTS test;
```

### 4.3 邮件服务器

```bash
# Postfix 安全配置
# 限制中继
smtpd_relay_restrictions = permit_mynetworks, permit_sasl_authenticated, reject_unauth_destination

# 启用 TLS
smtpd_use_tls = yes
smtpd_tls_cert_file = /etc/ssl/certs/mail.pem
smtpd_tls_key_file = /etc/ssl/private/mail.key
```

## 5. 审计和监控

### 5.1 系统审计

```bash
# 安装审计框架
sudo apt install auditd

# 配置审计规则
# /etc/audit/rules.d/custom.rules
-w /etc/passwd -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/sudoers -p wa -k sudoers

# 启动服务
sudo systemctl start auditd
sudo systemctl enable auditd

# 查看审计日志
sudo ausearch -k identity
```

### 5.2 日志监控

```bash
# 集中日志管理
# 安装 rsyslog
sudo apt install rsyslog

# 配置远程日志
# /etc/rsyslog.conf
*.* @logserver.example.com:514

# 日志轮转
# /etc/logrotate.d/custom
/var/log/custom/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
}
```

### 5.3 文件完整性检查

```bash
# 安装 AIDE
sudo apt install aide

# 初始化数据库
sudo aideinit

# 定期检查
sudo crontab -e
0 3 * * * /usr/bin/aide --check | mail -s "AIDE Report" admin@example.com
```

## 6. 合规检查

### 6.1 CIS Benchmarks

```bash
# 下载 CIS 脚本
wget https://github.com/CISOfy/lynis/archive/refs/tags/3.0.8.tar.gz
tar -xzf 3.0.8.tar.gz
cd lynis-3.0.8

# 运行检查
sudo ./lynis audit system

# 查看报告
sudo cat /var/log/lynis.log
```

### 6.2 漏洞扫描

```bash
# 安装 OpenVAS
sudo apt install openvas

# 运行扫描
sudo gvm-start

# 访问 Web 界面
# https://localhost:9392
```

## 7. 实战案例

### 7.1 服务器加固脚本

```bash
#!/bin/bash
# 服务器加固脚本

# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装安全工具
sudo apt install -y fail2ban aide auditd

# 配置防火墙
sudo iptables -P INPUT DROP
sudo iptables -P FORWARD DROP
sudo iptables -P OUTPUT ACCEPT
sudo iptables -A INPUT -i lo -j ACCEPT
sudo iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables-save > /etc/iptables/rules.v4

# 配置 SSH
sudo sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# 初始化 AIDE
sudo aideinit

# 启动服务
sudo systemctl enable fail2ban auditd
sudo systemctl start fail2ban auditd

echo "加固完成"
```

### 7.2 安全检查脚本

```bash
#!/bin/bash
# 安全检查脚本

echo "=== 安全检查报告 ==="
echo ""

# 检查开放端口
echo "开放端口:"
sudo netstat -tulnp | grep LISTEN

# 检查 SUID 文件
echo ""
echo "SUID 文件:"
find / -type f -perm -4000 -exec ls -l {} \; 2>/dev/null

# 检查密码策略
echo ""
echo "密码策略:"
grep -E "^PASS_MAX_DAYS|^PASS_MIN_DAYS|^PASS_MIN_LEN" /etc/login.defs

# 检查 SSH 配置
echo ""
echo "SSH 配置:"
grep -E "^PermitRootLogin|^PasswordAuthentication" /etc/ssh/sshd_config

# 检查防火墙规则
echo ""
echo "防火墙规则:"
sudo iptables -L -n
```

## 参考资料

- [CIS Benchmarks](https://www.cisecurity.org/cis-benchmarks/)
- [Ubuntu 安全指南](https://ubuntu.com/server/docs/security)
- [Red Hat 安全指南](https://www.redhat.com/en/topics/security)
- [Lynis 安全审计工具](https://cisofy.com/lynis/)