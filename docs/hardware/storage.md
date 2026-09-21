# 存储设备

## 学习目标

- 了解常见存储设备的类型
- 掌握磁盘信息的查看方法
- 学会磁盘管理和优化

## 1. 存储设备类型

### 1.1 硬盘类型

| 类型 | 说明 | 特点 |
|------|------|------|
| HDD | 机械硬盘 | 大容量、低成本 |
| SSD | 固态硬盘 | 高速度、无噪音 |
| NVMe | 非易失性内存 | 超高速、低延迟 |

### 1.2 接口类型

| 接口 | 说明 | 速度 |
|------|------|------|
| SATA | 串行 ATA | 6 Gbps |
| SAS | 串行连接 SCSI | 12 Gbps |
| NVMe | 非易失性内存 | 32 Gbps+ |
| USB | 通用串行总线 | 5-20 Gbps |

## 2. 磁盘信息查看

### 2.1 lsblk - 块设备

```bash
# 查看块设备信息
lsblk

# 查看详细信息
lsblk -f

# 查看特定设备
lsblk /dev/sda

# 显示文件系统类型
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT
```

### 2.2 fdisk - 磁盘分区

```bash
# 查看磁盘分区
sudo fdisk -l

# 查看特定磁盘
sudo fdisk -l /dev/sda

# 进入交互模式
sudo fdisk /dev/sda
```

### 2.3 hdparm - 硬盘参数

```bash
# 查看硬盘信息
sudo hdparm -I /dev/sda

# 测试读取速度
sudo hdparm -Tt /dev/sda
```

### 2.4 smartctl - SMART 信息

```bash
# 安装 smartmontools
sudo apt install smartmontools    # Debian/Ubuntu
sudo yum install smartmontools    # RHEL/CentOS

# 查看 SMART 信息
sudo smartctl -a /dev/sda

# 查看健康状态
sudo smartctl -H /dev/sda

# 运行自检
sudo smartctl -t short /dev/sda
```

## 3. 磁盘分区

### 3.1 fdisk - MBR 分区

```bash
# 进入 fdisk 交互模式
sudo fdisk /dev/sdb

# 常用命令
# n：新建分区
# d：删除分区
# p：显示分区表
# t：更改分区类型
# w：保存并退出
# q：不保存退出
```

### 3.2 gdisk - GPT 分区

```bash
# 进入 gdisk 交互模式
sudo gdisk /dev/sdb

# 常用命令
# n：新建分区
# d：删除分区
# p：显示分区表
# t：更改分区类型
# w：保存并退出
# q：不保存退出
```

### 3.3 parted - 分区工具

```bash
# 查看分区信息
sudo parted /dev/sdb print

# 创建 GPT 分区表
sudo parted /dev/sdb mklabel gpt

# 创建分区
sudo parted /dev/sdb mkpart primary ext4 0% 50%

# 创建交换分区
sudo parted /dev/sdb mkpart primary linux-swap 50% 100%
```

## 4. 文件系统管理

### 4.1 创建文件系统

```bash
# 创建 ext4 文件系统
sudo mkfs.ext4 /dev/sdb1

# 创建 XFS 文件系统
sudo mkfs.xfs /dev/sdb1

# 创建 Btrfs 文件系统
sudo mkfs.btrfs /dev/sdb1

# 创建 swap
sudo mkswap /dev/sdb2
```

### 4.2 挂载文件系统

```bash
# 临时挂载
sudo mount /dev/sdb1 /mnt

# 挂载为只读
sudo mount -o ro /dev/sdb1 /mnt

# 挂载为读写
sudo mount -o rw /dev/sdb1 /mnt

# 查看挂载信息
mount
findmnt
```

### 4.3 永久挂载（/etc/fstab）

```bash
# 编辑 fstab 文件
sudo vim /etc/fstab

# 添加一行（示例）
/dev/sdb1 /mnt ext4 defaults 0 2

# 测试 fstab 配置
sudo mount -a
```

## 5. LVM 管理

### 5.1 物理卷

```bash
# 创建物理卷
sudo pvcreate /dev/sdb1

# 查看物理卷
sudo pvdisplay
sudo pvs
```

### 5.2 卷组

```bash
# 创建卷组
sudo vgcreate vg0 /dev/sdb1

# 查看卷组
sudo vgdisplay
sudo vgs

# 扩展卷组
sudo vgextend vg0 /dev/sdc1
```

### 5.3 逻辑卷

```bash
# 创建逻辑卷
sudo lvcreate -L 20G -n lv_root vg0

# 查看逻辑卷
sudo lvdisplay
sudo lvs

# 扩展逻辑卷
sudo lvextend -L +10G /dev/vg0/lv_root

# 扩展文件系统
sudo resize2fs /dev/vg0/lv_root    # ext4
sudo xfs_growfs /dev/vg0/lv_root   # XFS
```

## 6. 磁盘性能测试

### 6.1 dd - 简单测试

```bash
# 测试写入速度
dd if=/dev/zero of=testfile bs=1G count=1 oflag=direct

# 测试读取速度
dd if=testfile of=/dev/null bs=1G count=1 iflag=direct
```

### 6.2 fio - 专业测试

```bash
# 安装 fio
sudo apt install fio    # Debian/Ubuntu
sudo yum install fio    # RHEL/CentOS

# 顺序读测试
fio --name=seq_read --rw=read --bs=1M --size=1G --numjobs=1 --runtime=60 --filename=testfile

# 顺序写测试
fio --name=seq_write --rw=write --bs=1M --size=1G --numjobs=1 --runtime=60 --filename=testfile

# 随机读测试
fio --name=rand_read --rw=randread --bs=4k --size=1G --numjobs=4 --runtime=60 --filename=testfile
```

## 7. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 分区工具 | fdisk/gdisk | fdisk/gdisk |
| LVM 包 | lvm2 | lvm2 |
| 文件系统 | ext4/XFS | ext4/XFS |

## 参考资料

- [鸟哥的私房菜 - 磁盘管理](https://linux.vbird.org/linux_basic/0230filesystem.php)
- [Arch Wiki - Partitioning](https://wiki.archlinux.org/title/Partitioning)
- [Arch Wiki - LVM](https://wiki.archlinux.org/title/LVM)
