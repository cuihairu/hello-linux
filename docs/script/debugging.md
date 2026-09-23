# 脚本调试

调试是脚本开发中不可省略的环节：Shell 是解释执行、弱类型的，很多错误——引号漏了、变量为空、管道子 shell——**不会在「写」的时候暴露，只会在运行到某一行时以诡异的方式炸开**。好的调试习惯不是「出事再查」，而是分层设防：写的时候用 shellcheck 静态扫，跑之前用 `bash -n` 过语法，跑的时候用 `set -x` 看展开，复杂逻辑用 bashdb 单步，上线后靠 `trap` 与日志留下线索。本章按这个顺序展开，并给出三发行版的工具安装方式。

> 内容参考自 Bash 手册、ShellCheck 文档和 Arch Wiki，见文末参考资料。

## 学习目标

- 掌握严格模式 `set -euo pipefail` 的每个选项与副作用
- 会用 `set -x` / `bash -x` 定位执行路径与展开结果
- 三系安装并使用 shellcheck，读懂常见告警
- 会用 `trap` 处理 EXIT/ERR/INT，编写错误处理与日志
- 了解 bashdb 基本断点与单步操作

## 1. 严格模式：set -euo pipefail

工程脚本开头几乎总有一行 `set -euo pipefail`。三个选项各堵一类漏洞：`-e`（errexit）让任何命令返回非零（且未被 `if`/`&&`/`||` 等消费）则立即退出；`-u`（nounset）让引用未定义变量直接报错而非展开为空串；`-o pipefail` 让管道中**任意一段**失败则整个管道退出码为失败（默认只看最后一段）。

`pipefail` 的差异可以用最小例子看清：`false | true` 在无 pipefail 时退出码为 0（只看最后一段 true），有 pipefail 时为 1（中间 false 让整条管道失败）。**为什么需要 `-u`**：未定义变量在默认模式下展开为空，`rm "$dir"/*` 当 `dir` 拼错时可能变成危险路径；`-u` 让拼错的变量名立刻 `unbound variable` 停下。

**副作用与边界**（用之前必须知道）：

1. **`local x=$(false)` 不触发 `-e`**——`local` 自身退出码为 0，吞掉了子命令失败（详见 [函数](./functions.md)）。
2. **`((var++))` 在 var=0 时返回 1**，`set -e` 会让脚本退出；改 `var=$((var+1))` 或 `|| true`。
3. **`grep` 无匹配返回 1** 也会触发 `-e`；允许无匹配时写 `grep ... || true`。
4. 函数作为 `if` 条件调用时，`-e` 在函数体内**暂时失效**（整个函数处于「条件上下文」）——复杂函数里不要依赖 `-e` 逐条兜底。

临时关闭再打开：`set +e` 执行刻意容忍失败的片段，再 `set -e` 恢复。`-e` 是安全网不是逻辑框架，关键分支仍要显式 `if`/`||`。

## 2. 语法与静态检查

### 2.1 bash -n：只解析不执行

`bash -n script.sh` 不执行任何命令，只做解析——适合提交前快速过滤「漏了 `fi`」这类低级错，退出码 0 表示语法通过。

### 2.2 shellcheck：脚本的 linter

