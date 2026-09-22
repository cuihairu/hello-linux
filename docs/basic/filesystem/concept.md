# 文件系统概念

文件系统是操作系统管理磁盘数据的方式——它规定数据按什么结构存放、如何命名、怎样被检索。但对使用者来说，更重要的事实是：Linux 在具体文件系统之上盖了一层 **VFS（虚拟文件系统）**，让 ext4、XFS、Btrfs、NFS 甚至 `/proc` 这类"假目录"对你呈现完全一致的操作接口。理解这层抽象，是理解"为什么 mount 能把一块盘接到任意目录"和"为什么一切皆文件"的前提。

> 内容参考自 Linux 内核文档与 Arch Wiki，见文末参考资料。

## 学习目标

- 理解文件系统与 VFS 分层模型，说清"一切皆文件"到底指什么
- 能根据数据特征在 ext4、XFS、Btrfs 之间做出有理由的选择
- 掌握挂载/卸载与 `/etc/fstab` 的正确配置方法，知道写错的后果

## 1. 什么是文件系统

### 1.1 它决定的三件事

文件系统决定了数据在磁盘上如何存储、组织和访问：**布局**（inode 表、目录项、空闲块怎么排）、**语义**（权限如何作用、mtime 何时更新、是否支持快照/压缩）和**上限**（单文件最大多大、分区最大多大）。格式化一块盘，本质上就是把这三件事定死——所以选 ext4 还是 Btrfs 不是口味问题，而是能力边界问题。

### 1.2 VFS：所有文件系统共用的中间层

```
┌─────────────────────────────────┐
│          应用程序                │   cat、ls、vim 都只认这一层
├─────────────────────────────────┤
│      VFS（虚拟文件系统）         │   统一接口：open/read/write/mount
├────────┬────────┬────────┬──────┤
│  ext4  │  XFS   │ Btrfs  │ NFS  │   具体实现，各管各的磁盘格式
├────────┴────────┴────────┴──────┤
│          块设备驱动              │
├─────────────────────────────────┤
│       磁盘 / SSD / NVMe         │
└─────────────────────────────────┘
```

```bash
cat /proc/filesystems
# nodev	sysfs
# nodev	tmpfs
#     	ext4          ← 无 nodev 前缀的是真正的磁盘文件系统
#     	xfs
#     	btrfs
```

VFS 的价值在于**解耦**：应用程序不需要知道背后是本地 Btrfs 还是网络 NFS，调用的都是同一套 `open()`/`read()`；也因此"把移动硬盘挂到 `/mnt` 下当本地目录用"才成为可能——挂载就是把某个具体文件系统的根，接到 VFS 目录树的某个节点上。

## 2. "一切皆文件"

Linux 把几乎所有资源抽象成文件接口，好处是**一套命令通吃**：`cat`、`ls`、重定向、管道对设备、进程、网络状态同样有效。

```bash
# 一切皆文件的直观对照：设备、进程、网络都能被 ls/cat 统一操作
ls -la /dev/sda        # 块设备（b 开头）
ls -la /dev/tty        # 字符设备（c 开头）
ls -la /dev/null       # 空设备——写进去的数据直接丢弃
cat /proc/cpuinfo      # 内核现造的"文件"
cat /proc/meminfo
```

`/dev`、`/proc`、`/sys` 都不是"存了数据的目录"，而是内核在内存里现造的文件——它们能被 `ls` 列出、被 `cat` 读取，靠的正是 VFS 的统一接口。

## 3. 常见文件系统：ext4、XFS、Btrfs 怎么选

三大发行版的默认选择各不相同，这不是偶然：

| 文件系统 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky | 一句话定位 |
|---------|---------------|------|-------------------|-----------|
| ext4 | 默认根分区 | 默认根分区 | RHEL 7 及以前默认 | 稳定的通用默认，无短板也无长板 |
| XFS | 可选 | 可选 | **RHEL 8 起默认** | 大文件、高并发写性能好，企业服务器偏好 |
| Btrfs | 可选 | 安装器提供子卷方案 | 可选 | 快照、透明压缩、校验和——为"可恢复性"付费 |

### 3.1 ext4：事实上的默认答案

成熟、经过最长实战检验、`fsck` 工具链完备。你没有特殊需求时选它不会错：

```bash
sudo mkfs.ext4 /dev/sdb1
# mke2fs 1.47.0 (28-Jan-2024)
# Creating filesystem with 6553600 4k blocks and 1638400 inodes

sudo tune2fs -l /dev/sdb1 | grep -E 'Filesystem features|Inode count'
```

代价：没有原生快照，扩容容易缩容极难（`resize2fs` 只能扩），海量小文件场景下目录项性能弱于 XFS。

### 3.2 XFS：大文件与高吞吐

RHEL 8 选择它做默认，看重的是大文件写入、并行 I/O 和元数据扩展性。适合数据库数据目录、媒体库、日志归档：

```bash
sudo mkfs.xfs /dev/sdb1
# meta-data=/dev/sdb1 isize=512 agcount=4, sectsize=512
# data bsize=4096 blocks=... imaxpct=25

sudo xfs_info /dev/sdb1 | head -3
```

注意 XFS 的老限制（历史版本单文件 16TB 时代已过）当前版本上限极高，但**不支持缩容**是硬约束——规划 XFS 分区时"宁大勿小"。

### 3.3 Btrfs：为可恢复性设计

写时复制（CoW）带来快照、回滚、透明压缩和校验和（能主动发现静默数据损坏）。Arch 用户群中 Btrfs 流行度不低，Ubuntu 也在 Live 会话默认用它：

