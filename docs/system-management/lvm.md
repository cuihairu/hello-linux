# LVM 逻辑卷管理

在裸分区上格式化文件系统，容量在 `mkfs` 那一刻就被分区表钉死了：根分区给了 50 GB，几个月后写满，你只能在"停机重分区、逐块搬运数据"和"把服务迁走"之间选一个。LVM（Logical Volume Manager，逻辑卷管理器）解决的就是这件事——它在物理盘与文件系统之间插入一层映射，让容量、快照、迁移变成可以随时调整的操作：逻辑卷在线扩容不需要卸载，快照能在备份期间冻结一个一致性视图，多块盘可以拼成一个卷组再按需切片。代价是多一层设备映射，多一套要学的命令，以及"忘记同步扩文件系统"这类只有 LVM 才有的坑。

> 内容参考自 LVM 项目文档与 man 手册（lvm(8)、pvcreate、vgcreate、lvcreate 等），见文末参考资料。

## 学习目标

- 说清 PV / VG / LV 三层抽象各自的边界，以及 PE 为什么决定卷的最终大小
- 会读 `pvs`、`vgs`、`lvs` 与 `lsblk` 的输出，把逻辑卷一路定位到物理盘
- 独立完成"PV → VG → LV → mkfs → 挂载"的建卷闭环，并写对 fstab
- 分清 ext4 与 XFS 的在线扩容命令差异，以及扩完逻辑卷还要扩文件系统这一步
- 会用 LVM 快照做备份前置冻结，理解快照空间打满会失效
- 掌握 `pvmove`/`vgreduce` 做在线换盘，能对着现有机器判断 LVM 与 RAID、LUKS 的栈顺序

## 1. 三层模型与 PE

### 1.1 PV / VG / LV

LVM 把存储抽象成三层，自上而下说更顺：

- **PV（Physical Volume，物理卷）**：`pvcreate` 打过 LVM 元数据标签的块设备。它可以是整块盘、一个分区（惯例是类型 `8e00` 的 GPT 分区），也可以是 md RAID 阵列或 dm-crypt 加密设备——这一层不关心底下是什么。
- **VG（Volume Group，卷组）**：`vgcreate` 把一个或多个 PV 汇成资源池。容量单位的管理、剩余空间的查询都发生在这一层，`vgs` 的输出就是卷组账本。
- **LV（Logical Volume，逻辑卷）**：`lvcreate` 从 VG 里切出来的可用卷，格式化成文件系统后挂载，用法和 `/dev/sda1` 这类普通分区没有区别。

同一台机器上可以有多个 VG，一个 VG 里可以有多个 LV，一个 LV 的物理落点可以横跨多个 PV。这套映射关系记录在磁盘上的 LVM 元数据里（每个 PV 头部一份副本，默认明文），所以内核在开机时能自动组装出 `/dev/mapper/` 下的设备节点。

### 1.2 PE：分配的最小粒度

LVM 不按字节分配，而是以 **PE（Physical Extent，物理扩展块）** 为单位搬运空间，PE 大小在 `vgcreate -s` 时确定（默认 4 MiB）。LV 的块被映射到一组 PE 上，这件事决定了两个实际后果：

- **卷的大小是 PE 的整数倍**。你请求 `lvcreate -L 10G`，LVM 会向上取整到你请求的 PE 个数，可能比 10G 略小或略大；相差多少可以用 `vgs -o vg_name,vg_extent_size` 和 `lvs -o lv_name,size,current_le` 自己核对。
- **PE 是 pvmove、快照、镜像的搬运单位**。理解 PE 比理解分区表更接近 LVM 的本质：LV 不是一段连续地址，而是一张"逻辑块 → 物理 PE"的映射表。

### 1.3 读三套输出

`pvs`/`vgs`/`lvs` 是三个最常用的查询命令，各自对应一层。下面是一台典型服务器的输出：

