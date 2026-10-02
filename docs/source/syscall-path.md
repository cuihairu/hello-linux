# 系统调用：一次 write() 的全程

每个 Linux 程序与内核的每一次对话都要过同一道门：系统调用。`printf` 落到屏幕、`read` 取回文件内容、`fork` 造出新进程——去掉缓冲与包装，底层都是一次 CPU 特权级切换加一张函数指针表的查表分发。本页用最小的一个调用 `write()` 把这道门拆开看：用户态怎么触发切换、内核怎么按号找到函数、参数怎么传、错误怎么回来。它是源码篇所有模块章的"第 0 章"——进程、内存、VFS、网络的入口都悬在这条路径上，先把入口走通，后面每章的"调用路径"段都是它的延长线。本章按本篇统一的五段式展开：核心数据结构 → 关键函数调用路径 → 源码阅读顺序 → 实操跟踪 → 延伸资料。

> 内容参考自内核源码树（v6.12）与上述书目（概念框架），见文末参考资料。

## 学习目标

- 分清库函数与系统调用，能解释 `printf` 的输出为什么不一定立刻产生 `write`
- 认识三件套：`sys_call_table`、`SYSCALL_DEFINE` 宏、`pt_regs`，知道参数怎么经寄存器进内核
- 独立走通 `write()` 的完整调用链：`entry_SYSCALL_64` → `do_syscall_64` → `__x64_sys_write` → `ksys_write` → `vfs_write`
- 用 strace/ftrace/bpftrace 四个实验，把静态调用链在真机上"看见"
- 避开跨架构调用号、函数名版本差异、vDSO 不可见这三类高频误解

## 1. 系统调用为什么存在

### 1.1 用户态与内核态：一堵墙、一扇门

现代 CPU 自带特权级：内核跑在 ring 0，能碰所有内存与设备；用户程序跑在 ring 3，越界的访问会立刻触发异常。这堵墙保护的不是内核的隐私，而是系统的秩序——如果任何进程都能直接写磁盘控制器、改页表，隔离与安全都无从谈起。但墙内的事终究要有人代办，于是 CPU 提供了少数"合法翻墙"的指令：x86-64 上的 `syscall` 就是那扇门。执行它的一瞬间，CPU 把特权级切到 0，RIP 跳到一个内核预先登记的入口地址（开机时由内核写入 `MSR_LSTAR` 寄存器），之后的代码就是内核的了。门是快的，但不免费：寄存器要保存、缓存要冲刷、调度与审计的钩子要过——这就是"系统调用有成本"的物理来源，也是后面 VFS 章里 page cache、网络章里零拷贝这些设计存在的原因：少过一次门，就省一份钱。

### 1.2 库函数不是系统调用

初学者最常见的混淆在这一层：`printf`、`fwrite`、`malloc` 都是**库函数**，运行在用户态；`write`、`brk` 才是**系统调用**，要过门。库函数往往把多次逻辑操作合并成少数系统调用：`printf` 把内容攒进用户态缓冲区，直到缓冲满、显式 `fflush` 或程序退出才真正调一次 `write`；`malloc` 大块地向内核要内存（`brk`/`mmap`），小块地在用户态自己切分。用 strace 看一眼就明白——循环 `printf` 一百次，`write(1, ...)` 可能只出现一两次。这个"缓冲层"解释了很多表面怪象：程序崩了最后几行日志没出来（缓冲没 flush）、重定向到文件后输出顺序变了（全缓冲替换了行缓冲）、`strace` 里"少调了几次"（根本没发生，不是丢了）。读内核源码之前先把这条边界划清，才知道自己追的到底是 libc 的代码还是内核的代码。

### 1.3 本页在源码篇的位置

[跟踪工具](./tracing-tools.md)一章给了四层观察体系，本页 §5 的四个实验是它的第一次实战；[源码目录导读](./source-tree.md)的目录地图在这里开始派上用场——本章涉及的文件集中在 `arch/x86/entry/`、`include/linux/syscalls.h` 与 `fs/read_write.c` 三处。走完本页，`write()` 在 `vfs_write()` 处把接力棒交给文件系统，之后的路程属于 [VFS 与 ext4](./vfs-ext4.md) 一章。

