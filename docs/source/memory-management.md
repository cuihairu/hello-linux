# Memory Management

Memory is the hardest subsystem in the kernel to see through at a glance:
the process thinks it owns one contiguous address range, while the kernel sees millions of scattered 4KB page receipts;
`free` shows only a few GB left, yet `available` reports tens of GB;
and an ordinary assignment may quietly complete a round of page fault handling behind your back.
This page follows the source-part's unified five acts --
first recognize the data structures (who keeps the accounts), then walk three call paths (how the accounts are kept), give the source reading order (which page to open first), add four groups of live local tracing experiments (print the ledger and compare), and finish with deeper reading.
Every function name and file path in this chapter was verified against kernel v6.12 source;
where old books conflict with the current source, this page wins.

> Content draws on the kernel source tree (v6.12) and the books above (conceptual framework); see the references at the end.

## What This Part Covers

- Explain the division of labor of the three-layer ledger memblock → buddy → slub
- Read the four core structures: `struct page`, `zone`/`free_area`, VMA, and `kmem_cache`
- Draw from memory the trunk of the page fault path from `exc_page_fault` down to `do_wp_page`, plus the call chains of the two allocation paths, buddy and slub
- Empirically demonstrate demand paging and copy-on-write with minflt counters, smaps, and bpftrace -- conclusions by evidence, not by recitation
- Avoid the high-frequency pitfalls: confusing min_flt/maj_flt, the three-allocator folklore, and unclear smaps accounting

**This chapter's skeleton (the source part's unified five acts): ① core data structures (§1) → ② key function call paths (§2) → ③ source reading order (§3) → ④ hands-on tracing (§4) → ⑤ further reading (§6).**

## 1. Core Data Structures

### 1.1 The Ledger Worldview: Physical Pages Are Currency

The Linux kernel uses the 4KB physical page as its smallest unit of account --
it does not keep books by the byte but by the page,
and every question about "memory health" ultimately reduces to "which page belongs to whom, and how many are left".
The ledger has three layers:
during boot, **memblock** (`mm/memblock.c`) coarsely carves up physical ranges, from which the kernel image, ramdisk, and early memory pools claim their territory;
once boot is done, all allocatable pages are handed over wholesale to the **buddy** (`mm/page_alloc.c`), the hub of every page-level request at runtime;
the buddy wholesales by page, and **slub** (`mm/slub.c`) cuts whole pages up and retails them as small objects --
and that is where `kmalloc` lands.
Division of labor in one sentence: memblock runs boot, buddy runs pages, slub runs objects.

User space keeps a different ledger:
the address `mmap` returns is virtual and contiguous, but the physical pages behind it may be scattered anywhere,
with page tables in between (on x86-64 the ordinary four-level PGD → P4D → PUD → PMD → PTE, with the optional five-level LA57) translating again and again.
So "this process occupies 256MB" is virtual accounting, and "how many pages does the machine have left" is the buddy's physical accounting --
the two books will never balance.
`free` counts only truly free pages, while `available` folds in reclaimable page cache and freeable slab:
measured live on this machine, `MemTotal: 54400304 kB`, `MemFree: 4067216 kB`, `MemAvailable: 36100788 kB` --
two accounting conventions on one machine differing by over 30GB.
For the operations-side breakdown of these conventions and tuning, see [Performance](../system-management/performance.md);
this page only gives the structural reason: these are two ledgers, not one number.

### 1.2 struct page: The Record Card of One Page

`struct page` is defined in `include/linux/mm_types.h`, one entry per physical page --
what it records is not the data stored in the page but the page's identity, situation, and ownership.
The number of `struct page` entries in the kernel equals the total number of physical pages
(54GB on this machine ≈ 14 million entries), several orders of magnitude more than any process's thread count:
it is a row of the global ledger, and it does not live or die with a process.
Key members:

