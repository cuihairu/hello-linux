# 内存管理

内存是内核里最难一眼看穿的子系统：进程以为自己独占一片连续地址，内核看到的却是几百万张 4KB 的散页账单；`free` 显示只剩几个 GB，`available` 却报还有几十 GB；一次普通的赋值，背后可能悄悄完成一轮缺页处理。本页按源码篇统一五段式展开——先认数据结构（谁在记账），再走三条调用路径（账怎么记），给出源码阅读顺序（先翻哪一页），配四组本机实跑的跟踪实验（把账本打印出来对照），最后列深化书目。全章函数名与文件路径逐一对照内核 v6.12 源码核实，老书写法与现源码冲突处，以本页为准。

> 内容参考自内核源码树（v6.12）与上述书目（概念框架），见文末参考资料。

## 学习目标

- 说清 memblock → buddy → slub 三层账本的分工，理解虚拟地址与物理页为何是两本账
- 读懂 `struct page`、`zone`/`free_area`、VMA、`kmem_cache` 四个核心结构，能把 `/proc` 输出与源码字段对上
- 默画缺页从 `exc_page_fault` 到 `do_wp_page` 的主干，以及 buddy、slub 两条分配路的调用链
- 用 minflt 计数、smaps、bpftrace 实证按需分页与写时复制——结论靠证据，不靠背诵
- 避开 min_flt/maj_flt 混淆、slab 三实现老黄历、smaps 口径不清等高频坑

**本章骨架（源码篇统一五段式）：① 核心数据结构（§1）→ ② 关键函数调用路径（§2）→ ③ 源码阅读顺序（§3）→ ④ 实操跟踪（§4）→ ⑤ 延伸资料（§6）。**

## 1. 核心数据结构

### 1.1 账本世界观：物理页是货币

Linux 内核以 4KB 物理页为最小计量单位——它不按字节记账，按页记账，一切"内存好坏"最终都化归为"哪一页归谁、还剩几页"这一个问题。账本分三层：启动期由 **memblock**（`mm/memblock.c`）粗分物理区间，内核映像、ramdisk、早期内存池都从这里领地盘；开机完成后可分配的页整体移交给 **buddy**（`mm/page_alloc.c`），它是运行期所有页级请求的中枢；buddy 按页批发，**slub**（`mm/slub.c`）把整页切碎零售成小对象，`kmalloc` 的落点就在这。分工一句话：memblock 管启动、buddy 管页、slub 管对象。

用户空间看到的是另一本账：`mmap` 拿到的地址是虚拟的、连续的，背后的物理页却可以任意散——中间隔着页表（x86-64 常规四级 PGD → P4D → PUD → PMD → PTE，五级 LA57 可选）的一次次翻译。所以"这个进程占了 256MB"是虚拟账，"机器还剩多少页"是 buddy 的物理账，两本账永远对不齐。`free` 只算纯空闲页，`available` 把可回收的页缓存与可释放的 slab 也折算进来——本机实测 `MemTotal: 54400304 kB`、`MemFree: 4067216 kB`、`MemAvailable: 36100788 kB`，同一台机两种口径差出 30GB 有余。运维侧的口径拆解与调优见[性能与资源管理](../system-management/performance.md)，本页只交代结构上的原因：这是两本账，不是一个数。

### 1.2 struct page：一页纸的档案

`struct page` 定义在 `include/linux/mm_types.h`，每个物理页对应一条——它记的不是页里存的数据，而是这页的身份、处境与归属。内核里 `struct page` 的条目数等于物理页总数（本机 54GB ≈ 1400 万个条目），比任何进程的线程数都多几个数量级：它是全局账本的行，不随进程生灭。关键成员：

