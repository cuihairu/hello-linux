# 系统监控工具

监控的目的不是"收集更多数字"，而是在业务变慢之前回答三个问题：**CPU 还剩多少余量、内存有没有在换页、磁盘和网卡谁先成为瓶颈**。工具本身三系高度一致，真正的分水岭在于——你是否知道每个读数的含义，以及**看到什么才算异常**。

> 内容参考自 procps-ng、sysstat 手册、Brendan Gregg 方法论与 Arch Wiki，见文末参考资料。

## 学习目标

- 分清 top/htop（实时交互）、vmstat/iostat/mpstat（采样）、sar（历史）的分工
- 读懂 vmstat、iostat、mpstat、sar 关键列，建立"异常阈值"直觉
- 掌握 sysstat 三系安装与采集启用（含 Arch 的 pacman 与 systemd timer）
- 能按"负载 → CPU → 内存 → IO"顺序做一次完整体检

## 1. 选型：瞬时、采样还是历史

把工具按时间能力排成三档，排查时先选档再选命令：

| 档位 | 工具 | 回答的问题 | 局限 |
|------|------|-----------|------|
| 瞬时交互 | `top`、`htop` | 此刻谁最忙 | 没有历史，关掉即失 |
| 周期采样 | `vmstat`、`iostat`、`mpstat`、`pidstat` | 一段时间内各子系统是否饱和 | 只覆盖你人肉守着的窗口 |
| 持久历史 | `sar`（sysstat） | 昨天下午 3 点内存什么样 | 需提前安装并启用采集 |
| 动态追踪 | `bpftrace`/perf | 具体哪个函数/调用路径导致热点 | 门槛高，生产慎用 |

典型排障顺序：`uptime`/`top` 看负载 → `vmstat 1` 分 CPU/内存/IO 大类 → `iostat -x 1`/`mpstat -P ALL 1` 锁定设备或某一颗核 → 必要时 `pidstat`/`htop` 落到进程 → 翻 `sar` 找"什么时候开始变坏的"。

## 2. top：实时进程与头部概况

### 2.1 为什么先看 top 头部

进程列表之前有五行系统概况，**大部分误判死在不读头部**：

```bash
$ top
top - 14:02:11 up 12 days,  1 load average: 6.52, 4.10, 3.05
Tasks: 182 total,   2 running, 180 sleeping,   0 stopped,   0 zombie
%Cpu(s): 25.0 us, 10.5 sy,  0.0 ni, 55.2 id,  8.9 wa,  0.0 hi,  0.4 si,  0.0 st
MiB Mem :   7800.0 total,   400.0 free,   6100.0 used,   1300.0 buff/cache
MiB Swap:   2048.0 total,   1024.0 free,   1024.0 used.    900.0 avail Mem
```

读法与异常信号：

- **load average**：1/5/15 分钟。与 `CPU(s)` 核数比较——8 核时 6.5 仍在线内；持续大于核数 = 任务在排队。三条线一起升是持续压力，只有 1 分钟高多为尖峰。
- **%Cpu(s)**：`us`（用户态）高 → 应用在算；`sy` 高 → 系统调用/内核态过重（频繁 `sy` + 低 `us` 要查 `strace`/锁竞争）；`wa` 持续高且磁盘忙 → IO 瓶颈；`st` 持续 > 0 → 虚拟机被宿主机抢占，找云厂商或缩超售。
- **内存行**：`free` 低不慌，看 `avail Mem`；已用 swap 持续增长才结合 si/so 判断（见第 4 节与[内存管理](./memory.md)）。
- **zombie**：长期非 0 找父进程收尸，见[进程管理](./process.md)。

常用键：`P` CPU 排序、`M` 内存排序、`1` 每核展开、`k` 发信号、`q` 退出。脚本取数用 `top -bn1`（`-b` 批处理才适合 `grep`/`awk`）。

### 2.2 top 的局限

`top` 默认按采样间隔给平均值，几秒内的尖峰可能被抹平；`%MEM` 基于 RSS，共享库重复计算。跨机对比、出报表时更推荐 `vmstat`/`pidstat`/`sar` 的机器可读输出。

## 3. htop：交互增强与安装

