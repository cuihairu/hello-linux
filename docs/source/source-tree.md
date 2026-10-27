# Getting the Source and Reading the Directory Layout

Documentation answers "what",
the source answers "why" and "how":
the manual tells you `kill -9` terminates a process,
but only the source tells you how the signal is queued after `sys_kill` hands off to `do_send_sig_info`,
and at which checkpoint it is finally discarded.
When troubleshooting reaches the level of "why does the kernel do this",
the kernel source is the ultimate truth --
and the first step toward that truth is not opening an editor
but making the source **match the version** of the kernel running on your machine.
This page is the first stop of the Kernel Source part:
where to get the official source,
what the directory map looks like,
how to read the Kconfig/Makefile/.config build language,
how to index and browse locally and online,
and finally a 30-minute guided reading route.
When you finish this page you can use these records to verify that you completed
the whole process from `uname -r` to opening `init/main.c` on your own;
building the kernel and writing modules is left to
[Kernel Build and Module Development](./build-and-modules.md),
and tracing/observation is left to this part's
[Tracing Tools](./tracing-tools.md).

> The content draws on the kernel.org official documentation and the kernel's own Documentation/;
> the conceptual framework draws on Bird's Private Recipes (Lin's Linux Administration Guide) and *Linux Kernel Development*; see the references at the end.

## What This Part Covers

- Make clear what question each of documentation, books, and source code answers, and establish the discipline of "fix the version first, then read code"
- Get the source through both the official tarball and git
- Draw the kernel directory map from memory
- Understand the division of labor among the Kconfig/Makefile/.config trio
- Set up a local index (ctags/cscope) or an online browser
- Follow the 30-minute route to complete your first straight read without getting lost among the tens of thousands of files under drivers/
- Go chapter by chapter through the modular chapter order (process scheduling → memory management → VFS/ext4 → network stack → interrupts/clocks → IPC → driver framework → system calls), completing each chapter's five steps: "data structures → key paths → reading order → hands-on tracing → further books"

## 1. Why You Need the Source

Three kinds of material answer three levels of question: **man pages** answer "what does this parameter mean";
**books** answer "what are the design tradeoffs of this subsystem";
**source code** answers "why is this exact line, running on this machine, written the way it is".
The division of labor and the boundaries:

| Material | Question answered | Timeliness | When to move to the next level |
|------|-----------|--------|--------------------|
| man/info pages | Parameters, semantics, return values | Updated with the package | When the manual cannot explain the actual behavior |
| Books / official documentation | Design model, subsystem architecture | A snapshot of the version at writing time | When the model does not match the phenomenon |
| Source code | Line-by-line facts, version differences, patch impact | Strictly tied to the version | -- (the final truth) |

In practice, what actually forces people to the source is usually a class of questions documentation cannot answer:
which condition exactly triggered an incomprehensible warning in the kernel log;
why two config options look equivalent but behave differently in practice;
why a driver changed behavior after a kernel upgrade, and which commit did it.
What these have in common is that the answer is not at the abstraction layer of the documentation
but in the specific lines of the specific version.

Reading source also has a hidden benefit:
**it is the final documentation that never goes stale**.
Books and blog posts are based on the version at writing time;
the analysis you find online may be a ten-year-old kernel;
the source is the byte-for-byte fact of the version you are running right now.
When the two disagree, the source wins,
and then you can work back to where the article went stale --
which is exactly why this part demands "version discipline".

### 1.1 Version Discipline: Match the Version, Then Read Code

The first step of any code-reading work is answering one question:
**does the source I am reading correspond to the kernel I am running**.
Distribution kernels usually carry local patches
(Ubuntu's and Debian's `-generic`/`-amd64` suffixes are the tell),
and the same mainline version number can still be a different build:

```bash
$ uname -r
6.12.7-arch1-1
$ cat /etc/os-release | head -2
PRETTY_NAME="Arch Linux"
```

`uname -r` gives the running version,
and the distribution tag (`arch1-1`, `6.1.0-28-amd64`, `5.14.0-427.el9`)
tells you which repository to pull the matching source from --
Section 2.3 gives the side-by-side for all three families.
This discipline is the same conservative operational mindset as
"look at your dependencies before upgrading" in package management:
when the source does not match the running kernel,
you will spend a lot of time hunting for evidence in functions that do not exist in your version,
and this kind of error is extremely hard to detect after the fact --
did the search fail because the version is wrong,
or because your understanding is wrong?
Isolate the variable first, reason only after.

