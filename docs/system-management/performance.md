# 性能优化

"服务器变慢了"是运维中最模糊的一句抱怨，也是性能页要解决的核心问题：
把模糊的体感翻译成**有证据的结论**（瓶颈在 CPU、内存还是磁盘 IO），
然后才谈得上调优。
本页的立场写在最前面：**观测优先于调优**——
没有基线、没有对照、没有复现路径的"优化"，
本质是拿生产环境做随机实验。

> 方法论参考自 Brendan Gregg 的 USE 方法与 Arch Wiki、
> RHEL 性能文档，见文末参考资料；
> 单条命令的语法与输出列含义见
> [命令篇 · 系统管理](../commands/system.md)，本页不重复展开。

## 学习目标

- 理解为什么"先观测、再假设、最后才动手"，以及反着做的代价
- 掌握"负载 / 内存 / IO"三角的判定路径，会用最少的命令走完一轮筛查
- 纠正常见误读：`load average` 不是 CPU%、`available` 才是内存答案
- 会用 USE 方法把资源逐项过一遍，把"感觉慢"变成一张填了值的表
- 在有证据之后再做调优，并知道哪些"经典调优"其实是坑
- 掌握三发行版（Debian/Ubuntu、Arch、RHEL/CentOS/Rocky）观测工具的安装差异

## 1. 为什么观测优先于调优

调优失败几乎都源于同一个错误顺序：
**先改参数，再看有没有效果，最后（往往来不及）搞清楚当初问题是什么**。
常见场景是把 `vm.swappiness` 从 60 改成 10、把 I/O 调度器换成 `deadline`、
关掉某些服务，然后宣布"快多了"。
这些操作各自都可能是对的，但没有测量时，
你无法回答三个问题：瓶颈真的是内存吗、改善是参数带来的还是流量回落带来的、
改动有没有引入新问题。

观测优先之所以是纪律而不仅是技巧，因为它同时解决三件事：

1. **定位**。系统变慢的原因分布极广——
   一次没跑完的 `apt upgrade` 留下的 dpkg/apt 后台进程、
   一个写满磁盘的日志、一次 NFS 挂载超时、
   甚至是一次内核 OOM kill 重启循环，
   表象都是"卡"。只有测量能把假设收敛到一条排查路径上。
2. **建立基线**。不知道平时 CPU 峰值是 30% 还是 70%，
   就无法判断今天的 80% 是否异常。
   基线也是给容量规划和告警阈值定线的唯一依据。
3. **验证与回滚**。任何调优都是一次实验：
   有前后对照的数据，才能证明改动有效；
   一旦恶化，也能量化恶化程度并果断回滚。

Brendan Gregg 把这套顺序总结为一句话：
先用便宜的工具回答"是哪类资源的问题"（USE 方法，见第 5 节），
再用昂贵的工具（perf、bcc 系追踪）下钻到具体代码路径，
最后才考虑改配置或改代码。
本页的章节顺序就是这条路径的落地。

## 2. 负载、内存、IO：性能判定的三角

绝大多数"机器慢"最终落在三个方向之一。
三者互相牵连（IO 等待会推高负载，内存耗尽会引发换页拖垮 IO），
所以排查必须**交叉验证**而不是单指标定罪：

- **负载（Load）高**：说明有任务在排队或阻塞。
  但负载高 ≠ CPU 不够用——它同样可能是磁盘等待造成的
  （详见第 4 节的误读辨析）。
- **内存（Memory）紧**：看 `available` 是否持续偏低、
  `vmstat` 的 `si/so` 是否持续非零。
  换页一旦持续，系统进入颠簸（thrashing），体感就是"什么都打不开"。
- **IO 繁忙**：看 `iostat -x` 的 `%util`、`await` 与队列长度。
  顺序读写尚可的盘，被随机小 IO 打满是数据库类业务的典型瓶颈。

一轮快速筛查只需要三步，顺序固定：

```bash
# 第一步：看负载与 CPU 分布——高负载时先分清是算力还是等待
$ uptime
 10:30:00 up 12 days,  3:21,  1 user,  load average: 6.52, 4.10, 3.05

$ mpstat -P ALL 1
10:31:05  CPU    %usr   %nice    %sys %iowait    %irq   %soft  %steal   %idle
10:31:06  all  45.10    0.00    3.20   28.50    0.00    0.50    0.00   22.70
10:31:06   0  44.00    0.00    3.00   30.00    0.00    1.00    0.00   22.00
10:31:06   1  46.20    0.00    3.40   27.00    0.00    0.00    0.00   23.40
```

