# 内核跟踪工具箱

读源码最忌"闭眼想象"：盯着 `vfs_write` 的代码猜它何时被调、参数是什么，不如让内核自己招供。跟踪工具就是插在内核与用户态边上的仪表盘——strace 站在系统调用面看"程序要求内核做什么"，ftrace 站在函数级看"内核内部走了哪条路"，bpftrace 把千百万次调用聚合成统计图，gdb 配合 QEMU 则能在任意一行内核代码上按下暂停键。这四层的侵入度、信息量、搭建成本各不相同，选错层级是排障效率的头号杀手——用 gdb 调"服务为什么慢"是大炮打蚊子，用 strace 问"内核为什么死锁"则是缘木求鱼。本页是源码篇的第三章：[源码导读](./source-tree.md)告诉你代码长在哪、[内核编译](./build-and-modules.md)让你拿到带符号的 vmlinux，本页教你把"看到的函数名"和"执行的路径"对上号——后续每个模块章的"实操跟踪"小节都建立在这套工具之上。

> 内容参考自内核官方 trace 文档与 bpftrace 项目文档，见文末参考资料。

## 学习目标

- 建立"观察层级"的选型直觉：什么问题用 strace，什么问题必须上 ftrace/bpftrace
- 会用 ftrace 的 function/function_graph tracer 与 set_ftrace_filter 收窄观察面
- 会用 kprobe_events 与 bpftrace 一行程序做带参数、可聚合的动态探针
- 能搭起 QEMU + gdb 的内核断点调试环境，并理解 KASLR 对断点的影响
- 记住生产纪律：动态探针可上生产，ptrace 与全局 function tracer 不行

## 1. 观察内核的四个层级

### 1.1 侵入度、信息量与成本的三角

四个工具不是四个"更好的版本"，而是四个不同的观察面。**strace** 用 ptrace 机制在系统调用边界拦截，看到的是程序与内核的"收发清单"——它不知道内核内部发生了什么，但知道程序提出的每一个请求；**ftrace** 是内核自带的跟踪基础设施，能打印内核函数的调用流与耗时，代价几乎为零（编译期埋点，不用时是一条 `nop` 指令）；**bpftrace** 基于 eBPF 在任意内核函数上挂动态探针，还能在内核里就地聚合数据，把百万次事件压缩成一张统计表；**gdb** 则干脆把内核停下来，逐指令查看现场。这像一个递进的检修体系：先看快递单（strace），再进车间看工序流转（ftrace），然后给车间装计数器（bpftrace），最后整条产线停电检修（gdb）。

| 工具 | 观察面 | 侵入度 | 搭建成本 | 典型问题 |
|------|--------|--------|----------|----------|
| strace | 系统调用边界 | 每条 syscall 停两次，目标慢一个量级 | 零 | 程序在等什么文件、卡在哪个 syscall |
| ftrace | 内核函数流与时长 | filter 后可忽略；全局开很重 | 零（内核自带） | 一次请求在内核里走了哪些函数 |
| bpftrace | 动态探针 + 聚合 | 验证器保证安全，可上生产 | 装个包 | 谁在写这个文件、某函数调用分布 |
| gdb + QEMU | 任意断点现场 | 内核直接停住 | 半小时起步 | 某函数首次被调用时的完整现场 |

### 1.2 工具安装（三发行版对照）

四个工具在三系的包名高度一致，差异集中在 RHEL 的 QEMU 命名——它历史上有两套（用户态全系统模拟的 qemu 与 KVM 加速的 qemu-kvm），现代版本已合并，`qemu-kvm` 包提供 `qemu-kvm` 命令，而 Debian/Arch 都是 `qemu-system-x86` 包配 `qemu-system-x86_64` 命令：

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 strace | `apt install strace` | `pacman -S strace` | `dnf install strace` |
| 安装 bpftrace | `apt install bpftrace` | `pacman -S bpftrace` | `dnf install bpftrace` |
| 安装 trace-cmd | `apt install trace-cmd` | `pacman -S trace-cmd` | `dnf install trace-cmd` |
| 安装 gdb | `apt install gdb` | `pacman -S gdb` | `dnf install gdb` |
| 安装 QEMU | `apt install qemu-system-x86` | `pacman -S qemu-system-x86` | `dnf install qemu-kvm` |
| 查看已装版本 | `apt show strace` | `pacman -Qi strace` | `dnf info strace` |