## 2. Two Routes to the Source

### 2.1 The Official Tarball: The Fastest Route

kernel.org's release archive is organized by version series;
under `v6.x/` lie all the 6.x releases:

```bash
# Download and unpack the official source (example: 6.12.7)
$ curl -LO https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.12.7.tar.xz
$ tar -xf linux-6.12.7.tar.xz
$ du -sh linux-6.12.7
1.4G    linux-6.12.7
```

The archive is about 140 MB and unpacks to about 1.4 GB --
worth knowing in advance:
when disk is tight or the network is restricted,
the tarball is still cheaper than a full git repository (see Section 7).
A tarball is a "read-only snapshot":
no history, no branches, suited to "reading this one version";
to see commit history you must use git.

Before you rely on it, do an integrity check while you are at it --
kernel.org provides a `.sign` signature and hash list for every release,
and one `sha256sum -c` line rules "corrupted download" out of every weird symptom that follows:

```bash
$ curl -LO https://cdn.kernel.org/pub/linux/kernel/v6.x/sha256sums.asc
$ grep "linux-6.12.7.tar.xz" sha256sums.asc
e0b1d...  linux-6.12.7.tar.xz        # the value in the official list
$ sha256sum linux-6.12.7.tar.xz
e0b1d...  linux-6.12.7.tar.xz        # the locally computed value; matching means pass
```

The probability payoff of this step is low,
but it turns a "what if" into a certainty --
the same discipline as running memtest before blaming memory during troubleshooting:
nail down the physical-layer suspect first,
and every piece of reasoning after it can stand.

### 2.2 The git Clone: Choose It When You Want History

```bash
# Shallow clone of mainline (the torvalds tree), latest snapshot only
$ git clone --depth 1 https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git
Cloning into 'linux'...
$ du -sh linux
389M    linux
```

The torvalds tree is mainline --
it carries no distribution patches,
and it is also the default target of LWN and the elixir online index.
There is one more tree worth knowing:
the **stable tree** (`git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git`),
where maintainers continuously backport fixes onto mainline --
your distribution kernel's small version numbers like `.7` and `.28` come from it.
When chasing "which version fixed this bug",
the stable tree and its `v6.12.y` series tags are the fastest verification route.

A few facts to put on the table first:

- **A repository with full history is several GB** -- the git history contains thirty years of commits, useless for pure code reading; `--depth 1` gets the latest snapshot, and you can fetch history later if needed (`git fetch --unshallow`, pay as you go)
- **Distribution kernels live in their own repositories**: Debian's `linux` source package, Fedora/RHEL's `kernel` source package, and Ubuntu's `linux` source tree each carry their own patch series. When they do not match, go back to Section 2.3 and get the distribution source
- **Release tags are natural anchors**: after a full clone, `git tag | tail` lists tags like `v6.12.7`, and `git checkout v6.12.7` returns you to the exact state corresponding to `uname -r` -- the real decision point between "tarball or git" is whether you want this anchor

The tradeoffs of the three acquisition routes in one table:

| Dimension | kernel.org tarball | git clone (torvalds/stable) | Distribution source package |
|------|--------------------|------------------------------|--------------|
| Size | ~140 MB (1.4 GB unpacked) | Hundreds of MB shallow / several GB full | Tens of MB upward |
| Commit history | None | Yes (`git log`/`blame` available) | Patch series (quilt/patchset form) |
| Match with the local kernel | Same version number only | mainline/stable, no distribution patches | **Exact match (patches included)** |
| Best for | Reading a fixed version, limited bandwidth | Following evolution, comparing across versions | Explaining local behavior |

### 2.3 Getting the Source That Matches "the Running Kernel" (Three Families)

The shortest path to reading the version you run
is to take the source from your distribution's package system,
with the patch differences included:

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Get the source package | `apt install linux-source-6.1` | `pkgctl repo clone linux` | Subscription-based `dnf source`, or take CentOS Stream |
| Output form | `/usr/src/linux-source-6.1.tar.xz` | PKGBUILD + the official patch series | src.rpm or a git tree |
| Use case | Reading the Debian kernel running locally | Reading the official Arch kernel build | Reading the RHEL kernel (heavily patched) |

