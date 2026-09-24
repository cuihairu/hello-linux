# 进程管理命令

Linux 里"程序"躺在磁盘上，"进程"是程序跑起来之后的样子：有 PID、有父进程、占着 CPU 与内存、能被信号打扰。进程管理要回答的不是"有哪些命令"，而是三件事——**谁在跑、该用哪个工具看、用什么信号让它停**。

> 内容参考自鸟哥的私房菜、Arch Wiki 与 systemd 官方文档，见文末参考资料。

## 学习目标

- 分清 ps、top、htop 的适用场景并会选
- 理解 SIGTERM/SIGKILL/SIGHUP 的语义与选用顺序
- 知道僵尸进程为什么产生、为什么 kill 不掉
- 理解 systemd 单元与进程树、cgroup 的关系

## 1. 进程是什么：为什么需要管理它

Shell 敲下一条命令时，内核会 `fork` 出一个子进程，再 `exec` 成目标程序——于是你看到的是一个个带 PID 的运行实体。每个进程记录着父 PID（PPID）、打开的文件、地址空间与状态。绝大多数排障问题最终都会落到进程上：服务起不来（进程没拉起或立刻退出）、机器卡（某进程吃满 CPU）、文件被占用（进程持有 fd）……所以"找到那个进程、看清它的状态、用合适的方式干预"是 Linux 运维的基本功。

进程状态里最常被问到的是 `R`（运行/就绪）、`S`（睡眠，等事件）、`D`（不可中断睡眠，多在等 IO）、`Z`（僵尸）与 `T`（停止）。`Z` 与 `D` 的含义会在后文专节展开；日常用 `ps`/`top` 时，先能区分"在跑"与"在等"，就能解释大部分 `load` 与 `iowait` 现象。

## 2. ps vs top vs htop：三种视角怎么选

这三个工具看的是同一批进程，差别在**时间维度**与**交互能力**上，选错不会出事故，但会浪费排查时间。

### 2.1 ps — 一帧快照

`ps` 是瞬时拍照：执行瞬间的进程列表打出来就结束，适合脚本、工单、一次定格。两大风格等价，记住一套即可：

```bash
$ ps aux | head -5
USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
root           1  0.0  0.2 168924 11608 ?        Ss   08:15   0:02 /sbin/init
root           2  0.0  0.0      0     0 ?        S    08:15   0:00 [kthreadd]
www-data    1102  0.1  0.4 214500 18236 ?        Ss   08:15   0:04 nginx: master process /usr/sbin/nginx
```

- `aux`：BSD 风格，`%CPU`/`%MEM` 直接可用，`STAT` 列是状态字母。
- `-ef`：System V 风格，多一列 PPID，适合顺藤摸瓜找父进程。
- `auxf` / `-ef --forest`：树状缩进，父子关系一目了然。
- `ps aux --sort=-%cpu | head`：按 CPU 倒序取前 N，等价于"top 快照"。

`STAT` 列的 `Z` 是僵尸、`S+` 是前台睡眠、`Rl` 是多线程运行中——不认识的字母先 `man ps` 查 "STANDARD FORMAT SPECIFIERS"。

### 2.2 top — 随时刷新的仪表盘

`top` 每隔几秒重绘一次，回答"**现在**谁最忙"，还能顺手发信号。三系均自带（Debian/Arch 为 procps 或 procps-ng，RHEL 系为 procps-ng）：

```bash
$ top
top - 10:30:41 up 12 days,  3:21,  2 users,  load average: 1.20, 0.95, 0.70
Tasks: 182 total,   1 running, 181 sleeping,   0 stopped,   1 zombie
%Cpu(s):  3.2 us,  1.1 sy,  0.0 ni, 95.4 id,  0.2 wa,  0.0 hi,  0.1 si,  0.0 st
MiB Mem :   7800.0 total,   1200.0 free,   3100.0 used,   3500.0 buff/cache
MiB Swap:   2048.0 total,   2048.0 free,      0.0 used.   4400.0 avail Mem

    PID USER      PR  NI    VIRT    RES  %CPU  %MEM     TIME+ COMMAND
   2041 mysql     20   0   12.2g   1.8g   8.5  23.1   120:34.1 mysqld
```

