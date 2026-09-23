# 备份与恢复

备份是系统管理里少数"平时无感、出事定生死"的工作。
它的残酷之处在于**反馈延迟**：
做备份的动作和验证备份的时刻往往相隔几周甚至几个月，
而数据丢失只给一次机会。
本页围绕一个核心观点展开——**恢复演练才是真备份**：
没有实际恢复过的备份文件，只是一堆占用磁盘的字节，
你不知道它是否完整、不知道恢复要多久、更不知道轮到你操作时会不会手抖。

> 内容参考自 rsync/tar 手册、Arch Wiki 备份页面与 3-2-1 策略资料，见文末参考资料。

## 学习目标

- 理解 3-2-1 备份策略，能说清"3、2、1"各自挡住哪类事故
- 分清全量/增量/差异三种备份类型在**恢复成本**上的真实差别
- 掌握 rsync 镜像同步、硬链接快照、整盘镜像三种机制的适用边界
- 会用 cron 与 systemd timer 调度备份，并知道三发行版的默认差异
- 独立完成一次恢复演练，能估算自己的 RTO（恢复时间目标）

## 1. 为什么备份：数据以你没预料的方式丢

很多人以为备份是防"硬盘坏了"。
实际上硬件故障只是丢数据最温和的一种方式，因为它至少可预期；
真实事故清单远比这丰富：

- **人为误操作**：`rm -rf` 打错目录、一次错误的 `--delete` 同步、
  有人"顺手"改了生产库的表结构——事后审计显示，
  误删是中小团队丢数据的第一大原因。
- **软件与升级事故**：失败的发行版大版本升级、
  一次不兼容的数据库迁移、应用 bug 覆写配置文件。
- **恶意加密**：勒索软件不挑目标，桌面机与服务器一视同仁；
  被加密时"最新的那份备份"如果与源文件同在一块盘上，等于没有备份。
- **账号与云资源被回收**：云盘随实例释放、
  对象存储桶策略配错被清空——数据存在别人机房，
  丢起来比本地硬盘还快。

对策必须假设**事故一定会来，而且来的时候你不在场**。
这就是 3-2-1 策略存在的意义。

### 1.1 3-2-1：每个数字在防什么

- **3 份副本**：生产数据本身算 1 份，备份至少 2 份。
  单份备份坏掉、被误删、被加密时，你还有一次机会；
  两份互为验证，也能发现"备份其实早就不完整了"。
- **2 种不同介质**：两份都放同一型号的两块 SATA 盘，
  一次雷击、一次电源故障、一批次的固件缺陷可能同时带走它们。
  本地盘 + NAS、本地盘 + 对象存储，异构才算数。
- **1 份异地**：火灾、盗窃、机房断电不会先给你发通知。
  异地可以是另一座城市的办公室，也可以是云上一个独立账号的存储桶——
  关键是**与生产环境不共享故障域**，包括账号本身。

一个可落地的个人/小团队版本：
数据在本地 SSD（生产），
每天 rsync 到家里的 NAS（本地备份，第 2 份），
NAS 每周再同步到对象存储的独立桶（异地，第 3 份）。
介质两条线（SSD + HDD/NAS、NAS + 云），副本三份，异地一份——达标。

反过来，"移动硬盘每周手工拷一次、拷完插回抽屉"只有 2 份、1 种介质、0 异地，
而且高度依赖"每周记得动手"这个最不可靠的组件。
调度问题交给第 6 节的 cron 与 systemd timer 解决。

### 1.2 全量、增量、差异：差别主要在恢复时

| 类型 | 备份内容 | 备份成本 | 恢复成本 |
|------|---------|---------|---------|
| 全量（full） | 所有数据 | 每次都最慢、最占空间 | 最简单：一个文件/一盘搞定 |
| 增量（incremental） | 自**上次任意备份**后变化的部分 | 最快、最省空间 | 最慢：需按链依次还原全量 + 一串增量 |
| 差异（differential） | 自**上次全量**后变化的部分 | 随时间变慢 | 只需全量 + 最后一份差异 |

