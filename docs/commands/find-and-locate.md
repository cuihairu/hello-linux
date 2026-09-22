# 查找与定位

Linux 的文件系统动辄几十万个文件——
一台装满软件包的服务器，
`/usr` 下轻松超过 10 万个 inode。
靠 `ls` 一层层翻找文件、
靠眼睛在日志里找错误行，
既慢又不可靠。
查找与定位工具解决的就是两个问题：
**"东西在哪"**（按文件名、
类型、
大小、
时间、
权限等条件定位文件）和**"内容是什么"**（在文件内部搜索、
抽取、
替换文本）。
这两类能力组合起来，
就是日常运维 80% 的动作——
找大文件、
找最近改过的配置、
找某个命令属于哪个包、
统计日志里的错误次数。

> 内容参考自 find、locate、grep 手册和实际运维经验，见文末参考资料。
> 文中标注"真实输出"的终端结果均来自实际执行（演示目录 `/tmp/findemo`），你可以在自己的机器上原样复现。

## 为什么先分清"三把不同的刀"

新手最常见的困惑是：
`find`、
`locate`、
`grep` 都能"查找"，
到底用哪个？
答案取决于你要找的是**文件本身**还是**文件里的字**，
以及你是否愿意等待。

`find` 是**实时扫描**。
它按目录树逐个检查，
条件最丰富（名称、
类型、
大小、
时间、
权限、
属主，
还能对结果直接执行命令），
缺点是全盘扫描在大磁盘上可能要跑几十秒。
它是"精确但慢"的代表。

`locate` 是**查数据库**。
它不看文件系统，
只查询 `updatedb` 定期生成的文件名索引，
所以几乎秒出结果；
代价是**结果可能过期**——
刚刚 `touch` 的文件、
或数据库更新间隔之间变动的文件，
它可能查不到。
它是"快但可能旧"的代表。

`grep` 是**进入文件内部**。
它按正则匹配**文件内容**，
配合 `-r` 可以递归整个目录。
`find` 找的是"名字里有 error 的文件"，
`grep` 找的是"内容里有 error 的行"，
两者不可互相替代。

判断口诀：
**找文件名用 `find`/`locate`，
找文件里的字用 `grep`；
文件名规律简单且要最新结果用 `find`，
文件名随便写写且图快用 `locate`。
** 除此之外，
现代发行版还提供了 `fd`（`find` 的人性化替代）和 `ripgrep`（`grep` 的加速替代），
本章最后会给出对照与三系安装方式。

从工程角度看，
这套工具链也体现了 Unix 的组合哲学：
`find` 负责产出文件列表，
`grep`/`awk`/`sed` 负责加工文本，
`xargs`/`-exec` 负责把列表交给下一个命令执行。
你写的每一条复杂管道，
几乎都是这几块积木的拼接。

## 学习目标

- **掌握 find 的条件表达式**：
  按名称（`-name`/`-iname`）、
  类型（`-type`）、
  大小（`-size`）、
  时间（`-mtime`/`-mmin`）、
  权限（`-perm`）、
  属主（`-user`）组合筛选，
  并能用 `-exec`、
  `-ok`、
  `-delete` 对结果执行动作；
  理解 AND/OR/NOT 的结合与括号转义。
- **会用 locate 快速定位**：
  知道它的数据库机制、
  更新方法（`updatedb`）与配置（`PRUNEPATHS`/`PRUNEFS`），
  明确"快但可能过期"的边界。
- **精通 grep 内容搜索**：
  `-i`、
  `-n`、
  `-r`、
  `-v`、
  `-c`、
  `-o`、
  `-A/-B/-C`、
  `--include`/`--exclude-dir`，
  以及 BRE/ERE（`-E`）/PCRE（`-P`）三种正则的选用时机。
- **用 awk/sed 做结构化处理**：
  `awk` 按字段取列与统计（`$1`、
  `-F`、
  `NR`/`NF`），
  `sed` 按行地址替换与删除（`s///g`、
  `-i`、
  `-n 'xp'`）。
