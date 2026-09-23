# 压缩与归档

在 Linux 世界里，
"把一堆文件变成一个文件带走"和"把这个文件变小"是两件不同的事，
只是 `tar -czf` 一行命令把它们焊在了一起，
导致很多人从始至终分不清 **归档（archive）** 与 **压缩（compression）**。
归档解决的是**组织问题**——
目录树、
权限、
属主、
时间戳要原样封进一个文件，
传输和备份才有原子性；
压缩解决的是**体积问题**——
利用数据冗余把字节流变短，
省磁盘、
省带宽。
分清这两个概念，
你才能理解为什么 `tar` 要配 `-z`/`-j`/`-J`/`--zstd`、
为什么 `.tar.gz` 里面其实是两层格式、
以及在"备份要快"和"发版要小"两种相反需求下该选哪种算法。

> 内容参考自 tar、gzip、bzip2、xz、zstd 手册和实际运维经验，见文末参考资料。
> 文中标注"真实输出"的终端结果均来自实际执行（演示目录 `/tmp/tardemo`），可在自己的机器上复现。

## 为什么压缩与归档必须一起学

三个绕不开的真实场景：

1. **备份**。
   `/var/www` 有 40 GB 文件、
   上万个 inode、
   混合的属主和 750 权限。
   如果你用 `zip -r` 打包，
   权限位会被压扁成统一的读写位，
   恢复到新机器后 Web 服务可能直接打不开文件；
   `tar` 则原样保留权限、
   属组、
   软链和设备文件。
   这就是服务器备份几乎只用 `tar`（配压缩）的根本原因。
2. **传输**。
   给同事发 2 GB 日志，
   不压缩走内网要几分钟，
   压缩后可能只有 200 MB；
   反过来，
   已经是压缩格式的 `.mp4` 再 `gzip` 几乎不会变小，
   纯属浪费 CPU。
   **选对算法和选对"要不要压"同样重要。**
3. **系统包与源码分发**。
   Debian 的 `.deb`、
   RPM、
   Arch 的 `.pkg.tar.zst` 本质上都是"tar 归档 + 某种压缩"——
   Arch 从 2020 年起把包格式从 `.pkg.tar.xz` 换成 `.pkg.tar.zst`，
   就是因为在解包速度上 zstd 有数量级优势。
   你在包管理章节看到的每个安装包，
   底层都是本章的工具。

鸟哥的教程把这条链总结为：
**打包 = 装箱，
压缩 = 抽真空**。
先装箱（tar），
再抽真空（gzip/zstd/…），
两步可以由 `tar -z` 自动串联，
也可以拆开分别执行（`tar -cf - dir | gzip > out.tgz`）。
理解可拆分性，
才能读懂下面所有的流式管道用法。

> 示例输出来自真实 Ubuntu 26.04 环境，见文末参考资料。

## 学习目标

- **掌握 tar 全流程**：
  创建（`-c`）、
  查看（`-t`）、
  解压（`-x`）、
  指定文件名（`-f`）、
  指定解压目录（`-C`）、
  排除（`--exclude`）、
  增量备份（`--listed-incremental`）、
  分卷（配合 `split`），
  并能解释 `-czvf` 每个字母的含义。
- **按场景选算法**：
  记住 gzip（快、
  通用）、
  bzip2（较慢、
  较高压缩率）、
  xz（最慢、
  最小）、
  zstd（快且可调、
  现代默认）四者的定位，
  知道"日常备份用 gzip/zstd、
  追求体积用 xz、
  交互解压要快用 zstd"的选型口诀。
- **熟练使用单文件压缩工具**：
  `gzip`/`bzip2`/`xz`/`zstd` 的保留原文件（`-k`）、
  标准输出（`-c`）、
  测试（`-t`）、
  级别（`-1`…
  `-9`）与多线程（`xz -T0`、
  `zstd -T0`）。
- **跨平台交付**：
  会用 `zip`/`unzip` 与 Windows 互传，
  用 `7z` 处理分卷与加密，
  知道"给 Linux 服务器备份不要用 zip"。
- **三系环境无障碍**：
  `tar`/`gzip`/`bzip2`/`xz`/`zstd` 三系预装；
  `zip`/`pigz`/`7z` 等按 Debian 用 `apt install`、
  Arch 用 `pacman -S`、
  RHEL 系用 `dnf install` 安装。
