# 设备驱动框架

一台机器上有几百个驱动、成百上千种设备，内核不可能为每种组合写一套胶水代码。`drivers/base/` 的设备模型把这件事拆成三方——**总线怎么匹配**（bus）、**硬件怎么描述**（device）、**驱动怎么干活**（driver），用统一的 match/probe 机制收编所有组合；应用这一侧则通过 VFS 的 `file_operations` 合同接入，根本不关心对面是网卡还是 `/dev/hello`。本章先讲清三元模型与三条接入路线（miscdevice／裸 cdev／总线驱动），再交付本篇**第二个真实模块**——misc 字符设备 `hello_chr`：从源码、加载、`/dev/hello` 读写，到 udevadm 与 strace/ftrace 两面对照，把第 3 节的调用链在自己的机器上跑出来。

> 内容参考自 LDD3 与内核 Documentation/driver-api/（概念框架与机制细节），见文末参考资料。

## 学习目标

- 说清 bus/device/driver 三元模型各解决什么问题，以及 misc 路线与总线路线的分工
- 掌握 `struct miscdevice`、`struct file_operations`、`struct cdev` 三个结构的关键字段与相互引用关系
- 默画注册、使用、匹配三条调用链的关键函数名（`misc_register` / `chrdev_open` / `misc_open` / `really_probe`）
- 独立完成 `hello_chr` 字符设备模块从源码到 `/dev/hello` 读写的完整闭环
- 用 strace 与 ftrace 对**同一次 open** 做两面对照，解释 `replace_fops` 交接了什么
- 预判六类高频故障：节点缺失、权限拒绝、API 版本漂移、模块被占用、probe 不触发、设备号撞车

## 1. 驱动框架解决什么问题

### 1.1 三元模型：把组合爆炸拆成三块

假设有 10 种总线、500 种设备，如果配对逻辑散落在每个驱动里，内核会退化成 5000 个特例。设备模型的答案是把参与方固定成三个结构，各管一段：

- **bus（总线）**——配对规则与生命周期钩子。`struct bus_type`（`include/linux/device/bus.h`，6.12 实测字段）里最核心的就是 `name`、`match`、`probe` 这几个成员：`match` 回答"这对设备与驱动配不配"，`probe` 回答"配上了之后干什么"。
- **device（设备）**——硬件一侧的事实：叫什么、挂在哪条总线上、有什么资源。
- **driver（驱动）**——代码一侧的意志：我认哪些设备（id 表/of_match 表），认下之后怎么接管（`probe`）、设备走人时怎么收摊（`remove`）。

三方的互动像一场招聘会：bus 是规则、device 是岗位、driver 是候选人，`match` 是筛选，`probe` 是入职第一天真正接手工作。设备枚举或热插拔事件到来时，内核遍历这条链（第 3.3 节给出完整调用图），匹配成功即调 `probe()`，失败则换下一个驱动继续——**没有任何一方需要知道其他两方的全部细节**。

### 1.2 应用这一侧：VFS 的合同

用户态永远不直接碰驱动：`open/read/write` 进入 VFS，VFS 按 inode 找到 `f_op`，剩下的全在 `file_operations` 这张函数表里。设备如何"长出"这张表，内核给了三条路线：

| 路线 | 设备节点谁来建 | 设备号怎么来 | 适用场景 |
|------|----------------|--------------|----------|
| miscdevice（本章主线） | `misc_register` 内部代办 | 复用主设备号 10，次号动态分配 | 实验、小型杂项设备，最短闭环 |
| 裸 cdev | 自己 `cdev_add` + class/节点全套 | 自己 `alloc_chrdev_region` 抢 | 需要独立主设备号的字符设备 |
| 总线驱动 | 枚举/match/probe 全套 | 随总线设备走 | 真实硬件、设备树描述的设备 |

