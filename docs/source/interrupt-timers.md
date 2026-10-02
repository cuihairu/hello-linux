# 中断与时钟

进程、内存、文件系统这些子系统的源码里，主角都是"被请求的任务"；中断与时钟相反，它研究的是**内核什么时候有机会干活**——网卡来了一包数据、磁盘扇区读完了、时间片用尽了要换人、一个延迟函数到期了，全靠中断体系把内核从睡眠里拽起来。这也决定了它的代码气质：处处是"不能睡眠"的约束和"贵活推迟"的权衡。本页沿统一骨架展开——先认清六套核心数据结构（`irq_desc`、softirq 槽位、`work_struct`、`hrtimer`、clocksource/clock_event_device、`timer_list` 时间轮），再走通五条调用路径（中断上半部、softirq 执行体、workqueue、hrtimer 与 tick/NOHZ、时间轮到期），然后给出源码阅读顺序与六个实操跟踪实验，最后是常见坑与延伸书目。工具细节（ftrace/bpftrace 的用法）见[跟踪工具](./tracing-tools.md)，本页只讲"被观察的机制本身"。

> 内容参考自内核源码树（v6.12）与下列真实书目（概念框架），见文末参考资料。本页所有函数名、结构体字段、trace 事件路径均对照 v6.12 源码逐一核对，终端输出取自一台 14 核 x86-64 机器的真实采样。

## 学习目标

- 说清上半部/下半部的经济学分界，知道为什么中断上下文里不能 `mutex_lock`
- 认出 `irq_desc`、`softirq_vec`、`work_struct`、`hrtimer`、`timer_list` 各自的适用场景与代码位置
- 默画出"设备中断 → `common_interrupt` → `irq_desc->action->handler` → `invoke_softirq`"的调用链
- 说出 hrtimer 与 timer_list 的分工：谁的到期在红黑树、谁的到期在时间轮、谁在管周期 tick
- 读懂 `/proc/interrupts`、`/proc/softirqs`、`/proc/timer_list` 三个运行态文件的行列语义，并与源码字段互证
- 用 ftrace 的 irq/softirq 事件与 `/proc` 计数互相印证，把源码读成动态现场
- 避开 tasklet 弃用、irqbalance 打架、NOHZ 盲开、`CLK_TCK` 误当 HZ 等高频误区

## 1. 中断为什么是内核的节拍器

### 1.1 异步事件的统一入口

CPU 只会埋头执行指令流，外设的"我有一包数据"全靠一根电信号打断它——这就是硬件中断。内核必须在极短时间内（微秒级）响应，否则丢包、丢键、丢时钟节拍。与中断相对的是**异常**（除零、缺页，指令流内同步发生）与**系统调用**（`int 0x80`/`syscall` 指令主动陷入），三者共用 IDT 中断描述表这套分发机制，但来源与语义不同：中断是异步的硬件打断，异常是同步的指令出错，系统调用是同步的主动请求——[系统调用章](./syscall-path.md)讲第三种，本页专讲第一种。同一套机制还管核间通信：`/proc/interrupts` 尾部的 `RES`（唤起调度）、`CAL`（函数调用）、`TLB`（刷新页表）各行就是 CPU 之间互相打的核间中断（IPI），"那个核的活干完了你来看一眼"也是中断。

### 1.2 上半部与下半部的经济学

中断处理的第一纪律是：**中断上下文不能睡眠**。进程被调度走时上下文可以丢弃重来，中断没有自己的"进程"可言——它打断谁就借谁的栈运行，睡下去就没人能把它叫醒。于是 Linux 把处理一分为二：

- **上半部（hardirq）**：关中断或至少不可抢占的窗口内，只做"最要紧的三件事"——应答中断控制器（不回应下次中断就不来了）、读硬件状态寄存器把数据捞出来（不清中断源硬件会反复打）、把"剩下的贵活"打包挂到下半部。时间预算以微秒计。
- **下半部（softirq/workqueue）**：中断返回前夕或稍后的安全时机执行，可以做耗时工作。softirq 在**中断返回的同一 CPU 上**跑（延迟低、可并发多实例，但仍是中断上下文不能睡）；workqueue 则交给内核线程（`kworker`），是**进程上下文**，可以睡、可以拿 mutex。

这套二分是理解一切驱动代码 API 选择的钥匙。把两条纪律（能否睡眠、延迟预算）当坐标轴，各机制一眼归位：