| 字段 | 管什么 |
|------|--------|
| `flags` | 页状态位：`PG_locked`（正被搬动/回写）、`PG_dirty`（脏页待写盘）、`PG_uptodate`（内容有效）、`PG_lru`（挂在回收链上）……一眼判断页的角色与处境 |
| `_refcount` | 引用计数——这页还被谁攥着；归零才可能被回收或归还 buddy |
| `_mapcount` | 比页表映射数少 1（`-1` 即无人映射）——fork 后父子共享的判定依据 |
| union 联合体 | 同一条目按角色复用：空闲页挂 `buddy_list`、页缓存页挂 LRU 链、slab 页装对象，"这页现在归谁管"由 `flags` 与联合体指针共同表明 |

遇到 `PageXxx(page)` 这类宏，定义就在 `mm_types.h`——把它当字典随手翻。页缓存那一侧（`struct address_space` 与 inode 如何把文件内容摊成页）见[虚拟文件系统与 ext4](./vfs-ext4.md)，本页到"页归谁"为止。

### 1.3 zone 与 free_area：buddy 的货架

物理内存按用途分区（zone），定义在 `include/linux/mmzone.h`。zone 枚举按编译条件裁剪，现代 x86-64 机器实际只有三行：

| zone | 何时编入 | 干什么 |
|------|----------|--------|
| `ZONE_DMA` | `CONFIG_ZONE_DMA` | 老 ISA 外设的 16MB 以下兼容窗口 |
| `ZONE_DMA32` | `CONFIG_ZONE_DMA32` | 4GB 以下，服务只能做 32 位寻址的老总线设备 |
| `ZONE_NORMAL` | 总是 | 常规区，内核直接映射，绝大多数分配从这走 |
| `ZONE_HIGHMEM` | **仅 `CONFIG_HIGHMEM`（32 位）** | 高端内存——64 位配置里根本不存在这一档 |

`ZONE_HIGHMEM` 是 32 位时代内核虚拟地址不够映射全部物理内存的补丁：需要"临时映射窗口"才能碰到高端页。x86-64 内核地址空间足够大，全部物理内存直接映射，这档随之消失——老书/旧模板把 HIGHMEM 解释成"数百 GB 大内存场景"是时代错位，见 §5。另有 `ZONE_MOVABLE`（只放可迁移页，服务内存热插拔与 CMA 隔离）等特殊区，日常读代码可先绕过。

每个 zone 内部按阶（order）摆货架，货架本体就两行：

```c
// include/linux/mmzone.h —— 每个 zone 一份 free_area 数组，下标即阶
struct free_area {
	struct list_head	free_list[MIGRATE_TYPES];	// 每种迁移类型一条链
	unsigned long		nr_free;			// 该阶空闲块数
};
```

order k 的一块是 2^k 页（order 0 = 4KB，order 10 = 4MB），上限 `MAX_PAGE_ORDER` 默认 10（`mmzone.h`）——单次分配最大 4MB 连续。链表按 `enum migratetype` 分账（`MIGRATE_UNMOVABLE`/`MIGRATE_MOVABLE`/`MIGRATE_RECLAIMABLE`）：用户页全部进 MOVABLE，回收时优先搬这一类腾出整块，别让钉子户式的内核不可动页把高阶页绞碎——这就是防碎片迁移类型的全部动机。buddy 的进出规则一句话：**分配 = 当前阶没货就向高阶借、逐级对半劈；释放 = 找"伴页"（另一半也空闲，`PageBuddy` 标志可辨）合并升阶、一路合到合不动为止**——碎片被消灭在合并里。多节点机器每个 NUMA node 一套 `pglist_data` 与 zone，分配先本 node 后跨 node；簿记细节见书目，老书里的函数名多已改名。

### 1.4 mm_struct 与 vm_area_struct：用户空间的账页

`mm_struct`（`mm_types.h`）是一个进程地址空间的总账：页表根、RSS 计数、`mmap_lock`（改映射要拿写锁，缺页以读锁进入——两条路的并发纪律全系于此），以及最关键的 **`mm_mt`——一棵 maple tree，存放进程全部 VMA**。6.1 起内核用 maple tree 替换了老书里 VMA 红黑树的论述，段落找不到对应代码别意外，见 §5。

