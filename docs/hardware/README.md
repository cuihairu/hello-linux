# 硬件篇

运维做到后面会发现：大部分"玄学问题"追到底，都是机器实体层的反馈。CPU 无缘无故变慢，多半是降频、过热或超线程争抢；内存告警此起彼伏，可能只是页缓存把 `free` 列压得很低；磁盘"忽快忽慢"，往往是 SMART 已经在悄悄报错；网络偶发丢包，可能只是链路协商成了半双工。本篇不教你拆机装机，而是建立一条从"机器实体"到"Linux 观测接口"的映射：每一类硬件在内核里叫什么名字、暴露在哪个 `/proc` 或 `/sys` 节点、用哪条命令能拿到证据。概念对了，你在任何发行版上都能自己推导命令；概念错了，拿着工具清单也只能碰运气。

本篇与[基础篇](../basic/README.md)的关系是"先认设备、再认设备上的数据"：基础篇讲文件系统、挂载和权限，本篇讲盘从哪来、卡插在哪、中断怎么走。两篇在存储与网络处会相互引用，建议按顺序阅读，跳读时也请点开交叉链接补齐上下文。

> 本篇以 **Debian/Ubuntu、Arch、RHEL/CentOS/Rocky** 三大发行版家族为主线对照讲解。凡涉及安装工具或行为差异的地方都会标注所属家族；Arch 的安装动作统一写作 `pacman -S`，避免你误以为 Arch 也有 `apt`。三系的内核接口（`/proc`、`/sys`、`lscpu`、`ethtool` 的用法）完全一致，差异几乎只在**包名**和**是否预装**。

## 为什么运维要懂硬件

**第一，故障定位是自上而下的分层排除，硬件是所有层的地基。** 应用报"请求超时"，你可能先查代码、再查网络、再查磁盘——但如果磁盘 SMART 已报 `Reallocated_Sector_Ct` 增长，前面所有软件层的排查都是白费时间。不懂硬件的人会在软件层无限打转，懂硬件的人会先花两分钟跑一遍 `smartctl -H`、`sensors`、`ethtool`，把最底层排除掉再往上走。鸟哥强调的"先了解原理再下命令"，在硬件篇体现得最直接：每条诊断命令背后都对应一个物理事实。

**第二，大量"假故障"必须结合硬件背景才能正确解读。** `free` 里 `free` 列很低不代表内存不够，那是 Linux 把空闲内存拿去做页缓存的设计行为；CPU 占用高不代表代码写得差，可能只是调度器把任务堆在了同一个超线程上，或电源策略压着频率不让上去；磁盘写入突然变慢，可能是 SMART 盘的写缓存被关掉进入了直写模式。观测数字本身不会说话，硬件知识就是给数字补上语境的那块拼图。

**第三，采购、扩容和虚拟化选型都以硬件概念为前提。** 内存条要插在正确的通道上才能组双通道，PCIe 通道数决定了你能同时插几张 NVMe 和几张万兆卡，开 KVM 虚拟机之前必须确认 CPU 暴露了 `vmx`（Intel）或 `svm`（AMD）标志。这些决策没有补救空间——买错了、插错了，软件层再怎么调优也救不回来。

**第四，云与虚拟化时代并没有淘汰硬件知识，只是把它推到了宿主机侧。** 你的虚拟机"莫名卡顿"，可能是宿主机超卖或邻居吵闹（`steal` 时间升高）；你的容器"内存莫名被杀"，可能是 cgroup 限额而非物理内存不足。能区分"客户机问题"和"底层硬件问题"，在向云厂商提工单时也能给出对方无法敷衍的证据。

**第五，安全基线本身就写在 CPU 的 flags 里。** SMEP、SMAP、NX、虚拟化标志、IOMMU 能力，这些既是性能话题也是安全话题——合规检查的第一步往往就是确认这些能力是否开启。硬件篇是后面[安全篇](../security/README.md)中"固件与启动链信任"部分的前置知识。

## 学习路线

本篇五章按"先建立整体地图，再逐类设备深入"的顺序排列，每一环都依赖上一环：

| 阶段 | 章节 | 为什么放在这里 |
|------|------|----------------|
| 1. 建立整体地图 | [计算机体系结构](./architecture.md) | 先知道机器由哪几大件组成、`lscpu`/`dmidecode` 这两个总入口怎么用，后面每章都在这张地图上展开 |
| 2. 处理器视角 | [CPU](./cpu.md) | 性能问题的第一现场：拓扑、flags、降频、虚拟化能力都由它决定 |
| 3. 内存视角 | [内存](./memory.md) | 第二现场：虚拟内存、OOM、`free` 读数、NUMA，堵住新手最容易误判的一类告警 |
| 4. 数据落地 | [存储设备](./storage.md) | 唯一可能造成**不可逆数据损失**的一层，块层、SMART、分区关系必须吃透 |
| 5. 连通性基础 | [网络设备](./network.md) | 从硬件视角看网卡、驱动与链路，与[网络篇](../network/README.md)的协议栈视角互补 |