| 机制 | 执行上下文 | 典型延迟 | 能否睡眠 | 何时选 |
|------|-----------|---------|---------|--------|
| hardirq 上半部 | 中断上下文 | 微秒 | 否 | 应答硬件、搬运数据 |
| softirq | 中断返回路径 / ksoftirqd | 极低 | 否 | 网络收发、定时器到期等高频低延迟 |
| tasklet（弃用中） | softirq 之上 | 低 | 否 | 仅存量代码维护 |
| threaded irq | 内核线程（irq/N-名） | 中 | 是 | 上半部稍重、要拿 mutex |
| workqueue | kworker 线程 | 中 | 是 | 默认选择、延迟回调 |
| timer_list 时间轮 | TIMER_SOFTIRQ 收割 | 1 jiffy 级 | 否 | 粗粒度延后执行 |
| hrtimer | 中断 / HRTIMER_SOFTIRQ | 纳秒级 | 否 | 精确超时、nanosleep |

老代码里大量出现的 tasklet 正处在历史转折点——`include/linux/interrupt.h` 的注释已把它标记为**不推荐新代码使用**（老书的 tasklet 优先叙述过时了，见第 6 节），现代推荐是 threaded irq（`request_threaded_irq`，把上半部也放到可睡眠线程）或直接 workqueue。与包管理"先装依赖再装本体"的分层同理：中断体系的分层不是功能堆叠，而是**按约束分级**——每层的自由度（能不能睡、能不能被嵌套打断）决定了它能承担什么活。

## 2. 核心数据结构

### 2.1 `irq_desc`：一条中断线的档案

每条中断线（IRQ 编号）一份档案，定义在 `include/linux/irqdesc.h`：

```c
struct irq_desc {
    struct irq_common_data   irq_common_data;  // 共享属性
    struct irq_data          irq_data;         // 芯片层：irqchip/中断号/hwirq
    struct irqstat __percpu *kstat_irqs;       // ★ per-CPU 计数（/proc/interrupts 的列）
    irq_flow_handler_t       handle_irq;       // 流控处理（边沿/电平/速率限流）
    struct irqaction        *action;           /* ★ IRQ action list：驱动注册的 handler 链 */
    unsigned int             depth;            // 嵌套 disable 计数
    raw_spinlock_t           lock;
    const char              *name;
    /* wake_depth/tot_count/threads_* 等字段略；CONFIG_SPARSE_IRQ 下另有 rcu/kobj */
};
```

两层结构值得停下来看：`handle_irq` 是**中断控制器厂商无关**的流控层（level/edge 怎么应答），`action` 链表是**驱动注册**的业务层——一条 IRQ 可挂多个共享 handler（`IRQF_SHARED`），遍历链表直到某个 handler 认领。`/proc/interrupts` 的每行就是一个 `irq_desc`：行首中断号，中间每列是 `irq_desc_kstat_cpu(desc, cpu)` 的 per-CPU 计数，尾列是芯片名与触发方式（`IO-APIC 1-edge`）再加 handler 名（`action->name`，共享时逗号并列多个）。打印由 `fs/proc/interrupts.c` 注册、`kernel/irq/proc.c` 的 `show_interrupts` 执行——源码字段与 proc 输出逐列对得上，这是本页最好的"先看输出再读码"入口。

### 2.2 `softirq_vec[]`：十个编号槽位

softirq 不是"动态注册的队列"，而是**编译期定死的十个编号槽**，定义在 `include/linux/interrupt.h` 的枚举里（v6.12 顺序）：

```text
HI_SOFTIRQ=0, TIMER_SOFTIRQ, NET_TX_SOFTIRQ, NET_RX_SOFTIRQ, BLOCK_SOFTIRQ,
IRQ_POLL_SOFTIRQ, TASKLET_SOFTIRQ, SCHED_SOFTIRQ, HRTIMER_SOFTIRQ, RCU_SOFTIRQ
```

`kernel/softirq.c` 里一个 `static struct softirq_action softirq_vec[NR_SOFTIRQS]` 数组按下标挂回调。这个"编号即 ABI"的设计有两重含义：其一，`/proc/softirqs` 的十行（HI 到 RCU）由 `softirq_to_name[]` 逐槽位翻译、`fs/proc/softirqs.c` 的 `show_softirqs` 打印，行序与枚举完全一致——读那份输出时每个数字都对应一个槽位的累计执行次数；其二，新增 softirq 要改内核头文件，所以社区宁可把新机制塞进 workqueue——`TASKLET_SOFTIRQ`（tasklet 专用）与 `SCHED_SOFTIRQ`（负载均衡专用，回调是 `kernel/sched/fair.c` 的 `sched_balance_softirq`，承接周期负载均衡与 NOHZ 空闲核均衡）各自占一个独立槽位，正是历史沉积。

### 2.3 `work_struct`：可睡眠的下半部容器

```c
struct work_struct {
    atomic_long_t   data;
    struct list_head entry;
    work_func_t     func;   // 要执行的回调
};
```

