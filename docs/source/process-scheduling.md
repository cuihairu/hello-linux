# 进程管理与调度（源码篇）

运维视角里，进程是 `ps` 输出的一行：一个 PID、一个 STAT 字母、一个 nice 值。内核视角里，进程是一个 `task_struct` 加一摞账本：标识、状态、亲缘、调度实体、地址空间指针。本页把这两张视角对齐——STAT 的每个字母对应 `TASK_` 常量的哪一位、nice 值如何变成权重表里的一档、`fork` 与上下文切换在源码里怎么走完。跟读本篇的前置（源码获取、跟踪工具）见[源码获取与目录导读](./source-tree.md)与[跟踪工具](./tracing-tools.md)；本页所有函数名与字段名都按 **v6.12** 源码核对，6.6 起调度器从 CFS 换成 EEVDF，这个版本分界贯穿全页。进程的内存侧写（`mm` 指针、写时复制）留给[内存管理](./memory-management.md)，本页只埋伏笔。

> 内容参考自 Linux 内核 v6.12 源码树（函数名/文件/行号均经 elixir 核对）与文末书目（概念框架），见文末参考资料。

## 学习目标

- 把 `ps` 的 STAT 字母与 nice 值对回内核的 `TASK_` 常量与权重表，说出 `task_struct` 五族关键字段的职责
- 走通两条路径：fork 的 `kernel_clone` 链与调度的 `__schedule` 链，并备好与老书 `do_fork`/`_do_fork` 的对译表
- 理解 6.6+ 的 EEVDF：`sched_entity` 的 `vlag`/`deadline`/`slice` 三件套如何决定"谁有资格跑、先跑谁"
- 用 `sched_switch` tracepoint、bpftrace、`/proc` 把每一次上下文切换亲眼看到
- 会解读 D 状态、僵尸进程、`swapper/0` 这些高频现象在源码层的含义

## 1. 进程是什么：内核视角与运维视角

内核眼里没有"进程"与"线程"的鸿沟，只有 task：一个 `task_struct` 就是一个可调度实体。`fork()` 造出来的是新地址空间的新 task；`pthread_create()` 造出来的是**共享**地址空间的新 task——用户态的 `clone(2)` 带着 `CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD` 一组标志进内核，`copy_process` 见到 `CLONE_VM` 就跳过复制页表、只递增共享计数。所以 `ps -eLf` 里每个线程各占一行不是显示技巧：它们真的是内核里各自独立的 task，各有 PID（线程组内 `tgid` 相同，`ps` 显示的 PID 其实是 tgid）。

| 运维看到的 | 内核里的 | v6.12 位置 |
|-----------|---------|-----------|
| STAT 列 `R` | `TASK_RUNNING`（0x00000000，可运行） | include/linux/sched.h |
| STAT 列 `S` | `TASK_INTERRUPTIBLE`（0x00000001，可中断睡眠） | 同上 |
| STAT 列 `D` | `TASK_UNINTERRUPTIBLE`（0x00000002，不可中断睡眠） | 同上 |
| STAT 列 `T` | `__TASK_STOPPED`（0x00000004）/ `__TASK_TRACED`（0x00000008） | 同上 |
| STAT 列 `Z` | `EXIT_ZOMBIE`（0x00000020） | 同上 |
| nice -20..19 | 40 档 `sched_prio_to_weight[]` 权重表 | kernel/sched/core.c |
| `ps` 的 COMM 列 | `task_struct.comm`（16 字节短名） | include/linux/sched.h |

两个映射值得展开。其一，状态字段在较新的内核里改名为 `__state` 并要求经辅助函数访问——直接给 `current->state` 赋值的老代码、老文章照抄会编译不过，这是版本敏感的又一例。其二，nice 值不是线性扣减 CPU，而是查权重表：相邻一级权重差约 1.25 倍，`nice +5` 的任务拿到的 CPU 大约是对手的 1/3，`nice +10` 差不多只有 1/10——"调了一点没感觉"与"调狠了饿死"都是这张几何级数表的直接后果。`set_user_nice()`（kernel/sched/core.c）就是那个查表改权重的入口。

