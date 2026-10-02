# 进程间通信（IPC）

进程隔离给了每个进程独立的地址空间，也顺手关上了互相访问的门——内核只好再开几扇窗：信号是"拍肩膀"（异步通知，基本不带数据），管道是"传送带"（单向字节流），System V 与 POSIX IPC 是"会议室"（消息队列、信号量、共享内存），Unix 域套接字与 memfd 则是现代新贵。本页沿用源码篇统一五段式骨架——① 核心数据结构 ② 关键函数调用路径 ③ 源码阅读顺序 ④ 实操跟踪 ⑤ 延伸资料，函数名与文件路径按 **v6.12** 逐一核对；工具用法见[跟踪工具](./tracing-tools.md)，进程侧背景见[进程管理与调度](./process-scheduling.md)，本页只讲机制本身。

> 内容参考自 Linux 内核 v6.12 源码树（函数名/文件/行号经 elixir 交叉引用核对）与文末书目（概念框架），见文末参考资料。

## 学习目标

- 拿着一张分类表说清六类 IPC 的语义差异与内核代码落点，能为新代码做选型
- 默写三套核心数据结构：`sighand_struct` 的动作表与两级 pending 队列、`pipe_inode_info` 的环形缓冲、`ipc_ids`/`kern_ipc_perm` 的账本
- 走通三条调用路径：kill 的入队路、信号在返回用户态那一刻的投递路、pipe() 的创建与读写路
- 用 strace、bpftrace、ipcs 把上面三条路径亲眼看到，而不是背出来
- 避开信号不排队、异步信号安全、管道死锁、共享内存泄漏、ftok 漂移、ESRCH 与僵尸这六个高频坑

## 1. 为什么需要 IPC：隔离与协作的矛盾

### 1.1 一张分类表

| 机制 | 语义 | 内核里的载体 | 代码落点（v6.12） |
|------|------|-------------|------------------|
| 信号 signal | 异步通知，编号 + 极少量信息 | task 的 pending 队列 + 位图 | kernel/signal.c |
| 管道 pipe / FIFO | 单向字节流，半双工 | pipefs 伪 inode 的环形缓冲 | fs/pipe.c |
| System V IPC | 消息队列 / 信号量 / 共享内存，key 与 id 双寻址 | `ipc_ids` 账本里的内核对象 | ipc/msg.c、ipc/sem.c、ipc/shm.c、ipc/util.c |
| POSIX IPC | 命名的消息队列 / 信号量 / 共享内存 | mqueue 文件系统；tmpfs 文件 | ipc/mqueue.c、mm/shmem.c |
| Unix 域套接字 | 全双工字节流/数据报，可传 fd | 内存里的 socket 抽象 | net/unix/ |
| memfd | 匿名内存文件，可 mmap 可 seal | tmpfs 匿名 inode | mm/shmem.c |

这张表的横轴其实是历史：信号与管道来自最早期的 Unix，System V IPC 是 1980 年代补的课，POSIX IPC 是标准化时的重做，Unix 域套接字与 memfd 是"把网络与文件的成熟抽象借来用"的后来者。选型经验一句话：进程间传数据，新代码优先 Unix 域套接字（全双工、能 `SCM_RIGHTS` 传文件描述符、systemd/D-Bus 都靠它）或 memfd（大块共享内存）；System V IPC 多见于数据库、PostgreSQL 这类历史悠久的软件，读懂它是为了维护而非新建；管道仍是 shell 一切 `|` 的地基，信号则是 Ctrl+C、崩溃、作业控制这些语义里不可替代的一环——[系统调用路径](./syscall-path.md)讲过的"用户态请求进内核"在这里反复上演。

### 1.2 内核视角：IPC 对象住在哪里

看代码前先建立一个空间感：信号没有"对象"，它挂在 `task_struct` 身上；管道有对象但没有名字——`pipe_inode_info` 由 pipefs 伪文件系统里的匿名 inode 撑着，`ls` 里永远看不到它；System V IPC 有全局账本（`ipc_namespace`），所以才有 `ipcs` 这样的全局观测命令；POSIX IPC 反而走文件语义——`mq_open` 创建的东西能在 `/dev/mqueue` 下看到，`shm_open` 创建的能在 `/dev/shm` 下看到。这四种"住法"决定了各自的观测方式：信号用 tracepoint 看，管道用 strace 看，System V 用 ipcs 看，POSIX 用 ls 看。

## 2. 核心数据结构（五段式 ①）

### 2.1 `sighand_struct`：动作表与两级 pending 队列

信号系统的一切都围着两张表转。第一张是**动作表**——每个进程对每个信号编号的处置方式：