| Field | What it governs |
|------|--------|
| `flags` | page state bits: `PG_locked` (being moved or written back), `PG_dirty` (awaiting writeback), `PG_uptodate` (content valid), `PG_lru` (hanging on a reclaim chain) ... at a glance you can judge the page's role and situation |
| `_refcount` | reference count -- who is still holding this page; only at zero can it be reclaimed or returned to the buddy |
| `_mapcount` | one less than the page table mapping count (`-1` means nobody maps it) -- the basis for deciding whether parent and child share a page after fork |
| the union | the same entry reused by role: a free page hangs on `buddy_list`, a page cache page hangs on an LRU chain, a slab page holds objects; "who manages this page now" is jointly indicated by `flags` and the union pointer |

When you meet a macro like `PageXxx(page)`, its definition is right in `mm_types.h` --
flip it open like a dictionary.
On the page cache side (how `struct address_space` and inodes spread file content into pages), see [VFS and ext4](./vfs-ext4.md); this page stops at "who owns the page".

### 1.3 zone and free_area: The Buddy's Shelves

Physical memory is partitioned by purpose into zones, defined in `include/linux/mmzone.h`.
The zone enum is trimmed by compile-time configuration, and a modern x86-64 machine really has only three rows:

| zone | Compiled in when | What it does |
|------|----------|--------|
| `ZONE_DMA` | `CONFIG_ZONE_DMA` | the sub-16MB compatibility window for old ISA peripherals |
| `ZONE_DMA32` | `CONFIG_ZONE_DMA32` | below 4GB, serving old bus devices that can only do 32-bit addressing |
| `ZONE_NORMAL` | always | the ordinary zone, directly mapped by the kernel, where the vast majority of allocations come from |
| `ZONE_HIGHMEM` | **only `CONFIG_HIGHMEM` (32-bit)** | high memory -- this tier simply does not exist in 64-bit configurations |

`ZONE_HIGHMEM` was the patch for the 32-bit era, when the kernel's virtual address space was too small to map all of physical memory:
you needed a "temporary mapping window" to touch high pages.
The x86-64 kernel's address space is large enough to directly map all physical memory, and this tier disappeared accordingly --
old books and old templates explaining HIGHMEM as "the case of hundreds of GB of RAM" are anachronistic; see §5.
There are also special zones such as `ZONE_MOVABLE` (holding only migratable pages, serving memory hotplug and CMA isolation), which everyday code reading can skip for now.

Inside each zone, shelves are arranged by order, and the shelf itself is two lines:

```c
// include/linux/mmzone.h — one free_area array per zone, indexed by order
struct free_area {
	struct list_head	free_list[MIGRATE_TYPES];	// one list per migration type
	unsigned long		nr_free;			// number of free blocks at this order
};
```

A block of order k is 2^k pages (order 0 = 4KB, order 10 = 4MB), with the cap `MAX_PAGE_ORDER` defaulting to 10 (`mmzone.h`) --
so a single allocation is at most 4MB contiguous.
The lists are accounted by `enum migratetype` (`MIGRATE_UNMOVABLE`/`MIGRATE_MOVABLE`/`MIGRATE_RECLAIMABLE`):
all user pages go into MOVABLE, and reclaim prefers to move that kind to free up whole blocks,
so that intransigent non-migratable kernel pages do not fragment high-order blocks --
that is the entire motivation of anti-fragmentation migration types.
The buddy's in-and-out rule in one sentence:
**allocation = if the current order is out of stock, borrow from the next higher order and split it in half level by level; free = find the buddy page (the other half is also free, recognizable by the `PageBuddy` flag), merge and promote, all the way up until no more merging is possible** --
fragmentation is destroyed in the merging.
On a multi-node machine, each NUMA node has its own `pglist_data` and zones;
allocation goes local node first, then cross-node.
Bookkeeping details are in the bibliography, and many function names in old books have since been renamed.

