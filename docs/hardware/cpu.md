# CPU

CPU 是所有性能问题的第一现场：机器"变慢了"，第一杯水泼向的就该是它——频率被压了吗、任务都挤在一个核上吗、这台机器是不是虚拟机、 flags 支不支持你要跑的软件。本章介绍 CPU 的内部结构、拓扑、flags、频率管理与虚拟化能力，以及它们在 Linux 下的观察与调整方法，读完你应该能把"CPU 占用高/低但就是慢"这类模糊症状拆成可验证的具体假设。

> 内容参考自 Intel/AMD 官方手册、Arch Wiki 与 Linux 内核文档，见文末参考资料。

## 学习目标

- 理解 CPU 内部结构与超线程，会用 `lscpu -e` 读懂拓扑并解释为什么要绑核
- 掌握 `/proc/cpuinfo` flags 的读法，能区分 `vmx`/`svm`、识别虚拟机、解释 `illegal instruction`
- 理解频率与降频的机制，会切换 governor 并知道三系上 `cpupower` 的安装差异
- 掌握硬件虚拟化的检查路径（`vmx`/`svm` → `/dev/kvm`），建立 NUMA 的初步概念
- 认识"观测数字本身可能骗人"的几个经典坑（`nproc` 与 cgroup、虚拟机无 cpufreq）

## 1. CPU 内部结构

### 1.1 核心组成

```text
┌─────────────────────────────────────────────┐
│                    CPU                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  核心 0   │  │  核心 1   │  │  核心 N   │  │
│  │ ALU+控制 │  │ ALU+控制 │  │ ALU+控制 │  │
│  │  L1d/L1i │  │  L1d/L1i │  │  L1d/L1i │  │
│  │    L2    │  │    L2    │  │    L2    │  │
│  └──────────┘  └──────────┘  └──────────┘  │
│               ┌──────────┐                  │
│               │  L3(共享) │                  │
│               └──────────┘                  │
│  ┌───────────────┐   ┌──────────────┐       │
│  │  内存控制器     │   │ PCIe 控制器   │       │
│  └───────────────┘   └──────────────┘       │
└─────────────────────────────────────────────┘
```

| 组件 | 功能 | 排障意义 |
|------|------|---------|
| ALU + 控制单元 | 执行运算、解析指令 | `us` 时间的来源 |
| 寄存器组 | 高速数据存储 | 崩溃现场（core dump）快照 |
| L1/L2/L3 缓存 | 减少内存访问延迟 | 缓存行争用会拖慢多线程程序 |
| 内存控制器 | 管理内存读写 | 现代 CPU 内置，是 NUMA 的根源 |
| PCIe 控制器 | 管理高速设备 | 网卡/NVMe 的挂载点，见[体系结构章](./architecture.md) |

### 1.2 流水线、超标量与本章的关系

**流水线**把指令执行拆成多个阶段重叠执行，**超标量**让每个周期发射多条指令到不同执行单元；现代 Intel/AMD CPU 的流水线深度约十余到二十余级。对日常运维，这些概念只需要支撑一个结论：**CPU 的"忙"分好几种**——执行用户代码（`us`）、代表进程陷入内核（`sy`）、等 I/O（`wa`）、被虚拟机监控器偷走（`st`）。用 `mpstat` 或 `top` 看到这些列时，背后就是流水线在不同来源的指令间切换的开销，详见[系统管理篇 · 性能优化](../system-management/performance.md)。

## 2. 核心拓扑：socket、core、thread

### 2.1 物理核心与超线程（SMT）

每个物理核心是独立的运算单元，拥有自己的 ALU、寄存器和 L1/L2 缓存。Intel 超线程（Hyper-Threading）与 AMD SMT 让一个物理核心模拟两个逻辑核心，共享执行资源——两个逻辑核不是两个完整核心，**争抢同一套执行单元与 L1/L2**。

为什么拓扑值得单独一节：绑核、许可证计算（很多商业软件按物理 core 收费，超线程不加钱）、性能归因，全靠它。把 16 个 `nproc` 当成 16 个物理核去规划任务密度，是在超线程机器上犯的经典错误。

```bash
lscpu | grep -E "^CPU\(s\)|Core\(s\)|Thread\(s\)|Socket\(s\)"
# CPU(s): 16              ← 逻辑核数（含超线程），任务规划看这里
# Core(s) per socket: 8   Thread(s) per core: 2   ← 2 = 已启用超线程
# Socket(s): 1            ← 物理 CPU 数（许可证、NUMA 亲和看这里）
nproc   # 进程当前可用 CPU 数（可能被 taskset/cgroup 影响，见第 8 节的坑）
```

