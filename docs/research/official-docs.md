# 官方文档调研

官方文档是本仓第二类来源。本页做两件事：把值得引用的官方文档入口登记清楚，以及统计本仓到底引用了多少——引用密度本身就是覆盖判断的证据。

## 1. 本仓外链引用统计（A 级，本地全量扫描）

统计口径：扫描 `docs/**/*.md` 里 Markdown 链接语法 `](http(s)://…)` 的全部外链目标，按域名归并；2026-10-08 初测，2026-10-10 复测并按当日补链（How Linux Works / Linux Bible 目录来源）重算。

- 全仓外链 970 处，162 个域名；本轮口径下 `example.com`、`localhost` 类示例域名 0 处。
- 覆盖页面 142 个（含首页与目录页），平均每个页面 6.8 条外链。

### 1.1 按来源归类

| 来源类别 | 引用条数 | 涉及页面 |
|---------|---------|---------|
| ArchWiki 与 Arch 官方（`wiki.archlinux.org`、`man.archlinux.org`、`archlinux.org`） | 302 | 122 |
| 鸟哥的私房菜（`linux.vbird.org`） | 102 | 96 |
| Red Hat 与 Fedora（`docs.redhat.com`、`access.redhat.com`、`docs.fedoraproject.org`） | 55 | 50 |
| 内核相关（`www.kernel.org`、`docs.kernel.org`、`elixir.bootlin.com`） | 74 | 32 |
| GNU、POSIX 与 TLDP（`www.gnu.org`、`tldp.org`、`pubs.opengroup.org`） | 54 | 27 |
| 手册站（`man7.org` 等） | 51 | 31 |
| 项目官方文档（Docker、Ansible、Prometheus、nginx、MySQL、Redis、BIND 等） | 50 | 25 |
| Debian 官方（`www.debian.org`、`wiki.debian.org`） | 37 | 35 |
| Ubuntu（`ubuntu.com`、`help.ubuntu.com`、`netplan.io`） | 21 | 20 |
| RHEL 兼容发行版（`docs.rockylinux.org` 等） | 17 | 13 |

### 1.2 单域名前十

| 域名 | 条数 | 页面数 |
|------|------|-------|
| `wiki.archlinux.org` | 251 | 120 |
| `linux.vbird.org` | 102 | 96 |
| `man7.org` | 51 | 31 |
| `docs.redhat.com` | 46 | 46 |
| `man.archlinux.org` | 43 | 13 |
| `www.gnu.org` | 40 | 24 |
| `elixir.bootlin.com` | 36 | 13 |
| `www.debian.org` | 28 | 28 |
| `www.kernel.org` | 25 | 21 |
| `github.com` | 16 | 12 |

两个数字值得注意：`docs.redhat.com` 的 46 条引用散布在 46 个页面上（每页一条，典型的「每章挂一条官方出处」），`man.archlinux.org` 的 43 条集中在 13 个页面（命令速查页密集引用）。README 维护备注记录过 docs.redhat.com 全域 403 反爬，链接可达性靠双通道仲裁确认，属 B 级。

## 2. ArchWiki（A 级，本轮实取结构）

官方站 `wiki.archlinux.org` 本轮不可达，类目结构取自中文镜像 `wiki.archlinux.org.cn` 的目录页。该镜像未获 Arch 官方承认，**只用于取类目树与条目数，不用于取正文**；正文引用一律写官方 `wiki.archlinux.org` 地址（本仓 251 条引用全部指向官方域名）。

镜像目录页给出 8 个顶级类目、336 条编号条目，条目后的数字是该类目在镜像上的页面数。与本仓相关的二级类目：

> 2026-10-09 复测：官方目录页实取 200，8 个顶级类目与 337 条编号条目，结构与镜像一致（部分类目计数 ±1 属镜像时差），本节类目结构升级为官方直取。复测记录见[缺口补全与核对修订](./gap-fill.md)。

