# 文件系统

如果说进程是 Linux 的"心跳"，文件系统就是它的"记忆"。权限配错会导致服务起不来，挂载写错会导致重启丢数据，目录放错位置会导致备份漏文件——运维和开发中大部分"玄学问题"，追到最后都落在文件系统这一层。本章从"数据怎么存在磁盘上"讲到"谁能读写这些数据"，帮你建立从磁盘到目录再到权限的完整心智模型。

> 内容参考自 FHS 3.0、Linux 内核文档与 Arch Wiki，见文末参考资料。

## 学习目标

- 理解文件系统的作用与 VFS 抽象层，说清"一切皆文件"到底指什么
- 能根据数据特征在 ext4、XFS、Btrfs 之间做出有理由的选择
- 掌握挂载/卸载与 `/etc/fstab` 的正确配置方法，知道写错的后果
- 熟记 FHS 顶级目录的分工，能解释每个目录"为什么存在"
- 熟练使用 rwx、umask、SUID/SGID/Sticky 和 ACL，避开权限相关的经典事故

## 子页导读

| 章节 | 一句话导读 | 适合带着什么问题去读 |
|------|-----------|---------------------|
| [文件系统概念](./filesystem/concept.md) | VFS 分层模型、ext4/XFS/Btrfs 特性对比、挂载与 fstab 实战 | "我的场景该选哪种文件系统？mount 为什么会失败？" |
| [目录层次结构](./filesystem/hierarchy.md) | FHS 每个顶级目录的"存在理由"，/etc、/var、/usr、/proc 的三系差异 | "配置文件该放哪？为什么 /var 和 /usr 要分开？" |
| [文件权限](./filesystem/permissions.md) | rwx 之外的 umask、SUID/SGID/Sticky 真实场景，以及与 ACL 的衔接 | "为什么 umask 是 0022？chmod 4755 什么时候能用、什么时候是坑？" |

## 三系文件系统差异速览

表面上三大家族的目录结构遵循同一份 FHS 标准，实际使用中的差异集中在**默认格式选择**和**包管理器的数据布局**上：

| 维度 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 根分区默认格式 | ext4 | ext4（archinstall 也提供 Btrfs/XFS 选项） | XFS（RHEL 8 起默认，7 及以前是 ext4） |
| Btrfs 采用度 | 可选，不作默认 | 社区常用，安装器内置子卷方案 | 可选，OpenSUSE 系更青睐 |
| 包数据库 | `/var/lib/dpkg/` | `/var/lib/pacman/` | `/var/lib/rpm/` |
| 包缓存 | `/var/cache/apt/archives/` | `/var/cache/pacman/pkg/` | `/var/cache/dnf/` |
| 包配置文件管理 | `.dpkg-dist` 备份 | `.pacnew` / `.pacsave` | `.rpmnew` / `.rpmsave` |
| 日志主文件 | `/var/log/syslog` | `/var/log/messages`（journald 亦可用） | `/var/log/messages` |
| 网络配置目录 | `/etc/netplan/` | `/etc/systemd/network/` 或 NetworkManager | `/etc/sysconfig/network-scripts/`（RHEL 9 起改由 NetworkManager 管理） |
| 合并 /usr | 是（`/bin` → `usr/bin` 符号链接） | 是（2023 年完成 usr-merge） | 是（RHEL 9 起） |

注意最后一行：三大发行版近年都完成了 **usr-merge**（把 `/bin`、`/sbin`、`/lib` 合并进 `/usr` 并保留符号链接），所以你在新装的系统上执行 `ls -ld /bin` 很可能看到 `lrwxrwxrwx ... /bin -> usr/bin`。这不是配置错误，而是为了支持"整个 `/usr` 只读、统一升级"的部署模式。这一细节在 hierarchy 一节展开。

## 快速诊断命令速查

文件系统相关的问题（磁盘满、挂载失败、权限拒绝）排查路径很固定：**先看容量，再看挂载，最后看权限**。把下面这组命令当成肌肉记忆，九成以上的"玄学问题"都能在两分钟内缩小范围：

```bash
# 1. 容量：谁把盘写满了
df -hT                  # 挂载点视角，-T 显示文件系统类型
df -i                   # inode 也可能耗尽（小文件过多时）
du -sh /var/* 2>/dev/null | sort -rh | head   # 定位大目录

# 2. 挂载：设备、文件系统、选项是否符合预期
findmnt                 # 树形查看所有挂载
mount | grep -E 'ro|rw' # 关注是否只读挂载
lsblk -f                # 块设备与文件系统类型、UUID

# 3. 权限与归属：谁在拒绝你
namei -l /path/to/file  # 逐级查看路径上每一段的权限，定位断点
ls -ldZ /path           # -Z 显示安全上下文（SELinux/AppArmor 系）
id && groups            # 当前用户与所属组

# 4. 空间被删文件但仍占位（df 与 du 对不上）
sudo lsof +L1           # 找出已删除但仍被进程持有的文件
```

