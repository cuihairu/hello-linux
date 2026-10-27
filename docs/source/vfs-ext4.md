# VFS and ext4: A Source Tour

The instant you type `cat /etc/passwd`, a chain of dispatch fires inside the kernel: how does that path become an open file? Does the content you read come from disk or memory? Why is the second `cat` so much faster than the first? The answers to all of these live in the source of the VFS (virtual filesystem) and ext4. VFS is the implementation layer of "everything is a file" -- `read()` on a regular file, a pipe, and a device all enter through the same syscall and dispatch via a function pointer table to their respective implementations; ext4 is one concrete implementation of that table for on-disk filesystems. This page follows the unified five-part skeleton of the source part: first recognize the five core data structures, then walk the `open` and `read` call chains level by level, then give a reading order that will not be drowned by thirty million lines of code, and finally use strace, page cache experiments, bpftrace, and ftrace to turn the static source into a live scene. For the syscall side of the path entry point, see [System Call Path](./syscall-path.md); for full usage of the tracing tools, see [Tracing Tools](./tracing-tools.md).

> Content adapted from the kernel source tree (v6.12), the official ext4 wiki, and the books below (conceptual framework); see the references at the end.

## What This Page Covers

- The responsibilities of the five VFS objects (super_block/inode/dentry/file/address_space) and the header files they live in
- Walking both the open and read call chains, explaining the dispatch essence of the `f_op->read_iter` step
- How ext4's `ext4_map_blocks` translates a file offset into a disk block, and why the journal exists
- Three hands-on page cache experiments (Cached changes, the second-read cliff, the drop_caches control)
- Doing one real function-level trace of the read path with bpftrace/ftrace

## 1. Why a VFS Is Needed

"Everything is a file" is not a description of disk organization but a promise of the **interface layer**: `write(fd, buf, n)` is syntactically identical for a regular file, a pipe, and a character device. The kernel cannot write a separate set of syscalls for each kind of object, so it implements polymorphism with C function pointer tables -- every opened `file` carries a `file_operations` table, and whoever `read_iter` points to is whose read behavior you get. That is the VFS proper: a set of abstract interfaces (object structs + operation tables) plus a family of concrete implementations. Once you understand this dispatch mechanism, "why can Linux make `/proc` and `/sys` files too" is no longer mysterious -- fill in one operation table correctly, and anything can be "filed".

| Family | Filesystems | Where the data actually lives |
|------|---------|---------------|
| Disk | ext4, xfs, btrfs | Its own layout on a block device |
| Memory | tmpfs | page cache/memory only; lost on power-off |
| Pseudo | proc, sysfs | live snapshots of kernel data structures; reading is querying |
| Network | nfs | the remote server's storage |

This family tree also foreshadows this page's leading role: VFS is the interface layer shared by all families, and ext4 is merely the disk family's representative. Reading an NFS file and reading an ext4 file go through exactly the same `vfs_read` and only part ways after the `f_op->read_iter` dispatch -- the interface/implementation boundary is drawn right here.

## 2. Core Data Structures

The five VFS objects each govern a stretch of lifecycle, all defined in two header files (`include/linux/fs.h` and `include/linux/dcache.h`):

| Object | Defined in | One corresponds to | Governs |
|------|---------|-------------|--------|
| `super_block` | include/linux/fs.h | one **mounted filesystem instance** | the whole filesystem's global state: block size, total inode count, dirty-page writeback watermarks |
| `inode` | include/linux/fs.h | one **disk object** (file/directory/device) | content metadata: size, permissions, timestamps, data block locations; unique within the filesystem by inode number |
| `dentry` | include/linux/dcache.h | one **path name component** | maps a name to an inode; all dentries form the dcache directory cache |
| `file` | include/linux/fs.h | one `open` | session state: the `f_pos` read cursor, flag bits, a pointer to `file_operations` |
| `address_space` | include/linux/fs.h | one inode's page cache | the ledger of that file's cached pages, `i_pages` (an XArray) organized by page index |