```bash
$ sudo pvs                  # 每个 PV：属于哪个 VG、总大小、已用多少、还剩多少
  PV         VG  Fmt  Attr PSize   PFree
  /dev/sda3  vg0 lvm2 a--  462.80g 512.00m
  /dev/sdb1  vg0 lvm2 a--  931.00g 931.00g

$ sudo vgs                  # 每个 VG：PV 数、LV 数、总空间与剩余空间
  VG  #PV #LV #SN Attr   VSize    VFree
  vg0   2   3   0 wz--n-   1.36t   931.51g

$ sudo lvs -a -o name,vg_name,lv_size,devices   # 每个 LV：落在哪些 PV 上
  LV     VG  LSize  Devices
  lvroot vg0 50.00g /dev/sda3(0)
  lvhome vg0 412.00g /dev/sda3(12800)
```

判读的重点：`vgs` 的 `VFree` 是**还能切出多少新 LV 或加给现有 LV** 的空间——扩容前必须先看这一行，它决定了你是 `lvextend` 就够，还是得先 `vgextend` 加盘。`pvs` 的 `PFree` 是同一个量在单个 PV 上的分解。`lvs -a` 加 `-a` 是为了把内部卷（快照、镜像的 `_rimage`/`_rmeta` 等）也列出来，做故障排查时必须看到它们。

`lvs` 的 `Devices` 列相当于把"逻辑卷 → 物理盘"的映射直接摊开，和 `lsblk` 的多层树互补：`lsblk` 从设备树的角度看（哪块盘上挂着什么），`lvs` 从 LVM 内部的角度看（这个卷用了哪几个 PV 的哪些 PE）。同一个 `sda3 → vg0-lvroot → /` 结构在 `lsblk` 里的读法，[硬件篇 · 存储设备](../hardware/storage.md)第 3.1 节已经讲过——device-mapper 把虚拟设备插入块层这件事也在那篇，本页不再复述，只接着往下走怎么把这块设备建出来。

```bash
# lsblk 与 lvm 命令的对应关系：设备树的每一层都能用一套命令验证
$ lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS
NAME        SIZE TYPE FSTYPE MOUNTPOINTS
sda       465.8G disk
├─sda1        1G part vfat   /boot/efi
├─sda2        2G part ext4   /boot
└─sda3    462.8G part LVM2_member
  ├─vg0-lvroot 50G lvm  ext4  /
  └─vg0-lvhome 412G lvm xfs   /home
```

设备名分三种写法，认识它们能少踩很多坑：`/dev/vg0/lvroot`（VG/LV 符号链接）、`/dev/mapper/vg0-lvroot`（device-mapper 节点）、`/dev/dm-0`（内核真实编号）。三者指向同一个设备，但只有前两种是稳定的，`dm-N` 的编号随内核探测顺序变化。

## 2. 从裸盘到挂载：建卷序列

下面是一条完整可执行的序列，假设目标是把新加的 `/dev/sdb` 做成分给 `/srv/data` 的逻辑卷。每一步之后都有可验证的输出，不要一口气敲完再看结果。

```bash
# 1) 看一眼盘，确认没选错设备（/dev/sdb 上的数据会被清掉）
$ sudo lsblk /dev/sdb
NAME MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS
sdb    8:16   0  1.8T  0 disk

# 2) 整盘做 PV（也可以先分一个 8e00 类型的分区再做 PV，见下）
$ sudo pvcreate /dev/sdb
  Physical volume "/dev/sdb" successfully created.

# 3) 建 VG，-s 指定 PE 大小（这里 4M，缺省值）
$ sudo vgcreate -s 4M vgdata /dev/sdb
  Volume group "vgdata" successfully created.

# 4) 切 LV：-L 按容量切，-l 按 PE 个数切（两者互斥，选一个）
$ sudo lvcreate -L 1T -n lvdata vgdata
  Logical volume "lvdata" created.

# 5) 格式化——LVM 不替你做这一步，文件系统要自己上
$ sudo mkfs.ext4 /dev/vgdata/lvdata

# 6) 挂载并写 fstab（fstab 一律用 UUID 或 /dev/mapper/ 稳定路径）
$ sudo mkdir -p /srv/data
$ sudo mount /dev/vgdata/lvdata /srv/data
$ lsblk -f /dev/vgdata/lvdata     # 取 UUID 与 FSTYPE
```

