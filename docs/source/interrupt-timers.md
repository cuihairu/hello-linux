# Interrupts and Timers

In the source of the process, memory, and filesystem subsystems, the protagonist is always "the task being asked to do something"; interrupts and timers are the opposite -- they study **when the kernel gets the chance to work at all**: a packet arrives at the NIC, a disk sector finishes reading, the time slice runs out and it is time to switch tasks, a delay function expires. Every one of these depends on the interrupt machinery hauling the kernel out of sleep. This also determines the character of the code: everywhere you meet the "must not sleep" constraint and the tradeoff of "defer the expensive work".
This page follows the unified skeleton -- first recognize the six core data structures (`irq_desc`, the softirq slots, `work_struct`, `hrtimer`, clocksource/clock_event_device, and the `timer_list` timer wheel), then walk through five call paths (the interrupt top half, the softirq executor, the workqueue, hrtimer with tick/NOHZ, and timer wheel expiry), then give the source reading order and six hands-on tracing experiments, and finally the common pitfalls and further reading.
Tool details (how to use ftrace/bpftrace) are in [Tracing Tools](./tracing-tools.md); this page only covers the mechanism being observed itself.

> Content draws on the kernel source tree (v6.12) and the real books listed below (conceptual framework); see the references at the end. Every function name, structure field, and trace event path on this page was checked against v6.12 source, and the terminal output is real samples from a 14-core x86-64 machine.

## What This Part Covers

- Explain the economic boundary between top half and bottom half
- Recognize what `irq_desc`, `softirq_vec`, `work_struct`, `hrtimer`, and `timer_list` are each for, and where in the code they live
- Draw the call chain "device interrupt → `common_interrupt` → `irq_desc->action->handler` → `invoke_softirq`" from memory
- State the division of labor between hrtimer and timer_list: whose expiry lives in a red-black tree, whose in the timer wheel, and who minds the periodic tick
- Read the row/column semantics of the three runtime files `/proc/interrupts`, `/proc/softirqs`, and `/proc/timer_list`, and cross-check them against source fields
- Corroborate ftrace's irq/softirq events with the `/proc` counters, turning source reading into a live scene
- Avoid the high-frequency mistakes: deprecated tasklets, irqbalance fights, blindly enabling NOHZ, mistaking `CLK_TCK` for HZ

## 1. Why Interrupts Are the Kernel's Metronome

### 1.1 The Unified Entry Point for Asynchronous Events

The CPU will only plow through its instruction stream; a peripheral's "I have a packet of data" gets its attention only via an electrical signal -- that is the hardware interrupt.
The kernel must respond within an extremely short window (microseconds), or packets, keystrokes, and clock ticks get dropped.
The counterpart of the interrupt is the **exception** (divide by zero, page fault -- happening synchronously inside the instruction stream) and the **system call** (`int 0x80`/`syscall` instructions deliberately trapping in).
All three share the IDT interrupt descriptor table dispatch mechanism, but their sources and semantics differ: an interrupt is an asynchronous hardware intrusion, an exception is a synchronous instruction error, and a system call is a deliberate synchronous request.
The [System Call Path](./syscall-path.md) chapter covers the third kind; this page is exclusively about the first.
The same machinery also handles inter-processor communication:
the `RES` (reschedule), `CAL` (call function), and `TLB` (flush page tables) rows at the bottom of `/proc/interrupts` are inter-processor interrupts (IPI) that CPUs send to each other --
"that core finished its work, come take a look" is also an interrupt.

### 1.2 The Economics of Top Half and Bottom Half

The first discipline of interrupt handling is: **interrupt context must not sleep**.
A process's context can be discarded and redone when it is scheduled away; an interrupt has no "process" of its own --
it borrows the stack of whatever it interrupted, and if it goes to sleep, nobody can wake it back up.
So Linux splits handling in two:

- **Top half (hardirq)**: within a window of interrupts disabled or at least non-preemptible, it does only "the three most urgent things" -- acknowledge the interrupt controller (if you do not answer, no next interrupt arrives), read the hardware status register to grab the data (if you do not clear the interrupt source, hardware will keep hammering), and package the "remaining expensive work" onto the bottom half. The time budget is counted in microseconds.
- **Bottom half (softirq/workqueue)**: runs on the verge of the interrupt return or at a later safe moment, and is allowed to take its time. A softirq runs **on the same CPU that is returning from the interrupt** (low latency, multiple instances may run concurrently, but it is still interrupt context and cannot sleep); a workqueue is handed to a kernel thread (`kworker`), which is **process context** -- it may sleep and take a mutex.

This dichotomy is the key to understanding every API choice in driver code.
Take the two disciplines (can it sleep, and what latency budget) as the coordinate axes, and every mechanism falls into place at a glance:

| Mechanism | Execution context | Typical latency | May sleep | When to choose it |
|------|-----------|---------|---------|--------|
| hardirq top half | interrupt context | microseconds | no | acknowledge hardware, move data |
| softirq | interrupt return path / ksoftirqd | extremely low | no | network TX/RX, timer expiry, and other high-frequency low-latency work |
| tasklet (deprecated) | on top of softirq | low | no | maintaining legacy code only |
| threaded irq | kernel thread (`irq/N-name`) | medium | yes | slightly heavier top half that needs a mutex |
| workqueue | kworker thread | medium | yes | the default choice; deferred callbacks |
| `timer_list` timer wheel | reaped by TIMER_SOFTIRQ | ~1 jiffy | no | coarse-grained deferred execution |
| hrtimer | hardirq / HRTIMER_SOFTIRQ | nanoseconds | no | precise timeouts, nanosleep |

The tasklet, which appears all over old code, sits at a historical turning point --
the comments in `include/linux/interrupt.h` have already marked it as **not recommended for new code** (old books lead with tasklets; that emphasis is out of date, see Section 6).
The modern recommendation is the threaded irq (`request_threaded_irq`, which puts even the top half into a sleepable thread) or a workqueue directly.
Just as package management layers "install dependencies before the package itself", the interrupt hierarchy is not a stack of features but a **grading by constraint** --
each layer's degrees of freedom (can it sleep, can it be interrupted by nesting) determine what work it can take on.

## 2. Core Data Structures

### 2.1 `irq_desc`: The Dossier of One Interrupt Line

One dossier per interrupt line (IRQ number), defined in `include/linux/irqdesc.h`:

```c
struct irq_desc {
    struct irq_common_data   irq_common_data;  // shared attributes
    struct irq_data          irq_data;         // chip layer: irqchip/irq number/hwirq
    struct irqstat __percpu *kstat_irqs;       // ★ per-CPU counters (the columns of /proc/interrupts)
    irq_flow_handler_t       handle_irq;       // flow control handler (edge/level/rate limiting)
    struct irqaction        *action;           /* ★ IRQ action list: the handler chain drivers register */
    unsigned int             depth;            // nesting disable counter
    raw_spinlock_t           lock;
    const char              *name;
    /* fields like wake_depth/tot_count/threads_* omitted; CONFIG_SPARSE_IRQ adds rcu/kobj */
};
```

Two layers are worth stopping to look at:
`handle_irq` is the **interrupt-controller-vendor-independent** flow control layer (how level/edge get acknowledged),
while the `action` list is the **driver-registered** business layer --
one IRQ can carry multiple shared handlers (`IRQF_SHARED`), and the chain is walked until some handler claims it.
Every row of `/proc/interrupts` is one `irq_desc`:
the interrupt number at the head of the row, then per-CPU counters from `irq_desc_kstat_cpu(desc, cpu)` in the middle columns,
then the chip name and trigger mode at the tail (`IO-APIC 1-edge`) plus the handler name (`action->name`; when shared, several comma-separated).
The printing is registered by `fs/proc/interrupts.c` and performed by `show_interrupts` in `kernel/irq/proc.c` --
source fields and proc output line up column by column, which makes this page's best "look at the output first, then read the code" entry point.

### 2.2 `softirq_vec[]`: Ten Numbered Slots

A softirq is not a "dynamically registered queue" but **ten numbered slots fixed at compile time**, defined by the enum in `include/linux/interrupt.h` (v6.12 order):

```text
HI_SOFTIRQ=0, TIMER_SOFTIRQ, NET_TX_SOFTIRQ, NET_RX_SOFTIRQ, BLOCK_SOFTIRQ,
IRQ_POLL_SOFTIRQ, TASKLET_SOFTIRQ, SCHED_SOFTIRQ, HRTIMER_SOFTIRQ, RCU_SOFTIRQ
```

In `kernel/softirq.c` a `static struct softirq_action softirq_vec[NR_SOFTIRQS]` array hangs callbacks by index.
This "the number is the ABI" design has two implications.
First, the ten rows of `/proc/softirqs` (HI through RCU) are translated slot by slot by `softirq_to_name[]` and printed by `show_softirqs` in `fs/proc/softirqs.c`, in exactly the order of the enum --
when you read that output, every number is the cumulative execution count of one slot.
Second, adding a softirq means editing a kernel header file, so the community would rather stuff new mechanisms into workqueues.
`TASKLET_SOFTIRQ` (dedicated to tasklets) and `SCHED_SOFTIRQ` (dedicated to load balancing, whose callback is `sched_balance_softirq` in `kernel/sched/fair.c`, taking on periodic load balancing and NOHZ idle-core balancing) each occupy their own separate slot -- a deposit of history.

### 2.3 `work_struct`: The Sleepable Bottom-Half Container

```c
struct work_struct {
    atomic_long_t   data;
    struct list_head entry;
    work_func_t     func;   // the callback to execute
};
```

