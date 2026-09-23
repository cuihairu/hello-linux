# 文本处理

文本处理是 Shell 脚本的核心技能——Linux 系统里配置、日志、账号、进程信息几乎都以文本形式存在，脚本的日常职责就是"从文本里筛选、统计、改写信息"。`grep`、`sed`、`awk` 被称为三件套：**grep 负责找，sed 负责改，awk 负责算**。三者都内建或默认使用正则表达式，但默认方言不同（BRE/ERE/自成一派），这正是本章与 [正则表达式](./regex.md) 的衔接点。命令篇已讲过基础用法（见 [文本处理命令](../commands/text/text_processing.md)），本章聚焦**脚本语境下的组合技巧、退出码语义与跨工具选型**，避免大段重复基础参数。

> 内容参考自 GNU 手册、鸟哥的私房菜和 Awk 编程语言，见文末参考资料。

## 学习目标

- 掌握 grep 在脚本中的退出码语义与常用旗标组合
- 会用 sed 做地址限定替换、原地编辑与安全备份
- 掌握 awk 的字段、模式、内置变量与求和去重
- 能根据任务在 grep/sed/awk/cut/sort 间做出正确选型
- 理解管道组合的退出码与 `pipefail` 的影响

## 1. grep：搜索与过滤

### 1.1 核心旗标与脚本用途

最常用的旗标组合：`-i` 忽略大小写，`-n` 显示行号，`-v` 反向匹配，`-c` 只输出匹配行数，`-o` 只输出匹配到的部分，`-r` 递归目录，`-E` 扩展正则 ERE，`-F` 固定字符串最快，`-w` 全词匹配，`-A`/`-B` 输出匹配行前后上下文。模式以 `-` 开头时用 `--` 终止选项解析。**`egrep`/`fgrep` 已被 POSIX 标记为弃用**，脚本里统一写 `grep -E` / `grep -F`。

**退出码才是脚本里的关键**：0 表示找到至少一行匹配（`if grep -q ...; then` 条件成立），1 表示没有任何匹配，2 表示出错（文件不存在等）。要区分"不存在"与"出错"时不能只看非零，应取 `$?` 判断是否等于 1。幂等写配置的典型例子：`grep -q "^USE_NTP=yes" /etc/ntp.conf` 已存在则跳过，否则追加一行。

**`grep -c` 无匹配时退出码是 1 不是 0**——统计脚本里"允许无匹配"时记得 `|| true` 或 `count=$(grep ... || true)`。在 `set -o pipefail` 下，管道中间的 `grep` 返回 1 会让整条管道非零，从而触发 `set -e` 退出；写进严格模式脚本前先想清楚"无匹配是不是错误"。

### 1.2 脚本常用组合

递归搜索排除版本控制目录：`grep -rn --exclude-dir={.git,node_modules} "TODO" src/`。只提取匹配部分再统计：`grep -oE 'IP 正则' access.log | sort | uniq -c | sort -rn | head`。单纯计数优先 `grep -c`，比手写 `while read` 快一个数量级——但一旦需要按行做复杂分支（多条件、累计、跳过注释），就改用循环，见 [循环结构](./loops.md)。

```bash
$ printf 'GET /a 200\nPOST /b 500\nGET /c 404\n' > access.log
$ grep ' 5[0-9][0-9]$' access.log | sed -E 's| /[^ ]+ | |' | awk '{print $1, "=>", $NF}'
POST => 500
```

组合语义：`grep` 先筛出 5xx 行，`sed` 抽掉路径只留方法与状态，`awk` 再按字段排版——每一步只做一件事，正是三件套的分工。

## 2. sed：流编辑器

sed 逐行读入模式空间，对匹配的行执行脚本命令，然后输出——它是**非交互式**的行编辑器，适合"批量、可重复、可写进脚本"的替换。核心是 `s/old/new/g`：不带 `g` 每行只替换第一处，`-i` 原地修改，`-n` 抑制默认输出配合 `p` 只打印被替换的行，`-i.bak` 原地修改并留备份（**强烈推荐**——`sed -i` 直接重写原文件，正则写错如 `s/.*//` 内容瞬间清空且无 undo）。

