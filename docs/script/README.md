# 脚本篇

Shell 脚本是 Linux 系统管理与自动化的基础技能。它不是一门"新语言"，而是把你在命令行里已经敲熟的命令，用变量、判断、循环和函数串成可重复执行的程序。本篇从"为什么要写脚本"讲起，带你从第一个 `echo` 走到能落地的备份、日志统计和批量重命名脚本，并覆盖调试工具链与三发行版差异。

> 内容参考自 Bash 手册、Arch Wiki、鸟哥的私房菜和 Advanced Bash-Scripting Guide，见各章节参考资料。

## 学习目标

- 理解为什么要把手工命令沉淀成脚本，掌握学习路线
- 掌握 Bash 脚本基础语法、变量、条件、循环与函数
- 会写并能调试实用的自动化脚本（备份、日志、批量处理）
- 掌握 `set -euo pipefail`、shellcheck 等工程化实践
- 分清 bash 与 sh、`[ ]` 与 `[[ ]]`、`$@` 与 `$*` 等易混点

## 1. 为什么要把命令写成脚本

你在终端里手工敲过的命令，本质上已经是一段"程序"——只是它没有被保存下来，也没法保证下次一字不差地复现。把命令写进脚本解决三个真实痛点：

1. **可重复**。部署一套环境要敲二十条命令，手工敲难免漏一步；写成脚本后每次执行结果一致，也便于交给 cron 定时跑。
2. **可交接**。同事接手时，脚本本身就是文档；口头传授"先 cd 再改配置再重启"极易失真。
3. **可批量**。对一台机器改配置是手工活，对一百台就是脚本活。循环与 `ssh` 让"改一百台"变成一条命令。

一个直观对照：手工操作是"记住了什么就敲什么"，脚本是"想清楚了才写下什么"。前者快，后者稳。日常探索用前者，凡是需要重复执行的动作都应该沉淀成后者。

## 2. 学习路线

脚本篇按依赖顺序组织，建议按顺序阅读，不要跳读：

1. **[Bash 基础](./bash-basics.md)** — shebang 选择、执行方式、引号规则、命令替换。这是地基，引号没搞懂后面全是坑。
2. **[变量与数据类型](./variables.md)** — 变量定义、环境变量、数组、算术与字符串扩展。重点理解 `$@` vs `$*` 和 `local`。
3. **[条件判断](./conditionals.md)** — `if`/`case`、`[ ]` 与 `[[ ]]`、文件与整数测试、`&&`/`||` 退出码陷阱。
4. **[循环结构](./loops.md)** — `for`/`while`/`until`、管道子 shell 变量丢失、`read` 处理含空格文件名、glob 引号。
5. **[函数](./functions.md)** — 函数定义、局部变量、`return` 与 `echo` 混用的坑、函数库。
6. **[文本处理](./text-processing.md)** — `grep`/`sed`/`awk` 实战，与命令篇交叉引用避免重复。
7. **[正则表达式](./regex.md)** — BRE/ERE/PCRE 区别及与 `grep`/`sed`/`awk` 的对应。
8. **[脚本调试](./debugging.md)** — `set -x`、shellcheck 三系安装、bashdb、错误处理与日志。
9. **[实战案例](./examples.md)** — 可真实运行的备份、日志统计、批量重命名脚本，附真实输出。

前五章是语法骨架，第六、七章是数据加工能力，第八章是质量保障，第九章把所有内容收束成能直接跑的成品。

## 3. 每文件一句话导读

| 章节 | 导读 |
|------|------|
| [Bash 基础](./bash-basics.md) | 脚本长什么样、怎么跑、引号和特殊字符怎么用 |
| [变量与数据类型](./variables.md) | 变量、环境变量、数组、算术与字符串扩展 |
| [条件判断](./conditionals.md) | `if`/`case`、文件与整数测试、`[ ]` 与 `[[ ]]` |
| [循环结构](./loops.md) | `for`/`while`/`until`、循环控制、常见循环陷阱 |
| [函数](./functions.md) | 函数定义、参数、返回值、局部变量与函数库 |
| [文本处理](./text-processing.md) | `grep`/`sed`/`awk` 及管道组合实战 |
| [正则表达式](./regex.md) | BRE/ERE/PCRE 区别与各工具对应关系 |
| [脚本调试](./debugging.md) | `set -x`、shellcheck、bashdb、错误处理与日志 |
| [实战案例](./examples.md) | 备份、日志统计、批量重命名等可运行脚本 |

## 4. 三发行版的 bash 环境差异

脚本本身是跨发行版的，但你依赖的解释器和工具链略有差别。写脚本前先搞清楚这些差异，避免"在我机器上能跑"：

| 项目 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|--------------|------|--------------------|
| 默认 `/bin/sh` | dash（非 bash） | bash | bash |
| bash 版本 | 5.x（较新） | 5.x（最新） | 5.1（较保守，随大版本） |
| 安装 bash | 已预装 | 已预装（`pacman -S bash` 可升级） | 已预装（`dnf install bash`） |
| 安装 shellcheck | `apt install shellcheck` | `pacman -S shellcheck` | `dnf install ShellCheck` |
| 安装 bashdb | `apt install bashdb` | `pacman -S bashdb` | `dnf install bashdb` |
| coreutils | GNU coreutils | GNU coreutils | GNU coreutils |

