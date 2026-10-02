# VFS 与 ext4：源码导读

`cat /etc/passwd` 敲下去的瞬间，内核里发生了一连串分派：这个路径怎么变成一个打开的文件？读到的内容从磁盘还是从内存来？为什么第二次 `cat` 比第一次快得多？这些问题的答案都在 VFS（虚拟文件系统）与 ext4 的源码里。VFS 是"一切皆文件"这句话的实现层——`read()` 一个普通文件、一个管道、一个设备走的是同一个系统调用入口，靠函数指针表分派到各自的实现；ext4 则是这张表在磁盘文件系统上的一次具体实现。本页按源码篇统一五段式展开：先认清五个核心数据结构，再逐级走读 `open` 与 `read` 两条调用链，然后给出一个不会被 3000 万行代码淹没的阅读顺序，最后用 strace、page cache 实验、bpftrace 与 ftrace 把静态源码变成动态现场。读路径入口的系统调用一侧见[系统调用](./syscall-path.md)章，跟踪工具的完整用法见[跟踪工具](./tracing-tools.md)。

> 内容参考自内核源码树（v6.12）、ext4 官方 wiki 与上述书目（概念框架），见文末参考资料。

## 学习目标

- 说清 VFS 五对象（super_block/inode/dentry/file/address_space）各自的职责与所在头文件
- 走通 open 与 read 两条调用链，解释 `f_op->read_iter` 这一步的分派本质
- 知道 ext4 的 `ext4_map_blocks` 如何把文件偏移翻译成磁盘块，日志为什么存在
- 掌握 page cache 的三个实证实验（Cached 变化、二次读断崖、drop_caches 对照）
- 会用 bpftrace/ftrace 对读路径做一次真实的函数级跟踪

## 1. 为什么要有 VFS

"一切皆文件"不是磁盘组织的描述，而是**接口层**的承诺：`write(fd, buf, n)` 对一个普通文件、一个管道、一个字符设备在语法上完全一致。内核不可能为每种对象写一套系统调用，于是用 C 语言的函数指针表实现了多态——每个打开的 `file` 都带着一张 `file_operations` 表，`read_iter` 指向谁，读的行为就是谁。这就是 VFS 的本体：一套抽象接口（对象结构 + 操作表）加一族具体实现。理解了这个分派机制，"Linux 为什么能把 `/proc`、`/sys` 也做成文件"就不再神秘——只要填对一张操作表，任何东西都能被"文件化"。

| 家族 | 文件系统 | 数据真正存在哪 |
|------|---------|---------------|
| 磁盘系 | ext4、xfs、btrfs | 块设备上的自有布局 |
| 内存系 | tmpfs | 仅 page cache/内存，掉电即失 |
| 伪文件系 | proc、sysfs | 内核数据结构的即时快照，读即查询 |
| 网络系 | nfs | 远端服务器的存储 |

这张族谱也预告了本页的主角定位：VFS 是所有家族共用的接口层，ext4 只是磁盘系的代表。读 NFS 文件与读 ext4 文件走完全相同的 `vfs_read`，只在 `f_op->read_iter` 分派之后才分道扬镳——接口与实现的边界，画在这里。

## 2. 核心数据结构

VFS 的五个对象各管一段生命周期，全部可以在两个头文件里找到定义（`include/linux/fs.h` 与 `include/linux/dcache.h`）：

| 对象 | 定义位置 | 一个对应几个 | 管什么 |
|------|---------|-------------|--------|
| `super_block` | include/linux/fs.h | 一个**已挂载的文件系统实例** | 整个文件系统的全局状态：块大小、inode 总数、脏页回写水位 |
| `inode` | include/linux/fs.h | 一个**磁盘对象**（文件/目录/设备） | 内容的元数据：大小、权限、时间戳、数据块位置；按 inode 号在文件系统内唯一 |
| `dentry` | include/linux/dcache.h | 一个**路径名组件** | 把名字映射到 inode；全部 dentry 构成 dcache 目录缓存 |
| `file` | include/linux/fs.h | 一次 `open` | 会话状态：`f_pos` 读游标、标志位、指向 `file_operations` |
| `address_space` | include/linux/fs.h | 一个 inode 的页缓存 | 该文件所有缓存页的账本，`i_pages`（XArray）按页索引号组织 |