三者的取舍不是"增量一定先进"：
增量链上任何一环损坏，后面的备份全部作废，
恢复时要按顺序叠七八个文件，半夜救火时极易漏环。
数据量不大时（百 GB 级以内）每日全量或"每周全量 + 每日增量"
往往更省心；恢复路径越短，深夜出错的概率越低。
真正需要认真设计链条的是 TB 级以上、变化量又小的场景。

策略频率没有全球标准，以两个数字倒推：
**RPO（恢复点目标，能接受丢多久数据）决定频率**——
一天一备意味着最多丢 24 小时；**RTO（恢复时间目标，多久能恢复服务）决定方式**——
要求 1 小时内恢复的业务，不能依赖"临时找工具、临时写恢复脚本"。

## 2. 恢复演练才是真备份

备份界有句老话：备份不是为了创建，是为了恢复。
没有演练过的备份，至少埋着四颗雷：

1. **文件根本没进去**：脚本路径写错、权限不足、
   数据库导出命令静默失败，日志没人看，
   于是"每天都在备份"的目录其实三周前就停更了。
2. **备份是坏的**：压缩包损坏、传输中断留下半个文件、
   加密私钥丢了——不打开一次永远不知道。
3. **恢复步骤没人会**：恢复命令要临时翻文档，
   中途发现少装了 `dump`、少带了 `-C` 参数。
4. **恢复时间超预期**：估的 RTO 是 2 小时，
   实际拉 500GB 从异地回来就要 5 小时。

所以演练不是"锦上添花的仪式"，而是**唯一能证明备份存在的手段**。
一个最低限度的季度演练包含四步：

```bash
# 1) 挑一份最近的备份，记下它的日期与大小（确认它不是空壳）
$ ls -lh /backup/websites/
drwxr-xr-x 1000 1000 4.0K Jan 14 02:03 files_20260114_020311
-rw-r--r--    1 root  8.7M Jan 14 02:05 db_20260114_020544.sql.gz

# 2) 解压/同步到隔离目录，绝不直接覆盖生产路径
$ mkdir -p /tmp/restore_drill
$ gzip -t /backup/websites/db_20260114_020544.sql.gz   # 校验压缩包完整性
$ rsync -a /backup/websites/files_20260114_020311/ /tmp/restore_drill/

# 3) 抽查关键文件能否打开、内容是否合理（首页、配置、一条记录）
$ head -5 /tmp/restore_drill/index.html
$ zcat /backup/websites/db_20260114_020544.sql.gz | head -20

# 4) 记录耗时——这就是你的真实 RTO，写进文档
$ du -sh /tmp/restore_drill && rm -rf /tmp/restore_drill
```

数据库类备份还要单独验证**逻辑可恢复性**：
把 SQL 导入一个临时实例，跑两条查询，确认表和行数都在。
"文件存在"与"数据可用"之间隔着整整一次导入测试。
季度演练 + 每次备份作业的完成告警（第 8 节），
两件事共同把"以为在备份"变成"确实在备份"。

## 3. rsync 增量、快照、镜像：三种"看起来都在备份"的机制

这三个词日常混用，机制和风险完全不同。
选错机制是备份方案里最常见的设计错误。

### 3.1 rsync 同步：镜像式增量

rsync 的本职是**把源目录的变化同步到目标**，
只传变化的块，所以常被当作"增量备份工具"：

```bash
# 本地归档同步：-a 保留属性，-z 传输压缩，--delete 让目标严格镜像源
$ rsync -avz --delete --exclude='*.log' /var/www/ /backup/www/

sending incremental file list
index.html
              1,024  100%    1.00kB/s    0:00:00 (xfr#1, to-chk=3/4)

sent 1,456 bytes  received 35 bytes  2,982.00 bytes/sec
total size is 1,024  speedup is 0.69
```

