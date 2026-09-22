# 系统信息查看命令

拿到一台陌生的 Linux 机器，第一件事不是改配置、不是装软件，而是**看清楚它是什么**：内核多新、CPU 几核、内存多大、磁盘怎么分区、谁登录过。系统信息查看就是排障与变更前的"望诊"——先诊断，再开方。

> 内容参考自鸟哥的私房菜、Arch Wiki 与各工具 man 手册，见文末参考资料。

## 学习目标

- 理解"先查系统信息再动手"的排查习惯
- 掌握 uname、lscpu、lsblk、df、ip 等核心命令的读法
- 能区分三发行版（Debian/Ubuntu、Arch、RHEL/CentOS/Rocky）的工具差异
- 学会从负载、日志与登录记录快速建立系统画像

## 1. 为什么先看系统信息

生产事故里最常见的两类错误，一是**拿错假设**（以为是 4 核机器结果是 2 核，以为内存 8G 结果只有 2G），二是**改错对象**（在 Debian 上敲 `dnf`，把 `/dev/sda` 当成数据盘格式化）。`uname`、`/etc/os-release`、`lsblk` 这几条命令花不了一分钟，却能挡掉后面百分之八十的低级错误。

系统信息大致分四层，由内到外分别是：**内核与发行版身份 → 硬件资源 → 挂载与网络 → 运行时状态**。下面按这个顺序展开；每节先说"为什么要看"，再给命令与真实输出。

## 2. 系统身份：uname 与 os-release

### 2.1 uname — 内核视角

内核版本决定了你能用哪些特性：eBPF 工具链、cgroup v2、io_uring 都对内核版本有硬性要求。排查"某命令在这台机器上不存在/行为不同"时，先看内核：

```bash
$ uname -a
Linux web01 6.8.0-45-generic #45-Ubuntu SMP PREEMPT_DYNAMIC x86_64 GNU/Linux

$ uname -r
6.8.0-45-generic
```

`-s` 返回内核名（Linux），`-n` 是主机名，`-m` 是硬件架构（`x86_64`、`aarch64`）。日常只记 `-r` 与 `-m` 足够；`-a` 的完整串适合贴进工单。

**注意**：`uname -r` 是**内核**版本，不是发行版版本。Arch 每次 `pacman -Syu` 升级内核后这个数字都会变，而 Ubuntu 的 `6.8.0-45-generic` 尾部的 `-generic` 是内核 flavor 标记。

### 2.2 /etc/os-release — 发行版身份

真正回答"这是哪家发行版"的是 `/etc/os-release`，三大主流发行版输出形态差别很大，值得先对一遍：

```bash
$ cat /etc/os-release
PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"
NAME="Debian GNU/Linux"
VERSION_ID="12"
VERSION="12 (bookworm)"
ID=debian
```

Arch 的文件里通常只有 `ID=arch` 和 `BUILD_ID=rolling`，**没有** `VERSION_ID`——滚动更新发行版本来就不存在"版本号"；Rocky 则会写 `VERSION_ID="9.4"` 并带 `ID_LIKE="rhel centos fedora"`。判断包管理器用哪家，看 `ID` 字段即可：`debian`→`apt`，`arch`→`pacman`，`rhel` 系→`dnf`。

`hostnamectl` 在三系上均可使用，能一并看到主机名、内核与虚拟化信息：

```bash
$ hostnamectl
 Static hostname: web01.example.com
       Chassis: vm
Operating System: Debian GNU/Linux 12 (bookworm)
          Kernel: Linux 6.8.0-45-generic
    Architecture: x86-64
```

主机名的**修改**方法（`hostnamectl set-hostname`）与三系网络/时间入口一起放在[配置管理工具](./configuration-management.md)，此处只做查看。

### 2.3 uptime — 运行时间与负载

`uptime` 一行里最有用的不是"开了几天"，而是末尾的 **load average**（1/5/15 分钟平均负载）：

```bash
$ uptime
 10:30:41 up 12 days,  3:21,  2 users,  load average: 0.15, 0.10, 0.08
```

负载表示"处于可运行或不可中断状态的平均任务数"。**判断标准不是绝对值，而是与 CPU 核数比较**：4 核机器上 load 长期 > 4 说明任务在排队；1 核机器上 load 0.8 已经很忙。15 分钟值持续走高、而 1 分钟值回落，往往意味着尖峰已过但系统仍偏紧。更细的进程级视角见[进程管理](./process.md)与[系统监控工具](./monitoring.md)。

## 3. 硬件信息

### 3.1 lscpu — CPU 画像

CPU 数量直接影响性能判断：负载阈值、`make -j` 并行度、数据库连接池都以它为基准。