一个可操作的自检标准：学完本篇后，你应该能在一台陌生机器上回答——"这台机器几个物理核几个逻辑核、是不是虚拟机、内存条什么规格有没有 ECC、根分区在哪块盘健不健康、网卡是什么驱动跑在哪个 PCIe 槽上"。五个问题都能用命令拿到证据，硬件篇就算过关。查不到答案时，先回到[体系结构](./architecture.md)的"信息入口"一节，那里是所有问题的起点。

## 子页导读

| 章节 | 一句话导读 | 适合带着什么问题去读 |
|------|-----------|---------------------|
| [计算机体系结构](./architecture.md) | 冯·诺依曼、中断、PCIe 为什么是排障地图的一部分，`lscpu`/`dmidecode` 两个总入口 | "设备在系统里是怎么被 CPU 看到的？" |
| [CPU](./cpu.md) | 拓扑与超线程、flags 的真实含义（`vmx`/`svm`）、频率降频、硬件虚拟化 | "机器为什么变慢了？这台机器能不能开虚拟机？" |
| [内存](./memory.md) | 虚拟内存与页表、OOM Killer、`free`/`vmstat` 读数、Swap 与大页、NUMA 入门 | "内存到底够不够？进程为什么被 Killed？" |
| [存储设备](./storage.md) | 块层与 I/O 路径、HDD/SSD/NVMe、`lsblk`/`smartctl`、分区与挂载的栈式关系 | "数据写下去经过了什么？这块盘还能撑多久？" |
| [网络设备](./network.md) | 网卡结构、驱动绑定、`ethtool`、中断与多队列、链路协商 | "包还没进协议栈之前，在硬件上出了什么问题？" |

子页之间的引用是有分工的，读之前先记住三条边界，避免重复劳动：

- **存储页与基础篇的分工**：本篇只讲"盘本身"（块层、接口、健康、分区表），`mkfs`、`mount`、`/etc/fstab` 的操作细节归[基础篇 · 文件系统](../basic/filesystem.md)，本篇相关小节只给关系图和交叉链接，不重复教程。
- **网络页与网络篇的分工**：本篇讲"包进入协议栈之前"的硬件路径——网卡、驱动、DMA、中断、链路协商；IP 地址怎么配、路由怎么排、防火墙怎么看，请去[网络篇](../network/README.md)。
- **CPU 页与内存页在 NUMA 处交叉**：CPU 页解释"什么是 NUMA 节点"（拓扑事实），内存页解释"进程该绑哪个节点的内存"（分配策略），两页各讲一半，互相链接。

> 内容参考自 Arch Wiki、鸟哥的私房菜与内核文档，见各章节参考资料。

## 学习目标

- 理解冯·诺依曼体系与 PCIe 拓扑，能用 `lscpu`、`dmidecode` 给一台陌生机器"验明正身"
- 掌握 CPU 拓扑、flags 与降频机制，能用证据判断"变慢"是否来自超线程争抢、降频或虚拟机 steal 时间
- 能正确解读 `free`/`vmstat` 读数，避开"`free` 列低 = 内存不足"的误判，理解 OOM Killer 的触发条件
- 掌握块层与 SMART 健康检查，能用 `lsblk`、`smartctl` 判断磁盘是否即将失效，并分清 `hdparm` 与 `nvme` 的适用范围
- 能用 `ethtool` 检查链路协商与驱动状态，分清"包进协议栈之前"的硬件问题与协议栈问题
- 掌握三系诊断工具的包名差异（如 `lm-sensors` 与 `lm_sensors`），能一次性装齐并体检本机工具链

## 三系诊断工具速览

同一把工具在三大发行版中的**包名和是否预装**并不一致。下表是本篇反复使用的"安装底座"，后文各页涉及工具时不再重复解释包名差异——照这张表把工具装齐，再往下读会顺畅很多：

