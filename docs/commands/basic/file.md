# 文件操作命令

在 Linux 里，"一切皆文件"不只是口号：程序、设备、配置甚至目录本身，最终都以文件接口暴露。日常排错时，你真正高频使用的往往不是复杂服务命令，而是创建、查看、复制、移动、删除、查找、比较这一组文件操作。把它们的语义、退出码和危险边界弄清楚，后面学权限、日志和自动化脚本都会顺很多。

> 本页示例输出来自真实 Ubuntu 26.04 环境；发行版差异见文中标注。核心工具在 Debian/Ubuntu、RHEL/CentOS/Rocky、Arch 上默认均已安装，一般无需额外安装。

## 学习目标

- 理解文件创建、查看、复制、移动与删除的语义与退出码
- 掌握按名称/大小/时间查找，以及文件比较与链接
- 认识 inode、符号链接、通配符引号等常见坑

## 1. 文件创建

### 1.1 touch - 创建空文件与更新时间戳

`touch` 有两个用途：文件不存在时创建空文件；文件已存在时更新访问时间（atime）与修改时间（mtime）。运维脚本里常用它"打卡"式刷新时间戳，或批量生成占位文件。

```bash
# 创建空文件
touch file.txt

# 一次创建多个
touch file1.txt file2.txt file3.txt

# 设定指定修改时间（[[CC]YY]MMDDhhmm）
touch -t 202401011200 file.txt
stat -c '%n mtime=%y' file.txt
```

```text
file.txt mtime=2024-01-01 12:00:00.000000000 +0000
```

只更新访问时间用 `touch -a`，只更新修改时间用 `touch -m`。用 `-d` 可读性更好：`touch -d '2024-06-15 08:30:00' file2.txt`。

**坑**：`touch` 不会清空已有文件内容，只动时间戳。若目标路径中间目录不存在，会报 `No such file or directory`，需先 `mkdir -p`。

### 1.2 cat 重定向与 heredoc - 写入内容

创建文件更常见的方式是重定向。`cat > file` 覆盖写入，`cat >> file` 追加；heredoc（`<< EOF`）适合一次写入多行。

```bash
cat > file.txt << 'EOF'
Hello Linux
Second line	with tab
EOF

cat >> file.txt << 'EOF'
appended line
EOF
```

`<< 'EOF'` 两侧引号能抑制变量展开（`$VAR` 原样保留），写配置片段时更安全。

## 2. 文件查看

### 2.1 cat - 整文件输出

`cat` 把文件原样送到标准输出，适合小文件或管道拼接。`-n` 加行号，`-A` 显示全部非打印字符（Tab 显示为 `^I`，行尾为 `$`）。

```bash
cat -n file.txt
cat -A file.txt
```

```text
     1	Hello Linux
     2	Second line	with tab
     3	Third line with trailing space   
```

```text
Hello Linux$
Second line^Iwith tab$
Third line with trailing space   $
```

`cat -A` 是排查"看不见的空格/Tab/行尾"的利器：配置对齐失败、补丁无法应用时先看它。

**坑**：对超大日志用 `cat` 会一次读进管道，既慢又占内存；大文件请改用 `less`、`head`、`tail`。

### 2.2 less / more - 分页查看

大文件用 `less` 可来回翻页、搜索；`more` 只能向前翻，功能弱但依赖更少。`less` 常用键：空格下一页，`b` 上一页，`/` 搜索，`q` 退出。

```bash
less file.txt
more file.txt
```

### 2.3 head / tail - 查看首尾

日志排错最常用的一对命令。默认各显示 10 行；`-n` 指定行数，`-c` 指定字节；`tail -f` 实时跟踪追加写入。

```bash
head -n 5 nums.txt
tail -n 3 nums.txt
tail -n +18 nums.txt    # 从第 18 行开始显示到结尾
```

```text
1
2
3
4
5
```

```text
23
24
25
```

`tail -n +N` 在"跳过前面进度条/表头"时比 `sed -n 'N,$p'` 更直观。实时看日志：`tail -f /var/log/syslog`（RHEL 系常见路径为 `/var/log/messages`；`-F` 在日志轮转后会自动重新打开）。

## 3. 文件复制

### 3.1 cp - 复制文件

`cp` 默认**不保留**属主、时间戳等元数据，也不会提示覆盖已存在的目标。`-i` 交互确认，`-n` 不覆盖，`-p` 保留属性，`-a` 归档模式（保留属性并递归，等价于 `-dR --preserve=all` 的常用写法）。

