# 计算机体系结构

本章介绍计算机硬件的基本工作原理，为后续学习 CPU、内存、存储等具体硬件奠定基础。

> 内容参考自经典教材和厂商文档，见文末参考资料。

## 学习目标

- 理解冯·诺依曼体系结构
- 掌握指令执行的基本流程
- 了解总线、寄存器、中断的作用
- 理解存储层次结构

## 1. 冯·诺依曼体系结构

1945 年，冯·诺依曼（John von Neumann）提出了"存储程序"的计算机设计思想，至今仍是绝大多数计算机的基础架构。

### 1.1 五大部件

```
                    ┌─────────────┐
                    │    控制器    │
                    │ (Control Unit)│
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────┴──────┐  ┌─────┴──────┐  ┌──────┴──────┐
   │   运算器    │  │   存储器    │  │  输入/输出   │
   │    (ALU)    │  │  (Memory)   │  │   (I/O)     │
   └─────────────┘  └────────────┘  └─────────────┘
```

| 部件 | 功能 |
|------|------|
| 运算器（ALU） | 执行算术和逻辑运算 |
| 控制器（CU） | 协调各部件工作，解析指令 |
| 存储器 | 存储程序和数据 |
| 输入设备 | 向计算机输入数据（键盘、磁盘） |
| 输出设备 | 向外界输出结果（显示器、磁盘） |

### 1.2 存储程序原理

核心思想：程序指令和数据都存储在内存中，CPU 按顺序从内存取出指令并执行。

```bash
# 在 Linux 中，程序存储在磁盘上，加载到内存后由 CPU 执行
# 查看进程的内存布局
cat /proc/self/maps
```

## 2. 指令执行流程

CPU 执行一条指令分为以下阶段：

### 2.1 经典五级流水线

```
时钟周期 →  1      2      3      4      5
           ┌──────┬──────┬──────┬──────┬──────┐
指令 1     │ 取指 │ 译码 │ 执行 │ 访存 │ 写回 │
           └──────┴──────┴──────┴──────┴──────┘
指令 2            │ 取指 │ 译码 │ 执行 │ 访存 │ 写回
                  └──────┴──────┴──────┴──────┴──────┘
```

| 阶段 | 英文 | 功能 |
|------|------|------|
| 取指 | Instruction Fetch (IF) | 从内存读取指令 |
| 译码 | Instruction Decode (ID) | 解析指令含义 |
| 执行 | Execute (EX) | ALU 执行运算 |
| 访存 | Memory Access (MEM) | 读写内存数据 |
| 写回 | Write Back (WB) | 结果写回寄存器 |

```bash
# 查看 CPU 支持的指令集架构
cat /proc/cpuinfo | grep "model name"
lscpu | grep "Model name"

# 查看 CPU 支持的扩展指令集
grep -o "sse\|avx\|avx2\|avx512" /proc/cpuinfo | sort -u
```

### 2.2 指令集架构（ISA）

指令集架构是软件和硬件之间的接口规范：

| 架构 | 代表厂商 | 特点 |
|------|---------|------|
| x86/x86-64 | Intel、AMD | CISC，桌面/服务器主流 |
| ARM | ARM Holdings | RISC，移动/嵌入式 |
| RISC-V | 开源 | RISC，新兴架构 |

```bash
# 查看当前架构
uname -m
# x86_64 = 64位 x86
# aarch64 = 64位 ARM
```

## 3. 总线系统

总线是计算机各部件之间传输数据的公共通道。

### 3.1 总线分类

```
┌─────────┐     ┌─────────┐     ┌─────────┐
│   CPU   │────│  北桥    │────│  内存    │
└─────────┘     └────┬────┘     └─────────┘
                     │ 前端总线(FSB)
                     │
                ┌────┴────┐
                │  南桥    │
                └────┬────┘
                     │
          ┌──────────┼──────────┐
          │          │          │
     ┌────┴───┐ ┌────┴───┐ ┌───┴────┐
     │  PCI   │ │  SATA  │ │  USB   │
     └────────┘ └────────┘ └────────┘
```

> 注：现代 CPU 已将内存控制器集成到内部，北桥功能被 CPU 取代。

| 总线类型 | 作用 | 带宽参考 |
|---------|------|---------|
| 前端总线（FSB） | CPU 与芯片组通信 | 已淘汰 |
| 内存总线 | CPU 与内存通信 | DDR5-6400: 51.2 GB/s |
| PCIe | 高速设备接口 | PCIe 5.0 x16: 64 GB/s |
| SATA | 存储设备接口 | SATA III: 6 Gbps |
| USB | 通用外设接口 | USB 3.2: 20 Gbps |

```bash
# 查看 PCIe 设备
lspci

# 查看总线信息
lspci -tv

# 查看 USB 总线
lsusb
```