`vm_area_struct` 是账本单行：一段连续虚拟区间的完整档案，读 `vm_start`/`vm_end`（半开区间 `[start, end)`）、`vm_flags`（`VM_READ`/`VM_WRITE`/`VM_EXEC`/`VM_SHARED`……权限与共享语义）、`vm_ops`（`fault`/`mmap`/`page_mkwrite` 等回调——这 VMA 背后是普通文件、匿名内存还是设备，缺页时走谁家代码就由它决定）、`vm_file`（映射的文件）。`cat /proc/self/maps` 每一行就是一个 VMA，`/proc/self/smaps` 则是逐 VMA 的明细账；缺页处理的第一步 `find_vma` 就是在这棵树里找"故障地址落在哪个 VMA"，找不到即真越界，转成 SIGSEGV。进程视角（`mm_struct` 如何随 fork 诞生、exec 换血）见[进程管理与调度](./process-scheduling.md)。

### 1.5 kmem_cache：小对象的工厂

一页 4KB 若给一个 32B 对象独用，浪费 99%——所以 slub 把页切成固定大小的对象池，池子的图纸就是 `struct kmem_cache`（定义在内部头 `mm/slab.h`，不是 slub 实现文件里；公共 API 在 `include/linux/slab.h`）。图纸上的参数决定工厂产能：对象大小与对齐、每页对象数、**每 CPU freelist**（快路径不加锁的秘密——摘对象纯属本 CPU 本地操作），以及可选的构造函数。对外只有一对入口：

```c
// include/linux/slab.h —— 6.x 用 alloc_hooks 宏给分配路径做记账，_noprof 是记账后缀
void *kmem_cache_alloc_noprof(struct kmem_cache *cachep, gfp_t flags);
#define kmem_cache_alloc(...)  alloc_hooks(kmem_cache_alloc_noprof(__VA_ARGS__))
```

系统启动时已预建几十个基础工厂：`dentry`、`inode_cache`、`filp`、`task_struct`，以及按大小分档的 `kmalloc-32/64/96/128/…`——`kmalloc(n)` 本质是按 n 挑中某个 `kmalloc-*` 工厂再 `kmem_cache_alloc`。工厂的存货清单就是 `/proc/slabinfo`，§4.4 实测。

## 2. 关键函数调用路径

### 2.1 缺页路：从异常到三路分派（本章最重要的一张图）

CPU 访问未映射或写保护的虚拟地址，硬件触发缺页异常并把故障地址记进 CR2，软件侧从 IDT 入口一路走到三种处置。以下调用链的每个名字都对照 v6.12 源码核实过（`arch/x86/mm/fault.c` 与 `mm/memory.c` 两段）：

```text
CPU 访问未映射 / 写保护的地址 ──硬件异常──▶ CR2 记下故障地址
  exc_page_fault                     arch/x86/mm/fault.c（IDT 入口）
    └─ handle_page_fault             按 fault_in_kernel_space() 分流
        ├─ do_kern_addr_fault        内核地址段（内核自己踩了空页）
        └─ do_user_addr_fault        用户地址段：读锁 mmap_lock → find_vma 找账页
            └─ handle_mm_fault       mm/memory.c（进程侧总入口）
                └─ __handle_mm_fault 逐级补页表：PGD → P4D → PUD → PMD
                    └─ handle_pte_fault   落到最终 PTE，三种情形
                        ├─ do_pte_missing        PTE 不在
                        │    ├─ do_anonymous_page 匿名 VMA → 分配新页 / 映射零页
                        │    └─ do_fault          文件 VMA
                        │         ├─ do_read_fault    读 → filemap_fault 查页缓存
                        │         │                    （mm/filemap.c，缓存没有才读盘）
                        │         ├─ do_cow_fault     私有写 → 先复制再改私有映射
                        │         └─ do_shared_fault  共享写 → 直接映射，稍后写回
                        └─ do_wp_page            PTE 在但写保护 → 写时复制
                             └─ wp_page_copy      拷贝新页、换页表、放旧页
```

