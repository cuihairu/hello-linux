# Process Management and Scheduling (Source Part)

From the operations view, a process is one line of `ps` output: a PID, one STAT letter, one nice value.
From the kernel's view, a process is a `task_struct` plus a stack of ledgers: identity, state, kinship, scheduling entity, address space pointer.
This page aligns the two views --
which bit of the `TASK_` constant each STAT letter corresponds to, how a nice value becomes a rung in the weight table, and how `fork` and context switching walk through the source.
Prerequisites for following this part (getting the source, tracing tools) are in [Source Tree](./source-tree.md) and [Tracing Tools](./tracing-tools.md);
every function name and field name on this page was checked against **v6.12** source,
and the version boundary where the scheduler switched from CFS to EEVDF in 6.6 runs through the whole page.
The process's memory side (the `mm` pointer, copy-on-write) is left to [Memory Management](./memory-management.md); this page only plants seeds.

> Content draws on the Linux kernel v6.12 source tree (function names/files/line numbers all verified with elixir) and the books at the end (conceptual framework); see the references at the end.

## What This Part Covers

- Map `ps`'s STAT letters and nice values back onto the kernel's `TASK_` constants and weight table, and state the responsibilities of the five families of key `task_struct` fields
- Walk two paths: fork's `kernel_clone` chain and scheduling's `__schedule` chain, with a translation table for the old books' `do_fork`/`_do_fork`
- EEVDF in 6.6+: how `sched_entity`'s `vlag`/`deadline`/`slice` trio decides "who is eligible to run, and who runs first"
- See every context switch with your own eyes using the `sched_switch` tracepoint, bpftrace, and `/proc`
- Interpret the source-level meaning of high-frequency phenomena: D state, zombie processes, and `swapper/0`

## 1. What Is a Process: The Kernel's View and Operations' View

In the kernel's eyes there is no chasm between "process" and "thread" -- only tasks:
one `task_struct` is one schedulable entity.
`fork()` creates a new task with a new address space;
`pthread_create()` creates a new task that **shares** the address space --
user space's `clone(2)` enters the kernel with the flag set `CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD`,
and `copy_process`, upon seeing `CLONE_VM`, skips copying page tables and only bumps the shared count.
So each thread occupying its own row in `ps -eLf` is not a display trick:
they really are independent tasks in the kernel, each with its own PID
(within a thread group the `tgid` is the same, and the PID `ps` displays is actually the tgid).

| What operations sees | In the kernel | v6.12 location |
|-----------|---------|-----------|
| STAT column `R` | `TASK_RUNNING` (0x00000000, runnable) | include/linux/sched.h |
| STAT column `S` | `TASK_INTERRUPTIBLE` (0x00000001, interruptible sleep) | same |
| STAT column `D` | `TASK_UNINTERRUPTIBLE` (0x00000002, uninterruptible sleep) | same |
| STAT column `T` | `__TASK_STOPPED` (0x00000004) / `__TASK_TRACED` (0x00000008) | same |
| STAT column `Z` | `EXIT_ZOMBIE` (0x00000020) | same |
| nice -20..19 | the 40-rung `sched_prio_to_weight[]` weight table | kernel/sched/core.c |
| `ps`'s COMM column | `task_struct.comm` (a 16-byte short name) | include/linux/sched.h |

Two mappings deserve expansion.
First, in newer kernels the state field has been renamed `__state` and must be accessed through helper functions --
old code and old articles that assign to `current->state` directly will no longer compile; another instance of version sensitivity.
Second, the nice value does not linearly shave CPU off; it looks up a weight table:
adjacent rungs differ by about 1.25× in weight,
so a `nice +5` task gets roughly 1/3 of the CPU its competitor gets, and `nice +10` about 1/10 --
both "I tuned it a little and felt nothing" and "I tuned it hard and starved it" are direct consequences of this geometric table.
`set_user_nice()` (kernel/sched/core.c) is the entry point that looks the value up and changes the weight.

## 2. Core Data Structures (Act ①)

### 2.1 task_struct: The Process's General Ledger

