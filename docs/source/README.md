# 源码篇

命令手册告诉你 `write` 怎么用，系统文档告诉你内核提供了什么，但总有一些问题只有源码能回答：为什么 `epoll` 比 `select` 快？`fork` 之后子进程看到的内存和父进程是什么关系？TIME_WAIT 到底是谁在等谁？本篇把这些"为什么"带回它们被实现的地方——Linux 内核源码，以及少量用户态核心组件（coreutils、glibc、systemd）的源码。阅读源码不是内核开发者的专利，而是运维与后端工程师把"经验"升级为"机制"的捷径：排障时多看一层，处置就多一分把握。

> 内容参考自内核自带 Documentation/、kernel.org 官方文档与下列真实书目，见各章节参考资料。

## 本篇怎么组织：按模块，每章一条完整路径

源码篇不按"教程章"组织，而是按**内核模块**组织——进程管理/调度、内存管理、VFS 与 ext4、网络栈、中断与时钟、IPC、设备驱动框架、系统调用，一个模块一章。每章遵循统一的结构，读完任何一章都经历同一条完整路径：

| 结构段 | 回答的问题 |
|--------|-----------|
| 核心数据结构 | 这个模块的"主角"是谁（`task_struct`、`struct page`、`struct file`……），长什么样、藏在哪个头文件 |
| 关键函数调用路径 | 一件事在内核里怎么走完（从入口函数到出口，逐级函数名） |
| 源码阅读顺序 | 先读哪个文件、再读哪个文件，避免在 3000 万行代码里迷路 |
| 实操跟踪 | 用 strace/ftrace/bpftrace/gdb 真实跟踪一条路径，把静态代码变成动态现场 |
| 延伸资料 | 对应书目的相关章节——书目按实标注，版本对不上的地方明确说明 |

模块章之前有三章前置：拿到源码并读懂目录（[源码获取与目录导读](./source-tree.md)）、编译内核并跑通第一个模块（[内核编译与模块开发](./build-and-modules.md)）、掌握跟踪工具箱（[跟踪工具](./tracing-tools.md)）。三者就绪后，按任何顺序进入模块章都不会迷路；建议顺序仍是自上而下——系统调用是所有模块的入口，进程与内存是所有模块的地基，VFS 与网络栈是业务工程师最高频的两块。

## 阅读书目：真实清单与使用方式

本篇在延伸资料中引用的书目全部真实存在，且各自定位不同，混着用比单读一本好：

| 书目 | 作者 | 基线版本 | 适合什么时候读 |
|------|------|---------|---------------|
| 《Linux内核设计与实现》 | Robert Love | 2.6 | 每个模块的第一本：篇幅短、给框架，先读它再进源码 |
| 《深入理解Linux内核》 | Bovet & Cesati | 2.6 | 框架确立后补细节地图：数据结构关系图密集 |
| 《Linux内核源代码情景分析》 | 毛德操、胡希明 | 2.4 | 学"情景分析法"：沿一次系统调用/中断把内核走穿 |
| 《深入Linux内核架构》 | Wolfgang Mauerer | 2.6.24 | 当参考手册查：某模块数据结构字段级细节 |
| 《深入理解Linux虚拟内存管理》 | Mel Gorman | 2.6 | 仅内存管理模块： buddy/slab 最深入的单行本 |
| 《Linux Device Drivers》第三版 | Corbet、Rubini、Kroah-Hartman | 2.6 | 仅设备驱动模块：驱动写作经典（英文原版 LDD3 可免费在线阅读） |

