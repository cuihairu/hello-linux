# 官方文档调研

官方文档是本仓第二类来源。本页做两件事：把值得引用的官方文档入口登记清楚，以及统计本仓到底引用了多少——引用密度本身就是覆盖判断的证据。

## 1. 本仓外链引用统计（A 级，本地全量扫描）

统计口径：扫描 `docs/**/*.md` 里全部 `http(s)://` 链接，按域名归并，2026-10-08 本地执行。

- 全仓外链 965 处，160 个域名；其中 953 处、157 个域名是真实来源，另 12 处是 `example.com`、`localhost` 这类示例域名，不计入来源统计。
- 覆盖页面 128 个（含首页与目录页），平均每个页面 7.5 条外链。

### 1.1 按来源归类

| 来源类别 | 引用条数 | 涉及页面 |
|---------|---------|---------|
| ArchWiki 与 Arch 官方（`wiki.archlinux.org`、`man.archlinux.org`、`archlinux.org`） | 302 | 112 |
| 鸟哥的私房菜（`linux.vbird.org`） | 100 | 94 |
| 内核相关（`www.kernel.org`、`docs.kernel.org`、`elixir.bootlin.com`） | 70 | 29 |
| Red Hat 与 Fedora（`docs.redhat.com`、`access.redhat.com`、`docs.fedoraproject.org`） | 58 | 47 |
| GNU、POSIX 与 TLDP（`www.gnu.org`、`tldp.org`、`pubs.opengroup.org`） | 50 | 24 |
| 手册站（`man7.org` 等） | 50 | 30 |
| Debian 官方（`www.debian.org`、`wiki.debian.org`） | 40 | 34 |
| 项目官方文档（Docker、Ansible、Prometheus、nginx、MySQL、Redis、BIND 等） | 37 | 18 |
| Ubuntu（`ubuntu.com`、`help.ubuntu.com`、`netplan.io`） | 27 | 16 |
| RHEL 兼容发行版（`docs.rockylinux.org` 等） | 13 | 11 |

### 1.2 单域名前十

| 域名 | 条数 | 页面数 |
|------|------|-------|
| `wiki.archlinux.org` | 238 | 111 |
| `linux.vbird.org` | 100 | 94 |
| `man7.org` | 49 | 29 |
| `docs.redhat.com` | 40 | 40 |
| `man.archlinux.org` | 40 | 10 |
| `www.gnu.org` | 36 | 21 |
| `elixir.bootlin.com` | 34 | 11 |
| `www.debian.org` | 29 | 26 |
| `www.kernel.org` | 25 | 21 |
| `github.com` | 17 | 13 |

两个数字值得注意：`docs.redhat.com` 的 40 条引用散布在 40 个页面上（每页一条，典型的「每章挂一条官方出处」），`man.archlinux.org` 的 40 条集中在 10 个页面（命令速查页密集引用）。README 维护备注记录过 docs.redhat.com 全域 403 反爬，链接可达性靠双通道仲裁确认，属 B 级。

## 2. ArchWiki（A 级，本轮实取结构）

官方站 `wiki.archlinux.org` 本轮不可达，类目结构取自中文镜像 `wiki.archlinux.org.cn` 的目录页。该镜像未获 Arch 官方承认，**只用于取类目树与条目数，不用于取正文**；正文引用一律写官方 `wiki.archlinux.org` 地址（本仓 238 条引用全部指向官方域名）。

镜像目录页给出 8 个顶级类目、336 条编号条目，条目后的数字是该类目在镜像上的页面数。与本仓相关的二级类目：

> 2026-10-09 复测：官方目录页实取 200，8 个顶级类目与 337 条编号条目，结构与镜像一致（部分类目计数 ±1 属镜像时差），本节类目结构升级为官方直取。复测记录见[缺口补全与核对修订](./gap-fill.md)。