- **会用 which/whereis 回答"命令从哪来"**：区分 shell 内建、别名与磁盘上的可执行文件。
- **三系环境不卡壳**：
  知道 `find`/`grep` 三系预装，
  而 `locate`、
  `fd`、
  `ripgrep` 需要用 `apt`/`pacman`/`dnf` 按发行版安装对应软件包。

## 1. find 命令

### 1.1 基本语法与执行模型

`find` 的通用写法是 `find [路径] [选项] [表达式]`。
比语法更重要的是它的**执行模型**：
从指定路径出发，
**深度优先遍历**目录树，
对每个文件依次求值"测试表达式"，
为真的结果被输出（默认打印路径）。
测试之间可以隐式 AND（写在一起即"同时满足"）、
显式 OR（`-o`）、
取反（`!` 或 `-not`）。
先理解这个模型，
后面所有复杂表达式都能自己推出来，
而不用死记。

默认输出就是路径本身。下面是在演示目录上的真实输出，四个普通文件被逐一列出：

```bash
$ find /tmp/findemo -type f
/tmp/findemo/t.csv
/tmp/findemo/a.tmp
/tmp/findemo/notes.txt
/tmp/findemo/logs/app.log
```

GNU find 扩展的 `-printf` 可以自定义输出格式，
比如边找边看文件大小，
再交给 `sort` 排序——
找"吃磁盘的元凶"时这比直接 `-ls` 直观得多：

```bash
$ find /tmp/findemo -type f -printf '%s\t%p\n' | sort -n
2	/tmp/findemo/a.tmp
12	/tmp/findemo/t.csv
20	/tmp/findemo/notes.txt
51	/tmp/findemo/logs/app.log
```

### 1.2 按名称与类型查找

名称匹配用 shell 通配符语法，
但匹配工作是 `find` 自己完成的，
**模式必须加引号**，
否则会被当前 shell 提前展开。
`-iname` 忽略大小写，
适合找 README/Readme/readme 混写的情况；
`-name` 只匹配路径的最后一段（basename），
想匹配整条路径用 `-path`，
例如 `find / -path "*/.git/config"`。

类型测试用 `-type` 加一个字母：
`f` 普通文件、
`d` 目录、
`l` 符号链接、
`b` 块设备（如 `/dev/sda`）、
`c` 字符设备（如 `/dev/tty`）。
其中 `-type l` 配合 GNU 的 `-xtype l` 还能专门找**悬空软链**（目标已不存在的链接），
修复网站目录时很实用。

```bash
find /path -name "filename"
find /path -iname "filename"
find /path -name "*.txt"
find /path -type d -name "dirname"
```

### 1.3 按大小与时间查找

大小单位 `k`/`M`/`G` 对应 1024 进制（GNU find），
`+`/`-` 表示"大于/小于"，
不写表示"恰好"（实际上因块对齐，
很少精确命中）。
注意 `-size` 统计的是**占用块数**换算值，
稀疏文件（sparse file）的逻辑大小和表观大小可能差很多；
`-empty` 则匹配空文件**或**空目录。

时间类测试基于三个时间戳：
**atime**（最后访问）、
**mtime**（最后内容修改）、
**ctime**（最后状态变更——
改权限、
改属主也会动 ctime）。
单位是"24 小时的整倍数"：
`-mtime -7` 表示最近 7 天内修改过，
`-mtime +30` 表示至少 31 天前修改过。
这个"+/-"语义最容易记反，
动手前先用一个明确日期的小目录验证。
按分钟精度的 `-mmin`/`-amin`/`-cmin` 在"刚才那五分钟谁改了配置"这类取证场景里远比按天好用。

```bash
find /path -size +100M
find /path -empty
find /path -mtime -7
find /path -mtime +30
find /path -cmin -10
```

### 1.4 按权限与属主查找

权限测试的三种模式语义完全不同，
写安全巡检脚本时用错会直接导致漏报：
`-perm 755` 要求权限**精确等于** 755（750 就不匹配）；
`-perm -4000` 中的 `-` 表示"列出的位**全部**置位"，
找 SUID 文件必须这样写；
GNU 还引入 `/` 表示"**任一位**匹配"。
属主方面，
`-user` 按用户名查，
`-uid` 按数字 ID 查（批量迁移后用户名可能对不上，
数字更可靠）；
`-nouser` 找属主已不在 `/etc/passwd` 里的孤儿文件，
是删账号后的标准收尾动作。