`task_struct` has several hundred fields and reading it straight through is inefficient;
you only remember it by taking it in "families".
For process management and scheduling, five families are worth keeping in your head:

```text
                    fork()/clone()
                         │
                         ▼
   ┌─────────── TASK_RUNNING (R, ready or currently running) ────────────┐
   │                    ▲                │                              │
   │ event arrives      │                │ waiting for the event        │ uninterruptible
   │ (signal/IO/timer)  │                │ (waiting for input/lock)     │ (waiting for IO)
   │                    │                ▼                              ▼
   │            TASK_INTERRUPTIBLE (S)  ◄──►     TASK_UNINTERRUPTIBLE (D)
   │                    │                                               │
   │                    └── exit ──► EXIT_ZOMBIE (Z) ── parent waits ──► reaped
   └─────────────────────────────────────────────────────────────────────┘
   plus __TASK_STOPPED (T, paused by SIGSTOP) and __TASK_TRACED (t, intercepted by a ptrace debugger)
```

The five families of fields:

| Field family | Representative fields (v6.12 line) | What they govern |
|-------|----------------------|--------|
| identity | `pid` (:1018), `tgid` (:1019), `comm` (short name) | who is who; within a thread group pids differ, tgid is shared |
| state | `__state` (:786) | the truth behind R/S/D/Z/T; the scheduler judges runnability by it |
| kinship | `real_parent` (:1032), `children` (:1040) | the creditor-debtor relation of zombie reaping (see 3.3) |
| scheduling | `se` (:831), `policy`, `prio`/`normal_prio`, `cpus_mask` (:880) | which scheduling class, what priority, which CPUs it may run on |
| address space | `mm` (points to `mm_struct`) | the process's memory map; not copied at fork, only a reference is bumped (seed planted in [Memory Management](./memory-management.md)) |

### 2.2 sched_entity: What the Scheduler Actually Watches

The fair scheduling class does not operate on `task_struct` but on the `struct sched_entity` embedded inside it
(old books call it `sched_entity` or simply discuss `vruntime`; the fields have changed a great deal).
Key v6.12 fields:

```text
struct sched_entity {          // include/linux/sched.h (excerpt)
    struct load_weight  load;   // weight, looked up from nice
    struct rb_node      run_node; // node hanging into the cfs_rq red-black tree
    u64                 vruntime; // virtual runtime: "amount already run", weighted
    s64                 vlag;      // the account: positive = the kernel owes you CPU, negative = you overdrew
    u64                 deadline;  // virtual deadline: vd_i = ve_i + r_i / w_i
    u64                 slice;     // the time slice request allowed this round
    unsigned char       on_rq;     // whether on the run queue
};
```

EEVDF (Earliest Eligible Virtual Deadline First, replacing CFS since 6.6) makes its rulings on exactly these three fields:
**only a task with `vlag >= 0` is eligible to be picked** (a negative lag means it has already overdrawn its quota),
and among the eligible set, **the one with the earliest virtual `deadline` wins**.
A task with a small `slice` naturally gets an earlier deadline --
this is EEVDF's built-in mechanism for favoring short interactive requests,
and it also explains why so many CFS articles written around `vruntime` after 6.6 must be read with version awareness:
the `vruntime` field is still there, but the judge's rule for "who runs first" has changed.
The `vlag` account is not zeroed at sleep:
it is decayed according to the deferred dequeue policy, preventing a task from waking up with free priority --
the first-hand sources for these semantics are the kernel documentation `Documentation/scheduler/sched-eevdf.rst` and the comment at the top of kernel/sched/fair.c.

### 2.3 rq and Group Scheduling: Why the Scheduler Does Not Schedule task_structs

Each CPU has one `struct rq` (kernel/sched/sched.h), whose fair-class sub-queue is `cfs_rq` --
a red-black tree organized by `deadline`.
Designing the scheduler to face `sched_entity` rather than `task_struct` reserves a door for **group scheduling**:
with `CONFIG_FAIR_GROUP_SCHED` on, a cgroup (a `task_group`) also appears in the parent queue as a `sched_entity`,
and the red-black tree thus grows into a hierarchy --
two containers running 10 tasks each first split the CPU at the machine level, and only then divide within each group.
This also corrects an operations intuition:
under group scheduling, raising the nice of some task inside a container competes for the in-group share,
and the inter-group cake is cut by group weights first --
the answer to "why does the task in this cgroup still lose the fight after lowering its nice" lies in the hierarchy.

