# 目录操作命令

目录本质上是"记录文件名与 inode 对应关系"的特殊文件。创建、切换、列出、复制、删除目录，以及查看空间占用，构成了日常操作系统的骨架。和文件操作相比，目录操作多了递归、路径深度、权限可执行位（能否 `cd` 进去）等容易踩坑的细节，本页用真实输出把每一步讲清楚。

> 示例输出来自真实 Ubuntu 26.04 环境。下列命令在 Debian/Ubuntu、RHEL/CentOS/Rocky、Arch 上均已默认提供（`tree`、`plocate` 等可选工具除外）。

## 学习目标

- 掌握目录的创建、删除、切换与显示
- 理解 `ls` 长格式各列含义与常用排序/递归选项
- 会用 `du`/`df` 区分"目录占多少"与"分区还剩多少"
- 了解目录权限、递归删除与打包备份的注意点

## 1. 目录创建

### 1.1 mkdir - 创建目录

`mkdir` 一次可建多个目录；`-p` 依次创建缺失的父目录（路径已存在也不报错，适合脚本幂等）；`-m` 直接指定权限；`-v` 打印创建过程。

```bash
mkdir -m 750 -v private_dir
ls -ld private_dir
```

```text
mkdir: created directory 'private_dir'
drwxr-x--- 2 cui cui 40 Sep 22 05:53 private_dir
```

多级与批量创建：

```bash
mkdir -p project/{src,bin,doc,test}
ls project
```

```text
bin
doc
src
test
```

```bash
mkdir dir_{1..3}
ls -d dir_*
```

```text
dir_1
dir_2
dir_3
```

花括号展开 `dir_{1..3}` 是 **Bash 扩展**，不是 `mkdir` 自身功能；若 `sh` 链接到 dash（Debian/Ubuntu 默认 `/bin/sh`），需改用显式列表或 `mkdir -p` 循环。

**坑**：不加 `-p` 时父目录缺失会报错；`mkdir a b` 若其中一个已存在，整条命令失败且已成功的部分**不会回滚**，脚本里更稳妥的是逐个 `mkdir -p`。

## 2. 目录删除

### 2.1 rmdir - 只删空目录

`rmdir` 故意设计得"保守"：非空一律拒绝，避免误删数据。`-p` 连同变空的父目录一并删除。

```bash
mkdir -p tmp_empty/sub
rmdir -v tmp_empty/sub
rmdir -v tmp_empty
```

```text
rmdir: removing directory, 'tmp_empty/sub'
rmdir: removing directory, 'tmp_empty'
```

```bash
mkdir -p nonempty && touch nonempty/f
rmdir nonempty
```

```text
rmdir: failed to remove 'nonempty': Directory not empty
# 退出码 1
```

### 2.2 rm -r / rm -rf - 递归删除

需要连内容一起删时用 `rm -r`；加 `-f` 变为强制（无确认、文件不存在也不报错），常写 `rm -rf`。

```bash
rm -r directory
rm -ri directory      # 逐个确认
rm -rf directory
```

**安全红线**：

1. 对变量路径先判空、再加 `--`：`[ -n "$dir" ] && rm -rf -- "$dir"`。
2. 避免 `rm -rf "$dir/"` 与未初始化变量组合；空值在部分场景会被解释成根相关路径。
3. 不确定时先 `rm -r`（会提示）或 `rm -i`，确认清单后再 `-f`。
4. 桌面环境误删请先考虑回收站；服务器 `rm` 通常不可恢复。

递归删除同样适用于文件页，见[文件操作命令](./file.md)。

## 3. 目录切换

### 3.1 cd - 切换目录

`cd` 是 shell 内建命令（不是外部程序），因此 `which cd` 通常找不到它。常用形态：

```bash
cd /etc/nginx          # 绝对路径
cd ..                  # 上级
cd .                   # 当前（一般无意义，脚本里可用于等待/占位）
cd ~                   # 家目录
cd                     # 同上，无参数也回家目录
cd -                   # 回到上一次所在目录（OLDPWD）
```

