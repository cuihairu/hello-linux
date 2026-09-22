# 系统信息查看命令

## 学习目标

- 掌握系统信息的查看方法
- 了解硬件信息的获取方式
- 学会监控系统状态

## 1. 系统信息

### 1.1 uname - 系统信息

```bash
# 查看所有信息
uname -a

# 查看内核名称
uname -s

# 查看内核版本
uname -r

# 查看主机名
uname -n

# 查看架构
uname -m
```

### 1.2 hostname - 主机名

```bash
# 查看主机名
hostname

# 查看完整主机名
hostname -f

# 查看 IP 地址
hostname -I
```

### 1.3 uptime - 运行时间

```bash
# 查看系统运行时间和负载
uptime
```

## 2. 硬件信息

### 2.1 lscpu - CPU 信息

```bash
# 查看 CPU 信息
lscpu
```

输出示例：
```
Architecture:          x86_64
CPU op-mode(s):        32-bit, 64-bit
Byte Order:            Little Endian
CPU(s):                8
On-line CPU(s) list:   0-7
Thread(s) per core:    2
Core(s) per socket:    4
Socket(s):             1
Vendor ID:             GenuineIntel
CPU family:            6
Model:                 142
Model name:            Intel(R) Core(TM) i7-8550U CPU @ 1.80GHz
```

### 2.2 /proc/cpuinfo - CPU 详细信息

```bash
# 查看 CPU 详细信息
cat /proc/cpuinfo

# 查看 CPU 核心数
grep -c processor /proc/cpuinfo

# 查看 CPU 型号
grep "model name" /proc/cpuinfo | head -1
```

### 2.3 lsblk - 块设备信息

```bash
# 查看块设备信息
lsblk

# 查看详细信息
lsblk -f

# 查看特定设备
lsblk /dev/sda
```

### 2.4 lshw - 硬件信息

```bash
# 查看所有硬件信息
sudo lshw

# 查看简要信息
sudo lshw -short

# 查看特定类别
sudo lshw -class disk
sudo lshw -class network
```

### 2.5 lspci - PCI 设备

```bash
# 查看 PCI 设备
lspci

# 查看详细信息
lspci -v

# 查看网络设备
lspci | grep -i network

# 查看显卡
lspci | grep -i vga
```

### 2.6 lsusb - USB 设备

```bash
# 查看 USB 设备
lsusb

# 查看详细信息
lsusb -v
```

## 3. 内存信息

### 3.1 free - 内存使用情况

```bash
# 查看内存使用情况
free

# 人类可读格式
free -h

# 显示详细信息
free -m
```

### 3.2 /proc/meminfo - 内存详细信息

```bash
# 查看内存详细信息
cat /proc/meminfo

# 查看总内存
grep MemTotal /proc/meminfo

# 查看空闲内存
grep MemFree /proc/meminfo
```

## 4. 磁盘信息

### 4.1 df - 磁盘使用情况

```bash
# 查看磁盘使用情况
df

# 人类可读格式
df -h

# 显示文件系统类型
df -Th

# 查看特定文件系统
df -h /home
```

### 4.2 du - 目录大小

```bash
# 查看目录大小
du -sh directory

# 查看所有文件大小
du -ah directory

# 查看当前目录大小
du -sh *

# 排序显示
du -sh * | sort -hr
```

### 4.3 fdisk - 磁盘分区

```bash
# 查看磁盘分区
sudo fdisk -l

# 查看特定磁盘
sudo fdisk -l /dev/sda
```

## 5. 网络信息

### 5.1 ip - 网络配置

```bash
# 查看网络接口
ip link show

# 查看 IP 地址
ip addr show

# 查看路由表
ip route show
```

### 5.2 ifconfig - 网络配置（旧版）

```bash
# 查看网络接口
ifconfig

# 查看特定接口
ifconfig eth0
```

## 6. 系统状态

### 6.1 top - 进程监控

```bash
# 启动 top
top

# top 快捷键
# P：按 CPU 使用率排序
# M：按内存使用率排序
# k：终止进程
# q：退出
```

### 6.2 htop - 增强版 top

```bash
# 安装 htop
sudo apt install htop    # Debian/Ubuntu
sudo yum install htop    # RHEL/CentOS

# 启动 htop
htop
```

### 6.3 vmstat - 虚拟内存统计

```bash
# 查看虚拟内存统计
vmstat

# 每秒更新一次
vmstat 1
```

### 6.4 iostat - I/O 统计

```bash
# 查看 I/O 统计
iostat

# 每秒更新一次
iostat 1
```

## 7. 系统日志

### 7.1 journalctl - systemd 日志

```bash
# 查看所有日志
journalctl

# 查看系统启动日志
journalctl -b

# 查看指定服务日志
journalctl -u service_name

# 实时查看
journalctl -f
```

### 7.2 dmesg - 内核日志

```bash
# 查看内核日志
dmesg

# 查看最近日志
dmesg | tail

# 查看特定类型日志
dmesg | grep -i error
```

## 8. 用户信息

### 8.1 whoami - 当前用户

```bash
# 查看当前用户
whoami
```

### 8.2 id - 用户信息

```bash
# 查看用户信息
id

# 查看特定用户
id username
```

### 8.3 who - 登录用户

```bash
# 查看当前登录用户
who

# 查看登录历史
last
```

## 9. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 硬件信息 | lshw | lshw |
| 系统监控 | htop | htop |
| 日志查看 | journalctl | journalctl |

## 参考资料

- [鸟哥的私房菜 - 文件与目录管理](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)
- [Arch Wiki - System maintenance](https://wiki.archlinux.org/title/System_maintenance)
- [Linux man pages](https://man7.org/linux/man-pages/)