三行主干（`include/linux/workqueue.h`），语义是"一个待办项"：`INIT_WORK` 填 func，`queue_work(wq, work)` 挂进某个 workqueue 的待办链，内核 worker 线程（`kworker/0:1` 这类名字，`kernel/workqueue.c`）醒来在**进程上下文**执行它——于是 `mutex_lock`、`kmalloc(GFP_KERNEL)`、甚至主动调度都合法。与 softirq 的取舍一句话：**同 CPU 低延迟用 softirq，能睡能排队用 workqueue**；驱动初始化、延迟回调、几乎一切现代下半部，答案都是 workqueue。设计文档在源码树 `Documentation/core-api/workqueue.rst`（含 `WQ_UNBOUND`/`WQ_MEM_RECLAIM` 等标志的语义），是一手权威。

### 2.4 `hrtimer`：纳秒精度的闹钟

```c
struct hrtimer {
    struct timerqueue_node   node;      // 内嵌 rb 节点，按到期时间键控
    ktime_t                  _softexpires; // 允许提前触发的余量
    enum hrtimer_restart   (*function)(struct hrtimer *);
    struct hrtimer_clock_base *base;    // 所属时钟基
    u8 state;                           // INACTIVE/QUEUED/CALLBACK...
    u8 is_rel;                          // 相对时间模式
    u8 is_soft;                         // 软化：跑在 HRTIMER_SOFTIRQ 里
    u8 is_hard;                         // 硬化：强制硬中断上下文
};
```

（`include/linux/hrtimer_types.h`，v6.12 从 hrtimer.h 拆出。）每个 CPU 每个时钟基（MONOTONIC/REALTIME/BOOTTIME 等）一棵红黑树（`base->active`，`struct timerqueue_head`），`hrtimer_start` 插树 `O(log n)`，到期事件由 clock_event_device 触发 `hrtimer_interrupt`（高精度模式）收割。`CONFIG_HIGH_RES_TIMERS=y` 的发行版内核里，`nanosleep`、poll/select/epoll 超时、POSIX 定时器、`setitimer` 间隔定时、TCP 的发送 pacing 与压缩 ACK 都落在 hrtimer 上——用户态每个 `sleep` 的后台就是它。但 hrtimer 并未通吃：`delayed_work` 内嵌的是 `timer_list`，TCP 的重传/延迟确认/保活也还是 `timer_list`（`tcp_timer.c` 里两类定时器在同一套接字上并存）——这正是"精度需求"的分界线，见 2.6。

### 2.5 clocksource 与 clock_event_device：读表与闹钟

时间子系统的两个抽象分工明确（`kernel/time/clocksource.c` 与 `kernel/time/tick-common.c` 一带）：**clocksource** 回答"现在几点"——只管单调递增地读（TSC、acpi_pm、arch_counter）；**clock_event_device** 回答"到点叫我"——只管在指定时刻触发一次中断（oneshot/periodic 能力，每 CPU 一个 tick device）。`tick-sched.c` 拿这两个零件拼出周期 tick（HZ 分频）与 NOHZ（空闲 CPU 停表），详见 3.4 节。把它们想成"手表"与"闹钟"：看时间不需要响铃，定闹钟不需要天天读——分开抽象后，虚拟化场景只需虚拟 TSC 与虚拟 APIC timer 两件事就能撑起整个客户机时间体系（`/proc/timer_list` 头部直接打印当前 clocksource 与精度）。

### 2.6 `timer_list` 与时间轮：jiffies 级闹钟

```c
struct timer_list {
    struct hlist_node entry;    // 挂进时间轮某个桶的链
    unsigned long     expires;  // 到期时刻，单位 jiffy
    void            (*function)(struct timer_list *);
    u32               flags;    // TIMER_DEFERRABLE / TIMER_IRQSAFE / TIMER_PINNED
};
```

（`include/linux/timer_types.h`。）`add_timer`/`mod_timer` 把它挂进 per-CPU 的 `timer_base`，到期由 `TIMER_SOFTIRQ` 收割（路径见 3.5）。存放结构不是一棵树而是**时间轮**（timer wheel，`kernel/time/timer.c`，文件头注释值得通读）：`LVL_DEPTH` 层（HZ>100 时 9 层，否则 8 层）× 每层 `LVL_SIZE`=64 个桶；每层有自己的时钟，第 n 层粒度是 `LVL_CLK_DIV^n`（即 8^n）个 jiffy，时钟频率是 `HZ / 8^n`。**到期越远的定时器放越高层、桶粒度越粗**——近处的精确定位，远处的哈希粗放。注释里专门强调：现代实现**去掉了经典 wheel 的级联下坠（recascading）**——高层按自己的慢时钟独立扫描，天然接受秒级以上的粗粒度误差。收益是 `add_timer`/`del_timer` 都是 O(1) 的桶操作，代价是远期定时器只保证"那一层的粒度内"到期。jiffies 本身就是 `kernel/time/timer.c` 里的 `u64 jiffies_64`（`INITIAL_JIFFIES` 起），每次 tick 加一。

## 3. 关键函数调用路径

### 3.1 中断上半部（设备 → handler）

