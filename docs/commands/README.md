# 命令篇

Linux 是一个靠命令驱动的系统。
图形界面能让你完成"点几下鼠标"的事，
但当 SSH 连上一台没有桌面的服务器、
当半夜服务挂掉需要在黑屏终端里排障、
当你要在三台机器上重复同样的操作时，
唯一能用的就是命令行。
命令篇是本教程的"查阅手册"：
前面基础篇讲概念、
后面服务器篇讲服务搭建，
而这一篇回答的是"这条命令到底怎么用、
参数什么意思、
三系发行版上有没有差别"。

> 本篇以 **Debian/Ubuntu、Arch、RHEL/CentOS/Rocky** 三大发行版家族为主线对照讲解。
> 凡涉及具体操作或行为差异的地方都会标注所属家族，
> 避免你拿着 `apt` 的命令去 Arch 上执行，
> 最后只得到一句 `command not found`。

## 为什么先读命令篇的导读

很多读者的习惯是跳过导读直接搜命令，这会带来两个长期代价：

1. **把某个发行版的命令当成 Linux 标准**。
   `apt` 只属于 Debian 系，
   `dnf` 只属于 RHEL 系，
   `pacman` 只属于 Arch 系——
   Linux 标准里稳定存在的其实是 `tar`、
   `grep`、
   `find`、
   `ps` 这些 POSIX/GNU 工具。
   分清这两类，
   你读任何英文文档都不会再卡住。
2. **只会背参数，
   不会描述问题**。
   运维能力的差距不在于谁记得 `-size +100M`，
   而在于谁能在"磁盘满了"这句话面前，
   自己推导出要找大文件、
   要查进程、
   要算目录占用。
   本篇每一章都先讲"这个场景为什么存在"，
   再讲"命令怎么敲"，
   就是为了让你建立这条推导链。

> 示例输出来自真实 Ubuntu 26.04 环境，见文末参考资料。

## 学习目标

学完本篇后，你应该能够：

- **熟练执行文件与目录操作**：
  创建、
  复制、
  移动、
  删除、
  权限修改，
  并清楚 `-r`、
  `-i`、
  `-f` 这类通用选项在不同命令里的含义差异。
- **用管道组合文本工具**：
  `grep` 过滤、
  `sed` 替换、
  `awk` 取列、
  `sort`/`uniq` 统计，
  能独立写出一行 shell 管道解决日志分析问题。
- **快速定位文件与内容**：
  知道什么时候用 `find`（实时、
  按条件）、
  什么时候用 `locate`（秒出结果但依赖数据库）、
  什么时候用 `fd`/`ripgrep`（现代替代品）。
- **正确打包与压缩**：
  分清"归档"和"压缩"是两件事，
  按场景选择 gzip、
  zstd、
  xz，
  掌握 `tar -C`、
  `--exclude`、
  分卷与流式传输。
- **读懂系统与网络状态**：用 `ps`、`free`、`df`、`ss`、`ip` 回答"谁在占资源、网络通不通"这类问题。
- **三系包管理自如切换**：
  见 APT 用 `apt`、
  见 RPM 用 `dnf`、
  见 Arch 用 `pacman`，
  并知道去哪里装缺失的命令。

## 章节导读

本篇包含两个层面：
五个**章节首页**负责给出学习路线和三系对照，
其下的**子页**负责具体命令的语法与示例；
另有两篇专题（查找与定位、
压缩与归档）直接以单页组织。

### 章节首页（学习路线入口）

- [基本命令](./basic.md) — 一切操作的起点：文件与目录的增删改查、权限位含义，读不懂 `ls -l` 后面的九个字母，就看不懂 Linux 的权限模型。
- [文本处理](./text.md) — Linux 哲学里"文本是通用接口"的落点：`cat`/`less` 看、`grep` 找、`sed` 改、`awk` 算，再配 Vim 保存结果。
- [系统管理](./system.md) — 回答"这台机器现在怎么样"：系统信息、进程、内存、监控与配置自动化，是排障的第一现场。
- [网络管理](./network.md) — 配地址、查连接、测连通：`ip`、`ss`、`ping`、`curl` 一条链路走完，网络问题就不再是玄学。
- [包管理](./package.md) — 安装、升级、卸载软件的三套完全不同的工具链（APT / DNF / pacman），以及六维对照表；缺命令时先来这里。

### 子页（具体命令速查）