`%iowait` 占到两三成，说明相当一部分"CPU 空闲"其实在等磁盘，
此时矛头应指向 IO；若 `%usr` 打满而 `%iowait` 接近 0，才是 CPU 瓶颈。

```bash
# 第二步：看内存——只认 available，不认 free
$ free -h
               total        used        free      shared  buff/cache   available
Mem:            15Gi       6.2Gi       512Mi       256Mi       8.6Gi       8.5Gi
Swap:          2.0Gi       128Mi       1.9Gi

$ vmstat 1 3
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd     free    buff   cache   si   so    bi    bo   in   cs us sy id wa st
 2  1  131072  524288  102400 8808448    0   12    10   120  850 1600 45  3 22 30  0
 3  0  131072  518144  102400 8812672   48    0   512   980  920 1750 48  3 19 30  0
 2  2  131072  515072  102400 8815104   52    0   540  1024  940 1780 47  4 18 31  0
```

`si/so` 持续非零才是真换页压力；偶尔一笔属正常冷页换出。
`available` 的判定标准与常见误读见第 4 节。

```bash
# 第三步：看磁盘——%util 高说明盘忙，await 高说明每次请求都慢
$ iostat -x 1
Device  r/s     w/s    rkB/s    wkB/s  await aqu-sz  %util
sda     12.00  320.00   48.00  4096.00  8.50   2.84  65.20
nvme0n1  0.00    0.00    0.00     0.00  0.00   0.00   0.00
```

不同 sysstat 版本的列名略有差异：`aqu-sz` 与 `avgqu-sz` 是同一列的两种写法，
含义相同——平均请求队列长度，以你机器上 `iostat -x` 的实际输出为准。

三角走完，结论通常已经能落到"CPU 批处理太猛"、
"内存开始换页"、"这块盘被打满"三者之一；
再用 `pidstat`、`iotop`、`top` 定位到具体进程。
网络方向的观测（`iftop`、`nethogs`、`ss -s`）
在网络篇与命令篇已有专页，此处不展开。

## 3. 观测工具速览

工具本身是查表可得的，这里只强调各自"回答什么问题"：

| 问题 | 首选工具 | 说明 |
|------|---------|------|
| 现在排队多久了 | `uptime`、`top` 首行 | load 三条线的趋势比单点数值重要 |
| CPU 花在哪了 | `mpstat -P ALL 1` | 区分 us/sy/wa/hi，见第 2 节第一步 |
| 谁在吃 CPU/内存 | `top`/`htop`、`ps aux --sort=-%mem` | 批处理抓取用 `top -b -n 1` |
| 内存还够不够 | `free -h` 看 `available`；`vmstat` 看 si/so | 列含义详见[内存管理](../commands/system/memory.md) |
| 磁盘谁在打 | `iostat -x 1`、`iotop` | `%util` 高与 `await` 高是两种病 |
| 历史发生了什么 | `sar -u`、`sar -q`、`sar -d` | 依赖 sysstat 采集已开启，见第 6 节 |
| 网络流量与连接 | `iftop`、`nethogs`、`ss -s` | 见[网络监控](../network/network-monitoring.md) |
| 深挖到具体调用 | `perf top`、bcc 工具（`execsnoop` 等） | 贵、有开销，放在三角筛查之后 |

`mpstat`、`iostat`、`pidstat`、`sar` 全部来自同一个包 **sysstat**，
三系安装对照见第 6 节；
需要"到底哪个系统调用在耗时"这类问题时，
再安装 bcc 系动态追踪工具（Debian 系工具名带 `-bpfcc` 后缀）。

## 4. 常见误读

### 4.1 load average 不是 CPU 使用率

`load average` 统计的是**运行态 + 不可中断睡眠（D 状态）**的任务数，
后者绝大多数在等 IO。因此它天然混合了"CPU 排队"和"磁盘排队"两种病因，
把它直接换算成"CPU 百分比"必然误判：

- 8 核机器 load 6.5：在线内，未必有问题；
  持续超过核数才说明任务在排队。
- load 20 而 `mpstat` 的 `%us` 只有 40%、`%iowait` 很高：
  瓶颈是磁盘，加 CPU 无济于事。
- load 与 CPU% 的对照读法、三条线的趋势含义，
  [命令篇 · 系统管理](../commands/system.md)的常见问题有完整推导，
  这里只给结论：**load 回答"有多少任务在等"，CPU% 回答"算力花在哪"，
  两者必须并排看**。

### 4.2 available 才是内存答案，不是 free

`free -h` 里 `free` 列长期偏低是**健康状态**：
Linux 会把暂时用不到的内存做成页缓存加速磁盘读写，
进程申请时缓存立刻让出。判断"还够不够"只看 `available`——
它是内核估算的"可立刻分配给新进程"的内存量。
`available` 与 `free` 的逐列拆解、swappiness 的真实含义、
OOM 的触发链路，都在
[命令篇 · 内存管理](../commands/system/memory.md)有专节，
本页不重复，只保留这条判定规则：