```text
设备拉中断线 → APIC/中断控制器 → IDT 向量
  → arch/x86/entry/entry_64.S（共同入口，切换特权栈）
  → common_interrupt（arch/x86/kernel/irq.c，DEFINE_IDTENTRY_IRQ 定义）
  → call_irq_handler（按向量找 irq_desc）
  → irq_desc->handle_irq（流控层：edge/level 应答）
  → irq_desc->action->handler（驱动注册的上半部，遍历链表直到认领）
  → IRQ_HANDLED / IRQ_NONE
  → irq_exit_rcu → __irq_exit_rcu → invoke_softirq()
       ├─ 本 CPU 中断栈上且有 pending → __do_softirq()（立即执行）
       └─ 否则 → wakeup_softirqd()（唤醒 ksoftirqd/N 稍后执行）
```

一个必须点破的版本事实：**老书里的 `do_IRQ` 在 x86-64 已不存在**（6.12 源码已核对），入口函数名是 `common_interrupt`（`DEFINE_IDTENTRY_IRQ(common_interrupt)`），向下经 `call_irq_handler` → `handle_irq` 到通用层的 `generic_handle_irq_desc`（一行就是 `desc->handle_irq(desc)`）——架构层薄化、通用层承接是这十余年的主线。而"什么时候执行 softirq"的答案在 `irq_exit_rcu` 尾巴上：`invoke_softirq()` 判断 `!in_interrupt() && local_softirq_pending()` 决定当场跑还是唤 `ksoftirqd`——RT 内核或嵌套过深时交给内核线程，宁可晚一点也不在中断嵌套里再开一层。驱动若要在处理里拿 mutex，注册时用 `request_threaded_irq(irq, handler, thread_fn, flags, name, dev)`——`handler` 只做应答与返回 `IRQ_WAKE_THREAD`，`thread_fn` 跑在内核线程里（`ps -e | grep '^.*irq/'` 可见 `irq/41-virtio` 这类线程），上下文可睡。

### 3.2 softirq 执行体：预算制的 `__do_softirq`

```text
__do_softirq()                    // kernel/softirq.c 的对外入口
  → handle_softirqs(false)        // 真正的预算循环
      pending = local_softirq_pending()   // 快照本轮要跑哪些槽位
      循环：清 pending → 逐槽位 softirq_vec[i].action(&vec[i])
      预算：耗时 2ms（MAX_SOFTIRQ_TIME = msecs_to_jiffies(2)）
            或 10 轮重启（MAX_SOFTIRQ_RESTART = 10）
      超预算 → wakeup_softirqd()  // 贵活移交 ksoftirqd，防止软中断饿死进程
```

两个宏值都是硬编码纪律：softirq 允许"最多 10 轮、最多 2 毫秒"，超了就把剩余工作甩给每 CPU 的 `ksoftirqd/%u` 内核线程（`kernel/softirq.c` 中 `DEFINE_PER_CPU(struct task_struct *, ksoftirqd)`）。这解释了一个运维现象：极端网络流量下 `ksoftirqd/0` 的 CPU 占用会飙高——它是在替被预算踢出来的 softirq 加班。每个 softirq 槽位回调都可以在多 CPU 上**并发执行**（不像单队列 work 那样串行），这是 NET_RX 能吃满多核的机制基础，也是写下半部代码必须自备自旋锁的原因。

### 3.3 workqueue 路：入队到 kworker

```text
INIT_WORK(&w, func) / PREPARE_WORK
  → queue_work(system_wq, &w)          // 选队列：system / unbound / highpri
  → __queue_work()                     // 按 CPU/优先级挂进 pool->worklist
  → 唤醒该 pool 的 worker 线程（kworker/N:H）
  → process_scheduled_works()
  → w->func(w)                         // 进程上下文执行，可睡眠
```

`system_wq`（`events/`）、`system_highpri_wq`、`system_unbound_wq` 等内置队列覆盖九成场景；`schedule_delayed_work` 则把工作挂进 `struct delayed_work` **内嵌的 `timer_list`**，到点经时间轮回调再入队（又一次 2.6 的分界线：延迟入队用粗粒度足够）。与 softirq 的对比在 2.3 节已给：这里每一步都发生在可调度的线程里，所以队列满、要等锁、要做 IO 都没问题——代价是调度延迟（微秒到毫秒级）。

### 3.4 hrtimer 与 tick/NOHZ

```text
hrtimer_start(&timer, expires, mode)          // 插入 base->active 红黑树
  → 若最近到期时间被提前 → clock_event_device 编程一发中断
  → 中断到来 → hrtimer_interrupt()            // 高精度时钟事件处理
  → __hrtimer_run_queues()                    // 扫到期者
  → __run_hrtimer()                           // 摘树 → 放锁 → 调 fn → 按返回值重插
       fn 返回 HRTIMER_RESTART → timerqueue_add 重新排队
```