几个必须固化的细节：

- **`-L` 与 `-l` 的区别**。`-L 1T` 按容量给；`-l 100%FREE` 把 VG 剩余空间全给这个卷；`-l 50%VG` 取整组的一半。用 `%` 形式扩卷时尤其方便，能避免手算容量算错。
- **整盘 PV 还是分区 PV**。直接把整盘 `pvcreate` 最简单；但如果这块盘将来可能要拆成不同用途，先划一个分区、把类型设为 `8e00`（Linux LVM，MBR）或 `E6D6D379-F507-44C2-A23C-238F2A3DF928`（GPT 的 GUID），再对分区做 PV，灵活度更高。分区工具的用法见[硬件篇](../hardware/storage.md)第 3.2 节的引用。
- **fstab 里写什么**。写 `/dev/vg0/lvroot` 能挂，但设备名在卷改名后会失效；写 `/dev/mapper/vg0-lvroot` 更明确，写 `UUID=` 最稳。三条铁律与普通分区一致：**每加一行就跑一次 `mount -a` 验证**，确认不报错再重启，否则下次开机卡在 emergency shell。fstab 字段的完整语义归[基础篇 · 文件系统](../basic/filesystem.md)。
- **LVM 元数据默认不加密**。`lsblk` 能看到 VG/LV 名、`pvs` 能看到 PV 布局，这是设计使然；如果盘上结构本身算敏感信息，考虑把 LV 放进 LUKS 里（见第 7 节）。

## 3. 扩容

扩容是 LVM 日常最高频的操作，分两件事：**先扩逻辑卷，再扩文件系统**。这两步的边界在于 LVM 只管块设备容量，不认识上层是什么文件系统，所以"逻辑卷变大"和"文件系统能用上这块空间"必须分别做。

```bash
# 扩之前先看卷组还剩多少（VFree 够不够，不够就先加盘）
$ sudo vgs
  VG  #PV #LV #SN Attr   VSize VFree
  vg0   2   3   0 wz--n- 1.36t 100.00g

# 扩逻辑卷：三种写法，选其一
$ sudo lvextend -L +50G /dev/vg0/lvroot        # 在当前基础上加 50G
$ sudo lvextend -L 100G /dev/vg0/lvroot        # 扩到绝对值 100G（注意不是加）
$ sudo lvextend -l +100%FREE /dev/vg0/lvroot   # 吃掉 VG 全部剩余空间

# 扩文件系统：ext4 与 XFS 命令不同，这是 LVM 最常见的失误点
$ sudo resize2fs /dev/vg0/lvroot          # ext4：在线扩容，无需卸载
$ sudo xfs_growfs /mnt/xfsvol             # XFS：必须传【挂载点】，不是设备名
```

三个容易出错的判断：

**`-L +50G` 和 `-L 50G` 差一个加号**。前者是增量，后者是目标值。`lvextend` 不会缩容——目标值小于当前大小时命令直接报错退出；真正的风险是静默偏差：卷现在 40G，你想加 50G 到 90G，写成 `-L 50G` 得到的就是 50G，比预期少了 40G 而命令照常成功。用 `-L` 前先想清楚是"加"还是"到"。

**`resize2fs` 吃设备名，`xfs_growfs` 吃挂载点**。这不是记混了，是设计差异：XFS 只能在线增长（不能在线收缩），其生长接口是文件系统级操作，需要一个已挂载的文件系统路径。如果你习惯性地对 XFS 敲 `xfs_growfs /dev/vg0/lvhome`，它会报不是挂载点；反过来对 ext4 敲挂载点也会失败。两种文件系统的特性对比见[基础篇 · 文件系统概念](../basic/filesystem/concept.md)。

**XFS 不支持缩容**，这是硬约束，不是命令没找对。XFS 的设计让在线缩小在技术上不可行，所以 XFS 卷的容量只能单向增加。RHEL 系默认就是 XFS，因此在这类系统上"给少了改小"的路径根本不存在——规划容量时必须一次给够，或接受"缩不了就只能重建 + 迁数据"。

