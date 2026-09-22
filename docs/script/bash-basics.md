# Bash 基础

Shell 脚本是包含一系列命令的文本文件，由 Shell 解释执行。它不是编译型语言，没有"编译-链接"过程——你写下的每一行都会在运行时被解释器逐条读取、解析、执行。这个模型决定了 Bash 脚本的两个核心特征：**错误往往在运行时才暴露**（所以需要 shellcheck 提前拦截），以及**引号与特殊字符的处理规则直接决定脚本成败**（这是本章的重点）。本章从"为什么要有 shebang"讲起，带你掌握脚本结构、执行方式、引号规则与命令替换。

> 内容参考自 Bash 手册、Arch Wiki 和 Advanced Bash-Scripting Guide，见文末参考资料。

## 学习目标

- 理解 shebang 的作用，会根据目标环境选择 `#!/bin/bash` 还是 `#!/bin/sh`
- 掌握三种执行方式（执行权限 / `bash` / `source`）的差异
- 吃透单引号、双引号、反引号与命令替换的规则
- 理解特殊字符与转义，为后续变量、条件、循环打地基

## 1. 脚本结构与 shebang

### 1.1 为什么第一行是 `#!/bin/bash`

Shebang（也叫 hashbang）是脚本第一行以 `#!` 开头的特殊注释，它告诉内核：**不要用默认 shell 解释这个文件，用后面指定的解释器**。当你执行 `./script.sh` 时，内核读取第一行，把路径和参数拼成 `exec` 调用，等价于手动执行 `/bin/bash script.sh`。

```bash
#!/bin/bash
```

两种常见写法及选择依据：

| 写法 | 含义 | 适用场景 |
|------|------|---------|
| `#!/bin/bash` | 直接指定 bash 的绝对路径 | **绝大多数情况**，三系通用，最稳妥 |
| `#!/usr/bin/env bash` | 通过 `env` 在 `PATH` 中查找 bash | 需要用非标准路径的 bash（如自行编译、多版本共存） |
| `#!/bin/sh` | 交给系统的 `/bin/sh` | **仅当脚本确认只用 POSIX sh 语法**（Debian 上实际是 dash） |

**为什么不要写 `#!/bin/sh` 却用 bash 语法**：Debian/Ubuntu 的 `/bin/sh` 是 dash，它不支持数组、`[[ ]]`、`local`、`$(( ))` 之外的 bash 扩展。一个用了 `[[ ]]` 的脚本在 Arch（`/bin/sh` → bash）上能跑，在 Debian 上会直接报 `[[: not found` 之类的错。除非你明确只写 POSIX 子集，否则第一行永远写 `#!/bin/bash`。

Arch 上 `/bin/sh` 也指向 bash，所以"在 Arch 测过、搬到 Debian 就挂"是跨发行版脚本的头号陷阱。

### 1.2 基本结构

一个结构清晰的脚本通常包含：shebang、注释头、严格模式、主函数、入口调用：

```bash
#!/bin/bash
# 脚本描述: 示例脚本
# 作者: Your Name
# 日期: 2026-09-22
# 用法: ./script.sh <参数>

set -euo pipefail   # 严格模式，详见 [脚本调试](./debugging.md)

main() {
    echo "脚本开始"
    # ... 其他命令 ...
    echo "脚本结束"
}

main "$@"
```

`set -euo pipefail` 被称为严格模式，三个选项各管一件事：`-e` 让任何命令返回非零时立即退出脚本；`-u` 让引用未定义变量直接报错（而不是展开为空字符串）；`-o pipefail` 让管道中任意一段失败时整个管道返回失败（默认只看最后一段）。为什么需要它、有哪些边界情况，会在 [脚本调试](./debugging.md) 专门展开——本章只需记住：**工程脚本第一行有效代码就是它**。

`main "$@"` 把脚本收到的所有参数原样传给 `main` 函数。注意 `$@` 必须加双引号，否则含空格的参数会被拆散——这是 [变量与数据类型](./variables.md) 的重点。

## 2. 执行方式

三种执行方式对应三种不同语义，选错会导致"环境不生效"或"权限不对"：

### 2.1 添加执行权限

```bash
$ chmod +x script.sh
$ ./script.sh
```

