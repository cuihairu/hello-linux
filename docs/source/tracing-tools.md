# Kernel Tracing Toolbox

The worst habit when reading source is "imagining with your eyes closed":
staring at `vfs_write`'s code and guessing when it gets called and with what arguments is far worse than letting the kernel confess itself.
Tracing tools are the instrument panel plugged in at the kernel/user-space boundary --
strace stands at the system call surface watching "what is the program asking the kernel to do",
ftrace stands at the function level watching "which path did the kernel take internally",
bpftrace aggregates millions of calls into a statistical chart,
and gdb paired with QEMU can press pause on any line of kernel code.
These four layers differ in intrusion, information, and setup cost;
choosing the wrong layer is the number one killer of troubleshooting efficiency --
using gdb to debug "why is the service slow" is using a cannon on a mosquito,
and using strace to ask "why did the kernel deadlock" is climbing a tree to catch a fish.
This page is the third chapter of the source part:
[Source Tree](./source-tree.md) tells you where the code lives,
[Kernel Build](./build-and-modules.md) gets you a vmlinux with symbols,
and this page records how to reconcile "the function name you saw" with "the path that executed" --
every module chapter's hands-on section downstream is built on this toolbox.

> Content draws on the kernel's official trace documentation and the bpftrace project documentation; see the references at the end.

## What This Part Covers

- Build the selection intuition for "observation layers": which problems use strace, which must go to ftrace/bpftrace
- Use ftrace's function/function_graph tracers and set_ftrace_filter to narrow the observation surface
- Use kprobe_events and one-line bpftrace programs to build dynamic probes with arguments and aggregation
- Set up a QEMU + gdb kernel breakpoint debugging environment, and understand KASLR's effect on breakpoints
- Remember the production discipline: dynamic probes may go to production; ptrace and the global function tracer may not

## 1. Four Layers of Observing the Kernel

### 1.1 The Triangle of Intrusion, Information, and Cost

The four tools are not four "better versions" of one thing but four different observation surfaces.
**strace** intercepts at the system call boundary via the ptrace mechanism, and sees the "send/receive manifest" between program and kernel --
it knows nothing of what happens inside the kernel, but it knows every request the program made;
**ftrace** is the kernel's own tracing infrastructure, able to print the kernel's function call flow and durations at nearly zero cost
(instrumented at compile time; a `nop` instruction when unused);
**bpftrace** hangs dynamic probes on any kernel function via eBPF, and can also aggregate data right inside the kernel, compressing a million events into one statistical table;
**gdb** simply stops the kernel and inspects the scene instruction by instruction.
It is like a progressive inspection system:
first look at the waybill (strace), then enter the workshop and watch the process flow (ftrace), then install counters in the workshop (bpftrace), and finally cut power to the whole production line for inspection (gdb).

| Tool | Observation surface | Intrusion | Setup cost | Typical question |
|------|--------|--------|----------|----------|
| strace | the system call boundary | two stops per syscall; the target slows by an order of magnitude | zero | what file is the program waiting on, which syscall is it stuck in |
| ftrace | kernel function flow and duration | negligible after filtering; heavy when global | zero (in-kernel) | which functions did one request walk through |
| bpftrace | dynamic probes + aggregation | verifier guarantees safety; production-capable | install a package | who is writing this file, the call distribution of some function |
| gdb + QEMU | the scene at any breakpoint | the kernel simply stops | half an hour minimum | the complete scene when some function is called for the first time |

### 1.2 Tool Installation (Three Distribution Families Compared)

The four tools' package names are highly consistent across the three families;
the differences concentrate on RHEL's QEMU naming --
it historically had two names (user-mode full-system emulation `qemu` and KVM-accelerated `qemu-kvm`),
and modern versions have merged:
the `qemu-kvm` package provides the `qemu-kvm` command,
while Debian/Arch both use the `qemu-system-x86` package with the `qemu-system-x86_64` command:

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| install strace | `apt install strace` | `pacman -S strace` | `dnf install strace` |
| install bpftrace | `apt install bpftrace` | `pacman -S bpftrace` | `dnf install bpftrace` |
| install trace-cmd | `apt install trace-cmd` | `pacman -S trace-cmd` | `dnf install trace-cmd` |
| install gdb | `apt install gdb` | `pacman -S gdb` | `dnf install gdb` |
| install QEMU | `apt install qemu-system-x86` | `pacman -S qemu-system-x86` | `dnf install qemu-kvm` |
| show an installed version | `apt show strace` | `pacman -Qi strace` | `dnf info strace` |

