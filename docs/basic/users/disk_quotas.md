# 磁盘配额

多人共用的服务器上，磁盘是典型的"公地悲剧"资源：某个人跑了个失控的日志任务，或者 `~/.cache` 被无意中塞满，`/home` 分区一到 100%，所有人的 SSH 登录都会开始报 `No space left on device`——即使他们各自的家目录还有大把空闲。磁盘配额（disk quota）就是为这种场景设计的硬性预算：给每个用户（或每个组）设定用量上限，让失控的那一个先撞墙，而不是拖垮所有人。启用配额后，系统会在写入路径上实时统计每个 UID/GID 占用的数据块与 inode 数，一旦超过阈值就直接拒绝写入并返回错误。本页先讲清楚软限制与硬限制这对核心概念（以及"宽限期"这个容易被误解的中间态），再分别给出 ext4 与 XFS 的启用流程——两者初始化方式差异不小，照抄对方的步骤一定失败。

> 内容参考自 Arch Wiki、鸟哥的私房菜与各发行版 `man` 手册，见文末参考资料。

## 学习目标

- 说清配额防的是什么问题，以及它统计的两类资源（块与 inode）
- 区分软限制（soft，可暂时超过）与硬限制（hard，绝对上限）的语义
- 分别完成 ext4 与 XFS 的配额启用与初始化
- 会用 `edquota` 设置、`repquota` 审计、`edquota -p` 批量套用

## 1. 为什么需要配额

没有配额的共享 `/home` 等于把整块分区的命运交给运气。常见触发场景：

- 一名用户在 `~/Downloads` 下载了 80GB 数据集，分区瞬间告急；
- 某个服务账号（比如跑批处理的 `etl` 用户）日志没轮转，单账号写满几十 GB；
- 部署脚本用 `nohup ... > ~/job.out` 跑长任务，输出文件无人清理。

配额把"整盘预算"细化为"每人预算"，并且能在告警阶段（超过软限制但未达硬限制）就通过邮件/日志提醒，给管理员留出处置时间。需要注意的是，配额统计的是**文件系统层**的用量：硬链接算一次（因为指向同一 inode），稀疏文件按实际占用块算；它不感知"这个文件是否重要"，只看字节数与文件个数。

另一类容易混淆的资源是 **inode**。文件系统格式化时就固定了 inode 总数，每个小文件都要消耗一个 inode。哪怕磁盘还有 100GB 空闲，只要 inode 耗尽（典型场景：百万个几 KB 的小缓存文件），写入同样会失败。因此配额要同时限制块（KB）和 inode（文件数）两类指标。

## 2. 软限制、硬限制与宽限期

`edquota` 编辑的每一行都包含四个数字，语义必须先分清，否则设出来的限制一定不符合预期：

| 限制类型 | 含义 | 超限后的行为 |
|---------|------|-------------|
| soft（软） | 允许日常使用的额度 | 可以**暂时**超过，但进入宽限期倒计时 |
| hard（hard） | 绝对上限 | 写入被内核直接拒绝，无法突破 |
| inodes soft | 最多能创建多少个文件 | 同块 soft，超限进入宽限期 |
| inodes hard | 文件数的绝对上限 | 达到后 `creat`/`open(O_CREAT)` 失败 |

宽限期（grace period）默认 7 天。一旦用量超过 soft 但未达 hard，系统开始计时；宽限期内可以继续写，超时后 soft 的效果等同于 hard，写入开始被拒绝，直到用量降回 soft 以下。这个设计的用意是容忍突发：平时写到 800MB 无妨，只要在一周内清掉，就不会被卡死。把 soft 设为 0 表示"不设软限制，只用 hard"；hard 必须 ≥ soft，否则 `edquota` 保存时会拒绝。