## 2. 核心数据结构（五段式 ①）

### 2.1 task_struct：进程的总账本

`task_struct` 有几百个字段，通读是低效的，按"族"取用才记得住。对进程管理与调度这一章，值得放进脑子的是五族：

```text
                    fork()/clone()
                         │
                         ▼
   ┌─────────── TASK_RUNNING（R，就绪或正在跑）────────────┐
   │                    ▲                │                 │
   │ 事件到来            │                │ 等待事件          │ 不可中断
   │ （信号/IO/定时器）    │                │ （等输入/等锁）     │（等 IO）
   │                    │                ▼                 ▼
   │            TASK_INTERRUPTIBLE（S）  ◄──►     TASK_UNINTERRUPTIBLE（D）
   │                    │                                        │
   │                    └── 退出 ──► EXIT_ZOMBIE（Z）── 父 wait ──► 回收
   └──────────────────────────────────────────────────────────────┘
   另有 __TASK_STOPPED（T，SIGSTOP 暂停）与 __TASK_TRACED（t，被 ptrace 调试器截住）
```

五族字段：

| 字段族 | 代表字段（v6.12 行号） | 管什么 |
|-------|----------------------|--------|
| 标识 | `pid`（:1018）、`tgid`（:1019）、`comm`（短名） | 谁是谁；线程组内 pid 各异、tgid 相同 |
| 状态 | `__state`（:786） | R/S/D/Z/T 的真相；调度器据此判断可运行性 |
| 亲缘 | `real_parent`（:1032）、`children`（:1040） | 僵尸回收的债权关系（见 3.3） |
| 调度 | `se`（:831）、`policy`、`prio`/`normal_prio`、`cpus_mask`（:880） | 归哪个调度类、什么优先级、能跑哪些 CPU |
| 地址空间 | `mm`（指向 `mm_struct`） | 进程的内存地图；fork 时不复制只挂引用（伏笔见[内存管理](./memory-management.md)） |

### 2.2 sched_entity：调度器真正盯着的东西

公平调度类操作的对象不是 `task_struct`，而是嵌在它里面的 `struct sched_entity`（老书叫 `sched_entity` 或直接谈 `vruntime`，字段已大变）。v6.12 的关键字段：

```text
struct sched_entity {          // include/linux/sched.h（节选）
    struct load_weight  load;   // 权重，nice 查表而来
    struct rb_node      run_node; // 挂进 cfs_rq 红黑树的节点
    u64                 vruntime; // 虚拟运行时间：按权重折算的"已跑量"
    s64                 vlag;      // 账：正=内核欠你 CPU，负=你多占了
    u64                 deadline;  // 虚拟截止时间：vd_i = ve_i + r_i / w_i
    u64                 slice;     // 本轮允许的时间片请求
    unsigned char       on_rq;     // 是否在运行队列里
};
```

EEVDF（Earliest Eligible Virtual Deadline First，6.6 起取代 CFS）的裁决规则就建立在这三个字段上：**只有 `vlag ≥ 0` 的任务才有资格被选中**（lag 为负说明它已透支了配额），在"有资格"的集合里**挑虚拟截止时间 `deadline` 最早的那个**。`slice` 小的任务 deadline 自然靠前——这就是 EEVDF 天然照顾短交互请求的机制，也解释了为什么 6.6 之后大量讲 `vruntime` 派生的 CFS 文章必须带版本警惕去读：`vruntime` 字段还在，但"谁先跑"的裁判规则换了。`vlag` 的账在睡眠时不清零：按延迟出队（deferred dequeue）策略折算衰减，防止任务睡一觉醒来白赚优先级——这些语义一手出处是内核文档 `Documentation/scheduler/sched-eevdf.rst` 与 kernel/sched/fair.c 顶部注释。

### 2.3 rq 与组调度：为什么调度的不是 task_struct