ftrace needs no installation --
it is part of the kernel, and all it takes is `CONFIG_FUNCTION_TRACER=y` and `CONFIG_KPROBE_EVENTS=y` in `/boot/config-$(uname -r)`;
mainstream distribution kernels have them all on by default, verifiable at a glance with `grep FTRACE /boot/config-$(uname -r)`.
bpftrace depends on `CONFIG_BPF` and `CONFIG_BPF_SYSCALL`, likewise standard in distributions.
The only thing that needs "preparation" is the vmlinux gdb needs (the uncompressed kernel image with symbols):
distributions usually ship it separately in a debuginfo package,
and a self-built kernel produces it directly at the top of the source tree -- see [Kernel Build](./build-and-modules.md).

## 2. strace: The System Call Surface

### 2.1 Seeing Every "Request" the Program Makes

strace's output is the complete conversation record between program and kernel.
Narrow it with `-e trace=` to the calls you care about, and the noise drops by an order of magnitude immediately:

```bash
$ strace -e trace=write cat /etc/hostname
execve("/usr/bin/cat", ["cat", "/etc/hostname"], 0x7ffc9a2b41f0 /* 42 vars */) = 0
write(1, "hello-linux\n", 12)          = 12      # the actual output action
close(1)                                = 0       # tidy up the fd
+++ exited with 0 +++
```

Three lines are a "confession":
`execve` is the starting point strace always shows (the process image changed);
`write(1, ..., 12)` says the data went to standard output, 12 bytes long, and the return value 12 means it all went out;
the final `exited with 0` is a clean exit.
In troubleshooting the three most valuable kinds of line are:
**lines returning -1** (`ENOENT` file not found, `EACCES` insufficient permission, `EAGAIN` resource temporarily unavailable -- the error code is the diagnosis);
**lines stuck without returning** (no return value after `read(3,` means the process is waiting on that fd;
`/proc/PID/syscall` shows which call it is blocked in);
**lines repeating an anomaly many times** (the same openat failing hundreds of times is usually a path loop or a cache invalidation).
Note that execve is shown even when it does not match a `-e trace=write` filter --
strace always traces the process's birth.

Besides naming calls one by one, `-e trace=` can also select by **class**:
`%file` matches all file-related calls (openat/stat/access/unlink in one net),
`%process` is the fork/exec/clone family,
`%network` is the socket/connect/accept family.
To profile an unfamiliar program, one run with `strace -e trace=%file,%network` shows which files it touched and which addresses it connected to --
when auditing a binary of unknown origin, this is the first physical.
For an already running process, attach with `-p PID` (needs the same uid or root);
between attach and detach the target is monitored the whole time.
Write output to disk with `-o` for unhurried analysis, so the terminal does not get flooded.

### 2.2 Statistical Mode and Child Processes

`-c` compresses thousands of lines of conversation into one bill;
sort by cost to see the hot spots:

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

How to read the bill:
the `calls` column shows behavioral patterns (many openat means it is hunting for files like crazy),
the `errors` column shows the failure distribution,
and `usecs/call` shows the per-call cost.
When giving a service a "why is startup slow" check-up,
a single `strace -c -f systemctl start foo` shows whether it spends its time scanning config files or resolving DNS --
`-f` brings forked children into the trace, so the service manager's whole child chain is in the net.

### 2.3 The Ceiling: It Cannot See Inside the Kernel