```bash
# 编辑指定用户的配额（会打开 EDITOR）
$ sudo edquota -u alice

# 编辑期间看到的表格（数值单位是文件系统块，通常 1 块 = 1KB）
Filesystem     blocks       soft       hard     inodes     soft     hard
/dev/sda2     1048576     2097152    3145728       842        0        0
#             ↑ 已用      ↑ 软限制   ↑ 硬限制    ↑ 已用文件数
```

`blocks` 已用量是内核实时统计写入的，**不包含**你手工 `dd` 到块设备绕过文件系统的情况；改完配额数值立即生效，无需重启服务。

## 3. 启用配额：ext4（Debian/Ubuntu、Arch、Rocky 默认）

ext4 的配额靠内核在挂载时读取 `usrquota`/`grpquota` 选项启用，流程分三步：改挂载选项 → 重新挂载 → 运行 `quotacheck` 建库。**顺序不能颠倒**——`quotacheck` 需要在已启用配额的挂载点上扫描并创建 `aquota.user`/`aquota.group` 数据库文件，没先 remount 就执行会直接报错。

```bash
# 第 1 步：编辑 /etc/fstab，给目标挂载点加上 usrquota,grpquota
# Debian/Ubuntu/Arch/RHEL 的 fstab 格式一致
$ sudo vim /etc/fstab
/dev/sda2  /home  ext4  defaults,usrquota,grpquota  0  2
#                            ↑ 关键新增项

# 第 2 步：重新挂载使选项生效（改 fstab 后必须先做这一步）
$ sudo mount -o remount /home

# 验证选项已生效
$ mount | grep /home
/dev/sda2 on /home type ext4 (rw,relatime,usrquota,grpquota)

# 第 3 步：初始化配额数据库
$ sudo quotacheck -cugm /home
# -c 创建数据库  -u 用户配额  -g 组配额  -m 禁止只读检查

# 第 4 步：开启配额
$ sudo quotaon /home

# 开机自动开启：在 fstab 同一行再补 usrquota（或用 quotaon.service）
$ sudo systemctl enable quotaon.service   # systemd 系发行版通用
```

三系安装工具包的命令不同，但之后的流程完全一致：

```bash
$ sudo apt install quota      # Debian/Ubuntu
$ sudo pacman -S quota-tools  # Arch（包名带 -tools 后缀）
$ sudo dnf install quota      # RHEL/CentOS/Rocky
```

## 4. 启用配额：XFS（只认挂载选项，没有 quotacheck）

XFS 的实现与 ext4 不兼容：它不在挂载点生成 `aquota.*` 文件，而是把配额元数据存在文件系统内部的隐藏 inode 中，因此**没有 `quotacheck` 这一步**，初始化靠 `xfs_quota` 命令。如果照抄第 3 节的步骤去跑 `quotacheck`，会得到 `quotacheck: Cannot find filesystem to check` 之类的失败——这是 ext4/XFS 混淆最经典的结果。

```bash
# fstab 里 XFS 需要显式写 quota 子选项
$ sudo vim /etc/fstab
/dev/sdb1  /data  xfs  defaults,quota,usrquota,grpquota,prjquota  0  0

$ sudo mount -o remount /data

# XFS 用 xfs_quota 设置，不需要 edquota 之外再跑 quotacheck
$ sudo xfs_quota -x -c 'limit -u alice 20g 30g' /data
#                       ↑ 软 20g，硬 30g，语法与 edquota 不同
$ sudo xfs_quota -x -c 'report -h' /data
```

Fedora/RHEL 系允许同时存在 XFS 与 ext4 分区，但**同一分区只能用一套配额工具**——按 `df -T` 先确认文件系统类型，再决定走第 3 节还是第 4 节。RHEL/CentOS/Rocky 默认根与 `/home` 常为 XFS，Debian/Ubuntu 与 Arch 默认 ext4，这也是"教程不标发行版就会翻车"的典型例子。

## 5. 查看与审计

