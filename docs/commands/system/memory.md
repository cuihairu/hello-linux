# 内存管理命令

"内存不够用"是新手最容易误判的告警：`free` 里 `free` 列很小，不代表机器快挂了；swap 用了几 MB，也不代表出了大问题。内存管理的第一课是**读懂内核到底把字节放在了哪里**，第二课才是调参与排障。

> 内容参考自鸟哥的私房菜、Arch Wiki（Memory/Swap/OOM Killer）与 kernel.org 文档，见文末参考资料。

## 学习目标

- 分清 `free` 中 available 与 free 的差别，会正确评估内存压力
- 会读 swap 使用率与 si/so，理解 swappiness 的真实含义
- 掌握 OOM Killer 的触发条件、日志定位与 oom_score_adj 调节
- 会用 sysctl 持久化内核参数（含三系路径差异）与 pmap/valgrind/perf/bpftrace 做进阶分析

## 1. free -h：available 与 free 为什么差这么多

### 1.1 先看真实输出

```bash
$ free -h
               total        used        free      shared  buff/cache   available
Mem:            15Gi       8.2Gi       1.2Gi       512Mi       6.1Gi       6.3Gi
Swap:          2.0Gi          0B       2.0Gi
```

很多人的第一反应是"15G 内存只剩 1.2G free，快满了"——这是用错列的经典案例。各列含义：

| 列 | 含义 | 该怎么用 |
|----|------|----------|
| total | 物理内存总量 | 容量规划基数 |
| used | 已被进程/内核占用的页（不含可回收的页缓存） | 粗看占用 |
| free | **完全空闲、不在任何 LRU 上**的页 | 仅参考，低≠危险 |
| shared | tmpfs/共享内存等共享页 | 看 `/dev/shm` 是否膨胀 |
| buff/cache | 页缓存与块设备缓冲，**可按需回收** | 健康系统应当"用满" |
| available | 内核估算的**可启动新进程**的内存量 ≈ free + 可回收缓存 − 低水位预留 | **评估内存够不够看这一列** |

### 1.2 为什么内核不把内存留成 free

把空闲内存做成磁盘页缓存，重复读文件就能命中内存，这是 Linux 性能的基石之一。缓存只有在进程真正申请内存时才会被回收让位——所以长期运行的服务器 `free` 很低、`buff/cache` 很高是**设计如此**，不是泄漏。`available`（对应 `/proc/meminfo` 的 `MemAvailable`）就是内核替你做的估算：这些缓存里有多少能立刻变成可用内存。

老版本 `free` 曾打印 `-/+ buffers/cache:` 行给出"扣掉缓存后的 used/free"，新版 procps 直接用 `available` 一列表达同一思想。因此：

- **够不够**：看 `available`，低于你给业务留的安全水位（如总量的 10%–15%）再紧张。
- **有没有泄漏**：盯 `used` 与具体进程 RSS 的趋势，而不是纠结 `free` 是否归零。
- **容器/虚拟机**：宿主机 `free` 是全机视角；容器内要看 cgroup 的 `memory.max`/`memory.current`（`/sys/fs/cgroup/`）。

`free` 常用选项：`-h` 人类可读，`-m`/`-g` 指定单位，`-s 2` 每 2 秒刷新，`-t` 加 swap 合计行。持续观察内存压力更专业的做法是 `vmstat 1` 看 `si/so`，或 `sar -r` 留历史，见[系统监控工具](./monitoring.md)。

### 1.3 /proc/meminfo — 需要更细时

```bash
$ grep -E 'MemTotal|MemAvailable|Cached|Dirty|SwapTotal|SwapFree' /proc/meminfo
MemTotal:       15769904 kB
MemAvailable:    6553600 kB
Cached:         4200448 kB
Dirty:             1024 kB
SwapTotal:       2097148 kB
SwapFree:        2097148 kB
```

`Dirty` 表示待写回磁盘的数据，持续暴涨说明写盘跟不上（网盘拷贝、数据库刷页）；`CommitLimit`/`Committed_AS` 与 overcommit 策略有关，虚拟化与大内存场景才会深究。日常仍以 `free` + 进程级 RSS 为主。

