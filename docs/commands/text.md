# 文本处理

Linux 系统里最重要的"数据格式"不是 JSON 也不是数据库表，
而是纯文本：
配置文件是文本、
日志是文本、
账号表 `/etc/passwd` 是文本、
进程列表 `ps` 的输出是文本。
正因为如此，
Unix 设计者把整套工具链都围绕文本构建——
一个命令只做一件事，
然后用管道把它们串起来完成复杂任务。
这就是"Linux 文本处理"真正的威力所在：
你不需要学一个庞大的软件，
只需要组合几个各司其职的小命令。

> 本章命令（`grep`、
> `sed`、
> `awk`、
> `sort`、
> `cat`、
> `less`、
> Vim 等）在 **Debian/Ubuntu、
> Arch、
> RHEL/CentOS/Rocky** 三系上行为一致，
> 均来自 GNU/POSIX 生态，
> 可放心跨发行版使用。
> 只有当你想安装额外编辑器或工具时，
> 才需要按发行版切换包管理器（`apt install` / `pacman -S` / `dnf install`）。

## 为什么文本处理是 Linux 的核心技能

三个很现实的理由：

1. **排障靠读日志，
   日志是文本**。
   服务 502 了，
   你要在 `/var/log/nginx/error.log` 里找时间段内的错误；
   磁盘告警了，
   你要统计哪个目录的文件在疯长。
   这些动作的第一反应都是"把文本捞出来、
   过滤、
   统计"，
   也就是 `grep` + `awk` + `sort | uniq -c` 的组合。
   不会管道，
   就只能一屏一屏肉眼翻。
2. **批量修改配置必须交给工具**。
   要把 200 台机器上的 `PermitRootLogin yes` 改成 `no`，
   手工打开 200 个文件不现实；
   用 `sed -i` 一行搞定，
   配合 `find`/`xargs` 还能限定范围。
   改文本的效率决定了自动化的下限。
3. **管道是 shell 编程的语法**。
   `ps aux | grep nginx | awk '{print $2}' | xargs kill` 这样一条命令里，
   每个工具都很简单，
   但组合起来完成了一次"找进程—取 PID—终止"的完整流程。
   理解管道里流动的是文本流，
   你就理解了 shell 编程的一半。

鸟哥常用的教学比喻是：
`grep` 是筛子（挑出符合条件的行），
`sed` 是流水线工人（按脚本逐行加工），
`awk` 是会计师（按列取数、
算合计）。
三者分工不同，
经常接力使用。

> 示例输出来自真实 Ubuntu 26.04 环境，见文末参考资料。

## 学习目标

- **看**：
  熟练 `cat`、
  `less`、
  `head`、
  `tail -f`，
  知道大文件和实时日志分别该用哪个（大文件用 `less`，
  实时追 tail 用 `tail -f`，
  超大日志用 `less +F`）。
- **找**：
  掌握 `grep` 的 `-i`、
  `-n`、
  `-r`、
  `-v`、
  `-c`、
  `-A/-B/-C` 与正则（BRE/`-E` ERE/`-P` PCRE），
  能从日志里精准捞出错误行并带上行号和上下文。
- **改**：
  掌握 `sed` 的替换（`s/old/new/g`）、
  行地址、
  `-i` 就地修改与备份（`-i.bak`），
  理解"先预览再 `-i`"的安全流程。
- **算**：
  掌握 `awk` 的字段引用（`$1`…
  `$n`）、
  `-F` 分隔符、
  `NR`/`NF`/`FS` 内置变量与 `BEGIN`/`END` 块，
  能做列抽取、
  条件过滤、
  计数汇总。
- **整理**：会用 `sort`、`uniq -c`、`cut`、`tr`、`wc` 做排序去重和统计，把杂乱输出变成可读报表。
- **写**：掌握 Vim 的插入、保存、退出、搜索替换等最小可用集，能在服务器上直接改配置文件而不必下载到本地。

## 子页导读

| 子页 | 一句话导读 |
|------|------------|
| [文本处理命令](./text/text_processing.md) | 管道工具箱：`cat`/`nl`/`wc` 查看统计，`grep` 搜索过滤，`sed` 替换删除，`awk` 取列计算，`sort`/`uniq`/`cut`/`tr` 整理格式，配合大量可直接复制的管道实例。 |
| [文本编辑和查看工具](./text/editors.md) | 编辑器与查看器：Vim 三种模式与常用快捷键（插入、保存退出、查找替换、可视块）、nano 快速上手，以及 `less`/`more`/`head`/`tail -f` 在不同场景下的选择与分页技巧。 |

推荐顺序：先读[文本处理命令](./text/text_processing.md)建立"管道思维"，再读[文本编辑和查看工具](./text/editors.md)学会把加工结果保存下来。读完后可用这个自检：`grep -c ERROR /var/log/syslog` 能统计错误条数，`awk '{print $1}' /etc/passwd | sort -u` 能列出系统里所有唯一用户名，两条都能独立写出，本章即算过关。

## 三系差异速览

| 场景 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 默认编辑器 | 常为 `nano`（`editor` 命令） | 常为 `vi` | 常为 `vim`（`vi` 是 symlink） |
| 安装 Vim | `sudo apt install vim` | `sudo pacman -S vim` | `sudo dnf install vim-enhanced` |
| 安装 `ripgrep`（更快的 grep 替代） | `sudo apt install ripgrep` | `sudo pacman -S ripgrep` | `sudo dnf install ripgrep`（EPEL/AppStream） |
| 安装 `fd-find` | `sudo apt install fd-find`（命令名 `fdfind`） | `sudo pacman -S fd`（命令名 `fd`） | `sudo dnf install fd-find` |
| 日志文件位置 | `/var/log/syslog` | `/var/log/messages`（journalctl 另存） | `/var/log/messages` |
| 实时日志 | `journalctl -f` 通用；文本日志用 `tail -f` | 同左 | 同左 |

