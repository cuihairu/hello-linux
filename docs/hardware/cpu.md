# CPU

CPU（Central Processing Unit）是计算机的运算和控制核心。本章介绍 CPU 的内部结构、工作原理和 Linux 下的管理方法。

> 内容参考自经典教材和厂商文档，见文末参考资料。

## 学习目标

- 理解 CPU 的内部结构和工作原理
- 掌握 CPU 信息的查看方法
- 了解 CPU 性能优化和调优

## 1. CPU 内部结构

### 1.1 核心组成

```
┌─────────────────────────────────────────────┐
│                    CPU                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  核心 0   │  │  核心 1   │  │  核心 N   │  │
│  │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │  │
│  │ │ ALU  │ │  │ │ ALU  │ │  │ │ ALU  │ │  │
│  │ ├──────┤ │  │ ├──────┤ │  │ ├──────┤ │  │
│  │ │ L1   │ │  │ │ L1   │ │  │ │ L1   │ │  │
│  │ ├──────┤ │  │ ├──────┤ │  │ ├──────┤ │  │
│  │ │ L2   │ │  │ │ L2   │ │  │ │ L2   │ │  │
│  │ └──────┘ │  │ └──────┘ │  │ └──────┘ │  │
│  └──────────┘  └──────────┘  └──────────┘  │
│               ┌──────────┐                  │
│               │    L3    │                  │
│               └──────────┘                  │
│               ┌──────────┐                  │
│               │内存控制器│                  │
│               └──────────┘                  │
└─────────────────────────────────────────────┘
```

| 组件 | 功能 |
|------|------|
| ALU（算术逻辑单元） | 执行算术和逻辑运算 |
| 控制单元 | 解析指令，协调执行 |
| 寄存器组 | 高速数据存储 |
| 缓存（L1/L2/L3） | 减少内存访问延迟 |
| 内存控制器 | 管理内存读写 |
| PCIe 控制器 | 管理高速设备 |

### 1.2 流水线与超标量

**流水线**：将指令执行分为多个阶段，多条指令重叠执行。

**超标量**：每个时钟周期发射多条指令到不同的执行单元。

```bash
# 查看 CPU 流水线深度（需要专业工具）
# 现代 Intel/AMD CPU 流水线深度约 14-20 级
```

## 2. 核心与线程

### 2.1 物理核心

每个物理核心是独立的运算单元，拥有自己的 ALU、寄存器和 L1/L2 缓存。

### 2.2 超线程（SMT）

Intel 超线程（Hyper-Threading）/ AMD SMT：一个物理核心模拟两个逻辑核心，共享执行资源。

```bash
# 查看物理核心数
lscpu | grep "Core(s) per socket"

# 查看逻辑核心数（含超线程）
nproc
# 或
lscpu | grep "^CPU(s):"

# 查看超线程状态
lscpu | grep "Thread(s) per core"
# 1 = 未启用超线程
# 2 = 已启用超线程
```

### 2.3 查看 CPU 拓扑

```bash
# 查看完整的 CPU 拓扑
lscpu -e

# 输出示例
# CPU  SOCKET  CORE  NODE  L1d:L1i:L2:L3
#   0       0     0     0   0:0:0:0
#   1       0     1     0   1:1:1:0
#   2       0     0     0   0:0:0:0   # 与 CPU 0 同核心（超线程）
#   3       0     1     0   1:1:1:0   # 与 CPU 1 同核心（超线程）
```

## 3. 缓存层次

### 3.1 缓存结构

| 缓存 | 位置 | 延迟 | 容量 | 共享 |
|------|------|------|------|------|
| L1d | 核心内 | ~1 ns | 32-48 KB | 核心独享 |
| L1i | 核心内 | ~1 ns | 32-64 KB | 核心独享 |
| L2 | 核心内 | ~3 ns | 256 KB-2 MB | 核心独享 |
| L3 | 核心外 | ~10 ns | 几 MB-几十 MB | 多核心共享 |

### 3.2 缓存行

缓存以**缓存行（Cache Line）**为单位读写，通常为 64 字节。

```bash
# 查看缓存行大小
getconf LEVEL1_DCACHE_LINESIZE
# 输出: 64
```

### 3.3 查看缓存信息

