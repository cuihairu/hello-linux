# 内核源码获取与目录结构导读

文档回答"是什么"，源码回答"为什么"与"怎么办"：手册告诉你 `kill -9` 能终止进程，只有源码告诉你信号从 `sys_kill` 走到 `do_send_sig_info` 之后被怎样排队、又在哪个检查点被丢弃。排障到"内核为什么这么做"这一层，内核源码是终极真相——而拿到真相的第一步不是打开编辑器，是先让源码与你机器上跑的内核**对上版本**。本页是源码篇的第一站：官方源码从哪里取、目录地图长什么样、Kconfig/Makefile/.config 这套构建语言怎么读、本地与在线如何索引浏览，最后给一条 30 分钟的跟读路线。读完本页你应该能独立完成"从 `uname -r` 到打开 `init/main.c`"的全过程；编译内核与写模块留到[内核编译与模块开发](./build-and-modules.md)，跟踪观察留到本篇的[跟踪工具](./tracing-tools.md)。

> 内容参考自 kernel.org 官方文档与内核自带 Documentation/（概念框架参考鸟哥的私房菜与《Linux内核设计与实现》，见文末参考资料。

## 学习目标

- 说清文档、书籍与源码三者各自回答什么问题，建立"先固定版本再读码"的纪律
- 用官方 tarball 与 git 两条路获取源码，并能拿到本机发行版对应内核的源码
- 默画内核目录地图，知道每个一级目录该"读什么"、该"跳过什么"
- 读懂 Kconfig/Makefile/.config 三件套的分工，会用运行中内核的配置对照源码
- 搭起本地索引（ctags/cscope）或在线浏览器，会用 git 历史追一个函数的演进
- 跟着 30 分钟路线完成第一次顺读，不迷失在 drivers/ 的万级文件里
- 依据模块化章节顺序（进程调度→内存管理→VFS/ext4→网络栈→中断/时钟→IPC→驱动框架→系统调用）逐章完成源码深入阅读，每章完成"数据结构→关键路径→阅读顺序→实操跟踪→延伸书目"五步走

## 1. 为什么要拿到源码

三类材料回答三个层次的问题：**手册（man）**回答"这个参数是什么"；**书籍**回答"这一子系统的设计取舍是什么"；**源码**回答"这台机器上跑的这行代码为什么这样写"。三者的分工与边界：

| 材料 | 回答的问题 | 时效性 | 什么时候该换下一层 |
|------|-----------|--------|--------------------|
| man/info 手册 | 参数、语义、返回值 | 随软件包更新 | 手册解释不了实际行为时 |
| 书籍/官方文档 | 设计模型、子系统架构 | 写作时版本的快照 | 模型与现象对不上时 |
| 源码 | 逐行事实、版本差异、补丁影响 | 与版本严格绑定 | ——（最终真相） |

实务中真正把人逼到源码面前的，通常是一些文档无解的问题：内核日志里一条看不懂的 warning 究竟由哪条判断触发；两个配置项看起来等价、实测行为却不同；升级内核后某个驱动的行为变了，想确认是哪次提交改的。这类问题的共同点是——答案不在文档的抽象层，而在具体版本的具体代码行里。

读源码还有一条隐性的收益：**它是不会过时的最终文档**。书籍与博客基于写作时的版本，网上搜到的分析文可能是十年前的内核；源码则是你此刻运行版本的逐字节事实。两者对不上时，以源码为准，再回头判断文章过时在哪里——这正是本篇要求"版本纪律"的原因。

### 1.1 版本纪律：先对版本，再翻码

所有读码工作的第一步是回答一个问题：**我读的这份源码，对应我正在跑的内核吗**。发行版内核常带本地补丁（Ubuntu、Debian 的 `-generic`/`-amd64` 后缀即是记号），mainline 版本号相同也可能是不同构建：

```bash
$ uname -r
6.12.7-arch1-1
$ cat /etc/os-release | head -2
PRETTY_NAME="Arch Linux"
```

`uname -r` 给出运行版本，发行版标识（`arch1-1`、`6.1.0-28-amd64`、`5.14.0-427.el9`）告诉你该去哪家仓库取对应源码——第 2.3 节给出三系对照。这条纪律与包管理"先看清依赖再升级"是同一种保守操作观：源码与运行内核对不上时，你会花大量时间在不存在的函数上找证据，而这类错误在事后极难自我察觉——搜不到，到底是版本不对，还是你的理解不对？先把变量隔离掉，再谈推理。

