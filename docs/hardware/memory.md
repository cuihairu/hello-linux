# 内存

"内存不够了"是新手最容易误判的一类告警：`free` 里 `free` 列很小，不代表机器快挂了；swap 动了几 MB，也不代表出了大问题；进程被 `Killed`，罪魁祸首未必是物理内存不够。内存篇要解决的正是这三件事——先理解内核如何用页表把物理 DRAM 组织成进程眼中的虚拟内存，再学会读 `free`/`vmstat` 的真实含义，最后才是 Swap、大页与 NUMA 这些进阶话题。概念对了，告警数字才有意义；概念错了，你会在风平浪静的机器上空转紧张。

> 内容参考自鸟哥的私房菜、Arch Wiki、JEDEC 标准与 Linux 内核文档，见文末参考资料。

## 学习目标

- 理解 DRAM 的刷新与组织方式，能解释 DDR4/DDR5 关键参数与带宽计算
- 建立虚拟内存与页表的心智模型，分清缺页、swap、OOM 三件不同的事
- 精确判读 `free` 与 `vmstat` 的每个字段，知道何时才需要紧张
- 掌握 OOM Killer 的日志定位与 `oom_score_adj` 调节，理解 cgroup 限额这一"隐形墙"
- 会配置 Swap 与大页，建立 NUMA 内存分配的入门视角（拓扑概念见 [CPU 章](./cpu.md)）

## 1. 内存工作原理

### 1.1 DRAM 基础

DRAM（Dynamic Random-Access Memory）是现代计算机主存的主流技术，三个特性决定了它的一切行为：每个 bit 存在一个**会漏电的电容**里，因此需要周期性**刷新（Refresh）**；读取是**破坏性**的，读后必须回写；随机访问很快（约 100 ns），但比 SRAM 缓存慢两个数量级（见[体系结构章](./architecture.md)的存储层次）。刷新意味着 DRAM 有固定的后台开销，也意味着"内存条坏了一个 bit"是会真实发生的事件——ECC 就是为此而生（第 5 节）。

### 1.2 内存条的组织

```
┌─────────────────────────────────┐
│           内存条 (DIMM)          │
│  ┌─────┐ ┌─────┐ ┌─────┐       │
│  │Rank0│ │Rank1│ │Rank2│       │
│  └──┬──┘ └──┬──┘ └──┬──┘       │
│  ┌──┴───────┴───────┴──┐       │
│  │   内存芯片 (DRAM)     │       │
│  └──────────────────────┘       │
└─────────────────────────────────┘
```

| 概念 | 说明 | 排障意义 |
|------|------|---------|
| Rank | 内存条上一组协同工作的芯片 | 插法不当会降频；Rank 数影响兼容性 |
| Bank | 芯片内的存储阵列 | 深度与行命中率相关，普通运维无需深究 |
| Row/Column | Bank 内的行列地址 | 行激活开销是延迟的组成 |
| CL（CAS Latency） | 列选通延迟 | 与频率一起构成"时序"，标称对比用 |

### 1.3 查看内存条规格

```bash
# 固件视角：容量、类型、频率、是否 ECC（需 root）
sudo dmidecode -t memory | grep -E "Size:|Type:|Speed:|Error Correction" | head -8
# Error Correction Type: Multi-bit ECC   ← 服务器常见；None = 非 ECC
# Size: 16 GB / Type: DDR4 / Speed: 3200 MT/s
```

内存条层面的硬件信息归本节，"系统还剩多少可用"的软件视角归第 6 节——两者经常被混为一谈，是本篇要拆开的第一组概念。

## 2. DDR 代际与带宽

### 2.1 代际对比

| 参数 | DDR3 | DDR4 | DDR5 |
|------|------|------|------|
| 电压 | 1.5 V | 1.2 V | 1.1 V |
| 频率范围（MT/s） | 800-2133 | 2133-5333 | 4800-8400+ |
| 预取 | 8n | 8n | 16n |
| 单条最大容量 | 16 GB | 64 GB | 128 GB |
| 发布年份 | 2007 | 2014 | 2020 |