```bash
find /path -perm 755
find /path -perm -4000
find /path -user username
find /path -nouser
find /path -uid 1000
```

### 1.5 对结果执行动作

`find` 找到文件后通常还要"做点什么"，
有三种机制。
`{}` 是"当前文件"的占位符，
`\;` 是被转义的分号（告诉 shell 这是 find 的参数）。
`-delete` 是内置删除，
最高效；
`-exec ... \;` 每个文件调用一次命令；
`-exec ... +` 会尽量把多文件合并成一次调用，
比 `\;` 快一个数量级；
`-ok` 是 `-exec` 的交互版，
执行前逐个询问，
危险操作必用。
`-print0` 配合 `xargs -0` 用 NUL 分隔文件名，
是处理**含空格、
换行、
引号的文件名**的唯一稳妥方式。

```bash
find /path -name "*.tmp" -delete
find /path -name "*.txt" -exec ls -l {} \;
find /path -name "*.txt" -exec ls -l {} +
find /path -name "*.tmp" -ok rm {} \;
find /path -name "*.txt" -print0 | xargs -0 ls -l
```

真实验证——
对含空格的路径 `my dir/file.txt`，
`-print0 | xargs -0` 与 `-exec` 都能正确处理，
而普通 `xargs` 会把它拆成两个路径并报错：

```bash
$ find /tmp/findemo -name "*.txt" -print0 | xargs -0 ls -l
-rw-rw-r-- 1 cui cui  0 Sep 22 05:32 /tmp/findemo/my dir/file.txt
-rw-rw-r-- 1 cui cui 20 Sep 22 05:32 /tmp/findemo/notes.txt
```

### 1.6 组合条件与括号转义

隐式 AND 直接把测试写在一起即可；
OR 用 `-o`，
取反用 `!`（或 `-not`）。
**只要有 `-o`，
就必须用 `\(...\)` 把 OR 两侧整体括起来**——
括号要反斜杠转义给 shell。
限制深度的 `-maxdepth` 在 `/` 下搜索时能极大提速，
例如 `find /usr -maxdepth 3 -name "openssl"`。

下面两条命令在演示目录上的结果不同：
第一条多了目录 `dir.log`。
原因是未加括号时表达式被解析为 `(-type f AND -name "*.tmp") OR (-name "*.log")`——
OR 右侧**不再受 `-type f` 约束**，
于是目录也混了进来。
这是 find 第一大坑，
写完务必用小目录验证语义。

```bash
$ find /tmp/findemo -type f -name "*.tmp" -o -name "*.log"
/tmp/findemo/dir.log
/tmp/findemo/a.tmp
/tmp/findemo/logs/app.log

$ find /tmp/findemo -type f \( -name "*.tmp" -o -name "*.log" \)
/tmp/findemo/a.tmp
/tmp/findemo/logs/app.log
```

更多组合写法：
`find /path -name "*.txt" -size +1M` 是隐式 AND；
`find /path ! -name "*.txt"` 是取反；
`find /path -type f \( -name "*.txt" -o -name "*.log" \) -size +1M` 是"txt 或 log 且大于 1M"——
注意 AND 优先级高于 OR，
混合时多加括号总没错。

## 2. locate 命令

### 2.1 为什么 locate 这么快，以及它的边界

`locate` 不访问文件系统，
只在 `updatedb` 生成的**文件名数据库**里做字符串检索。
数据库通常每天由 `cron`/`systemd timer` 更新一次，
所以它的速度可以做到"全盘文件名查询毫秒级返回"，
代价是三条：
**刚创建的文件查不到**（数据库还没更新）；
**刚删除的文件可能还在结果里**；
数据库默认**跳过**若干目录（`/tmp`、
`/proc`、
网络挂载等，
见 2.3），
这些位置的内容定位不了。

