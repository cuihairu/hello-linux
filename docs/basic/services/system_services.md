# 系统服务管理

systemd 是现代 Linux 发行版的初始化系统和服务管理器。

> 内容参考自 Arch Wiki systemd 文档，见文末参考资料。

## 1. systemctl 基本操作

```bash
# 启动服务
sudo systemctl start service_name

# 停止服务
sudo systemctl stop service_name

# 重启服务
sudo systemctl restart service_name

# 重新加载配置
sudo systemctl reload service_name

# 查看状态
systemctl status service_name

# 开机自启
sudo systemctl enable service_name

# 禁用开机自启
sudo systemctl disable service_name

# 列出所有服务
systemctl list-units --type=service
```

## 2. 系统操作

```bash
# 重启
sudo systemctl reboot

# 关机
sudo systemctl poweroff
```

## 3. 运行级别

| 目标 | 说明 |
|------|------|
| multi-user.target | 命令行模式 |
| graphical.target | 图形模式 |

```bash
# 设置默认运行级别
sudo systemctl set-default multi-user.target
```

## 4. 查看日志

```bash
# 查看服务日志
sudo journalctl -u service_name

# 实时查看
sudo journalctl -u service_name -f
```

## 两系差异

两系均使用 systemd，命令一致。

## 参考资料

- `man systemctl`、`man journalctl`
- Arch Wiki - systemd — [wiki.archlinux.org](https://wiki.archlinux.org/title/systemd)