### 2.2 读懂 lscpu -e 拓扑表

`lscpu -e` 把每个逻辑 CPU 的归属摊开，是绑核前必看的一张表：

```bash
$ lscpu -e | head -4
CPU NODE SOCKET CORE L1d:L1i:L2:L3 ONLINE
 0    0      0    0  0:0:0:0       yes
 2    0      0    0  0:0:0:0       yes   ← 与 CPU 0 同核（超线程兄弟）
```

用法直接推导：CPU 0 和 CPU 2 共享 L1/L2 与执行单元，**不要把两个都吃单核的重活放在 0 和 2 上**——那是把一个物理核当两个用。绑核工具是 `taskset` 或 `numactl`（见第 7 节与[内存章 · NUMA](./memory.md)）。多路服务器还要看 `NODE` 列：跨 NUMA 节点访问内存更慢，详见第 7 节。

## 3. 缓存层次与缓存行

### 3.1 各级缓存

| 缓存 | 位置 | 延迟 | 典型容量 | 共享范围 |
|------|------|------|---------|---------|
| L1d | 核心内 | ~1 ns | 32-48 KB | 核心独享 |
| L1i | 核心内 | ~1 ns | 32-64 KB | 核心独享 |
| L2 | 核心内 | ~3 ns | 256 KB-2 MB | 核心独享 |
| L3 | 核心间共享 | ~10 ns | 几 MB-几十 MB | 同 socket 多核共享 |

缓存未命中要走到内存（~100 ns，见[体系结构章](./architecture.md)的存储层次），延迟差两个数量级——这就是"内存密集型负载"慢的物理根源，也是超线程共享 L1/L2 会互相干扰的原因。

### 3.2 缓存行与 false sharing

缓存以**缓存行（Cache Line）**为单位读写，x86-64 上通常是 64 字节。两个线程各自频繁写**同一缓存行内不同变量**时，缓存行会在核间来回"乒乓"，性能断崖式下跌——这叫 false sharing（伪共享）。它是"单线程很快、开两个线程反而更慢"的常见硬件解释；定位靠 `perf c2c`，修复靠填充对齐（业界常用 64 字节 padding）。日常先记住概念，遇到多线程性能异常时它在嫌疑列表里。

```bash
getconf LEVEL1_DCACHE_LINESIZE   # 缓存行大小，x86-64 常见输出 64
lscpu -C                         # 各级缓存容量与类型一览
```

想看更底层的原始数据，sysfs 的 `index*/` 目录（`level`、`type`、`size` 文件）直接对应每一级缓存——`lscpu -C` 本质上就是把这些文件整理后打印，两者对不上时才需要下去逐个 `cat` 核对。

## 4. flags：CPU 能力清单

### 4.1 为什么运维必须会读 flags

flags 是 CPU 向软件宣告的**能力清单**，三类问题只看 flags 就能定性：

1. **`illegal instruction`**：二进制用了本机没有的指令。要么编译时 `-march` 太新，要么发行版基线太高——例如 **RHEL 9 要求 x86-64-v2 及以上**（含 SSE4.2、SSSE3、CMPXCHG16B 等），2010 年前的 CPU 跑不起来；Arch 官方仓库基线更宽但 AUR 包按构建机而定。
2. **虚拟化不可用**：没有 `vmx`/`svm` 就开不了 KVM（见第 6 节）。
3. **安全基线**：SMEP/SMAP/NX 等标志关系到内核防护能力，合规检查常查它们。

### 4.2 常见 flags 速查

| flag | 含义 | 关注它的原因 |
|------|------|-------------|
| `lm` | 长模式（64 位） | 没有它就不是 64 位 CPU |
| `sse4.2` / `ssse3` | SIMD 扩展 | x86-64-v2 基线的组成部分 |
| `avx` / `avx2` | 高级向量扩展 | 科学计算、编译优化、部分加密库 |
| `avx512f` | AVX-512 基础集 | 服务器/新架构才有；老发行版二进制不依赖它 |
| `aes` | AES-NI 硬件加密 | 加解密吞吐量差距巨大，VPN/磁盘加密依赖 |
| `vmx` | Intel VT-x 硬件虚拟化 | Intel 机器开 KVM 的前提 |
| `svm` | AMD-V 硬件虚拟化 | AMD 机器开 KVM 的前提 |
| `hypervisor` | 运行在虚拟机下 | 有它 = 这是 VM，性能抖动先想到超卖 |
| `smep` / `smap` | 内核态执行/访问用户页限制 | 内核安全基线 |