[ShellCheck](https://www.shellcheck.net/) 静态分析常见陷阱：未加引号的变量、`$[ ]` 旧语法、`cat file |` 反模式、`==` 用于 `[ ]` 等数百条规则。**三系安装**：

```bash
# Debian/Ubuntu
sudo apt install shellcheck

# Arch
sudo pacman -S shellcheck

# RHEL/CentOS/Rocky
sudo dnf install ShellCheck
```

注意 RHEL 系包名是 `ShellCheck`（驼峰，与二进制名 `shellcheck` 不同），Debian/Arch 是全小写——包名拼错会 `No match`，这是三系对照时最容易卡住的一步。

基本用法：`shellcheck script.sh` 直接列出告警（如 SC2086 提醒给变量加引号）；`-f gcc` 输出 GCC 风格便于编辑器跳转；`-f json` 供 CI 解析；`-S error` 只看 error 级别；`-e SC2086` 排除特定规则。**纳入工作流**：编辑器插件实时提示；CI 里对 `*.sh` 跑 `shellcheck -S warning` 并让告警导致构建失败。本教程所有示例都应能通过 shellcheck 的核心规则（SC2086 加引号、SC2046 命令替换加引号等）。

### 2.3 调试友好的输出习惯

`printf 'name=%q\n' "$name"` 的 `%q` 会转义，空格与特殊字符一目了然——比裸 `echo` 更能看出变量到底有没有尾部空格、是否含制表符。`declare -p arr` 打印数组与类型。函数入口打印参数个数与 `"<$1>"` 形式，能立刻发现传参被拆散的问题。

## 3. set -x：追踪执行

在可疑代码段前后 `set -x` / `set +x`，或整脚本 `bash -x script.sh`。每行开头的 `+` 表示「实际执行的展开后命令」——**变量展开结果直接可见**，漏引号、展开为空的问题一眼暴露。控制噪音：`PS4='+ ${BASH_SOURCE}:${LINENO}: '` 显示文件与行号；`BASH_XTRACEFD=3 bash -x script.sh 3>trace.log` 把跟踪写到 fd 3，stdout 保持干净。与 `set -e` 联用 `set -ex` 可同时看轨迹和失败点；失败前的最后一条 `+` 行往往就是元凶。

## 4. trap 与错误处理

三种最常用信号：`EXIT` 在脚本结束（正常或 `exit`）时触发，用于删临时文件、释放锁；`ERR` 在命令返回非零时触发（需 `set -e` 或 `set -o errtrace` 配合细粒度），用于报错定位；`INT`/`TERM` 对应 Ctrl+C 与 `kill`，用于优雅退出。另有 `DEBUG` 在每条命令前触发，极吵，仅超细粒度追踪用。

标准模板是 `trap cleanup EXIT` + `mktemp`：临时文件即使中途 `set -e` 退出也能删掉，不会堆积在 `/tmp`；`trap 'on_error ${LINENO} "$BASH_COMMAND" $?' ERR` 记录出错行号与命令；`trap 'echo "收到中断"; exit 130' INT` 处理中断。启动时一次性把「缺工具、缺变量、缺文件」挡在门外：用 `command -v` 探测依赖，用 `${VAR:?}` 或 `[[ -n ${TARGET:-} ]]` 检查变量——比跑到一半 `command not found` 友好得多。

**注意 `trap ERR` 与 `set -e` 的分工**：`-e` 管「命令失败就退出」，`ERR` 管「失败时跑一段钩子」；两者都依赖失败能被 shell 看见。`if cmd` / `while cmd` 这类条件位置会消费掉退出码，既不触发 `-e` 也不进 `ERR`——钩子不会跑是设计如此，不是配置写错了。

## 5. 日志记录

日志函数把时间戳、级别、消息拼好后 `tee -a` 写文件，整体 `>&2` 到标准错误——这样 `result=$(my_cmd 2>>log)` 能同时留下日志又不污染结果（数据/日志分离见 [函数](./functions.md)）。级别过滤用关联数组（Bash 4+，三系默认满足）：`DEBUG=0 INFO=1 WARN=2 ERROR=3`，低于 `LOG_LEVEL` 的直接返回不输出。

生产上简单轮转可自实现（超过大小则 `mv` 序号滚动），但更省心的做法是把日志交给 `logrotate`（见 [日志轮转](../basic/log/rotation.md)），脚本只管往固定文件写——自己实现轮转容易在并发写、inode 复用上踩坑。

## 6. bashdb：交互式断点调试

`set -x` 只能「整段回放」，需要**暂停、改变量、单步**时用 bashdb——GDB 风格的 Bash 调试器。**三系安装**：

```bash
# Debian/Ubuntu
sudo apt install bashdb

# Arch
sudo pacman -S bashdb

# RHEL/CentOS/Rocky
sudo dnf install bashdb
```

会话里常用：`break 12` 或 `break func` 下断点，`continue` 继续到下一断点，`next`（n）单步不进函数，`step`（s）单步进入函数，`print $var` 求值打印，`list` 显示附近源码，`where` 看调用栈，`quit` 退出；也可 `bashdb -b 10 script.sh` 非交互停在第 10 行。安装体积小（Arch 上 `pacman -S bashdb` 秒装），复杂状态机脚本值得投入学习成本；简单脚本用 `set -x` + `printf` 往往更快。

## 7. 调试流程建议

1. **写完先 `shellcheck`**——能拦下 60% 的引号与常见反模式问题。
2. **`bash -n`**——语法错误在执行前解决。
3. **小样本跑通**——用最小输入文件验证逻辑，再上真实数据。
4. **`bash -x` 跟踪**——路径不对或展开为空时打开，看每一步实际执行了什么。
5. **打印中间值**——`printf '%q\n'` 关键变量，或临时 `declare -p`。
6. **bashdb 单步**——状态复杂、多层函数、循环条件难复现时上断点。
7. **上线前 `trap EXIT` + 日志**——现场无法复现时靠留下的痕迹。

## 8. 本章常见坑

1. **以为 `set -e` 万能**。函数在 `if` 条件位置时内部 `-e` 失效；`local x=$(cmd)`、`((i++))`、`grep` 无匹配都有例外。`-e` 是安全网不是逻辑框架，关键分支仍要显式 `if`/`||`。

2. **开了 `-u` 却不处理可选变量**。可选参数用 `${VAR:-}`、`${1:?...}` 模式，否则正常路径也会 `unbound variable`。

3. **shellcheck 装错包名**。RHEL 系是 `dnf install ShellCheck`（大写），Debian 是 `shellcheck`，Arch 是 `pacman -S shellcheck`；小写包名在 Rocky 上会找不到。

4. **`set -x` 输出与业务 stdout 混在一起**。跟踪日志应重定向：`BASH_XTRACEFD=3 bash -x s.sh 3>trace.log`，或 `exec 2>trace.log` 后单独看 stderr。

5. **`trap ERR` 不触发**。需要 `set -e` 或 `set -o errtrace`；且被 `if cmd` 消费掉退出码的命令不进 ERR。

6. **不检查 `$?` 就接 `&&`**。`cmd && do_ok || do_fail` 在 `do_ok` 失败时也会进 `do_fail`——见 [条件判断](./conditionals.md)。

7. **调试完忘了删 `set -x`/`echo debug`**。提交前 shellcheck + 代码搜一遍 `TODO`/`DEBUG`；把调试输出收进 `log DEBUG` 并由 `LOG_LEVEL` 控制更安全。

8. **在生产脚本里 `rm -rf $dir` 调试**。先 `echo rm -rf "$dir"` 试跑，或加 `-i`/`--dry-run`；`set -u` 保证 `dir` 拼错会报错而不是删根。

## 参考资料

- `man bash` — set（Shell Builtin Commands）、trap
- ShellCheck Wiki — [shellcheck.net](https://www.shellcheck.net/wiki/)
- Arch Wiki - Bash — [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- Bash 手册 - The Set Builtin — [gnu.org](https://www.gnu.org/software/bash/manual/html_node/The-Set-Builtin.html)
- Bash 手册 - Bourne Shell Builtins (trap) — [gnu.org](https://www.gnu.org/software/bash/manual/html_node/Shell-Builtin-Commands.html)
- 鸟哥的私房菜 - script 的执行方式与建议 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0320bash.php)
- Advanced Bash-Scripting Guide - Debugging — [tldp.org](https://tldp.org/LDP/abs/html/debugging.html)
- bashdb 手册 — [bashdb.sourceforge.net](https://bashdb.sourceforge.net/)
