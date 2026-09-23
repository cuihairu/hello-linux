# 系统管理

一台 Linux 机器出问题时，
你的价值不在于"记得多少命令"，
而在于**能不能在两分钟内回答三个问题**：
这台机器是什么配置、
现在谁在占资源、
刚才发生了什么。
系统管理章就是围绕这三个问题组织的——
先看身份与硬件（系统信息），
再看正在运行什么（进程），
再看资源还剩多少（内存与磁盘），
然后持续观察（监控工具），
最后把重复的检查动作固化下来（配置管理）。
这条链走通了，
"服务器变慢了"就不再是一句无从下手的抱怨，
而是一组可以逐项排除的假设。

> 本章工具以 GNU/procps 生态和 systemd 为主，
> 在 **Debian/Ubuntu、
> Arch、
> RHEL/CentOS/Rocky** 三系上大部分通用；
> 差异集中在日志入口、默认监控包、以及配置管理工具的安装方式，文中会逐处标注。

## 为什么系统管理是排障的第一现场

很多人排障的顺序是反的：
先重启、
再百度、
最后才想到看日志。
正确的顺序应该反过来——
**先取证，
再假设，
最后才动手**。
系统管理章的每个工具，
本质都是在为"取证"服务：

1. **`ps`/`top` 回答"谁在跑"**。
   CPU 100% 时，
   `top` 的按 `P` 排序能在一秒内揪出元凶进程；
   `ps aux --sort=-%mem` 能列出内存占用前几名。
   没有这一步，
   任何"优化"都是盲目的。
2. **`free`/`df`/`du` 回答"还剩多少"**。
   `No space left on device` 不等于磁盘真满了——
   `df -h` 看分区、
   `du -sh *` 找大目录、
   `df -i` 查 inode 耗尽（大量小文件时常见），
   三步定位。
3. **`journalctl`/`dmesg` 回答"刚才发生了什么"**。
   进程为什么被 OOM killer 杀掉？
   `dmesg | grep -i oom` 有答案。
   服务为什么起不来？
   `systemctl status` + `journalctl -u 服务名 -e` 有答案。
4. **把重复动作固化成配置管理**。
   当你要在 50 台机器上统一安装监控 agent、
   统一改 sshd 配置，
   手敲 50 遍必然出错，
   Ansible 这类工具就是把"命令"升级成"可审计的代码"。

鸟哥在教程里反复强调：
系统管理能力 = 观察能力 × 排查顺序。
命令本身是查表就能得到的，
观察顺序则需要刻意练习，
本章的五个子页就是按"观察 → 分析 → 固化"的顺序排列的。

> 示例输出来自真实 Ubuntu 26.04 环境，见文末参考资料。

## 学习目标

- **快速画像**：
  用 `uname -a`、
  `hostnamectl`、
  `lscpu`、
  `lsblk`、
  `df -h` 在 30 秒内说清一台机器的内核、
  发行版、
  CPU、
  磁盘与挂载情况。
- **进程可控**：
  熟练 `ps`（`aux` 与 `-ef` 两种风格）、
  `top`/`htop` 交互操作、
  `kill`/`killall`/`pkill` 的信号选择（先 `TERM` 再 `KILL`），
  理解前台/后台与 `jobs`/`fg`/`bg`。
- **内存判断**：
  读懂 `free -h` 的 `total/used/available` 与 buff/cache，
  知道 `available` 才是"真正可分配内存"，
  不把缓存误判为内存泄漏。
- **瓶颈定位**：
  会用 `vmstat`、
  `iostat`、
  `mpstat`、
  `pidstat`（sysstat 包）判断瓶颈在 CPU、
  内存还是磁盘 I/O，
  用 `sar` 回看历史数据。
- **配置自动化**：
  理解 Ansible 的"无代理 + SSH + YAML playbook"模型，
  能写一个安装软件包并改配置文件的最小 playbook。
- **三系差异**：
  知道 journalctl、
  systemctl 三系通用，
  而 `yum` vs `dnf`、
  `iptables` vs `firewalld`、
  默认日志文件位置需要按发行版切换。

## 子页导读

