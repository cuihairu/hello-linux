# 入侵检测

入侵检测系统（IDS）用于监控和检测恶意活动。

> 内容参考自 Fail2Ban、AIDE、OSSEC 官方文档和实际运维经验，见文末参考资料。

## 学习目标

- 掌握 Fail2Ban 配置和使用
- 学会使用 AIDE 进行文件完整性检查
- 了解 OSSEC 入侵检测系统

## 1. Fail2Ban

### 1.1 基本概念

```bash
# Fail2Ban 通过监控日志文件来阻止恶意 IP
# 支持多种服务：SSH、Apache、Nginx 等
```

### 1.2 安装和配置

```bash
# 安装
sudo apt install fail2ban

# 启动服务
sudo systemctl start fail2ban
sudo systemctl enable fail2ban

# 查看状态
sudo systemctl status fail2ban
```

### 1.3 配置文件

```bash
# 主配置文件
/etc/fail2ban/fail2ban.conf

# 监狱配置文件
/etc/fail2ban/jail.conf

# 自定义配置（推荐）
/etc/fail2ban/jail.local
```

### 1.4 SSH 保护

```bash
# /etc/fail2ban/jail.local
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
```

### 1.5 常用命令

```bash
# 查看所有监狱
sudo fail2ban-client status

# 查看特定监狱状态
sudo fail2ban-client status sshd

# 手动封禁 IP
sudo fail2ban-client set sshd banip 192.168.1.100

# 手动解封 IP
sudo fail2ban-client set sshd unbanip 192.168.1.100

# 查看封禁日志
sudo tail -f /var/log/fail2ban.log
```

### 1.6 自定义过滤器

```bash
# /etc/fail2ban/filter.d/myfilter.conf
[Definition]
failregex = ^.*Failed password for .* from <HOST>.*$
            ^.*Invalid user .* from <HOST>.*$
ignoreregex =
```

## 2. AIDE

### 2.1 基本概念

```bash
# AIDE (Advanced Intrusion Detection Environment)
# 通过检查文件完整性来检测入侵
```

### 2.2 安装和配置

```bash
# 安装
sudo apt install aide

# 初始化数据库
sudo aideinit

# 检查完整性
sudo aide --check

# 更新数据库
sudo aide --update
```

### 2.3 配置文件

```bash
# 主配置文件
/etc/aide/aide.conf

# 示例配置
/etc/aide/aide.conf.d/
```

### 2.4 配置示例

```bash
# /etc/aide/aide.conf
# 数据库位置
database_in=file:/var/lib/aide/aide.db
database_out=file:/var/lib/aide/aide.db.new

# 规则
NORMAL = p+i+n+u+g+s+m+c+sha256
DIR = p+i+n+u+g
LOG = p+i+n+u+g

# 监控目录
/boot NORMAL
/bin NORMAL
/sbin NORMAL
/lib NORMAL
/lib64 NORMAL
/etc NORMAL

# 忽略目录
!/var/log
!/var/spool
!/var/cache
```

### 2.5 定时检查

```bash
# 添加定时任务
sudo crontab -e

# 每天凌晨 3 点检查
0 3 * * * /usr/bin/aide --check | mail -s "AIDE Report" admin@example.com
```

## 3. OSSEC

### 3.1 基本概念

```bash
# OSSEC 是开源的主机入侵检测系统
# 支持日志分析、文件完整性检查、rootkit 检测
```

### 3.2 安装

```bash
# 下载安装包
wget https://github.com/ossec/ossec-hids/archive/3.6.0.tar.gz
tar -xzf 3.6.0.tar.gz
cd ossec-hids-3.6.0

# 安装
sudo ./install.sh

# 启动服务
sudo /var/ossec/bin/ossec-control start
```

### 3.3 配置

```bash
# 主配置文件
/var/ossec/etc/ossec.conf

# 示例配置
<ossec_config>
  <global>
    <email_notification>yes</email_notification>
    <email_to>admin@example.com</email_to>
    <smtp_server>localhost</smtp_server>
  </global>
  
  <rules>
    <include>rules_config.xml</include>
    <include>pam_rules.xml</include>
    <include>sshd_rules.xml</include>
  </rules>
  
  <syscheck>
    <frequency>7200</frequency>
    <directories check_all="yes">/etc,/usr/bin,/usr/sbin</directories>
  </syscheck>
  
  <rootcheck>
    <frequency>86400</frequency>
  </rootcheck>
</ossec_config>
```

### 3.4 管理命令

```bash
# 查看状态
sudo /var/ossec/bin/ossec-control status

# 查看日志
sudo tail -f /var/ossec/logs/ossec.log

# 查看告警
sudo tail -f /var/ossec/logs/alerts/alerts.log
```

## 4. rkhunter

### 4.1 基本概念

```bash
# rkhunter (Rootkit Hunter)
# 检测 rootkit、后门、漏洞
```

### 4.2 安装和使用

```bash
# 安装
sudo apt install rkhunter

# 更新数据库
sudo rkhunter --update

# 检查系统
sudo rkhunter --check

# 查看日志
sudo cat /var/log/rkhunter.log
```

### 4.3 配置

```bash
# 主配置文件
/etc/rkhunter.conf

# 常用配置
ALLOWHIDDENDIR="/etc/.java"
ALLOWHIDDENFILE="/etc/.pwd.lock"
```

## 5. 日志监控

### 5.1 使用 logwatch

```bash
# 安装
sudo apt install logwatch

# 查看日志报告
sudo logwatch --detail high --range today
```

### 5.2 使用 multitail

```bash
# 安装
sudo apt install multitail

# 监控多个日志
sudo multitail /var/log/syslog /var/log/auth.log
```

## 6. 实战案例

### 6.1 SSH 防护配置

```bash
# /etc/fail2ban/jail.local
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 86400
findtime = 600

[sshd-ddos]
enabled = true
port = ssh
filter = sshd-ddos
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600
```

### 6.2 Web 服务器防护

```bash
# /etc/fail2ban/jail.local
[nginx-http-auth]
enabled = true
port = http,https
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 3
bantime = 3600

[nginx-botsearch]
enabled = true
port = http,https
filter = nginx-botsearch
logpath = /var/log/nginx/access.log
maxretry = 2
bantime = 86400
```

### 6.3 文件完整性检查

```bash
#!/bin/bash
# 文件完整性检查脚本

# 初始化 AIDE 数据库
if [ ! -f /var/lib/aide/aide.db ]; then
    sudo aideinit
fi

# 检查完整性
report=$(sudo aide --check)

if [ -n "$report" ]; then
    echo "文件完整性检查发现问题:"
    echo "$report"
    echo "$report" | mail -s "AIDE Alert" admin@example.com
fi
```

## 参考资料

- [Fail2Ban 文档](https://www.fail2ban.org/)
- [AIDE 文档](https://aide.github.io/)
- [OSSEC 文档](https://www.ossec.net/docs/)
- [rkhunter 文档](http://rkhunter.sourceforge.net/)