```bash
cd app/logs
pwd
cd ../..
pwd
cd -
```

```text
/tmp/rewrite_demo/dirsamples/app/logs
/tmp/rewrite_demo/dirsamples
/tmp/rewrite_demo/dirsamples/app/logs
```

`cd -` 会同时把新旧目录都打印一遍，适合"改完配置跳回去"的肌肉记忆操作。

**坑**：`cd /path || exit 1` 在脚本中很重要——切目录失败后若继续执行，后续相对路径操作会落在错误目录。

### 3.2 pwd - 显示当前目录

`pwd` 打印逻辑路径；`-P` 解析全部符号链接得到物理路径。二者不一致时，说明你正站在链接目录里。

```bash
ln -sfn /tmp/rewrite_demo/demoX /tmp/demoX_link
cd /tmp/demoX_link
pwd
pwd -P
```

```text
/tmp/demoX_link
/tmp/rewrite_demo/demoX
```

写绝对路径脚本、排查 `PATH`/`chroot` 问题时，`pwd -P` 比肉眼更可靠。

### 3.3 pushd / popd / dirs - 目录栈

需要在多个目录间来回跳，又不想敲长路径时，用目录栈暂存：

```bash
pushd /tmp/rewrite_demo/demoX
dirs
pushd /tmp
dirs
popd
dirs
```

```text
/tmp/rewrite_demo/demoX
/tmp /tmp/rewrite_demo/demoX /tmp/rewrite_demo/demoX
/tmp/rewrite_demo/demoX /tmp/rewrite_demo/demoX
```

`dirs -v` 可带编号查看；`cd +N` 跳到栈中第 N 项。它们同样是 Bash 内建。

## 4. 目录查看

### 4.1 ls - 列出目录内容

`ls` 是信息密度最高的日常命令之一。先看长格式每一列的含义，再记常用组合。

```bash
ls -la | head -8
```

```text
total 80
drwxrwxr-x  4 cui cui 640 Sep 22 05:53 .
drwxrwxr-x 10 cui cui 200 Sep 22 05:53 ..
-rw-rw-r--  1 cui cui   9 Sep 22 05:53 a.txt
-rw-rw-r--  1 cui cui   9 Sep 22 05:53 b.txt
lrwxrwxrwx  1 cui cui  18 Sep 22 05:53 broken_link.txt -> missing_target.txt
```

解读要点：

- 第一列 `drwxrwxr-x`：首字符 `d` 目录、`l` 符号链接、`-` 普通文件；其后三组分别是属主/属组/其他人的 rwx。
- 第二列数字是**硬链接数**（目录至少为 2：`.` 与父目录中的项）。
- `.` 当前目录，`..` 父目录；`ls -a` 才显示它们及其它隐藏项（以 `.` 开头）。

常用变体：

```bash
ls            # 当前目录，短格式
ls -lh        # 人类可读大小（K/M/G）
ls -lt        # 按修改时间，新在上
ls -lS        # 按大小，大在上
ls -R         # 递归列出子目录
ls --color=auto -F   # 着色并标出类型（/ 目录，@ 链接，* 可执行）
```

```bash
ls -lt | head -5
ls -lS | head -5
```

```text
# -lt 示例（时间新→旧）
-rwxr-xr-x  1 cui cui   4 Sep 22 05:53 fakebin
-rw-rw-r--  1 cui cui   2 Sep 22 05:53 f1
...
```

```bash
ls -R
```

```text
.:
f1
sub1

./sub1:
f2
```

**坑**：

- `ls dir` 与 `ls dir/` 结果通常相同，但 `ls dir/*` 会先展开再传给 `ls`，可能混入多个参数。
- 管道后颜色丢失：用 `ls --color=auto`（或配 `alias`），不要对管道强制 `--color=always` 再 `grep` 颜色码。
- `ls -l` 看到的链接默认**不**跟随（显示链接本身）；需要目标属性时用 `ls -lL` 或 `stat -L`。

### 4.2 tree - 树状显示