```text
// include/linux/sched/signal.h（v6.12）
struct sighand_struct {
    spinlock_t            siglock;        // 保护本结构与其指向的 pending 队列
    refcount_t            count;          // 线程共享 sighand（CLONE_SIGHAND 时只加计数）
    wait_queue_head_t     signalfd_wqh;   // signalfd 的等待队列
    struct k_sigaction    action[_NSIG];  // 动作表：编号 → SIG_DFL/SIG_IGN/handler
};
// task_struct->sighand（include/linux/sched.h:1155）指向它；
// 每个 k_sigaction 内嵌一个用户可见的 struct sigaction（include/linux/signal_types.h:51）
```

`sigaction()` 系统调用改的就是这张表（见 3.1 末尾）。第二张是**pending 队列**，而且是两级：`task_struct->pending`（include/linux/sched.h:1160）是线程私有的，`signal_struct->shared_pending`（include/linux/sched/signal.h:107）是整个线程组共享的——`kill(pid)` 发给线程组进共享队列，`tgkill/tkill` 发给特定线程进私有队列，`get_signal` 摘取时两级都查。每个 `struct sigpending` 由一条 `sigqueue` 链表（承载 si_pid/si_uid 等 detail）加一个 `sigset_t` 位图（快速判断"这个编号在不在队里"）组成——**位图管合并、链表管排队**，这正是后文"标准信号不排队"的物理基础。

### 2.2 `pipe_inode_info`：一条环形字节流

管道在内核里是一个固定槽位的环形缓冲，不是很多人想象中的"连续 64KB 内存"：

```text
// include/linux/pipe_fs_i.h（v6.12）
#define PIPE_DEF_BUFFERS 16                     // 默认 16 槽 × 每槽一页 = 64 KiB
struct pipe_inode_info {                        // :58
    unsigned int head;      // 下一个写入槽
    unsigned int tail;      // 下一个读出槽
    unsigned int max_usage; // 实际可用的槽位数
    unsigned int ring_size; // bufs[] 数组大小（2 的幂）
    struct pipe_buffer *bufs;                   // 每槽一页，页可以不连续
    wait_queue_head_t rd_wait, wr_wait;         // 读者/写者各自的等待队列
    ...
};
```

三个容量数字要分清：**默认容量**是 16 槽即 64 KiB（`alloc_pipe_info`，fs/pipe.c:790 起用 `PIPE_DEF_BUFFERS` 初始化，本页 5.1 会实测验证）；**`/proc/sys/fs/pipe-max-size`**（内核变量 `pipe_max_size`，默认 1048576）不是默认值，而是 `F_SETPIPE_SZ` 扩容时的上限，超过它需要 `CAP_SYS_RESOURCE`（fs/pipe.c 的 `pipe_set_size` 里检查）；普通用户还有按用户的管道页数软限额（`pipe_user_pages_soft`，超了会把新管道降到最小槽数）。扩容动作 `F_SETPIPE_SZ` 从 fs/fcntl.c:536 的 `pipe_fcntl` 一路走到 `round_pipe_size` + `pipe_resize_ring`（fs/pipe.c:1247/1266）重新分配 bufs 数组——所以容量是"槽位数×页大小"向上取整，不是任意字节。

管道"没有文件实体"的本质：`create_pipe_files`（fs/pipe.c:920）在 pipefs 这个内核内部文件系统上用 `new_inode_pseudo` 造一个匿名 inode，再用 `alloc_file_pseudo` 造写端、`alloc_file_clone` 克隆出读端，两个 `struct file` 的 `private_data` 都指向同一个 `inode->i_pipe`，操作表统一是 `pipefifo_fops`（fs/pipe.c:1232，`.read_iter = pipe_read`、`.write_iter = pipe_write`）。FIFO（`mkfifo` 命名的管道）复用同一套 fops，只是多了目录项和打开时的同步逻辑（`fifo_open`，fs/pipe.c:1107）——"有名字的管道"在数据通路层面与匿名管道完全同构。

### 2.3 `ipc_ids` 与 `kern_ipc_perm`：System V 的账本

System V 三件套（消息队列/信号量/共享内存）共用一套记账基础设施，这是 ipc/ 目录存在的理由：

