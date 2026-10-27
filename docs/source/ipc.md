# Inter-Process Communication (IPC)

Process isolation gives every process its own address space, and conveniently shuts the door on mutual access --
so the kernel had to open a few windows: a signal is a "tap on the shoulder" (asynchronous notification, carrying essentially no data), a pipe is a conveyor belt (a one-way byte stream), System V and POSIX IPC are "meeting rooms" (message queues, semaphores, shared memory), and Unix domain sockets plus memfd are the modern favorites.
This page follows the source-part's unified five-act skeleton -- ① core data structures ② key function call paths ③ source reading order ④ hands-on tracing ⑤ further reading -- with function names and file paths checked one by one against **v6.12**;
tool usage is in [Tracing Tools](./tracing-tools.md), process-side background is in [Process Scheduling](./process-scheduling.md), and this page only covers the mechanism itself.

> Content draws on the Linux kernel v6.12 source tree (function names/files/line numbers cross-checked via elixir) and the books listed at the end (conceptual framework); see the references at the end.

## What This Part Covers

- Use a classification table to explain the semantic differences of six kinds of IPC and where they land in kernel code
- Write from memory the three core data structures: the `sighand_struct` action table and two-level pending queues, the `pipe_inode_info` ring buffer, and the `ipc_ids`/`kern_ipc_perm` ledger
- Walk through three call paths: the kill enqueueing path, the delivery path at the moment of returning to user space, and the pipe() creation and read/write path
- See all three paths with your own eyes using strace, bpftrace, and ipcs, instead of reciting them
- Avoid the six high-frequency pitfalls: signals not queueing, async-signal-safety, pipe deadlock, shared memory leaks, ftok drift, and ESRCH vs. zombies

## 1. Why IPC Is Needed: The Isolation-Collaboration Contradiction

### 1.1 A Classification Table

| Mechanism | Semantics | The carrier in the kernel | Where the code lives (v6.12) |
|------|------|-------------|------------------|
| signal | asynchronous notification: a number plus very little information | the task's pending queue + bitmap | kernel/signal.c |
| pipe / FIFO | one-way byte stream, half-duplex | ring buffer of a pipefs pseudo-inode | fs/pipe.c |
| System V IPC | message queue / semaphore / shared memory, dual-addressed by key and id | kernel objects in the `ipc_ids` ledger | ipc/msg.c, ipc/sem.c, ipc/shm.c, ipc/util.c |
| POSIX IPC | named message queue / semaphore / shared memory | the mqueue filesystem; tmpfs files | ipc/mqueue.c, mm/shmem.c |
| Unix domain socket | full-duplex byte stream / datagram, can pass fds | an in-memory socket abstraction | net/unix/ |
| memfd | anonymous memory file, mmap-able and sealable | anonymous tmpfs inode | mm/shmem.c |

The horizontal axis of this table is actually history:
signals and pipes come from the earliest Unix, System V IPC was made up in the 1980s, POSIX IPC was the redo during standardization, and Unix domain sockets plus memfd are the latecomers that "borrow the mature abstractions of networking and files".
Selection experience in one sentence:
for passing data between processes, new code should prefer Unix domain sockets (full-duplex, can pass file descriptors with `SCM_RIGHTS`, and what systemd/D-Bus are built on) or memfd (large blocks of shared memory);
System V IPC mostly shows up in long-lived software like databases and PostgreSQL -- you read it to maintain, not to build new things;
pipes remain the foundation of every `|` in the shell, and signals are an irreplaceable part of Ctrl+C, crashes, and job control --
the "user-space request enters the kernel" story told in the [System Call Path](./syscall-path.md) chapter plays out here repeatedly.

### 1.2 The Kernel's View: Where IPC Objects Live

Before reading the code, build a sense of space:
signals have no "object" -- they hang off `task_struct`;
pipes have an object but no name -- `pipe_inode_info` is held up by an anonymous inode in the pipefs pseudo-filesystem, and you will never see it in `ls`;
System V IPC has a global ledger (`ipc_namespace`), which is why a global observation command like `ipcs` exists;
POSIX IPC instead goes the file-semantics route -- what `mq_open` creates is visible under `/dev/mqueue`, and what `shm_open` creates is visible under `/dev/shm`.
These four "dwelling styles" determine how you observe each:
observe signals with tracepoints, pipes with strace, System V with ipcs, POSIX with ls.

## 2. Core Data Structures (Act ①)

### 2.1 `sighand_struct`: The Action Table and Two-Level Pending Queues

Everything in the signal system revolves around two tables.
The first is the **action table** -- what each process does with each signal number:

```text
// include/linux/sched/signal.h (v6.12)
struct sighand_struct {
    spinlock_t            siglock;        // protects this struct and the pending queues it points to
    refcount_t            count;          // threads share sighand (with CLONE_SIGHAND the count is just bumped)
    wait_queue_head_t     signalfd_wqh;   // signalfd's wait queue
    struct k_sigaction    action[_NSIG];  // action table: number → SIG_DFL/SIG_IGN/handler
};
// task_struct->sighand (include/linux/sched.h:1155) points to it;
// each k_sigaction embeds a user-visible struct sigaction (include/linux/signal_types.h:51)
```