```bash
# 当前登录用户查看自己的用量（无需 root）
$ quota
Disk quotas for user alice (uid 1000):
     Filesystem  blocks   quota   limit   grace   files   quota   limit   grace
      /dev/sda2 1048576 2097152 3145728          842       0       0
#                               ↑ 软    ↑ 硬              ↑ 文件数软/硬

# 管理员查看任意用户
$ sudo quota -u alice

# 一次性审计整个挂载点（最常用，适合写进巡检脚本）
$ sudo repquota /home
*** Report for user quotas on /dev/sda2
            Block grace time: 7 days.   Inode grace time: 7 days.
User      Space over quota limits: 0  Time remaining: unlimited
        hard   soft   used   hard   soft
alice    3145728 2097152 1048576   ...

# 从用户视角看还有多少余量
$ quota -s alice        # -s 以人类可读单位显示（GB/MB）
```

`repquota` 输出里 `grace` 列出现倒计时（如 `6days+`）就意味着该用户已超软限制、正在宽限期内，是发提醒邮件的最佳时机。生产环境通常配合 cron 每天跑一次 `repquota -ugs` 并 diff 阈值。

## 6. 批量设置与复制

逐个 `edquota` 低效且容易输错，模板复制是批量初始化的正确姿势：

```bash
# 先给一个"标准用户"调好配额，存为模板
$ sudo edquota -u template_user

# 复制模板到多个用户（-p = prototype）
$ sudo edquota -p template_user alice bob carol dave

# 也可以按组套用
$ sudo edquota -g -p template_group developers

# 临时给某人"假期额度"：直接改他的 hard/soft，事后再改回
$ sudo edquota -u alice
```

需要临时解锁某人（比如应急导出数据）时，把他的 soft/hard 都临时调大，操作完成后立刻改回原值——不要图省事直接 `quotaoff /home` 关闭整个文件系统的配额，那会让所有人的限制同时失效，审计日志也会缺失这段"谁突破了额度"的记录。

## 7. 常见坑

1. **改了 fstab 却忘了 remount**。`usrquota` 选项只在挂载时被读取，`quotacheck` 对未启用配额的挂载点会失败。顺序永远是：改 fstab → `mount -o remount` → `quotacheck` → `quotaon`。

2. **在 XFS 上跑 ext4 的流程**。XFS 没有 `quotacheck`/`aquota.user`，改用 `xfs_quota`（见第 4 节）。反之在 ext4 上用 `xfs_quota` 也无效。

3. **把 soft 当成"警告值"就不管 hard**。soft 超限只是开始计时，真正卡住用户的是 hard。给共享服务器设值时的经验比例是 soft ≈ 70% hard，给 7 天宽限留出回收窗口。

4. **忽略 inode 限制**。只设了块限额的目录，仍可能被百万小文件塞爆 inode。对日志/缓存目录，把 inodes soft 也设上（比如 50 万），双保险。

5. **在 NFS 上误用本地配额**。NFS 客户端的配额统计依赖服务器端的 `usrquota` 挂载与 `quota` 服务；只在客户端 `quotaon` 是无效的。共享存储配额要在**导出端**配置。

6. **删除用户后残留配额记录**。`userdel -r` 不会自动清理 `aquota.user` 里的条目。长期运行的机器定期用 `requota /home` 对比实际用户列表，或用 `edquota -d username`（若发行版支持）清理孤儿条目。

## 参考资料

- Arch Wiki - Disk quota — [wiki.archlinux.org](https://wiki.archlinux.org/title/Disk_quota)
- 鸟哥的私房菜 - 磁盘配额 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/043quota.php)
- XFS 配额管理官方文档 — [xfs.org](https://xfs.org/index.php/XFS_QuotaSupport)
- Debian 手册 - 磁盘配额 — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- RHEL 9 - 配置配额 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html-single/managing_storage/index)
- `man quota`、`man repquota`、`man edquota`、`man quotacheck`、`man quotaon`、`man xfs_quota`
