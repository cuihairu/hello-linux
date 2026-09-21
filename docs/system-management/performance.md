# 性能优化

系统性能监控和优化方法。

> 内容参考自 Arch Wiki 和 Brendan Gregg 的性能分析方法论，见文末参考资料。

## 1. 性能监控工具

### 系统负载

```bash
uptime
# 10:30:00 up 10 days, load average: 0.50, 0.75, 0.80
# 1分钟  5分钟  15分钟 平均负载
```

### CPU

```bash
top               # 实时监控
htop              # 增强版 top
mpstat -P ALL 1   # 每个 CPU 核心
```

### 内存

```bash
free -h           # 内存使用
vmstat 1          # 虚拟内存统计
```

### 磁盘 I/O

```bash
iostat -x 1       # I/O 统计
iotop             # 按进程查看 I/O
```

### 网络

```bash
iftop             # 网络流量
nethogs           # 按进程查看网络
ss -s             # 连接统计
```

## 2. 优化建议

### CPU

```bash
# 查看调频策略
cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor

# 设置性能模式
sudo cpupower frequency-set -g performance
```

### 内存

```bash
# 调整 swappiness
sudo sysctl vm.swappiness=10

# 清理缓存
sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'
```

### 磁盘

```bash
# 使用 SSD
# 选择合适的文件系统（XFS 大文件，ext4 通用）
# 调整 I/O 调度器
cat /sys/block/sda/queue/scheduler
```

## 3. 性能分析方法

USE 方法（Utilization, Saturation, Errors）：

| 资源 | 使用率 | 饱和度 | 错误 |
|------|--------|--------|------|
| CPU | mpstat | vmstat r 列 | perf |
| 内存 | free | vmstat si/so | dmesg |
| 磁盘 | iostat | iostat avgqu-sz | smartctl |
| 网络 | ip -s | ss -s | ip -s errors |

## 参考资料

- Brendan Gregg - Linux Performance — [brendangregg.com](http://www.brendangregg.com/linuxperf.html)
- Arch Wiki - Improving performance — [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- Red Hat Performance Tuning Guide — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/index)