高精度关闭或未启用时另有兜底：`hrtimer_run_queues()` 挂在周期 tick 路径上代扫（函数开头 `hrtimer_hres_active()` 为真就直接 `return`——高精度开着时它不干活）。周期 tick 那条腿则由 `update_process_times` 领跑：`account_process_tick` 记账 → `run_local_timers()`（先顺带跑 `hrtimer_run_queues`，再按需 raise TIMER_SOFTIRQ）→ `sched_tick()` 调度记账（[进程管理章](./process-scheduling.md)）→ `run_posix_cpu_timers`。NOHZ（无周期 tick）模式下，周期 tick 本身就是用一个 hrtimer 实现的——`tick-sched.c` 的 `tick_nohz_handler` 签名就是 `enum hrtimer_restart (*)(struct hrtimer *)`，"下一拍"就是改这个 hrtimer 的到期时间；`NOHZ_IDLE` 让空闲 CPU 停表省电（发行版默认开，无需你做任何事），`NOHZ_FULL` 连忙碌 CPU 的 tick 也关（面向超低延迟场景，需要 `isolcpus`、cpuset、用户态轮询全套配合，日常开了反而是给自己挖坑）。

### 3.5 时间轮到期路径

```text
挂入（驱动/子系统）：
  add_timer(&t) / mod_timer(&t, expires)
    → internal_add_timer(base, timer)   // 按 expires 距今远近选层选桶，O(1)

到期（每 CPU）：
  周期 tick → update_process_times → run_local_timers()
      → 有 pending 定时器 → raise TIMER_SOFTIRQ
  → run_timer_softirq()                  // 注册点：open_softirq(TIMER_SOFTIRQ, run_timer_softirq)
      → run_timer_base(BASE_LOCAL/GLOBAL/DEF)   // NOHZ 下 local/global/deferrable 三套轮
      → __run_timers(base)               // 只扫"本层时钟已推进"的层
      → expire_timers(base, heads + levels)
      → call_timer_fn(timer, fn, baseclk)   // 关中断调 function()；DEFERRABLE 不唤醒空闲 CPU
```

注意两处细节：`run_local_timers` **按需** raise（`timer_base::next_expiry` 没到就不打软中断，白扫是浪费）；NOHZ 配置下一个 CPU 有 `BASE_LOCAL`/`BASE_GLOBAL`/`BASE_DEF` 三套轮（可迁移、不可迁移、可延迟唤醒各归其位），`run_timer_softirq` 依次跑三套。时间轮回调与 hrtimer 同纪律：中断上下文、不能睡，重活转手 workqueue。

## 4. 源码阅读顺序

给一条从短到长、每步注明"跳过什么"的路线：

1. **`kernel/softirq.c` 的 `handle_softirqs` 与 `__do_softirq`**（全篇心脏，约百行量级）：先建立"预算制 + 槽位分发"的心智模型，这是下半部的总调度台。跳过 RT 分支与热插拔代码。
2. **`include/linux/interrupt.h` 当字典**：`request_irq`/`request_threaded_irq` 的签名、`IRQF_*` 标志语义表（6.12 确认的完整集合：`IRQF_SHARED`、`IRQF_ONESHOT`、`IRQF_NO_THREAD`、`IRQF_PERCPU`、`IRQF_NOBALANCING`、`IRQF_NO_AUTOEN` 等——注意**没有任何形如 `IRQF_RAISE_SOFTIRQ` 的标志**，驱动提升 softirq 是直接调 `raise_softirq()`，NAPI 收包正是 `napi_schedule` → `raise_softirq(NET_RX_SOFTIRQ)` 这条明路）。不顺序读，按需查。
3. **`kernel/time/timer.c` 头部 150 行**：时间轮设计注释全文 + `internal_add_timer` 的选层选桶逻辑——整棵轮盘的说明书，比任何二手文章都短都准。
4. **`kernel/time/hrtimer.c` 的 `__run_hrtimer`**（短函数，摘锁-调回调-重插三段式干净利落），顺流而下看 `__hrtimer_run_queues` 的到期扫描；再回头读 `include/linux/hrtimer.h` 里 `hrtimer_init` 的模式参数（`HRTIMER_MODE_ABS/REL/HARD/SOFT`）。
5. **`kernel/workqueue.c` 只读入队侧**：`queue_work` → `__queue_work` 的选池与唤醒逻辑。跳过 worker 池管理、WQ_SYSFS、所有调试宏——那是另一本书的厚度。
6. **`arch/x86/kernel/irq.c` 的 `common_interrupt`**（看 `DEFINE_IDTENTRY_IRQ` 宏展开前后各一遍），顺着 `call_irq_handler` 走到通用层——架构相关与通用层的边界线在此看清。
7. 运行态三件套全程对照：`/proc/interrupts`（irq_desc 计数）、`/proc/softirqs`（槽位分账）、`/proc/timer_list`（hrtimer 在册清单）——**每读一个字段就去 proc 里找它的影子**，这是本章"源码↔现场"互证的支点。