strace's overhead comes from the mechanism itself:
ptrace stops the target process at **every** system call's entry and exit,
and an order-of-magnitude slowdown of the traced program is the norm.
This dictates two disciplines:
never attach strace during load testing (all performance numbers are ruined),
and in production use it briefly, on a single misbehaving process only.
The deeper ceiling is the observation surface:
everything inside the kernel --
lock contention, softirqs, page reclaim, scheduling latency --
never appears in a system call record.
A process stuck in D state (uninterruptible sleep): strace can only show that its "last syscall never returned";
where exactly it is stuck inside the kernel is ftrace's jurisdiction.
From this section on, we cross the system call boundary and enter the kernel.

## 3. ftrace: The Kernel's Own Function-Level Tracing

### 3.1 tracefs: Where the Control Panel Is

All of ftrace's knobs are exposed through the tracefs filesystem, usable with a single command:

```bash
# mount -t tracefs nodev /sys/kernel/tracing   # the modern mount point; most systems already have it mounted by the kernel
# ls /sys/kernel/tracing | head
available_events      events/               set_event             trace
available_filter_functions  kprobe_events   set_ftrace_filter     trace_pipe
buffer_size_kb        current_tracer        set_graph_function    tracing_on
```

The `/sys/kernel/debug/tracing` of old documentation is the same filesystem at its old mount point (hidden under debugfs);
new kernels uniformly recommend `/sys/kernel/tracing`,
and the two paths have identical contents --
just replace the path when copying from old material.
This directory is a control panel:
`current_tracer` picks the tracer,
`set_ftrace_filter` narrows to specific functions,
`trace` reads the results,
and `tracing_on` is the master switch.
All interaction is ordinary file read/write (echo/cat), which means ftrace is scriptable by nature --
it is less a tool than a set of /sys interfaces, and trace-cmd merely puts a nicer shell around it.

### 3.2 The function tracer: The Function Call Flow

```bash
# cd /sys/kernel/tracing
# echo function > current_tracer
# echo vfs_write > set_ftrace_filter     # trace only this one function; saves CPU and buffer
# echo > trace                           # clear the old buffer
# cat /etc/hostname > /dev/null          # produce one write
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

The information density of the output deserves a column-by-column read:
`cat-2213` tells you who (the task_struct of [Process Scheduling](./process-scheduling.md) is running on its behalf);
`[004]` is the CPU number;
the four state symbol columns (irqs-off/need-resched/hardirq/preempt) are the interrupt and preemption context --
you will use them constantly when reading [Interrupts and Timers](./interrupt-timers.md);
and `vfs_write <-ksys_write` is the point:
the left of the arrow is the callee, the right is the caller,
meaning "this vfs_write came from ksys_write" --
matched against [System Call Path](./syscall-path.md), it is exactly the second hop of `write(2) → ksys_write → vfs_write`.
That big legend in the header appears in every file; learn it once and you are done.
**Always pair a filter**:
a global function tracer without `set_ftrace_filter` produces millions of events per second and the machine visibly stutters;
`available_filter_functions` lists every traceable function (several hundred thousand) --
grep it first to confirm the name exists before writing the filter;
a typo produces no error at all, only silent empty output.

### 3.3 function_graph: Timing Every Function

The function tracer answers "who called whom"; function_graph answers "how long did this walk take":

```bash
# echo function_graph > current_tracer
# echo vfs_write > set_graph_function
# echo > trace && cat /etc/hostname > /dev/null && head -6 trace
  3)               |  ksys_write() {
  3)               |    vfs_write() {
  3)   0.840 us    |      rw_verify_area();
  3)   2.917 us    |    }                       # vfs_write total cost
  3) + 14.875 us   |  }                         # + means over 10 us