```text
// include/linux/ipc_namespace.h（v6.12）
struct ipc_namespace {
    struct ipc_ids ids[3];      // :32 —— 三个账本：msg、sem、shm 各一
    ...
};
struct ipc_ids {               // :18
    int in_use;                        // 在册对象数（ipcs 第一行看到的总量）
    struct rw_semaphore rwsem;         // 账本级读写锁
    struct idr ipcs_idr;               // id → 对象 的 radix 树
    struct rhashtable key_ht;          // key → 对象 的哈希表（按 key 找已有对象）
    unsigned short seq;                // id 复用代数，防悬空 id 撞旧对象
};
// 每个对象头部都是 struct kern_ipc_perm（include/linux/ipc.h:12）：
// key、id、uid/gid/cuid/cgid、mode、seq、lock、refcount —— 权限检查的统一落点
```

理解双寻址就理解了 `ipcs` 输出的全部列：**key** 是"门牌号"，由 `ftok()` 从路径+编号算出（或用 `IPC_PRIVATE` 让内核分配），供不相干的进程找到同一个对象；**id**（shmid/semid/msqid）是"会员卡"，`shmget` 成功后凭它做后续操作。查 key 走 `key_ht` 哈希表（`ipc_findkey`），查 id 走 `ipcs_idr`（`ipc_obtain_object_idr`），两条路都通向同一个 `kern_ipc_perm` 头——所有权限检查（mode 位、uid/gid）都在这个头部上完成，这就是 shmctl/semctl/msgctl 系列看起来长得一样的缘故。

### 2.4 POSIX 侧：mqueue 文件系统与 tmpfs

POSIX IPC 与 System V 的最大差别是"一切皆文件"的落点。**POSIX 消息队列**（`mq_open` 那一族）在内核里是独立的小文件系统 `mqueue`（ipc/mqueue.c 里定义 `mqueue_fs_type`），挂载在 `/dev/mqueue`（本机实测：`mqueue on /dev/mqueue type mqueue`）；每个队列是一个 inode，对应的 `struct mqueue_inode_info`（ipc/mqueue.c:134）内嵌 `struct mq_attr attr`（mq_maxmsg/mq_msgsize 等限额）和一棵按消息优先级组织的红黑树 `msg_tree`——`mq_timedsend`/`mq_timedreceive`（ipc/mqueue.c:1284/1298）就在这棵树上进出。**POSIX 共享内存**更彻底：glibc 的 `shm_open` 就是打开 `/dev/shm/<名字>` 这个文件，而 `/dev/shm` 是 tmpfs 挂载点（本机实测：`tmpfs on /dev/shm type tmpfs`），后续 `mmap` 完全走普通文件映射路径，内核侧落在 mm/shmem.c，根本不经过 ipc/ 目录。**POSIX 信号量**同样是 `/dev/shm` 下的文件加 futex，没有独立内核对象——对比 System V 信号量还在 ipc/sem.c 里维护真正的内核对象，两者的"存在感"差异一目了然。

## 3. 关键函数调用路径（五段式 ②）

### 3.1 信号发送：kill 的入队之路

```text
// 发送侧：只做"入队 + 唤醒"，不执行任何处理函数
kill(2)
└─ SYSCALL_DEFINE2(kill)            kernel/signal.c:3833
   └─ kill_something_info           kernel/signal.c:1603
      │  pid>0 定向一个线程组；pid==0 本进程组；pid==-1 广播所有进程
      ├─ group_send_sig_info        kernel/signal.c:1440   → 线程组（进 shared_pending）
      └─ do_send_sig_info           kernel/signal.c:1293   → 指定 task（进 task->pending）
         └─ send_signal_locked      kernel/signal.c:1214
            └─ __send_signal_locked kernel/signal.c:1073   ← 真正干活的地方
               ├─ prepare_signal    kernel/signal.c:902    过滤：组退出中只放 SIGKILL 等
               ├─ legacy_queue      kernel/signal.c:1068   标准信号已在位图 → 直接返回（合并！）
               ├─ __sigqueue_alloc + list_add_tail         分配 sigqueue 挂链表，填 si_pid/si_uid
               ├─ sigaddset(&pending->signal, sig)         位图置位
               └─ complete_signal    kernel/signal.c:994   挑一个线程 signal_wake_up 唤醒
```

`__send_signal_locked` 里那行 `legacy_queue`（`sig < SIGRTMIN && sigismember(&signals->signal, sig)`）是全页最重要的一行源码：标准信号（1–31）只要位图里已有同号信号，第二次发送就直接返回——**不排队、不计数**；实时信号（SIGRTMIN 起）不做这个检查，每次发送都追加一条 `sigqueue`。函数末尾的 `trace_signal_generate`（kernel/signal.c:1186）就是 5.3 节 bpftrace 探针的挂点，它的 `result` 参数对应 include/trace/events/signal.h:27 的枚举：0 已入队、1 被忽略、2 已在排队（合并）、3 队列溢出、4 丢失 detail 仅保留信号本身。另外注意**注册侧**是另一条短路：`rt_sigaction`（kernel/signal.c:4493）→ `do_sigaction`（kernel/signal.c:4170）拿 `siglock` 改写 2.1 节的 `action[]` 表，与发送路径只在锁上交汇——改处置方式不需要"发"任何东西。