Three lines of trunk (`include/linux/workqueue.h`), meaning "one to-do item":
`INIT_WORK` fills in `func`, `queue_work(wq, work)` hangs it onto some workqueue's to-do list,
and a kernel worker thread (names like `kworker/0:1`, `kernel/workqueue.c`) wakes up and executes it in **process context** --
so `mutex_lock`, `kmalloc(GFP_KERNEL)`, and even deliberately scheduling are all legal.
The softirq/workqueue tradeoff in one sentence: **same-CPU low latency means softirq; anything that can sleep or queue means workqueue**.
Driver initialization, deferred callbacks, and pretty much every modern bottom half -- the answer is the workqueue.
The design document lives in the source tree as `Documentation/core-api/workqueue.rst` (including the semantics of flags like `WQ_UNBOUND`/`WQ_MEM_RECLAIM`) and is a first-hand authority.

### 2.4 `hrtimer`: A Nanosecond-Precision Alarm Clock

```c
struct hrtimer {
    struct timerqueue_node   node;      // embedded rb node, keyed by expiry time
    ktime_t                  _softexpires; // slack allowed for early firing
    enum hrtimer_restart   (*function)(struct hrtimer *);
    struct hrtimer_clock_base *base;    // the clock base it belongs to
    u8 state;                           // INACTIVE/QUEUED/CALLBACK...
    u8 is_rel;                          // relative-time mode
    u8 is_soft;                         // softened: runs in HRTIMER_SOFTIRQ
    u8 is_hard;                         // hardened: forced into hardirq context
};
```

(`include/linux/hrtimer_types.h`, split out of hrtimer.h as of v6.12.)
Each CPU keeps one red-black tree per clock base (MONOTONIC/REALTIME/BOOTTIME etc.) (`base->active`, a `struct timerqueue_head`);
`hrtimer_start` inserts into the tree in `O(log n)`,
and expiry events are reaped by `hrtimer_interrupt` triggered by the clock_event_device (in high-resolution mode).
On distribution kernels with `CONFIG_HIGH_RES_TIMERS=y`,
`nanosleep`, poll/select/epoll timeouts, POSIX timers, `setitimer` interval timers, and TCP send pacing and delayed ACKs all sit on hrtimers --
the background of every `sleep` you run in user space is this.
But hrtimers do not take everything:
`delayed_work` embeds a `timer_list`, and TCP's retransmit/delayed-ACK/keepalive timers are also `timer_list` (the two kinds of timer coexist on the same socket in `tcp_timer.c`).
That is exactly where the "precision requirement" boundary lies -- see 2.6.

### 2.5 clocksource and clock_eventDevice: Reading the Watch and Setting the Alarm

The time subsystem's two abstractions have a clean division of labor (`kernel/time/clocksource.c` and around `kernel/time/tick-common.c`):
**clocksource** answers "what time is it now" -- it only cares about reading monotonically increasing values (TSC, acpi_pm, arch_counter);
**clock_event_device** answers "wake me when it is time" -- it only cares about firing one interrupt at a specified moment (oneshot/periodic capability; one tick device per CPU).
`tick-sched.c` assembles these two parts into the periodic tick (divided down from HZ) and NOHZ (an idle CPU stops its clock); details in Section 3.4.
Think of them as a "wristwatch" and an "alarm clock":
telling time does not need a ringer, and setting an alarm does not need daily reading.
Once abstracted separately, virtualization only needs a virtual TSC and a virtual APIC timer to support the entire guest's time system
(`/proc/timer_list` prints the current clocksource and its precision right at the top).

### 2.6 `timer_list` and the Timer Wheel: jiffy-Granularity Alarms

```c
struct timer_list {
    struct hlist_node entry;    // chain link into some bucket of the timer wheel
    unsigned long     expires;  // expiry moment, in jiffies
    void            (*function)(struct timer_list *);
    u32               flags;    // TIMER_DEFERRABLE / TIMER_IRQSAFE / TIMER_PINNED
};
```

(`include/linux/timer_types.h`.)
`add_timer`/`mod_timer` hang it into the per-CPU `timer_base`, and expiry is reaped by `TIMER_SOFTIRQ` (the path is in Section 3.5).
The structure holding them is not a tree but a **timer wheel** (`kernel/time/timer.c`; the file-head comment is worth reading end to end):
`LVL_DEPTH` levels (9 levels when HZ>100, otherwise 8) × `LVL_SIZE`=64 buckets per level;
each level has its own clock, the granularity of level n is `LVL_CLK_DIV^n` jiffies (i.e. 8^n), and the clock frequency is `HZ / 8^n`.
**The further away a timer expires, the higher a level it goes into and the coarser its bucket** --
near timers are located precisely; far timers are hashed coarsely.
The comment specifically stresses that the modern implementation **dropped the classic wheel's recascading**:
each high level scans independently on its own slow clock, naturally accepting coarse errors of a second or more.
The payoff is that `add_timer`/`del_timer` are both O(1) bucket operations;
the price is that far-future timers only expire "within that level's granularity".
`jiffies` itself is the `u64 jiffies_64` in `kernel/time/timer.c` (starting from `INITIAL_JIFFIES`), incremented by one on every tick.

