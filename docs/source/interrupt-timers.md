# 中断与时钟

> **本章节正在编写中，敬请期待。**

## 计划涵盖内容

- 中断控制器：GIC、APIC、中断亲和性、MSI/MSI-X
- 中断处理流程：`do_IRQ`、`handle_irq_event`、上半部/下半部
- 软中断：`softirq`、`tasklet`、workqueue、kthread
- 定时器子系统：hrtimer、tickless、动态时钟、时间保持
- 时钟源与时钟事件：`clocksource`、`clockevent`、TSC、HPET
- 中断线程化：`CONFIG_IRQ_FORCED_THREADING`、实时内核影响
- 中断统计与调试：`/proc/interrupts`、`/proc/softirqs`、ftrace irqsoff

## 相关章节

- [进程管理与调度](./process-scheduling.md) — 抢占上下文、中断返回路径
- [系统调用路径](./syscall-path.md) — 系统调用入口与中断门的区别
- [跟踪工具](./tracing-tools.md) — ftrace irqsoff/preemptoff、中断延迟分析

---

*预计在后续版本完善。欢迎贡献内容或提出建议。*