### 3.2 信号投递：返回用户态的那一刻

发送侧只负责把信号放进队列并踢醒目标；处理函数真正执行，发生在目标线程被调度回来、**准备返回用户态**的那个检查点：

```text
// 投递侧：中断/系统调用返回用户态前的统一检查点
...（任意内核态入口：系统调用/中断/异常）
└─ exit_to_user_mode_loop           kernel/entry/common.c:90
   └─ ti_work & (_TIF_SIGPENDING | _TIF_NOTIFY_SIGNAL)   :110
      └─ arch_do_signal_or_restart  arch/x86/kernel/signal.c:333
         └─ get_signal              kernel/signal.c:2683
            │  从 private/shared 两级 pending 摘一条，查 action[] 表：
            │  SIG_IGN → 丢弃继续摘下一条；SIG_DFL → 执行默认动作（TERM/STOP/CORE/IGN）
            │  handler → 选定它，trace_signal_deliver（:2813）后返回
            └─ handle_signal        arch/x86/kernel/signal.c:255
               └─ setup_rt_frame    arch/x86/kernel/signal.c:236
                  在用户栈压入 siginfo + ucontext，把返回地址改成 handler，
                  handler 返回时经 rt_sigreturn 系统调用恢复原现场
```

这条路径解释了两个日常现象：其一，**阻塞（sigprocmask）不是丢弃**——被屏蔽的信号停留在 pending 位图里，解除屏蔽后的下一次返回用户态才投递；其二，**处理函数永远在用户态、目标线程自己的栈上跑**，内核只是伪造了一个调用现场。老书（2.4/2.6 时代）把投递入口写作 `do_notify_resume`，v6.12 里这套逻辑已被重构进 `exit_to_user_mode_loop` → `arch_do_signal_or_restart`（通用入口框架 kernel/entry/ 是近几年才统一的），读老书时按此对译；更早资料里的 `__send_signal` 现在叫 `__send_signal_locked`。顺带一提：`get_signal` 里还有大量作业控制与 ptrace 的分叉（SIGSTOP 的默认动作、调试器接管），本页只走主干，调度侧的唤醒衔接见[进程管理与调度](./process-scheduling.md)。

### 3.3 管道：创建、读写与阻塞

```text
// 创建：pipe() → 两个 file 共享一个环形缓冲
SYSCALL_DEFINE1(pipe)               fs/pipe.c:1045
└─ SYSCALL_DEFINE2(pipe2)           fs/pipe.c:1040   （pipe 就是 flags=0 的 pipe2）
   └─ __do_pipe_flags
      └─ create_pipe_files          fs/pipe.c:920
         ├─ get_pipe_inode：new_inode_pseudo(pipe_mnt->mnt_sb)  在 pipefs 上造匿名 inode
         ├─ alloc_pipe_info         fs/pipe.c:790    默认 16 槽 = 64 KiB（见 2.2）
         ├─ alloc_file_pseudo(..., O_WRONLY, &pipefifo_fops)     写端 file
         └─ alloc_file_clone(..., O_RDONLY,  &pipefifo_fops)     读端 file

// 读写：环形缓冲上的生产者—消费者，两把等待队列对接
write(fd[1], ...)
└─ pipe_write                      fs/pipe.c:428
   ├─ 环满 → wait_event_interruptible_exclusive(&pipe->wr_wait, pipe_writable)  :579
   ├─ copy_from_iter 到 bufs[head] 页内，head 前进
   └─ wake_up_interruptible_sync_poll(&pipe->rd_wait, EPOLLIN)                  :577

read(fd[0], ...)
└─ pipe_read                       fs/pipe.c:251
   ├─ 环空 → wait_event_interruptible_exclusive(&pipe->rd_wait, pipe_readable)  :390
   ├─ 拷出 bufs[tail]，tail 前进，整槽空出则释放页
   └─ wake_up_interruptible_sync_poll(&pipe->wr_wait, EPOLLOUT)                 :402
```