Debian's `linux-source-*` packages install the kernel source as a tarball into `/usr/src/`,
strictly corresponding to the running local version;
Arch's kernel is built officially itself,
and `pkgctl repo clone linux` (provided by devtools, replacing the deprecated `asp`)
pulls exactly the `PKGBUILD` and the patch queue --
`makepkg`'s build process is the official kernel's production process;
RHEL-family kernels carry many Red Hat patches and the source lives in the subscription repos;
without a subscription, the CentOS Stream kernel repository serves as an approximate reference.
The three families share a single criterion:
**only when the source version plus the patch set matches `uname -r`
can the behavior you read explain the phenomenon on your screen**.

## 3. The Directory Map

The source tree has about 30,000 files,
but only twenty-odd top-level directories --
build a sense of the map first, then drill into details.
The table below is organized by "what you should read" rather than alphabetically:

| Directory | Responsibility | What to read |
|------|------|--------|
| `init/` | Kernel entry and global initialization | `start_kernel` in `main.c` -- the source of the entire boot mainline |
| `arch/` | Per-CPU-architecture code | `arch/x86/` is the x86 entry; architecture-independent code is **not** here |
| `kernel/` | Core subsystems (architecture-independent parts) | `sched/` scheduling, `fork.c` process creation, `signal.c` signals, `time/` timekeeping |
| `mm/` | Memory management | buddy allocation (`page_alloc.c`), SLUB (`slub.c`), page faults (`memory.c`) |
| `fs/` | VFS and concrete filesystems | VFS core in `fs/*.c` (`namei.c`, `read_write.c`), ext4 in `fs/ext4/` |
| `net/` | The network protocol stack | Entry at `socket.c`, protocol layers in `core/`, `ipv4/`, `ipv6/` |
| `drivers/` | Device drivers | More than half the whole tree; **leaf code** -- look at the subsystem first, then come back here |
| `include/` | Public headers | `include/linux/` holds the core structure definitions -- `task_struct` in `sched.h` |
| `block/` | The block layer | I/O merging, schedulers, request queues |
| `ipc/` | System V IPC | Semaphores, message queues, shared memory implementations |
| `virt/` | Virtualization | KVM lives in `virt/kvm/` |
| `Documentation/` | The kernel's own documentation | Official .rst files, same version as the source -- **the most underestimated entry point** |
| `scripts/` | Build-system scripts | The Kconfig parser and various helpers; usually skipped while reading code |

Three easy-to-trip-on points about this table.
First, **`kernel/` and `drivers/` have a "core vs. leaf" relationship**:
process scheduling, memory allocation, and other "kernel proper" code lives in `kernel/` and `mm/`,
while drivers for concrete hardware live in `drivers/`;
when first reading the source, heading straight for `drivers/` tends to get more confusing the further you go,
because leaves depend on the trunk and you have the order backwards.
Second, **VFS and concrete filesystems are kept on two layers**:
the top-level `.c` files in `fs/` are the VFS generic layer
(common logic for open, read/write, and path resolution),
while `fs/ext4/` is ext4's own implementation --
this layering is expanded in the
[VFS and ext4 chapter](./vfs-ext4.md).
Third, **the value of `Documentation/` is seriously underestimated**:
the kernel's official documentation ships at the same version as the source,
and `Documentation/filesystems/` and `Documentation/admin-guide/` often state outright
"the semantics of this sysfs node",
far more accurate than search-engine articles.

`arch/x86/` deserves a word of its own:
it is the "x86 architecture's kernel entry layer" --
the early assembly boot (`kernel/head_64.S`),
the system call table (`kernel/syscall_64.tbl`, the source of the numbers for 64-bit system calls),
and the interrupt entry points (around `kernel/entry_64.S`) all live here,
while architecture-independent logic goes back to `kernel/`.
The same function name having an implementation in both `arch/` and the core directory is normal
(one is chosen at compile time by architecture);
when reading code, first recognize which layer you are holding,
so you can switch correctly between "generic logic" and "architecture detail" --
this is the layering habit that recurs throughout this part's later chapters when discussing call paths:
**entries in `arch/`, the trunk in the core directories, leaves in `drivers/`**.