### 1.4 mm_struct and vm_area_struct: User Space's Ledger Page

`mm_struct` (`mm_types.h`) is the general ledger of a process's address space:
the page table root, RSS counters, `mmap_lock` (changing a mapping takes the write lock, a page fault enters with the read lock --
the concurrency discipline of both paths hangs entirely on this),
and the most important member of all, **`mm_mt` -- a maple tree holding every VMA of the process**.
Since 6.1 do not be surprised that the old books' discussion of the VMA red-black tree has no matching code in 6.x; see §5.

`vm_area_struct` is a single ledger row:
the complete record of one contiguous virtual range.
Read `vm_start`/`vm_end` (the half-open interval `[start, end)`),
`vm_flags` (`VM_READ`/`VM_WRITE`/`VM_EXEC`/`VM_SHARED` ... permission and sharing semantics),
`vm_ops` (callbacks like `fault`/`mmap`/`page_mkwrite` -- whether this VMA is backed by an ordinary file, anonymous memory, or a device determines whose code a page fault walks into),
and `vm_file` (the mapped file).
Every line of `cat /proc/self/maps` is one VMA, and `/proc/self/smaps` is the per-VMA itemized account;
the first step of page fault handling, `find_vma`, is exactly a lookup in this tree for "which VMA does the faulting address fall in";
not finding one means a genuine out-of-bounds access, converted into SIGSEGV.
For the process perspective (how `mm_struct` is born with fork and has its blood replaced by exec), see [Process Scheduling](./process-scheduling.md).

### 1.5 kmem_cache: The Small-Object Factory

If one 4KB page were dedicated to a single 32B object, 99% would be wasted --
so slub cuts pages into fixed-size object pools, and the pool's blueprint is `struct kmem_cache`
(defined in the internal header `mm/slab.h`, not in the slub implementation file; the public API is in `include/linux/slab.h`).
The parameters on the blueprint determine the factory's capacity:
object size and alignment, objects per page,
the **per-CPU freelist** (the secret of the lock-free fast path -- taking an object off is purely a local operation on this CPU),
and an optional constructor.
On the outside there is only one pair of entry points:

```c
// include/linux/slab.h — in 6.x the alloc_hooks macro does accounting on the allocation path; _noprof is the accounting suffix
void *kmem_cache_alloc_noprof(struct kmem_cache *cachep, gfp_t flags);
#define kmem_cache_alloc(...)  alloc_hooks(kmem_cache_alloc_noprof(__VA_ARGS__))
```

At boot, dozens of base factories are already pre-built:
`dentry`, `inode_cache`, `filp`, `task_struct`,
plus the size-graded `kmalloc-32/64/96/128/…` --
`kmalloc(n)` is essentially picking the right `kmalloc-*` factory for n and then calling `kmem_cache_alloc`.
The factory's inventory list is `/proc/slabinfo`, measured in §4.4.

## 2. Key Function Call Paths

### 2.1 The Page Fault Path: From Exception to Three-Way Dispatch (This Chapter's Most Important Picture)

When the CPU accesses an unmapped or write-protected virtual address, hardware raises a page fault exception and records the faulting address in CR2,
and the software side walks from the IDT entry all the way to one of three dispositions.
Every name in the following chain was verified against v6.12 source (in `arch/x86/mm/fault.c` and `mm/memory.c`):