## 4. 寄存器

寄存器是 CPU 内部的高速存储单元，访问速度最快。

### 4.1 x86-64 通用寄存器

| 寄存器 | 64位名称 | 用途 |
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
| RIP | rip | 指令指针（程序计数器） |
| RFLAGS | rflags | 标志寄存器 |

```bash
# 使用 GDB 查看寄存器
# （需要先编译带调试信息的程序）
# gcc -g -o hello hello.c
# gdb ./hello
# (gdb) info registers
```

### 4.2 段寄存器

| 寄存器 | 用途 |
|--------|------|
| CS | 代码段 |
| DS | 数据段 |
| SS | 栈段 |
| ES/FS/GS | 附加数据段 |

> 在 64 位模式下，段寄存器的作用已大大简化。

## 5. 中断机制

中断是 CPU 响应外部或内部事件的机制。

### 5.1 中断分类

| 类型 | 来源 | 示例 |
|------|------|------|
| 硬中断 | 外部硬件 | 网卡收到数据、定时器到期 |
| 软中断 | 软件指令 | 系统调用（`int 0x80`） |
| 异常 | CPU 内部 | 除零错误、缺页异常 |

### 5.2 中断处理流程

```
1. CPU 检测到中断信号
2. 保存当前执行状态（寄存器、程序计数器）
3. 查询中断向量表，找到中断处理程序入口
4. 跳转执行中断处理程序
5. 处理完成后恢复之前的状态
6. 继续执行被中断的程序
```

```bash
# 查看中断统计
cat /proc/interrupts

# 查看软中断
cat /proc/softirqs

# 查看中断次数（按 CPU 统计）
watch -n 1 "cat /proc/interrupts | head -20"
```

### 5.3 中断向量表

中断向量表存储了各类中断处理程序的入口地址：

| 向量号 | 类型 | 说明 |
|--------|------|------|
| 0 | 异常 | 除零错误 |
| 13 | 异常 | 通用保护故障 |
| 14 | 异常 | 缺页异常 |
| 32-255 | 硬中断 | 外部设备中断 |
| 128 (0x80) | 软中断 | Linux 系统调用 |

## 6. 存储层次结构

存储器按照速度和容量形成层次结构：

```
        速度 ↑          容量 ↓
        ┌─────┐
        │寄存器│  ~1ns    几百字节
        ├─────┤
        │ L1  │  ~1ns    32-64 KB
        ├─────┤
        │ L2  │  ~3ns    256 KB-1 MB
        ├─────┤
        │ L3  │  ~10ns   几 MB-几十 MB
        ├─────┤
        │内存  │  ~100ns  几 GB-几 TB
        ├─────┤
        │ SSD │  ~100μs  几百 GB-几 TB
        ├─────┤
        │ HDD │  ~10ms   几 TB
        └─────┘
```

| 层级 | 介质 | 速度 | 容量 | 成本/GB |
|------|------|------|------|---------|
| L1 缓存 | SRAM | ~1 ns | 32-64 KB | 极高 |
| L2 缓存 | SRAM | ~3 ns | 256 KB-1 MB | 很高 |
| L3 缓存 | SRAM | ~10 ns | 几 MB-几十 MB | 高 |
| 主内存 | DRAM | ~100 ns | 几 GB-几 TB | 中等 |
| 固态硬盘 | NAND Flash | ~100 μs | 几百 GB-几 TB | 低 |
| 机械硬盘 | 磁盘 | ~10 ms | 几 TB-几十 TB | 最低 |

```bash
# 查看各级缓存大小
lscpu | grep "cache"

# 查看内存大小
free -h

# 查看磁盘大小
lsblk
```

## 7. 实战：查看硬件架构信息

```bash
# CPU 架构信息
lscpu

# 完整硬件概览
sudo lshw -short

# 查看设备树（ARM 平台常用）
ls /sys/firmware/devicetree/base/

# 查看 ACPI 表
sudo acpidump

# 查看主板信息
sudo dmidecode -t baseboard
```

## 参考资料

- Patterson, D. A., & Hennessy, J. L.《计算机组成与设计：硬件/软件接口》（RISC-V 版），机械工业出版社
- Bryant, R. E., & O'Hallaron, D. R.《深入理解计算机系统》（CSAPP），机械工业出版社
- Intel® 64 and IA-32 Architectures Software Developer Manuals — [intel.com](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html)
- AMD64 Architecture Programmer's Manual — [amd.com](https://developer.amd.com/resources/developer-guides-manuals/)
- Linux Kernel Documentation: [kernel.org/doc](https://www.kernel.org/doc/html/latest/)
- Wikipedia: [Von Neumann architecture](https://en.wikipedia.org/wiki/Von_Neumann_architecture)