分隔符可以换：路径斜杠太多时用 `s|/usr/local|/opt|g` 或 `s#^http://#https://#` 更清晰。地址限定让替换只作用于部分行：行号 `5`、范围 `5,10`、到末尾 `5,$`、正则 `/^DEBUG/`、GNU 扩展 `/error/,+3`（匹配行及后 3 行）。删除用 `d`（`/^#/d` 删注释行、`/^$/d` 删空行），插入/追加用 `i\` 与 `a\`——GNU sed 与 BSD sed（macOS）语法不同，**本教程三发行版均为 GNU sed**。

实用片段：提取 `key=value` 的 value 用 `-n 's/^name=//p'`；去行首行尾空白用 `s/^[[:space:]]*//;s/[[:space:]]*$//`；配合管道只改内存中的流、不碰原文件（重定向到新文件再 `mv`）是更安全的原地编辑模式。替换串里 `&` 表示整个匹配，`\1`–`\9` 表示分组——与 `grep` 只匹配不替换的语义不同。

## 3. awk：字段与统计

awk 是"模式-动作"语言：对每一行匹配模式则执行动作，内建字段拆分（默认按空白）、算术与关联数组，天然适合**按列统计**。最常用：`{print $1}` 打印第 1 字段；`-F:` 指定分隔符；`$3 >= 1000` 条件过滤；`/error/` 正则模式；`NR == 5` 第 5 行；`NR>=10 && NR<=20` 行范围；`END {print NR}` 总行数（END 块只跑一次）。

内置变量：`NR` 已处理行数，`NF` 当前行字段数，`FS`/`OFS` 输入/输出分隔符，`FILENAME` 当前文件名，`FNR` 当前文件内行号（多文件时区别于 NR），`RS` 记录分隔符。`BEGIN {FS=":"}` 可在读入前改分隔符。

统计三板斧：**求和** `'{sum += $3} END {printf "sum=%.2f", sum}'`；**去重** `!seen[$0]++`（首次 `seen[$0]` 为 0 假值，`!0` 为真故打印，随后自增；再次遇到 `!1` 为假不打印——一行完成"保留首次出现"）；**频率** 抽字段后 `sort | uniq -c | sort -rn`。格式化输出用 `printf "%-20s %10d\n"`；多文件时 `FNR==1 {print "=== " FILENAME " ==="}` 打分隔头。

```bash
$ printf 'alice 100\nbob 250\ncarol 150\nalice 50\n' > score.txt
$ awk '{sum += $2} END {printf "sum=%.0f avg=%.1f\n", sum, sum/NR}' score.txt
sum=550 avg=137.5
$ awk '!seen[$1]++ {print $1}' score.txt   # 按第 1 字段保留首次出现
alice
bob
carol
```

**awk 默认字段分隔是"任意空白"**，连续空格不会产生空字段；要按单个空格或 CSV 解析需显式 `FS`。含空格的 CSV 别用 `-F,` 硬拆，考虑更严谨的解析。中英文混排时优先 `[[:space:]]` 比 `[ \t]` 可移植。

## 4. 其他工具与选型

命令篇有完整章节，这里只列脚本最高频的一行式：`cut -d: -f1,3` 按固定分隔符取列（比 awk 更轻）；`sort -k2 -n` 按列数值排序；`sort -u` 排序去重；`sort | uniq -c | sort -rn` 频率统计标准三连；`tr 'a-z' 'A-Z'` 字符级转换（仅映射，不能按列）；`wc -l` 数行。

**选型口诀**：只判断"有没有/哪几行"→ `grep`；按行号或正则**改写**内容 → `sed`；按**字段**过滤、求和、格式化 → `awk`；固定分隔符取几列、不需逻辑 → `cut`；排序去重计数 → `sort`+`uniq`（awk 不擅长排序）。常见组合：TOP 10 IP 是 `awk '{print $1}' | sort | uniq -c | sort -rn | head`；每小时请求量是抽时间字段再 `cut -d: -f2 | sort | uniq -c`；实时盯错误是 `tail -f | grep --line-buffered`（不加 `--line-buffered` 时 grep 会按块缓冲，日志延迟）。