## 2. 核心数据结构 ①

### 2.1 sys_call_table：一张函数指针账本

内核把全部系统调用登记在一张数组里——`arch/x86/entry/syscall_64.c` 中的定义短得可以一眼看完：

```c
// arch/x86/entry/syscall_64.c（v6.12，节选）
const sys_call_ptr_t sys_call_table[] = {
#include <asm/syscalls_64.h>
};
```

数组本体只有一行，条目来自一个**构建时生成**的头文件 `asm/syscalls_64.h`：内核构建系统根据系统调用表（`kernel/sys_ni.c` 与各处 `SYSCALL_DEFINE` 的登记）生成 `__SYSCALL(nr, sym)` 宏序列，同一份头文件被以三种不同宏定义包含三次——一次生成 extern 声明，一次填充这张表，一次生成 `x64_sys_call()` 的 switch 分发。调用号就是数组下标：x86-64 上 `write` 是 1 号，`read` 是 0 号，它们在 `<asm/unistd_64.h>` 中定义且**架构间互不相同**（详见 §6）。这张表是"号→函数"的唯一真相源，但注意 v6.12 的 `do_syscall_64` 并不直接下标查表，而是调用 switch 版的 `x64_sys_call()`——间接跳转面更小，对 Spectre 类推测执行攻击更友好；两条路殊途同归，都落在 `__x64_sys_write` 这样的包装函数上。

### 2.2 SYSCALL_DEFINE：把自己挂上表的宏

内核里定义一个系统调用不是写个普通 C 函数了事，而是套一层宏：

```c
// fs/read_write.c（v6.12，节选）
SYSCALL_DEFINE3(write, unsigned int, fd, const char __user *, buf, size_t, count)
{
    return ksys_write(fd, buf, count);
}
```

`SYSCALL_DEFINE3` 的 3 是参数个数。在启用 `CONFIG_ARCH_HAS_SYSCALL_WRAPPER` 的 x86-64 上，这行宏展开成三层函数：最外层 `__x64_sys_write(const struct pt_regs *regs)` 接收统一的寄存器快照，把 `regs->di/dx/si` 拆成三个参数；中层 `__se_sys_write` 把所有参数当作 `long` 做符号扩展（用户可能传进截断值，内核必须 defensive）；最内层 `__do_sys_write` 才是你写的函数体。这套分层看起来繁琐，换来的正是 §2.3 的关键设计：**系统调用的入参协议与 C 调用约定解耦**。宏还顺手生成 `SYSCALL_METADATA`——ftrace 的 syscall 事件（`-e syscalls:sys_enter_write`）靠的就是它。旧教材里"sys_write"直呼其名的写法对应的是宏展开前的概念名，在 6.x 源码里 grep `sys_write` 要连着 `__x64_`/`__se_`/`__do_` 三个前缀一起找。

### 2.3 pt_regs：参数寄存器的快照

x86-64 的系统调用约定值得背下来：**调用号放 `rax`；参数依次放 `rdi`、`rsi`、`rdx`、`r10`、`r8`、`r9`；返回值放 `rax`**。眼熟的读者会发现前三个与 C 调用约定相同，第四个却是 `r10` 而不是 `rcx`——因为 `syscall` 指令硬件规定把返回地址写进 `rcx`、把 flags 存进 `r11`，`rcx` 被征用了，第四参数只好挪到 `r10`。`write(fd, buf, count)` 因此是 `rax=1`、`rdi=fd`、`rsi=buf`、`rdx=count`。内核入口做的第一件事就是把用户寄存器现场按固定布局压进内核栈，形成 `struct pt_regs`——它既是参数包（`__x64_sys_write` 从这里拆参数），也是返回现场（SYSRET 时恢复），还是 `ptrace`/strace 窥视系统调用的窗口：strace 报告里的参数值，读的正是这份快照。