## 2. 获取源码的两条路

### 2.1 官方 tarball：最快的一条路

kernel.org 的发布归档按版本系列组织，`v6.x/` 下是 6.x 系列全部发布版：

```bash
# 下载并解压官方源码（示例：6.12.7）
$ curl -LO https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.12.7.tar.xz
$ tar -xf linux-6.12.7.tar.xz
$ du -sh linux-6.12.7
1.4G    linux-6.12.7
```

压缩包约 140 MB，解压后约 1.4 GB——这个体积值得提前知道：磁盘吃紧或网络受限时，tarball 仍是比完整 git 仓库更经济的选择（见第 7 节）。tarball 是"只读快照"：没有历史、没有分支，适合"读这一个版本"；要看提交历史则必须走 git。

正式使用前顺手做一次完整性校验——kernel.org 为每个发布版提供 `.sign` 签名与哈希清单，`sha256sum -c` 一行就能把"下载损坏"从后续所有诡异现象里排除：

```bash
$ curl -LO https://cdn.kernel.org/pub/linux/kernel/v6.x/sha256sums.asc
$ grep "linux-6.12.7.tar.xz" sha256sums.asc
e0b1d...  linux-6.12.7.tar.xz        # 官方清单里的值
$ sha256sum linux-6.12.7.tar.xz
e0b1d...  linux-6.12.7.tar.xz        # 本地计算值，两处一致即通过
```

这一步的概率收益不高，但它把一个"万一"变成了确定性——与换内存排查故障前先跑 memtest 是同一种纪律：把物理层的可疑点先钉死，后面所有推理才站得稳。

### 2.2 git 克隆：要历史就选它

```bash
# 浅克隆 mainline（torvalds 树），只要最新快照
$ git clone --depth 1 https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git
Cloning into 'linux'...
$ du -sh linux
389M    linux
```

torvalds 树是 mainline（主线），不含任何发行版补丁，也是 LWN、elixir 在线索引的默认对象。除此之外还有一棵值得知道的树：**stable 树**（`git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git`），由维护者在 mainline 基础上持续回移修复——你发行版内核的 `.7`、`.28` 这类小版本号就来自它。追"某个 bug 是哪个版本修的"时，stable 树与它的 `v6.12.y` 系列标签是最快的查证入口。

几个事实先摆清楚：

- **完整历史的仓库是数 GB 量级**——git 历史包含三十年全量提交，纯读码场景用不上；`--depth 1` 拿最新快照即可，将来要追历史再补取（`git fetch --unshallow`，按需付费）。
- **发行版内核在各自仓库**：Debian 的 `linux` 包源、Fedora/RHEL 的 `kernel` 包源、Ubuntu 的 `linux` 源码树，都带着各自的补丁序列。对不上时回第 2.3 节取发行版源。
- **发布标签是天然的锚点**：完整克隆后 `git tag | tail` 可列出 `v6.12.7` 这样的标签，`git checkout v6.12.7` 即回到与 `uname -r` 对应的精确状态——"tarball 与 git 二选一"的真正判断点在于你要不要这把锚。

三条获取路径的取舍合并成一张表：

| 维度 | kernel.org tarball | git 克隆（torvalds/stable） | 发行版源码包 |
|------|--------------------|------------------------------|--------------|
| 体积 | 约 140 MB（解压 1.4 GB） | 浅克隆数百 MB / 完整数 GB | 数十 MB 起 |
| 提交历史 | 无 | 有（`git log`/`blame` 可用） | 补丁序列（ quilt/patchset 形态） |
| 与本机内核一致性 | 版本号一致即可 | mainline/stable，无发行版补丁 | **完全一致（含补丁）** |
| 适合 | 读固定版本、带宽受限 | 追演进、跨版本对比 | 解释本机现象 |

### 2.3 拿"正在跑的内核"对应的源码（三系）