## 5. 实操跟踪

六个实验，从计数器到事件流逐级深入（ftrace 操作细节见[跟踪工具](./tracing-tools.md)，此处只给本章专属的观测点）。以下终端块取自一台 14 核 x86-64、`CONFIG_HZ=1000`、`CONFIG_HIGH_RES_TIMERS=y` 的机器，列做过截断：

**实验一：让 `/proc/interrupts` 动起来。** 记下网卡中断行的计数，跑一段流量（`ping -f` 网关或对内网机器持续 `curl` 下载），再 `grep eth /proc/interrupts`——NAPI 聚合下通常批量增长。行尾的 IPI 各行也在动：`RES`（重调度）、`CAL`（跨核函数调用）、`TLB`（页表 shootdown）、`LOC`（本地 APIC 定时器，也就是周期 tick 的硬件源头）。判读要点：列数=CPU 数；单列独涨说明该队列没开多队列或亲和性没散开（与 `irqbalance` 的话题见第 6 节）。

```text
$ cat /proc/interrupts
           CPU0       CPU1       CPU2       CPU3
  1:          0          0          0          0  IO-APIC   1-edge      i8042
 19:         27          0          0          0  IO-APIC  19-edge      ehci_hcd:usb2, ehci_hcd:usb3
LOC:   14474763   14468385   14453656   14610204  Local timer interrupts
RES:     155722     166836     161109     158102  Rescheduling interrupts
TLB:    1910663    1899037    1857732    1863226  TLB shootdowns
```

**实验二：`/proc/softirqs` 的分账对上动作。** 前后各取一次：跑 `ping` 看 `NET_RX` 涨、开几百条 `while :; do sleep 0.01; done` 看 `TIMER` 涨、写大文件看 `BLOCK` 涨——每个实验只放大一个槽位，把 2.2 节的编号表变成肌肉记忆。十行之外**没有**汇总行，要总量自己横着加。

```text
$ cat /proc/softirqs
                CPU0      CPU1      CPU2      CPU3
HI:               0         1         6         1
TIMER:       464256    283595    262235    281986   ← 时间轮 run_timer_softirq
NET_TX:          32        30        19        18
NET_RX:      236429    227150    194928    186549   ← 收包（NAPI → raise_softirq）
BLOCK:            1         0         0         0
TASKLET:         94         1        15         2
SCHED:      4392984   1669826    820101    564867   ← 负载均衡 sched_balance_softirq
HRTIMER:          0         0         0         0
RCU:        2294411   2274130   2287550   2294800
```

**实验三：`/proc/timer_list` 看见 hrtimer。** `sudo cat /proc/timer_list | head -40`：头部是当前时间基与精度（`.resolution: 1 nsecs`——高精度在工作的直接证据），下面每个 `# expires at` 就是一个在册 hrtimer，区间两端正是 `_softexpires` 与硬到期（源码 2.4 的字段在输出里具象化）。最能说明问题的是 `tick_nohz_handler` 那一项——周期 tick 自己就是个 hrtimer（3.4 的结论肉眼可见）：

```text
Timer List Version: v0.10
HRTIMER_MAX_CLOCK_BASES: 8
now at 15882606768126 nsecs

cpu: 0
 clock 0:
  .index:      0
  .resolution: 1 nsecs
active timers:
 #0: <...>, hrtimer_wakeup, S:01
 # expires at 15882607122972-15882607172972 nsecs [in 354846 to 404846 nsecs]
 #1: <...>, tick_nohz_handler, S:01
 # expires at 15882608000000-15882608000000 nsecs [in 1231874 to 1231874 nsecs]
```

`hrtimer_wakeup` 是 `nanosleep` 一族的标准回调——开一个 `sleep 3600` 的 shell 再看，能捕捉到属于它的到期项。

**实验四：ftrace 抓 irq/softirq 事件流。** 低开销的事件点比 function tracer 更适合看中断。注意 v6.12 起 softirq 事件挂在 `events/irq/` 组下（`include/trace/events/irq.h` 同一个 TRACE_SYSTEM），不是独立的 `events/softirq/` 目录：

```bash
# 事件级跟踪（开销远低于 function tracer）
$ sudo sh -c 'echo 1 > /sys/kernel/tracing/events/irq/irq_handler_entry/enable'
$ sudo sh -c 'echo 1 > /sys/kernel/tracing/events/irq/softirq_entry/enable'
$ sudo sh -c 'echo 1 > /sys/kernel/tracing/events/irq/softirq_raise/enable'
$ ping -c 5 127.0.0.1 > /dev/null
$ sudo grep -m4 'NET_RX' /sys/kernel/tracing/trace
            ping-887859  [013] D..1. 16907.951252: softirq_raise: vec=3 [action=NET_RX]
            ping-887859  [013] ..s1. 16907.951253: softirq_entry: vec=3 [action=NET_RX]
$ sudo grep -m2 'irq_handler_entry' /sys/kernel/tracing/trace
           rustc-887518  [010] d.h.. 16907.943956: irq_handler_entry: irq=41 name=virtio2-request
# 用完记得关掉，或 echo 0 逐项关闭
$ sudo sh -c 'echo 0 > /sys/kernel/tracing/events/irq/irq_handler_entry/enable; \
              echo 0 > /sys/kernel/tracing/events/irq/softirq_entry/enable; \
              echo 0 > /sys/kernel/tracing/events/irq/softirq_raise/enable; echo > /sys/kernel/tracing/trace'
```