`htop` 提供彩色条、鼠标、树视图（`F5`）、过滤（`F4`）、`F9` 菜单发信号，巡检体验优于 `top`，但**不是预装**：

```bash
sudo apt install htop      # Debian/Ubuntu
sudo pacman -S htop        # Arch
sudo dnf install htop      # RHEL/CentOS/Rocky
```

Arch 请在系统完整升级（`sudo pacman -Syu`）之后再装，避免 partial upgrade。顶部双条分别对应 CPU 与内存，颜色即状态（绿=正常，红=危险）；与 `top` 相同的数据源，选择纯属交互偏好。服务器可装后作为默认巡检入口，脚本仍用可管道的 `top -bn1` 或 `ps`。

## 4. vmstat：一行看清 CPU / 内存 / IO 分工

### 4.1 用法与首行陷阱

```bash
$ vmstat 1 5
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
  r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
  2  0 512000 400000 100000 800000  10   50   200   400  1500 3000 20  5 60 10  0
  0  0 512000 398000 100000 802000   0    0    10    20  1200 2500  8  2 90  0  0
```

语法 `vmstat [间隔秒] [次数]`。**第一行数字是自开机以来的平均值**，从第二行起才是间隔内的真实采样——下结论请从第二行开始。

### 4.2 列含义与"看到什么算异常"

| 区域 | 列 | 含义 | 异常判读 |
|------|----|------|----------|
| procs | r | 等待运行的进程数 | **持续 > CPU 核数** → CPU 排队、调度饱和 |
| procs | b | 不可中断睡眠（多为等 IO） | **持续 ≥ 1** → 进程卡在磁盘/驱动 |
| memory | swpd | 已用 swap（KB） | 单独看无意义，结合 si/so |
| memory | free/buff/cache | 空闲与缓存 | free 低本身不异常 |
| swap | si / so | 每秒换入/换出 KB | **持续非 0** → 内存压力、可能颠簸 |
| io | bi / bo | 每秒块设备读/写 KB | 与业务预期对照；突发写要看是否该时段备份 |
| system | in / cs | 中断/上下文切换每秒 | `cs` 异常高（数十万级）且 CPU `sy` 高 → 过度切换（线程模型/锁竞争） |
| cpu | us / sy / id / wa / st | 用户/系统/空闲/等 IO/被抢占 | `id` 长期 < 5% 且 `r` > 核数 → CPU 满；`wa` 持续高 → IO；`st` > 0 → 宿主机干扰 |

一组"健康 vs 病态"直觉：健康机器多数时刻 `r` ≤ 核数、`si/so≈0`、`b=0`、`id` 有余量；数据库备份窗口 `bo` 与 `wa` 同步升高可以解释，**非窗口期仍高**才算事故。

## 5. iostat：磁盘是否成为瓶颈

### 5.1 安装（sysstat 三系对照）

`iostat`/`mpstat`/`sar` 同属 **sysstat** 包，三系安装命令不同，这是监控篇必须记住的三条：

```bash
sudo apt install sysstat     # Debian/Ubuntu（apt）
sudo pacman -S sysstat       # Arch（pacman）
sudo dnf install sysstat     # RHEL/CentOS/Rocky（dnf）
```

Arch 安装后由随包 **systemd timer**（`sysstat-collect.timer` 等）负责周期采集，`systemctl status sysstat-collect.timer` 应为 active；Debian/Ubuntu 还需在 `/etc/default/sysstat` 设 `ENABLED="true"`，否则 `sar` 没有历史数据。装好先 `iostat -x 1 3` 验证命令存在。

### 5.2 用法与输出

```bash
$ iostat -x 1 3
Linux 6.8.0-45-generic (web01) 	09/22/2026 	_x86_64_	(4 CPU)

avg-cpu:  %user   %nice %system %iowait  %steal   %idle
           3.10    0.00    1.20    4.50    0.00   91.20

Device            r/s     w/s    rkB/s    wkB/s   rareq-sz  wareq-sz  await  %util
sda              5.00   20.00    80.00   400.00     16.00     20.00   2.50  15.00
nvme0n1         80.00   10.00  1200.00   100.00     15.00     10.00   0.40  25.00
```