```

Indentation expresses call depth, the trailing number is the cost in microseconds,
and the `+` and `!` markers denote slow calls over 10 and 100 microseconds --
one glance locates the hot level.
This is the most direct evidence of "how long did one write spend in the VFS layer",
far more efficient than repeatedly guessing "is the kernel slow".
For longer recording sessions use `trace-cmd record -p function_graph -l vfs_write sleep 10` and replay offline with `trace-cmd report`,
spared the tedium of manual echo;
the data collected by both methods is identical --
trace-cmd just adds a record/replay wrapper.

### 3.4 kprobe Dynamic Events: Seeing the Arguments Too

A static tracer can only tell you "vfs_write was called";
a kprobe event can also dig out the argument values.
On x86-64, the third argument of `vfs_write(unsigned int fd, const char __user *buf, size_t count)`, `count`, travels in the `%rdx` register:

```bash
# echo 'p:mywrite vfs_write count=%dx' > kprobe_events   # p=probe, mywrite=event name, %dx=the count argument
# echo 1 > events/kprobes/mywrite/enable
# head -c 512 /dev/urandom > /tmp/rand && cat /etc/hostname > /dev/null
# head -2 trace | tail -1
           head-2417    [005] .....   812.445310: mywrite: (vfs_write+0x0/0x2b0) count=0x200
```

`count=0x200` is precisely 512 bytes in hex --
the probe really captured the argument.
Unpacking the syntax:
`p:` means attach a probe (`r:` is a return probe, which can catch the return value);
`mywrite` is the custom event name;
`vfs_write` is the attachment point;
`count=%dx` extracts register dx and names it count.
Once enabled, the event lives under `events/kprobes/mywrite/`,
where `enable` is the switch and `filter` can add conditions (such as `count > 1048576` to watch only large writes).
This register-argument syntax depends on the target architecture's calling convention;
on x86-64 the first six arguments are in `di/si/dx/cx/r8/r9` in order --
the kernel's kprobetrace documentation has the complete syntax table.
When done, remember to clean up with `echo 0 > events/kprobes/mywrite/enable && echo > kprobe_events` --
an idle probe costs nothing to keep, but it keeps writing to the buffer.

### 3.5 Tracepoint Events: The Kernel's Pre-Installed Observation Points

Besides hanging kprobes on arbitrary functions, the kernel has **pre-installed** over two thousand static observation points (tracepoints) on key paths,
each with a stable event name and pre-formatted fields --
steadier than kprobes (they do not shift across kernel version upgrades) and more readable than kprobes (arguments are named semantically).
To enable them, set the tracer back to `nop` and turn on events by "subsystem:event name":

```bash
# echo nop > current_tracer
# echo sched:sched_switch > set_event          # enable one; *:* enables all (use with care)
# echo > trace && sleep 1 && head -2 trace | tail -1
          <idle>-0     [001] ....   813.001274: sched_switch: prev_comm=swapper/1 prev_pid=0 prev_prio=120 prev_state=S ==> next_comm=cat next_pid=2213 next_prio=120
```

This line records one complete CPU context switch:
from the idle task `swapper/1` (pid 0) to `cat` --
analyzing scheduling behavior in the [Process Scheduling](./process-scheduling.md) chapter relies on exactly this kind of event rather than per-function tracing.
The `events/` directory is divided into dozens of subsystem groups --
`sched/`, `block/`, `net/`, `kmem/`, and more;
the `available_events` file lists the whole set,
and `grep -i 'block\|writeback' available_events` finds observation points faster than flipping through documentation.
The common tracer set is now complete at four:
`function` for call relationships,
`function_graph` for per-level timing,
`nop` + `set_event` for semantic events,
and kprobes to supplement arguments for any function --
covering ninety percent of observation needs when reading source;
only the last ten percent calls for bpftrace's aggregation and gdb's breakpoints.

## 4. bpftrace: One Line of Code for Aggregation

### 4.1 From "Seeing the Path" to "Seeing the Distribution"

ftrace and kprobe answer "what does this one call look like";
bpftrace answers "what do these hundred thousand calls look like overall" --
it attaches eBPF programs to probes, counts, sums, and draws histograms right inside the kernel,
and sends only the aggregated results back to user space.
The classic one-liner:

```bash
# bpftrace -e 'kprobe:vfs_write { @[comm] = count(); }'
Attaching 1 probe...
^C                                        # run for ten-odd seconds, then Ctrl-C to exit

