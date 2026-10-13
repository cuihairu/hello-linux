# 术语表（Glossary）

本仓核心术语的中英对照、一句话定义、权威出处与相关页。出处均为官方文档、规范（RFC）、官方手册或权威百科；
相关页互链见各条目末尾。维护口径：新增条目必须给出可点的权威出处；查不到就写「未找到权威出处（待核）」，不得凭印象编造链接。

## 文件系统与 VFS

### VFS（Virtual File System，虚拟文件系统）
内核提供的抽象文件接口层：以 super_block/inode/dentry/file/address_space 五对象加函数指针表实现多态，使普通文件、管道、设备、伪文件走同一组系统调用。
**出处**：[Linux 内核文档 · Virtual File System](https://www.kernel.org/doc/html/latest/filesystems/vfs.html)
**相关页**：[VFS 与 ext4](/source/vfs-ext4.md)、[文件系统概念](/basic/filesystem/concept.md)

### inode（索引节点）
文件系统对象的元数据载体：大小、权限、时间戳、数据块位置，按 inode 号在文件系统内唯一；名字不属于 inode 而属于 dentry。
**出处**：[man7 · inode(7)](https://man7.org/linux/man-pages/man7/inode.7.html)
**相关页**：[VFS 与 ext4](/source/vfs-ext4.md)、[文件系统概念](/basic/filesystem/concept.md)

### dentry（目录项，Directory Entry）
路径名组件到 inode 的映射缓存：全部 dentry 构成 dcache，路径解析先查缓存、未命中才走具体文件系统的 lookup 回调。
**出处**：[Wikipedia · Dentry](https://en.wikipedia.org/wiki/Dentry)
**相关页**：[VFS 与 ext4](/source/vfs-ext4.md)

### super_block（超级块）
一个已挂载文件系统实例的全局状态：块大小、inode 总数、脏页回写水位，由具体文件系统在挂载时填充。
**出处**：[Linux 内核文档 · Virtual File System](https://www.kernel.org/doc/html/latest/filesystems/vfs.html)
**相关页**：[VFS 与 ext4](/source/vfs-ext4.md)

### page cache（页缓存）
文件页的内存缓存账本（address_space 按页索引组织）：读命中即免磁盘 I/O，写先落缓存再由回写线程刷盘，是「第二次读快得多」的根源。
**出处**：[Wikipedia · Page cache](https://en.wikipedia.org/wiki/Page_cache)
**相关页**：[VFS 与 ext4](/source/vfs-ext4.md)、[性能优化](/system-management/performance.md)

### ext4（Fourth Extended Filesystem）
Linux 主流日志文件系统：以 extent 树描述文件块映射，配 jbd2 日志保证元数据一致性，支持延迟分配以减少碎片。
**出处**：[ext4 官方 wiki](https://ext4.wiki.kernel.org/)
**相关页**：[VFS 与 ext4](/source/vfs-ext4.md)

### extent 树
ext4 描述「文件逻辑块区间 → 磁盘物理块区间」的树状结构，取代 ext2/3 的间接块表；ext4_map_blocks 沿树二分完成偏移翻译。
**出处**：[ext4 官方 wiki](https://ext4.wiki.kernel.org/)
**相关页**：[VFS 与 ext4](/source/vfs-ext4.md)

### 延迟分配（Delayed Allocation）
ext4 的写策略：数据先进页缓存，磁盘块推迟到关闭/回写时才分配，以看到更完整的连续块图、减少碎片。
**出处**：[ext4 官方 wiki](https://ext4.wiki.kernel.org/)
**相关页**：[VFS 与 ext4](/source/vfs-ext4.md)

### JBD2（Journaling Block Device，日志）
ext4 的日志层：元数据变更先记日志再落盘，崩溃后重放保证一致性；data=ordered/writeback/journal 三档控制数据是否也进日志。
**出处**：[ext4 官方 wiki](https://ext4.wiki.kernel.org/)
**相关页**：[VFS 与 ext4](/source/vfs-ext4.md)

### procfs（/proc 伪文件系统）
内核数据结构的即时快照接口：读即查询（如 /proc/meminfo、/proc/slabinfo），由 seq_file 等机制现场拼装文本，无磁盘块。
**出处**：[Linux 内核文档 · procfs](https://www.kernel.org/doc/html/latest/filesystems/proc.html)
**相关页**：[VFS 与 ext4](/source/vfs-ext4.md)、[用户态源码选读](/source/userland.md)

### sysfs（/sys 伪文件系统）
内核设备、驱动、总线对象的统一视图，与 kobject 模型对应，是用户态了解与配置内核对象的窗口。
**出处**：[Linux 内核文档 · sysfs](https://www.kernel.org/doc/html/latest/filesystems/sysfs.html)
**相关页**：[VFS 与 ext4](/source/vfs-ext4.md)

### 硬链接（Hard Link）
多个 dentry 指向同一个 inode：inode->i_nlink 计数加一，rm 只删名字，计数归零才释放 inode。
**出处**：[man7 · inode(7)](https://man7.org/linux/man-pages/man7/inode.7.html)
**相关页**：[文件系统概念](/basic/filesystem/concept.md)

### 符号链接（Symbolic Link）
存目标路径字符串的特殊文件：路径解析时跟随，可跨文件系统，与硬链接的「共享 inode」本质不同。
**出处**：[Wikipedia · Symbolic link](https://en.wikipedia.org/wiki/Symbolic_link)
**相关页**：[文件系统概念](/basic/filesystem/concept.md)

### 挂载（Mount）
把文件系统的 super_block 接入全局 VFS 树、使路径可访问的动作；data=ordered 等日志模式是挂载属性，改完须重新挂载。
**出处**：[man7 · mount(2)](https://man7.org/linux/man-pages/man2/mount.2.html)
**相关页**：[文件系统概念](/basic/filesystem/concept.md)、[VFS 与 ext4](/source/vfs-ext4.md)

## 内核与系统调用

### 系统调用（System Call）
用户态进入内核的受控入口：经系统调用表分派到内核实现，strace/ftrace 可观察其调用面与纵深。
**出处**：[man7 · syscall(2)](https://man7.org/linux/man-pages/man2/syscall.2.html)
**相关页**：[syscall-path](/source/syscall-path.md)、[用户态源码选读](/source/userland.md)

### 文件描述符（File Descriptor）
进程打开文件/管道/套接字后的内核句柄：指向 struct file，记录读游标与操作表；fork 后父子共享同一 file 结构。
**出处**：[Wikipedia · File descriptor](https://en.wikipedia.org/wiki/File_descriptor)
**相关页**：[IPC](/source/ipc.md)、[用户态源码选读](/source/userland.md)

### 进程（Process）
资源与执行上下文的抽象：独立地址空间、文件描述符表与调度实体，由调度器在 CPU 间切换。
**出处**：[Wikipedia · Process (computing)](https://en.wikipedia.org/wiki/Process_(computing))
**相关页**：[进程管理与调度](/source/process-scheduling.md)、[进程管理](/commands/system/process.md)

### CFS（Completely Fair Scheduler，完全公平调度器）
Linux 默认 CPU 调度器：以虚拟运行时间记账、红黑树选最左节点运行，目标是按比例公平分配 CPU。
**出处**：[Linux 内核文档 · CFS 设计](https://www.kernel.org/doc/html/latest/scheduler/sched-design-CFS.html)
**相关页**：[进程管理与调度](/source/process-scheduling.md)

### 中断（Interrupt）
硬件/定时器异步通知内核的机制：经中断描述符表分派到处理函数，分顶半部与底半部，是设备驱动与时钟的根基。
**出处**：[Linux 内核文档 · 通用 IRQ](https://www.kernel.org/doc/html/latest/core-api/genericirq.html)
**相关页**：[中断与时钟](/source/interrupt-timers.md)

### 内核模块（Kernel Module）
可动态加载进内核的代码单元（.ko）：经 insmod/modprobe 注册，无需重启即可扩展内核功能。
**出处**：[Linux 内核文档 · 模块构建](https://www.kernel.org/doc/html/latest/kbuild/modules.html)
**相关页**：[内核编译与模块开发](/source/build-and-modules.md)

### 设备驱动（Device Driver）
内核与硬件之间的适配层：向 VFS/块层/网络栈注册操作表，把设备能力暴露为文件接口。
**出处**：[Linux 内核文档 · 驱动 API](https://www.kernel.org/doc/html/latest/driver-api/index.html)
**相关页**：[设备驱动框架](/source/driver-framework.md)

### 块层（Block Layer）
文件系统与磁盘驱动之间的中间层：合并/排序 I/O 请求、I/O 调度、向磁盘提交 BIO。
**出处**：[Linux 内核文档 · 块层](https://www.kernel.org/doc/html/latest/block/index.html)
**相关页**：[VFS 与 ext4](/source/vfs-ext4.md)

### 网络栈（Network Stack）
内核实现 TCP/IP 协议族的层次结构：套接字层 → TCP/UDP → IP → 链路层，逐层封装与分派。
**出处**：[Linux 内核文档 · 网络](https://www.kernel.org/doc/html/latest/networking/index.html)
**相关页**：[网络栈](/source/network-stack.md)、[TCP/IP 要点](/network/tcpip-essentials.md)

### TCP/IP 协议族（Internet Protocol Suite）
互联网基础协议集合：IP 寻址路由、TCP 可靠流、UDP 数据报、DNS/DHCP 等应用支撑协议。
**出处**：[Wikipedia · Internet protocol suite](https://en.wikipedia.org/wiki/Internet_protocol_suite)
**相关页**：[TCP/IP 要点](/network/tcpip-essentials.md)、[网络基础](/network/basics.md)

### 管道（Pipe）与 IPC
进程间通信机制：管道提供单向字节流（man pipe(7)），与信号、共享内存、套接字等构成 IPC 家族。
**出处**：[man7 · pipe(7)](https://man7.org/linux/man-pages/man7/pipe.7.html)
**相关页**：[IPC](/source/ipc.md)

### 信号（Signal）
内核向进程发送的异步事件通知：默认动作/捕获/忽略三态，kill 命令与 signal(7) 语义对应。
**出处**：[man7 · signal(7)](https://man7.org/linux/man-pages/man7/signal.7.html)
**相关页**：[IPC](/source/ipc.md)

### strace（系统调用跟踪器）
跟踪进程系统调用与信号的工具：-e trace=openat,read 过滤、-c 统计，是观察程序行为的第一手工具。
**出处**：[man7 · strace(1)](https://man7.org/linux/man-pages/man1/strace.1.html)
**相关页**：[跟踪工具](/source/tracing-tools.md)

### ftrace / bpftrace（内核函数级跟踪）
ftrace 是内核内置的函数跟踪框架（function_graph 画调用树）；bpftrace 以 eBPF 在内核态聚合统计，一行程序完成按进程计数等观测。
**出处**：[Linux 内核文档 · ftrace](https://www.kernel.org/doc/html/latest/trace/ftrace.html)、[bpftrace 官方仓库](https://github.com/bpftrace/bpftrace)
**相关页**：[跟踪工具](/source/tracing-tools.md)

## 系统管理与服务

### systemd 与服务管理
现代 Linux 的 init 系统与服务管理器：以 unit 文件声明服务/挂载/定时器，统一启停、依赖与日志（journald）。
**出处**：[systemd.io 官方站](https://systemd.io/)
**相关页**：[systemd 服务与程序管理](/system-management/services-systemd.md)、[系统服务管理](/basic/services/system_services.md)

### 守护进程（Daemon）
后台运行、脱离终端的服务进程：由 init 系统（现代为 systemd）管理生命周期。
**出处**：[Wikipedia · Daemon (computing)](https://en.wikipedia.org/wiki/Daemon_(computing))
**相关页**：[系统服务管理](/basic/services/system_services.md)

### syslog / journald（系统日志）
系统日志体系：传统 syslog 按设施/级别分类写文件，journald 以结构化二进制存储并由 journalctl 查询。
**出处**：[systemd.io 官方站](https://systemd.io/)
**相关页**：[系统日志](/basic/log/syslog.md)、[日志系统管理](/system-management/logging.md)

### LVM（Logical Volume Manager，逻辑卷管理）
在物理卷之上抽象卷组与逻辑卷的存储层：可动态扩容、快照，把「分区大小固定」的约束解开。
**出处**：[Wikipedia · Logical Volume Manager (Linux)](https://en.wikipedia.org/wiki/Logical_Volume_Manager_(Linux))
**相关页**：[LVM 逻辑卷管理](/system-management/lvm.md)

### GRUB（GRand Unified Bootloader）
Linux 主流引导加载器：加载内核与 initramfs 并移交控制权，配置经 grub-mkconfig 生成。
**出处**：[GNU GRUB 官方手册](https://www.gnu.org/software/grub/manual/grub/html_node/)
**相关页**：[GRUB 引导程序](/basic/boot/grub.md)

### UEFI（Unified Extensible Firmware Interface）
取代传统 BIOS 的现代固件接口：定义启动服务、ESP 分区与引导项，Secure Boot 是其安全扩展。
**出处**：[Wikipedia · Unified Extensible Firmware Interface](https://en.wikipedia.org/wiki/Unified_Extensible_Firmware_Interface)
**相关页**：[BIOS 与 UEFI](/basic/boot/bios_uefi.md)

### BIOS（Basic Input/Output System）
传统 PC 固件：开机自检、初始化硬件并移交引导扇区，容量与功能受限，正被 UEFI 取代。
**出处**：[Wikipedia · BIOS](https://en.wikipedia.org/wiki/BIOS)
**相关页**：[BIOS 与 UEFI](/basic/boot/bios_uefi.md)

### 权限模型（rwx / setuid / setgid / sticky）
Unix 文件权限位体系：属主/属组/其他三段 rwx 加三个特殊位——setuid 以属主身份执行、setgid 继承属组、sticky 限目录内删改。
**出处**：[man7 · inode(7)](https://man7.org/linux/man-pages/man7/inode.7.html)
**相关页**：[文件权限](/basic/filesystem/permissions.md)

### ACL（Access Control List，访问控制列表）
在 rwx 三段之外为指定用户/组追加条目的细粒度权限机制，setfacl/getfacl 读写。
**出处**：[man7 · acl(5)](https://man7.org/linux/man-pages/man5/acl.5.html)
**相关页**：[ACL 权限控制](/basic/users/acl_permissions.md)

### PAM（Pluggable Authentication Modules，可插拔认证模块）
Linux 认证框架：以可插拔模块堆叠实现密码、指纹、双因素等策略，sudo/login 等程序经它完成认证。
**出处**：[man7 · pam(8)](https://man7.org/linux/man-pages/man8/pam.8.html)
**相关页**：[PAM 与 sudo](/security/pam-sudo.md)

### x86-64 ABI（psABI）
x86-64 架构的应用二进制接口规范：调用约定、寄存器使用、栈布局与系统调用 ABI，是汇编与编译器共同遵守的契约。
**出处**：[x86-64 psABI 官方仓库](https://gitlab.com/x86-psABIs/x86-64-ABI)
**相关页**：[计算机体系结构](/hardware/architecture.md)

### Shell / Bash
命令解释器与脚本语言：把用户输入解析为命令执行，支持变量、控制流与函数，是系统自动化的入口。
**出处**：[GNU Bash 官方手册](https://www.gnu.org/software/bash/manual/)
**相关页**：[Bash 基础](/script/bash-basics.md)

## 网络与服务

### DNS（Domain Name System，域名系统）
把域名解析为 IP 的分布式数据库系统，RFC 1035 定义报文格式；BIND 是 Unix 世界主流服务端实现。
**出处**：[RFC 1035 · Domain Names — Implementation and Specification](https://www.rfc-editor.org/rfc/rfc1035)
**相关页**：[DNS](/server/dns/bind.md)

### DHCP（Dynamic Host Configuration Protocol）
主机自动获取 IP 与网络参数的协议，RFC 2131 定义；与 DNS 常并列为网络基础服务。
**出处**：[RFC 2131 · Dynamic Host Configuration Protocol](https://www.rfc-editor.org/rfc/rfc2131)
**相关页**：[DHCP 服务器](/server/dhcp.md)

### netfilter / nftables（防火墙框架）
Linux 内核的包过滤框架：netfilter 提供钩子与连接跟踪，nftables 是其新一代规则引擎（取代 iptables）。
**出处**：[netfilter.org 官方站](https://www.netfilter.org/)、[nftables 官方 wiki](https://wiki.nftables.org/)
**相关页**：[防火墙](/network/firewall.md)、[防火墙](/security/firewall.md)

### SELinux（Security-Enhanced Linux）
NSA 发起、主线内核合入的强制访问控制（MAC）实现：以安全上下文标签与策略规则约束进程对文件/端口的访问。
**出处**：[SELinux 官方项目仓库](https://github.com/SELinuxProject/selinux)
**相关页**：[SELinux 实战](/security/selinux.md)、[concept](/basic/security/concept.md)

### Docker（容器运行时）
容器化技术的事实标准：把应用与依赖打包为镜像，共享宿主机内核、以秒级启动，介于裸机与虚拟机之间。
**出处**：[Docker 官方文档](https://docs.docker.com/)
**相关页**：[容器](/server/container/docker.md)

### KVM（Kernel-based Virtual Machine）
Linux 内核自带的虚拟化方案：借 CPU VT-x/AMD-V 硬件辅助执行客户机指令，配 QEMU 与 libvirt 组成完整虚拟化栈。
**出处**：[linux-kvm.org 官方站](https://www.linux-kvm.org/page/Main_Page)
**相关页**：[KVM 虚拟化](/server/virtualization/kvm.md)

### oplock（机会锁，Opportunistic Lock）
SMB 的客户端缓存加速机制：服务端授予锁让客户端本地缓存读写，断连或并发时回收，是「文件被占用」类现象的来源之一。
**出处**：[Samba 官方文档](https://www.samba.org/samba/docs/)
**相关页**：[Samba 文件共享](/server/samba.md)

### passdb（Samba 账号数据库）
Samba 独立于系统账号的密码账本（默认 tdbsam 后端）：共享访问凭它核验，与 /etc/shadow 是两本账。
**出处**：[Samba 官方文档](https://www.samba.org/samba/docs/)
**相关页**：[Samba 文件共享](/server/samba.md)

---

**维护口径**：新增条目必须给出可点的权威出处（官方文档/规范/官方手册/权威百科）；查不到就写「未找到权威出处（待核）」，不得凭印象编造链接。

<!-- BACKLINKS-AUTO -->
## 相关页面

- [knowledge](knowledge.md)