VG 空间不够时先加物理资源，再加给 LV：

```bash
# 把一块新盘加进卷组（-v 输出过程，比如是否要迁移已有 PE）
$ sudo pvcreate /dev/sdc
$ sudo vgextend -v vg0 /dev/sdc
$ sudo vgs vg0                 # VFree 从加盘前变成 加盘后 + /dev/sdc 的大小
$ sudo lvextend -l +100%FREE /dev/vg0/lvhome
$ sudo xfs_growfs /home
```

给 LV 扩容不丢数据、不需要卸载（ext4 在线增长、XFS 在线增长都支持，前提是 VG 有空间），但**扩之前一定先 `df -h` 确认挂载点，扩完再 `df -h` 确认文件系统真的变大了**——这一步的分量在第 9 节反复出现。

## 4. 缩容

**缩容是高风险操作，不是扩容的逆操作。** 扩容丢数据的概率接近零，缩容丢数据的概率取决于你顺序做对没有、文件系统支持不支持、以及数据是不是真的落在那块空间里。先把结论放前面：

> 生产环境上，容量不够时**优先考虑加盘**（`vgextend` 加物理卷，见第 3 节），而不是缩小别的卷腾空间。缩容只在"某块卷确实长期空着、且腾出的空间有明确去向"时才做，并且要挑维护窗口、先备份。

如果确实要缩，ext4 的顺序是**先缩文件系统，再缩逻辑卷**，绝不能反：

```bash
# 1) 卸载文件系统（ext4 缩容必须离线，在线缩容的内核支持非常有限）
$ sudo umount /srv/data

# 2) 先做文件系统自检，缩容前必须确认 fs 干净
$ sudo e2fsck -f /dev/vgdata/lvdata

# 3) 缩小文件系统到目标大小（这一步之后，尾部空间才好撤回）
$ sudo resize2fs /dev/vgdata/lvdata 800G

# 4) 再收回逻辑卷（-L 800G 是缩到的目标值，不是缩掉的量）
$ sudo lvreduce -L 800G /dev/vgdata/lvdata

# 5) 重新挂载并核对
$ sudo mount /dev/vgdata/lvdata /srv/data && df -h /srv/data
```

顺序的关键在于：`resize2fs` 缩小文件系统时，它会把数据往低地址搬，尾部那段空间变成空洞；此时如果先 `lvreduce` 把逻辑卷切短，文件系统还没搬完的数据会被直接砍掉。**先 fs 后 lv**，一步都不能反。缩容还有两个前提：XFS 根本不支持缩（第 3 节），以及目标大小不能小于实际数据量——`resize2fs` 会在你请求小于数据用量时报错退出，这是它的保护机制，报错是对的。

对确实无法离线的场景，可以先用 `lvreduce --test` 干跑看 LVM 是否接受这个请求，但**在线缩 ext4 的支持极不稳定，不要当成生产能力**。缩容后 VG 会多出空间，可以再分给别的卷或直接 `vgreduce` 摘盘。

## 5. 快照

LVM 快照是**写时复制（COW）**语义：创建瞬间它引用源 LV 的全部 PE，不复制数据；此后源 LV 上任何被写入的 PE，旧内容会被先搬到快照空间里保存，源上的新内容照常落盘。快照本身是一个可挂载、可读写的普通 LV，所以你可以把快照挂到别处以"冻结的那个时刻"去做备份。

```bash
# 1) 给源卷拍一张 20G 的快照（快照是一个独立 LV，别把它当零成本）
$ sudo lvcreate -s -L 20G -n lvdata_snap /dev/vgdata/lvdata

# 2) 挂载快照到别处（注意：不要挂回源挂载点；挂载前 fsck 一下更稳）
$ sudo mkdir -p /mnt/snap
$ sudo mount -o ro,nouuid /dev/vgdata/lvdata_snap /mnt/snap
$ sudo tar -czf /backup/data_$(date +%F).tar.gz -C /mnt/snap .

# 3) 备份完立刻删掉快照，否则源一被写，快照就开始吃空间
$ sudo umount /mnt/snap && sudo lvremove /dev/vgdata/lvdata_snap

# 4) 回滚：把快照合并回源卷（源卷必须未被挂载或处于可合并状态）
$ sudo lvconvert --merge /dev/vgdata/lvdata_snap
```

