# 计算机体系结构

体系结构常被当成历史课跳过，但它其实是排障时的地图：CPU 如何"看到"一块网卡、一次缺页异常为什么会让进程停顿、中断为什么能打满单个核——这些问题的答案都画在同一张图上。本章把冯·诺依曼结构、指令执行、总线与中断这些教科书概念，逐一挂到 Linux 的观测接口上（`lscpu`、`dmidecode`、`/proc/interrupts`、`lspci`），为后续学习 CPU、内存、存储等具体硬件奠定基础。读完本章你应该形成一个习惯：看到任何硬件问题，先问"这在体系结构的哪一层"，再选命令。

> 内容参考自经典教材、Intel/AMD 官方手册与 Linux 内核文档，见文末参考资料。

## 学习目标

- 理解冯·诺依曼体系结构，以及"存储程序"如何对应到 `/proc` 下的进程内存视图
- 掌握指令执行与指令集架构（ISA）的基本概念，能解释 `illegal instruction` 的硬件根源
- 理解总线与 PCIe 在现代机器上的真实拓扑，会用 `lspci -k` 找到设备与驱动的绑定关系
- 理解中断分类与 `/proc/interrupts` 的读法，能判断"单核被打满"是不是中断分摊不均
- 掌握 `lscpu` 与 `dmidecode` 两个硬件信息总入口，知道它们在三系发行版上的安装方式

## 1. 冯·诺依曼体系结构与 Linux

1945 年，冯·诺依曼（John von Neumann）提出了"存储程序"的计算机设计思想：指令和数据一样存放在存储器中，CPU 按序取指令执行。至今它仍是绝大多数计算机的基础架构——也正因如此，Linux 里"程序"和"数据"在内存中并不存在天然的边界，这直接决定了进程隔离、权限模型和大量安全机制的形态。

### 1.1 五大部件

```text
                     ┌─────────────┐
                     │    控制器    │
                     │(Control Unit)│
                     └──────┬──────┘
                            │
           ┌────────────────┼────────────────┐
           │                │                │
    ┌──────┴──────┐  ┌─────┴──────┐  ┌──────┴──────┐
    │   运算器    │  │   存储器    │  │  输入/输出   │
    │    (ALU)    │  │  (Memory)   │  │   (I/O)     │
    └─────────────┘  └────────────┘  └─────────────┘
```

| 部件 | 功能 | 在 Linux 里对应的观察对象 |
|------|------|---------------------------|
| 运算器（ALU） | 执行算术和逻辑运算 | `lscpu` 报告的型号、主频、flags（AVX 等向量单元） |
| 控制器（CU） | 协调各部件工作，解析指令 | 指令指针、流水线状态（`perf` 的分支事件） |
| 存储器 | 存储程序和数据 | `free`、`/proc/meminfo`、页表 |
| 输入设备 | 向计算机输入数据（键盘、网卡、磁盘） | `/dev/input`、`/proc/interrupts` |
| 输出设备 | 向外界输出结果（显示器、磁盘、网卡） | `/sys/block`、`ip -s link` |

把这张表横着读一遍，你会发现本篇后续每一章都在回答同一句话："某个部件的状态，从 Linux 的哪个入口去看。"

### 1.2 存储程序原理为什么与排障相关

核心思想是程序指令和数据都存储在内存中，CPU 按顺序从内存取出指令并执行。这条看似抽象的推论在排障时有三个直接后果：

1. **程序必须先加载进内存才能跑。** 磁盘上的二进制、动态库和运行时的内存映像是两份东西。进程崩溃时看的是内存里的映像（core dump、`/proc/<pid>/maps`），而不是磁盘上的文件——所以"磁盘上的文件明明是新的，进程行为还是旧的"往往说明该进程还没重启，或动态库被旧缓存加载着。
2. **指令与数据同处可寻址内存，必须靠硬件+内核双重隔离。** 没有隔离，一个进程就能改写另一个进程的指令——这就是 NX 位、SMEP/SMAP、页表权限位存在的原因，也是"不可执行栈"这类安全特性的体系结构根源。这些能力最终都以 flag 的形式出现在 `/proc/cpuinfo` 里，见 [CPU 章](./cpu.md)。
3. **"取指令—执行"的每一环都可能失败，且失败表现为异常。** 缺页（第 14 号向量）、非法指令（第 0 号向量）、段错误，都是这条链上断掉的一环。看到 `SIGSEGV` 时，你应该能想到它对应的是访存阶段的地址翻译失败，而不是笼统的"程序写错了"。

