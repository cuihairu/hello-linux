# 用户态源码选读

内核给了机制，用户态给语义：`ls` 到底按什么规则给文件着色、`systemd` 何时把一个 unit 文件变成运行中的进程，答案都不在内核里，而在两座更大的仓库——coreutils 与 systemd——以及它们脚下那层所有 C 程序共用的地基 glibc。本篇模块章练的是“顺调用链、查数据结构、用 strace/ftrace 佐证”的肌肉，这套肌肉迁到用户态仓库反而更顺手：构建以分钟计（内核以小时计）、崩溃只是进程退出（不是整机 panic）、gdb 挂上就能下断点。本章按与模块章完全同构的五段式——核心结构、关键调用路径、源码阅读顺序、实操跟踪、延伸资料——把三个选读目标各跑一遍全流程：coreutils 的一个命令、glibc 的最后一厘米、systemd 的一个单元，最后在第 5 节把方法论沉淀成一张差异表，收官本篇。

> 内容参考自 coreutils、glibc、systemd 官方仓库与 gnulib 项目文档，见文末参考资料。

## 学习目标

- 说清“机制在内核、语义在用户态”的分工，知道哪些问题该去读哪一层
- 从源码编译自建 coreutils，用 strace 把一次 `ls` 拆成读目录、着色决策、分块输出三段
- 画出 printf 到内核 write 的三层调用栈，并用 LD_DEBUG 亲眼看见符号绑定
- 沿 `unit_load` → fragment 解析 → `manager_startup` 的线索读懂 systemd 的一个单元加载
- 掌握用户态与内核源码阅读的差异对照，把本篇前几章的方法迁移到任意仓库

本篇与模块章共用同一骨架，三个选读目标（第 2、3、4 节）各自跑完整的一圈，对照关系如下：

| 骨架段 | coreutils（§2） | glibc（§3） | systemd（§4） |
|--------|----------------|-------------|---------------|
| ① 核心结构 | 2.1 仓库地图与自建编译 | 3.1 三层分工与源码地图 | 4.1 src/core 三件套 |
| ② 关键调用路径 | 2.2 从 main 到 stdout | 3.2 printf 到 write | 4.2 unit_load 主链 |
| ③ 源码阅读顺序 | 2.3 grep 定位三步 | 3.3 从符号到实现 | 4.3 沿主函数顺藤摸 |
| ④ 实操跟踪 | 2.4 strace 三段式 | 3.4 LD_DEBUG 与 maps | 4.4 运行态对表 |
| ⑤ 延伸资料 | 2.5 测试与官方文档 | 3.5 vDSO 与 man 一页 | 4.5 管理面回链 |

## 1. 为什么还要读用户态源码

### 1.1 机制与语义的分工

一个文件的权限位是内核判的（VFS 的 `inode_permission`），但“这个文件该不该显示绿色、该不该加粗”是 `ls` 判的；一个服务进程的 cgroup 是 systemd 拉起的，但“哪个 unit 先于哪个 unit、失败要不要重启、重试几次”是 systemd 用户态代码里的策略。排障时问错层是常见浪费：`ls` 输出颜色不对去翻内核源码，如同 `grep` 查不到内容去研究 ext4 的目录项存储——前者的答案在 `src/ls.c`，后者的答案才在 fs/。判断去哪层读的准则只有一条：**内核管“能不能”，用户态管“按什么规矩”**。机制与规矩的交界处（syscall 边界）正是本篇 [系统调用](./syscall-path.md) 章画过的那条线，本章所有内容都发生在这条线的用户态一侧。拿不准时对照下表分层：

| 症状/问题 | 答案所在层 | 该读哪里 |
|-----------|-----------|----------|
| `ls` 着色规则不对、排序行为存疑 | 用户态语义 | coreutils `src/ls.c` 与 `tests/` |
| 缓冲导致输出顺序、时机反常 | C 库语义 | glibc `libio/` 与 man 3 stdio |
| 服务重启策略、启动顺序不符预期 | 用户态策略 | systemd `src/core/` 与 unit 文件语法 |
| 读文件返回 -EACCES、写入被拒 | 内核机制 | 内核 VFS 与权限检查（本篇 [VFS 与 ext4](./vfs-ext4.md) 章） |

