# 安装前的准备

确认硬件满足要求，准备好安装介质。

## 1. 硬件要求

| 配置 | 最低 | 推荐 |
|------|------|------|
| CPU | 1 GHz 双核 | 2 GHz 四核 |
| 内存 | 1 GB | 4 GB+ |
| 磁盘 | 10 GB | 25 GB+ |
| 网络 | 有线/无线 | 有线更稳定 |

```bash
# 在现有系统上查看硬件
lscpu           # CPU
free -h         # 内存
lsblk           # 磁盘
```

## 2. 制作启动盘

### Windows

推荐工具：
- [Rufus](https://rufus.ie/) — 简单好用
- [balenaEtcher](https://www.balena.io/etcher/) — 跨平台

### macOS / Linux

```bash
# 查看 USB 设备
lsblk

# 写入镜像（注意替换设备名！）
sudo dd if=ubuntu-24.04-desktop-amd64.iso of=/dev/sdX bs=4M status=progress
sync
```

或使用 balenaEtcher 图形界面。

## 3. 备份数据

安装会格式化磁盘，务必提前备份重要数据。

## 4. 了解启动模式

| 模式 | 分区表 | 引导 |
|------|--------|------|
| UEFI（推荐） | GPT | EFI 分区 |
| Legacy BIOS | MBR | MBR |

```bash
# Linux 下查看当前启动模式
ls /sys/firmware/efi   # 存在则为 UEFI
```

## 参考资料

- [Ubuntu 安装指南](https://ubuntu.com/tutorials/install-ubuntu-desktop)
- [Debian 安装手册](https://www.debian.org/releases/stable/installmanual)
- [Arch Wiki - Installation guide](https://wiki.archlinux.org/title/Installation_guide)