两个语义边界由**引用计数**而非数据结构决定：所有写端都关闭后，阻塞的 `read` 返回 0（EOF）；所有读端都关闭后，`write` 收到 `EPIPE` 且进程被投递 SIGPIPE（shell 里没管这个信号时程序无声退出，正是"Broken pipe"的来历）。唤醒用 `wake_up_interruptible_sync_poll` 带 EPOLLIN/EPOLLOUT——这解释了为什么管道天然支持 epoll/poll：等待队列与事件掩码在读写路径里就地维护。管道页在缓冲区里挂着不复制，`splice`/`tee` 能在两个管道间零拷贝搬运（5.1 的实验里 modern coreutils 的 `cat` 就会现场表演这套优化）。

### 3.4 System V 共享内存：shmget / shmat

```text
// 创建：key → 账本登记
shmget(key, size, flags)
└─ SYSCALL_DEFINE3(shmget)          ipc/shm.c:842
   └─ ipcget（ipc/util.c 的 ipcget_new :339 / ipcget_public :397）
      ├─ key 已存在：ipc_findkey（util.c:172）走 key_ht → 权限/大小校验 → 返回已有 id
      └─ 新建：newseg                ipc/shm.c:697   分配 shmid_kernel（内嵌 kern_ipc_perm）
         └─ ipc_addid                ipc/util.c:278  登记进 ipcs_idr 与 key_ht

// 附接：id → 页表映射
shmat(shmid, addr, flags)
└─ SYSCALL_DEFINE3(shmat)           ipc/shm.c:1688
   └─ do_shmat                      ipc/shm.c:1514
      ├─ shm_obtain_object_check    ipc/shm.c:177
      │  └─ ipc_obtain_object_check ipc/util.c:650 → ipc_obtain_object_idr :627（按 id 查账本）
      ├─ 权限检查落在 kern_ipc_perm 的 mode/uid 上（与 ipcctl_obtain_check :998 同一套）
      ├─ 借 tmpfs 的 file 承载物理页（共享内存驻留内存但走文件抽象，见 2.4）
      └─ do_mmap                    ipc/shm.c:1657   建立页表映射到调用进程地址空间

shmdt(addr) → SYSCALL_DEFINE1(shmdt) ipc/shm.c:1829  只解除本进程映射；
IPC_RMID   → shmctl                       对象标记销毁，等最后一个附接者离开后释放
```

这条路径最值得咂摸的是"账本与本体分离"：`shmget` 之后对象已经活在内核账本里（`ipcs -m` 立刻可见），`shmat` 只是给自己进程的页表接上线，`shmdt` 只拆自己的线——对象本体要等 `IPC_RMID` 且引用归零才消失。这正是 6.4 节"共享内存泄漏"的结构性根源。消息队列与信号量（ipc/msg.c、ipc/sem.c）走完全相同的账本层，读懂 shm 再看它们，新东西只剩各自的数据通路。

## 4. 源码阅读顺序（五段式 ③）

### 4.1 第一站：fs/pipe.c —— 最小而完整的 IPC

约 1500 行，却覆盖一个 IPC 机制的全部生命周期：创建（`create_pipe_files`）、读写（`pipe_read`/`pipe_write`）、扩容（`pipe_set_size`）、销毁（`free_pipe_info`），还不牵扯命名空间账本。读法：先看 `pipefifo_fops`（:1232）这张操作表，从 `.read_iter`/`.write_iter` 倒着进 `pipe_read`/`pipe_write`，把 head/tail 环形逻辑走通；再回头看 `create_pipe_files` 理解"伪 inode + 两个 file"的骨架。读完它，你对"IPC 对象在内核里长什么样"的手感就有了。

### 4.2 第二站：kernel/signal.c —— 最复杂的 IPC

近 5000 行，别从头读。按三条短线各取所需：注册线最短（`rt_sigaction` :4493 → `do_sigaction` :4170，改一张表而已）；发送线读 `__send_signal_locked`（:1073），重点盯 2.1 节讲过的位图与链表配合；投递线读 `get_signal`（:2683），配合 arch/x86/kernel/signal.c 的 `arch_do_signal_or_restart`（:333）与 `setup_rt_frame`（:236）看"内核如何在用户栈上伪造 handler 调用现场"。kernel/entry/common.c 的 `exit_to_user_mode_loop`（:90）只需记住它是所有入口共用的检查点。

### 4.3 第三站：ipc/util.c + ipc/shm.c —— 账本式 IPC

先读 ipc/util.c 的账本原语一条线：`ipc_init_ids`（:115，账本初始化）→ `ipc_findkey`（:172，按 key 找）→ `ipc_addid`（:278，登记）→ `ipc_obtain_object_idr`（:627，按 id 取）。然后进 ipc/shm.c 只读两个函数：`newseg`（:697，对象诞生）与 `do_shmat`（:1514，页表接线）。msg/sem 的账本调用与 shm 逐字雷同，需要时再翻。