三路语义各管一种内存：**匿名页**（栈、堆、`MAP_ANONYMOUS`，没有文件背书）首次读映射零页、首次写才真分配清零；**文件页读**先查页缓存，命中直接建映射（这就是 §4.2 里 300MB 映射只驻留几十 KB 的机制），未命中经 `filemap_fault` 走文件系统读盘；**写时复制**专治 `fork`：父子先共享同一批物理页（`_mapcount` 指向两套页表），谁先写谁触发 `do_wp_page → wp_page_copy`，拷一份私有的再放行——父进程的页毫发无损（§4.3 实验）。返回值是 `vm_fault_t` 位图：0 表示已处理，`VM_FAULT_MAJOR` 让 `do_user_addr_fault` 给进程记一次 `maj_flt`，`VM_FAULT_ERROR`/`VM_FAULT_OOM` 走 OOM 选择器，`VM_FAULT_SIGSEGV` 才真正转成信号——全部在 fault.c 的收尾处解释，读返回值别只看"是不是 0"。

### 2.2 buddy 分配路：按阶借、对半劈

页级分配（以及 slub 的 `new_slab` 要页）都汇进 `mm/page_alloc.c` 的同一条主干：

```text
alloc_pages(gfp, order)                    入口宏（gfp.h：alloc_hooks → alloc_pages_noprof）
  └─ __alloc_pages_noprof                  page_alloc.c 的实现本体
      ├─ get_page_from_freelist            快路径：沿 zonelist 逐 zone 找货
      │    └─ rmqueue                      进了 zone 怎么摘
      │         ├─ rmqueue_pcplist         pcp_allowed_order 内的小阶：先摸本 CPU 零散页缓存
      │         └─ rmqueue_buddy           落空或大阶：free_area[order] 直接摘链
      │              └─ 本阶没货 → 向高阶借，逐级对半劈开
      └─ __alloc_pages_slowpath            快路径全空才进来：水位不够先回收
           （wakeup_kswapd / 直接回收），仍不行才 OOM
```

gfp 掩码决定这笔分配的脾气：`GFP_KERNEL` 允许睡眠、允许回收（常规内核分配的默认），`GFP_ATOMIC` 不许睡（中断上下文用），`__GFP_ZERO` 要求清零。读这条链的纪律是水位判断只记结论——"不够就转慢路径"，watermark 的细节留到真读代码时再展开。

### 2.3 slub 分配路：本 CPU 摘对象

`kmem_cache_alloc` 落到 `mm/slub.c`，快慢两径：

```text
kmem_cache_alloc(cache, gfp)       include/linux/slab.h（宏 → kmem_cache_alloc_noprof）
  └─ slab_alloc_node               mm/slub.c 快路径（__fastpath_inline）
       ├─ 本 CPU freelist 摘一个对象 → 纯本地操作、无锁，命中即返回
       └─ freelist 空 → __slab_alloc_node → ___slab_alloc 慢路径
            ├─ 复用 partial slab 的空闲对象（本 CPU / 跨 CPU / 节点级）
            └─ 全都没有 → new_slab 向 buddy 要整页，按对象大小切开成新池
```

归还 `kmem_cache_free` 对称地把对象丢回 freelist；整张 slab 全空了才把页还给 buddy。批发（buddy 管页）与零售（slub 管对象）的边界就落在 `new_slab` 这一行——它既是 slub 慢路径的终点，也是 §2.2 分配路的起点。

## 3. 源码阅读顺序

### 3.1 先读输出，再读代码