## 3. Key Function Call Paths

### 3.1 The Interrupt Top Half (device → handler)

```text
Device raises its interrupt line → APIC/interrupt controller → IDT vector
  → arch/x86/entry/entry_64.S (common entry, switches to the privilege stack)
  → common_interrupt (arch/x86/kernel/irq.c, defined via DEFINE_IDTENTRY_IRQ)
  → call_irq_handler (find irq_desc by vector)
  → irq_desc->handle_irq (flow control layer: edge/level acknowledgement)
  → irq_desc->action->handler (the driver-registered top half; walk the list until claimed)
  → IRQ_HANDLED / IRQ_NONE
  → irq_exit_rcu → __irq_exit_rcu → invoke_softirq()
       ├─ on this CPU's interrupt stack with pending work → __do_softirq() (runs immediately)
       └─ otherwise → wakeup_softirqd() (wakes ksoftirqd/N to run it later)
```

One version fact that has to be stated outright: **`do_IRQ` from the old books no longer exists on x86-64** (verified against 6.12 source).
The entry function is named `common_interrupt` (`DEFINE_IDTENTRY_IRQ(common_interrupt)`),
and downward through `call_irq_handler` → `handle_irq` it reaches the generic layer's `generic_handle_irq_desc` (one line, `desc->handle_irq(desc)`) --
thin out the architecture layer and let the generic layer take over has been the mainline of the last decade.
The answer to "when does the softirq actually run" sits at the tail of `irq_exit_rcu`:
`invoke_softirq()` checks `!in_interrupt() && local_softirq_pending()` to decide whether to run it on the spot or wake `ksoftirqd` --
on an RT kernel or with nesting too deep it goes to the kernel thread, preferring to be late over opening yet another level inside interrupt nesting.
If a driver needs to take a mutex inside its handler, register with `request_threaded_irq(irq, handler, thread_fn, flags, name, dev)`:
`handler` only acknowledges and returns `IRQ_WAKE_THREAD`,
`thread_fn` runs in a kernel thread (visible via `ps -e | grep '^.*irq/'` as threads like `irq/41-virtio`), and its context may sleep.

### 3.2 The softirq Executor: `__do_softirq` with a Budget

```text
__do_softirq()                    // the external entry in kernel/softirq.c
  → handle_softirqs(false)        // the real budget loop
      pending = local_softirq_pending()   // snapshot of which slots run this round
      loop: clear pending → call softirq_vec[i].action(&vec[i]) slot by slot
      budget: 2ms spent (MAX_SOFTIRQ_TIME = msecs_to_jiffies(2))
              or 10 restarts (MAX_SOFTIRQ_RESTART = 10)
      over budget → wakeup_softirqd()  // hand the expensive work to ksoftirqd, so softirqs cannot starve processes
```

Both macro values are hardcoded discipline:
a softirq may take "at most 10 rounds, at most 2 milliseconds", and past that the remaining work is thrown to the per-CPU `ksoftirqd/%u` kernel thread (`DEFINE_PER_CPU(struct task_struct *, ksoftirqd)` in `kernel/softirq.c`).
This explains an operations phenomenon:
under extreme network traffic, `ksoftirqd/0`'s CPU usage spikes --
it is working overtime for the softirqs the budget kicked out.
Every softirq slot callback may run **concurrently** on multiple CPUs (unlike a single-queue work item, which is serialized);
this is the mechanical basis for NET_RX being able to saturate multiple cores, and also the reason any bottom-half code you write must bring its own spinlock.

### 3.3 The workqueue Path: Enqueue to kworker

```text
INIT_WORK(&w, func) / PREPARE_WORK
  → queue_work(system_wq, &w)          // pick the queue: system / unbound / highpri
  → __queue_work()                     // hang onto pool->worklist by CPU/priority
  → wake that pool's worker thread (kworker/N:H)
  → process_scheduled_works()
  → w->func(w)                         // executed in process context, may sleep
```

The built-in queues `system_wq` (`events/`), `system_highpri_wq`, `system_unbound_wq` and friends cover ninety percent of scenarios;
`schedule_delayed_work` puts the work into the **embedded `timer_list`** of a `struct delayed_work`,
and on expiry it is enqueued via the timer wheel's callback (another 2.6 boundary: for delayed enqueue, coarse granularity is plenty).
The comparison with softirq is already given in Section 2.3:
here every step happens in a schedulable thread, so a full queue, waiting for a lock, or doing IO are all fine --
the cost is scheduling latency (microseconds to milliseconds).

### 3.4 hrtimer and tick/NOHZ

```text
hrtimer_start(&timer, expires, mode)          // insert into base->active red-black tree
  → if the nearest expiry moved earlier → program one interrupt in the clock_event_device
  → interrupt arrives → hrtimer_interrupt()   // high-resolution clock event handler
  → __hrtimer_run_queues()                    // scan for expired ones
  → __run_hrtimer()                           // unhook → drop the lock → call fn → reinsert per return value
       fn returns HRTIMER_RESTART → timerqueue_add requeues it
```