- **避开经典事故**：
  理解 `-f` 必须紧贴文件名、
  绝对路径打包会被剥前缀、
  `gzip -f` 不能修复损坏、
  解压前必须确认目标目录为空等常见坑。

## 1. tar 命令

### 1.1 基本用法

`tar` 是 *tape archive* 的缩写，最初为磁带机设计，如今是 Linux 事实上的归档标准。最常用的两条肌肉记忆：

```bash
tar -cvf archive.tar /path/to/directory
tar -czvf archive.tar.gz /path/to/directory
tar -cjvf archive.tar.bz2 /path/to/directory
tar -cJvf archive.tar.xz /path/to/directory
tar --zstd -cf archive.tar.zst /path/to/directory
tar -xvf archive.tar
tar -xzvf archive.tar.gz
tar -xJvf archive.tar.xz
tar -xzvf archive.tar.gz -C /opt/app
tar -tvf archive.tar
```

真实输出——创建后逐行列出内容（`-t` 等价于 `ls -l` 风格）：

```bash
$ tar -cvf archive.tar tardemo
tardemo/
tardemo/app/
tardemo/app/main.conf
tardemo/app/logs/
tardemo/app/logs/app.log

$ tar -tvf archive.tar
drwxrwxr-x cui/cui           0 2026-09-22 05:33 tardemo/
drwxrwxr-x cui/cui           0 2026-09-22 05:33 tardemo/app/
-rw-rw-r-- cui/cui          18 2026-09-22 05:33 tardemo/app/main.conf
drwxrwxr-x cui/cui           0 2026-09-22 05:33 tardemo/app/logs/
-rw-rw-r-- cui/cui           4 2026-09-22 05:33 tardemo/app/logs/app.log
```

`-tvf` 的输出正是"tar 保留元数据"的证据：
属主/属组（`cui/cui`）、
权限位（`-rw-rw-r--`）、
时间戳全部在档。
这也是为什么恢复备份后权限能自动回来。

### 1.2 常用选项

把 `-czvf` 拆开看，tar 的核心选项其实只有几个字母：

| 选项 | 含义 | 备注 |
|------|------|------|
| `-c` | create，创建归档 | 与 `-x`/`-t` 互斥 |
| `-x` | extract，解压 | |
| `-t` | list，列出内容 | 发包前核对用 |
| `-v` | verbose，逐行打印文件名 | 脚本里常省略以减少日志量 |
| `-f` | file，指定归档文件名 | **后面必须紧跟文件名**，见常见坑 |
| `-z` | 经 gzip 管道 | `.tar.gz`/`.tgz` |
| `-j` | 经 bzip2 管道 | `.tar.bz2`/`.tbz2` |
| `-J` | 经 xz 管道 | `.tar.xz` |
| `--zstd` | 经 zstd 管道 | `.tar.zst` |
| `-C` | 切换到目录再操作 | 解压到指定目录的关键 |
| `--exclude` | 排除匹配的路径 | 可多次使用 |
| `-p`/`--preserve-permissions` | 保留权限位 | root 解压备份时默认保留 |

老教程里的 `-z` 已可被新版 GNU tar 的自动识别取代（`tar -xvf foo.tar.gz` 能自己发现是 gzip），
但**显式写出 `-z` 更利于移植**，
在精简环境和非 GNU tar（如某些 BSD 场景）上更稳。

### 1.3 高级用法：排除、增量、分卷、改目录

```bash
tar -czvf archive.tar.gz --exclude="*.log" /path
tar -czvf archive.tar.gz --exclude="node_modules" --exclude=".git" /path
tar -czvf archive.tar.gz --exclude-from=exclude.txt /path
tar -czvf out.tar.gz -C /path/to/dir .
tar -czvf backup-full.tar.gz --listed-incremental=/backup/snapshot.snar /data
tar -czvf backup-incr.tar.gz --listed-incremental=/backup/snapshot.snar /data
tar -czvf - /path | split -b 1G - archive.tar.gz.
cat archive.tar.gz.* | tar -xzvf -
tar -czvf - /path | ssh user@remote "cat > /remote/backup.tar.gz"
ssh user@remote "tar -xzvf /remote/backup.tar.gz -C /remote/path"
```

