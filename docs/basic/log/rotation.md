# 日志轮转

## 学习目标

- 理解日志轮转的概念和作用
- 掌握 logrotate 的配置方法
- 学会管理日志文件

## 1. 日志轮转简介

日志轮转用于管理日志文件的大小和数量，防止单个日志文件过大。

### 1.1 为什么需要日志轮转

- 防止磁盘空间耗尽
- 便于日志管理和分析
- 满足合规要求
- 提高系统性能

### 1.2 轮转方式

- **按时间**：每天、每周、每月
- **按大小**：当日志文件达到指定大小
- **手动**：根据需要手动轮转

## 2. logrotate 配置

### 2.1 主配置文件

```bash
# 主配置文件
/etc/logrotate.conf

# 默认配置
weekly
rotate 4
create
dateext
compress

# 包含其他配置
include /etc/logrotate.d
```

### 2.2 应用配置

```bash
# 应用配置目录
/etc/logrotate.d/

# 常见配置文件
/etc/logrotate.d/syslog
/etc/logrotate.d/apache2
/etc/logrotate.d/nginx
```

## 3. 配置选项

### 3.1 基本选项

| 选项 | 说明 |
|------|------|
| daily | 每天轮转 |
| weekly | 每周轮转 |
| monthly | 每月轮转 |
| rotate N | 保留 N 个日志文件 |
| compress | 压缩旧日志 |
| delaycompress | 延迟压缩 |
| missingok | 日志文件不存在时不报错 |
| notifempty | 空日志不轮转 |
| create mode owner group | 创建新日志文件的权限 |

### 3.2 高级选项

| 选项 | 说明 |
|------|------|
| size | 按大小轮转 |
| maxsize | 最大大小 |
| minsize | 最小大小 |
| maxage | 最大保留天数 |
| dateext | 使用日期作为扩展名 |
| dateformat | 日期格式 |
| postrotate | 轮转后执行的命令 |
| prerotate | 轮转前执行的命令 |

## 4. 配置示例

### 4.1 系统日志

```bash
# /etc/logrotate.d/syslog
/var/log/syslog
/var/log/messages
{
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

### 4.2 Apache 日志

```bash
# /etc/logrotate.d/apache2
/var/log/apache2/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 root adm
    sharedscripts
    postrotate
        /etc/init.d/apache2 reload > /dev/null
    endscript
}
```

### 4.3 Nginx 日志

```bash
# /etc/logrotate.d/nginx
/var/log/nginx/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 `cat /var/run/nginx.pid`
    endscript
}
```

## 5. 管理命令

### 5.1 手动轮转

```bash
# 强制轮转所有日志
sudo logrotate -f /etc/logrotate.conf

# 轮转特定配置
sudo logrotate -f /etc/logrotate.d/syslog

# 测试轮转（不实际执行）
sudo logrotate -d /etc/logrotate.conf
```

### 5.2 查看状态

```bash
# 查看轮转状态
cat /var/lib/logrotate/status

# 查看最近轮转时间
ls -la /var/lib/logrotate/
```

## 6. 自定义轮转

### 6.1 按大小轮转

```bash
# /etc/logrotate.d/myapp
/var/log/myapp/*.log {
    size 100M
    rotate 5
    compress
    missingok
    notifempty
}
```

### 6.2 按时间轮转

```bash
# /etc/logrotate.d/myapp
/var/log/myapp/*.log {
    daily
    rotate 30
    compress
    missingok
    notifempty
    dateext
    dateformat -%Y%m%d
}
```

## 7. 常见问题

### 7.1 日志文件权限问题

```bash
# 检查权限
ls -la /var/log/syslog

# 修复权限
sudo chmod 640 /var/log/syslog
sudo chown root:adm /var/log/syslog
```

### 7.2 轮转不生效

```bash
# 检查配置语法
sudo logrotate -d /etc/logrotate.conf

# 检查 cron 任务
sudo systemctl status cron

# 手动执行
sudo logrotate -f /etc/logrotate.d/syslog
```

### 7.3 磁盘空间不足

```bash
# 查看日志大小
du -sh /var/log/*

# 清理旧日志
sudo find /var/log -name "*.gz" -mtime +30 -delete

# 压缩日志
sudo gzip /var/log/syslog.1
```

## 8. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 配置目录 | /etc/logrotate.d/ | /etc/logrotate.d/ |
| 状态文件 | /var/lib/logrotate/status | /var/lib/logrotate/status |
| 命令 | logrotate | logrotate |

## 参考资料

- [鸟哥的私房菜 - 日志轮转](https://linux.vbird.org/linux_basic/0570syslog.php#rotate)
- [Arch Wiki - Logrotate](https://wiki.archlinux.org/title/Logrotate)
- [logrotate 手册](https://man7.org/linux/man-pages/man8/logrotate.8.html)