```bash
$ lscpu
Architecture:          x86_64
CPU op-mode(s):        32-bit, 64-bit
CPU(s):                8
On-line CPU(s) list:   0-7
Thread(s) per core:    2
Core(s) per socket:    4
Socket(s):             1
Model name:            Intel(R) Core(TM) i7-8550U CPU @ 1.80GHz
```

读法：`Socket(s)×Core(s)×Thread(s) = CPU(s)`。这里 1×4×2=8，即**物理 4 核、8 线程**。谈"几核"时要说清楚是逻辑 CPU 还是物理核，否则容量规划会差一倍。

`nproc` 只返回**当前进程可用**的 CPU 数：在 cgroup CPU 限制的容器里它可能小于 `lscpu` 的 `CPU(s)`——容器里跑性能测试时两个数对不上是正常现象，不是 bug。

`/proc/cpuinfo` 信息更细（每个逻辑 CPU 一段），快速提取型号与核数：

```bash
$ grep -m1 "model name" /proc/cpuinfo
model name	: Intel(R) Core(TM) i7-8550U CPU @ 1.80GHz
$ grep -c ^processor /proc/cpuinfo
8
```

### 3.2 lsblk — 块设备与分区树

格式化磁盘前必须先确认设备名，`lsblk` 以树状展示磁盘—分区—挂载点关系，比 `fdisk -l` 更直观：

```bash
$ lsblk
NAME   MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
sda      8:0    0 238.5G  0 disk
├─sda1   8:1    0   512M  0 part /boot/efi
└─sda2   8:2    0 238.0G  0 part /
sr0     11:0    1  1024M  0 rom
```

`lsblk -f` 额外显示文件系统类型与 UUID——写 `/etc/fstab` 时 UUID 从这里抄最省事。**云服务器上常见的 `vda`/`xvda` 与本地机的 `sda` 只是命名不同**，不要假设"sda 一定是系统盘"，永远对照 `MOUNTPOINTS` 列确认。

### 3.3 lspci / lsusb — 总线设备

驱动出问题时先确认硬件是否存在、认出来没有：

```bash
$ lspci | grep -i network
03:00.0 Ethernet controller: Realtek Semiconductor Co., Ltd. RTL8111/1681/8411 PCI Express Gigabit Ethernet Controller

$ lsusb
Bus 002 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub
```

`lspci -v` / `lsusb -v` 可看驱动绑定情况；无线网卡不出现多半是缺固件而非插槽坏了。PCI 类别速查：`VGA`/`3D` 是显卡，`Network` 是网卡，` SATA`/`NVMe` 是存储控制器。

### 3.4 lshw — 硬件全量清单

需要一份完整硬件报告时用 `lshw`，它聚合了 CPU、内存、网卡、主板等多类信息：

```bash
$ sudo lshw -short          # 简表，适合贴工单
$ sudo lshw -class disk     # 只看某一类
$ sudo lshw -class network
```

`lshw` 在三大发行版仓库里都有（`apt install lshw`、`pacman -S lshw`、`dnf install lshw`）。日常九成场景 `lscpu`/`lsblk`/`lspci` 已够用，`lshw` 留给写硬件清单或排查诡异兼容性问题。

## 4. 内存信息

快速看内存用 `free`，列含义（尤其 `available` 与 `free` 的区别）在[内存管理](./memory.md)有专节展开，这里只给最小读法：

```bash
$ free -h
               total        used        free      shared  buff/cache   available
Mem:            15Gi       8.2Gi       1.2Gi       512Mi       6.1Gi       6.3Gi
Swap:          2.0Gi          0B       2.0Gi
```

判断"内存够不够"看 **`available`**，不要看 `free`——Linux 会把空闲内存拿去做磁盘缓存，`free` 很低是健康状态的常态。`/proc/meminfo` 提供更细的字段（`MemAvailable`、`Cached`、`Dirty` 等），需要精确到页时再翻。

## 5. 磁盘信息

### 5.1 df — 文件系统使用率

`df` 报告的是**已挂载文件系统**的使用率，是磁盘告警的第一数据源：

```bash
$ df -hT
Filesystem     Type   Size  Used Avail Use% Mounted on
/dev/sda2      ext4   234G   87G  136G  40% /
tmpfs          tmpfs  7.8G     0  7.8G   0% /dev/shm
```

`-h` 人类可读，`-T` 带文件系统类型（`-Th` 合写）。两个常见误读：

1. **`/dev/shm` 是内存盘**，它用满不代表磁盘满，但它用满会让依赖共享内存的程序（如浏览器、部分数据库）报错。
2. **`df` 与 `du` 数字对不上**通常是被删但仍被进程持有的文件占着空间（`du` 看不到、`df` 看得到），用 `lsof +L1` 找这类"幽灵文件"，不要急着重装。