每个 CPU 一个 `struct rq`（kernel/sched/sched.h），其中公平类的子队列是 `cfs_rq`——一棵按 `deadline` 组织的红黑树。设计上让调度器面对 `sched_entity` 而非 `task_struct`，是为**组调度**留的门：开启 `CONFIG_FAIR_GROUP_SCHED` 后，一个 cgroup（`task_group`）在父队列里也表现为一个 `sched_entity`，红黑树因此长成层级结构——两个各跑 10 个任务的容器，在机器层面先对半分 CPU，再在组内分配。这也修正了运维直觉：组调度下把容器里某个任务 nice 拉高，争用的是组内份额，容器间分蛋糕先看组权重——"为什么这台 cgroup 里的任务降了 nice 还是抢不过隔壁"的答案在层级里。

## 3. 关键函数调用路径（五段式 ②）

### 3.1 fork 路：一个进程的诞生

```text
用户 fork()
  └─ __x64_sys_fork（x86 入口包装）
       └─ sys_fork            kernel/fork.c:2868  SYSCALL_DEFINE0(fork)
            └─ kernel_clone    kernel/fork.c:2745
                 ├─ copy_process    kernel/fork.c:2118
                 │    ├─ sched_fork  :2344   初始化调度实体、定优先级
                 │    ├─ copy_files  :2362   复制/共享文件描述符表
                 │    ├─ copy_mm    :2374   复制/共享地址空间（见下）
                 │    └─ copy_thread         准备内核栈与寄存器现场
                 └─ wake_up_new_task  kernel/fork.c:2817   放入就绪队列
```

`copy_mm` 是"fork 很便宜"神话的出处：它调用 `dup_mm` **复制的是页表不是内存**——逐项把可写页标成写保护、父子共享物理页，谁先写谁触发缺页再各复制一份（写时复制，机制细节见[内存管理](./memory-management.md)）。所以 fork 一个 10GB 的进程不消耗 10GB，只消耗页表与 `task_struct` 本身。`sched_fork` 则给新任务一个干净的调度出身：继承 policy 与 nice、清零 `vlag` 相关账目、挂进父亲的 CPU 掩码。老书对译：`do_fork`（2.4 时代）→ `_do_fork`（2.6—5.x）→ `kernel_clone`（6.x 至今），读不同年代材料时先在心里换算成同一个函数。

fork 家族的差异全部落在 `copy_process` 收到的 clone 标志上，一张表说清：

| 接口 | 关键标志 | 效果 |
|------|---------|------|
| `fork()` | `SIGCHLD`（glibc 经 `clone` 实现） | 复制页表与文件表，父子地址空间独立 |
| `vfork()` | `CLONE_VFORK\|CLONE_VM` | 父子**临时**共享地址空间，子进程 exec/退出前父挂起——省页表但极危险，POSIX 已不推荐 |
| `pthread_create()` | `CLONE_VM\|CLONE_FS\|CLONE_FILES\|CLONE_SIGHAND\|CLONE_THREAD\|CLONE_SETTLS` | 共享一切的"进程"：同一 tgid、同一信号处理、独立内核栈与 TLS |
| `clone3()` | 64 位结构体传参 | 标志可扩展（如 `CLONE_INTO_CGROUP`，systemd 派生子进程进 cgroup 靠它），内核侧统一入口仍是 `kernel_clone` |

也就是说"线程 vs 进程"在源码层是**一组标志位的选择题**，不是两种创建路径——读 `copy_process` 时带着这组标志回看，每个 `if (clone_flags & ...)` 分支就都是显式的。

### 3.2 调度路：一次上下文切换

```text
时钟中断 / 唤醒事件 / 主动让出
  └─ schedule()
       └─ __schedule      kernel/sched/core.c:6548
            ├─ 关中断与抢占，选定 prev/next
            ├─ pick_next_task    :6647   按调度类问一圈（stop→dl→rt→fair→idle）
            │    └─ fair 类: pick_next_task_fair → pick_eevdf（kernel/sched/fair.c:907）
            └─ context_switch    :6693
                 ├─ 切换地址空间（switch_mm_irqs_off；内核线程借用 prev 的 active_mm）
                 └─ switch_to（汇编）换寄存器栈现场——执行流从此属于 next
```