> `available` 持续低于你给业务留的安全水位（如总量的 10%–15%），
> **且** `vmstat` 的 `si/so` 持续非零，才需要考虑加内存或查泄漏；
> 只是 `free` 低、`buff/cache` 高，什么都不用做。

### 4.3 top 的 %MEM 加起来超 100% 是正常的

共享库按每个进程的 RSS 重复计入，单进程视角看没问题；
整机内存永远以 `free` 的 `available` 为准。
同理，`top` 里 `%us` 高是应用问题、`%sy` 高是系统调用过频、
`%wa` 高是磁盘瓶颈——都叫"CPU 高"，结论完全不同。

### 4.4 清缓存"提性能"是伪需求

随手 `echo 3 > /proc/sys/vm/drop_caches` 只会制造一次冷缓存风暴，
让接下来的访问更慢。它只在两种场景有意义：
跑基准测试前消除冷热差异、或确认某次 IO 测试不被缓存干扰。
生产环境把它当"优化手段"是把症状当病治。

## 5. USE 方法：把资源逐项过一遍

USE（Utilization 使用率、Saturation 饱和度、Errors 错误）
是 Brendan Gregg 推荐的检查清单式方法：
对每种资源问同样三个问题，任何一个非零都要能解释。
它不是新工具，而是**保证不漏项的流程**：

| 资源 | 使用率 | 饱和度 | 错误 |
|------|--------|--------|------|
| CPU | `mpstat` 的 us+sy+st | `vmstat` 的 `r` 列（运行队列） | `perf`、`dmesg` 里的异常 |
| 内存 | `free` 的 used 占比 | `vmstat` 的 `si/so`（换页） | `dmesg` 的 OOM 记录 |
| 磁盘 | `iostat -x` 的 `%util` | `aqu-sz`（队列长度） | `smartctl -a`、`dmesg` 的 I/O error |
| 网络 | `ip -s link` 收发速率 | `ss -s` 的重传/积压 | `ip -s link` 的 errors/drops |

实操顺序建议：先用第 2 节的三角快速筛一遍，
锁定嫌疑资源后再用 USE 表把它三项填满，
最后才动用 `pidstat -d 1`、`bcc` 工具下钻到进程与函数。
常见坑是跳过前两步直接上 `perf top`——
火焰图很漂亮，但解释不了"为什么现在要看这个进程"。

## 6. 三系工具安装对照

观测工具在三大发行版的包名与"装完是否在工作"状态差异不小，
这是本页最容易踩坑的地方：

| 工具 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| sysstat（iostat/sar/mpstat） | `sudo apt install sysstat` | `sudo pacman -S sysstat` | `sudo dnf install sysstat` |
| bcc 动态追踪工具集 | `sudo apt install bpfcc-tools`（命令带 `-bpfcc` 后缀） | `sudo pacman -S bcc bcc-libbpf-tools` | `sudo dnf install bcc-tools`，装前 `dnf search bcc` 核实包名 |
| bpftrace 高级追踪 | `sudo apt install bpftrace` | `sudo pacman -S bpftrace` | `sudo dnf install bpftrace` |
| htop / iotop 实时查看 | `sudo apt install htop iotop` | `sudo pacman -S htop iotop` | `sudo dnf install htop iotop` |
| cpupower（调频查看） | `sudo apt install linux-tools-common linux-tools-$(uname -r)` | `sudo pacman -S cpupower` | `sudo dnf install kernel-tools` |

三点必须知道的细节：

**sysstat 装完不等于 `sar` 有历史数据**。
Debian/Ubuntu 默认在 `/etc/default/sysstat` 里写 `ENABLED="false"`，
要改为 `true` 并 `sudo systemctl enable --now sysstat` 才开始采集；
Arch 的采集配置在 `/etc/conf.d/sysstat`，RHEL 系的在 `/etc/sysconfig/sysstat`，
装完都建议确认一遍开关。
数据目录三系也不同：Debian/Ubuntu 是 `/var/log/sysstat/`，
Arch 与 RHEL 系是 `/var/log/sa/`，
`sar -q`、`sar -u` 查不到东西时先分清自己在哪一系。

**bcc 工具三系叫法不统一**。
Debian/Ubuntu 用 `bpfcc` 命名且命令带后缀（`execsnoop-bpfcc`）；
Arch 拆成 `bcc` 库与 `bcc-libbpf-tools` 工具集；
RHEL 系历史上叫 `bcc-tools`。
安装前用 `pacman -Ss bcc`、`apt search bpfcc`、`dnf search bcc`
各搜一次，是三系通用的习惯，
不确定的包名宁可现场搜也不凭记忆敲。