`/proc` 里每个数字都是某个数据结构的打印件——先看输出回答"这结构长什么样"，再进源码回答"它怎么变成这样的"，事半功倍。对照关系：

| `/proc` 输出 | 打印的结构 | 读它回答什么 |
|--------------|------------|--------------|
| `/proc/buddyinfo` | `zone->free_area[order].nr_free` | 各阶还剩几块空闲 |
| `/proc/pagetypeinfo` | `free_list[迁移类型]` | 碎片堆在哪种迁移类型里 |
| `/proc/slabinfo` | 每行一个 `kmem_cache` | 哪个工厂囤了多少对象 |
| `/proc/self/maps` | `mm_struct` 的 VMA 集合 | 这进程地址空间怎么分段 |

`buddyinfo` 人人可读；`pagetypeinfo` 与 `slabinfo` 在多数发行版锁给 root（本机实测见 §4.4）。`pagetypeinfo` 的头两行就是 §1.3 货架的全貌——迁移类型 × 阶的二维账：

```bash
# 每迁移类型 × 每阶的空闲页（buddyinfo 看不到的两个维度：类型与页块）
$ sudo head -6 /proc/pagetypeinfo
Page block order: 9
Pages per block:  512

Free pages count per migrate type at order       0      1      2      3      4      5      6      7      8      9     10
Node    0, zone      DMA, type    Unmovable      0      0      0      0      0      0      0      0      1      0      0
Node    0, zone      DMA, type      Movable      0      0      0      0      0      0      0      0      0      1      2
```

### 3.2 四步阅读单

1. **`mm/memory.c` 的缺页主干**：`handle_mm_fault → __handle_mm_fault → handle_pte_fault` 的三分派（§2.1 的图）。全文件近七千行，别顺流而下——跳过各路的错误处理与加锁细节，先让主干在脑子里跑通，三分派源码就在本页图上。
2. **`mm/page_alloc.c` 的分配主干**：`get_page_from_freelist → rmqueue → rmqueue_buddy`，配上 §4.1 的 buddyinfo 输出对照读；水位判断只记"不够转 `__alloc_pages_slowpath`"。
3. **`mm/slub.c` 的快路径**：`slab_alloc_node` 开头几十行（freelist 摘取）加 `___slab_alloc` 慢路径的三步走。
4. **`include/linux/mm_types.h` 当字典**：`struct page`、`vm_area_struct`、`mm_struct` 遇到就翻，别背。

配两条纪律：每个函数名先去 [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/latest/source) 搜定义再读——别在老书的行号里刻舟求剑；想看真实调用序，用 ftrace 的 `function_graph` 挂上（工具细节、过滤器写法与翻页技巧见[内核跟踪工具](./tracing-tools.md)），跑一次 `ls` 就能把 dentry 缺页链完整钓出来。

## 4. 实操跟踪

四组实验分别对着 §1 的四个数据结构与 §2 的三条路径，全部在本机跑过、输出如实——跟着敲一遍，比读三遍印象深。

### 4.1 观察 buddy：写 300MB 前后对比

```bash
# NORMAL 区各阶空闲块数（11 列 = order 0..10，与 MAX_PAGE_ORDER 对齐）
$ grep -E 'Normal' /proc/buddyinfo
Node 0, zone   Normal  85897  60745  19001   7792   5467   3600   1099    423    258    231    146
$ dd if=/dev/zero of=/tmp/hog bs=1M count=300 2>/dev/null && sync
$ grep -E 'Normal' /proc/buddyinfo
Node 0, zone   Normal  16041  56473  18998   7788   5465   3599   1097    421    256    233    146
$ rm /tmp/hog
```

判读：300MB 落盘先吃掉 order-0 单页七万余块（85897 → 16041）——页缓存逐页申请，要的是散页不是连续大块，高阶几乎纹丝不动。低阶本就进出频繁，别抠个位数，看量级与趋势；删文件几分钟后再看，order-0 回升，回收器把缓存吐了回来。这一来一回就是 §2.2 `rmqueue_buddy` 摘链与释放合并的现场。