**快照容量给多少**。没有精确公式，取决于两个量：快照存活时间 × 源卷的写入速率。源卷每秒写 100 MB、快照放一小时，最坏情况要 360 GB；同一场景只放 10 分钟并趁低峰跑备份，20 GB 就够。实践中的做法是给源卷容量的 10%–20% 起步，并配合监控（见下）。快照空间**一旦打满，快照会被标记为无效**——它不再是一致的时间点视图，从它备份出来的数据可能不可用，而且此时源卷不受影响。所以快照必须配 `lvs` 的 `Data%` 监控：

```bash
# 快照用量的三个关键列：Data%（已用）、Meta%（元数据）、剩余空间
$ sudo lvs -a -o name,vg_name,size,data_percent,snap_percent
  LV           VG     LSize  Data%
  lvdata       vgdata  1.00t
  lvdata_snap  vgdata 20.00g   3.50
```

快照适合"备份前置冻结"这个用途：数据库一致性导出的窗口很短，先拍快照把窗口压到秒级、再从快照慢慢导出，比在生产库上跑一小时 `mysqldump` 对业务友好得多。**快照不能替代备份**——它和源卷同在一个 VG、同一批物理盘上，盘坏了快照一起没，勒索加密也能连快照一起写。备份策略的教训见[备份与恢复](./backup-and-recovery.md)第 1 节：快照只是把备份窗口挪走的手段，副本的异地与独立性仍然要按 3-2-1 来做。

## 6. 在线迁移与换盘

`pvmove` 在 PE 粒度上把数据从一块 PV 搬到另一块，全程在线、业务不停。最典型的场景是**换盘**：`/dev/sdb` 报了 SMART 警告（重映射扇区在涨，判读见[硬件篇](../hardware/storage.md)第 4 节），盘还有寿命但迟早要下，此时加一块新盘进来，把数据挪走再摘掉旧盘。

```bash
# 1) 给新盘打 PV 并加入同一个 VG（VG 现有空间够容纳要搬走的量）
$ sudo pvcreate /dev/sdd
$ sudo vgextend vgdata /dev/sdd

# 2) 把 /dev/sdb 上的 PE 全部挪到 VG 的其他 PV 上
$ sudo pvmove /dev/sdb
  /dev/sdb: Moved: 12.5%
  ...
  /dev/sdb: Moved: 100.0%

# 3) 迁移完成后，把空的 PV 从 VG 摘出
$ sudo vgreduce vgdata /dev/sdb

# 4) 抹掉 PV 元数据，这一步之后旧盘就是一块裸盘了
$ sudo pvremove /dev/sdb
```

`pvmove` 的关键性质是**它是 PE 级搬运，可中断可续做**：中途 Ctrl-C 会停下，已搬的不会回滚，重新执行会接着搬；搬运期间源盘上被读到的 PE 会在目标盘上重读，所以对上层是透明的。缺点是绕不开物理带宽——搬 1 TB 数据就是实打实的 1 TB 读写，对大容量盘要规划好窗口，别在业务高峰跑。

`pvmove` 也能指定只搬某个 LV 的 PE（迁移粒度更细），或指定源与目标 PV 做点对点搬运。摘盘前务必确认目标盘已经真正落数据（`pvs` 里旧盘 `PFree` 等于 `PSize`），直接 `vgreduce` 一个还有数据的 PV 会被 LVM 拒绝——拒绝才是对的，那说明它上面还有东西。

## 7. 与 RAID、LUKS 的栈顺序

LVM 是块设备虚拟化的一层，它上面或下面还可以叠加密与冗余，两种栈顺序的取舍不同。

