# 系统服务管理

## 学习目标

- 理解 systemd 的概念和作用
- 掌握 systemctl 命令的使用
- 了解服务的启动、停止和状态管理

## 1. systemd 简介

systemd 是大多数现代 Linux 发行版的初始化系统和服务管理器。

### 1.1 systemd 的功能

- 系统初始化
- 服务管理
- 日志管理
- 定时任务
- 设备管理

### 1.2 服务单元类型

| 类型 | 文件扩展名 | 说明 |
|------|-----------|------|
| 服务单元 | .service | 系统服务 |
| 套接字单元 | .socket | 进程间通信 |
| 挂载单元 | .mount | 文件系统挂载 |
| 定时器单元 | .timer | 定时任务 |
| 目标单元 | .target | 服务组 |

## 2. systemctl 命令

### 2.1 服务管理

```bash
# 启动服务
sudo systemctl start service_name

# 停止服务
sudo systemctl stop service_name

# 重启服务
sudo systemctl restart service_name

# 重新加载配置
sudo systemctl reload service_name

# 查看服务状态
systemctl status service_name

# 启用服务（开机自启）
sudo systemctl enable service_name

# 禁用服务
sudo systemctl disable service_name

# 查看所有服务
systemctl list-units --type=service

# 查看所有启用的服务
systemctl list-unit-files --type=service
```

### 2.2 系统状态

```bash
# 查看系统状态
systemctl status

# 切换运行级别
sudo systemctl isolate multi-user.target  # 命令行模式
sudo systemctl isolate graphical.target   # 图形模式

# 设置默认运行级别
sudo systemctl set-default multi-user.target

# 重启系统
sudo systemctl reboot

# 关机
sudo systemctl poweroff
```

## 3. 服务单元文件

### 3.1 文件位置

```bash
# 系统服务
/usr/lib/systemd/system/    # 安装的服务
/etc/systemd/system/        # 自定义服务
/run/systemd/system/        # 运行时服务
```

### 3.2 单元文件示例

```ini
[Unit]
Description=My Service
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/my-service
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 3.3 常用配置项

```ini
[Unit]
Description=服务描述
After=依赖服务
Requires=必需服务
Wants=可选服务

[Service]
Type=服务类型
ExecStart=启动命令
ExecStop=停止命令
Restart=重启策略
RestartSec=重启间隔
User=运行用户
Group=运行组
WorkingDirectory=工作目录
Environment=环境变量

[Install]
WantedBy=目标单元
```

## 4. 常见服务示例

### 4.1 Web 服务

```bash
# Apache
sudo systemctl start apache2    # Debian/Ubuntu
sudo systemctl start httpd      # RHEL/CentOS

# Nginx
sudo systemctl start nginx
```

### 4.2 数据库服务

```bash
# MySQL
sudo systemctl start mysql      # Debian/Ubuntu
sudo systemctl start mysqld     # RHEL/CentOS

# PostgreSQL
sudo systemctl start postgresql
```

### 4.3 SSH 服务

```bash
# 启动 SSH
sudo systemctl start sshd

# 查看状态
systemctl status sshd

# 启用开机自启
sudo systemctl enable sshd
```

## 5. 服务日志

```bash
# 查看服务日志
sudo journalctl -u service_name

# 实时查看日志
sudo journalctl -u service_name -f

# 查看最近的日志
sudo journalctl -u service_name -n 100

# 查看指定时间范围的日志
sudo journalctl -u service_name --since "2024-01-01" --until "2024-01-02"
```

## 6. 运行级别

### 6.1 传统运行级别

| 级别 | 说明 |
|------|------|
| 0 | 关机 |
| 1 | 单用户模式 |
| 2 | 多用户模式（无网络） |
| 3 | 多用户模式（命令行） |
| 4 | 未使用 |
| 5 | 图形模式 |
| 6 | 重启 |

### 6.2 systemd 目标

| 目标 | 对应级别 |
|------|---------|
| poweroff.target | 0 |
| rescue.target | 1 |
| multi-user.target | 3 |
| graphical.target | 5 |
| reboot.target | 6 |

## 7. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 初始化系统 | systemd | systemd |
| 服务管理 | systemctl | systemctl |
| 日志 | journalctl | journalctl |
| 默认运行级别 | graphical.target | multi-user.target |

## 参考资料

- [鸟哥的私房菜 - 系统服务](https://linux.vbird.org/linux_basic/0560daemons.php)
- [Arch Wiki - systemd](https://wiki.archlinux.org/title/systemd)
- [systemd 手册](https://www.freedesktop.org/software/systemd/man/)