因此定位策略是：
**先 `locate` 秒出候选，
再用 `find`/`ls -l` 确认实时状态**；
或者反过来，
当你明确知道文件刚变化过，
直接用 `find`，
不要相信 `locate`。

### 2.2 基本用法与更新数据库

`locate -i` 忽略大小写，
`-n 10` 限制结果数量，
`-c` 只统计匹配数，
`-r` 接正则（务必加引号）。
刷新数据库用 `sudo updatedb`（可加 `-U /path` 只索引指定目录）。
注意：
很多精简安装的系统上 `locate` **默认并未安装**，
真实环境里的执行结果可能是 `bash: locate: command not found`——
此时按第 8 节三系对照安装提供 `locate` 的软件包即可。

```bash
locate filename
locate -i filename
locate -n 10 filename
sudo updatedb
sudo updatedb -U /path
```

### 2.3 配置文件

`/etc/updatedb.conf`（mlocate）控制索引行为：
`PRUNEPATHS` 是要跳过的目录列表（如 `/tmp /var/spool /media /mnt`），
`PRUNEFS` 是要跳过的文件系统类型（如 `nfs nfs4 cifs proc sysfs`），
`PRUNE_BIND_MOUNTS` 控制是否跳过绑定挂载。
把目录放进 `PRUNEPATHS` 后 `locate` 就永远查不到它——
排查"明明有文件却 locate 不到"时，
先看这个文件，
再看数据库时间戳（`ls -l /var/lib/mlocate/` 或 `/var/lib/plocate/`）确认 `updatedb` 是否真的跑过。

## 3. grep 命令

### 3.1 基本用法与真实输出

`grep` 的全称是 *global regular expression print*：
按正则在输入流中筛选行并打印。
常用选项可以概括为六组：
`-i` 忽略大小写、
`-n` 带行号、
`-r` 递归目录（`-R` 会跟随目录软链，
仓库搜索用 `-r` 更安全）、
`-v` 反向匹配排除、
`-c` 只输出匹配行数、
`-w` 全词匹配、
`-o` 只输出匹配片段。

真实输出（日志内容为 `INFO start` / `ERROR disk full` / `WARN slow` / `ERROR timeout`）：

```bash
$ grep -n "ERROR" /tmp/findemo/logs/app.log
2:ERROR disk full
4:ERROR timeout

$ grep -c ERROR /tmp/findemo/logs/app.log
2

$ grep -rn "ERROR" /tmp/findemo
/tmp/findemo/logs/app.log:2:ERROR disk full
/tmp/findemo/logs/app.log:4:ERROR timeout
```

### 3.2 正则表达式：BRE、ERE、PCRE

`grep` 默认使用**基础正则（BRE）**，
其中 `+`、
`?`、
`|`、
`{}` 都是字面量，
要写成 `\+`/`\?` 等才生效；
加 `-E` 切换到**扩展正则（ERE）**，
元字符直接用，
可读性好且有 POSIX 保证，
日常首选；
加 `-P` 使用 **Perl 风格正则（PCRE）**，
支持 `\d`、
`\w`、
`\s`、
环视（lookaround）等高级特性，
但依赖 grep 编译时链接的 PCRE，
个别嵌入式/精简环境可能不可用，
脚本依赖它之前先在目标机验证。

```bash
grep "^start" file
grep "end$" file
grep -E "pattern1|pattern2" file
grep -E "go+" file
grep -P "\d{3}" file
```

### 3.3 上下文与排除：让结果可读

排障时单行匹配往往不够，
`-A 3`/`-B 3`/`-C 3` 分别取匹配行的后 3 行、
前 3 行、
前后各 3 行（A=after，
B=before，
C=context）——
看一段错误前后的日志上下文，
比只看那一行有用得多。
`-l` 只列出含匹配的文件名，
`-L` 反之。
在代码仓库里不加 `--exclude-dir` 搜索，
`node_modules` 和 `.git` 会把结果刷成瀑布；
在日志目录不加 `--include`，
则会扫进大量无关二进制文件并打出 `Binary file matches` 告警。