ftrace 不需要安装——它是内核的一部分，只要 `/boot/config-$(uname -r)` 里 `CONFIG_FUNCTION_TRACER=y`、`CONFIG_KPROBE_EVENTS=y` 就绪即可，主流发行版内核默认全开，`grep FTRACE /boot/config-$(uname -r)` 一验便知。bpftrace 依赖 `CONFIG_BPF` 与 `CONFIG_BPF_SYSCALL`，同样是发行版标配。唯一需要"准备"的是 gdb 调试所需的 vmlinux（带符号的未压缩内核映像）——发行版一般单独放在 debuginfo 包里，自己编译内核则直接产出在源码树顶层，见[内核编译](./build-and-modules.md)。

## 2. strace：系统调用面

### 2.1 看见程序的每一次"请求"

strace 的输出是"程序 ↔ 内核"的完整对话记录。用 `-e trace=` 收窄到关心的调用，噪声立刻少一个数量级：

```bash
$ strace -e trace=write cat /etc/hostname
execve("/usr/bin/cat", ["cat", "/etc/hostname"], 0x7ffc9a2b41f0 /* 42 vars */) = 0
write(1, "hello-linux\n", 12)          = 12      # 真正的输出动作
close(1)                                = 0       # 收尾关 fd
+++ exited with 0 +++
```

三行输出就是一份"口供"：`execve` 是 strace 必然展示的起点（换了进程映像）；`write(1, ..., 12)` 说明数据走的是标准输出、长度 12 字节、返回值 12 表示全部写出；最后的 `exited with 0` 是干净退出。排障时最有价值的是三类行——**返回 -1 的行**（`ENOENT` 文件不存在、`EACCES` 权限不足、`EAGAIN` 资源暂不可达，错误码就是病因）；**卡住不动的行**（`read(3,` 之后没有返回值，进程在等这个 fd，`/proc/PID/syscall` 能看到它阻塞在哪个调用上）；**重复异常多次的行**（同一 openat 失败几百次，通常是路径循环或缓存失效）。注意 execve 即使命中了 `-e trace=write` 过滤也会显示——strace 总是跟踪进程的出生。

`-e trace=` 除了逐个点名，还能按**类**圈定：`%file` 匹配所有文件类调用（openat/stat/access/unlink 一网打尽）、`%process` 是 fork/exec/clone 系列、`%network` 是 socket/connect/accept 系列。给陌生程序做行为画像，用 `strace -e trace=%file,%network` 跑一遍就能看清它碰了哪些文件、连了哪些地址——审计一个来路不明的二进制时，这是第一道体检。对已在跑的进程则用 `-p PID` 附着（需同 uid 或 root），附着与分离之间目标全程被监视；输出用 `-o` 落盘慢慢分析，避免终端被刷爆。

### 2.2 统计模式与子进程

`-c` 把数千行对话压缩成一张账单，按耗时排序看热点：

```bash
$ strace -c cat /etc/hostname > /dev/null
% time     seconds  usecs/call     calls    errors syscall
------ ----------- ----------- --------- --------- ----------------
 31.79    0.000187           7        26           mmap
 14.46    0.000085          10         8         1 openat
 12.20    0.000072           9         7           close
  8.14    0.000048           8         6           newfstatat
------ ----------- ----------- --------- --------- ----------------
100.00    0.000588                    59         3 total
```

账单的读法：`calls` 列看行为模式（openat 多说明在疯狂找文件），`errors` 列看失败分布，`usecs/call` 看单次代价。给服务做"启动为什么慢"的体检时，`strace -c -f systemctl start foo` 一条命令就能看出它把时间花在配置文件扫描还是 DNS 解析上——`-f` 让 fork 出的子进程也被纳入跟踪，服务管理器的子进程链条全在网内。