| 类目 | 页面数 | 本仓落点 |
|------|-------|---------|
| 1.3 安装过程 | 35 | 基础篇 · 安装 Linux（3 页） |
| 4.2 CPU / 4.16 存储 | 9 / 17 | 硬件篇 · CPU、存储设备 |
| 4.6 显卡图形 / 4.15 声音 | 33 / 21 | 显卡图形由[桌面图形栈](../hardware/desktop-stack.md)新页落点；声音未单列 |
| 6.4 防火墙 / 6.7 网络配置 / 6.8 网络监控 | — / 10 / 11 | 网络篇与安全篇对应页 |
| 6.12 服务器 / 6.3.2 邮件服务器 | 20 / 30 | 服务器篇（21 页）与 `mail/postfix` |
| 8.8 文件系统 | 46 | 基础篇 · 文件系统（3 页）+ LVM 新页 |
| 8.12 内核 | 37 | 源码篇（14 页） |
| 8.18 软件包管理 | 26 | 基础篇 · 软件安装 + 命令篇 · 包管理命令 |
| 8.20 安全 | 39 | 安全篇（8 页）+ 基础篇 SELinux（4 页）+ AppArmor 新页 |
| 8.23 虚拟化 | 37 | 容器页（docker）+ KVM 新页 |
| 8.6 视觉美化 / 8.10 图形用户界面 / 8.14 本地化 | 25 / 3 / 14 | 桌面图形栈新页 |
| 8.1 备份 / 8.2 引导过程 / 8.15 日志 / 8.16 监控 | 16 / 19 / 6 / 2 | 系统管理篇对应页 |

明确不跟的部分：4.9 笔记本电脑（按厂商列了 33 个子类、Lenovo 一项 183 页）、2.x 开发工具链、6.10 点对点与 6.13 流媒体、6.15 VoIP——这类条目属于设备适配与应用软件目录，与本仓「学 Linux 系统本身」的定位不同，[差异表](./coverage-matrix.md) 里标为不覆盖而非缺口。

## 3. 其他官方文档入口

| 文档 | 入口 | 本仓引用 | 本轮状态 |
|------|------|---------|---------|
| Debian 官方手册 | [debian.org/doc/manuals/debian-handbook](https://www.debian.org/doc/manuals/debian-handbook/) | 28 条 `www.debian.org` + 9 条 `wiki.debian.org` | 入口 C 级升级中：2026-10-09 复测落地页 200；章级目录经官方在线版（debian-handbook.info，Bullseye）实取，16 章结构见[权威书籍调研](./authoritative-books.md) 2.1 节，正文细节仍未取 |
| 内核文档 | [docs.kernel.org](https://docs.kernel.org/)、[www.kernel.org](https://www.kernel.org/) | 13 + 25 条 | 2026-10-10 升 A：官方首页实取 200，解析出 21 个顶级分区（maintainer、process、core-api、driver-api、locking、doc-guide、dev-tools、kernel-hacking、trace、fault-injection、livepatch、rust、admin-guide、kbuild、tools、userspace-api、firmware-guide、devicetree、arch、staging、translations），另有未列入首页的 `scheduler/` 直访 200。本仓 13 条引用分布于 scheduler、process、networking、mm、kbuild、devicetree 六个区域，均属 admin-guide 与核心机制文档范围；README 记录过后继链核验轮的路径迁移修复 |
| Red Hat 文档 | [docs.redhat.com](https://docs.redhat.com/) | 46 条，覆盖 46 页 | B 级：仓库外链核查轮已确认可达（403 反爬，双通道仲裁） |
| GNU 工具手册 | [www.gnu.org](https://www.gnu.org/)（coreutils、bash、findutils、tar 等） | 40 条，24 页 | B 级：既有核验轮通过 |
| Arch 手册页 | [man.archlinux.org](https://man.archlinux.org/) | 43 条，13 页 | 2026-10-10 复测：带 UA 直测 200，此前 wayback 快照佐证撤 |
| systemd 文档 | [systemd.io](https://systemd.io/) | 2 条（services-systemd、boot-process 两页，2026-10-09 补链） | 引用缺口已清：两页各补一条官方入口（URL 均 200 实测），明细见[缺口补全与核对修订](./gap-fill.md) §2 第 4 条 |
| 内核源码浏览 | [elixir.bootlin.com](https://elixir.bootlin.com/) | 36 条，13 页 | B 级：带 UA 实测 200，README 记录为反爬假阳性 |

引用口径：本仓外链在上一轮站点巡检里做过 54 页 / 291 条抽样（README 维护备注），269 条正常、10 处失效已换替代、10 处反爬假阳性保留、6 处网络瞬态登记不动。2026-10-10 复测：6 处瞬态 5 处转 200（确认为当时瞬态），proftpd.org 仍 000（DNS 解析为 198.18.x.x 假地址，出口侧问题，wayback 有快照）维持保留；elixir.bootlin.com、cisecurity.org、man.archlinux.org、groups.google.com 四处 wayback 佐证项带 UA 直测 200，佐证撤；help.ubuntu.com 503 为反爬（非 404）维持保留。