**管道退出码提醒**：`sort | uniq | head` 这类管道，最后一条是 `head` 时，前面 `grep` 无匹配（exit 1）在无 `pipefail` 时会被掩盖；开了 `pipefail` 则整条变非零。写进 `set -euo pipefail` 的脚本前，先想清楚"无匹配是不是错误"，按需 `|| true`。

## 5. 实战：Nginx 日志分析

设计思路：参数校验（`用法` + `[[ -r ]]`）→ 总请求数 `wc -l` → 独立 IP 数抽第 1 字段 `sort -u | wc -l` → TOP IP 与状态码分布各来一串 `sort | uniq -c | sort -rn`。全部是只读管道，无破坏性操作，可直接挂 cron 出日报。真实量级输出形如总请求 12043、独立 IP 876、状态码以 200 为主夹杂 404/502——看到 502 突增就该去查上游了。复杂分支（按状态码分桶告警、按 UA 统计爬虫）再上 `awk` 脚本或本章三件套组合。

```bash
$ cat > nginx-stats.sh <<'EOF'
#!/bin/bash
# 用法: ./nginx-stats.sh access.log
set -euo pipefail
log=${1:?用法: $0 <access.log>}
[[ -r "$log" ]] || { echo "错误: 无法读取 $log" >&2; exit 1; }

echo "总请求数: $(wc -l < "$log")"
echo "独立 IP 数: $(awk '{print $1}' "$log" | sort -u | wc -l)"
echo "TOP 5 IP:"
awk '{print $1}' "$log" | sort | uniq -c | sort -rn | head -5
echo "状态码分布:"
awk '{print $9}' "$log" | sort | uniq -c | sort -rn
EOF
$ chmod +x nginx-stats.sh
$ ./nginx-stats.sh access.log
总请求数: 12043
独立 IP 数: 876
TOP 5 IP:
   1520 203.0.113.7
    984 198.51.100.23
    ...
状态码分布:
   9871 200
   1432 404
    511 502
    ...
```

## 6. 本章常见坑

1. **`grep -c` 无匹配时退出码是 1 不是 0**。`count=$(grep -c X f)` 在 `set -e` 下可能直接退出；写 `|| count=0`。

2. **`sed -i` 不备份就原地改**。正则写错一秒清空文件。用 `sed -i.bak` 或先 `cp`。

3. **`awk` 默认字段分隔是"任意空白"**，连续空格不会产生空字段；要按单个空格或 CSV 解析需显式 `FS`。含空格的 CSV 别用 `-F,` 硬拆。

4. **用 `cat file | grep` 浪费进程**。重定向 `grep pat file` 少 fork 一个 `cat`，脚本与循环里差别可观。

5. **`$9` 及以后在 awk 里没问题，但 shell 里提取字段别用位置参数 `$1`**——日志行不是脚本参数，用 `cut`/`awk`。

6. **在 `set -o pipefail` 下把"无匹配"当错误**。grep/sed 找不到模式返回 1，整条管道变非零；按需 `|| true`。

7. **中英文混排时字符类选错**。`[[:space:]]` 比 `[ \t]` 更可移植；处理 UTF-8 中文请确保 locale 为 UTF-8，否则 `.` 与字符类按字节处理。

8. **与命令篇重复造轮子**。`sort`/`uniq`/`cut`/`wc` 的完整参数表见 [文本处理命令](../commands/text/text_processing.md)；本章只强调组合与退出码。

## 参考资料

- `man grep`、`man sed`、`man awk`、`man cut`、`man sort`、`man uniq`
- GNU Grep 手册 — [gnu.org](https://www.gnu.org/software/grep/manual/)
- GNU Sed 手册 — [gnu.org](https://www.gnu.org/software/sed/manual/)
- GNU Awk 手册 — [gnu.org](https://www.gnu.org/software/gawk/manual/)
- The AWK Programming Language — [awk-lang.org](https://awk-lang.org/)
- 鸟哥的私房菜 - 文本处理器 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0330regularex.php)
- Arch Wiki - Core utilities — [wiki.archlinux.org](https://wiki.archlinux.org/title/Core_utilities)
- 命令篇 - 文本处理命令 — [docs/commands/text/text_processing.md](../commands/text/text_processing.md)
