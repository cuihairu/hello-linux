# 变量与数据类型

Shell 变量是存储数据的容器，无需声明类型——同一个变量既可能装数字也可能装字符串，解释器在用到时才做上下文相关的解释。这个「弱类型」设计让脚本写起来快，但也带来两类高频事故：该加引号没加导致词分割与 glob 展开；该用 `"${arr[@]}"` 却写了 `$arr` 导致数组被压扁成一个字符串。本章从变量定义讲起，覆盖环境变量、特殊变量、数组与算术字符串扩展，并重点拆解 `$@` vs `$*`、`local` 与退出码相关的细节。

> 内容参考自 Bash 手册、Arch Wiki 和 Shell 编程实践，见文末参考资料。

## 学习目标

- 掌握变量定义、引用与只读/删除，理解「等号两边不能有空格」的原因
- 分清本地变量、环境变量与特殊变量（`$@`/`$*`/`$?`/`$$` 等）
- 会用索引数组与关联数组，并知道 `"${arr[@]}"` 与 `$arr` 的区别
- 掌握算术运算与字符串扩展（长度、子串、替换、删除前后缀）
- 理解 `local` 的作用域与不加 `local` 造成的全局污染

## 1. 变量定义

### 1.1 赋值语法：等号两边为什么不能有空格

`name="John"` 是词法赋值，不是「把等号两边的表达式算出来再存」。若写成 `name = "John"`，Bash 会把 `name` 当命令、`=` 与 `John` 当参数，于是报 `name: command not found`——这是新手第一课级别的坑。引用时建议始终写 `"${name}"` 或 `"$name"`：当变量名紧跟其他字符时花括号明确界定边界，`${name}suffix` 若写成 `$namesuffix` 会去找另一个变量。养成习惯：**变量后紧跟字母数字时必加花括号，变量作参数一律双引号**。

```bash
$ name="John"
$ echo "Hello, ${name}!"
Hello, John!
$ greeting="Hi$name again"      # 紧跟字母时必须花括号界定
$ echo "$greeting"
HiJohn again
$ readonly PI=3.14159
$ PI=3                         # 再赋值即报错
bash: PI: readonly variable
$ unset name && echo "${name:-Anonymous}"
Anonymous
```

只读与删除：`readonly PI=3.14159` 或 `declare -r VERSION=1.0` 之后再赋值会得到 `readonly variable` 错误；`unset name` 只删除变量本身（只影响当前 shell），若变量被 `export` 过，子 shell 仍可能从别处继承。

### 1.2 为什么推荐双引号

不加引号时，若变量值含空格或通配符，会被 shell 拆成多个参数或被 glob 展开：`file="my file.txt"` 时 `echo $file` 看似正常，但作为参数传给命令时已变成两个词；`files="*.txt"` 时 `echo $files` 会 glob 成实际文件列表。**规则：所有变量引用一律写成 `"$var"`**，除非明确需要词分割（如遍历数组时的 `"$@"` 特殊语义）。

## 2. 数据类型与数组

### 2.1 字符串操作速览

字符串是 Bash 里最常用的「类型」，操作全靠 `${}` 扩展：`${#str}` 取长度；`${str:0:5}` 从位置 0 取 5 个字符；`${str/World/Linux}` 替换第一处，`${str//o/0}` 全局替换；`${str#Hello }` 删前缀，`${str% World}` 删后缀。记忆技巧：`#` 在变量名前像「从头数」（删前缀），`%` 像「百分号收尾」（删后缀）；`//` 表示全局替换，单个 `/` 只换第一处。单引号内的内容不展开变量（`'Hello $USER'` 原样输出），双引号内才展开——详见 [Bash 基础](./bash-basics.md)。

```bash
$ str="Hello World"
$ echo "${#str}"          # 长度
11
$ echo "${str:0:5}"       # 子串
Hello
$ echo "${str/World/Linux}"   # 替换第一处
Hello Linux
$ echo "${str//o/0}"          # 全局替换
Hell0 W0rld
$ echo "${str#Hello }"        # 删前缀
World
$ echo "${str% World}"        # 删后缀
Hello
```