### 4.2 制造缺页：mmap 300MB 只碰几页

```c
// onepage.c — mmap 大文件只碰几页，实测按需缺页
#define _GNU_SOURCE
#include <stdio.h>
#include <string.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/resource.h>

int main(int argc, char *argv[])
{
    int fd = open(argv[1], O_RDONLY);
    long sz = lseek(fd, 0, SEEK_END);
    char *p = mmap(NULL, sz, PROT_READ, MAP_PRIVATE, fd, 0);
    FILE *st = fopen("/proc/self/status", "r");   /* 先热身 stdio */
    printf("warmup\n");
    struct rusage ru;
    long f0, f1;
    volatile char c = 0;
    getrusage(RUSAGE_SELF, &ru); f0 = ru.ru_minflt;
    c = p[0];                                     /* 第一次碰 */
    getrusage(RUSAGE_SELF, &ru); f1 = ru.ru_minflt;
    printf("touch page0:      minflt +%ld\n", f1 - f0);
    getrusage(RUSAGE_SELF, &ru); f0 = ru.ru_minflt;
    c = p[2 * 4096];                              /* 邻近页 */
    getrusage(RUSAGE_SELF, &ru); f1 = ru.ru_minflt;
    printf("touch neighbor:   minflt +%ld\n", f1 - f0);
    getrusage(RUSAGE_SELF, &ru); f0 = ru.ru_minflt;
    c = p[sz - 4096];                             /* 文件末尾的页 */
    getrusage(RUSAGE_SELF, &ru); f1 = ru.ru_minflt;
    printf("touch far page:   minflt +%ld\n", f1 - f0);
    getrusage(RUSAGE_SELF, &ru); f0 = ru.ru_minflt;
    c = p[0];                                     /* 重碰原页 */
    getrusage(RUSAGE_SELF, &ru); f1 = ru.ru_minflt;
    printf("re-touch page0:   minflt +%ld\n", f1 - f0);
    printf("mapped %ld KB\n", sz / 1024);
    rewind(st);
    char line[128];
    while (fgets(line, sizeof line, st))
        if (!strncmp(line, "VmSize", 6) || !strncmp(line, "VmRSS", 5))
            printf("%s", line);
    (void)c;
    return 0;
}
```

```bash
$ dd if=/dev/urandom of=/tmp/bigfile bs=1M count=300 2>/dev/null
$ gcc -Wall -O0 -o onepage onepage.c && ./onepage /tmp/bigfile
warmup
touch page0:      minflt +1
touch neighbor:   minflt +0
touch far page:   minflt +1
re-touch page0:   minflt +0
mapped 307200 KB
VmSize:	  309968 kB
VmRSS:	    1952 kB
```

四行计数各有含义：碰第一页 `+1` 是教科书式的一次缺页；碰邻页 `+0` 是文件缺页的"买一赠多"——`filemap_map_pages` 的 fault-around 把近旁已缓存的页顺带映射进页表；碰文件末尾 `+1`（超出赠品范围，再缺一次）；重碰 `+0`（页表里已有，缺页是一次性成本）。最硬的证据是最后两行：映射了 307200KB，驻留只有 1952KB——其中大头还是动态链接器、libc 与栈，300MB 的文件真正进来的只有被碰过的那几十 KB。**strace 在这里完全看不见**——缺页不是系统调用，这正是它与跟踪 syscall 的工具的分界；要数缺页，程序内用 `getrusage`（如上），程序外读 `/proc/<pid>/stat` 第 10 列 `minflt`（配 `sleep` 观察长命进程），或用 bpftrace 探 `kprobe:handle_mm_fault`——探针选型见[内核跟踪工具](./tracing-tools.md)。

### 4.3 写时复制现场：fork 后子进程改值