几个关键点：

- **默认 shell 不同**。Debian/Ubuntu 的 `/bin/sh` 指向 `dash`，它不是 bash，不支持数组、`[[ ]]`、`local` 等 bash 扩展。脚本第一行写 `#!/bin/bash` 而非 `#!/bin/sh`，就是为了避免在 Debian 上用 dash 解释 bash 语法而报错。详见 [Bash 基础](./bash-basics.md) 的 shebang 一节。
- **bash 版本**。RHEL 系随大版本固定 bash（如 Rocky 9 是 5.1），Arch 滚动更新到最新（`pacman -S bash`）。写脚本时若用到较新的 bash 特性（如关联数组需 4.0+、`readarray` 需 4.0+），注意 RHEL 老版本可能不支持。
- **coreutils 三系通用**。本篇涉及的 `ls`、`grep`、`sed`、`awk`、`sort`、`uniq`、`cut`、`wc` 等在三系都是 GNU 实现，命令行为一致；本篇不讨论 BSD 差异（那是 macOS/FreeBSD 的问题）。
- **工具需手动装**。shellcheck、bashdb 不是默认必装，三系安装方式见上表与 [脚本调试](./debugging.md)。

## 5. shellcheck 工具链

[ShellCheck](https://www.shellcheck.net/) 是 Shell 脚本的静态分析工具，相当于脚本界的 linter。它能在不执行脚本的情况下发现未加引号的变量、用 `==` 而非 `=`、`$[ ]` 旧式算术等数百类问题。**强烈建议每写完一个脚本就跑一次 shellcheck**，很多"常见坑"它能提前拦下。

三系安装：

```bash
# Debian/Ubuntu
sudo apt install shellcheck

# Arch
sudo pacman -S shellcheck

# RHEL/CentOS/Rocky
sudo dnf install ShellCheck
```

基本用法与输出格式详见 [脚本调试](./debugging.md)。工具链全景：写脚本 → shellcheck 静态检查 → `bash -n` 语法检查 → `set -x` 追踪执行 → 需要时用 bashdb 单步调试。

## 6. 快速入门

第一个脚本，按"为什么 → 怎么做"的思路逐行拆解：

```bash
#!/bin/bash
# 第一个脚本：打印当前时间与用户
# 为什么用 bash 而非 sh：需要可靠支持以下语法
set -euo pipefail   # 严格模式，见"为什么"

echo "Hello, World!"
echo "当前时间: $(date)"
echo "当前用户: $(whoami)"
```

写完后这样跑：

```bash
$ chmod +x hello.sh
$ ./hello.sh
Hello, World!
当前时间: Tue Sep 22 10:30:00 CST 2026
当前用户: alice
```

`set -euo pipefail` 是工程脚本的标配"严格模式"：`-e` 出错即退、`-u` 用未定义变量即报错、`-o pipefail` 让管道中任意一段失败都算整体失败。为什么需要它、有哪些副作用，会在 [Bash 基础](./bash-basics.md) 和 [脚本调试](./debugging.md) 展开。

## 7. 常见坑

入门阶段最容易卡住的几件事，后文各章都会展开，这里先给一张"排雷图"：

1. **shebang 与默认 shell 混淆**。Debian/Ubuntu 的 `/bin/sh` 是 dash，不支持 `[[ ]]`、数组、`local`。脚本一律写 `#!/bin/bash`，调试用 `bash script.sh` 而非 `sh script.sh`。
2. **变量不加引号**。`rm $file` 在文件名含空格时会删错对象；`echo $files` 里的 `*` 会被 glob 提前展开。规则是"变量引用一律双引号，遍历用 `"$@"` 与 `"${arr[@]}"`"。
3. **管道喂 `while` 导致计数器丢失**。`cmd | while read` 的循环体跑在子 shell 里，变量修改回不到当前 shell；应改写为 `while ... done < file` 或进程替换。
4. **把 `return` 当数据返回**。`return` 只能带 0–255 的退出码；函数要返回字符串必须 `echo` 并用 `$( )` 捕获，同时日志走 `stderr`，否则会污染结果。
5. **`[ ]` 与 `[[ ]]`、BRE 与 ERE 混用**。空变量、正则方言选错会得到"看起来跑了但匹配不对"的结果，详见条件判断与正则两章。
6. **不做静态检查就上线**。shellcheck 能拦下大部分引号与反模式问题；三系分别用 `apt install shellcheck`、`pacman -S shellcheck`、`dnf install ShellCheck` 安装。

## 8. 参考资料

- Bash 手册 — [gnu.org](https://www.gnu.org/software/bash/manual/)
- Arch Wiki - Bash — [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- 鸟哥的私房菜 - Shell 脚本 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0430bash.php)
- Advanced Bash-Scripting Guide — [tldp.org](https://tldp.org/LDP/abs/html/)
- ShellCheck — [shellcheck.net](https://www.shellcheck.net/)
- Google Shell Style Guide — [google.github.io](https://google.github.io/styleguide/shellguide.html)
- `man bash`、`man sh`
