# 内存

内存（Memory）是 CPU 与存储设备之间的高速缓冲层。本章介绍内存的工作原理、技术规格和 Linux 下的管理方法。

> 内容参考自经典教材和厂商文档，见文末参考资料。

## 学习目标

- 理解 DRAM 的工作原理
- 掌握 DDR 代际差异和关键参数
- 了解 ECC 内存和 NUMA 内存架构
- 学会内存监控和调优

## 1. 内存工作原理

### 1.1 DRAM 基础

DRAM（Dynamic Random-Access Memory）是现代计算机主内存的主流技术。

- 每个 bit 存储在一个电容中
- 电容会漏电，需要定期**刷新（Refresh）**
- 读取是破坏性的，读后需要**回写**

### 1.2 内存组织

```
┌─────────────────────────────────┐
│           内存条 (DIMM)          │
│  ┌─────┐ ┌─────┐ ┌─────┐       │
│  │ Rank│ │ Rank│ │ Rank│       │
│  │  0  │ │  1  │ │  2  │       │
│  └──┬──┘ └──┬──┘ └──┬──┘       │
│     │       │       │           │
│  ┌──┴───────┴───────┴──┐       │
│  │    内存芯片 (DRAM)    │       │
│  └──────────────────────┘       │
└─────────────────────────────────┘
```

| 概念 | 说明 |
|------|------|
| Rank | 内存条上一组协同工作的芯片 |
| Bank | 芯片内的存储阵列 |
| Row/Column | Bank 内的行列地址 |
| CL（CAS Latency） | 列地址选通信号延迟 |

## 2. DDR 代际

### 2.1 DDR 对比

| 参数 | DDR3 | DDR4 | DDR5 |
|------|------|------|------|
| 电压 | 1.5V | 1.2V | 1.1V |
| 频率范围 | 800-2133 MHz | 2133-5333 MHz | 4800-8400+ MHz |
| 预取位数 | 8n | 8n | 16n |
| 单条最大容量 | 16 GB | 64 GB | 128 GB |
| 通道 | 单/双 | 单/双 | 单/双 |
| 发布年份 | 2007 | 2014 | 2020 |

### 2.2 带宽计算

```
理论带宽 = 频率 × 数据宽度 × 通道数 / 8

# DDR4-3200 双通道
= 3200 MHz × 64 bit × 2 / 8
= 51.2 GB/s
```

```bash
# 查看内存类型和频率
sudo dmidecode -t memory | grep -E "Type|Speed|Size"

# 查看内存带宽（需要安装工具）
sudo apt install hwloc    # Debian/Ubuntu
lstopo
```

## 3. ECC 内存

### 3.1 什么是 ECC

ECC（Error-Correcting Code）内存能够检测并纠正单 bit 错误。

| 类型 | 检测 | 纠正 | 适用场景 |
|------|------|------|---------|
| Non-ECC | 无 | 无 | 普通桌面 |
| ECC | 有 | 单 bit | 服务器 |
| Registered ECC | 有 | 单 bit | 大容量服务器 |

### 3.2 查看 ECC 支持

```bash
# 查看是否支持 ECC
sudo dmidecode -t memory | grep "Error Correction Type"

# 查看内存错误统计
sudo edac-util -s
# 或
cat /sys/devices/system/edac/mc/mc0/ce_count    # 可纠正错误
cat /sys/devices/system/edac/mc/mc0/ue_count    # 不可纠正错误
```

## 4. 内存信息查看

### 4.1 dmidecode

```bash
# 查看内存硬件信息
sudo dmidecode -t memory

# 输出关键字段
# Maximum Capacity: 最大支持容量
# Number Of Devices: 内存插槽数
# Size: 单条容量
# Type: DDR3/DDR4/DDR5
# Speed: 频率
# Manufacturer: 制造商
```

### 4.2 free 命令

```bash
# 查看内存使用情况
free -h

# 输出说明
#               total    used    free   shared  buff/cache  available
# Mem:           15Gi    8.2Gi   1.2Gi   512Mi     6.1Gi      6.3Gi
# Swap:         2.0Gi      0B   2.0Gi
```

| 字段 | 说明 |
|------|------|
| total | 物理内存总量 |
| used | 已使用的内存 |
| free | 完全空闲的内存 |
| shared | 共享内存 |
| buff/cache | 缓冲区和缓存 |
| available | 可用内存（含可回收缓存） |

### 4.3 /proc/meminfo

```bash
# 查看详细内存信息
cat /proc/meminfo

# 关键字段
grep -E "MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree" /proc/meminfo
```

## 5. Swap 管理

### 5.1 什么是 Swap

Swap 是磁盘上的交换空间，当物理内存不足时，将不活跃的页面换出到磁盘。

### 5.2 Swap 配置建议

| 物理内存 | 建议 Swap 大小 |
|---------|---------------|
| ≤ 2 GB | 内存的 2 倍 |
| 2-8 GB | 与内存相等 |
| 8-64 GB | 至少 4 GB |
| ≥ 64 GB | 根据应用需求 |

### 5.3 创建 Swap 文件

```bash
# 创建 4GB swap 文件
sudo fallocate -l 4G /swapfile
# 或
sudo dd if=/dev/zero of=/swapfile bs=1M count=4096

# 设置权限
sudo chmod 600 /swapfile

# 格式化
sudo mkswap /swapfile

# 启用
sudo swapon /swapfile

# 永久启用（/etc/fstab）
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 查看 swap 状态
swapon --show
```

### 5.4 swappiness 参数

控制内核使用 swap 的倾向：

```bash
# 查看当前值
cat /proc/sys/vm/swappiness
# 默认 60，值越小越倾向使用物理内存

# 临时调整
sudo sysctl vm.swappiness=10

# 永久调整
echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
```

## 6. 大页内存

### 6.1 什么是大页内存

默认页面大小为 4 KB，大页（Huge Pages）使用 2 MB 或 1 GB 页面，减少 TLB 缺失。

### 6.2 配置大页内存

```bash
# 查看当前大页配置
grep -i huge /proc/meminfo

# 配置大页数量（2MB 页面）
echo 1024 | sudo tee /sys/kernel/mm/hugepages/hugepages-2048kB/nr_hugepages

# 永久配置
echo "vm.nr_hugepages = 1024" | sudo tee -a /etc/sysctl.conf
```

## 7. 内存性能监控

### 7.1 vmstat

```bash
# 查看内存统计
vmstat 1

# 关键字段
# si: 从 swap 读入 (KB/s)
# so: 写入 swap (KB/s)
# free: 空闲内存
# buff: 缓冲区
# cache: 页缓存
```

### 7.2 sar

```bash
# 安装 sysstat
sudo apt install sysstat    # Debian/Ubuntu
sudo yum install sysstat    # RHEL/CentOS

# 查看内存使用情况
sar -r 1

# 查看 swap 使用情况
sar -S 1
```

## 8. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 工具包 | procps | procps-ng |
| sysstat | sysstat | sysstat |
| NUMA 工具 | numactl | numactl |
| 性能调优 | — | tuned |

## 参考资料

- Bryant, R. E., & O'Hallaron, D. R.《深入理解计算机系统》(CSAPP)
- JEDEC DDR4 Standard — [jedec.org](https://www.jedec.org/standards-documents/docs/jesd79-4)
- JEDEC DDR5 Standard — [jedec.org](https://www.jedec.org/standards-documents/docs/jesd79-5)
- Arch Wiki - Improving performance — [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- Linux Kernel Documentation: Memory Management — [kernel.org/doc](https://www.kernel.org/doc/html/latest/admin-guide/mm/index.html)
