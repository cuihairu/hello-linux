# 内存管理

> **本章节正在编写中，敬请期待。**

## 计划涵盖内容

- 物理内存管理：页框分配器（Buddy System）、页面迁移与反碎片化
- 虚拟内存：页表结构、多级页表、TLB 与缓存一致性
- 缺页处理：`do_page_fault`、写时复制（COW）、零页与大页
- 内存回收：LRU 列表、kswapd、直接回写、OOM Killer
- Slab 分配器：kmem_cache、slub 实现、对象缓存与着色
- 内存映射：`mmap`、`munmap`、文件映射与匿名映射
- 用户态接口：`/proc/meminfo`、`/proc/vmstat`、cgroup memory 子系统

## 相关章节

- [进程管理与调度](./process-scheduling.md) — 进程的内存侧写（`mm_struct`、页表）
- [VFS 与 ext4](./vfs-ext4.md) — address_space 与页缓存的交接
- [跟踪工具](./tracing-tools.md) — 内存压力观测（脏页水位、回写统计）

---

*预计在后续版本完善。欢迎贡献内容或提出建议。*