```bash
cp file.txt copy_of_file.txt
cp -v file.txt copy2.txt
```

```text
-rw-rw-r-- 1 cui cui 67 Sep 22 05:52 copy_of_file.txt
'file.txt' -> 'copy2.txt'
```

```bash
cp -a file.txt cp_a.txt
stat -c '%n %y' file.txt cp_a.txt
```

```text
file.txt 2024-01-01 12:00:00.000000000 +0000
cp_a.txt 2024-01-01 12:00:00.000000000 +0000
```

复制目录必须加 `-r`/`-R`（或 `-a`）。递归复制目录的更多细节见[目录操作命令](directory.md)。

**坑**：`cp src/ dest/` 中源路径尾部斜杠在 GNU `cp` 下通常仍表示目录本身；真正危险的是目标写错成 `.` 或根路径。生产上建议 `cp -i` 或先 `cp` 到临时名再 `mv` 覆盖。

## 4. 文件移动

### 4.1 mv - 移动与重命名

同一文件系统内，`mv` 主要改目录项（rename），几乎瞬时完成；跨文件系统则相当于复制后删除。重命名与移动是同一条命令的两种形态。

```bash
mv -v copy2.txt renamed.txt
```

```text
renamed 'copy2.txt' -> 'renamed.txt'
```

```bash
mv file.txt /path/to/dir/
mv -i old.txt existing.txt      # 覆盖前询问
mv -n important.txt backup/     # 目标存在则不覆盖
```

**坑**：`mv` 默认静默覆盖同名目标，没有 `-i`/`-n` 时无法撤销。批量 `mv *.txt dir/` 前先 `echo *.txt` 看看通配结果，避免把意外文件卷进去。

## 5. 文件删除

### 5.1 rm - 删除文件

`rm` 删除后通常不进回收站。`-i` 逐个确认，`-f` 强制（文件不存在也不报错），`-r` 递归删除目录。

```bash
rm -v renamed.txt
```

```text
removed 'renamed.txt'
```

```bash
rm file.txt
rm -i important.txt
rm -r directory/
rm -rf directory/
```

**安全建议（务必遵守）**：

1. 脚本里对 `rm -rf` 变量路径做非空判断：`[ -n "$dir" ] && rm -rf -- "$dir"`。
2. 永远写 `--` 结尾的绝对路径或明确相对路径，防止以 `-` 开头的文件名被当成选项。
3. 空路径在部分老实现上极度危险；新 GNU coreutils 有防护，但不要赌实现细节。
4. 递归删除目录的完整讨论见[目录操作命令](directory.md)。

## 6. 文件查找

### 6.1 find - 按条件查找

`find` 直接遍历文件系统，条件精确、无需数据库。最常用的是按名、按类型、按大小、按时间。

```bash
find . -name "*.txt" -type f
find . -iname "*.TXT"              # 名称忽略大小写
find . -name "*.txt" -size +0c     # 大小超过 0 字节
find . -name "*.txt" -mtime -1     # 24 小时内修改过
find . -perm -u+x -name "*.sh"     # 属主可执行的脚本
```

```text
./a.txt
./b.txt
./copy_of_file.txt
./dir_a/nested.txt
./file.txt
...
./permtest/exec.sh
```

对匹配结果执行动作：

```bash
find . -maxdepth 1 -name "nums.txt" -exec wc -l {} \;
```

```text
25 ./nums.txt
```

`-delete` 可就地删除（隐含深度优先）；大量文件用 `-print0 | xargs -0` 处理，见[文本处理命令](../text/text_processing.md)中的 `xargs`。

**坑**：

- `-name "*.txt"` 中的 `*.txt` **必须加引号**，否则会被当前目录的 glob 先展开，导致 `find` 收到一串具体文件名而不是模式。
- `-mtime -7` 表示"7 天内"，`-mtime +7` 表示"超过 7 天"，符号方向容易记反；拿不准时先去掉 `-exec` 只看路径。
- `find /` 从根扫全盘较慢；先缩小起始目录，或对已索引路径改用 `locate`。

### 6.2 locate - 基于数据库的快速查找

`locate` 查询预建数据库，速度极快，但**看不到刚创建/刚删除的文件**，且结果是历史快照。数据库由 `updatedb` 定时更新（通常经 `cron`/`systemd timer`）。