### 1.2 用户态实验的三个优势

其一，构建快：coreutils 全量编译约 1-2 分钟、glibc 十几分钟量级，而内核以小时计——实验迭代成本低一个数量级。其二，爆炸半径小：用户态程序崩了是退出码和 core dump，随时重来；内核模块与内核调试崩了是整机 panic，必须活在虚拟机快照里（[编译与模块](./build-and-modules.md) 章的风险模型）。其三，观察手段现成：`strace`、`gdb`、`LD_DEBUG` 这些工具全部挂在用户态边界上，[跟踪工具](./tracing-tools.md) 章练熟的命令在这里直接复用，且不必挂载 tracefs 或开 BPF。这三点合起来意味着一件事：**先在用户态仓库练熟“入口 → 调用链 → 实证”的走读法，再带着同一套方法回内核，是性价比最高的学习曲线**。本章的三个目标就是按这条曲线选的：由浅入深，一个命令、一层库、一个守护进程。

## 2. coreutils：一个命令的一生

### 2.1 核心结构：仓库地图与自建编译

先拿到代码。发行版的二进制包无法对应阅读，自建才是正路。三系的差异只在工具链这一步：

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 编译工具链 | `sudo apt install build-essential` | `sudo pacman -S --needed base-devel` | `sudo dnf groupinstall "Development Tools"` |