## 3. Key Function Call Paths (Act ②)

### 3.1 The fork Path: The Birth of a Process

```text
user fork()
  └─ __x64_sys_fork (x86 entry wrapper)
       └─ sys_fork            kernel/fork.c:2868  SYSCALL_DEFINE0(fork)
            └─ kernel_clone    kernel/fork.c:2745
                 ├─ copy_process    kernel/fork.c:2118
                 │    ├─ sched_fork  :2344   initialize the scheduling entity, set priority
                 │    ├─ copy_files  :2362   copy/share the file descriptor table
                 │    ├─ copy_mm    :2374   copy/share the address space (see below)
                 │    └─ copy_thread         prepare the kernel stack and register frame
                 └─ wake_up_new_task  kernel/fork.c:2817   put it on the ready queue
```

`copy_mm` is where the "fork is cheap" myth actually comes from:
it calls `dup_mm`, which **copies page tables, not memory** --
item by item, writable pages are marked write-protected and parent and child share the physical pages;
whoever writes first takes a fault and each gets its own copy (copy-on-write; mechanism details in [Memory Management](./memory-management.md)).
So forking a 10GB process does not consume 10GB -- only the page tables and the `task_struct` itself.
`sched_fork` gives the new task a clean scheduling pedigree:
it inherits policy and nice, zeroes the `vlag`-related accounts, and attaches it to the father's CPU mask.
Old-book translation: `do_fork` (2.4 era) → `_do_fork` (2.6–5.x) → `kernel_clone` (6.x to date) --
when reading material from different eras, mentally translate them all to the same function first.

All differences within the fork family come down to the clone flags `copy_process` receives:

| Interface | Key flags | Effect |
|------|---------|---------|
| `fork()` | `SIGCHLD` (glibc implements it via `clone`) | copies page tables and the file table; parent and child have independent address spaces |
| `vfork()` | `CLONE_VFORK\|CLONE_VM` | parent and child **temporarily** share the address space; the parent is suspended until the child execs or exits -- saves page tables but extremely dangerous, no longer recommended by POSIX |
| `pthread_create()` | `CLONE_VM\|CLONE_FS\|CLONE_FILES\|CLONE_SIGHAND\|CLONE_THREAD\|CLONE_SETTLS` | a "process" that shares everything: same tgid, same signal handling, independent kernel stack and TLS |
| `clone3()` | a 64-bit struct argument | flags are extensible (such as `CLONE_INTO_CGROUP`, which systemd relies on to spawn children into a cgroup); the kernel-side unified entry is still `kernel_clone` |

In other words, "thread vs. process" at the source level is **a multiple-choice question over flag bits**, not two creation paths --
read `copy_process` with that flag set in hand and every `if (clone_flags & ...)` branch becomes explicit.

### 3.2 The Scheduling Path: One Context Switch

```text
clock interrupt / wake-up event / voluntary yield
  └─ schedule()
       └─ __schedule      kernel/sched/core.c:6548
            ├─ disable interrupts and preemption, pick prev/next
            ├─ pick_next_task    :6647   ask around by scheduling class (stop→dl→rt→fair→idle)
            │    └─ fair class: pick_next_task_fair → pick_eevdf (kernel/sched/fair.c:907)
            └─ context_switch    :6693
                 ├─ switch address space (switch_mm_irqs_off; kernel threads borrow prev's active_mm)
                 └─ switch_to (assembly) swaps the register/stack frame — from here the flow belongs to next
```