`-C /path/to/dir .` 这个组合值得单独记：
很多人打包后解压出来多了一长串 `path/to/dir/` 层级，
就是因为在错误的目录层级上执行了 `tar -cf out.tar.gz path/to/dir`。
**想让归档根目录"扁平"，
就在打包时用 `-C` 先进入目标，
再归档 `.`。**

增量备份的 `.snar` 快照文件记录了上次备份时各文件的状态，
第二次执行 `--listed-incremental` 会**自动把已备份且未变化的文件标记为"已处理"**，
产出的归档只含变化。
注意：
增量链必须配套保存，
丢了中间一环，
后面的增量就无法正确恢复。

## 2. gzip 命令

gzip 是历史最久、
生态最广的压缩工具：
几乎所有 Linux 系统日志轮转（logrotate）、
内核镜像（`vmlinuz`）、
man 手册（`*.gz`）都在用它。
默认级别 `-6` 是速度与体积的平衡点，
日常直接回车即可。

```bash
gzip file.txt
gzip -d file.txt.gz
gzip -k file.txt
gzip -9 file.txt
gzip -1 file.txt
gzip -c file.txt > out.gz
gzip -l file.gz
gzip -t file.gz
gzip -r /path
```

真实输出（`-l` 能直观看到"压掉了多少"）：

```bash
$ gzip -l archive.tar.gz
         compressed        uncompressed  ratio uncompressed_name
                225               10240  98.0% /tmp/archive.tar
```

10240 字节的 tar 被压到 225 字节（压缩率 98%）——
演示数据太小导致数字夸张，
真实文本数据通常在 60%–80% 区间。
另一个真实提醒：
**小文件压缩后反而可能变大**，
一个 18 字节的配置文件 `gzip -9` 后是 43 字节，
因为 gzip 的头部和 deflate 码表本身就有固定开销。

注意 `gzip -r` 与 `tar -z` 的本质区别：
`gzip -r` 是把目录下**每个文件各自**压成 `.gz`，
不保留目录结构和权限；
`tar -czf` 才是真正的"归档 + 压缩"。
备份场景永远选后者。

## 3. bzip2 命令

bzip2 采用 Burrows-Wheeler 变换，
压缩率通常比 gzip 高 10%–20%，
但速度慢数倍。
它在 2000 年代的源码包（`.tar.bz2`）中非常流行，
如今逐渐被 xz/zstd 两头挤压，
主要用于兼容历史文件。

```bash
bzip2 file.txt
bzip2 -d file.txt.bz2
bzip2 -k file.txt
bzip2 -9 file.txt
bzip2 -c file.txt > out.bz2
bzip2 -t file.txt.bz2
bzip2 -l file.txt.bz2
```

真实对比（同一 18 字节文件）：
`bzip2` 产出 50 字节，
`xz` 产出 84 字节——
小文件上算法差异全被固定开销淹没，
再次说明**压缩率对比要在有体量的数据集上做才有意义**。

## 4. xz 命令

xz 基于 LZMA/LZMA2，
是这几种传统算法里压缩率最高的，
代价是压缩慢、
解压也比 gzip 慢。
内核源码树、
部分发行版的软件包曾大量使用 `.xz`。
它对大文件、
变化不剧烈的文本效果最好。

```bash
xz file.txt
xz -d file.txt.xz
xz -k file.txt
xz -9 file.txt
xz -0 file.txt
xz -T 0 file.txt
xz -t file.txt.xz
xz -l file.txt.xz
```

`-T 0` 是 xz 相对其它工具的独门优势：
单文件也能吃满多核。
在 16 核机器上压缩 10 GB 日志，
`xz -T0 -9` 相比单线程能快一个数量级，
最终体积还相同。

## 5. zstd 命令

zstd（Zstandard）由 Facebook 开源，
目标就是"比 gzip 快、
比 gzip 小"，
并且提供**连续可调的级别**：
`-1` 到 `-19`，
还有极端的 `--ultra -22`。
它是当前的新一代默认选择——
Arch 的包格式是 `.pkg.tar.zst`，
Debian 11+ 的 `.deb` 内层也是 zstd，
systemd、
Chrome 等项目均已完成迁移。