**LVM 之上放 LUKS**（`PV → VG → LV → LUKS → fs`）：每个 LV 单独加密，粒度最细，可以只加密某个卷而让系统盘明文，密钥管理灵活。代价是每个加密卷要单独维护密钥槽，盘数多时管理成本上升。

**LVM 之下用 mdraid**（`md → PV → VG → LV → fs`）：先做 RAID 阵列，再把阵列做成 PV。RAID 层负责冗余与坏盘重建，LVM 只面对一个"永远不会坏"的虚拟盘。**这是绝大多数服务器的选择**，理由是冗余由 RAID 统一管、LVM 不用关心底下几块盘，也不用为了镜像而牺牲 PE 分配的灵活性。软件 RAID 的建法与级别选择见[硬件篇 · 存储设备](../hardware/storage.md)第 6 节。

取舍可以压成一句：**要"哪块卷加密"的细粒度就 LUKS 在上，要"盘坏了与我无关"的省心就 RAID 在下**。两者不互斥——`md → PV → VG → LV → LUKS → fs` 的四层栈在需要全盘加密的服务器上很常见，代价是排障时要从文件系统一路往下剥到 md。分层越多，"挂载失败"可能的出错层就越多，这是[硬件篇](../hardware/storage.md)第 5.1 节那张栈图已经提示过的规律。

## 8. 别把 LVM 当备份

需要单独强调一次：**LVM 的任何机制都不构成数据保护**。快照与源卷同盘同 VG，物理盘一坏全没；`pvmove` 是迁移不是冗余，源和目标在同一台机器上，机房事故一起带走；`lvremove` 没有回收站，摘错盘、缩错卷都不可逆。LVM 提供的是灵活的容量管理，数据保护仍然要靠 RAID 冗余（第 7 节）、监控（SMART、快照 `Data%`）与[备份与恢复](./backup-and-recovery.md)的 3-2-1 策略各司其职——"我做了快照所以数据安全"是运维里反复出现的错觉，快照只解决备份窗口问题，不解决副本独立性问题。

## 9. 常见故障

### 9.1 VG 空间不足

`lvextend` 报 `Insufficient free space in volume group` 是最常见的报错。先 `vgs` 看 `VFree`：如果只剩几百 MB，你其实是在要求 LVM 变空间出来，它变不出来。两条出路——加盘（`pvcreate` + `vgextend`，第 3 节）或先缩别的卷腾空间（第 4 节，但不推荐）。**不要**试图通过改 PE 大小来"挤出"空间：`vgcreate` 时的 PE 大小决定了 VG 内所有卷的分配粒度，事后不能改。

注意一个容易忽略的现象：`vgs` 的 `VFree` 可能显示有空间，`lvextend` 却失败——那通常是 LV 的条带/镜像布局要求整数个 PE，或 `-L` 请求的量对齐后超了。改用 `-l` 按 PE 个数精确指定，或先看 `lvs -o lv_name,stripes,stripe_size`。

### 9.2 忘记 `xfs_growfs`，挂载点没变大

`lvextend` 成功、`lvs` 显示 LV 已经变大、但 `df -h` 挂载点容量纹丝不动——这是 LVM 新手最高频的困惑。原因是**扩 LV 和扩文件系统是两件事**（第 3 节），LVM 不知道上层是 XFS 还是 ext4。补救很简单：ext4 跑 `resize2fs /dev/vg0/lvX`，XFS 跑 `xfs_growfs /挂载点`。

把这个故障固化成一个习惯：**每次扩完都 `df -h` 核对，不核对不算做完**。一个真实的连锁反应是——有人扩了根分区以为解决 `/` 空间告警，结果告警没消继续报，回头才发现最后一步的 `xfs_growfs /` 漏了。

### 9.3 LVM 名字与 `/dev/mapper/` 映射对应不上

`/dev/vg0/lvroot`、`/dev/mapper/vg0-lvroot`、`/dev/dm-0` 是同一个设备的三种写法（第 1.3 节），但它们的对应关系依赖内核与 udev 的探测顺序，重启后 `dm-N` 的编号可能变。两个实际症状：

