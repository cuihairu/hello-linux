# 目录层次结构

Linux 遵循 FHS（Filesystem Hierarchy Standard）标准，定义了目录结构和各目录的用途。

> 内容参考自 FHS 标准和 Arch Wiki，见文末参考资料。

## 学习目标

- 掌握 Linux 目录结构
- 了解各主要目录的用途

## 1. 目录结构

```
/
├── bin -> usr/bin        # 基本命令
├── sbin -> usr/sbin      # 系统管理命令
├── lib -> usr/lib        # 共享库
├── boot                  # 启动文件（内核、GRUB）
├── dev                   # 设备文件
├── etc                   # 配置文件
├── home                  # 用户主目录
├── media                 # 可移动设备挂载点
├── mnt                   # 临时挂载点
├── opt                   # 第三方软件
├── proc                  # 进程信息（虚拟文件系统）
├── root                  # root 用户主目录
├── run                   # 运行时数据
├── srv                   # 服务数据
├── sys                   # 系统信息（虚拟文件系统）
├── tmp                   # 临时文件
├── usr                   # 用户程序和数据
└── var                   # 可变数据（日志、缓存）
```

## 2. 重点目录说明

| 目录 | 用途 | 示例 |
|------|------|------|
| `/etc` | 系统配置文件 | `/etc/passwd`、`/etc/ssh/sshd_config` |
| `/home` | 用户主目录 | `/home/user/` |
| `/var` | 可变数据 | `/var/log/`、`/var/cache/` |
| `/tmp` | 临时文件 | 重启后可能清空 |
| `/usr` | 用户程序 | `/usr/bin/`、`/usr/lib/` |
| `/proc` | 进程和系统信息 | `/proc/cpuinfo`、`/proc/meminfo` |
| `/dev` | 设备文件 | `/dev/sda`、`/dev/tty` |

## 3. /etc 配置文件

```bash
# 用户信息
cat /etc/passwd

# 用户密码（需 root）
sudo cat /etc/shadow

# 组信息
cat /etc/group

# 主机名
cat /etc/hostname

# DNS 配置
cat /etc/resolv.conf

# 系统版本
cat /etc/os-release
```

## 4. /var 可变数据

```bash
# 系统日志
ls /var/log/

# 包管理缓存
ls /var/cache/apt/      # Debian/Ubuntu
ls /var/cache/dnf/      # RHEL/CentOS

# 邮件
ls /var/mail/
```

## 5. /proc 和 /sys（虚拟文件系统）

这两个目录不占用磁盘空间，是内核信息的接口：

```bash
# CPU 信息
cat /proc/cpuinfo

# 内存信息
cat /proc/meminfo

# 内核版本
cat /proc/version

# 网络连接
cat /proc/net/tcp

# 块设备
ls /sys/block/

# 网络接口
ls /sys/class/net/
```

## 6. 两系差异

| 目录 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| Apache 配置 | `/etc/apache2/` | `/etc/httpd/` |
| 网络配置 | `/etc/netplan/` | NetworkManager（RHEL 9 起 network-scripts 已移除） |
| 日志 | `/var/log/syslog` | `/var/log/messages` |

## 参考资料

- FHS 3.0 — [refspecs.linuxfoundation.org](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html)
- Arch Wiki - File system hierarchy — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_system)
- `man hier` — Linux 手册页