一个实用的决策顺序：`df` 报满 → 用 `du` 缩小到具体目录 → 若 `du` 结果远小于 `df`，多半是已删除文件仍被进程占用，走 `lsof +L1` 路线；`mount` 失败 → 先 `findmnt` 看历史挂载和 `lsblk -f` 核对 UUID，再查 `/etc/fstab` 语法；`Permission denied` → 用 `namei -l` 从根逐级找到第一段缺 `x` 或属主不对的目录，而不是从最后一级开始猜。三系差异只影响个别命令的默认输出（如 RHEL 默认 XFS、Ubuntu 默认 ext4），诊断思路完全一致。

## 常见问题预览

文件系统和权限是新手最容易踩坑的区域，高频问题预告如下：

1. **`Permission denied` 满天飞**——十有八九不是权限坏了，而是 rwx 三组位的语义没吃透：目录的 `x` 决定能否进入，`w` 决定能否增删条目；对目录没有 `x`，再给 `w` 也写不进文件。
2. **`umount: target is busy`**——有进程还开着该目录下的文件（常见于 `cd` 进没退出、tail 日志、编辑器未关）。用 `fuser -vm /mnt` 找出元凶，而不是随手 `-l` 懒卸载。
3. **fstab 写错导致开机进 emergency shell**——把 `/dev/sda1` 这种不稳定的名字写进 fstab，或挂载点/选项笔误。永远用 UUID，写完先 `sudo mount -a` 验证。
4. **Btrfs 快照复制到自身报错**——快照目标不能位于被快照的子卷内部，否则形成循环。
5. **给脚本加 SUID 却不生效**——内核出于安全考虑会忽略 shell 脚本上的 SUID 位，只有二进制程序有效。
6. **误以为 `chmod -R 777` 能解决权限问题**——它解决了眼前，却把安全边界拆光了；正确做法是定位所有者/组，用最小权限修复。
7. **Arch 升级后报 `.pacnew` 未合并**——pacman 不会覆盖你改过的配置，留下的 `.pacnew` 需要人工 diff 后决定取舍。

### 选择文件系统决策表

选格式别迷信"最新的就是最好的"，按数据特征对号入座：

| 场景特征 | 推荐格式 | 理由 |
|----------|----------|------|
| 通用服务器/桌面，追求稳定省心 | **ext4** | 生态最成熟，三系都支持，出问题资料最多 |
| 大文件、数据库、单机大容量 | **XFS** | RHEL 8+ 默认，大文件与并行 I/O 表现好 |
| 需要快照、透明压缩、子卷灵活布局 | **Btrfs** | 快照/校验/压缩是杀手锏，但要注意 RAID5/6 写洞问题 |
| UEFI 启动分区 | **FAT32 (ESP)** | 固件只认 FAT，与根分区用什么无关 |
| 外置 U 盘频繁插拔 | **exFAT / FAT32** | 跨平台兼容，无日志不怕异常拔出 |

核心取舍一句话：**省心选 ext4，大容量大文件选 XFS，要快照/压缩选 Btrfs**。做决定前先问自己"这块盘上的数据最怕什么"——怕丢选带校验的，怕性能瓶颈选并行好的，怕管理复杂选默认的。

## 阅读顺序

建议先读概念篇建立"磁盘 → VFS → 目录 → 权限"的分层视角，再读层次结构篇理解每层数据该落在哪里，最后读权限篇完成闭环。如果你是带着具体故障来的（比如服务 403、挂载失败），可以直接跳到对应小节，但建议回头把"为什么"部分补完——权限和路径的问题往往成对出现。

## 参考资料

- FHS 3.0 — [refspecs.linuxfoundation.org](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html)
- Arch Wiki - File systems — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_systems)
- Arch Wiki - File permissions and attributes — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_permissions_and_attributes)
- Linux Kernel Documentation: Filesystems — [kernel.org](https://www.kernel.org/doc/html/latest/filesystems/)
- 鸟哥的私房菜 - Linux 文件权限与目录配置 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0210filepermission.php)
- Debian Reference - File system hierarchy — [debian.org](https://www.debian.org/doc/debian-reference/ch02.zh-cn.html)