One `cat /etc/passwd` strings the five objects together most clearly: path resolution hits dentries component by component (two dentries, `etc` and `passwd`), each dentry pointing to an inode; the `passwd` inode carries an address_space that manages its cached pages; after `open` succeeds the kernel creates one more file struct recording this session's cursor and operation table. **The division of labor between inode and dentry is the key concept to keep straight**: the name belongs to the dentry, the content metadata to the inode. The essence of hard links follows immediately -- two dentries point to the same inode, `inode->i_nlink` counts up by one; `rm` deletes only the dentry and decrements the count, and only when it reaches zero is the inode actually freed. This also explains the classic phenomenon: after a file opened by a process is `rm`ed, the fd remains readable and writable -- as long as the inode still has a reference (here the file struct), it will not be reclaimed; "the file is gone" only means the name is gone.

The file struct's `f_pos` cursor also hides the semantics of fork: after a parent `open`s and then `fork`s, the two processes share the **same** file struct, and one side's reads advance the other's cursor -- the shell's redirect inheritance is built on this; whereas two independent `open`s of the same file yield two files with two cursors, not affecting each other. The interface proper of polymorphism is three function pointer tables: `file_operations` (session operations like read/write), `inode_operations` (namespace operations like create/link), and `super_operations` (inode allocation, reclamation, and writeback). ext4's `ext4_file_operations` (fs/ext4/file.c) is one filling-in of the `file_operations` table -- one line `.read_iter = ext4_file_read_iter` hangs "ext4's read" into the generic dispatch.