## 2. 进程级内存：pmap、smaps 与 RSS

整机够用但单个进程越来越肥时，要钻到进程地址空间：

```bash
$ pmap -x 2041 | tail -5
2041:   mysqld
Address           Kbytes   RSS   Dirty Mode  Mapping
...
 total kB        12500000 1843200  812000

$ ps -o pid,rss,vsz,cmd -p 2041
    PID    RSS     VSZ CMD
   2041 1800000 12500000 mysqld

$ cat /proc/2041/smaps_rollup
Rss:            1800000 kB
Pss:            1100000 kB
Swap:                 0 kB
```

读法要点：**VSZ 是虚拟地址空间**（含未实际占用的映射），**RSS 是常驻物理页**，谈"进程占了多少内存"用 RSS；`Pss`（比例集）把共享库按进程数摊分，多进程共享 glibc 时 Pss 更能反映"独占代价"。`smaps_rollup` 是 `smaps` 的汇总版，逐段 `smaps` 有几万行，先看 rollup。

## 3. swap：使用率怎么读

### 3.1 先看现状

```bash
$ swapon --show
NAME       TYPE      SIZE USED PRIO
/swapfile  file      2.0G   0B   -2

$ free -h
...
Swap:          2.0Gi          0B       2.0Gi
```

**swap 使用率 = used / total**（上例 0%）。怎么算"异常"：

1. **used 长期为 0 且 available 充足**：健康，没问题。
2. **used 非零但稳定（如 2G 里用了 50M–300M）且 `vmstat` 的 si/so 接近 0**：正常。默认 swappiness 下，内核会把**冷页**主动换出，腾出内存给缓存——这是优化，不是故障。
3. **si/so 持续大于 0、available 持续走低、系统交互变卡**：正在**颠簸（thrashing）**，才是真压力。
4. **swap 100% 用满 + available 极低**：即将触发 OOM，见第 5 节。

判断 si/so：

```bash
$ vmstat 1 5
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
  r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
  1  0      0 120000  50000 600000    0    0    10    20  200  400  2  1 97  0  0
```

`si`（swap in）/`so`（swap out）单位是每秒 KB。首行是**自开机以来的平均值**，从第二行起才是采样间隔的真实瞬时值——用首行下结论是最常见的误读。

### 3.2 创建与持久化 swap

内存吃紧的机器可以加 swap 文件（分区方案类似，略）：

