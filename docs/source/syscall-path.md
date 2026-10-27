# System Calls: The Full Journey of One write()

Every conversation between a Linux program and the kernel passes through the same door: the system call.
`printf` reaching the screen, `read` fetching a file's contents, `fork` creating a new process --
strip away the buffering and wrappers, and underneath it is one CPU privilege-level switch plus a lookup dispatch through a function pointer table.
This page takes the smallest possible call, `write()`, and takes the door apart:
how user space triggers the switch, how the kernel finds the function by number, how arguments travel, and how errors come back.
It is "chapter 0" for every module chapter of the source part --
the entry points of processes, memory, VFS, and the network all hang off this path;
walk through the entrance first, and every later chapter's "call path" section is simply its extension line.
This chapter follows the part's unified five acts: core data structures → key function call paths → source reading order → hands-on tracing → further reading.

> Content draws on the kernel source tree (v6.12) and the books above (conceptual framework); see the references at the end.

## What This Part Covers

- Tell library functions apart from system calls
- Recognize the trio: `sys_call_table`, the `SYSCALL_DEFINE` macro, and `pt_regs`
- Independently walk the complete call chain of `write()`: `entry_SYSCALL_64` → `do_syscall_64` → `__x64_sys_write` → `ksys_write` → `vfs_write`
- "See" the static call chain on a real machine with four strace/ftrace/bpftrace experiments
- Avoid the three families of high-frequency misunderstandings: cross-architecture call numbers, function name version drift, and vDSO being invisible

This page's five-act navigation (the unified skeleton of this part's module chapters):

| Act | This page | In one sentence |
|---|---------|--------|
| ① Core data structures | §2 | `sys_call_table`, `SYSCALL_DEFINE`, `pt_regs`, vDSO |
| ② Key function call paths | §3 | the whole chain `entry_SYSCALL_64 → ... → vfs_write` and the way back |
| ③ Source reading order | §4 | four files; what to read and what to skip at each step |
| ④ Hands-on tracing | §5 | a five-part experiment with strace/ftrace/bpftrace/tracepoints |
| ⑤ Further reading | §7 | what to take from each of three books; how to use the version warnings |

## 1. Why System Calls Exist

### 1.1 User Mode and Kernel Mode: A Wall and a Door

Modern CPUs ship with privilege levels:
the kernel runs in ring 0 and may touch all memory and devices;
user programs run in ring 3, and out-of-bounds access triggers an exception immediately.
What the wall protects is not the kernel's privacy but the system's order --
if any process could write disk controllers or edit page tables directly, isolation and security would be moot.
But things inside the wall eventually need doing on its behalf,
so the CPU provides a few "legal wall-crossing" instructions:
on x86-64, `syscall` is that door.
The instant it executes, the CPU switches the privilege level to 0 and jumps RIP to an entry address the kernel pre-registered
(written into the `MSR_LSTAR` register at boot),
and from there the code is the kernel's.
The door is fast, but not free:
registers must be saved, caches flushed, scheduling and audit hooks passed --
this is the physical source of "system calls have a cost",
and also the reason designs like the page cache in the VFS chapter and zero-copy in the network chapter exist:
one fewer trip through the door is one fewer bill.

### 1.2 A Library Function Is Not a System Call

The most common confusion lives at this layer:
`printf`, `fwrite`, and `malloc` are **library functions** running in user space;
`write` and `brk` are **system calls** that must pass through the door.
Library functions often merge many logical operations into a few system calls:
`printf` accumulates content into a user-space buffer and only really calls `write` once the buffer is full, or on an explicit `fflush`, or at exit;
`malloc` asks the kernel for memory in large chunks (`brk`/`mmap`) and slices it up itself in user space for small ones.
One look with strace settles it --
loop `printf` a hundred times and `write(1, ...)` may appear only once or twice.
This "buffering layer" explains many surface oddities:
a program crashes and the last few log lines never appear (the buffer was never flushed);
output order changes after redirecting to a file (full buffering replaced line buffering);
"strace shows fewer calls" (they never happened; nothing was lost).
Draw this boundary clearly before reading kernel source, so you know whether the code you are chasing is libc's or the kernel's.

The door's overhead is also worth measuring with your own hands once --
it is the unit of measure for every performance story later in this part:

```bash
$ time /bin/true          # no strace: the baseline for creating and exiting a process
real 0m0.002s
$ time strace -c /bin/true 2>/dev/null   # the cost of intercepting every call
% time     seconds    usecs/call     calls    errors syscall
------ ----------- ----------- --------- --------- ----------------
  0.00    0.000009           4         2           read
  ...                                                       (a few file/memory calls)
------ ----------- ----------- --------- --------- ----------------
100.00    0.000365                  30           1 total
```