```c
// arch/x86/include/asm/ptrace.h（v6.12，字段顺序即压栈顺序，节选）
struct pt_regs {
    unsigned long r15;  unsigned long r14;  unsigned long r13;
    unsigned long r12;  unsigned long bp;   unsigned long bx;
    unsigned long r11;  unsigned long r10;  unsigned long r9;
    unsigned long r8;   unsigned long ax;   unsigned long cx;
    unsigned long dx;   unsigned long si;   unsigned long di;
    unsigned long orig_ax;          // 调用号的备份（syscall clobber 了 ax）
    unsigned long ip;   unsigned long cs;
    unsigned long flags; unsigned long sp;  unsigned long ss;
};
```

`entry_SYSCALL_64` 用一条 `PUSH_AND_CLEAR_REGS` 把通用寄存器按上述顺序反向压入（`rax` 进栈时预置 `-ENOSYS`，见 §3.2），再补上 `ip/cs/flags/sp/ss` 五元组——正是 `iret` 指令恢复用户态所需的完整帧，`SYSRET` 快速返回同样从这里取。值得注意的两个字段：`orig_ax` 存的是**调用号**（`rax` 在压栈后要当返回值暂存，原号挪进 `orig_ax`，strace/ptrace 读系统调用号正是读它）；`di/si/dx` 等 x86 专用命名则提醒你这是寄存器快照而非参数表——真正的"参数有几个"由第 2.2 节的宏说了算，两者必须一起看才对得上。

### 2.4 vDSO：不陷门的豁免通道

有一类"读时间"的操作（`gettimeofday`、`clock_gettime`、`time`、`getcpu`）被特殊照顾：内核在启动时把一小段代码和数据映射进每个进程的地址空间（vDSO），这些调用直接在用户态完成，根本不过 `syscall` 门——读的是内核预先填好、随时钟中断更新的只读数据页。收益是数量级的：过一次门约几百纳秒起，vDSO 路径只要几十纳秒，对高频打点的时间敏感程序是天壤之别。对读源码的人它有一个直接副作用：**strace 里看不到这些调用**（详见 §6）。判据记一条：`ldd /bin/true` 输出里的 `linux-vdso.so.1` 就是这块映射的痕迹。

## 3. 关键函数调用路径 ②

### 3.1 write() 的完整调用栈

把一次 `write(1, "hello", 5)` 的全程画成一张纵向图，左列用户态、右列内核态，每站标注源码位置：

```text
用户态                               内核态（v6.12）
──────────────                      ─────────────────────────────────────────
write(fd, buf, count)
  │  glibc 薄包装：mov eax, 1; mov rdi/rsi/rdx; syscall
  ╳ ── syscall 指令：CPL3→0，RIP ← MSR_LSTAR ──────────────────▶
                                      entry_SYSCALL_64
                                        arch/x86/entry/entry_64.S
                                        swapgs；从 per-CPU 取内核栈顶；
                                        把用户寄存器压成 pt_regs（rax 预置 -ENOSYS）
                                      do_syscall_64(regs, nr)
                                        arch/x86/entry/common.c
                                        nr 越界防护(array_index_nospec)后
                                        交 x64_sys_call() 按 nr 分发
                                      __x64_sys_write(regs)
                                        SYSCALL_DEFINE3 生成：拆 pt_regs → (fd, buf, count)
                                      ksys_write(fd, buf, count)
                                        fs/read_write.c
                                        fdget_pos(fd)：fd 号 → struct file（查进程的
                                        文件描述符表；带文件位置并发保护）
                                      vfs_write(file, buf, count, pos)
                                        fs/read_write.c —— 进入 VFS 的分界点
                                        走 file->f_op->write，或 new_sync_write()
                                        包装后走 write_iter —— 之后的路属于 VFS/ext4 章
  ╳ ◀─ SYSRET（无信号且 %al==0 走快速路径，否则慢路径换栈返回）──────
write() 返回 rax：成功是写入字节数，失败是 -errno
```

### 3.2 逐站解读：每一站在防什么