常用交互键：`P` 按 CPU、`M` 按内存、`1` 展开每核、`k` 杀进程、`r` 改 nice、`q` 退出。脚本里用 `top -bn1 | head` 取一次快照（注意 `-b` 批处理才适合管道）。

头部几行是"系统概况"：负载、任务统计（含 zombie 计数）、CPU 分项（`wa` 高=等 IO，`st` 高=被宿主机抢占）、内存与 swap——读法与异常阈值见[系统监控工具](./monitoring.md)。

### 2.3 htop — 交互增强版

`htop` 是社区对 `top` 的现代化改造：彩色界面、鼠标支持、横向滚动看完整命令行、树状视图一键切换、`F9` 菜单式发信号。它不是三系预装，安装方式必须按家族区分：

```bash
sudo apt install htop      # Debian/Ubuntu
sudo pacman -S htop        # Arch
sudo dnf install htop      # RHEL/CentOS/Rocky
```

Arch 上若系统较久未升级，先 `sudo pacman -Syu` 再装，避免 partial upgrade。快捷键底栏可见：`F3` 搜索、`F4` 过滤、`F5` 树、`F6` 排序、`F9` 信号、`F10` 退出。

### 2.4 怎么选：一张表说清

| 场景 | 首选 | 原因 |
|------|------|------|
| 脚本/工单需要固定输出 | `ps aux --sort=-%cpu` | 非交互、可管道、结果可 diff |
| 刚发现负载高，要抓现行 | `top` 或 `htop` | 几秒刷新，看谁持续吃 CPU |
| 要理清 master/worker 父子关系 | `ps auxf`、`htop -t`、`pstree` | 树状比平铺直观 |
| 服务器上日常巡检 | `htop` | 交互效率高，需先安装 |
| 只关心某服务进程 | `pgrep -a nginx` / `systemctl status` | 一步到位 |

三者数据源相同（`/proc`），`top`/`htop` 的百分比是**采样间隔内**的平均，瞬时尖峰可能被抹平；要抓毫秒级热点应转向 `pidstat`、`perf`（见[监控](./monitoring.md)）。另外 `top` 里 `%MEM` 基于 RSS，共享库会在多进程间重复计算，汇总各进程 `%MEM` 往往超过 100%——看整机内存仍以 `free` 为准。

## 3. 查找进程：pgrep 与 pidof

知道名字要拿 PID 时，别再 `ps aux | grep xxx`——grep 有时会匹配到自己那行，还得 `grep -v` 二次过滤：

```bash
$ pgrep -a nginx
1102 nginx: master process /usr/sbin/nginx
1103 nginx: worker process

$ pidof nginx
1103 1102

$ pgrep -u www-data -f "php-fpm"   # 按用户与完整命令行过滤
```

`pgrep` 输出纯 PID，直接喂给 `kill`；`-f` 匹配完整命令行（小心误伤含相同子串的进程）。`pkill` 与之对称，按名字发信号。`pstree -p` 可看全系统进程树及 PID，`pstree -p 1102` 从某进程向下展开。

## 4. kill 与信号：TERM / KILL / HUP 怎么选

`kill` 名字里有 kill，本质却是**发信号**（`kill -l` 列出全部）。默认信号是 `SIGTERM`（15），不是 `SIGKILL`（9）——这是新手与老手的第一个分水岭。

### 4.1 三类核心信号

| 信号 | 编号 | 能否被捕获 | 语义与典型用途 |
|------|------|-----------|----------------|
| SIGHUP | 1 | 能 | 传统"挂起"；守护进程约定俗成为**重读配置**（reload） |
| SIGINT | 2 | 能 | Ctrl+C，终端中断前台进程 |
| SIGTERM | 15 | 能 | **默认终止**，给进程机会清理临时文件、刷缓冲、释放锁 |
| SIGKILL | 9 | **不能** | 内核直接抹掉，无清理，最后手段 |
| SIGSTOP/SIGCONT | 19/18 | STOP 不能捕获 | 暂停/恢复，用于调试 |

**选择顺序**：先 `kill PID`（即 TERM）→ 观察数秒 → 若确实卡死或不理会，再 `kill -9 PID`。直接 `-9` 的代价是：缓冲区未落盘、锁文件残留、数据库可能需要恢复；且被杀进程要等父进程收尸才会从表里消失（见僵尸一节）。