The same `true`, an order of magnitude slower once strace intercepts every call --
the `ptrace` that strace uses goes through the same door as the system call
(it must stop the target, copy the arguments, and release it every time), and that is only the cost of watching.
The hierarchy where tracepoints are cheaper than ftrace's function tracer, and the function tracer cheaper than breakpoints
(the selection table in Section 1 of [Tracing Tools](./tracing-tools.md)),
all trace back to the same triangle: intrusion, information, overhead -- you cannot have all three.

One final era note:
the design of system calls is not fixed.
Linux's call numbers grew from around three hundred in the 2.6 era to number 462 in v6.12 (`mseal`),
but the fundamental shape of a "one trip through the door at a time" call like `write` has not changed --
the changes are responses to cost:
`io_uring` turns submission and completion into a shared ring in the kernel --
register once, pass through the door in batches -- designed specifically for high-frequency small I/O.
Read the full journey of a single call first (this page),
and when you then look at `io_uring` you will understand exactly which segments it saves --
one of the pleasures of reading source is that the chronology of design intent unfolds with it.

### 1.3 This Page's Place in the Source Part

The [Tracing Tools](./tracing-tools.md) chapter gives a four-layer observation system, and this page's §5 experiments are its first live use;
the directory map of [Source Tree](./source-tree.md) starts earning its keep here --
the files this chapter touches are concentrated in three places: `arch/x86/entry/`, `include/linux/syscalls.h`, and `fs/read_write.c`.
Once this page is done, `write()` hands the baton to the filesystem at `vfs_write()`,
and the rest of the journey belongs to [VFS and ext4](./vfs-ext4.md).

## 2. Core Data Structures ①

### 2.1 sys_call_table: A Ledger of Function Pointers

The kernel registers all its system calls in an array --
the definition in `arch/x86/entry/syscall_64.c` is short enough to read at a glance:

```c
// arch/x86/entry/syscall_64.c (v6.12, excerpt)
const sys_call_ptr_t sys_call_table[] = {
#include <asm/syscalls_64.h>
};
```

The array body is one line, with its entries coming from a **build-time generated** header, `asm/syscalls_64.h`:
the kernel build system generates a sequence of `__SYSCALL(nr, sym)` macros from the syscall tables
(the registrations in `kernel/sys_ni.c` and the `SYSCALL_DEFINE` macros everywhere),
and the same header is included three times with three different macro definitions --
once to produce extern declarations, once to fill this table, once to generate the switch dispatch of `x64_sys_call()`.
The call number is the array index:
on x86-64, `write` is number 1 and `read` is number 0;
they are defined in `<asm/unistd_64.h>` and **differ between architectures** (see §6).
This table is the single source of truth for "number → function",
but note that v6.12's `do_syscall_64` does not index the table directly --
it calls the switch version `x64_sys_call()`,
which has a smaller indirect-jump surface and is friendlier against Spectre-class speculative execution attacks;
the two roads end at the same place, both landing on wrapper functions like `__x64_sys_write`.
Two engineering details to note in passing:
first, the table's length is bounded by the `NR_syscalls` macro, generated at build time from `syscall_64.tbl`;
unallocated call number slots are uniformly filled with `sys_ni_syscall` --
"not implemented" and "does not exist" are the same function in the kernel's eyes, both returning `-ENOSYS`,
which is the mechanical reason a garbage call number always yields the same error;
second, the call numbers are not packed continuously --
`syscall_64.tbl` has historical holes, so gaps in the table are not missing files.
`syscall_64.tbl` itself is the best entry point for understanding the whole table --
a plain text table where three columns tell you everything: who is at which number, which implementation function it lands on, and whether it is a compat call.

### 2.2 SYSCALL_DEFINE: The Macro That Hangs You on the Table

Defining a system call in the kernel is no longer writing an ordinary C function -- it is wrapped in a macro:

```c
// fs/read_write.c (v6.12, excerpt)
SYSCALL_DEFINE3(write, unsigned int, fd, const char __user *, buf, size_t, count)
{
    return ksys_write(fd, buf, count);
}
```

