# 安全基础

传统 Linux 权限（rwx + user/group）有一个结构性弱点：**root 说了算**。Web 服务被攻破时，攻击者拿到的往往是运行服务的那个进程的身份；如果进程以 root 运行、或恰好能通过 sudo 提权，DAC 权限模型就全线失守——文件权限挡不住一个已经是 root 的进程。强制访问控制（MAC）正是为此设计的第二道闸：即便进程拥有 uid 0，只要安全策略没写"允许它碰这个文件"，内核照样拒绝。

本章讲 Linux 上最主流的 MAC 实现 SELinux：它是什么、三种模式怎么选、日常排障的标准命令流程，以及 file contexts 为什么比 `chcon` 更可靠。同时会对照 Debian/Ubuntu 的 AppArmor 与 Arch 的默认无 MAC 现状，帮你建立三系安全栈的全景认知，避免把 RHEL 文档的命令生搬到其他发行版上。

> 内容参考自 Red Hat SELinux 文档、Arch Wiki 与各发行版安全文档，见文末参考资料。

## 导语

安全基础不止 SELinux。本章从 DAC 的局限性出发引入 MAC 概念，再分四节展开 SELinux 的**概念**（安全上下文与 type enforcement）、**模式**（Enforcing/Permissive/Disabled 的取舍）、**基本命令**（ausearch/restorecon/semanage 的排障流程）和**策略配置**（fcontext 持久化、audit2allow 的正确用法）。每节都会对照说明三发行版的默认安全栈差异，确保你在 Ubuntu 上不会找不到 `getenforce`、在 Arch 上不会误以为 SELinux 默认开启。

## 为什么需要 MAC：从 DAC 的天花板说起

DAC（Discretionary Access Control，自主访问控制）的规则很简单：文件的 owner 决定谁能读写，root 能改一切。这在"所有程序都可信"的年代够用，但在共享服务器上有一个致命前提被打破——**你无法保证每个进程都是善意的**。

一个典型故事：nginx 以 root 启动、随后降权为 `www-data`，这在 DAC 下看起来没问题。但如果 nginx 存在路径穿越漏洞，攻击者通过它读取了 `/etc/shadow`——DAC 检查的是"www-data 有没有权限"，而 `/etc/shadow` 的 group 经常恰好允许某些服务组读取；更糟的情况是进程本身以 root 跑，DAC 直接放行。MAC 换了问法：不问"用户是谁"，而问"**这个类型的进程，被策略允许访问那个类型的文件吗？**"——`httpd_t` 进程想碰 `shadow_t` 文件，策略里没有这条规则，内核拒绝，与 uid 无关。

这就是 SELinux 的核心：**把"谁能访问什么"的决定权从文件所有者手里收回到系统安全策略手里**。

## 三发行版的默认安全栈（先建立全景）

这是本章最重要的背景之一：**并非所有发行版都默认开启 SELinux**。只按 RHEL 视角学 SELinux，换到 Ubuntu 或 Arch 会完全对不上号：

| 发行版 | 默认 MAC 方案 | 默认状态 | 说明 |
|--------|--------------|---------|------|
| RHEL/CentOS/Rocky/Fedora | **SELinux** | Enforcing（强制） | 企业级默认，targeted 策略保护关键服务 |
| Debian / Ubuntu | **AppArmor** | 启用（enforce 模式） | 基于路径的 MAC，profile 在 `/etc/apparmor.d/`，与 SELinux 机制不同 |
| Arch | **两者默认都不启用** | 无 MAC | 官方不默认启用 SELinux 或 AppArmor；SELinux 需自行编译/安装用户态工具与策略，属高级自定义场景 |

因此：

- 在 **RHEL 系**上遇到"服务莫名被拒"，第一反应查 `ausearch -m avc`。
- 在 **Debian/Ubuntu** 上同样的问题，第一反应查 `aa-status` / `/var/log/kern.log` 里的 apparmor 拒绝记录。
- 在 **Arch** 上，DAC + 防火墙 + 最小权限就是默认基线，SELinux/AppArmor 属于"我知道我在做什么"的额外选项。

本章后续四节聚焦 SELinux（它是 RHEL 系的默认栈，也是概念上最完整的 MAC 教材），但每节都会对照说明另外两系的情况，避免形成"Linux = SELinux"的错误心智模型。

> 内容参考自 Red Hat SELinux 文档与 Arch Wiki，见各章节参考资料。

## 学习目标

- 理解 DAC 与 MAC 的本质区别，能用自己的话解释"为什么 root 也需要被 SELinux 约束"
- 掌握 SELinux 三种模式（Enforcing/Permissive/Disabled）的行为差异与三系默认值
- 掌握排障标准流程：确认模式 → `ausearch` 读拒绝日志 → 判断是布尔值/标签/策略缺口 → 选择最小改动修复
- 理解 type enforcement 与安全上下文（`user:role:type:level`）的读法
- 掌握 `semanage fcontext` + `restorecon` 的正确用法，明白为什么它优于 `chcon`
- 能说清 AppArmor（Debian/Ubuntu 默认）与 SELinux（RHEL 默认）的定位差异，Arch 为何选择不默认启用

## 子页导读