| 子页 | 一句话导读 |
|------|------------|
| [系统信息查看](./system/system_info.md) | 给机器验明正身：`uname`、`hostnamectl`、`lscpu`、`lspci`、`lsusb`、`lsblk`、`df`、`uptime` 等，回答"这是什么系统、什么硬件、磁盘怎么分的"。 |
| [进程管理](./system/process.md) | 运行时的主角：`ps` 两种输出风格、`top`/`htop` 交互、`pgrep` 定位、`kill` 信号语义、`nohup`/`&`/`jobs` 前后台控制，以及僵尸进程与孤儿进程的成因。 |
| [内存管理](./system/memory.md) | 读懂内存账本：`free` 各列含义、`vmstat`/`slabtop`/`/proc/meminfo` 深入、缓存与 buffer 的角色、OOM killer 触发条件与排查。 |
| [配置管理工具](./system/configuration-management.md) | 从命令到代码：Ansible inventory/playbook/role 核心概念与实例，Puppet、Chef、SaltStack 的定位差异，以及"什么时候值得上配置管理"的判断标准。 |
| [系统监控工具](./system/monitoring.md) | 持续观察的眼睛：`top`/`htop`/`atop` 实时监控，`vmstat`/`iostat`/`nload` 性能分析，`sar` 历史回放，以及从监控指标到瓶颈结论的推理路径。 |

建议路线：
`system_info` → `process` → `memory` → `monitoring`（观察三部曲），
最后读 `configuration-management` 学会把前面的手工动作固化。
读完后自检：
拿到一台陌生机器，
能在两分钟内报出"发行版、
内核、
CPU 核数、
内存总量、
磁盘使用率、
CPU 最高的三个进程"，
本章即算过关。

## 三系差异速览

| 场景 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 服务管理 | `systemctl`（systemd） | `systemctl`（systemd） | `systemctl`（systemd） |
| 日志查询 | `journalctl -u 服务名` | 同左 | 同左 |
| 文本日志位置 | `/var/log/syslog`、`/var/log/auth.log` | `/var/log/messages`（详志看 journal） | `/var/log/messages`、`/var/log/secure` |
| 包管理器 | `apt`/`dpkg` | `pacman` | `dnf`（CentOS 7 为 `yum`） |
| 默认进程查看 | `ps`（procps-ng） | `ps`（procps-ng） | `ps`（procps-ng） |
| 装 `htop` | `sudo apt install htop` | `sudo pacman -S htop` | `sudo dnf install htop` |
| 装 `sysstat`（iostat/sar） | `sudo apt install sysstat`（默认可能未启用采集） | `sudo pacman -S sysstat` | `sudo dnf install sysstat`（需手动 `ENABLED=true`） |
| 防火墙命令 | `ufw`（底层 iptables/nftables） | 自选 `nftables`/`iptables` | `firewall-cmd`（firewalld） |
| 内核日志 | `dmesg`（可能需 sudo） | `dmesg` | `dmesg`（RHEL 系默认限制非 root 读取） |

一个容易忽略的细节：
Debian/Ubuntu 的 `sysstat` 装完默认**不开始采集**（`/etc/default/sysstat` 里 `ENABLED=false`），
`sar` 查不到历史数据；
Arch 和 RHEL 系一般默认启用。
要用 `sar` 做历史回看，
先确认采集开关。

## 常见坑

1. **把 buff/cache 当成"内存被吃光"**。
   `free -h` 里的 `used` 不含 cache，
   而 Linux 会尽量把空闲内存拿来做缓存；
   判断是否真缺内存要看 `available` 列（或 `free` 的 `-m` 输出）。
   盲目加内存、
   加 `vm.swappiness` 调优前，
   先确认 `available` 确实长期偏低。
2. **`kill -9` 当成万能钥匙**。
   `SIGKILL`（`-9`）无法被捕获，
   进程没有机会释放锁、
   写完日志、
   清理临时文件，
   可能导致数据损坏或资源泄漏。
   正确姿势：
   先 `kill 进程号`（默认 `SIGTERM`），
   等几秒不退再 `kill -9`。
3. **`ps aux` 与 `ps -ef` 输出列含义不同**。
   两者都能列出进程，
   但 `USER`/`PID`/`%CPU` 列的位置和顺序不一致，
   写 `awk '{print $2}'` 取 PID 时必须先看清当前是哪种风格，
   否则会取错列。
4. **`top` 里看错指标**。
   `%us`（用户态）高是应用问题，
   `%sy`（内核态）高可能是系统调用过频或驱动问题，
   `%wa`（I/O wait）高是磁盘瓶颈——
   三者都算"CPU 高"，
   但结论完全不同。