代际之间**物理上互不兼容**（缺口位置不同），插错代的条子根本按不下去——买内存前先用 `dmidecode -t memory` 确认现有代际。频率单位注意：内存标称的 3200 实际是 MT/s（每秒百万次传输），换算带宽时按 3200×10⁶ 次/s × 64 bit 理解即可。

### 2.2 带宽计算

```
理论带宽 = 有效速率 × 数据总线宽度 × 通道数 ÷ 8

DDR4-3200 双通道：
= 3200 MT/s × 64 bit × 2 / 8
= 51.2 GB/s
```

对运维的实际用途：内存带宽密集型负载（大数据 shuffle、某些数据库全表扫描）在**单通道**下会损失约一半带宽。升级内存时**插法比容量更致命**——两条 8 GB 组双通道优于一条 16 GB 单通道，四插槽主板还要对照主板手册的优先槽位（通常先插 A2/B2，以手册为准）。确认拓扑可用 `hwloc` 的 `lstopo`（Debian/Ubuntu `apt install hwloc`、Arch `pacman -S hwloc`、RHEL `dnf install hwloc`，安装对照见第 10 节）：无图形环境用 `lstopo-no-graphics` 输出文字版拓扑树，能看到每个 NUMA 节点挂了哪些核与内存，是核对"通道/节点是否如预期"的直观工具。

## 3. 虚拟内存与页表

### 3.1 为什么需要虚拟内存

冯·诺依曼结构里指令与数据同在内存（见[体系结构章](./architecture.md)），但现代 OS 不让进程直接碰物理地址：每个进程拿到一套**虚拟地址空间**，由内核维护虚拟→物理的翻译表——**页表**。这一层带来三个根本能力：进程隔离（各自的页表互不可见）、地址重定位（程序不必关心加载到哪段物理内存）、共享（多个进程映射同一份共享库或文件页）。你今天看到的 ASLR、共享内存、`mmap`、core dump，全都建立在这层翻译上。

### 3.2 页、多级页表与 TLB

x86-64 上基本页大小是 **4 KB**；虚拟地址被拆成多级索引（经典 4 级，较新硬件可开 5 级），逐级查表直到命中物理页。为了不为每个 4 KB 都存完整映射，内核用多级+按需建页的方式节省页表本身的空间；硬件则用 **TLB**（地址翻译缓存）加速——TLB 命中接近零开销，未命中要走多级查表（还可能触发页错误）。

**缺页异常（page fault）**因此分两种，`vmstat` 里对应两个字段（第 6.2 节）：

- **minor fault**：页其实已在内存（如共享库已被别的进程加载），只需补页表项，代价小。
- **major fault**：页不在内存，要从磁盘（swap 或文件）读回，代价高——`wa` 升高、应用卡顿的常见来源。

```bash
# 进程虚拟内存概况（页表开销看 VmPTE，驻留集看 VmRSS）
grep -E "VmSize|VmRSS|VmPTE|VmSwap" /proc/self/status
# VmSize: 13428 kB  ← 虚拟地址空间总量（大≠占物理内存）
# VmRSS:   3684 kB  ← 实际驻留物理内存，占用看这个
# VmPTE:     28 kB  ← 页表本身占用
```

确认整个系统是否在发生大量缺页，看 `/proc/vmstat` 的 `pgmajfault` 增速即可——比逐进程翻 `status` 更快定位"是全体在抖还是单个进程在抖"。

`VmSize` 远大于物理内存是常态（JVM 预留地址空间、`mmap` 大文件都不立即占物理页）——**判断占用看 `VmRSS` 与 `free` 的 `available`，不要看 `VmSize`**，这是虚拟内存概念落到读数上的第一条纪律。

### 3.3 覆盖层：zRAM 与压缩

部分发行版/桌面默认把 swap 放在内存里的压缩块设备（zRAM）上，而不是磁盘分区：换出的页先压缩，能省盘 I/O 但吃 CPU。看到 `zram0` 出现在 `swapon --show` 里不必惊慌，这是设计行为；它也让"swap 使用量"的解读多了一层——zRAM 用得欢，可能只是压缩在正常工作，见第 7 节。