三个必须吃透的细节：

- **源路径尾部斜杠**决定内容层次：
  `/var/www/` 同步的是 www 里的文件；
  `/var/www` 会把 www 目录本身放进目标。
  写错一格，恢复时多套一层目录，救火时才发现。
- **`--delete` 是把双刃剑**：它让目标成为源的精确镜像，
  源里误删的文件会立刻从备份里消失——
  镜像同步**天然不是历史版本库**。
  第一次上线务必先 `-n` 干跑：

  ```bash
  $ rsync -avzn --delete /var/www/ /backup/www/ | tail -5
  ...
  sent 1,200 bytes  received 35 bytes  0.00 bytes/sec   # -n 不落地任何写入
  ```

- **只有 rsync 一份 = 违反 3-2-1**：
  备份目录和源数据在同一块盘上，盘坏了两份一起没。

适合场景：目标就是"保持一份最新拷贝"的静态站点、
配置目录、作为快照链的底层引擎。
不适合直接当历史版本：它记不住"上周三的文件长什么样"。

### 3.2 硬链接快照：看起来像全量，空间是增量

快照解决的正是镜像的盲区：**保留任意时间点**。
经典做法是用 `--link-dest` 指向上一次快照：
没变化的文件直接硬链接过去（不占新空间），
变化的才真正复制——每次看到的都是完整目录树，代价接近增量：

```bash
# 新快照目录里，未变化文件硬链接自上一次快照；空间只随变化量增长
$ rsync -a --link-dest=/backup/snap/latest /data/ /backup/snap/new/
$ ln -sfn new /backup/snap/latest    # 滚动"最新"指针（示意）
```

Timeshift、rsnapshot、borgbackup 这类工具
本质是把上述流程产品化：调度、保留策略、硬链接管理都替你做了。
Timeshift 只保护**系统文件**（默认排除 `/home`），
定位是"升级搞坏系统后一键回滚"，不是用户数据备份；
数据备份请另外用 rsync/borg 覆盖 `/home` 或业务目录。
Borg/restic 还提供去重与客户端加密，适合异地与云目的地。

**硬链接快照有一个隐蔽的坑**：
如果某程序**原地覆写**文件（先 open 再写，而不是写临时文件再 rename），
由于 inode 被多份快照共享，**旧快照里的"旧版本"会跟着一起变**，
时间机器瞬间穿越。多数现代打包器与数据库导出走"临时文件 + rename"是安全的，
但把正在被原地写的数据库数据目录直接纳入硬链接快照并不可靠——
数据库应使用其自身的导出/热备机制（见 4.2 节），文件层快照只兜配置与静态数据。

### 3.3 整盘镜像：dd 与文件系统快照

`dd` 按**块**逐个复制，产出一个和源盘结构完全一致的镜像：

```bash
# 备份整盘（/dev/sda 换成 lsblk 看到的实际设备；确认 if/of 没写反）
$ sudo dd if=/dev/sda of=/backup/sda.img bs=4M status=progress

# 恢复：同样先确认目标盘内容可以被覆盖
$ sudo dd if=/backup/sda.img of=/dev/sda bs=4M status=progress

# 管道压缩，省空间但更慢，且无法中途随机访问
$ sudo dd if=/dev/sda bs=4M status=progress | gzip > /backup/sda.img.gz
```

镜像的优点是恢复最彻底——连分区表、引导加载器一起还原，
适合装机基线、裸金属迁移；
缺点同样尖锐：体积等于整盘、恢复必须整盘写回、
文件级恢复（只想捞一个文件）反而麻烦。
Btrfs/ZFS 的文件系统级快照则是另一条路：
秒级创建、几乎零空间，但**快照与源同盘**，
防勒索与防盘毁能力有限，必须再同步一份到别处——
又回到 3-2-1。

三种机制的选型可以压成一张表：