```bash
# 进程内存布局：r-x 段是指令，r--/rw- 段是数据（存储程序结构的可视化）
cat /proc/self/maps | head -2
```

## 2. 指令执行流程与指令集

### 2.1 经典五级流水线

CPU 执行一条指令分为取指、译码、执行、访存、写回五个阶段；流水线让多条指令重叠执行，超标量则让每个周期发射多条指令到不同执行单元。现代 CPU 的流水线实际远深于五级（Intel/AMD 通常十余级到二十余级），但五级模型足以解释排障中常问的一件事：**为什么取指和访存阶段慢会拖垮整体**——取指依赖指令缓存，访存依赖数据缓存和主存延迟，这两处的层次结构见第 6 节，也是 [CPU 章](./cpu.md)缓存一节的伏笔。

| 阶段 | 英文 | 功能 | 失败时的表现 |
|------|------|------|--------------|
| 取指 | Instruction Fetch (IF) | 从内存读取指令 | 指令页不在内存 → 缺页（major fault） |
| 译码 | Instruction Decode (ID) | 解析指令含义 | 无法识别的编码 → `SIGILL`（非法指令） |
| 执行 | Execute (EX) | ALU 执行运算 | 除零 → `SIGFPE` |
| 访存 | Memory Access (MEM) | 读写内存数据 | 地址非法 → `SIGSEGV` |
| 写回 | Write Back (WB) | 结果写回寄存器 | — |

```bash
# 查看 CPU 型号、指令集扩展与架构（flags 详解见 CPU 章）
lscpu | grep -E "Model name|Flags" | cut -c1-100
uname -m   # x86_64 = 64位 x86；aarch64 = 64位 ARM
```

### 2.2 指令集架构（ISA）：软件与硬件的合同

指令集架构是软件和硬件之间的接口规范。同一份源码编译成哪种 ISA 的机器码，决定了它能在哪些机器上运行：

| 架构 | 代表厂商 | 特点 | 排障相关点 |
|------|---------|------|-----------|
| x86/x86-64 | Intel、AMD | CISC，桌面/服务器主流 | `uname -m` 显示 `x86_64`；32 位程序需要多库支持 |
| ARM | ARM Holdings | RISC，移动/嵌入/云（Graviton 等） | `uname -m` 显示 `aarch64`；很多 x86 工具在 ARM 上要换包 |
| RISC-V | 开源 | RISC，新兴架构 | 目前多见于开发板，工具链尚在完善 |

`uname -m` 是判断当前机器架构的第一命令：`x86_64` 对应 64 位 x86，`aarch64` 对应 64 位 ARM——跨架构搬运二进制、查包名之前先跑它，比记住发行版文档里的"支持平台"更可靠。

ISA 对排障的实际意义在于解释一类经典报错：**`Illegal instruction`**。它的根源几乎总是"二进制用到了当前 CPU 不支持的指令"——要么程序是在更新的机器上编译的（用了 AVX-512 而这台机器没有），要么发行版的二进制基线高于这台老机器（例如 RHEL 9 要求 x86-64-v2 及以上指令集，2010 年前的 CPU 无法运行）。判断方法是对照 `/proc/cpuinfo` 的 flags，详见 [CPU 章 · flags](./cpu.md)。

## 3. 总线与 PCIe：设备为什么"看不见"

总线是计算机各部件之间传输数据的公共通道。理解它的演进史，能解释你在 `lspci` 输出里看到的许多"遗迹"。

### 3.1 从南北桥到现代拓扑

```text
┌─────────┐     内存通道(直连)      ┌─────────┐
│   CPU   │───────────────────────│  内存    │
│(内置MC) │                        └─────────┘
└────┬────┘
     │UPI/QPI(多路互联) 或 DMI(到芯片组)
┌────┴────┐
│  芯片组  │──── SATA / USB / 低速 PCIe
└────┬────┘
     │ PCIe 根端口
┌────┴────────────────────┐
│  PCIe 设备: NVMe/网卡/GPU│
└─────────────────────────┘
```