`tree` 最直观，但**默认不随最小化安装**：Ubuntu/Debian 用 `apt install tree`，RHEL 系 `dnf install tree`，Arch 用 `pacman -S tree`。

```bash
tree -L 2        # 最多 2 层
tree -d          # 只列目录
tree -a          # 含隐藏项
```

没有 `tree` 时的替代：`ls -R`、`find . -type d`，或 `find . -name pattern -type d`。

## 5. 目录复制

### 5.1 cp -r / cp -a - 复制目录

复制目录必须递归：`-r`/`-R`，或 `-a`（归档：递归 + 保留权限/时间/链接等，接近 `cpio`/`tar` 语义）。

```bash
cp -r source_dir dest_dir
cp -a source_dir dest_dir_backup
cp -rv app app_copy        # -v 打印每个复制的文件
cp -ri . existing_dir      # 覆盖前确认
```

语义细节：

- 若 `dest_dir` **不存在**：创建 `dest_dir`，内容来自 `source_dir`。
- 若 `dest_dir` **已存在**：把 `source_dir` 作为子目录拷进 `dest_dir/source_dir`，而不是合并覆盖同名文件——这与很多人的直觉相反，是高频事故点。

```bash
# 先 dry-run 思路：看目标是否已存在
[ -e dest ] && echo "exists, will nest" || echo "will create"
```

**坑**：`cp -r` 默认丢时间戳与属主；要"像原样备份"用 `cp -a`。跨文件系统复制大量小文件会明显变慢，必要时改用 `tar` 管道。

## 6. 目录移动

### 6.1 mv - 移动与重命名目录

目录的重命名与移动同样是 `mv`，同文件系统内只改目录项。

```bash
mkdir to_rename
mv -v to_rename renamed_dir
```

```text
renamed 'to_rename' -> 'renamed_dir'
```

```bash
mv old_name new_name                 # 重命名
mv source_dir /path/to/dest/         # 移入目标目录
```

**坑**：目标已存在且为**非空目录**时 `mv` 会失败（不会合并两个目录树）；目标为空目录时 GNU `mv` 可能直接放入其下（取决于具体实现与选项），不确定时先 `ls dest` 再执行。跨设备移动会变成复制+删除，大目录耗时且中途失败会留下半份数据。

## 7. 目录查找

### 7.1 find -type d

把 `find` 限定为目录类型即可；名称、时间、大小条件与文件查找一致，完整语法见[文件操作命令](./file.md)。

```bash
find /path -type d -name "dirname"
find /path -type d -mtime -7
find . -type d | sort
```

```text
.
./app
./app/conf
./app/logs
```

**坑**：目录大小用 `find ... -type d -size +100M` 意义不大——`-size` 对目录测的是目录项本身占的 inode 数据，**不**等于子树总和。要子树占用请用 `du -sh`。

## 8. 目录大小与磁盘

### 8.1 du - 统计目录占用

`du` 统计实际磁盘占用（不是 `ls -l` 的"长度"字段之和）。`-s` 汇总，`-h` 人类可读，`-a` 连文件一起列。

```bash
du -sh .
du -sh * | sort -hr | head -5
```

```text
8.0K	.
4.0K	sub1
4.0K	f1
```

按大小排序的黄金组合：`du -sh * | sort -hr`（`-h` 人类可读排序需 GNU sort；若 `sort -h` 不可用，改为 `sort -rn` 前先去掉 `-h` 或用 `du -sk`）。

**坑**：

- 硬链接被多处引用时，`du` 默认只计一次（跨命令行参数可能重复计），`df` 与 `du` 对不上常源于此。
- 符号链接默认不跟随统计目标（GNU `du` 计链接本身）；`-L` 才跟随，可能统计到链接外部的大目录，慎用。
- `du` 结果受权限影响：无读权限的子树会报错或不完整，需要时加 `2>/dev/null`。

### 8.2 df - 查看分区剩余

`df` 报告的是**挂载点/文件系统**级别，不是单个目录"自己的"大小。目录再大，只要在同一分区，就只反映在该分区的 `Use%` 上。