不带 `-x` 时只有 `tps`、`kB_read/s`、`kB_wrtn/s` 基础吞吐；排障请始终加 **`-x`**。同样注意：不带间隔参数或**首个报告**含自开机以来的平均，连续观察看第二段以后。

### 5.3 关键列与异常

| 列 | 含义 | 异常判读 |
|----|------|----------|
| r/s、w/s（tps） | 每秒读写请求次数 | 与应用行为对照；无业务却很高 → 后台任务/日志风暴 |
| rareq-sz / wareq-sz | 平均请求大小（扇区/字节档） | 很小的随机写多 → 小 IO 碎片，考虑合并或换 SSD |
| await / r_await / w_await | 平均等待时间（含排队，ms） | 机械盘持续 > 20–30ms、SSD 持续 > 数 ms 且与基线比明显升高 → 关注 |
| aqu-sz（新版 iostat） | 平均队列长度 | 持续 ≥ 1–2 且 await 升 → 设备在排队 |
| %util | 设备有请求的时间占比 | **单队列**设备接近 100% → 饱和；**NVMe/多队列**设备 %util 很高也可能远未饱和，须结合 await 与队列长度 |

`%util` 是被误解最多的列：它表示"至少有一个 IO 在跑的时间比例"，不表示带宽用满。RAID、NVMe、多队列设备上单看 %util 会误判，Brendan Gregg 与 iostat 手册都强调要与 await、aqu-sz 联读。`avg-cpu` 的 `%iowait` 与 `vmstat` 的 `wa` 同源，解读同样保守——iowait 在空闲核多时可能虚高，**磁盘慢不慢以设备列为准**。

## 6. mpstat：每一颗 CPU 都单独体检

`vmstat`/`top` 给的是全机 CPU 汇总，**单线程应用打满一核**时汇总看起来仍有空闲——`mpstat` 按核拆开看：

```bash
$ mpstat -P ALL 1 3
14:05:01  CPU    %usr   %sys  %iowait   %irq  %soft  %steal  %guest  %idle
14:05:02  all   12.50   3.00     1.00   0.00   0.50    0.00    0.00   83.00
14:05:02    0   45.00   8.00     2.00   0.00   1.00    0.00    0.00   44.00
14:05:02    1    2.00   1.00     0.00   0.00   0.00    0.00    0.00   97.00
14:05:02    2    3.00   2.00     2.00   0.00   1.00    0.00    0.00   92.00
14:05:02    3    1.00   1.00     0.00   0.00   0.00    0.00    0.00   97.00
```

（安装与 `iostat` 相同，同属 sysstat；首行之后才是间隔采样。）

读法与异常：

- **某一颗 `%idle` 持续接近 0，其余核大量 idle** → 单线程瓶颈或 CPU 亲和性绑核；应用层要水平拆分，或查 `taskset`/cgroup 限核是否误配。
- **`%iowait` 集中在少数核**：与 `iostat` 交叉验证磁盘。
- **`%soft`（软中断）持续高** → 网卡收包/时钟等中断处理吃 CPU，常见于高 pps 场景，考虑多队列/RPS 调优（进阶）。
- **`%steal` 高** → 与 `vmstat` 的 `st` 同一问题，虚拟化争用。
- **`%sys` 全核偏高、`%usr` 不高** → 系统调用过密或内核路径问题，下一步 `perf`/`strace -c`。

`mpstat -P ALL 1` 是判断"负载是全机的还是某一核的"最快的命令，四核以上机器强烈建议作为体检标配。

## 7. sar：把监控变成历史

### 7.1 为什么需要 sar

前面所有工具都是"你正好在场"。用户说"昨天下午开始变卡"，没有历史数据只能靠猜。**sar 采集并留存系统指标，是事后复盘的时间机器**（数据亦来自 sysstat 包）。

三系安装与启用差异：

