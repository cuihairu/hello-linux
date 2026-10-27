# Device Driver Framework

A machine has several hundred drivers and hundreds or thousands of device types;
the kernel cannot write a bespoke piece of glue for every combination.
The device model in `drivers/base/` splits the job into three parties --
**how matching works** (bus), **how hardware is described** (device), and **how a driver does its work** (driver) --
and absorbs every combination behind a single match/probe mechanism.
On the application side, everything plugs in through the VFS `file_operations` contract,
none the wiser as to whether the thing on the other end is a network card or `/dev/hello`.
This chapter first explains the three-part model and the three routes into it
(miscdevice / bare cdev / bus driver),
then delivers this part's **second real module** --
the misc character device `hello_chr`:
from source, loading, and reading/writing `/dev/hello`,
to the two-sided comparison of udevadm and strace/ftrace,
running the Section 3 call chain on your own machine.

> Content draws on LDD3 and the kernel's Documentation/driver-api/ (conceptual framework and mechanism detail); see the references at the end.

## What This Part Covers

- What problem each part of the bus/device/driver trio solves, and the division of labor between the misc route and the bus route
- The key fields of `struct miscdevice`, `struct file_operations`, and `struct cdev`, and how they reference each other
- Drawing the key function names of the registration, usage, and matching call chains from memory (`misc_register` / `chrdev_open` / `misc_open` / `really_probe`)
- Completing the whole `hello_chr` character device loop independently, from source to reading and writing `/dev/hello`
- Comparing the same `open` from two sides with strace and ftrace, and explaining what `replace_fops` hands over
- Anticipating six classes of high-frequency failures: missing node, permission denied, API drift, module busy, probe never firing, device number collision

## 1. What the Driver Framework Solves

### 1.1 The Three-Part Model: Breaking Combinatorial Explosion into Three Pieces

Suppose there are 10 bus types and 500 device types;
if the pairing logic were scattered across every driver, the kernel would degenerate into 5000 special cases.
The device model's answer is to fix the participants as three structures, each owning one segment:

- **bus** -- the matching rules and lifecycle hooks. In `struct bus_type` (`include/linux/device/bus.h`, fields verified on 6.12) the core members are exactly `name`, `match`, and `probe`: `match` answers "do this device and driver fit together", `probe` answers "what to do once they fit".
- **device** -- the facts on the hardware side: what it is called, which bus it hangs off, what resources it has.
- **driver** -- the intent on the code side: which devices do I recognize (id table / of_match table), how do I take over once I do (`probe`), and how do I clean up when the device leaves (`remove`).

The interaction of the three resembles a job fair:
the bus is the rulebook, the device is the position, the driver is the candidate,
`match` is the screening, and `probe` is the first day on the job when the work actually changes hands.
When device enumeration or a hotplug event arrives, the kernel walks this chain
(Section 3.3 gives the complete call diagram),
calls `probe()` on a successful match,
and moves on to the next driver on failure --
**no party needs to know the full details of the other two**.

### 1.2 The Application Side: The VFS Contract

User space never touches a driver directly:
`open/read/write` enter the VFS,
the VFS finds `f_op` from the inode,
and everything else lives in the `file_operations` function table.
The kernel offers three routes for a device to "grow" this table:

| Route | Who creates the device node | Where the device number comes from | Applies to |
|------|----------------|--------------|----------|
| miscdevice (this chapter's main line) | handled inside `misc_register` | reuses major number 10, minor assigned dynamically | experiments, small miscellaneous devices, the shortest loop |
| bare cdev | you do `cdev_add` plus the whole class/node ceremony | you grab one with `alloc_chrdev_region` | character devices needing their own major number |
| bus driver | the whole enumeration/match/probe ceremony | comes along with the bus device | real hardware, devices described by a device tree |

All three roads lead to the same place --
they all end up as one `struct file_operations` hung on a device node.
The difference is only "how much of the chores someone else did for you":
the misc route does all the chores for the least code, at the price of a shared major number;
the bus route is the heaviest, but it is designed for "devices can appear and disappear at any time".
Mechanism details on the VFS side are in [VFS and ext4](./vfs-ext4.md);
the full path of one `write(2)` is in [System Call Path](./syscall-path.md);
node ownership and permission control are in [File Permissions](../basic/filesystem/permissions.md).

## 2. Core Data Structures

### 2.1 struct miscdevice: Everything the misc Route Configures

The driver author's entire interface with the misc framework is this one structure
(`include/linux/miscdevice.h`, GPL-2.0):

```c
struct miscdevice {
	int minor;                             /* minor number; 255 = let the framework assign one */
	const char *name;                      /* node name, determines /dev/<name> */
	const struct file_operations *fops;    /* the contract the driver hands to the VFS */
	struct list_head list;                 /* list node for the misc_list registry */
	struct device *parent;                 /* parent device, usually NULL */
	struct device *this_device;            /* back-filled by misc_register: the device the framework built */
	const struct attribute_group **groups;  /* sysfs attribute groups */
	const char *nodename;                  /* overrides the default node name */
	umode_t mode;                          /* node permissions; 0 = devtmpfs default 0600 */
};
```

Of the nine fields, you really only write the first three and a half:
`minor` uses `MISC_DYNAMIC_MINOR` (macro value 255) to let the framework pick the number,
`name` decides what the node is called,
`fops` points at your function table,
and `mode` -- if ordinary users should be able to read and write, set `0666` explicitly
(`misc_devnode` only overrides the default when `mode` is non-zero).
Fields like `list` and `this_device` are filled in by the framework during registration --
`this_device` is the handle `misc_register` back-fills after building the `device` internally,
and it is what you use later to send messages to sysfs.
The `module_misc_device` macro in the same header
(expands to `module_driver(__misc_device, misc_register, misc_deregister)`)
is syntactic sugar for "register on entry, deregister on exit";
this chapter deliberately uses explicit `init/exit` so that the Section 3.1 chain is visible in the code.

### 2.2 struct file_operations: The Contract Between Driver and VFS

```c
struct file_operations {
	struct module *owner;
	loff_t (*llseek)(struct file *, loff_t, int);
	ssize_t (*read)(struct file *, char __user *, size_t, loff_t *);
	ssize_t (*write)(struct file *, const char __user *, size_t, loff_t *);
	long (*unlocked_ioctl)(struct file *, unsigned int, unsigned long);
	int (*open)(struct inode *, struct file *);
	int (*release)(struct inode *, struct file *);
	/* poll/mmap/fsync and the rest omitted; see include/linux/fs.h */
};
```

Four points to grasp when reading this table.
**First**, `owner` must be `THIS_MODULE` --
the module reference count hangs off it,
and it is also what enforces the "module is in use" block at `rmmod` time (Section 6).
**Second**, `open` and `release` are strictly paired, called once per open/close,
while `read/write` may run zero to many times;
do not put cleanup of paired resources inside `read`.
**Third**, on 6.12 `vfs_write` (`fs/read_write.c`) still prefers the legacy `.write` --
`if (file->f_op->write) ret = file->f_op->write(...)`,
falling back to `new_sync_write` for `.write_iter`;
the read side is symmetric.
So this chapter's `hello_write` simply implements `.write`;
the more modern `read_iter/write_iter` interfaces are for cases that need splice or zero-copy.
**Fourth**, a `__user`-annotated buffer is a user-space address and must go through
`copy_from_user/copy_to_user` --
dereferencing it directly oopses outright thanks to address translation under KASLR.

### 2.3 struct cdev and the Three Entrances

The star of the bare-c route (`include/linux/cdev.h`, GPL-2.0):

```c
struct cdev {
	struct kobject kobj;
	struct module *owner;
	const struct file_operations *ops;
	struct list_head list;
	dev_t dev;              /* major + minor number */
	unsigned int count;     /* how many minor numbers it covers */
};
```

`cdev_init` binds the fops and `cdev_add` hangs it into the kernel's `cdev_map` --
only then can the VFS look it up by device number.
The misc route does half of this step for you:
`misc_init` (a `subsys_initcall`, earlier than any module)
calls `register_chrdev(MISC_MAJOR, "misc", &misc_fops)`,
creating one cdev for **the entire major number 10** whose entrance points at `misc_fops` (`.open = misc_open`).
In other words, misc devices do not hold a cdev of their own;
they share one "main entrance", and `misc_open` dispatches you by minor number to the concrete device --
which is exactly why the Section 3.2 chain "passes the baton twice".
The fields of the third structure, `struct bus_type`, are listed in Section 1.1;
its registration, matching, and probing implementation lives in `drivers/base/bus.c` and `drivers/base/dd.c`,
with the call chain in Section 3.3.

## 3. Key Function Call Paths

### 3.1 The Registration Path: misc_register Builds Everything for You

```text
insmod hello_chr.ko
  └─ finit_module(2) system call → kernel module loader → hello_init()
       └─ misc_register(&hello_misc)                 drivers/char/misc.c
            ├─ minor == 255 → misc_minor_alloc()     pick a free minor number
            ├─ scan misc_list to confirm no conflict (a collision returns an error)
            ├─ device_create_with_groups(&misc_class, ...) builds the device
            │    ├─ devtmpfs auto-creates /dev/hello (mode comes from misc_devnode)
            │    └─ uevent emitted → udev applies rules for permissions, aliases
            ├─ back-fill hello_misc.this_device
            └─ list_add(&hello_misc.list, &misc_list) into the registry, for lookup at open time
```

The foundation of the whole misc subsystem --
`misc_class` (`class_register`), the cdev for major number 10 (`register_chrdev`),
and `/proc/misc` (`proc_create_seq`) --
is laid by `misc_init` at the `subsys_initcall` level during kernel boot,
long before any module loads.
All the module plugs in is one entry in the registry;
the framework's node-creating work was already done in that one `device_create_with_groups` line:
**the module needs neither `class_create` nor `device_create`**.
Three pieces of evidence of a successful load:
the `registered` line in `dmesg`,
the minor number from `grep hello /proc/misc`,
and the `/sys/class/misc/hello/` directory.

### 3.2 The Usage Path: How One open Reaches hello_open

```text
cat /dev/hello
  └─ openat(2) → do_sys_openat2 → path_openat
       └─ do_dentry_open()                           fs/open.c
            ├─ f_op = fops_get(inode->i_fop)          a char node = def_chr_fops
            └─ f_op->open() = chrdev_open()           fs/char_dev.c
                 ├─ check the inode->i_cdev cache; on a miss
                 │    kobj_lookup(cdev_map, dev) → the cdev of major 10
                 ├─ fops_get(cdev->ops) → replace_fops(filp, misc_fops)
                 └─ f_op->open() = misc_open()        drivers/char/misc.c
                      ├─ mutex_lock(&misc_mtx), scan misc_list by minor
                      ├─ file->private_data = &hello_misc
                      ├─ replace_fops(filp, hello_fops)   the second handover
                      └─ f_op->open() = hello_open()      your code; returning completes the open
```

Both ends of the chain carry a design trick.
At the start: when a character device node is created, `init_special_inode` already points
`inode->i_fop` at `def_chr_fops` (`fs/inode.c`, `.open = chrdev_open`),
so the VFS does not initially know whether the thing opposite is a misc device, a NIC, or a block device --
it calls through the single "character device" entrance,
and `chrdev_open` performs the first dispatch by table lookup.
At the end: two consecutive `replace_fops` calls inside `misc_open`
swap `filp->f_op` all the way from `def_chr_fops` to `hello_fops` --
**once the handover is complete, subsequent read/write/release go straight to the driver,
and closing no longer passes through `misc_open`**.
Section 5.4 nails this chain down with ftrace;
the `write(2)` side is much simpler:
`vfs_write` calls `hello_write` directly via the Section 2.2 branch,
seamless with the `ksys_write → vfs_write` chain of the
[System Call Path](./syscall-path.md) chapter.

### 3.3 The Matching Path: The Bus Trio's probe Chain

Misc is the direct-connect route where "device and driver live in the same structure";
it has no match step.
The bus route's full chain lives in `drivers/base/bus.c` and `drivers/base/dd.c`:

```text
device joins a bus (enumeration / registration / platform_device coming online)
  ── bus_probe_device(dev)                          drivers/base/bus.c
       ├─ check sp->drivers_autoprobe (if disabled, the whole chain never fires)
       └─ device_initial_probe(dev) → __device_attach(dev, true)
            └─ bus_for_each_drv(...) → __device_attach_driver(drv, dev)
                 ├─ driver_match_device(drv, dev)   calls bus->match (name/of_match_table/acpi/id_table)
                 ├─ no match → move to the next driver
                 └─ match → driver_probe_device → really_probe
                      └─ call_driver_probe:
                           dev->bus->probe(dev) if the bus manages probe itself
                           otherwise drv->probe(dev)   the driver's own probe finally gets called
```

A failed `match` moves on to the next candidate;
a `probe` returning `-EPROBE_DEFER` is suspended and retried --
when the clocks, regulators, or parent devices it depends on are not ready yet
(the normal state of affairs on device-tree systems), the kernel queues it,
and those `deferred probe` messages in `dmesg` are the record of it waiting for someone.
The choice criterion between the two routes is therefore clear:
**experimental devices that involve no real bus go the misc route (this chapter's main line);
real hardware on a bus goes the three-part model** --
but the reading order is the opposite:
build the "registration -- dispatch -- contract" intuition with misc first,
then see how the bus layers the dynamism of match/probe on top of it.

## 4. Source Reading Order (Which File to Read First)

Read in the order "minimal loop → contract definition → the VFS seam → dynamic pairing",
opening each step side by side on elixir (v6.12):

1. **`drivers/char/misc.c`** -- read `misc_register` first: how the three steps of minor number allocation, `device_create_with_groups`, and `list_add` turn a structure into `/dev/hello`; then read `misc_open`'s dispatch-by-number and `misc_init`'s foundation (`subsys_initcall`, `register_chrdev`, `/proc/misc`). This is the smallest "framework does the work for you" example in the entire kernel. [elixir: misc.c](https://elixir.bootlin.com/linux/v6.12/source/drivers/char/misc.c)
2. **`include/linux/miscdevice.h`** -- go back and check the nine fields of Section 2.1: which are configuration, which are back-filled by the framework; also look at the `module_misc_device` and `MODULE_ALIAS_MISCDEV` macro pair. [elixir: miscdevice.h](https://elixir.bootlin.com/linux/v6.12/source/include/linux/miscdevice.h)
3. **`struct file_operations` in `include/linux/fs.h`** -- in a thousand-line header, search to locate this structure first, then read the function pointer signatures member by member: `__user`, `loff_t *ppos`, and the return value semantics are all in the signatures. This is the complete text of the contract between driver author and VFS. [elixir: fs.h](https://elixir.bootlin.com/linux/v6.12/source/include/linux/fs.h)
4. **`fs/char_dev.c`** -- read `def_chr_fops` and `chrdev_open`: the `cdev_map` lookup, `replace_fops`, and the `request_module("char-major-…")` auto-load fallback. This step fills in the seam of "how the VFS finds you". [elixir: char_dev.c](https://elixir.bootlin.com/linux/v6.12/source/fs/char_dev.c)
5. **`drivers/base/dd.c` + `drivers/base/bus.c`** -- finally read `really_probe`, `call_driver_probe` (the either-or of `dev->bus->probe` vs. `drv->probe`), and `bus_probe_device`'s `drivers_autoprobe` switch, against the Section 3.3 chain; at that point `match` and `-EPROBE_DEFER` fall into place on their own. [elixir: dd.c](https://elixir.bootlin.com/linux/v6.12/source/drivers/base/dd.c), [bus.c](https://elixir.bootlin.com/linux/v6.12/source/drivers/base/bus.c)

After reading each function, go back to the ftrace output of Section 5.4 and check yourself:
the source says "what should happen", the trace says "what did happen",
and when the two disagree, trust the trace and fix your understanding --
the discipline this part repeats again and again (see [Tracing Tools](./tracing-tools.md)).

## 5. Hands-On Tracing: The Second Real Module, hello_chr

The earlier chapter's `hello.c` only printed a line at load time;
it proved "you can get into the kernel".
This chapter's `hello_chr` is the second real module --
a character device you can read and write on `/dev/hello` --
and the bar for the loop is raised accordingly:
**after loading there is a node, you can write to it, read it back, and it disappears cleanly after unloading**.
The build environment (headers and toolchain installation for the three families) follows Section 2 of
[Kernel Build and Module Development](./build-and-modules.md) and is not repeated here.

### 5.1 Source and Makefile

Create a clean directory with two files in it.
The module source `hello_chr.c` (compiles as-is):

```c
// hello_chr.c -- this part's second real module: a misc character device
#include <linux/module.h>
#include <linux/miscdevice.h>
#include <linux/fs.h>
#include <linux/uaccess.h>
#include <linux/mutex.h>

#define HELLO_CAP 64              /* buffer limit: 63 bytes + terminating NUL */

static char hello_buf[HELLO_CAP]; /* static buffer on the kernel side */
static size_t hello_len;
static DEFINE_MUTEX(hello_lock);  /* concurrent writes to the same buffer need a mutex */

static int hello_open(struct inode *inode, struct file *file)
{
	pr_info("hello_chr: open (pid %d)\n", current->pid);
	return 0;
}

static int hello_release(struct inode *inode, struct file *file)
{
	pr_info("hello_chr: release (pid %d)\n", current->pid);
	return 0;
}

static ssize_t hello_write(struct file *file, const char __user *buf,
			   size_t count, loff_t *ppos)
{
	if (count >= HELLO_CAP)
		return -E2BIG;                 /* leave room for the NUL; over-long writes are rejected */
	mutex_lock(&hello_lock);
	if (copy_from_user(hello_buf, buf, count)) {
		mutex_unlock(&hello_lock);
		return -EFAULT;                /* user address not readable */
	}
	hello_buf[count] = '\0';
	hello_len = count;
	mutex_unlock(&hello_lock);
	pr_info("hello_chr: wrote %zu bytes\n", count);
	return count;
}

static ssize_t hello_read(struct file *file, char __user *buf,
			  size_t count, loff_t *ppos)
{
	ssize_t ret;

	mutex_lock(&hello_lock);
	if (*ppos >= (loff_t)hello_len) {
		ret = 0;                       /* end of file */
	} else {
		if (count > hello_len - (size_t)*ppos)
			count = hello_len - (size_t)*ppos;
		if (copy_to_user(buf, hello_buf + *ppos, count))
			ret = -EFAULT;
		else {
			*ppos += count;
			ret = count;
		}
	}
	mutex_unlock(&hello_lock);
	return ret;
}

static const struct file_operations hello_fops = {
	.owner		= THIS_MODULE,   /* the rmmod reference count hangs on it */
	.open		= hello_open,
	.read		= hello_read,
	.write		= hello_write,
	.release	= hello_release,
};

static struct miscdevice hello_misc = {
	.minor	= MISC_DYNAMIC_MINOR,  /* let the misc framework assign the minor number */
	.name	= "hello",             /* decides the name /dev/hello */
	.fops	= &hello_fops,
	.mode	= 0666,                /* open to everyone for experiments; tighten in production */
};

static int __init hello_init(void)
{
	int ret = misc_register(&hello_misc);

	if (ret == 0)
		pr_info("hello_chr: registered, /dev/%s\n", hello_misc.name);
	return ret;
}

static void __exit hello_exit(void)
{
	misc_deregister(&hello_misc);
	pr_info("hello_chr: unregistered\n");
}

module_init(hello_init);
module_exit(hello_exit);

MODULE_LICENSE("GPL");
MODULE_AUTHOR("hello-linux");
MODULE_DESCRIPTION("misc character device example");
```

The Makefile is identical to the previous module's:

```makefile
# Makefile -- same directory as hello_chr.c
obj-m += hello_chr.o
```

While reading the code, focus on the three differences from `hello.c`:
one `misc_register` line replaces the bare route's `alloc_chrdev_region`/`cdev_add`/`class_create` trio;
`copy_from_user/copy_to_user` are the only legal channel across the user-space boundary;
and the static buffer guarded by the `mutex` illustrates
"there is no default thread safety in the kernel" --
two processes opening at once, one reading and one writing, is the normal case,
and this lock is the static buffer's only guardian.

### 5.2 The Compile-and-Load Loop

```bash
$ make -C /lib/modules/$(uname -r)/build M=$PWD modules
  CC [M]  hello_chr.o
  MODPOST [M] hello_chr.mod.o
  CC [M]  hello_chr.mod.o
  LD [M]  hello_chr.ko
$ sudo insmod ./hello_chr.ko
$ grep hello /proc/misc
 58 hello                               # the minor differs per machine; /proc/misc is authoritative
$ ls -l /dev/hello
crw-rw-rw- 1 root root 10, 58 Oct  3 10:24 /dev/hello
```

Each of the three lines of evidence has a source:
the `/proc/misc` line comes from the `proc_create_seq("misc", ...)` registered by `misc_init`;
in `ls -l`, the 10 of `10, 58` is `MISC_MAJOR`
(defined in `include/uapi/linux/major.h`; you can reconcile it against the `misc` line under the major number section of `/proc/devices`),
and 58 matches what grep just found;
the `crw-rw-rw-` permissions are the result of `misc_devnode` applying `.mode = 0666`.
Then a full read/write round:

```bash
$ echo -n "hello from userland" > /dev/hello
$ cat /dev/hello
hello from userland
$ dmesg | tail -5
[  520.118337] hello_chr: open (pid 2312)
[  520.118402] hello_chr: wrote 19 bytes
[  520.118451] hello_chr: release (pid 2312)
[  520.119015] hello_chr: open (pid 2313)
[  520.119078] hello_chr: release (pid 2313)
```

The five log lines correspond to two opens:
2312 is `echo` (open → write → release),
2313 is `cat` (open → read twice to EOF → release; the reads themselves print nothing).
Unload:

```bash
$ sudo rmmod hello_chr
$ dmesg | tail -1
[  531.774219] hello_chr: unregistered
$ ls /dev/hello
ls: cannot access '/dev/hello': No such file or directory
```

The node disappears together with `misc_deregister → device_destroy`, and the loop is complete.
If journald has taken over the kernel log so that `dmesg` does not show everything,
read the same ring buffer with `journalctl -k -n 5`;
details in [Log System Administration](../system-management/logging.md).

### 5.3 udevadm: Who Creates the Node, Who Decides the Rules

The module was unloaded at the end of the previous section;
load it again first -- Sections 5.3 and 5.4 need it online throughout:

```bash
$ sudo insmod ./hello_chr.ko
```

There are actually two participants between `insmod` and the appearance of `/dev/hello`:
the kernel-side devtmpfs creates the node directly,
then a uevent wakes user-space udev to apply rules (fix permissions, create aliases).
`udevadm` is the observation window into the latter
(it ships with systemd on all three families; nothing extra to install):

```bash
$ udevadm info -q property -n /dev/hello | grep -E '^(DEVNAME|MAJOR|MINOR|SUBSYSTEM)='
DEVNAME=/dev/hello
MAJOR=10
MINOR=58
SUBSYSTEM=misc
$ cat /sys/class/misc/hello/dev
10:58
```

`SUBSYSTEM=misc` confirms that `device_create_with_groups(&misc_class, ...)` hung it under the misc class,
and `10:58` reconciles with both `/proc/misc` and `ls -l` -- a three-way agreement.
To watch the rules take effect, attach `sudo udevadm monitor --udev --property` in another terminal
and `insmod`/`rmmod` once more;
the `add`/`remove` events and their properties scroll out line by line --
from now on, whenever a "node permissions are wrong" problem shows up,
use these two commands first to separate **the node the kernel created** from **the node udev modified**.

### 5.4 A Two-Sided Comparison: strace Sees the Contract, ftrace Sees the Handover

The same `cat /dev/hello`, sampled once from each observation surface.
The user-space side (strace; tool usage in [Tracing Tools](./tracing-tools.md)):

```bash
$ echo -n "hello from userland" > /dev/hello   # the buffer is empty after reloading; write something first
$ strace -e trace=openat,read,write,close cat /dev/hello 2>&1 \
    | grep -E '/dev/hello|"hello'
openat(AT_FDCWD, "/dev/hello", O_RDONLY) = 3
read(3, "hello from userland", 131072)  = 19
write(1, "hello from userland", 19)     = 19
```

On the strace side there is nothing but system calls and the data being moved --
`chrdev_open`, `misc_open`, and `replace_fops` do not exist from its point of view,
and that is precisely the ceiling of the system call surface.
The kernel side (ftrace, run as root;
the filter admits only `misc_open` and the `hello_*` functions,
because `chrdev_open` is the shared character-device entrance for the whole kernel and would drag in other devices' noise):

```bash
# cd /sys/kernel/tracing
# echo misc_open > set_ftrace_filter          # set the filter before enabling the tracer; leave no global window
# echo hello_open >> set_ftrace_filter
# echo hello_read >> set_ftrace_filter
# echo hello_write >> set_ftrace_filter
# echo hello_release >> set_ftrace_filter
# echo -n "hello from userland" > /dev/hello  # pre-write content so the read side has data (both cleared next step)
# echo function > current_tracer
# echo > trace
# cat /dev/hello                              # traffic one: read twice to EOF
# echo -n "x" > /dev/hello                    # traffic two: overwrite the buffer
# grep -E 'misc_open|hello_' trace
           cat-2452    [001] ....   512.341026: misc_open <-chrdev_open
           cat-2452    [001] ....   512.341031: hello_open <-misc_open
           cat-2452    [001] ....   512.341064: hello_read <-vfs_read
           cat-2452    [001] ....   512.341117: hello_read <-vfs_read      # the second read returns 0
           cat-2452    [001] ....   512.341150: hello_release <-__fput
          bash-2451    [001] ....   513.006404: misc_open <-chrdev_open
          bash-2451    [001] ....   513.006410: hello_open <-misc_open
          bash-2451    [001] ....   513.006412: hello_write <-vfs_write
          bash-2451    [001] ....   513.006501: hello_release <-__fput
```

Only the two surfaces put together give the complete fact:
in the millisecond of strace's `openat`, the kernel walked the three-level dispatch
`chrdev_open` (the `cdev_map` lookup) → `misc_open` (find `hello_misc` by minor) → `hello_open` (your code) --
the `misc_open <-chrdev_open` arrow is the empirical proof of the first hop,
and the caller column is not constrained by the filter:
functions that never entered the filter still appear in the arrow as "where it came from".
`hello_write <-vfs_write` directly corroborates the Section 2.2 branch where `vfs_write` prefers the legacy `.write`;
and among the callers of `hello_release <-__fput` there is **no `misc_open`** --
once the `replace_fops` handover is complete, the close path goes straight to the driver,
and the Section 3.2 "baton" claim closes its loop here.

## 6. Common Pitfalls

**`ls: cannot access '/dev/hello': No such file or directory`.** `insmod` succeeded (dmesg shows `registered`) but there is no node;
nine times out of ten the environment lacks devtmpfs --
containers, chroot, and minimal rootfs environments will not create nodes for you.
Take the minor number with `grep hello /proc/misc` and add one by hand with `sudo mknod /dev/hello c 10 <minor>`;
also run `dmesg | tail` immediately after every load to check the `registered` line,
and confirm `insmod` exited 0 --
if `misc_register` fails (a device number collision, say) the module never stays resident,
and the question of a node does not even arise.

**Opening the device reports `Permission denied`.** When the `mode` field of `miscdevice` is not set,
devtmpfs creates the node with the default 0600 and only root can open it.
Experiment code sets `.mode = 0666` explicitly
(`misc_devnode` only overrides the default when `mode` is non-zero);
production environments should keep 0600/0660 and use udev rules to change the group for authorization.
The full mechanics of ownership and ACLs are in [File Permissions](../basic/filesystem/permissions.md).

**The build reports `too many arguments to function 'class_create'`.** You hand-copied the old-tutorial `class_create(THIS_MODULE, "hello")` --
**since 6.4, `class_create` takes a single argument**, `class_create(const char *name)`
(`include/linux/device/class.h`, verified on 6.12).
The more fundamental fix is not to copy at all:
on the misc route, `misc_register` has already built the class and node via `device_create_with_groups` internally,
so `class_create`/`device_create` appearing in module code is itself the sign you took the wrong route.

**`rmmod: ERROR: Module hello_chr is in use`.** Some process still has `/dev/hello` open --
`.owner = THIS_MODULE` makes every open raise the module's reference count by one,
and the framework refuses to unload code that is still on duty.
Find the occupant with `fuser -v /dev/hello` or `lsof /dev/hello`
(often a `tail -f` someone forgot to close), close it, then unload.
This block is protection rather than obstruction:
without it, the function pointers after unload would dangle inside someone else's `file` structure.

**A bus driver's `probe()` prints nothing.** Walk Section 3.3 stage by stage:
a failed `match` is the number one cause
(the device tree `compatible` string does not line up, or the `id_table` does not cover the device);
the device not being registered on the bus at all comes next;
`/sys/bus/<name>/drivers_autoprobe` written to 0 disables the entire auto-probe chain;
and if `dmesg` floods with `deferred probe` messages, `probe` returned `-EPROBE_DEFER` --
the clocks/regulators it depends on are not ready, the kernel is queueing retries,
and it will complete on its own once the dependencies come online.

**The bare cdev route gets `-EBUSY` when grabbing a device number.** When the range `alloc_chrdev_region` requests overlaps an already registered region it returns `-EBUSY`,
and even dynamic allocation can keep colliding with scattered occupants.
This is exactly why the misc route is the first choice for experiments:
the whole system shares one `MISC_MAJOR` (10),
and its 256 minor numbers are allocated centrally by `misc_minor_alloc` within its own registry --
hand the number-picking responsibility over with `.minor = MISC_DYNAMIC_MINOR`
and you can essentially say goodbye to device number wars.

## 7. Further Reading

- **LDD3 Chapter 3, "Char Drivers"** -- the classic treatment of `cdev`, device number allocation, and the fops skeleton; this chapter's `hello_chr` is its minimal modern form. The book's APIs are dated (`class_create` and node-creation idioms have drifted with versions): read the concepts, compare with this chapter's rewritten form, and do not copy the code directly. The legitimate free copy is provided by LWN: [lwn.net/Kernel/LDD3/](https://lwn.net/Kernel/LDD3/)
- **LDD3 Chapter 6, "Advanced Char Driver Operations"** -- `ioctl`, `llseek`, `poll`, and concurrency control; the next stop if you want to upgrade `hello_chr` with control commands
- **Robert Love, *Linux Kernel Development*, stated honestly** -- the book is organized by subsystem throughout (process scheduling, memory management, concurrency and synchronization) and **has no dedicated device driver chapter**; for the driver framework rely on LDD3 and the in-tree documentation. Those chapters are nonetheless good preparation for reading this chapter's code
- **In-tree `Documentation/driver-api/`** -- the authoritative source for concepts and mechanisms, with three focal points: `basics.rst` (device model terminology), `misc_devices.rst` (the official description of this chapter's protagonist), and the `driver-model/` subdirectory (the three-part model overview)
- **The elixir source browser** -- every file and call chain in this chapter was checked against **v6.12**; before reading any version, select the one matching `uname -r` at [elixir.bootlin.com](https://elixir.bootlin.com/), because with a version mismatch function names appear like phantoms (the same warning appears in the [Tracing Tools](./tracing-tools.md) chapter)

## References

- Linux Device Drivers 3rd (LDD3, free legitimate copy at LWN) -- [lwn.net/Kernel/LDD3/](https://lwn.net/Kernel/LDD3/)
- In-tree device driver API documentation (including misc_devices.rst, basics.rst, driver-model/) -- [elixir.bootlin.com/linux/v6.12/source/Documentation/driver-api/](https://elixir.bootlin.com/linux/v6.12/source/Documentation/driver-api/)
- The kernel driver model overview (Documentation/driver-api/driver-model/) -- [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/source/Documentation/driver-api/driver-model/)
- Key source files (verified against v6.12) -- [drivers/char/misc.c](https://elixir.bootlin.com/linux/v6.12/source/drivers/char/misc.c), [fs/char_dev.c](https://elixir.bootlin.com/linux/v6.12/source/fs/char_dev.c), [drivers/base/dd.c](https://elixir.bootlin.com/linux/v6.12/source/drivers/base/dd.c)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [knowledge](/knowledge.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [cross-compile](cross-compile.md)