```bash
$ kill 1102          # TERM，默认
$ kill -TERM 1102    # 等价写法
$ kill -HUP 1102     # 请服务自己重读配置（是否支持由服务决定）
$ kill -9 1102       # 最后手段
```

对成批同名进程，`pkill nginx` 按名字；`pkill -f "pattern"` 按完整命令行——**生产环境慎用 `-f`**，模式写宽了会误杀。按 PID 列表批量 TERM 可用 `kill $(pgrep -d' ' nginx)` 一类写法。

### 4.2 服务场景：HUP 与 systemd reload 的关系

老式守护进程（nginx、sshd 等）用 `kill -HUP` 重载配置；在 systemd 管理下更推荐：

```bash
sudo systemctl reload nginx    # 按 unit 的 ExecReload 定义发送合适信号
sudo systemctl kill -s HUP nginx
sudo systemctl restart nginx   # 进程完全重来，PID 变化
```

`reload` 不杀进程、不中断连接（服务需支持）；`restart` 会换 PID。改配置后该 reload 还是 restart，取决于服务是否热加载——不确定时 `systemctl cat nginx | grep ExecReload` 看 unit 怎么写的。服务管理细节见[系统服务管理](../../basic/services/system_services.md)。

## 5. 僵尸进程：为什么 kill 不掉

`top` 头部出现 `1 zombie`，或 `ps` 里状态为 `Z`，说明有一个**已经死掉却还没被父进程收走**的进程。

### 5.1 僵尸是怎么来的

进程退出时会留下退出码等"遗言"，必须由父进程调用 `wait()`/`waitpid()` 读取，内核才会彻底回收该 PID。父进程若忘了收（busy loop 不 wait、 bug、被信号打断未重启收尸逻辑），子进程就停在 `Z` 状态——**不再消耗 CPU 和内存**，只剩进程表里一个条目。它不是"还在运行的僵尸"，而是"等待签收的尸体"。

### 5.2 为什么 kill 杀不死它

`kill` 发给的已是不存在的执行实体，信号无人接收；`kill -9` 同样无效。唯一出路是让**父进程**收尸：

```bash
$ ps -eo pid,ppid,stat,cmd | awk '$3 ~ /Z/'
    PID    PPID STAT CMD
   2041    1873 Z    [nginx] <defunct>

$ ps -p 1873 -o pid,cmd
    PID CMD
   1873 nginx: master process /usr/sbin/nginx
```

处理思路：先看 PPID 是谁。若父进程是正常服务，重启该服务（`systemctl restart`）通常一并清掉；若父进程行为异常，按情况 TERM 父进程——父进程退出后，孤儿僵尸会被 PID 1（或 systemd）接管并回收。少量、偶发的僵尸一般无害；**持续堆积**才是 bug，会耗尽 PID。在 systemd 系统里，服务由 systemd 拉起，长期僵尸往往指向该服务自身代码未 wait，交给应用方修。

## 6. systemd 单元与进程关系

三发行版默认 PID 1 都是 systemd，理解它与进程的关系，才能解释 `systemctl status` 里那棵树。

### 6.1 一个 unit 对应一棵进程树与一个 cgroup

`systemctl status` 的输出把关系写得很直白：

```bash
$ systemctl status nginx
● nginx - A high performance web server
     Loaded: loaded (/lib/systemd/system/nginx.service; enabled)
     Active: active (running) since Mon 2026-09-21 08:15:03 CST; 1 day ago
   Main PID: 1102 (nginx)
      Tasks: 5 (limit: 4612)
     Memory: 12.4M
        CPU: 1.234s
     CGroup: /system.slice/nginx.service
             ├─1102 nginx: master process /usr/sbin/nginx
             ├─1103 nginx: worker process
             └─1104 nginx: worker process
```

要点：