五个对象的关系用一次 `cat /etc/passwd` 串起来最清楚：路径解析逐组件命中 dentry（`etc` 与 `passwd` 两个 dentry），每个 dentry 指向一个 inode；`passwd` 的 inode 挂着一个 address_space 管着它的缓存页；`open` 成功后内核再造一个 file 结构记录这次会话的游标与操作表。**inode 与 dentry 的分工是初学者第一个必须掰清的概念**：名字属于 dentry，内容元数据属于 inode。硬链接的本质由此一目了然——两个 dentry 指向同一个 inode，`inode->i_nlink` 计数加一；`rm` 只删 dentry 并递减计数，归零才真正释放 inode。这也解释了那个经典现象：进程打开着的文件被 `rm` 后，fd 依然可读可写——inode 只要还有引用（此处是 file 结构）就不会被回收，"文件没了"只是名字没了。

file 结构的 `f_pos` 游标还藏着 fork 的语义：父进程 `open` 后 `fork`，两个进程共享**同一个** file 结构，一方的读会推进另一方的游标——shell 里重定向的继承就建立在这之上；而各自独立 `open` 同一文件得到的是两个 file、两套游标，互不影响。多态的接口本体是三张函数指针表：`file_operations`（读写等会话操作）、`inode_operations`（创建/链接等名字空间操作）、`super_operations`（inode 的分配回收与回写）。ext4 源码里的 `ext4_file_operations`（fs/ext4/file.c）就是 `file_operations` 的一次填表——`.read_iter = ext4_file_read_iter` 一行，就把"ext4 的读"挂进了通用分派。

address_space 是页缓存的账本（`struct xarray i_pages` 按页索引号组织缓存页，取代了老书里的 radix tree），它把"文件的第 N 页"映射到内存页框。这一层与内存管理的 `struct page` 直接交接，页的结构与分配回收见[内存管理](./memory-management.md)；用户侧"文件系统"概念（挂载、inode 号、`df` 的空间）见[文件系统概念](../basic/filesystem/concept.md)，本页只讲内核实现。

五对象的组合还有一个藏在 fs/dcache.c 里的动态机制值得单独点名：**dcache 的查找与回收**。路径解析的每一步都先在 dentry 哈希表里做 `d_lookup`，命中即免去磁盘 I/O；未命中的 dentry 会被挂入 LRU，内存吃紧时由内核回收（回收只删缓存、不动文件本体）。这就解释了两件运维现象：`ls` 一个从未访问过的冷目录后，后续访问持续变快——dentry 与 inode 正在被逐级回填；而 `find /` 扫过全盘后内存占用攀升，是 dcache+inode cache+page cache 三层集体扩张的正常结果，`free` 的 buff/cache 栏随之变大（"这是缓存不是泄漏"的判定见第 6 节）。

### 2.1 伪文件系统怎么"读"：proc 与 seq_file 的反例

不是所有 file 背后都有磁盘块。`cat /proc/meminfo` 同样走 `vfs_read` → `f_op->read_iter`，但 procfs 的实现（fs/proc/）里没有 `address_space` 的磁盘页——它注册的操作表在每次 `read` 时现场调用内核的 `show()` 回调，把内核数据结构（内存统计、进程列表、`/proc/self/fd`）即时拼成文本喂给用户。这类"读即查询"的伪文件系统是理解 VFS 多态的最好反例：文件只是**接口**，`f_op` 表后面可以是磁盘（ext4）、内存（tmpfs）、内核数据（proc/sysfs）或远端服务器（nfs）。`seq_file`（fs/seq_file.c）是这类实现的公共骨架——内核里成百上千个 `/proc` 条目都不自己管"读到第几行"，而是把行拼装交给 seq_file 的游标机制。

## 3. 关键函数调用路径

### 3.1 open 路：名字怎么变成 file

```text
openat(2)
  └─ do_sys_openat2()            fs/open.c     解析 flags/mode → struct open_how
      └─ do_filp_open()          fs/namei.c    建立路径解析上下文
          └─ path_openat()       fs/namei.c    逐组件走 dcache（命中即返回）
              │                                 未命中则调用文件系统的 lookup 回填 dentry
              ├─ alloc_empty_file()            分配 file 结构
              └─ f_op->open()                  调用具体文件系统的打开钩子（多数文件系统无动作）
```