查 inode 是否耗尽用 `df -i`——小文件海量的目录（邮件队列、缓存目录）经常 inode 先满而字节空间还很空。

### 5.2 du — 目录占用

`df` 告诉你"哪个分区满了"，`du` 告诉你"是谁占的"：

```bash
$ sudo du -sh /var/log/* | sort -hr | head
2.1G	/var/log/journal
412M	/var/log/sysstat
88M	/var/log/apt
```

`-s` 汇总、`-h` 人类可读；`sort -hr` 按人类可读尺寸倒序（比 `sort -h` 只排字符串更稳）。深目录扫描可能跑几十秒，先 `du -sh /var` 再逐层下钻，比一上来 `du -ah /` 快得多。

### 5.3 fdisk — 分区表

需要看磁盘级分区表（含未挂载分区）时：

```bash
$ sudo fdisk -l /dev/sda
Disk /dev/sda: 238.47 GiB, 256060514304 bytes, 500118192 sectors
```

现代系统更推荐 `lsblk` 看结构、`blkid` 拿 UUID；`fdisk` 在**改分区表**时才是主角（改表有丢数据风险，练习请用虚拟机）。GPT 大盘也可用 `gdisk`/`parted`，此处不展开。

## 6. 网络信息

### 6.1 ip — 现代标准

`ip` 是 `net-tools`（`ifconfig`/`route`/`arp`）的继任者，三系默认仓库均带 `iproute2`：

```bash
$ ip -br addr show
lo               UNKNOWN        127.0.0.1/8 ::1/128
enp3s0           UP             192.168.10.5/24 fe80::216:3eff:fe01:2a3b/64

$ ip route show
default via 192.168.10.1 dev enp3s0 proto dhcp src 192.168.10.5 metric 100
192.168.10.0/24 dev enp3s0 proto kernel scope link src 192.168.10.5
```

`-br` 给简表：接口名、状态、地址一行看完。查"通不通"先 `ip addr` 有无地址，再 `ip route` 有无默认路由，最后才是 `ping`——顺序反了会把路由问题误判成防火墙问题。

### 6.2 ifconfig — 为什么逐步退役

`ifconfig` 老树盘根，新装的最小化系统往往**根本没装** `net-tools`，敲下去直接 `command not found`。即便装了，它也不支持 `ip addr` 那样的扩展语法（如 secondary 地址、策略路由）。教学与老文档里仍常见，实际运维请统一用 `ip`；接口的**持久化配置**按发行版走 Netplan/nmcli/networkd，见[配置管理工具](./configuration-management.md)与[网络配置基础](../../network/network-configuration.md)。

## 7. 系统状态与日志速览

进程与性能的完整方法论分别在[进程管理](./process.md)和[系统监控工具](./monitoring.md)，本节只保留"系统信息画像"用得上的三板斧。

### 7.1 top / htop — 谁在消耗资源

```bash
$ top
# 快捷键：P 按 CPU 排序，M 按内存排序，1 展开每核，k 发信号，q 退出

$ htop
```

`top` 三系开箱即有；`htop` 需要安装，三家命令不同：

```bash
sudo apt install htop      # Debian/Ubuntu
sudo pacman -S htop        # Arch
sudo dnf install htop      # RHEL/CentOS/Rocky
```

### 7.2 vmstat / iostat — 系统级抽样

```bash
$ vmstat 1 5      # 每秒一次，共 5 次
$ iostat -x 1 5   # 磁盘扩展统计（来自 sysstat 包）
```

`vmstat` 属于 `procps`/`procps-ng`，三系一般自带；`iostat` 属于 **sysstat** 包，Arch 上是 `pacman -S sysstat`，Debian 是 `apt install sysstat`，Rocky 是 `dnf install sysstat`。列含义与"怎样算异常"见[系统监控工具](./monitoring.md)。

### 7.3 journalctl / dmesg — 日志

```bash
$ journalctl -b --no-pager | tail -20   # 本次启动日志末尾
$ journalctl -u nginx -n 50             # 某服务最近 50 条
$ journalctl -f                         # 跟随新日志

$ dmesg --level=err,warn                # 内核告警/错误（需权限视配置而定）
```

三系都以 systemd journal 为主入口。`dmesg` 看内核态消息（磁盘故障、OOM、USB 插拔），`journalctl -u` 看用户态服务。装机自检时先 `journalctl -b -p err` 过滤本次启动的错误级日志，往往一眼就能发现缺驱动或文件系统只读挂载。日志体系详见[日志管理](../../basic/services/log_management.md)。

## 8. 用户与登录记录

