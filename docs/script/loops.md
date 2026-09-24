# 循环结构

循环用于重复执行代码块，直到满足条件为止——它是"把一条命令对一百个文件执行一百次"与"写一百行重复代码"的分水岭。Bash 提供三种循环：`for`（遍历已知列表）、`while`（条件为真时重复）、`until`（条件为假时重复）。语法本身很简单，真正容易出错的是**循环的边界**：管道会开子 shell 导致变量丢失、`read` 不处理好分隔符会截断含空格的文件名、glob 不加引号会让通配符提前展开。本章按"为什么用 → 怎么用 → 常见坑"展开。

> 内容参考自 Bash 手册、Arch Wiki 和 Advanced Bash-Scripting Guide，见文末参考资料。

## 学习目标

- 掌握 `for`（列表、范围、C 风格、文件 glob）、`while`、`until`
- 会用 `break`/`continue` 控制循环，理解多层 `break N`
- 理解管道子 shell 与重定向对变量作用域的影响
- 掌握 `while read` 正确读取含空格/特殊字符的行与文件名
- 会写批量重命名、日志统计等实用循环

## 1. for 循环

### 1.1 列表遍历与数字范围

最直观的形式是对一组已知的词依次执行：`for fruit in apple banana cherry; do ... done`。列表在循环开始时**一次性展开**——循环体内再修改"列表源"不影响本次迭代。数字范围优先用花括号展开 `{1..5}`、带步长 `{0..10..2}`，或 C 风格 `for ((i=0; i<5; i++))`（变量参与条件时更灵活）。

**为什么优先 `{1..N}` 而非 `$(seq 1 N)`**：`seq` 是外部命令，每次循环都要 fork 一个进程；`{1..N}` 是 shell 的花括号展开，纯内建。循环上万次时差异明显。需要复杂步进或浮点时才用 `seq`。

```bash
$ for fruit in apple banana cherry; do echo "fruit: $fruit"; done
fruit: apple / fruit: banana / fruit: cherry
$ for i in {1..5}; do printf '%s ' "$i"; done; echo    # → 1 2 3 4 5
$ for ((i=0; i<3; i++)); do echo "i=$i"; done          # → i=0 / i=1 / i=2
```

### 1.2 文件 glob 遍历

`for file in *.txt` 里的 `*.txt` 在 `in` 列表位置由 shell 展开；若**没有匹配文件**，默认（未开 `nullglob`）会原样保留 `*.txt` 字面量——于是循环体第一次收到的字符串就是 `*.txt` 本身，`cat *.txt` 可能报"没有那个文件"。稳健写法是 `shopt -s nullglob` 让无匹配时展开为空列表（循环零次），用完再 `shopt -u nullglob`；或先把 glob 赋给数组，检查 `${files[0]}` 是否存在再进循环。

**循环体内引用文件名必须加引号**：`for file in *.txt` 展开时每个文件名已是独立词（含空格的文件名在 glob 展开阶段就是安全的），但循环体里 `mv $file ...` 不加引号会在第二阶段被再次词分割——详见第 5 节。

### 1.3 命令输出与数组遍历

遍历数组的正确写法是 `for item in "${arr[@]}"`（加引号），取下标用 `for i in "${!arr[@]}"`。遍历命令输出时，**不推荐 `for x in $(cmd)`**：命令替换的结果会再经历一次词分割与 glob 展开——文件名里的空格被拆开，`*` 被展开。读"每行一条、字段可能含空格"的数据（文件名、路径、含空格的文本）请用 `while IFS= read -r`，见下节。

## 2. while 与 until

`while (( count < 5 )); do ...; done` 做计数循环时，递增写 `count=$((count + 1))` 而非 `((count++))`——当 `count` 为 0 时 `((count++))` 的算术结果是 0（后缀自增返回旧值），`(( ))` 以此为退出码，`set -e` 会误以为失败并退出脚本。读文件用 `while IFS= read -r line; do ...; done < file.txt`：`IFS=` 清空内部字段分隔符避免行首行尾空白被吞，`-r` 禁止反斜杠转义（否则 `a\nb` 会丢掉反斜杠）——这两个选项是**默认模板**，不写就会在含空格或反斜杠的数据上出错。按 CSV 字段读则 `IFS=,`。