| 项目 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 | `sudo apt install sysstat` | `sudo pacman -S sysstat` | `sudo dnf install sysstat` |
| 采集机制 | cron（`/etc/cron.d/sysstat`） | **systemd timer**（`sysstat-collect.timer` 等） | cron/服务脚本（`sysstat`） |
| 启用/配置 | `/etc/default/sysstat` 中 `ENABLED="true"` | 确认 timer：`systemctl enable --now sysstat-collect.timer` | `/etc/sysconfig/sysstat` 设 `HISTORY=28`（保留天数等） |
| 数据目录 | `/var/log/sysstat/` | `/var/log/sysstat/` | `/var/log/sysstat/` |
| 文件名 | `sa21`（二进制，sar 直接读）/ `sar21`（文本） | 同左 | 同左 |

Debian 系最常见的"装了 sar 却没有历史"就是忘了 `ENABLED="true"`；Arch 则要确认 timer 在跑。验证采集是否工作：`ls -l /var/log/sysstat/` 应出现当天的 `saDD` 文件。

```bash
$ sudo systemctl status sysstat-collect.timer    # Arch/RHEL 系 timer 视发行版而定
$ ls /var/log/sysstat/
sa21  sa22  sar21  sar22
```

### 7.2 常用读法

```bash
sar -u 1 5           # CPU 实时等价于连续采样
sar -u               # 今天（或当前小时）CPU 历史
sar -r               # 内存
sar -b               # IO 汇总
sar -d               # 各磁盘
sar -n DEV 1 5       # 网卡吞吐
sar -n EDEV          # 网卡错误/丢包
sar -q               # 运行队列与负载
sar -u -f /var/log/sysstat/sa21        # 指定日期（21 日）
sar -u -s 14:00:00 -e 15:00:00         # 指定时段
```

`-u` 的 `%usr/%sys/%iowait/%steal/%idle` 与 mpstat 同构；`-r` 的 `%memused` 注意各版本算法与 `free` 列不完全同一口径，跨工具对账时以趋势为主。`-n EDEV` 出现持续 `err/s`/`drop/s` → 网线/交换机/驱动/缓冲区问题。

### 7.3 "看到什么算异常"（sar 视角）

- `%idle` 工作时段长期 < 10%，且与负载曲线吻合 → CPU 容量紧。
- `%iowait` 非备份窗口持续 > 5–10% → 查磁盘与 `iostat -x`。
- `%steal` > 0 且稳定 → 虚拟化争用，评估迁移或投诉。
- `kbmemfree` 单调下降且 `kbswpused` 上升 → 内存泄漏或容量不足，对照[内存管理](./memory.md)。
- `rxpck/s` 突增、`drop/s` 同步升高 → 流量攻击或网卡缓冲不足。

没有基线就没有异常：上线第一周就启用 sar，攒够"正常长什么样"，之后用 `sar -u -f ...` 做对比才有意义。

## 8. 辅助命令：free、df、du、lsof、strace

与子系统专项工具配合的"快速三板斧"，详细原理见[内存管理](./memory.md)与[系统信息查看](./system_info.md)：

```bash
free -h                          # 内存：看 available
df -hT && df -i                  # 磁盘：容量 + inode
du -sh /var/log/* | sort -hr | head
lsof -p PID                      # 进程打开的文件/端口
lsof +L1                         # 已删除仍被持有的文件（df/du 差额）
strace -c -p PID                 # 系统调用计数（定位卡在哪类调用）
```

`strace -p` 会显著拖慢目标进程，生产上短时 attach 并告知业务方；比"进程在干什么"更上层的问题用 `perf top`/`bpftrace`。

## 9. bpftrace：动态追踪入门（含三系安装）

当问题从"哪个子系统慢"细化到"**哪个函数、哪条调用路径**慢"，采样工具不够时，eBPF 生态的 `bpftrace` 用几十行单行脚本即可内核态观测，无需重编译内核：

```bash
sudo apt install bpftrace     # Debian/Ubuntu（需较新内核与 root）
sudo pacman -S bpftrace       # Arch
sudo dnf install bpftrace     # RHEL/CentOS/Rocky
```

示意（统计各进程系统调用次数，`Ctrl+C` 结束）：

```bash
$ sudo bpftrace -e 'tracepoint:syscalls:sys_enter_* { @[comm] = count(); }'
```

