# 知识调查总览

这组文档回答三个问题：同类权威书籍和官方文档讲了什么、本仓实际覆盖了多少、差的部分怎么办。产出分四步落地，对应四类文件：

| 文件 | 内容 | 对应步骤 |
|------|------|---------|
| [权威书籍调研](./authoritative-books.md) | 鸟哥私房菜两篇与 TLCL/USAH/Debian Handbook 的实测目录，其余英文书的定位 | ① 调研 |
| [官方文档调研](./official-docs.md) | ArchWiki、Debian、kernel.org、Red Hat 等官方文档清单，附本仓外链引用统计 | ① 调研 |
| [应用场景调研](./application-scenarios.md) | 服务器、云计算、边缘与嵌入式、桌面开发四类场景对文档的要求 | ① 调研 |
| [覆盖核对与差异表](./coverage-matrix.md) | 来源主题逐条对到本仓页面，判定已覆盖/部分覆盖/缺口/不覆盖 | ③ 覆盖核对 |
| [缺口补全与核对修订](./gap-fill.md) | 本次新增页面与修订记录，每条都注明由哪条差异触发 | ④ 补缺口与修订 |

## 来源分级与核验状态

引用分三级，每条来源在正文里都标了级别，方便后来人判断该不该信：

- **A 级，本轮实取**：2026-10-08/09 在本机直接抓取页面并读到正文，统计数字与目录条目均来自抓取结果。
- **B 级，仓库既有核验**：本仓 `scripts/check_links.py` 已在外链核查轮里验证过该 URL 可达，README 维护备注记录了轮次与结论；本轮不重复取正文。
- **C 级，仅书目信息**：只引用书名、作者、出版方、站点入口这类稳定事实，没有取到目录或正文，不引用其中任何细节。

**本轮网络状况**：2026-10-08 本机访问境外站点全部失败（TLS 握手被中断，`linux.vbird.org`、`wiki.archlinux.org`、`www.debian.org`、`docs.kernel.org`、`systemd.io`、`www.gnu.org`、`web.archive.org` 一律 `curl: (35) SSL routines::unexpected eof while reading`，DNS 返回 198.18.x.x 假地址，说明出口链路在路由器侧中断，与本机配置无关）。因此本轮改用两类可访问通道取证：

1. **镜像站**：`vbird.org.cn`（鸟哥站点镜像，A 级）、`wiki.archlinux.org.cn`（ArchWiki 中文镜像，A 级，非官方承认的镜像，仅用于取类目结构）。
2. **仓库既有外链核验记录**（B 级），加上本机实测的工具输出（Ubuntu 26.04 的 `lsblk`、`aa-status`、`qemu-system-x86_64 --version`）。

境外链路恢复后需要复测的清单见 [缺口补全与核对修订](./gap-fill.md) 的「待复测」一节。**2026-10-09 复测已执行**：原「不可达」清单中 `linux.vbird.org`、`wiki.archlinux.org`、`www.debian.org`、`docs.kernel.org`、`systemd.io`、`web.archive.org` 实测 200（`www.gnu.org` 连接层仍失败），两份鸟哥目录与 ArchWiki 类目结构对官方站逐条核对一致，明细与升级结论见 [缺口补全与核对修订](./gap-fill.md)。

## 结论要点