```bash
# 查看各级缓存大小
lscpu | grep "cache"

# 更详细的缓存信息
lscpu -C

# 查看 /sys 文件系统
ls /sys/devices/system/cpu/cpu0/cache/index*/
cat /sys/devices/system/cpu/cpu0/cache/index0/size
cat /sys/devices/system/cpu/cpu0/cache/index0/type
```

## 4. 指令集扩展

### 4.1 常见扩展

| 扩展 | 用途 | 支持情况 |
|------|------|---------|
| SSE4.2 | 字符串处理、CRC | 通用支持 |
| AVX/AVX2 | 向量运算 | 主流 CPU 支持 |
| AVX-512 | 高性能向量运算 | 部分服务器/高端 CPU |
| AES-NI | 硬件加密加速 | 通用支持 |
| VT-x/AMD-V | 硬件虚拟化 | 通用支持 |

```bash
# 查看 CPU 支持的指令集扩展
grep -o "sse\|avx\|avx2\|avx512\|aes\|vt-x\|svm" /proc/cpuinfo | sort -u

# 查看完整 flags
grep "flags" /proc/cpuinfo | head -1
```

## 5. CPU 频率管理

### 5.1 频率调节策略

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| performance | 始终最高频率 | 高性能需求 |
| powersave | 始终最低频率 | 节能模式 |
| ondemand | 按需调节 | 通用默认 |
| schedutil | 基于调度器调节 | 内核推荐 |

```bash
# 查看当前频率策略
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor

# 查看可用策略
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors

# 查看当前频率
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq

# 查看所有 CPU 频率
grep -r "scaling_cur_freq" /sys/devices/system/cpu/cpu*/cpufreq/
```

### 5.2 修改频率策略

```bash
# 安装 cpupower 工具
sudo apt install linux-tools-common    # Debian/Ubuntu
sudo yum install kernel-tools          # RHEL/CentOS

# 设置为性能模式
sudo cpupower frequency-set -g performance

# 设置为节能模式
sudo cpupower frequency-set -g powersave
```

## 6. NUMA 架构

### 6.1 什么是 NUMA

NUMA（Non-Uniform Memory Access）将 CPU 和内存划分为多个节点，每个节点访问本地内存快于远程内存。

```
┌─────────────────┐     ┌─────────────────┐
│    NUMA Node 0   │     │    NUMA Node 1   │
│  ┌─────┐ ┌────┐ │     │ ┌─────┐ ┌────┐  │
│  │ CPU │ │内存│ │     │ │ CPU │ │内存│  │
│  │0,1  │ │    │ │     │ │2,3  │ │    │  │
│  └─────┘ └────┘ │     │ └─────┘ └────┘  │
└────────┬────────┘     └────────┬────────┘
         │      QPI/Infinity     │
         └───────────┬───────────┘
```

```bash
# 查看 NUMA 拓扑
numactl --hardware

# 查看 NUMA 统计
numastat

# 在特定 NUMA 节点运行程序
numactl --cpunodebind=0 --membind=0 command
```

## 7. CPU 信息查看汇总

```bash
# 基本信息
lscpu

# 详细信息
cat /proc/cpuinfo

# 硬件信息
sudo dmidecode -t processor

# 缓存信息
lscpu -C

# 拓扑信息
lscpu -e

# NUMA 信息
numactl --hardware
```

## 8. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| cpupower 包 | linux-tools-common | kernel-tools |
| 调频配置 | /etc/default/cpufrequtils | tuned 服务 |
| 性能调优 | — | tuned-adm profile |

## 参考资料

- Patterson, D. A., & Hennessy, J. L.《计算机组成与设计：硬件/软件接口》
- Intel® 64 and IA-32 Architectures Software Developer Manuals — [intel.com](https://www.intel.com/content/www/us/en/developer/articles/technical/intel-sdm.html)
- AMD64 Architecture Programmer's Manual — [amd.com](https://developer.amd.com/resources/developer-guides-manuals/)
- Arch Wiki - CPU frequency scaling — [wiki.archlinux.org](https://wiki.archlinux.org/title/CPU_frequency_scaling)
- Linux Kernel Documentation: CPU — [kernel.org/doc](https://www.kernel.org/doc/html/latest/admin-guide/sysctl/kernel.html)
