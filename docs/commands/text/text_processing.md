# 文本处理命令

Linux 运维与开发的大量工作，本质是"把一堆文本变成另一堆文本"：过滤日志、提取字段、统计汇总、批量替换。`grep`、`sed`、`awk` 被合称为文本处理三剑客，再配合 `sort`/`uniq`/`cut`/`tr`/`wc` 等小工具，可以用管道搭出很强大的流水线。本页强调**语义与退出码**，因为脚本里"命令成功"往往就等于"退出码为 0"。

> 示例输出来自真实 Ubuntu 26.04 环境。下列工具在 Debian/Ubuntu、RHEL/CentOS/Rocky、Arch 上默认均已安装。

## 学习目标

- 掌握 `grep` 检索及退出码约定（0/1/2）
- 会用 `sed`/`awk` 做替换、删行、按列处理与简单统计
- 熟悉 `sort`/`uniq`/`cut`/`tr`/`wc` 等管道积木
- 了解 BRE/ERE 差异与 `egrep`/`fgrep` 的 POSIX 废弃背景

## 1. 文本查看

查看类命令在[文件操作命令](../basic/file.md)与[文本编辑和查看工具](./editors.md)有更完整的行为说明，此处只列与流水线相关的要点。

### 1.1 cat / less / head / tail

```bash
cat -n file.txt / cat -A / head -n 5 / tail -n 3 / tail -n +18 / tail -f / less
# cat -n: 1  Hello Linux
# cat -A: Hello Linux$ / Second line^Iwith tab$（^I=Tab，行尾 $）
```

**管道习惯**：`head`/`tail` 既能接文件参数，也能读标准输入；`less` 也可 `dmesg | less`。实时多文件或轮转场景优先 `tail -F`。

## 2. 文本搜索

### 2.1 grep - 检索之王

`grep` 在文件或标准输入中查找匹配行。最需要记住的不是选项列表，而是**退出码**：脚本控制流几乎全靠它。

```bash
printf 'Apple pie\nbanana\nAPPLE sauce\ngrape\n' > g.txt
grep -i apple g.txt        # 忽略大小写 → Apple pie / APPLE sauce
grep -n -i apple g.txt     # 带行号 → 1:Apple pie / 3:APPLE sauce
grep -c -i apple g.txt     # 只输出匹配行数 → 2
grep -v -i apple g.txt     # 反向 → banana / grape
grep -A1 -i apple g.txt    # 匹配行后 1 行
grep -B1 -A1 -i apple g.txt # 前 1 + 匹配 + 后 1
grep -rn "Hello" . --include="*.txt"   # 递归限定扩展名
grep -F 'Apple pie' g.txt  # 固定字符串
grep -E -i 'apple|banana' g.txt        # 扩展正则
```

**退出码（必须背下来）**：

| 退出码 | 含义 |
|--------|------|
| `0` | 至少有一行匹配 |
| `1` | 没有任何匹配（**不是错误**） |
| `2` | 语法错误或文件不存在等真错误 |

```bash
grep nomatch g.txt; echo $?
grep -i apple g.txt >/dev/null; echo $?
```

```text
1
0
```

管道陷阱：默认情况下 `grep 无匹配 | wc -l` 的退出码来自 `wc`（0），`set -e` 不会中断。需要感知"有没有匹配"时开管道失败传播：

```bash
set -o pipefail
grep zzz g.txt | wc -l; echo $?
# 输出 0，退出码 1 —— grep 的"无匹配"被传了出来
set +o pipefail
```

### 2.2 egrep / fgrep - POSIX 已废弃，改用 `grep -E` / `grep -F`

`egrep` 与 `fgrep` 历史上分别是 `grep -E`（扩展正则）与 `grep -F`（固定字符串）的别名。**POSIX 已将它们标记为 deprecated（废弃）**，理由包括与 `grep -E/-F` 语义重复、历史实现行为不一致，以及 `egrep` 名称在新标准中带来的兼容包袱；部分系统文档与新发行版已不再推荐、甚至不再提供独立别名。因此：**新脚本与新教程一律写 `grep -E` / `grep -F`**，遇到旧代码里的 `egrep`/`fgrep` 应理解为同义并逐步替换。

