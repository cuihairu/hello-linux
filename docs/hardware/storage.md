# 存储设备

存储设备用于长期保存数据。本章介绍 HDD、SSD、NVMe 的工作原理，以及 RAID、分区和文件系统选型。

> 内容参考自经典教材和厂商文档，见文末参考资料。

## 学习目标

- 理解 HDD、SSD、NVMe 的工作原理和差异
- 掌握磁盘信息的查看方法
- 了解 RAID 级别和适用场景
- 学会分区和文件系统选型

## 1. 存储设备类型

### 1.1 HDD（机械硬盘）

HDD 通过磁头在旋转的磁盘上读写数据。

```
        ┌─────────────────┐
        │     磁头臂       │
        │       ↓         │
        │  ┌─────────┐    │
        │  │ 磁盘片  │    │
        │  │ (旋转)   │    │
        │  └─────────┘    │
        └─────────────────┘
```

| 参数 | 说明 | 典型值 |
|------|------|--------|
| 转速 | 磁盘旋转速度 | 5400/7200/10000/15000 RPM |
| 寻道时间 | 磁头移动到目标磁道 | 3-12 ms |
| 接口 | 连接方式 | SATA / SAS |
| 容量 | 存储空间 | 1 TB - 20+ TB |

### 1.2 SSD（固态硬盘）

SSD 使用 NAND Flash 芯片存储数据，无机械部件。

| 类型 | 每单元位数 | 寿命 | 速度 | 成本 |
|------|-----------|------|------|------|
| SLC | 1 bit | 最长 | 最快 | 最贵 |
| MLC | 2 bits | 较长 | 较快 | 较贵 |
| TLC | 3 bits | 中等 | 中等 | 中等 |
| QLC | 4 bits | 较短 | 较慢 | 较低 |

### 1.3 NVMe

NVMe（Non-Volatile Memory Express）是专为闪存设计的高速接口协议。

| 对比 | SATA SSD | NVMe SSD |
|------|----------|----------|
| 接口 | SATA | PCIe |
| 协议 | AHCI | NVMe |
| 最大带宽 | 600 MB/s | 7 GB/s (PCIe 4.0) |
| 队列深度 | 1 个队列，32 命令 | 64K 队列，64K 命令 |
| 延迟 | ~100 μs | ~10 μs |

## 2. 磁盘信息查看

### 2.1 lsblk

```bash
# 查看块设备列表
lsblk

# 输出示例
# NAME   MAJ:MIN RM   SIZE RO TYPE MOUNTPOINT
# sda      8:0    0   500G  0 disk
# ├─sda1   8:1    0   512M  0 part /boot/efi
# ├─sda2   8:2    0     1G  0 part /boot
# └─sda3   8:3    0   498G  0 part
#   ├─vg0-root  253:0    0    50G  0 lvm  /
#   └─vg0-home  253:1    0   448G  0 lvm  /home

# 查看文件系统类型
lsblk -f

# 查看详细信息
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,ROTA,DISC-GRAN
# ROTA=1 表示 HDD，ROTA=0 表示 SSD
```

### 2.2 fdisk

```bash
# 查看磁盘分区表
sudo fdisk -l

# 查看特定磁盘
sudo fdisk -l /dev/sda
```

### 2.3 hdparm

```bash
# 查看硬盘参数（SATA）
sudo hdparm -I /dev/sda

# 测试读取速度
sudo hdparm -Tt /dev/sda
# -T: 缓存读取速度
# -t: 磁盘读取速度
```

### 2.4 nvme（NVMe 工具）

```bash
# 安装
sudo apt install nvme-cli    # Debian/Ubuntu
sudo yum install nvme-cli    # RHEL/CentOS

# 列出 NVMe 设备
nvme list

# 查看设备信息
nvme id-ctrl /dev/nvme0

# 查看 SMART 信息
nvme smart-log /dev/nvme0
```

### 2.5 smartctl（SMART 监控）

```bash
# 安装
sudo apt install smartmontools

# 查看 SMART 信息
sudo smartctl -a /dev/sda

# 查看健康状态
sudo smartctl -H /dev/sda

# 运行自检
sudo smartctl -t short /dev/sda
sudo smartctl -t long /dev/sda
```

## 3. RAID

### 3.1 RAID 级别