### 2.2 索引数组：为什么必须写 `"${arr[@]}"`

数组字面量用圆括号：`fruits=("apple" "banana" "cherry")`。取元素 `${fruits[0]}`，取全部 `${fruits[@]}`，取个数 `${#fruits[@]}`，追加 `fruits+=("date")`，删除 `unset fruits[1]`（会留下空洞）。**不加花括号和 `@`，数组会被压缩成第一个元素；不加引号，元素里的空格会被再次拆分**：`files=("a b.txt" "c.txt")` 时 `echo $files` 经词分割后看不出问题但传参已错，`echo "${files[@]}"` 才把每个元素作为独立词输出。循环数组、传给函数一律用 `"${arr[@]}"`。

```bash
$ fruits=("apple" "banana" "cherry")
$ echo "${fruits[0]}"
apple
$ echo "${#fruits[@]}"       # 元素个数
3
$ fruits+=("date")
$ echo "${fruits[@]}"
apple banana cherry date
$ files=("my notes.txt" "c.txt")
$ printf '[%s]\n' $files          # 不加引号: 含空格元素被再次拆分
[my]
[notes.txt]
[c.txt]
$ printf '[%s]\n' "${files[@]}"    # 正确写法: 每个元素一个词
[my notes.txt]
[c.txt]
```

### 2.3 关联数组（Bash 4+）

`declare -A user` 之后可用 `user[name]="John"` 这样的键值赋值；`${user[name]}` 取值，`${!user[@]}` 取全部键，`${user[@]}` 取全部值。关联数组要求 Bash 4.0+：Debian/Ubuntu、Arch、RHEL/CentOS/Rocky 9 的默认 bash 都是 5.x，满足要求；极老的 RHEL 6（bash 4.1）也支持，但若目标环境是 macOS 自带的 bash 3.2 就不可用（本教程聚焦 Linux，一般无虞）。

## 3. 环境变量

常用只读观察的有 `$HOME`、`$USER`、`$SHELL`、`$PATH`（冒号分隔的命令搜索路径）、`$PWD`、`$LANG`。普通赋值只在当前 shell 存在；`export VAR="value"` 之后的变量会放入「环境块」，任何由当前 shell 启动的子进程（脚本、`ssh` 远程命令）都能读到——脚本里调用外部命令需要传参时靠的就是这个机制。要永久生效，把 `export` 行追加进 `~/.bashrc` 再 `source ~/.bashrc`；登录 shell、非登录交互 shell、非交互 shell 读取的配置文件顺序不同，改错了会「看起来没生效」，排查时先 `echo $PATH` 确认当前会话是否已经带上新值。

## 4. 特殊变量与 `$@` vs `$*`

这些变量由 Bash 自动维护：`$0` 脚本名；`$1`–`$9` 第 1–9 个参数，`${10}` 及以后必须加花括号（`$10` 会被解析成 `$1` 后跟字符 `0`）；`$#` 参数个数；`$?` 上一条命令退出状态（**只反映紧邻的上一条**，中间插任何命令都会覆盖它，要么紧跟判断要么立刻 `ret=$?` 存起来）；`$$` 当前 PID；`$!` 最后一个后台进程 PID。

`$@` 与 `$*` 的差别在**加双引号**时才真正显现：`"$@"` 把每个参数当作独立的、完整的词；`"$*"` 把所有参数拼成一个词，用 `IFS` 第一个字符（默认空格）连接。演示脚本对 `"a b"` 与 `"c"` 两个参数输出：`"$@"` 得到两个词 `<a b>` `<c>`，`"$*"` 得到一个词 `<a b c>`。**给函数或命令传参一律用 `"$@"`**；只有在明确要把多个参数拼成一句日志/命令字符串时才用 `"$*"`。位置参数在函数调用期间有效，返回后恢复——详见 [函数](./functions.md)。