### 4.4 字典与锚点

结构体定义集中在 include/linux/pipe_fs_i.h、include/linux/sched/signal.h、include/linux/ipc.h 与 include/linux/ipc_namespace.h——把它们当字典查，不要顺序通读。查符号用 [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/source/) 在线交叉引用；本页标注的行号都按 v6.12 核对过，但内核小版本间行号会漂移，**以符号名为锚点、行号只作路标**（源码获取方式见[源码获取与目录导读](./source-tree.md)）。

## 5. 实操跟踪（五段式 ④）

### 5.1 strace 看管道：从 pipe2 到 EOF

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

逐行对回 3.3 节：bash 用一次 `pipe2` 拿到读端 3/写端 4，fork 出两个子进程后各自 `dup2` 接线（echo 的 stdout 接写端、cat 的 stdin 接读端）；echo `write` 3 字节进环形缓冲；最后 `read(0, "", 65536) = 0` 就是"写端全关 → EOF"的现场。中间那几行是彩蛋：现代 coreutils 的 `cat` 检测到输入是管道后，自建一根内部管道并 `F_SETPIPE_SZ` 扩到 1 MiB，优先尝试 `splice` 零拷贝（两次 EINVAL 是因为 stdout 不是管道，退回 read/write）——2.2 节讲的扩容上限（1048576 恰好等于 `pipe-max-size` 默认值，无需特权）在系统工具里天天发生。再验证默认容量：

```bash
$ python3 -c "import fcntl, os; r, w = os.pipe(); print('F_GETPIPE_SZ =', fcntl.fcntl(w, 1032))"
F_GETPIPE_SZ = 65536
```

16 槽 × 4 KiB = 65536，与 `PIPE_DEF_BUFFERS` 的源码账对上了（1032 是 `F_GETPIPE_SZ` 的命令号，见 linux/fcntl.h）。

### 5.2 sigaction 样例：亲手注册一个 handler

```c
/* sigdemo.c —— 编译：gcc -Wall -o sigdemo sigdemo.c */
#include <stdio.h>
#include <signal.h>
#include <unistd.h>

static void handler(int sig, siginfo_t *info, void *ucontext)
{
    /* handler 里只用异步信号安全函数：write(2) 在白名单内，printf 不在 */
    char buf[64];
    int n = snprintf(buf, sizeof buf, "[handler] sig=%d from pid=%d code=%d\n",
                     sig, info->si_pid, info->si_code);
    write(STDOUT_FILENO, buf, n);
}

int main(void)
{
    struct sigaction sa = {0};
    sa.sa_sigaction = handler;
    sa.sa_flags = SA_SIGINFO;          /* 带 siginfo 三参数形式，对应 setup_rt_frame */
    sigemptyset(&sa.sa_mask);
    if (sigaction(SIGUSR1, &sa, NULL) == -1)
        return 1;
    printf("my pid = %d, waiting for SIGUSR1...\n", getpid());
    fflush(stdout);
    pause();                           /* 睡到信号到来（见 3.1 的唤醒链） */
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

`kill -USR1` 走完 3.1 的入队路，把写端 shell 的 pid 填进 `si_pid`；`./sigdemo` 被唤醒后在返回用户态检查点走 3.2 的投递路，`handler` 打印的 `sig=10`（SIGUSR1 的编号）与 `code=0`（`SI_USER`，来自 kill(2)）都是内核在 `__send_signal_locked` 里填的。`pause` 醒来说明 handler 返回后执行流接回 `pause` 之后——这就是 `setup_rt_frame` 伪造现场再由 `rt_sigreturn` 恢复的全过程。

### 5.3 bpftrace 看信号生成与"不排队"

先用一个阻塞了 SIGUSR1 的受害者当靶子（信号会停在 pending 里，方便连发观察）：

```python
# victim.py —— 阻塞 SIGUSR1 后睡眠，信号全部积累在 pending 位图
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
python3  pid=784547 sig=10 grp=1 res=0      # 第一次 kill：入队成功（DELIVERED）
python3  pid=784547 sig=10 grp=1 res=2      # 第二次 kill：已在排队（ALREADY_PENDING，合并！）
python3  pid=784547 sig=10 grp=1 res=2      # 第三次 kill：同样合并
$ kill -USR1 784547; kill -USR1 784547; kill -USR1 784547
```

bpftrace 在前台占住窗口持续打印，另开一个终端连发三次 `kill -USR1 784547`——受害者已把 SIGUSR1 屏蔽，三个信号都停在 pending 里，正好把合并逻辑暴露出来。`res` 就是 3.1 节 `trace_signal_generate` 的 result 枚举：0 入队、1 被忽略、2 已在排队、3 溢出、4 丢失 detail。三次 `kill -USR1` 只入队一次——`legacy_queue` 那行源码在观测面上现出原形，这也是 6.1 坑的现场证据。注意探针字段里 `comm`/`pid` 是**目标进程**（tracepoint 在发送者上下文触发，但字段按目标填充）；过滤器里带上 `args->pid` 是因为在繁忙机器上不滤会刷屏（本例实测同秒内就有 dockerd 的 SIGURG 流量）。bpftrace 安装与语法见[跟踪工具](./tracing-tools.md)。

### 5.4 ipcs / ipcmk：System V 对象的生灭

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
$ ipcrm -m 32768 -q 0 -s 1     # 用完即删，别给系统留账
```