三条路线殊途同归——最终都汇成一个 `struct file_operations` 挂到某个设备节点上。差别只在"谁替你干了多少杂活"：misc 路线杂活全包、代码最少，代价是共享主设备号；总线路线最重，但那是为"设备可以随时出现和消失"设计的。VFS 一侧的机制细节见[VFS 与 ext4](./vfs-ext4.md)，一次 `write(2)` 的完整路径见[系统调用路径](./syscall-path.md)，节点的属主与权限控制见[文件权限](../basic/filesystem/permissions.md)。

## 2. 核心数据结构

### 2.1 struct miscdevice：misc 路线的全部配置

驱动作者与 misc 框架的全部接口就是这一个结构（`include/linux/miscdevice.h`，GPL-2.0）：

```c
struct miscdevice {
	int minor;                             /* 次设备号；255 = 交给框架动态分配 */
	const char *name;                      /* 节点名，决定 /dev/<name> */
	const struct file_operations *fops;    /* 驱动交给 VFS 的合同 */
	struct list_head list;                 /* 挂进 misc_list 注册表的链点 */
	struct device *parent;                 /* 父设备，通常 NULL */
	struct device *this_device;            /* misc_register 回填：框架建好的 device */
	const struct attribute_group **groups;  /* sysfs 属性组 */
	const char *nodename;                  /* 覆盖默认节点名 */
	umode_t mode;                          /* 节点权限；0 = devtmpfs 默认 0600 */
};
```

九个字段里真正要写的是前三个半：`minor` 用 `MISC_DYNAMIC_MINOR`（宏值 255）让框架挑号，`name` 决定节点叫什么，`fops` 指向你的函数表，`mode` 想让普通用户能读写就显式给 `0666`（`misc_devnode` 只在 `mode` 非 0 时才覆盖默认值）。`list`、`this_device` 这些字段由框架在注册过程中填——`this_device` 是 `misc_register` 内部建好 `device` 后回填的把手，日后要往 sysfs 送消息就靠它。同头文件里的 `module_misc_device` 宏（展开为 `module_driver(__misc_device, misc_register, misc_deregister)`）是"入口注册、出口注销"的语法糖，本章故意用显式 `init/exit` 写法，让第 3.1 节的链路在代码里可见。

### 2.2 struct file_operations：驱动与 VFS 的合同

```c
struct file_operations {
	struct module *owner;
	loff_t (*llseek)(struct file *, loff_t, int);
	ssize_t (*read)(struct file *, char __user *, size_t, loff_t *);
	ssize_t (*write)(struct file *, const char __user *, size_t, loff_t *);
	long (*unlocked_ioctl)(struct file *, unsigned int, unsigned long);
	int (*open)(struct inode *, struct file *);
	int (*release)(struct inode *, struct file *);
	/* 省略 poll/mmap/fsync 等成员，见 include/linux/fs.h */
};
```

读这张表要抓四个要点。**其一**，`owner` 必须填 `THIS_MODULE`——模块引用计数就挂在这里，`rmmod` 时"模块正被使用"的拦截也由它执行（第 6 节）。**其二**，`open` 与 `release` 严格成对，每次打开/关闭各调一次，`read/write` 则可能零次到多次，别把需要配对的资源清理写进 `read`。**其三**，6.12 的 `vfs_write`（`fs/read_write.c`）仍然优先走旧式 `.write`——`if (file->f_op->write) ret = file->f_op->write(...)`，否则才 `new_sync_write` 转 `.write_iter`；读侧对称。所以本章的 `hello_write` 直接实现 `.write` 即可，`read_iter/write_iter` 那套更现代的接口留给需要 splice/零拷贝的场景。**其四**，`__user` 标注的缓冲区是用户态地址，必须经 `copy_from_user/copy_to_user` 拷贝——直接解引用会因 KASLR 下的地址翻译直接 oops。

### 2.3 struct cdev 与三元入口

裸 c 路线的主角（`include/linux/cdev.h`，GPL-2.0）：