读懂运行版本的最短路径，是从本发行版的包体系取源码，补丁差一并拿到：

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 取源码包 | `apt install linux-source-6.1` | `pkgctl repo clone linux` | 订阅制 `dnf source` 或取 CentOS Stream |
| 产物形态 | `/usr/src/linux-source-6.1.tar.xz` | PKGBUILD + 官方补丁序列 | src.rpm 或 git 树 |
| 适用场景 | 对照本机跑的 Debian 内核 | 对照 Arch 官方内核构建 | 对照 RHEL 内核（打补丁多） |

Debian 的 `linux-source-*` 包把内核源码以 tarball 形式装进 `/usr/src/`，与本机运行版本严格对应；Arch 的内核是官方自建，`pkgctl repo clone linux`（devtools 提供，取代已废弃的 `asp`）拉到的正是 `PKGBUILD` 与补丁队列，`makepkg` 的构建流程即是官方内核的生产流程；RHEL 系内核带大量红帽补丁且源码在订阅源内，未订阅时可用 CentOS Stream 的内核仓库作为近似参照。三系共同的判断标准只有一条：**源码版本 + 补丁集与 `uname -r` 一致，读出来的行为才能解释你屏幕上的现象**。

## 3. 目录地图

源码树约 3 万个文件，但一级目录只有二十来个——先建立"地图感"，再钻细节。下表按"该读什么"而非按字典序组织：

| 目录 | 职责 | 读什么 |
|------|------|--------|
| `init/` | 内核入口与全局初始化 | `main.c` 的 `start_kernel`——全部启动主线的源头 |
| `arch/` | 各 CPU 架构相关代码 | `arch/x86/` 是 x86 入口；与架构无关的代码**不**在此 |
| `kernel/` | 核心子系统（与架构无关部分） | `sched/` 调度、`fork.c` 进程创建、`signal.c` 信号、`time/` 时间 |
| `mm/` | 内存管理 | buddy 分配（`page_alloc.c`）、SLUB（`slub.c`）、缺页（`memory.c`） |
| `fs/` | VFS 与具体文件系统 | VFS 核心在 `fs/*.c`（`namei.c`、`read_write.c`），ext4 在 `fs/ext4/` |
| `net/` | 网络协议栈 | 入口 `socket.c`，协议分层 `core/`、`ipv4/`、`ipv6/` |
| `drivers/` | 设备驱动 | 体量占全树一半以上；**叶子代码**，先看子系统再回这里 |
| `include/` | 对外头文件 | `include/linux/` 放核心结构体定义——`sched.h` 里的 `task_struct` |
| `block/` | 块层 | I/O 合并、调度器、请求队列 |
| `ipc/` | System V IPC | 信号量、消息队列、共享内存的实现 |
| `virt/` | 虚拟化 | KVM 在 `virt/kvm/` |
| `Documentation/` | 内核自带文档 | 官方 .rst，与源码同版本——**最被低估的入口** |
| `scripts/` | 构建工具脚本 | Kconfig 解析器、各类辅助脚本，读码时通常跳过 |

这张表有三个容易踩的理解点。其一，**`kernel/` 与 `drivers/` 是"核心 vs 叶子"的关系**：进程调度、内存分配这些"内核本体"在 `kernel/`、`mm/`，具体硬件的驱动在 `drivers/`——新手直奔 `drivers/` 常常越读越晕，因为叶子依赖主干，顺序反了。其二**VFS 与具体文件系统分两层放**：`fs/` 顶层那批 `.c` 是 VFS 的通用层（打开、读写、路径解析的公共逻辑），`fs/ext4/` 才是 ext4 自己的实现——这个分层在[ VFS 与 ext4 一章](./vfs-ext4.md)展开。其三**`Documentation/` 的价值被严重低估**：内核官方文档随源码同版本发布，`Documentation/filesystems/`、`Documentation/admin-guide/` 里常常直接写着"这个 sysfs 节点的语义"，比搜引擎文章准确得多。

`arch/x86/` 值得单独说一句：它是"x86 架构的内核入口层"——早期汇编启动（`kernel/head_64.S`）、系统调用表（`kernel/syscall_64.tbl`，64 位系统调用的编号即出自此文件）、中断入口（`kernel/entry_64.S` 一带）都在这里，而与架构无关的逻辑回到 `kernel/`。同一个函数名在 `arch/` 与核心目录各有一个实现是常态（编译时按架构择一），读码时先认清手上这份是哪一层，才能在"通用逻辑"与"架构细节"之间正确切换——这也是本篇后续各章讲调用路径时反复出现的分层习惯：**入口在 `arch/`，主干在核心目录，叶子在 `drivers/`**。

