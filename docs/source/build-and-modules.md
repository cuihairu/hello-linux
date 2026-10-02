# 内核编译与模块开发

"编译内核"四个字把两类分量完全不同的工作盖在了一起：全量编译要动配置、重编上万文件、更换引导项，是"换一个内核"级别的动作，做错会连系统都起不来；模块开发只需要一份与当前运行内核精确匹配的开发头文件（headers），十分钟就能把一个 `.c` 编译成 `.ko` 并加载进正在跑的内核里。本页把最短路径放在最前面——先用发行版 headers 把 hello-world 模块真实跑通（第 3 节给出逐行可抄的完整闭环），获得"我真的能改内核"的正反馈，再进入全量编译安装流程（第 5 节）与虚拟机演练纪律（第 6 节）。三系安装、真实感输出与六类高频故障全部给出对照；源码获取与目录导航见[源码获取与目录导读](./source-tree.md)，加载之后如何观察执行路径见[内核跟踪工具](./tracing-tools.md)。

> 内容参考自内核自带 Documentation/ 与 TLDP 模块编程指南（概念框架参考《Linux Device Drivers》与鸟哥的私房菜），见文末参考资料。

## 学习目标

- 分清全量编译与模块开发两条路径，知道 headers 在链条中的位置
- 三发行版安装内核开发头文件，验证 build 链接就绪
- 独立完成 hello-world 模块从源码、编译、加载到卸载的完整闭环
- 用 module_param 与 modinfo 观察模块参数与元数据
- 掌握 menuconfig / olddefconfig 到 make install 的全量流程与三系引导项差异
- 预判六类高频故障，知道每类先看哪一行

## 1. 编译内核与写模块是两件事

两条路径的目标、成本与风险完全不同，先把这张账算清楚：

| 维度 | 模块开发 | 全量编译 |
|------|----------|----------|
| 前置 | 运行中内核 + 对应 headers | 完整源码树 + 数十 GB 磁盘 |
| 周期 | 编译-加载分钟级 | 配置-编译-安装小时级 |
| 生效方式 | insmod 即刻进内核 | 重启进新内核 |
| 出错代价 | rmmod 卸掉重来 | 新内核起不来要回引导项 |
| 适用 | 写驱动、验证补丁、学习子系统 | 换内核版本、深度定制、研究构建系统 |

分量的差别源自风险模型：模块代码就跑在内核地址空间里，与内核共用同一套页表与特权级，一个空指针解引用不是进程收到 `SIGSEGV`，而是 oops 甚至 panic——整机一起倒（第 6 节展开这条纪律）；而全量编译的失败大多发生在"重启之前"，`make` 报错、磁盘不够、引导项没写上，都有机会从容回退。类比包管理：模块开发像 `pacman -S` 装一个包试效果，出问题卸载即可；全量编译像升级整个发行版基线，要先确认有回滚路径——两者都值得做，但顺序应当是先小后大。

这条顺序也是本页的编排依据：第 2-4 节走通模块闭环，第 5 节才进入全量编译。还有个务实的理由——阅读源码的正反馈来得越早越好，先让代码真的在内核里跑一行 `pr_info`，再回头啃 Kconfig 与 Kbuild，枯燥的部分会好啃得多。

## 2. 环境：安装内核开发头文件

headers 是"当前运行内核的构建树接口"：它包含 `.config` 的展开结果、生成的版本头与 Kbuild 规则，模块编译时挂到它上面完成构建。三系安装对照：

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 头文件（核心） | `apt install linux-headers-$(uname -r)` | `pacman -S linux-headers` | `dnf install kernel-devel kernel-headers` |
| 编译工具链 | `apt install build-essential` | `pacman -S base-devel` | `dnf groupinstall "Development Tools"` |
| 验证 build 链接 | `ls -ld /lib/modules/$(uname -r)/build` | 同左 | 同左 |

RHEL 系的两个包各管一件事：`kernel-devel` 才是模块构建的主体（含 Kbuild 树与 `.config`），`kernel-headers` 是提供给用户态程序编译用的 UAPI 头文件，一起装是惯例。Arch 一行 `linux-headers` 就够，但注意滚动升级后若升级了内核包却没重启，headers 与运行中的内核会短暂错位（第 7 节的 `Invalid module format` 就来自这里）。