这张链上每一站的存在都有理由，读源码时带着"它在防什么"的问句，代码就不只是符号海洋。`entry_SYSCALL_64` 是纯汇编，开场 `swapgs` 是因为用户态与内核态共用一套 GS 寄存器、而内核的 per-CPU 数据要靠内核 GS 基址寻址——先换基址，后面才能安全取当前任务与栈顶；它把用户 RSP 存进 TSS 备用槽、从 per-CPU 变量取内核栈顶，然后按 §2.3 的布局压栈，`rax` 预置为 `-ENOSYS` 是一个防御设计：若调用号非法分发失败，栈上天然就是一个失败返回值。`do_syscall_64` 做的第一件事是**把调用号当不可信输入**：先当无符号数判界，再过 `array_index_nospec` 阻断推测执行越界（Spectre v1 缓解），合法才分发；`nr == -1` 被视为"这不是一次系统调用"直接跳过（restart 场景的约定）。`__x64_sys_write` 这层包装站在这里是为了把"寄存器协议"翻译成"C 函数协议"。`ksys_write` 里的 `fdget_pos` 回答一个更实际的问题：`fd` 只是个小整数，内核要拿它查当前进程的文件描述符表（`task_struct` → `files_struct` → `fdtable`）得到 `struct file`——同一个 fd 号在不同进程里指向完全不同的文件，这张转发表正是 shell 重定向能工作的机制基础（§5.2 会亲眼看到）。最后 `vfs_write` 是用户数据进入文件系统的分水岭，此后内核要处理缓冲、锁与具体文件系统的差异——那是 [VFS 与 ext4](./vfs-ext4.md) 的领地。错误沿原路反向传播：内层返回 `-errno`，逐层原样上浮，glibc 把负值搬进 `errno` 并让 `write` 返回 `-1`——所以 strace 里 `= -1 EBADF (Bad file descriptor)` 是内核深处早就决定好的答案。

### 3.3 返回之路：门不是只开不关的

去程讲完还有回程，而回程的分岔恰是 `do_syscall_64` 返回值的用途：它返回一个布尔值，告诉汇编入口"这次可以从容走 `SYSRET` 快路径"还是"必须走 `IRET` 慢路径"。快路径只做三件事——`swapgs` 把 GS 换回用户基址、恢复 `rcx/r11`、`sysretq` 跳回用户态；慢路径（`swapgs_restore_regs_and_return_to_usermode`）则要先过一段 exit 工作栈：待处理信号、`syscall_exit_to_user_mode` 钩子（ptrace 的"系统调用退出"事件、审计、tracepoint 都挂在这里）、被抢占的调度……之后才换栈返回。什么情况走慢路？`rax` 非零（失败返回常以慢路出，因为要搬运错误语义）、栈/标志位不满足 `SYSRET` 硬件前提、有信号要递送。读这段代码时把"返回值在寄存器里"与"返回路径也要审查"两件事分开——`strace -e trace=write` 显示 `= 6` 是 `rax`，而每行之所以能出现、有时还会冒出 `?restart_syscall`，是 exit 工作栈在说话。错误码 `errno` 的两次翻译也发生在这条路上：内核给负值，`-ERESTARTSYS` 一类会被原地转成信号或重启（glibc 看到的是被信号打断的调用），真正传到用户程序 `errno` 变量的，只是走完这条审查路的幸存者。

## 4. 源码阅读顺序 ③

第一次读这条链，不要从 `init/main.c` 顺流而下，按"从门到账本"的顺序四步走，每步都有明确的"读什么、跳过什么"：

**第一步：`arch/x86/entry/entry_64.S` 只读 `SYM_CODE_START(entry_SYSCALL_64)` 一段**（用编辑器跳到该符号，上下约两百行）。汇编别怕，这段注释密集且模式重复，核心骨架摘出来只有这几行（v6.12，示意节选）：

```asm
SYM_INNER_LABEL(entry_SYSCALL_64, SYM_L_GLOBAL)
    swapgs                              /* GS 换内核基址，一切 per-CPU 寻址的前提 */
    movq    %rsp, PER_CPU_VAR(...)      /* 用户栈暂存（TSS 槽） */
    movq    PER_CPU_VAR(pcpu_hot + X86_top_of_stack), %rsp   /* 换到当前任务内核栈 */
    pushq   __USER_DS / ss, sp, r11, __USER_CS, rcx          /* iret 帧 */
    PUSH_AND_CLEAR_REGS rax=$-ENOSYS    /* 通用寄存器压成 pt_regs；调用号非法时天然 -ENOSYS */
    movq    %rsp, %rdi                  /* 第 1 参：&pt_regs */
    movslq  %eax, %esi                  /* 第 2 参：符号扩展的调用号 */
    call    do_syscall_64
```