```text
CPU touches an unmapped / write-protected address ──hardware exception──▶ CR2 records the fault address
  exc_page_fault                     arch/x86/mm/fault.c (IDT entry)
    └─ handle_page_fault             branches on fault_in_kernel_space()
        ├─ do_kern_addr_fault        kernel address range (the kernel tripped over a hole itself)
        └─ do_user_addr_fault        user address range: read-lock mmap_lock → find_vma to find the ledger page
            └─ handle_mm_fault       mm/memory.c (the process-side entry point)
                └─ __handle_mm_fault build page tables level by level: PGD → P4D → PUD → PMD
                    └─ handle_pte_fault   reaches the final PTE; three cases
                        ├─ do_pte_missing        PTE absent
                        │    ├─ do_anonymous_page anonymous VMA → allocate a new page / map the zero page
                        │    └─ do_fault          file-backed VMA
                        │         ├─ do_read_fault    read → filemap_fault consults the page cache
                        │         │                    (mm/filemap.c; only reads from disk if absent)
                        │         ├─ do_cow_fault     private write → copy first, then fix up the private mapping
                        │         └─ do_shared_fault  shared write → map directly, write back later
                        └─ do_wp_page            PTE present but write-protected → copy-on-write
                             └─ wp_page_copy      copy a new page, swap the page table, release the old page
```

Each of the three routes manages one kind of memory:
**anonymous pages** (stack, heap, `MAP_ANONYMOUS`, with no file backing) map the zero page on first read and only really allocate and zero on first write;
**file page reads** consult the page cache first, and a hit builds the mapping directly
(this is the mechanism behind §4.2, where a 300MB mapping occupies only a few tens of KB);
a miss goes through `filemap_fault` and the filesystem to read from disk;
**copy-on-write** exists specifically for `fork`:
parent and child first share the same physical pages (`_mapcount` pointing at two sets of page tables),
and whoever writes first triggers `do_wp_page → wp_page_copy`,
copying a private page before letting the write through --
the parent's page is left untouched (the §4.3 experiment).
The return value is a `vm_fault_t` bitmap:
0 means handled, `VM_FAULT_MAJOR` makes `do_user_addr_fault` record a `maj_flt` for the process,
`VM_FAULT_ERROR`/`VM_FAULT_OOM` goes to the OOM selector,
and only `VM_FAULT_SIGSEGV` actually becomes a signal --
all interpreted at the tail of fault.c, so when reading a return value, do not just check "is it 0".

### 2.2 The Buddy Allocation Path: Borrow Upward, Split in Half