```bash
zstd file.txt
zstd -d file.txt.zst
zstd -k file.txt
zstd -19 file.txt
zstd -T0 file.txt
zstd -t file.txt.zst
zstd -l file.txt.zst
tar --zstd -cf backup.tar.zst /data
```

选型口诀：
**新系统、
要兼顾速度和体积 → zstd；
要极限体积、
可以慢慢压 → xz；
要最大兼容（对方可能是老系统/Windows 便携工具）→ gzip；
纯粹解历史遗留 → bzip2。
** 演示数据里 `tar --zstd`（418 字节）反而比 `tar.gz`（225 字节）大，
原因是样本只有几个字节、
zstd 的字典表开销占了大头——
**对 KB 级以下的小文件，
纠结算法毫无意义，
直接 gzip 即可。**

## 6. zip 和 unzip

zip 的核心价值不是压缩率，
而是**跨平台**：
Windows、
macOS 都能原生打开，
邮件/网盘附件生态成熟。
它也支持密码加密和分卷。
缺点是不保留 Linux 权限位和属主，
所以**服务器备份不要用 zip**，
**给 Windows 同事发文件才用 zip**。

```bash
zip archive.zip file1.txt file2.txt
zip -r archive.zip /path/to/directory
zip -r archive.zip /path -x "*.log"
zip -r -s 1G archive.zip /path
zip -e archive.zip file
unzip archive.zip
unzip archive.zip -d /path
unzip -l archive.zip
unzip -t archive.zip
unzip -o archive.zip
```

需要更强加密（AES-256）时用 `7z` 或 `zip -P` 之外的现代工具；
`zip -e`/`-P` 的 ZipCrypto 已可被暴力破解，
涉密数据不要依赖它。

## 7. 7z 命令

7z 提供高压缩率、
多算法（LZMA/LZMA2/Zstd/PPMd…）、
AES-256 加密和**分卷归档**，
适合"大文件拆开加密传给对方"这类场景。
它不是默认安装：
Debian/Ubuntu 执行 `sudo apt install p7zip-full`，
Arch 执行 `sudo pacman -S 7zip`（旧文档写的 `p7zip` 已由 `7zip` 包接管），
RHEL/CentOS/Rocky 执行 `sudo dnf install p7zip p7zip-plugins`——
三系完整对照见第 9 节。

基本用法（`a` = add，`x` = 解压并保留路径结构，`e` = 解压丢弃路径，`l` = list，`t` = test）：

```bash
7z a archive.7z file1.txt file2.txt
7z x archive.7z
7z e archive.7z
7z l archive.7z
7z t archive.7z
7z a -v1g archive.7z /large/dir
7z a -pSecret -mhe=on archive.7z dir
```

## 8. 压缩工具对比与选型

| 工具 | 压缩率 | 压缩速度 | 解压速度 | 扩展名 | 典型场景 |
|------|--------|----------|----------|--------|----------|
| gzip | 中 | 快 | 很快 | `.gz`/`.tgz` | 日志轮转、日常备份、最大兼容 |
| bzip2 | 较高 | 慢 | 中 | `.bz2` | 历史源码包兼容 |
| xz | 最高（传统算法中） | 很慢 | 中偏慢 | `.xz` | 极限体积、内核/固件发布 |
| zstd | 高（同级别优于 gzip） | 快（可多核） | 很快 | `.zst`/`.tzst` | 新项目默认、包格式、大备份 |
| zip | 中 | 快 | 快 | `.zip` | 与 Windows 互传、邮件附件 |
| 7z | 高 | 中 | 中 | `.7z` | 加密、分卷、多格式归档 |

**选型决策树**（按顺序判断即可）：

1. 对方是 Windows 或需要双击打开 → `zip`（要加密分卷则 `7z`）。
2. 是服务器备份/发布给 Linux 用户，且不确定对方环境 → `tar.gz`（保底永远正确）。
3. 备份体积大、且在意备份窗口（耗时） → `tar.zst`（`zstd` 默认级别）。
4. 体积极致重要、可以睡前再跑 → `tar.xz`（`xz -T0 -9`）。
5. 需要增量/排除/保留权限 → 无论哪种压缩，**外层一定是 `tar`**。
6. 已经是压缩格式的文件（mp4/jpg/gz/xz）→ **不要再压**，直接打包传输。

## 9. 三系对照与工具安装