- **Main PID**：unit 的主进程；`Type=` 决定 systemd 如何识别它（`simple` 认 `ExecStart` 直接拉起的第一个进程；`forking` 认父进程 fork 后退出、由后台进程接班；`oneshot` 跑完即结束；`notify` 等进程主动上报就绪）。
- **CGroup**：unit 下所有进程被放进同一控制组。`systemctl stop`/`kill` 的语义是**干掉整个 cgroup**，连漏网的 worker 一起走——这是 systemd 比裸 `kill` 主进程更可靠的原因：只杀 master 有时会留下孤儿 worker 继续占端口。
- **Tasks**：当前 unit 内线程/进程数，突然暴涨可能意味着 fork 风暴或线程泄漏。

### 6.2 与手工进程的区别

你自己 `nginx &` 起的进程不属于任何服务 unit：`systemctl stop` 管不到它，开机也不会自启，日志同样可能绕开 journal。排查"服务怎么还在跑"时，分清是 `systemctl status` 认领的 cgroup 进程，还是终端里的野生进程（`ps` 的 `TTY` 列为 `pts/` 而非 `?` 常能说明问题）。

相关命令速查：

```bash
systemctl status nginx       # 看树与 Main PID
systemctl cat nginx          # 看 unit 定义（ExecStart/Reload）
systemctl kill nginx         # 对整个 cgroup 发信号（默认 TERM）
pgrep -a nginx               # 列出所有 nginx 进程
```

## 7. 进程优先级：nice 与 renice

内核用 nice 值调度 CPU 竞争：范围 **-20（最贪）～19（最客气）**，默认 0。普通用户只能把自己进程往"客气"方向调（数值调大），负值需要 root。

```bash
$ nice -n 10 tar cf /backup.tar /data    # 低优先级打包，不拖垮在线业务
$ sudo nice -n -20 mysqld                 # 提高优先级（谨慎）

$ renice 10 -p 2041                       # 调整运行中进程
$ ps -o pid,ni,cmd -p 2041
    PID  NI COMMAND
   2041  10 mysqld
```

`htop`/`top` 里 `PR`/`NI` 列即实时优先级信息。nice 只影响 CPU 竞争，**不直接限制 IO 或内存**；要硬性配额需 cgroup（systemd 的 `CPUWeight=`、`MemoryMax=` 等）。批量离线任务（备份、编译）降 nice 是好习惯；生产改负值前先想清楚会不会饿死系统进程。

## 8. 前台、后台与作业控制

交互 shell 里小范围控制用作业（job）机制：

```bash
$ long_command &          # 放后台
$ Ctrl+Z                  # 挂起前台任务
$ jobs                    # 查看作业，得到 %1
$ bg %1                   # 后台继续跑
$ fg %1                   # 拉回前台
```

关掉 SSH 窗口后，前台与普通后台作业都会收到 SIGHUP 而死。需要"关终端还活着"：

```bash
$ nohup ./run.sh > run.log 2>&1 &
```

`nohup` 忽略 SIGHUP，输出重定向到 `run.out` 或指定文件。短脚本这样够用；**长期服务应交给 systemd**（自启、重启策略、日志、依赖管理一次到位），而不是堆一串 `nohup`——这是从"会用 shell"到"会管服务器"的分界线。

## 9. 管道与重定向：进程的接口

进程之间最常用的协作是管道：前一个进程的标准输出接到后一个的标准输入，两个进程并存、由内核管道缓冲衔接：

```bash
$ ps aux | grep nginx | awk '{print $2}'   # 三个进程组成流水线
$ ps aux --sort=-%mem | head -n 10 > /tmp/top-mem.txt
```

重定向决定进程与文件的关系：`>` 覆盖、`>>` 追加、`2>` 收错误、`2>&1` 合并、`>/dev/null` 丢弃。排障时把服务标准输出丢进文件是第一动作；shell 层细节见[文本处理与重定向](../../script/bash-basics.md)。此处只需记住：**每段管道都是独立进程**，`kill` 只能按 PID 精确打击，管道整体没有"进程号"。

## 10. 定时任务：cron 与 at

周期性拉起进程属于调度器职责，与手工 kill 是同一枚硬币的两面：

```bash
$ crontab -e          # 编辑当前用户任务
$ crontab -l          # 列出
# 格式：分 时 日 月 周 命令
# 0 2 * * * /usr/local/bin/backup.sh

$ at now + 30 minutes   # 一次性任务
at> /usr/local/bin/report.sh
at> Ctrl+D
$ atq                  # 查看队列
$ atrm 1                # 删除
```