address_space is the page cache's ledger (`struct xarray i_pages` organizes cached pages by page index, replacing the radix tree of older books); it maps "page N of the file" to an in-memory page frame. This layer hands off directly to memory management's `struct page` -- for page structure and allocation/reclamation see [Memory Management](./memory-management.md); for the user-side concept of "filesystem" (mounting, inode numbers, `df`'s space) see [Filesystem Concepts](../basic/filesystem/concept.md) -- this page only covers the kernel implementation.

One more dynamic mechanism of the five-object combination deserves naming separately, hiding in fs/dcache.c: **dcache lookup and reclamation**. Every step of path resolution first does a `d_lookup` in the dentry hash table, and a hit spares the disk I/O; a missed dentry is hung on the LRU and reclaimed by the kernel under memory pressure (reclamation deletes only the cache, never touching the file itself). This explains two operational phenomena: after `ls` on a never-before-accessed cold directory, subsequent accesses keep getting faster -- dentries and inodes are being backfilled level by level; and memory usage climbing after `find /` sweeps the disk is the normal result of the dcache + inode cache + page cache layers expanding together, with `free`'s buff/cache column growing accordingly (for the "this is cache, not a leak" verdict see §6).

### 2.1 How Pseudo Filesystems "Read": The Counterexample of proc and seq_file

Not every file has disk blocks behind it. `cat /proc/meminfo` also goes `vfs_read` → `f_op->read_iter`, but the procfs implementation (fs/proc/) has no `address_space` disk pages -- its registered operation table calls the kernel's `show()` callback live on every `read`, assembling kernel data structures (memory statistics, process lists, `/proc/self/fd`) into text on the fly and feeding it to the user. These "reading is querying" pseudo filesystems are the best counterexample for understanding VFS polymorphism: the file is only an **interface**; behind the `f_op` table can sit disk (ext4), memory (tmpfs), kernel data (proc/sysfs), or a remote server (nfs). `seq_file` (fs/seq_file.c) is the common skeleton of such implementations -- the hundreds of `/proc` entries in the kernel do not track "which line am I on" themselves, but delegate line assembly to seq_file's cursor mechanism.

## 3. Key Function Call Paths

### 3.1 The open Path: How a Name Becomes a file

```text
openat(2)
  └─ do_sys_openat2()            fs/open.c     parse flags/mode → struct open_how
      └─ do_filp_open()          fs/namei.c    set up the path-resolution context
          └─ path_openat()       fs/namei.c    walk dcache component by component (return on hit)
              │                                 on a miss, call the filesystem's lookup to backfill the dentry
              ├─ alloc_empty_file()            allocate the file struct
              └─ f_op->open()                  call the specific filesystem's open hook (mostly a no-op)
```

The fs/namei.c where `path_openat` lives is the most complex path resolver in the whole kernel -- symlink loops, mount-point traversal, and per-level permission checks all happen here; on a first reading, follow only the `link_path_walk` trunk and skip the symlink-handling details. The design worth appreciating is the dcache's position: path resolution **checks the cache first**; `ls /etc` is fast not because the disk is fast but because those dentries have long resided in memory; only a cache miss walks into the specific filesystem's `lookup` callback to search the disk.

### 3.2 The read Path (This Page's Climax): From vfs_read to the Page Cache

```text
read(2)
  └─ ksys_read()                fs/read_write.c   fd → struct file
      └─ vfs_read()             fs/read_write.c   permission and basic checks
          └─ new_sync_read()    fs/read_write.c   wrapper for sync reads, converts to the async interface
              └─ f_op->read_iter                  ★dispatch point: the file_operations table decides the way
                  └─ ext4_file_read_iter()    fs/ext4/file.c   ext4's entry: shutdown/empty read/DAX/DIO branching
                      └─ generic_file_read_iter()  mm/filemap.c ordinary cached read (thin wrapper)
                          └─ filemap_read()        mm/filemap.c   the real read loop
                              ├─ filemap_get_pages()  check the address_space page cache first
                              │    └─ miss → build a BIO to ask the block layer for the page (block-layer details omitted here)
                              └─ copy_page_to_iter()  copy to the user buffer on hit/arrival
```

The line worth staring at most on this chain is `f_op->read_iter`: all `new_sync_read` holds is a `file` -- it does not know and need not know whether ext4, tmpfs, or proc lies behind it; only at the instant the function pointer is dereferenced does the concrete implementation take over. ext4's `ext4_file_read_iter` (fs/ext4/file.c) itself only handles exceptions and special modes (return `-EIO` on forced shutdown, short-circuit empty reads, branch on DAX/DIO), delegating ordinary cached reads to `generic_file_read_iter`, which is the generic implementation shared by nearly all disk filesystems -- the real read loop lives in `filemap_read` (mm/filemap.c). `filemap_get_pages` computes the page index from `f_pos` and looks the page up in `address_space->i_pages`: on a hit it copies straight to the user; only on a miss does it issue a BIO to the block layer to read the disk blocks into a cached page before copying. **The second `cat` being faster than the first is precisely this stretch of "found it, no BIO needed"** -- §5 proves it with three numbers.

### 3.3 The ext4 Side: How a File Offset Becomes a Disk Block

ext4 describes "file logical blocks X..Y live in disk blocks Z..W" with an **extent tree**, replacing ext2/3's indirect block tables. Each extent records the triple `(ee_block, ee_len, ee_start_hi/lo)` -- file logical block number, length, and 48-bit starting physical block number. Extent tree nodes come in two kinds: leaf nodes store extent records directly, internal nodes store indices of `(first logical block of subtree, physical block of child)`. The root is embedded in `ext4_inode_info->i_data[15 * 12 bytes]` (up to 4 extents/indices); beyond four entries it splits into a depth-2 tree (root + leaf), and large files go deeper still.

`ext4_map_blocks` (fs/ext4/inode.c:595) is the entry of the translation chain: given an inode and a block number within the file, it returns the corresponding disk block number and length. Internally:
1. First consult the **extent status tree** (an in-memory red-black tree, `EXT4_I(inode)->i_es_tree`); a hit returns directly -- this is the hot path, sparing a disk metadata read.
2. On a miss, take the `i_data_sem` lock and walk `ext4_ext_map_blocks`: binary search down the extent tree from root to leaf (`ext4_ext_find_extent`).
3. Once the extent is found, compute the offset as `lblk - ee_block` and fill `map->m_pblk = ee_start + offset`.
4. If the flags include `EXT4_GET_BLOCKS_CREATE` and the block falls in a hole or delayed region, enter `ext4_map_create_blocks` to actually allocate blocks (mballoc, the multi-block allocator), write back into the extent tree, and insert into the extent status tree.

When a page cache miss requires reading from disk, `ext4_map_blocks`'s return value decides which sectors the BIO fetches from. For the user-side view of mounting and inode numbers, see [Filesystem Concepts](../basic/filesystem/concept.md).

> Hole handling on the read path: `filemap_read` zero-fills the user buffer on a hole and issues no BIO -- `ext4_map_blocks` returns 0 with `m_pblk=0`, and the upper layer copies zeros on the zero test. In `strace cat /proc/kallsyms | head -1` no `read` syscall appears at all (seq_file goes straight to the callback), while in the strace of `dd if=/dev/zero of=/tmp/hole bs=1k count=1 seek=1000` followed by `cat /tmp/hole`, `read` returns the full amount yet takes almost no time -- both are manifestations of the zero-page optimization.

### 3.4 The Write Path: When Delayed Allocation and the Journal Do Their Work

Reading is "look up, copy"; writing adds a timing question -- when does the data actually land on disk:

```text
write(2)
  └─ vfs_write()                    fs/read_write.c
      └─ f_op->write_iter           ★dispatch point (symmetric with read)
          └─ ext4_file_write_iter() fs/ext4/file.c   redirect/overwrite/DIO branching
              └─ ext4_buffered_write_iter()
                  └─ generic_perform_write()         mm/filemap.c  advances page by page
                      ├─ ext4_write_begin()  fs/ext4/inode.c  (or ext4_da_write_begin)
                      │    └─ ext4_da_get_block_prep / ext4_get_block
                      │         └─ ext4_map_blocks finds the disk location -- this is where blocks are truly allocated
                      │    └─ jbd2_journal_start()   begin a journal transaction
                      ├─ transfer the user data into the page cache (the write can already return here!)
                      └─ ext4_write_end() / ext4_da_write_end()  commit the journal, account i_disksize
```

**The writeback path** (when dirty pages truly hit disk):

```text
writeback (pdflush/kthread/fsync)
  └─ ext4_writepages()          fs/ext4/inode.c
      └─ ext4_do_writepages()   via the mpage_da_data struct
          └─ mpage_da_map_blocks()  batch-convert delayed allocation into real blocks
              └─ ext4_map_blocks(EXT4_GET_BLOCKS_CREATE|IO_SUBMIT)
          └─ submit the BIO to the block layer and wait for completion
```

Two counterintuitive timing facts on this chain are the key to understanding ext4's crash behavior. First, **delayed allocation**: only at the moment the data is written into the page cache does `ext4_map_blocks` pick a disk block for it -- allocating later lets the file see a more complete contiguous block map at close/writeback time, reducing fragmentation. `ext4_da_write_begin` passes no handle (the comment reads `Called from ext4_da_write_begin() which has no handle started?`); the allocation actually happens at `ext4_da_write_end` or at writeback. Second, **a returned `write()` is not data on disk**: the write syscall returns success after placing data into the page cache, and what the jbd2 journal (logging metadata changes before they hit disk, replaying after a crash to guarantee consistency) guarantees is "metadata consistency", not "your data is on disk right now" -- which is why `fsync` is a step an application must call itself for correctness; it flushes the page cache to disk and waits for journal commit. The `data=ordered/writeback/journal` mount options control "should file data also enter the journal": ordered (the default) only guarantees data hits disk before metadata commits; writeback does not even carry that guarantee (a crash may expose old half-data); journal is the strongest but the slowest. The line in `ext4_write_begin`'s source comment reading `jbd2_journal_start at the start of` is the direct footnote to this boundary.

**Live evidence of data=ordered's crash semantics**:

```bash
$ dd if=/dev/urandom of=/mnt/test bs=4k count=1000   # 4MB
$ sync; sync
sudo umount /mnt
sudo # at this point yank the power (or under qemu -drive file=...,format=raw,if=none,id=hd; qemu-system-x86_64 -device ide-hd,drive=hd; inside the guest trigger echo b > /proc/sysrq-trigger)
sudo mount /dev/sdX /mnt
$ cmp /mnt/test /tmp/original   # ordered: always identical; writeback: possibly different
```

## 4. Source Reading Order

| Order | File | What to read | Rough line count |
|------|------|--------|---------|
| 1 | fs/read_write.c | `vfs_read`/`vfs_write`, short; see the check-and-dispatch skeleton clearly | ~30 each |
| 2 | fs/namei.c | the `path_openat` trunk and `link_path_walk`'s component-by-component loop (skip symlink details) | ~80 for the trunk |
| 3 | mm/filemap.c | the `filemap_read` loop and `filemap_get_pages`'s hit/miss branches | ~200 |
| 4 | fs/ext4/file.c | the `ext4_file_operations` table fill and `ext4_file_read_iter`'s branching | ~60 |
| 5 | fs/ext4/inode.c | `ext4_map_blocks`'s extent lookup | optional |

The principle of this order is "thin to thick": build a sense of the skeleton in a 30-line function first, then read the 200-line implementation body, and only then touch ext4's on-disk layout details. Keep [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/latest/source) open while reading -- clicking into each function name for cross-references builds the "who calls whom" map faster than local grep. After reading the code, cross-check with the runtime: `cat /proc/slabinfo | grep -E "ext4_inode_cache|dentry"` shows how many live inode and dentry instances are in the kernel right now -- a just-`ls`ed large directory makes the dentry count jump, and code and machine finally agree.

## 5. Hands-On Tracing

### 5.1 strace: Seeing the Read Interface

```bash
$ strace -e trace=openat,read,close cat /etc/passwd | head -3
openat(AT_FDCWD, "/etc/passwd", O_RDONLY|O_CLOEXEC) = 3
read(3, "root:x:0:0:root:/root:/bin/bash\n"..., 8192) = 985
root:x:0:0:root:/root:/bin/bash
...
close(3)                                = 0
```

`read` asked for 8192 bytes once and returned 985 -- the file is smaller than one block, so one read goes through. Compare `dd if=/dev/zero of=/tmp/f bs=1M count=10` with `strace dd if=/tmp/f of=/dev/null bs=1M`: dd's `read` count is inversely proportional to `bs`, while cat loops with a fixed buffer -- **the syscall count is decided by the buffering strategy**, which is the source-level answer to "why libraries buffer at all" (stdio's full buffering exists precisely to amortize the cost of this dispatch).