| 机制 | 时间点 | 空间开销 | 恢复粒度 | 主要风险 |
|------|--------|---------|---------|---------|
| rsync 镜像 | 仅最新 | ≈ 数据总量 | 文件级 | `--delete` 抹掉历史；与源同盘 |
| 硬链接快照 | 每次快照 | ≈ 变化量 | 文件级/整树 | 原地写污染共享 inode |
| dd 整盘镜像 | 单次 | ≈ 整盘 | 整盘 | 笨重；写错设备直接毁盘 |
| 数据库导出 | 每次导出 | ≈ 数据量 | 逻辑对象 | 需导入验证；长事务一致性 |

实践中它们是组合关系而非竞争关系：
配置与站点文件走 rsync 或快照，
数据库走逻辑导出，装机基线留一份镜像。

## 4. 工具与三系安装

### 4.1 三系安装对照

| 工具 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| rsync | `sudo apt install rsync` | `sudo pacman -S rsync` | `sudo dnf install rsync` |
| tar（多数系统预装） | 随 base 提供 | `sudo pacman -S tar` | 随 coreutils 同族提供 |
| Timeshift 系统快照 | `sudo apt install timeshift`（universe 仓库） | `sudo pacman -S timeshift` | 先 `sudo dnf install epel-release`，再 `dnf install timeshift` |
| Borg 去重备份 | `sudo apt install borgbackup` | `sudo pacman -S borg` | `sudo dnf install borgbackup`（常在 EPEL，先 `dnf search borg` 确认） |
| rclone 云同步 | `sudo apt install rclone` | `sudo pacman -S rclone` | `sudo dnf install rclone` |
| dump/restore | `sudo apt install dump` | `sudo pacman -S dump` | `sudo dnf install dump` |
| 定时：cron | 默认安装并启用 | 不预装：`sudo pacman -S cronie` 并启用 crond | cronie 默认安装并启用 |

Arch 用户注意：官方仓库没有 cron 时，
定时备份直接用 systemd timer 是更贴合发行版习惯的做法（见第 6 节）；
若团队习惯 crontab，先 `pacman -S cronie` 再谈调度。
RHEL 系装 Timeshift、borg 前先确认 EPEL 是否已启用，
`dnf search` 是三系通用的包名核实动作。

### 4.2 tar 归档与逻辑导出

tar 是最通用的归档工具，适合"打包一份带走"的场景：

```bash
# 创建压缩归档 / 查看 / 解压
$ tar -czvf /backup/etc_$(date +%F).tar.gz /etc
$ tar -tvf backup.tar.gz | head          # 只列内容不解包
$ tar -xzvf backup.tar.gz -C /restore/

# tar 自带的清单增量：首份全量写清单，后续只收变化文件
$ tar -czvf full.tar.gz --listed-incremental=/backup/snap.snar /data
$ tar -czvf incr.tar.gz --listed-incremental=/backup/snap.snar /data
```

数据库不能只备份数据目录文件（InnoDB 热写时文件拷贝不一致），
必须用逻辑导出，并且**把导出是否成功写进退出码**：

```bash
$ mysqldump -u backup -p --single-transaction --routines \
    --databases shop | gzip > /backup/db/shop_$(date +%F).sql.gz
$ echo $?        # 0 才算成功；非 0 必须触发告警（见第 8 节）
```

`--single-transaction` 对 InnoDB 可在不锁表的情况下取得一致性快照；
MyISAM 或需要强一致时改用 `--lock-all-tables`，代价是写入暂停。
PostgreSQL 对应的是 `pg_dump`（`-Fc` 自定义格式支持并行恢复）。

`dump/restore` 面向文件系统级备份（按块 + 增量级别），
`dump -0` 全量、`dump -1` 起为增量，`restore -r` 按序还原；
它与文件级 rsync 的分工是：dump 更适合"整个分区原样复活"，
日常文件级保护仍以 rsync/快照为主。