```bash
# 查看关心的指令集扩展；vmx = Intel VT-x，svm = AMD-V
grep -o -w "sse4_2\|avx2\|avx512f\|aes\|vmx\|svm" /proc/cpuinfo | sort -u
# vmx
# 一眼判断是否虚拟机（hypervisor 位被点亮即为 VM）
grep -q "^flags.*hypervisor" /proc/cpuinfo && echo "虚拟机" || echo "物理机或未暴露"
```

完整 flags 每行很长，先 `grep "^flags" /proc/cpuinfo | head -1 | cut -c1-200` 截断阅读，需要完整清单时再重定向到文件里逐项对照。注意 `/proc/cpuinfo` 中**不存在**名为 `vt-x`/`VT-x` 的 flag——Intel 的官方营销名是 VT-x，落到 flag 上就叫 `vmx`，按营销名去 grep 一定空手而归。

> 此前本文档把虚拟化 flag 误写为 `vt-x`——已更正。**判断口诀：Intel 写 vmx，AMD 写 svm，营销页写 VT-x/AMD-V，`/proc/cpuinfo` 只认前两个。**

### 4.3 虚拟机里 flags 会变少

虚拟机的 flags 是 hypervisor 精选后透传/模拟的，常见差异：`hypervisor` 位被点亮、部分扩展被裁掉、`vmx`/`svm` 默认**不**透传（需要嵌套虚拟化才能在 VM 里再开 KVM）。所以"宿主机能跑的软件，VM 里报 illegal instruction"是合法现象——对比两台机器的 flags 输出即可确认，宿主机侧的对比入口见[体系结构章](./architecture.md)第 7 节。

## 5. CPU 频率管理与降频

### 5.1 为什么 CPU 会"变慢"

CPU 主频不是恒定值。温度逼近上限、功耗墙、电池模式、节能策略，都会让它主动降频；笔记本上这叫正常的热管理，在你眼里却像"代码突然变慢了"。归因顺序建议：先看频率（本节），再看调度（第 2 节拓扑），最后才怀疑代码。服务器上则相反——电源策略若停在保守档，跑分与延迟会白白损失，这也是上生产前把 governor 调成 `performance` 的原因。

### 5.2 调频策略（governor）

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| `performance` | 锁定最高频率 | 服务器、延迟敏感负载 |
| `powersave` | 倾向最低频率 | 省电、散热受限环境 |
| `ondemand` | 按负载快速升频 | 传统默认，响应激进 |
| `schedutil` | 由调度器直接驱动频率 | 内核推荐，与 CFS/EAS 协同 |

```bash
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor            # 当前策略
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors # 可选策略
# performance / performance powersave schedutil（ondemand 取决于驱动）
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq            # 当前频率 kHz
```

怀疑"某个核被压在低频拖了后腿"时，把 `cpu[0-9]*/cpufreq/scaling_cur_freq` 全部读一遍对比即可（一个 `for` 循环加 `paste` 就够）；数值远低于 `cpuinfo_max_freq` 且 governor 是 powersave/ondemand，就是降频在场的直接证据。

### 5.3 用 cpupower 切换策略（三系安装）

`cpupower` 是内核配套的调频前端，三系安装包名完全不同，这是本页最容易装错的工具：

```bash
# 安装 cpupower（三系包名不同，本页最易装错的工具）
sudo apt install linux-tools-common linux-tools-$(uname -r)   # Debian/Ubuntu
sudo pacman -S linux-tools                                    # Arch
sudo dnf install kernel-tools                                 # RHEL/CentOS/Rocky
# 切换策略（临时，重启失效）：performance 给服务器/压测，powersave 省电
sudo cpupower frequency-set -g performance
sudo cpupower frequency-set -g powersave
```

持久化没有三系统一的落点：Debian/Ubuntu 桌面历史上由 `cpufrequtils`/系统设置管理（新版本多由电源管理组件接管，需按你的桌面环境核实）；**RHEL/CentOS/Rocky 推荐 `tuned`**（`sudo dnf install tuned` 后 `sudo tuned-adm profile throughput-performance`，profile 内含调频与 I/O 设置）；Arch 通常自己写 systemd unit 调 `cpupower frequency-set`，或使用 `cpupower` 的服务单元。生产环境改配置前先 `cpupower idle-info` 确认当前状态，改完隔天用 `tuned-adm active`（RHEL）或重新读 sysfs 验证是否生效——**重启后失效的临时设置是最常见的"调了但没调上"**。

