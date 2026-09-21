# 目录层次结构

## 学习目标

- 掌握 Linux 目录结构的标准
- 了解各主要目录的用途
- 学会合理组织文件和目录

## 1. 根目录结构

```
/
├── bin -> usr/bin        # 基本命令
├── sbin -> usr/sbin      # 系统管理命令
├── lib -> usr/lib        # 共享库
├── lib64 -> usr/lib64    # 64位共享库
├── boot                  # 启动文件
├── dev                   # 设备文件
├── etc                   # 配置文件
├── home                  # 用户主目录
├── media                 # 可移动设备挂载点
├── mnt                   # 临时挂载点
├── opt                   # 第三方软件
├── proc                  # 进程信息（虚拟）
├── root                  # root 用户主目录
├── run                   # 运行时数据
├── srv                   # 服务数据
├── sys                   # 系统信息（虚拟）
├── tmp                   # 临时文件
├── usr                   # 用户程序和数据
└── var                   # 可变数据
```

## 2. 主要目录详解

### 2.1 /etc - 配置文件目录

系统配置文件的集中存放位置：

```bash
# 网络配置
/etc/network/          # Debian/Ubuntu
/etc/sysconfig/network-scripts/  # RHEL/CentOS

# 用户配置
/etc/passwd            # 用户信息
/etc/shadow            # 用户密码
/etc/group             # 组信息

# 服务配置
/etc/ssh/              # SSH 配置
/etc/nginx/            # Nginx 配置
/etc/apache2/          # Apache 配置（Debian/Ubuntu）
/etc/httpd/            # Apache 配置（RHEL/CentOS）
```

### 2.2 /var - 可变数据目录

存放经常变化的数据：

```bash
/var/log/              # 日志文件
/var/cache/            # 缓存数据
/var/lib/              # 程序运行时数据
/var/mail/             # 用户邮件
/var/spool/            # 队列数据
/var/tmp/              # 临时文件（重启后保留）
```

### 2.3 /usr - 用户程序目录

用户程序和数据的主要存放位置：

```bash
/usr/bin/              # 用户命令
/usr/sbin/             # 系统管理命令
/usr/lib/              # 共享库
/usr/share/            # 架构无关数据
/usr/local/            # 本地安装的软件
/usr/include/          # 头文件
/usr/src/              # 源代码
```

### 2.4 /home - 用户主目录

每个用户都有自己的主目录：

```bash
/home/username/        # 用户主目录
├── .bashrc            # Bash 配置
├── .bash_history      # 命令历史
├── .ssh/              # SSH 密钥
├── .config/           # 应用配置
└── Documents/         # 文档
```

## 3. 特殊目录

### 3.1 /proc - 进程信息

虚拟文件系统，提供进程和系统信息：

```bash
# 查看 CPU 信息
cat /proc/cpuinfo

# 查看内存信息
cat /proc/meminfo

# 查看进程信息
ls /proc/

# 查看特定进程
cat /proc/1/status
```

### 3.2 /sys - 系统信息

虚拟文件系统，提供设备和内核信息：

```bash
# 查看块设备
ls /sys/block/

# 查看网络接口
ls /sys/class/net/

# 查看电源管理
ls /sys/power/
```

### 3.3 /dev - 设备文件

设备文件的存放位置：

```bash
# 硬盘设备
/dev/sda, /dev/sdb

# 分区
/dev/sda1, /dev/sda2

# 光驱
/dev/cdrom

# 终端
/dev/tty, /dev/pts/*
```

## 4. 两系差异

| 目录 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| Apache 配置 | /etc/apache2/ | /etc/httpd/ |
| 网络配置 | /etc/netplan/ | /etc/sysconfig/network-scripts/ |
| 日志 | /var/log/syslog | /var/log/messages |
| 默认 Shell | bash | bash |

## 参考资料

- [鸟哥的私房菜 - 目录配置](https://linux.vbird.org/linux_basic/0210filepermission.php#dir)
- [Arch Wiki - File system hierarchy](https://wiki.archlinux.org/title/File_system_hierarchy)
- [FHS 3.0](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html)