### 5.2 Three Numbers Proving the Page Cache

```bash
$ dd if=/dev/urandom of=/tmp/big bs=1M count=512 && echo 3 | sudo tee /proc/sys/vm/drop_caches
$ grep ^Cached /proc/meminfo
Cached:            262144 kB          # baseline (after dropping)
$ time cat /tmp/big > /dev/null
real    0m1.842s                     # first read: truly reads the disk
$ grep ^Cached /proc/meminfo
Cached:            786432 kB          # up ~512MB: the file now lives in the cache
$ time cat /tmp/big > /dev/null
real    0m0.171s                     # second read: dramatically faster
$ echo 3 | sudo tee /proc/sys/vm/drop_caches
$ time cat /tmp/big > /dev/null
real    0m1.795s                     # after dropping the cache, back to square one
```

After the first read `Cached` rose by about 512MB, the time fell from 1.8 seconds to 0.17 seconds, and `drop_caches` restored everything -- the three numbers are the most minimal proof of the page cache's existence, size, and causality, exactly the user-space projection of `filemap_get_pages`'s hit branch. When doing performance experiments you **must** `drop_caches` first like this; otherwise you are measuring the cache, not the disk.

### 5.3 bpftrace: Counting Reads per Process

```bash
sudo bpftrace -e 'kprobe:vfs_read { @[comm] = count(); } interval:s:5 { exit(); }'
Attaching 2 probes...
@[cat]: 41
@[systemd-journald]: 6
```