`tar`、
`gzip`、
`bzip2`、
`xz`、
`zstd`、
`gunzip`、
`zcat` 在 **Debian/Ubuntu、
Arch、
RHEL/CentOS/Rocky** 上全部预装，
开箱即用。
需要按发行版安装的是下列工具（注意 **Arch 一列的 `pacman -S` 写法**）：

| 工具/命令 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|-----------|---------------|------|-------------------|
| `zip`/`unzip` | `sudo apt install zip unzip`（unzip 常预装） | `sudo pacman -S zip unzip` | `sudo dnf install zip unzip` |
| `7z` | `sudo apt install p7zip-full` | `sudo pacman -S 7zip` | `sudo dnf install p7zip p7zip-plugins` |
| `pigz`（并行 gzip） | `sudo apt install pigz` | `sudo pacman -S pigz` | `sudo dnf install pigz` |
| `pbzip2`（并行 bzip2） | `sudo apt install pbzip2` | `sudo pacman -S pbzip2`（AUR 中亦有） | `sudo dnf install pbzip2`（EPEL） |
| `pxz`（并行 xz 旧项目） | `sudo apt install pxz` | `sudo pacman -S pxz` | 一般用 `xz -T0` 替代 |
| `zstd` | `sudo apt install zstd`（通常已装） | `sudo pacman -S zstd` | `sudo dnf install zstd` |
| `lrzip`/`lz4` | `sudo apt install lrzip lz4` | `sudo pacman -S lrzip lz4` | `sudo dnf install lrzip lz4` |

要点：

- **并行工具是提速捷径**。
  `pigz` 用法与 `gzip` 完全一致（把 `-z` 管道换成 pigz 即可），
  单机多核压缩 GB 级日志时提速明显；
  `xz`/`zstd` 原生支持 `-T0`，
  无需额外并行包。
- **RHEL/CentOS 的部分包在 EPEL**（如 `pbzip2`）：
  先 `sudo dnf install epel-release` 再安装。
- **Arch 的 `7z` 命令由 `7zip` 包提供**（老教程的 `p7zip` 已进入弃用状态，
  `pacman -S 7zip` 即可）。
- 验证工具是否可用：`command -v pigz pbzip2 7z zstd`，缺哪个装哪个，不要假设三系命令集相同。

## 10. 实战案例

### 10.1 备份压缩脚本

```bash
#!/bin/bash
# 备份压缩脚本：打包 → 校验大小 → 按保留策略清理旧备份
set -euo pipefail

BACKUP_DIR="/backup"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"
tar -czvf "$BACKUP_DIR/backup_$DATE.tar.gz" /important/data

# 检查备份大小（空备份或异常小通常意味着源路径写错了）
ls -lh "$BACKUP_DIR/backup_$DATE.tar.gz"

# 删除 30 天前的备份（先 -ls 预览过再改成 -delete 是更稳妥的习惯）
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +30 -delete
```

生产环境建议在 `tar` 成功后（`set -e` 已保证）再做一次 `tar -tzf ... > /dev/null` 完整性抽检，
最后才轮转旧备份——
**先确认新备份可用，
再删旧备份**，
顺序不可颠倒。

### 10.2 日志压缩（先归档、确认、再删除源文件）

```bash
#!/bin/bash
# 日志压缩脚本：只归档已停止变化的旧日志，确认归档完整后才删除源文件
set -euo pipefail

LOG_DIR="/var/log"
ARCHIVE_DIR="/var/log/archive"
DATE=$(date +%Y%m%d)

mkdir -p "$ARCHIVE_DIR"

# -mtime +7：至少 8 天未修改，避开正在写入的活跃日志
# -print0 | tar --null -T -：安全处理含空格的文件名
find "$LOG_DIR" -name "*.log" -mtime +7 -print0 \
  | tar -czf "$ARCHIVE_DIR/logs_$DATE.tar.gz" --null -T -

# 归档完整性抽检通过，才允许删除源文件
tar -tzf "$ARCHIVE_DIR/logs_$DATE.tar.gz" > /dev/null
find "$LOG_DIR" -name "*.log" -mtime +7 -delete
```

这个顺序（打包 → `tar -t` 校验 → 删除）是日志归档的安全底线。
直接 `-delete` 再打包，
一旦打包失败源日志就永久丢了。