`path_openat`（fs/namei.c）所在的 fs/namei.c 是全内核最复杂的路径解析器——符号链接循环、挂载点穿越、权限逐级检查都发生在这里，第一次读只跟主干的 `link_path_walk` 即可，跳过 symlink 处理细节。值得体会的设计是 dcache 的位置：路径解析**先查缓存**，`ls /etc` 快不是因为磁盘快，而是这些 dentry 早就驻留内存；缓存未命中才会走到具体文件系统的 `lookup` 回调去磁盘上找。

### 3.2 read 路（本页高潮）：从 vfs_read 到页缓存

```text
read(2)
  └─ ksys_read()                fs/read_write.c   fd → struct file
      └─ vfs_read()             fs/read_write.c   权限与基本检查
          └─ new_sync_read()    fs/read_write.c   同步读的包装，转 async 接口
              └─ f_op->read_iter                  ★分派点：file_operations 表决定走向
                  └─ ext4_file_read_iter()    fs/ext4/file.c   ext4 的入口：shutdown/空读/DAX/DIO 分流
                      └─ generic_file_read_iter()  mm/filemap.c 普通缓存读（薄封装）
                          └─ filemap_read()        mm/filemap.c 真正的读循环
                              ├─ filemap_get_pages()  先查 address_space 页缓存
                              │    └─ 未命中 → 构造 BIO 向块层要页（块层细节本文不展开）
                              └─ copy_page_to_iter() 命中/到达后拷贝到用户缓冲区
```

这条链上最值得盯住的是 `f_op->read_iter` 那一行：`new_sync_read` 拿到的只是一个 `file`，它不知道也不需要知道背后是 ext4、tmpfs 还是 proc；解引用函数指针的瞬间，具体实现才接管。ext4 的 `ext4_file_read_iter`（fs/ext4/file.c）自己只处理异常与特殊模式（强制 shutdown 返回 `-EIO`、空读短路、DAX/DIO 分流），普通缓存读委托给 `generic_file_read_iter`，后者是几乎全部磁盘文件系统共用的通用实现——真正的读循环在 `filemap_read`（mm/filemap.c）。`filemap_get_pages` 按 `f_pos` 算出页索引，到 `address_space->i_pages` 里找页：命中则直接拷给用户，未命中才向块层发 BIO 把磁盘上的块读进缓存页再拷。**第二次 `cat` 比第一次快，快的正是"查到了、不用发 BIO"这一段**——第 5 节用三个数字实证它。

### 3.3 ext4 侧：文件偏移怎么翻译成磁盘块

ext4 用 extent 描述"文件第 X 到 Y 块存在磁盘第 Z 到 W 块"，`ext4_map_blocks`（fs/ext4/inode.c:595）是这条翻译链的入口：给定 inode 与文件内块号，返回对应的磁盘块号与长度。页缓存未命中要读磁盘时，`ext4_map_blocks` 的返回值就决定了 BIO 去哪些扇区取数。文件系统概念的挂载与 inode 号用户视角见[文件系统概念](../basic/filesystem/concept.md)。

### 3.4 写路径：延迟分配与日志什么时候干活

读是"查表拷贝"，写多出一层时序问题——数据何时真正落到磁盘：

```text
write(2)
  └─ vfs_write()                    fs/read_write.c
      └─ f_op->write_iter           ★分派点（与读对称）
          └─ ext4_file_write_iter() fs/ext4/file.c   重定向/覆盖/DIO 等分流
              └─ ext4_buffered_write_iter()
                  └─ generic_perform_write()         mm/filemap.c 按页推进
                      ├─ ext4_write_begin()  fs/ext4/inode.c
                      │    └─ ext4_map_blocks 找磁盘位置——这里才真正分配块
                      │    └─ jbd2_journal_start()   开启日志事务
                      ├─ 把用户数据拷进页缓存（此刻 write 已可返回！）
                      └─ ext4_write_end()    提交日志事务、inode 计数与时间戳入账
```