| 类目 | 页面数 | 本仓落点 |
|------|-------|---------|
| 1.3 安装过程 | 35 | 基础篇 · 安装 Linux（3 页） |
| 4.2 CPU / 4.16 存储 | 9 / 17 | 硬件篇 · CPU、存储设备 |
| 4.6 显卡图形 / 4.15 声音 | 33 / 21 | 无落点，属硬件外设类缺口 |
| 6.4 防火墙 / 6.7 网络配置 / 6.8 网络监控 | — / 10 / 11 | 网络篇与安全篇对应页 |
| 6.12 服务器 / 6.3.2 邮件服务器 | 20 / 30 | 服务器篇（15 页）与 `mail/postfix` |
| 8.8 文件系统 | 46 | 基础篇 · 文件系统（3 页）+ LVM 新页 |
| 8.12 内核 | 37 | 源码篇（11 页） |
| 8.18 软件包管理 | 26 | 基础篇 · 软件安装 + 命令篇 · 包管理命令 |
| 8.20 安全 | 39 | 安全篇（6 页）+ 基础篇 SELinux（4 页）+ AppArmor 新页 |
| 8.23 虚拟化 | 37 | 容器页（docker）+ KVM 新页 |
| 8.6 视觉美化 / 8.10 图形用户界面 / 8.14 本地化 | 25 / 3 / 14 | 桌面图形栈新页 |
| 8.1 备份 / 8.2 引导过程 / 8.15 日志 / 8.16 监控 | 16 / 19 / 6 / 2 | 系统管理篇对应页 |

明确不跟的部分：4.9 笔记本电脑（按厂商列了 33 个子类、Lenovo 一项 183 页）、2.x 开发工具链、6.10 点对点与 6.13 流媒体、6.15 VoIP——这类条目属于设备适配与应用软件目录，与本仓「学 Linux 系统本身」的定位不同，[差异表](./coverage-matrix.md) 里标为不覆盖而非缺口。

## 3. 其他官方文档入口

| 文档 | 入口 | 本仓引用 | 本轮状态 |
|------|------|---------|---------|
| Debian 官方手册 | [debian.org/doc/manuals/debian-handbook](https://www.debian.org/doc/manuals/debian-handbook/) | 29 条 `www.debian.org` + 9 条 `wiki.debian.org` | C 级：本轮境外链路中断，未取正文；手册的包管理、系统管理、LVM、安全章节是既有引用方向 |
| 内核文档 | [docs.kernel.org](https://docs.kernel.org/)、[www.kernel.org](https://www.kernel.org/) | 9 + 25 条 | C 级：同上；README 记录过后继链核验轮的路径迁移修复 |
| Red Hat 文档 | [docs.redhat.com](https://docs.redhat.com/) | 40 条，覆盖 40 页 | B 级：仓库外链核查轮已确认可达（403 反爬，双通道仲裁） |
| GNU 工具手册 | [www.gnu.org](https://www.gnu.org/)（coreutils、bash、findutils、tar 等） | 36 条，21 页 | B 级：既有核验轮通过 |
| Arch 手册页 | [man.archlinux.org](https://man.archlinux.org/) | 40 条，10 页 | B 级：README 记录过 42 处被本机出口限速、按 wayback 快照判定存活 |
| systemd 文档 | [systemd.io](https://systemd.io/) | 无直接引用 | C 级：本轮未取；systemd 系统管理页目前靠 ArchWiki 与 RHEL 文档支撑，属下一轮可补的引用缺口 |
| 内核源码浏览 | [elixir.bootlin.com](https://elixir.bootlin.com/) | 34 条，11 页 | B 级：带 UA 实测 200，README 记录为反爬假阳性 |

引用口径：本仓外链在上一轮站点巡检里做过 54 页 / 291 条抽样（README 维护备注），269 条正常、10 处失效已换替代、10 处反爬假阳性保留、6 处网络瞬态登记不动。本轮境外链路整体中断，不改变该结论，也不重复计数。