```c
// cowtest.c — fork 后子进程写全局变量，父进程的值不动
#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
static int g = 42;

int main(void)
{
    pid_t pid = fork();
    if (pid == 0) { g = 99; sleep(2); _exit(0); }   /* 子：写 + 挂住，留出观察窗口 */
    printf("parent pid=%d: g=%d（子进程已改 99，父仍见 42）\n", getpid(), g);
    wait(NULL);
    return 0;
}
```

```bash
$ gcc -O0 -o cowtest cowtest.c && ./cowtest
parent pid=574178: g=42（子进程已改 99，父仍见 42）
```

`fork` 那一刻父子指向同一批物理页，子进程执行 `g = 99` 触发 §2.1 的 `do_wp_page → wp_page_copy`：拷贝一份私有页、改子进程页表、旧页引用减一——父进程眼里的 42 因此毫发无损。想看现场有两个角度：bpftrace 挂 `kprobe:do_wp_page` 统计触发（需 `CONFIG_KALLSYMS_ALL`，发行版一般已开），或在 `sleep` 窗口里对比父子 `/proc/<pid>/smaps`——子进程的 `Private_Dirty` 多出来的正是被 COW 出来的私有脏页。

### 4.4 slab 的账本：dentry 工厂增减

```bash
# 普通用户直接读会被拒——多数发行版锁 root-only（本机实测）
$ head -3 /proc/slabinfo
head: cannot open '/proc/slabinfo' for reading: Permission denied
$ sudo head -3 /proc/slabinfo
slabinfo - version: 2.1
# name            <active_objs> <num_objs> <objsize> <objperslab> <pagesperslab> : tunables <limit> <batchcount> <sharedfactor> : slabdata <active_slabs> <num_slabs> <sharedavail>
nf_conntrack_expect      0      0    232   35    2 : tunables    0    0    0 : slabdata      0      0      0
# 取 dentry / inode 两个工厂，遍历目录前后各看一次
$ sudo grep -E '^(dentry|inode_cache) ' /proc/slabinfo
inode_cache        11301  14508    616   26    4 : tunables    0    0    0 : slabdata    558    558      0
dentry            1000729 1295994    192   21    1 : tunables    0    0    0 : slabdata  61714  61714      0
$ ls -R /usr/lib > /dev/null
$ sudo grep -E '^(dentry|inode_cache) ' /proc/slabinfo
inode_cache        11301  14508    616   26    4 : tunables    0    0    0 : slabdata    558    558      0
dentry            1004904 1295994    192   21    1 : tunables    0    0    0 : slabdata  61714  61714      0
```

列含义以头注释为准：`<active_objs> <num_objs> <objsize> <objperslab> <pagesperslab> … slabdata <active_slabs> <num_slabs>`。判读：`ls -R` 遍历目录树新造了 4175 个 dentry（1000729 → 1004904），而 `num_objs` 与 `slabdata` 分毫未动——新对象全从既有 slab 的空闲位里拿，工厂没开新页；`inode_cache` 纹丝不动，因为这些 inode 早就在缓存里。dentry 长到百万级也别慌，路径查找只建不删是常态，回收由 shrinker 负责——这正是 §1.5"工厂 + 存货清单"的活账本。

## 5. 常见坑

**老书 zone 图里画着"高内存"——64 位内核根本没有 HIGHMEM。** `ZONE_HIGHMEM` 只在 `CONFIG_HIGHMEM` 的 32 位配置里编入（`mmzone.h` 枚举里它藏在一个 ifdef 后面），x86-64 直接映射全部物理内存，这一档不存在。看到"高内存 = 数百 GB 大内存"的说法按时代错位跳过；现代机器的 buddyinfo 只有 DMA/DMA32/Normal 三行（§4.1 实见）。