```bash
grep -C 3 "pattern" file
grep -o "pattern" file
grep -rn --exclude-dir={.git,node_modules,.svn} "pattern" /path
grep -rn --include="*.conf" "pattern" /etc
```

## 4. awk 命令

`awk` 是"按列处理文本"的瑞士军刀：
默认以空白切分字段（连续空白算一个分隔符），
`$1`、
`$2`…
 引用列，
`$0` 是整行，
`$NF` 是最后一列。
`-F:` 指定自定义分隔符，
是处理 `/etc/passwd`、
`/etc/group`、
sshd 配置这类冒号/等号分隔文件的标配——
分隔符选错是最常见的列错位原因。
内置变量里 `NR` 是当前行号、
`NF` 是字段数、
`FS`/`OFS` 是输入/输出分隔符；
`BEGIN`/`END` 块分别在处理输入**之前**和**之后**各执行一次，
是做统计汇总的标准位置。

真实输出——从 passwd 取首列、从 CSV 取第二列：

```bash
$ awk -F: '{print $1}' /etc/passwd | head -5
root
daemon
bin
sys
sync

$ awk -F, '{print $2}' /tmp/findemo/t.csv
b
2
```

模式匹配与范围匹配让 awk 不必写显式 `if`：
`/pattern/` 只处理匹配行，
`!/pattern/` 反之，
`/start/,/end/` 处理从 start 到 end 的范围；
`$3 > 100` 是数值条件过滤。
统计示例——
`sum+=$NF` 累加最后一列，
`END` 里打印总和与行数：

```bash
awk '{print $1, $3}' file
awk -F: '{print $1, $NF}' file
awk 'BEGIN{FS=":"} {print $7}' /etc/passwd
awk '/start/,/end/' file
awk '$3 > 100' file
awk '{print NF}' file
awk '{sum+=$NF} END{print "total:", sum, "lines:", NR}' file
```

注意：
`FS` 若设为单个空白字符，
awk 自动合并连续空白；
设为其它字符（如 `:`、
`,`）则连续出现的分隔符会产生空字段，
列号随之偏移。
列对不齐时首先检查分隔符。

## 5. sed 命令

`sed` 是"流编辑器"：
逐行读入、
按脚本编辑、
默认输出到屏幕（**不改原文件**）。
核心是替换命令 `s/old/new/flags`，
`g` 标志表示行内全局替换（不加则每行只替换第一次出现）。
加 `-i` 才就地修改，
`-i.bak` 则在修改前自动留一份 `file.bak` 备份——
**先预览、
后 `-i`** 是铁律：
去掉 `-i` 跑一遍看输出，
确认无误再加；
重要配置直接用 `-i.bak`。

地址范围让替换只作用于局部：
数字行号（`3`、
`3,5`）、
模式行（`/pattern/`）、
两者组合（`/start/,/end/`）。
配合 `-n` 关闭默认输出，
再用 `p` 打印，
就变成"只打印第 N 行/匹配行"（等价 grep）。
另外 `i\` 在指定行前插入、
`a\` 在其后追加、
`c\` 整行替换——
改配置文件时比开编辑器还快。

```bash
sed 's/old/new/g' file
sed -i 's/old/new/g' file
sed -i.bak 's/old/new/g' file
sed '/pattern/d' file
sed '/start/,/end/s/old/new/' file
sed -n '3p' file
sed -n '/pattern/p' file
sed '3a\新增的行' file
```

真实取行示例——
只打印日志第 3 行：
`sed -n '3p' app.log`。
sed 的正则与 grep 的 BRE 一脉相承；
替换串中的 `&` 表示"整个匹配内容"，
反斜杠转义的分组 `\1`…
`\9` 可以引用，
做"两段互换"这类操作时不可替代。

## 6. which、whereis 与 type

当你想知道"敲下的命令到底从哪来"，
有三个层次的工具，
语义各不相同。
**`type` 是 shell 内建，
最诚实**——
它会告诉你 `ls` 其实是别名；
`which` 只搜 PATH，
对别名/函数无能为力；
`whereis` 还会去标准源码树和 man 目录找，
适合回答"系统里有没有装它的源码/手册"。
排查 `command not found` 的推荐顺序：
`type -a 命令名` → `echo $PATH` → `ls -l 期望路径`。

真实输出，可见 `ls` 同时存在别名定义和两个磁盘路径：

```bash
$ type -a ls
ls is aliased to `ls --color=auto'
ls is /usr/bin/ls
ls is /bin/ls
```

