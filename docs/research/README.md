# 知识调查总览

这组文档回答三个问题：同类权威书籍和官方文档讲了什么、本仓实际覆盖了多少、差的部分怎么办。产出分四步落地，对应四类文件：

| 文件 | 内容 | 对应步骤 |
|------|------|---------|
| [权威书籍调研](./authoritative-books.md) | 鸟哥私房菜两篇的实测目录，以及四本英文系统管理书的定位 | ① 调研 |
| [官方文档调研](./official-docs.md) | ArchWiki、Debian、kernel.org、Red Hat 等官方文档清单，附本仓外链引用统计 | ① 调研 |
| [应用场景调研](./application-scenarios.md) | 服务器、云计算、边缘与嵌入式、桌面开发四类场景对文档的要求 | ① 调研 |
| [覆盖核对与差异表](./coverage-matrix.md) | 来源主题逐条对到本仓页面，判定已覆盖/部分覆盖/缺口/不覆盖 | ③ 覆盖核对 |
| [缺口补全与核对修订](./gap-fill.md) | 本次新增页面与修订记录，每条都注明由哪条差异触发 | ④ 补缺口与修订 |

## 来源分级与核验状态

引用分三级，每条来源在正文里都标了级别，方便后来人判断该不该信：

- **A 级，本轮实取**：2026-10-08 在本机直接抓取页面并读到正文，统计数字与目录条目均来自抓取结果。
- **B 级，仓库既有核验**：本仓 `scripts/check_links.py` 已在外链核查轮里验证过该 URL 可达，README 维护备注记录了轮次与结论；本轮不重复取正文。
- **C 级，仅书目信息**：只引用书名、作者、出版方、站点入口这类稳定事实，没有取到目录或正文，不引用其中任何细节。

**本轮网络状况**：2026-10-08 本机访问境外站点全部失败（TLS 握手被中断，`linux.vbird.org`、`wiki.archlinux.org`、`www.debian.org`、`docs.kernel.org`、`systemd.io`、`www.gnu.org`、`web.archive.org` 一律 `curl: (35) SSL routines::unexpected eof while reading`，DNS 返回 198.18.x.x 假地址，说明出口链路在路由器侧中断，与本机配置无关）。因此本轮改用两类可访问通道取证：

1. **镜像站**：`vbird.org.cn`（鸟哥站点镜像，A 级）、`wiki.archlinux.org.cn`（ArchWiki 中文镜像，A 级，非官方承认的镜像，仅用于取类目结构）。
2. **仓库既有外链核验记录**（B 级），加上本机实测的工具输出（Ubuntu 26.04 的 `lsblk`、`aa-status`、`qemu-system-x86_64 --version`）。

境外链路恢复后需要复测的清单见 [缺口补全与核对修订](./gap-fill.md) 的「待复测」一节。**2026-10-09 复测已执行**：原「不可达」清单中 `linux.vbird.org`、`wiki.archlinux.org`、`www.debian.org`、`docs.kernel.org`、`systemd.io`、`web.archive.org` 实测 200（`www.gnu.org` 连接层仍失败），两份鸟哥目录与 ArchWiki 类目结构对官方站逐条核对一致，明细与升级结论见 [缺口补全与核对修订](./gap-fill.md)。

## 结论要点

- 本仓现有 126 个目录条目，覆盖鸟哥基础学习篇 25 章中的 22 章对应主题、服务器架设篇 12 章中的 9 章，ArchWiki 八大类里与服务器运维相关的类目基本落地。
- 确认 6 个缺口，全部补页：Arch 包管理入口页、LVM 实操、桌面图形栈、KVM 虚拟化、AppArmor、应用场景。
- 修订 3 处：存储篇里"LVM 实操归基础篇与系统管理篇"的指向此前没有落点，现指向新页；README 篇章表与参考资料补入研究篇；基础篇软件安装章的目录补齐第三系。
- 全仓外链 965 条、160 个域名，前四位是 `wiki.archlinux.org`（238 条 / 111 页）、`linux.vbird.org`（100 条 / 94 页）、`man7.org`（49 条 / 29 页）、`docs.redhat.com`（40 条 / 40 页）——权威来源的实际引用密度与调研结论一致。