盯住 `swapgs`、内核栈顶、`PUSH_AND_CLEAR_REGS`、`call do_syscall_64` 四个关键词就够。跳过同文件里中断、NMI 的其他入口——那是[中断与时钟](./interrupt-timers.md)一章的事。

**第二步：`arch/x86/entry/common.c` 读 `do_syscall_64`**。签名 `__visible noinstr bool do_syscall_64(struct pt_regs *regs, int nr)`——注意 `nr` 是汇编塞进第二个参数的，C 函数自己不读 `orig_ax`。函数体的三件事按顺序：`do_syscall_x32` 处理 x32 ABI（关了 `CONFIG_X86_X32_ABI` 就直接落空）；无符号判界后 `array_index_nospec(nr, NR_syscalls)` 把越界号在硬件层面清成安全下标；`x64_sys_call(regs, nr)` 按号分发到 `__x64_sys_*`。分发不中且 `nr != -1` 时落到 `__x64_sys_ni_syscall`（`SYSCALL_DEFINE0(ni_syscall)` 定义，返回 `-ENOSYS`）；`nr == -1` 被当作"非系统调用"直接跳过——`restart_syscall` 重入场景就靠这个约定。返回值布尔语义见 §3.3。

**第三步：`arch/x86/include/asm/syscall_wrapper.h` 与 `include/linux/syscalls.h` 对照读 `SYSCALL_DEFINE` 展开**。目标是亲手展开一次 `SYSCALL_DEFINE3(write, ...)`，看清三层各自做什么：

```text
SYSCALL_DEFINE3(write, unsigned int, fd, const char __user *, buf, size_t, count)
  ├─ __x64_sys_write(const struct pt_regs *regs)   /* 架构包装：di→fd, si→buf, dx→count */
  │    └─ __se_sys_write(long, long, long)          /* 参数统一成 long 并符号扩展 */
  │         └─ __do_sys_write(fd, buf, count)       /* 你写的函数体：return ksys_write(...) */
  └─ SYSCALL_METADATA(...)                          /* 生成 ftrace 的 sys_enter_write 事件 */
```

x86-64 启用了 `CONFIG_ARCH_HAS_SYSCALL_WRAPPER`，三层的命名与"谁接收 `pt_regs`"由 `syscall_wrapper.h` 重定义——这也是老文章里 `sys_write` 之名在现源码中找不到的直接原因（§6 有专门一条）。`SYSCALL_METADATA` 知道是给 ftrace 用的即可，§5.5 会兑现它。

**第四步：`fs/read_write.c` 读 `ksys_write` 与 `vfs_write` 收尾**。`SYSCALL_DEFINE3` 的函数体只有一行 `return ksys_write(fd, buf, count);`——真正干活的拆开看：

```c
// fs/read_write.c（v6.12，示意节选）
ssize_t ksys_write(unsigned int fd, const char __user *buf, size_t count)
{
    struct fd f = fdget_pos(fd);          /* fd → struct file + 文件位置并发保护 */
    ...
    ret = vfs_write(f.file, buf, count, ...);
    ...
    fdput_pos(f);
    return ret;
}

ssize_t vfs_write(struct file *file, const char __user *buf, size_t count, loff_t *pos)
{
    ...
    if (file->f_op->write)                 /* 老式直接写 */
        ret = file->f_op->write(...);
    else if (file->f_op->write_iter)       /* 新式：包 kiocb 走 write_iter（现代文件系统都在这） */
        ret = new_sync_write(file, buf, count, pos);
    ...
}
```

看到 `fdget_pos` 与 `write_iter` 的分叉就停——再往下是 VFS 的通用层，留给[下一章](./vfs-ext4.md)带着"一次写怎么落盘"的问题去读。四步读完，回头看 §3.1 的调用栈图，每一站应该都能说出"它防什么"。