内核读取 shebang，用指定解释器执行。这是最常见的运行方式，也是发布脚本的标准方式。若提示 `Permission denied`，先检查 `chmod +x` 是否执行、文件是否在 `PATH` 目录。

### 2.2 使用 Shell 执行

```bash
$ bash script.sh
$ sh script.sh
```

**关键差异**：`bash script.sh` 明确用 bash 解释，**忽略 shebang**；`sh script.sh` 用 `/bin/sh` 解释，同样忽略 shebang（在 Debian 上就是 dash）。调试时用 `bash script.sh` 最省心——即使 shebang 写错也能跑；但如果脚本依赖 shebang 指定的特殊解释器，就要注意。

另外，`bash script.sh` 会**启动一个子 shell**，脚本里的 `cd`、`export`、变量赋值都不会影响当前 shell；而下面的 `source` 会。

### 2.3 Source 执行

```bash
$ source script.sh
$ . script.sh
```

`source`（或等价的 `.`）在**当前 shell 进程**中执行脚本，不启动子 shell。典型用途：

- 加载 `~/.bashrc`、函数库等需要"留下痕迹"的配置
- 让脚本里的 `cd`、`export PATH=...` 对当前会话生效

反过来，如果你的脚本会 `cd` 到某目录处理文件，就不该用 `source` 执行——它会把当前 shell 带跑偏。

三种方式的对照：

| 方式 | 子 shell | 尊重 shebang | 典型用途 |
|------|---------|-------------|---------|
| `./script.sh` | 是 | 是 | 日常运行 |
| `bash script.sh` | 是 | 否 | 调试、强制用 bash |
| `source script.sh` | 否 | 否 | 加载配置/函数库 |

## 3. 引号规则

引号是 Bash 最容易出错也最重要的概念。**是否加引号、加哪种引号，直接决定变量展开、glob 展开、转义是否发生**。

### 3.1 单引号：原样输出

单引号内的内容**不进行任何展开**——变量、命令替换、转义统统失效，原样输出：

```bash
$ USER=alice
$ echo 'Hello $USER'
Hello $USER
$ echo '当前目录: $(pwd)'
当前目录: $(pwd)
```

需要**字面量**（如正则、含 `$` 的文本）时用单引号。

### 3.2 双引号：展开但不拆分

双引号内**会**展开变量和命令替换，但**不会**进行词分割（word splitting）和 glob 展开：

```bash
$ USER=alice
$ echo "Hello $USER"
Hello alice
$ echo "Today is $(date +%Y-%m-%d)"
Today is 2026-09-22
```

**为什么变量几乎总要加双引号**：不加引号时，若变量值含空格或通配符，会被 shell 拆成多个参数或被 glob 展开：

```bash
$ file="my file.txt"
$ echo $file        # 危险：被拆成两个词
my file.txt         # 看似正常，但作为参数传给命令时已变成两个
$ echo "$file"      # 正确：整体作为一个参数
my file.txt

$ files="*.txt"
$ echo $files       # 危险：glob 展开成实际文件列表
a.txt b.txt c.txt
$ echo "$files"     # 正确：输出字面量 *.txt
*.txt
```

**规则**：所有变量引用一律写成 `"$var"`，除非你明确需要词分割（如遍历数组时的 `"$@"` 特殊语义）。

### 3.3 反引号与 `$()`：命令替换

命令替换把命令的输出捕获为字符串。旧式用反引号，新式用 `$()`：

```bash
# 旧式（不推荐）：反引号
$ files=`ls -l`

# 推荐写法：$()
$ files=$(ls -l)

# 嵌套时差异明显——$() 可直接嵌套，反引号需要转义
$ echo "主机: $(uname -n), 内核: $(uname -r)"
主机: ubuntu-lab, 内核: 6.8.0-45-generic
```

