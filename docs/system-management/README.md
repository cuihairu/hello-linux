# 系统管理篇

装完系统、敲熟命令之后，真正拉开管理员水平差距的，是三件看起来不性感的事：
**这台机器现在状态如何（观测）、数据丢了怎么办（备份）、同样的活怎么不再手敲第二遍（自动化）**。
本篇围绕这三件事展开，分别对应三个子页：性能优化、备份与恢复、自动化运维。
三者共享同一条底层逻辑——先看清事实，再设计对策，最后把对策固化成可重复执行的机制。
缺了第一环，调优是赌博、备份是安慰剂、自动化只是把错误批量复制；
缺了后两环，观测与经验永远停留在个人记忆里，无法沉淀为团队资产。

> 本篇遵循"先为什么、再怎么做"的写法：每章开头的概念段落与后面的命令同等重要；
> 示例尽量附真实终端输出；涉及工具安装处给出三发行版
> （Debian/Ubuntu、Arch、RHEL/CentOS/Rocky）对照；
> 没有把握的版本差异宁可不写，或标注"需按你的版本核实"。

## 总览：为什么把这三件事放在一篇

性能、备份、自动化表面上分属不同领域，在日常运维里却是一条因果链。
服务器"变慢了"，第一步不是调参数，而是用观测工具证明瓶颈在 CPU、内存还是磁盘
——这是[性能优化](./performance.md)的职责；
业务数据"丢了"，能救回来的前提是早就按策略复制过至少一份
——这是[备份与恢复](./backup-and-recovery.md)的职责；
而"每周三凌晨两点手工跑一遍备份脚本"这种安排，迟早会因为一次值班疏忽而中断
——这是[自动化运维](./automation.md)的职责：
把动作交给 cron 或 systemd timer，把多机配置交给 Ansible，
人只负责看结果、处理异常。

反过来，三者也互相制约：
没有备份意识就敢大胆调优（改坏了能回滚）；
没有自动化，备份和巡检都无法保证频率；
没有观测数据，你甚至不知道该备份什么、调什么。
这也是本篇子页顺序"性能 → 备份 → 自动化"的由来：
**先学会看，再学会保底，最后学会放手交给机器**。

## 学习路线

建议按顺序推进，每完成一站就回到终端做一次真实验证：

1. **学会观测**：读[性能优化](./performance.md)，
   搞清"负载 / 内存 / IO"三角的判定路径，
   理解为什么"观测优先于调优"，
   以及 `load average` 与 CPU%、`available` 与 `free` 这两对最容易误读的指标。
   单条命令的语法在[命令篇 · 系统管理](../commands/system.md)有速查，
   本页专注"读出结论"。
2. **建立保底**：读[备份与恢复](./backup-and-recovery.md)，
   理解 3-2-1 策略每个数字在防什么事故，
   分清 rsync 镜像同步、硬链接快照、整盘镜像三种机制的适用边界，
   并亲手做一次恢复演练——**没有演练过的备份等于没有备份**。
3. **交给机器**：读[自动化运维](./automation.md)，
   判断"写个脚本"和"上 Ansible"的分界线，
   理解幂等性为什么是自动化的生命线，
   在 cron、systemd timer、流水线三者之间做出有依据的选择。

如果你只有半小时，建议只读性能页的"观测优先"与"常见误读"两节，
以及备份页的 3-2-1 与恢复演练两节——
这四节合起来能纠正日常八成以上的错误直觉。

实际工作中，这三站往往不是一次性走完的：
新人入职先学会看监控、跑巡检脚本；
第一次负责数据时补备份与演练；
机器扩到十台以上再考虑 Ansible 与 timer。
把每一站的结论沉淀成自己环境的检查清单，
比反复重读文档更有效。

## 子页导读