When high-resolution is off or unavailable there is a fallback:
`hrtimer_run_queues()` hangs on the periodic tick path and scans on its behalf
(the function returns immediately if `hrtimer_hres_active()` is true at the top -- when high precision is on, it does nothing).
The periodic tick leg is led by `update_process_times`:
`account_process_tick` accounting → `run_local_timers()` (which first incidentally runs `hrtimer_run_queues`, then raises TIMER_SOFTIRQ as needed) → `sched_tick()` scheduling accounting (see the [Process Scheduling](./process-scheduling.md) chapter) → `run_posix_cpu_timers`.
In NOHZ (no periodic tick) mode, the periodic tick is itself implemented with an hrtimer --
`tick_nohz_handler` in `tick-sched.c` has the signature `enum hrtimer_restart (*)(struct hrtimer *)`,
and "the next beat" simply means changing that hrtimer's expiry.
`NOHZ_IDLE` stops the clock of idle CPUs to save power (on by default in distributions; nothing for you to do),
while `NOHZ_FULL` shuts the tick even on busy CPUs (aimed at ultra-low-latency scenarios, requiring the full set of `isolcpus`, cpuset, and user-space polling to cooperate; enabling it casually in daily use is digging yourself a pit).

### 3.5 The Timer Wheel Expiry Path

```text
Enqueue (driver/subsystem):
  add_timer(&t) / mod_timer(&t, expires)
    → internal_add_timer(base, timer)   // pick level and bucket by how far expires is away; O(1)

Expiry (per CPU):
  periodic tick → update_process_times → run_local_timers()
      → pending timers present → raise TIMER_SOFTIRQ
  → run_timer_softirq()                  // registration point: open_softirq(TIMER_SOFTIRQ, run_timer_softirq)
      → run_timer_base(BASE_LOCAL/GLOBAL/DEF)   // under NOHZ three wheels: local/global/deferrable
      → __run_timers(base)               // scans only levels whose clock has advanced
      → expire_timers(base, heads + levels)
      → call_timer_fn(timer, fn, baseclk)   // calls function() with interrupts disabled; DEFERRABLE does not wake an idle CPU
```

Two details to note:
`run_local_timers` raises **on demand** (if `timer_base::next_expiry` has not arrived, no softirq is raised -- a wasted scan is a waste);
under NOHZ a CPU has three wheels, `BASE_LOCAL`/`BASE_GLOBAL`/`BASE_DEF` (migratable, non-migratable, and wake-delayable each in their own place), and `run_timer_softirq` runs all three in turn.
Timer wheel callbacks live by the same discipline as hrtimers: interrupt context, no sleeping, hand heavy work over to a workqueue.

## 4. Source Reading Order

A route from short to long, each step noting "what to skip":

1. **`handle_softirqs` and `__do_softirq` in `kernel/softirq.c`** (the heart of the whole topic, on the order of a hundred lines): first build the mental model of "budget system + slot dispatch" -- this is the general dispatch desk of the bottom half. Skip the RT branches and hotplug code.
2. **`include/linux/interrupt.h` as a dictionary**: the signatures of `request_irq`/`request_threaded_irq`, and the table of `IRQF_*` flag semantics (the full set confirmed on 6.12: `IRQF_SHARED`, `IRQF_ONESHOT`, `IRQF_NO_THREAD`, `IRQF_PERCPU`, `IRQF_NOBALANCING`, `IRQF_NOAUTOEN`, etc. -- note that **there is no flag shaped like `IRQF_RAISE_SOFTIRQ`**: a driver raises a softirq by calling `raise_softirq()` directly, and NAPI reception is exactly the open-and-shut route `napi_schedule` → `raise_softirq(NET_RX_SOFTIRQ)`). Do not read it in order; look things up as needed.
3. **The first 150 lines of `kernel/time/timer.c`**: the timer wheel design comment in full plus the level/bucket selection logic of `internal_add_timer` -- the manual for the whole wheel, shorter and more accurate than any secondhand article.
4. **`__run_hrtimer` in `kernel/time/hrtimer.c`** (a short function, with a clean three-part unhook-lock/call-callback/reinsert); follow the stream down to the expiry scan of `__hrtimer_run_queues`; then go back and read the mode parameters of `hrtimer_init` in `include/linux/hrtimer.h` (`HRTIMER_MODE_ABS/REL/HARD/SOFT`).
5. **`kernel/workqueue.c`, enqueue side only**: pool selection and wake logic from `queue_work` → `__queue_work`. Skip worker pool management, WQ_SYSFS, and all debug macros -- that is another book's worth of thickness.
6. **`common_interrupt` in `arch/x86/kernel/irq.c`** (read the `DEFINE_IDTENTRY_IRQ` macro both before and after expansion), and follow `call_irq_handler` down to the generic layer -- the boundary between architecture-specific and generic code becomes clear here.
7. Cross-check the three runtime files throughout: `/proc/interrupts` (irq_desc counters), `/proc/softirqs` (slot accounting), `/proc/timer_list` (the registered inventory of hrtimers) -- **every time you read a field, go find its shadow in proc**: this is the fulcrum of this chapter's "source ↔ live scene" cross-verification.