```c
struct cdev {
	struct kobject kobj;
	struct module *owner;
	const struct file_operations *ops;
	struct list_head list;
	dev_t dev;              /* 主 + 次设备号 */
	unsigned int count;     /* 覆盖的次设备号数量 */
};
```

`cdev_init` 绑定 fops、`cdev_add` 把它挂进内核的 `cdev_map`——之后 VFS 才能按设备号查到它。misc 路线替你做了这一步的一半：`misc_init`（`subsys_initcall`，比任何模块都早）调 `register_chrdev(MISC_MAJOR, "misc", &misc_fops)`，为**整个主设备号 10** 建一个 cdev、入口指向 `misc_fops`（`.open = misc_open`）。也就是说 misc 设备不单独持有 cdev，而是共享一个"总入口"，`misc_open` 再按次设备号把你分派到具体设备——这正是第 3.2 节调用链里"接力棒交两次"的原因。三元结构 `struct bus_type` 的字段已在 1.1 节列出，它的注册、匹配、探测实现在 `drivers/base/bus.c` 与 `drivers/base/dd.c`，调用链见 3.3 节。

## 3. 关键函数调用路径

### 3.1 注册路：misc_register 替你建好一切

```text
insmod hello_chr.ko
  └─ finit_module(2) 系统调用 → 内核模块加载器 → hello_init()
       └─ misc_register(&hello_misc)                 drivers/char/misc.c
            ├─ minor == 255 → misc_minor_alloc()     挑一个空闲次设备号
            ├─ 查 misc_list 确认无冲突（撞号返回错误）
            ├─ device_create_with_groups(&misc_class, ...) 建 device
            │    ├─ devtmpfs 自动生成 /dev/hello（mode 来自 misc_devnode）
            │    └─ uevent 发出 → udev 按规则处理权限、别名
            ├─ 回填 hello_misc.this_device
            └─ list_add(&hello_misc.list, &misc_list) 进注册表，供 open 时查找
```

整个 misc 子系统的地基——`misc_class`（`class_register`）、主设备号 10 的 cdev（`register_chrdev`）、`/proc/misc`（`proc_create_seq`）——都由 `misc_init` 在内核启动时的 `subsys_initcall` 层级完成，远早于任何模块加载。模块插进来的只是注册表里的一项，框架建设备节点的活早在 `device_create_with_groups` 一行里替你干完了：**模块内不需要 `class_create`，也不需要 `device_create`**。装载成功的证据有三处：`dmesg` 的 `registered` 行、`grep hello /proc/misc` 的次设备号、`/sys/class/misc/hello/` 目录。

### 3.2 使用路：一次 open 如何落到 hello_open

```text
cat /dev/hello
  └─ openat(2) → do_sys_openat2 → path_openat
       └─ do_dentry_open()                           fs/open.c
            ├─ f_op = fops_get(inode->i_fop)          字符节点 = def_chr_fops
            └─ f_op->open() = chrdev_open()           fs/char_dev.c
                 ├─ 查 inode->i_cdev 缓存；未命中则
                 │    kobj_lookup(cdev_map, dev) → major 10 的那个 cdev
                 ├─ fops_get(cdev->ops) → replace_fops(filp, misc_fops)
                 └─ f_op->open() = misc_open()        drivers/char/misc.c
                      ├─ mutex_lock(&misc_mtx)，按 minor 扫 misc_list
                      ├─ file->private_data = &hello_misc
                      ├─ replace_fops(filp, hello_fops)   第二次交接
                      └─ f_op->open() = hello_open()      你的代码，返回即 open 完成
```