| 章节 | 一句话导读 | 适合谁 |
|------|-----------|--------|
| [性能优化](./performance.md) | 观测优先于调优的为什么、负载/内存/IO 三角、`load` 与 CPU%、`available` 与 `free` 等常见误读、USE 方法与有证据的调优 | 被"服务器好慢"折磨的人 |
| [备份与恢复](./backup-and-recovery.md) | 3-2-1 策略每个数字防什么、rsync 增量 vs 硬链接快照 vs 整盘镜像、恢复演练才是真备份、cron 与 timer 的三系调度差异 | 负责数据安全的人 |
| [自动化运维](./automation.md) | 何时写脚本 vs 何时用 Ansible、幂等为什么重要、cron vs timer vs 流水线、与脚本篇的分工 | 要把重复劳动交出去的人 |

三页可以独立阅读，但存在依赖：
性能页的观测结论决定备份窗口（别在业务高峰跑全量备份），
备份页的调度选择直接复用自动化页的 cron/timer 知识，
自动化页的脚本质量又依赖你是否养成了性能页强调的"先测量"习惯。
带着"上一页的结论如何约束下一页"去读，比孤立地背命令牢固得多。

## 学习目标

- 理解"观测优先于调优"，能用负载/内存/IO 三角定位瓶颈，避开 `load average` 与 `available` 的常见误读
- 掌握 3-2-1 备份策略每个数字的含义，能按场景选择 rsync 镜像、硬链接快照或整盘镜像
- 能独立完成一次恢复演练，明白"没有演练过的备份等于没有备份"
- 掌握 cron、systemd timer 与流水线的分工，能为重复任务做出有依据的调度选择
- 分清"写个脚本"与"上 Ansible"的分界线，理解幂等性并能编写可重复执行的自动化动作
- 能在三系发行版上装齐 sysstat、rsync、Ansible 等工具，避开包名差异与"预装 ≠ 启用"的坑

## 与其它篇的分工

系统管理篇与其它篇的边界如下，重复处以对应篇章为准：

- **与[基础篇](../basic/README.md)**：
  服务单元、日志轮转、包管理概念在基础篇讲"是什么"；
  本篇讲它们在观测、备份、调度场景里"怎么用"。
- **与[命令篇 · 系统管理](../commands/system.md)**：
  `ps`/`free`/`vmstat` 等单命令的语法与输出解读在命令篇；
  本篇性能页只在其之上补"三角判定"与"误读纠正"，
  不再大段重复各列含义，需要时会给出交叉引用。
- **与[脚本篇](../script/README.md)**：
  脚本篇讲 Bash 语法、调试与 shellcheck；
  本篇自动化页讲**选型与调度**——什么该写脚本、什么该交给 Ansible、
  写好的东西交给谁执行。分工原则：语法问题查脚本篇，架构问题看本篇。
- **与[服务器篇](../server/README.md)**：
  Nginx、MySQL 等具体服务的部署与调优在服务器篇；
  本篇只在备份示例中出现数据库导出这类通用动作。
- **与[安全篇](../security/README.md)、[网络篇](../network/README.md)**：
  加固基线与防火墙策略在安全篇，连通性排障在网络篇；
  本篇的备份涉及加密时只讲 GPG 用法，安全策略设计请回安全篇。

## 三系管理工具速览

同一项管理任务，三大发行版的包名、默认状态往往不同。
下表是本篇反复使用的"安装底座"，后文涉及工具时不再重复解释包名差异：

