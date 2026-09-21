# 文件系统概念

## 学习目标

- 理解文件系统的基本概念
- 了解 Linux 文件系统的层次结构
- 掌握常见文件系统的类型和特点

## 1. 什么是文件系统

文件系统是操作系统用于管理存储设备上数据的方法和数据结构。它决定了数据如何存储、组织和访问。

### 1.1 文件系统的功能

- **存储管理**：管理磁盘空间的分配和回收
- **目录管理**：组织文件的层次结构
- **文件管理**：创建、删除、读取、写入文件
- **访问控制**：管理文件的权限和所有权

### 1.2 Linux 文件系统特点

- **一切皆文件**：设备、进程、网络连接等都以文件形式呈现
- **单一目录树**：所有文件系统挂载在一个统一的目录树下
- **权限管理**：基于用户和组的权限控制

## 2. 常见文件系统类型

### 2.1 ext4

- **特点**：Linux 默认文件系统，稳定可靠
- **最大文件大小**：16 TB
- **最大分区大小**：1 EB
- **适用场景**：大多数 Linux 系统

```bash
# 创建 ext4 文件系统
mkfs.ext4 /dev/sdb1

# 检查文件系统
fsck.ext4 /dev/sdb1

# 查看文件系统信息
tune2fs -l /dev/sdb1
```

### 2.2 XFS

- **特点**：高性能，支持大文件和大分区
- **最大文件大小**：8 EB
- **最大分区大小**：8 EB
- **适用场景**：大容量存储、数据库

```bash
# 创建 XFS 文件系统
mkfs.xfs /dev/sdb1

# 检查文件系统
xfs_repair /dev/sdb1

# 查看文件系统信息
xfs_info /dev/sdb1
```

### 2.3 Btrfs

- **特点**：支持快照、压缩、校验等高级功能
- **适用场景**：需要数据保护的场景
- **状态**：开发中，部分功能不稳定

```bash
# 创建 Btrfs 文件系统
mkfs.btrfs /dev/sdb1

# 创建快照
btrfs subvolume snapshot /mnt /mnt/snapshot

# 压缩挂载
mount -o compress=zstd /dev/sdb1 /mnt
```

### 2.4 FAT32/exFAT

- **特点**：兼容 Windows，适合 U 盘
- **限制**：FAT32 单文件最大 4 GB
- **适用场景**：跨平台数据交换

```bash
# 创建 FAT32 文件系统
mkfs.vfat -F 32 /dev/sdb1

# 创建 exFAT 文件系统
mkfs.exfat /dev/sdb1
```

## 3. 文件系统层次结构标准（FHS）

Linux 遵循 FHS（Filesystem Hierarchy Standard），定义了目录结构：

| 目录 | 用途 |
|------|------|
| `/` | 根目录，所有目录的起点 |
| `/bin` | 基本命令（已链接到 /usr/bin） |
| `/sbin` | 系统管理命令（已链接到 /usr/sbin） |
| `/etc` | 配置文件 |
| `/home` | 用户主目录 |
| `/root` | root 用户主目录 |
| `/var` | 可变数据（日志、缓存等） |
| `/tmp` | 临时文件 |
| `/usr` | 用户程序和数据 |
| `/opt` | 第三方软件 |
| `/boot` | 启动文件 |
| `/dev` | 设备文件 |
| `/proc` | 进程信息（虚拟文件系统） |
| `/sys` | 系统信息（虚拟文件系统） |
| `/mnt` | 临时挂载点 |
| `/media` | 可移动设备挂载点 |

```bash
# 查看目录结构
ls -la /

# 查看磁盘使用情况
df -h

# 查看目录大小
du -sh /home
```

## 4. 挂载与卸载

### 4.1 挂载文件系统

```bash
# 临时挂载
mount /dev/sdb1 /mnt

# 挂载为只读
mount -o ro /dev/sdb1 /mnt

# 挂载为读写
mount -o rw /dev/sdb1 /mnt

# 查看挂载信息
mount
findmnt
```

### 4.2 永久挂载（/etc/fstab）

```bash
# 编辑 fstab 文件
sudo vim /etc/fstab

# 添加一行（示例）
/dev/sdb1 /mnt ext4 defaults 0 2

# 测试 fstab 配置
sudo mount -a
```

### 4.3 卸载文件系统

```bash
# 卸载
umount /mnt

# 强制卸载（设备忙时）
umount -l /mnt

# 查找使用设备的进程
fuser -m /mnt
lsof /mnt
```

## 参考资料

- [鸟哥的私房菜 - 文件系统](https://linux.vbird.org/linux_basic/0230filesystem.php)
- [Arch Wiki - File systems](https://wiki.archlinux.org/title/File_systems)
- [FHS 标准](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html)