一个必须先说清的事实：以上书目基线都在 2.4-2.6 时代，而本篇源码跟读基于 6.x。十余年间调度器从 O(n) 到 CFS 再到 EEVDF、锁与内存管理大面积重写，**书里的机制思想大多仍然成立，但具体函数名、文件位置、数据结构字段常常已对不上**。因此本篇的纪律是：概念与思想引书，函数与行号查现源码（[elixir.bootlin.com](https://elixir.bootlin.com/linux/latest/source) 在线交叉引用是日常工具），两者冲突时以现源码为准并在文中标注版本差异。这正是"情景分析"方法在今天的用法——方法不老，代码会老。

## 环境准备

- 任意主流发行版（Debian/Ubuntu、Arch、RHEL/Rocky 三系命令在本篇对照给出），磁盘预留 20GB 以上
- 内核 headers 与编译工具链（[第二章](./build-and-modules.md)给出三系安装对照）
- **强烈建议在虚拟机里做所有实验**：内核模块的错误是整机 panic 而非进程崩溃，快照回滚是唯一的后悔药
- 跟踪实验（ftrace/bpftrace）在物理机亦可安全进行，BPF 验证器保证探针不致死机

## 与其他篇的关系

- [命令篇 · 进程管理](../commands/system/process.md)与[硬件篇 · 内存](../hardware/memory.md)给出使用者视角的概念，本篇给出实现视角的机制，两相对照理解最深
- 系统管理篇的 [systemd 服务与程序管理](../system-management/services-systemd.md)、[日志系统管理](../system-management/logging.md)讲管理面，本篇 [用户态源码选读](./userland.md)会掀开 systemd 的一角
- 网络篇（[TCP/IP 要点](../network/tcpip-essentials.md)）讲协议行为，本篇 [网络栈](./network-stack.md)讲这些行为在哪几行代码里发生

## 章节导读

| 章节 | 内容 | 阅读建议 |
|------|------|---------|
| [源码获取与目录导读](./source-tree.md) | kernel.org/git 获取源码、目录地图、Kbuild 体系、在线浏览 | 本篇第 1 步 |
| [内核编译与模块开发](./build-and-modules.md) | menuconfig、编译安装、hello-world 模块真实跑通 | 本篇第 2 步，正反馈最快的入口 |
| [交叉编译与嵌入式](./cross-compile.md) | 交叉工具链、ARCH/CROSS_COMPILE、设备树、BusyBox rootfs、U-Boot 与 QEMU 验证 | 要把内核做给非 x86 架构的人 |
| [跟踪工具](./tracing-tools.md) | strace/ftrace/bpftrace/gdb+QEMU 四层观察体系 | 本篇第 3 步，模块章的实操都靠它 |
| [系统调用](./syscall-path.md) | 一次 write() 从用户态到内核的全程 | 模块章起点：所有路径的入口 |
| [进程管理/调度](./process-scheduling.md) | task_struct、fork 路径、CFS→EEVDF、上下文切换 | 核心模块 |
| [内存管理](./memory-management.md) | buddy/slab、缺页路径、mmap、写时复制 | 核心模块 |
| [VFS 与 ext4](./vfs-ext4.md) | 五大对象、open/read 调用链、page cache | 核心模块，业务工程师最高频 |
| [网络栈](./network-stack.md) | 收发包两条路径、sock 结构、softirq | 核心模块，与网络篇对照读 |
| [中断与时钟](./interrupt-timers.md) | irq_desc、softirq/workqueue、hrtimer | 理解"内核什么时候有机会干活" |
| [设备驱动框架](./driver-framework.md) | 总线-设备-驱动模型、cdev、第二个真实模块 | 想写驱动必读 |
| [IPC](./ipc.md) | 信号、管道、System V/POSIX 机制 | 服务的进程间协作原理 |
| [用户态源码选读](./userland.md) | coreutils、glibc 的 syscall 包装、systemd 选段 | 收官：内核之外的源码世界 |

## 参考资料

- Linux 内核档案 — [kernel.org](https://www.kernel.org/)
- 内核官方文档 — [docs.kernel.org](https://docs.kernel.org/)
- 在线源码交叉引用 — [elixir.bootlin.com](https://elixir.bootlin.com/linux/latest/source)
- Robert Love.《Linux内核设计与实现》（Linux Kernel Development, 3rd ed.）
- Daniel P. Bovet & Marco Cesati.《深入理解Linux内核》（Understanding the Linux Kernel, 3rd ed.）
- 毛德操、胡希明.《Linux内核源代码情景分析》
- Wolfgang Mauerer.《深入Linux内核架构》（Professional Linux Kernel Architecture）
- Mel Gorman.《深入理解Linux虚拟内存管理》（Understanding the Linux Virtual Memory Manager）
- Jonathan Corbet, Alessandro Rubini, Greg Kroah-Hartman.《Linux Device Drivers》3rd ed. — [lwn.net/Kernel/LDD3](https://lwn.net/Kernel/LDD3/)