### 10.3 文件传输压缩

```bash
tar -czvf - /path | ssh user@remote "cat > /remote/backup.tar.gz"
ssh user@remote "tar -xzvf /remote/backup.tar.gz -C /remote/path"
tar -cf - /large | pv -s $(du -sb /large | cut -f1) | gzip > backup.tar.gz
```

### 10.4 分卷压缩大文件

```bash
tar -czvf - /large/path | split -b 1G - archive.tar.gz.
cat archive.tar.gz.* | tar -xzvf -
scp archive.tar.gz.* user@remote:/path
```

`split -d` 可把后缀改成数字（`-00`、
`-01`），
排序更直观；
zip 则原生支持 `zip -s 1G` 分卷，
场景不同不要混用两套分卷文件。

## 11. 性能优化

### 11.1 选择压缩级别

级别与耗时近似线性权衡：`-1` 最快体积最大，`-9` 最慢体积最小，`-6` 是 gzip 默认平衡点。经验参考：

- 交互式传输、赶时间 → `-1` 或 `-3`（体积差通常只有几个百分点，时间差可能是数倍）。
- 夜间例行备份 → 默认级别（gzip `-6` / zstd `-3`）。
- 归档冷数据、一次压完不再读 → `xz -9 -T0` 或 `zstd -19`。

### 11.2 多线程压缩

```bash
sudo apt install pigz     # Debian/Ubuntu
sudo pacman -S pigz       # Arch
sudo dnf install pigz     # RHEL/CentOS/Rocky
tar -cf - /path | pigz > backup.tar.gz
xz -T0 -9 file.tar
zstd -T0 -19 file.tar
tar -cf - /path | pbzip2 > backup.tar.bz2
```

并行压缩对**单个大文件**收益最大；
大量小文件时瓶颈常在 I/O 和进程调度，
先 `tar -cf -` 聚合成一条流再交给并行压缩器，
比对每个小文件分别并行要快。

### 11.3 压缩算法选择

文本、
源码、
日志这类**高冗余数据**各算法都能压出明显差距；
已压缩媒体（`.jpg`/`.mp4`/`.gz`）则几乎无差别。
真正该被优化的是**流程**：
能在管道里流式完成的，
就不要"先写临时文件、
再压、
再删临时文件"——
省一次磁盘往返，
往往比纠结 `-9` 还是 `-6` 更有意义。

## 12. 故障排查与常见坑

1. **`-f` 位置放错，把目录当成归档文件**。`-f` 后面必须紧跟归档文件名。真实报错：

   ```bash
   $ tar -cvf tardemo archive2.tar
   tar: tardemo: Cannot open: Is a directory
   tar: Error is not recoverable: exiting now
   ```

   正确写法是 `tar -cvf archive2.tar tardemo`——
   文件名在 `-f` 后，路径在最后。
   如果忘了写 `-f`，GNU tar 可能尝试写默认磁带设备或把归档流喷到终端上（满屏乱码），后果更糟。