### 5.4 虚拟机里可能没有 cpufreq

KVM/VMware 虚拟机通常**不呈现** `cpufreq` 子系统——`/sys/devices/system/cpu/cpu0/cpufreq/` 目录不存在属正常现象，此时频率由宿主机决定，VM 内无从调起。云主机同理：你看到的"频率"往往是宿主机视角的换算值。在这类环境里排查性能，看 `steal` 时间（`mpstat`/`top` 的 `st` 列）比调 governor 有意义得多。

## 6. 硬件虚拟化：vmx 与 svm

### 6.1 先决条件检查

KVM 把 Linux 变成 Type-1 风格的 hypervisor，前提是 CPU 暴露硬件虚拟化扩展：Intel 是 `vmx`（VT-x），AMD 是 `svm`（AMD-V）。检查分三步，缺一不可：

```bash
grep -o -w "vmx\|svm" /proc/cpuinfo | sort -u   # 第一步：vmx(Intel)/svm(AMD)
# vmx
lsmod | grep -E "^kvm"       # 第二步：kvm_intel/kvm_amd 已加载
ls -l /dev/kvm               # 第三步：设备节点存在；usermod -aG kvm 后需重新登录
```

三步全绿，`virsh`/`virt-manager` 才能创建虚机；第三步权限不够时，virt-manager 会报"连接失败"或打开极慢——**加组后必须重新登录**，`newgrp` 只在当前 shell 生效，这是新手最耗时间的一类"明明装了却连不上"。

### 6.2 安装虚拟化组件（对照）

只验证能力的话，第一步 `grep vmx` 已经够了；要真正建虚机，三系安装对照如下（均以官方源为例）：Debian/Ubuntu 用 `sudo apt install qemu-kvm virt-manager`；Arch 用 `sudo pacman -S qemu-desktop libvirt virt-manager`，并记得 `sudo systemctl enable --now libvirtd`（及 `virtlogd`/`virtlockd`，具体单元以你的 libvirt 版本为准）——**Arch 上启用服务这步最容易被忽略**，不启用则 virt-manager 连接列表里一片空白；RHEL/CentOS/Rocky 用 `sudo dnf install qemu-kvm libvirt virt-manager`。

嵌套虚拟化（在 VM 里再跑 KVM）需内核模块参数 `nested=1`（Intel 为 `kvm_intel`、AMD 为 `kvm_amd`），云主机是否开放嵌套则取决于厂商策略——不确定时先读宿主机文档，不要假设默认开启。

## 7. NUMA 架构入门

### 7.1 什么是 NUMA

NUMA（Non-Uniform Memory Access）把 CPU 和内存划分为多个节点，**访问本地节点的内存快于访问远端节点**——它是内存控制器进 CPU（第 1 节）后的自然结果：每个 socket 各自连着自己的内存通道，跨 socket 要走 UPI/Infinity Fabric。

```text
┌─────────────────┐     ┌─────────────────┐
│    NUMA Node 0   │     │    NUMA Node 1   │
│  ┌─────┐ ┌────┐ │     │ ┌─────┐ ┌────┐  │
│  │CPU  │ │内存│ │     │ │CPU  │ │内存│  │
│  │0,1  │ │    │ │     │ │2,3  │ │    │  │
│  └─────┘ └────┘ │     │ └─────┘ └────┘  │
└────────┬────────┘     └────────┬────────┘
         │      UPI/IF          │
         └───────────┬───────────┘
```

单路机器只有一个 node，一切"本地"；双路及以上才需要真正关心它。数据库、JVM、高频交易这类内存密集负载，跨节点访问的额外延迟会直接体现在 P99 上。

```bash
numactl --hardware   # NUMA 拓扑：node 数、每个 node 的 CPU 与内存
numactl --cpunodebind=0 --membind=0 ./your_app   # 绑定 node 0（策略见内存章）
```

`numactl` 三系安装同名：`apt install numactl`、`pacman -S numactl`、`dnf install numactl`。**内存分配视角的 NUMA 策略（local/interleave、`numastat` 判读）见[内存章 · NUMA](./memory.md)**，本节只负责建立拓扑概念，两页合起来才是完整的 NUMA 入门。

## 8. 信息查看汇总与三系工具