`__schedule` 的骨架并不神秘：锁住现场、选出 next、切换走。公平类选人的核心 `pick_eevdf`（fair.c:907，顶部注释 :889 起是 EEVDF 的正式说明书）在红黑树里找"lag 非负且 deadline 最早"的实体——2.6 时代 CFS 的"vruntime 最小者先跑"在此处已被替换。`context_switch` 里有个人畜无害的细节：内核线程没有用户地址空间（`mm` 为 NULL），切换时借前任的 `active_mm` 用，省一次 TLB 换血——你在 trace 里看到 kworker 与用户进程频繁互切并不产生大量地址空间开销，一半功劳在这。

### 3.3 退出路：僵尸的账本含义

`do_exit`（kernel/exit.c:877）释放进程的资源后，把状态置为 `EXIT_ZOMBIE`（0x00000020）并**不**立即回收 `task_struct`——退出码与资源账目还钉在那具躯壳上，等父进程 `wait`/`waitpid` 来结账。这就是僵尸的定义：**账未结，不是 bug**。父进程先死呢？内核把孤儿重新挂到最近的 subreaper（没有就一路挂到 1 号，现代系统即 systemd）名下，由它收账；服务进程可以自己 `prctl(PR_SET_CHILD_SUBREAPER, 1)` 宣布"孙辈的账我认领"，这也是 systemd 旗下服务能托管孙进程退出的机制基础——服务与进程归属的管理面话题见[系统服务管理](../basic/services/system_services.md)。

## 4. 源码阅读顺序（五段式 ③）

同样的源码，读的顺序决定两周入门还是两个月迷路。对进程与调度，推荐这条线，每步都注明"跳过什么"：

1. **include/linux/sched.h 当字典用，不要顺序读**。几百个字段的巨结构，先只查 2.1 那五族；`TASK_` 常量在文件头部（:99 起），`sched_entity` 在结构体定义区内。
2. **kernel/fork.c 的 `copy_process` 读主干**。从 :2118 进入，跳过 audit、seccomp、cgroup、ptrace 那些带条件编译的支线，只追 `sched_fork` → `copy_files` → `copy_mm` → `copy_thread` 四步；回头再看 `kernel_clone`（:2745）怎么包调用与 `wake_up_new_task`。
3. **kernel/sched/core.c 只读 `__schedule`**（:6548）。跳过实时类与 deadline 类的分支（`pick_next_task` 对各类的轮询逻辑看懂即可），聚焦 `context_switch`。
4. **kernel/sched/fair.c 从顶部注释读起**（:889 起的 EEVDF 说明），再回头看 2.2 的字段含义，最后才进 `pick_eevdf`（:907）看红黑树怎么按 deadline 查找。整文件 1.3 万行，负载均衡部分（`load_balance` 一族）第一遍全部跳过。
5. **kernel/exit.c 只读 `do_exit`**（:877）与它的收尾段：资源释放的顺序、`EXIT_ZOMBIE` 的置位点、退出通知（`do_notify_parent`）。跳过 ptrace 与信号杀伤路径——那属于[系统调用路径](./syscall-path.md)与跟踪工具的射程。

这条线的产出是 3.1/3.2 两张路径图在你脑内闭环；负载均衡、实时调度、cgroup 配额是第二遍的事。工具面（怎么在浏览器里点这些函数、怎么建本地索引）见[源码获取与目录导读](./source-tree.md)。

## 5. 实操跟踪（五段式 ④）

### 5.1 跟踪一次 fork

```bash
$ strace -f bash -c 'true' 2>&1 | grep -E 'clone|execve' | head -3
clone(child_stack=NULL, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, child_tidptr=0x7f2c...) = 23347
execve("/usr/bin/true", ["true"], 0x55f8... /* 42 vars */) = 0
+++ exited with 0 +++
```

现代 glibc 的 `fork()` 底层就是带 `SIGCHLD` 的 `clone`——参数里没有 `CLONE_VM`，正是 3.1 所说的"不共享地址空间"。再用 bpftrace 给 `kernel_clone` 打点，统计谁在生进程：