### 2.3 天花板：它看不见内核内部

strace 的开销来自机制本身：ptrace 在**每条**系统调用的入口和出口各停一次目标进程，被跟踪的程序慢一个数量级是常态。这决定了两条纪律——压测时绝不挂 strace（性能数字全废），生产环境只对单个出问题的进程短时使用。更深的天花板是观察面：内核内部的一切——锁竞争、软中断、页面回收、调度延迟——都不会出现在系统调用记录里。一个进程卡在 D 状态（不可中断睡眠），strace 只能看到它"最后一条 syscall 没返回"，至于内核里卡在哪，那是 ftrace 的辖区。从这一节往下，我们跨过系统调用边界，进内核。

## 3. ftrace：内核自带的函数级跟踪

### 3.1 tracefs：控制面板在哪

ftrace 的全部旋钮都通过 tracefs 文件系统暴露，一行命令即可使用：

```bash
# mount -t tracefs nodev /sys/kernel/tracing   # 现代挂载点，多数系统已由内核自动挂好
# ls /sys/kernel/tracing | head
available_events      events/               set_event             trace
available_filter_functions  kprobe_events   set_ftrace_filter     trace_pipe
buffer_size_kb        current_tracer        set_graph_function    tracing_on
```

老文档里的 `/sys/kernel/debug/tracing` 是同一个文件系统的旧挂载点（藏在 debugfs 下），新内核统一推荐 `/sys/kernel/tracing`，两个路径的内容完全一致——抄旧教程时把路径替换掉即可。这个目录就是一块控制面板：`current_tracer` 选跟踪器，`set_ftrace_filter` 收窄到指定函数，`trace` 读结果，`tracing_on` 是总开关。所有交互都是普通的文件读写（echo/cat），这意味着 ftrace 天然可脚本化——这与其说是个工具，不如说是一组/sys 接口，trace-cmd 只是给它套了层更好用的壳。

### 3.2 function tracer：函数调用流

```bash
# cd /sys/kernel/tracing
# echo function > current_tracer
# echo vfs_write > set_ftrace_filter     # 只跟踪这一个函数，省 CPU 与缓冲
# echo > trace                           # 清空旧缓冲
# cat /etc/hostname > /dev/null          # 制造一次写操作
# cat trace
# tracer: function
#
# entries-in-buffer/entries-written: 2/2   #P:8
#
#                            _-----=> irqs-off
#                           / _----=> need-resched
#                          | / _---=> hardirq/softirq
#                          || / _--=> preempt-depth
#                          ||| /     delay
#           TASK-PID     CPU#  ||||   TIMESTAMP  FUNCTION
#              | |         |   ||||      |         |
            cat-2213    [004] ....   812.341020: vfs_write <-ksys_write
            cat-2213    [004] ....   812.341462: vfs_write <-ksys_write
```

输出的信息密度值得逐列读：`cat-2213` 告诉你是谁（[进程管理](./process-scheduling.md)里的 task_struct 就在代表它跑）；`[004]` 是 CPU 编号；四个状态符号列（irqs-off/need-resched/hardirq/preempt）是中断与抢占上下文——读[中断与时钟](./interrupt-timers.md)时会频繁用到；`vfs_write <-ksys_write` 是重点：箭头左边是被调函数、右边是调用者，即"这次 vfs_write 是从 ksys_write 走过来的"，对照[系统调用路径](./syscall-path.md)正好是 `write(2) → ksys_write → vfs_write` 的第二跳。表头那一大段图例每个文件里都有，读熟一次就够了。**永远配 filter**：不设 `set_ftrace_filter` 的全局 function tracer 每秒产生百万级事件，机器会明显卡顿——`available_filter_functions` 文件列出了全部可跟踪函数（几十万个），先在里面 `grep` 确认函数名存在再写 filter，写错了不会有任何报错，只会静默无输出。

### 3.3 function_graph：给每个函数计时