### 4.3 系统基线清单

恢复一台机器不止要文件，还要"它当初装了什么"：

```bash
# 三系各自的软件包清单——重建系统时照单恢复
$ dpkg --get-selections > /backup/pkgs.dpkg.list          # Debian/Ubuntu
$ pacman -Qqe     > /backup/pkgs.pacman.list              # Arch（-e 仅显式安装）
$ rpm -qa --qf '%{NAME}\n' | sort > /backup/pkgs.rpm.list # RHEL 系

$ fdisk -l    > /backup/partitions.txt                    # 分区表
$ lsblk -f    > /backup/lsblk.txt                         # 文件系统与 UUID
$ ip addr     > /backup/network.txt                       # 网络配置快照
```

`pacman -Qqe` 特别值得强调：
Arch 滚动更新没有"发行版安装盘版本号"可依赖，
显式包列表是重建环境最快的地图。
这类文本清单体积小、变更频繁，放进每日备份几乎零成本。

## 5. 备份方案示例

方案没有银弹，下面两个模板按"目的 → 结构"组织，
可在理解后裁剪，不建议整段照抄：

**站点/文件备份**（rsync 镜像 + 过期清理）：

```bash
#!/bin/bash
# backup-web.sh —— 每日站点备份：镜像一份文件 + 一份数据库导出
set -euo pipefail

BACKUP_DIR="/backup/websites"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=30

mkdir -p "$BACKUP_DIR"

# 文件镜像：先干跑过确认 --delete 行为，再上生产
rsync -a --delete --exclude='*.log' /var/www/ "$BACKUP_DIR/files_$DATE/"

# 数据库逻辑导出：凭据从权限 600 的 defaults 文件读取，不把密码写进命令行；
# 退出码非 0 由 set -e 中断，整体作业记为失败
mysqldump --defaults-extra-file=/root/.my.cnf --single-transaction --databases shop \
  | gzip > "$BACKUP_DIR/db_$DATE.sql.gz"

# 保留策略：只清理超过 KEEP_DAYS 的历史
find "$BACKUP_DIR" -maxdepth 1 -name 'files_*'  -mtime +"$KEEP_DAYS" -exec rm -rf {} +
find "$BACKUP_DIR" -maxdepth 1 -name 'db_*.sql.gz' -mtime +"$KEEP_DAYS" -delete

echo "backup ok: $BACKUP_DIR ($DATE)"
```

关键设计点：镜像目录带时间戳（历史可回溯），
`set -euo pipefail` 让 `mysqldump` 失败不再被管道吞掉，
清理只碰明确的命名模式——
备份脚本里最危险的一行永远是 `rm`，
它比 `rsync` 更需要先干跑、再上线。
另外，写在命令行里的密码会暴露在 `ps` 输出中，
所以本脚本的 `mysqldump` 直接用 `--defaults-extra-file`
指向一个权限 600 的配置文件（内含 `[client]` 段的 user/password），
密码不出现在命令行，`set -u` 下也不再有未定义的 `$DB_PASS`。

**配置与系统基线备份**（tar + 包清单，见 4.3 节命令），
每日一次、体积小、恢复最常用：
救火时往往先还原 `/etc`，再谈业务数据。

## 6. 调度：cron 与 systemd timer 的三系差异

再好的脚本，靠人记得跑就注定失守。
调度层的选择在三大发行版上并不统一：

| 维度 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 默认 cron | `cron` 包预装并启用 | 默认无 cron，需 `pacman -S cronie` | `cronie` 预装并启用 |
| 默认 timer | systemd timer 可直接用 | 同左（Arch 官方推荐） | 同左 |
| 常见选择 | 简单任务用 cron 足够 | 无 cron 时天然倾向 timer | 老脚本多沿用 cron |

### 6.1 cron：五字段，三系同构