- **fstab 或脚本里写了 `/dev/dm-2`**，换块盘或改个配置后编号漂移，开机挂错设备或挂不上。用 `lsblk -f` 看 UUID，fstab 一律写 `UUID=` 或稳定的 `/dev/mapper/` 路径。
- **VG 名里的连字符映射有陷阱**。LVM 用 `-` 作 VG/LV 的分隔符，所以 VG 名或 LV 名里本身就带连字符时，`/dev/mapper/` 下会用多个 `-` 表示，直接照抄 VG-LV 的名字去 `mount` 会失败。遇到这种情况，`lsblk -o NAME,PATH` 或 `lvs -o lv_path` 拿到 LVM 自己认为的路径最可靠。

排查顺序一句话：`lsblk -f` 看清设备与 UUID，`pvs`/`vgs`/`lvs` 看清 LVM 内部结构，两者对不上就是元数据或 udev 的问题。开机阶段因 LVM 组装失败卡住的兜底流程，见[开机流程与引导排错](./boot-process.md)。

### 9.4 快照空间打满导致失效

第 5 节提过，快照的 `Data%` 打到 100% 时会被标记为失效（`lvs` 的 `Attr` 列出现对应状态），不再是一致的时间点视图。更隐蔽的后果是：**快照失效后挂载它做备份会得到错乱的数据，而且不报错**——你以为在备份，其实在备份一个撕裂的状态。

预防靠三件事：快照容量给足（10%–20% 起步，写入快的源卷给更多）、备份脚本跑完立刻 `lvremove` 快照、把 `lvs -o name,data_percent` 接进监控并在超过阈值时告警。血泪教训是"三个月前设了一个快照想用于备份，忘了删，源卷一直在写，某天要恢复时发现快照早已失效"——**不给快照设生命周期，等于给自己埋一个假备份**。

## 10. 常见坑

1. **扩了 LV 忘了扩文件系统**。`lvextend` 完必须 `resize2fs`（ext4）或 `xfs_growfs`（XFS），否则 `df` 不变（9.2 节）。
2. **对 XFS 尝试缩容**。XFS 不支持缩容，命令报错是设计而非 bug；容量规划要一次给够（第 3、4 节）。
3. **`-L 50G` 当成了 `-L +50G`**。前者是目标值、后者是增量，写错会得到比预期小的卷（第 3 节）。
4. **fstab 里写 `/dev/dm-N` 或裸设备名**。编号会漂移，用 UUID 或 `/dev/mapper/` 稳定路径，每改一行 `mount -a` 验证（9.3 节）。
5. **`resize2fs` 传了挂载点**。ext4 要设备名，XFS 的 `xfs_growfs` 才要挂载点，两个别串（第 3 节）。
6. **快照设了不删，或把它当备份**。源卷持续写会吃满快照空间并使其失效，创建与删除必须成对；同盘同 VG 的快照一律不算备份（第 8 节、9.4 节）。
7. **`vgreduce` 摘盘前不确认盘已空**。旧盘上还有 PE 时 `vgreduce` 会被拒绝，别强摘；换盘走 `pvmove` 全量迁移（第 6 节）。
8. **PE 大小建 VG 时随手定**。默认 4 MiB 对多数场景合适，特大卷可考虑 16/32/64 MiB 以减少元数据开销，但建完不能改（9.1 节）。

## 参考资料

- lvm(8) man 手册 — [man7.org](https://man7.org/linux/man-pages/man8/lvm.8.html)
- Arch Wiki - LVM — [wiki.archlinux.org](https://wiki.archlinux.org/title/LVM)
- Red Hat 存储管理文档（RHEL LVM 章节） — [docs.redhat.com](https://docs.redhat.com/)
- Ubuntu Server 文档（LVM 指南） — [ubuntu.com/server/docs](https://ubuntu.com/server/docs)
- `man pvcreate`、`man vgcreate`、`man lvcreate`（含 `-s` 快照）、`man lvextend`、`man lvreduce`、`man lvconvert`（`--merge`）
- `man resize2fs`、`man xfs_growfs`、`man pvmove`、`man vgreduce`
