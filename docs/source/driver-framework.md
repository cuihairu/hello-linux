# 设备驱动框架

> **本章节正在编写中，敬请期待。**

## 计划涵盖内容

- Linux 设备模型：总线、设备、驱动、类的三层关系
- 设备树：DTS/DTB、节点与属性、binding 规范
- 平台总线：`platform_driver`、`platform_device`、资源管理
- 字符设备：`cdev`、`file_operations`、设备号分配、udev 交互
- 设备驱动核心：`driver_core`、probe/remove、PM 运行时
- 内核模块编写：`module_init`/`module_exit`、参数、导出符号
- 真实模块实战：第二个内核模块从骨架到加载运行

## 相关章节

- [内核编译与模块开发](./build-and-modules.md) — 编译环境、模块构建、符号版本
- [跟踪工具](./tracing-tools.md) — 驱动探针观测、kprobe 附着驱动函数
- [源码获取与目录导读](./source-tree.md) — `drivers/` 目录结构导航

---

*预计在后续版本完善。欢迎贡献内容或提出建议。*