验证那条命令的输出应当是一个指向具体版本目录的链接，例如 Debian 上指向 `/usr/src/linux-headers-6.8.0-45-generic`；若是 `No such file or directory`，说明 headers 没装对版本或被升级清掉了——后面 `make` 会在更上游的位置报错，先在这里拦住：

```bash
$ ls -ld /lib/modules/$(uname -r)/build
lrwxrwxrwx 1 root root ... /lib/modules/6.8.0-45-generic/build -> /usr/src/linux-headers-6.8.0-45-generic
```

工具链的三系差异与包管理章节反复出现的对照完全一致：Debian 叫 `build-essential`、Arch 叫 `base-devel`、RHEL 是组包安装，换的是名字，不换"编译 C 程序需要 make 与 gcc"这个事实。

## 3. hello-world 模块完整跑通

### 3.1 源码与 Makefile

新建一个干净目录，放入两个文件。模块源码（`hello.c`）：

```c
// hello.c —— 最小可加载内核模块
#include <linux/init.h>      /* __init / __exit 宏 */
#include <linux/module.h>    /* module_init / MODULE_LICENSE */
#include <linux/kernel.h>    /* pr_info */

static int __init hello_init(void)
{
    pr_info("hello: Hello, world! (%s loaded)\n", KBUILD_MODNAME);
    return 0;                /* 返回非 0 = 加载失败，模块不会留在内核 */
}

static void __exit hello_exit(void)
{
    pr_info("hello: Goodbye.\n");
}

module_init(hello_init);     /* insmod 时执行 */
module_exit(hello_exit);     /* rmmod 时执行 */

MODULE_LICENSE("GPL");
MODULE_AUTHOR("hello-linux");
MODULE_DESCRIPTION("Minimal loadable module example");
```

构建文件（`Makefile`，只有一行规则加注释）：

```makefile
# Makefile —— 与 hello.c 同目录
obj-m += hello.o
```

`obj-m` 表示要构造"可加载模块"（`obj-y` 是编进内核本体的，构建系统语义不同）。真正的构建逻辑由 kbuild 提供，我们从命令行把两件事告诉它：去哪里构建（`-C` 指向 headers 构建树）、源码在哪（`M=$(PWD)`）。一行命令：

```bash
$ make -C /lib/modules/$(uname -r)/build M=$(PWD) modules
  CC [M]  hello.o
  MODPOST [M] hello.mod.o
  CC [M]  hello.mod.o
  LD [M]  hello.ko
$ ls
hello.c  hello.ko  hello.mod.c  hello.mod.o  hello.o  Makefile
```

`-C` 先切入内核构建树（那里的顶层 Makefile 与 Kbuild 规则接管一切），`M=` 再跳回我们的目录处理外部模块——这就是"模块开发不需要内核源码"的机制：构建树在 headers 里，我们只提供一个 `.c`。输出里 `CC [M]` 是编译、`LD [M]` 是链接出 `.ko`、`MODPOST` 是模块后处理（生成 `hello.mod.o` 里的元数据段）；`.cmd` 隐藏文件记录了依赖追踪，删掉增量编译照样能重建。

### 3.2 加载与卸载的闭环

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

这四步就是本页对"跑通"的定义：`lsmod` 里看得到（模块在内核模块表中）、`dmesg` 里看得到加载打印、卸载打印也在——`__init` 段的初始化函数与 `__exit` 段的清理函数各被执行了一次。`lsmod` 那行三列依次是引用计数相关的大小与使用数；`dmesg` 的时间戳是开机秒数，`412` 秒说明这次加载发生在开机约 7 分钟后。调试循环里更顺手的姿势是开着 `sudo dmesg --follow` 另开一个终端，加载与卸载的打印会实时滚进来，省掉每次盲 `tail`——内核环形缓冲有容量上限，旧日志会被顶掉，频繁实验时这个细节决定了你看到的是当前这次还是上一次的残留。