Who is going through `vfs_read` in a five-second window is immediately visible -- when troubleshooting, the answer to "who is repeatedly reading this file" lives in one-liners like this ([Tracing Tools](./tracing-tools.md)).

### 5.4 ftrace: The Depth of One Read at Function Level

```bash
$ cd /sys/kernel/tracing
$ echo function_graph > current_tracer
$ echo filemap_read > set_graph_function
$ echo > trace; cat /etc/passwd > /dev/null; cat trace | head -15
 # CPU  DURATION                  FUNCTION CALLS
   2)               |  filemap_read() {
   2)   0.147 us    |    filemap_get_pages();
   2)   0.062 us    |    folio_mark_accessed();
   2)   0.091 us    |    copy_page_to_iter();
   ...
   2)               |  }
```

`set_graph_function` draws the entire call subtree along with its durations -- the read path is not a line but a tree, and function_graph is the only tracer that can "see the tree".

### 5.5 Reading Directories and Caches: dentry/inode Are Not Files

```bash
$ strace -e trace=openat,read bash -c 'ls /usr/bin > /dev/null' 2>&1 | head -4
openat(AT_FDCWD, "/usr/bin", O_RDONLY|O_DIRECTORY|O_CLOEXEC) = 3
read(3, /* 53240 bytes */, 53240)      = 53240
close(3)                                = 0
$ cat /proc/slabinfo | grep -E "dentry|ext4_inode_cache"
dentry             184732    231010    192   21:  192.0
ext4_inode_cache    51240     52015   1048   32: 1048.0
$ find /usr/share/doc > /dev/null   # sweep a cold directory
$ cat /proc/slabinfo | grep dentry
dentry             186001    232300    192   21:  192.0   # active count rose
```