## 5. Hands-On Tracing

Six experiments, deepening level by level from counters to event streams (ftrace operation details are in [Tracing Tools](./tracing-tools.md); here we only give this chapter's own observation points).
The following terminal blocks come from a 14-core x86-64 machine with `CONFIG_HZ=1000` and `CONFIG_HIGH_RES_TIMERS=y`, with columns truncated:

**Experiment 1: Make `/proc/interrupts` move.** Note the counter on the NIC's interrupt row, run some traffic (`ping -f` the gateway, or a sustained `curl` download from an internal machine), then `grep eth /proc/interrupts` -- under NAPI aggregation it usually grows in batches.
The IPI rows at the bottom move too: `RES` (reschedule), `CAL` (cross-core function call), `TLB` (page table shootdown), `LOC` (local APIC timer, i.e. the hardware source of the periodic tick).
Reading points: number of columns = number of CPUs; one column growing alone means that queue did not enable multi-queue or affinity was not spread (on the `irqbalance` topic see Section 6).

```text
$ cat /proc/interrupts
           CPU0       CPU1       CPU2       CPU3
  1:          0          0          0          0  IO-APIC   1-edge      i8042
 19:         27          0          0          0  IO-APIC  19-edge      ehci_hcd:usb2, ehci_hcd:usb3
LOC:   14474763   14468385   14453656   14610204  Local timer interrupts
RES:     155722     166836     161109     158102  Rescheduling interrupts
TLB:    1910663    1899037    1857732    1863226  TLB shootdowns
```

**Experiment 2: Reconcile `/proc/softirqs`' accounting with actions.** Take a sample before and after each: run `ping` and watch `NET_RX` climb, start a few hundred `while :; do sleep 0.01; done` loops and watch `TIMER` climb, write a big file and watch `BLOCK` climb --
each experiment amplifies exactly one slot, turning the Section 2.2 numbering table into muscle memory.
Beyond the ten rows there is **no** summary row; add across a row yourself if you want a total.

```text
$ cat /proc/softirqs
                CPU0      CPU1      CPU2      CPU3
HI:               0         1         6         1
TIMER:       464256    283595    262235    281986   ← timer wheel run_timer_softirq
NET_TX:          32        30        19        18
NET_RX:      236429    227150    194928    186549   ← packet reception (NAPI → raise_softirq)
BLOCK:            1         0         0         0
TASKLET:         94         1        15         2
SCHED:      4392984   1669826    820101    564867   ← load balancing sched_balance_softirq
HRTIMER:          0         0         0         0
RCU:        2294411   2274130   2287550   2294800
```

**Experiment 3: See hrtimers in `/proc/timer_list`.** `sudo cat /proc/timer_list | head -40`: the header shows the current time base and precision (`.resolution: 1 nsecs` -- direct evidence that high resolution is working), and below each `# expires at` is one registered hrtimer, the two ends of the interval being exactly `_softexpires` and the hard expiry (the source fields of 2.4 made concrete in the output).
Most telling of all is the `tick_nohz_handler` entry -- the periodic tick is itself an hrtimer (the conclusion of 3.4 visible with the naked eye):

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

`hrtimer_wakeup` is the standard callback of the `nanosleep` family --
start a shell running `sleep 3600` and look again, and you can catch its expiry entry.

**Experiment 4: Capture the irq/softirq event stream with ftrace.** Low-overhead event sites suit interrupt observation better than the function tracer.
Note that since v6.12 softirq events hang under the `events/irq/` group (`include/trace/events/irq.h`, the same TRACE_SYSTEM), not a standalone `events/softirq/` directory:

```bash
# Event-level tracing (far lower overhead than the function tracer)
$ sudo sh -c 'echo 1 > /sys/kernel/tracing/events/irq/irq_handler_entry/enable'
$ sudo sh -c 'echo 1 > /sys/kernel/tracing/events/irq/softirq_entry/enable'
$ sudo sh -c 'echo 1 > /sys/kernel/tracing/events/irq/softirq_raise/enable'
$ ping -c 5 127.0.0.1 > /dev/null
$ sudo grep -m4 'NET_RX' /sys/kernel/tracing/trace
            ping-887859  [013] D..1. 16907.951252: softirq_raise: vec=3 [action=NET_RX]
            ping-887859  [013] ..s1. 16907.951253: softirq_entry: vec=3 [action=NET_RX]
$ sudo grep -m2 'irq_handler_entry' /sys/kernel/tracing/trace
           rustc-887518  [010] d.h.. 16907.943956: irq_handler_entry: irq=41 name=virtio2-request
# Turn them off when done, or echo 0 item by item
$ sudo sh -c 'echo 0 > /sys/kernel/tracing/events/irq/irq_handler_entry/enable; \
              echo 0 > /sys/kernel/tracing/events/irq/softirq_entry/enable; \
              echo 0 > /sys/kernel/tracing/events/irq/softirq_raise/enable; echo > /sys/kernel/tracing/trace'
```

Three interlocks:
`vec=3` is precisely the Section 2.2 enum index (3=`NET_RX_SOFTIRQ`);
the gap from `raise` to `entry` is 1 microsecond (the latency from raise to execution);
and the name in `irq_handler_entry irq=41 name=virtio2-request` shares its origin with `/proc/interrupts` (both are `action->name`).
The `d.h..`/`..s1.` string after TASK-PID is the trace-flag column (`d`=interrupts disabled, `h`=running in hardirq, `s`=running in softirq, digit=preemption depth; full semantics in `Documentation/trace/ftrace.rst`) --
the `raise` happens under `D..1.` (raising a softirq from process context with interrupts disabled) and the `entry` under `..s1.` (executing in softirq context): the context switch is visible with the naked eye.

**Experiment 5: The process face of a workqueue.** `ps -e | grep kworker` lists all workers (the `0` in `kworker/0:1` is the CPU, the `1` is the pool-internal number, and a trailing H means the high-priority pool);
watch a `kworker`'s `TIME` delta across an action that queues a lot of work (such as the reclaim work triggered by `echo 1 > /proc/sys/vm/drop_caches`).
To conveniently verify Section 3.3, enable the `events/workqueue/workqueue_execute_start` event, or run `sudo bpftrace -e 'kprobe:process_one_work { @[comm] = count(); }'` to see who is handing out work orders.

**Experiment 6: Check your machine's HZ and high-resolution switches.** This is the base number behind every "latency semantic" that follows:

```bash
$ getconf CLK_TCK          # 100 — this is USER_HZ (the user-space ABI), not the kernel HZ!
100
$ grep -E 'CONFIG_HZ=|CONFIG_HIGH_RES' /boot/config-$(uname -r)
CONFIG_HIGH_RES_TIMERS=y
CONFIG_HZ_1000=y
CONFIG_HZ=1000
```

If `/boot/config-$(uname -r)` does not exist (some distributions), use `zcat /proc/config.gz | grep CONFIG_HZ=` instead.
HZ=1000 means one beat is 1ms --
the timer wheel's finest granularity is also 1ms, which is where the first pitfall of Section 6 comes from.

## 6. Common Pitfalls

**Treating `msleep(1)`/`queue_delayed_work(wq, &w, 1)` as precise milliseconds.** Symptom: measured delays range from 1-20ms, occasionally "sleep 1ms, wake up 15ms later".
Root cause: these APIs go through the timer wheel, whose granularity is 1 jiffy (4ms at HZ=250), and whose expiry is bucket-aligned and allowed to be coarse; miss the alignment point and you wait two beats.
For deterministic short delays you must go through the hrtimer family: `usleep_range()`, `schedule_hr_timeout()`, `hrtimer_nanosleep()`.
The selection mantra returns to the table in 1.2: **precision goes to hrtimer, bulk work goes to the timer wheel**.

**Writing tasklets because an old book said so.** Symptom: `tasklet_init` copied from *LKD* or *Analysis of Linux Kernel Scenarios* gets bounced in review, or you spot `tasklet_schedule` and judge "this is old code".
The tasklet system (`HI_SOFTIRQ`/`TASKLET_SOFTIRQ`, two slots) still functions but **is no longer recommended for new code**; the modern replacement is one of two depending on need:
must have extremely low latency → the threaded mode of `request_threaded_irq` (the top half only wakes, heavy work happens in the sleepable IRQ thread);
ordinary bottom half → `queue_work`/`system_wq`.
When reading old books, just mentally translate tasklets into "the lightweight bottom half of its era" -- the idea behind the mechanism still holds.

**Sleeping in interrupt context.** Symptom: `BUG: scheduling while atomic` the moment a module loads, or intermittent deadlocks that are hard to reproduce.
Root cause: calling a sleepable primitive (mutex_lock, `kmalloc` with `GFP_KERNEL`, `msleep`) from softirq/interrupt context -- timer wheel callbacks and hrtimer callbacks are equally guilty.
Discipline: in interrupt-related code `printk` is fine, `kmalloc(GFP_ATOMIC)` is fine, and the only locks are spinlocks;
when unsure, move to a workqueue and put the code back in process context.
This is the master switch for an entire class of driver bugs; once you understand "context determines the primitive", everything reads clearly.

**Manual IRQ affinity fighting irqbalance.** Symptom: `/etc/default/irqbalance` has not been disabled, yet `smp_affinity` is set to a static value, and the affinity keeps getting reset periodically.
Who wins depends on timing; it shows up as an interrupt distribution that "drifts after being set".
Order of handling: decide on a strategy first --
for a static distribution, `systemctl disable --now irqbalance` and then write `smp_affinity`;
for dynamic load balancing, leave it to irqbalance and do not touch procfs.
A multi-queue NIC (one IRQ per queue) plus irqbalance is the default best answer;
manual pinning is only worth it where you have measurement backing a specific goal like NUMA affinity optimization.

**Doing slow work in an hrtimer callback.** Symptom: system clock jitter, `watchdog: BUG: soft lockup`, or an abnormally large gap between `hrtimer_expire_entry` and `exit` in a trace.
hrtimer callbacks live by the same discipline as softirqs -- by default they run in interrupt context (even a "softened" `is_soft` hrtimer only goes as far as softirq level), and time-consuming work must be handed over with `queue_work`.
The judgment mantra matches Section 1.2: in a callback only "mark and hand off", never "compute and wait".

**Blindly enabling NOHZ_FULL.** Symptom: copying a low-latency guide's `nohz_full=` changes makes things no better or even worse.
NOHZ_FULL requires the kernel to drive all miscellaneous work (RCU callbacks, timer migration) off the protected CPUs, and needs the application side to supply the full set of `isolcpus`, cpuset, and user-space polling;
the payoff only shows in scenarios sensitive to microsecond-level tail latency.
The default NOHZ_IDLE already gets you most of the benefit for free; do not touch the other half without having measured latency.

**Treating `getconf CLK_TCK` as the kernel HZ.** Symptom: every delay conversion computed for 1000 beats is off by an order of magnitude.
`CLK_TCK` is the POSIX user-space ABI (always 100, i.e. `USER_HZ`) and is unrelated to this machine's kernel HZ (250/300/1000 are common) --
on the machine in Experiment 6 the former is 100 and the latter 1000.
The kernel HZ can only be read from `CONFIG_HZ=` in `/boot/config-$(uname -r)` or `/proc/config.gz`;
in a VM you must also realize the host may steal ticks (the `HYP` row in `/proc/interrupts` is the trace of host callbacks).

**Reading `/proc/interrupts` columns as a serial total.** Symptom: taking a single column's number as the global total to judge "too many/too few interrupts".
Number of columns = number of logical CPUs, and each column is that CPU's counter --
to judge distribution, look at whether the columns in a row are balanced (a multi-queue NIC should be roughly even);
only sum across a row to judge the total.
Also note that VMs and physical machines count differently (a vCPU's interrupts come injected from the host), so state your basis when comparing across environments.

## 7. Further Reading

Books matched to topics (real books, honestly labeled; each reflects the 2.4-2.6 era -- the mechanism ideas are precious, but function names must follow current source):

- **The interrupt system and bottom halves**: Robert Love's *Linux Kernel Development*, the chapters on interrupt handling and bottom halves / deferred execution -- the classic narrative, but update your understanding of the tasklet chapters per Section 6
- **Time management**: the same book's time management chapter (the jiffies/timer_list view); for hrtimer details defer to `kernel/time/hrtimer.c` and Section 3.4 of this page
- **Interrupt controllers and flow details**: Bovet & Cesati's *Understanding the Linux Kernel*, the interrupt-related chapters (it explains the x86 APIC hardware-to-software bridge in detail and still has hardware reference value from the 2.6 era)
- **The timer wheel and scenario walkthroughs**: Mao Decao and Hu Ximing's *Annotated Walkthrough of Linux Kernel Source Code*, the clock and timer scenarios -- the difference between the old wheel (with cascading) and the modern implementation is a living textbook of design evolution; read it against the header comment of `kernel/time/timer.c`
- **workqueue design**: the in-tree `Documentation/core-api/workqueue.rst` (written by Tejun Heo, a first-hand authority)
- **ftrace events and trace flags**: the in-tree `Documentation/trace/ftrace.rst` (the output-format manual for Experiment 4 of this page)
- **First-hand source**: [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/source/) online cross-reference -- every function name on this page was checked against v6.12 (`common_interrupt` replaces `do_IRQ`, `handle_softirqs` runs the budget loop, `__run_hrtimer` executes a single expired item, `internal_add_timer` picks a level and enters the wheel)
- **Live observation**: the ftrace/bpftrace chapters of [Tracing Tools](./tracing-tools.md) -- the tool details for Experiments 4 and 5 of this page

## References

- Official kernel documentation -- [docs.kernel.org](https://docs.kernel.org/)
- Workqueue design document (in-tree) -- `Documentation/core-api/workqueue.rst`
- ftrace user guide (in-tree) -- `Documentation/trace/ftrace.rst`
- Online source cross-reference (v6.12) -- [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/source/)
- Robert Love. *Linux Kernel Development*, 3rd ed.
- Daniel P. Bovet & Marco Cesati. *Understanding the Linux Kernel*, 3rd ed.
- Mao Decao, Hu Ximing. *Annotated Walkthrough of Linux Kernel Source Code*
- Wolfgang Mauerer. *Professional Linux Kernel Architecture*

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [README](README.md)
- [syscall-path](syscall-path.md)
- [tracing-tools](tracing-tools.md)
