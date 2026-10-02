# 用户态源码选读

> **本章节正在编写中，敬请期待。**

## 计划涵盖内容

- C 库系统调用包装：glibc `syscall()`、`INLINE_SYSCALL`、vDSO 加速
- coreutils 核心工具：`ls`、`cp`、`rm`、`cat` 的内核交互路径
- systemd 源码剖析：单元文件解析、事务依赖、cgroup 委托、journal 实现
- 启动流程用户态：initramfs、`switch_root`、systemd 第一个 PID 1
- 容器运行时：runc、crun、CRI-O、containerd 的核心调用链
- 调试器与追踪器：strace/ltrace 实现原理、gdb ptrace 交互

## 相关章节

- [系统调用路径](./syscall-path.md) — 从用户态到内核态的完整路径
- [跟踪工具](./tracing-tools.md) — 用户态追踪（uprobe、USDT）
- [systemd 服务与程序管理](../system-management/services-systemd.md) — 管理面视角

---

*预计在后续版本完善。欢迎贡献内容或提出建议。*