工具链就位后，取源码与构建三系完全一致（tarball 以 [GNU 官方 coreutils 目录](https://ftp.gnu.org/gnu/coreutils/) 中的最新 9.x 为准，下同）：

```bash
$ wget https://ftp.gnu.org/gnu/coreutils/coreutils-9.x.tar.xz
$ tar xf coreutils-9.x.tar.xz && cd coreutils-9.x
$ ./configure && make -j$(nproc)          # 约 1-2 分钟
$ ./src/ls --version | head -1
ls (GNU coreutils) 9.x
```

tarball 走 `./configure` 即可；git clone 路线则要先 `./bootstrap` 同步 gnulib（README-hacking 有细节），本章取前者。目录地图只需记四个：

```text
coreutils-9.x/
├── src/       # 每个命令一个主程序：ls.c、cp.c、cat.c……（阅读主战场）
├── lib/       # 各命令共用的工具库：版本比较、磁盘用量、排序原语
├── gnulib/    # 可移植层（git 路线下是子模块）：POSIX 兼容的第三方代码
└── tests/     # 每个命令的测试套件——行为语义的权威文档
```

gnulib 是理解 coreutils 能在三系上原样跑的关键：它是被“vendor”进来的可移植函数层——时间格式化、正则、目录遍历这些 POSIX 定义含糊或平台有差别的能力，由 gnulib 统一实现，coreutils 自己的代码只写“语义”不写“平台补丁”。这个“第三方层同步进来”的组织方式与包管理器把补丁打进源码包是同一思想，也直接决定了阅读纪律（见第 6 节的对应坑位）。

### 2.2 关键调用路径：从 main 到 stdout

`ls` 的执行主线是一条经典的命令行程序流水线：`main` 解析 `argv` → `decode_switches` 把 `--color=always` 这类选项翻译成全局配置变量 → 逐目录收集条目 → 按配置决定排序与着色 → 经 stdio 缓冲分块写向 stdout。着色决策的落点在条目分类（“这是目录、这是符号链接、这有执行位”）与调色板拼接上，全部是用户态比较——**内核在整条链里只被问了两类问题：目录里有什么（getdents64）、往哪写（write）**。这条链与模块章的调用路径读法完全同构：入口唯一、逐级下行、边界清晰，唯一区别是最后一级落在 `syscall` 指令而非 `entry_SYSCALL_64`——或者说，正是 [系统调用](./syscall-path.md) 章那条链的上半截。整条链俯瞰如下：

```text
main(argc, argv)
  └─ decode_switches()        # 选项 → 全局配置变量（--color=always 在此落地）
       └─ 逐目录收集条目       # readdir 系调用，边界处触发 getdents64
            └─ 分类与着色决策   # 用户态比较：目录/链接/可执行位 → 调色板拼接
                 └─ stdio 缓冲  # 行缓冲/全缓冲，攒够或遇换行才冲刷
                      └─ write() ← syscall 指令，进入内核
```

### 2.3 源码阅读顺序：先定位再通读

`src/ls.c` 上万行，硬读是弯路。正确姿势是 grep 定位三步（输出行号随版本变动，仅示意）：

```bash
$ cd coreutils-9.x
$ grep -n 'decode_switches' src/ls.c | head -2   # 第一步：选项解码入口
1641:static int
1642:decode_switches (int argc, char **argv)
$ grep -n 'print_color_indicator' src/ls.c | head -2   # 第二步：着色落点
997:static bool
998:print_color_indicator (const struct bin_str *ind)
$ grep -rn 'decode_switches' src/ | head         # 第三步：确认没有第二处定义
```

顺着入口读它对 `color` 与长选项表的处理，再回 `main` 顺一遍主循环——**grep 是读大型用户态源码的显微镜**，这正是本篇 [目录导读](./source-tree.md) 章“索引与浏览”一节讲的原则，只是这里用的是最朴素的 grep。行为拿不准时读 `tests/` 下对应命令的用例：测试是语义的权威版本，比任何旧书都可靠。

### 2.4 实操跟踪：strace 看三段式

编译产物直接喂给 strace，把一次列出拆成 syscall 现场（注意管道下 `ls` 默认不着色，需显式 `--color=always` 才能看到转义序列走 write；行数与字节数随版本和目录变动，仅示意）：

```bash
$ strace -e trace=getdents64,write ./src/ls --color=always 2>&1 | head -5
getdents64(4, /* 42 entries */, 32768) = 1344
write(1, "\033[0m\033[01;34mbin\033[0m \033[0m\033[01;34mdoc\033[0m "..., 1024) = 1024
write(1, "README.md src tests\n", 21) = 21
```

三段一目了然：`getdents64` 批量把目录项读进用户态（一次调用带回整批条目，缓冲由内核供给）；中间那段“读目录 → 分类 → 着色”的热闹全部发生在两次 syscall 之间，**strace 里看不见它，却决定了 write 的内容**——这就是“语义在用户态”的实证；`write` 按缓冲区大小分块吐出。追问一层，用 [跟踪工具](./tracing-tools.md) 章的 ftrace 或 `perf stat` 可证：getdents64 调用次数远少于输出行数。想亲眼看计数，strace 自带统计模式（数值随目录内容变动，仅示意）：

```bash
$ strace -c -e trace=getdents64,write ./src/ls > /dev/null
% time     seconds  usecs/call     calls    errors    syscall
------ ----------- ----------- --------- --------- ----------------
  0.00    0.000000           0         1           getdents64
100.00    0.000143          71         2           write
------ ----------- ----------- --------- --------- ----------------
100.00    0.000143                     3           total
```

一次 `getdents64` 带回整个目录的条目，两笔 `write` 吐出全部输出——**次数对比就是“批量读、分块写”最直接的证据**。边界看够了，再往边界内走一步：gdb 直接下断点看用户态调用栈（源码树内构建的产物自带符号，零配置可调试）：

```bash
$ gdb -batch -ex 'break decode_switches' -ex run -ex bt --args ./src/ls
Breakpoint 1, decode_switches (argc=1, argv=0x...) at src/ls.c:...
#0  decode_switches (argc=1, argv=0x...) at src/ls.c:...
#1  main (argc=1, argv=0x...) at src/ls.c:...
```

`bt` 打出的两帧——`main` 调 `decode_switches`——正是 2.2 节链路的第一跳。**strace 看边界、gdb 看边界内，两者拼起来就是一次完整的走读**；这套“边界上看次数与内容、边界内靠源码”的双轨法，与 [系统调用](./syscall-path.md) 章跟 `write()` 的方法是同一套，只是这回从 `ls` 这一侧发起。

### 2.5 延伸资料：测试套件与官方文档

coreutils 侧的延伸有三处，都不需要额外买书：`tests/` 目录读用例（行为语义的权威版本）、`src/*.c` 顶部的长注释（作者留下的设计笔记）、NEWS 文件（版本间语义变更的编年史）。读完本节若想把“一次命令 = 一串 syscall”的观感接回内核视角，直接回 [系统调用](./syscall-path.md) 章对账；想把 strace 用法再上一层楼，去 [跟踪工具](./tracing-tools.md) 章。书目方面，Michael Kerrisk《The Linux Programming Interface》的文件 I/O 与标准 I/O 部分讲透了本节涉及的缓冲与描述符语义（章节号以你手上版本为准，见文末参考资料）。

## 3. glibc：系统调用的最后一厘米

### 3.1 核心结构：三层分工与源码地图

`printf("hi")` 到屏幕之间隔着三层：**stdio 缓冲层**（数据先进 FILE 结构的缓冲区，行缓冲/全缓冲决定何时冲刷）→ **write 包装层**（glibc 把缓冲区交给 `write` 的平台封装）→ **syscall 指令层**（汇编把调用号装进寄存器、执行陷入指令）。源码地图对应三站：stdio 一侧在 `libio/`（glibc 内部 IO 函数一律 `_IO_` 前缀，这是稳定的路标），系统调用封装在 `sysdeps/` 下按平台层层分叉，x86-64 + Linux 这条路径落在 `sysdeps/unix/sysv/linux/` 一带，最底下是各架构的汇编封装。三层的分工解释了两个常见现象：`printf` 没换行时迟迟不出（缓冲未冲刷）、`strace` 里 `write` 的次数和 `printf` 的行数对不上（包装层合并与分块）。

### 3.2 关键调用路径：printf 到 write

主链很短，但每一层都值得一格：

```text
printf("hi %d", n)                 # 格式化：结果进 FILE 的缓冲区
  └─ _IO_file_xsputn               # libio/ 缓冲写：满/换行/fflush 才放行
       └─ write 的平台封装          # sysdeps/unix/sysv/linux/ 一带
            └─ syscall 指令         # 汇编封装：调用号进寄存器，陷入内核
```

**这条链上每往下一层，抽象就薄一分，直到寄存器装载完毕**——与模块章“每章跟一条从上到下的链”是同一训练法，只是链短得多。三层的分工也在这里落地：缓冲层解释了 `printf` 没换行时为何迟迟不出、包装层解释了 `write` 次数为何与 `printf` 行数对不上。链上还有一个必须点名的岔路：并非所有“系统调用”都陷入内核。`gettimeofday`、`clock_gettime` 这类读时钟的操作，内核会把一小段代码映射进每个进程地址空间（vDSO），glibc 直接在用户态调这段代码读时钟数据，只在 vDSO 未命中时才退回真 syscall——这就是 `strace` 里看不到 `clock_gettime` 却照样拿到时间的原因。谁在干这件事、如何被解析，[系统调用](./syscall-path.md) 章已从内核侧讲过；用户态视角只需记住一句：**vDSO 是 glibc 对 syscall 边界的“豁免通道”，读 strace 输出前先问一句“这个操作有没有豁免通道”**。

### 3.3 源码阅读顺序：从符号到实现

glibc 检索纪律比内核更依赖目录感：**先想清楚“x86-64 + Linux”这条路径，再顺藤摸瓜**。步骤上，先在 gitweb（sourceware 有反爬，浏览器访问正常）里全局搜符号名拿到平台无关的入口声明，再进 `sysdeps/unix/sysv/linux/` 找平台封装，最后看该架构目录下的汇编；stdio 一侧则从 `libio/` 的 `_IO_` 家族入手。两个省力的落脚点：一是头文件与注释比书新——`bits/syscall.h` 一族直接给出调用号清单；二是**验证工具就在手边**——`LD_DEBUG` 与 strace 是本节的仲裁者，书上说的符号以你检出的版本源码为准，对不上就信源码。

### 3.4 实操跟踪：LD_DEBUG 与地址映射

glibc 内置的调试开关开箱即用，不改代码就能看见符号绑定的动态过程（环境变量的语义见 [脚本篇变量章](../script/variables.md)）：

```bash
$ LD_DEBUG=symbols /bin/ls > /dev/null 2> /tmp/ld.log
$ grep -m3 'lookup' /tmp/ld.log
   17321:	symbol=write;  lookup in file /usr/lib/libc.so.6 [0]
   17321:	symbol=write;  binding file /bin/ls [0] to /usr/lib/libc.so.6 [0]: normal symbol
$ LD_DEBUG=help /bin/ls 2>&1 | head -5        # 输出爆炸前，先看可用子选项
```

`LD_DEBUG` 子选项很多（`bindings`、`files`、`reloc`……），生产环境一律重定向到文件再 grep，直接打屏会淹没终端。第二组对照实验把静态与动态接起来：

```bash
$ ldd /bin/ls | head -3                       # “答应给谁”：解析出的库清单
	linux-vdso.so.1 (0x00007ffd8c7e9000)
	libc.so.6 => /usr/lib/libc.so.6 (0x00007f...)
$ cat /proc/self/maps | grep libc              # “实际映了谁”：真正进地址空间的段
7f...-7f... r--p 00000000 08:02 12345678 /usr/lib/libc.so.6
```

**ldd 是“答应给谁”，maps 是“实际映了谁”**，动态加载排错时以 maps 为准——这与“配置说了什么不等于进程用了什么”的 systemd 读法（第 4 节）一脉相承，也是本章反复出现的“运行态才是真相”原则的又一次落地。

### 3.5 延伸资料：vDSO 与 man 一页

glibc 侧的延伸从一页 man 开始：`man 7 vdso` 用不到十行讲清豁免通道的机制与观测方法，是本篇少见的“官方自述”型文档。书目上，Kerrisk《The Linux Programming Interface》的文件 I/O、标准 I/O 与动态链接相关部分是本节的展开版（章节号以手上版本为准）。做完本节实验，可回 [系统调用](./syscall-path.md) 章把内核侧的 vDSO 解析与这里用户侧的 `LD_DEBUG` 观测拼成完整图景——**同一件事，两侧各看一半**。

## 4. systemd：单元加载的一角

### 4.1 核心结构：src/core 三件套

systemd 源码以庞大著称，但“一个 unit 文件如何变成可拉起的进程”这条线索短而完整，适合选读。仓库顶层是 `src/` 大目录，核心在 `src/core/`——PID 1 的本体。本节只记三件套：`unit.c`（单个单元的加载主逻辑与入队机制）、`load-fragment.c`（unit 文件的语法解析器，把 `Description=`、`ExecStart=`、`Wants=` 这些键值逐行翻译成结构体字段）、`manager.c`（管理器整体生命周期，单元加载被编排进启动次序）。三者的分工可以概括成：**manager 决定“何时加载”，unit 决定“加载什么”，load-fragment 决定“怎么翻译”**——先把这张分工表记住，再进任何函数都不迷路。

### 4.2 关键调用路径：manager_startup 到 unit_load

主链两段。整体一段：`manager_startup` 展示启动次序（跑生成器、枚举既有单元、coldplug、就绪），单元加载编排在这条主线里。个体一段：`int unit_load(Unit *u)` 是单个单元加载的主函数，顺它会碰到 `unit_load_fragment_and_dropin`（连同 drop-in 一起定位 fragment 文件）与入队机制 `unit_add_to_load_queue`（解析未完的单元先排队、批量推进）。**两段合起来回答了“文件怎么变成内存结构”**——磁盘上的文本经 load-fragment.c 翻译成字段，字段挂进 manager 管理的结构里，进程再依据这些字段被拉起。D-Bus 与事务求解不在本节范围——那属于管理面 [systemd 进阶](../system-management/services-systemd.md) 章已讲的 Wants/Requires 语义，这里只补实现侧，读完正好与管理面互为表里。

### 4.3 源码阅读顺序：沿主函数顺藤摸

顺序与前两节一致，但入口换成主函数本身。先用 grep 把三站钉在地图上（行号随版本变动，仅示意）：

```bash
$ grep -n 'int unit_load(' src/core/unit.c        # 第一站：加载主函数
1412:int unit_load(Unit *u) {
$ grep -n 'ExecStart' src/core/load-fragment.c | head -2   # 第二站：语法落字段处
...
$ grep -n 'manager_startup(' src/core/manager.c   # 第三站：整体启动次序
```

然后读 `unit_load` 依次调了谁（fragment 定位、drop-in 合并、解析、入队），进 `load-fragment.c` 挑一个自己 unit 文件里见过的键（比如 `ExecStart=`）反向搜、看它落到 `Unit` 结构的哪个字段，最后回 `manager.c` 看 `manager_startup` 如何安排批量加载。每一步都带着一个具体问题——“这个键最终变成什么字段”“排队的单元何时被批量推进”——**问题驱动比顺序通读快一个数量级**，这与 [目录导读](./source-tree.md) 章的索引思路一脉相承。不深入 D-Bus 信号与依赖图求解，那是另一条深水区航线。

### 4.4 实操跟踪：运行态对表

源码字段的最好验证是拿运行态对表（`dump` 输出随版本与单元内容变动，仅示意）：

```bash
$ systemctl cat nginx | head -8               # 运行时真正生效的 unit 内容（含 drop-in）
$ systemd-analyze dump | grep -A2 'Unit nginx.service' | head
```

`systemctl cat` 的输出与 `load-fragment.c` 解析的输入是同一份文本，`dump` 则把 `unit_load` 之后的内存结构摊开——**三者串起来就是“文件 → 解析 → 结构体”的完整证据链**。对照时记住管理面那条铁律的源码版本：磁盘上的文件可能被 drop-in 覆盖、被 generator 临时改写，dump 出来的字段才是进程实际依据的字段。想进一步看加载顺序，时间线视角与本节的代码视角互补（数值随机器变动，仅示意）：

```bash
$ systemd-analyze critical-chain nginx.service
nginx.service +812ms
└─network-online.target @1.456s
  └─NetworkManager-wait-online.service @402ms +1.054s
```

`critical-chain` 回答“谁拖了后腿”，`unit_load` 链回答“字段从哪来”——**一个看时间，一个看结构，合起来才是完整的单元生命周期**。

### 4.5 延伸资料：管理面回链

systemd 侧的延伸分两支。操作一支回 [systemd 进阶](../system-management/services-systemd.md) 章：unit 文件的完整语法、Wants/Requires 的语义在那里，本节的源码阅读正好解释了那些语义“为什么长这样”。文档一支看官方 man 页：`man 5 systemd.unit` 是键值语法的权威定义，与 `load-fragment.c` 的解析器逐行对应——**读解析器时把 man 页摊在旁边，一边是规格一边是实现**，这是读配置型源码的通用捷径。英文不挡路的话，systemd 源码树根目录的文档目录也值得一览。

## 5. 方法论：把模块章的肌肉迁移过来

用户态与内核源码的读法同构，但差异决定操作细节，值得贴在显示器边上：

| 维度 | 内核源码 | 用户态源码 |
|------|---------|-----------|
| 构建周期 | 小时级（全量编译） | 分钟级（coreutils 约 2 分钟） |
| 崩溃半径 | 整机 panic，虚拟机快照保命 | 进程退出，core dump 重来 |
| 调用边界 | syscall/中断（strace/ftrace 各管一半） | 函数调用为主，strace 只看边界 |
| 调试器 | gdb + QEMU `-S -s` 断点冷启动 | gdb 直接 attach 进程，零风险 |
| 入口形态 | `start_kernel` / syscall 表 / 中断向量 | `main` 或回调（GUI/事件循环） |
| 行为权威 | 内核源码与文档 | `tests/` 用例与 man 页 |

通用顺序不变，拆开是四步：

1. **找入口**：`main`、注册的回调或主函数本身；grep 符号名与命令行选项字符串两路夹击
2. **顺调用链**：从入口逐级下行，每层记一个问题（这层做什么、往下交给谁）
3. **拿证据闭环**：strace 的次数与内容、LD_DEBUG 的绑定记录、dump 的字段——每步推断都要有可观测输出背书
4. **回配置对表**：源码结论与实际生效的配置/运行态互相验证，不一致时以运行态为准

**先 grep 定位、再顺链下行、每一步都拿证据闭环**，这是本篇所有章共享的走读法，换仓库不换方法。本章三个目标恰好各练一块肌肉：coreutils 练“边界与内容分离”的双轨观察，glibc 练“分层抽象逐层剥”，systemd 练“配置与运行态对表”。三块肌肉合起来，就是读任意用户态仓库的底气。

## 6. 常见坑

**读了主分支，对不上系统跑的版本。** coreutils 跨大版本行为有差异（着色规则、排序细节、长选项集都动过），现象是“源码里明明这样写”。先 `ls --version` 对版本，再决定是否 checkout 对应 tag——git 仓库里 `git log` 一个函数名的历史，比翻书准。

**进了 gnulib 目录出不来，白费劲。** 它是同步进来的第三方可移植层，读它等于读移植史而不是读 `ls`。纪律：`src/` 是语义、`lib/` 是工具、`gnulib/` 原则不进——在 gnulib 里迷路十分钟就该退出来。

**LD_DEBUG 输出爆炸刷屏。** 直接 `LD_DEBUG=symbols` 跑任一程序，几千行瞬间涌出。先 `LD_DEBUG=help` 看子选项清单，一律重定向到文件再 grep；测试完记得卸掉环境变量，它对子进程同样生效。

**在 glibc 里搜函数名搜出好几个实现。** glibc 的代码按平台分目录（`sysdeps/` 下按架构与内核家族层层分叉），`write` 在 unix/sysv/linux 一条线上才有意义，别的目录是别的平台的同名实现。检索时先想清楚“x86-64 + Linux”这条路径，再顺藤摸瓜。

**systemd 单元文件与源码结构对不上。** 磁盘文件可能被 drop-in 覆盖、可能被 generator 临时改写，直接读 `/usr/lib/systemd/system/` 下的原文会得出错误结论。以 `systemctl cat` 的合并结果为输入、`systemd-analyze dump` 的字段为输出，源码只解释中间的翻译过程——**运行态永远是“当前真相”，磁盘只是“候选输入”**。

## 参考资料

- coreutils 源码仓库 — [github.com/coreutils/coreutils](https://github.com/coreutils/coreutils)（GNU 官方 Git 仓库镜像）
- GNU coreutils 发行目录 — [ftp.gnu.org/gnu/coreutils](https://ftp.gnu.org/gnu/coreutils/)
- glibc 源码浏览（gitweb） — [sourceware.org/git/?p=glibc.git](https://sourceware.org/git/?p=glibc.git)
- systemd 源码仓库 — [github.com/systemd/systemd](https://github.com/systemd/systemd)
- gnulib 可移植层项目 — [gnu.org/software/gnulib](https://www.gnu.org/software/gnulib/)
- systemd.unit 手册页 — [freedesktop.org/software/systemd/man/systemd.unit.html](https://www.freedesktop.org/software/systemd/man/systemd.unit.html)
- Michael Kerrisk.《The Linux Programming Interface》（Linux 程序设计）— man 手册维护者所著，系统编程接口的权威参考
- Linux 手册页 — [man7.org](https://man7.org/)（`man 2 write`、`man 7 vdso`、`man 7 system_data_types` 一族）