The skeleton of `__schedule` is not mysterious: lock the scene, pick next, switch away.
The fair class's core chooser `pick_eevdf` (fair.c:907; the formal manual of EEVDF is the comment starting at :889)
finds in the red-black tree the entity with non-negative lag and the earliest deadline --
the 2.6-era CFS rule of "smallest vruntime runs first" has been replaced here.
Inside `context_switch` sits one harmlessly interesting detail:
kernel threads have no user address space (`mm` is NULL),
so at switch time they borrow the predecessor's `active_mm`, saving one TLB flush --
when you see kworker and user processes switching frequently in a trace without generating much address-space overhead, half the credit goes here.

### 3.3 The Exit Path: The Ledger Meaning of a Zombie

After `do_exit` (kernel/exit.c:877) releases the process's resources,
it sets the state to `EXIT_ZOMBIE` (0x00000020) and does **not** immediately reap the `task_struct` --
the exit code and resource accounts are still pinned to that shell, waiting for the parent's `wait`/`waitpid` to settle the bill.
That is the definition of a zombie: **the account is unsettled, not a bug**.
What if the parent dies first?
The kernel re-hangs the orphan under the nearest subreaper (and if there is none, all the way up to PID 1 -- systemd on modern systems),
which settles the account;
a service process can declare "I will claim my grandchildren's accounts" itself with `prctl(PR_SET_CHILD_SUBREAPER, 1)`,
which is also the mechanical basis for services under systemd being able to host grandchild exits --
for the management-plane topic of service and process ownership see [System Services](../basic/services/system_services.md).

## 4. Source Reading Order (Act ③)

Same source, but the reading order decides whether you get started in two weeks or lost for two months.
For processes and scheduling, this route is recommended, each step noting "what to skip":