```bash
# 手动更新数据库（需 root）
sudo updatedb

# 查找
locate file.txt

# 正则匹配路径
locate -r '\.txt$'
```

安装情况因发行版而异：本 Ubuntu 演示环境默认**未安装** `locate`（需 `apt install plocate`）；RHEL/CentOS/Rocky 为 `dnf install plocate` 或 `mlocate`；Arch 可用 `pacman -S plocate`。若命令不存在，`find` 是唯一可靠选择。

更多说明见 [Arch Wiki - Locate](https://wiki.archlinux.org/title/Locate) 与 [man find](https://man.archlinux.org/man/find.1.en)。

## 7. 文件比较

### 7.1 diff - 比较文件

`diff` 输出**人类可读/可打补丁**的差异。退出码是脚本关键：`0` 相同，`1` 有差异，`>1` 出错。

```bash
diff file.txt file2.txt; echo "exit=$?"
```

```text
1,2c1,2
< Hello Linux
< Second line	with tab
---
> Hello Linux v2
> Second line changed
3a4
> Fourth line
exit=1
```

统一格式（补丁标准）与并排显示：

```bash
diff -u file.txt file2.txt || true
diff -y file.txt file2.txt
diff -rq dir1 dir2          # 只报告有差异的文件（quiet）
```

```text
--- file.txt	2024-01-01 12:00:00.000000000 +0000
+++ file2.txt	2024-06-15 08:30:00.000000000 +0000
@@ -1,3 +1,4 @@
-Hello Linux
-Second line	with tab
+Hello Linux v2
+Second line changed
 Third line with trailing space   
+Fourth line
```

**坑**：`set -e` 下 `diff` 发现差异会因退出码 `1` 中断脚本；要么 `diff ... || true`，要么显式判断 `if diff -q a b; then ...`。

### 7.2 cmp - 逐字节比较

`cmp` 输出第一个不同字节的位置，适合二进制文件；`-l` 列出所有不同字节（八进制）。

```bash
cmp a.txt b.txt; echo "exit=$?"
cmp -l a.txt b.txt || true
```

```text
a.txt b.txt differ: byte 7, line 1
exit=1
7 147 130
```

选择建议：文本要"看改了什么"用 `diff`；二进制或只需"是否相同"用 `cmp`。

## 8. 文件链接

### 8.1 ln - 硬链接与符号链接

硬链接与原文件共享同一 inode，**删除原名后内容仍可通过另一硬链接访问**；目录通常不能建硬链接（防止出现环）。符号链接是独立的小文件，存目标路径，目标不存在即 broken。

```bash
ln file.txt hard_link.txt
ls -li file.txt hard_link.txt
```

```text
6665323 -rw-rw-r-- 2 cui cui 67 Jan  1  2024 file.txt
6665323 -rw-rw-r-- 2 cui cui 67 Jan  1  2024 hard_link.txt
```

`ls -li` 中两行 inode 同为 `6665323`、链接数为 `2`，说明是同一份数据。

```bash
ln -s file.txt soft_link.txt
ln -s missing_target.txt broken_link.txt
ls -l soft_link.txt broken_link.txt
```

```text
lrwxrwxrwx 1 cui cui  8 Sep 22 05:53 soft_link.txt -> file.txt
lrwxrwxrwx 1 cui cui 18 Sep 22 05:53 broken_link.txt -> missing_target.txt
```

**坑**：

- 给已有名字建链接：`ln -sf 真实文件 链接名` 中 `-f` 才能覆盖；不加 `-s` 会变成又一个硬链接。
- 符号链接指向相对路径时，是**相对链接所在目录**解析，不是相对当前工作目录。
- 跨文件系统无法建硬链接，只能用符号链接。

## 9. 文件属性

### 9.1 stat - 查看元数据

`stat` 显示 inode、大小、权限、三次时间（访问/修改/状态改变）等。排查"文件明明在却打不开""时间戳不对"时先 `stat`。

```bash
stat file.txt
stat -c 'inode=%i links=%h size=%s mode=%A' file.txt
```

```text
  File: file.txt
  size: 67        	Blocks: 8          IO Block: 4096   regular file
Device: 0,38	Inode: 6665323     Links: 2
Access: (0664/-rw-rw-r--)  Uid: ( 1000/     cui)   Gid: ( 1000/     cui)
Access: 2026-09-22 05:52:37.979360375 +0000
Modify: 2024-01-01 12:00:00.000000000 +0000
Change: 2026-09-22 05:53:16.742582259 +0000
 Birth: 2026-09-22 05:52:37.891366681 +0000
```

```text
inode=6665323 links=2 size=67 mode=-rw-rw-r--
```

三个时间不要混淆：**Access** 读一次就变；**Modify** 内容变了才变（备份常用它）；**Change** 元数据（权限、属主）变了就变，通常紧跟 Modify。

查看文件系统剩余空间用 `df -h file.txt`（`stat -f` 是 BSD/macOS 习惯，GNU/Linux 上语义不同，见[目录操作命令](directory.md)）。

### 9.2 file - 识别文件类型

不靠扩展名，`file` 读文件头判断类型；`-i` 输出 MIME。

```bash
file file.txt
file -i file.txt
file fakebin
```

```text
file.txt: ASCII text
file.txt: text/plain; charset=us-ascii
fakebin: ELF
```

**坑**：`file` 对符号链接默认报告链接本身（`symbolic link to ...`）；加 `-L` 才跟随目标。扩展名是 `.sh` 不代表可执行，是否可执行看权限位（`ls -l`）和 shebang。

## 10. 常见坑速查

| 现象 | 原因 | 处理 |
|------|------|------|
| `rm` 误删无法恢复 | 无回收站机制 | 重要数据先备份；谨慎 `rm -rf` |
| `cp`/`mv` 静默覆盖 | 默认无确认 | 加 `-i` 或 `-n` |
| `find` 模式失效 | `*.txt` 被 shell 先展开 | 给模式加引号 |
| `diff` 让脚本中途退出 | 有差异退出码为 1 | `\|\| true` 或显式判断 |
| 符号链接点击/打开失败 | 目标不存在（broken link） | `ls -l` 看箭头指向，`stat -L` 跟随 |
| `locate` 查不到新文件 | 数据库未更新 | `sudo updatedb` 或改用 `find` |
| 行尾/Tab 对不齐 | 文件里有不可见字符 | `cat -A` 检查 |

## 11. 三发行版差异说明

`cp`/`mv`/`rm`/`find` 等核心命令三系一致，差异集中在**默认 umask、覆盖确认别名、SELinux 上下文**这几处会在脚本里"悄悄不同"的地方。

| 场景 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 `plocate`/`tree`/`file` | `sudo apt install plocate tree file` | `sudo pacman -S plocate tree file` | `sudo dnf install plocate tree file` |
| 新用户默认 umask | `0022` | `0022` | 普通用户 `0002`（legacy）；root `0022` |
| `cp`/`mv` 覆盖确认别名 | 默认无 `-i` 别名 | 默认无 `-i` 别名 | 部分环境为 root 配 `cp -i`、`mv -i` 别名 |
| 查看 SELinux 上下文（`ls -Z`） | AppArmor，少见用 | 无默认强制访问控制 | 常用；规则用 `semanage fcontext` |
| 系统日志路径（`tail -f` 示例） | `/var/log/syslog` | `journalctl` 优先 | `/var/log/messages` |

**要点**：RHEL 系交互式 root shell 常见 `cp`/`mv` 的 `-i` 别名，同一脚本交互与非交互下行为可能不同，自动化里显式写 `-n` 或 `\cp`；`ls -Z` 上下文不对是 SELinux 标签问题，用 `restorecon -R` 恢复而非 `chmod`。

## 参考资料

- [鸟哥的私房菜 - 文件与目录管理](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)
- [Arch Wiki - Core utilities](https://wiki.archlinux.org/title/Core_utilities)
- [Arch Wiki - Find](https://wiki.archlinux.org/title/Find)
- [Arch Wiki - Locate](https://wiki.archlinux.org/title/Locate)
- [Arch Wiki - File permissions](https://wiki.archlinux.org/title/File_permissions)
- [man ls](https://man.archlinux.org/man/ls.1.en) / [man find](https://man.archlinux.org/man/find.1.en) / [man stat](https://man.archlinux.org/man/stat.1.en) / [man diff](https://man.archlinux.org/man/diff.1.en) / [man ln](https://man.archlinux.org/man/ln.1.en)
- [Linux man pages (man7)](https://man7.org/linux/man-pages/)
- [Debian 手册](https://www.debian.org/doc/manuals/debian-handbook/) · [Rocky Linux 文档](https://docs.rockylinux.org/) · [Red Hat 文档](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/)