| 任务（命令） | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------------|---------------|------|-------------------|
| CPU 概览 `lscpu` | 预装（`util-linux`） | `pacman -S util-linux` | 预装（`util-linux`） |
| 硬件总览 `lshw` | `apt install lshw` | `pacman -S lshw` | `dnf install lshw` |
| 主板/内存条 `dmidecode` | `apt install dmidecode` | `pacman -S dmidecode` | `dnf install dmidecode` |
| 温度电压 `sensors` | `apt install lm-sensors` | `pacman -S lm_sensors` | `dnf install lm_sensors` |
| 调频 `cpupower` | `apt install linux-tools-common linux-tools-$(uname -r)` | `pacman -S linux-tools` | `dnf install kernel-tools` |
| 实时负载 `htop` | `apt install htop` | `pacman -S htop` | `dnf install htop` |
| NUMA `numactl` | `apt install numactl` | `pacman -S numactl` | `dnf install numactl` |
| 内存拓扑 `lstopo` | `apt install hwloc` | `pacman -S hwloc` | `dnf install hwloc` |
| 历史采样 `sar` | `apt install sysstat` | `pacman -S sysstat` | `dnf install sysstat` |
| 总线 `lspci`/`lsusb` | `apt install pciutils usbutils` | `pacman -S pciutils usbutils` | `dnf install pciutils usbutils` |
| 磁盘健康 `smartctl` | `apt install smartmontools` | `pacman -S smartmontools` | `dnf install smartmontools` |
| NVMe `nvme` | `apt install nvme-cli` | `pacman -S nvme-cli` | `dnf install nvme-cli` |
| 网卡属性 `ethtool` | `apt install ethtool` | `pacman -S ethtool` | `dnf install ethtool` |

三处包名陷阱值得提前记住，它们是新手"命令装不上"的高发原因：Debian/Ubuntu 的温度工具包叫 **`lm-sensors`（连字符）**，而 Arch 和 RHEL 叫 **`lm_sensors`（下划线）**，照着另一个系的包名装会直接报"无法定位包"；Debian 的调频工具要装**与当前内核版本匹配**的 `linux-tools-$(uname -r)`，只装 `linux-tools-common` 会提示找不到 `cpupower`；RHEL 系若提示某个诊断包不存在，先确认 EPEL 等扩展仓库是否已启用。

工具装齐后，用一条命令快速体检本机的诊断能力：

```bash
for t in lscpu dmidecode sensors smartctl ethtool lspci nvme numactl; do
  command -v "$t" >/dev/null && echo "OK   $t" || echo "MISS $t"
done
```

缺失的按上表补齐即可。`lscpu` 与 `lspci` 属于系统基础包，正常安装的发行版不应缺失——如果连它们都没有，先怀疑你的最小化安装裁剪得过狠，或 PATH 配置出了问题，而不是硬件坏了。

## 阅读约定与常见误区

本篇沿用全书约定：每节先讲"为什么需要这个概念"，再给命令；示例输出取自典型的 x86_64 主机，你机器上的数值不同属正常，重点看字段结构；没有把握的版本差异一律不写，或明确标注"需按你的版本核实"。涉及三系安装的地方以速览表为准，正文中不再逐条重复。

开始阅读前，四个高频误区先摆出来，它们几乎每个都会在本篇对应的章节被反复纠正：

1. **`free` 列很低 = 内存快没了**——错，看 `available`；详见[内存](./memory.md)。
2. **`hdparm` 能测任何盘**——错，`hdparm` 只对 SATA/PATA 有意义，NVMe 请用 `nvme` 工具或 `fio`；详见[存储设备](./storage.md)。
3. **虚拟机里 `dmidecode` 看到的就是真实硬件**——错，你读到的是 hypervisor 模拟出来的固件信息；详见[计算机体系结构](./architecture.md)的常见坑。
4. **`ethtool` 改完的参数会永久生效**——错，多数运行时参数重启即失，持久化要交给网络配置层；详见[网络设备](./network.md)。

带着这四个警觉进入正文，能省下大量"照抄命令却得到意外结果"的挫败。

## 参考资料

- 鸟哥的私房菜 - 认识计算机硬件 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0105computers.php)
- 鸟哥的私房菜 - 系统管理工具 — [linux.vbird.org](https://linux.vbird.org/linux_server/)
- Arch Wiki - Hardware 分类 — [wiki.archlinux.org](https://wiki.archlinux.org/title/Category:Hardware)
- Arch Wiki - 安装程序前的系统要求（含 CPU flags 基线） — [wiki.archlinux.org](https://wiki.archlinux.org/title/Arch_Linux)
- Linux Hardware Database — [linux-hardware.org](https://linux-hardware.org/)
- Linux 内核文档 — [kernel.org](https://www.kernel.org/doc/html/latest/)
- Patterson & Hennessy《计算机组成与设计：硬件/软件接口》
- Bryant & O'Hallaron《深入理解计算机系统》（CSAPP）
- Intel® 64 and IA-32 Architectures Software Developer Manuals — [intel.com](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html)
- AMD64 Architecture Programmer's Manual — [developer.amd.com](https://www.amd.com/en/support/tech-docs)