```bash
df -h .
df -Th .
```

```text
Filesystem                         Size  Used Avail Use% Mounted on
/dev/mapper/ubuntu--vg-ubuntu--lv  883G  492G  354G  59% /
tmpfs                               20G   92K   20G   1% /dev/shm
```

`-T` 附带文件系统类型（ext4、xfs、tmpfs…），排"空间没了却 du 不大"时先 `df -Th` 看是否打满的是另一块盘，或被打开但已删除的日志文件占住（`lsof +L1` 思路）。

| 问题 | 用哪个 |
|------|--------|
| 这个文件夹到底多大？ | `du -sh path` |
| 磁盘还剩多少？ | `df -h` |
| 空间被谁删掉的文件占着？ | `df -h` + 查看已删除未释放句柄 |

## 9. 目录权限

### 9.1 chmod - 修改权限

目录的 `x` 位决定能否 `cd` 进入与穿越，`r` 位决定能否 `ls` 列名，`w` 位决定能否在其中增删文件。**丢了 `x` 却有 `r`，会看到文件名却打不开**，这是权限排错的经典场景。

```bash
chmod 755 directory
chmod +x directory          # 补执行（穿越）位
chmod -R 755 project        # 递归（慎用，会改到所有子文件）
ls -ld app
```

```text
drwxr-xr-x 3 cui cui 80 Sep 22 05:53 app
```