教科书上的"北桥管内存与显卡、南桥管慢速外设"是正确的历史模型，但注意上图那行注释——**现代 CPU 已将内存控制器和大量 PCIe 根端口集成到内部，北桥作为独立芯片已消失**。这带来两个排障上的现实变化：内存带宽不再经过"前端总线"这个公共瓶颈（FSB 已淘汰）；而多路服务器上，CPU 与 CPU 之间的互联（Intel UPI / AMD Infinity Fabric）成了新的"总线"，也催生了 NUMA（见 [CPU 章](./cpu.md)）。

| 总线类型 | 作用 | 带宽参考 |
|---------|------|---------|
| 前端总线（FSB） | CPU 与芯片组通信 | 已淘汰，仅见于老设备 |
| 内存总线 | CPU 与内存通道 | DDR5-6400 双通道约 102 GB/s（理论值） |
| UPI / Infinity Fabric | 多路 CPU 互联 | 决定 NUMA 跨节点延迟 |
| PCIe | 高速设备接口 | PCIe 5.0 x16 约 64 GB/s（双向、含编码开销前） |
| SATA | 存储设备接口 | SATA III 上限 6 Gbps（约 600 MB/s） |
| USB | 通用外设接口 | USB 3.2 Gen2 x2 理论 20 Gbps |

### 3.2 为什么 PCIe 与 Linux 排障直接相关

对运维来说，PCIe 不是带宽数字，而是三件具体的事：

1. **设备在不在。** `lspci` 能列出设备，说明 PCIe 枚举成功；列表里根本没有你要的卡，问题在硬件接触、插槽供电或固件（BIOS/直通配置），此时去查驱动是南辕北辙。
2. **驱动绑没绑。** 同一个 `lspci` 条目，`-k` 参数会显示 `Kernel driver in use`。有设备却无驱动绑定，设备就不会生成 `/dev/nvme0`、`eth1` 这样的节点——这是"卡插着但系统里找不到"的标准排查路径。
3. **设备挂在哪条路径上。** PCIe 设备通过 IOMMU 映射参与 DMA；虚拟化直通（VFIO）、网卡中断的 NUMA 亲和性，都以"设备挂在哪个 CPU/PCIe 域"为前提，这部分进阶见 [CPU 章](./cpu.md)与 [网络设备章](./network.md)。

```bash
lspci -tv    # PCIe 设备树（层级与带宽 x1/x4/x16）
lspci -k | grep -A3 -i ethernet   # 驱动绑定情况（排障首选）
# 03:00.0 Ethernet controller: Intel I350 Gigabit Network Connection
#         Kernel driver in use: igb   ← 此行缺失 = 驱动没加载
lsusb        # USB 总线
```

三系发行版上，`lspci` 来自 `pciutils`、`lsusb` 来自 `usbutils`，均为默认预装；若被最小化安装裁掉：Debian/Ubuntu 用 `apt install pciutils usbutils`，Arch 用 `pacman -S pciutils usbutils`，RHEL/CentOS/Rocky 用 `dnf install pciutils usbutils`。

## 4. 寄存器：CPU 的工作台

寄存器是 CPU 内部的高速存储单元，访问速度在存储层次中排第一（见第 6 节）。对日常排障而言，你不需要背下全部寄存器，但两类场景会用到它们：程序崩溃时 core dump 里的寄存器快照，以及用 GDB/`perf` 定位问题时的现场还原。

### 4.1 x86-64 通用寄存器（速查）

| 寄存器 | 64 位名称 | 用途 |
|--------|---------|------|
| RAX | rax | 返回值、累加器 |
| RBX | rbx | 基址寄存器 |
| RCX | rcx | 计数器 |
| RDX | rdx | 数据寄存器 |
| RSI | rsi | 源变址寄存器 |
| RDI | rdi | 目的变址寄存器 |
| RBP | rbp | 栈基址指针 |
| RSP | rsp | 栈顶指针 |
| R8-R15 | r8-r15 | 扩展通用寄存器 |
| RIP | rip | 指令指针（程序计数器），指向下一条要执行的指令 |
| RFLAGS | rflags | 标志寄存器（进位、零、方向等） |