**为什么推荐 `$()`**：可读性更好、可嵌套、错误处理更清晰。反引号里的 `$` 和 `\` 还需要额外转义，容易出错。

```bash
# 获取当前日期与文件数（真实输出示例）
$ today=$(date +%Y-%m-%d)
$ file_count=$(ls -1 | wc -l)
$ echo "$today 共 $file_count 个文件"
2026-09-22 共 14 个文件
```

## 4. 特殊字符

Bash 中许多字符有特殊含义，需要时用反斜杠 `\` 或引号转义：

| 字符 | 说明 | 示例 |
|------|------|------|
| `#` | 注释（行首或词首） | `# 这是注释` |
| `$` | 变量引用 / 命令替换 | `$VAR`、`${VAR}`、`$(cmd)` |
| `\` | 转义下一个字符 | `\$`、`\n` |
| `|` | 管道 | `ls \| grep txt` |
| `&` | 后台执行 | `command &` |
| `;` | 命令分隔 | `cmd1; cmd2` |
| `&&` | 逻辑与（前一条成功才执行） | `cmd1 && cmd2` |
| `\|\|` | 逻辑或（前一条失败才执行） | `cmd1 \|\| cmd2` |
| `>` `>>` | 重定向覆盖 / 追加 | `echo hi > f`、`echo hi >> f` |
| `<` | 输入重定向 | `sort < file` |
| `()` | 子 shell | `(cd /tmp && ls)` |
| `{}` | 当前 shell 的代码块 / glob | `{ cmd1; cmd2; }`、`{1..5}` |
| `[]` | test 命令 / glob 字符类 | `[ -f file ]`、`[aeiou]` |
| `~` | 家目录展开 | `~/doc` |
| `!` | 历史展开 / 逻辑非 | `! cmd`、`[ ! -f f ]` |

**`&&` 与 `||` 的退出码陷阱**（详见 [条件判断](./conditionals.md)）：`cmd1 && cmd2 || cmd3` 并**不**等价于"cmd1 成功执行 cmd2，否则 cmd3"——若 cmd2 失败，cmd3 也会执行。要表达"三选一分支"请用 `if`。

## 5. 注释

```bash
# 单行注释

# 多行注释方法一：Here Document（不执行，只占位）
: <<'COMMENT'
这是多行注释
第二行
COMMENT

# 多行注释方法二：连续 # 行（最直观，推荐）
# 这也是多行注释
# 每一行都加 #
```

**为什么用 `: <<'COMMENT'`**：`:` 是 Bash 的空操作内建命令，Here Document 的内容被当作它的标准输入但不执行。单引号 `'COMMENT'` 确保正文不做任何展开。缺点是不如连续 `#` 直观，**新代码推荐直接写连续 `#` 行**，IDE 也更好折叠。

## 6. 本章常见坑

1. **shebang 写 `#!/bin/sh` 却用 bash 语法**。Debian 上 `/bin/sh` 是 dash，`[[ ]]`、数组、`local` 全部失效。除非确认只用 POSIX 子集，否则统一写 `#!/bin/bash`。

2. **变量不加引号**。`rm $file` 在文件名含空格时会变成 `rm my file.txt`（删两个文件）；`echo $files` 里的 `*` 会被 glob 展开。**规则：变量一律 `"$var"`**，遍历数组用 `"${arr[@]}"`、参数用 `"$@"`。

3. **用 `sh script.sh` 测 bash 脚本**。调试时用 `bash script.sh` 或 `./script.sh`（配好 shebang），避免用 `sh` 造成"我这儿能跑"的假象。

4. **`source` 与直接执行混用**。脚本里有 `cd` 或 `export` 时，`source` 会污染当前 shell；反之需要留下环境改动时又误用 `bash script.sh`，改动随子 shell 消失。先想清楚"要不要留下痕迹"。

5. **`&&`/`||` 当 if-else 用**。`a && b || c` 在 b 失败时会错误地执行 c，分支逻辑请用 `if`。

6. **反引号里不转义 `$`**。`` result=`echo $var` `` 中 `$var` 仍会展开，若本意是字面量就用单引号包 `$()`。

## 参考资料

- `man bash` — Shell 语法与引号规则
- Bash 手册 - Quoting — [gnu.org](https://www.gnu.org/software/bash/manual/html_node/Quoting.html)
- Arch Wiki - Bash — [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- 鸟哥的私房菜 - 什么是 shell script — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0430bash.php)
- Advanced Bash-Scripting Guide - Chapter 2 - Starting Out With a Shell Script — [tldp.org](https://tldp.org/LDP/abs/html/startup.html)
- Google Shell Style Guide - Quoting Conventions — [google.github.io](https://google.github.io/styleguide/shellguide.html)