## 4. OOM Killer：内核为什么要杀进程

### 4.1 触发逻辑

当空闲页跌破水位线、回收又来不及，而某个进程仍在申请内存时，内核的 **OOM Killer**（Out-Of-Memory）会挑选"得分最高"的进程杀掉，以保住系统整体存活。得分综合 RSS、运行时间、`oom_score_adj` 等因素——结果常显得"不讲理"：无辜的守护进程被杀，而真正吃内存的 JVM 活着。理解这一点，才能把"进程莫名消失"从灵异事件变成日志检索。

现代系统还有**第二堵墙：cgroup 限额**。容器/虚拟化环境里，物理内存明明充裕，进程仍被杀——因为 cgroup 的 `memory.max` 先触发了（走的是 cgroup OOM，日志与全局 OOM 不同）。排查时先分清你在哪堵墙下（第 4.3 节）。

### 4.2 定位：日志与得分

```bash
# 全局 OOM 的标准日志行（dmesg 与 journal 同源）
sudo dmesg -T | grep -iE "out of memory|oom-kill" | tail -5
# Out of memory: Killed process 21873 (java) ...
cat /proc/$(pidof java)/oom_score        # OOM 得分 0-1000，越高越容易被杀
# 保护：echo -500 > /proc/<pid>/oom_score_adj（范围 -1000 到 1000）
```

`oom_score_adj` 是应急手段不是常规配置：把所有关键服务都设成 -1000，等于把 OOM 的后果集中到"唯一没设的倒霉蛋"身上。正确的长期解法是**给服务做内存上限**（cgroup/systemd 的 `MemoryMax=`），让超限先发生在自己的配额里，而不是全局 OOM 风暴。容器场景见第 4.3 节；进程级的持续观察工具（`pmap`、`smaps`）与本节数字的配合详见[命令篇 · 内存管理命令](../commands/system/memory.md)。

### 4.3 cgroup 限额：容器里的"假 OOM"

```bash
# cgroup v2：容器/进程组的限额与当前用量（max = 未设限）
cat /sys/fs/cgroup/<group>/memory.max
cat /sys/fs/cgroup/<group>/memory.current
systemctl show sshd -p MemoryMax   # systemd 服务的限额来自 unit 的 MemoryMax=
```

宿主机 `free` 一切正常 + 进程照样被 Killed + journal 里出现 `Memory cgroup out of memory`，就是 cgroup 这堵墙，而不是物理内存耗尽。这个区分是云原生环境下内存排障的分水岭：前者调限额或修泄漏，后者才需要加内存。

## 5. ECC 内存

ECC（Error-Correcting Code）内存能检测并纠正单 bit 错误、报告多 bit 错误。服务器标配，桌面通常没有——没有 ECC 不代表不能用，只意味着宇宙射线/老化导致的静默位翻转可能悄悄改坏数据（数据库页、内存中的密钥），这也是关键业务坚持 ECC 的原因。

| 类型 | 检测 | 纠正 | 适用场景 |
|------|------|------|---------|
| Non-ECC | 无 | 无 | 普通桌面 |
| ECC | 有 | 单 bit | 工作站/入门服务器 |
| Registered ECC（RDIMM） | 有 | 单 bit | 大容量服务器（带缓冲，稳定插更多条） |

```bash
sudo dmidecode -t memory | grep -i "error correction" | head -1   # 是否配置 ECC
cat /sys/devices/system/edac/mc/mc0/ce_count   # 可纠正错误累计（单bit，已自愈）
cat /sys/devices/system/edac/mc/mc0/ue_count   # 不可纠正错误累计（数据已损坏，立刻换条）
```

`ce_count` 缓慢增长提示内存条在老化，值得纳入巡检；**`ue_count` 非零是换件信号**——继续跑等于拿数据冒险。虚拟机里通常看不到 EDAC 节点（错误处理由宿主机负责），别把"没有 edac"误判成"ECC 没开"，先看 `dmidecode` 的声明。

## 6. 读数：free 与 vmstat

### 6.1 free：available 才是答案

