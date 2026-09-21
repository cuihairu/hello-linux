# 日志管理

Linux 使用 rsyslog 和 journald 管理系统日志。

> 内容参考自 Arch Wiki 和 rsyslog 文档，见文末参考资料。

## 1. 日志文件位置

| 日志 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 系统日志 | /var/log/syslog | /var/log/messages |
| 认证日志 | /var/log/auth.log | /var/log/secure |
| 内核日志 | /var/log/kern.log | /var/log/dmesg |

## 2. 查看日志

```bash
# 查看日志文件
cat /var/log/syslog

# 实时查看
tail -f /var/log/syslog

# 搜索日志
grep "error" /var/log/syslog
```

## 3. journalctl

```bash
# 查看所有日志
journalctl

# 查看系统启动日志
journalctl -b

# 查看指定服务
journalctl -u service_name

# 实时查看
journalctl -f

# 按时间过滤
journalctl --since "2024-01-01" --until "2024-01-02"
```

## 4. 日志轮转

logrotate 自动管理日志文件大小：

```bash
# 配置文件
/etc/logrotate.conf
/etc/logrotate.d/

# 手动轮转
sudo logrotate -f /etc/logrotate.conf
```

## 参考资料

- `man journalctl`、`man logrotate`
- Arch Wiki - systemd/Journal — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Journal)