对照 2.3 节：`ipcmk` 随机生成 key，三列 key/shmid/owner/perms 全部来自 `kern_ipc_perm` 头部；`nattch 0` 说明尚无进程 `shmat`（只有账本登记、没有页表接线）。注意这组对象在 `ipcrm` 之前会一直活着——**进程退出不会带走它们**（6.4 坑的引子）。POSIX 侧同样可以眼看手验：`ls /dev/mqueue/` 看消息队列、`df -h /dev/shm` 看 POSIX 共享内存占掉的 tmpfs 容量。

### 5.5 Ctrl+Z 的内核旅程：SIGTSTP 与 SIGCONT

在终端按 Ctrl+Z 与 `kill -TSTP` 等价（终端驱动把按键翻译成发给前台进程组的 SIGTSTP）：

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

内核侧的旅程正好把两条路径串起来：SIGTSTP 沿 3.1 入队，投递时 `get_signal` 查 action[] 发现是 `SIG_DFL`，默认动作"stop"把任务置为 `__TASK_STOPPED`（STAT 的 T）；SIGCONT 是唯一能唤醒停止态任务的信号（`prepare_signal` 里对 stop/cont 互斥清理的特判），任务回到 S。`fg`/`bg` 只是在这之上补了作业控制协议（SIGCONT + 终端前后台归属），机制内核早铺好了。

## 6. 常见坑

**同一信号连发三次，处理函数只跑一次。** 标准信号（1–31）在 pending 位图里只有一个槽位：第二次发送被 `legacy_queue` 直接合并（5.3 实测 res=2），SIGCHLD 连发导致 `waitpid` 少收尸、SIGUSR1 计数丢失都是这个根因。出路按需选：要"每次都数"用实时信号（SIGRTMIN 起，排队且可带 sigqueue 数据）；要"状态对齐"就在 handler 里只置 `volatile sig_atomic_t` 标志位，主循环里处理完再清——标志位天然把合并语义转成"至少发生了一次"。

**信号处理函数里 printf/malloc，偶发死锁或崩溃。** handler 可能在任意两条指令之间打断主程序——printf 正拿着 stdio 内部锁时被同一个锁重入，malloc 正改堆元数据时被再入，都是未定义行为。纪律是 handler 里只调 man signal-safety(7) 白名单里的函数（write、_exit 等标志位派），或者干脆用 `signalfd` 把信号转成可 epoll 的文件描述符，在主循环里当普通事件处理——异步问题异步治，回到同步世界。

**双向对话用一根管道，两个进程互相卡死。** 管道是严格半双工：A 拿写端写、B 同时拿同一根的写端写自己的请求，读端谁也读不全。另一变体是单方向写超过 64 KiB 默认容量而对端不读——`pipe_write` 阻塞在 wr_wait，若对端又在等别的资源就成环。出路：要双向就 `socketpair(AF_UNIX, ...)` 或两根管道明确分工；要大流量就 `F_SETPIPE_SZ` 扩容（普通用户上限 `/proc/sys/fs/pipe-max-size`，默认 1 MiB）或改用 `splice` 搬运。

**ipcs 里 shm 越积越多，/dev/shm 被撑满。** System V 对象生命周期独立于进程：`shmat` 后进程崩溃，映射自动解除但对象仍在账本里（`nattch 0` 还挂着）；`ipcmk` 建了忘 `IPC_RMID` 就是永久垃圾。POSIX 侧同理——`/dev/shm` 是 tmpfs，占的是内存，塞满后 mmap 匿名页开始失败。出路：代码里保证 `IPC_RMID`/`shm_unlink` 走到（哪怕异常路径），运维上把 `ipcs -m` 与 `df /dev/shm` 纳入例行巡检（基线对比思路同[性能优化](../system-management/performance.md)），发现 nattch=0 的老对象先问归属再删。