```bash
sudo mkfs.btrfs /dev/sdb1
# 创建快照（目标路径不能位于被快照的子卷内，否则会循环嵌套）
sudo btrfs subvolume snapshot /mnt /mnt/snapshots/my-snapshot
# Create a snapshot of '/mnt' in '/mnt/snapshots/my-snapshot'
```

代价：CoW 在数据库等"原地更新"负载上有写放大问题（可通过 `nodatacow` 关闭，但会失去快照能力）；碎片化在 HDD 上更明显；备份工具需按子卷理解结构。

### 3.4 容量上限对照

| 文件系统 | 单文件上限 | 分区上限 | 特点 | 适用场景 |
|---------|-----------|---------|------|---------|
| ext4 | 16 TB | 1 EB | 稳定成熟 | 通用默认 |
| XFS | 8 EB | 8 EB | 大文件高性能 | 数据库、媒体 |
| Btrfs | 16 EB | 16 EB | 快照、压缩、校验 | 需要回滚的数据保护 |
| FAT32 | 4 GB | 8 TB | 跨平台兼容 | ESP、U 盘 |
| NTFS | 16 TB | 256 TB | Windows 默认 | 双系统共享数据 |

顺带解释安装篇里"ESP 必须 FAT32"：UEFI 规范只认 FAT 系列，所以哪怕根分区用 Btrfs，那个 512MB 的引导分区也没得选。

## 4. 挂载与卸载

### 4.1 挂载：把设备接到目录树上

```bash
# 临时挂载 / 只读挂载（排查损坏盘或取证时用）
sudo mount /dev/sdb1 /mnt
sudo mount -o ro /dev/sdb1 /mnt
findmnt            # 树状输出比 mount 一行行更易读
```

**为什么强调"挂载点必须是已存在的空目录"**：挂载本质是把设备的根目录"覆盖"到该目录上。如果挂到有文件的目录上，原有文件会被暂时遮住（不是删除，卸载后重现）——把 `/home` 挂到一个非空目录、或把根分区挂到自身子目录，都是经典的把自己关在门外的操作。

### 4.2 永久挂载：/etc/fstab

`mount` 命令的效果重启即失效；要开机自动挂载，写进 `/etc/fstab`：

```bash
sudo vim /etc/fstab
# UUID=8f3c1c2e-...  /data  ext4  defaults  0  2
#                                  │        └── fsck 顺序：0=不检查，/=根最先，2=根之后
#                                  └── 默认 rw,suid,dev,exec,auto,nouser,async
```

**写完必测**——fstab 错误的代价是开机卡在 emergency shell：

```bash
sudo mount -a     # 按 fstab 重新挂载所有未挂载项；有错会报 UUID 失败/挂载点不存在
echo $?           # 0 才算通过
```

永远用 UUID（或 LABEL）而非 `/dev/sda1`：设备名依赖枚举顺序，加了块硬盘就可能漂移，UUID 则终身绑定该分区。

### 4.3 卸载

```bash
sudo umount /mnt
# umount: /mnt: target is busy.        ← 最常见报错

sudo fuser -vm /mnt                    # 找出占用者：cui 的 shell cd 在里面、root 的 tail 没关
# -l 懒卸载：等占用者释放后才真正断开。应急可用但别养成习惯——
# 它会掩盖"谁在用"的问题，且进程仍持有已删除的文件句柄
sudo umount -l /mnt
```

卸载失败几乎从不是文件系统坏了，而是**还有人开着这个目录**。先 `fuser` 找到进程，关掉再卸，比 `-l` 更干净。

## 5. 常见坑

- **`mount -a` 没测就重启**——fstab 一个 UUID 抄错，重启就进不去系统。改完永远先 `sudo mount -a`。
- **把 `/dev/sdX` 写进 fstab**——设备名漂移导致挂到错误的盘。一律 UUID。
- **以为 `mount` 后的数据在设备里**——挂载只是"接上"，`umount` 前直接拔盘可能因缓存未落盘丢数据；拔盘前先 `sync` 并正常卸载。
- **Btrfs 快照目标放在子卷内部**——形成自嵌套，命令直接报错。快照目录应在子卷之外或作为兄弟子卷。
- **对 Btrfs 用 `fsck.ext4`**——工具不匹配。Btrfs 用 `btrfs check`/`btrfs scrub`，XFS 用 `xfs_repair`，ext4 用 `fsck.ext4`；用错工具轻则无效、重则加重损坏。
- **把 Btrfs 快照当备份**——快照和源盘同生共死，盘坏了全没。快照解决"手滑/升级翻车"，备份要解决"盘坏"，两者不可互相替代。
- **Arch 升级后忘记看包管理状态**——pacman 会在 `/var/lib/pacman/` 维护本地数据库，异常中断的事务可用 `pacman -Dk`/`pacman-keys --populate` 修复；怀疑文件损坏时 `pacman -Qk` 检查已装包的文件完整性。

## 参考资料

- Arch Wiki - File systems — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_systems)
- Arch Wiki - Btrfs / XFS / Ext4 专题页 — [wiki.archlinux.org](https://wiki.archlinux.org/title/Btrfs)
- Linux Kernel Documentation: VFS — [kernel.org/doc](https://www.kernel.org/doc/html/latest/filesystems/)
- ext4 文档 — [kernel.org/doc](https://www.kernel.org/doc/html/latest/filesystems/ext4/)
- `man mount`、`man fstab`、`man filesystems`