## 5. 实操跟踪 ④

四个实验从用户态一路打到内核入口，工具的完整用法见[跟踪工具](./tracing-tools.md)，此处只给最小可跑版本。前提：任一主流发行版，strace 装好即可做前两个，后两个需要 root。

### 5.1 strace：看系统调用的边界

```bash
$ echo hello | strace -e trace=write tee /tmp/out
hello
write(1, "hello\n", 6)                  = 6
write(3, "hello\n", 6)                  = 6
+++ exited with 0 +++
```

`tee` 把同一份数据写两处：fd 1（stdout）与 fd 3（它自己打开的 `/tmp/out`）。每一行判读五个字段：函数名、fd 号、缓冲区**内容**（strace 帮你把地址解引用成了字符串）、字节数、返回值。`= 6` 就是内核走完 §3.1 全链后放进 rax 的答案。换 `strace -e trace=write,openat,close` 能看到 fd 3 从哪来、到哪去——fd 的生老病死都在 syscall 边界上。

### 5.2 重定向：fd 号没变，struct file 换了

```bash
$ strace -e trace=write bash -c 'echo hi > /tmp/f'
write(1, "hi\n", 3)                     = 3
$ cat /tmp/f
hi
```

重定向之后 `write` 的 fd 仍是 1——shell 没有换 fd 号，而是在 `exec` 前把 fd 1 指向的 `struct file` 换成了 `/tmp/f`。这正是 `ksys_write` 里 `fdget_pos` 那张转发表的威力：**fd 是进程本地的小整数，含义完全由描述符表决定**。同一行实验顺手验证了 §1.2：bash 的 `echo` 是内建命令，没有 `execve`，只有一次 `write`。

### 5.3 ftrace：看 vfs_write 之下的调用深度

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

`set_graph_function` 把 function_graph 限定在 `vfs_write` 子树，输出即 §3.1 图中"分界点"以下的真实形状：本例落到了 ext4 的 `write_iter`（`/tmp` 在 ext4 上；你的文件系统不同，叶子也会不同）。缩进层级就是调用深度，微秒列是每站耗时——静态调用链第一次以"带时间的解剖图"出现。

### 5.4 bpftrace：给全机的 write 记账

```bash
# bpftrace -e 'kprobe:vfs_write { @[comm] = count(); }'
Attaching 1 probe...
^C

@[systemd-journald]: 14
@[bash]: 3
@[bpftrace]: 1
```

挂一个 `kprobe:vfs_write`，按进程名计数，Ctrl-C 出账单。三十秒就能回答"谁在写盘"这类值班问题——这正是把源码知识变成运维武器的最短路径：知道 `vfs_write` 是所有写路径的咽喉，才知道探针该挂在哪。

## 6. 常见坑

**strace 里 write 的 buf 是地址还是内容？** strace 默认好心地把缓冲区解引用显示为字符串，但它在显示 `-e trace=write` 与参数dump 上有两档：想稳定拿到完整缓冲内容，用 `strace -e write=1` 这类 `write=fd` 选项，它会对写往指定 fd 的数据做十六进制/文本 dump——长缓冲、二进制内容时是唯一可靠读法。

**拿 i386 的调用号用在 x86-64 上。** 调用号是每张表自己的编号：x86-64 的 1 是 `write`，i386 的 1 是 `exit`、4 才是 `write`。跨架构调试时若把架构记错，寄存器里塞的号会命中完全不同的调用，症状千奇百怪。核对的权威位置是内核源码的 `<asm/unistd_{64,32}.h>`（构建时生成），或 man 2 手册页末尾的对照表。

**glibc 的 fwrite/printf "少调了" write。** 循环输出一万次 `printf`，strace 里 `write` 只有个位数——这是用户态缓冲在合并，不是丢数据。判断口诀见 §1.2：缓冲没满、没显式 flush、没退出，就不会过门。反过来，崩溃前"丢日志"也同一根源，要立刻落盘用 `fflush` 或 `write` 直发。

