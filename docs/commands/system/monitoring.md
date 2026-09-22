# 系统监控工具

系统监控工具用于实时监控系统资源使用情况，帮助发现性能瓶颈。

> 内容参考自 procps-ng、sysstat 手册和实际运维经验，见文末参考资料。

## 学习目标

- 掌握 top、htop 等实时监控工具
- 学会使用 vmstat、iostat 等性能分析工具
- 了解 sar 等历史数据收集工具
- 掌握系统监控最佳实践

## 1. top 命令

### 1.1 基本用法

```bash
# top 用于实时监控系统进程
top

# 常用交互命令
# 1：显示每个 CPU 核心的使用情况
# M：按内存使用排序
# P：按 CPU 使用排序
# k：杀死进程
# r：重新设置进程优先级
# q：退出
```

### 1.2 输出解读

```bash
# 第一行：系统概况
# 12:34:56 up 1 day,  2:34,  2 users,  load average: 0.00, 0.01, 0.05
# 时间 运行时间 用户数 负载平均值（1分钟 5分钟 15分钟）

# 第二行：进程统计
# Tasks: 100 total,   1 running,  99 sleeping,   0 stopped,   0 zombie
# 总进程数 运行中 睡眠中 停止 僵尸进程

# 第三行：CPU 使用率
# %Cpu(s):  0.3 us,  0.3 sy,  0.0 ni, 99.3 id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st
# 用户空间 系统空间  nice值 空闲 等待IO 硬件中断 软件中断 虚拟机偷取时间

# 第四行：内存使用
# MiB Mem :   8000.0 total,   2000.0 free,   3000.0 used,   3000.0 buff/cache
# 总内存 空闲 已用 缓冲/缓存

# 第五行：交换分区使用
# MiB Swap:   2000.0 total,   2000.0 free,      0.0 used.   4500.0 avail Mem
# 总交换分区 空闲 已用 可用内存
```

### 1.3 常用选项

```bash
# 批处理模式（用于脚本）
top -b -n 1

# 显示特定用户的进程
top -u username

# 显示特定进程
top -p PID

# 设置刷新间隔
top -d 5
```

## 2. htop 命令

### 2.1 安装

```bash
# Debian/Ubuntu
sudo apt install htop

# RHEL/CentOS
sudo dnf install htop
```

### 2.2 基本用法

```bash
# htop 是 top 的增强版，提供更友好的界面
htop

# 常用快捷键
# F1：帮助
# F2：设置
# F3：搜索进程
# F4：过滤进程
# F5：树状视图
# F6：排序
# F9：杀死进程
# F10：退出
```

### 2.3 特点

```bash
# 1. 彩色界面
# 2. 支持鼠标操作
# 3. 树状视图显示进程关系
# 4. 可以横向和纵向滚动
# 5. 支持搜索和过滤
```

## 3. vmstat 命令

### 3.1 基本用法

```bash
# vmstat 报告虚拟内存统计
vmstat

# 每 2 秒更新一次
vmstat 2

# 更新 10 次
vmstat 2 10
```

### 3.2 输出解读

```bash
# procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
#  r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs  us sy id wa st
#  1  0      0 100000  50000 200000    0    0     0     0    0    0   0  0 100  0  0

# procs：进程
# r：运行队列长度
# b：阻塞进程数

# memory：内存
# swpd：虚拟内存使用量
# free：空闲内存量
# buff：缓冲区使用量
# cache：缓存使用量

# swap：交换分区
# si：从磁盘交换到内存的量
# so：从内存交换到磁盘的量

# io：IO
# bi：块设备读取量
# bo：块设备写入量

# system：系统
# in：中断数
# cs：上下文切换数

# cpu：CPU 使用率
# us：用户空间
# sy：系统空间
# id：空闲
# wa：等待IO
# st：虚拟机偷取时间
```

### 3.3 常用选项

```bash
# 显示活跃和非活跃内存
vmstat -a

# 显示磁盘统计
vmstat -d

# 显示 slab 信息
vmstat -m

# 显示事件计数器
vmstat -s
```

## 4. iostat 命令

### 4.1 安装

```bash
# Debian/Ubuntu
sudo apt install sysstat

# RHEL/CentOS
sudo dnf install sysstat
```

### 4.2 基本用法

```bash
# iostat 报告 CPU 和 IO 统计
iostat

# 每 2 秒更新一次
iostat 2

# 显示扩展信息
iostat -x

# 显示特定设备
iostat -x sda
```

### 4.3 输出解读

```bash
# Linux 5.4.0-100-generic (hostname) 	09/21/2026 	_x86_64_	(4 CPU)

# avg-cpu:  %user   %nice %system %iowait  %steal   %idle
#            0.30    0.00    0.30    0.00    0.00   99.40

# Device             tps    kB_read/s    kB_wrtn/s    kB_read    kB_wrtn
# sda               0.50         0.00         0.00          0          0

# avg-cpu：CPU 平均使用率
# %user：用户空间
# %nice：nice 值
# %system：系统空间
# %iowait：等待 IO
# %steal：虚拟机偷取时间
# %idle：空闲

# Device：设备统计
# tps：每秒传输次数
# kB_read/s：每秒读取量
# kB_wrtn/s：每秒写入量
# kB_read：总读取量
# kB_wrtn：总写入量
```

### 4.4 常用选项