```bash
$ whoami
root

$ id
uid=0(root) gid=0(root) groups=0(root)

$ who
root     pts/0        2026-09-22 10:12 (192.168.10.20)

$ last -n 5
```

`whoami`/`id` 回答"我是谁、有什么权限"——脚本里 `sudo` 失败先跑这两条，多半是用户不在 `sudo`/`wheel` 组。`who` 看**当前**在线会话，`last` 看历史登录（数据来自 `/var/log/wtmp`）。安全排查时 `last` + `journalctl -u sshd` 能交叉验证可疑 IP；账号管理命令见[用户管理](../../basic/users.md)。

## 9. 三发行版对照与工具安装

同一台"查系统信息"的活，三系默认工具基本一致（都来自 util-linux、procps、iproute2），差异集中在**个别增强工具是否预装**：

| 任务 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 发行版识别 | `cat /etc/os-release` | 同左 | 同左 |
| 内核版本 | `uname -r` | 同左 | 同左 |
| CPU/磁盘/总线 | `lscpu`/`lsblk`/`lspci` | 同左 | 同左 |
| 内存 | `free`（procps） | `free`（procps-ng） | `free`（procps-ng） |
| 网络 | `ip` | `ip` | `ip` |
| 实时进程 | `top` 自带 | `top` 自带 | `top` 自带 |
| 增强进程界面 | `sudo apt install htop` | `sudo pacman -S htop` | `sudo dnf install htop` |
| 硬件全量清单 | `sudo apt install lshw` | `sudo pacman -S lshw` | `sudo dnf install lshw` |
| 磁盘 I/O 统计 | `sudo apt install sysstat` | `sudo pacman -S sysstat` | `sudo dnf install sysstat` |
| 日志 | `journalctl` | `journalctl` | `journalctl` |

Arch 注意事项：滚动更新下**先保证系统整体是最新的**再装包，避免 partial upgrade——`sudo pacman -Syu htop` 一次完成，而不是只 `pacman -S htop` 却长期没升级系统。RHEL 8/9 与 Rocky 对应仓库一般自带 `lshw`/`sysstat`；极老的 CentOS 7 需要 EPEL 的部分工具，新项目不建议再基于 EOL 系统。

不确定机器是谁家时，养成固定动作：`cat /etc/os-release` → 定家族 → 再选 `apt`/`pacman`/`dnf`。

## 10. 常见坑

1. **把 `uname -r` 当发行版版本**。它是内核版本；发行版看 `/etc/os-release`。给 Arch 用户问版本，正确的问题是"你上次 `pacman -Syu` 是什么时候"。
2. **`free` 的 `free` 列很低就以为内存不够**。健康系统会把空闲内存变成 buff/cache，看 `available`；判断标准见[内存管理](./memory.md)。
3. **`df` 与 `du` 对不上就怀疑磁盘坏了**。先 `lsof +L1` 查已删除未释放的文件；容器 overlay 层也会造成两者视差。
4. **`ifconfig` 找不到就以为网络驱动坏了**。多半只是没装 `net-tools`；用 `ip -br addr` 即可，接口没出现才是驱动/硬件问题。
5. **load average 不看核数直接报警**。8 核机器 load 3 完全正常；阈值应与 `lscpu` 的 `CPU(s)` 联动，并观察 1/5/15 三条线的趋势。
6. **云主机上把 `vda`/`nvme0n1` 猜成数据盘**。永远以 `lsblk` 的 `MOUNTPOINTS` 和 `df -hT` 交叉确认后再操作。
7. **`lscpu` 的 CPU 数与 `nproc` 不一致**。容器/cgroup 限额下这是预期行为；裸机不一致才需要查 `taskset`/`isolcpus`。
8. **改网络/时区只敲了查看命令**。`hostnamectl`、`ip addr` 都是"看"；"改"要走[配置管理工具](./configuration-management.md)里的持久化入口，改完还要验证生效（新开 shell、`ip addr` 复查）。

## 参考资料

- 鸟哥的私房菜 - 开机流程、程序与安装软件 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos8/0210filemanager.php)
- Arch Wiki - System maintenance — [wiki.archlinux.org](https://wiki.archlinux.org/title/System_maintenance)
- Arch Wiki - General recommendations — [wiki.archlinux.org](https://wiki.archlinux.org/title/General_recommendations)
- `man uname`、`man lscpu`、`man lsblk`、`man df`、`man du`、`man ip`
- uname(1) 手册页 — [man7.org](https://man7.org/linux/man-pages/man1/uname.1.html)
- lscpu(1) 手册页 — [man7.org](https://man7.org/linux/man-pages/man1/lscpu.1.html)
- /proc 文件系统文档 — [kernel.org](https://www.kernel.org/doc/html/latest/filesystems/proc.html)