### 3.1 一张地图的用法：分层阅读观

目录地图的用途不是背诵，是**给每次阅读定一个层级**。读调度器就钉在 `kernel/sched/`，读页分配就钉在 `mm/`，读 ext4 就钉在 `fs/ext4/`，只在调用链跨层时才跟着跳——比如从 `sys_read`（`fs/read_write.c`）跳到 ext4 的实现（`fs/ext4/inode.c`、`file.c`）。跳层时问自己一句"现在是通用层还是具体实现"，答案变了、预期也要变：通用层的函数看"契约与流程"，具体实现层的函数看"这个实现如何兑现契约"。这条习惯的收益在后期：读得越多，"哪些代码值得精读、哪些只需要知道在哪"的判断越准——地图感最终会内化成一种省力的阅读直觉。

### 3.2 源码模块化章程（按模块讲解）

源码篇不再按字典序罗列，而以**8 个核心模块**为序，每个模块均按固定结构展开：

| 模块 | 关注点 | 章节结构 |
|------|--------|----------|
| 1. 进程管理/调度 | `kernel/sched/`、 `include/linux/sched.h` | 核心数据结构 → 关键函数调用路径 → 源码阅读顺序 → gdb/ftrace 实操 → 参考书目 |
| 2. 内存管理 | `mm/`、 `include/linux/mm.h` | 核心数据结构 → 关键函数调用路径 → 源码阅读顺序 → gdb/ftrace 实操 → 参考书目 |
| 3. VFS 与 ext4 | `fs/`、`fs/ext4/` | 核心数据结构 → 关键函数调用路径 → 源码阅读顺序 → gdb/ftrace 实操 → 参考书目 |
| 4. 网络栈 | `net/`、`net/core/`、`net/ipv4/` | 核心数据结构 → 关键函数调用路径 → 源码阅读顺序 → 实操跟踪 → 参考书目 |
| 5. 中断与时钟 | `kernel/time/`、`include/linux/time.h`、`arch/*/kernel/entry_64.S` | 核心数据结构 → 关键函数调用路径 → 源码阅读顺序 → ftrace/perf 实操 → 参考书目 |
| 6. IPC | `ipc/`、 `include/linux/ipc.h` | 核心数据结构 → 关键函数调用路径 → 源码阅读顺序 → 实操跟踪 → 参考书目 |
| 7. 设备驱动框架 | `drivers/`（子系统入口）、`include/linux/platform_driver.h` | 核心数据结构 → 关键函数调用路径 → 源码阅读顺序 → 硬件实操 → 参考书目 |
| 8. 系统调用 | `include/asm-generic/unistd.h`、`kernel/` 相关入口 | 核心数据结构 → 关键函数调用路径 → 源码阅读顺序 → strace/ftrace/eBPF 实操 → 参考书目 |

每章的阅读顺序均遵循**"先读哪个文件 → 追踪函数流 → 验证实操 → 归纳书目"**的四字真经，避免在 `drivers/` 的叶子代码里迷路。

## 4. 构建体系三件套

### 4.1 Kconfig：配置项的定义语言

`menuconfig` 里看到的每一个配置项，都由源码树中某个 `Kconfig` 文件定义（选项名、类型、依赖、帮助文本）。`kernel/Kconfig`、`mm/Kconfig`、`drivers/*/Kconfig` 逐层展开构成菜单树。读 Kconfig 的实际价值在于：**一个配置项的 `depends on` 与 `select` 就是它的行为边界**——某功能在你机器上"怎么都打开不了"，多半是依赖项没满足，去 Kconfig 里查比翻搜索引擎快：

```text
# fs/ext4/Kconfig（节选，真实文件）
config EXT4_FS
	tristate "The Extended 4 (ext4) filesystem"
	select BUFFER_HEAD
	select CRC32
	help
	  This is the next generation of the ext3 filesystem.
```

