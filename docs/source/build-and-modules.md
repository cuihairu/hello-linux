# Kernel Build and Module Development

The phrase "compiling the kernel" covers two kinds of work with completely different weight:
a full build means touching the configuration, recompiling tens of thousands of files, and swapping the boot entry --
an action at the level of "installing a different kernel" where a mistake can leave the system unable to boot at all;
module development only needs a set of development headers that exactly match the running kernel,
and ten minutes later a `.c` file is compiled into a `.ko` and loaded into the live kernel.
This page puts the shortest path first --
get a hello-world module actually running with the distribution's headers (Section 3 gives a complete, copyable loop line by line),
earn the positive feedback of "I really can change the kernel",
and only then move on to the full build-and-install flow (Section 5) and the virtual-machine drill discipline (Section 6).
All three distribution families, realistic expected output, and six high-frequency failure classes are given side by side;
for getting the source and navigating the directory see
[Getting the Source and Reading the Tree](./source-tree.md),
and for observing the execution path after loading see
[Kernel Tracing Tools](./tracing-tools.md).

> Content draws on the kernel's own Documentation/ and the TLDP module programming guide (conceptual framework from *Linux Device Drivers* and Bird's Private Recipes (Lin's Linux Administration Guide)); see the references at the end.

## What This Part Covers

- Telling the two paths apart: full build vs. module development
- Installing kernel development headers on three distributions and verifying the build link is ready
- Completing the whole hello-world module loop independently: source, compile, load, unload
- Observing module parameters and metadata with module_param and modinfo
- The full flow from menuconfig / olddefconfig to make install, plus boot-entry differences across the three families
- Anticipating six classes of high-frequency failures

## 1. Compiling the Kernel and Writing Modules Are Two Different Things

The two paths differ entirely in goal, cost, and risk; get the accounting straight first:

| Dimension | Module development | Full build |
|------|----------|----------|
| Prerequisites | The running kernel + matching headers | A complete source tree + tens of GB of disk |
| Cycle | Compile-load, minutes | Configure-compile-install, hours |
| How it takes effect | insmod enters the kernel immediately | reboot into the new kernel |
| Cost of failure | rmmod, unload, start over | If the new kernel won't boot, fall back to the boot entry |
| Applies to | Writing drivers, verifying patches, studying a subsystem | Changing kernel version, deep customization, studying the build system |

The difference in weight comes from the risk model:
module code runs in kernel address space,
sharing the same page tables and privilege level with the kernel,
so a null pointer dereference is not a process receiving `SIGSEGV` --
it is an oops or even a panic, taking the whole machine down with it (Section 6 expands this discipline);
whereas most full-build failures happen "before the reboot" --
`make` errors, insufficient disk, a boot entry that did not get written --
all of them allow a calm retreat.
Package-management analogy:
module development is like `pacman -S` installing one package to try it out, and uninstalling if there is a problem;
a full build is like upgrading the whole distribution baseline, where you first confirm a rollback path exists --
both are worth doing, but the order should be small first, then big.

That ordering is also the arrangement of this page:
Sections 2-4 complete the module loop,
and only Section 5 enters the full build.
There is a practical reason too --
the positive feedback of reading source should arrive as early as possible:
first let your code actually run one line of `pr_info` in the kernel,
then go back to wrestle with Kconfig and Kbuild;
the dull parts become much easier to chew.

## 2. Environment: Install the Kernel Development Headers

Headers are "the build-tree interface of the currently running kernel":
they contain the expanded result of `.config`, the generated version header, and the Kbuild rules;
module builds attach to them to complete the build.
Side-by-side install for the three families:

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Headers (core) | `apt install linux-headers-$(uname -r)` | `pacman -S linux-headers` | `dnf install kernel-devel kernel-headers` |
| Compilation toolchain | `apt install build-essential` | `pacman -S base-devel` | `dnf groupinstall "Development Tools"` |
| Verify the build link | `ls -ld /lib/modules/$(uname -r)/build` | same as left | same as left |

On RHEL-family systems the two packages each do one job:
`kernel-devel` is the actual subject of module builds (it contains the Kbuild tree and `.config`),
while `kernel-headers` provides the UAPI headers used for compiling user-space programs;
installing both together is convention.
On Arch a single `linux-headers` line suffices,
but note that after a rolling upgrade, if the kernel package was upgraded without a reboot,
the headers and the running kernel are briefly out of sync
(this is where Section 7's `Invalid module format` comes from).

The verification command should print a symlink pointing at the concrete version directory --
on Debian, for example, at `/usr/src/linux-headers-6.8.0-45-generic`.
If it says `No such file or directory`,
the headers are the wrong version or were cleaned out by an upgrade --
`make` will fail further upstream later, so intercept it here:

```bash
$ ls -ld /lib/modules/$(uname -r)/build
lrwxrwxrwx 1 root root ... /lib/modules/6.8.0-45-generic/build -> /usr/src/linux-headers-6.8.0-45-generic
```

The toolchain naming differences across the three families match the contrasts that recur in the package-management chapter:
Debian calls it `build-essential`, Arch calls it `base-devel`, RHEL installs a package group --
the name changes; the fact that "compiling a C program needs make and gcc" does not.

## 3. Getting the hello-world Module Fully Working

### 3.1 The Source and the Makefile

Create a clean directory and put two files in it.
The module source (`hello.c`):

```c
// hello.c -- a minimal loadable kernel module
#include <linux/init.h>      /* __init / __exit macros */
#include <linux/module.h>    /* module_init / MODULE_LICENSE */
#include <linux/kernel.h>    /* pr_info */

static int __init hello_init(void)
{
    pr_info("hello: Hello, world! (%s loaded)\n", KBUILD_MODNAME);
    return 0;                /* non-zero return = load failure, the module will not stay in the kernel */
}

static void __exit hello_exit(void)
{
    pr_info("hello: Goodbye.\n");
}

module_init(hello_init);     /* executed on insmod */
module_exit(hello_exit);     /* executed on rmmod */

MODULE_LICENSE("GPL");
MODULE_AUTHOR("hello-linux");
MODULE_DESCRIPTION("Minimal loadable module example");
```

The build file (`Makefile`, one rule plus a comment):

```makefile
# Makefile -- same directory as hello.c
obj-m += hello.o
```

`obj-m` means "build a loadable module" (`obj-y` is for compiling into the kernel proper; the build system semantics differ).
The real build logic comes from kbuild, and we tell it two things from the command line:
where to build (`-C` pointing at the headers build tree) and where the source is (`M=$(PWD)`).
One command line:

```bash
$ make -C /lib/modules/$(uname -r)/build M=$(PWD) modules
  CC [M]  hello.o
  MODPOST [M] hello.mod.o
  CC [M]  hello.mod.o
  LD [M]  hello.ko
$ ls
hello.c  hello.ko  hello.mod.c  hello.mod.o  hello.o  Makefile
```

`-C` first switches into the kernel build tree (where the top-level Makefile and Kbuild rules take over everything),
then `M=` jumps back to our directory to handle the external module --
this is the mechanism behind "module development doesn't need the kernel source":
the build tree is in the headers, and we supply only a `.c`.
In the output, `CC [M]` is compilation, `LD [M]` links the `.ko`,
and `MODPOST` is module post-processing (generating the metadata sections inside `hello.mod.o`);
the hidden `.cmd` files record dependency tracking, and a rebuild works fine after deleting them.

### 3.2 The Load/Unload Loop

```bash
$ sudo insmod ./hello.ko
$ lsmod | grep hello
hello 16384 0
$ dmesg | tail -1
[  412.663214] hello: Hello, world! (hello loaded)
$ sudo rmmod hello
$ dmesg | tail -1
[  431.055102] hello: Goodbye.
```

These four steps are this page's definition of "working":
visible in `lsmod` (the module is in the kernel's module list),
the load message visible in `dmesg`,
and the unload message there too --
the `__init` section's init function and the `__exit` section's cleanup function each ran exactly once.
The three columns in the `lsmod` line are the size and use count related to the reference count;
the `dmesg` timestamp is seconds since boot,
and `412` seconds means this load happened about 7 minutes after boot.
A more convenient posture in a debugging loop:
keep `sudo dmesg --follow` running in one terminal and load/unload in another,
so the messages scroll in live instead of a blind `tail` every time --
the kernel ring buffer has a size limit and old messages get pushed out,
so during frequent experiments this detail decides whether you are looking at the current run or a leftover from the previous one.

A word on why the `MODULE_LICENSE("GPL")` line cannot be omitted:
without it the module is loaded as "proprietary",
the kernel log shows `module license 'unspecified' taints kernel`,
and the kernel is marked tainted;
the more practical loss is that symbols exported with `EXPORT_SYMBOL_GPL` --
 the interface of a great many modern subsystems --
are invisible to proprietary modules,
and `insmod` fails outright with `Unknown symbol`.
Taint is a state bit rather than a fault;
you can see it in `/proc/sys/kernel/tainted` and in `dmesg`,
and when reporting a bug the first thing others ask for is this bit.
Declaring GPL buys full symbol visibility and a clean load record --
the default discipline of module development.

### 3.3 What Happens in the Kernel After insmod

Once the loop works, it is worth asking one layer deeper:
between `insmod hello.ko` and the `Hello, world!` print,
what path does the kernel side actually walk?
The `insmod` user-space tool itself does almost nothing --
it reads the `.ko` file into memory and issues one `finit_module(2)` system call;
everything else is the kernel module loader's work:

```text
insmod reads the file ─▶ finit_module(2) ─▶ kernel module loader
                                            ├─ parse ELF sections and metadata (vermagic / signature / license)
                                            ├─ verify: version fingerprint mismatch → Invalid module format
                                            │          signature check failure → Key was rejected
                                            ├─ symbol resolution: unresolved references → Unknown symbol
                                            ├─ allocate module memory (core sections resident, init sections freed after use)
                                            └─ call hello_init(), registered via module_init()
                                                      └─ pr_info enters the kernel ring buffer → visible in dmesg
```

This diagram lines up with every high-frequency failure in Section 7:
`Invalid module format` stalls at metadata verification,
`Key was rejected` at the signature,
`Unknown symbol` at symbol resolution (license-restricted, or a dependency module not loaded first).
The meaning of the `__init` marker also becomes visible here --
functions and data carrying it are placed in the init section,
and once `hello_init` returns, that whole block of memory is freed:
this is "init code is used once and discarded" implemented at the link level.
Once you understand this path, troubleshooting stops being mysticism:
wherever the error occurs, check the input of that stage.

`rmmod` is the symmetric other half:
the kernel first confirms the reference count has dropped to zero
(it will not allow unload while another module or kernel component is still using it),
then calls the cleanup function registered via `module_exit`,
and finally reclaims the module memory.
This explains a discipline issue:
resources a module allocates (memory, device numbers, timers) must all be returned along the exit path,
otherwise they leak after unload, and kernel leaks are harder to reclaim than user-space ones.
Writing init and exit as a pair of transactions is a more important habit than remembering any API.

## 4. Advanced Module Postures

### 4.1 Module Parameters and sysfs Exposure

Add three lines to `hello.c` and the module acquires tunable parameters.
The full diff (only the four comment-marked places differ from Section 3.1):

```c
// hello.c -- version with parameters
#include <linux/init.h>
#include <linux/module.h>
#include <linux/kernel.h>

static char *name = "kernel";                              /* <- new: parameter variable and default */
module_param(name, charp, 0644);                           /* <- new: charp = string, 0644 = sysfs permissions */
MODULE_PARM_DESC(name, "Who to greet");                    /* <- new: description visible to modinfo */

static int __init hello_init(void)
{
    pr_info("hello: Hello, %s! (%s loaded)\n", name, KBUILD_MODNAME);  /* <- now uses name */
    return 0;
}

static void __exit hello_exit(void)
{
    pr_info("hello: Goodbye, %s.\n", name);
}

module_init(hello_init);
module_exit(hello_exit);

MODULE_LICENSE("GPL");
MODULE_DESCRIPTION("Minimal loadable module example with a parameter");
```

Recompile and load with a parameter:

```bash
$ sudo insmod hello.ko name="vbird"
$ cat /sys/module/hello/parameters/name
vbird
$ sudo sh -c 'echo -n "linux" > /sys/module/hello/parameters/name'
$ cat /sys/module/hello/parameters/name
linux
```

`module_param` does two things:
it parses the parameter from the `insmod` command line at load time,
and it creates a file with permissions `0644` under `/sys/module/<module name>/parameters/`.
The latter means **writable at runtime** --
but it is worth spelling out that writing to sysfs changes only the variable inside the module,
and when that takes effect depends on how the module itself uses it:
in this example the print happens in `init` (executed once at load time only),
so changing the value at runtime will not reprint anything;
to observe an effect you would have to make the module read the variable on some other path.
The "does the change take effect immediately or not" semantics are everywhere in driver tuning:
whenever you see `module_param` while reading code, ask one more question --
who consumes this value, and at what moment?

### 4.2 Metadata and Multi-File Modules

```bash
$ modinfo hello.ko
filename:       hello.ko
description:    Minimal loadable module example
author:          hello-linux
license:        GPL
srcversion:     3A9F1C2E5B7D8A4C1E0F6B2   # related to a hash of the source contents
depends:
vermagic:       6.8.0-45-generic SMP preempt mod_unload modversions
```

Two fields are the most used in troubleshooting:
`license` corresponds to the taint issue of the previous section;
`vermagic` is the fingerprint of "which kernel this `.ko` was built for" --
assembled field by field from the kernel version, SMP, the preemption model, modversions, and more,
compared strictly at `insmod` time, with a mismatch rejected outright (the root cause of Section 7's second item).

Real drivers are rarely single-file.
Multi-file modules declare their members in the Makefile with `combo-y`:

```makefile
obj-m += combo.o
combo-y := driver.o helper.o util.o   # three .o files linked into one combo.ko
```

A great many subsystems in the kernel tree are organized this way
(a directory's Makefile with a long run of `obj-y`/`obj-m` --
see [Getting the Source and Reading the Tree](./source-tree.md) for the Kbuild expansion);
when reading source, a directory-level Makefile maps to "the parts list of this subsystem".

### 4.3 insmod vs. modprobe: Manual Loading and Dependency Resolution

`insmod` is a "bare load":
give it a `.ko` path and it hands it to the kernel as-is,
so if the module depends on another module that is not loaded first,
symbol resolution fails with `Unknown symbol`.
`modprobe` is "load by name":
it consults the dependency index `/lib/modules/$(uname -r)/modules.dep`,
inserts the missing prerequisite modules in topological order,
and then installs the target module --
in a distribution `modprobe` is the daily tool and `insmod` is the workbench:

```bash
$ sudo modprobe hello          # load by module name (no .ko suffix), dependencies handled automatically
$ lsmod | grep hello
hello 16384 0
$ sudo modprobe -r hello       # unload (equivalent to rmmod, but still goes through dependency checks)
```

For a self-compiled module to be found by `modprobe`,
put it in the module tree and rebuild the index:

```bash
$ sudo cp hello.ko /lib/modules/$(uname -r)/extra/
$ sudo depmod -a               # rebuild the modules.dep index
$ sudo modprobe hello          # now loadable by name
```

`depmod -a` scans the symbol references and exports of every module under `/lib/modules/$(uname -r)/`
and generates `modules.dep` and the other index files --
understand this step and you understand why
"you put the `.ko` in but `modprobe` says not found":
the index was not rebuilt, so `modprobe` still reads the old list.
The tree-shaped dependencies of in-tree modules
(for example the crc checksum module a filesystem driver depends on)
are woven once at install time by this mechanism,
and the `Used by` column in `lsmod` output is a live projection of the dependencies in that index.

### 4.4 Why printk Comes First When Debugging

There is a clear priority among debugging tools during module development:
`printk` (`pr_info`/`pr_debug`) costs the least --
change a line, recompile, `insmod`, the loop is seconds,
and `dmesg` is ground truth from the kernel's point of view;
attaching gdb to a kernel first requires solving three things --
symbols, KGDB or a QEMU simulation, and a serial connection --
making the setup cost two orders of magnitude higher than printk.
The discipline: use prints first to narrow the problem to within one function, then bring in a debugger.
printk's log levels, dynamic switches (`dynamic_debug`),
and heavier tools like ftrace/eBPF are upgraded as needed in
[Kernel Tracing Tools](./tracing-tools.md).

One practical difference between `pr_debug` and `pr_info` is worth knowing now:
`pr_debug` prints nothing by default
(toggleable wholesale at compile time, and lit up precisely at runtime by dynamic_debug per file, per function, per line) --
shipped driver code full of `pr_debug` is a set of probes reserved for future field debugging,
with zero cost when unneeded.
Use `pr_info` in practice modules to guarantee visibility;
use `pr_debug` in code meant "for other people" to guarantee quietness --
cultivate this distinction from the very first module.

## 5. The Full Build and Install

The goal of a full build is to produce a complete kernel image and its module tree;
the flow is "configure → compile → install modules → install the kernel → update the boot entry".
The configuration interface needs the ncurses development libraries;
side-by-side for the three families:

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| menuconfig interface | `apt install libncurses-dev` | `pacman -S ncurses` | `dnf install ncurses-devel` |
| Build dependencies (excerpt) | `flex bison libssl-dev libelf-dev` | `base-devel` already includes flex/bison | `dnf install flex bison openssl-devel elfutils-libelf-devel` |

The correct starting point for configuration is **the currently running kernel's configuration**,
not a fresh set of defaults --
a default config lacks the drivers your machine needs, and a new kernel that fails to boot is common:

```bash
$ cp /boot/config-$(uname -r) .config   # use the current kernel as the baseline
$ make olddefconfig                     # fill in new options with defaults, without interrupting interaction
$ make menuconfig                       # make targeted adjustments as needed
$ make -j$(nproc)                       # parallel build
$ sudo make modules_install             # install the module tree under $(KERNELRELEASE)
$ sudo make install                     # install the kernel image and handle the boot entry
```

`olddefconfig` is the key step of "starting from a known baseline":
a new source version introduces new config options,
and it fills them in with Kconfig defaults and writes the file, asking not a single question.
For aggressive trimming you can switch to `make localmodconfig` --
it walks the modules currently loaded in `lsmod` as the list and asks about each,
producing a much smaller `.config`;
the cost is that anything not on the list is simply not compiled,
so plugging in a card you were not using may find no driver --
use it for learning, be careful with it in production kernel swaps.
An honest time expectation:
`localmodconfig` plus a new machine is on the order of an hour,
a full configuration takes 1-4 hours or more depending on hardware,
and `-j` parallelism is constrained by memory
(each compiler process eats hundreds of MB; too little memory means OOM rather than more speed).

Two efficient habits in `menuconfig` are worth cultivating on day one.
First, press `/` to search --
type a driver name or chip model (say `e1000` or `NVME`),
and the interface lists every matching config option with its location,
including whether its dependency conditions are already satisfied --
two orders of magnitude faster than arrow-keying through a menu tree of thousands of items.
Second, remember the difference between the two built-in states:
`*` compiles into the kernel proper (vmlinuz gets bigger, always available),
`M` builds a module (`.ko` loaded on demand, size decided by the initramfs) --
selecting `*` for storage and filesystem drivers required at boot saves the complexity of initramfs,
selecting `M` for pluggable devices keeps things flexible --
this is the core tradeoff every kernel customizer has to make.

If the options you want to change are only a small handful,
there is no need to hunt them down in the menu one by one:
the kernel tree ships a config-fragment merge tool --
write "the items you want to override" into a small file and layer it onto the baseline with one command:

```bash
$ cat my.config
CONFIG_DRM_I915=y
CONFIG_SND_HDA_INTEL=m
$ ./scripts/kconfig/merge_config.sh -m .config my.config
$ make olddefconfig     # still run the default-filling pass after merging
```

This "baseline + fragments" idea shares a philosophy with distribution `/etc/sysctl.d/` snippet management:
the complete configuration is a generated artifact, and humans only maintain the difference.
Fragments go into version control and diffs are reviewable,
far more sustainable than hand-maintaining a whole `.config` --
the in-tree `kernel/configs/` directory and each distribution's config packages
are organized on exactly this pattern.

`modules_install` and `install` have a clear division of labor:
the former installs the modules under `/lib/modules/<new version>/`,
the latter places `vmlinuz`, generates the initramfs, and updates the boot entry.
The degree of automation of the boot-entry step varies across the three families,
and this is where the chapter connects to the boot-management material:

- Debian/Ubuntu: the `installkernel` hook works with `update-initramfs`, and the boot entry is written automatically via `update-grub` triggered through `/etc/kernel/postinst.d/`;
- RHEL/CentOS/Rocky: hooks call `grubby` to rewrite the default boot entry;
- Arch: no automatic hook -- you must run `grub-mkconfig -o /boot/grub/grub.cfg` by hand; forgetting this step looks like "compile and install succeeded, but after the reboot the new entry never appears".

After installing, it is worth checking the artifacts once with `ls /boot`,
confirming the trio is complete before talking about the reboot:

```bash
$ ls -lt /boot | head -6
vmlinuz-6.10.0-custom      # the kernel image itself (the compressed executable)
System.map-6.10.0-custom   # the kernel symbol table (for troubleshooting tools to match addresses; the on-disk backup of kallsyms)
config-6.10.0-custom       # the final configuration of this kernel (the on-disk copy of .config)
initramfs-6.10.0-custom.img  # the initramfs (naming differs per family: initrd.img-/initramfs-)
```

The `config-` file has one more use:
it is the authoritative answer to "what exactly did this kernel enable".
Later, forgetting whether an option was `y` or `m`,
`grep CONFIG_XXX /boot/config-$(uname -r)` is much faster than re-running menuconfig --
the same discipline as `pacman -Q` for installed versions or `dpkg -L` for file lists:
ask the system for the truth first, do not rely on memory.

For GRUB generation and menu structure see
[The GRUB Bootloader](../basic/boot/grub.md).
One last discipline matters more than the flow itself:
**always keep the old kernel entry**.
When the new kernel fails to boot, pick the old version from the GRUB menu and debug the new configuration from there;
in the extreme case where you cannot even enter the menu, the rescue flow (chroot from a Live environment) is in
[Boot Process and Boot Management](../system-management/boot-process.md).
This is the concrete form of "have a rollback path before making a change" for kernel upgrades.

## 6. Practice in a Virtual Machine

The difference in risk models decides the choice of practice environment:
a user-space program crash is collected by the kernel's process manager, and the loss is limited to that process;
kernel-space code failing is at best an oops printout plus the death of the current process,
at worst a panic that freezes the whole machine -- everything unsaved is lost outright, and the filesystem may be left corrupted.
Therefore:

- **Full builds and the first start of a new kernel**: must be done in a virtual machine with rollback snapshots (QEMU/KVM, VirtualBox, or VMware, your choice). Take a snapshot → install the new kernel → reboot and verify → roll back if it is wrong. Doing this loop once and failing on bare metal means one reinstall.
- **Module development**: a VM is recommended for the same reason. Even a harmless hello-world exists for the day you mistype `pr_info` into a wild pointer dereference -- the kernel has no `ulimit` as a safety net. Crash in the VM and you roll back the snapshot; crash on bare metal and after the reboot `dmesg` still holds the oops stack, but the service has been down.
- An incidental convenience: `insmod` experiments in a VM do not pollute the host's tainted state or signature policy, and Secure Boot is easy to turn off (Section 7's third item) -- especially clean for teaching environments.

Taking QEMU's qcow2 disk as the example, the snapshot workflow is three commands and done
(VirtualBox/VMware press the equivalent buttons in the GUI):

```bash
$ qemu-img snapshot -c before-kernel-test disk.qcow2    # snapshot before the experiment
$ qemu-system-x86_64 -hda disk.qcow2 ...                # install the new kernel, reboot, verify
$ qemu-img snapshot -a before-kernel-test disk.qcow2   # not happy? roll back
```

There is exactly one discipline:
**the snapshot must already exist before you touch the kernel**.
Rollback solves the class of failures where "the new kernel won't boot";
it cannot save the procedural mistake of "started without taking a snapshot" --
the same conservative change mindset as "back up before changing" in databases and
"confirm you can roll back before upgrading" in package management, projected into a third domain.

Starting a VM from the QEMU command line and virtme-style "mount the local source and run it directly" are advanced topics,
covered in the debugging-environment section of [Kernel Tracing Tools](./tracing-tools.md);
this page does not expand on them.

## 7. Common Pitfalls

**make says "no rule to make target" -- check the directory and the M= parameter first.** Nine times out of ten this error comes from the wrong build entry point:
the `Makefile` or `hello.c` is not in the current directory (one `ls` tells you);
in `M=$(PWD)`, `$(PWD)` expands to the current path in the shell,
so hard-coding a wrong path or running in a directory with no `.c` makes kbuild fail to find the source file and throw this.
Fix it and re-run the same `make -C ... M=$(PWD) modules`;
the appearance of `CC [M]` means normal service has resumed --
note that if the error mentions `/lib/modules/.../build` itself not existing,
that is Section 2's headers not installed properly, and the problem is not in the Makefile at all.

**insmod says `Invalid module format` -- vermagic mismatch, most likely "upgraded without the matching reboot".** Compare `modinfo -F vermagic hello.ko` with `uname -r` character by character:
the headers package moved to a new version directory with the upgrade, but the machine has not rebooted yet,
so `uname -r` still reports the old version,
and the built `.ko` naturally fails the running kernel's fingerprint check:

```bash
$ modinfo -F vermagic hello.ko | awk '{print $1}'
6.8.0-45-generic
$ uname -r
6.8.0-47-generic          # <- mismatch between the two lines is the root cause; reboot to align, or rebuild with the matching headers
```

Pick one of three options:
reboot so the two align (smoothest);
rebuild using the headers matching the old version;
or confirm that a `.ko` put in from elsewhere is not mixing build environments.
The `vermagic` comparison is field by field --
a different `SMP` or preemption model is rejected just the same.

**insmod says `Key was rejected by service` -- Secure Boot refuses unsigned modules.** When the kernel has Secure Boot and forced module signature verification enabled,
a `.ko` with no signature chain is refused outright.
In a learning scenario the shortest path is turning Secure Boot off in the VM's firmware settings;
on real hardware that must stay on, you have to walk the MOK (Machine Owner Key) flow --
generate a key, register it with `mokutil --import`, and confirm in the blue MOK manager after the reboot.
In production, signatures are an asset; in learning, turning them off is efficiency --
pick per scenario and do not keep flip-flopping between the two paths.

**The module loads but dmesg shows no expected output -- suspect the level and your search term first, not that the code did not run.** `pr_info` is `KERN_INFO` (level 6);
below the console log level the line will not scroll onto the screen,
but it is still recorded in the kernel ring buffer:
`dmesg | grep hello` or `dmesg -l info | tail` will find it.
Two common misjudgments:
staring at the terminal waiting for output (kernel prints go to the kernel log, not your tty);
and using `dmesg | tail` only to see the tail of unrelated logs --
after confirming the load succeeded with `lsmod`,
grep by the keyword from your print rather than trusting a blind `tail`.

**The build stops at a warning -- the distribution enabled CONFIG_WERROR.** New kernels have a `CONFIG_WERROR` option (enabled by default by some distributions)
that promotes every compile warning to an error and aborts the build.
To locate it, look at the file and line indicated by the `warning:` above the error;
the temporary escape is turning `CONFIG_WERROR` off in `make menuconfig`,
or adding `-Wno-error` for warnings you are truly confident about --
but keeping it on for long-term in-tree builds tells you upstream treats warnings as problems to fix,
so prefer reading and understanding the warning before routing around it.

**Not enough disk or memory for a full build -- run `df -h` before starting.** A complete source tree plus object files for a full `.config` usually runs 10-20GB,
and `modules_install` writes a second set of the tree under the system module directory, so the two stack.
Insufficient space shows up as `No space left on device` mid-build,
by which point object files are strewn everywhere;
cleanup goes through `make clean` (keeps the configuration) or `make mrproper` (clears `.config` too -- use with care).
The corresponding discipline on the memory side: do not blindly max out `-j`:
`-j$(nproc)` is usually safe on an 8-core machine with 16GB of RAM,
and more aggressive parallelism may buy you OOM instead of speed.

## References

- The Linux Kernel -- docs.kernel.org -- [process/howto.html](https://docs.kernel.org/process/howto.html) (official guide to the kernel development process)
- In-tree `Documentation/kbuild/` -- the Kbuild/Kconfig build system documentation
- In-tree `Documentation/admin-guide/modules.rst` -- module packaging and load management
- Linux Kernel Module Programming Guide -- [tldp.org/LDP/lkmpg/2.6/html/](https://tldp.org/LDP/lkmpg/2.6/html/) (TLDP keeps revising it to follow new kernels)
- *Linux Device Drivers*, 3rd ed. -- Jonathan Corbet, Alessandro Rubini, Greg Kroah-Hartman, Chapter 2 "Building and Running Modules"
- Bird's Private Recipes (Lin's Linux Administration Guide) -- [linux.vbird.org](https://linux.vbird.org/linux_server/) (kernel compilation chapter)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [tarball](/basic/packages/tarball.md)
- [glossary](/glossary.md)
- [knowledge](/knowledge.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [cross-compile](cross-compile.md)
- [driver-framework](driver-framework.md)
- [source-tree](source-tree.md)
- [tracing-tools](tracing-tools.md)
- [userland](userland.md)