寄存器对日常排障的落点在崩溃现场：core dump 与 `gdb` 的 `info registers`（快照）、`bt`（栈回溯）配合，才能把 `SIGSEGV` 定位到具体指令与调用链——单看某个寄存器值意义有限，结合回溯才有结论。编译时带上 `-g` 才有符号可用。

### 4.2 段寄存器与 64 位模式

| 寄存器 | 用途 |
|--------|------|
| CS | 代码段 |
| DS | 数据段 |
| SS | 栈段 |
| ES/FS/GS | 附加数据段（x86-64 下 FS/GS 常用于线程本地存储） |

> 在 64 位模式下，段寄存器的作用已大大简化：段基址基本被忽略，分段机制让位于分页机制——内存保护真正的工作由页表完成，见 [内存章](./memory.md)。

## 5. 中断机制：硬件如何"喊话"给 CPU

中断是 CPU 响应外部或内部事件的机制。没有它，CPU 就只能轮询设备——这正是理解"为什么网卡能一秒钟处理百万个包而 CPU 占用却不高"的钥匙：设备通过中断（及后续的 NAPI/轮询混合机制）主动通知 CPU，而不是 CPU 反复查问。

### 5.1 三类事件的区分

| 类型 | 来源 | 示例 | 观察入口 |
|------|------|------|----------|
| 硬中断（hardware IRQ） | 外部硬件 | 网卡收到数据包、磁盘完成 I/O、定时器 | `/proc/interrupts` |
| 软中断（softirq） | 内核延迟下半部 | `NET_RX`/`NET_TX`（网络收发）、`TIMER`、`TASKLET` | `/proc/softirqs` |
| 异常（exception） | CPU 执行指令时触发 | 除零错误、缺页异常、非法指令 | 内核日志、core dump |

> 注意术语：日常口语把系统调用也叫"软中断"，但 Linux 文档中的 **softirq 特指内核的延迟执行机制**（`/proc/softirqs` 里那些条目），与第 0x80 号向量不是一回事。读文档时按上下文区分，别把两个"软"混为一谈。

### 5.2 中断处理流程

一次硬中断的处理大致是：CPU 检测到中断信号 → 保存当前执行状态（寄存器、程序计数器）→ 查询中断向量表找到处理程序入口 → 跳转执行中断处理程序（复杂的处理常转入 softirq 上下半部）→ 完成后恢复之前的状态继续执行被中断的程序。对运维的启示是：**中断处理本身消耗 CPU 时间**，某个 CPU 的 `us+sy` 很高却查不到用户进程时，打开 `/proc/interrupts` 看看是不是某个设备的中断全堆在一个核上——多队列网卡与 `irqbalance` 就是为此存在的，见 [网络设备章](./network.md)。

```bash
grep -E "eth|nvme|timer|TLB" /proc/interrupts   # 每 CPU 一列，看分布是否倾斜
#            CPU0       CPU1       CPU2       CPU3
# 40:  152039452          0          0          0  IR-PCI-MSI-edge  nvme0q0
grep -E "NET_RX|TIMER" /proc/softirqs   # 软中断（NET_RX 飙高 = 收包压力大）
```

### 5.3 中断向量表

中断向量表（及 IDT）存储了各类中断处理程序的入口地址。Linux 在 x86 上的典型分配：

| 向量号 | 类型 | 说明 |
|--------|------|------|
| 0 | 异常 | 除零错误 |
| 13 | 异常 | 通用保护故障 |
| 14 | 异常 | 缺页异常（分页机制的核心，见内存章） |
| 32-255 | 硬中断 | 可编程硬件中断从 32 起分配（0-31 保留给异常） |
| 128 (0x80) | 传统陷入 | Linux x86 上历史遗留的**系统调用**入口（现代 x86-64 代码主要用 `syscall` 指令） |

> 0x80 是软件主动执行 `int 0x80` 触发的系统调用陷入，属于"软中断/陷阱"意义上的事件，**不是** `/proc/softirqs` 里统计的 softirq，也不是硬件 IRQ。把三者分清，读内核日志和性能文档时才不会串线。