对照这张定义卡再回看 `make menuconfig` 的界面，菜单不是凭空来的：`tristate` 对应 y/m/n 三态（与第 4.2 节 `obj-y`/`obj-m` 联动），`select` 是"选中我时自动带上它"的强拉依赖，`depends on` 则是"不满足就连菜单都不显示"的前置条件。会用 `menuconfig` 的 `/` 搜索（输入符号名直接列出定义位置）之后，Kconfig 就从"另一套要学的语言"变成你配置内核的索引页。

### 4.2 Makefile：编成什么，由它决定

每个目录的 `Makefile` 用 `obj-y`（编进内核）与 `obj-m`（编成可加载模块）声明产物：

```make
# fs/ext4/Makefile（节选）
obj-$(CONFIG_EXT4_FS) += ext4.o
ext4-y := balloc.o bitmaps.o ...
```

`obj-$(CONFIG_EXT4_FS)` 把 Kconfig 与 Makefile 缝在一起：`.config` 里 `CONFIG_EXT4_FS=y` 时展开为 `obj-y`（编进内核），`=m` 时展开为 `obj-m`（模块），未设置则为空。理解这一行，你就同时看懂了"配置—构建—加载"三者的联动——也是[编译与模块开发](./build-and-modules.md)里写模块时改 Makefile 的依据。

### 4.3 .config：运行中内核的"答案卷"

`.config` 是 Kconfig 问答的最终答案，两份来源对照着读最有效：

```bash
# 源码树内的配置（make defconfig / make menuconfig 生成）
$ ls -l .config
-rw-r--r-- 1 user user 168K  ... .config

# 运行中内核的配置：路径存在则直接用
$ zcat /boot/config-$(uname -r) | grep EXT4_FS=
CONFIG_EXT4_FS=y
# 或（内核开启 CONFIG_IKCONFIG_PROC 时）
$ zcat /proc/config.gz | grep EXT4_FS=
CONFIG_EXT4_FS=y
```

学习场景的标准姿势是：把运行内核的配置拷成 `.config`（`cp /boot/config-$(uname -r) .config && make olddefconfig`），源码树就与你机器的行为完全同构——读到任何 `#ifdef` 分支，都知道自己该走哪一边。`/proc/config.gz` 不一定存在（取决于发行版是否开 `CONFIG_IKCONFIG_PROC`），不存在时用 `/boot/config-*` 这份磁盘上的事实，两者本质是同一份答案的两个存放处。

## 5. 索引与浏览

### 5.1 本地索引：ctags 与 cscope

读码最频繁的动作是"跳到定义、找所有引用"，本地索引把这个动作从秒级降到毫秒级：

```bash
# ctags：跳定义（vim 中 Ctrl+] 跳转，Ctrl+T 返回）
$ make tags
# cscope：查引用/调用关系（make cscope 生成 cscope.out）
$ make cscope
# 两者生成后都可以在 vim 中 -t 符号 直接打开
$ vim -t start_kernel
```

`make tags`/`make cscope` 是内核顶层 Makefile 自带的目标，产物落在源码树根。ctags 管"定义在哪"，cscope 管"谁引用了它、谁调用了它"——排查"这个函数被谁改了状态"这类问题时，cscope 的引用查询是无可替代的。vim 内置 cscope 客户端，三步接入：

```bash
# 1) 生成索引（源码树根执行）
$ make cscope
# 2) vim 中挂载索引
:cs add cscope.out
# 3) 常用查询
:cs find g schedule      " 查定义
:cs find c schedule      " 查谁调用了它
```

clangd 方案（配合 `compile_commands.json`）对跳转精度更高，但配置成本也高，初学阶段 ctags/cscope 足够。

### 5.2 Grep 的正确姿势

索引之外，两处 grep 有固定套路——找结构体定义去 `include/linux/`，找实现在核心目录（`kernel/`、`mm/`、`fs/`）：

```bash
# 定义在头文件：task_struct 的老家是 include/linux/sched.h
$ grep -rn "struct task_struct {" include/
include/linux/sched.h:737:struct task_struct {
# 实现在核心目录：fork 路径的主实现
$ grep -rn "copy_process" kernel/fork.c
kernel/fork.c:2317:static __latent_entropy struct task_struct *copy_process(
```

只搜 `.c` 漏掉 `include/` 里的内联函数与宏，是"明明搜不到"的头号原因——很多关键逻辑是 `static inline` 写在头文件里的，第 7 节会把这条列进坑单。

### 5.3 在线浏览器：不装环境也能读

