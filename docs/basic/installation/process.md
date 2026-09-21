# 安装过程

以 Ubuntu Desktop 为例，其他发行版流程类似。

## 1. 启动安装程序

1. 插入启动盘，重启电脑
2. 进入 BIOS/UEFI（开机按 Del/F2/F12）
3. 选择从 USB 启动
4. 选择 "Install Ubuntu"

## 2. 安装步骤

### 语言和键盘

- 选择语言：中文（简体）
- 键盘布局：默认即可

### 网络

- 连接 Wi-Fi 或有线网络
- 安装过程中会下载更新

### 安装类型

| 选项 | 说明 | 适用场景 |
|------|------|---------|
| 清除磁盘安装 | 格式化整个磁盘 | 新电脑、不保留数据 |
| 与其他系统共存 | 双系统 | 需要保留 Windows |
| 手动分区 | 自定义分区 | 高级用户 |

### 分区建议

**简单方案**（新手推荐）：

| 分区 | 大小 | 用途 |
|------|------|------|
| / | 剩余全部 | 系统和数据 |
| swap | 内存大小 | 交换分区 |

**标准方案**（服务器推荐）：

| 分区 | 大小 | 用途 |
|------|------|------|
| /boot/efi | 512 MB | UEFI 引导（UEFI 模式） |
| /boot | 1 GB | 引导文件 |
| / | 20-50 GB | 系统 |
| /home | 剩余 | 用户数据 |
| swap | 内存大小 | 交换分区 |

### 用户设置

- 输入用户名和密码
- 计算机名称（hostname）

### 等待安装完成

安装过程约 10-30 分钟，完成后重启。

## 3. 安装后配置

### 更新系统

```bash
# Debian/Ubuntu
sudo apt update
sudo apt upgrade

# RHEL/CentOS/Fedora
sudo dnf update
```

### 安装常用工具

```bash
# Debian/Ubuntu
sudo apt install vim git curl wget htop net-tools

# RHEL/CentOS/Fedora
sudo dnf install vim git curl wget htop net-tools
```

### 设置时区

```bash
sudo timedatectl set-timezone Asia/Shanghai
```

### 配置国内镜像源

加速软件下载：

```bash
# Ubuntu - 使用清华源
sudo sed -i 's|http://archive.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list
sudo apt update
```

## 4. 双系统注意事项

安装双系统后，GRUB 会自动管理启动菜单：

```bash
# 更新 GRUB 菜单
sudo update-grub    # Debian/Ubuntu
sudo grub2-mkconfig -o /boot/grub2/grub.cfg  # RHEL/CentOS
```

## 参考资料

- [Ubuntu 安装教程](https://ubuntu.com/tutorials/install-ubuntu-desktop)
- [Debian 安装手册](https://www.debian.org/releases/stable/installmanual)
- [RHEL 安装指南](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/performing_a_standard_rhel_9_installation/index)
- [Arch Wiki - Installation guide](https://wiki.archlinux.org/title/Installation_guide)
