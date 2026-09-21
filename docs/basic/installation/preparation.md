# 安装前的准备

## 学习目标

- 了解安装 Linux 前需要做的准备工作
- 掌握硬件兼容性检查方法
- 学会规划磁盘分区

## 1. 硬件兼容性检查

### 1.1 最低硬件要求

| 组件 | 最低要求 | 推荐配置 |
|------|---------|---------|
| CPU | 1 GHz | 2 GHz 双核以上 |
| 内存 | 1 GB | 4 GB 以上 |
| 磁盘 | 10 GB | 25 GB 以上 |
| 显卡 | 支持 1024x768 | 支持 1920x1080 |

### 1.2 检查硬件支持

```bash
# 查看 CPU 信息
lscpu
cat /proc/cpuinfo

# 查看内存信息
free -h
cat /proc/meminfo

# 查看磁盘信息
lsblk
fdisk -l

# 查看网卡信息
lspci | grep -i network
ip link show
```

## 2. 磁盘分区规划

### 2.1 分区方案

#### 简单方案（新手推荐）

| 分区 | 大小 | 文件系统 | 挂载点 |
|------|------|---------|--------|
| / | 剩余空间 | ext4 | / |
| swap | 内存的 1-2 倍 | swap | - |

#### 标准方案（服务器推荐）

| 分区 | 大小 | 文件系统 | 挂载点 |
|------|------|---------|--------|
| /boot | 1 GB | ext4 | /boot |
| / | 20-50 GB | ext4 | / |
| /home | 剩余空间 | ext4 | /home |
| swap | 内存的 1-2 倍 | swap | - |

#### 进阶方案（生产环境推荐）

| 分区 | 大小 | 文件系统 | 挂载点 |
|------|------|---------|--------|
| /boot/efi | 512 MB | FAT32 | /boot/efi |
| /boot | 1 GB | ext4 | /boot |
| / | 20-50 GB | ext4 | / |
| /var | 20-100 GB | ext4 | /var |
| /tmp | 10-20 GB | ext4 | /tmp |
| /home | 剩余空间 | ext4 | /home |
| swap | 内存的 1-2 倍 | swap | - |

### 2.2 LVM 分区

LVM（Logical Volume Manager）提供更灵活的磁盘管理：

```bash
# 创建物理卷
pvcreate /dev/sda2

# 创建卷组
vgcreate vg0 /dev/sda2

# 创建逻辑卷
lvcreate -L 20G -n lv_root vg0
lvcreate -L 100G -n lv_home vg0

# 格式化
mkfs.ext4 /dev/vg0/lv_root
mkfs.ext4 /dev/vg0/lv_home

# 挂载
mount /dev/vg0/lv_root /mnt
mount /dev/vg0/lv_home /mnt/home
```

## 3. 网络准备

### 3.1 网络连接方式

- **有线连接**：自动获取 IP（DHCP）
- **无线连接**：需要 Wi-Fi 驱动
- **静态 IP**：手动配置 IP 地址

### 3.2 网络配置

```bash
# 查看网络接口
ip link show

# 查看 IP 地址
ip addr show

# 测试网络连接
ping -c 3 8.8.8.8
```

## 4. 数据备份

安装前务必备份重要数据：

```bash
# 使用 rsync 备份
rsync -av /home/user/ /backup/home/

# 使用 tar 打包
tar -czvf backup.tar.gz /home/user/
```

## 参考资料

- [鸟哥的私房菜 - 安装前的准备](https://linux.vbird.org/linux_basic/0160startlinux.php#prepare)
- [Arch Wiki - Partitioning](https://wiki.archlinux.org/title/Partitioning)