其余常用写法：
`which python` 找 PATH 中第一个匹配，
`which -a python` 列出全部匹配；
`whereis python` 一并给出二进制、
源码、
手册位置，
`-b`/`-s`/`-m` 可分别只要其中一类；
`type ls` 则直接回答"这个 `ls` 到底是别名还是磁盘上的文件"。

## 7. 现代替代品：fd 与 ripgrep

`find` 和 `grep` 功能完备但语法古老（括号转义、
`\;`、
默认 BRE 都是历史包袱）。
两个现代替代品在**交互使用**中明显更顺手：
`fd` 默认递归、
默认尊重 `.gitignore`、
正则语法更直观（`fd -e conf nginx /etc` 按扩展名加内容筛选）；
`ripgrep`（命令 `rg`）默认递归、
默认跳过二进制和被忽略文件，
速度比 `grep -r` 快一个数量级，
`rg --files -g '*.log'` 还能替代"按名列举"。

选择建议：
**交互式探索用 `fd`/`rg`，
写进脚本/审计流程用 `find`/`grep`**——
后者是三系默认必装的 POSIX/GNU 基础设施，
脚本依赖它们不需要额外安装步骤；
前者则要先确认目标机器装了对应软件包（见下节）。
常用写法：
`fd '\.conf$' /etc`、
`fd -e conf nginx /etc`、
`rg "ERROR" /var/log`、
`rg -n -C 2 "timeout" .`、
`rg --files -g '*.log'`。

## 8. 三系对照与工具安装

`find`（findutils）、
`grep`、
`awk`（gawk/mawk）、
`sed` 在 **Debian/Ubuntu、
Arch、
RHEL/CentOS/Rocky** 上全部预装，
无需任何操作。
会提示 `command not found` 的是下列增强工具：

| 工具 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| `locate`（及 `updatedb`） | `sudo apt install mlocate`（或 `plocate`） | `sudo pacman -S plocate` | `sudo dnf install mlocate` |
| `fd` | `sudo apt install fd-find`（命令名为 `fdfind`） | `sudo pacman -S fd`（命令名 `fd`） | `sudo dnf install fd-find` |
| `ripgrep` | `sudo apt install ripgrep` | `sudo pacman -S ripgrep` | `sudo dnf install ripgrep`（需 EPEL/CRB） |
| `fdupes`（查重文件） | `sudo apt install fdupes` | `sudo pacman -S fdupes` | `sudo dnf install fdupes`（需 EPEL） |
| `trash-cli`（安全删除） | `sudo apt install trash-cli` | `sudo pacman -S trash-cli` | `sudo dnf install trash-cli` |
| GNU findutils 本体 | 预装 | 预装（`findutils`） | 预装 |

要点提醒有三条。
**Arch 用户记住 `pacman -S 包名` 这一列**：
`plocate`、
`fd`、
`ripgrep` 在官方仓库都是一等公民，
装完即用；
AUR 里还有更多查找类工具（如 `fzf` 模糊查找），
但 AUR 需要 `yay`/`paru` 助手，
且构建脚本需自行审阅。
**Debian/Ubuntu 的 `fd` 命令名是 `fdfind`**（避免与历史包名冲突），
写脚本前用 `command -v fd fdfind` 探测，
或在脚本里做兼容别名。
**RHEL/CentOS/Rocky 的部分工具在 EPEL** 中，
先 `sudo dnf install epel-release` 再安装。
另外，
装完 `locate` 要立刻跑一次 `sudo updatedb`，
否则数据库是空的，
查什么都不返回。

验证安装是否成功的最快方式：
`command -v fd fdfind rg locate`，
或 `fd --version; rg --version`。

## 9. 实战案例

### 9.1 查找大文件（磁盘满了怎么查）