顺带解释 `MODULE_LICENSE("GPL")` 这行为什么不能省：没有它，模块会被以"专有（proprietary）"身份装载，内核日志出现 `module license 'unspecified' taints kernel`，内核被标记 tainted；更实际的损失是 `EXPORT_SYMBOL_GPL` 导出的符号——现代内核里大量子系统接口——对专有模块不可见，`insmod` 直接报 `Unknown symbol`。taint 是个状态位而非故障，`/proc/sys/kernel/tainted` 与 `dmesg` 都能看到它，报障时别人第一眼问的就是这个位。声明 GPL 换来全部符号可见与干净的装载记录，是模块开发的默认纪律。

### 3.3 insmod 之后内核里发生了什么

闭环敲完，值得多问一层：`insmod hello.ko` 到 `Hello, world!` 打印之间，内核侧走了一条什么样的路。`insmod` 这个用户态工具自己几乎不做事——它把 `.ko` 文件读进内存，发起一次 `finit_module(2)` 系统调用，剩下的全是内核模块加载器的活：

```text
insmod 读文件 ─▶ finit_module(2) ─▶ 内核模块加载器
                                    ├─ 解析 ELF 段与元数据（vermagic / 签名 / license）
                                    ├─ 校验：版本指纹不符 → Invalid module format
                                    │        签名校验失败 → Key was rejected
                                    ├─ 符号解析：未解析的引用 → Unknown symbol
                                    ├─ 分配模块内存（core 段常驻，init 段用完即释放）
                                    └─ 调用 module_init 注册的 hello_init()
                                              └─ pr_info 进入内核环形缓冲 → dmesg 可见
```

这张图把第 7 节的高频故障全部对上了号：`Invalid module format` 卡在元数据校验，`Key was rejected` 卡在签名，`Unknown symbol` 卡在符号解析（license 受限或依赖模块没先加载）。`__init` 标记的意义也在这里显形——带这个标记的函数与数据被放进 init 段，`hello_init` 执行完毕后该段内存整体释放，这就是"初始化代码只用一次，用完即弃"在链接层面的实现。理解这条路径后，排障就不再是玄学：报错发生在哪一环，就查哪一环的输入。

`rmmod` 是对称的另一半：内核先确认引用计数归零（别的模块或内核组件还在用就不允许卸载），再调用 `module_exit` 注册的清理函数，然后回收模块内存。这解释了一个纪律问题——模块申请的资源（内存、设备号、定时器）必须在 exit 路径全部归还，否则卸载后就是泄漏，且比用户态泄漏更难回收。写模块时把 init 与 exit 当成一对事务来写，是比记住任何 API 都重要的习惯。

## 4. 模块的进阶姿势

### 4.1 模块参数与 sysfs 暴露

给 `hello.c` 加三行，模块就带上了可调参数。改动全貌如下（与 3.1 节的差异只有注释标出的四处）：