```bash
$ crontab -e
# 分 时 日 月 周  命令
0 2 * * *   /usr/local/bin/backup-web.sh >> /var/log/backup.log 2>&1
0 3 * * 0   /usr/local/bin/full-backup.sh >> /var/log/backup.log 2>&1
```

cron 的表达力就这五个字段，好处是三系语法完全一致、
老运维零学习成本。必须记住两件事：
**输出必须重定向**，否则执行结果（包括报错）会因无终端而丢进 mailbox 或被丢弃；
**crontab 里的 `%` 有特殊含义**（被当作换行处理），
命令中出现百分号必须转义或放进单引号。
cron 的环境变量也比登录 shell 瘦得多，
脚本内部一律写绝对路径，不要依赖交互环境里的 `PATH`。

### 6.2 systemd timer：可观测、可补跑

timer 由一个 `oneshot` 单元加一个 `.timer` 单元组成：

```ini
# /etc/systemd/system/backup.service
[Unit]
Description=Daily backup

[Service]
Type=oneshot
ExecStart=/usr/local/bin/backup-web.sh

# /etc/systemd/system/backup.timer
[Unit]
Description=Daily backup at 02:00

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now backup.timer
$ systemctl list-timers backup.timer
NEXT                        LEFT    LAST                        PASSED  UNIT
Tue 2026-01-20 02:00:00 CST 6h left Mon 2026-01-19 02:00:00 CST 18h ago backup.timer
```

相比 cron 的三个实质优势：
**日志进 journal**（`journalctl -u backup.service` 直接看上次成败，
不用自己拼 `>> log 2>&1`）；
**`Persistent=true` 会在错过触发后补跑**——
笔记本睡眠、虚拟机关机错过的凌晨两点，开机后自动补上，
这对桌面与非 7×24 服务器是刚需；
**可与依赖、条件、资源限制组合**（`After=`、`ConditionPathExists=`），
备份盘没挂载就不启动，比脚本开头手工判断优雅。
代价是多两个 unit 文件、语法要查手册——
一次性任务用 `OnActiveSec=`/`OnBootSec=` 相对定时更顺手。

### 6.3 怎么选

- **单机、几条规则、团队习惯 cron**：继续用 cron，
  注意输出重定向与三系 cron 包差异（Arch 要先装 cronie）。
- **要日志、要补跑、要条件依赖**：用 systemd timer，三系通用。
- **多机统一调度**：调度器只解决"何时"，不解决"改什么"；
  多机一致性交给[自动化运维](./automation.md)的 Ansible，
  本机频率交给 timer——两层各管一段，不要用 crontab 去下发配置。

## 7. 异地与云端

第 6 节解决了"自动跑"，本节解决 3-2-1 的最后一个 1：

```bash
# 异地 rsync（先配置免密 SSH 密钥；-e 指定传输通道）
$ rsync -avz -e ssh /backup/ user@remote:/remote/backup/

# rclone 对象存储（三系安装见 4.1；rclone config 配置远端后）
$ rclone copy /backup remote:backup-bucket --progress
$ rclone ls remote:backup-bucket | head        # 定期核对远端清单
```

对象存储选型（AWS S3、阿里云 OSS 等）各有厂商 CLI，
本文不复制其安装步骤——以厂商文档为准，
要点只有一个：**异地桶用独立账号/独立密钥，权限最小化**，
否则勒索或误操作可以顺着同一套凭据把异地副本一起清了。
开启版本控制或对象锁（WORM）的桶能额外抵消 `rclone sync` 类误删。

## 8. 加密与监控

### 8.1 加密备份

异地副本若含敏感数据，出发前先加密：

```bash
# 打包后加密（收件人公钥；-e 对称口令用 --symmetric）
$ tar -czf - /data | gpg -e -r backup@example.com > backup.tar.gz.gpg

# 恢复
$ gpg -d backup.tar.gz.gpg | tar -xzf - -C /restore/
```

