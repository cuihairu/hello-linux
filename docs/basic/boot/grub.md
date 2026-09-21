# GRUB 引导程序

## 学习目标

- 理解 GRUB 的作用和工作原理
- 掌握 GRUB 配置文件的修改方法
- 学会修复 GRUB 引导问题

## 1. GRUB 简介

GRUB（GRand Unified Bootloader）是大多数 Linux 发行版使用的引导程序。

### 1.1 GRUB 版本

- **GRUB Legacy**：旧版本（0.9x）
- **GRUB 2**：当前版本（2.0+）

### 1.2 GRUB 的功能

- 加载操作系统内核
- 支持多系统启动
- 提供命令行界面
- 支持网络启动

## 2. GRUB 配置

### 2.1 配置文件位置

```bash
# 主配置文件
/boot/grub/grub.cfg        # Debian/Ubuntu
/boot/grub2/grub.cfg       # RHEL/CentOS

# 用户配置文件
/etc/default/grub

# 自定义脚本
/etc/grub.d/
```

### 2.2 /etc/default/grub 配置

```bash
# 编辑配置文件
sudo vim /etc/default/grub
```

常见配置项：

```bash
# 默认启动项
GRUB_DEFAULT=0

# 超时时间（秒）
GRUB_TIMEOUT=5

# 内核参数
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"

# 分辨率
GRUB_GFXMODE=1920x1080

# 主题
GRUB_THEME="/boot/grub/themes/theme.txt"
```

### 2.3 更新 GRUB

```bash
# Debian/Ubuntu
sudo update-grub

# RHEL/CentOS
sudo grub2-mkconfig -o /boot/grub2/grub.cfg

# EFI 模式
sudo grub2-mkconfig -o /boot/efi/EFI/centos/grub.cfg
```

## 3. 修改启动项

### 3.1 临时修改

1. 开机时按 `e` 进入编辑模式
2. 找到 `linux` 行，修改内核参数
3. 按 `Ctrl+X` 启动

### 3.2 永久修改

```bash
# 编辑 /etc/default/grub
sudo vim /etc/default/grub

# 修改 GRUB_DEFAULT 设置默认启动项
GRUB_DEFAULT=0  # 第一个启动项

# 更新 GRUB
sudo update-grub
```

## 4. 修复 GRUB

### 4.1 GRUB 损坏修复

使用 Live CD 启动后：

```bash
# 挂载根分区
sudo mount /dev/sda1 /mnt

# 挂载必要的虚拟文件系统
sudo mount --bind /dev /mnt/dev
sudo mount --bind /proc /mnt/proc
sudo mount --bind /sys /mnt/sys

# 进入 chroot 环境
sudo chroot /mnt

# 重新安装 GRUB
grub-install /dev/sda

# 更新 GRUB 配置
update-grub

# 退出并重启
exit
sudo umount /mnt/dev /mnt/proc /mnt/sys
sudo umount /mnt
sudo reboot
```

### 4.2 EFI 模式修复

```bash
# 挂载 EFI 分区
sudo mount /dev/sda2 /mnt/boot/efi

# 重新安装 GRUB
grub-install --target=x86_64-efi --efi-directory=/boot/efi

# 更新配置
update-grub
```

## 5. GRUB 命令行

### 5.1 进入命令行

在 GRUB 菜单按 `c` 进入命令行。

### 5.2 常用命令

```bash
# 查看磁盘
ls

# 查看分区
ls (hd0,msdos1)/

# 手动启动
set root=(hd0,msdos1)
linux /vmlinuz root=/dev/sda1
initrd /initrd.img
boot
```

## 6. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 配置文件 | /boot/grub/grub.cfg | /boot/grub2/grub.cfg |
| 更新命令 | update-grub | grub2-mkconfig |
| 安装命令 | grub-install | grub2-install |
| EFI 路径 | /boot/efi/EFI/ubuntu | /boot/efi/EFI/centos |

## 参考资料

- [鸟哥的私房菜 - 开机流程](https://linux.vbird.org/linux_basic/0510osloader.php)
- [Arch Wiki - GRUB](https://wiki.archlinux.org/title/GRUB)
- [GNU GRUB 手册](https://www.gnu.org/software/grub/manual/grub/)