### 3.1 How to Use the Map: A Layered Reading View

The purpose of the directory map is not memorization
but **fixing a layer for each reading session**.
To read the scheduler, pin yourself in `kernel/sched/`;
for page allocation, pin yourself in `mm/`;
for ext4, pin yourself in `fs/ext4/`;
only follow a jump when the call chain crosses layers --
for example from `sys_read` (`fs/read_write.c`) to ext4's implementation (`fs/ext4/inode.c`, `file.c`).
When jumping layers, ask yourself "am I in the generic layer or the concrete implementation now":
when the answer changes, your expectations must change too --
functions in the generic layer are read for "contract and flow",
functions in the concrete implementation are read for "how this implementation honors the contract".
The payoff of this habit shows up later:
the more you read, the sharper your judgment of
"which code deserves a close read and which only needs to be located" --
the map eventually internalizes into an effortless reading intuition.

### 3.2 The Source Modular Charter (Explained by Module)

The Kernel Source part no longer lists things alphabetically
but proceeds through **8 core modules**,
each developed with the same fixed structure:

| Module | Focus | Chapter structure |
|------|--------|----------|
| 1. Process management/scheduling | `kernel/sched/`, `include/linux/sched.h` | Core data structures → key function call paths → source reading order → gdb/ftrace hands-on → reference books |
| 2. Memory management | `mm/`, `include/linux/mm.h` | Core data structures → key function call paths → source reading order → gdb/ftrace hands-on → reference books |
| 3. VFS and ext4 | `fs/`, `fs/ext4/` | Core data structures → key function call paths → source reading order → gdb/ftrace hands-on → reference books |
| 4. Network stack | `net/`, `net/core/`, `net/ipv4/` | Core data structures → key function call paths → source reading order → hands-on tracing → reference books |
| 5. Interrupts and clocks | `kernel/time/`, `include/linux/time.h`, `arch/*/kernel/entry_64.S` | Core data structures → key function call paths → source reading order → ftrace/perf hands-on → reference books |
| 6. IPC | `ipc/`, `include/linux/ipc.h` | Core data structures → key function call paths → source reading order → hands-on tracing → reference books |
| 7. Device driver framework | `drivers/` (subsystem entries), `include/linux/platform_driver.h` | Core data structures → key function call paths → source reading order → hardware hands-on → reference books |
| 8. System calls | `include/asm-generic/unistd.h`, the relevant entries under `kernel/` | Core data structures → key function call paths → source reading order → strace/ftrace/eBPF hands-on → reference books |

Every chapter's reading order follows the four-word creed
**"which file first → follow the function flow → verify hands-on → summarize the books"**,
keeping you from getting lost in the leaf code under `drivers/`.

## 4. The Build System Trio

### 4.1 Kconfig: The Definition Language of Config Options

Every config option you see in `menuconfig` is defined by some `Kconfig` file in the source tree
(option name, type, dependencies, help text).
`kernel/Kconfig`, `mm/Kconfig`, and `drivers/*/Kconfig` unfold layer by layer into the menu tree.
The practical value of reading Kconfig is:
**a config option's `depends on` and `select` are its behavioral boundary** --
when some feature "just won't turn on" on your machine,
most often an unmet dependency is the cause,
and checking in Kconfig is faster than searching the web:

```text
# fs/ext4/Kconfig (excerpt, real file)
config EXT4_FS
	tristate "The Extended 4 (ext4) filesystem"
	select BUFFER_HEAD
	select CRC32
	help
	  This is the next generation of the ext3 filesystem.
```

Hold this definition card and look back at `make menuconfig`:
the menu is not conjured from nothing --
`tristate` corresponds to the three states y/m/n (coupled with `obj-y`/`obj-m` in Section 4.2),
`select` is the hard "when I am selected, bring it along" pull dependency,
and `depends on` is the precondition without which the menu item does not even appear.
Once you know `menuconfig`'s `/` search
(type a symbol name and it lists where it is defined directly),
Kconfig turns from "another language to learn"
into the index page for configuring your kernel.

### 4.2 Makefiles: What Gets Built Is Decided Here

Each directory's `Makefile` declares its outputs with `obj-y` (compiled into the kernel)
and `obj-m` (built as a loadable module):