磁盘告警时不要一上来就全盘 `find`，
**先按目录聚合锁定嫌疑目录，
再在目录内下钻**，
顺序对了时间成本差一个量级。
`-xdev` 表示不跨文件系统（跳过 NFS/其它挂载点），
能显著提速并避免在备份盘里白扫；
`2>/dev/null` 丢弃无权限访问的报错。
注意 `du` 统计的是磁盘占用，
`find -size` 统计的是文件大小，
稀疏文件和被硬链接多次的文件会让两者不一致。

```bash
du -xh --max-depth=2 / 2>/dev/null | sort -rh | head -20
find /var -xdev -type f -size +100M -exec ls -lh {} \; 2>/dev/null
find /var -xdev -type f -printf '%s\t%p\n' 2>/dev/null | sort -rn | head -10
```

### 9.2 查找最近修改的文件

改了配置服务就异常？
先列出最近动过的文件，
比逐个打开猜要快。
三个常用变体分别对应"最近一天的日志"、
"最近一周的配置"、
"刚才十分钟谁动了这个目录"（按分钟精度取证，
`-ls` 直接带上权限与时间戳）。

```bash
find /var/log -type f -mtime -1
find /etc -type f -name "*.conf" -mtime -7
find /etc/nginx -cmin -10 -ls
```

### 9.3 查找重复文件

查重的正确顺序是**先按大小粗筛，
再对少量候选算哈希**。
`fdupes -r` 一条命令完成全流程（三系均可安装，
见第 8 节）；
没有它时用 `find -printf '%s %p\n' | sort -n` 先找出大小出现多次的文件，
再逐一 `md5sum` 确认内容是否真的相同。
"全量 `find -exec md5sum` 然后 `sort | uniq -d`"的做法在大目录上非常慢（要把所有数据都读一遍），
只适合小范围。

```bash
fdupes -r /path
find /path -type f -size +1M -printf '%s %p\n' | sort -n
find /path -type f -name "*.iso" -exec md5sum {} + | sort | uniq -d -w 32
```

### 9.4 批量重命名

这是少见的**三系命令行为分叉点**：
Debian/Ubuntu 的 `rename` 是 Perl 版（`rename 's/\.txt$/\.md/' *.txt`），
Arch 的 `rename` 来自 util-linux、
语法是简单的 `rename from to files`（`rename .txt .md *.txt`），
两者互不兼容。
跨发行版写脚本时优先用 `find -exec bash` 重写扩展名，
完全可移植：

```bash
rename 's/\.txt$/\.md/' *.txt          # Debian/Ubuntu
rename .txt .md *.txt                  # Arch/util-linux 风格
find /path -name "*.txt" -exec bash -c 'mv "$1" "${1%.txt}.md"' _ {} \;
```

### 9.5 日志分析

日志分析的骨架几乎总是"过滤 → 抽取 → 计数 → 排序"。
`grep -c` 数条数；
`awk` 范围模式按时间段截取；
`grep -rhoE 'ERROR [A-Z_]+' | sort | uniq -c | sort -rn | head` 是现成的"错误类型 Top-N 报表"——
`sort | uniq -c` 就是 shell 里的分组计数，
最后按数值排用 `sort -rn`。
再与 `find -mtime -3 -exec grep -l ... {} +` 组合，
就能只搜最近三天改过的日志，
避开历史归档的干扰。

```bash
grep -rn "ERROR" /var/log/
grep -c "ERROR" /var/log/syslog
awk '/2024-01-01 10:00/,/2024-01-01 11:00/' /var/log/syslog
grep -rhoE 'ERROR [A-Z_]+' /var/log/*.log | sort | uniq -c | sort -rn | head
find /var/log -name "*.log" -mtime -3 -exec grep -l "timeout" {} +
```

## 10. 常见坑

1. **`find` 的模式忘了加引号**。
   `find . -name *.log` 会被当前 shell 的通配符先展开：
   若当前目录恰有 `.log` 文件，
   会变成只找这个名；
   若一个都没有，
   则把字面量传给 find。
   **凡通配符传给命令自己解释的（`find -name`、
   `grep -e`、
   `tar --exclude`），
   一律加单引号。**