| 级别 | 最少磁盘 | 冗余 | 可用容量 | 读性能 | 写性能 | 适用场景 |
|------|---------|------|---------|--------|--------|---------|
| RAID 0 | 2 | 无 | N×盘 | 高 | 高 | 临时数据 |
| RAID 1 | 2 | 镜像 | 1×盘 | 高 | 中 | 系统盘 |
| RAID 5 | 3 | 单校验 | (N-1)×盘 | 高 | 中 | 通用存储 |
| RAID 6 | 4 | 双校验 | (N-2)×盘 | 高 | 中 | 大容量存储 |
| RAID 10 | 4 | 镜像+条带 | N/2×盘 | 很高 | 高 | 数据库 |

### 3.2 软件 RAID（mdadm）

```bash
# 安装
sudo apt install mdadm

# 创建 RAID 5
sudo mdadm --create /dev/md0 --level=5 --raid-devices=3 /dev/sd{b,c,d}

# 查看 RAID 状态
cat /proc/mdstat
sudo mdadm --detail /dev/md0

# 保存配置
sudo mdadm --detail --scan >> /etc/mdadm/mdadm.conf
```

## 4. 分区

### 4.1 分区表类型

| 类型 | 最大磁盘 | 最大分区数 | 引导方式 |
|------|---------|-----------|---------|
| MBR | 2 TB | 4 主分区 | BIOS |
| GPT | 9.4 ZB | 128 分区 | UEFI |

### 4.2 分区工具

```bash
# fdisk（MBR/GPT）
sudo fdisk /dev/sdb

# gdisk（GPT）
sudo gdisk /dev/sdb

# parted（MBR/GPT）
sudo parted /dev/sdb

# 交互命令（fdisk/gdisk）
# n: 新建分区
# d: 删除分区
# p: 打印分区表
# t: 更改分区类型
# w: 保存退出
# q: 不保存退出
```

## 5. 文件系统选型

### 5.1 常见文件系统对比

| 文件系统 | 最大文件 | 最大分区 | 特点 | 适用场景 |
|---------|---------|---------|------|---------|
| ext4 | 16 TB | 1 EB | 稳定成熟 | 通用默认 |
| XFS | 8 EB | 8 EB | 高性能大文件 | 数据库、大容量存储 |
| Btrfs | 16 EB | 16 EB | 快照、压缩、校验 | 数据保护 |
| ZFS | 16 EB | 256 ZB | 企业级功能 | NAS、服务器 |

### 5.2 创建文件系统

```bash
# ext4
sudo mkfs.ext4 /dev/sdb1

# XFS
sudo mkfs.xfs /dev/sdb1

# Btrfs
sudo mkfs.btrfs /dev/sdb1

# 查看文件系统信息
sudo tune2fs -l /dev/sdb1    # ext4
sudo xfs_info /dev/sdb1      # XFS
sudo btrfs filesystem show /dev/sdb1  # Btrfs
```

## 6. 性能测试

### 6.1 dd

```bash
# 测试顺序写入
dd if=/dev/zero of=testfile bs=1G count=1 oflag=direct

# 测试顺序读取
dd if=testfile of=/dev/null bs=1G count=1 iflag=direct
```

### 6.2 fio

```bash
# 安装
sudo apt install fio

# 顺序读
fio --name=seq_read --rw=read --bs=1M --size=1G --numjobs=1 --runtime=60 --filename=testfile

# 顺序写
fio --name=seq_write --rw=write --bs=1M --size=1G --numjobs=1 --runtime=60 --filename=testfile

# 随机读（4K）
fio --name=rand_read --rw=randread --bs=4k --size=1G --numjobs=4 --runtime=60 --filename=testfile

# 混合随机读写
fio --name=rand_rw --rw=randrw --rwmixread=70 --bs=4k --size=1G --numjobs=4 --runtime=60 --filename=testfile
```

## 7. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 默认文件系统 | ext4 | ext4 (CentOS 7), XFS (CentOS 8+) |
| 分区工具 | fdisk/gdisk | fdisk/gdisk |
| LVM 包 | lvm2 | lvm2 |
| RAID 包 | mdadm | mdadm |
| NVMe 工具 | nvme-cli | nvme-cli |

## 参考资料

- Arch Wiki - Partitioning — [wiki.archlinux.org](https://wiki.archlinux.org/title/Partitioning)
- Arch Wiki - File systems — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_systems)
- Arch Wiki - LVM — [wiki.archlinux.org](https://wiki.archlinux.org/title/LVM)
- Arch Wiki - RAID — [wiki.archlinux.org](https://wiki.archlinux.org/title/RAID)
- NVM Express Specification — [nvmexpress.org](https://nvmexpress.org/specifications/)
- smartmontools Documentation — [smartmontools.org](https://www.smartmontools.org/)