更多八进制/符号模式说明见父页[基本命令](../basic.md)与 [Arch Wiki - File permissions](https://wiki.archlinux.org/title/File_permissions)。

**坑**：对整个代码树 `chmod -R 775`/`755` 会把普通文件也加上执行位；更精细用 `find project -type d -exec chmod 755 {} +` 与 `find project -type f -exec chmod 644 {} +` 分开处理。

### 9.2 chown - 修改属主/属组

改属主通常需要 root：

```bash
chown user directory
chown user:group directory
chown -R user:group directory
```

```text
chown: changing ownership of 'f1': Operation not permitted (os error 1)
# 普通用户执行时的典型报错
```

**坑**：递归 `chown -R` 影响面大，先 `chown user dir` 看一级效果，或先 `find` 出列表核对。把用户家目录误改属主会导致后续 `sudo`/会话异常。

## 10. 目录链接

```bash
ln -s /path/to/directory link_name
```

- **目录不能创建硬链接**（防止目录树成环，通用文件系统约定）；强行 `ln dir hard` 会报 `hard link not allowed for directory`。
- 符号链接指向目录是常态（`/etc/alternatives`、模块路径切换都靠它）。
- 与文件链接的 inode/`ls -li` 细节见[文件操作命令](./file.md)第 8 节。

## 11. 目录比较

```bash
diff -r dir1 dir2
diff -rq dir1 dir2
```

```text
Only in d1: b.txt
```

`-r` 递归比较同名文件；`-q` 只报告"是否不同/仅一侧存在"，适合备份校验。退出码与 `diff` 文件比较一致：`0` 相同，`1` 有差异。统一格式补丁见[文本处理命令](../text/text_processing.md)。

## 12. 目录打包

```bash
tar -czf archive.tar.gz directory      # 打包并 gzip 压缩
tar -tzf archive.tar.gz                # 只列出内容（不解包）
tar -xzf archive.tar.gz                # 解包解压
tar -cvf archive.tar directory         # 不压缩
```

```text
d1/
d1/b.txt
d1/a.txt
```

**坑**：

- `-z` 对应 gzip，`-j` 对应 bzip2，`-J` 对应 xz；后缀 `.tar.gz` 与选项要匹配。
- 打包时写 `directory` 与 `directory/` 在归档内路径表现可能不同，解包脚本里要固定一种写法。
- 先 `tar -t` 预览，再解到临时目录核对，避免 `--overwrite` 直接污染生产文件。
- 需要保留属主/ACL/SELinux 上下文时，GNU tar 加 `-p`/`--acls`/`--xattrs`（恢复端需相应权限）。

## 13. 实用技巧

### 13.1 批量创建结构

```bash
mkdir -p project/{src,bin,doc,test}
mkdir -p web/{css,js,img}
find web -type d | sort
```

```text
web
web/css
web/img
web/js
```

### 13.2 快捷方式回顾

```bash
cd ~        # 家目录
cd -        # 上次目录
cd ..       # 上级
pushd/popd  # 目录栈
```

### 13.3 一条命令定位"谁占空间"

```bash
du -h --max-depth=1 . | sort -hr | head
df -h .
```

先 `df` 判断盘是否写满，再 `du` 下钻目录，比盲目 `rm` 更安全。

## 14. 常见坑速查

| 现象 | 原因 | 处理 |
|------|------|------|
| `rmdir` 报 Directory not empty | 目录非空（含隐藏文件） | `ls -a` 查看后决定 `rm -r` |
| `cp -r` 结果里多套了一层 | 目标目录已存在 | 先确认目标是否存在 |
| `pwd` 与 `pwd -P` 不一致 | 当前路径含符号链接 | 统一用 `pwd -P` 写脚本 |
| `du` 很小但磁盘满 | 别的挂载点/已删除未释放 | `df -Th`，检查日志轮转 |
| `chmod` 后文件全可执行 | `chmod -R` 误伤普通文件 | 用 `find -type d/f` 分开改 |
| `tree`/`locate` 命令不存在 | 未安装 | `apt/dnf/pacman` 安装对应包 |
| `cd` 后相对路径全错 | 切目录失败未中止 | `\|\| exit 1` |

## 15. 三发行版差异说明

核心目录命令（`mkdir`/`cd`/`ls`/`du`/`df`）都来自 GNU coreutils，三系行为一致；差别集中在**可选工具预装与否、`/tmp` 挂载方式、默认 shell**上，换机器排错前先对下表。

| 场景 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 `tree`/`ncdu`/`plocate` | `sudo apt install tree ncdu plocate` | `sudo pacman -S tree ncdu plocate` | `sudo dnf install tree ncdu plocate` |
| `/tmp` 默认挂载 | systemd 默认 tmpfs（重启清空） | 可选 tmpfs 单元，默认常为磁盘目录 | 默认磁盘目录（`/var/tmp` 保留） |
| 默认登录 shell | `/bin/bash`（`/bin/sh` → dash） | `/bin/bash` | `/bin/bash` |
| `ls` 颜色/确认别名 | root 默认 `--color=auto` | root 默认 `--color=auto` | root 默认 `--color=auto`；部分别名含 `-i` |

**要点**：`/tmp` 是否 tmpfs 决定"重启文件还在不在"；`sh` 在 Debian/Ubuntu 指向 dash，shebang 没写 bash 时花括号展开会失效。Arch 基础文件命令已随 base 提供，详见 [Arch Wiki - Pacman](https://wiki.archlinux.org/title/Pacman)。

## 参考资料

- 鸟哥的私房菜 - 文件与目录管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)
- Arch Wiki - Core utilities — [wiki.archlinux.org](https://wiki.archlinux.org/title/Core_utilities)
- Arch Wiki - File permissions — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_permissions)
- Arch Wiki - Pacman — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- man ls — [man.archlinux.org](https://man.archlinux.org/man/ls.1)
- man mkdir — [man.archlinux.org](https://man.archlinux.org/man/mkdir.1)
- man rmdir — [man.archlinux.org](https://man.archlinux.org/man/rmdir.1)
- man du — [man.archlinux.org](https://man.archlinux.org/man/du.1)
- man df — [man.archlinux.org](https://man.archlinux.org/man/df.1)
- man tar — [man.archlinux.org](https://man.archlinux.org/man/tar.1)
- man chmod — [man.archlinux.org](https://man.archlinux.org/man/chmod.1)
- Debian 手册 — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Rocky Linux 文档 — [docs.rockylinux.org](https://docs.rockylinux.org/)
- Red Hat 文档 — [access.redhat.com](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/)