2. **`-o` 两侧没有用括号括起来**。
   见 1.6 的真实输出：
   OR 右侧不受前面的 `-type f` 约束，
   目录会混进结果。
   默认养成 `\(... -o ... \)` 的写法，
   并在小目录上验证。
3. **`+` 和 `-` 在时间/大小测试里记反**。
   `-mtime -7` 是"7 天内"，
   `-mtime +30` 是"至少 31 天前"。
   写清理脚本前先 `find 目录 -mtime +30 -ls` 只打印不删除，
   肉眼确认范围正确。
4. **`-perm 755` 与 `-perm -4000` 语义不同却当同一种用**。
   前者要求**精确等于**，
   后者要求位**全部置位**。
   找"SUID 位被置位的文件"必须用 `-perm -4000`，
   写反会漏掉风险文件。
5. **`locate` 查不到刚创建的文件就以为坏了**。
   它是查数据库不是查磁盘，
   先 `sudo updatedb` 再查；
   或改用 `find`。
   反过来，
   已删除文件仍出现在结果里也是同一机制，
   不代表幽灵文件。
6. **`locate` 默认可能根本没装**。
   Debian/Ubuntu/Arch/RHEL 的最小化安装都不带它，
   按第 8 节安装 `mlocate`/`plocate` 后再用，
   装完立刻 `updatedb`。
7. **`grep` 输出 `Binary file xxx matches`**。
   目标文件含 NUL 字节被当成二进制，
   加 `-a` 当作文本处理，
   或加 `-I` 忽略二进制文件；
   源码树里搜索通常用 `-I` 避免噪音。
8. **文件名含空格导致 `xargs`/`for` 循环拆词**。
   改用 `find -print0 | xargs -0 命令`、
   `find -exec 命令 {} +`，
   或 bash 的 `while IFS= read -r f; do ...; done`。
9. **`grep -P` 在个别环境不可用**。
   若报 `grep: -P is not supported`，
   改写为 `grep -E` 或 `perl -ne`；
   写跨发行版脚本前在目标系统上先跑一次。
10. **`sed -i` 无备份、
    `find -delete` 无确认**。
    两者都是不可逆就地操作。
    规则：
    先去掉 `-i`/`-delete` 预览结果 → 确认范围无误 → 加回执行；
    重要数据目录先 `tar` 打包再动手，
    批量删除初期用 `-ok` 逐个确认。
11. **在 `/` 下全盘 `find` 不加 `-xdev`/`2>/dev/null`**。
    会跨进网络挂载疯狂扫描，
    同时向 stderr 狂刷 `Permission denied`。
    标准写法：
    `find / -xdev ... 2>/dev/null`。
12. **硬链接与重复文件误判**。
    `find -samefile 文件` 找的是同一 inode 的硬链接（本来就共享数据），
    不等于"内容重复的两个文件"；
    查重请走 9.3 的大小 + 哈希流程。

## 参考资料

- `man find`, `man locate`, `man updatedb`, `man grep`, `man awk`, `man sed`, `man xargs`, `man type`
- [findutils（GNU find）手册](https://www.gnu.org/software/findutils/manual/)
- [grep 手册](https://www.gnu.org/software/grep/manual/)
- [gawk 手册（GNU awk）](https://www.gnu.org/software/gawk/manual/)
- [sed 手册](https://www.gnu.org/software/sed/manual/)
- [Arch Wiki - Core utilities](https://wiki.archlinux.org/title/Core_utilities)
- [Arch Wiki - Pacman（`pacman -S` 安装 plocate/fd/ripgrep）](https://wiki.archlinux.org/title/Pacman)
- [Debian 手册 - 包管理与 findutils/grep](https://www.debian.org/doc/manuals/debian-handbook/)
- [Red Hat 文档 - Searching files and file contents](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/searching_files_and_file_contents/index)
- [fd 项目页](https://github.com/sharkdp/fd)
- [ripgrep 项目页](https://github.com/BurntSushi/ripgrep)
- [鸟哥的私房菜 - 文件搜寻与挂载](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)
