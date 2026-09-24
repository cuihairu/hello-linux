# 基本命令

基本命令是 Linux 操作的地基：
创建一个文件、
进入一个目录、
复制一份配置、
改一下权限、
删掉一个临时文件——
无论你未来做开发、
做运维还是做安全，
每天重复最多的都是这五类动作。
这一章不要求你背下所有参数，
而是先把**路径的概念、
权限位的含义、
以及"危险命令的边界"**这三件事建立起来。
地基打好了，
后面的文本处理、
查找定位、
系统管理章节都能自然生长出来；
地基不牢，
`rm -rf` 敲错一个空格就可能带走整台机器的数据。

> 本章命令绝大多数来自 GNU coreutils，
> 在 **Debian/Ubuntu、
> Arch、
> RHEL/CentOS/Rocky** 三系上行为一致。
> 唯一需要按发行版切换的是安装额外工具的方式（`apt install` / `pacman -S` / `dnf install`），
> 文中会标注。

## 为什么先学文件与目录命令

Linux 把"一切皆文件"作为设计基石：
硬件是文件（`/dev`）、
进程是文件（`/proc`）、
网络连接也能通过虚拟文件系统观察。
这意味着**掌握了文件操作，
就掌握了操作一切对象的统一语言**。
具体到日常收益有三点：

1. **路径感是排障的前提**。
   看到报错 `failed to open /etc/nginx/nginx.conf`，
   你必须立刻反应过来这是绝对路径，
   和你当前在哪个目录无关；
   看到 `./deploy.sh` 你得知道这是相对路径，
   依赖当前目录。
   分不清这两者，
   日志会越看越迷糊。
2. **权限是安全的第一道闸**。
   `chmod 777` 能让脚本"跑起来"，
   也会让整台服务器上的任何用户都能改它。
   知道 rwx 三位分别对应属主、
   属组、
   其他人，
   才知道该给 `750` 还是 `644`。
3. **批量操作的效率差距是数量级的**。
   手工复制 20 个文件要点 40 次鼠标，
   用 `cp`/`rsync` 只要一行；
   手工重命名 100 个日志会崩溃，
   配合通配符或 `rename` 一秒完成。
   基本命令练熟，
   后面 `find`、
   `tar`、
   管道组合才有落点。

> 示例输出来自真实 Ubuntu 26.04 环境，见文末参考资料。

## 学习目标

- **文件操作**：
  熟练使用 `touch`、
  `cp`、
  `mv`、
  `rm`、
  `cat`、
  `ln`，
  理解复制与移动在跨文件系统时的行为差异，
  养成 `rm -i` 或先 `ls` 再删的习惯。
- **权限管理**：
  会用八进制（`chmod 750`）和符号（`chmod u+x`）两种方式改权限，
  理解属主/属组/其他人三组 rwx，
  了解 SUID/SGID/Sticky 位的场景含义。
- **目录操作**：
  熟练 `mkdir -p`、
  `cd`（含 `-` 返回上一目录）、
  `pwd`、
  `ls` 的常用组合（`-lah`），
  理解绝对路径与相对路径、
  `.` 与 `..` 的区别。
- **安全意识**：
  知道哪些操作不可逆（`rm -rf`、
  `mv` 覆盖、
  `chmod -R`），
  掌握先预览（`ls`、
  `echo`）再执行、
  重要数据先备份再动手的流程。
- **三系无差别**：确认本章命令在三系上通用，只在"安装某个非预装工具"时才需要切换包管理器。

## 子页导读

| 子页 | 一句话导读 |
|------|------------|
| [文件操作](./basic/file.md) | 单个文件的生命周期：创建（`touch`）、查看（`cat`/`more`）、复制（`cp`）、移动（`mv`）、删除（`rm`）、链接（`ln`）、比较（`diff`/`cmp`），以及 `chmod`/`chown` 权限与属主管理的完整语法和示例。 |
| [目录操作](./basic/directory.md) | 目录树的导航与维护：`mkdir` 建目录（含 `-p` 递归创建）、`cd`/`pwd` 切换与定位、`ls` 列出内容、`rmdir`/`rm -r` 删除、`tree` 查看层级，以及路径写法（绝对 vs 相对）和目录快捷操作（`pushd`/`popd`）。 |

建议顺序：先读[文件操作](./basic/file.md)掌握权限位，再读[目录操作](./basic/directory.md)把文件放进目录树里理解；两页读完后，在实验机上完成"建目录 → 建文件 → 改权限 → 复制 → 删除"一个完整闭环，本章即算过关。

## 三系差异速览

本章主体命令三系通用，下表只列出会遇到差异的地方：

| 场景 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 缺 `tree` 命令 | `sudo apt install tree` | `sudo pacman -S tree` | `sudo dnf install tree`（需 EPEL 或 AppStream） |
| 缺 `ncdu`（交互式磁盘占用） | `sudo apt install ncdu` | `sudo pacman -S ncdu` | `sudo dnf install ncdu`（需 EPEL） |
| 缺 `vim` | `sudo apt install vim` | `sudo pacman -S vim` | `sudo dnf install vim-enhanced` |
| 默认 `ls` 配色/别名 | 通常来自 `ls --color=auto` 别名 | 同左（Bash 别名） | 同左 |
| 临时文件目录 | `/tmp`（可能 tmpfs） | `/tmp`（默认 tmpfs，重启清空） | `/tmp`（默认磁盘目录） |

