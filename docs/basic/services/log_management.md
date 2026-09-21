# 日志管理

## 学习目标

- 理解 Linux 日志系统的架构
- 掌握日志查看和分析方法
- 了解日志轮转配置

## 1. 日志系统简介

### 1.1 日志的重要性

- 故障排查
- 安全审计
- 性能监控
- 合规要求

### 1.2 日志系统架构

```
应用程序 → rsyslog → 日志文件
         ↓
       journald → 二进制日志
```

## 2. 常见日志文件

### 2.1 系统日志

```bash
# 系统日志
/var/log/syslog          # Debian/Ubuntu
/var/log/messages        # RHEL/CentOS

# 内核日志
/var/log/kern.log

# 认证日志
/var/log/auth.log        # Debian/Ubuntu
/var/log/secure          # RHEL/CentOS

# 启动日志
/var/log/boot.log
```

### 2.2 应用日志

```bash
# Web 服务器
/var/log/apache2/        # Debian/Ubuntu
/var/log/httpd/          # RHEL/CentOS

# 数据库
/var/log/mysql/
/var/log/postgresql/

# 邮件
/var/log/mail.log
```

## 3. 日志查看命令

### 3.1 基本查看

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

### 3.2 journalctl 命令

```bash
# 查看所有日志
journalctl

# 查看系统启动日志
journalctl -b

# 查看指定服务日志
journalctl -u service_name

# 实时查看
journalctl -f

# 查看指定时间范围
journalctl --since "2024-01-01" --until "2024-01-02"

# 查看指定优先级
journalctl -p err

# 查看内核日志
journalctl -k
```

## 4. 日志轮转

### 4.1 logrotate 配置

```bash
# 主配置文件
/etc/logrotate.conf

# 应用配置
/etc/logrotate.d/
```

### 4.2 配置示例

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

### 4.3 配置选项

| 选项 | 说明 |
|------|------|
| daily | 每天轮转 |
| weekly | 每周轮转 |
| monthly | 每月轮转 |
| rotate N | 保留 N 个日志文件 |
| compress | 压缩旧日志 |
| missingok | 日志文件不存在时不报错 |
| notifempty | 空日志不轮转 |
| create mode owner group | 创建新日志文件的权限 |

## 5. 远程日志

### 5.1 配置远程日志服务器

```bash
# 编辑 rsyslog 配置
sudo vim /etc/rsyslog.conf

# 添加远程日志配置
*.* @remote-server:514    # UDP
*.* @@remote-server:514   # TCP
```

### 5.2 接收远程日志

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

## 6. 日志分析工具

### 6.1 常用工具

```bash
# 统计错误数量
grep -c "error" /var/log/syslog

# 查看最频繁的错误
grep "error" /var/log/syslog | sort | uniq -c | sort -rn

# 查看特定时间段的日志
awk '/Jan 1 10:00/,/Jan 1 11:00/' /var/log/syslog
```

### 6.2 日志分析工具

- **logwatch**：日志分析和报告
- **goaccess**：实时日志分析
- **ELK Stack**：企业级日志分析

## 7. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 系统日志 | /var/log/syslog | /var/log/messages |
| 认证日志 | /var/log/auth.log | /var/log/secure |
| 日志服务 | rsyslog | rsyslog |
| 二进制日志 | journalctl | journalctl |

## 参考资料

- [鸟哥的私房菜 - 日志文件](https://linux.vbird.org/linux_basic/0570syslog.php)
- [Arch Wiki - systemd/Journal](https://wiki.archlinux.org/title/Systemd/Journal)
- [rsyslog 文档](https://www.rsyslog.com/doc/)