链路的两端各有一个设计巧思。起点：字符设备节点在创建时 `init_special_inode` 就把 `inode->i_fop` 指到 `def_chr_fops`（`fs/inode.c`，`.open = chrdev_open`），所以 VFS 一开始并不知道对面是 misc、网卡还是块设备，它只按"字符设备"这一个入口调用，由 `chrdev_open` 查表完成第一次分派。终点：`misc_open` 里连续两次 `replace_fops` 把 `filp->f_op` 从 `def_chr_fops` 一路换成 `hello_fops`——**交接完成后，后续的 read/write/release 直达驱动，关闭时不会再经过 `misc_open`**。这条链在 5.4 节用 ftrace 一抓就是实锤；`write(2)` 一侧则简单得多：`vfs_write` 按 2.2 节的分支直接调 `hello_write`，与 [系统调用路径](./syscall-path.md) 一章的 `ksys_write → vfs_write` 无缝衔接。

### 3.3 匹配路：总线三元模型的 probe 链

misc 是"设备与驱动长在同一个结构里"的直连路线，没有 match 环节；总线路线的完整链在 `drivers/base/bus.c` 与 `drivers/base/dd.c`：

```text
设备加入总线（枚举/注册/platform_device 上线）
  └─ bus_probe_device(dev)                          drivers/base/bus.c
       ├─ 检查 sp->drivers_autoprobe（关闭则整条链不触发）
       └─ device_initial_probe(dev) → __device_attach(dev, true)
            └─ bus_for_each_drv(...) → __device_attach_driver(drv, dev)
                 ├─ driver_match_device(drv, dev)   调 bus->match（name/of_match_table/acpi/id_table）
                 ├─ 不匹配 → 换下一个驱动
                 └─ 匹配 → driver_probe_device → really_probe
                      └─ call_driver_probe:
                           dev->bus->probe(dev) 若总线自管 probe
                           否则 drv->probe(dev)     驱动自己的 probe 终于被调
```

`match` 失败就换人，`probe` 返回 `-EPROBE_DEFER` 则挂起重试——依赖的时钟、调节器、父设备还没就绪时（设备树系统的常态），内核会把它排进队列，`dmesg` 里那些 `deferred probe` 消息就是它在等人的记录。两条路线的选择标准因此很清楚：**不涉及真实总线的实验设备走 misc（本章主线），挂在总线上的真实硬件走三元模型**——但读代码的顺序相反，先用 misc 建立"注册—分派—合同"的直觉，再看总线如何在此之上叠加 match/probe 的动态性。

## 4. 源码阅读顺序（先读哪个文件）

按"最小闭环 → 合同定义 → VFS 接缝 → 动态配对"的顺序读，每步都在 elixir（v6.12）上点开对照：