@[systemd-journald]: 963
@[bash]: 41
@[cat]: 3
```

The table printed when you press Ctrl-C is the complete answer to "who is calling vfs_write" during the observation window --
systemd-journald stands alone at the top; log writing is this machine's dominant writer.
The syntax has only four parts:
`kprobe:vfs_write` is the attachment point (swap the prefix to `kretprobe:` for a return probe);
`{ }` is the action body;
`@[comm]` is an aggregate map keyed by process name;
`count()` is the built-in counting function.
If you want bytes rather than counts, change the action to `@[comm] = sum(arg2);` --
`arg2` is vfs_write's third argument, count, which bpftrace has already fetched from the register for you, far kinder than a raw kprobe's `%dx`.

### 4.2 Latency Histograms: Pairing Entry and Return Probes

Measuring "how long did one call take" requires pairing entry and exit:
the entry probe stores a timestamp in a map keyed by thread id, and the return probe takes the difference and draws a histogram.
This is bpftrace's most-used skeleton, worth memorizing:

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

`@start[tid]` is keyed by thread id, so concurrent calls do not cross-contaminate;
`/@start[tid]/` is a predicate that only processes returns with a matching entry;
`hist()` buckets the microsecond deltas into power-of-two ranges,
showing at a glance that the body sits in 16-32 microseconds with a long tail past 64.
Virtually every performance dispute ("did the kernel get slower?") can eventually converge to a histogram like this:
take one before and one after a version upgrade, and a rightward shift of the distribution is hard evidence.
Swap the function name for `ext4_file_write_iter` or `__x64_sys_write` and the same skeleton reuses directly in the hands-on sections of the [Filesystem](./vfs-ext4.md) and [System Call](./syscall-path.md) chapters.

### 4.3 The Division of Labor with ftrace, and Production Readiness

The combination punch of the two tools works like this:
first use ftrace's function_graph to see the complete path of **one** request (answering "how does the road go"),
then, having spotted a suspect function, use bpftrace to take **around-the-clock** statistics on it (answering "how does everyone fare on this road in aggregate").
bpftrace can go to production while a hand-written kprobe dares not --
the root reason is the BPF verifier:
at program load time the kernel exhaustively checks all execution paths and confirms the program will not access out of bounds, loop forever, or crash the kernel;
if verification fails, loading is refused.
This "prove safety before running" mechanism is the same discipline as [package management](../basic/packages/apt.md) verifying signatures before installing:
both intercept risk before it takes effect.
`bpftrace -l 'vfs_*'` can fuzzy-list every attachable probe --
check it once before writing a script, and it beats guessing function names from error messages.

## 5. gdb + QEMU: Breakpoint-Debugging the Kernel

### 5.1 When Is It Worth Stopping the Kernel

The previous three layers are all "observation"; gdb is "interrogation" --
stopping the kernel at any line of code and inspecting the entire scene at that instant:
local variables, registers, the call stack, page table contents.
The cost is that the environment must be rebuilt:
you cannot put a breakpoint on a running production kernel (stopping it is an incident);
instead you run a kernel inside a QEMU virtual machine and connect from outside with gdb.
Only one class of scenario justifies it:
the scene the first time some function is called, or the trigger conditions of some rare path --
these are too low-probability for a trace to catch, while a breakpoint hits every time.
The bzImage and the symbol-bearing vmlinux produced by the [Kernel Build](./build-and-modules.md) chapter come into play here;
for the initramfs, a distribution tool generating a minimal root filesystem is enough.

### 5.2 The Minimal Runnable Environment

One QEMU command starts the "server";
`-s` is the built-in gdbserver (listening on port 1234), and `-S` freezes at the very first instruction on boot
(so the kernel does not run far away before gdb connects):

```bash
$ qemu-system-x86_64 -kernel arch/x86/boot/bzImage \
    -initrd rootfs.cpio.gz \
    -append "console=ttyS0 nokaslr" \
    -nographic -s -S