```make
# fs/ext4/Makefile (excerpt)
obj-$(CONFIG_EXT4_FS) += ext4.o
ext4-y := balloc.o bitmaps.o ...
```

`obj-$(CONFIG_EXT4_FS)` stitches Kconfig and the Makefile together:
when `CONFIG_EXT4_FS=y` in `.config` it expands to `obj-y` (into the kernel),
when `=m` to `obj-m` (a module),
and to nothing when unset.
Understand this one line and you simultaneously understand
how "configuration — build — loading" interlock --
and it is also the basis for editing Makefiles when writing modules in
[Build and Module Development](./build-and-modules.md).

### 4.3 .config: The "Answer Sheet" of the Running Kernel

`.config` is the final answer of the Kconfig Q&A;
the most effective way to read it is to compare two sources:

```bash
# The configuration inside the source tree (generated by make defconfig / make menuconfig)
$ ls -l .config
-rw-r--r-- 1 user user 168K  ... .config

# The running kernel's configuration: use it directly if the path exists
$ zcat /boot/config-$(uname -r) | grep EXT4_FS=
CONFIG_EXT4_FS=y
# Or (when the kernel has CONFIG_IKCONFIG_PROC enabled)
$ zcat /proc/config.gz | grep EXT4_FS=
CONFIG_EXT4_FS=y
```

The standard posture for a learning scenario is:
copy the running kernel's configuration to `.config`
(`cp /boot/config-$(uname -r) .config && make olddefconfig`),
and the source tree becomes perfectly isomorphic to your machine's behavior --
when you read any `#ifdef` branch, you know which side to take.
`/proc/config.gz` does not always exist
(it depends on whether the distribution enabled `CONFIG_IKCONFIG_PROC`);
when it does not, use `/boot/config-*`, the fact on disk.
Both are essentially two locations of the same answer.

## 5. Indexing and Browsing

### 5.1 Local Indexes: ctags and cscope

The most frequent action while reading code is "jump to definition, find all references";
a local index takes this from seconds to milliseconds:

```bash
# ctags: jump to definitions (Ctrl+] jumps in vim, Ctrl+T goes back)
$ make tags
# cscope: look up references/call relationships (make cscope generates cscope.out)
$ make cscope
# Once generated, both can be opened directly in vim with -t symbol
$ vim -t start_kernel
```

`make tags`/`make cscope` are targets provided by the kernel's top-level Makefile,
and their outputs land at the source tree root.
ctags handles "where is the definition",
cscope handles "who references it, who calls it" --
for questions like "who changed this function's state",
cscope's reference query is irreplaceable.
vim has a built-in cscope client; connect in three steps:

```bash
# 1) Generate the index (run at the source tree root)
$ make cscope
# 2) Attach the index in vim
:cs add cscope.out
# 3) Common queries
:cs find g schedule      " find the definition
:cs find c schedule      " find who calls it
```

A clangd-based setup (with `compile_commands.json`) jumps more precisely,
but costs more to configure;
ctags/cscope are enough at the start.

### 5.2 The Right Way to Grep

Beyond indexes, two grep habits are fixed:
structure definitions go to `include/linux/`,
implementations to the core directories (`kernel/`, `mm/`, `fs/`):

```bash
# Definition in a header: task_struct's home is include/linux/sched.h
$ grep -rn "struct task_struct {" include/
include/linux/sched.h:737:struct task_struct {
# Implementation in the core directory: the main implementation of the fork path
$ grep -rn "copy_process" kernel/fork.c
kernel/fork.c:2317:static __latent_entropy struct task_struct *copy_process(
```

Searching only `.c` files and missing the inline functions and macros in `include/`
is the number one reason for "it obviously exists but I can't find it" --
a great deal of key logic is written `static inline` in headers,
and Section 7 puts this on the pitfall list.

### 5.3 Online Browsers: Read Without Installing Anything

