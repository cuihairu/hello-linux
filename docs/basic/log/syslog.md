# 系统日志

rsyslog 是大多数 Linux 发行版使用的系统日志服务。

> 内容参考自 rsyslog 文档和 Arch Wiki，见文末参考资料。

## 1. 日志级别

| 级别 | 说明 |
|------|------|
| emerg | 系统不可用 |
| alert | 需要立即处理 |
| crit | 严重条件 |
| err | 错误条件 |
| warning | 警告条件 |
| notice | 正常但重要 |
| info | 信息性消息 |
| debug | 调试消息 |

## 2. 配置文件

```bash
/etc/rsyslog.conf
/etc/rsyslog.d/
```

## 3. 查看日志

```bash
# 查看系统日志
cat /var/log/syslog          # Debian/Ubuntu
cat /var/log/messages        # RHEL/CentOS

# 实时查看
tail -f /var/log/syslog

# 搜索
grep "error" /var/log/syslog
```

## 4. journalctl

```bash
journalctl                  # 所有日志
journalctl -b               # 本次启动
journalctl -u nginx         # 指定服务
journalctl -f               # 实时查看
journalctl -p err           # 按级别过滤
```

## 参考资料

- `man rsyslog.conf`、`man journalctl`
- Arch Wiki - rsyslog — [wiki.archlinux.org](https://wiki.archlinux.org/title/Rsyslog)
