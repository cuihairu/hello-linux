# 什么是 Linux

## 学习目标

- 理解 Linux 的定义和本质
- 了解 Linux 与 GNU 的关系
- 掌握 Linux 的核心特点

## 1. Linux 的定义

Linux 严格来说只是**内核（Kernel）**，由 Linus Torvalds 于 1991 年首次发布。我们通常所说的 "Linux" 实际上是指 **GNU/Linux 操作系统**，即 Linux 内核 + GNU 工具集。

### 1.1 Linux 内核

```bash
# 查看内核版本
uname -r

# 查看内核详细信息
cat /proc/version

# 查看内核发布日期
uname -v
```

### 1.2 GNU 工具

GNU（GNU's Not Unix）项目由 Richard Stallman 于 1983 年发起，提供了大量自由软件工具：

- **核心工具**：coreutils（ls, cp, mv 等）
- **编译器**：GCC（GNU Compiler Collection）
- **调试器**：GDB（GNU Debugger）
- **文本编辑器**：Emacs
- **Shell**：Bash（Bourne Again Shell）

## 2. Linux 的特点

### 2.1 开源自由

- 源代码公开，可自由修改和分发
- 遵循 GPL（GNU General Public License）协议
- 社区驱动的开发模式

### 2.2 多用户多任务

- 支持多个用户同时登录
- 支持多个程序同时运行
- 进程间隔离，互不干扰

### 2.3 稳定安全

- 内核设计稳定，可长时间运行
- 严格的权限管理机制
- 丰富的安全工具和策略

### 2.4 可移植性强

- 支持多种硬件架构（x86, ARM, MIPS 等）
- 从嵌入式设备到超级计算机都能运行

## 3. Linux 与 Unix 的区别

| 特性 | Linux | Unix |
|------|-------|------|
| 源代码 | 开源 | 闭源（多数） |
| 费用 | 免费 | 商业授权 |
| 硬件支持 | 广泛 | 特定平台 |
| 开发模式 | 社区驱动 | 公司驱动 |
| 标准 | POSIX 兼容 | POSIX 标准 |

## 4. Linux 的应用领域

- **服务器**：Web 服务器、数据库服务器、文件服务器
- **嵌入式**：路由器、智能家居、物联网设备
- **超级计算机**：全球 Top 500 超级计算机均运行 Linux
- **桌面**：开发者工作站、日常办公
- **移动**：Android 基于 Linux 内核

## 参考资料

- [鸟哥的私房菜 - 什么是 Linux](https://linux.vbird.org/linux_basic/0110whatislinux.php)
- [Arch Wiki - Linux](https://wiki.archlinux.org/title/Linux)
- [GNU 项目](https://www.gnu.org/)