这条链上有两个非直觉的时序事实，是理解 ext4 崩溃行为的钥匙。其一，**延迟分配**（delayed allocation）：数据写进页缓存这一刻，`ext4_map_blocks` 才第一次为它挑磁盘块——更晚分配意味着文件关闭/回写时能看到更完整的连续块图，从而减少碎片。其二，**`write()` 返回 ≠ 数据上盘**：write 的系统调用在拷进页缓存后就返回成功，jbd2 日志（把元数据变更先记日志再落盘，崩溃后重放保证一致性）保证的是"元数据一致性"，不是"你的数据此刻在磁盘上"——所以 `fsync` 是应用要正确性就必须自己调的一步，它把页缓存刷下盘并等待日志提交。用户在 `mount` 选项看到的 `data=ordered/writeback/journal` 三档控制"文件数据要不要也进日志"：ordered（默认）只保证元数据提交前数据先落盘，writeback 连这层保证都没有（崩溃可能暴露旧的半截数据），journal 最强但最慢。`ext4_write_begin` 源码注释里那句 `jbd2_journal_start at the start of` 正是这层边界的直接注脚。

## 4. 源码阅读顺序

| 顺序 | 文件 | 读什么 | 预计行数 |
|------|------|--------|---------|
| 1 | fs/read_write.c | `vfs_read`/`vfs_write`，短小，看清检查与分派骨架 | 各 ~30 行 |
| 2 | fs/namei.c | `path_openat` 主干与 `link_path_walk` 的逐组件循环（跳过 symlink 细节） | 主干 ~80 行 |
| 3 | mm/filemap.c | `filemap_read` 读循环与 `filemap_get_pages` 的命中/未命中分支 | ~200 行 |
| 4 | fs/ext4/file.c | `ext4_file_operations` 填表与 `ext4_file_read_iter` 的分流 | ~60 行 |
| 5 | fs/ext4/inode.c | `ext4_map_blocks` 的 extent 查找 | 选读 |

这个顺序的原则是"由薄到厚"：先在 30 行的函数里建立骨架感，再去读 200 行的实现体，最后才碰 ext4 的磁盘布局细节。读的时候开着 [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/latest/source)，每个函数名点进去看交叉引用，比本地 grep 更快建立"谁调用谁"的地图。读完代码用运行态互证：`cat /proc/slabinfo | grep -E "ext4_inode_cache|dentry"` 能看到内核里此刻活着的 inode 与 dentry 实例数——刚 `ls` 过的大目录会让 dentry 计数应声上涨，代码与机器在这一刻对上了号。

## 5. 实操跟踪

### 5.1 strace：看见 read 的调用面

```bash
$ strace -e trace=openat,read,close cat /etc/passwd | head -3
openat(AT_FDCWD, "/etc/passwd", O_RDONLY|O_CLOEXEC) = 3
read(3, "root:x:0:0:root:/root:/bin/bash\n"..., 8192) = 985
root:x:0:0:root:/root:/bin/bash
...
close(3)                                = 0
```

`read` 一次要了 8192 字节、实际返回 985——文件不足一块，一次读穿。对比 `dd if=/dev/zero of=/tmp/f bs=1M count=10` 后 `strace cat /tmp/f > /dev/null` 与 `strace dd if=/tmp/f of=/dev/null bs=1M`：dd 的 `read` 次数与 `bs` 成反比，cat 则固定按缓冲循环——**系统调用次数是被缓冲策略决定的**，这是"为什么库要带缓冲"的源码级答案（stdio 的全缓冲正是为了摊薄这次分派的开销）。

### 5.2 三个数字实证 page cache

```bash
$ dd if=/dev/urandom of=/tmp/big bs=1M count=512 && echo 3 | sudo tee /proc/sys/vm/drop_caches
$ grep ^Cached /proc/meminfo
Cached:            262144 kB          # 基线（清空后）
$ time cat /tmp/big > /dev/null
real    0m1.842s                     # 第一次：真读磁盘
$ grep ^Cached /proc/meminfo
Cached:            786432 kB          # 涨了 ~512MB：文件住进了缓存
$ time cat /tmp/big > /dev/null
real    0m0.171s                     # 第二次：断崖式变快
$ echo 3 | sudo tee /proc/sys/vm/drop_caches
$ time cat /tmp/big > /dev/null
real    0m1.795s                     # 丢缓存后打回原形
```

第一次读之后 `Cached` 涨了约 512MB、耗时从 1.8 秒跌到 0.17 秒、`drop_caches` 后一切复原——三个数字构成 page cache 存在性、体量与因果的最简证明，这正是 `filemap_get_pages` 命中分支在用户态的投影。做性能实验时**必须**像这样先 `drop_caches`，否则你测的是缓存不是磁盘。