```c
// hello.c —— 带参数的版本
#include <linux/init.h>
#include <linux/module.h>
#include <linux/kernel.h>

static char *name = "kernel";                              /* ← 新增：参数变量与默认值 */
module_param(name, charp, 0644);                           /* ← 新增：charp=字符串，0644=sysfs 权限 */
MODULE_PARM_DESC(name, "Who to greet");                    /* ← 新增：modinfo 可见的描述 */

static int __init hello_init(void)
{
    pr_info("hello: Hello, %s! (%s loaded)\n", name, KBUILD_MODNAME);  /* ← 改用 name */
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

重新编译并带参加载：

```bash
$ sudo insmod hello.ko name="vbird"
$ cat /sys/module/hello/parameters/name
vbird
$ sudo sh -c 'echo -n "linux" > /sys/module/hello/parameters/name'
$ cat /sys/module/hello/parameters/name
linux
```

`module_param` 干了两件事：装载时从 `insmod` 命令行解析参数，同时在 `/sys/module/<模块名>/parameters/` 下生成一个权限为 `0644` 的文件。后者意味着**运行期可写**——但值得说明的是，写 sysfs 改的只是模块里的那个变量，何时生效取决于模块自己怎么用它：本例的打印发生在 `init`（仅加载时执行一次），所以运行期改值不会重打日志，要观察效果得让模块在别的路径读这个变量。这种"改动即刻生效与否"的语义在驱动调参里到处都是，读代码时看到 `module_param` 就要多问一句：这个值被谁、在什么时机消费。

### 4.2 元数据与多文件模块

```bash
$ modinfo hello.ko
filename:       hello.ko
description:    Minimal loadable module example
author:          hello-linux
license:        GPL
srcversion:     3A9F1C2E5B7D8A4C1E0F6B2   # 与源码内容哈希相关
depends:
vermagic:       6.8.0-45-generic SMP preempt mod_unload modversions
```

两个字段排障时最常用：`license` 对应上一节的 taint 问题；`vermagic` 是"这个 `.ko` 是为什么内核编译的"指纹——内核版本、SMP、抢占模型、modversions 等逐项拼成，`insmod` 时严格比对，不匹配就拒绝装载（第 7 节第二条的根因）。

真实驱动很少是单文件。多文件模块在 Makefile 里用 `combo-y` 声明成员：

```makefile
obj-m += combo.o
combo-y := driver.o helper.o util.o   # 三个 .o 链接成一个 combo.ko
```

内核树内大量子系统以这种方式组织（某个目录的 Makefile 一长串 `obj-y`/`obj-m`，见[源码获取与目录导读](./source-tree.md)对 Kbuild 的展开）——读源码时看到目录级 Makefile，映射的就是"这个子系统的构件清单"。

### 4.3 insmod 与 modprobe：手动装载与依赖解析

`insmod` 是"裸装载"：给它一个 `.ko` 路径，它就原样塞给内核，模块依赖的另一个模块没先加载，就在符号解析那一环报 `Unknown symbol`。`modprobe` 是"按名装载"：它查 `/lib/modules/$(uname -r)/modules.dep` 这份依赖索引，把缺的前置模块按拓扑序依次插入，再装目标模块——发行版里 `modprobe` 是日常，`insmod` 是实验台：

```bash
$ sudo modprobe hello          # 按模块名（无 .ko 后缀）装载，自动处理依赖
$ lsmod | grep hello
hello 16384 0
$ sudo modprobe -r hello       # 卸载（等价 rmmod，但同样走依赖检查）
```

自己编译的模块想被 `modprobe` 找到，要放进模块树并重建索引：

```bash
$ sudo cp hello.ko /lib/modules/$(uname -r)/extra/
$ sudo depmod -a               # 重建 modules.dep 索引
$ sudo modprobe hello          # 现在可以按名装载了
```

`depmod -a` 扫描 `/lib/modules/$(uname -r)/` 下所有模块的符号引用与导出，生成 `modules.dep` 等索引文件——理解了这一步，就理解了为什么"拷了 `.ko` 进去 `modprobe` 却说 not found"：索引没重建，`modprobe` 看的还是旧清单。树内模块的树状依赖（比如文件系统驱动依赖的 crc 校验模块）都由这套机制在安装时一次性织好，`lsmod` 输出里的 `Used by` 列就是索引里依赖关系的实时投影。

### 4.4 为什么调试先用 printk

模块开发期的调试手段选择有明确优先级：`printk`（`pr_info`/`pr_debug`）成本最低——改一行、重编译、`insmod`，循环以秒计，且 `dmesg` 是内核视角的地面真相；gdb 挂内核要先解决符号、KGDB 或 QEMU 模拟、串口连接三件事，准备成本比 printk 高两个数量级。纪律是：先用打印把问题范围缩到一个函数以内，再上调试器。`printk` 的日志级别、动态开关（`dynamic_debug`）与 ftrace/eBPF 这些更重的手段，按需在[内核跟踪工具](./tracing-tools.md)里升级。

`pr_debug` 与 `pr_info` 的一个实际差别值得现在知道：`pr_debug` 默认不输出（编译期可整体开关，运行期由 dynamic_debug 按文件、按函数、按行精确点亮）——正式提交的驱动代码里满篇 `pr_debug`，就是为日后现场排查预留的探针，不需要时零开销。写练习模块时用 `pr_info` 保证可见；写"给别人用"的代码时用 `pr_debug` 保证安静，这个分野从第一个模块就养成。

## 5. 全量编译安装

全量编译的目标是产出一个完整内核镜像与它的模块树，流程是"配置 → 编译 → 装模块 → 装内核 → 更新引导"。配置界面依赖 ncurses 开发库，三系对照：

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| menuconfig 界面 | `apt install libncurses-dev` | `pacman -S ncurses` | `dnf install ncurses-devel` |
| 构建依赖（节选） | `flex bison libssl-dev libelf-dev` | `base-devel` 已含 flex/bison | `dnf install flex bison openssl-devel elfutils-libelf-devel` |

配置的正确起点是**当前运行内核的配置**，而不是全新默认值——默认配置缺了你机器需要的驱动，新内核起不来是常事：

```bash
$ cp /boot/config-$(uname -r) .config   # 以当前内核为基线
$ make olddefconfig                     # 面对新选项用默认值补齐，不中断交互
$ make menuconfig                       # 需要时再做定向调整
$ make -j$(nproc)                       # 并行编译
$ sudo make modules_install             # 安装模块树到 /lib/modules/$(KERNELRELEASE)/
$ sudo make install                     # 安装内核镜像并处理引导项
```

`olddefconfig` 是"从已知基线出发"的关键一步：源码版本变了会有新配置项，它按 Kconfig 默认值补齐并落盘，过程不问一个问题。想大幅裁剪可以改用 `make localmodconfig`——以当前 `lsmod` 里加载的模块为清单逐项询问，产出的 `.config` 小得多；代价是清单之外的模块一律不编，插一块没在用的卡可能发现没有驱动，学习场景用它、生产换内核慎用。时间预期诚实地说：`localmodconfig` 加新机器约 1 小时量级，全量配置视硬件 1-4 小时甚至更久，`-j` 的并行度受内存约束（每个编译进程吃数百 MB，内存不足会 OOM 而不是变快）。

`menuconfig` 里有两个高效习惯值得第一天就养成。其一，按 `/` 进入搜索——输入驱动名或芯片型号（如 `e1000`、`NVME`），界面列出所有命中的配置项及其位置，包括依赖条件是否已满足；比在几千项的菜单树里按方向键翻快两个数量级。其二，记住两种编入状态的区别：`*` 编进内核本体（vmlinuz 变大、随时可用），`M` 编为模块（`.ko` 按需装载、体积留给 initramfs 决定）——启动必需的存储与文件系统驱动选 `*` 可以省去 initramfs 的复杂度，可插拔设备的驱动选 `M` 保持灵活，这是每个内核定制者都要做的核心权衡。

改动的配置项如果只涉及一小撮，不必手工在菜单里逐个找：内核树自带配置碎片合并工具，把"想覆盖的项"写进一个小文件，一条命令叠到基线上：

```bash
$ cat my.config
CONFIG_DRM_I915=y
CONFIG_SND_HDA_INTEL=m
$ ./scripts/kconfig/merge_config.sh -m .config my.config
$ make olddefconfig     # 合并后仍要过一遍默认值补齐
```

这套"基线 + 碎片"的思路与发行版的 `/etc/sysctl.d/` 片段管理是同一哲学：完整配置是生成的产物，人只维护差异。碎片文件进版本库、diff 可审阅，比手工维护整份 `.config` 可持续得多——树内的 `kernel/configs/` 目录与各发行版的 config 包，本质都是按这个模式组织的。

`modules_install` 与 `install` 分工明确：前者把模块铺进 `/lib/modules/<新版本>/`，后者放 `vmlinuz`、生成 initramfs 并更新引导项。引导项这一步三系的自动化程度不同，也是与引导管理章节衔接的地方：

- Debian/Ubuntu：`installkernel` 钩子联动 `update-initramfs`，引导项经 `/etc/kernel/postinst.d/` 触发 `update-grub` 自动写入；
- RHEL/CentOS/Rocky：钩子调用 `grubby` 重写默认引导项；
- Arch：无自动钩子，需手动 `grub-mkconfig -o /boot/grub/grub.cfg`——忘了这步的表现是"编译安装都成功，重启却进不来新条目"。

装完值得用 `ls /boot` 验收一次产物，确认三件套齐了再谈重启：

```bash
$ ls -lt /boot | head -6
vmlinuz-6.10.0-custom      # 内核镜像本体（压缩后的可执行体）
System.map-6.10.0-custom   # 内核符号表（排障工具对照地址用，kallsyms 的磁盘备份）
config-6.10.0-custom       # 这份内核的最终配置（.config 的落盘副本）
initramfs-6.10.0-custom.img  # initramfs（名字三系不同：initrd.img-/initramfs-）
```

`config-` 文件还有一层用途：它是"这份内核到底开了什么"的权威答案。日后忘了某个选项是 `y` 还是 `m`，`grep CONFIG_XXX /boot/config-$(uname -r)` 比重新跑 menuconfig 快得多——与 `pacman -Q` 查已装版本、`dpkg -L` 查文件清单一样，都是"先问系统要真相，不要凭记忆"的同一套纪律。

GRUB 生成与菜单结构见[GRUB 引导程序](../basic/boot/grub.md)。最后一条纪律比流程本身更重要：**永远保留旧内核条目**。新内核起不来时，在 GRUB 菜单选旧版本进入，再排新配置的问题；菜单都进不去的极端情况，救援流程（Live 环境 chroot 重建）见[开机流程与引导管理](../system-management/boot-process.md)。这是"先有回滚路径、再做变更"在内核升级上的具体形态。

## 6. 在虚拟机里练

风险模型的差异决定了练习环境的选择：用户态程序崩溃，内核进程管理器收尸，损失限于那个进程；内核态代码出错，轻则 oops 打印后杀掉当前进程，重则 panic 全机冻结，未保存的一切直接丢失，还可能留下损坏的文件系统。所以：

- **全量编译与新内核首启**：必须在可回滚快照的虚拟机（QEMU/KVM、VirtualBox、VMware 任选）里做。做快照 → 装新内核 → 重启验证 → 不对就回滚，这个循环在物理机上做一次失败就是一次重装。
- **模块开发**：同样建议虚拟机。哪怕 hello-world 人畜无害，练的是把 `pr_info` 写错成解引用野指针的那天——内核没有 `ulimit` 兜底。VM 里崩了，回滚快照即可；物理机上崩了，重启后 `dmesg` 还留着 oops 栈，但业务已经断了。
- 顺带的便利：虚拟机里 `insmod` 实验不污染宿主机的 tainted 状态与签名策略，Secure Boot 也容易关（第 7 节第三条），教学环境尤其干净。

以 QEMU 的 qcow2 磁盘为例，快照工作流三条命令就是全部（VirtualBox/VMware 在图形界面里点等价按钮）：

```bash
$ qemu-img snapshot -c before-kernel-test disk.qcow2    # 试验前打快照
$ qemu-system-x86_64 -hda disk.qcow2 ...                # 装新内核、重启验证
$ qemu-img snapshot -a before-kernel-test disk.qcow2   # 不满意，回滚
```

纪律只有一条：**动内核之前快照必须已经存在**。回滚解决的是"新内核起不来"这一类失败；它救不了"没打快照就动手"这种流程性失误——这与数据库"先备份再变更"、包管理"升级前确认可回退"是同一条保守变更观在三个领域的投影。

QEMU 命令行起虚拟机、virtme 类"挂载本机源码直接跑"的玩法属于进阶，见[内核跟踪工具](./tracing-tools.md)的调试环境一节，本页不展开。

## 7. 常见坑

**make 报"没有规则来制作目标"——先确认目录与 M= 参数。** 这条报错九成来自构建入口不对：`Makefile` 或 `hello.c` 不在当前目录（`ls` 一眼的事）；`M=$(PWD)` 的 `$(PWD)` 在 shell 里展开为当前路径，写死成错误路径或在不含 `.c` 的目录里执行，kbuild 找不到源文件就抛这句。改完重新跑同一条 `make -C ... M=$(PWD) modules`，`CC [M]` 出现即恢复正常——注意报错里若提到 `/lib/modules/.../build` 本身不存在，那是第 2 节 headers 没装好，问题根本不在 Makefile。

**insmod 报 `Invalid module format`——vermagic 对不上，八成是"升级了没重启"。** `modinfo -F vermagic hello.ko` 与 `uname -r` 逐字对比：headers 包随升级换了新版本目录，而你还没重启，`uname -r` 报的还是旧版本，编译出的 `.ko` 自然与运行内核指纹不合：

```bash
$ modinfo -F vermagic hello.ko | awk '{print $1}'
6.8.0-45-generic
$ uname -r
6.8.0-47-generic          # ← 两行对不上就是根因，重启归位或用对应版本 headers 重编
```

处置三选一：重启让两者归位（最顺）；改用匹配旧版的 headers 重编；确认不是从别处拷来的 `.ko` 混用了构建环境。`vermagic` 的比对是逐字段的，`SMP`/抢占模型不同同样拒绝装载。

**insmod 报 `Key was rejected by service`——Secure Boot 拒收未签名模块。** 内核开了 Secure Boot 与模块签名强制校验时，没有签名链的 `.ko` 直接被拒。学习场景的最短路径是在虚拟机固件设置里关掉 Secure Boot；真机要继续开着，就得走 MOK（Machine Owner Key）流程：生成密钥、`mokutil --import` 注册、重启在蓝色 MOK 管理界面确认——生产环境签名是资产，学习环境关掉是效率，按场景选，别在两条路中间反复横跳。

**模块加载成功但 dmesg 里没有预期输出——先怀疑级别与检索词，不是怀疑代码没跑。** `pr_info` 是 `KERN_INFO`（级别 6），低于控制台打印级别时屏幕不会滚出这行，但内核环形缓冲里仍然记录着：`dmesg | grep hello` 或 `dmesg -l info | tail` 都能看到。两个常见误判：盯着终端等输出（内核打印去的是内核日志，不是你的 tty）；用 `dmesg | tail` 看到了别处的日志尾部——从 `lsmod` 确认加载成功后，按打印里的关键词 grep 而非盲信 `tail`。

**编译在警告处终止——发行版把 CONFIG_WERROR 打开了。** 新内核有 `CONFIG_WERROR` 配置（部分发行版默认开），任何编译警告都升级为错误中止构建。定位看报错行上方的 `warning:` 指示的文件与代码行；临时出路是在 `make menuconfig` 关掉 `CONFIG_WERROR`，或对确有把握的警告加 `-Wno-error`——但内核树内构建长期开着它，说明上游把警告当问题修，优先读懂警告再绕过。

**全量编译磁盘与内存不够——开工前先 `df -h`。** 完整源码树加全量 `.config` 的对象文件通常要 10-20GB 量级，`modules_install` 再复制一份到 `/lib/modules/`，两头叠加。空间不足的表现是 `make` 中途报 `No space left on device`，此时对象文件已铺一地，清理走 `make clean`（保留配置）或 `make mrproper`（连 `.config` 一起清，慎用）。内存侧的对应纪律是 `-j` 别无脑开满：`-j$(nproc)` 在 16GB 内存的 8 核机器上通常是安全的，更激进的并行度换来的可能不是速度而是 OOM。

## 参考资料

- The Linux Kernel — docs.kernel.org — [process/howto.rst](https://docs.kernel.org/process/howto.rst)（内核开发流程官方指南）
- 内核树内 `Documentation/kbuild/` — Kbuild/Kconfig 构建系统文档
- 内核树内 `Documentation/admin-guide/modules.rst` — 模块打包与装载管理
- Linux Kernel Module Programming Guide — [tldp.org/LDP/lkmpg/2.6/html/](https://tldp.org/LDP/lkmpg/2.6/html/)（TLDP 持续修订，跟新内核走）
- 《Linux Device Drivers》3rd ed. — Jonathan Corbet, Alessandro Rubini, Greg Kroah-Hartman，第 2 章 Building and Running Modules
- 鸟哥的私房菜 — [linux.vbird.org](https://linux.vbird.org/linux_server/)（编译内核章）