注意 `/tmp` 的行为差异：
Arch 默认将 `/tmp` 挂载为 tmpfs（重启即清空），
Debian/Ubuntu 和 RHEL 系通常保留磁盘上的 `/tmp`（由 `systemd-tmpfiles` 定期清理）。
把重要文件丢在 `/tmp` 里过夜，
在 Arch 上很可能第二天就没了。

## 常见坑

1. **`rm -rf` 后面的路径写错**。
   `rm -rf /var/log/` 后多打一个空格再跟个变量空值，
   历史上曾酿成删库事故。
   安全习惯：
   先 `ls` 或 `echo` 看一眼目标，
   给 `rm` 加 `-i` 别名，
   重要目录操作前先 `tar` 打包备份一份。
   永远不要对 `/`、
   `/etc`、
   `/usr` 整树执行 `rm -rf`。
2. **覆盖不提示导致数据丢失**。
   `cp`、
   `mv` 默认会**静默覆盖**同名目标（`cp -i`、
   `mv -i` 才会询问，
   且多数发行版的交互式别名只在交互 shell 生效）。
   管道或脚本里尤其危险，
   因为别名不生效。
   习惯上先 `ls 目标目录` 确认没有同名文件。
3. **`chmod -R` 递归改权限"误伤"**。
   对整个家目录执行 `chmod -R 777` 会把 `.ssh`、
   私钥、
   脚本全部放开。
   权限应按目录用途精确给：
   家目录 `700`、
   `.ssh` `700`、
   公钥 `600`、
   普通配置 `644`、
   可执行脚本 `750`。
4. **软链接（`ln -s`）指向相对路径时的歧义**。
   `ln -s file link` 创建的软链解析是**相对于软链所在目录**，
   不是当前 shell 目录。
   移动软链位置或用绝对路径更稳妥：
   `ln -s /etc/nginx/nginx.conf /home/user/nginx.conf`。
5. **跨文件系统时 `mv` 实际是"复制+删除"**。
   把文件从磁盘移动到 U 盘（不同挂载点）会变慢且中途断电可能丢数据；
   这种场景用 `cp` 确认成功后再 `rm` 更可控。
6. **把当前目录 `.` 写进 `PATH`**。
   `PATH=.:$PATH` 会让你在当前目录"找到"并执行任意同名程序，
   属于经典的 PATH 劫持风险，
   服务器上不要这样配置。
7. **忘记 Linux 区分大小写**。
   `Config.conf` 和 `config.conf` 是两个文件；
   `cd /etc/ssh` 打错大小写会得到 `No such file or directory`。

## 常见问题

**Q：`cp` 为什么默认直接覆盖，不提示？**

交互确认靠别名，不靠命令本身。
多数发行版的 shell 配置里定义了 `alias cp='cp -i'`（`mv`、`rm` 同理），
所以在交互式终端里会看到 `cp: overwrite 'x'?` 的提示。
但脚本里（`sh`/`bash script.sh`）默认不加载这些别名，
覆盖就是静默的。
想要"永远提示"，
应在脚本里显式写 `cp -i`，
或者依赖 `set -o noclobber` 让 `>` 重定向也拒绝覆盖已存在文件。

**Q：为什么 `chmod -R 777` 是坏习惯？**

它把递归路径下**所有**文件都改成"任何人可读写执行"。
可写意味着任何本地用户都能往里塞内容；
可执行意味着脚本和二进制都能被别人改完再执行；
配置文件可写则给了提权入口。
正确做法是分层给权：
目录一般 `750`/`755`，
普通文件 `644`/`640`，
确实需要组协作的用 `chgrp` 先改组再给组权限，
绝不用一把梭的 `777`。

**Q：软链接和硬链接到底怎么选？**

一句话：**跨文件系统、要能指向目录、目标删了链接就该失效——用软链接（`ln -s`）；同一文件系统内要"多个名字共享同一份数据"、不怕目标消失——用硬链接（`ln`）**。
inode 不会变的是硬链接（所以 `ls -li` 看两个硬链接 inode 相同）；
`rm` 只删名字，硬链接数据要等所有名字都删掉才真正释放，
而软链接删掉目标后就成了悬空链接（`ls -l` 会显示红色箭头）。
备份场景里"硬链接 + 增量"（如 `rsync --link-dest`、btrfs 快照）就是利用这一点做秒级回滚。

**Q：误删了重要文件还有救吗？**

第一时间**停止一切写入**——继续安装、下载、编排任务都会覆盖被释放的块。
若在 ext4 上，检查 `~/.local/share/Trash/files/`（图形界面删除通常先进回收站）；
`rm` 直接删的，可用 `extundelete`/`testdisk` 按 inode 抢救，成功率取决于删后写入量。
生产环境的正解是防患于未然：
重要目录先 `cp -a` 打个时间戳备份，
或者把"删除"写成移动到 `/var/trash/$(date +%F)/` 的脚本，
留出后悔的时间窗。

## 参考资料

- `man ls`, `man cp`, `man mv`, `man rm`, `man chmod`, `man chown`, `man mkdir`
- 鸟哥的私房菜 - 文件与目录管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)
- 鸟哥的私房菜 - Linux 文件权限 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0210filepermission.php)
- Arch Wiki - File permissions — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_permissions)
- Arch Wiki - Core utilities — [wiki.archlinux.org](https://wiki.archlinux.org/title/Core_utilities)
- GNU coreutils 手册 — [gnu.org](https://www.gnu.org/software/coreutils/manual/)
- POSIX - rm/cp/mv/chmod — [pubs.opengroup.org](https://pubs.opengroup.org/onlinepubs/9699919799/)
