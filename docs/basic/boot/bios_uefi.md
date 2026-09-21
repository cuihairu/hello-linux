# BIOS 与 UEFI

BIOS 和 UEFI 是计算机启动时运行的第一段程序，负责初始化硬件并加载操作系统。

> 内容参考自 Arch Wiki UEFI 文档，见文末参考资料。

## 1. BIOS

BIOS（Basic Input/Output System）是传统的固件接口：

- 存储在主板 ROM 芯片中
- 使用 MBR 分区表
- 最大支持 2 TB 磁盘
- 最多 4 个主分区

## 2. UEFI

UEFI（Unified Extensible Firmware Interface）是新一代固件标准：

- 使用 GPT 分区表
- 支持 9.4 ZB 磁盘
- 支持安全启动（Secure Boot）
- 图形界面，支持鼠标

## 3. 对比

| 特性 | BIOS | UEFI |
|------|------|------|
| 分区表 | MBR | GPT |
| 最大磁盘 | 2 TB | 9.4 ZB |
| 引导方式 | MBR 引导代码 | EFI 分区 |
| 安全启动 | 不支持 | 支持 |
| 图形界面 | 无 | 有 |

## 4. 查看启动模式

```bash
# UEFI 模式下存在此目录
ls /sys/firmware/efi

# 查看分区表类型
sudo fdisk -l /dev/sda
# GPT: Disklabel type: gpt
# MBR: Disklabel type: dos
```

## 5. EFI 分区

UEFI 模式需要一个 FAT32 格式的 EFI 分区：

```bash
# 查看 EFI 分区
lsblk -f | grep -i efi
# 通常挂载在 /boot/efi
```

## 参考资料

- Arch Wiki - UEFI — [wiki.archlinux.org](https://wiki.archlinux.org/title/UEFI)
- Arch Wiki - Partitioning — [wiki.archlinux.org](https://wiki.archlinux.org/title/Partitioning)
