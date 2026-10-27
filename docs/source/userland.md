# Selected Readings in User-Space Source

The kernel provides mechanisms; user space provides semantics. What rules `ls` uses to color files, or when `systemd` turns a unit file into a running process, are answers found not in the kernel but in two larger repositories -- coreutils and systemd -- and in the common foundation beneath them, glibc, shared by every C program. The module chapters of this book practice a muscle: follow the call chain, look up the data structures, and back it up with strace/ftrace. That muscle actually fits user-space repositories even better: builds take minutes (hours for the kernel), a crash is just a process exiting (not a whole-machine panic), and gdb can attach and set breakpoints right away. This chapter uses the exact same five-part skeleton as the module chapters -- core structures, key call paths, source reading order, hands-on tracing, further reading -- to run each of three optional targets through the full cycle: one coreutils command, the last centimeter of glibc, and one systemd unit. Section 5 then distills the methodology into a comparison table, closing out the part.

> Content adapted from the official repositories of coreutils, glibc, and systemd, plus the gnulib project documentation; see the references at the end.

## What This Part Covers

- Explain the division of labor: "mechanism in the kernel, semantics in user space"
- Build coreutils from source and use strace to split one `ls` into three segments: read directory, color decision, chunked output
- Draw the three-layer call stack from printf to the kernel's write, and watch symbol binding happen with your own eyes via LD_DEBUG
- Read through one systemd unit load along the trail of `unit_load` → fragment parsing → `manager_startup`
- Get familiar with how user-space and kernel source reading differ, and carry the method of the previous chapters to any repository

This part shares its skeleton with the module chapters; each of the three optional targets (§2, §3, §4) runs the full loop:

| Skeleton part | coreutils (§2) | glibc (§3) | systemd (§4) |
|--------|----------------|-------------|---------------|
| ① Core structures | 2.1 Repository map and self-build | 3.1 Three-layer division and source map | 4.1 The src/core trio |
| ② Key call path | 2.2 From main to stdout | 3.2 printf to write | 4.2 The unit_load chain |
| ③ Source reading order | 2.3 The three grep steps | 3.3 From symbol to implementation | 4.3 Trailing the main function |
| ④ Hands-on tracing | 2.4 The three-segment strace | 3.4 LD_DEBUG and maps | 4.4 Reconciling with runtime |
| ⑤ Further reading | 2.5 Tests and official docs | 3.5 vDSO and one man page | 4.5 Back-links to the admin side |

## 1. Why Still Read User-Space Source

### 1.1 The Division Between Mechanism and Semantics

The kernel judges a file's permission bits (the VFS's `inode_permission`), but whether "this file should be shown green, or bold" is judged by `ls`; systemd creates a service process's cgroup, but "which unit precedes which, whether to restart on failure, how many retries" is policy in systemd's user-space code. Asking the wrong layer is a common waste when troubleshooting: paging through kernel source because `ls` output has the wrong colors, or researching ext4's directory entry storage because `grep` finds no content -- the first answer lives in `src/ls.c`, the second in fs/. The criterion for which layer to read in is only one: **the kernel governs "can you", user space governs "by what rules"**. The boundary between mechanism and rules (the syscall boundary) is exactly the line [System Call Path](./syscall-path.md) drew in this part; everything in this chapter happens on the user-space side of that line. When unsure, use this layering table:

| Symptom / question | Where the answer lives | What to read |
|-----------|-----------|-----------|
| `ls` coloring rules wrong, sort behavior suspicious | User-space semantics | coreutils `src/ls.c` and `tests/` |
| Buffering makes output order or timing odd | C library semantics | glibc `libio/` and man 3 stdio |
| Restart policy or startup order not as expected | User-space policy | systemd `src/core/` and unit file syntax |
| Read file returns -EACCES, write refused | Kernel mechanism | Kernel VFS and permission checks (the [VFS and ext4](./vfs-ext4.md) chapter) |