系统级 cron 放 `/etc/crontab` 或 `/etc/cron.d/`（带用户名字段），用户级只用 `crontab`。systemd 系还可用 timer unit 替代 cron（`systemctl list-timers`）；Arch 上很多包（如 sysstat）默认就用 timer 采集。任务没跑时先查：时间表达式、绝对路径、环境变量是否比交互 shell 少、日志有没有重定向——cron 的 `PATH` 通常只有 `/usr/bin:/bin`，`mysql`、`docker` 等要写全路径。

## 11. 三发行版工具对照（含 pacman）

| 任务 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 进程快照 | `ps`（procps） | `ps`（procps-ng） | `ps`（procps-ng） |
| 实时监控 | `top` 自带 | `top` 自带 | `top` 自带 |
| 增强界面 | `sudo apt install htop` | `sudo pacman -S htop` | `sudo dnf install htop` |
| 进程树 | `pstree`（psmisc，多数已装） | `pacman -S psmisc` | `dnf install psmisc` |
| 按名杀进程 | `pkill`/`killall` | 同左 | 同左 |
| 动态追踪 | `sudo apt install bpftrace` | `sudo pacman -S bpftrace` | `sudo dnf install bpftrace` |
| 服务进程关系 | `systemctl`（systemd） | 同左 | 同左 |
| 定时任务 | cron 预装 | `pacman -S cronie` 并 enable | `dnf install cronie`（或 systemd timer） |

说明：Arch 最小安装不含 cron，需要 cron 类能力时装 `cronie` 并 `systemctl enable --now crond`；RHEL 系常见 `crond` 默认启用。`bpftrace` 用于内核态动态追踪（谁在读哪个文件、哪个函数最热），需要较新内核与 root；入门监控先掌握 top/vmstat/iostat 即可，bpftrace 属于进阶武器，三系包名一致、安装命令随包管理器切换。

## 12. 常见坑

1. **习惯性 `kill -9`**。先 TERM 给清理机会；KILL 是核选项不是默认项。KILL 之后进程若仍显示，多半在等父进程收尸，见僵尸一节。
2. **`ps aux | grep nginx` 杀到自己**。管道里 grep 自己也是一行，`kill` 收到非数字会报错；用 `pgrep -f` 或 `pgrep nginx`。
3. **`pkill -f` 模式过宽**。`pkill -f python` 可能带走 jupyter、supervisor 里的一切 Python；先 `pgrep -af` 预览再 `pkill`。
4. **只杀 master 不管 worker**。手工 kill 可能留下占端口的孤儿；服务进程用 `systemctl stop/restart`，让 cgroup 一起清。
5. **把僵尸当恶意进程反复 kill**。无效；应找 PPID，重启父服务或修父进程的 wait 逻辑。
6. **reload 不生效**。服务若没配 `ExecReload` 或本身不支持热加载，`systemctl reload` 等于没做；改完配置用 `nginx -t` 等语法检查 + 该 restart 就 restart。
7. **在容器里找不到"系统进程"**。容器 PID 空间隔离，`ps` 只看到容器内进程；看宿主机进程要进宿主机命名空间，别急着怀疑监控坏了。
8. **以为 `nice` 能限制 IO/内存**。它只影响 CPU 调度权重；资源硬上限用 cgroup/systemd 单元属性。
9. **nohup 当服务管理器用**。无重启、无日志规范、无依赖；长期任务迁到 systemd unit。

## 参考资料

- 鸟哥的私房菜 - 程序观察与作业管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0440processcontrol.php)
- Arch Wiki - Process management — [wiki.archlinux.org](https://wiki.archlinux.org/title/Process)
- Arch Wiki - systemd — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd)
- systemd.service(5) 手册（Type= 与 cgroup 语义） — [man7.org](https://man7.org/linux/man-pages/man5/systemd.service.5.html)
- `man ps`、`man top`、`man kill`、`man pgrep`、`man nice`
- signals(7) — [man7.org](https://man7.org/linux/man-pages/man7/signal.7.html)
- 内存与 OOM 相关见 [内存管理](./memory.md)；监控读数见 [系统监控工具](./monitoring.md)
