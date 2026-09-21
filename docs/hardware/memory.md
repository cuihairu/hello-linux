# 内存

## 学习目标

- 了解内存的工作原理
- 掌握内存信息的查看方法
- 学会内存管理和优化

## 1. 内存基础

### 1.1 内存类型

| 类型 | 说明 | 常见应用 |
|------|------|---------|
| DRAM | 动态随机存取内存 | 主内存 |
| SRAM | 静态随机存取内存 | CPU 缓存 |
| DDR4/DDR5 | 双倍数据速率内存 | 现代计算机 |

### 1.2 内存关键参数

- **容量**：内存大小（GB）
- **频率**：内存时钟频率（MHz）
- **时序**：内存延迟（CL值）
- **通道**：单通道/双通道/四通道

## 2. 内存信息查看

### 2.1 free 命令

```bash
# 查看内存使用情况
free

# 人类可读格式
free -h

# 显示详细信息
free -m

# 持续监控
free -h -s 2
```

输出说明：
```
              total        used        free      shared  buff/cache   available
Mem:          15Gi       8.2Gi       1.2Gi       512Mi       6.1Gi       6.3Gi
Swap:         2.0Gi          0B       2.0Gi
```

- **total**：总内存
- **used**：已使用内存
- **free**：空闲内存
- **shared**：共享内存
- **buff/cache**：缓冲/缓存
- **available**：可用内存

### 2.2 /proc/meminfo

```bash
# 查看详细内存信息
cat /proc/meminfo

# 查看总内存
grep MemTotal /proc/meminfo

# 查看空闲内存
grep MemFree /proc/meminfo

# 查看 Swap 信息
grep Swap /proc/meminfo
```

### 2.3 dmidecode

```bash
# 查看内存硬件信息
sudo dmidecode -t memory

# 查看内存条信息
sudo dmidecode -t memory | grep -A 5 "Memory Device"
```

### 2.4 lshw

```bash
# 查看内存信息
sudo lshw -class memory

# 简要信息
sudo lshw -short -class memory
```

## 3. 内存性能监控

### 3.1 vmstat

```bash
# 查看虚拟内存统计
vmstat

# 每秒更新
vmstat 1

# 显示详细信息
vmstat -w
```

### 3.2 sar

```bash
# 安装 sysstat
sudo apt install sysstat    # Debian/Ubuntu
sudo yum install sysstat    # RHEL/CentOS

# 查看内存使用情况
sar -r

# 每秒更新
sar -r 1

# 查看历史数据
sar -r -f /var/log/sysstat/sa$(date +%d)
```

## 4. Swap 管理

### 4.1 查看 Swap

```bash
# 查看 Swap 使用情况
swapon --show

# 查看 Swap 文件
ls -la /swapfile
```

### 4.2 创建 Swap 文件

```bash
# 创建 Swap 文件
sudo dd if=/dev/zero of=/swapfile bs=1G count=4
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# 永久启用
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 4.3 Swap 优化

```bash
# 查看 swappiness
cat /proc/sys/vm/swappiness

# 临时调整
sudo sysctl vm.swappiness=10

# 永久调整
echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
```

## 5. 内存优化

### 5.1 清理缓存

```bash
# 清除页面缓存
sudo sh -c 'echo 1 > /proc/sys/vm/drop_caches'

# 清除目录项和 inode
sudo sh -c 'echo 2 > /proc/sys/vm/drop_caches'

# 清除所有缓存
sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'
```

### 5.2 大页内存

```bash
# 查看大页内存配置
cat /proc/meminfo | grep Huge

# 配置大页内存
echo 1024 | sudo tee /proc/sys/vm/nr_hugepages

# 永久配置
echo "vm.nr_hugepages = 1024" | sudo tee -a /etc/sysctl.conf
```

## 6. 内存泄漏检测

### 6.1 valgrind

```bash
# 安装 valgrind
sudo apt install valgrind    # Debian/Ubuntu
sudo yum install valgrind    # RHEL/CentOS

# 检测内存泄漏
valgrind --leak-check=full ./program
```

### 6.2 mtrace

```bash
# 在程序中使用 mtrace
#include <mtrace.h>

# 设置环境变量
export MALLOC_TRACE=output.log

# 运行程序
./program

# 分析结果
mtrace program output.log
```

## 7. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 工具包 | procps | procps-ng |
| sysstat | sysstat | sysstat |
| valgrind | valgrind | valgrind |

## 参考资料

- [鸟哥的私房菜 - 内存管理](https://linux.vbird.org/linux_basic/0440processcontrol.php#memory)
- [Arch Wiki - Swap](https://wiki.archlinux.org/title/Swap)
- [Arch Wiki - Improving performance](https://wiki.archlinux.org/title/Improving_performance)