```

On the other end, start gdb, load symbols, connect, set a breakpoint, and continue:

```text
$ gdb vmlinux
(gdb) target remote :1234
Remote debugging using :1234
0x000000000000fff0 in ?? ()
(gdb) hbreak start_kernel          # hardware breakpoint: memory management is not ready yet, a soft breakpoint cannot be written into memory
Hardware assisted breakpoint 1 at 0x...: kernel/init/main.c, line ...
(gdb) c
Continuing.
Breakpoint 1, start_kernel () at init/main.c:...
```

`console=ttyS0` redirects kernel output to the serial port, and QEMU's `-nographic` wires that serial port to the current terminal --
so the kernel's boot log and gdb's prompt alternate on the same screen;
this is the standard posture of kernel debugging (on real hardware you use a serial cable; the principle is identical).
There is a hard reason to use `hbreak` rather than `break`:
a soft breakpoint is implemented by "rewriting the instruction into int3",
and early in kernel boot the MMU is not yet enabled and the code segment is not writable,
so only a hardware breakpoint implemented via debug registers will do.
The initramfs need not be crafted by hand:
`dracut --no-hostonly --force` (RHEL family) or `mkinitcpio` (Arch) can both produce a minimal rootfs.cpio.gz with a busybox shell --
the goal is not completeness but "once the kernel is up there is a shell to type commands in and create scenarios".

### 5.4 The Kernel's Own gdb Scripts: The lx-* Commands

The kernel source tree ships a set of gdb helper scripts (`scripts/gdb/vmlinux-gdb.py`);
once loaded you gain a family of `lx-` prefixed commands that translate kernel data structures into readable output:

```text
(gdb) source scripts/gdb/vmlinux-gdb.py
(gdb) lx-dmesg                       # the kernel log (like the dmesg you would see on the serial port, read directly from gdb)
(gdb) lx-lsmod                       # loaded modules and each module's memory layout
(gdb) lx-cpus                        # CPU/logical processor overview
(gdb) p init_task                    # PID 0's task_struct, the protagonist of the process chapter
```

`lx-dmesg` is most valuable when stopped at a breakpoint --
stopped at a deadlock scene, the serial port may no longer be flushing logs, but gdb can read the ring buffer directly;
`p init_task` turns the abstract structure of [Process Scheduling](./process-scheduling.md) into a field tree you can flip through right there
(`(gdb) p init_task.pid`, `p init_task.comm`).
These scripts evolve with kernel versions; the command list lives in the source tree's `scripts/gdb/` directory --
one more footnote that "the tools are in the source".

### 5.3 KASLR: The Number One Culprit for Missed Breakpoints

Modern kernels enable address space layout randomization (KASLR) by default;
each boot moves the kernel code to a random address, while the symbol table in gdb's hands records compile-time addresses --
the two do not line up, so breakpoints naturally miss.
The solution is the unremarkable `nokaslr` in that command line above:
add it to `-append`'s kernel command line and the kernel returns to its compile-time origin, where symbols are addresses.
Production kernels do not allow disabling KASLR (it is a security feature), so it is normal for a debugging kernel command line to differ from production;
conversely, comparing the breakpoint address in gdb's `info breakpoints` against the actual address in `cat /proc/kallsyms | grep start_kernel` --
whether they align is the criterion for whether KASLR is in effect.
This detail has consumed many people's entire first afternoon:
the symbols are clearly loaded and the breakpoint simply never hits -- nine times out of ten it is this.

## 6. A Combined Campaign: The Full Investigation of "Periodic Stalls While Writing a File"

How do the four layers chain into a real investigation?
Take a classic failure as the script:
`cp` a 2GB file to an ext4 partition, and the speed drops from the usual 1.2 GB/s to 45 MB/s, stalling for a moment every few seconds of writing.
The investigation escalates by layer, each layer answering exactly one question.

**Layer one: `strace -c` to confirm "stuck at the boundary or stuck in the kernel".** In the bill of `strace -c cp big.iso /mnt/`, nearly all the time falls on `write` with zero errors --
nothing anomalous on the program side and no retry storm;
the problem is in the kernel or deeper.
This layer takes five minutes, and its value is ruling out user space so you do not hunt for keys on the wrong floor.

**Layer two: watch the dirty page watermarks.** `watch -n1 'grep -E "Dirty|Writeback" /proc/meminfo'`:
Dirty climbs all the way to about 500 MB and is then emptied in an instant,
with write speed recovering and falling again --
the classic periodic forced writeback.
The page cache accumulates writes in memory,
and once the `vm.dirty_ratio` threshold is reached it holds the writer down
(`balance_dirty_pages` rate-limits),
releasing it only when writeback catches up;
with an aggressive threshold and a slow underlying disk, you get the sawtooth of "sprint -- long pause".
This is a mechanism at the crossroads of the [Memory Management](./memory-management.md) and [Filesystem](./vfs-ext4.md) chapters.

**Layer three: bpftrace quantifies the bimodal distribution.** Using the §4.2 histogram skeleton on `kprobe:vfs_write`/`kretprobe:vfs_write`:
the latency distribution is clearly bimodal --
a cluster in the tens of microseconds (page cache hit, returns immediately)
and a cluster in the tens of milliseconds (held down by writeback throttling).
The bimodality confirms the existence of two fates, and quantifies "occasional slowness" into a comparable baseline.

**Layer four: ftrace sees which functions the slow hammer took.** function_graph with `set_graph_function ext4_file_write_iter`,
and inside the slow call appears a clear waiting chain of `balance_dirty_pages` → `io_schedule` --
the rate-limiting point stamped and confirmed.
The treatment follows:
either tune `vm.dirty_background_ratio`/`vm.dirty_ratio` so writeback starts earlier and flushes smoothly
(sysctl persistence is in the [systemd chapter's sysctl management conventions](../system-management/services-systemd.md)),
or accept that the underlying disk's write capability is simply the bottleneck.
Four layers of tools, four answers; not one step was a guess --
this is the live form of "observation layers":
from outside in, each layer narrows the circle by one, and the verdict arrives only at the last step.

## 7. Engineering Discipline

**In production use dynamic probes, not breakpoints.** bpftrace and filtered ftrace carry the backing of the verifier / compile-time instrumentation and may enter production routine observation;
strace and gdb, one crippling the target and one halting the machine outright, belong only to troubleshooting scenes and lab environments.
Where that line is drawn matters more than how many tools you know.

**Pin the version before tracing.** Kernel function names and structures drift with versions
(the location of `ksys_write` in 6.x differs from 5.x, for instance);
every symbol seen in tool output must reconcile with "the source of this very machine" --
`uname -r` fixes the version, then go to [elixir.bootlin.com](https://elixir.bootlin.com/), select the matching version, and enter the source file.
With a version mismatch the function names you see are phantoms:
traceable in the tool, unsearchable in the source, and you doubt your own sanity for nothing.
Getting and version-matching the source tree is in [Source Tree](./source-tree.md).

**Buffers fill up.** The trace buffer is sharded per CPU, and each shard defaults to only tens of kilobytes --
high-frequency events blow it in seconds (new events are silently dropped).
Before a long session run `echo 8192 > buffer_size_kb` to enlarge it,
and afterwards `echo 0 > buffer_size_kb` to restore (0 means default).
Reading via `trace_pipe` streams and consumes as you collect, avoiding disk-write contention --
but these are concerns for "recording long sessions" only;
a first experiment's few seconds of output is more than fine with the default buffer.

**Turn "function name → source line" into a reflex.** Every time you see a new function name in trace output,
click it open on elixir and look at its implementation --
the tool tells you "what happened here", and the source tells you "why it happened that way".
Every later module chapter's hands-on section is arranged to this rhythm:
trace first, compare against source next, and finally return to the source reading order.
Tracing tools are the magnifying glass of source reading, not a replacement.

## 8. Common Pitfalls

**An ordinary user cannot write to /sys/kernel/tracing.** tracefs is root-writable by default, and a non-root echo gets Permission denied.
The proper approach is to specify `gid=` at mount time
(`mount -o remount,gid=tracegid /sys/kernel/tracing`) to grant access to a dedicated tracing group;
for everyday experiments a root session is simply easier.
Do not leave tracing permissions open for ordinary accounts year-round for convenience --
it can see the whole system's function flow, which is equivalent to installing global surveillance.

**A wrong function name in set_ftrace_filter silently yields no output.** Whether the name is misspelled or the function was inlined or not exported,
ftrace raises no error --
it only leaves the trace file empty.
Before writing a filter, `grep -w vfs_write available_filter_functions` to confirm the function is on the roster --
this list of several hundred thousand lines is the filter's legal domain, and it has the final say.

**Turning the function tracer on globally drags the system down.** Without a filter, millions of events per second fill the buffer and raise CPU;
the machine visibly stutters.
One discipline only:
enabling the function tracer must be preceded by writing `set_ftrace_filter`;
function_graph likewise must be narrowed with `set_graph_function`.
When done, `echo nop > current_tracer` to turn it off --
do not leave a heavyweight tracer configured overnight.

**bpftrace reports that a kprobe cannot find the symbol.** A misspelled name, a kernel version with a different name, or a static unexported symbol all abort at load time --
friendlier than ftrace's silence, but the debugging approach is the same:
`bpftrace -l 'vfs*'` lists them first, then write.
Note that `kprobe:` only works on symbols visible in `/proc/kallsyms`;
functions inside modules need a module name prefix
(such as `kprobe:ext4_*`, requiring the module to be loaded).

**A gdb breakpoint that never hits.** Nine times out of ten it is KASLR (see §5.3, solved by `nokaslr`),
and one time out of ten it is using `break` where early memory is not writable (switch to `hbreak`).
Order of judgment:
compare gdb's `info breakpoints` address against `cat /proc/kallsyms | grep <symbol>`;
rule out randomization first, then suspect the breakpoint type.

**Leaving strace attached during load testing.** ptrace's double-stop mechanism slows the target by an order of magnitude,
all load test data is distorted, and the conclusion will inevitably mislead the optimization direction.
Leave performance measurement to ftrace/bpftrace's kernel-side statistics (they do not intercept in user space);
strace answers "behavior" questions, not "performance" questions.

**The trace file grows the more you cat it.** `cat trace` reads a snapshot,
but background system calls keep producing new events;
watching it grow while you read is normal, not paranormal.
Clear once with `echo > trace` before the experiment, cat immediately after the action,
and do not interleave unrelated commands in between;
or switch to `trace_pipe` (consumed as read).
Storing output you cannot finish reading to a file for later analysis is healthier than chasing the scrollbar in a terminal.

## References

- Official ftrace documentation -- [kernel.org/doc/html/latest/trace/ftrace.html](https://www.kernel.org/doc/html/latest/trace/ftrace.html)
- kprobe event syntax -- [kernel.org/doc/html/latest/trace/kprobetrace.html](https://www.kernel.org/doc/html/latest/trace/kprobetrace.html)
- The bpftrace project and one-liners documentation -- [github.com/iovisor/bpftrace](https://github.com/iovisor/bpftrace)
- bpftrace cheat sheet (Brendan Gregg) -- [brendangregg.com/BPF/bpftrace-cheat-sheet.html](https://www.brendangregg.com/BPF/bpftrace-cheat-sheet.html)
- strace official site -- [strace.io](https://strace.io/); also see man strace
- Bird's Private Recipes (Lin's Linux Administration Guide), system observation and program tracing chapters -- [linux.vbird.org](https://linux.vbird.org/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [README](README.md)
- [build-and-modules](build-and-modules.md)
- [cross-compile](cross-compile.md)
- [driver-framework](driver-framework.md)
- [interrupt-timers](interrupt-timers.md)
- [ipc](ipc.md)
- [memory-management](memory-management.md)
- [network-stack](network-stack.md)
- [process-scheduling](process-scheduling.md)
- [source-tree](source-tree.md)
- [syscall-path](syscall-path.md)
- [userland](userland.md)
- [vfs-ext4](vfs-ext4.md)