function tracer 回答"谁调了谁"，function_graph 回答"这一路走了多久"：

```bash
# echo function_graph > current_tracer
# echo vfs_write > set_graph_function
# echo > trace && cat /etc/hostname > /dev/null && head -6 trace
  3)               |  ksys_write() {
  3)               |    vfs_write() {
  3)   0.840 us    |      rw_verify_area();
  3)   2.917 us    |    }                       # vfs_write 总耗时
  3) + 14.875 us   |  }                         # + 号表示超过 10 us
```

缩进表达调用深度、行尾数字是以微秒计的耗时，`+` 与 `!` 标记分别表示超过 10 微秒与 100 微秒的慢调用——扫一眼就能定位热点层级。这是"一次写操作在 VFS 层花了多久"的最直接证据，比反复猜测"是不是内核慢"高效得多。录制较长会话时用 `trace-cmd record -p function_graph -l vfs_write sleep 10`，再用 `trace-cmd report` 离线回放，避免手工 echo 的繁琐；两种方式采集的数据完全一致，trace-cmd 只是加了一层录制/回放的封装。

### 3.4 kprobe 动态事件：连函数参数一起看

静态 tracer 只能告诉你"vfs_write 被调了"，kprobe 事件还能把参数值抠出来。在 x86-64 上，`vfs_write(unsigned int fd, const char __user *buf, size_t count)` 的第三个参数 `count` 走 `%rdx` 寄存器：

```bash
# echo 'p:mywrite vfs_write count=%dx' > kprobe_events   # p=探针，mywrite=事件名，%dx=count 参数
# echo 1 > events/kprobes/mywrite/enable
# head -c 512 /dev/urandom > /tmp/rand && cat /etc/hostname > /dev/null
# head -2 trace | tail -1
           head-2417    [005] .....   812.445310: mywrite: (vfs_write+0x0/0x2b0) count=0x200
```

`count=0x200` 正是 512 字节的十六进制——探针真实抓到了参数。写法拆开看：`p:` 表示挂一个探针（`r:` 是返回探针，能抓返回值）；`mywrite` 是自定义事件名；`vfs_write` 是挂载点；`count=%dx` 把寄存器 dx 取出来命名为 count。事件启用后走 `events/kprobes/mywrite/` 目录，`enable` 是开关、`filter` 还能加条件（如 `count > 1048576` 只看大写入）。这套寄存器取参的写法依赖目标架构的调用约定，x86-64 前六个参数依次在 `di/si/dx/cx/r8/r9`——内核文档 kprobetrace 里有完整的语法表。用完记得 `echo 0 > events/kprobes/mywrite/enable && echo > kprobe_events` 拆干净，探针挂着不收费，但会持续写缓冲。


### 3.5 tracepoint 事件：内核预埋的观测点

除了往任意函数上挂 kprobe，内核还在关键路径**预埋**了两千多个静态观测点（tracepoint），每个点有稳定的事件名与格式化好的字段——这比 kprobe 稳（内核版本升级不移位）也比 kprobe 好读（参数已按语义命名）。启用方式是把 tracer 置回 `nop`，然后按"子系统:事件名"开事件：

```bash
# echo nop > current_tracer
# echo sched:sched_switch > set_event          # 开一个；*:* 全开（慎用）
# echo > trace && sleep 1 && head -2 trace | tail -1
          <idle>-0     [001] ....   813.001274: sched_switch: prev_comm=swapper/1 prev_pid=0 prev_prio=120 prev_state=S ==> next_comm=cat next_pid=2213 next_prio=120
```

这行事件完整记录了一次 CPU 上下文切换：从空闲进程 `swapper/1`（pid 0）切到 `cat`——[进程调度](./process-scheduling.md)一章里分析调度行为，靠的就是这类事件而非逐函数跟踪。`events/` 目录按子系统分了 `sched/`、`block/`、`net/`、`kmem/` 等几十类，`available_events` 一文件列全集，`grep -i 'block\|writeback' available_events` 找观测点比翻文档快。常用 tracer 组合就此凑齐四个：`function` 看调用关系、`function_graph` 看层级耗时、`nop` + `set_event` 看语义化事件、kprobe 补任意函数的参数——覆盖源码阅读时的九成观察需求，剩下的一成才轮到 bpftrace 的聚合与 gdb 的断点。