## 6. 存储层次结构与 Linux 的"内存观"

存储器按速度和容量形成层次结构——这不是为了考试背的梯子，而是解释"为什么 Linux 故意不把内存留成 free"的理论依据：

```text
        速度 ↑          容量 ↓
        ┌─────┐
        │寄存器│  ~1 ns      几百字节
        ├─────┤
        │ L1  │  ~1 ns      32-64 KB/核
        ├─────┤
        │ L2  │  ~3 ns      256 KB-2 MB/核
        ├─────┤
        │ L3  │  ~10 ns     几 MB-几十 MB（多核共享）
        ├─────┤
        │内存  │  ~100 ns    几 GB-几 TB
        ├─────┤
        │ SSD │  ~100 μs    几百 GB-几 TB
        ├─────┤
        │ HDD │  ~10 ms     几 TB-几十 TB
        └─────┘
```

| 层级 | 介质 | 速度 | 容量 | 成本/GB |
|------|------|------|------|---------|
| L1/L2 缓存 | SRAM | ~1-3 ns | 每核几百 KB | 极高 |
| L3 缓存 | SRAM | ~10 ns | 几 MB-几十 MB | 高 |
| 主内存 | DRAM | ~100 ns | 几 GB-几 TB | 中等 |
| 固态硬盘 | NAND Flash | ~100 μs | 几百 GB-几 TB | 低 |
| 机械硬盘 | 磁盘 | ~10 ms | 几 TB-几十 TB | 最低 |

内存比 SSD 快约三个数量级、SSD 比 HDD 快约两个数量级——正因为差距如此悬殊，内核会把暂时空闲的内存拿来做**页缓存**：重复读文件就能命中内存。于是长期运行的机器 `free` 很低、`buff/cache` 很高是设计如此，不是泄漏；判断内存够不够要看 `available` 列，详见 [内存章](./memory.md)。同理，数据"写进"文件系统后并未立刻到达盘上，写缓存与刷盘策略见 [存储设备章](./storage.md)。

```bash
lscpu -C 2>/dev/null || lscpu | grep -i cache   # 各级缓存大小
free -h && lsblk -d -o NAME,SIZE,ROTA           # 内存与磁盘容量、是否机械盘
# 缓存行等高级参数也可 getconf LEVEL1_DCACHE_LINESIZE 一类宏直接问 libc
```

## 7. 实战：lscpu 与 dmidecode 两个总入口

前面六节建立的地图，落到操作上就是两个入口：**`lscpu` 回答"CPU 与拓扑"，`dmidecode` 回答"这台机器的物理清单"**。日常排障先跑这两条，九成的"这是台什么机器"问题就解决了。

### 7.1 lscpu：CPU 侧的总入口

`lscpu` 读取 `/proc/cpuinfo` 与 `/sys` 的拓扑信息并整理成表，是无需 root 的第一入口：

```bash
$ lscpu | grep -E "^CPU\(s\)|Model name|Thread|Core|Socket|Hypervisor"
CPU(s):                   8
Model name:               Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz
Thread(s) per core:       2
Core(s) per socket:       4
Hypervisor vendor:        KVM   ← 有值 = 虚拟机；物理机通常为 None
```

输出里最有排障价值的是 `Hypervisor vendor`（区分物理机/虚拟机，直接影响你对抖动的归因）和 `Thread(s) per core`（判断超线程是否开启，影响绑核策略）。拓扑与 flags 的完整解读见 [CPU 章](./cpu.md)。

### 7.2 dmidecode：物理硬件清单

`dmidecode` 从 BIOS/SMBIOS 表中读取硬件信息，能报出内存条规格、主板型号、机箱序列号等 `lscpu` 看不到的物理细节。它**必须以 root 运行**，且信息由固件提供：

```bash
# 三系安装：apt install dmidecode / pacman -S dmidecode / dnf install dmidecode
sudo dmidecode -t memory | grep -E "Size|Speed|Type:" | head -8
sudo dmidecode -t baseboard   # 主板型号；-t processor 看插槽上的 CPU
```

需要 `lshw` 做更完整的硬件树时：`apt install lshw`、`pacman -S lshw`、`dnf install lshw`，然后 `sudo lshw -short` 一页看全。ARM 开发板上没有传统 BIOS，改看设备树：`ls /sys/firmware/devicetree/base/`。