### 1.2 Three Advantages of User-Space Experiments

First, fast builds: full coreutils compiles in about 1-2 minutes, glibc in the tens of minutes, while the kernel takes hours -- an order of magnitude lower cost per iteration. Second, small blast radius: a crashed user-space program means an exit code and a core dump, restartable at any time; a crashed kernel module or kernel debugging session means a whole-machine panic, so you must live inside VM snapshots (the risk model of the [Kernel Build](./build-and-modules.md) chapter). Third, ready-made observability: `strace`, `gdb`, and `LD_DEBUG` all hook onto the user-space boundary -- the commands drilled in [Tracing Tools](./tracing-tools.md) apply here directly, with no tracefs to mount and no BPF to enable. Together these three mean one thing: **get fluent in the "entry point → call chain → evidence" reading method in user-space repositories first, then take the same method back to the kernel -- that is the best value-per-effort learning curve**. The three targets of this chapter were picked along that curve: shallow to deep, one command, one library layer, one daemon.

## 2. coreutils: The Life of One Command

### 2.1 Core Structures: Repository Map and Self-Build

Get the code first. Distribution binary packages cannot be read along with; building your own is the right path. The only step that differs across the three distro families is the toolchain:

| Step | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Compile toolchain | sudo apt install build-essential | sudo pacman -S --needed base-devel | sudo dnf groupinstall "Development Tools" |