## 4. bpftrace：一行代码做聚合

### 4.1 从"看路径"到"看分布"

ftrace 与 kprobe 回答的是"这一次调用长什么样"，bpftrace 回答的是"这十万次调用整体长什么样"——它把 eBPF 程序挂到探针上，在内核里就地计数、求和、画直方图，只把聚合结果送回用户态。经典一行程序：

```bash
# bpftrace -e 'kprobe:vfs_write { @[comm] = count(); }'
Attaching 1 probe...
^C                                        # 运行十几秒后 Ctrl-C 退出

@[systemd-journald]: 963
@[bash]: 41
@[cat]: 3
```

按 Ctrl-C 退出时打印的这张表，就是观测期内"谁在调 vfs_write"的完整答案——systemd-journald 一枝独秀，日志写盘是这台机器写入的主力。语法拆解只有四个零件：`kprobe:vfs_write` 是挂载点（函数名前缀换成 `kretprobe:` 即返回探针）；`{ }` 是动作体；`@[comm]` 是以进程名为键的聚合映射（map）；`count()` 是内置的计数函数。想知道写入量而非次数，把动作换成 `@[comm] = sum(arg2);`——`arg2` 就是 vfs_write 的第三个参数 count，bpftrace 已经替你从寄存器里取好了，比裸 kprobe 的 `%dx` 体贴得多。

### 4.2 延迟直方图：进出探针配对计时

测"一次调用花了多久"需要入口与出口配对：入口探针把时间戳按线程 id 存进映射，返回探针取差值画直方图。这是 bpftrace 最常用的骨架，值得背下来：

```bash
# bpftrace -e '
  kprobe:vfs_write  { @start[tid] = nsecs; }
  kretprobe:vfs_write /@start[tid]/ {
    @write_us = hist((nsecs - @start[tid]) / 1000);
    delete(@start[tid]);
  }'
^C

@write_us:
[8, 16)              947 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@        |
[16, 32)            1204 |@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@|
[32, 64)              38 |@@                                              |
[64, 128)              2 |                                                |
```

`@start[tid]` 以线程 id 为键——并发调用不会互相串门；`/@start[tid]/` 是谓词，只处理配得上对的返回；`hist()` 把微秒差值分桶成 2 的幂次区间，一眼看出主体落在 16-32 微秒、长尾到 64 微秒以上。绝大多数性能争议（"内核是不是变慢了"）最终都能收敛到一张这样的直方图上：版本升级前后各采一张，分布右移就是实锤。函数名换成 `ext4_file_write_iter`、`__x64_sys_write`，同一骨架直接复用到[文件系统](./vfs-ext4.md)与[系统调用](./syscall-path.md)各章的实操里。

### 4.3 与 ftrace 的分工及生产可用性

两个工具的组合拳是这样打的：先用 ftrace 的 function_graph 看清**一条**请求的完整路径（回答"路怎么走"），发现可疑函数后再用 bpftrace 对它做**全天候**统计（回答"所有人走这条路时整体如何"）。bpftrace 能上生产而裸写 kprobe 不敢，根本原因在 BPF 验证器：程序加载时内核会穷举所有执行路径，确认它不会越界访问、不会死循环、不会崩溃内核——验证不过就拒绝加载。这套"先证明安全再运行"的机制，与[包管理](../basic/packages/apt.md)先校验签名再安装是同一种纪律：都把风险拦截在生效之前。`bpftrace -l 'vfs_*'` 可以模糊列出全部可挂的探针，写脚本前先查一遍，比对着报错猜函数名省事。

## 5. gdb + QEMU：断点调试内核

### 5.1 什么时候值得动用终极致命武器