## 8. 三系差异速览

本页命令三系用法一致，差异只在包名与是否预装：

| 场景 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| `lscpu` | 预装（`util-linux`） | 预装 | 预装 |
| `dmidecode` | `apt install dmidecode` | `pacman -S dmidecode` | `dnf install dmidecode` |
| `lshw` | `apt install lshw` | `pacman -S lshw` | `dnf install lshw` |
| `lspci`/`lsusb` | 预装（最小化安装或缺） | `pacman -S pciutils usbutils` | `dnf install pciutils usbutils` |
| `sensors` | `apt install lm-sensors`（连字符） | `pacman -S lm_sensors`（下划线） | `dnf install lm_sensors` |

内核接口（`/proc`、`/sys`）与输出格式三系相同，差异只在包名——`lm-sensors`/`lm_sensors` 连字符与下划线之别是高发陷阱。完整底座见 [README · 三系诊断工具速览](./README.md)。

## 9. 常见坑

1. **虚拟机/云主机里 `dmidecode` 读到的是"假"硬件。** 序列号、主板型号都是 hypervisor 模拟或注入的，不能当作采购凭证；内存条数量也未必等于你下单的配置。以 hypervisor 控制台或云厂商文档为准，`dmidecode` 在这些环境里只适合看"虚拟机被配置成了什么规格"。
2. **容器里的 `/proc/interrupts`、`/sys` 是宿主机的命名空间视图。** 你在容器内看到的中断计数、PCIe 设备属于宿主机，不是本容器的"硬件"。容器层面的资源限制要去 cgroup 看（`/sys/fs/cgroup/`），别对着容器里的 `lspci` 排查宿主机故障。
3. **`lspci` 完全没有输出或缺设备，先查枚举再查驱动。** 虚拟机默认机型（如 i440fx）可能没给你模拟目标设备，需在虚拟机配置里添加；物理机则检查插槽、供电与 BIOS 设置。`lspci` 有设备但没有 `Kernel driver in use`，才是驱动问题——见第 3.2 节。
4. **在 ARM 机器上照抄 x86 命令。** `uname -m` 是 `aarch64` 时，没有 `dmidecode` 可读的信息源（改用设备树/`/sys/firmware`），GDB 里的寄存器名也完全不同。跨架构作业前先 `uname -m` 确认。
5. **把"软中断"、0x80、硬件 IRQ 当成同一件事。** 三者的观察入口分别是 `/proc/softirqs`、系统调用跟踪（`strace`）、`/proc/interrupts`，混用会导致结论完全跑偏（见第 5.1 节的术语框）。
6. **拿旧教科书的"北桥/FSB"直接套现代机器。** 内存控制器早已进 CPU，老机器上的结论（"升级北桥提带宽"）在现代平台上不成立；带宽问题应查通道数、插法与 NUMA，见 [内存章](./memory.md)。

## 参考资料

- Patterson, D. A., & Hennessy, J. L.《计算机组成与设计：硬件/软件接口》（RISC-V 版），机械工业出版社
- Bryant, R. E., & O'Hallaron, D. R.《深入理解计算机系统》（CSAPP），机械工业出版社
- 鸟哥的私房菜 - 认识计算机硬件 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0105computers.php)
- Arch Wiki - Hardware 分类 — [wiki.archlinux.org](https://wiki.archlinux.org/title/Category:Hardware)
- Arch Wiki - dmidecode — [wiki.archlinux.org](https://wiki.archlinux.org/title/Category:Hardware)
- Intel® 64 and IA-32 Architectures Software Developer Manuals — [intel.com](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html)
- AMD64 Architecture Programmer's Manual — [developer.amd.com](https://www.amd.com/en/support/tech-docs)
- Linux Kernel Documentation — [kernel.org](https://www.kernel.org/doc/html/latest/)
- dmidecode 项目主页 — [git.kernel.org](https://git.kernel.org/pub/scm/utils/dmidecode/dmidecode.git)
- Wikipedia: Von Neumann architecture — [en.wikipedia.org](https://en.wikipedia.org/wiki/Von_Neumann_architecture)