The 3 in `SYSCALL_DEFINE3` is the argument count.
On x86-64 with `CONFIG_ARCH_HAS_SYSCALL_WRAPPER` enabled, this macro line expands into three layers of functions:
the outermost `__x64_sys_write(const struct pt_regs *regs)` receives the unified register snapshot and unpacks `regs->di/dx/si` into three arguments;
the middle `__se_sys_write` sign-extends all arguments as `long`
(the user may pass truncated values; the kernel must be defensive);
the innermost `__do_sys_write` is the function body you wrote.
This layering looks tedious, but what it buys is the key design of §2.3:
**the system call's argument protocol is decoupled from the C calling convention**.
The macro also conveniently generates `SYSCALL_METADATA` --
ftrace's syscall events (`-e syscalls:sys_enter_write`) depend on it.
The old-textbook way of naming it `sys_write` corresponds to the conceptual name before macro expansion;
in 6.x source, grepping `sys_write` requires also looking for the three prefixes `__x64_`, `__se_`, and `__do_`.

### 2.3 pt_regs: A Snapshot of the Argument Registers

The x86-64 system call convention is worth memorizing:
**the call number goes in `rax`; arguments go in `rdi`, `rsi`, `rdx`, `r10`, `r8`, `r9` in order; the return value goes in `rax`**.
Attentive readers will notice the first three match the C calling convention but the fourth is `r10` rather than `rcx` --
because the `syscall` instruction hardware-conventionally writes the return address into `rcx` and stores flags in `r11`;
`rcx` is conscripted, so the fourth argument had to move to `r10`.
So `write(fd, buf, count)` is `rax=1`, `rdi=fd`, `rsi=buf`, `rdx=count`.
The first thing the kernel entry does is push the user register scene onto the kernel stack in a fixed layout, forming `struct pt_regs` --
it is simultaneously the argument packet (`__x64_sys_write` unpacks arguments from it), the return scene (restored on SYSRET), and the window through which ptrace/strace spy on system calls:
the argument values in strace's output are read from exactly this snapshot.

```c
// arch/x86/include/asm/ptrace.h (v6.12; field order is the push order, excerpt)
struct pt_regs {
    unsigned long r15;  unsigned long r14;  unsigned long r13;
    unsigned long r12;  unsigned long bp;   unsigned long bx;
    unsigned long r11;  unsigned long r10;  unsigned long r9;
    unsigned long r8;   unsigned long ax;   unsigned long cx;
    unsigned long dx;   unsigned long si;   unsigned long di;
    unsigned long orig_ax;          // backup of the call number (syscall clobbered ax)
    unsigned long ip;   unsigned long cs;
    unsigned long flags; unsigned long sp;  unsigned long ss;
};
```

`entry_SYSCALL_64` uses a single `PUSH_AND_CLEAR_REGS` to push the general registers in reverse order of the above
(`rax` is preset to `-ENOSYS` on the stack, see §3.2), then adds the `ip/cs/flags/sp/ss` quintet --
exactly the complete frame the `iret` instruction needs to restore user mode, and the fast SYSRET return draws from here too.
Two fields worth noting:
`orig_ax` stores the **call number** (after being pushed, `rax` is repurposed as the return value stash, so the original number moves into `orig_ax`;
strace/ptrace read the system call number precisely from it);
and the x86-specific names `di/si/dx` remind you this is a register snapshot rather than an argument list --
how many arguments there truly are is decided by the §2.2 macro;
only reading both together do they reconcile.

### 2.4 vDSO: The Exemption Lane That Never Trips the Door

One family of "read the time" operations (`gettimeofday`, `clock_gettime`, `time`, `getcpu`) gets special treatment:
at boot the kernel maps a small piece of code and data into every process's address space (the vDSO),
and these calls complete entirely in user space, never passing through the `syscall` door --
they read a read-only data page the kernel pre-fills and updates on clock interrupts.
The payoff is an order of magnitude:
one trip through the door starts at a few hundred nanoseconds, while the vDSO path takes only tens --
a world of difference for time-sensitive programs that timestamp at high frequency.
For source readers it has one direct side effect:
**these calls do not appear in strace** (see §6).
One rule of thumb to remember:
the `linux-vdso.so.1` in `ldd /bin/true`'s output is the trace of this mapping.

## 3. Key Function Call Paths ②

### 3.1 The Complete Call Stack of write()

Draw the whole journey of one `write(1, "hello", 5)` as a vertical diagram, user space on the left, kernel on the right, each stop annotated with its source location:

```text
User space                            Kernel space (v6.12)
──────────────                      ─────────────────────────────────────────
write(fd, buf, count)
  │  glibc's thin wrapper: mov eax, 1; mov rdi/rsi/rdx; syscall
  ╳ ── syscall instruction: CPL3→0, RIP ← MSR_LSTAR ─────────────────▶
                                      entry_SYSCALL_64
                                        arch/x86/entry/entry_64.S
                                        swapgs; fetch the kernel stack top from per-CPU;
                                        push the user registers into pt_regs (rax preset to -ENOSYS)
                                      do_syscall_64(regs, nr)
                                        arch/x86/entry/common.c
                                        after bounds-checking nr (array_index_nospec)
                                        dispatch by nr through x64_sys_call()
                                      __x64_sys_write(regs)
                                        generated by SYSCALL_DEFINE3: unpack pt_regs → (fd, buf, count)
                                      ksys_write(fd, buf, count)
                                        fs/read_write.c
                                        fdget_pos(fd): fd number → struct file (looked up in the
                                        process's descriptor table; with file position concurrency protection)
                                      vfs_write(file, buf, count, pos)
                                        fs/read_write.c — the boundary into the VFS
                                        calls file->f_op->write, or wraps and goes through
                                        write_iter via new_sync_write() — the rest belongs to the VFS/ext4 chapter
  ╳ ◀─ SYSRET (fast path when no signal and %al==0; otherwise the slow path switches stacks and returns) ──
write() returns rax: on success the number of bytes written, on failure -errno
```

### 3.2 Stop by Stop: What Each Stop Is Defending Against

Every stop on this chain exists for a reason;
read source with the question "what is it defending against" in hand, and the code stops being a sea of symbols.
`entry_SYSCALL_64` is pure assembly;
its opening `swapgs` exists because user mode and kernel mode share one set of GS registers, while the kernel's per-CPU data must be addressed via the kernel GS base --
swap the base first, and only then can it safely fetch the current task and stack top;
it stashes the user RSP into the TSS scratch slot, fetches the kernel stack top from a per-CPU variable,
then pushes onto the stack per the §2.3 layout.
`rax` being preset to `-ENOSYS` is a defensive design:
if the call number is invalid and dispatch fails, the stack naturally already holds a failure return value.
The first thing `do_syscall_64` does is **treat the call number as untrusted input**:
first bounds-check it as an unsigned number, then pass it through `array_index_nospec` to block speculative out-of-bounds execution (a Spectre v1 mitigation),
and only dispatch if legal;
`nr == -1` is treated as "this is not a system call" and skipped outright (the convention for the restart scenario).
`__x64_sys_write`, this wrapper stop, exists to translate "register protocol" into "C function protocol".
`fdget_pos` inside `ksys_write` answers a more practical question:
`fd` is just a small integer, and the kernel must look it up in the current process's file descriptor table (`task_struct` → `files_struct` → `fdtable`) to get the `struct file` --
the same fd number points at completely different files in different processes,
and this translation table is precisely the mechanical basis of why shell redirection works (§5.2 shows it live).
Finally `vfs_write` is the watershed where user data enters the filesystem;
from here the kernel must deal with buffering, locks, and per-filesystem differences --
that is the territory of [VFS and ext4](./vfs-ext4.md).
Errors propagate back the same way they came:
the inner layer returns `-errno`, which floats up unchanged layer by layer,
and glibc moves the negative value into `errno` and makes `write` return `-1` --
so the `= -1 EBADF (Bad file descriptor)` in strace is an answer that was decided deep inside the kernel long ago.

### 3.3 The Way Back: The Door Does Not Only Open