前面三层都是"观察"，gdb 是"审讯"——把内核停在任意一行代码上，检查那一时刻的全部现场：局部变量、寄存器、调用栈、页表内容。代价是环境必须重建：你不能对正在跑的生产内核下断点（停机即事故），而是在 QEMU 虚拟机里跑一个内核，从外部用 gdb 连上去。适用场景只有一类：某函数**第一次**被调用时的现场，或某条罕见路径的触发条件——这些用 trace 抓概率太低，断点一击必中。[内核编译](./build-and-modules.md)一章产出的 bzImage 与带符号 vmlinux 在这里派上用场；initramfs 用发行版工具生成一份最小根文件系统即可。

### 5.2 最小可跑环境

一条 QEMU 命令把"服务器"跑起来，`-s` 是内置 gdbserver（监听 1234 端口），`-S` 是开机即冻结在第一条指令（防止 gdb 连上之前内核已经跑远）：

```bash
$ qemu-system-x86_64 -kernel arch/x86/boot/bzImage \
    -initrd rootfs.cpio.gz \
    -append "console=ttyS0 nokaslr" \
    -nographic -s -S
```

另一端启动 gdb，加载符号后连线、下断点、放行：

```text
$ gdb vmlinux
(gdb) target remote :1234
Remote debugging using :1234
0x000000000000fff0 in ?? ()
(gdb) hbreak start_kernel          # 硬件断点：此时内存管理未就绪，软断点写不进内存
Hardware assisted breakpoint 1 at 0x...: kernel/init/main.c, line ...
(gdb) c
Continuing.
Breakpoint 1, start_kernel () at init/main.c:...
```

`console=ttyS0` 把内核输出重定向到串口，QEMU 的 `-nographic` 把串口接到当前终端——于是同一屏里内核的启动日志与 gdb 的提示交替出现，这是内核调试的标准姿势（真实硬件上用串口线，原理相同）。断点用 `hbreak` 而非 `break` 有个硬理由：软断点的实现是"把指令改写成 int3"，而内核启动早期 MMU 尚未启用、代码段不可写，只能靠调试寄存器实现的硬件断点。initramfs 的制作不必手搓，`dracut --no-hostonly --force` （RHEL 系）或 `mkinitcpio`（Arch）都能产出一个带 busybox shell 的最小 rootfs.cpio.gz——目标不是功能齐全，而是"内核起来后有个 shell 可以敲命令制造场景"。

### 5.4 内核自带的 gdb 脚本：lx-* 命令

内核源码树里附赠了一套 gdb 辅助脚本（`scripts/gdb/vmlinux-gdb.py`），加载后多出一组 `lx-` 前缀的命令，把内核数据结构翻译成可读输出：

```text
(gdb) source scripts/gdb/vmlinux-gdb.py
(gdb) lx-dmesg                       # 内核日志（相当于串口里看到的 dmesg，gdb 侧直接读）
(gdb) lx-lsmod                       # 已加载模块与各模块的内存布局
(gdb) lx-cpus                        # CPU/逻辑处理器概览
(gdb) p init_task                    # 0 号进程的 task_struct，进程章的主角
```

`lx-dmesg` 在断点停住时最有价值——停在死锁现场，串口未必还刷得出日志，gdb 却能直接读环形缓冲区；`p init_task` 则把[进程管理](./process-scheduling.md)里的抽象结构变成眼前可翻的字段树（`(gdb) p init_task.pid`、`p init_task.comm`）。这套脚本随内核版本演进，命令清单见源码树 `scripts/gdb/` 目录——又一条"工具就在源码里"的注脚。

### 5.3 KASLR：断点不命中的头号元凶

现代内核默认开启地址随机化（KASLR），每次启动内核代码被搬到随机地址，而 gdb 手里的符号表记录的是编译时地址——两边对不上，断点自然打空。解法就是上面命令行里那个不起眼的 `nokaslr`：把它加进 `-append` 的内核命令行，内核回到编译时的原点，符号即地址。生产内核不允许关 KASLR（那是安全特性），所以调试用的内核命令行与生产不同是常态；反过来说，在 gdb 里 `info breakpoints` 看到断点地址、`cat /proc/kallsyms | grep start_kernel` 看实际地址，两者对齐与否就是 KASLR 是否生效的判据。这个细节吞噬过无数初学者的第一个下午——符号明明加载了、断点就是不中，九成是它。