- [基本命令 · 文件操作](./basic/file.md) — `cp`、`mv`、`rm`、`chmod`、`chown` 等单文件操作的语法与安全用法。
- [基本命令 · 目录操作](./basic/directory.md) — `mkdir`、`cd`、`pwd`、`ls`、目录树与路径写法（绝对路径 vs 相对路径）。
- [文本处理 · 文本处理命令](./text/text_processing.md) — `grep`、`sed`、`awk`、`sort`、`uniq`、`cut`、`tr` 组成的管道工具箱。
- [文本处理 · 编辑和查看工具](./text/editors.md) — Vim 核心操作、nano 快速上手，以及 `less`、`head`、`tail -f` 的正确打开方式。
- [系统管理 · 系统信息查看](./system/system_info.md) — `uname`、`hostnamectl`、`lscpu`、`lsblk`，快速给机器"验明正身"。
- [系统管理 · 进程管理](./system/process.md) — `ps`、`top`、`kill`、`nice`/`renice`，从发现异常进程到优雅终止。
- [系统管理 · 内存管理](./system/memory.md) — `free`、`vmstat`，分清 buff/cache 与真正的内存不足。
- [系统管理 · 配置管理工具](./system/configuration-management.md) — Ansible 为主的批量运维：把重复命令写成可复用的 playbook。
- [系统管理 · 系统监控工具](./system/monitoring.md) — `top`/`htop`、`vmstat`、`iostat`、`sar`，定位 CPU、内存、I/O 瓶颈的工具链。
- [网络管理 · 网络管理命令](./network/network.md) — `ip`、`ss`、`ping`、`traceroute`、`dig`，配置与诊断的最小闭环。
- [网络管理 · 网络工具](./network/network-tools.md) — `curl`、`wget`、`ssh`、`scp`、`rsync`，数据传输与远程管理的日常主力。
- [包管理命令](./package/package.md) — APT、DNF、pacman 三大包管理器的完整操作、仓库配置与依赖排障。

### 专题页

- [查找与定位](./find-and-locate.md) — 从 `find` 的条件表达式到 `locate` 的数据库检索，再到 `grep`/`fd`/`ripgrep` 内容搜索，以及"缺命令先装包"的三系安装方式。
- [压缩与归档](./compression.md) — `tar` 归档与 gzip/zstd/xz 压缩的分工、选型对照、分卷与增量备份，以及常见坑（含 `pacman -S` 安装压缩工具的写法）。

## 三系差异速览

同一句话，在三个发行版家族里的落点完全不同。下表是阅读本篇时最常查的对照：

| 场景 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装软件 | `sudo apt install 包名` | `sudo pacman -S 包名` | `sudo dnf install 包名` |
| 更新软件源索引 | `sudo apt update` | `sudo pacman -Sy`（建议与 `-u` 合写为 `-Syu`） | `sudo dnf makecache` |
| 升级全部已装软件 | `sudo apt upgrade` | `sudo pacman -Syu` | `sudo dnf upgrade` |
| 卸载 | `sudo apt remove/purge` | `sudo pacman -Rns` | `sudo dnf remove` |
| 搜索包 | `apt search 关键词` | `pacman -Ss 关键词` | `dnf search 关键词` |
| 查文件属于哪个包 | `dpkg -S 文件路径` | `pacman -Qo 文件路径` | `dnf whatprovides 文件路径` |
| 默认防火墙 | `ufw` | 自选 `nftables`/`iptables` | `firewalld`（`firewall-cmd`） |
| 默认强制访问控制 | AppArmor | 无默认配置 | SELinux（enforcing） |
| 包格式 | `.deb` | `.pkg.tar.zst` | `.rpm` |
| 第三方扩展 | PPA、backports | AUR（配合 `yay`/`paru` 等助手） | EPEL、RPM Fusion |

**记住一条经验法则**：
凡是名字里带发行版前缀的命令（`apt`、
`dnf`、
`pacman`、
`firewall-cmd`、
`netplan`）都不是 Linux 标准，
换发行版就要换写法；
凡是 GNU/coreutils 里的命令（`ls`、
`cp`、
`grep`、
`find`、
`tar`、
`chmod`）在三系上行为一致，
最多选项风格略有差别。

## 命令格式约定

Linux 命令的通用书写格式是：

```bash
命令 [选项] [参数]
```

- `命令`：要执行的程序，可以是可执行文件、shell 内建命令（如 `cd`、`export`）或别名。
- `[选项]`：
  控制命令行为的开关。
  短选项写作 `-l`、
  `-r`，
  常可合并为 `-la`；
  长选项写作 `--human-readable`，
  GNU 工具几乎都支持。
- `[参数]`：命令的操作对象，通常是文件或目录路径。

常见选项在多数命令里的含义相对稳定：