- **[Elixir Bootlin](https://elixir.bootlin.com/linux/latest/source)**：内核源码在线索引，支持标识符跳转、交叉引用、版本切换——讨论"6.6 与 6.12 行为差异"时切版本对比尤其好用。
- **[CodeBrowser](https://codebrowser.dev/linux/)**：另一套内核在线浏览，基于 clang 的语义索引，跳转粒度更细。

两者都支持指定版本与标识符直达，是发链接给别人的通用载体；自己深度阅读仍建议本地索引 + 编辑器。

### 5.4 用 git 历史理解设计意图

`git log`/`git blame` 回答的问题比源码更进一步：**这段代码为什么从"那样"变成"这样"**。

```bash
# 追 schedule() 所在文件的历史（按函数范围）
$ git log --oneline -L :schedule:kernel/sched/core.c | head -20
# 追某几行的提交与修复动机
$ git blame -L 100,120 kernel/fork.c
```

`-L :函数名:文件` 是 git 内置的按函数范围追历史的语法；`blame` 给出每一行最后动它的人与提交，再 `git show <hash>` 看提交说明——内核提交说明（commit message）往往写明动机与取舍，是理解"为什么不是另一种写法"的最好材料：

```bash
$ git show --stat 1f9f8b0e2c4d        # 换成 blame 查到的真实哈希
# 输出包含：Subject（一句话改动）
#          Body（动机、取舍、影响面——内核提交说明常写明"为什么不那样做"）
#          文件清单（这次改动波及哪些子系统）
```

一次 `git show` 读三样东西：标题看改了什么，正文看**为什么改**（这是文档永远不给的信息），文件清单看影响面。这一步用到 git 历史，所以第 2.2 节说"要历史就选 git"。

## 6. 第一次浏览的跟跑路线

给一条 30 分钟的最小路线，目标不是读懂，是**建立地图感**。开始前先对版本并确认配置可读：

```bash
$ uname -r
6.12.7-arch1-1
$ zcat /proc/config.gz | head -1 || ls /boot/config-$(uname -r)
# 配置取到手即可，内容第一行不重要
```

第一步（10 分钟）：顺读 `start_kernel` 初始化主线——

```bash
$ grep -n "void __init start_kernel" init/main.c
698:asmlinkage __visible void __init __no_sanitize_address start_kernel(void *cmdline_p)
$ vim -t start_kernel        # 或 vim init/main.c 后跳到该行
```

（行号随版本浮动，以 grep 结果为准——这也是每次动手先搜一次而非照抄文章行号的原因。）

`start_kernel`（`init/main.c`）是与架构无关的内核入口（架构相关的第一跳在 `arch/x86/kernel/head_64.S`，暂不深入）。沿途会看到 `setup_arch`（架构初始化）、`mm_init`（内存子系统起步）、`sched_init`（调度器起步）这些调用——**每个调用点只需读出"它负责什么"即可跳过**，主线末尾 `rest_init` 派生出内核线程，初始化让位给调度器，内核开始调度第一个用户进程。类比读一本书先看目录：此刻的目的是记住"主线从哪进、分了几支"，不是逐页精读。

第二步（10 分钟）：在 `kernel/sched/core.c` 看调度器的立足点——

```bash
$ vim -t sched_init          # 调度器初始化
$ vim -t schedule            # 核心调度函数
```

`sched_init` 做数据结构的引导初始化，`schedule` 是主动让出/抢占后选下一个进程的核心函数——两个点连起来就是"调度器怎么启动、怎么运转"的骨架。此时不需要看懂 CFS/EEVDF 的具体算法，只需要知道**算法住在 `kernel/sched/fair.c`、框架住在 `core.c`**——具体分配与算法的关系，是[进程管理与调度](./process-scheduling.md)一章的正题。

第三步（10 分钟）：用文档校准观感，收束——

```bash
$ less Documentation/process/howto.rst   # 官方"如何参与内核开发"，也是读码指南
$ grep -n "start_kernel" init/main.c | head -3   # 确认自己刚才读的是哪一行
```

走完三步，你手上有四样东西：对上版本的源码、可读的 `.config`、一份索引、一张"入口在 `init/main.c`、调度在 `kernel/sched/`"的地图。后续每读一个子系统，都重复同一套动作——**对版本 → 定入口 → 建索引 → 顺主线**——这正是本篇各章结构（数据结构 → 调用路径 → 阅读顺序 → 实操跟踪）的方法论来源。

## 7. 常见坑

**版本错位——拿着 6.x 的文章在 2.6 源码里找函数（或反之）。** 内核三十年演进改名了大量函数与结构体，网上文章与书籍基于各自年代。症状是"按教程搜什么都搜不到"，而你会误以为是自己理解有问题。处置顺序：`uname -r` 对齐源码版本 → 在线索引切到同版本重搜 → 对不上再查该函数的改名史（`git log --follow -p -S 函数名` 搜提交）。先把变量隔离，再谈推理——与读任何系统一样，先确认观察对象没拿错。

**tarball 与 git 树体积差一个量级——深度克隆全套历史只为读码不值。** 症状是克隆半小时、磁盘占 5 GB 却只打算读代码。处置：读码用 `--depth 1`（几百 MB）；确需历史再 `git fetch --unshallow` 按需补取；只想看某函数历史时，直接去在线浏览器切版本更省。判断标准只有一条：你需不需要 `git log -L` 这把锚，不需要就别付历史的存储价。

**在 drivers/ 迷路——先去子系统核心目录，驱动是叶子。** 症状是打开 `drivers/` 看到二十个子目录、每个上百文件，不知从哪进。根因是顺序反了：驱动依赖内核核心 API（网络驱动要懂 net 核心层，块驱动要懂块层），倒着读必然迷路。处置：从 `kernel/`、`mm/`、`fs/`、`net/` 四个主干进，带着"驱动怎么调用核心层"的问题再回 `drivers/`——先读主干再读叶子，与先看地图再找店铺是同一个道理。

**搜索只搜 .c 漏了 include/linux/ 的内联与宏。** 症状是逻辑明显存在、代码却"搜不到"。根因是大量关键逻辑是 `static inline` 写在头文件、或以宏形式展开的。处置：结构体定义固定去 `include/linux/`，调用与实现去核心目录；grep 时把 `include/` 纳入路径（`grep -rn "函数名" include/ kernel/ mm/`），或干脆用 cscope 的引用查询一次拿到全树——把搜索面补齐，比反复调关键词有效得多。

**menuconfig 里搜不到该配置项——依赖未满足，菜单被整个隐藏。** 症状是按教程翻遍菜单树找不到某个 CONFIG 项，或 `/` 搜索能找到定义却无法设置。根因是 Kconfig 的 `depends on` 前置条件没满足，或该项被其他符号 `select` 强拉。处置：在 `menuconfig` 里对准任何选项按 `?`（help）看依赖链，或直接读对应目录的 `Kconfig`（第 4.1 节）；想强制打开又不想过界面时改 `.config` 后跑 `make olddefconfig` 让它按规则补全——但要接受它可能把依赖项一并改写。这条与"理解行为边界再去改"是同一种思路：先看依赖，再动开关。

**发行版内核与 mainline 有补丁差——对不上时找本发行版源。** 症状是同一版本号的代码在你机器上行为与 elixir 看到的不同。根因是发行版打了补丁（安全修复、功能回移、驱动调优）。处置：回第 2.3 节从本发行版包体系取源（Debian `linux-source-*`、Arch `pkgctl repo clone linux`、RHEL 对应 src），或直接读本发行版的补丁提交。这与"文档要读对应版本的手册"是同一条纪律——源码与运行内核的关系，比源码与版本号的关系更紧。

## 参考资料

- The Linux Kernel Archives — [kernel.org](https://www.kernel.org/)
- 内核官方文档 — [docs.kernel.org](https://docs.kernel.org/)
- 内核源码在线索引（可切版本/标识符跳转） — [elixir.bootlin.com](https://elixir.bootlin.com/linux/latest/source)
- 源码树内文档：`Documentation/process/howto.rst`（如何参与内核开发）、`Documentation/admin-guide/README.rst`
- 《Linux内核设计与实现》（Robert Love）——"从内核出发"相关章节，作为源码阅读方法与内核全景的背景书
- 鸟哥的私房菜 — 开机流程章（`start_kernel` 启动主线的系统视角背景） — [linux.vbird.org](https://linux.vbird.org/)