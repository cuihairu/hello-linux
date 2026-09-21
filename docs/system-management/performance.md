# 性能优化

## 学习目标

- 掌握系统性能监控方法
- 了解性能优化的基本原则
- 学会常见性能问题的排查

## 1. 性能监控

### 1.1 系统负载

```bash
# 查看系统负载
uptime

# 输出示例
# 10:30:00 up 10 days,  2:30,  2 users,  load average: 0.50, 0.75, 0.80
```

负载平均值：
- **1分钟**：当前负载
- **5分钟**：过去5分钟负载
- **15分钟**：过去15分钟负载

### 1.2 top/htop

```bash
# 启动 top
top

# 启动 htop
htop

# top 快捷键
# P：按 CPU 使用率排序
# M：按内存使用率排序
# k：终止进程
# q：退出
```

### 1.3 vmstat

```bash
# 查看虚拟内存统计
vmstat

# 每秒更新
vmstat 1

# 输出说明
# procs: r(运行) b(阻塞)
# memory: swpd(虚拟) free(空闲) buff(缓冲) cache(缓存)
# swap: si(换入) so(换出)
# io: bi(读入) bo(写出)
# system: in(中断) cs(上下文切换)
# cpu: us(用户) sy(系统) id(空闲) wa(等待) st(虚拟)
```

### 1.4 iostat

```bash
# 查看 I/O 统计
iostat

# 每秒更新
iostat 1

# 显示详细信息
iostat -x
```

### 1.5 sar

```bash
# 安装 sysstat
sudo apt install sysstat    # Debian/Ubuntu
sudo yum install sysstat    # RHEL/CentOS

# 查看 CPU 使用情况
sar -u

# 查看内存使用情况
sar -r

# 查看 I/O 使用情况
sar -b

# 查看历史数据
sar -u -f /var/log/sysstat/sa$(date +%d)
```

## 2. CPU 优化

### 2.1 查看 CPU 使用情况

```bash
# 查看 CPU 使用率
top

# 查看每个 CPU 核心
mpstat -P ALL

# 查看进程 CPU 使用
ps aux --sort=-%cpu | head
```

### 2.2 CPU 优化技巧

- 优化代码，减少 CPU 计算
- 使用多线程/多进程
- 调整进程优先级
- 使用 CPU 亲和性

## 3. 内存优化

### 3.1 查看内存使用情况

```bash
# 查看内存使用
free -h

# 查看进程内存使用
ps aux --sort=-%mem | head

# 查看内存映射
pmap PID
```

### 3.2 内存优化技巧

- 增加物理内存
- 调整 swappiness
- 清理缓存
- 使用大页内存

## 4. 磁盘优化

### 4.1 查看磁盘使用情况

```bash
# 查看磁盘空间
df -h

# 查看磁盘 I/O
iostat -x

# 查看磁盘使用详情
du -sh /*
```

### 4.2 磁盘优化技巧

- 使用 SSD
- 调整文件系统参数
- 使用 RAID
- 定期清理日志

## 5. 网络优化

### 5.1 查看网络使用情况

```bash
# 查看网络连接
ss -s

# 查看网络流量
iftop

# 查看网络统计
netstat -s
```

### 5.2 网络优化技巧

- 调整 TCP 参数
- 使用网络绑定
- 优化防火墙规则
- 使用 CDN

## 6. 性能分析工具

### 6.1 perf

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

### 6.2 strace

```bash
# 跟踪系统调用
strace command

# 跟踪进程
strace -p PID

# 统计系统调用
strace -c command
```

### 6.3 ltrace

```bash
# 跟踪库调用
ltrace command

# 跟踪进程
ltrace -p PID
```

## 7. 性能优化原则

1. **先测量，再优化**：使用工具定位瓶颈
2. **一次只改一个参数**：便于评估效果
3. **记录变更**：便于回滚和复现
4. **测试验证**：确保优化有效

## 参考资料

- [鸟哥的私房菜 - 性能优化](https://linux.vbird.org/linux_basic/)
- [Arch Wiki - Improving performance](https://wiki.archlinux.org/title/Improving_performance)
- [Linux Performance](http://www.brendangregg.com/linuxperf.html)