### 5.3 bpftrace：按进程统计读次数

```bash
$ sudo bpftrace -e 'kprobe:vfs_read { @[comm] = count(); } interval:s:5 { exit(); }'
Attaching 2 probes...
@[cat]: 41
@[systemd-journald]: 6
```

五秒窗口里谁在走 `vfs_read` 一目了然——排障时"这文件被谁反复读"的答案就在这类一行程序里（[跟踪工具](./tracing-tools.md)）。

### 5.4 ftrace：函数级看一次读的纵深

```bash
$ cd /sys/kernel/tracing
$ echo function_graph > current_tracer
$ echo filemap_read > set_graph_function
$ echo > trace; cat /etc/passwd > /dev/null; cat trace | head -15
 # CPU  DURATION                  FUNCTION CALLS
   2)               |  filemap_read() {
   2)   0.121 us    |    pagecache_get_page();
   2)   0.085 us    |    mark_page_accessed();
   ...
   2)               |  }
```

`set_graph_function` 把整棵调用子树连同耗时画出来——读路径不是一条线而是一棵树，function_graph 是唯一能"看见树"的 tracer。观察 inode 生命周期则用 slab 计数：两个终端分别 `cat` 与 `stat` 同一文件，`cat /proc/slabinfo | grep ext4_inode_cache` 的 active 数只涨不随关闭立刻回落——inode 缓存的生命周期比 file 长得多，这正是 dcache/inode cache 与 page cache 三层缓存各自节奏的直观展示。

## 6. 常见坑

**性能实验结论飘忽——读到的是缓存不是磁盘。** 不先 `echo 3 > /proc/sys/vm/drop_caches` 的任何磁盘读测试，测到的都是 page cache 命中路径。第 5.2 节的三数字实验必须包含"丢缓存后复原"这一步作对照，否则快慢差异无法归因。

**老文章的函数名对不上。** 6.1 起 `filemap_read`（mm/filemap.c）成为读循环主体、`generic_file_read_iter` 退为薄封装，2.6 时代书里的 `do_generic_file_read`/`generic_file_aio_read` 更是早已改名。函数名漂移是内核源码阅读的常态，书上的机制思想仍成立，具体名字一律以 [elixir](https://elixir.bootlin.com/linux/v6.12/latest/source) 对当前版本核对为准。

**inode 与 dentry 混淆。** 名字、路径属于 dentry；大小、权限、块位置属于 inode。硬链接是多 dentry 一 inode；`rm` 已被打开的文件后 fd 仍可读写，是因为 inode 的生命周期跟着引用（file 结构）而非名字走。分不清这两个对象，dcache 与 inode cache 的行为就永远解释不通。

**free 的 buff/cache 被误读。** `buff`（buffers）如今主要是块设备元数据映射的残留，体量很小；`cache` 才是 page cache 主体。拿 buffers 当文件缓存分析，方向就错了——第 5.2 节实验里涨的是 `Cached`。

**ext4 日志模式改了没生效。** `data=ordered/writeback/journal` 是挂载属性，改完必须重新挂载或重启；用 `mount | grep ext4` 确认当前生效值，别相信 fstab 里写了就等于在跑。

## 7. 延伸资料

- Robert Love.《Linux内核设计与实现》（Linux Kernel Development, 3rd ed.）——VFS 一章：五对象与操作表的入门首选
- Daniel P. Bovet & Marco Cesati.《深入理解Linux内核》（Understanding the Linux Kernel, 3rd ed.）——VFS 与 ext2/3 相关章：数据结构关系图密集（基于 2.6，字段名需对照新源码）
- 毛德操、胡希明.《Linux内核源代码情景分析》——读文件情景的完整走读范式，本页第 3 节的结构即致敬此法（基于 2.4）
- Wolfgang Mauerer.《深入Linux内核架构》（Professional Linux Kernel Architecture）——VFS 相关章，字段级细节当参考手册查
- ext4 官方 wiki — [ext4.wiki.kernel.org](https://ext4.wiki.kernel.org/)
- Linux v6.12 源码在线交叉引用 — [elixir.bootlin.com/linux/v6.12](https://elixir.bootlin.com/linux/v6.12/latest/source)