**动态追踪需要内核配合**。
bcc/bpftrace 依赖内核 BPF 能力与对应头文件/内核参数，
容器与部分云主机镜像可能裁剪了相关配置；
报 `Operation not permitted` 或缺少 header 时，
先确认 `uname -r` 对应的内核头文件已安装，再怀疑代码问题。

## 7. 有证据之后：调优的基本纪律

以下操作都属于"确认瓶颈后"的动作，顺序比参数本身更重要：

### CPU 调频策略

```bash
# 查看当前策略（powersave/schedutil/performance 因发行版与驱动而异）
$ cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
schedutil

# 需要持续满频的场景（如数据库裸金属）再切 performance
$ sudo cpupower frequency-set -g performance
```

笔记本/云主机默认的 `schedutil` 或 `powersave` 通常是合理选择，
把办公机长期钉在 `performance` 只会换风扇噪音，
不会让编译快过"本来就瓶颈在磁盘"的场景。

### 内存参数

`vm.swappiness` 的语义是"回收时偏向换出匿名页的程度"而非"是否用 swap"，
0 也不等于永不换出。
只有在 `si/so` 持续非零、`available` 常期贴地被证实后才值得调整；
持久化写入 `/etc/sysctl.d/99-*.conf` 而不是追加老教程里的 `/etc/sysctl.conf`，
改完 `sysctl --system` 验证——
逐列解释与完整推导见[内存管理](../commands/system/memory.md)。

### 磁盘与调度器

```bash
# 查看当前调度器
$ cat /sys/block/sda/queue/scheduler
[mq-deadline] kyber bfq none
```

SSD/NVMe 上默认的 `mq-deadline` 或 `none`（多队列直通）通常无需改动；
`bfq` 更适合桌面交互式负载。
换调度器是**运行时可随时回写**的低风险操作，
但收益也常常接近于零——先用 `iostat` 证明排队问题存在再动手。
文件系统选型（大文件流水用 XFS、通用 ext4）属于部署期决策，
运行中换文件系统不在本页范围。

## 8. 常见坑

1. **只有一个采样点就下结论**。
   `top` 按下的那一刻可能正好是 GC、备份或 apt 更新的尖峰；
   至少看 1 分钟趋势（`mpstat 1 10`）或 15 分钟负载线再判断。
2. **把 load 高直接翻译成"CPU 不够"**。
   先看 `%iowait` 与 `iostat`，见 4.1 节——
   这是本页收录的两个经典误读之一，另一个是把 `free` 当内存答案。
3. **在没有备份的情况下改内核参数/调度器**。
   调优属于可回滚实验，前提是知道怎么回滚；
   回滚能力来自[备份与恢复](./backup-and-recovery.md)，
   两条纪律在本篇是配套的。
4. **sysstat 装了却查不到历史**。
   采集开关没打开（Debian 系默认关），
   现场排查时打开只能从当下开始积累，回看不了"昨晚发生了什么"。
   新机器到手第一件事就该把采集打开，详见 6 节。
5. **凭网络文章的参数清单批量照抄**。
   swappiness、调度器、read-ahead、NR_OPEN……
   不同内核版本与硬件的行为差异很大，
   每一项都要能回答"我解决了哪个被测量出来的问题"，
   答不上来就不要改。
6. **观测工具本身把机器拖慢**。
   `iostat 0.1`、过多的 `sar` 采样、常驻的高开销追踪都有成本；
   生产环境采样间隔从 1 秒起步即可，
   动态追踪工具用完即关。

## 参考资料

- Brendan Gregg - Linux Performance (USE method, methodology) — [brendangregg.com](https://www.brendangregg.com/linuxperf.html)
- Arch Wiki - Improving performance — [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- Red Hat - Monitoring and managing system status and performance — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/index)
- sysstat 官方文档（iostat/mpstat/pidstat/sar） — [github.com](https://github.com/sysstat/sysstat)
- BCC 工具集（动态追踪） — [github.com](https://github.com/iovisor/bcc)
- bpftrace — [github.com](https://github.com/bpftrace/bpftrace)
- 鸟哥的私房菜 - 程序观察与管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0440processcontrol.php)
- [命令篇 · 系统管理](../commands/system.md)（命令语法与输出列速查）
- [命令篇 · 内存管理](../commands/system/memory.md)（available/swappiness/OOM 专节）
- `man mpstat`、`man iostat`、`man vmstat`、`man sar`、`man pidstat`