**buddyinfo 各阶加起来远小于 MemTotal，不是机器坏了。** buddy 只管自己名下的页：memblock 启动期保留（BIOS/ACPI 表、内核映像）、E820 `RESERVED` 区间、内核自身常驻占用都不在货架上；再叠上 MemFree 与 MemAvailable 本就是两种口径（§1.1），三个数字互相对不上是常态——对账前先弄清谁在记谁的账。

**min_flt 猛涨，误以为程序在读盘。** `min_flt` 是缺页但页已在内存、只补页表映射的成本（按需分页的正常开销）；`maj_flt` 才代表真·磁盘 IO（页缓存未命中或 swap）。strace 对缺页完全不可见——它不是系统调用，这是与 syscall 跟踪工具的分界；数缺页用 `getrusage` 或 `/proc/<pid>/stat`（§4.2），分析 IO 只盯 `maj_flt`。

**slab 章节写"slab/slob/slub 三套并存、按需 fallback"——老黄历。** slob 早在 5.8 被删除，SLAB 分配器随后也移出，6.x 只剩 SLUB 一个实现（§1.5、§2.3 通篇只有它）。同理，老书 NUMA 分配簿记里那些改过名的 gfp 标志与已消失的回退链，一律以现源码为准，别拿 2.6 的路书开 6.x 的车。

**smaps 只看 Rss，共享库被重复计账。** `Rss` 把共享页在每个进程都全额计入——把全家的 Rss 相加会严重高估；`Pss` 按共享比例摊（两进程共享一页各记 0.5），比对容器/微服务占用用它；`Private_Dirty` 只记"自己写出来的"页，fork + COW 新增的私有脏页全在这（§4.3）。三项一起看才有全貌。

**`/proc/self/maps` 还在、红黑树没了——VMA 容器已换成 maple tree。** 6.1 起 `mm_struct` 用 `mm_mt`（`maple_tree`，见 `mm_types.h`）存放 VMA，老书关于 VMA 红黑树旋转与平衡的段落在 6.x 源码里找不到对应。`find_vma` 的语义没变，变的只是容器——读代码时认函数，别认数据结构的旧名字。

## 6. 延伸资料

| 书目 | 读哪里 | 版本坐标 |
|------|--------|----------|
| Mel Gorman《Understanding the Linux Virtual Memory Manager》 | buddy/slab/页回收讲得最深的单行本 | 面向 2.6；机制框架仍对，函数名全变 |
| Robert Love《Linux内核设计与实现》 | 内存管理一章，半天建立骨架 | 早期 2.6；重概念轻代码 |
| Bovet & Cesati《深入理解Linux内核》 | 页表与内存管理章（页表机制讲得最细） | 2.6 时代 |
| Wolfgang Mauerer《深入Linux内核架构》 | 内存管理相关章，与全书体系互查 | 2.6.24 |

四本书的共同点是都停在 2.6——当"为什么"来读，别当"在哪"用：函数名、文件路径一律以 v6.12 为准（§3.2 的 elixir 检索法）。folio 化、maple tree、SLUB-only 这些 5–6.x 的演进书里没有，读时自行补差；随版本更新的官方 mm 文档见文末参考资料。

## 参考资料

- Linux 内核源码在线交叉检索（v6.12） — [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/latest/source)
- 内核官方 mm 子系统文档 — [docs.kernel.org/mm](https://docs.kernel.org/mm/index.html)
- `/proc` 文件系统手册 — [man7.org](https://man7.org/linux/man-pages/man5/proc.5.html)
- Linux 内核官网（源码下载与 changelog） — [kernel.org](https://www.kernel.org/)
- Mel Gorman. Understanding the Linux Virtual Memory Manager — 书（当年随 OLS 论文发布）
- Robert Love. 《Linux内核设计与实现》（Linux Kernel Development）— 书
- Bovet, Cesati. 《深入理解Linux内核》（Understanding the Linux Kernel）— 书
- Wolfgang Mauerer. 《深入Linux内核架构》（Professional Linux Kernel Architecture）— 书
