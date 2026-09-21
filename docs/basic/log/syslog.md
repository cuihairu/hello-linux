# 系统日志

## 学习目标

- 理解系统日志的架构和作用
- 掌握 rsyslog 的配置方法
- 学会分析和管理系统日志

## 1. 系统日志架构

### 1.1 rsyslog 简介

rsyslog 是大多数 Linux 发行版使用的系统日志服务。

主要功能：
- 接收系统日志消息
- 分类存储日志
- 支持远程日志传输
- 支持日志过滤

### 1.2 日志级别

| 级别 | 代码 | 说明 |
|------|------|------|
| emerg | 0 | 系统不可用 |
| alert | 1 | 需要立即处理 |
| crit | 2 | 严重条件 |
| err | 3 | 错误条件 |
| warning | 4 | 警告条件 |
| notice | 5 | 正常但重要 |
| info | 6 | 信息性消息 |
| debug | 7 | 调试消息 |

## 2. 日志配置

### 2.1 主配置文件

```bash
# rsyslog 主配置
/etc/rsyslog.conf

# 额外配置
/etc/rsyslog.d/
```

### 2.2 配置语法

```bash
# 设施.级别 动作
auth,authpriv.*    /var/log/auth.log
*.*;auth,authpriv.none    /var/log/syslog
```

### 2.3 常见设施

| 设施 | 说明 |
|------|------|
| auth | 认证相关 |
| authpriv | 私有认证 |
| cron | 定时任务 |
| daemon | 守护进程 |
| kern | 内核消息 |
| mail | 邮件系统 |
| syslog | 系统日志 |
| user | 用户程序 |

## 3. 日志文件说明

### 3.1 Debian/Ubuntu

```bash
# 系统日志
/var/log/syslog

# 认证日志
/var/log/auth.log

# 内核日志
/var/log/kern.log

# 邮件日志
/var/log/mail.log

# 定时任务日志
/var/log/cron.log
```

### 3.2 RHEL/CentOS

```bash
# 系统日志
/var/log/messages

# 认证日志
/var/log/secure

# 内核日志
/var/log/dmesg

# 邮件日志
/var/log/maillog

# 定时任务日志
/var/log/cron
```

## 4. 日志查看命令

### 4.1 基本查看

```bash
# 查看日志文件
cat /var/log/syslog

# 查看最后几行
tail -n 100 /var/log/syslog

# 实时查看
tail -f /var/log/syslog

# 搜索日志
grep "error" /var/log/syslog
```

### 4.2 高级查看

```bash
# 按时间过滤
awk '/Jan 1 10:00/,/Jan 1 11:00/' /var/log/syslog

# 统计错误数量
grep -c "error" /var/log/syslog

# 查看最频繁的错误
grep "error" /var/log/syslog | sort | uniq -c | sort -rn
```

## 5. 远程日志配置

### 5.1 发送端配置

```bash
# 编辑 rsyslog 配置
sudo vim /etc/rsyslog.conf

# 添加远程日志配置
*.* @remote-server:514    # UDP
*.* @@remote-server:514   # TCP
```

### 5.2 接收端配置

```bash
# 编辑 rsyslog 配置
sudo vim /etc/rsyslog.conf

# 启用 UDP 接收
$ModLoad imudp
$UDPServerRun 514

# 启用 TCP 接收
$ModLoad imtcp
$InputTCPServerRun 514
```

## 6. 日志轮转

### 6.1 logrotate 配置

```bash
# 主配置文件
/etc/logrotate.conf

# 应用配置
/etc/logrotate.d/
```

### 6.2 配置示例

```bash
# /etc/logrotate.d/syslog
/var/log/syslog {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 0640 root adm
    postrotate
        /usr/lib/rsyslog/rsyslog-rotate
    endscript
}
```

## 7. 日志分析工具

### 7.1 logwatch

```bash
# 安装
sudo apt install logwatch    # Debian/Ubuntu
sudo yum install logwatch    # RHEL/CentOS

# 生成报告
sudo logwatch --detail high --range today
```

### 7.2 goaccess

```bash
# 安装
sudo apt install goaccess    # Debian/Ubuntu
sudo yum install goaccess    # RHEL/CentOS

# 分析 Web 日志
goaccess /var/log/apache2/access.log --log-format=COMBINED
```

## 8. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 系统日志 | /var/log/syslog | /var/log/messages |
| 认证日志 | /var/log/auth.log | /var/log/secure |
| 日志服务 | rsyslog | rsyslog |

## 参考资料

- [鸟哥的私房菜 - 日志文件](https://linux.vbird.org/linux_basic/0570syslog.php)
- [Arch Wiki - rsyslog](https://wiki.archlinux.org/title/Rsyslog)
- [rsyslog 文档](https://www.rsyslog.com/doc/)