`until` 与 `while` 相反：条件为假时循环，适合"等待文件出现、等端口就绪"这类"直到条件成立"的场景，比 `while ! condition` 更易读，两者可互换。无限循环两种写法：`while true` 或 `while :`（`:` 是空操作内建，永远返回 0）。

```bash
$ count=0
$ while (( count < 3 )); do echo "count=$count"; count=$((count + 1)); done
# count=0 / count=1 / count=2 —— 不用 ((count++)), 见 set -e 陷阱
$ n=3
$ until (( n == 0 )); do echo "还剩 $n"; n=$((n - 1)); done
# 还剩 3 / 还剩 2 / 还剩 1
```

## 3. 循环控制与嵌套

`break` 跳出整个循环，`continue` 跳过本次迭代；`break 2` / `continue 2` 跳出/跳过第 N 层（1=最内层）。嵌套循环典型例子是九九乘法表：外层控制行、内层控制列，用 `printf` 不换行拼一行，外层末尾再 `echo`。循环里调用函数处理每个文件时，函数参数用 `local`，循环外的计数器也要在当前 shell 累加——若把循环放进管道右侧就会丢，见下节。`[[ -e $file ]] || continue` 是跳过不存在文件的常见守卫。

## 4. 关键陷阱：管道子 shell 与变量丢失

**这是循环章节最经典、最高频的坑**：`cat file.txt | while read -r line; do count=$((count+1)); done` 之后 `echo $count` 得到 0。**原因**：管道 `|` 的右侧会开启一个**子 shell**，循环在子 shell 里跑，对 `count` 的修改只存在于子 shell；父 shell 的 `count` 从未改变。进程结束，子 shell 里的变量随之消失。

```bash
$ printf 'a\nb\nc\n' > /tmp/lines.txt
$ count=0
$ cat /tmp/lines.txt | while IFS= read -r line; do count=$((count + 1)); done
$ echo "管道写法: $count"          # → 管道写法: 0（子 shell 变量丢失）
$ count=0
$ while IFS= read -r line; do count=$((count + 1)); done < /tmp/lines.txt
$ echo "重定向写法: $count"        # → 重定向写法: 3
```

三种修复思路，按推荐度排序：

1. **重定向代替管道**（最佳）：`while ...; done < file.txt`——循环留在当前 shell，计数器正常累加。
2. **进程替换**：`while ...; done < <(cat file.txt)`——循环仍在当前 shell，适合数据来自命令而非文件。
3. **结果写数组/文件**：循环只往数组 `results+=("$line")` 或临时文件里追加，循环结束后再读——适合既要计数又要保留明细的场景。

`done < file.txt` 只接受文件，`done < <(cmd)` 接受任意产生标准输出的命令。日常读文件用前者即可。**同理**：`cmd | while ...` 一律会开子 shell；只要循环体要**改当前 shell 的变量**（计数器、累加器、标记），就绝不能用管道喂给 `while`。

## 5. 关键陷阱：read、空格文件名与 glob 引号

### 5.1 read 的正确姿势