Under the hood `ls /usr/bin` is one directory `open` plus a `read` returning a string of `getdents64` records -- the interface-layer evidence that "a directory is also a file", only the contents are a dentry list rather than a byte stream. The slab counts are the living indicators of the dcache and inode cache layers: sweep a cold directory and the dentry active count jumps, and it **only goes up without immediately falling back** (LRU reclamation lags behind access) -- the runtime annotation of "find makes memory grow, and that is not a leak" from above. `stat` a never-accessed file, `ls` a cold directory, `find /` the whole disk -- three operations inflate the three counters in turn, and together with §5.2's `Cached` experiment, all four of the five objects except file (short-lived, following open/close) leave visible traces.

## 6. Common Pitfalls

**Performance experiment conclusions wobble -- you read the cache, not the disk.** Any disk read test without `echo 3 > /proc/sys/vm/drop_caches` first measures the page cache hit path. The three-number experiment of §5.2 must include the "restore after dropping the cache" control; otherwise speed differences cannot be attributed.

**Old articles' function names do not match.** Since 5.12, `filemap_read` (mm/filemap.c) has been the body of the read loop and `generic_file_read_iter` a thin wrapper (5.10 had no such function; the rename happened around 5.11), and the `do_generic_file_read`/`generic_file_aio_read` of 2.6-era books have long ceased to exist. Function name drift is routine in kernel source reading; the mechanisms in books still hold, but every concrete name must be checked against the current version on [elixir](https://elixir.bootlin.com/linux/v6.12/latest/source).

**Confusing inode with dentry.** Names and paths belong to the dentry; sizes, permissions, and block locations belong to the inode. Hard links are many dentries to one inode; after `rm`ing an already-opened file the fd is still readable because the inode's lifecycle follows references (file structs), not names. Cannot keep these two objects apart, and the behavior of dcache and inode cache will never make sense.

**Misreading free's buff/cache.** `buff` (buffers) nowadays is mostly the residue of block device metadata mappings and is very small; `cache` is the main body of the page cache. Analyzing buffers as file cache is the wrong direction -- what rose in the §5.2 experiment is `Cached`.

**Changing the ext4 journal mode had no effect.** `data=ordered/writeback/journal` is a mount attribute; after changing it you must remount or reboot. Confirm the currently effective value with `mount | grep ext4`; do not trust that writing it into fstab means it is running.

## 7. Further Reading

- Robert Love. *Linux Kernel Development*, 3rd ed. -- the VFS chapter: the first choice for an introduction to the five objects and the operation tables
- Daniel P. Bovet & Marco Cesati. *Understanding the Linux Kernel*, 3rd ed. -- the VFS and ext2/3 chapters: dense with data-structure relationship diagrams (based on 2.6; check field names against newer source)
- Mao Decao and Hu Ximing. *Scenario Analysis of the Linux Kernel Source Code* -- the complete walking-through paradigm for the file-reading scenario; the structure of §3 here pays homage to this method (based on 2.4)
- Wolfgang Mauerer. *Professional Linux Kernel Architecture* -- the VFS chapters; use as a field-level reference manual
- Official ext4 wiki -- [ext4.wiki.kernel.org](https://ext4.wiki.kernel.org/)
- Online cross-reference for the Linux v6.12 source -- [elixir.bootlin.com/linux/v6.12](https://elixir.bootlin.com/linux/v6.12/latest/source)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [README](README.md)
- [driver-framework](driver-framework.md)
- [memory-management](memory-management.md)
- [source-tree](source-tree.md)
- [syscall-path](syscall-path.md)
- [tracing-tools](tracing-tools.md)
- [userland](userland.md)