1. **Use include/linux/sched.h as a dictionary, do not read it in order.** A giant structure with hundreds of fields; look up only the five families of 2.1 first. The `TASK_` constants are at the head of the file (from :99), and `sched_entity` is inside the structure definition area.
2. **Read the trunk of `copy_process` in kernel/fork.c.** Enter at :2118, skip the conditional-compilation branches of audit, seccomp, cgroup, and ptrace, and follow only the four steps `sched_fork` → `copy_files` → `copy_mm` → `copy_thread`; then go back to `kernel_clone` (:2745) to see how it wraps the call and `wake_up_new_task`.
3. **In kernel/sched/core.c, read only `__schedule`** (:6548). Skip the real-time and deadline class branches (understanding `pick_next_task`'s polling logic across classes is enough), and focus on `context_switch`.
4. **Start kernel/sched/fair.c from the top comment** (the EEVDF explanation from :889), then revisit the field meanings of 2.2, and only then enter `pick_eevdf` (:907) to see how the red-black tree searches by deadline. The whole file is 13,000 lines; skip the entire load balancing section (`load_balance` and family) on the first pass.
5. **In kernel/exit.c read only `do_exit`** (:877) and its tail: the order of resource release, where `EXIT_ZOMBIE` is set, and the exit notification (`do_notify_parent`). Skip ptrace and signal-kill paths -- those are in the range of [System Call Path](./syscall-path.md) and the tracing tools.

The output of this route is that the two path diagrams of 3.1/3.2 close into a loop inside your head;
load balancing, real-time scheduling, and cgroup quotas are second-pass work.
For the tooling side (how to click these functions in the browser, how to build a local index), see [Source Tree](./source-tree.md).

## 5. Hands-On Tracing (Act ④)

### 5.1 Tracing One fork

```bash
$ strace -f bash -c 'true' 2>&1 | grep -E 'clone|execve' | head -3
clone(child_stack=NULL, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, child_tidptr=0x7f2c...) = 23347
execve("/usr/bin/true", ["true"], 0x55f8... /* 42 vars */) = 0
+++ exited with 0 +++
```

Modern glibc's `fork()` is a `clone` with `SIGCHLD` underneath --
there is no `CLONE_VM` in the flags, precisely the "no shared address space" of 3.1.
Now put a probe on `kernel_clone` with bpftrace and tally who is spawning processes:

```bash
$ sudo bpftrace -e 'kprobe:kernel_clone { @[comm] = count(); } interval:s:5 { exit(); }'
@[systemd]: 2
@[bash]: 1
```

Five seconds of systemd's and bash's fork counts at a glance --
for chasing "processes are quietly breeding" problems, this one probe beats repeated `ps` runs.

### 5.2 Seeing Every Context Switch

`sched:sched_switch` is the kernel's own tracepoint, turning every `__schedule` ruling into a flow record:

```bash
$ echo 1 | sudo tee /sys/kernel/tracing/events/sched/sched_switch/enable
$ sudo cat /sys/kernel/tracing/trace | tail -4
<idle>-0       [003] d..2. 83109.112233: sched_switch: prev_comm=swapper/3 prev_pid=0 prev_prio=120 prev_state=S ==> next_comm=bash next_pid=23347 next_prio=120
bash-23347    [003] d..2. 83109.112241: sched_switch: prev_comm=bash prev_pid=23347 prev_prio=120 prev_state=S ==> next_comm=swapper/3 next_pid=0 next_prio=120
```

Every line is the on-site record of the 3.2 path walking through once:
`prev_state=S` means bash yielded by sleeping (waiting for IO or input), not by being preempted after exhausting its slice;
`swapper/3` is CPU 3's idle task.
Use it to cross-check load:
run a busy loop and watch its relationship with involuntary switches --
far more intuitive than reciting concepts (tracefs paths and filtering tips are in [Tracing Tools](./tracing-tools.md)).

### 5.3 Runtime Corroboration

```bash
$ ps -eLf | head -3
UID   PID  PPID   LWP  C NLWP STIME TTY          TIME CMD
root     1     0     1  0    1 21:30 ?        00:00:02 /sbin/init
root   467     1   467  0    3 21:30 ?        00:00:00 /usr/sbin/sshd -D
$ grep ctxt /proc/$$/status
voluntary_ctxt_switches:        412
nonvoluntary_ctxt_switches:     3
```

`ps -eLf` gives one line per thread (NLWP is the thread count) --
each line corresponds to one `task_struct`, and every field of 2.1 has a landing point in this view.
The two switch counters in `/proc/<pid>/status` are a check-up sheet for scheduling behavior:
a high voluntary count is normal (waiting on network, waiting on keyboard);
a steadily growing nonvoluntary count means fierce CPU contention and frequent preemption --
pair it with the 5.2 trace to find who is fighting it.

### 5.4 The D-State Experiment

```bash
$ dd if=/dev/zero of=/mnt/usb/bigfile bs=1M count=2048 conv=fsync oflag=direct & sync
$ ps -o stat,pid,wchan:24,comm -C dd,sync
STAT   PID WCHAN                    COMMAND
D      5102 io_schedule              dd
```

Catching `ps` while writing a big file to slow media (a USB drive, network storage) shows tasks with STAT `D` and wchan around `io_schedule` --
`TASK_UNINTERRUPTIBLE` is exactly the state in the 2.1 table that "even a signal cannot wake":
it is waiting for paging or block device IO, and its sleep point chose uninterruptible mode.
This also explains why kill -9 is ineffective on a D-state task, and why the load average counts D tasks
(the accounting basis of iowait) --
phenomenon, constant, and source aligned in three layers here.
Everyday use of process states and commands is in [Process Commands](../commands/system/process.md).

## 6. Common Pitfalls

**Cannot find `do_fork`/`_do_fork` per old books.** 2.4's `do_fork`, 5.x's `_do_fork`, and 6.x's `kernel_clone` are three generations of names for the same function.
When reading material from any era, translate first; when searching code, try all three names.
Conversely, grepping `do_fork` in 6.x source yields comments about old fork paths rather than a definition --
do not conclude "this kernel still uses the old interface" on that basis.

**Using CFS articles to understand a 6.6+ kernel.** "Smallest vruntime runs first" has not held since 6.6:
EEVDF's judge is "non-negative lag and earliest deadline".
The `vruntime` field is still there and still accumulating, but the selection rule changed;
when reading a scheduling article, check its publication date and kernel version first,
just as with a DNS article you first check whether the record types it discusses are still valid.

**The scheduler schedules sched_entities, not task_structs.** With group scheduling on (it is on in all mainstream distributions), a cgroup is also a `sched_entity` in the parent queue.
The semantics of nice therefore become two-tiered:
in-group share and inter-group share are computed separately --
no matter how low a task's nice inside a container goes, it cannot beat the group's inborn weight allocation;
when chasing "priority has no effect", look at the hierarchy under `/sys/fs/cgroup` before you look at nice.

**A zombie is an unsettled account, not a bug.** `EXIT_ZOMBIE` is merely waiting for the parent to collect the exit code;
what genuinely needs fixing is "a parent that never waits".
Orphans are settled by the subreaper or systemd, and `PR_SET_CHILD_SUBREAPER` is the proper way for a service process to take over grandchildren --
the starting point for "curing" zombies is always changing the parent, never repeatedly killing the zombie itself.

**Lots of `swapper/N` in the trace.** Each CPU has one idle task (`INIT_TASK_COMM` is "swapper"; idle tasks are named `swapper/<cpu>`),
and when a CPU spins idle the scheduler switches to it, so it appears in swaths in the trace --
this is normal noise; filter `next_pid!=0` or `prev_pid!=0` to focus on real tasks.

**Tweaking nice gives no feeling.** The weight table is a geometric series (adjacent rungs differ by about 1.25×);
`nice +1` is only a 25% difference, hard to see by eye --
you usually need +5 before a gap opens.
And perceived effect gets diluted by group scheduling and IO waits --
first use the 5.3 switch counters to confirm the bottleneck really is CPU share before touching nice.

**PIDs in `ps` do not match the threads.** `ps -eLf` gives one row per thread with differing LWP values, yet `kill <PID>` acts on "the whole group" --
because `ps`'s PID column shows the `tgid`, and signals are delivered to the thread group by default.
To operate on a single thread, either use the LWP number with explicit syntax,
or internalize the division of labor between `pid` and `tgid` in the 2.1 table;
`top -H` switching to the thread view is the fastest eyeball check.

## 7. Further Reading (Act ⑤)

- *Linux Kernel Development* (Robert Love) -- the process and scheduling chapters: the smallest introductory framework, an early-2.6 perspective, concepts still valid today, function names need the 3.1 translation table
- *Understanding the Linux Kernel* (Bovet & Cesati) -- the process-related chapters: the densest book of data structure relationship diagrams, likewise based on 2.6
- *Professional Linux Kernel Architecture* (Wolfgang Mauerer) -- the process management chapters: a field-level reference from 2.6.24, useful when looking up the historical semantics of structure fields
- First-hand EEVDF material -- the in-tree `Documentation/scheduler/sched-eevdf.rst` and the comment at the top of kernel/sched/fair.c (v6.12, from :889); the lag semantics and the virtual deadline formula `vd_i = ve_i + r_i/w_i` are authoritative here
- [Linux v6.12 online cross-reference](https://elixir.bootlin.com/linux/v6.12/latest/source) -- every line number on this page can be re-verified there
- [Kernel scheduler documentation index](https://docs.kernel.org/scheduler/) -- the entry point of the official documentation tree

## References

- Linux kernel source v6.12 -- [elixir.bootlin.com/linux/v6.12](https://elixir.bootlin.com/linux/v6.12/latest/source)
- Official kernel scheduler documentation -- [docs.kernel.org/scheduler](https://docs.kernel.org/scheduler/)
- EEVDF explanation (in-tree documentation) -- `Documentation/scheduler/sched-eevdf.rst`
- man pages -- man clone(2), man proc(5), man ps(1)
- Robert Love. *Linux Kernel Development*, 3rd ed.
- Daniel P. Bovet & Marco Cesati. *Understanding the Linux Kernel*, 3rd ed.
- Wolfgang Mauerer. *Professional Linux Kernel Architecture*
- Bird's Private Recipes (Lin's Linux Administration Guide) -- [linux.vbird.org](https://linux.vbird.org/) (conceptual framework for processes and jobs)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [README](README.md)
- [interrupt-timers](interrupt-timers.md)
- [ipc](ipc.md)
- [memory-management](memory-management.md)
- [source-tree](source-tree.md)
- [tracing-tools](tracing-tools.md)