日常排查的命令顺序可以背下来：`lscpu` 看全貌（拓扑、flags、Hypervisor）→ `lscpu -e` 看绑核归属 → `lscpu -C` 补缓存细节 → `cat /proc/cpuinfo` 回到原始 flags 逐项核对 → 需要固件/物理清单时才动 `sudo dmidecode -t processor`（虚拟机中是模拟值）→ 多路机器追加 `numactl --hardware` → 温度看 `sensors`（部分主板才暴露 CPU 温度，且首次需 `sudo sensors-detect` 扫描一次）。这些命令在三系上用法完全一致，差异只在工具包名，按下表与[硬件篇速览表](./README.md)对号入座即可：

| 方面 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| `cpupower` 包 | `linux-tools-common` + `linux-tools-$(uname -r)` | `pacman -S linux-tools` | `dnf install kernel-tools` |
| 温度工具 `sensors` | `apt install lm-sensors`（连字符） | `pacman -S lm_sensors`（下划线） | `dnf install lm_sensors` |
| 持久化调优 | 桌面电源管理组件 / cpufrequtils（按环境核实） | 自建 systemd unit 调 cpupower | `tuned`（`tuned-adm profile`） |
| 虚拟化组 | `qemu-kvm` + libvirt | `pacman -S qemu-desktop libvirt` + 启用 libvirtd | `qemu-kvm` + `libvirt` |

接手陌生机器先跑这一条，一分钟拿到 CPU 侧关键事实：

```bash
lscpu | grep -E "^CPU\(s\)|Model name|Core\(s\)|Thread\(s\)|Socket|Hypervisor"
command -v numactl >/dev/null && numactl --hardware   # 多路才用得上；单路只报 1 个 node
```

`lscpu` 回答"几个核、是不是虚拟机"，绑核规划与归因都从这里起步（第 2、4 节）；`numactl --hardware` 只在 `Socket(s) > 1` 时值得细看，单路确认 1 个 node 即可跳过。需要逐字段深挖再回到对应小节。

## 常见坑

1. **把营销名当 flag。** `/proc/cpuinfo` 里只有 `vmx`/`svm`，没有 `vt-x`/`VT-x`；按 VT-x 去 grep 一定空手而归（见第 4.2 节的更正说明）。
2. **`nproc` 和 `lscpu` 的 CPU(s) 对不上，以为系统坏了。** `nproc` 反映**当前进程可用**的 CPU：被 `taskset`/cpuset/容器 CPU 绑定后会变小，而 `lscpu` 始终是全机拓扑。反过来，cgroup 的 CPU 配额（`cpu.max`，CFS quota）**不会**反映到 `nproc` 里——容器里 `nproc` 显示 16 不代表能用满 16 核，配额要看 cgroup 文件。
3. **虚拟机里找不到 `cpufreq` 目录就以为驱动坏了。** 多数 VM 不模拟调频接口，属正常（第 5.4 节）；此时改 governor 无从谈起，宿主机抖动表现为 VM 的 `steal` 时间。
4. **加完 `kvm` 组不重新登录，然后反复重装软件。** 组权限在登录时才刷新；`id` 看不到 `kvm` 组就是还没生效（第 6.1 节）。
5. **按 16 个"核"排满任务，实际是 8 物理核 × 2 超线程。** 密集计算负载按物理核（`Core(s)×Socket(s)`）规划，把超线程当余量，别当产能（第 2.1 节）。
6. **flags 少了就断言"CPU 坏了/被缩水"。** 先对比是不是 VM（`hypervisor` 位）、是不是 BIOS 关了 AVX/虚拟化（`vmx` 消失的常见原因）、是不是容器裁剪了 `/proc/cpuinfo` 视图。三者都是配置差异，不是硬件故障。

## 参考资料

- Patterson, D. A., & Hennessy, J. L.《计算机组成与设计：硬件/软件接口》
- Intel® 64 and IA-32 Architectures Software Developer Manuals：<https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html>
- AMD64 Architecture Programmer's Manual：<https://developer.amd.com/resources/developer-guides-manuals/>
- Arch Wiki - CPU frequency scaling：<https://wiki.archlinux.org/title/CPU_frequency_scaling>
- Arch Wiki - KVM（vmx/svm 与嵌套虚拟化）：<https://wiki.archlinux.org/title/KVM>
- Arch Wiki - NUMA：<https://wiki.archlinux.org/title/NUMA>
- Red Hat - RHEL 9 硬件兼容性与 x86-64-v2 要求：<https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/considerations_adopting_rhel-9/assembly_hardware-requirements_considerations-adopting-rhel-9>
- Linux Kernel Documentation - CPU scheduler utilization clamps / cpufreq：<https://www.kernel.org/doc/html/latest/admin-guide/pm/cpufreq.html>
- cpupower(1) 手册：<https://man7.org/linux/man-pages/man1/cpupower.1.html>