| 选项 | 常见含义 | 备注 |
|------|----------|------|
| `-a` | all，显示/包含所有项 | `ls -a`、`tar -a` 含义并不统一，以 `man` 为准 |
| `-l` | long，长格式 | `ls -l` 是长列表，`ps -l` 也是长格式 |
| `-r` | recursive，递归 | `cp -r`、`grep -r`；但 `tar -r` 是"追加到归档"，不通用 |
| `-v` | verbose，详细输出 | `tar -cvf` 会逐行列出文件名 |
| `-f` | force，强制 | `rm -f` 不提示；`tar -f` 是"指定归档文件名"，例外 |
| `-i` | interactive，交互确认 | `cp -i`、`rm -i` 覆盖前询问 |

`-r` 和 `-f` 在 `tar` 里的特殊含义是新手最常踩的坑之一：`tar` 的 `-f` 后面必须紧跟文件名，所以 `tar -cvf file.tar dir` 正确，而 `tar -cv dir file.tar` 会把 `file.tar` 当成要打包的文件。细节见[压缩与归档](./compression.md)。

**man 是最终答案**。
任何命令的权威文档都在手册里：
`man ls` 查看用法，
按 `/` 搜索、
按 `q` 退出；
`man 5 passwd` 查看文件格式类手册；
`apropos 关键词` 在手册标题里反查命令。
Arch Wiki 的价值在于讲"为什么"，
`man` 的价值在于讲"到底支持哪些选项"，
两者不可互相替代。

## 常见问题

**Q：提示 `command not found`，但教程明明写了这条命令？**

先按顺序排查：
① 这条命令是不是某发行版专属（`apt`/`dnf`/`pacman` 互不通用）；
② 是否只是没安装（Debian/Ubuntu 用 `apt install`、
Arch 用 `pacman -S`、
RHEL 系用 `dnf install` 装上提供该命令的包）；
③ 是否装了但不在 `PATH` 中，
用 `which 命令名` 或 `type 命令名` 确认；
④ 是否拼写错误或大小写错误（Linux 区分大小写）。

**Q：`Permission denied` 是权限问题还是文件不存在？**

两者报错不同：
文件不存在是 `No such file or directory`，
权限不足是 `Permission denied`。
后者用 `ls -l` 看属主属组和 rwx 位，
用 `id` 看当前用户组，
必要时 `sudo` 或 `chmod`/`chown` 处理。
若 `ls` 能列出文件名却打不开，
通常卡在"进入目录需要 x 权限"这一条上。

**Q：为什么我敲的命令和教程不一样？**

大概率是选项风格差异：
GNU 工具（Linux 上的主流）支持 `--long-option` 和 `-abc` 合并短选项，
而一些 POSIX 工具只认 `-abc`。
另外极少数命令（如 `kill`、
`ps`）的历史选项（BSD 风格不带 `-`）依然可用。
以本机 `man` 输出为准，
不要跨系统照抄。

**Q：管道、重定向、通配符总搞混，能一句话区分吗？**

重定向 `>`/`<` 决定数据"进出文件"，
管道 `|` 决定数据"从一个命令流到下一个命令"，
通配符 `*`/`?` 是 shell 在执行前对**文件名**的展开。
三者都由 shell 解释，
所以 `ls *.txt` 里的 `*` 由 shell 展开，
而 `find -name "*.txt"` 里的 `*` 是 find 自己匹配——
这也是为什么 `find` 的模式要加引号，
否则会被 shell 提前展开。

**Q：三系都有的"标准命令"有哪些？**

`ls`、
`cd`（shell 内建）、
`cp`、
`mv`、
`rm`、
`mkdir`、
`cat`、
`less`、
`grep`、
`sed`、
`awk`、
`find`、
`tar`、
`chmod`、
`chown`、
`ps`、
`kill`、
`df`、
`du`、
`mount` 在三系上完全一致（多来自 GNU coreutils/findutils/grep/tar）。
真正需要按发行版切换的，
集中在**包管理、
服务管理、
网络配置、
防火墙、
日志入口**这五类。

## 参考资料

- 鸟哥的私房菜 - 命令行与 Shell — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0340bash.php)
- 鸟哥的私房菜 - 常用命令介绍 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)
- Arch Wiki - Core utilities — [wiki.archlinux.org](https://wiki.archlinux.org/title/Core_utilities)
- Arch Wiki - Bash — [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- Arch Wiki - Pacman — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Debian 手册 — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Red Hat 文档中心 - Getting started with the command line — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/getting_started_with_the_red_hat_enterprise_linux_console/index)
- Linux man pages（man7.org） — [man7.org](https://man7.org/linux/man-pages/)
- POSIX.1-2017 Shell Command Language — [pubs.opengroup.org](https://pubs.opengroup.org/onlinepubs/9699919799/)