After the outbound trip there is the return trip, and the return trip's fork is exactly what `do_syscall_64`'s return value is for:
it returns a boolean telling the assembly entry whether "this one may take the relaxed `SYSRET` fast path" or "must take the `IRET` slow path".
The fast path does only three things --
`swapgs` swaps GS back to the user base, restores `rcx/r11`, and `sysretq` jumps back to user space;
the slow path (`swapgs_restore_regs_and_return_to_usermode`) first walks through an exit work stack:
pending signals, the `syscall_exit_to_user_mode` hooks (ptrace's "syscall exit" events, auditing, tracepoints all hang here), preemption and scheduling ...
and only then switches stacks to return.
When does it take the slow road?
When `rax` is non-zero (failed returns usually take the slow road because the error semantics must be carried across),
when the stack/flags do not satisfy `SYSRET`'s hardware preconditions,
or when a signal must be delivered.
When reading this code, keep two things apart:
"the return value is in a register" and "the return path is also audited" --
`strace -e trace=write` showing `= 6` is `rax`,
while why any line appears at all, and why `?restart_syscall` sometimes pops up, is the exit work stack speaking.
The two translations of `errno` also happen on this road:
the kernel gives a negative value, and things like `-ERESTARTSYS` are converted in place into signals or restarts
(glibc sees a call interrupted by a signal);
what actually reaches the user program's `errno` variable is only the survivor of this audited road.

## 4. Source Reading Order ③

The first time you read this chain, do not flow down from `init/main.c`;
go in four steps "from the door to the ledger", each step with an explicit "what to read, what to skip".
Prepare three escape routes first, for when you cannot chew through it:

- **Run before you read**: do the first two experiments of §5 before coming back --
  once you have seen the dynamic shape in your hands, every line of the static code has a landing point;
- **Use cross-references instead of linear browsing**: on elixir.bootlin.com click any function name to jump to its definition and callers --
  faster than chasing jumps in an editor; every function name on this page is one click away (select the v6.12 version, see the references);
- **Chase one edge at a time**: today only answer "how does `fdget_pos` turn fd 1 into a `struct file`";
  ask the next question tomorrow --
  the worst habit when following call chains is having twenty tabs open, each read for three lines.

**Step 1: in `arch/x86/entry/entry_64.S`, read only the `SYM_CODE_START(entry_SYSCALL_64)` stretch** (jump to the symbol in your editor; about two hundred lines around it).
Do not fear the assembly;
this stretch is comment-dense and the pattern repeats --
the core skeleton extracted is just these lines (v6.12, schematic excerpt):

```asm
SYM_INNER_LABEL(entry_SYSCALL_64, SYM_L_GLOBAL)
    swapgs                              /* swap GS to the kernel base; the premise of all per-CPU addressing */
    movq    %rsp, PER_CPU_VAR(...)      /* stash the user stack (TSS slot) */
    movq    PER_CPU_VAR(pcpu_hot + X86_top_of_stack), %rsp   /* switch to the current task's kernel stack */
    pushq   __USER_DS / ss, sp, r11, __USER_CS, rcx          /* the iret frame */
    PUSH_AND_CLEAR_REGS rax=$-ENOSYS    /* push general registers into pt_regs; preset -ENOSYS for an invalid call number */
    movq    %rsp, %rdi                  /* arg 1: &pt_regs */
    movslq  %eax, %esi                  /* arg 2: the sign-extended call number */
    call    do_syscall_64
```

Watching four keywords is enough: `swapgs`, the kernel stack top, `PUSH_AND_CLEAR_REGS`, and `call do_syscall_64`.
Skip the other entries in the same file for interrupts and NMIs --
that is [Interrupts and Timers](./interrupt-timers.md)'s business.

**Step 2: read `do_syscall_64` in `arch/x86/entry/common.c`.**
Signature: `__visible noinstr bool do_syscall_64(struct pt_regs *regs, int nr)` --
note that `nr` is the assembly's second argument; the C function itself does not read `orig_ax`.
The three things in the body, in order:
`do_syscall_x32` handles the x32 ABI (compiled out if `CONFIG_X86_X32_ABI` is off);
an unsigned bounds check then `array_index_nospec(nr, NR_syscalls)` sanitizes an out-of-range number into a safe index at the hardware level;
`x64_sys_call(regs, nr)` dispatches by number to `__x64_sys_*`.
A dispatch miss with `nr != -1` lands on `__x64_sys_ni_syscall`
(defined by `SYSCALL_DEFINE0(ni_syscall)`, returning `-ENOSYS`);
`nr == -1` is treated as "not a system call" and skipped outright --
the `restart_syscall` re-entry scenario depends on this convention.
The boolean semantics of the return value are in §3.3.

**Step 3: read the `SYSCALL_DEFINE` expansion by comparing `arch/x86/include/asm/syscall_wrapper.h` with `include/linux/syscalls.h`.**
The goal is to expand `SYSCALL_DEFINE3(write, ...)` by hand once and see what each of the three layers does:

```text
SYSCALL_DEFINE3(write, unsigned int, fd, const char __user *, buf, size_t, count)
  ├─ __x64_sys_write(const struct pt_regs *regs)   /* architecture wrapper: di→fd, si→buf, dx→count */
  │    └─ __se_sys_write(long, long, long)          /* unify arguments to long and sign-extend */
  │         └─ __do_sys_write(fd, buf, count)       /* the body you wrote: return ksys_write(...) */
  └─ SYSCALL_METADATA(...)                          /* generates ftrace's sys_enter_write event */
```

x86-64 enables `CONFIG_ARCH_HAS_SYSCALL_WRAPPER`, and `syscall_wrapper.h` redefines the naming of the three layers and "who receives `pt_regs`" --
which is the direct reason the old articles' `sys_write` cannot be found in current source (§6 has a dedicated entry).
Knowing that `SYSCALL_METADATA` is for ftrace is enough; §5.5 cashes it in.

**Step 4: read `ksys_write` and `vfs_write` in `fs/read_write.c` to finish.**
The `SYSCALL_DEFINE3` body is a single line, `return ksys_write(fd, buf, count);` --
the real work, unpacked:

```c
// fs/read_write.c (v6.12, schematic excerpt)
ssize_t ksys_write(unsigned int fd, const char __user *buf, size_t count)
{
    struct fd f = fdget_pos(fd);          /* fd → struct file + file position concurrency protection */
    ...
    ret = vfs_write(f.file, buf, count, ...);
    ...
    fdput_pos(f);
    return ret;
}

ssize_t vfs_write(struct file *file, const char __user *buf, size_t count, loff_t *pos)
{
    ...
    if (file->f_op->write)                 /* the old-style direct write */
        ret = file->f_op->write(...);
    else if (file->f_op->write_iter)       /* the new way: wrap a kiocb and go through write_iter (where all modern filesystems are) */
        ret = new_sync_write(file, buf, count, pos);
    ...
}
```

Stop once you see the `fdget_pos` and the `write_iter` fork --
below that is the VFS generic layer, left for [the next chapter](./vfs-ext4.md) with the question "how does one write reach the disk".
After the four steps, go back to the §3.1 stack diagram:
at every stop you should be able to say "what it defends against".

## 5. Hands-On Tracing ④

Four experiments that go from user space all the way to the kernel entry;
full tool usage is in [Tracing Tools](./tracing-tools.md) -- here only the minimal runnable versions.
Prerequisites: any mainstream distribution; the first two work with strace installed, the last two need root.

### 5.1 strace: Seeing the System Call Boundary

```bash
$ echo hello | strace -e trace=write tee /tmp/out
hello
write(1, "hello\n", 6)                  = 6
write(3, "hello\n", 6)                  = 6
+++ exited with 0 +++
```

`tee` writes the same data to two places: fd 1 (stdout) and fd 3 (the `/tmp/out` it opened itself).
Read five fields off every line:
the function name, the fd number, the buffer's **content** (strace kindly dereferences the address into a string for you), the byte count, and the return value.
`= 6` is the answer the kernel put into rax after walking the whole §3.1 chain.
Switch to `strace -e trace=write,openat,close` and you can see where fd 3 comes from and where it goes --
the birth, life, and death of an fd all happen at the syscall boundary.

### 5.2 Redirection: The fd Number Did Not Change, the struct file Did

```bash
$ strace -e trace=write bash -c 'echo hi > /tmp/f'
write(1, "hi\n", 3)                     = 3
$ cat /tmp/f
hi
```

After redirection, `write`'s fd is still 1 --
the shell did not change the fd number; before `exec` it swapped the `struct file` that fd 1 pointed at to `/tmp/f`.
This is exactly the power of the translation table in `fdget_pos`:
**an fd is a process-local small integer whose meaning is entirely decided by the descriptor table**.
The same experiment conveniently verifies §1.2:
bash's `echo` is a builtin with no `execve`, so there is exactly one `write`.

### 5.3 ftrace: Seeing the Call Depth Below vfs_write

```bash
# cd /sys/kernel/tracing
# echo function_graph > current_tracer
# echo vfs_write > set_graph_function
# echo > trace
# echo data > /tmp/t && cat trace | head -12
```

```text
 0)               |  vfs_write() {
 0)   0.080 us    |    file_start_write();
 0)               |    new_sync_write() {
 0)   0.410 us    |      ext4_file_write_iter();
 0)   0.760 us    |    }
 0)   4.120 us    |  }
```

`set_graph_function` restricts function_graph to the `vfs_write` subtree,
and the output is the real shape below the "boundary" in the §3.1 diagram:
in this example it landed on ext4's `write_iter`
(`/tmp` lives on ext4; on your filesystem the leaf will differ).
The indentation level is the call depth and the microsecond column is the cost of each stop --
the static call chain appears for the first time as "an anatomical diagram with timings".

### 5.4 bpftrace: Accounting for write() Across the Whole Machine

```bash
# bpftrace -e 'kprobe:vfs_write { @[comm] = count(); }'
Attaching 1 probe...
^C

@[systemd-journald]: 14
@[bash]: 3
@[bpftrace]: 1
```

Attach one `kprobe:vfs_write`, count by process name, Ctrl-C for the bill.
Thirty seconds answers duty questions like "who is writing to disk" --
this is the shortest path from source knowledge to an operations weapon:
knowing that `vfs_write` is the throat of every write path is what tells you where to put the probe.

### 5.5 Cashing in SYSCALL_METADATA: Reading the Arguments Straight Out of pt_regs

§2.2 said the macro expands into an ftrace event -- here is where it pays off:

```bash
# cd /sys/kernel/tracing
# echo 1 > events/syscalls/sys_enter_write/enable
# echo 1 > events/syscalls/sys_exit_write/enable
# echo > trace
$ echo x > /tmp/t
# cat trace | grep -E "sys_(enter|exit)_write" | tail -2
  <...>-4127  [000] ....1  1234.567890: sys_enter: fd: 1, buf: 0x7ffd.., count: 2
  <...>-4127  [000] ....2  1234.567891: sys_exit_write: 0x2
```

The `fd/buf/count` in `sys_enter` are exactly the three values the kernel unpacked from `pt_regs`'s `di/si/dx` --
the §2.3 structure materializes here in event form.
Read the two experiments together and you have a complete observation loop:
`sys_enter_*` catches the entrance (arguments, call number semantics),
`kprobe:vfs_write` catches arrivals deep in the kernel (where all entrances converge),
`sys_exit_*` catches the return (return value and duration).
When writing kernel scripts, this "entry event + deep probe" combination answers one more key question than a single-point probe:
**did this call even get there** --
an argument error is at the entrance, a logic error is deep in;
separate the two and you have localized it.

After the five experiments, self-check with three questions to see whether you have truly "seen" the chain:
what number is `write` on this machine (1 on x86-64, see §2.1);
is the §5.3 leaf function your filesystem's own `write_iter` (if the output is uniformly `pipe_write` and friends, you followed the wrong object);
do the three arguments printed in §5.5 match word for word what strace reported in §5.1
(if they match, strace and the tracepoint read the same `pt_regs` snapshot).
Nod to all three, and the static call chain has truly taken root on this machine --
every pitfall of §6 and every hands-on exercise of the later chapters layers on top of this level.

## 6. Common Pitfalls

**In strace, is write's buf an address or the content?** strace kindly dereferences the buffer into a string by default,
but it has two settings for `-e trace=write` and argument dumps:
to reliably get the full buffer content, use the `write=fd` options like `strace -e write=1`,
which hex/text dumps the data written to the specified fd --
the only reliable reading for long buffers and binary content.

**Using i386's call numbers on x86-64.** Call numbers are per-table:
on x86-64, 1 is `write`; on i386, 1 is `exit` and 4 is `write`.
Cross-architecture debugging with the wrong architecture remembered puts a number in the register that hits a completely different call, with symptoms too varied to list.
The authoritative place to check is the kernel source's `<asm/unistd_{64,32}.h>` (generated at build time),
or the table at the end of the man 2 pages.

**glibc's fwrite/printf "under-calling" write.** Loop `printf` ten thousand times and `write` appears only single-digit times in strace --
user-space buffering is merging them, not losing data.
The rule of thumb is §1.2: unless the buffer is full, or an explicit flush happens, or the program exits, no trip through the door.
Conversely, "lost logs" before a crash share the same root;
to land data immediately use `fflush` or direct `write`.

**Grepping 6.x source for the old textbooks' sys_write finds nothing.** After `SYSCALL_DEFINE` expansion the true names carry three layers of prefixes:
`__x64_sys_write` (wrapper), `__se_sys_write` (sign extension), `__do_sys_write` (body);
in ftrace/kprobe also watch the symbol name that kallsyms displays.
Reading a 2.6-era book against 6.x source and finding function names do not match is the normal state --
searching elixir for `SYSCALL_DEFINE.*write` is the safer move.

**vDSO calls vanish from strace.** `gettimeofday`/`clock_gettime` complete in user space via the vDSO and generate no `syscall` events --
"not in strace" does not mean "not executed".
If a benchmark finds that timing overhead exceeds the operation being measured, think of vDSO first;
confirm the path with `ltrace` or by reading `AT_SYSINFO_EHDR` (the vDSO mapping address) in the output of `LD_SHOW_AUXV=1 /bin/true`.

**Mistaking `= -1` for a byte count.** `= -1 EBADF (Bad file descriptor)` in strace is the human-readable form of "returned -1 with errno=EBADF";
what the kernel actually returned deep down is `-EBADF` (a negative errno), and the glibc wrapper layer does the translating.
When writing scripts that parse strace output, branch on "negative means failure" and keep it out of your success statistics.

**Is a write only successful if it wrote count bytes? Short writes are the norm.** A `write` return value less than `count` is not an error
(a full pipe buffer, low disk space, or a signal interruption can all short-write);
it means "please continue" --
the `while (n > 0) { n -= write(fd, p, n); ... }` loop of network programming is not defensive redundancy but the orthodox form.
Short-write semantics may differ per `write_iter` implementation below the vfs layer;
in [VFS and ext4](./vfs-ext4.md) you will see how `generic_perform_write` tops up with `iov_iter_count`.
Same when reading strace:
`write(1, ..., 8192) = 4096` is a legitimate ending, not a bug.

**`?restart_syscall` popping up in strace.** After a signal interrupts a system call, the kernel resumes it with `restart_syscall`
(the `-ERESTARTSYS` path of §3.3),
and strace displays this "sequel" as a pseudo-call prefixed with a question mark --
it is not a real system call, it is not in the call number table, and scripts tallying syscall distributions must exclude it.
A family member is `write(..., 10000000000000000000) = -1 EFAULT` --
`size_t` overflow and argument validation are already caught at `__se_sys_write`'s sign-extension layer.

## 7. Further Reading ⑤

The four books on this topic are used differently; do not walk one of them end to end.

Robert Love's *Linux Kernel Development* has the best first-read chapter on system calls --
a dozen pages that make the design motivation of "argument passing and validation" clear, and after that reading the source is twice the result for half the effort;
its opening argument about "why there must be a user/kernel mode boundary" fills exactly the motivation part of this page's §1.

Bovet & Cesati's *Understanding the Linux Kernel* has the most fully illustrated walkthrough of the system call entry/exit paths;
its field-by-field explanation of `pt_regs` reads best side by side with this page's §2.3
(the book is based on 2.6 and the register details differ somewhat from 6.x, but the framework still holds) --
it explains the slow segment of `syscall_64` on the exit path in far more detail than this page's §3.3;
read that part first when supplementing.

Mao Decao and Hu Ximing's *Annotated Walkthrough of Linux Kernel Source Code* is doing exactly what this page does --
picking one concrete call and following it from start to finish.
The methodology this 2.4-era book teaches is still sharp on 6.12:
function names change, call numbers change, but "find the function from the entry table, then walk the arguments all the way into the filesystem" does not.
Read it as a methodology textbook; do not take its line numbers to current source.

Wolfgang Mauerer's *Professional Linux Kernel Architecture* suits dictionary lookup for details --
the data structure fields left blank in this page's §2 (the `files_struct` layout, the generation details of the dispatch table) have expanded treatments inside.

The version warnings apply uniformly:
function names and file locations defer to current source;
the books' job is to give you the "why", not the "which line".
On the practical side, deep tool usage for this page's four experiments is in [Tracing Tools](./tracing-tools.md);
the journey after `write` passes the door is in [VFS and ext4](./vfs-ext4.md).

## References

- Linux kernel source v6.12 -- [elixir.bootlin.com/linux/v6.12](https://elixir.bootlin.com/linux/v6.12/latest/source)
- The x86-64 system call table itself -- [arch/x86/entry/syscalls/syscall_64.tbl](https://elixir.bootlin.com/linux/v6.12/source/arch/x86/entry/syscalls/syscall_64.tbl)
- man 2 syscall -- [man7.org/linux/man-pages/man2/syscall.2](https://man7.org/linux/man-pages/man2/syscall.2.html)
- man 2 write -- [man7.org/linux/man-pages/man2/write.2](https://man7.org/linux/man-pages/man2/write.2.html)
- man 7 vdso -- [man7.org/linux/man-pages/man7/vdso.7](https://man7.org/linux/man-pages/man7/vdso.7.html)
- x86-64 ABI (registers and system call conventions) -- [refspecs.linuxbase.org](https://gitlab.com/x86-psABIs/x86-64-ABI)
- Robert Love. *Linux Kernel Development*, 3rd ed., the system call chapter
- Daniel P. Bovet & Marco Cesati. *Understanding the Linux Kernel*, 3rd ed., the system call related chapters
- Mao Decao, Hu Ximing. *Annotated Walkthrough of Linux Kernel Source Code* -- the source of the scenario-tracing method

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [README](README.md)
- [driver-framework](driver-framework.md)
- [interrupt-timers](interrupt-timers.md)
- [ipc](ipc.md)
- [process-scheduling](process-scheduling.md)
- [tracing-tools](tracing-tools.md)
- [userland](userland.md)
- [vfs-ext4](vfs-ext4.md)