- 本仓现有 144 个目录条目，鸟哥基础学习篇 25 章、服务器架设篇 12 章全部有对应落点，ArchWiki 八大类里与服务器运维相关的类目基本落地。
- 确认 6 个缺口，全部补页：Arch 包管理入口页、LVM 实操、桌面图形栈、KVM 虚拟化、AppArmor、应用场景。
- 后续增量（2026-10-09）：首轮登记不补的两项已补页（[交叉编译与嵌入式](../source/cross-compile.md)、[LDAP 统一账号管理](../server/ldap.md)），缺口页累计 8 个；systemd 官方文档引用补链；页内「随版本核实」标记逐条核实或降级；TLCL、USAH、Debian Handbook 三本目录实取完成 C→A 升级，明细见 [缺口补全与核对修订](./gap-fill.md)。
- 调研产出的知识点收拢已成单页 [知识点整理](../knowledge.md)：核心概念、书籍与文档要点、场景与坑，逐条带来源标注回链本篇各页。
- 后续增量（2026-10-10）：差异表部分覆盖项 SSH 补独立页面 [SSH 远程登录](../server/ssh.md)（服务器篇），差异表与本页 §1 判定同步升级；同日基础篇「第二十一章」补 [源码编译与 Tarball 安装](../basic/packages/tarball.md)，差异表 §1 判定升级；USAH 5e 扩展选题 Cloud Computing 与 Continuous Integration and Delivery 落成 [云计算与 cloud-init](../server/cloud-computing.md)、[CI/CD 与持续交付](../server/ci-cd.md)两页，登记见 [缺口补全与核对修订](./gap-fill.md)。同日 USAH 5e 31 章、TLCL 36 章全部逐条对照进[覆盖核对与差异表](./coverage-matrix.md) §4、§5，暴露的落点逐条判定，登记不补 6 类见 gap-fill §3。Debian Handbook（Bullseye 版）16 章同日完成逐条对照，进差异表 §6：已覆盖 12 章，登记不补 2 类（实时通信与代理服务、Debian 打包工作流），见 gap-fill §3.2。
- 后续增量（2026-10-10 次轮）：剩余两本 C 级书目完成 C→A 升级——How Linux Works 3e 经 No Starch 新版产品页 + 官方详细目录 PDF 实取（17 章），The Linux Bible 经 Wiley 第 11 版产品页 + 官方 TOC PDF 实取（6 部 31 章，顺带更正原登记的无效 ISBN）。两本随即逐章对照进[覆盖核对与差异表](./coverage-matrix.md) §7、§8（已覆盖 15 / 27 章），登记不补 4 类见 gap-fill §3.3——至此五本英文权威书全部 A 级并逐章对照完毕，无 C 级书目残留。
- 修订 3 处：存储篇里"LVM 实操归基础篇与系统管理篇"的指向此前没有落点，现指向新页；README 篇章表与参考资料补入研究篇；基础篇软件安装章的目录补齐第三系。
- 「随版本核实」标记清账（2026-10-10）：ssh、ldap、cloud-computing、ci-cd 四页残留 5 处标记逐条核实完毕（man sshd_config、CentOS Stream 9 镜像、Arch Wiki、man slapo-memberof + OpenLDAP 管理指南、docs.gitea.com 五路取证），全部撤标改肯定句，顺带改正 TrustedUserCAkeys 拼写笔误，明细见 [缺口补全与核对修订](./gap-fill.md) §4.1.1。
- 全仓外链 970 条、162 个域名（2026-10-10 复测，含 How Linux Works / Linux Bible 目录来源补链），前四位是 `wiki.archlinux.org`（251 条 / 120 页）、`linux.vbird.org`（102 条 / 96 页）、`man7.org`（51 条 / 31 页）、`docs.redhat.com`（46 条 / 46 页）——权威来源的实际引用密度与调研结论一致。
- 交叉统计同步（2026-10-10 三轮）：知识点页来源表的 Debian（37 条）、内核文档（C→A，随官方文档调研 §4.4 升级）、Red Hat（46 条）、GNU（40 条）、man 页（51 / 43 条）五处计数与分级、[官方文档调研](./official-docs.md) §3 的 systemd 引用数（2→5 条）、[权威书籍调研](./authoritative-books.md) §3 的鸟哥引用数（100/94→102/96 页）按当日全量扫描口径对齐；[差异表](./coverage-matrix.md) §9 补入虚拟化行（与本篇 §2 六条要求对齐），[应用场景调研](./application-scenarios.md) §2 处置列统一收口为「已补页」。