With the toolchain in place, fetching sources and building is identical across the three families (the tarball is the latest 9.x from the [official GNU coreutils directory](https://ftp.gnu.org/gnu/coreutils/); same below):

```bash
$ wget https://ftp.gnu.org/gnu/coreutils/coreutils-9.x.tar.xz
$ tar xf coreutils-9.x.tar.xz && cd coreutils-9.x
$ ./configure && make -j$(nproc)          # about 1-2 minutes
$ ./src/ls --version | head -1
ls (GNU coreutils) 9.x
```

A tarball only needs `./configure`; the git clone route requires `./bootstrap` first to sync gnulib (README-hacking has the details) -- this chapter takes the former. The directory map needs only four entries:

```text
coreutils-9.x/
├── src/       # one main program per command: ls.c, cp.c, cat.c... (the main reading arena)
├── lib/       # utility libraries shared by commands: version comparison, disk usage, sort primitives
├── gnulib/    # the portability layer (a submodule in the git route): POSIX-compatible third-party code
└── tests/     # each command's test suite -- the authoritative document of behavioral semantics
```

gnulib is the key to understanding why coreutils runs identically on all three distro families: it is a "vendored" portability layer -- time formatting, regexes, directory traversal, these capabilities that POSIX defines vaguely or that vary by platform are implemented once by gnulib, and coreutils's own code writes "semantics", never "platform patches". This "syncing in a third-party layer" organization is the same idea as a package manager patching the source tarball, and it directly dictates a reading discipline (see the corresponding pitfall in §6).

### 2.2 Key Call Path: From main to stdout

`ls`'s execution spine is a classic command-line pipeline: `main` parses `argv` → `decode_switches` translates options like `--color=always` into global configuration variables → entries are collected directory by directory → sorting and coloring are decided per configuration → written to stdout in chunks through the stdio buffer. The coloring decision lands in entry classification ("this is a directory, this is a symlink, this has the execute bit") and palette assembly, all user-space comparisons -- **the kernel is asked only two kinds of questions along the entire chain: what is in the directory (getdents64), and where to write (write)**. This chain reads exactly like the call paths of the module chapters: single entry, descending level by level, clean boundary -- the only difference being that the last level lands on the `syscall` instruction instead of `entry_SYSCALL_64` -- or, put another way, it is precisely the upper half of the chain from [System Call Path](./syscall-path.md). The whole chain at a glance:

```text
main(argc, argv)
  └─ decode_switches()        # options → global config variables (--color=always lands here)
       └─ collect entries per directory   # readdir-family calls; getdents64 fires at the boundary
            └─ classification and color decision  # user-space comparison: dir/symlink/exec bit → palette assembly
                 └─ stdio buffer  # line/full buffering; flushes when full or on newline
                      └─ write() ← syscall instruction, entering the kernel
```

### 2.3 Source Reading Order: Locate First, Then Read Through

`src/ls.c` runs to tens of thousands of lines; reading it straight through is a detour. The right posture is the three grep steps (line numbers vary by version, illustrative only):

```bash
$ cd coreutils-9.x
$ grep -n 'decode_switches' src/ls.c | head -2   # step 1: the option-decoding entry
1641:static int
1642:decode_switches (int argc, char **argv)
$ grep -n 'print_color_indicator' src/ls.c | head -2   # step 2: where coloring lands
997:static bool
998:print_color_indicator (const struct bin_str *ind)
$ grep -rn 'decode_switches' src/ | head         # step 3: confirm there is no second definition
```

Read from the entry how it handles `color` and the long-option table, then follow `main` once around the main loop -- **grep is the microscope for reading large user-space source**, the very principle the "indexing and browsing" section of the [Source Tree](./source-tree.md) chapter taught, only here in its plainest grep form. When unsure of behavior, read the test cases for the command under `tests/`: tests are the authoritative version of semantics, more reliable than any old book.

### 2.4 Hands-On: strace in Three Segments

Feed the build output straight to strace and split one listing into a syscall scene (note that `ls` does not color under a pipe by default; you need explicit `--color=always` to see escape sequences go through write; line and byte counts vary by version and directory, illustrative only):

```bash
$ strace -e trace=getdents64,write ./src/ls --color=always 2>&1 | head -5
getdents64(4, /* 42 entries */, 32768) = 1344
write(1, "\033[0m\033[01;34mbin\033[0m \033[0m\033[01;34mdoc\033[0m "..., 1024) = 1024
write(1, "README.md src tests\n", 21) = 21
```

The three segments speak for themselves: `getdents64` reads directory entries into user space in bulk (one call returns a whole batch of entries, with the buffering supplied by the kernel); all the bustle of "read directory → classify → color" happens between the two syscalls -- **invisible in strace, yet it decides what the write contains** -- this is the live evidence of "semantics in user space"; and `write` spews out the output in chunks sized to the buffer. One level deeper: ftrace from [Tracing Tools](./tracing-tools.md), or `perf stat`, proves that getdents64 is called far fewer times than there are output lines. To see the count with your own eyes, strace has a built-in statistics mode (numbers vary with directory contents, illustrative only):

```bash
$ strace -c -e trace=getdents64,write ./src/ls > /dev/null
% time     seconds  usecs/call     calls    errors    syscall
------ ----------- ----------- --------- --------- ----------------
  0.00    0.000000           0         1           getdents64
100.00    0.000143          71         2           write
------ ----------- ----------- --------- --------- ----------------
100.00    0.000143                     3           total
```

One `getdents64` returns the whole directory's entries and two `write` calls emit all the output -- **the count comparison is the most direct evidence of "batch reads, chunked writes"**. Once the boundary is exhausted, step one level inside it: gdb sets a breakpoint directly and shows the user-space call stack (artifacts built from the source tree carry symbols and debug with zero configuration):

```bash
$ gdb -batch -ex 'break decode_switches' -ex run -ex bt --args ./src/ls
Breakpoint 1, decode_switches (argc=1, argv=0x...) at src/ls.c:...
#0  decode_switches (argc=1, argv=0x...) at src/ls.c:...
#1  main (argc=1, argv=0x...) at src/ls.c:...
```

The two frames `bt` prints -- `main` calling `decode_switches` -- are exactly the first hop of the §2.2 chain. **strace looks at the boundary, gdb at the inside of it; stitched together they make one complete reading**. This two-track method -- counts and contents at the boundary, source inside it -- is the same method [System Call Path](./syscall-path.md) used on `write()`, only this time initiated from the `ls` side.

### 2.5 Further Reading: Test Suite and Official Docs

Three places extend coreutils without needing to buy anything: read the cases in `tests/` (the authoritative version of behavioral semantics), the long comments at the top of each `src/*.c` (the authors' design notes), and the NEWS file (the chronicle of semantic changes between versions). If after this section you want to reconnect the "one command = one string of syscalls" impression to the kernel view, go straight back to [System Call Path](./syscall-path.md) to reconcile; to take strace usage one level further, see [Tracing Tools](./tracing-tools.md). On books: Michael Kerrisk's *The Linux Programming Interface* covers the buffering and descriptor semantics of this section thoroughly in its file I/O and standard I/O parts (check chapter numbers against your edition; see the references at the end).

## 3. glibc: The Last Centimeter of the System Call

### 3.1 Core Structures: Three Layers and the Source Map

Three layers sit between `printf("hi")` and the screen: **the stdio buffering layer** (data first enters the FILE struct's buffer; line/full buffering decides when it flushes) → **the write wrapper layer** (glibc's platform wrapper around `write`) → **the syscall instruction layer** (assembly loads the call number into a register and executes the trap instruction). The source map has three corresponding stations: stdio lives in `libio/` (every internal glibc IO function carries the `_IO_` prefix, a reliable landmark); syscall wrappers fork platform by platform under `sysdeps/`, and the x86-64 + Linux path lands around `sysdeps/unix/sysv/linux/`; at the bottom sits each architecture's assembly wrapper. The three-layer division explains two familiar phenomena: `printf` not appearing until long after without a newline (buffer not flushed), and `write` counts in strace not matching the number of `printf` lines (merging and chunking in the wrapper layer).

### 3.2 Key Call Path: printf to write

The main chain is short, but every layer deserves a stop:

```text
printf("hi %d", n)                 # formatting: the result enters the FILE buffer
  └─ _IO_file_xsputn               # libio/ buffered write: released on full/newline/fflush
       └─ write's platform wrapper  # around sysdeps/unix/sysv/linux/
            └─ syscall instruction  # assembly wrapper: call number into register, trap into the kernel
```

**Each level down this chain thins the abstraction by one layer, until the registers are loaded** -- the same training method as the module chapters' "follow one top-to-bottom chain per chapter", only much shorter. The three-layer division also lands here: the buffering layer explains why `printf` stalls without a newline, the wrapper layer explains why write counts mismatch printf lines. One fork in the road must also be named on this chain: not every "system call" traps into the kernel. Reading clocks such as `gettimeofday` and `clock_gettime` runs from a small piece of code the kernel maps into every process's address space (the vDSO); glibc calls that code directly in user space to read the clock data, falling back to a real syscall only on a vDSO miss -- which is why `clock_gettime` never shows up in strace yet you still get the time. Who does this and how it is resolved, [System Call Path](./syscall-path.md) already explained from the kernel side; user space only needs one sentence: **the vDSO is glibc's exemption lane across the syscall boundary -- before reading strace output, ask once "does this operation have an exemption lane"**.

### 3.3 Source Reading Order: From Symbol to Implementation

glibc searching depends on directory sense even more than the kernel does: **first think through the "x86-64 + Linux" path, then follow the trail**. Concretely: search the symbol name globally in gitweb (sourceware rate-limits crawlers; browser access is fine) to get the platform-independent entry declaration, then head into `sysdeps/unix/sysv/linux/` for the platform wrapper, and finally the assembly under that architecture's directory; on the stdio side, start from the `_IO_` family in `libio/`. Two effort-saving footholds: first, the headers and comments are newer than the books -- the `bits/syscall.h` family hands you the call-number list directly; second, **the verification tools are at hand** -- LD_DEBUG and strace are the arbiters of this section; whatever a book says about a symbol yields to the source of the version you checked out; if they disagree, trust the source.

### 3.4 Hands-On: LD_DEBUG and Address Mapping

glibc's built-in debug switch works out of the box: without touching any code you can watch symbol binding happen dynamically (for the environment variable semantics see the [Scripting Variables chapter](../script/variables.md)):

```bash
$ LD_DEBUG=symbols /bin/ls > /dev/null 2> /tmp/ld.log
$ grep -m3 'lookup' /tmp/ld.log
   17321:	symbol=write;  lookup in file /usr/lib/libc.so.6 [0]
   17321:	symbol=write;  binding file /bin/ls [0] to /usr/lib/libc.so.6 [0]: normal symbol
$ LD_DEBUG=help /bin/ls 2>&1 | head -5        # before the output explodes, see available sub-options
```

LD_DEBUG has many sub-options (`bindings`, `files`, `reloc`, ...) -- in production always redirect to a file and grep; printing straight to the screen floods the terminal. The second paired experiment connects the static and dynamic views:

```bash
$ ldd /bin/ls | head -3                       # "who it promised": the resolved library list
	linux-vdso.so.1 (0x00007ffd8c7e9000)
	libc.so.6 => /usr/lib/libc.so.6 (0x00007f...)
$ cat /proc/self/maps | grep libc              # "who actually got mapped": the segments truly in the address space
7f...-7f... r--p 00000000 08:02 12345678 /usr/lib/libc.so.6
```

**ldd is "who it promised", maps is "who actually got mapped"**; when debugging dynamic loading, maps wins -- in the same lineage as the systemd reading rule of §4 ("what the configuration says is not what the process uses"), and one more landing of the recurring principle "the runtime state is the truth".

### 3.5 Further Reading: vDSO and One Man Page

User-space extension from glibc starts with one man page: `man 7 vdso` explains the exemption lane's mechanism and how to observe it in under ten lines, one of this part's rare "official self-description" documents. On books, the file I/O, standard I/O, and dynamic-linking parts of Kerrisk's *The Linux Programming Interface* are the expanded version of this section (check chapter numbers against your edition). After finishing this section's experiments, return to [System Call Path](./syscall-path.md) and join the kernel-side vDSO resolution with the user-side LD_DEBUG observation here into one complete picture -- **the same thing, half seen from each side**.

## 4. systemd: One Corner of Unit Loading

### 4.1 Core Structures: The src/core Trio

The systemd source is famous for its size, but the trail of "how one unit file becomes a startable process" is short and complete, making it a good optional read. The repository's top level is the big `src/` directory, with the core in `src/core/` -- the body of PID 1. This section records only the trio: `unit.c` (the main loading logic of a single unit plus the queueing mechanism), `load-fragment.c` (the unit file's syntax parser, translating key-value pairs like `Description=`, `ExecStart=`, `Wants=` line by line into struct fields), and `manager.c` (the manager's overall lifecycle, with unit loading choreographed into the startup order). Their division of labor in one line: **manager decides "when to load", unit decides "what to load", load-fragment decides "how to translate"** -- memorize this division table first, and you will not get lost entering any function.

### 4.2 Key Call Path: manager_startup to unit_load

The main chain has two segments. The overall one: `manager_startup` shows the startup order (run generators, enumerate existing units, coldplug, become ready), with unit loading choreographed inside this spine. The individual one: `int unit_load(Unit *u)` is the main function for loading a single unit; following it you meet `unit_load_fragment_and_dropin` (locating the fragment file along with its drop-ins) and the queueing mechanism `unit_add_to_load_queue` (a unit not yet parsed queues up, and the queue is pushed through in batches). **Together the two segments answer "how a file becomes an in-memory structure"**: the text on disk is translated by load-fragment.c into fields, the fields hang off the structures the manager manages, and processes are then brought up based on those fields. D-Bus and transaction solving are out of scope here -- that belongs to the Wants/Requires semantics covered on the administrative side in [Advanced systemd](../system-management/services-systemd.md); this section only fills in the implementation side, and reading the two together makes a complete front-and-back picture.

### 4.3 Source Reading Order: Trailing the Main Function

The order matches the previous two sections, with the entry point being the main function itself. First pin the three stations on the map with grep (line numbers vary by version, illustrative only):

```bash
$ grep -n 'int unit_load(' src/core/unit.c        # station 1: the main loading function
1412:int unit_load(Unit *u) {
$ grep -n 'ExecStart' src/core/load-fragment.c | head -2   # station 2: where syntax becomes fields
...
$ grep -n 'manager_startup(' src/core/manager.c   # station 3: the overall startup order
```

Then read who `unit_load` calls in turn (fragment location, drop-in merging, parsing, queueing), pick a key you have seen in your own unit file (say `ExecStart=`), reverse-search it in `load-fragment.c` and see which field of the `Unit` struct it lands in, and finally return to `manager.c` to see how `manager_startup` arranges the batch loading. Every step carries a concrete question -- "which field does this key finally become", "when do queued units get pushed through in batches" -- **question-driven reading is an order of magnitude faster than reading straight through**, in the same lineage as the indexing approach of the [Source Tree](./source-tree.md) chapter. Going no deeper into D-Bus signals and dependency-graph solving: that is another deep-water route.

### 4.4 Hands-On: Reconciling with the Runtime

The best verification of source fields is checking them against the runtime (`dump` output varies by version and unit content, illustrative only):

```bash
$ systemctl cat nginx | head -8               # the unit content actually in effect (drop-ins included)
$ systemd-analyze dump | grep -A2 'Unit nginx.service' | head
```

The output of `systemctl cat` and the input consumed by `load-fragment.c`'s parser are the same text, and `dump` spreads out the in-memory structure after `unit_load` -- **strung together the three form the complete evidence chain of "file → parsing → struct"**. When comparing, remember the source-level version of the administrative side's iron rule: the file on disk may be overridden by a drop-in or temporarily rewritten by a generator; only the fields dumped are the ones the process actually goes by. To go further on load order, the timeline view complements this section's code view (numbers vary by machine, illustrative only):

```bash
$ systemd-analyze critical-chain nginx.service
nginx.service +812ms
└─network-online.target @1.456s
  └─NetworkManager-wait-online.service @402ms +1.054s
```

`critical-chain` answers "who held up the chain", the `unit_load` chain answers "where the fields come from" -- **one looks at time, the other at structure; together they make the complete unit lifecycle**.

### 4.5 Further Reading: Back-Links to the Administrative Side

Extensions on the systemd side split two ways. The operational branch returns to [Advanced systemd](../system-management/services-systemd.md): the complete unit file syntax and Wants/Requires semantics live there, and this section's source reading explains exactly why those semantics look the way they do. The documentation branch is the official man pages: `man 5 systemd.unit` is the authoritative definition of the key-value syntax and corresponds line by line to the parser in `load-fragment.c` -- **lay the man page next to you while reading the parser, one side the specification, one side the implementation**; this is the universal shortcut for reading configuration-driven source. If English is no obstacle, the documentation directory at the root of the systemd source tree is also worth a look.

## 5. Methodology: Carrying Over the Module Chapters' Muscle

User-space and kernel source reading are isomorphic, but the differences dictate operational details, worth pinning next to the monitor:

| Dimension | Kernel source | User-space source |
|------|---------|-----------|
| Build cycle | Hours (full build) | Minutes (coreutils ~2 min) |
| Blast radius | Whole-machine panic; live inside VM snapshots | Process exit; redo from a core dump |
| Call boundary | syscall/interrupts (strace/ftrace each cover half) | mostly function calls; strace only sees the boundary |
| Debugger | gdb + QEMU `-S -s`, breakpoint from a cold boot | gdb attaches to the process directly, zero risk |
| Entry point shape | `start_kernel` / syscall table / interrupt vector | `main` or a callback (GUI/event loop) |
| Behavioral authority | Kernel source and documentation | `tests/` cases and man pages |

The general order does not change; broken into four steps:

1. **Find the entry**: `main`, a registered callback, or the main function itself; converge with grep from two sides, symbol names and command-line option strings
2. **Follow the call chain**: descend level by level from the entry, asking one question per layer (what does this layer do, who does it hand off to)
3. **Close the loop with evidence**: strace's counts and contents, LD_DEBUG's binding records, dump's fields -- every inference step must be backed by observable output
4. **Reconcile with the configuration**: verify source conclusions against the actually effective configuration/runtime state; when they disagree, the runtime wins

**Grep to locate first, follow the chain down next, close every step with evidence** -- this is the reading method shared by every chapter of this part; change repositories, never the method. The three targets of this chapter each drilled one muscle: coreutils drilled the two-track observation of "boundary vs. inside", glibc drilled "peeling layered abstraction layer by layer", systemd drilled "reconciling configuration against runtime". Together the three muscles are the confidence to read any user-space repository.

## 6. Common Pitfalls

**Reading the main branch and not matching the running version.** coreutils changes behavior across major versions (coloring rules, sorting details, and the long-option set have all moved); the symptom is "the source clearly says otherwise". Run `ls --version` first to match versions, then decide whether to check out the corresponding tag -- in a git repo, `git log` on a function name is more accurate than flipping through books.

**Wandering into gnulib and wasting effort.** It is a synced-in third-party portability layer; reading it means reading the porting history, not `ls`. Discipline: `src/` is semantics, `lib/` is utilities, `gnulib/` in principle you do not enter -- ten minutes lost in gnulib is your cue to back out.

**LD_DEBUG output floods the screen.** Running any program with `LD_DEBUG=symbols` dumps thousands of lines instantly. Run `LD_DEBUG=help` first to see the sub-option list, always redirect to a file and grep; and remember to unset the variable after testing -- it applies to child processes too.

**Searching a glibc function name turns up several implementations.** glibc's code is directory-partitioned by platform (`sysdeps/` forks by architecture and kernel family layer by layer); `write` only means anything on the unix/sysv/linux line, and the other directories are same-named implementations for other platforms. Before searching, think through the "x86-64 + Linux" path, then follow the trail.

**systemd unit files not matching the source structure.** The file on disk may be overridden by a drop-in or temporarily rewritten by a generator; reading the originals under `/usr/lib/systemd/system/` directly leads to wrong conclusions. Take `systemctl cat`'s merged result as the input and `systemd-analyze dump`'s fields as the output, and let the source explain only the translation in between -- **the runtime is always the "current truth", the disk is merely "candidate input"**.

## References

- coreutils source repository -- [github.com/coreutils/coreutils](https://github.com/coreutils/coreutils) (mirror of the official GNU git repository)
- GNU coreutils release directory -- [ftp.gnu.org/gnu/coreutils](https://ftp.gnu.org/gnu/coreutils/)
- glibc source browsing (gitweb) -- [sourceware.org/git/?p=glibc.git](https://sourceware.org/git/?p=glibc.git)
- systemd source repository -- [github.com/systemd/systemd](https://github.com/systemd/systemd)
- gnulib portability layer project -- [gnu.org/software/gnulib](https://www.gnu.org/software/gnulib/)
- systemd.unit manual page -- [freedesktop.org/software/systemd/man/systemd.unit.html](https://www.freedesktop.org/software/systemd/man/systemd.unit.html)
- Michael Kerrisk. *The Linux Programming Interface* -- written by the maintainer of the man pages, the authoritative reference on the systems programming interface
- Linux man pages -- [man7.org](https://man7.org/) (the `man 2 write`, `man 7 vdso`, `man 7 system_data_types` family)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [README](README.md)
