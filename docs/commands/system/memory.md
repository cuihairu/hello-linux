# 内存管理命令

## 学习目标

- 掌握内存使用情况的查看方法
- 了解内存管理和优化技巧
- 学会排查内存相关问题

## 1. 内存查看

### 1.1 free - 内存使用情况

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

### 1.2 /proc/meminfo - 详细内存信息

```bash
# 查看详细内存信息
cat /proc/meminfo

# 查看特定信息
grep MemTotal /proc/meminfo
grep MemFree /proc/meminfo
grep SwapTotal /proc/meminfo
```

### 1.3 vmstat - 虚拟内存统计

```bash
# 查看虚拟内存统计
vmstat

# 每秒更新一次
vmstat 1

# 显示详细信息
vmstat -w

# 显示内存统计
vmstat -s
```

## 2. 内存分析

### 2.1 pmap - 进程内存映射

```bash
# 查看进程内存映射
pmap PID

# 显示详细信息
pmap -x PID

# 显示扩展信息
pmap -XX PID
```

### 2.2 smaps - 进程内存详细信息

```bash
# 查看进程内存详细信息
cat /proc/PID/smaps

# 查看汇总信息
cat /proc/PID/smaps_rollup
```

## 3. 内存管理

### 3.1 释放内存

```bash
# 清除页面缓存
sudo sh -c 'echo 1 > /proc/sys/vm/drop_caches'

# 清除目录项和 inode
sudo sh -c 'echo 2 > /proc/sys/vm/drop_caches'

# 清除所有缓存
sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'
```

### 3.2 swap 管理

```bash
# 查看 swap 使用情况
swapon --show

# 启用 swap
sudo swapon /dev/sdb1

# 禁用 swap
sudo swapoff /dev/sdb1

# 创建 swap 文件
sudo dd if=/dev/zero of=/swapfile bs=1G count=4
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### 3.3 /etc/fstab 配置

```bash
# 永久启用 swap
# 在 /etc/fstab 中添加
/swapfile none swap sw 0 0
```

## 4. 内存优化

### 4.1 调整 swappiness

```bash
# 查看当前 swappiness
cat /proc/sys/vm/swappiness

# 临时调整
sudo sysctl vm.swappiness=10

# 永久调整
echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
```

### 4.2 调整缓存压力

```bash
# 查看当前缓存压力
cat /proc/sys/vm/vfs_cache_pressure

# 临时调整
sudo sysctl vm.vfs_cache_pressure=50

# 永久调整
echo "vm.vfs_cache_pressure=50" | sudo tee -a /etc/sysctl.conf
```

## 5. 内存泄漏检测

### 5.1 valgrind - 内存调试工具

```bash
# 安装 valgrind
sudo apt install valgrind    # Debian/Ubuntu
sudo yum install valgrind    # RHEL/CentOS

# 检测内存泄漏
valgrind --leak-check=full ./program

# 生成详细报告
valgrind --leak-check=full --show-reachable=yes ./program
```

### 5.2 mtrace - 内存跟踪

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

## 6. OOM Killer

### 6.1 查看 OOM 日志

```bash
# 查看 OOM 日志
dmesg | grep -i oom
journalctl -k | grep -i oom
```

### 6.2 调整 OOM 优先级

```bash
# 查看进程 OOM 优先级
cat /proc/PID/oom_score

# 调整 OOM 优先级
echo -1000 > /proc/PID/oom_adj

# 禁用 OOM Killer（不推荐）
echo 1 > /proc/sys/vm/panic_on_oom
```

## 7. 内存性能分析

### 7.1 perf - 性能分析

```bash
# 安装 perf
sudo apt install linux-tools-common    # Debian/Ubuntu
sudo yum install perf                  # RHEL/CentOS

# 分析内存访问
perf stat -e cache-misses,cache-references ./program

# 生成火焰图
perf record -g ./program
perf script | stackcollapse-perf.pl | flamegraph.pl > flamegraph.svg
```

## 8. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 工具包 | procps | procps-ng |
| perf 包 | linux-tools-common | perf |
| 默认 swappiness | 60 | 60 |

## 参考资料

- [鸟哥的私房菜 - 内存管理](https://linux.vbird.org/linux_basic/0440processcontrol.php#memory)
- [Arch Wiki - Swap](https://wiki.archlinux.org/title/Swap)
- [Linux man pages](https://man7.org/linux/man-pages/)