## 5. 变量扩展与默认值

`${name:-Anonymous}` 在 name 为空或未定义时用默认值但不写回；`${name:=Anonymous}` 同时把默认值赋给变量；`${unset_var:?Variable not set}` 在未定义时直接报错退出。脚本开头给可选参数兜底常用 `:-`，关键变量缺失要立刻失败用 `:?`——它与 `set -u` 配合是很好的防御。算术优先用纯内建 `$((a + b))`，无需 fork 外部进程、无需转义空格；`let` 可用但赋值不如 `$(( ))` 直观；`expr` 是外部命令且要求空格，仅在需要兼容极老 POSIX shell 时才用。`$(( age >= 18 ? 1 : 0 ))` 只支持数值三元，字符串结果请用 `if`/`else`（见 [条件判断](./conditionals.md)）。

```bash
$ a=15 b=7
$ echo $(( a + b ))         # 22
22
$ echo $(( a * b ))         # 105
105
$ echo $(( a % b ))         # 取模
1
$ echo $(( a > b ? a : b )) # 数值三元
15
$ (( a += 3 )) && echo "$a" # 算术后赋值
18
```

## 6. 类型声明

`declare -i num=10` 声明整数，非数字自动转 0——看似方便，实则 `num="10+5"` 会被当算术表达式求值成 15，容易在拼接日志时出人意料，**除非明确需要，不要给普通变量加 `-i`**，算术一律写在 `$(( ))` 里。`declare -r` 只读，`-a` 索引数组，`-A` 关联数组，`-g` 在函数内创建全局变量，`-p` 打印变量的完整声明（含类型）——调试时 `declare -p var` 比裸 `echo` 更能看出「它到底是什么」。

## 7. 本章常见坑

1. **等号两边加空格**。`a = 1` 不是赋值，是调用命令 `a`。赋值紧贴写：`a=1`。

2. **引用数组只写 `$arr`**。`${arr}` 等于 `${arr[0]}`（第一个元素），遍历全部必须 `"${arr[@]}"`，取个数用 `${#arr[@]}`。

3. **`$@` 不加引号**。`f $@` 会把含空格的参数拆散，正确是 `f "$@"`。同理循环数组用 `for x in "${arr[@]}"`。

4. **函数内忘写 `local`**。不加 `local` 的变量是全局的，同名变量在调用方被意外覆盖——详见 [函数](./functions.md)。

5. **把 `$?` 放到下下条命令再判断**。`$?` 只反映紧邻的上一条命令；中间插任何命令都会覆盖它。要么紧跟判断，要么立刻存进变量：`ret=$?`。

6. **`${10}` 写成 `$10`**。`$10` 被解析成 `$1` 后跟字符 `0`。第 10 个及以后的参数必须加花括号。

7. **在 `[[ ]]` 外用 `=~` 取 BASH_REMATCH**。正则匹配结果存在 `BASH_REMATCH` 数组，但匹配本身要在 `[[ ... =~ ... ]]` 里做，详见 [正则表达式](./regex.md)。

8. **把 `local x=$(cmd)` 当成检查了 `cmd` 的退出码**。`local` 自身成功会覆盖 `cmd` 的 `$?`，分两步赋值。

## 参考资料

- `man bash` — Shell Variables、Arrays、Parameter Expansion
- Bash 手册 - Shell Variables — [gnu.org](https://www.gnu.org/software/bash/manual/html_node/Shell-Variables.html)
- Bash 手册 - Shell Parameters — [gnu.org](https://www.gnu.org/software/bash/manual/html_node/Shell-Parameters.html)
- Arch Wiki - Bash - Variables — [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- 鸟哥的私房菜 - 变量与环境变量 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0320bash.php)
- Advanced Bash-Scripting Guide - Variables — [tldp.org](https://tldp.org/LDP/abs/html/variables.html)