Page-level allocations (and slub's `new_slab` when it needs pages) all converge into the same trunk in `mm/page_alloc.c`:

```text
alloc_pages(gfp, order)                    entry macro (gfp.h: alloc_hooks → alloc_pages_noprof)
  └─ __alloc_pages_noprof                  the implementation proper in page_alloc.c
      ├─ get_page_from_freelist            fast path: walk zonelist zone by zone looking for stock
      │    └─ rmqueue                      once inside a zone, how to take one
      │         ├─ rmqueue_pcplist         small orders within pcp_allowed_order: first try this CPU's scattered page cache
      │         └─ rmqueue_buddy           miss or large order: take straight off free_area[order]
      │              └─ out of stock at this order → borrow from the next higher order, splitting in half level by level
      └─ __alloc_pages_slowpath            entered only when the fast path comes up empty: reclaim when watermarks are short
           (wakeup_kswapd / direct reclaim); OOM only if that still fails
```

The gfp mask decides this allocation's temperament:
`GFP_KERNEL` may sleep and may reclaim (the default for ordinary kernel allocations),
`GFP_ATOMIC` may not sleep (for interrupt context),
`__GFP_ZERO` requires zeroing.
The discipline for reading this chain is to only remember the conclusion of the watermark check --
"not enough means go to the slow path" --
and leave the watermark details for when you actually read the code.

### 2.3 The slub Allocation Path: Take an Object Off This CPU

`kmem_cache_alloc` lands in `mm/slub.c`, with a fast and a slow road:

```text
kmem_cache_alloc(cache, gfp)       include/linux/slab.h (macro → kmem_cache_alloc_noprof)
  └─ slab_alloc_node               mm/slub.c fast path (__fastpath_inline)
       ├─ take an object off this CPU's freelist → purely local, lock-free; return on hit
       └─ freelist empty → __slab_alloc_node → ___slab_alloc slow path
            ├─ reuse a free object from a partial slab (this CPU / other CPUs / node level)
            └─ nothing anywhere → new_slab asks the buddy for whole pages and cuts them into a new pool by object size
```

`kmem_cache_free` symmetrically throws the object back onto the freelist;
only when an entire slab is empty are its pages returned to the buddy.
The wholesale/retail boundary (buddy handles pages, slub handles objects) sits exactly at the `new_slab` line --
it is both the terminus of slub's slow path and the starting point of the §2.2 allocation path.

## 3. Source Reading Order

### 3.1 Read the Output First, Then the Code

Every number under `/proc` is a printout of some data structure --
look at the output first to answer "what does this structure look like", then go into the source to answer "how does it get that way", and you will work half as hard for twice the result.
The correspondences:

| `/proc` output | The structure being printed | What reading it answers |
|--------------|------------|--------------|
| `/proc/buddyinfo` | `zone->free_area[order].nr_free` | how many free blocks remain at each order |
| `/proc/pagetypeinfo` | `free_list[migration type]` | which migration type the fragmentation is piled in |
| `/proc/slabinfo` | one `kmem_cache` per row | which factory has hoarded how many objects |
| `/proc/self/maps` | `mm_struct`'s VMA set | how this process's address space is segmented |

`buddyinfo` is world-readable;
`pagetypeinfo` and `slabinfo` are root-only on most distributions (measured live on this machine in §4.4).
The first two lines of `pagetypeinfo` are the full picture of the §1.3 shelves --
a two-dimensional ledger of migration type × order:

```bash
# free pages per migration type per order (the two dimensions buddyinfo cannot show: type and block)
$ sudo head -6 /proc/pagetypeinfo
Page block order: 9
Pages per block:  512

Free pages count per migrate type at order       0      1      2      3      4      5      6      7      8      9     10
Node    0, zone      DMA, type    Unmovable      0      0      0      0      0      0      0      0      1      0      0
Node    0, zone      DMA, type      Movable      0      0      0      0      0      0      0      0      0      1      2
```

### 3.2 A Four-Step Reading List

1. **The page fault trunk in `mm/memory.c`**: the three-way dispatch of `handle_mm_fault → __handle_mm_fault → handle_pte_fault` (the §2.1 picture). The whole file is nearly seven thousand lines; do not read straight down it -- skip each route's error handling and locking details, and first get the trunk running through your head; the dispatch source is right there on this page's picture.
2. **The allocation trunk in `mm/page_alloc.c`**: `get_page_from_freelist → rmqueue → rmqueue_buddy`, read alongside the buddyinfo output of §4.1; for the watermark check, only remember "not enough goes to `__alloc_pages_slowpath`".
3. **The slub fast path in `mm/slub.c`**: the first few dozen lines of `slab_alloc_node` (taking objects off the freelist) plus the three steps of the `___slab_alloc` slow path.
4. **`include/linux/mm_types.h` as a dictionary**: flip to `struct page`, `vm_area_struct`, and `mm_struct` as you meet them; do not memorize.

Attach two disciplines:
for every function name, search its definition on [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/latest/source) before reading --
do not carve a boat to find a sword dropped at an old book's line number;
and to see the real call order, hook it up with ftrace's `function_graph`
(tool details, filter writing, and page-turning tips are in [Tracing Tools](./tracing-tools.md)) --
one run of `ls` will fish out the complete dentry page fault chain.

## 4. Hands-On Tracing

Four groups of experiments, one for each of §1's four data structures and §2's three paths;
all run on this local machine with output reproduced faithfully --
typing along once leaves a deeper impression than reading three times.

### 4.1 Watching the Buddy: Before and After Writing 300MB

```bash
# free block counts per order in the NORMAL zone (11 columns = orders 0..10, matching MAX_PAGE_ORDER)
$ grep -E 'Normal' /proc/buddyinfo
Node 0, zone   Normal  85897  60745  19001   7792   5467   3600   1099    423    258    231    146
$ dd if=/dev/zero of=/tmp/hog bs=1M count=300 2>/dev/null && sync
$ grep -E 'Normal' /proc/buddyinfo
Node 0, zone   Normal  16041  56473  18998   7788   5465   3599   1097    421    256    233    146
$ rm /tmp/hog
```

How to read it:
300MB hitting the disk first eats seventy thousand-odd order-0 single pages (85897 → 16041) --
the page cache requests pages one by one and wants scattered pages, not one contiguous large block, so the high orders barely move.
Low orders are churning in and out all the time anyway, so do not nitpick single digits; look at magnitudes and trends.
A few minutes after deleting the file, order-0 climbs back up as the reclaimer spits the cache out.
This back-and-forth is the live scene of §2.2's `rmqueue_buddy` taking off the list and free merging.

### 4.2 Manufacturing a Page Fault: mmap 300MB but Touch Only a Few Pages

```c
// onepage.c — mmap a big file, touch only a few pages; demand paging measured live
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
    FILE *st = fopen("/proc/self/status", "r");   /* warm up stdio first */
    printf("warmup\n");
    struct rusage ru;
    long f0, f1;
    volatile char c = 0;
    getrusage(RUSAGE_SELF, &ru); f0 = ru.ru_minflt;
    c = p[0];                                     /* first touch */
    getrusage(RUSAGE_SELF, &ru); f1 = ru.ru_minflt;
    printf("touch page0:      minflt +%ld\n", f1 - f0);
    getrusage(RUSAGE_SELF, &ru); f0 = ru.ru_minflt;
    c = p[2 * 4096];                              /* a neighbouring page */
    getrusage(RUSAGE_SELF, &ru); f1 = ru.ru_minflt;
    printf("touch neighbor:   minflt +%ld\n", f1 - f0);
    getrusage(RUSAGE_SELF, &ru); f0 = ru.ru_minflt;
    c = p[sz - 4096];                             /* the page at the end of the file */
    getrusage(RUSAGE_SELF, &ru); f1 = ru.ru_minflt;
    printf("touch far page:   minflt +%ld\n", f1 - f0);
    getrusage(RUSAGE_SELF, &ru); f0 = ru.ru_minflt;
    c = p[0];                                     /* re-touch the original page */
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

Each of the four counter lines has a meaning:
touching the first page, `+1`, is the textbook single page fault;
touching the neighbour, `+0`, is "buy one get several free" on file faults --
`filemap_map_pages`' fault-around pulls the already-cached nearby pages into the page table along for the ride;
touching the end of the file, `+1` (outside the freebie range, one more fault);
re-touching, `+0` (already in the page table; a fault is a one-time cost).
The hardest evidence is the last two lines:
307200KB mapped, yet only 1952KB resident --
most of which is the dynamic linker, libc, and the stack;
of the 300MB file, only the few tens of KB actually touched ever came in.
**strace is completely blind here** --
a page fault is not a system call, and this is precisely the boundary between it and syscall-tracing tools.
To count page faults, use `getrusage` inside the program (as above),
or read column 10 `minflt` of `/proc/<pid>/stat` from outside (pair it with `sleep` to watch long-lived processes),
or probe `kprobe:handle_mm_fault` with bpftrace --
for probe selection see [Tracing Tools](./tracing-tools.md).

### 4.3 The Copy-on-Write Scene: The Child Changes a Value After fork

```c
// cowtest.c — after fork the child writes a global variable; the parent's value stays put
#include <stdio.h>
#include <unistd.h>
#include <sys/wait.h>
static int g = 42;

int main(void)
{
    pid_t pid = fork();
    if (pid == 0) { g = 99; sleep(2); _exit(0); }   /* child: write + hang, to leave an observation window */
    printf("parent pid=%d: g=%d (child already changed it to 99, parent still sees 42)\n", getpid(), g);
    wait(NULL);
    return 0;
}
```

```bash
$ gcc -O0 -o cowtest cowtest.c && ./cowtest
parent pid=574178: g=42 (child already changed it to 99, parent still sees 42)
```

At the moment of `fork`, parent and child point at the same physical pages,
and the child executing `g = 99` triggers §2.1's `do_wp_page → wp_page_copy`:
copy a private page, fix the child's page table, decrement the old page's reference --
which is why the 42 in the parent's eyes is untouched.
Two angles for seeing the scene:
hook `kprobe:do_wp_page` with bpftrace to count triggers (needs `CONFIG_KALLSYMS_ALL`, generally on in distributions),
or compare parent and child `/proc/<pid>/smaps` during the `sleep` window --
the extra `Private_Dirty` in the child is exactly the private dirty pages COWed out.

### 4.4 The Slab Ledger: The dentry Factory Growing and Shrinking

```bash
# an ordinary user is denied outright — root-only on most distributions (measured live here)
$ head -3 /proc/slabinfo
head: cannot open '/proc/slabinfo' for reading: Permission denied
$ sudo head -3 /proc/slabinfo
slabinfo - version: 2.1
# name            <active_objs> <num_objs> <objsize> <objperslab> <pagesperslab> : tunables <limit> <batchcount> <sharedfactor> : slabdata <active_slabs> <num_slabs> <sharedavail>
nf_conntrack_expect      0      0    232   35    2 : tunables    0    0    0 : slabdata      0      0      0
# take the two factories dentry / inode, sample once before and once after walking a directory tree
$ sudo grep -E '^(dentry|inode_cache) ' /proc/slabinfo
inode_cache        11301  14508    616   26    4 : tunables    0    0    0 : slabdata    558    558      0
dentry            1000729 1295994    192   21    1 : tunables    0    0    0 : slabdata  61714  61714      0
$ ls -R /usr/lib > /dev/null
$ sudo grep -E '^(dentry|inode_cache) ' /proc/slabinfo
inode_cache        11301  14508    616   26    4 : tunables    0    0    0 : slabdata    558    558      0
dentry            1004904 1295994    192   21    1 : tunables    0    0    0 : slabdata  61714  61714      0
```

Column meanings follow the header comment:
`<active_objs> <num_objs> <objsize> <objperslab> <pagesperslab> … slabdata <active_slabs> <num_slabs>`.
Reading:
`ls -R` walking the directory tree created 4175 new dentries (1000729 → 1004904),
while `num_objs` and `slabdata` did not move a hair --
the new objects all came from free slots in existing slabs, and the factory opened no new pages;
`inode_cache` did not budge at all, because those inodes were already cached.
Do not panic that dentries grow into the millions either:
path lookup only creates and never deletes, and that is the normal state;
reclaim is the shrinker's job --
this is precisely the §1.5 "factory + inventory" ledger running live.

## 5. Common Pitfalls

**Old books' zone diagrams draw "high memory" -- a 64-bit kernel has no HIGHMEM at all.** `ZONE_HIGHMEM` is compiled in only for 32-bit configurations with `CONFIG_HIGHMEM` (in the `mmzone.h` enum it hides behind an ifdef);
x86-64 directly maps all of physical memory and this tier does not exist.
Skip any claim that "high memory = hundreds of GB of RAM" as anachronistic;
on modern machines buddyinfo has only three rows, DMA/DMA32/Normal (seen live in §4.1).

**The sum of buddyinfo's orders is far below MemTotal -- the machine is not broken.** The buddy only manages the pages under its own name:
what memblock reserved at boot (BIOS/ACPI tables, the kernel image), the E820 `RESERVED` ranges, and the kernel's own resident footprint are not on the shelves.
Add to that that MemFree and MemAvailable were two different conventions to begin with (§1.1) --
three numbers that do not reconcile with each other is the normal state;
before reconciling, first work out who is accounting for what.

**min_flt climbing fast, mistaken for the program reading from disk.** `min_flt` is the cost of a page fault where the page was already in memory and only the page table mapping had to be filled in (the normal overhead of demand paging);
only `maj_flt` stands for real disk I/O (page cache miss or swap).
strace is entirely blind to page faults -- they are not system calls, and this is the boundary with syscall-tracing tools;
count faults with `getrusage` or `/proc/<pid>/stat` (§4.2), and for I/O analysis watch only `maj_flt`.

**A slab chapter that says "slab/slob/slub coexist with on-demand fallback" -- folklore.** slob was removed back in 5.8, and the SLAB allocator was moved out shortly after;
6.x has only the SLUB implementation (§1.5 and §2.3 are SLUB throughout).
Likewise, for the renamed gfp flags and vanished fallback chains in old books' NUMA allocation bookkeeping, current source always wins --
do not drive a 6.x car with a 2.6 road map.

**Looking only at Rss in smaps double-counts shared libraries.** `Rss` charges shared pages in full to every process --
summing the Rss of the whole family massively overestimates;
`Pss` pro-rates by share (two processes sharing one page each record 0.5), and is what to use when comparing container/microservice footprint;
`Private_Dirty` records only "pages you wrote yourself", and every private dirty page added by fork + COW lands there (§4.3).
Only looking at all three together gives the full picture.

**/proc/self/maps is still there but the red-black tree is gone -- the VMA container has been swapped for a maple tree.** Since 6.1, `mm_struct` stores VMAs in `mm_mt` (a `maple_tree`, see `mm_types.h`),
and the old books' paragraphs on VMA red-black tree rotation and balancing have no corresponding code in 6.x.
`find_vma`'s semantics did not change; only the container did --
when reading code, recognize functions, not the old names of data structures.

## 6. Further Reading

| Book | Read what | Version coordinates |
|------|--------|----------|
| Mel Gorman, *Understanding the Linux Virtual Memory Manager* | the deepest single volume on buddy/slab/page reclaim | aimed at 2.6; the mechanism framework still holds, every function name has changed |
| Robert Love, *Linux Kernel Development* | the memory management chapter; builds the skeleton in half a day | early 2.6; heavy on concepts, light on code |
| Bovet & Cesati, *Understanding the Linux Kernel* | the page tables and memory management chapters (the most detailed treatment of page tables) | 2.6 era |
| Wolfgang Mauerer, *Professional Linux Kernel Architecture* | the memory management chapters, cross-reference with the book's overall system | 2.6.24 |

What the four books have in common is that they all stop at 2.6 --
read them for "why", not for "where":
function names and file paths always defer to v6.12 (the elixir search method of §3.2).
The 5–6.x evolutions -- folio-ization, the maple tree, SLUB-only -- are absent from these books;
fill the gaps yourself as you read.
The version-tracked official mm documentation is in the references at the end.

## References

- Online cross-reference search of the Linux kernel source (v6.12) -- [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/latest/source)
- Official kernel mm subsystem documentation -- [docs.kernel.org/mm](https://docs.kernel.org/mm/index.html)
- The `/proc` filesystem manual -- [man7.org](https://man7.org/linux/man-pages/man5/proc.5.html)
- The Linux kernel homepage (source downloads and changelogs) -- [kernel.org](https://www.kernel.org/)
- Mel Gorman. Understanding the Linux Virtual Memory Manager -- book (originally released with the OLS paper)
- Robert Love. *Linux Kernel Development* -- book
- Bovet, Cesati. *Understanding the Linux Kernel* -- book
- Wolfgang Mauerer. *Professional Linux Kernel Architecture* -- book

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [process-scheduling](process-scheduling.md)
- [tracing-tools](tracing-tools.md)
- [vfs-ext4](vfs-ext4.md)