```bash
$ free -h
               total        used        free      shared  buff/cache   available
Mem:            15Gi       8.2Gi       1.2Gi       512Mi       6.1Gi       6.3Gi
Swap:          2.0Gi          0B       2.0Gi
```

| 字段 | 含义 | 该怎么用 |
|------|------|----------|
| total | 物理内存总量 | 容量规划基数 |
| used | 已被进程/内核占用的页 | 粗看占用 |
| free | 完全空闲、不在任何回收列表上的页 | **仅参考**，低≠危险 |
| shared | tmpfs/共享内存等 | `/dev/shm` 膨胀时会体现在这 |
| buff/cache | 页缓存与块缓冲，**可按需回收** | 健康系统应当"用满" |
| available | 内核估算的可启动新进程的内存 ≈ free + 可回收缓存 − 预留 | **够不够看这一列** |

Linux 把空闲内存做成磁盘页缓存是性能基石（见[体系结构章](./architecture.md)第 6 节），缓存只在进程真正申请时让位。所以长期运行的机器 `free` 很低、`buff/cache` 很高是**设计如此**。判读纪律只有三条：够不够看 `available`（低于你预留的安全水位再紧张）；有没有泄漏盯 `used` 与进程 RSS 的**趋势**；容器内别看宿主 `free`，看 cgroup 的 `memory.current`（第 4.3 节）。`free` 命令的完整变体（`-s` 刷新、`-t` 合计）与进程级深挖见[命令篇 · 内存管理命令](../commands/system/memory.md)。

### 6.2 vmstat：压力从哪来

`free` 是快照，`vmstat` 是**每秒的动态账本**，能看出压力的方向——尤其是换页是否正在进行：

```bash
$ vmstat 1 3
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
 2  0      0 124508   2104 6230104    0    0    12    24  1830  3400  5  2 92  1  0
 1  0      0 118204   2104 6238108    0    0     0   116  1612  2985  8  3 89  0  0
```

| 区段 | 字段 | 判读 |
|------|------|------|
| procs | `r` | 运行队列长度；持续 > CPU 核数 = CPU 不够用 |
| procs | `b` | 不可中断睡眠（D 状态）进程；卡在这多为 I/O 等待，查[存储篇](./storage.md) |
| memory | `free/buff/cache` | 与 `free` 同源，趋势比单点有意义 |
| swap | `si`/`so` | **每秒从 swap 读入/写出的 KB**；持续非 0 = 正在换页，是内存压力的直接证据 |
| io | `bi`/`bo` | 块设备读写吞吐（KB/s）；`so` 与 `bo` 同涨提示换出在打盘 |
| system | `in`/`cs` | 中断与上下文切换速率；异常升高见[体系结构章](./architecture.md)与网络篇 |
| cpu | `us sy id wa st` | 用户/系统/空闲/IO等待/虚拟机被偷；`st` 高 = 宿主机超卖 |

判读口诀：**先看 `si/so`，再看 `free`**。`si/so` 为 0 时 `free` 低多半只是缓存让位，不用动手；`si/so` 持续走高才说明匿名页在被往外挤——此时再结合 `available` 决定是降 `swappiness`（第 7.3 节）、修泄漏，还是直接加内存。`r` 与 `wa` 分别把你的问题导向 CPU 篇与存储篇，`vmstat` 因此是三个硬件章节共用的分流器。

## 7. Swap 管理

### 7.1 Swap 是什么，什么时候需要

Swap 是磁盘（或 zRAM）上的交换空间：物理内存紧张时，内核把不活跃的页挪出去腾地方。它是**压力缓冲**而不是"第二内存"——依赖 swap 保命的业务会先被延迟打死（磁盘比内存慢五个数量级）。服务器的传统经验法则如下，仅作起点，最终以压测与 `si/so` 观测为准：

| 物理内存 | 建议 Swap |
|---------|-----------|
| ≤ 2 GB | 内存的 1-2 倍 |
| 2-8 GB | 与内存等大或 4 GB |
| 8-64 GB | 4-8 GB 即可 |
| ≥ 64 GB | 少量（几 GB）用于应急转储，或按应用需求 |

