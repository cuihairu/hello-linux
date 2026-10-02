# 进程间通信（IPC）

> **本章节正在编写中，敬请期待。**

## 计划涵盖内容

- 信号：信号语义、可靠信号、实时信号、`sigaction`、`signalfd`
- 管道与 FIFO：`pipe()`、`pipe2()`、缓冲区管理、零拷贝管道
- System V IPC：消息队列、信号量、共享内存、`ipcs`/`ipcrm`
- POSIX IPC：`mq_overview`、`sem_overview`、`shm_overview`
- 事件通知：`eventfd`、`signalfd`、`timerfd`、epoll 边缘触发
- Unix 域套接字：`SOCK_STREAM`/`SOCK_DGRAM`、`SCM_RIGHTS` 文件描述符传递
- 内核实现：`ipc_namespace`、命名空间隔离、锁与竞争

## 相关章节

- [进程管理与调度](./process-scheduling.md) — 信号处理上下文、任务唤醒路径
- [系统调用路径](./syscall-path.md) — IPC 系统调用入口分析
- [跟踪工具](./tracing-tools.md) — IPC 调用跟踪、延迟分析

---

*预计在后续版本完善。欢迎贡献内容或提出建议。*