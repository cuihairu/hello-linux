# 日志轮转

logrotate 自动管理日志文件大小和数量，防止日志占满磁盘。

> 内容参考自 logrotate 手册和 Arch Wiki，见文末参考资料。

## 1. 配置文件

```bash
/etc/logrotate.conf          # 主配置
/etc/logrotate.d/            # 应用配置
```

## 2. 配置示例

```bash
# /etc/logrotate.d/myapp
/var/log/myapp/*.log {
    daily                  # 每天轮转
    rotate 14              # 保留 14 个
    compress               # 压缩旧日志
    delaycompress          # 延迟压缩
    missingok              # 文件不存在不报错
    notifempty             # 空文件不轮转
    create 0640 root adm   # 新文件权限
}
```

## 3. 常用选项

| 选项 | 说明 |
|------|------|
| daily | 每天轮转 |
| weekly | 每周轮转 |
| monthly | 每月轮转 |
| rotate N | 保留 N 个文件 |
| size 100M | 按大小轮转 |
| compress | 压缩旧日志 |

## 4. 管理命令

```bash
# 测试配置
sudo logrotate -d /etc/logrotate.conf

# 强制轮转
sudo logrotate -f /etc/logrotate.conf
```

## 参考资料

- `man logrotate`
- Arch Wiki - Logrotate — [wiki.archlinux.org](https://wiki.archlinux.org/title/Logrotate)