## 6. 组合战例：一次"写文件周期性卡顿"的完整排查

四个层级怎么串成一次真实的排查？以一个经典故障为脚本：往 ext4 分区 `cp` 一个 2GB 文件，速度从平时的 1.2 GB/s 掉到 45 MB/s，且每写几秒就停顿一次。排查按层级递进，每一层只回答一个问题。

**第一层，strace -c 确认"卡在边界还是卡在内核"。**`strace -c cp big.iso /mnt/` 的账单里时间几乎全落在 `write` 上、errors 为零——程序侧无异常、也无重试风暴，问题在内核或更深处。这层五分钟就做完，价值是排除用户态，避免在错误的楼层找钥匙。

**第二层，看脏页水位。**`watch -n1 'grep -E "Dirty|Writeback" /proc/meminfo'`：Dirty 一路涨到约 500 MB 后被瞬间清空，写速度随之恢复又下跌——典型的周期性强制回写。页缓存把写动作攒在内存里，攒到 `vm.dirty_ratio` 阈值就把写入方按住（`balance_dirty_pages` 限速），等回写追上来再放行；阈值配得激进、底层盘又慢时，就呈现"冲刺—长停"的锯齿。这是[内存管理](./memory-management.md)与[文件系统](./vfs-ext4.md)两章交叉的机制。

**第三层，bpftrace 量化双峰分布。**用 4.2 节的直方图骨架挂 `kprobe:vfs_write`/`kretprobe:vfs_write`：延迟分布清晰双峰——十几微秒一团（页缓存命中，直接返回）、数十毫秒一团（被回写节流按住）。双峰证实了两种命运的存在，也把"偶发慢"量化成了可对比的基线。

**第四层，ftrace 看慢的那一锤走了哪些函数。**`function_graph` 配 `set_graph_function ext4_file_write_iter`，慢调用内部清晰出现 `balance_dirty_pages` → `io_schedule` 的等待链——限速点盖章确认。处置随之而来：要么调 `vm.dirty_background_ratio`/`vm.dirty_ratio` 让回写早启动、平滑冲刷（sysctl 持久化见[Systemd 篇的 sysctl 管理惯例](../system-management/services-systemd.md)），要么承认底层盘的写入能力就是瓶颈。四层工具各答一问，没有一步是猜测——这就是"观察层级"的实战形态：从外到内，每层收窄一圈，最后一步才见分晓。

## 7. 工程纪律

**生产用动态探针，不用断点。** bpftrace 与带 filter 的 ftrace 有验证器/编译期埋点背书，可以放进生产例行观测；strace 与 gdb 一个拖垮目标、一个直接停机，只属于排障现场与实验环境。这条线画在哪里，比会多少工具更重要。