再如跟踪进程打开文件、测量某探针时间差，官方 `tools/*.bt` 有现成脚本。使用门槛：内核 ≥ 约 4.9 且开启 BPF、需要 root、容器内通常要加特权。**定位顺序上永远先 top/vmstat/iostat 把范围缩到子系统**，bpftrace 是最后一层放大镜，不是第一把螺丝刀。

## 10. 实战：五分钟体检脚本

把高频命令按"负载 → CPU → 内存 → 磁盘 → 进程"串起来，输出可直接贴工单（各命令单行快照，适合 cron 采集与人工执行两用）：

```bash
#!/bin/bash
# health-check.sh — 单次系统体检快照
echo "===== $(date) ====="
uptime
echo; echo "--- CPU (vmstat 1 3, 行 2-3 为采样) ---"
vmstat 1 3
echo; echo "--- per-CPU ---"
mpstat -P ALL 1 2 | tail -n +4
echo; echo "--- Memory ---"
free -h
echo; echo "--- Disk ---"
df -hT -x tmpfs -x devtmpfs
iostat -x 1 2 | tail -n +4
echo; echo "--- Top CPU ---"
ps aux --sort=-%cpu | head -6
echo; echo "--- Top MEM ---"
ps aux --sort=-%mem | head -6
```

需要持续守护时，不要用 `while true` 空转轮询 top——用 `sar` 留历史 + 告警阈值（如磁盘 > 90%、`available` 过低、`sar -q` 负载持续超核数）。告警通道（邮件/webhook）依赖发行版是否带 `mail`、`bc` 等工具，最小化镜像往往没有，写脚本前先 `command -v` 确认，或改由 Prometheus 等采集（见[监控体系](../../server/monitoring/prometheus.md)）。阈值没有全球标准，**以本机基线 + 业务 SLO 为准**，先采一周再定线。

## 11. 常见坑

1. **拿 vmstat/iostat/mpstat 第一行下结论**。首行是开机以来平均；至少看第二行，或 `vmstat 1 5` 取后四行。
2. **%util 高就断言磁盘满了/坏了**。多队列设备 util 高很正常；看 `await`/`aqu-sz` 与基线。
3. **iowait 高就怪机械盘**。iowait 口径受调度与空闲统计影响，用 `iostat -x` 的设备列确认。
4. **装了 sysstat 却没有 sar 数据**。Debian 查 `ENABLED="true"`；Arch 查 `sysstat-collect.timer` 是否 active；Rocky 查 `/etc/sysconfig/sysstat`。
5. **Arch 上只 `pacman -Sy` 后装 sysstat**。partial upgrade 可能装出依赖不匹配；用 `pacman -Syu sysstat` 或先全量升级。
6. **load 高就加 CPU**。先 `vmstat` 看 `r` 与 `wa`——IO 饱和同样抬 load，加 CPU 无效。
7. **top 的 %MEM 加起来超 100%**。共享库按 RSS 重复计算，属正常；整机内存看 `free` 的 available。
8. **swap 一用就当事故**。冷页换出正常，看 si/so 是否持续非零（详见[内存管理](./memory.md)）。
9. **`st` 不为 0 没人管**。虚拟机 steal 持续存在=宿主机超售或降配，应用层怎么调优都补不回来。
10. **只监控不留基线**。没开 sysstat 就没法回答"什么时候开始变的"；采集要与告警同日上线。

## 参考资料

- sysstat 手册与 sar 指南 — [sysstat.github.io](https://sysstat.github.io/)
- procps-ng（top/free/vmstat） — [gitlab.com/procps-ng/procps](https://gitlab.com/procps-ng/procps)
- Brendan Gregg - Linux Performance Methods / USE Method — [brendangregg.com](https://www.brendangregg.com/linuxperf.html)
- Arch Wiki - Process management / BPFTrace — [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- iostat(1)、mpstat(1)、sar(1)、vmstat(8)、top(1) 手册页 — [man7.org](https://man7.org/linux/man-pages/)
- 用 USE 方法找瓶颈（Brendan Gregg） — [brendangregg.com/usemethod.html](https://www.brendangregg.com/usemethod.html)
- Prometheus 监控体系（长期方案） — [server/monitoring/prometheus.md](../../server/monitoring/prometheus.md)