- **[Elixir Bootlin](https://elixir.bootlin.com/linux/latest/source)**: online index of the kernel source, supporting identifier jumps, cross-references, and version switching -- especially handy when comparing behavior between 6.6 and 6.12.
- **[CodeBrowser](https://codebrowser.dev/linux/)**: another online kernel browser, with a clang-based semantic index and finer jump granularity.

Both support deep-linking to a specific version and identifier,
making them the usual carrier for sending links to other people;
for your own deep reading, a local index plus an editor is still recommended.

### 5.4 Understanding Design Intent with git History

`git log`/`git blame` answer a question one step beyond the source:
**why did this code change from "that" to "this"**.

```bash
# Follow the history of the file containing schedule() (by function range)
$ git log --oneline -L :schedule:kernel/sched/core.c | head -20
# Follow the commits for a few lines and the motivation for the fixes
$ git blame -L 100,120 kernel/fork.c
```

`-L :function:file` is git's built-in syntax for following history by function range;
`blame` tells you who last touched each line and in which commit,
and then `git show <hash>` shows the commit message --
kernel commit messages often state the motivation and tradeoffs,
and are the best material for understanding "why wasn't it written the other way":

```bash
$ git show --stat 1f9f8b0e2c4d        # replace with the real hash found via blame
# Output contains: Subject (one-line change)
#          Body (motivation, tradeoffs, blast radius -- kernel commit messages often explain "why not that way")
#          File list (which subsystems this change touched)
```

One `git show` read gives you three things:
the title for what changed,
the body for **why it changed** (this is information documentation never gives you),
and the file list for the blast radius.
This step uses git history,
which is why Section 2.2 says "choose git when you want history".

## 6. A Follow-Along Route for Your First Browse

Here is a minimal 30-minute route;
the goal is not comprehension but **building a sense of the map**.
Before starting, match versions and confirm the configuration is readable:

```bash
$ uname -r
6.12.7-arch1-1
$ zcat /proc/config.gz | head -1 || ls /boot/config-$(uname -r)
# Any readable configuration works; the first line does not matter
```

Step 1 (10 minutes): read straight through the `start_kernel` initialization mainline --

```bash
$ grep -n "void __init start_kernel" init/main.c
698:asmlinkage __visible void __init __no_sanitize_address start_kernel(void *cmdline_p)
$ vim -t start_kernel        # or open vim init/main.c and jump to that line
```

(Line numbers float with the version;
trust the grep result -- which is also why you always search once before acting
instead of copying line numbers from an article.)

`start_kernel` (`init/main.c`) is the architecture-independent kernel entry
(the architecture-specific first hop is in `arch/x86/kernel/head_64.S`; do not go deep yet).
Along the way you will see calls like `setup_arch` (architecture initialization),
`mm_init` (starting the memory subsystem), and `sched_init` (starting the scheduler) --
**at each call site, reading just "what it is responsible for" is enough to move on**.
At the end of the mainline, `rest_init` spawns kernel threads,
initialization gives way to the scheduler,
and the kernel begins scheduling the first user process.
Like skimming a book's table of contents first:
the purpose right now is to remember "where the mainline enters and how many branches it splits into",
not to read page by page.

Step 2 (10 minutes): find the scheduler's foothold in `kernel/sched/core.c` --

```bash
$ vim -t sched_init          # scheduler initialization
$ vim -t schedule            # the core scheduling function
```

`sched_init` does the bootstrap initialization of the data structures,
and `schedule` is the core function that picks the next process after a voluntary yield or preemption --
connect the two and you have the skeleton of "how the scheduler starts and how it runs".
At this point you do not need to understand the concrete CFS/EEVDF algorithms,
only that **the algorithms live in `kernel/sched/fair.c` and the framework lives in `core.c`** --
the relationship between concrete allocation and the algorithms is the proper subject of the
[Process Management and Scheduling](./process-scheduling.md) chapter.

Step 3 (10 minutes): calibrate your impression with the documentation and wrap up --

```bash
$ less Documentation/process/howto.rst   # the official "how to participate in kernel development", also a guide to reading code
$ grep -n "start_kernel" init/main.c | head -3   # confirm which line you just read
```

After the three steps you hold four things:
version-matched source, a readable `.config`, an index,
and a map with "entry in `init/main.c`, scheduling in `kernel/sched/`".
Every subsystem you read afterwards repeats the same set of actions --
**match versions → locate the entry → build the index → follow the mainline** --
which is exactly the methodological source of this part's chapter structure
(data structures → call paths → reading order → hands-on tracing).

## 7. Common Pitfalls

**Version mismatch -- hunting for a function in 2.6 source with a 6.x article (or vice versa).** Thirty years of kernel evolution renamed a great many functions and structures,
and articles and books are based on their own eras.
The symptom is "nothing I search for turns up",
and you mistakenly think your understanding is at fault.
The order of handling: align the source version with `uname -r` → switch the online index to the same version and search again → if it still does not match, check the function's rename history (`git log --follow -p -S function_name` to search commits).
Isolate the variable first, then reason --
as with reading any system, first confirm you are looking at the right object.

**The tarball and git tree differ by an order of magnitude in size -- a deep clone with full history is not worth it for code reading alone.** The symptom is a half-hour clone occupying 5 GB of disk when you only plan to read code.
The handling: read code with `--depth 1` (a few hundred MB);
if you truly need history, backfill on demand with `git fetch --unshallow`;
when you only want one function's history, switching versions in an online browser is cheaper.
There is only one criterion: do you need the anchor of `git log -L`?
If not, do not pay the storage price of history.

**Getting lost in drivers/ -- go to the subsystem's core directory first; drivers are leaves.** The symptom is opening `drivers/`, seeing twenty subdirectories with hundreds of files each, and not knowing where to enter.
The root cause is the reversed order:
drivers depend on core kernel APIs
(a network driver requires understanding net's core layer, a block driver the block layer),
and reading backwards inevitably loses you.
The handling: enter from the four trunks `kernel/`, `mm/`, `fs/`, `net/`,
carrying the question "how does the driver call the core layer" back into `drivers/` --
trunk before leaf, the same logic as looking at the map before hunting for a shop.

**Grepping only .c files and missing the inlines and macros in include/linux/.** The symptom is logic that clearly exists but the code "cannot be found".
The root cause is that a great deal of key logic is written `static inline` in headers, or expanded as macros.
The handling: structure definitions always go to `include/linux/`,
calls and implementations to the core directories;
when grepping, include `include/` in the path (`grep -rn "function_name" include/ kernel/ mm/`),
or just use cscope's reference query to get the whole tree at once --
widening the search surface beats retuning keywords again and again.

**The config option cannot be found in menuconfig -- dependencies unmet, the menu item is hidden entirely.** The symptom is searching the whole menu tree per the documentation and not finding a CONFIG item,
or finding the definition via `/` but being unable to set it.
The root cause is an unmet `depends on` precondition in Kconfig,
or the option being force-pulled by another symbol's `select`.
The handling: press `?` (help) on any option in `menuconfig` to see the dependency chain,
or read the corresponding directory's `Kconfig` directly (Section 4.1);
when you want to force it on without going through the interface,
edit `.config` and run `make olddefconfig` to fill things in by the rules --
but accept that it may rewrite dependencies along with it.
This is the same mindset as "understand the behavioral boundary before changing":
look at the dependencies first, then touch the switch.

**Distribution kernels differ from mainline by patches -- when things do not match, get your distribution's source.** The symptom is code with the same version number behaving differently on your machine than what you see on elixir.
The root cause is distribution patches (security fixes, feature backports, driver tuning).
The handling: go back to Section 2.3 and get the source from your distribution's package system
(Debian `linux-source-*`, Arch `pkgctl repo clone linux`, the corresponding RHEL src),
or read your distribution's patch commits directly.
This is the same discipline as "read the manual matching your version":
the bond between source and running kernel is tighter than the bond between source and a version number.

## References

- The Linux Kernel Archives -- [kernel.org](https://www.kernel.org/)
- Official kernel documentation -- [docs.kernel.org](https://docs.kernel.org/)
- Online kernel source index (version switching / identifier jumps) -- [elixir.bootlin.com](https://elixir.bootlin.com/linux/latest/source)
- In-tree documentation: `Documentation/process/howto.rst` (how to participate in kernel development), `Documentation/admin-guide/README.rst`
- Robert Love, *Linux Kernel Development* -- the "starting from the kernel" chapters, as background for source-reading methodology and a kernel overview
- Bird's Private Recipes (Lin's Linux Administration Guide) -- boot process chapter (system-level background for the `start_kernel` boot mainline) -- [linux.vbird.org](https://linux.vbird.org/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [build-and-modules](build-and-modules.md)
- [ipc](ipc.md)
- [network-stack](network-stack.md)
- [process-scheduling](process-scheduling.md)
- [syscall-path](syscall-path.md)
- [tracing-tools](tracing-tools.md)
- [userland](userland.md)
