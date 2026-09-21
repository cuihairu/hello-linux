# CPU

## 学习目标

- 了解 CPU 的基本架构
- 掌握 CPU 信息的查看方法
- 学会 CPU 性能监控和优化

## 1. CPU 基础

### 1.1 CPU 架构

| 架构 | 说明 | 常见应用 |
|------|------|---------|
| x86_64 | 64位 x86 架构 | 桌面、服务器 |
| ARM | 低功耗架构 | 嵌入式、移动设备 |
| RISC-V | 开源架构 | 嵌入式、研究 |

### 1.2 CPU 关键参数

- **主频**：CPU 的时钟频率（GHz）
- **核心数**：物理核心数量
- **线程数**：逻辑处理器数量（超线程）
- **缓存**：L1/L2/L3 缓存大小
- **TDP**：热设计功耗（W）

## 2. CPU 信息查看

### 2.1 lscpu 命令

```bash
# 查看 CPU 信息
lscpu
```

输出示例：
```
Architecture:          x86_64
CPU op-mode(s):        32-bit, 64-bit
Byte Order:            Little Endian
CPU(s):                8
On-line CPU(s) list:   0-7
Thread(s) per core:    2
Core(s) per socket:    4
Socket(s):             1
Vendor ID:             GenuineIntel
CPU family:            6
Model:                 142
Model name:            Intel(R) Core(TM) i7-8550U CPU @ 1.80GHz
Stepping:              10
CPU MHz:               1800.000
CPU max MHz:           4000.0000
CPU min MHz:           400.0000
BogoMIPS:              3984.00
Virtualization:        VT-x
L1d cache:             32K
L1i cache:             32K
L2 cache:              256K
L3 cache:              8192K
```

### 2.2 /proc/cpuinfo

```bash
# 查看 CPU 详细信息
cat /proc/cpuinfo

# 查看 CPU 核心数
grep -c processor /proc/cpuinfo

# 查看 CPU 型号
grep "model name" /proc/cpuinfo | head -1

# 查看 CPU 频率
grep "cpu MHz" /proc/cpuinfo | head -1
```

### 2.3 dmidecode

```bash
# 查看 CPU 硬件信息
sudo dmidecode -t processor

# 查看 CPU 缓存
sudo dmidecode -t cache
```

## 3. CPU 性能监控

### 3.1 top/htop

```bash
# 查看 CPU 使用率
top

# 按 CPU 使用率排序（在 top 中按 P）
```

### 3.2 mpstat

```bash
# 查看每个 CPU 核心的使用率
mpstat

# 每秒更新
mpstat 1

# 查看所有核心
mpstat -P ALL
```

### 3.3 perf

```bash
# 安装 perf
sudo apt install linux-tools-common    # Debian/Ubuntu
sudo yum install perf                  # RHEL/CentOS

# 查看 CPU 性能统计
perf stat command

# 记录性能数据
perf record command

# 分析性能数据
perf report
```

## 4. CPU 优化

### 4.1 CPU 调频

```bash
# 查看当前调频策略
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor

# 查看可用策略
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_available_governors

# 设置调频策略
sudo cpupower frequency-set -g performance    # 性能模式
sudo cpupower frequency-set -g powersave      # 节能模式
```

### 4.2 CPU 亲和性

```bash
# 将进程绑定到特定 CPU
taskset -c 0,1 command

# 查看进程的 CPU 亲和性
taskset -p PID

# 修改进程的 CPU 亲和性
taskset -pc 0,1 PID
```

### 4.3 NUMA 优化

```bash
# 查看 NUMA 拓扑
numactl --hardware

# 查看 NUMA 统计
numastat

# 在特定 NUMA 节点运行程序
numactl --cpunodebind=0 command
```

## 5. CPU 温度监控

### 5.1 lm-sensors

```bash
# 安装
sudo apt install lm-sensors    # Debian/Ubuntu
sudo yum install lm_sensors    # RHEL/CentOS

# 检测传感器
sudo sensors-detect

# 查看温度
sensors
```

### 5.2 热管理

```bash
# 查看热区
ls /sys/class/thermal/

# 查看温度
cat /sys/class/thermal/thermal_zone0/temp
```

## 6. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| perf 包 | linux-tools-common | perf |
| cpupower | linux-tools-common | kernel-tools |
| lm-sensors | lm-sensors | lm_sensors |

## 参考资料

- [鸟哥的私房菜 - CPU](https://linux.vbird.org/linux_basic/)
- [Arch Wiki - CPU frequency scaling](https://wiki.archlinux.org/title/CPU_frequency_scaling)
- [Linux perf 文档](https://perf.wiki.kernel.org/)