三处咬合：`vec=3` 正是 2.2 枚举下标（3=`NET_RX_SOFTIRQ`）；`raise` 到 `entry` 相差 1 微秒（提出到执行的延迟）；`irq_handler_entry irq=41 name=virtio2-request` 的名字与 `/proc/interrupts` 同源（都是 `action->name`）。TASK-PID 后那串 `d.h..`/`..s1.` 是 trace-flag 列（`d`=关中断、`h`=硬中断运行中、`s`=软中断运行中、数字=抢占深度，完整语义见 `Documentation/trace/ftrace.rst`）——`raise` 发生在 `D..1.`（进程上下文关中断提软中断）而 `entry` 在 `..s1.`（软中断上下文执行），上下文切换肉眼可见。

**实验五：workqueue 的进程面孔。** `ps -e | grep kworker` 列出所有 worker（`kworker/0:1` 中的 `0` 是 CPU、`1` 是池内编号，H 结尾为高优先级池）；观察一个会大量 `queue_work` 的动作（如 `echo 1 > /proc/sys/vm/drop_caches` 触发的回收工作）前后 kworker 的 `TIME` 增量。要顺手验证 3.3 节，开 `events/workqueue/workqueue_execute_start` 事件，或 `sudo bpftrace -e 'kprobe:process_one_work { @[comm] = count(); }'` 看谁在排工单。

**实验六：核对本机的 HZ 与高精度开关。** 这是后面一切"延迟语义"的底数：

```bash
$ getconf CLK_TCK          # 100 —— 这是 USER_HZ（用户态 ABI），不是内核 HZ！
100
$ grep -E 'CONFIG_HZ=|CONFIG_HIGH_RES' /boot/config-$(uname -r)
CONFIG_HIGH_RES_TIMERS=y
CONFIG_HZ_1000=y
CONFIG_HZ=1000
```

`/boot/config-$(uname -r)` 不存在时（部分发行版）改用 `zcat /proc/config.gz | grep CONFIG_HZ=`。HZ=1000 意味着一拍 1ms——时间轮最细粒度也就是 1ms，第 6 节第一个坑由此而来。

## 6. 常见坑

**把 `msleep(1)`/`queue_delayed_work(wq, &w, 1)` 当精确毫秒。** 症状：实测延迟 1-20ms 不等，偶尔"睡 1ms 醒来用了 15ms"。根因是这些 API 走时间轮，粒度=1 jiffy（HZ=250 时 4ms）且到期按桶对齐、允许粗放；对齐点错过就是两拍。要确定性的短延迟必须走 hrtimer 系：`usleep_range()`、`schedule_hr_timeout()`、`hrtimer_nanosleep()` 一族。选型口诀回到 1.2 的表：**精度看 hrtimer，粗活看时间轮**。

**照老书写 tasklet。** 症状：从《LKD》《情景分析》等书抄 `tasklet_init` 被 review 打回，或看到 `tasklet_schedule` 判定"这是老代码"。tasklet 体系（`HI_SOFTIRQ`/`TASKLET_SOFTIRQ` 两槽）功能仍在但**已不推荐新代码使用**，现代替代按需二选一：必须极低延迟 → `request_threaded_irq` 的 threaded 模式（上半部只做唤醒，重活在可睡眠的 IRQ 线程）；一般下半部 → `queue_work`/`system_wq`。读老书时把 tasklet 自动翻译成"当年的轻量下半部"即可，机制思想仍然成立。

**中断上下文里睡了。** 症状：加载模块即 `BUG: scheduling while atomic`，或偶发死锁难复现。根因是在 softirq/中断上下文（时间轮回调、hrtimer 回调同罪）调用了会睡眠的原语——`mutex_lock`、`GFP_KERNEL` 的 `kmalloc`、`msleep` 都是禁区。纪律：中断相关代码里 `printk` 可以、`kmalloc(GFP_ATOMIC)` 可以、锁只能自旋锁；拿不准就搬 workqueue，让代码回到进程上下文。这是一整类驱动 bug 的总开关，理解了"上下文决定原语"，看什么都通透。