错误示范是 `while read line`（无 `IFS=`、无 `-r`）：会丢反斜杠、吞首尾空格、遇 `\` 续行。正确模板固定写 `while IFS= read -r line; do ...; done < file.txt`。若担心末行无换行符被 `read` 吞掉（返回非零但 `line` 可能仍有数据），用 `while IFS= read -r line || [[ -n $line ]]; do ...; done` 兜底。

```bash
$ printf '  my notes.txt  \npath/with\\space.txt\n' > /tmp/names.txt
$ while IFS= read -r file; do echo "读到: [$file]"; done < /tmp/names.txt
读到: [  my notes.txt  ]          # 首尾空格保留
读到: [path/with\space.txt]       # 反斜杠保留
$ while read file; do echo "读到: [$file]"; done < /tmp/names.txt   # 错误示范
读到: [my notes.txt]              # 空格被吞
读到: [path/withspace.txt]        # 反斜杠被当转义吃掉
```

### 5.2 处理含空格的文件名

`for file in $(ls)` 会按空格拆分文件名——危险。正确做法是直接 glob `for file in *`（单词已安全），或用 `while IFS= read -r file` 读"一行一个文件名"的列表（Here Document 或进程替换）。处理任意路径列表时同样用 read，避免词分割。

### 5.3 glob 不加引号的两阶段展开

Shell 处理命令行分两个阶段：**扩展阶段**（变量、命令替换、glob）和**词分割阶段**。`file="my file.txt"` 时 `cat $file` 扩展得完整字符串，词分割成 `my` 和 `file.txt` 两个参数；`cat "$file"` 整体一个参数。`target="*.txt"` 时 `echo $target` 会 glob 展开成实际文件列表，`echo "$target"` 输出字面量 `*.txt`。**规则总结**：变量、`$@`、`"${arr[@]}"`、命令替换在作为参数时一律加双引号；glob 模式（`*`、`?`）在**期望展开**的位置（如 `for ... in *.txt`、`rm *.log`）**不要**加引号，否则会当成字面量。

## 6. 实战案例设计思路

**批量重命名（安全版）**：`nullglob` 防无匹配时循环一次字面量；`mv -n` 防覆盖（或先 `[[ -e $new_name ]]` 跳过）；`--` 终止选项解析（防文件名以 `-` 开头被当成选项）；计数用 `count=$((count + 1))`。先 `DRY_RUN=1` 打印将执行的 `mv` 而不动文件，确认后再实跑——破坏性操作的金标准。真实输出会看到 `重命名: my notes.txt → my notes.md` 这类含空格文件名被正确处理的行。

**统计日志错误数**：用 `while IFS= read -r line` 逐行读，`[[ $line == *ERROR* ]]` 计数；注意 `((errors++))` 在 errors 为 0 时退出码为 1，`set -e` 下需要 `|| true` 兜底（或改用 `errors=$((errors+1))`）。逐行 read 比 `grep -c` 慢，但一旦需要按行做复杂分支就只能这样写；单纯计数直接用 `grep -c` 更快。

**定时监控**：`while true; do ...; sleep 5; done` 演示结构即可，但生产监控建议直接用 `mpstat`、`sar` 或 `node_exporter`——自己算 `/proc/stat` 差分容易错，且长驻脚本不如 cron/systemd timer 易管理。

## 7. 本章常见坑

1. **管道喂 `while` 导致计数器归零**。`cmd | while read` 在子 shell 执行，变量回不来。改用 `while read ... done < file` 或进程替换 `done < <(cmd)`。

2. **`for x in $(cmd)` 拆碎含空格的数据**。文件名、路径一律 `while IFS= read -r` 或用数组 glob。

3. **`read` 不写 `IFS= -r`**。丢反斜杠、吞首尾空白；模板固定写 `while IFS= read -r line`。

4. **glob 无匹配时循环一次字面量**。`*.txt` 无匹配会原样进入循环，`mv *.txt ...` 可能报错。用 `shopt -s nullglob` 或先判存在。

5. **循环体内 `mv $file`/`rm $target` 不加引号**。文件名含空格会被拆成两个参数，可能误删。一律 `"$file"`，并在选项后加 `--`。

6. **`set -e` 下 `((var++))` 当 var 为 0 时脚本退出**。后缀 `++` 返回旧值 0 被当成失败。改 `var=$((var+1))`、`((++var))`，或行尾 `|| true`。

7. **`{1..N}` 与 `$(seq)` 混淆性能**。大范围循环用 `{1..N}` 或 `((;;))`，避免无谓的外部进程。

8. **末行无换行符被 `read` 吞掉**。用 `while IFS= read -r line || [[ -n $line ]]` 兜底。

## 参考资料

- `man bash` — Looping Constructs、Compound Commands
- Bash 手册 - Looping Constructs — [gnu.org](https://www.gnu.org/software/bash/manual/html_node/Looping-Constructs.html)
- Bash 手册 - pipelines（子 shell 语义） — [gnu.org](https://www.gnu.org/software/bash/manual/html_node/Pipelines.html)
- Arch Wiki - Bash - Loops — [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- 鸟哥的私房菜 - 循环 script — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0320bash.php)
- Advanced Bash-Scripting Guide - Loops — [tldp.org](https://tldp.org/LDP/abs/html/loops1.html)
- Google Shell Style Guide - 读取文件 — [google.github.io](https://google.github.io/styleguide/shellguide.html)