```bash
$ sudo bpftrace -e 'kprobe:kernel_clone { @[comm] = count(); } interval:s:5 { exit(); }'
@[systemd]: 2
@[bash]: 1
```

五秒内 systemd 与 bash 各自的 fork 次数一目了然——排查"进程在悄悄繁殖"类问题，这一行探针比反复 `ps` 靠谱。

### 5.2 看见每一次上下文切换

`sched:sched_switch` 是内核自带的 tracepoint，正好把 `__schedule` 的每次裁决变成流水记录：

```bash
$ echo 1 | sudo tee /sys/kernel/tracing/events/sched/sched_switch/enable
$ sudo cat /sys/kernel/tracing/trace | tail -4
<idle>-0       [003] d..2. 83109.112233: sched_switch: prev_comm=swapper/3 prev_pid=0 prev_prio=120 prev_state=S ==> next_comm=bash next_pid=23347 next_prio=120
bash-23347    [003] d..2. 83109.112241: sched_switch: prev_comm=bash prev_pid=23347 prev_prio=120 prev_state=S ==> next_comm=swapper/3 next_pid=0 next_prio=120
```

每行就是 3.2 那条路径走完一次的现场：`prev_state=S` 说明 bash 是睡眠让出（等 IO 或输入），不是时间片耗尽被抢占；`swapper/3` 是 3 号 CPU 的空闲任务。用它对拍负载：跑一个死循环观察它与非自愿切换的关系，比背概念直观得多（tracefs 路径与过滤技巧见[跟踪工具](./tracing-tools.md)）。

### 5.3 运行态佐证

```bash
$ ps -eLf | head -3
UID   PID  PPID   LWP  C NLWP STIME TTY          TIME CMD
root     1     0     1  0    1 21:30 ?        00:00:02 /sbin/init
root   467     1   467  0    3 21:30 ?        00:00:00 /usr/sbin/sshd -D
$ grep ctxt /proc/$$/status
voluntary_ctxt_switches:        412
nonvoluntary_ctxt_switches:     3
```

`ps -eLf` 每线程一行（NLWP 是线程数）——每行对应一个 `task_struct`，2.1 的字段在这个视图里全部有落点。`/proc/<pid>/status` 的两组切换计数是调度行为的体检单：voluntary 高是常态（等网络、等键盘）；nonvoluntary 持续增长说明 CPU 争用激烈、任务频繁被抢占——配合 5.2 的 trace 能定位是谁在跟它抢。

### 5.4 D 状态实验

```bash
$ dd if=/dev/zero of=/mnt/usb/bigfile bs=1M count=2048 conv=fsync oflag=direct & sync
$ ps -o stat,pid,wchan:24,comm -C dd,sync
STAT   PID WCHAN                    COMMAND
D      5102 io_schedule              dd
```

向慢速介质（USB 盘、网络存储）写大文件时抓 `ps`，能看到 STAT 为 `D`、`wchan` 落在 `io_schedule` 一类的任务——`TASK_UNINTERRUPTIBLE` 正是 2.1 表中那位"信号也叫不醒"的状态：它在等缺页换页或块设备 IO，睡眠点选了不可中断模式。这也解释了为什么 D 状态任务 kill -9 无效、为什么负载均值会把 D 任务计入（iowait 的会计口径）——现象、常量、源码三层在此对齐。进程状态与命令面的日常用法见[进程管理命令](../commands/system/process.md)。

## 6. 常见坑

**照老书找不到 `do_fork`/`_do_fork`。** 2.4 的 `do_fork`、5.x 的 `_do_fork`、6.x 的 `kernel_clone` 是同一个函数的三代名。读任何年代的材料先做对译，搜代码时三个名字都试一遍；反过来，在 6.x 源码里 grep `do_fork` 会得到 fork 老路径相关的注释而非定义，别据此断定"这内核还在用老接口"。

**拿 CFS 文章理解 6.6+ 内核。** "vruntime 最小者先跑"在 6.6 起不再成立：EEVDF 的裁判是"lag 非负且 deadline 最早"。`vruntime` 字段仍在、仍在累加，但选人规则变了；读调度文章先看发布日期与内核版本，就像读 DNS 文章先看它讲的是不是还有效的记录类型。