2. **打包了绝对路径，解压时层级失控**。真实过程：

   ```bash
   $ tar -czvf abs.tar.gz /tmp/tardemo/app/main.conf
   tar: Removing leading `/' from member names
   /tmp/tardemo/app/main.conf

   $ tar -xzvf abs.tar.gz -C /tmp/ext
   tmp/tardemo/app/main.conf
   # 实际落盘：/tmp/ext/tmp/tardemo/app/main.conf
   ```

   tar 出于安全会剥掉开头的 `/`（防止解压时写穿到根目录），
   于是 `/tmp/...` 变成相对路径 `tmp/...`，多出一层目录。
   **规范做法：`tar -czvf out.tgz -C /parent dir` 打包相对路径**，
   解压到哪里完全由 `-C` 控制。

3. **`gzip -f` 不是"修复"**。
   `-f` 只是"强制覆盖同名输出"，
   对已损坏的 `.gz` 毫无帮助——
   gzip 家族没有修复能力。
   损坏后应重新从源数据归档，
   或使用备份中的历史副本；
   `gzip -t`/`xz -t`/`zstd -t` 用来**检测**损坏，
   不用来修。

4. **解压到错误目录，
   文件散落一地**。
   `tar -xvf x.tar.gz` 不带 `-C` 会解到**当前目录**。
   在 `/root` 或 `/` 下误执行一次，
   目录结构就乱了。
   习惯：
   解压前 `pwd` 确认、
   先 `tar -tf` 看归档根是什么、
   目标目录不干净时先 `mkdir newdir && tar -xf -C newdir`。

5. **解压用错解压旗标**。`-z`/`-j`/`-J`/`--zstd` 要与文件实际压缩方式匹配。混用真实报错示例：

   ```bash
   $ tar -xzvf archive.tar.gz -t
   tar: You may not specify more than one '-Acdtrux', '--delete' or '--test-label' option
   ```

   这条报错其实还叠加了另一个错误：
   `-t` 与 `-x` 不能同时给（都是"操作模式"）。
   **一次只选一个模式（c/x/t）**，
   现代 GNU tar 没指定压缩旗标时还能自动识别，
   手动指定了就必须指对。

6. **覆盖已存在文件不提示**。
   tar 解压、
   `gzip -k`、
   `unzip` 都默认静默覆盖同名目标（`unzip` 会提示，
   但脚本里常用 `-o` 直接覆盖）。
   恢复生产文件前先 `tar -tf` 对比，
   或解到临时目录 diff 后再替换。

7. **权限恢复异常**。
   普通用户解压 root 打的备份时，
   属主会变成你自己（tar 无法"变成"别人），
   SUID 位也可能被丢弃（默认安全策略）。
   **以 root 解压系统级备份**，
   或显式 `tar -xpf`（`-p` 保留权限）并随后 `chown`。
   反过来，
   `zip` 从设计上就不保存 Unix 权限，
   用它做服务器备份恢复后权限必然不对——
   这是选型错误，
   不是操作错误。

8. **归档里混入"正在被写入"的文件**。
   备份运行中的数据库目录而没有先停写/做一致性快照，
   得到的归档可能是损坏的（应用中途改了文件）。
   规则：
   **数据库备份走专用工具（mysqldump/pg_dump）或 LVM/文件系统快照**，
   `tar` 只适合静态文件树。

9. **磁盘空间不足导致"半截归档"**。
   压缩过程需要临时空间（尤其分卷和解压时约等于原文件大小）。
   先 `df -h` 确认；
   空间紧张时用流式管道直接写到远端（见 10.3），
   避免在本机双份占用。

10. **小文件纠结压缩级别/算法**。
    几十字节的文件压完反而变大（本章真实数据：
    18 → 43 字节）。
    批量小文件应该先 `tar` 聚合再压缩，
    让冗余真正可被利用。

11. **`--exclude` 模式没加引号被 shell 展开**。
    `--exclude=*.log` 在当前目录恰好有 `.log` 文件时会被 shell 展开成具体文件名，
    排除语义就错了。
    凡是要交给 tar/find/grep 自己解释的模式，
    **一律单引号**。

12. **增量备份把 `.snar` 当垃圾删掉**。
    快照文件是增量链的根，
    删除它等于让历史增量无法恢复。
    `.snar` 必须与备份集同寿命保存。

## 参考资料

- `man tar`, `man gzip`, `man bzip2`, `man xz`, `man zstd`, `man zip`, `man unzip`, `man split`
- [GNU tar 手册](https://www.gnu.org/software/tar/manual/)
- [gzip 手册](https://www.gnu.org/software/gzip/manual/gzip.html)
- [bzip2 手册](https://sourceware.org/bzip2/manual.html)
- [xz / xz-utils 文档](https://tukaani.org/xz/)
- [zstd 手册](https://github.com/facebook/zstd/blob/dev/programs/zstd.1.md)
- [7-Zip 官方文档](https://www.7-zip.org/faq.html)
- [Arch Wiki - Pacman（`.pkg.tar.zst` 包格式）](https://wiki.archlinux.org/title/Pacman)
- [Arch Wiki - zstd](https://wiki.archlinux.org/title/Zstd)
- [鸟哥的私房菜 - 压缩与打包指令](https://linux.vbird.org/linux_basic/centos7/0240tar.php)
- [Debian 手册 - 归档与压缩](https://www.debian.org/doc/manuals/debian-handbook/)
- [Red Hat 文档 - Compressing and archiving files](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/compressing_and_archiving_files/index)