The `sigaction()` system call modifies exactly this table (see the end of 3.1).
The second is the **pending queue**, and it is two levels deep:
`task_struct->pending` (include/linux/sched.h:1160) is thread-private,
`signal_struct->shared_pending` (include/linux/sched/signal.h:107) is shared by the whole thread group --
`kill(pid)` aimed at a thread group goes into the shared queue,
`tgkill/tkill` aimed at a specific thread goes into the private queue,
and `get_signal` checks both levels when it dequeues.
Each `struct sigpending` consists of a `sigqueue` list (carrying details like si_pid/si_uid) plus a `sigset_t` bitmap (for fast "is this number already in the queue" checks) --
**the bitmap handles merging, the list handles queueing**, which is precisely the physical basis of "standard signals do not queue" later in this page.

### 2.2 `pipe_inode_info`: A Ring of Bytes

A pipe in the kernel is a fixed-slot ring buffer, not the "one contiguous 64KB block of memory" many people imagine:

```text
// include/linux/pipe_fs_i.h (v6.12)
#define PIPE_DEF_BUFFERS 16                     // 16 slots by default × one page per slot = 64 KiB
struct pipe_inode_info {                        // :58
    unsigned int head;      // next slot to write into
    unsigned int tail;      // next slot to read from
    unsigned int max_usage; // number of slots actually usable
    unsigned int ring_size; // size of the bufs[] array (a power of two)
    struct pipe_buffer *bufs;                   // one page per slot; pages need not be contiguous
    wait_queue_head_t rd_wait, wr_wait;         // separate wait queues for readers / writers
    ...
};
```

Three capacity numbers to keep straight:
the **default capacity** is 16 slots, i.e. 64 KiB (`alloc_pipe_info`, initialized from `PIPE_DEF_BUFFERS` starting at fs/pipe.c:790; Section 5.1 measures and verifies this);
**`/proc/sys/fs/pipe-max-size`** (kernel variable `pipe_max_size`, default 1048576) is not a default but the **upper limit** when `F_SETPIPE_SZ` enlarges a pipe -- exceeding it needs `CAP_SYS_RESOURCE` (checked inside `pipe_set_size` in fs/pipe.c);
ordinary users additionally have a per-user soft limit on pipe pages (`pipe_user_pages_soft`; once exceeded, new pipes are reduced to the minimum slot count).
The resize action `F_SETPIPE_SZ` travels from `pipe_fcntl` at fs/fcntl.c:536 through `round_pipe_size` + `pipe_resize_ring` (fs/pipe.c:1247/1266) to reallocate the bufs array --
so capacity is "slot count × page size" rounded to a power of two, not an arbitrary number of bytes.

The essence of a pipe "having no file entity":
`create_pipe_files` (fs/pipe.c:920) uses `new_inode_pseudo` to make an anonymous inode on pipefs, a kernel-internal filesystem,
then `alloc_file_pseudo` to make the write end and `alloc_file_clone` to clone the read end;
both `struct file`s' `private_data` point at the same `inode->i_pipe`,
and both share one operations table, `pipefifo_fops` (fs/pipe.c:1232, `.read_iter = pipe_read`, `.write_iter = pipe_write`).
FIFOs (the named pipes made by `mkfifo`) reuse the same fops, adding only a directory entry and open-time synchronization logic (`fifo_open`, fs/pipe.c:1107) --
a "named pipe" is completely isomorphic to the anonymous pipe at the data-path level.

### 2.3 `ipc_ids` and `kern_ipc_perm`: The System V Ledger

The System V trio (message queues, semaphores, shared memory) share one accounting infrastructure --
which is the reason the ipc/ directory exists:

```text
// include/linux/ipc_namespace.h (v6.12)
struct ipc_namespace {
    struct ipc_ids ids[3];      // :32 — three ledgers: one each for msg, sem, shm
    ...
};
struct ipc_ids {               // :18
    int in_use;                        // number of registered objects (the total in ipcs' first line)
    struct rw_semaphore rwsem;         // ledger-level read-write lock
    struct idr ipcs_idr;               // radix tree from id → object
    struct rhashtable key_ht;          // hash table from key → object (finding an existing object by key)
    unsigned short seq;                // generation number for id reuse, so a stale id cannot hit an old object
};
// every object's head is struct kern_ipc_perm (include/linux/ipc.h:12):
// key, id, uid/gid/cuid/cgid, mode, seq, lock, refcount — the single place where permission checks land
```

