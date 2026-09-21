# 安装过程

## 学习目标

- 掌握 Ubuntu/Debian 的安装步骤
- 掌握 RHEL/CentOS 的安装步骤
- 了解两系安装的差异

## 1. Ubuntu/Debian 安装

### 1.1 启动安装程序

1. 插入启动盘，重启电脑
2. 进入 BIOS/UEFI 设置，选择从 USB 启动
3. 选择 "Install Ubuntu" 或 "Install Debian"

### 1.2 安装步骤

1. **选择语言**：中文（简体）或 English
2. **选择键盘布局**：默认即可
3. **网络配置**：连接 Wi-Fi 或有线网络
4. **安装类型**：
   - 清除磁盘安装
   - 其他选项（手动分区）
5. **分区设置**：
   - 选择 "其他选项" 进行手动分区
   - 或使用默认的 "清除整个磁盘"
6. **设置用户**：
   - 输入用户名和密码
   - 选择计算机名称
7. **等待安装完成**
8. **重启系统**

### 1.3 安装后配置

```bash
# 更新系统
sudo apt update
sudo apt upgrade

# 安装常用软件
sudo apt install vim git curl wget htop

# 配置时区
sudo timedatectl set-timezone Asia/Shanghai
```

## 2. RHEL/CentOS 安装

### 2.1 启动安装程序

1. 插入启动盘，重启电脑
2. 进入 BIOS/UEFI 设置，选择从 USB 启动
3. 选择 "Install Red Hat Enterprise Linux" 或 "Install CentOS"

### 2.2 安装步骤

1. **选择语言**：中文或 English
2. **安装信息摘要**：
   - **本地化**：日期和时间、键盘、语言支持
   - **软件**：安装源、软件选择
   - **系统**：安装目的地、网络和主机名
3. **分区设置**：
   - 自动配置分区
   - 手动分区（自定义）
4. **网络配置**：
   - 启用网络接口
   - 设置主机名
5. **开始安装**
6. **设置 root 密码**
7. **创建用户**
8. **等待安装完成**
9. **重启系统**

### 2.3 安装后配置

```bash
# 更新系统
sudo dnf update  # Fedora/RHEL 8+
sudo yum update  # CentOS 7

# 安装常用软件
sudo dnf install vim git curl wget htop

# 配置时区
sudo timedatectl set-timezone Asia/Shanghai
```

## 3. 两系安装差异对比

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 安装程序 | Ubiquity/Debian Installer | Anaconda |
| 包管理 | APT | YUM/DNF |
| 防火墙 | ufw | firewalld |
| 网络配置 | Netplan | NetworkManager |
| 服务管理 | systemd | systemd |
| SELinux | 默认关闭 | 默认开启 |

## 4. 常见问题

### 4.1 无法从 USB 启动

- 检查 BIOS/UEFI 设置
- 确认启动顺序
- 尝试不同的 USB 端口

### 4.2 安装过程中网络连接失败

- 检查网线连接
- 确认 Wi-Fi 密码
- 尝试手动配置网络

### 4.3 分区后无法启动

- 检查 BIOS/UEFI 启动模式
- 确认 /boot 分区设置
- 检查 GRUB 安装位置

## 参考资料

- [鸟哥的私房菜 - 安装 Linux](https://linux.vbird.org/linux_basic/0160startlinux.php)
- [Debian 安装手册](https://www.debian.org/releases/stable/installmanual)
- [RHEL 安装指南](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/performing_a_standard_rhel_9_installation/index)