**先锁版本再跟踪。** 内核函数名与结构体随版本漂移（6.x 里 `ksys_write` 的位置就与 5.x 不同），工具输出里看到的每个符号都必须对得上"当前这台机器的源码"——`uname -r` 定版本，再去 [elixir.bootlin.com](https://elixir.bootlin.com/) 选对应版本点进源文件。版本错位时看到的函数名像是幻影：跟踪得到、源码里却搜不到，白白怀疑人生。源码树的获取与版本对照见[源码导读](./source-tree.md)。

**缓冲区会满。** trace 缓冲按 CPU 分片、默认每片仅数十 KB，高频事件几秒就冲爆（新事件静默丢弃）。长会话前 `echo 8192 > buffer_size_kb` 扩容，事后 `echo 0 > buffer_size_kb` 归位（0 表示恢复默认）。用 `trace_pipe` 流式读取可以边采边消费，避免落盘竞争——但这些是"录制长会话"时才需要操心的事，初次实验的几秒钟输出用默认缓冲绰绰有余。

**把"函数名 → 源码行"变成条件反射。** 每在 trace 输出里见到一个新函数名，就去 elixir 里点开它看一眼实现——工具负责告诉你"这里发生了什么"，源码负责告诉你"为什么这样发生"。本篇后续各模块章的实操小节都按这个节奏编排：先跟踪、再对照源码、最后回到源码阅读顺序。跟踪工具是源码阅读的放大镜，不是替代品。

## 8. 常见坑

**普通用户写不了 /sys/kernel/tracing。** tracefs 默认仅 root 可写，非 root 执行 echo 会得到 Permission denied。正规做法是挂载时指定 `gid=`（`mount -o remount,gid=tracegid /sys/kernel/tracing`）把权限授予一个跟踪专用组；日常实验直接用 root 会话更省事。别为了图方便给普通账号常年开跟踪权限——它能看到全系统函数流，等于装了台全局监控。

**set_ftrace_filter 写错函数名静默无输出。** 函数名拼错、或该函数被内联/未导出，ftrace 都不会报错，只会让 trace 文件空空如也。写 filter 前先 `grep -w vfs_write available_filter_functions` 确认函数在册——这个几十万行的清单就是 filter 的合法取值域，它说了算。

**function tracer 全局开启拖垮系统。** 不设 filter 时每秒百万级事件会占满缓冲、拉高 CPU，机器肉眼可见地卡。纪律只有一条：开 function tracer 必须先写 `set_ftrace_filter`；function_graph 同理用 `set_graph_function` 收口。用完 `echo nop > current_tracer` 关掉，别把重量级 tracer 留在配置里过夜。

**bpftrace 报 kprobe 找不到符号。** 函数名拼错、内核版本不同名、或该符号是 static 未导出，加载阶段就会报错终止——这比 ftrace 的静默友好，但排查思路相同：`bpftrace -l 'vfs*'` 先列出来再写。注意 `kprobe:` 只对 `/proc/kallsyms` 里可见的符号生效，模块里的函数要带模块名前缀（如 `kprobe:ext4_*` 需模块已加载）。

**gdb 断点不命中。** 九成是 KASLR（见 5.3 节，`nokaslr` 解决），一成是用了 `break` 而早期内存不可写（换 `hbreak`）。判定顺序：`cat /proc/kallsyms | grep <符号>` 比对 gdb 的 `info breakpoints` 地址，先排除随机化，再怀疑断点类型。

**strace 挂着跑压测。** ptrace 的双停机制让目标慢一个量级，压测数据全部失真，结论必然误导优化方向。性能测量交给 ftrace/bpftrace 的内核侧统计（它们不在用户态拦截），strace 只回答"行为"问题，不回答"性能"问题。

**trace 文件越 cat 越多。** `cat trace` 读到的是快照，但后台系统调用持续产生新事件，边看边涨是正常现象而非灵异。实验前 `echo > trace` 清一次、动作做完立刻 cat，中间不要穿插无关命令；或者改用 `trace_pipe`（读走即消费）。看不完的输出存文件慢慢分析，比在终端里追着滚动条健康。

## 参考资料

- ftrace 官方文档 — [kernel.org/doc/html/latest/trace/ftrace.html](https://www.kernel.org/doc/html/latest/trace/ftrace.html)
- kprobe 事件语法 — [kernel.org/doc/html/latest/trace/kprobetrace.html](https://www.kernel.org/doc/html/latest/trace/kprobetrace.html)
- bpftrace 项目与 one-liners 文档 — [github.com/iovisor/bpftrace](https://github.com/iovisor/bpftrace)
- bpftrace 备忘单（Brendan Gregg）— [brendangregg.com/BPF/bpftrace-cheat-sheet.html](https://www.brendangregg.com/BPF/bpftrace-cheat-sheet.html)
- strace 官网 — [strace.io](https://strace.io/)，另见 man strace
- 鸟哥的私房菜（系统观测与程序追踪相关章节）— [linux.vbird.org](https://linux.vbird.org/)