```bash
# 显示扩展信息
iostat -x

# 显示设备名称
iostat -N

# 显示持久设备名称
iostat -p

# 以 MB 为单位显示
iostat -m
```

## 5. sar 命令

### 5.1 安装和配置

```bash
# 安装 sysstat
sudo apt install sysstat

# 启用数据收集
sudo systemctl enable sysstat
sudo systemctl start sysstat

# 配置收集间隔
# /etc/cron.d/sysstat
# */10 * * * * root /usr/lib/sysstat/sa1 1 1
```

### 5.2 基本用法

```bash
# 查看 CPU 使用情况
sar -u

# 查看内存使用情况
sar -r

# 查看磁盘 IO
sar -d

# 查看网络统计
sar -n DEV

# 查看历史数据
sar -u -f /var/log/sysstat/sa21
```

### 5.3 常用选项

```bash
# 查看特定日期的数据
sar -u -f /var/log/sysstat/sa21

# 查看特定时间段的数据
sar -u -s 10:00:00 -e 12:00:00

# 每 2 秒收集一次，共 10 次
sar -u 2 10

# 输出到文件
sar -u -o output.file 2 10
```

## 6. 其他监控工具

### 6.1 free 命令

```bash
# 查看内存使用情况
free -h

# 输出解读
#               total        used        free      shared  buff/cache   available
# Mem:          7.8Gi       3.0Gi       2.0Gi       100Mi       2.8Gi       4.5Gi
# Swap:         2.0Gi          0B       2.0Gi

# total：总内存
# used：已用内存
# free：空闲内存
# shared：共享内存
# buff/cache：缓冲/缓存
# available：可用内存
```

### 6.2 df 命令

```bash
# 查看磁盘使用情况
df -h

# 查看特定文件系统
df -h /home

# 查看 inode 使用情况
df -i
```

### 6.3 du 命令

```bash
# 查看目录大小
du -sh /var/log

# 查看子目录大小
du -sh /var/log/*

# 按大小排序
du -sh /var/log/* | sort -hr
```

### 6.4 lsof 命令

```bash
# 查看打开的文件
lsof

# 查看特定进程打开的文件
lsof -p PID

# 查看特定用户打开的文件
lsof -u username

# 查看特定端口的进程
lsof -i :80
```

### 6.5 strace 命令

```bash
# 跟踪系统调用
strace command

# 跟踪正在运行的进程
strace -p PID

# 统计系统调用
strace -c command

# 跟踪特定系统调用
strace -e trace=open,read,write command
```

## 7. 实战案例

### 7.1 系统监控脚本

```bash
#!/bin/bash
# 系统监控脚本

LOG_FILE="/var/log/system_monitor.log"

monitor() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # CPU 使用率
    cpu=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}')
    
    # 内存使用率
    mem=$(free -m | awk 'NR==2{printf "%.2f%%", $3*100/$2}')
    
    # 磁盘使用率
    disk=$(df -h / | awk 'NR==2{print $5}')
    
    # 负载
    load=$(uptime | awk -F'load average:' '{print $2}')
    
    echo "[$timestamp] CPU: $cpu%, 内存: $mem, 磁盘: $disk, 负载: $load" | tee -a "$LOG_FILE"
}

# 每 5 分钟监控一次
while true; do
    monitor
    sleep 300
done
```

### 7.2 性能分析脚本

```bash
#!/bin/bash
# 性能分析脚本

echo "=== 系统性能分析 ==="
echo ""

# CPU 使用情况
echo "CPU 使用情况:"
top -bn1 | head -5

echo ""

# 内存使用情况
echo "内存使用情况:"
free -h

echo ""

# 磁盘 IO
echo "磁盘 IO:"
iostat -x 1 1

echo ""

# 网络连接
echo "网络连接:"
ss -tulnp

echo ""

# 进程 TOP 10
echo "进程 TOP 10 (按 CPU 使用率):"
ps aux --sort=-%cpu | head -11
```

### 7.3 告警脚本

```bash
#!/bin/bash
# 系统告警脚本

THRESHOLD_CPU=80
THRESHOLD_MEM=80
THRESHOLD_DISK=90
EMAIL="admin@example.com"

check_cpu() {
    local cpu=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}')
    if (( $(echo "$cpu > $THRESHOLD_CPU" | bc -l) )); then
        echo "CPU 使用率过高: ${cpu}%" | mail -s "CPU 告警" "$EMAIL"
    fi
}

check_memory() {
    local mem=$(free -m | awk 'NR==2{printf "%.2f", $3*100/$2}')
    if (( $(echo "$mem > $THRESHOLD_MEM" | bc -l) )); then
        echo "内存使用率过高: ${mem}%" | mail -s "内存告警" "$EMAIL"
    fi
}

check_disk() {
    local disk=$(df -h / | awk 'NR==2{print $5}' | tr -d '%')
    if [ $disk -gt $THRESHOLD_DISK ]; then
        echo "磁盘使用率过高: ${disk}%" | mail -s "磁盘告警" "$EMAIL"
    fi
}

# 每 5 分钟检查一次
while true; do
    check_cpu
    check_memory
    check_disk
    sleep 300
done
```

## 参考资料

- `man top`, `man htop`, `man vmstat`, `man iostat`, `man sar`
- [procps-ng 手册](https://gitlab.com/procps-ng/procps)
- [sysstat 手册](https://sysstat.github.io/)
- [Linux 性能优化](https://www.brendangregg.com/linuxperf.html)