**在 6.x 源码里 grep 不到老教材说的 sys_write。** `SYSCALL_DEFINE` 展开后真名带着 `__x64_sys_write`（包装）、`__se_sys_write`（符号扩展）、`__do_sys_write`（函数体）三层前缀；ftrace/kprobe 里还要注意 kallsyms 显示的符号名。读 2.6 时代的书配 6.x 的源码，函数名对不上是常态——按概念名去 elixir 搜 `SYSCALL_DEFINE.*write` 更稳。

**vDSO 调用在 strace 里消失了。** `gettimeofday`/`clock_gettime` 走 vDSO 在用户态完成，不产生 `syscall` 事件——"strace 里没有"不等于"没执行"。基准测试若发现测时间本身的开销比被测操作还大，先想想 vDSO；确认路径可用 `ltrace` 或直接读 `LD_SHOW_AUXV=1 /bin/true` 输出里的 `AT_SYSINFO_EHDR`（vDSO 映射地址）。

**把 `= -1` 当成了字节数。** strace 输出里 `= -1 EBADF (Bad file descriptor)` 是"返回 -1 且 errno=EBADF"的人读格式；内核深处返回的其实是 `-EBADF`（负值 errno），glibc 包装层负责翻译。写跟踪脚本解析 strace 输出时要按"负数即失败"分支，别把它混进成功路径统计。

## 7. 延伸资料 ⑤

本主题的四本书用法各异，别按一本走到底。

Robert Love《Linux内核设计与实现》的系统调用一章是最佳首读——十几页讲清"参数传递与验证"的设计动机，读完再看源码事半功倍；它的"为什么要有用户态/内核态分界"的开篇论述，正好回填本页 §1 的动机部分。

Bovet & Cesati《深入理解Linux内核》对系统调用的进入/退出路径有配图最全的走读，`pt_regs` 逐字段的解释与本页 §2.3 对照着读效果最好（该书基于 2.6，寄存器细节与 6.x 有出入，框架仍准）——它把退出路径上的 `syscall_64` 慢速段讲得比本页 §3.3 详细得多，补读时先翻那部分。

毛德操、胡希明《Linux内核源代码情景分析》的"情景"正是本页的做法——挑一个具体调用从头跟到尾。这本 2.4 时代的书教的方法论在 6.12 上依然锋利：函数名会变、调用号会变，"从入口表找到函数、沿参数一路走进文件系统"的走法不变。读它时把它当"方法论教材"，别拿它的行号去对现源码。

Wolfgang Mauerer《深入Linux内核架构》适合当字典查细节——本页 §2 留白的数据结构字段（`files_struct` 布局、分发表的生成细节）在里面能查到展开版。

版本警告统一适用：函数名与文件位置以现源码为准，书的职责是给你"为什么"，不是"在哪一行"。实操层面，本页四个实验的工具深度用法在[跟踪工具](./tracing-tools.md)；`write` 过门之后的旅程在 [VFS 与 ext4](./vfs-ext4.md)。

## 参考资料

- Linux 内核源码 v6.12 — [elixir.bootlin.com/linux/v6.12](https://elixir.bootlin.com/linux/v6.12/latest/source)
- man 2 syscall — [man7.org/linux/man-pages/man2/syscall.2](https://man7.org/linux/man-pages/man2/syscall.2.html)
- man 2 write — [man7.org/linux/man-pages/man2/write.2](https://man7.org/linux/man-pages/man2/write.2.html)
- man 7 vdso — [man7.org/linux/man-pages/man7/vdso.7](https://man7.org/linux/man-pages/man7/vdso.7.html)
- x86-64 ABI（寄存器与系统调用约定）— [refspecs.linuxbase.org](https://gitlab.com/x86-psABIs/x86-64-ABI)
- Robert Love.《Linux内核设计与实现》（Linux Kernel Development, 3rd ed.）系统调用一章
- Daniel P. Bovet & Marco Cesati.《深入理解Linux内核》（Understanding the Linux Kernel, 3rd ed.）系统调用相关章节
- 毛德操、胡希明.《Linux内核源代码情景分析》——情景跟踪方法的出处