**irq 手工绑核与 irqbalance 打架。** 症状：`/etc/default/irqbalance` 里没禁用、`smp_affinity` 却写了静态值，结果亲和性被周期性改回。两者谁赢取决于时序，表现为中断分布"设了又漂"。处置顺序：先决定策略——要静态分布就 `systemctl disable --now irqbalance` 再写 `smp_affinity`；要动态负载均衡就交给 irqbalance 别碰 procfs。多队列网卡（每队列一个 irq）+ irqbalance 是默认最佳解，手工绑核只在 NUMA 亲和优化这类有明确测量支撑的场景才值得。

**hrtimer 回调里干慢活。** 症状：系统时钟抖动、`watchdog: BUG: soft lockup`，或 trace 里 `hrtimer_expire_entry` 到 `exit` 间隔异常。hrtimer 回调与 softirq 同纪律——默认在中断上下文跑（`is_soft` 的软化 hrtimer 也只到 softirq 级），耗时工作必须 `queue_work` 转手。判断口诀与 1.2 节一致：回调里只做"标记与转交"，不做"计算与等待"。

**盲目开 NOHZ_FULL。** 症状：照抄低延迟指南改 `nohz_full=` 后效果不彰甚至更差。NOHZ_FULL 要求内核把一切杂活（RCU 回调、定时器迁移）赶出受保护 CPU，需要应用侧 `isolcpus`、cpuset、用户态轮询全套配合；收益只在微秒级尾延迟敏感场景。默认的 NOHZ_IDLE 已经免费拿到大头，没做过延迟测量就别碰另一半。

**`getconf CLK_TCK` 当成内核 HZ。** 症状：按 1000 拍做的延迟换算全错一位。`CLK_TCK` 是 POSIX 用户态 ABI（恒 100，即 `USER_HZ`），与本机内核 HZ（250/300/1000 常见）无关——实验六那台机器前者 100 后者 1000。内核 HZ 只能从 `/boot/config-$(uname -r)` 或 `/proc/config.gz` 的 `CONFIG_HZ=` 读，虚拟机还要意识到宿主机可能偷走 tick（`/proc/interrupts` 的 `HYP` 行是宿主回调的痕迹）。

**`/proc/interrupts` 多列看串行。** 症状：拿单列数字当全局总量判断"中断太多/太少"。列数=逻辑 CPU 数，每列是该 CPU 的计数——判断分布看行内各列是否均衡（多队列网卡应大致均匀），判断总量才横向求和。另注意虚拟机与物理机的计数语义有差异（vCPU 的中断来自宿主机注入），跨环境对比要先说明口径。

## 7. 延伸资料

按主题配书（书目真实、按实标注，各书基于 2.4-2.6 时代，机制思想可贵、函数名以现源码为准）：

- **中断体系与下半部**：Robert Love《Linux内核设计与实现》中断处理与下半部/推后执行相关章——经典叙述，但 tasklet 章节需按第 6 节更新认知
- **时间管理**：同书时间管理章（jiffies/timer_list 视角），hrtimer 细节以 `kernel/time/hrtimer.c` 与本页 3.4 节为准
- **中断控制器与流程细节**：Bovet & Cesati《深入理解Linux内核》中断相关章（x86 APIC 硬件到软件的桥讲得细，2.6 时代仍有硬件参考价值）
- **时间轮与情景走读**：毛德操、胡希明《Linux内核源代码情景分析》时钟与定时器情景——老 wheel（有级联）与现代实现的差异恰是理解设计演进的活教材，对照 `kernel/time/timer.c` 头注释读
- **workqueue 设计**：源码树 `Documentation/core-api/workqueue.rst`（Tejun Heo 所作，一手权威）
- **ftrace 事件与 trace-flag**：源码树 `Documentation/trace/ftrace.rst`（本页实验四的输出格式说明书）
- **一手源码**：[elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/source/) 在线交叉引用——本页函数名均按 v6.12 核对（`common_interrupt` 替代 `do_IRQ`、`handle_softirqs` 承担预算循环、`__run_hrtimer` 执行单个到期项、`internal_add_timer` 选层入轮）
- **现场观测**：[跟踪工具](./tracing-tools.md) 的 ftrace/bpftrace 章节——本页实验四、五的工具细节

## 参考资料

- 内核官方文档 — [docs.kernel.org](https://docs.kernel.org/)
- Workqueue 设计文档（树内） — `Documentation/core-api/workqueue.rst`
- ftrace 用户指南（树内） — `Documentation/trace/ftrace.rst`
- 在线源码交叉引用（v6.12） — [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/source/)
- Robert Love.《Linux内核设计与实现》（Linux Kernel Development, 3rd ed.）
- Daniel P. Bovet & Marco Cesati.《深入理解Linux内核》（Understanding the Linux Kernel, 3rd ed.）
- 毛德操、胡希明.《Linux内核源代码情景分析》
- Wolfgang Mauerer.《深入Linux内核架构》（Professional Linux Kernel Architecture）