```bash
sudo fallocate -l 4G /swapfile     # 或 dd if=/dev/zero of=/swapfile bs=1M count=4096
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

`chmod 600` 不可省略——权限过宽的 swapfile，`swapon` 会直接拒绝（安全限制）。持久化写入 `/etc/fstab`：

```text
/swapfile none swap sw 0 0
```

重启前 `swapon --show` 确认，或 `findmnt -rn -S /swapfile` 验证挂载。临时关掉用 `swapoff /swapfile`（会把换出的页读回内存，**内存放不下时 swapoff 可能触发 OOM**，先确认 available）。

### 3.3 swappiness 不是"禁用 swap 的开关"

```bash
$ cat /proc/sys/vm/swappiness
60
$ sudo sysctl vm.swappiness=10
```

swappiness 范围 0–200（多数发行版文档按 0–100 讲），值越大内核越**积极**换出匿名页、回收倾向偏向 swap，越小越偏向只回收页缓存。三点澄清：

1. **swappiness=0 不等于永不 swap**。现代内核在空闲内存极低时仍会换出，只是阈值极苛刻；把关键业务"防换出"应靠 mlock/cgroup，不是指望 0。
2. **默认 60 是折中**。桌面/服务器一般 10–60 均可；数据库等延迟敏感服务常降到 10 观察，**降之前先保证物理内存有余量**，否则只是把颠簸推迟。
3. **改了要持久化才算数**，见下一节 sysctl 路径；只 `sysctl -w` 重启即丢。

同族参数 `vm.vfs_cache_pressure` 控制内核回收 dentry/inode 缓存的积极程度，默认 100；小文件目录元数据压力大时可略调低（如 50）让目录缓存留得更久——前提是内存不紧张。

## 4. 内核参数持久化：三系 sysctl 路径差异

### 4.1 两层生效模型

内核参数（sysctl）有两层：

- **运行时**：`sysctl -w vm.swappiness=10` 或 `sysctl vm.swappiness=10`，立即生效、重启丢失。
- **持久化**：写入配置文件，开机由 **systemd-sysctl.service** 加载。

三发行版开机加载目录一致：**`/etc/sysctl.d/*.conf`**（以及发行版自带的 `/usr/lib/sysctl.d/`，`/etc` 覆盖 `/usr` 同名文件）。推荐为每个主题单独建文件，便于 RPM/DEB 包管理与 diff：

```bash
# /etc/sysctl.d/99-memory-tuning.conf
vm.swappiness=10
vm.vfs_cache_pressure=50
```

加载与验证：

```bash
$ sudo sysctl --system | grep swappiness     # 列出按优先级合并后的结果
$ sudo sysctl -p /etc/sysctl.d/99-memory-tuning.conf   # 立即试加载指定文件
$ sudo reboot                                  # 或重启后 sysctl vm.swappiness 复查
```

### 4.2 三系路径习惯对照

| 项目 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 推荐持久化位置 | `/etc/sysctl.d/*.conf` | `/etc/sysctl.d/*.conf`（Wiki 推荐） | `/etc/sysctl.d/*.conf` |
| 旧入口 `/etc/sysctl.conf` | 仍存在；`sysctl -p` 默认读它 | 一般不使用，建议 `.d` | 历史包袱重，老教程常见 |
| 无参数 `sysctl -p` | 读 `/etc/sysctl.conf` | 同左 | 同左 |
| 开机加载者 | systemd-sysctl | systemd-sysctl | systemd-sysctl |

**坑**：很多老教程写 `echo "vm.swappiness=10" >> /etc/sysctl.conf`。在只认 `/etc/sysctl.d/` 的环境里这行**不会开机生效**，重启后参数回退。稳妥做法是统一写 `/etc/sysctl.d/99-*.conf`，用 `sysctl --system` 确认出现在输出里。安全加固类参数（`kernel.kptr_restrict`、`net.ipv4.tcp_syncookies` 等）同理，见[安全加固](../../security/hardening.md)。

### 4.3 drop_caches：能用但别当日常操作

```bash
sync
sudo sh -c 'echo 1 > /proc/sys/vm/drop_caches'   # 页缓存
sudo sh -c 'echo 2 > /proc/sys/vm/drop_caches'   # dentry/inode
sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'   # 两者都要
```

它只丢**干净**缓存，不能回收脏页；先 `sync` 才有效果。用途仅限基准测试前统一冷缓存、或验证"缓存占了多少"。**不要**在生产写 cron 定期 drop——清掉缓存后下一轮 IO 全部回源，业务会莫名变慢，而且内存随后照样被缓存填满，等于花钱买抖动。真觉得内存不够，要么加条，要么查谁在占 `used`。

## 5. OOM Killer：内存耗尽时内核的最后手段

### 5.1 为什么会触发

当进程申请内存时，内核依次尝试回收页缓存、压缩（zram）、动用 swap；全部失败则分配失败。若是**全局**申请走投无路，内核的 OOM Killer 会介入：按评分挑一个"最该死"的进程发 `SIGKILL`，腾出空间让系统活下来——设计哲学是"牺牲一个，保住整机"。

注意与 cgroup OOM 的区别：容器/systemd 单元触顶 `memory.max` 时，死的是**该 cgroup 内**的进程，不一定惊动全局 OOM Killer。

### 5.2 怎么确认发生过

```bash
$ dmesg -T | grep -i -E 'out of memory|oom-kill'
[Thu Sep 18 03:12:44 2026] oom-kill:constraint=CONSTRAINT_NONE,...
[Thu Sep 18 03:12:44 2026] Out of memory: Killed process 3021 (java) total-vm:8043120kB, anon-rss:4096000kB ...

$ journalctl -k --since "3 days ago" | grep -i 'out of memory'
```

日志里会明确写出被杀进程名与 PID。翻历史还可用 `journalctl -k | grep -i oom`。被杀的往往不是"名字最坏"的，而是 **RSS 大、oom_score 高**的——Java、Python 数据进程常背锅，即使它们不是根因（根因可能是别的进程突发泄漏把全局内存吃光）。

### 5.3 oom_score 与 oom_score_adj

```bash
$ cat /proc/3021/oom_score
1023
$ cat /proc/3021/oom_score_adj
0
```

`oom_score` 随内存占用升高；`oom_score_adj`（-1000～1000）由管理员偏置：-1000 表示"绝对不杀"（内核守护、关键管理进程），正数表示"优先杀"。调整：

```bash
echo -1000 | sudo tee /proc/$PID/oom_score_adj          # 临时
# 或在 systemd unit 中写 OOMScoreAdjust=-1000，随服务管理持久化
```

**克制使用**：把所有重要服务都设成 -1000，OOM 时内核只能杀更小的进程或分配彻底失败，系统可能整体假死。正确姿势是先解决内存从哪来的问题（泄漏？容量？swap 策略？），偏置只用于极少数"死了更糟"的进程（如数据库主节点管理代理）。`panic_on_oom`（OOM 时重启/panic）仅适合特定高可用集群策略，常规服务器不要开。

### 5.4 缓解思路清单

1. 用 `ps aux --sort=-rss | head` 找 RSS 大户，确认是业务峰值还是泄漏（趋势看 `pidstat -r` 或定期 `free -m` 采样）。
2. 检查 swap 是否被禁用或过小——完全没有 swap 的机器，峰值时更早、更突然地 OOM。
3. 应用层限流/缓存上限（数据库 `innodb_buffer_pool_size`、JVM `-Xmx`）——**JVM 堆设得比 cgroup 上限还大**是容器 OOM 的头号原因。
4. systemd 服务可设 `MemoryMax=` 把爆炸范围关在单元内，避免拖死整机。
5. 确认没有把 `available` 误判为"还有很多 free"而持续加压。

## 6. 内存泄漏与性能分析工具

### 6.1 valgrind — 用户态泄漏检测

怀疑**自己写的**程序泄漏时，用 valgrind 插桩（会显著变慢，勿直接怼生产热路径）：

```bash
# 三系安装
sudo apt install valgrind    # Debian/Ubuntu
sudo pacman -S valgrind      # Arch
sudo dnf install valgrind    # RHEL/CentOS/Rocky

$ valgrind --leak-check=full --show-reachable=yes ./myprog
==1234== LEAK SUMMARY:
==1234==   definitely lost: 1,024 bytes in 4 blocks
```

`definitely lost` 是最值得追的；`still reachable` 程序退出前还持有可能是故意的全局缓存。输出里的调用栈能直接指到源码行（编译时加 `-g`）。

### 6.2 perf — 缓存与缺页热点

```bash
# 三系安装（Debian 按内核版本选 tools 包）
sudo apt install linux-tools-common linux-tools-$(uname -r)   # Debian/Ubuntu
sudo pacman -S perf                                           # Arch
sudo dnf install perf                                         # RHEL/CentOS/Rocky

$ perf stat -e cache-misses,cache-references,page-faults ./myprog
$ perf record -g ./myprog && perf report
```

`perf stat` 适合对比"改参数前后缓存命中率"；`perf record/report` 看时间都花在哪个函数。容器里 perf 常受 `perf_event_paranoid` 限制，需 root 或调整该 sysctl。

### 6.3 bpftrace — 动态追踪（进阶）

需要"谁在分配内存、哪条代码路径最耗页"这类动态问题时，eBPF 工具链比 valgrind/perf 更适合生产（低开销、无需重编译）。三系安装：

```bash
sudo apt install bpftrace     # Debian/Ubuntu（需较新内核）
sudo pacman -S bpftrace       # Arch
sudo dnf install bpftrace     # RHEL/CentOS/Rocky
```

最小示例（统计系统调用次数，root 运行）：

```bash
$ sudo bpftrace -e 'tracepoint:syscalls:sys_enter_* { @[comm] = count(); }'
```

内核需开启 BPF 相关配置（主流发行版默认可用）；Arch Wiki 与 bpftrace 手册有更多单行工具。本页只要求**会装、知道解决哪类问题**，深入见参考资料。

### 6.4 mtrace — glibc 层跟踪

对使用 glibc malloc 的程序，也可设 `MALLOC_TRACE=/tmp/mtrace.log` 运行后用 `mtrace prog /tmp/mtrace.log` 分析（需程序以 `-gm32` 一类方式编译支持）。实际项目中 valgrind 覆盖率更高，mtrace 作了解即可。

## 7. 三发行版对照

| 事项 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| free/ps 所属包 | procps | procps-ng | procps-ng |
| 默认 swappiness | 60 | 60 | 60（RHEL 系文档亦为 60） |
| sysctl 持久化 | `/etc/sysctl.d/*.conf` | `/etc/sysctl.d/*.conf` | `/etc/sysctl.d/*.conf`（另有遗留 `/etc/sysctl.conf`） |
| valgrind | `apt install valgrind` | `pacman -S valgrind` | `dnf install valgrind` |
| perf | `linux-tools-$(uname -r)` | `pacman -S perf` | `dnf install perf` |
| bpftrace | `apt install bpftrace` | `pacman -S bpftrace` | `dnf install bpftrace` |
| zram/swap 文件 | 工具与文档在 `zram-tools`/wiki | Arch Wiki 有完整 zram 方案 | `dnf install zram-generator`（RHEL 9 一代） |

上表"安装"列即三系最小对照：同一能力、不同前端；换发行版先 `cat /etc/os-release` 再选包管理器。Arch 用户请保持系统升级到最新再装上述包，避免 partial upgrade 引发依赖库不匹配。

## 8. 常见坑

1. **`free` 的 free 列低 = 内存不足**。看 `available`；`buff/cache` 是可回收的加速器。
2. **swap 一用就慌**。冷页换出属正常；看 si/so 是否持续非零、available 是否下降，而非 used 是否为 0。
3. **swappiness=0 当防换出银弹**。极端内存压力下仍会换；关键内存用 mlock/cgroup。
4. **`>> /etc/sysctl.conf` 后重启发现没生效**。统一写 `/etc/sysctl.d/99-*.conf`，用 `sysctl --system` 验证。
5. **定期 drop_caches"清内存"**。只会制造 IO 尖刺，内存转头又被缓存占满。
6. **OOM 只怪被杀进程**。被杀的是当时 oom_score 高的"替罪羊"，要回溯谁把全局内存吃光（`dmesg` + 事后 `journalctl` + 监控曲线）。
7. **swapoff 在 available 极低时执行**。会试图把 swap 全读回内存，直接诱发 OOM；先扩容或停业务。
8. **VSZ 当内存占用汇报**。VSZ 含巨大虚拟映射，汇报用 RSS/Pss。
9. **容器 OOM Killer 只看宿主机 dmesg**。cgroup OOM 会在容器日志与 `journalctl` 的 cgroup 记录里，先确认 `memory.max` 与 JVM `-Xmx` 是否打架。

## 参考资料

- 鸟哥的私房菜 - 内存与 swap 管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0610hardware.php)
- Arch Wiki - Memory management / Swap / OOM Killer — [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- Arch Wiki - Sysctl — [wiki.archlinux.org](https://wiki.archlinux.org/title/Sysctl)
- kernel.org - cgroup v1/v2 与 OOM 文档 — [kernel.org](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
- proc(5) /proc/meminfo — [man7.org](https://man7.org/linux/man-pages/man5/procfs.5.html)
- `man free`、`man vmstat`、`man sysctl`、`man swapon`、`man pmap`
- bpftrace 参考指南 — [github.com/bpftrace/bpftrace](https://github.com/bpftrace/bpftrace)
- valgrind 手册 — [valgrind.org](https://valgrind.org/docs/manual/)