Understand dual addressing and you understand every column of `ipcs` output:
the **key** is the "street address", computed by `ftok()` from a path + a number (or let the kernel allocate one with `IPC_PRIVATE`), so unrelated processes can find the same object;
the **id** (shmid/semid/msqid) is the "membership card" you use for subsequent operations after `shmget` succeeds.
Looking up by key goes through the `key_ht` hash table (`ipc_findkey`), looking up by id goes through `ipcs_idr` (`ipc_obtain_object_idr`);
both roads lead to the same `kern_ipc_perm` head --
all permission checks (mode bits, uid/gid) are performed on this head,
which is why shmctl/semctl/msgctl look so alike.

### 2.4 The POSIX Side: The mqueue Filesystem and tmpfs

The biggest difference from System V is POSIX IPC's "everything is a file" landing point.
**POSIX message queues** (the `mq_open` family) are a separate small filesystem in the kernel, `mqueue` (the `mqueue_fs_type` defined in ipc/mqueue.c), mounted at `/dev/mqueue` (verified live on this machine: `mqueue on /dev/mqueue type mqueue`);
each queue is one inode, whose `struct mqueue_inode_info` (ipc/mqueue.c:134) embeds a `struct mq_attr attr` (limits such as mq_maxmsg/mq_msgsize) and a red-black tree `msg_tree` organized by message priority --
`mq_timedsend`/`mq_timedreceive` (ipc/mqueue.c:1284/1298) enter and leave on this tree.
**POSIX shared memory** is more thorough:
glibc's `shm_open` just opens the file `/dev/shm/<name>`, and `/dev/shm` is a tmpfs mount point (verified live: `tmpfs on /dev/shm type tmpfs`);
the subsequent `mmap` goes entirely through the ordinary file-mapping path, landing in mm/shmem.c on the kernel side and never passing through the ipc/ directory at all.
**POSIX semaphores** are likewise a file under `/dev/shm` plus a futex, with no independent kernel object --
compare a System V semaphore, which still maintains a real kernel object in ipc/sem.c,
and the difference in "sense of existence" between the two is obvious at a glance.

## 3. Key Function Call Paths (Act ②)

### 3.1 Signal Sending: The Enqueue Path of kill

```text
// Sending side: only "enqueue + wake"; no handler runs at all
kill(2)
└─ SYSCALL_DEFINE2(kill)            kernel/signal.c:3833
   └─ kill_something_info           kernel/signal.c:1603
      │  pid>0 targets one thread group; pid==0 the current process group; pid==-1 broadcast to all
      ├─ group_send_sig_info        kernel/signal.c:1440   → thread group (into shared_pending)
      └─ do_send_sig_info           kernel/signal.c:1293   → a specific task (into task->pending)
         └─ send_signal_locked      kernel/signal.c:1214
            └─ __send_signal_locked kernel/signal.c:1073   ← where the real work happens
               ├─ prepare_signal    kernel/signal.c:902    filter: while group exiting, only SIGKILL etc. pass
               ├─ legacy_queue      kernel/signal.c:1068   standard signal already in bitmap → return at once (merge!)
               ├─ __sigqueue_alloc + list_add_tail         allocate a sigqueue, hang it on the list, fill si_pid/si_uid
               ├─ sigaddset(&pending->signal, sig)         set the bitmap bit
               └─ complete_signal    kernel/signal.c:994   pick a thread and signal_wake_up it
```

The `legacy_queue` line inside `__send_signal_locked` (`sig < SIGRTMIN && sigismember(&signals->signal, sig)`) is the single most important line of source on this page:
for standard signals (1-31), as soon as a signal of that number is already in the bitmap, a second send simply returns --
**no queueing, no counting**;
real-time signals (from SIGRTMIN up) skip this check and append a fresh `sigqueue` on every send.
At the function's end, `trace_signal_generate` (kernel/signal.c:1186) is the hook point for the bpftrace probe in Section 5.3;
its `result` parameter corresponds to the enum at include/trace/events/signal.h:27: 0 enqueued, 1 ignored, 2 already pending (merged), 3 queue overflow, 4 detail lost with only the signal itself kept.
Note also that the **registration** side is a separate short path:
`rt_sigaction` (kernel/signal.c:4493) → `do_sigaction` (kernel/signal.c:4170) takes `siglock` and rewrites the `action[]` table of Section 2.1, meeting the sending path only at the lock --
changing a disposition does not require "sending" anything.

### 3.2 Signal Delivery: The Moment of Returning to User Space

The sending side only queues the signal and kicks the target awake;
the handler actually runs at the checkpoint where the scheduled thread, **about to return to user space**, checks for work:

```text
// Delivery side: the common checkpoint before interrupt/syscall return to user space
... (any kernel entry point: syscall / interrupt / exception)
└─ exit_to_user_mode_loop           kernel/entry/common.c:90
   └─ ti_work & (_TIF_SIGPENDING | _TIF_NOTIFY_SIGNAL)   :110
      └─ arch_do_signal_or_restart  arch/x86/kernel/signal.c:333
         └─ get_signal              kernel/signal.c:2683
            │  dequeue one from the private/shared pending levels, consult the action[] table:
            │  SIG_IGN → drop it and dequeue the next; SIG_DFL → run the default action (TERM/STOP/CORE/IGN)
            │  handler → choose it, trace_signal_deliver (:2813), and return
            └─ handle_signal        arch/x86/kernel/signal.c:255
               └─ setup_rt_frame    arch/x86/kernel/signal.c:236
                  push siginfo + ucontext onto the user stack, change the return address to the handler;
                  when the handler returns, the original context is restored via the rt_sigreturn syscall
```