**私钥/口令本身必须有第 3-2-1 份**——
备份齐全但密钥只存在于被加密的那台机器上，等于全部备份同时失效。
这是加密方案最常见的自毁方式。

### 8.2 备份监控：让失败自己说话

没人看的日志等于没跑。最低配置两条：

```bash
# 1) 作业尾部写状态文件（时间戳就是"最近成功时间"）
$ date +%s > /backup/websites/.last_ok

# 2) 独立巡检作业（挂在 cron 或 timer 上）：文件缺失或超过 1 天未更新都算失败
if [ ! -f /backup/websites/.last_ok ] || \
   [ -n "$(find /backup/websites/.last_ok -mtime +1)" ]; then
    echo "STALE backup"
    exit 1
fi
echo "fresh"
```

把巡检接上你的告警通道（邮件、webhook、现成监控系统），
判据是**"最近一次成功时间"而不是"磁盘上有没有文件"**。
告警通道依赖的 `mail`/`bc` 等工具在最小化镜像上常常缺失，
写脚本前先 `command -v` 确认，做法与
[命令篇 · 系统监控](../commands/system/monitoring.md)一致；
机器多了则交给 Prometheus 类采集，见[监控](../server/monitoring/prometheus.md)。

## 9. 常见坑

1. **备份与源数据同一块盘**。勒索、误 `mkfs`、雷击一锅端。
   至少满足 3-2-1 的"异地"一条才有防御力。
2. **`--delete` 没干跑就上线**。源目录路径写错一格，
   `rsync` 会忠实地把错误"镜像"进备份。永远先 `-n`。
3. **只备文件不备数据库**。InnoDB 数据目录直接拷贝，
   恢复出来的是撕裂状态；逻辑导出 + 导入验证才是正解（4.2 节）。
4. **恢复从未演练**。第 2 节的四步每季度走一遍，
   把真实耗时写进文档，那才是你的 RTO。
5. **cron 任务静默失败**。没重定向输出、没检查退出码、
   没有"最后成功时间"监控，脚本从某天起一直报错也没人知道。
6. **加密备份丢了密钥**。私钥单独 3-2-1，或用口令且口令离线保存。
7. **Timeshift 当全机备份用**。它默认只管系统文件、排除 `/home`，
   用户数据必须另行覆盖（rsync/borg），两套互补不是二选一。
8. **异地同步用 `sync` 语义却没开版本控制**。
   本地误删会顺着同步删掉最后一份副本；
   对象存储开版本控制，或对远端用"只增不删"的归档布局。
9. **Arch 上 crontab 命令不存在**。默认没有 cron，
   `pacman -S cronie` 并启用 crond，或改用第 6.2 节的 systemd timer。

## 参考资料

- rsync 官方文档：<https://download.samba.org/pub/rsync/rsync.html>
- GNU tar 手册：<https://www.gnu.org/software/tar/manual/>
- Backblaze - The 3-2-1 Backup Strategy：
  <https://www.backblaze.com/blog/the-3-2-1-backup-strategy/>
- Arch Wiki - Timeshift：<https://wiki.archlinux.org/title/Timeshift>
- Arch Wiki - Borg backup：<https://wiki.archlinux.org/title/Borg_backup>
- Arch Wiki - Cron（cronie 安装与启用）：<https://wiki.archlinux.org/title/Cron>
- systemd.timer(5)：<https://man7.org/linux/man-pages/man5/systemd.timer.5.html>
- rclone 文档：<https://rclone.org/docs/>
- Red Hat - System Backup and Recovery（System Administrator's Guide，
  RHEL 7 版，ReaR/备份概念仍适用）：
  <https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/7/html/system_administrators_guide/part-system_backup_and_recovery>
- 鸟哥的私房菜 - 服务器篇（含备份相关单元）：
  <https://linux.vbird.org/linux_server/>
- `man rsync`、`man tar`、`man crontab`、`man dump`、`man restore`