| 章节 | 回答什么问题 | 建议阅读时机 |
|------|-------------|--------------|
| [SELinux 概念](./security/concept.md) | DAC vs MAC 为何需要；安全上下文怎么读；type enforcement 如何做决定；三系 MAC 全景 | 第一次接触 MAC，或看不懂 `ls -Z` 输出时 |
| [SELinux 模式](./security/modes.md) | Enforcing/Permissive/Disabled 各自后果；三系默认值；`setenforce` 与配置文件的边界；切换模式的正确姿势 | 要开启、关闭或调试 SELinux 之前 |
| [SELinux 基本命令](./security/commands.md) | `ausearch`/`setenforce`/`restorecon`/`semanage`/布尔值/端口标签的实操；排障标准流程 | 服务被拒、需要动手排障时（本章实操核心） |
| [SELinux 策略配置](./security/policy_configuration.md) | targeted/minimum/mls 策略差异；file contexts 与 fcontext 为何优于 chcon；audit2allow 的正确与危险用法 | 需要为自定义路径/端口持久化放行规则时 |

阅读顺序建议按编号来；赶时间排障可直接跳到[基本命令](./security/commands.md)。

## 三系差异速览

| 对比项 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------|---------------|------|--------------------|
| 默认 MAC | AppArmor | 无（SELinux/AppArmor 均可选） | SELinux |
| 默认模式/状态 | AppArmor enforce | — | SELinux Enforcing, targeted |
| 查状态命令 | `aa-status` | （若自行启用 SELinux：`getenforce`） | `getenforce` / `sestatus` |
| 拒绝日志位置 | `/var/log/kern.log`、journal | 视启用的方案而定 | `/var/log/audit/audit.log` |
| 临时放行手段 | `aa-complain` / 修改 profile | — | `setenforce 0`（临时）、布尔值 |
| 策略文件位置 | `/etc/apparmor.d/` | — | `/etc/selinux/targeted/` |
| 排障主命令 | `aa-status`, `dmesg \| grep apparmor` | — | `ausearch`, `sealert` |

一个容易踩的坑：在 Ubuntu 上执行 `getenforce` 会报 `None` 或 command not found——**不是你操作错了，是这台机器根本不用 SELinux**。同理，把 RHEL 文档里的 `setenforce` 流程照搬到 Arch，大概率因为用户态工具未安装而失败。先确认发行版和 MAC 方案，再选命令。

## 常见问题

**Q：SELinux 导致服务起不来，是不是应该直接关掉它？**
不建议。关掉等于拆掉第二道闸，且 RHEL 系上大量服务（httpd、samba、ftpd）的标签与布尔值都假设 SELinux 开启。正确路径是读拒绝日志、用布尔值或 fcontext 做最小放行——这正是[基本命令](./security/commands.md)一节的标准流程。只有在策略本身存在已知 bug 且暂时无法修复时，才用 Permissive 模式收集日志而不影响业务。

**Q：`setenforce 0` 和改 `/etc/selinux/config` 有什么区别？**
`setenforce` 是运行时切换，重启即失效，适合临时验证；改配置文件是持久设置，需重启（Disabled↔Enforcing 之间切换还必须重建文件标签）。详见[SELinux 模式](./security/modes.md)。

**Q：Ubuntu 到底用不用 SELinux？**
Ubuntu 默认用 AppArmor 而非 SELinux。两者都是 LSM（Linux Security Modules）框架下的 MAC 实现，机制不同：SELinux 基于类型（type）标签，AppArmor 基于文件路径的 profile。概念互通，命令不通用。

**Q：Arch 上能开 SELinux 吗？**
能，但不是默认路径：需要自行准备内核参数（`lsm=...selinux...`）、用户态工具、并替换大量核心包为带 SELinux 编译选项的版本，还要安装并维护策略。对多数 Arch 用户，这属于刻意的安全加固项目而非开箱特性；不了解细节前照搬 RHEL 文档大概率把系统搞到无法登录。

**Q：`chcon` 改了标签为什么重启后又变回去了？**
`chcon` 只改当前 inode 的标签，不写入策略数据库；任何触发 `restorecon` 的时机（重启、包更新、`restorecon -R /`）都会按策略文件里的默认规则重算标签。持久修改必须用 `semanage fcontext`，详见[策略配置](./security/policy_configuration.md)。

## 参考资料

- Red Hat - Using SELinux — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
- Red Hat - What is SELinux — [redhat.com](https://www.redhat.com/en/topics/linux/what-is-selinux)
- Arch Wiki - SELinux — [wiki.archlinux.org](https://wiki.archlinux.org/title/SELinux)
- Arch Wiki - AppArmor — [wiki.archlinux.org](https://wiki.archlinux.org/title/AppArmor)
- Debian Wiki - SELinux — [wiki.debian.org](https://wiki.debian.org/SELinux)
- Debian Wiki - AppArmor — [wiki.debian.org](https://wiki.debian.org/AppArmor)
- Ubuntu 社区 - AppArmor — [help.ubuntu.com](https://help.ubuntu.com/community/AppArmor)
- AppArmor 官网 — [apparmor.net](https://apparmor.net/)
- `man getenforce`、`man setenforce`、`man semanage`、`man ausearch`