### 7.2 创建与启用

```bash
# 创建 4G swap 文件（通用写法，任何文件系统上都可靠）
sudo dd if=/dev/zero of=/swapfile bs=1M count=4096 status=progress
sudo chmod 600 /swapfile          # 权限必须先收紧，mkswap 会检查
sudo mkswap /swapfile && sudo swapon /swapfile && swapon --show

# 永久启用：写 /etc/fstab（用绝对路径，别写会漂移的 /dev/sdX）
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
sudo mount -a && swapon -a        # 验证 fstab 无笔误再重启
```

> **不要在 btrfs 上用 `fallocate` 预分配 swapfile**：`swapon` 会因 CoW/不连续/压缩等问题拒绝它（报 `Invalid argument`）——btrfs 场景请用上面的 `dd` 全量写入（并按 Arch Wiki 确认 `NOCOW`、非子卷压缩等前置条件）。XFS 上 `fallocate` 创建的 swapfile 也曾在部分版本被拒，拿不准就统一用 `dd`，慢一次，省一次半夜救火。

### 7.3 swappiness：控制换出倾向

```bash
# 查看与临时调整（0-100；0 = 尽量不换出，不等于禁用 swap）
cat /proc/sys/vm/swappiness        # 默认 60
sudo sysctl vm.swappiness=10
# 持久化：写 sysctl.d（三系 systemd 发行版路径一致）
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swap.conf
```

两条容易记反的语义：**`swappiness=0` 不等于关 swap**——紧急水位下内核仍可能换出，想彻底关只能 `swapoff`（注意先确保内存放得下）；反之，对数据库这类已自行管理大页缓存的负载，调低它能减少匿名页被无谓换出导致的 major fault 抖动。改完用 `vmstat 1` 盯 `si/so` 验证效果，别只改完就走。

## 8. 大页内存

默认 4 KB 页面下，超大内存工作集会把 TLB 压垮（每 2 MB 就要 512 个条目）。**Huge Pages** 用 2 MB（或 1 GB）页减少 TLB 条目数，对 JVM、数据库、DPDK 等延迟敏感负载收益明显——Redis/MongoDB 的 `transparent_hugepage` 调优、JVM 的 `-XX:+UseLargePages` 都建立在这之上：

```bash
# 查看当前大页配置；Hugepagesize 常见 2048 kB（2MB）
grep -i huge /proc/meminfo
echo 1024 | sudo tee /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages  # 预留2GB
echo 'vm.nr_hugepages = 1024' | sudo tee /etc/sysctl.d/99-hugepages.conf     # 持久化
```

两个连带认知：预留内存**从可用池里划走**，改完 `free` 变小是正常记账，不是泄漏；透明大页（THP）默认开启时偶发"卡一下"的延迟抖动，延迟敏感服务常直接关掉 THP 用显式大页——是否关闭以你应用的官方文档为准，不确定就不动全局默认。

## 9. NUMA 下的内存分配

拓扑事实（几个 node、每个 node 挂多少 CPU/内存）见 [CPU 章 · NUMA](./cpu.md)；本节回答内存视角的另一半问题：**进程的页落在哪个 node 上**。

NUMA 的基本策略就三种：**default（local 优先，允许远端兜底）**、**interleave（轮询各节点，摊平带宽）**、**bind（锁死指定节点）**。默认 local 通常最优；当内存分配严重不均（一个 node 快满、另一个半空）或带宽敏感的流式计算时，才考虑 interleave/bind。跨节点访问延迟虽在百纳秒级，但数据库类负载的 P99 对此非常敏感。

```bash
numastat                    # NUMA 内存统计：找"远端命中占比高"的迹象
numastat -p <pid>           # 单进程视角
numactl --cpunodebind=0 --membind=0 ./db_server   # 绑定 node 0（见 CPU 章第 7 节）
numactl --interleave=all ./db_server              # 启动期交错（以应用文档为准）
```

单路机器 `numactl --hardware` 只报 1 个 node，这些选项没有实际差别——**先确认拓扑再谈策略**，避免照抄双路服务器的调优清单到单路 VM 上自我感动。