注意 Debian/Ubuntu 把 `fd` 包的可执行文件命名为 `fdfind`，
以避免与 `findutils` 的 `fd` 冲突；
Arch 和 RHEL 系则是标准的 `fd`。
跨发行版写脚本时要留意这个差异。

## 常见坑

1. **`sed -i` 不备份，
   改错无法回退**。
   就地修改前建议用 `sed -i.bak 's/a/b/' file`（会生成 `file.bak`），
   或先去掉 `-i` 预览输出，
   确认无误再加 `-i`。
   配置文件尤其要先备份。
2. **`grep` 的正则默认是 BRE，
   `+`、
   `?`、
   `|` 需要转义或改用 `-E`**。
   想写"一个或多个 o"用 `grep -E 'go+'`，
   直接写 `grep 'go+'` 在基础正则里 `+` 是字面量。
   Perl 风格（`\d`、
   `\w`）则要 `grep -P`（GNU grep 支持；
   个别精简环境可能未编译 PCRE）。
3. **`grep -r` 忘了排除 `.git`/`node_modules`，
   结果刷屏**。
   仓库目录里搜索加 `--exclude-dir={.git,node_modules}`；
   日志目录搜索加 `--include='*.log'` 限定范围。
4. **`awk` 默认按空白分列，
   连续空格会错位吗？
   ** 不会——
   awk 把连续空白当一个分隔符；
   但如果你用 `-F:` 处理 `/etc/passwd` 之类以冒号分隔的文件，
   就只能按冒号切。
   分隔符选错是最常见的列错位原因。
5. **`>` 重定向会先清空目标文件再写入**。
   `cat large.log > large.log` 会得到空文件；
   `>>` 才是追加。
   连续重定向同一文件也会被截断，
   管道和 tee 是更安全的写法。
6. **通配符被 shell 提前展开**。
   `find . -name *.log` 在当前目录没有 `.log` 文件时会把字面量 `*.log` 传给 find，
   或被 shell 展开成一长串文件名。
   `find` 的模式务必加引号：
   `find . -name "*.log"`。
7. **`tail -f` 遇到文件被轮转（rotate）会"看不见"新日志**。
   轮转会创建新文件并改 inode，
   旧的 `tail -f` 仍盯着旧 inode。
   用 `tail -F`（GNU，
   跟踪文件名）或直接 `journalctl -f` 更省心。
8. **Windows 换行符导致脚本报错**。
   从 Windows 拷来的文本是 CRLF（`\r\n`），
   在 Linux 上执行会报 `\r: command not found`。
   用 `dos2unix` 或 `sed -i 's/\r$//' file` 转换。

## 常见问题

**Q：`grep`、`sed`、`awk` 到底怎么分工？**

按"动词"记：**找用 `grep`，改用 `sed`，算/取列用 `awk`**。
只判断"有没有匹配行"或数个数，`grep` 一行搞定；
整行替换、按正则批量改写，`sed 's/…/…/g'` 最顺手；
要按分隔符取第 N 列、做求和/去重统计，`awk` 的字段变量（`$1`、`$NF`）和条件动作结构才是正解。
三者都能被 `perl`/`rg` 部分替代，
但作为 POSIX/GNU 底座，管道里组合它们的习惯值得先练熟。

**Q：`grep -E` 和直接 `grep` 有什么区别？**

默认的 `grep` 使用**基本正则**（BRE），
量词 `+`、`?`、分组 `()` 都要转义才能生效；
`grep -E` 切到**扩展正则**（ERE），
写法更接近直觉：`grep -E 'error|warn|fail' app.log`。
`grep -P` 则启用 Perl 正则（支持 `\d`、环视等），
但依赖 PCRE，在部分精简系统上不可用，生产脚本里优先 `-E`。

**Q：为什么管道里 `sort` 后接 `uniq`，而不是反过来？**

`uniq` 只合并**相邻**的相同行，
所以必须先把相同内容排到一起，去重才完整。
典型统计是 `sort file | uniq -c | sort -nr`：
先排序、再去重计数、再按次数倒序。
跳过 `sort` 直接 `uniq`，
得到的只是"相邻重复消除"，
结果会随输入顺序漂移，
看起来像随机丢数据。

**Q：Vim 保存时提示 `E45: 'readonly' is set` 怎么办？**

文件本身没有写权限（`ls -l` 看到属主不是你），
或者被 `chattr +i` 锁定。
想强制写入用 `:w !sudo tee %`（借助 sudo 写回），
但更常见的场景是你本就不该改这个文件——
先确认属主和权限，再决定是 `chmod` 还是 `sudoedit`。
把 `-i` 提示当噪音直接 `:w!` 硬写，
容易在错误的文件上留下半截修改。

## 参考资料

- `man grep`, `man sed`, `man awk`, `man sort`, `man less`, `man vim`
- 鸟哥的私房菜 - 文本编辑器与处理器 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0320bash.php)
- Arch Wiki - Vim — [wiki.archlinux.org](https://wiki.archlinux.org/title/Vim)
- Arch Wiki - Core utilities — [wiki.archlinux.org](https://wiki.archlinux.org/title/Core_utilities)
- GNU grep 手册 — [gnu.org](https://www.gnu.org/software/grep/manual/)
- GNU sed 手册 — [gnu.org](https://www.gnu.org/software/sed/manual/)
- gawk 手册（GNU awk） — [gnu.org](https://www.gnu.org/software/gawk/manual/)
- POSIX - Regular Expressions — [pubs.opengroup.org](https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/)