This path explains two everyday phenomena:
first, **blocking (sigprocmask) is not discarding** --
a masked signal stays in the pending bitmap and is only delivered at the next return to user space after unmasking;
second, **the handler always runs in user space, on the target thread's own stack** --
the kernel merely fakes a call frame.
Old books (2.4/2.6 era) call the delivery entry `do_notify_resume`; in v6.12 this logic has been refactored into `exit_to_user_mode_loop` → `arch_do_signal_or_restart` (the generic entry framework kernel/entry/ was unified only recently), so translate accordingly when reading old books;
the earlier `__send_signal` is now `__send_signal_locked`.
Incidentally: `get_signal` also contains many branches for job control and ptrace (the default action of SIGSTOP, debugger takeover); this page only walks the trunk, and the scheduling-side wake-up connection is in [Process Scheduling](./process-scheduling.md).

### 3.3 Pipes: Creation, Read/Write, and Blocking

```text
// Creation: pipe() → two files sharing one ring buffer
SYSCALL_DEFINE1(pipe)               fs/pipe.c:1045
└─ SYSCALL_DEFINE2(pipe2)           fs/pipe.c:1040   (pipe is just pipe2 with flags=0)
   └─ __do_pipe_flags
      └─ create_pipe_files          fs/pipe.c:920
         ├─ get_pipe_inode: new_inode_pseudo(pipe_mnt->mnt_sb)   an anonymous inode on pipefs
         ├─ alloc_pipe_info         fs/pipe.c:790    16 slots by default = 64 KiB (see 2.2)
         ├─ alloc_file_pseudo(..., O_WRONLY, &pipefifo_fops)     the write-end file
         └─ alloc_file_clone(..., O_RDONLY,  &pipefifo_fops)     the read-end file

// Read/write: producer-consumer on the ring buffer, two wait queues docking
write(fd[1], ...)
└─ pipe_write                      fs/pipe.c:428
   ├─ ring full → wait_event_interruptible_exclusive(&pipe->wr_wait, pipe_writable)  :579
   ├─ copy_from_iter into the bufs[head] page, advance head
   └─ wake_up_interruptible_sync_poll(&pipe->rd_wait, EPOLLIN)                       :577

read(fd[0], ...)
└─ pipe_read                       fs/pipe.c:251
   ├─ ring empty → wait_event_interruptible_exclusive(&pipe->rd_wait, pipe_readable) :390
   ├─ copy out of bufs[tail], advance tail, release the page if the slot is emptied
   └─ wake_up_interruptible_sync_poll(&pipe->wr_wait, EPOLLOUT)                      :402
```