## 10. 三系工具与配置差异

| 方面 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| `free`/`vmstat`/`swapon` | `procps`（默认预装） | `pacman -S procps`（若缺） | `procps-ng`（默认预装） |
| 历史采样 `sar` | `apt install sysstat` | `pacman -S sysstat` | `dnf install sysstat` |
| NUMA 工具 | `apt install numactl` | `pacman -S numactl` | `dnf install numactl` |
| 拓扑可视化 | `apt install hwloc` | `pacman -S hwloc` | `dnf install hwloc` |
| 持久化内核参数 | `/etc/sysctl.d/*.conf` | 同左（systemd） | 同左；`tuned` 可托管内存相关档位 |
| ECC 计数入口 | `/sys/.../edac/`（有硬件才有） | 同左 | 同左 + `edac-utils` 可选安装 |

`sysctl` 持久化三系写法一致（`/etc/sysctl.d/`），差异只在谁负责"官方推荐档位"——RHEL 系 `tuned` 有 `virtual-guest`/`throughput-performance` 等档位，Debian/Ubuntu/Arch 通常自行管理。首次调参建议只写 `sysctl.d` 单文件，便于 `rm` 回滚，别往 `/etc/sysctl.conf` 里无限追加历史垃圾。

## 常见坑

1. **把 `free` 当可用内存。** 危险线看 `available`；`free` 低+`buff/cache` 高+`si/so` 为 0 的机器健康得很（第 6.1 节）。
2. **用 `fallocate` 建 swap，重启后 swap 消失。** `swapon` 对 CoW 文件系统上的 fallocate swapfile 报错拒绝，fstab 里那行在开机时静默失败（第 7.2 节）；统一用 `dd`，写完必测 `swapon -a`。
3. **`swappiness=0` 当成"永不使用 swap"。** 它只是尽量不换；`swapoff -a` 才是禁用。改 sysctl 后忘了写 `sysctl.d`，重启回到默认 60（第 7.3 节）。
4. **容器里 OOM 却盯着宿主机 `free` 看。** 先查 cgroup 的 `memory.max`/`memory.current` 与 journal 里的 cgroup OOM 行，宿主机内存再充裕也拦不住限额杀进程（第 4.3 节）。
5. **`VmSize` 巨大 = 内存大户。** JVM/浏览器预留地址空间不占物理页；占用看 `VmRSS`，整体看 `available`（第 3.2 节）。
6. **加了大页/关了 THP 却不验证。** `nr_hugepages` 预留会直接减少 `free`，应用没配置 `UseLargePages` 时这笔预留就是纯浪费；改完先 `grep -i huge /proc/meminfo` 对账，再看应用日志确认它真的用了大页（第 8 节）。
7. **虚拟机里找不到 EDAC 就怀疑 ECC 没开。** VM 通常不透传 EDAC 计数，以 `dmidecode` 声明与 hypervisor 配置为准（第 5 节）。

## 参考资料

- Bryant, R. E., & O'Hallaron, D. R.《深入理解计算机系统》（CSAPP），机械工业出版社
- 鸟哥的私房菜 - 物理内存与虚拟内存：<https://linux.vbird.org/linux_basic/centos7/0150memory.php>
- Arch Wiki - Memory（含 OOM 与 swap 语义）：<https://wiki.archlinux.org/title/Memory>
- Arch Wiki - Btrfs swapfile 注意事项：<https://wiki.archlinux.org/title/Btrfs#Swap_file>
- Arch Wiki - NUMA：<https://wiki.archlinux.org/title/NUMA>
- JEDEC DDR4 Standard：<https://www.jedec.org/standards-documents/docs/jesd79-4>
- JEDEC DDR5 Standard：<https://www.jedec.org/standards-documents/docs/jesd79-5>
- Linux Kernel Documentation - Memory Management：<https://www.kernel.org/doc/html/latest/mm/index.html>
- Linux Kernel Documentation - OOM Killer：<https://www.kernel.org/doc/html/latest/mm/concepts.html>
- Red Hat - RHEL 9 内存管理与 tuning：<https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/index>
