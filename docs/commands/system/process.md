# 进程管理命令

## 学习目标

- 掌握进程的查看和管理方法
- 了解进程的优先级和调度
- 学会使用系统监控工具

## 1. 进程查看

### 1.1 ps - 查看进程

```bash
# 查看当前用户的进程
ps

# 查看所有进程
ps aux

# 查看所有进程（完整格式）
ps -ef

# 查看特定进程
ps -p PID

# 查看进程树
ps auxf

# 按 CPU 使用率排序
ps aux --sort=-%cpu

# 按内存使用率排序
ps aux --sort=-%mem
```

### 1.2 top - 实时监控

```bash
# 启动 top
top

# top 快捷键
# P：按 CPU 使用率排序
# M：按内存使用率排序
# k：终止进程
# r：调整优先级
# q：退出
```

### 1.3 htop - 增强版 top

```bash
# 安装 htop
sudo apt install htop    # Debian/Ubuntu
sudo yum install htop    # RHEL/CentOS

# 启动 htop
htop

# htop 快捷键
# F1：帮助
# F2：设置
# F3：搜索
# F4：过滤
# F5：树状显示
# F6：排序
# F9：终止进程
# F10：退出
```

## 2. 进程管理

### 2.1 kill - 终止进程

```bash
# 终止进程
kill PID

# 强制终止
kill -9 PID

# 发送特定信号
kill -SIGTERM PID
kill -SIGHUP PID

# 终止所有同名进程
killall process_name

# 按模式终止
pkill process_name
```

### 2.2 信号类型

| 信号 | 编号 | 说明 |
|------|------|------|
| SIGHUP | 1 | 挂起信号 |
| SIGINT | 2 | 中断信号（Ctrl+C） |
| SIGKILL | 9 | 强制终止 |
| SIGTERM | 15 | 终止信号（默认） |
| SIGSTOP | 19 | 暂停信号 |
| SIGCONT | 18 | 继续信号 |

## 3. 进程优先级

### 3.1 nice - 设置优先级

```bash
# 以指定优先级启动进程
nice -n 10 command

# 以低优先级启动
nice -n 19 command

# 以高优先级启动（需要 root）
sudo nice -n -20 command
```

### 3.2 renice - 调整优先级

```bash
# 调整进程优先级
renice 10 PID

# 调整用户的所有进程
renice 10 -u username

# 调整组的所有进程
renice 10 -g groupname
```

## 4. 后台进程

### 4.1 后台运行

```bash
# 后台运行命令
command &

# 暂停当前进程
Ctrl+Z

# 恢复后台进程
bg

# 恢复前台进程
fg

# 查看后台任务
jobs

# 切换到特定任务
fg %job_number
```

### 4.2 nohup - 持久运行

```bash
# 后台运行，不受终端关闭影响
nohup command &

# 输出重定向到文件
nohup command > output.log 2>&1 &
```

## 5. 进程间通信

### 5.1 管道

```bash
# 使用管道连接命令
command1 | command2

# 示例：查找并排序
ps aux | grep nginx | sort
```

### 5.2 重定向

```bash
# 标准输出重定向
command > file.txt

# 标准错误重定向
command 2> error.txt

# 合并输出
command > output.txt 2>&1

# 追加输出
command >> file.txt
```

## 6. 系统监控

### 6.1 uptime - 系统负载

```bash
# 查看系统运行时间和负载
uptime
```

### 6.2 vmstat - 虚拟内存统计

```bash
# 查看虚拟内存统计
vmstat

# 每秒更新一次
vmstat 1

# 显示详细信息
vmstat -w
```

### 6.3 iostat - I/O 统计

```bash
# 查看 I/O 统计
iostat

# 每秒更新一次
iostat 1

# 显示详细信息
iostat -x
```

## 7. 进程查找

### 7.1 pgrep - 按名称查找

```bash
# 按名称查找进程
pgrep process_name

# 显示进程名
pgrep -l process_name

# 显示完整命令
pgrep -a process_name
```

### 7.2 pidof - 查找进程 ID

```bash
# 查找进程 ID
pidof process_name
```

## 8. 系统信息

### 8.1 uname - 系统信息

```bash
# 查看所有信息
uname -a

# 查看内核版本
uname -r

# 查看主机名
uname -n
```

### 8.2 hostname - 主机名

```bash
# 查看主机名
hostname

# 查看完整主机名
hostname -f
```

## 9. 定时任务

### 9.1 cron - 定时任务

```bash
# 编辑定时任务
crontab -e

# 查看定时任务
crontab -l

# 删除定时任务
crontab -r

# cron 格式
# 分 时 日 月 周 命令
# 0 2 * * * /path/to/script.sh
```

### 9.2 at - 一次性任务

```bash
# 创建一次性任务
at now + 1 hour

# 查看待执行任务
atq

# 删除任务
atrm job_number
```

## 参考资料

- [鸟哥的私房菜 - 进程管理](https://linux.vbird.org/linux_basic/centos7/0440processcontrol.php)
- [Arch Wiki - Process management](https://wiki.archlinux.org/title/Process_management)
- [Linux man pages](https://man7.org/linux/man-pages/)