| 任务 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 性能统计（iostat/sar/mpstat） | `sudo apt install sysstat` | `sudo pacman -S sysstat` | `sudo dnf install sysstat` |
| 动态追踪（bcc 工具集） | `sudo apt install bpfcc-tools` | `sudo pacman -S bcc bcc-libbpf-tools` | `sudo dnf install bcc-tools`（装前 `dnf search bcc` 核实） |
| 实时监控 `htop`/`iotop` | `sudo apt install htop iotop` | `sudo pacman -S htop iotop` | `sudo dnf install htop iotop` |
| 文件同步/增量备份 `rsync` | `sudo apt install rsync` | `sudo pacman -S rsync` | `sudo dnf install rsync` |
| 系统快照 Timeshift | `sudo apt install timeshift`（universe） | `sudo pacman -S timeshift` | 先 `dnf install epel-release`，再 `dnf install timeshift` |
| 定时任务 cron | `cron` 基础系统默认安装并启用 | 不预装：`sudo pacman -S cronie` 后 `systemctl enable --now crond`，或直接用 systemd timer | `cronie` 默认安装并启用 |
| 现代定时器 systemd timer | systemd 预装，三系通用 | 同左 | 同左 |
| 配置管理 Ansible | `sudo apt install ansible` | `sudo pacman -S ansible` | `sudo dnf install ansible-core`（AppStream；完整 `ansible` 包在 EPEL） |

三个高频误区值得在起点就说清楚。

**Arch 上没有 `apt`，装包一律 `pacman -S`**。
本篇统一以 `sudo pacman -S 包名` 写出 Arch 的安装动作；
不确定包名时先 `pacman -Ss 关键词` 搜索，
Debian/Ubuntu 对应用 `apt search`，RHEL 系用 `dnf search`。
三系都装好后，用 `command -v 工具名` 验证是否真的可用，
比记忆"默认预装与否"可靠得多。

**"预装"不等于"在采集/在启用"**。
Debian/Ubuntu 的 `sysstat` 装完默认不开始采集（要改 `/etc/default/sysstat`），
cron 装了不代表你的任务已调度，
Timeshift 装了不代表快照计划已启用——
本篇各页凡涉及"装完还要做的一步"都会显式标出。

**RHEL 系的 `ansible` 与 `ansible-core` 不是一回事**。
AppStream 直接提供的是最小化的 `ansible-core`，
带社区 collections 的完整 `ansible` 包通常在 EPEL。
控制端与被控端的 Python 版本也要对照 Ansible 支持矩阵核实，
这是三系混用时最常见的"装上了却跑不动"原因。

## 阅读约定

- **真实输出优先**：示例输出取自典型的开发/局域网环境，
  你机器上的数字不同属正常，重点看字段结构与结论的推导过程。
- **先为什么后怎么做**：概念段落与命令同等重要，
  跳过概念直接抄命令，出问题时会失去判断力。
- **不确定不写**：已废弃参数、依赖特定内核版本的行为一律不写，
  或明确标注"需按你的版本核实"。
- **交叉引用而非重复**：指标列含义、命令语法这类查表内容指向命令篇，
  本篇只保留"如何下结论"的部分。

运维领域的"经验帖"过时极快：
十年前流行的内核参数今天可能有害，
某条命令在新版本上可能早已移除。
本篇只保留经得起版本变化的原理与主流工具。
拿不准时，回到对应手册页（`man rsync`、`man systemd.timer`、`man crontab`）
永远比搜索引擎结果更可靠。

## 参考资料

- 鸟哥的私房菜 - 系统管理单元：
  <https://linux.vbird.org/linux_basic/centos7/>
- Arch Wiki - System maintenance：
  <https://wiki.archlinux.org/title/System_maintenance>
- Arch Wiki - Pacman（Arch 装包习惯）：
  <https://wiki.archlinux.org/title/Pacman>
- Arch Wiki - Improving performance：
  <https://wiki.archlinux.org/title/Improving_performance>
- Brendan Gregg - Linux Performance Methods：
  <http://www.brendangregg.com/linuxperf.html>
- RHEL 9 监控与管理系统状态和性能：
  <https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/index>
- rsync 官方文档：<https://download.samba.org/pub/rsync/rsync.html>
- Backblaze - The 3-2-1 Backup Strategy：
  <https://www.backblaze.com/blog/the-3-2-1-backup-strategy/>
- systemd.timer(5)：<https://man7.org/linux/man-pages/man5/systemd.timer.5.html>
- Ansible 官方文档：<https://docs.ansible.com/>
- `man crontab`、`man rsync`、`man tar`、`man systemd.timer`