Two semantic boundaries are decided by **reference counts**, not by data structures:
once every write end is closed, a blocked `read` returns 0 (EOF);
once every read end is closed, `write` gets `EPIPE` and the process is delivered SIGPIPE
(when the shell does not manage that signal, the program exits silently -- this is where "Broken pipe" comes from).
Wakeups use `wake_up_interruptible_sync_poll` with EPOLLIN/EPOLLOUT --
which explains why pipes support epoll/poll natively:
the wait queue and event mask are maintained right in the read/write path.
Pipe pages hang in the buffer and are never copied, so `splice`/`tee` can move data between two pipes with zero copies (in the experiment of 5.1, modern coreutils' `cat` will demonstrate this optimization live).

### 3.4 System V Shared Memory: shmget / shmat

```text
// Creation: key → ledger registration
shmget(key, size, flags)
└─ SYSCALL_DEFINE3(shmget)          ipc/shm.c:842
   └─ ipcget (ipcget_new :339 / ipcget_public :397 in ipc/util.c)
      ├─ key already exists: ipc_findkey (util.c:172) goes through key_ht → permission/size checks → return the existing id
      └─ new: newseg                ipc/shm.c:697   allocate shmid_kernel (embedding kern_ipc_perm)
         └─ ipc_addid               ipc/util.c:278  register in ipcs_idr and key_ht

// Attach: id → page table mapping
shmat(shmid, addr, flags)
└─ SYSCALL_DEFINE3(shmat)           ipc/shm.c:1688
   └─ do_shmat                      ipc/shm.c:1514
      ├─ shm_obtain_object_check    ipc/shm.c:177
      │  └─ ipc_obtain_object_check ipc/util.c:650 → ipc_obtain_object_idr :627 (look the object up by id)
      ├─ permission checks land on kern_ipc_perm's mode/uid (same set as ipcctl_obtain_check :998)
      ├─ borrow a tmpfs file to carry the physical pages (shared memory resides in memory but goes through the file abstraction, see 2.4)
      └─ do_mmap                    ipc/shm.c:1657   establish page table mappings into the calling process's address space

shmdt(addr) → SYSCALL_DEFINE1(shmdt) ipc/shm.c:1829  detaches this process's mapping only;
IPC_RMID   → shmctl                       marks the object destroyed, freed once the last attacher leaves
```

The most instructive thing on this path is the "ledger and body are separate" design:
after `shmget` the object already lives in the kernel ledger (immediately visible in `ipcs -m`),
`shmat` merely wires your process's page tables up to it, and `shmdt` merely cuts your own wires --
the object body itself only disappears after `IPC_RMID` **and** the reference count reaches zero.
This is exactly the structural root of the "shared memory leak" in Section 6.4.
Message queues and semaphores (ipc/msg.c, ipc/sem.c) go through exactly the same ledger layer;
once you have read shm, reading them, the only new things are their respective data paths.

## 4. Source Reading Order (Act ③)

### 4.1 Stop One: fs/pipe.c -- The Smallest Complete IPC

Around 1500 lines, yet covering the full lifecycle of one IPC mechanism:
creation (`create_pipe_files`), read/write (`pipe_read`/`pipe_write`), resizing (`pipe_set_size`), teardown (`free_pipe_info`) --
and no namespace ledger to worry about.
How to read it:
start from the operations table `pipefifo_fops` (:1232), work backwards from `.read_iter`/`.write_iter` into `pipe_read`/`pipe_write`, and walk the head/tail ring logic through;
then come back to `create_pipe_files` to understand the "pseudo inode + two files" skeleton.
Once you have read it, you have a feel for "what an IPC object looks like inside the kernel".

### 4.2 Stop Two: kernel/signal.c -- The Most Complex IPC

Nearly 5000 lines; do not read from the top.
Take what you need from three short lines:
the registration line is shortest (`rt_sigaction` :4493 → `do_sigaction` :4170, it merely edits a table);
for the sending line read `__send_signal_locked` (:1073), focusing on the bitmap-and-list cooperation described in Section 2.1;
for the delivery line read `get_signal` (:2683) together with `arch_do_signal_or_restart` (:333) and `setup_rt_frame` (:236) in arch/x86/kernel/signal.c, to see "how the kernel fakes a handler call frame on the user stack".
Of kernel/entry/common.c's `exit_to_user_mode_loop` (:90) you only need to remember that it is the checkpoint shared by every entry point.

### 4.3 Stop Three: ipc/util.c + ipc/shm.c -- Ledger-Style IPC

First read the ledger primitives of ipc/util.c as a single line:
`ipc_init_ids` (:115, ledger initialization) → `ipc_findkey` (:172, find by key) → `ipc_addid` (:278, register) → `ipc_obtain_object_idr` (:627, fetch by id).
Then enter ipc/shm.c and read only two functions:
`newseg` (:697, the object's birth) and `do_shmat` (:1514, page table wiring).
The ledger calls of msg/sem are word-for-word identical to shm's; consult them when needed.

### 4.4 Dictionary and Anchors

Structure definitions are concentrated in include/linux/pipe_fs_i.h, include/linux/sched/signal.h, include/linux/ipc.h, and include/linux/ipc_namespace.h --
treat them as a dictionary, not something to read through in order.
Look symbols up with the [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/source/) online cross-reference;
the line numbers cited on this page were all checked against v6.12, but they drift between kernel minor versions,
so **anchor on symbol names and treat line numbers as road signs** (how to obtain the source is in [Source Tree](./source-tree.md)).

## 5. Hands-On Tracing (Act ④)

### 5.1 Watching Pipes with strace: From pipe2 to EOF

```bash
$ strace -f -o /tmp/pipe.trace bash -c 'echo hi | cat'
hi
$ grep -E 'pipe2|clone\(|dup2|pipe\(\[|SETPIPE|splice|write\(1, "hi|read\(3, "hi|read\(0, ""' /tmp/pipe.trace
pipe2([3, 4], 0)                 = 0
clone(child_stack=NULL, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, ...) = 724683
clone(child_stack=NULL, flags=CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|SIGCHLD, ...) = 724684
724683 dup2(4, 1)                = 1
724684 dup2(3, 0)                = 0
724683 write(1, "hi\n", 3)       = 3
724684 splice(0, NULL, 1, NULL, 1048576, 0) = -1 EINVAL (Invalid argument)
724684 pipe([3, 4])              = 0
724684 fcntl(3, F_SETPIPE_SZ, 1048576) = 1048576
724684 splice(0, NULL, 4, NULL, 1048576, 0) = 3
724684 splice(3, NULL, 1, NULL, 3, 0)   = -1 EINVAL (Invalid argument)
724684 read(3, "hi\n", 16384)    = 3
724684 write(1, "hi\n", 3)       = 3
724684 read(0, "", 65536)        = 0
```

Line by line, back to Section 3.3:
bash obtains read end 3 / write end 4 with one `pipe2`, forks two children, and each one wires itself up with `dup2` (echo's stdout to the write end, cat's stdin to the read end);
echo `write`s 3 bytes into the ring buffer;
and the final `read(0, "", 65536) = 0` is the live evidence of "all write ends closed → EOF".
The middle lines are a bonus:
when modern coreutils' `cat` detects that its input is a pipe, it builds an internal pipe of its own, enlarges it to 1 MiB with `F_SETPIPE_SZ`, and tries `splice` zero-copy first (the two EINVALs are because stdout is not a pipe, so it falls back to read/write) --
the resize cap described in Section 2.2 (1048576 exactly equals the default `pipe-max-size`, needing no privilege) happens daily inside system tools.
Now verify the default capacity:

```bash
$ python3 -c "import fcntl, os; r, w = os.pipe(); print('F_GETPIPE_SZ =', fcntl.fcntl(w, 1032))"
F_GETPIPE_SZ = 65536
```

16 slots × 4 KiB = 65536, reconciling with the source accounting of `PIPE_DEF_BUFFERS` (1032 is the command number of `F_GETPIPE_SZ`, see linux/fcntl.h).

### 5.2 A sigaction Sample: Register a Handler Yourself

```c
/* sigdemo.c — compile: gcc -Wall -o sigdemo sigdemo.c */
#include <stdio.h>
#include <signal.h>
#include <unistd.h>

static void handler(int sig, siginfo_t *info, void *ucontext)
{
    /* inside a handler use only async-signal-safe functions: write(2) is on the whitelist, printf is not */
    char buf[64];
    int n = snprintf(buf, sizeof buf, "[handler] sig=%d from pid=%d code=%d\n",
                     sig, info->si_pid, info->si_code);
    write(STDOUT_FILENO, buf, n);
}

int main(void)
{
    struct sigaction sa = {0};
    sa.sa_sigaction = handler;
    sa.sa_flags = SA_SIGINFO;          /* the three-argument siginfo form, matching setup_rt_frame */
    sigemptyset(&sa.sa_mask);
    if (sigaction(SIGUSR1, &sa, NULL) == -1)
        return 1;
    printf("my pid = %d, waiting for SIGUSR1...\n", getpid());
    fflush(stdout);
    pause();                           /* sleep until a signal arrives (see the wake chain in 3.1) */
    printf("woken up, bye\n");
    return 0;
}
```

```bash
$ gcc -Wall -o sigdemo sigdemo.c && ./sigdemo &
my pid = 641428, waiting for SIGUSR1...
$ kill -USR1 641428
[handler] sig=10 from pid=641427 code=0
woken up, bye
```

`kill -USR1` walks the whole enqueue path of 3.1, filling the writing shell's pid into `si_pid`;
once `./sigdemo` is woken, it walks the delivery path of 3.2 at the return-to-user-space checkpoint,
and the `sig=10` (SIGUSR1's number) and `code=0` (`SI_USER`, coming from kill(2)) printed by the handler were both filled in by the kernel inside `__send_signal_locked`.
`pause` waking up shows that after the handler returns, the flow of control resumes right after `pause` --
this is the complete process of `setup_rt_frame` faking the frame and `rt_sigreturn` restoring it.

### 5.3 Watching Signal Generation and "No Queueing" with bpftrace

Use a victim that has SIGUSR1 blocked as the target first (the signal will sit in pending, which makes repeated sends easy to observe):

```python
# victim.py — block SIGUSR1 then sleep; the signals all accumulate in the pending bitmap
import signal, os, time
signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGUSR1})
print("victim pid =", os.getpid(), flush=True)
time.sleep(30)
```

```bash
$ python3 victim.py &
victim pid = 784547
$ sudo bpftrace -e 'tracepoint:signal:signal_generate /args->sig == 10 && args->pid == 784547/ {
    printf("%-8s pid=%-6d sig=%d grp=%d res=%d\n", args->comm, args->pid, args->sig, args->group, args->result); }'
Attached 1 probe
python3  pid=784547 sig=10 grp=1 res=0      # first kill: enqueued successfully (DELIVERED)
python3  pid=784547 sig=10 grp=1 res=2      # second kill: already pending (ALREADY_PENDING, merged!)
python3  pid=784547 sig=10 grp=1 res=2      # third kill: merged as well
$ kill -USR1 784547; kill -USR1 784547; kill -USR1 784547
```

bpftrace holds the foreground and keeps printing while another terminal fires `kill -USR1 784547` three times --
the victim has SIGUSR1 masked, so all three signals sit in pending, laying the merge logic bare.
`res` is exactly the result enum of `trace_signal_generate` from Section 3.1: 0 enqueued, 1 ignored, 2 already pending, 3 overflow, 4 detail lost.
Three `kill -USR1`s enqueue exactly once --
that line of `legacy_queue` source reveals itself on the observation surface, and this is the on-site evidence for the Section 6.1 pitfall.
Note that in the probe's fields, `comm`/`pid` are the **target process** (the tracepoint fires in the sender's context, but the fields are filled by target);
the `args->pid` in the filter is there because on a busy machine you will be flooded without it (measured on this very example: dockerd's SIGURG traffic within the same second).
bpftrace installation and syntax are in [Tracing Tools](./tracing-tools.md).

### 5.4 ipcs / ipcmk: The Birth and Death of System V Objects

```bash
$ ipcmk -M 1048576 -Q -S 1
Shared memory id: 32768
Message queue id: 0
Semaphore id: 1
$ ipcs
------ Message Queues --------
key        msqid      owner      perms      used-bytes   messages
0x398360be 0          cui        644        0            0
------ Shared Memory Segments --------
key        shmid      owner      perms      bytes      nattch     status
0xdb8f799c 32768      cui        644        1048576    0
------ Semaphore Arrays --------
key        semid      owner      perms      nsems
0x1dfc5dee 1          cui        644        1
$ ipcrm -m 32768 -q 0 -s 1     # delete when done; do not leave accounts lying around on the system
```

Cross-check with Section 2.3:
`ipcmk` generates keys at random, and the key/shmid/owner/perms columns all come from the `kern_ipc_perm` head;
`nattch 0` means no process has `shmat`-ed yet (only ledger registration, no page table wiring).
Note that these objects stay alive until `ipcrm` --
**exiting the process does not take them away** (the setup for the Section 6.4 pitfall).
The POSIX side can equally be seen and handled:
`ls /dev/mqueue/` to see message queues, `df -h /dev/shm` to see the tmpfs capacity eaten by POSIX shared memory.

### 5.5 The Kernel Journey of Ctrl+Z: SIGTSTP and SIGCONT

Pressing Ctrl+Z in a terminal is equivalent to `kill -TSTP` (the terminal driver translates the keystroke into a SIGTSTP sent to the foreground process group):

```bash
$ sleep 300 &
[1] 790667
$ ps -o stat,pid,comm -p 790667
STAT     PID COMMAND
S     790667 sleep
$ kill -TSTP 790667
$ ps -o stat,pid,comm -p 790667
STAT     PID COMMAND
T     790667 sleep
$ kill -CONT 790667
$ ps -o stat,pid,comm -p 790667
STAT     PID COMMAND
S     790667 sleep
```

The kernel-side journey strings the two paths together perfectly:
SIGTSTP enqueues via 3.1; on delivery, `get_signal` consults action[] and finds `SIG_DFL`, whose default action "stop" sets the task to `__TASK_STOPPED` (the T in STAT);
SIGCONT is the only signal that can wake a stopped task (the special case in `prepare_signal` that mutually cleans up stop/cont), and the task returns to S.
`fg`/`bg` merely add the job control protocol on top of this (SIGCONT plus terminal foreground/background ownership) --
the kernel laid the mechanism long ago.

## 6. Common Pitfalls

**Sending the same signal three times and the handler only runs once.** Standard signals (1-31) have exactly one slot in the pending bitmap:
the second send is merged outright by `legacy_queue` (measured as res=2 in 5.3),
which is why rapid-fire SIGCHLD makes `waitpid` reap fewer children and SIGUSR1 counting loses events.
Choose the fix to fit your need:
to "count every one", use real-time signals (from SIGRTMIN up; they queue and can carry sigqueue data);
to "align state", set a `volatile sig_atomic_t` flag in the handler only and clear it in the main loop after handling --
the flag naturally converts the merge semantics into "at least one happened".

**printf/malloc inside a signal handler, occasional deadlock or crash.** The handler can interrupt the main program between any two instructions:
reentering printf while it holds the stdio internal lock, or malloc while it is mid-edit of heap metadata, is undefined behavior.
The discipline is to call only functions on the man signal-safety(7) whitelist inside a handler (write, _exit, and their flag-bearer kin),
or simply use `signalfd` to turn signals into an epoll-able file descriptor and handle them as ordinary events in the main loop --
treat an asynchronous problem asynchronously and return to the synchronous world.

**Two processes talking both ways over one pipe and deadlocking each other.** A pipe is strictly half-duplex:
if A writes on the write end while B writes its own requests on the same pipe's write end, neither side can ever read a complete message.
Another variant: writing more than the default 64 KiB capacity in one direction while the peer never reads --
`pipe_write` blocks on wr_wait, and if the peer is then waiting on some other resource you have a cycle.
The way out:
for two-way communication use `socketpair(AF_UNIX, ...)` or two pipes with an explicit division of labor;
for heavy traffic enlarge the pipe with `F_SETPIPE_SZ` (for ordinary users the cap is `/proc/sys/fs/pipe-max-size`, default 1 MiB) or move the data with `splice`.

**Shared memory piling up in ipcs until /dev/shm is full.** System V object lifetimes are independent of processes:
after `shmat`, if the process crashes the mapping detaches automatically but the object remains in the ledger (`nattch 0` still listed);
an `ipcmk` whose `IPC_RMID` was forgotten is permanent garbage.
Same on the POSIX side --
`/dev/shm` is tmpfs, backed by memory, and once it is full anonymous mmap pages start failing.
The way out:
guarantee in code that `IPC_RMID`/`shm_unlink` always run (including on error paths),
and in operations add `ipcs -m` and `df /dev/shm` to routine inspection (the baseline-comparison mindset is the same as [Performance](../system-management/performance.md)),
checking ownership of old nattch=0 objects before deleting them.

**The ftok key has not changed but shmget cannot find the old object.** `ftok(path, id)` computes its key from "the path's inode number + device number + id" --
the path string is unchanged, but if the file was recreated (an editor's atomic save deletes and rewrites), the inode changed and the key drifted;
two different paths can also collide onto the same key.
The symptom is the same configuration returning ENOENT on one side and EEXIST on the other, working fine after a reboot.
The way out:
dedicate the key file to one purpose and never overwrite it;
the more robust approach is to create with `IPC_PRIVATE` and pass the id to the collaborating process via a file/pipe/environment, bypassing the key guessing game.

**kill reports ESRCH but ps still shows the process.** Two cases must be separated:
`No such process` (ESRCH) means the task_struct is really gone from the kernel --
either already reaped, or you misremembered the pid (note that `kill`'s argument is tgid/thread-group semantics; the LWP column in `ps -eLf` is the thread number, and killing with it gives ESRCH in some scenarios);
the one you can see but cannot kill is the **zombie** --
the task_struct still exists (waiting for its parent's wait), but the process has long terminated, SIGKILL is meaningless to it, and no executor remains to handle any delivered signal.
The correct fix for a zombie is to make the parent `wait`/exit (it gets reaped after being reparented to init);
the ledger details of the process exit path are in [Process Scheduling](./process-scheduling.md).

## 7. Further Reading (Act ⑤)

Books matched to topics (titles and chapters verified; each book is based on an old kernel, so translate the function names using this page's correspondence table):

- **The standard reference for signals and System V IPC**: Bovet & Cesati's *Understanding the Linux Kernel* (3rd ed., based on 2.6) -- the Generating a Signal / Delivering a Signal sections of Chapter 11, Signals, correspond exactly to the two paths of Sections 3.1/3.2 here; Chapter 19, Process Communication, contains Pipes, FIFOs, System V IPC, and POSIX Message Queues, and its classic diagrams of key/id dual addressing are still usable
- **The Chinese line-by-line walkthrough**: Mao Decao and Hu Ximing's *Annotated Walkthrough of Linux Kernel Source Code* (based on 2.4.0) -- inter-process communication gets two whole chapters: Chapter 6 "Traditional Unix Inter-Process Communication" (signals, pipes, and the System V trio, line by line) and Chapter 7 "Socket-Based Inter-Process Communication" (Unix domain); no other book matches its density of line-level walkthroughs, but translate the function names to 6.x using this page
- **Stated honestly**: Robert Love's *Linux Kernel Development* (LKD, 3rd ed., based on 2.6) has no standalone IPC chapter in its 20 chapters --
  IPC was never its strength, and it is not recommended for this topic; its value is in the process/scheduling/interrupt chapters (see the citations on those pages)
- **The man pages (all verified present on this machine)**: man 7 signal (the semantics summary table), man 7 signal-safety (the async-signal-safe whitelist), man 7 pipe (pipe capacity and F_SETPIPE_SZ), man 7 fifo, man 7 sysvipc (the key/id/permission model), man 7 mq_overview / shm_overview / sem_overview (the three POSIX entry points)
- **First-hand source**: the [elixir.bootlin.com v6.12 cross-reference](https://elixir.bootlin.com/linux/v6.12/source/) -- every function name and line number on this page can be re-verified there; the three landing points fs/pipe.c, kernel/signal.c, and ipc/ are in the Section 4 reading order
- **Tool details**: the bpftrace/ftrace chapters of [Tracing Tools](./tracing-tools.md) (the probe syntax and filter writing for Section 5.3 here); everyday shell and service use of pipes/sockets is in [Process Commands](../commands/system/process.md)

## References

- Linux kernel source v6.12 -- [elixir.bootlin.com/linux/v6.12](https://elixir.bootlin.com/linux/v6.12/latest/source) (fs/pipe.c, kernel/signal.c, kernel/entry/common.c, arch/x86/kernel/signal.c, ipc/util.c, ipc/shm.c, ipc/mqueue.c, and the relevant headers)
- man pages -- man 7 signal, man 7 signal-safety, man 7 pipe, man 7 fifo, man 7 sysvipc, man 7 mq_overview, man 7 shm_overview
- Daniel P. Bovet & Marco Cesati. *Understanding the Linux Kernel*, 3rd ed., Chapters 11 and 19
- Mao Decao, Hu Ximing. *Annotated Walkthrough of Linux Kernel Source Code*, Chapters 6 and 7 (Zhejiang University Press)
- Robert Love. *Linux Kernel Development*, 3rd ed.
- Index of kernel IPC subsystem documentation -- [docs.kernel.org](https://docs.kernel.org/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [README](README.md)