1. **`drivers/char/misc.c`** —— 先读 `misc_register`：次设备号分配、`device_create_with_groups`、`list_add` 三步如何把一个结构变成 `/dev/hello`；再读 `misc_open` 的按号分派与 `misc_init` 的地基（`subsys_initcall`、`register_chrdev`、`/proc/misc`）。这是全内核里最小的"框架替你干活"实例。[elixir: misc.c](https://elixir.bootlin.com/linux/v6.12/source/drivers/char/misc.c)
2. **`include/linux/miscdevice.h`** —— 回头对照 2.1 节九个字段：哪个是配置、哪个是框架回填；顺带看 `module_misc_device` 与 `MODULE_ALIAS_MISCDEV` 这对宏。[elixir: miscdevice.h](https://elixir.bootlin.com/linux/v6.12/source/include/linux/miscdevice.h)
3. **`include/linux/fs.h` 中的 `struct file_operations`** —— 千行头文件里先用搜索定位这个结构，逐成员读函数指针签名：`__user`、`loff_t *ppos`、返回值语义都在签名里。这是驱动作者与 VFS 的合同全文。[elixir: fs.h](https://elixir.bootlin.com/linux/v6.12/source/include/linux/fs.h)
4. **`fs/char_dev.c`** —— 读 `def_chr_fops` 与 `chrdev_open`：`cdev_map` 查表、`replace_fops`、`request_module("char-major-…")` 自动装载兜底。这一步补上"VFS 怎么找到你"的接缝。[elixir: char_dev.c](https://elixir.bootlin.com/linux/v6.12/source/fs/char_dev.c)
5. **`drivers/base/dd.c` + `drivers/base/bus.c`** —— 最后读 `really_probe`、`call_driver_probe`（`dev->bus->probe` 与 `drv->probe` 的二选一）和 `bus_probe_device` 的 `drivers_autoprobe` 开关，对照 3.3 节的链；此时再看 `match`/`-EPROBE_DEFER` 就水到渠成。[elixir: dd.c](https://elixir.bootlin.com/linux/v6.12/source/drivers/base/dd.c)、[bus.c](https://elixir.bootlin.com/linux/v6.12/source/drivers/base/bus.c)

每读完一个函数就回到 5.4 节的 ftrace 输出对一次号：源码说"应该发生什么"，trace 说"真的发生了什么"，两边对不上时以 trace 为准去修你的理解——这是本篇反复强调的纪律（见[跟踪工具](./tracing-tools.md)）。

## 5. 实操跟踪：第二个真实模块 hello_chr

上一篇的 `hello.c` 只会在加载时打印一行，它证明"能进内核"；本章的 `hello_chr` 是第二个真实模块——一个能在 `/dev/hello` 上读写的字符设备，闭环标准也升级为：**加载后有节点、能写入、能读回、卸载后干净消失**。编译环境（三系 headers 与工具链安装）沿用[内核编译与模块开发](./build-and-modules.md)第 2 节的方案，此处不重复。

### 5.1 源码与 Makefile

新建干净目录，放入两个文件。模块源码 `hello_chr.c`（全文可直接编译）：

```c
// hello_chr.c —— 本篇第二个真实模块：misc 字符设备
#include <linux/module.h>
#include <linux/miscdevice.h>
#include <linux/fs.h>
#include <linux/uaccess.h>
#include <linux/mutex.h>

#define HELLO_CAP 64              /* 缓冲上限：63 字节 + 结尾 NUL */

static char hello_buf[HELLO_CAP]; /* 内核侧静态缓冲 */
static size_t hello_len;
static DEFINE_MUTEX(hello_lock);  /* 并发写同一缓冲需要互斥 */

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
		return -E2BIG;                 /* 给 NUL 留位，超长直接拒绝 */
	mutex_lock(&hello_lock);
	if (copy_from_user(hello_buf, buf, count)) {
		mutex_unlock(&hello_lock);
		return -EFAULT;                /* 用户地址不可读 */
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
		ret = 0;                       /* 读到末尾，返回 EOF */
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
	.owner		= THIS_MODULE,   /* rmmod 引用计数挂在它身上 */
	.open		= hello_open,
	.read		= hello_read,
	.write		= hello_write,
	.release	= hello_release,
};

static struct miscdevice hello_misc = {
	.minor	= MISC_DYNAMIC_MINOR,  /* 次设备号交给 misc 框架分配 */
	.name	= "hello",             /* 决定 /dev/hello 这个名字 */
	.fops	= &hello_fops,
	.mode	= 0666,                /* 实验开放给所有用户，生产应收紧 */
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

Makefile 与上一模块完全一致：

```makefile
# Makefile —— 与 hello_chr.c 同目录
obj-m += hello_chr.o
```

读代码时把注意力放在三处与 `hello.c` 的差异上：`misc_register` 一行顶掉了裸路线的 `alloc_chrdev_region`/`cdev_add`/`class_create` 三件套；`copy_from_user/copy_to_user` 是跨用户态边界的唯一合法通道；`mutex` 守住的静态缓冲则解释了"内核里没有默认线程安全"这回事——两个进程同时 open、一个在读一个在写是常态，这把锁是这块静态缓冲唯一的护身符。

### 5.2 编译与加载闭环

```bash
$ make -C /lib/modules/$(uname -r)/build M=$PWD modules
  CC [M]  hello_chr.o
  MODPOST [M] hello_chr.mod.o
  CC [M]  hello_chr.mod.o
  LD [M]  hello_chr.ko
$ sudo insmod ./hello_chr.ko
$ grep hello /proc/misc
 58 hello                               # 次设备号各机不同，/proc/misc 是权威
$ ls -l /dev/hello
crw-rw-rw- 1 root root 10, 58 Oct  3 10:24 /dev/hello
```

三行证据各有出处：`/proc/misc` 那行来自 `misc_init` 注册的 `proc_create_seq("misc", ...)`，`ls -l` 里 `10, 58` 的 10 就是 `MISC_MAJOR`（定义于 `include/uapi/linux/major.h`，主设备号段 `/proc/devices` 里 `misc` 一行可对账），58 与刚才 grep 到的一致；`crw-rw-rw-` 的权限则是 `misc_devnode` 应用 `.mode = 0666` 的结果。接着读写一轮：

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

五行日志对应两次打开：2312 是 `echo`（open → write → release），2313 是 `cat`（open → 读两遍到 EOF → release，读本身没有打印）。卸载：

```bash
$ sudo rmmod hello_chr
$ dmesg | tail -1
[  531.774219] hello_chr: unregistered
$ ls /dev/hello
ls: cannot access '/dev/hello': No such file or directory
```

节点随 `misc_deregister → device_destroy` 一起消失，闭环完成。内核日志若被 journald 收编导致 `dmesg` 看不全，用 `journalctl -k -n 5` 读同一个环形缓冲，详见[日志系统管理](../system-management/logging.md)。

### 5.3 udevadm：节点是谁建的、规则谁说了算

上一节收尾时模块已卸载，先重新装上——5.3、5.4 两节全程需要它在线：

```bash
$ sudo insmod ./hello_chr.ko
```

`insmod` 到 `/dev/hello` 出现之间其实有两个参与者：内核侧 devtmpfs 直接建节点，随后 uevent 唤醒用户态 udev 应用规则（改权限、建别名）。`udevadm` 是后者的观察窗（三系均由 systemd 自带，无需另装）：

```bash
$ udevadm info -q property -n /dev/hello | grep -E '^(DEVNAME|MAJOR|MINOR|SUBSYSTEM)='
DEVNAME=/dev/hello
MAJOR=10
MINOR=58
SUBSYSTEM=misc
$ cat /sys/class/misc/hello/dev
10:58
```

`SUBSYSTEM=misc` 印证了 `device_create_with_groups(&misc_class, ...)` 挂在 misc 类下，`10:58` 与 `/proc/misc`、`ls -l` 三方对账一致。想看规则生效的瞬间，另一终端挂上 `sudo udevadm monitor --udev --property` 再 `insmod`/`rmmod` 一次，`add`/`remove` 事件与属性会逐行滚出来——以后凡是"节点权限不对"的问题，都先用这两条命令分清**内核建的节点**与**udev 改过的节点**谁在说话。

### 5.4 两面对照：strace 看合同，ftrace 看交接

同一份 `cat /dev/hello`，两个观察面各截一段。用户态侧（strace，工具用法见[跟踪工具](./tracing-tools.md)）：

```bash
$ echo -n "hello from userland" > /dev/hello   # 重装后缓冲为空，先写入内容
$ strace -e trace=openat,read,write,close cat /dev/hello 2>&1 \
    | grep -E '/dev/hello|"hello'
openat(AT_FDCWD, "/dev/hello", O_RDONLY) = 3
read(3, "hello from userland", 131072)  = 19
write(1, "hello from userland", 19)     = 19
```

strace 这一侧只有系统调用与搬运的数据——`chrdev_open`、`misc_open`、`replace_fops` 在它眼里全部不存在，这正是系统调用面的天花板。内核侧（ftrace，root 操作；filter 只放 `misc_open` 与 `hello_*`，因为 `chrdev_open` 是全内核共享的字符设备入口，放进去会混入别的设备的噪声）：

```bash
# cd /sys/kernel/tracing
# echo misc_open > set_ftrace_filter          # 先设 filter 再开 tracer，不留全局窗口
# echo hello_open >> set_ftrace_filter
# echo hello_read >> set_ftrace_filter
# echo hello_write >> set_ftrace_filter
# echo hello_release >> set_ftrace_filter
# echo -n "hello from userland" > /dev/hello  # 预写内容，读侧才有数据（下一步统一清场）
# echo function > current_tracer
# echo > trace
# cat /dev/hello                              # 流量一：读两遍到 EOF
# echo -n "x" > /dev/hello                    # 流量二：覆写缓冲
# grep -E 'misc_open|hello_' trace
           cat-2452    [001] ....   512.341026: misc_open <-chrdev_open
           cat-2452    [001] ....   512.341031: hello_open <-misc_open
           cat-2452    [001] ....   512.341064: hello_read <-vfs_read
           cat-2452    [001] ....   512.341117: hello_read <-vfs_read      # 第二次读返回 0
           cat-2452    [001] ....   512.341150: hello_release <-__fput
          bash-2451    [001] ....   513.006404: misc_open <-chrdev_open
          bash-2451    [001] ....   513.006410: hello_open <-misc_open
          bash-2451    [001] ....   513.006412: hello_write <-vfs_write
          bash-2451    [001] ....   513.006501: hello_release <-__fput
```

两面拼起来才是完整事实：strace 的 `openat` 那一毫秒里，内核依次走了 `chrdev_open`（查 `cdev_map`）→ `misc_open`（按次号找到 `hello_misc`）→ `hello_open`（你的代码）三级分派——`misc_open <-chrdev_open` 的箭头就是第一跳的实证，调用者列不受 filter 限制，没进 filter 的函数照样会作为"从哪来"出现在箭头里。`hello_write <-vfs_write` 直接印证 2.2 节 `vfs_write` 优先调旧式 `.write` 的分支；而 `hello_release <-__fput` 的调用者里**没有 `misc_open`**——`replace_fops` 交接完成后，关闭路径直达驱动，3.2 节的"接力棒"论断就此闭环。

## 6. 常见坑

**`ls: cannot access '/dev/hello': No such file or directory`。** `insmod` 成功（dmesg 有 `registered`）却没有节点，九成是环境不带 devtmpfs——容器、chroot、极简 rootfs 都不会替你建节点。用 `grep hello /proc/misc` 取次设备号后 `sudo mknod /dev/hello c 10 <次号>` 手工补一个即可用；另外每次装载后立刻 `dmesg | tail` 核对 `registered` 行，并确认 `insmod` 退出码为 0——`misc_register` 失败（设备号冲突等）时模块根本不会驻留，节点更无从谈起。

**打开设备报 `Permission denied`。** `miscdevice` 的 `mode` 字段没设时，devtmpfs 按默认 0600 建节点，只有 root 能开。实验代码显式写 `.mode = 0666`（`misc_devnode` 只在 `mode` 非 0 时才覆盖默认值），生产环境则应保持 0600/0660 并用 udev 规则改属组授权，属主与 ACL 的完整机制见[文件权限](../basic/filesystem/permissions.md)。

**编译报 `too many arguments to function 'class_create'`。** 手抄了老教程的 `class_create(THIS_MODULE, "hello")`——**6.4 起 `class_create` 只剩单参数** `class_create(const char *name)`（`include/linux/device/class.h`，6.12 实测）。更根本的解法是别抄：misc 路线里 `misc_register` 内部已经 `device_create_with_groups` 建好类与节点，模块代码里出现 `class_create`/`device_create` 本身就说明走错了路线。

**`rmmod: ERROR: Module hello_chr is in use`。** 还有进程开着 `/dev/hello`——`.owner = THIS_MODULE` 让每次 open 都给模块引用计数 +1，框架拒绝卸载正在服役的代码。用 `fuser -v /dev/hello` 或 `lsof /dev/hello` 找到占用者（常是忘了关的 `tail -f`），关掉再卸；这个拦截是保护而非刁难，没有它，卸载后的函数指针会悬挂在别人的 `file` 结构里。

**总线驱动的 `probe()` 一行不打印。** 按 3.3 节逐环排查：`match` 没过（设备树 `compatible` 串对不上、`id_table` 没覆盖）是头号原因；设备压根没注册到总线次之；`/sys/bus/<名字>/drivers_autoprobe` 被写成 0 会关掉整条自动探测链；若 `dmesg` 里刷 `deferred probe`，则 `probe` 返回了 `-EPROBE_DEFER`——依赖的时钟/调节器未就绪，内核在排队重试，等依赖上线会自动完成。

**裸 cdev 路线抢设备号报 `-EBUSY`。** `alloc_chrdev_region` 请求的号段与已注册区域重叠时返回 `-EBUSY`，动态申请也可能连续撞上零散占用。这正是 misc 路线成为实验首选的原因：全系统共用一个 `MISC_MAJOR`（10），256 个次设备号由 `misc_minor_alloc` 在自己的注册表内统一分配——写 `.minor = MISC_DYNAMIC_MINOR` 把选号责任交出去，就基本告别设备号战争。

## 7. 延伸资料

- **LDD3 第 3 章「字符设备驱动」（Char Drivers）**——`cdev`、设备号分配、fops 骨架的经典讲法，本章 `hello_chr` 是它的最小现代形态；书中 API 偏旧（`class_create`、节点创建的写法随版本漂移），读概念、对照本章改写法，别直接抄代码。免费正版在 LWN 提供：[lwn.net/Kernel/LDD3/](https://lwn.net/Kernel/LDD3/)
- **LDD3 第 6 章「高级字符驱动操作」（Advanced Char Driver Operations）**——`ioctl`、`llseek`、`poll` 与并发控制；`hello_chr` 想升级出控制命令，下一步就读它
- **《Linux 内核设计与实现》（Robert Love）如实说明**——该书通篇按子系统组织（进程调度、内存管理、并发同步），**没有设备驱动专章**，驱动框架请以 LDD3 与树内文档为准；书中这些章节是读本章代码的良好前置
- **树内 `Documentation/driver-api/`**——概念与机制的权威出处，重点三处：`basics.rst`（设备模型术语）、`misc_devices.rst`（本章主角的官方说明）、`driver-model/` 子目录（三元模型总述）
- **elixir 源码浏览器**——本章全部文件与调用链按 **v6.12** 核对，读任何版本前先在 [elixir.bootlin.com](https://elixir.bootlin.com/) 选定与 `uname -r` 对应的版本，版本错位时函数名会像幻影（[跟踪工具](./tracing-tools.md)一章的同款警告）

## 参考资料

- Linux Device Drivers 3rd（LDD3，LWN 免费正版）— [lwn.net/Kernel/LDD3/](https://lwn.net/Kernel/LDD3/)
- 设备驱动 API 树内文档（含 misc_devices.rst、basics.rst、driver-model/）— [elixir.bootlin.com/linux/v6.12/source/Documentation/driver-api/](https://elixir.bootlin.com/linux/v6.12/source/Documentation/driver-api/)
- 内核驱动模型总述（Documentation/driver-api/driver-model/）— [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/source/Documentation/driver-api/driver-model/)
- 关键源码（v6.12 实测核对）— [drivers/char/misc.c](https://elixir.bootlin.com/linux/v6.12/source/drivers/char/misc.c)、[fs/char_dev.c](https://elixir.bootlin.com/linux/v6.12/source/fs/char_dev.c)、[drivers/base/dd.c](https://elixir.bootlin.com/linux/v6.12/source/drivers/base/dd.c)