**ftok 生成的 key 没变，shmget 却取不到旧对象。** `ftok(path, id)` 的算法是"路径的 inode 号 + 设备号 + id"拼 key——路径字符串不变，但文件被重建（编辑器原子保存就是删了重写）后 inode 变了，key 就漂移；两个不同路径也可能撞出同一个 key。症状是同一份配置一边 ENOENT 一边 EEXIST，重启又正常。出路：key 文件专物专用且不被覆盖写；更稳的做法是 `IPC_PRIVATE` 创建后把 id 通过文件/管道/环境传给协作进程，绕开 key 猜谜。

**kill 报 ESRCH，ps 里却还看得见那个进程。** 两种情况要分开：`No such process`（ESRCH）说明内核里 task_struct 确实不在了——要么已被回收，要么 pid 记错（注意 `kill` 参数是 tgid/线程组语义，`ps -eLf` 里的 LWP 列是线程号，拿它去 kill 某些场景会 ESRCH）；看得见却杀不死的是**僵尸进程**——task_struct 还在（等父进程 wait），但进程早已终止，SIGKILL 对它无意义，信号被接受也不会有任何执行体去处理。杀僵尸的正解是让父进程 `wait`/退出（过继给 init 后被收尸），进程退出路径的账本细节见[进程管理与调度](./process-scheduling.md)。

## 7. 延伸资料（五段式 ⑤）

按主题配书（书目与章节均经核实，各书基于旧内核，读时按本页对译表换算函数名）：

- **信号与 System V IPC 的标准参考**：Bovet & Cesati《深入理解Linux内核》（Understanding the Linux Kernel, 3rd ed，基于 2.6）——第 11 章 Signals 的 Generating a Signal / Delivering a Signal 两节正好对应本页 3.1/3.2 的两条路径；第 19 章 Process Communication 下有 Pipes、FIFOs、System V IPC、POSIX Message Queues 四节，key/id 双寻址的经典图示至今可用
- **中文逐行走读**：毛德操、胡希明《Linux内核源代码情景分析》（以 2.4.0 为依据）——进程间通信独占两章：第 6 章"传统的 Unix 进程间通信"（信号、管道、System V 三件套逐行讲）与第 7 章"基于 socket 的进程间通信"（Unix 域）；行号级走读的密度无书能出其右，但函数名需按本页对译到 6.x
- **如实说明**：Robert Love《Linux内核设计与实现》（LKD, 3rd ed，基于 2.6）全书 20 章没有独立的 IPC 章——IPC 本就不是它的强项，不建议为这个主题翻它；其价值在进程/调度/中断各章（见同篇各页的引用）
- **man 手册（本机 man7 均已验证存在）**：man 7 signal（信号语义总表）、man 7 signal-safety（异步信号安全函数白名单）、man 7 pipe（管道容量与 F_SETPIPE_SZ）、man 7 fifo、man 7 sysvipc（key/id/权限模型）、man 7 mq_overview / shm_overview / sem_overview（POSIX 三件套入口）
- **一手源码**：[elixir.bootlin.com v6.12 交叉引用](https://elixir.bootlin.com/linux/v6.12/source/)——本页所有函数名与行号可在此复核；fs/pipe.c、kernel/signal.c、ipc/ 三个落点见第 4 节阅读顺序
- **工具细节**：[跟踪工具](./tracing-tools.md)的 bpftrace/ftrace 章节（本页 5.3 的探针语法与过滤器写法）；管道/套接字在 shell 与服务里的日常用法见[进程管理命令](../commands/system/process.md)

## 参考资料

- Linux 内核源码 v6.12 — [elixir.bootlin.com/linux/v6.12](https://elixir.bootlin.com/linux/v6.12/latest/source)（fs/pipe.c、kernel/signal.c、kernel/entry/common.c、arch/x86/kernel/signal.c、ipc/util.c、ipc/shm.c、ipc/mqueue.c 及相关头文件）
- man 手册 — man 7 signal、man 7 signal-safety、man 7 pipe、man 7 fifo、man 7 sysvipc、man 7 mq_overview、man 7 shm_overview
- Daniel P. Bovet & Marco Cesati.《深入理解Linux内核》（Understanding the Linux Kernel, 3rd ed.）第 11、19 章
- 毛德操、胡希明.《Linux内核源代码情景分析》第 6、7 章（浙江大学出版社）
- Robert Love.《Linux内核设计与实现》（Linux Kernel Development, 3rd ed.）
- 内核 IPC 子系统文档索引 — [docs.kernel.org](https://docs.kernel.org/)