```bash
grep -E "pattern1|pattern2" file.txt   # 等价于废弃的 egrep
grep -F "fixed string" file.txt        # 等价于废弃的 fgrep（字面匹配，通常更快）
grep -E 'apple|banana' g.txt           # → Apple pie / banana / APPLE sauce
grep -F 'Apple pie' g.txt              # → Apple pie
```

注意：`grep -F` 会把 `.`、`*`、`[` 等全部当普通字符；需要正则时用 `-E`（或默认 BRE）。详细规范可对照 [POSIX grep](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/grep.html)与 [Arch Wiki - Grep](https://wiki.archlinux.org/title/Grep)。

## 3. 文本替换

### 3.1 sed - 流编辑器

`sed` 逐行处理，默认**不**修改原文件。最常用的是替换 `s/old/new/` 与删行 `Nd`。默认只替换每行**第一次**出现，加 `g` 才是全局。

```bash
printf 'foo bar foo baz\n' | sed 's/foo/FOO/'     # → FOO bar foo baz
printf 'foo bar foo baz\n' | sed 's/foo/FOO/g'    # → FOO bar FOO baz
printf 'foo bar foo\n' > sedfile.txt
sed -i.bak 's/foo/FOO/g' sedfile.txt              # 就地改并写 .bak 备份
seq 1 6 | sed '3,5d'    # → 1 2 6
seq 1 5 | sed -n '2p'   # → 2（-n 关默认打印，p 才输出选中行）
seq 1 3 | sed '2i\INSERTED'   # → 1 / INSERTED / 2 / 3
seq 1 3 | sed '2a\APPENDED'   # → 1 / 2 / APPENDED / 3
```

GNU sed 的 `-i` 直接改文件；`-i.bak`（注意没有空格）会先写备份。BSD/macOS 上 `-i` 必须带后缀参数，跨平台脚本要么显式 `-i.bak`，要么用重定向 + `mv`。`-n` 关闭默认打印，配合 `p` 才是"只输出选中行"。地址支持行号、`$` 末行、`/re/` 正则与逗号区间。

**坑**：

- 分隔符不一定要 `/`：路径替换常用 `s|/old|/new|g`，避免转义 `\/`。
- `-i` 前先 `cp file file.bak` 或 `sed -i.bak`，尤其是 `/etc` 下配置。
- 对二进制/大文件，`sed` 整文件载入策略要留意内存；优先限定行号或先 `grep` 缩小范围。

### 3.2 awk - 按列处理与统计

`awk` 默认按空白分列，`$1` 第一列，`$0` 整行，`NF` 列数，`NR` 行号；`-F` 指定分隔符。适合"取第几列、按条件过滤、分组求和"。

```bash
awk -F: '{print $1}' /etc/passwd              # → root / daemon / bin …
awk -F: '{print $1, $NF}' /etc/passwd | head -2  # → root /bin/bash · daemon /usr/sbin/nologin
awk 'NR<=3 {print NR, NF, $0}' fruits.txt     # 行号、列数、整行
awk '{s+=$2} END{print s}' fruits.txt         # 求和 → 20
printf 'a 10\nb 5\na 7\nc 3\na 1\nc 3\n' > sales.txt
awk '{s[$1]+=$2} END{for (k in s) printf "%-6s %d\n", k, s[k]}' sales.txt | sort
# → a 18 / b 5 / c 3
awk 'BEGIN{printf "%-10s %s\n", "NAME", "QTY"}'  # 表头格式化
```

**坑**：

- 数字比较在字段像数字时按数值算，否则按字符串；脏数据会 silently 得到错误结果，必要时 `+0` 强制转换。
- `awk` 的 `printf` 格式与 C 类似，`\n` 必须写在格式串里。
- 复杂状态机/正则回溯重的场景，现代也可考虑 `gawk` 扩展或专用工具，但三剑客仍是必修。

## 4. 文本排序与去重

### 4.1 sort

```bash
sort fruits.txt           # 字典序：apple 5 / apple 9 / banana 3 / cherry 2 / date 1
sort -k2 -n fruits.txt    # 按第 2 列数值：date 1 / cherry 2 / banana 3 / apple 5 / apple 9
sort -u list.txt          # 排序并去重
sort -t: -k3 -n /etc/passwd | head | cut -d: -f1,3   # root:0 / daemon:1 / bin:2
```

默认按**字典序**（甚至受 locale 影响），`-n` 数值、`-r` 反向、`-h` 人类可读大小（GNU）。管道里做数字排序时务必 `-n`，否则 `"10"` 会排在 `"9"` 前面。

### 4.2 uniq - 连续相同行去重

`uniq` **只合并相邻的重复行**，所以几乎总要先 `sort`。`-c` 计数，`-d` 只输出重复过的行，`-u` 只输出从未重复的行。

```bash
printf 'apple\nbanana\napple\ncherry\napple\n' > list.txt
sort list.txt | uniq -c   # → 3 apple / 1 banana / 1 cherry
sort list.txt | uniq -d   # → apple（只输出重复过的行）
sort list.txt | uniq -u   # → banana / cherry（只输出从未重复的行）
```

**坑**：跳过 `sort` 直接 `uniq`，相隔的重复行会被当成"没重复"。

## 5. 文本转换

### 5.1 tr - 按字符映射/删除

`tr` 只处理标准输入，不能直接接文件名；做大小写转换、删字符、压缩重复空白很方便。

```bash
printf 'hello world\n' | tr 'a-z' 'A-Z'   # → HELLO WORLD
printf 'a  b   c\n' | tr -s ' '           # 压缩连续空白 → a b c
printf 'abc123\n' | tr -d '0-9'           # 删除集合内字符 → abc
```

**坑**：`tr` 不能替换"一串"为另一串（那是 `sed` 的活）；`-d` 是删除集合内字符，不是删除行。

### 5.2 cut - 按分隔符/字符截取

比 `awk` 更轻的取列工具，适合简单 `-f` 场景；不支持复杂条件逻辑。

```bash
cut -d: -f1 /etc/passwd | head -3         # → root / daemon / bin
cut -d: -f1,3 /etc/passwd | head -3       # → root:0 / daemon:1 / bin:2
printf 'col1,col2,col3\n' | cut -d, -f2   # → col2
printf 'abcdefghij\n' | cut -c3-5         # → cde
```

**坑**：`cut` 的分隔符只能是**单个字符**，不能是多字符/正则；CSV 内含逗号时请用 `awk -F'","'` 或专用 CSV 工具。

### 5.3 paste - 按行合并多列

```bash
paste -d, c1.txt c2.txt   # c1: a b c / c2: 1 2 3 → a,1 / b,2 / c,3
```

默认分隔符是 Tab；`paste -s` 可把多行合成一行。

## 6. 文本统计

```bash
wc -l fruits.txt     # 5 fruits.txt（行数）
wc -lw fruits.txt    # 5 10 fruits.txt（行·词）
wc fruits.txt g.txt  # 各文件行/词/字节 + total 行
```

列顺序固定为：行数、词数、字节数。`-l` 行、`-w` 词、`-c` 字节（部分实现 `-m` 为字符数）。

**坑**：`wc -l` 数的是**换行符个数**；最后一行没有 `\n` 时不会被计入。配合 `grep -c` 要分清"行数"与"匹配行数"。

## 7. 文本比较与补丁

```bash
diff -u file.txt file2.txt || true
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

生成补丁并应用：

```bash
diff -u old.conf new.conf > fix.patch
patch < fix.patch          # 或 patch target_file < fix.patch
```

退出码：`0` 相同，`1` 有差异，`>1` 出错——与 `grep` 的"1 表示无匹配"一样，**1 在这里表示业务意义上的"有差异"，不是崩溃**。`set -e` 脚本中请显式处理。文件级更多示例见[文件操作命令](../basic/file.md)。

## 8. 正则表达式

### 8.1 基本正则表达式（BRE）

`grep`/`sed` 默认方言（POSIX BRE）。`+`、`?`、`|`、`()` 等**不是**元字符，字面匹配；需要时写 `\+`、`\?` 等（GNU 扩展）。

| 符号 | 说明 |
|------|------|
| `.` | 匹配任意单个字符 |
| `*` | 前一字符 0 次或多次 |
| `^` | 行首（行中间则是字面 `^` 视实现而定） |
| `$` | 行尾 |
| `[]` | 字符集合 |
| `[^]` | 集合取反 |
| `\` | 转义/引用 |

### 8.2 扩展正则表达式（ERE）

`grep -E`、`awk`（默认近似 ERE）、`sed -E` 使用。元字符含义与直觉更接近现代正则。

| 符号 | 说明 |
|------|------|
| `+` | 1 次或多次 |
| `?` | 0 次或 1 次 |
| `()` | 分组 |
| `\|` | 或（ERE 中 `\|` 即可） |
| `{n}` / `{n,}` / `{n,m}` | 次数限定 |

```bash
echo 'a+ b' | grep 'a+'        # BRE：+ 是字面量，仍匹配成功
echo 'a+ b' | grep -E 'a+'     # ERE：+ 是量词 → a+ b
echo 'foo(bar)' | grep -E 'foo(bar)'   # 分组
```

### 8.3 实用示例

```bash
printf 'ip 192.168.1.1 ok\ndate 2024-01-15\nmail user@example.com\n' > rx.txt

grep -Eo '[0-9]{1,3}(\.[0-9]{1,3}){3}' rx.txt
grep -E '[0-9]{4}-[0-9]{2}-[0-9]{2}' rx.txt
grep -E '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' rx.txt
```

```text
192.168.1.1
date 2024-01-15
mail user@example.com
```

**坑**：IP 示例是"教学级"正则，不能校验 0–255 边界；生产校验请用成熟解析库。中文、Unicode 类与 `grep -P`（PCRE，非所有系统默认启用）要确认平台支持再用。

## 9. 管道进阶

### 9.1 xargs - 把标准输入变成命令参数

`find`/`grep` 的输出转成 `rm`、`chmod` 等命令的参数时，空格与换行文件名是重灾区，优先 `-print0` + `-0`。

```bash
printf 'one two three\n' | xargs -n1 echo got   # → got one / got two / got three
printf 'a.txt\0b.txt\0' | xargs -0 -I{} echo "file: {}"  # file: a.txt / file: b.txt
find . -name "*.txt" -print0 | xargs -0 rm     # 空格文件名安全删除
```

**坑**：GNU `xargs` 默认即使无输入也可能执行一次命令（视选项）；要"有输入才跑"可加 `-r`（GNU）。删除前先去掉 `-exec rm` 试跑 `find ... -print | xargs -n1 echo` 看清单。

### 9.2 tee - 同时写屏幕与文件

```bash
echo hello | tee teeout.txt     # → 屏幕与文件各一份 hello
echo world | tee -a teeout.txt  # 追加 → teeout.txt: hello / world
```

`tee` 默认覆盖，`-a` 追加；可接多个文件名。既想看进度又想落盘时替代 `> file`。

### 9.3 管道组合示例：日志 Top 关键字

```bash
grep -i error app.log | awk '{print $3}' | sort | uniq -c | sort -rn | head
```

思路固定为：**过滤 → 取列 → 排序 → 去重计数 → 再按计数排 → 截断**。改任一环节即可适配其它统计需求。

## 10. 常见坑速查

| 现象 | 原因 | 处理 |
|------|------|------|
| `grep` 返回码 1 使脚本中断 | 1 = 无匹配，`set -e` 视为失败 | 判断退出码，或显式 `\|\| true` |
| `egrep` 在新系统报 not found/警告 | POSIX 废弃别名 | 改写 `grep -E` / `grep -F` |
| `sed -i` 搞坏配置 | 无备份就地写 | `-i.bak` 或先 `cp` |
| `uniq` 去重不干净 | 未先 `sort` | `sort \| uniq` |
| `sort -n` 仍乱序 | 混有非数字/未加 `-n` | 检查分隔符与 `-k` |
| `cut` 取错列 | 默认按 Tab，不是任意空白 | `-d:` 指定分隔符，复杂用 `awk` |
| `wc -l` 少一行 | 文件末行无换行 | 接受语义或 `printf '\n'` 补齐 |
| 管道"假成功" | 退出码来自最后一命令 | `set -o pipefail` |
| 文件名带空格被 `xargs` 拆碎 | 按空白分词 | `-print0` + `xargs -0` |

## 11. 三发行版差异说明

三系都是 GNU 工具链（`grep`/`sed` 语义一致），差别主要在 **awk 实现、现代替代工具与日志路径**上，写跨发行版脚本前先对下表。

| 场景 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| awk 实现 | 默认可能 `mawk`，装 `apt install gawk` | `gawk`（`pacman -S gawk` 确认） | 默认 `gawk`（`dnf install gawk` 确认） |
| `grep -P`（PCRE） | GNU grep 默认支持 | 默认支持 | 默认支持 |
| 现代搜索替代（ripgrep/fd） | `apt install ripgrep fd-find`（二进制 `fdfind`） | `pacman -S ripgrep fd` | `dnf install ripgrep fd-find` |
| `sed -i` 行为 | GNU sed：`-i` 无需后缀，`-i.bak` 才备份 | 同左 | 同左 |
| 默认分页/编辑器 | `less` + `nano` | `less` + 需自装编辑器 | `less` + `vim-minimal`/`nano` |
| 日志路径（`tail -f` 示例） | `/var/log/syslog` | `journalctl` 优先 | `/var/log/messages` |

**要点**：Debian 系 awk 常是轻量 `mawk`，依赖 `asort` 等 gawk 特性的脚本要显式 `gawk`；`fd` 在 Debian/Ubuntu 二进制名为 `fdfind`。Arch 详见 [Arch Wiki - AWK](https://wiki.archlinux.org/title/AWK)、[Arch Wiki - Sed](https://wiki.archlinux.org/title/Sed)、[Arch Wiki - Grep](https://wiki.archlinux.org/title/Grep)。

## 参考资料

- 鸟哥的私房菜 - 正则表达式与文本处理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0330regularex.php)
- Arch Wiki - Grep — [wiki.archlinux.org](https://wiki.archlinux.org/title/Grep)
- Arch Wiki - Sed — [wiki.archlinux.org](https://wiki.archlinux.org/title/Sed)
- Arch Wiki - AWK — [wiki.archlinux.org](https://wiki.archlinux.org/title/AWK)
- Arch Wiki - Core utilities — [wiki.archlinux.org](https://wiki.archlinux.org/title/Core_utilities)
- POSIX grep — [pubs.opengroup.org](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/grep.html)
- man grep — [man.archlinux.org](https://man.archlinux.org/man/grep.1)
- man sed — [man.archlinux.org](https://man.archlinux.org/man/sed.1)
- man awk — [man.archlinux.org](https://man.archlinux.org/man/awk.1)
- man sort — [man.archlinux.org](https://man.archlinux.org/man/sort.1)
- man uniq — [man.archlinux.org](https://man.archlinux.org/man/uniq.1)
- man tr — [man.archlinux.org](https://man.archlinux.org/man/tr.1)
- man cut — [man.archlinux.org](https://man.archlinux.org/man/cut.1)
- man wc — [man.archlinux.org](https://man.archlinux.org/man/wc.1)
- man xargs — [man.archlinux.org](https://man.archlinux.org/man/xargs.1)
- man tee — [man.archlinux.org](https://man.archlinux.org/man/tee.1)
- man diff — [man.archlinux.org](https://man.archlinux.org/man/diff.1)
- Linux man pages (man7) — [man7.org](https://man7.org/linux/man-pages/)