5. **非交互/脚本环境里用 `top -b -n 1`**。
   交互式 `top` 无法直接重定向输出做分析，
   批量抓取要用批处理模式：
   `top -b -n 1 | head -20`。
6. **`dmesg` 无权限或被限流**。
   RHEL 系默认 `kernel.dmesg_restrict=1`，
   非 root 执行 `dmesg` 会报 `Operation not permitted`，
   用 `sudo dmesg` 或看 `/var/log/dmesg`。
7. **配置管理工具"一上来就全套"**。
   Ansible 适合从 5–10 台机器起步，
   Puppet/Chef 的学习与维护成本更高。
   先把手工流程跑顺、
   写成脚本，
   再考虑工具化；
   否则会陷入"为了自动化而写自动化"。
8. **忘了三系包管理器不同**。
   监控工具缺命令时：
   Debian/Ubuntu `sudo apt install 包名`、
   Arch `sudo pacman -S 包名`、
   RHEL/CentOS/Rocky `sudo dnf install 包名`，
   不要混用。

## 常见问题

**Q：`load average` 超过 CPU 核数就一定有问题吗？**

不一定。
Linux 的负载包含**运行态 + 不可中断睡眠（D 状态，通常是等 I/O）**两部分。
16 核机器 load 20，若同时伴随 `iostat -x` 里 `%util` 接近 100%，
瓶颈在磁盘而不是 CPU；
反过来 load 18 但 `%us` 打满、I/O 空闲，
才是 CPU 不够用。
判断顺序永远是：
`top`/`mpstat` 看 CPU 分布 → `iostat` 看 I/O → `pidstat`/`ps` 定位进程，
不要只盯着 load 一个数字下结论。

**Q：`free -h` 里 `available` 和 `free` 差那么多，内存到底够不够？**

看 **`available`**。
Linux 会把暂时用不到的内存拿去做页缓存（buff/cache）加速磁盘读写，
这部分在进程真正申请时会立刻让出，所以不计入"空闲"却随时可用。
`free` 列只是"完全没被碰过"的内存，
现代系统上它长期偏低是**正常现象**。
只有 `available` 持续低于总内存的 5%～10%，
且 `free -h` 的 `swap used` 在不断增长，
才说明真的需要加内存或查内存泄漏。

**Q：`systemctl enable` 和 `start` 有什么区别？**

`start`/`stop` 管**当前这一次**是否立即运行；
`enable`/`disable` 管**下次开机**是否自动拉起。
两者互不影响：
`enable` 之后不 `start`，服务要等重启才生效；
`start` 之后不 `enable`，服务重启机器就没了。
容器化/云镜像里常见的"改了配置没生效"，
一半是忘了 `systemctl daemon-reload`（改了 unit 文件），
另一半是只 `start` 没 `enable`（或反之）。
`is-active`/`is-enabled` 可以分别验证两种状态。

**Q：`kill` 默认发的信号是哪个？`kill -9` 为什么不能随便用？**

默认是 **SIGTERM（15）**，
进程可以捕获它，用来清理临时文件、关闭连接、释放锁。
`kill -9` 发的是 **SIGKILL**，
内核直接回收，进程没有任何善后机会——
数据库可能留下未落盘的事务，
锁文件可能残留导致下次启动失败。
排障顺序应是：
先 `kill`（TERM）等几秒 → 无效再 `kill -HUP` 或按应用文档给的优雅退出信号 → 最后才 `-9`。
长期杀不掉的进程，真正要查的是它卡在哪个系统调用（`strace -p`），而不是反复补刀。

## 参考资料

- `man ps`, `man top`, `man free`, `man systemctl`, `man journalctl`, `man vmstat`, `man iostat`
- 鸟哥的私房菜 - 程序观察与作业管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0510process_monitor.php)
- Arch Wiki - Process management — [wiki.archlinux.org](https://wiki.archlinux.org/title/Process_management)
- Arch Wiki - systemd — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd)
- Arch Wiki - Btop/Htop（监控工具） — [wiki.archlinux.org](https://wiki.archlinux.org/title/Btop)
- procps-ng 项目页 — [gitlab.com](https://gitlab.com/procps-ng/procps)
- sysstat 手册（iostat/vmstat/sar） — [sebastien.godard.pagesperso-orange.fr](https://sebastien.godard.pagesperso-orange.fr/)
- Red Hat 文档 - Monitoring and managing system status and performance — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/index)
- Ansible 官方文档 — [docs.ansible.com](https://docs.ansible.com/)