**调度的不是 task_struct，是 sched_entity。** 组调度开启时（主流发行版都开），cgroup 在父队列里也是一个 `sched_entity`。nice 的语义因此变成两层：组内份额与组间份额分开算——容器里某个任务 nice 再低，也压不过组权重先天的分配，排查"优先级不生效"先看 `/sys/fs/cgroup` 的层级再看 nice。

**僵尸是账未结，不是 bug。** `EXIT_ZOMBIE` 只是等父进程取退出码；真正要治理的是"长期不 wait 的父进程"。孤儿会被 subreaper 或 systemd 收账，`PR_SET_CHILD_SUBREAPER` 是服务进程接管孙辈的正规姿势——给僵尸"治病"的起点永远是改父进程，不是反复 kill 僵尸本体。

**trace 里大量 `swapper/N` 出现。** 每个 CPU 一个空闲任务（`INIT_TASK_COMM` 即 "swapper"，idle 命名 `swapper/<cpu>`），CPU 空转时调度器切到它，trace 里自然成片出现——这是正常噪音，过滤 `next_pid!=0` 或 `prev_pid!=0` 即可聚焦真实任务。

**nice 微调没体感。** 权重表是几何级数（相邻档约 1.25 倍），`nice +1` 只差 25%，肉眼难辨；要拉开差距通常 +5 起。且体感受组调度、IO 等待稀释——先用 5.3 的切换计数确认瓶颈真在 CPU 份额上，再动 nice。

**`ps` 里的 PID 与线程实际对不上。** `ps -eLf` 每线程一行、LWP 列各不相同，但 `kill <PID>` 却作用到"整组"——因为 `ps` 的 PID 列显示的是 `tgid`，信号默认投递给线程组。按线程单独操作要么用 LWP 号加显式语法，要么认清 2.1 表里 `pid` 与 `tgid` 的分工；`top -H` 切换到线程视图是最快的肉眼核对。

## 7. 延伸资料（五段式 ⑤）

- 《Linux内核设计与实现》（Robert Love）——进程与调度两章：篇幅最小的入门框架，2.6 早期视角，概念至今成立，函数名需按 3.1 的对译表换算
- 《深入理解Linux内核》（Bovet & Cesati）——进程相关章：数据结构关系图最密集的一本，同样基于 2.6
- 《深入Linux内核架构》（Wolfgang Mauerer）——进程管理相关章：2.6.24 的字段级参考，查结构体字段的历史语义时用
- EEVDF 一手材料——内核树内 `Documentation/scheduler/sched-eevdf.rst` 与 kernel/sched/fair.c 顶部注释（v6.12 :889 起）；lag 语义、虚拟截止时间公式 `vd_i = ve_i + r_i/w_i` 都以这里为准
- [Linux v6.12 在线交叉引用](https://elixir.bootlin.com/linux/v6.12/latest/source)——本页全部行号可在此复核
- [内核调度器文档索引](https://docs.kernel.org/scheduler/)——官方文档树入口

## 参考资料

- Linux 内核源码 v6.12 — [elixir.bootlin.com/linux/v6.12](https://elixir.bootlin.com/linux/v6.12/latest/source)
- 内核调度器官方文档 — [docs.kernel.org/scheduler](https://docs.kernel.org/scheduler/)
- EEVDF 说明（树内文档）— `Documentation/scheduler/sched-eevdf.rst`
- man 手册 — man clone(2)、man proc(5)、man ps(1)
- Robert Love.《Linux内核设计与实现》（Linux Kernel Development, 3rd ed.）
- Daniel P. Bovet & Marco Cesati.《深入理解Linux内核》（Understanding the Linux Kernel, 3rd ed.）
- Wolfgang Mauerer.《深入Linux内核架构》（Professional Linux Kernel Architecture）
- 鸟哥的私房菜 — [linux.vbird.org](https://linux.vbird.org/)（进程与工作的概念框架）
