# 文件系统概念

文件系统是操作系统管理磁盘数据的方式。Linux 支持多种文件系统类型，并通过 VFS 提供统一接口。

> 内容参考自内核文档和 Arch Wiki，见文末参考资料。

## 学习目标

- 理解文件系统的作用
- 了解常见文件系统类型
- 掌握挂载和卸载操作

## 1. 什么是文件系统

文件系统决定了数据在磁盘上如何存储、组织和访问。

```
┌─────────────────────────────────┐
│          应用程序                │
├─────────────────────────────────┤
│      VFS（虚拟文件系统）         │  ← 统一接口
├────────┬────────┬────────┬──────┤
│  ext4  │  XFS   │ Btrfs  │ NFS  │  ← 具体实现
├────────┴────────┴────────┴──────┤
│          块设备驱动              │
├─────────────────────────────────┤
│       磁盘 / SSD / NVMe         │
└─────────────────────────────────┘
```

## 2. "一切皆文件"

Linux 将所有资源抽象为文件：

```bash
# 普通文件
cat /etc/passwd

# 目录
ls /home/

# 设备
ls -la /dev/sda       # 块设备
ls -la /dev/tty       # 字符设备
ls -la /dev/null      # 空设备

# 进程信息
cat /proc/cpuinfo
cat /proc/meminfo

# 网络
cat /proc/net/tcp
```

## 3. 常见文件系统

### 3.1 ext4

Linux 默认文件系统，稳定可靠。

```bash
# 创建
sudo mkfs.ext4 /dev/sdb1

# 查看信息
sudo tune2fs -l /dev/sdb1

# 检查
sudo fsck.ext4 /dev/sdb1
```

### 3.2 XFS

高性能，适合大文件。

```bash
# 创建
sudo mkfs.xfs /dev/sdb1

# 查看信息
sudo xfs_info /dev/sdb1

# 检查
sudo xfs_repair /dev/sdb1
```

### 3.3 Btrfs

支持快照、压缩、校验。

```bash
# 创建
sudo mkfs.btrfs /dev/sdb1

# 创建快照（目标路径不能位于被快照的子卷内）
sudo btrfs subvolume snapshot /mnt /mnt/snapshots/my-snapshot
```

### 3.4 对比

| 文件系统 | 最大文件 | 最大分区 | 特点 | 适用场景 |
|---------|---------|---------|------|---------|
| ext4 | 16 TB | 1 EB | 稳定成熟 | 通用默认 |
| XFS | 8 EB | 8 EB | 大文件高性能 | 数据库 |
| Btrfs | 16 EB | 16 EB | 快照、压缩 | 数据保护 |
| FAT32 | 4 GB | 8 TB | 跨平台兼容 | U 盘 |
| NTFS | 16 TB | 256 TB | Windows 默认 | 双系统共享 |

## 4. 挂载与卸载

### 4.1 挂载

```bash
# 临时挂载
sudo mount /dev/sdb1 /mnt

# 挂载为只读
sudo mount -o ro /dev/sdb1 /mnt

# 查看挂载
mount
findmnt
```

### 4.2 永久挂载（/etc/fstab）

```bash
# 编辑 fstab
sudo vim /etc/fstab

# 格式：设备  挂载点  文件系统  选项  dump  fsck
/dev/sdb1  /data  ext4  defaults  0  2

# 测试
sudo mount -a
```

### 4.3 卸载

```bash
sudo umount /mnt

# 设备忙时
sudo umount -l /mnt
```

## 参考资料

- Arch Wiki - File systems — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_systems)
- Linux Kernel Documentation: VFS — [kernel.org/doc](https://www.kernel.org/doc/html/latest/filesystems/)
- ext4 文档 — [kernel.org/doc](https://www.kernel.org/doc/html/latest/filesystems/ext4/)
