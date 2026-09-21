# GRUB 引导程序

GRUB（GRand Unified Bootloader）是大多数 Linux 发行版使用的引导程序。

> 内容参考自 GNU GRUB 手册和 Arch Wiki，见文末参考资料。

## 1. GRUB 的作用

- 加载操作系统内核
- 支持多系统启动
- 提供命令行界面

## 2. 配置文件

```bash
# 主配置文件（不要手动编辑）
/boot/grub/grub.cfg        # Debian/Ubuntu
/boot/grub2/grub.cfg       # RHEL/CentOS

# 用户配置文件
/etc/default/grub

# 自定义脚本
/etc/grub.d/
```

## 3. 修改 GRUB

编辑 `/etc/default/grub`：

```bash
sudo vim /etc/default/grub
```

常见配置：

```bash
# 默认启动项（0 = 第一个）
GRUB_DEFAULT=0

# 超时时间（秒）
GRUB_TIMEOUT=5

# 内核参数
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash"
```

更新 GRUB：

```bash
sudo update-grub                              # Debian/Ubuntu
sudo grub2-mkconfig -o /boot/grub2/grub.cfg   # RHEL/CentOS
```

## 4. 临时修改启动项

开机时在 GRUB 菜单按 `e`，找到 `linux` 行修改参数，按 `Ctrl+X` 启动。

## 5. 修复 GRUB

使用 Live CD 启动后：

```bash
# 挂载根分区
sudo mount /dev/sda1 /mnt

# 挂载必要目录
sudo mount --bind /dev /mnt/dev
sudo mount --bind /proc /mnt/proc
sudo mount --bind /sys /mnt/sys

# 进入 chroot
sudo chroot /mnt

# 重新安装 GRUB
grub-install /dev/sda
update-grub

# 退出重启
exit
sudo reboot
```

## 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 配置文件 | `/boot/grub/grub.cfg` | `/boot/grub2/grub.cfg` |
| 更新命令 | `update-grub` | `grub2-mkconfig` |

## 参考资料

- GNU GRUB 手册 — [gnu.org](https://www.gnu.org/software/grub/manual/grub/)
- Arch Wiki - GRUB — [wiki.archlinux.org](https://wiki.archlinux.org/title/GRUB)
