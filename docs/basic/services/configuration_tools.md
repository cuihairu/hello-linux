# 系统配置工具

## 学习目标

- 掌握常用的系统配置工具
- 了解图形化和命令行配置工具
- 学会管理系统配置

## 1. 网络配置工具

### 1.1 Netplan（Ubuntu）

```bash
# 配置文件
/etc/netplan/*.yaml

# 示例配置
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: true
      addresses:
        - 192.168.1.100/24
      gateway4: 192.168.1.1
      nameservers:
        addresses:
          - 8.8.8.8
          - 8.8.4.4

# 应用配置
sudo netplan apply

# 测试配置
sudo netplan try
```

### 1.2 NetworkManager

```bash
# 查看连接
nmcli connection show

# 查看设备状态
nmcli device status

# 创建连接
nmcli connection add type ethernet con-name my-connection ifname eth0

# 修改连接
nmcli connection modify my-connection ipv4.addresses 192.168.1.100/24

# 启用连接
nmcli connection up my-connection

# 禁用连接
nmcli connection down my-connection
```

### 1.3 nmtui（文本界面）

```bash
# 启动文本界面配置
nmtui
```

## 2. 时间配置

### 2.1 timedatectl

```bash
# 查看时间状态
timedatectl

# 设置时区
sudo timedatectl set-timezone Asia/Shanghai

# 启用 NTP
sudo timedatectl set-ntp true

# 设置时间
sudo timedatectl set-time "2024-01-01 12:00:00"
```

### 2.2 chrony（NTP 客户端）

```bash
# 安装
sudo apt install chrony    # Debian/Ubuntu
sudo yum install chrony    # RHEL/CentOS

# 配置文件
/etc/chrony.conf

# 查看状态
chronyc tracking
chronyc sources
```

## 3. 语言和区域配置

### 3.1 locale

```bash
# 查看当前 locale
locale

# 查看可用 locale
locale -a

# 生成 locale
sudo locale-gen zh_CN.UTF-8

# 设置默认 locale
sudo update-locale LANG=zh_CN.UTF-8
```

### 3.2 localectl

```bash
# 查看 locale 设置
localectl

# 设置 locale
sudo localectl set-locale LANG=zh_CN.UTF-8

# 设置键盘布局
sudo localectl set-keymap us
```

## 4. 主机名配置

### 4.1 hostnamectl

```bash
# 查看主机名
hostnamectl

# 设置主机名
sudo hostnamectl set-hostname my-server

# 查看静态主机名
hostnamectl --static

# 查看瞬态主机名
hostnamectl --transient
```

### 4.2 /etc/hostname

```bash
# 编辑主机名文件
sudo vim /etc/hostname

# 内容
my-server
```

## 5. 防火墙配置

### 5.1 ufw（Ubuntu）

```bash
# 启用防火墙
sudo ufw enable

# 查看状态
sudo ufw status

# 允许端口
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp

# 拒绝端口
sudo ufw deny 23/tcp

# 删除规则
sudo ufw delete allow 22/tcp
```

### 5.2 firewalld（RHEL/CentOS）

```bash
# 查看状态
sudo firewall-cmd --state

# 查看规则
sudo firewall-cmd --list-all

# 允许端口
sudo firewall-cmd --add-port=22/tcp --permanent

# 重新加载
sudo firewall-cmd --reload
```

## 6. SELinux 配置

### 6.1 SELinux 状态

```bash
# 查看状态
getenforce

# 查看详细状态
sestatus

# 临时关闭
sudo setenforce 0

# 临时开启
sudo setenforce 1
```

### 6.2 SELinux 配置文件

```bash
# 配置文件
/etc/selinux/config

# 设置模式
SELINUX=enforcing    # 强制模式
SELINUX=permissive   # 宽容模式
SELINUX=disabled     # 禁用
```

## 7. 系统监控工具

### 7.1 系统信息

```bash
# 系统信息
uname -a

# CPU 信息
lscpu

# 内存信息
free -h

# 磁盘信息
lsblk

# 网络信息
ip addr show
```

### 7.2 性能监控

```bash
# 系统负载
uptime

# 进程监控
top
htop

# 磁盘 I/O
iostat

# 网络监控
iftop
nethogs
```

## 8. 图形化配置工具

### 8.1 GNOME 系统设置

- 网络设置
- 用户管理
- 日期和时间
- 语言支持
- 显示设置

### 8.2 KDE 系统设置

- 网络设置
- 用户管理
- 日期和时间
- 区域设置
- 显示设置

## 参考资料

- [鸟哥的私房菜 - 系统配置](https://linux.vbird.org/linux_basic/0560daemons.php)
- [Arch Wiki - System administration](https://wiki.archlinux.org/title/System_administration)
