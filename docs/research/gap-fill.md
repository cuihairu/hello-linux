# 缺口补全与核对修订

本页是四步里的第④步：登记[覆盖核对与差异表](./coverage-matrix.md)判定出的每一处缺口与修订，由哪条差异触发、落成哪个文件、改了哪些既有页。待复测事项在最后一节。

## 1. 本轮补页（6，全部由差异表「缺口」行触发）

| 新页 | 触发差异 | 内容 |
|------|---------|------|
| [Pacman 包管理](../basic/packages/pacman.md) | 差异表 1 章「第二十二章」软件安装章只有 APT/DNF 两系，第三系无落点（ArchWiki 8.18 软件包管理同判） | 滚动更新模型、仓库与数据库、日常命令、`-Syu` 原子性与部分升级危害、缓存管理、AUR 与 makepkg 边界、三系对照表、keyring/.pacnew 等坑 |
| [LVM 逻辑卷管理](../system-management/lvm.md) | 差异表 1 章「第七章」LVM 实操此前无落点（存储篇只讲到 device-mapper 分层） | PV/VG/LV/PE 模型、建卷序列、扩容（ext4 与 XFS 差异）、缩容风险、快照与回滚、pvmove 换盘、与 RAID/LUKS 的栈序、常见故障 |
| [桌面图形栈](../hardware/desktop-stack.md) | 差异表 ArchWiki「4.6 显卡图形 / 8.10 图形用户界面 / 8.14 本地化」与鸟哥「第二十三章 X Window」均无落点 | DRM/KMS 到像素的分层链路、Xorg 与 Wayland 模型对比、显示管理器、桌面环境与 WM、显卡驱动与 DKMS、字体输入法、三系最小安装对照、服务器不装桌面的判断、排错入口 |
| [KVM 虚拟化](../server/virtualization/kvm.md) | 差异表鸟哥服务器篇「第二章 虚拟机」与 ArchWiki「8.23 虚拟化」只有容器页支撑 | KVM/QEMU/libvirt/virsh 四者关系、CPU 硬件辅助检查、三系安装、NAT 与桥接网络、qcow2/raw 存储、virt-install 全参数实例、virsh 日常管理、快照克隆、与容器分工表、常见故障 |
| [AppArmor 实战](../security/apparmor.md) | 差异表 ArchWiki「8.20 安全」两套 MAC 只写了 SELinux，AppArmor 仅在加固页对照表出现一行 | 「路径 vs 标签」模型对照、aa-status 三态、deny 日志判读、aa-complain 定位、local/ 与 abstractions/ 持久修正、aa-logprof/aa-genprof、自定义 profile 骨架、三系现状、容器场景 |
| [应用场景调研](./application-scenarios.md)（本轮补阅读路径节） | 差异表场景行「边缘与嵌入式」要求给出阅读路径 | 四类场景（服务器与云、边缘与嵌入式、桌面与开发、运维自动化）各给一条本仓既有页面的阅读顺序 |
| [交叉编译与嵌入式](../source/cross-compile.md)（2026-10-09 增量） | 差异表场景行「边缘与嵌入式」与本页 §3 首条登记 | 交叉工具链三元组、内核交叉编译（ARCH/CROSS_COMPILE）、设备树、BusyBox rootfs 与 initramfs、U-Boot 引导链、QEMU 异架构验证、gdb 交叉调试 |
| [LDAP 统一账号管理](../server/ldap.md)（2026-10-09 增量） | 差异表鸟哥服务器篇「第十一章」与本页 §3 次条登记 | 目录服务模型（DN/LDIF/schema）、OpenLDAP 三系安装（含 RHEL 8 起移除 openldap-servers 的实情与 Rocky plus/EPEL 替代）、cn=config、建树与查询、TLS、SSSD 客户端接入、olcAccess 访问控制 |
| [SSH 远程登录](../server/ssh.md)（2026-10-10 增量） | 差异表鸟哥服务器篇「第十章」由部分覆盖升级（客户端用法此前散在命令篇与安全篇） | openssh-server 三系安装（含服务名 sshd/ssh 差异）、密钥认证闭环、sshd_config 核心项与 Match/drop-in、~/.ssh/config、防火墙与 SELinux 端口标签、常见故障 |
| [源码编译与 Tarball 安装](../basic/packages/tarball.md)（2026-10-10 增量） | 差异表鸟哥基础篇「第二十一章」由部分覆盖升级（源码编译安装此前无独立小节） | 源码安装的取舍判断、三系工具链组、configure 检测与 --prefix、六步标准流程、config.log 读法、卸载两解法（DESTDIR 清单与 GNU stow）、与包管理器的边界、常见故障 |
| [云计算与 cloud-init](../server/cloud-computing.md)（2026-10-10 增量） | USAH 5e「Cloud Computing」章对照（[权威书籍调研](./authoritative-books.md) 2.1 实取目录）登记的扩展选题 | IaaS/PaaS/SaaS 模型、实例与镜像、cloud-init 三系安装与四段单元链、#cloud-config 用户数据、NoCloud 与 metadata 服务、安全组与 VPC 概念、私有云一瞥、常见故障 |
| [CI/CD 与持续交付](../server/ci-cd.md)（2026-10-10 增量） | USAH 5e「Continuous Integration and Delivery」章对照登记的扩展选题 | CI 与 CD 分界、三平台对照（GitHub Actions/GitLab CI/Jenkins）、流水线解剖与最小示例、制品与镜像两种交付物、四档部署策略、secrets 红线、常见故障 |

## 2. 本轮修订（3 处，均注明触发）

1. **存储篇 LVM 指向落地**。`docs/hardware/storage.md` 里「LVM 的实操归基础篇与系统管理篇」的链接此前指向 `../system-management/README.md`，该 README 并无 LVM 实操内容，属于有指向、无落点；现指向新页 [LVM 逻辑卷管理](../system-management/lvm.md)。（触发：差异表「部分覆盖→本轮修订」行）
2. **基础篇软件安装章目录补齐第三系**。`docs/basic/packages.md` 章导语由「本章两页」改为三页并补 Pacman 页介绍条目；`docs/basic/README.md` 覆盖范围注从「Arch 的 pacman 在发行版简介有对照」改为指向新页。（触发：差异表同上）
3. **README 篇章表与参考资料补入研究篇**。中英双语 README 的内容表各补一行研究篇，参考资料各补一条站内调研入口；`docs/index.md` 首页特性卡片补研究篇并订正五处章节数（基础 36→37、硬件 6→7、系统管理 8→9、服务器 16→17、安全 7→8）。（触发：差异表同上）
4. **systemd 官方文档引用补链**（2026-10-09 增量）。`docs/system-management/services-systemd.md` 参考资料补 systemd.io 项目文档门户、`boot-process.md` 补 systemd.io/BOOT 官方启动流程说明（URL 均 200 实测；freedesktop man 页对 curl 返回 418 反爬，既有引用不动）。（触发：官方文档调研 §3 的 systemd 引用缺口登记）

接线记录：`docs/SUMMARY.md` 补 5 页与新「研究篇」节；`docs/.vitepress/config.mts` nav 补研究篇、sidebar 补 6 页与 `/research/` 组；`docs/security/hardening.md` MAC 段落补 SELinux 实战与 AppArmor 实战两处链接。

## 3. 登记不补（首轮登记 3 项，2026-10-09 增量已全部清账）

- **嵌入式交叉编译专题**（触发：应用场景调研 1.2 节——全仓 `交叉编译` 零命中）。首轮只以场景页给出阅读路径；已补 [交叉编译与嵌入式](../source/cross-compile.md)，接入源码篇目录。
- **LDAP 统一账号**（触发：应用场景调研 1.4 节——运维主线缺「多机账号一致性」）。已补 [LDAP 统一账号管理](../server/ldap.md)，接入服务器篇目录。
- **systemd 文档引用缺口**（触发：官方文档调研 §3 登记）。已在 services-systemd、boot-process 两页补 systemd.io 官方入口，见 §2 修订第 4 条。

### 3.1 第二批登记不补（2026-10-10，USAH/TLCL 逐章核对轮）

触发：[覆盖核对与差异表](./coverage-matrix.md) §4（USAH 31 章）、§5（TLCL 36 章）逐章判定。逐类登记如下，均属有意识不写，日后定位变化可重启：

| 主题 | 出处 | 不补理由 |
|------|------|---------|
| 打印 CUPS | USAH 第 12 章、TLCL 第 22 章 | 桌面办公外围场景，与服务器运维主线弱相关；CUPS 已在 [systemd 服务与程序管理](../system-management/services-systemd.md) 作单元示例出现 |
| SSO 完整部署 | USAH 第 17 章 | Kerberos KDC 与域集成需要域环境支撑，超出单机学习定位；[LDAP 统一账号管理](../server/ldap.md) 已衔接 Kerberos 与 FreeIPA 概念 |
| readline 键绑定与 history 扩展 | TLCL 第 8 章 | 终端使用习惯类技巧；任务控制（jobs/fg/bg）等核心已由[进程管理](../commands/system/process.md)覆盖 |
| 格式化输出小工具（nl/fold/pr） | TLCL 第 21 章 | 低频排版工具；printf 与 fmt 已在[文本处理](../commands/text/text_processing.md) |
| 提示符定制（PS1） | TLCL 第 13 章 | 终端个人配置，不影响系统管理主线 |
| shell 杂项技巧 | TLCL 第 36 章 | 杂项合集；核心技巧（heredoc、进程替换）已散见脚本篇[循环](../script/loops.md)与[实战案例](../script/examples.md) |

另有 USAH 第 30 章（机房设施与带外管理）、第 31 章（组织流程与软技能）在差异表判「不覆盖」：前者属数据中心运维范畴，后者非系统技术主题，不进本登记表。

### 3.2 第三批登记不补（2026-10-10，Debian Handbook 逐章核对轮）

触发：[覆盖核对与差异表](./coverage-matrix.md) §6（Debian Handbook 16 章）逐章判定——三本 A 级英文书里最后一本完成对照。逐类登记如下：

| 主题 | 出处 | 不补理由 |
|------|------|---------|
| 实时通信与代理服务（Squid、SIP/XMPP/TURN） | 第 11 章 Network Services | 企业专用协议栈，与单机学习主线弱相关；同章的 Postfix、Apache、NFS、Samba、LDAP 五项已有独立页，该章实质覆盖 |
| Debian 打包工作流（`dpkg-buildpackage`、debhelper） | 第 15 章 Creating a Debian Package | 属发行版打包者技能，非系统管理主线；源码编译安装已由[源码编译与 Tarball 安装](../basic/packages/tarball.md)覆盖，打包进自家仓库的流程不在本仓定位内 |

另有第 2 章（Presenting the Case Study，全书连贯叙事载体）、第 16 章（Conclusion，社区展望）判「不覆盖」，非技术主题，不进本登记表。

### 3.3 第四批登记不补（2026-10-10 次轮，How Linux Works / Linux Bible 逐章核对）

触发：[覆盖核对与差异表](./coverage-matrix.md) §7（How Linux Works 3e 17 章）、§8（Linux Bible 11e 31 章）逐章判定——五本 A 级英文书最后两本完成对照。逐类登记如下：

| 主题 | 出处 | 不补理由 |
|------|------|---------|
| 设备文件与 udev 规则 | HLW 第 3 章 Devices | 设备节点与 sysfs 的语义已散见[存储设备](../hardware/storage.md)、[目录结构](../basic/filesystem/hierarchy.md)与源码篇驱动框架，udev 规则细节属设备适配范畴（与 ArchWiki 4.9 笔记本适配同判据） |
| 云厂商控制台部署 | Linux Bible 第 29 章 | 特定平台（AWS 等）控制台实操，超出单机学习定位；[云计算与 cloud-init](../server/cloud-computing.md) 已覆盖 IaaS 模型、实例与镜像、安全组与 VPC 等跨云通用机制 |
| Kubernetes 多节点编排 | Linux Bible 第 31 章、HLW 第 17 章 17.2.4 小节 | 编排系统超出单机定位；[容器](../server/container/docker.md) Compose 节已写明「超出单机范围（多节点调度、滚动升级、服务发现）后再评估 Kubernetes」的边界判断，落点即判断本身 |
| AI Chatbot 本地部署 | Linux Bible 第 22 章 | LLM 应用部署属应用软件范畴，与「学 Linux 系统本身」定位不同（第 11 版新增章，无既有对照压力） |

另有 HLW 第 15 章（Development Tools，gcc/make/lex/yacc）沿用 ArchWiki 核对轮「2.x 开发工具链不覆盖」判定；Linux Bible 第 16 章（Configuring a Print Server）沿用打印登记（USAH 第 12 章），均不重复入表。

## 4. 待复测（2026-10-08 断网轮降级项）与复测结果（2026-10-09 已执行）

原网络状况见[总览](./README.md)：2026-10-08 出境链路中断，调研降级为镜像实取 + 既有核验记录。**2026-10-09 出口恢复，以下复测当日完成**：

| 项目 | 10-08 状态 | 10-09 复测 | 结论 |
|------|-----------|-----------|------|
| `linux.vbird.org` 基础学习篇目录 | 官方不可达，取自镜像 | curl 实取官方页 200，24 个章标题逐条比对 | 与镜像版完全一致，[权威书籍调研](./authoritative-books.md) 1.1 节升级为官方直取 |
| `linux.vbird.org` 服务器架设篇目录 | 同上 | 官方页 200，12 个章标题逐条比对 | 与镜像版完全一致，1.2 节同升 |
| `wiki.archlinux.org` 目录页 | 官方不可达，取自中文镜像 | 官方页 200，解析出 8 个顶级类目、337 条编号条目 | 与镜像结构一致（336→337 为镜像时差，4.16 存储 17→18、8.12 内核 37→36、8.20 安全 39→38 等计数 ±1），[官方文档调研](./official-docs.md) 第 2 节类目结构升级为官方直取 |
| `www.debian.org/doc/manuals/debian-handbook/` | C 级，未取 | 200，落地页可读，确认书目（Debian Bullseye from Discovery to Mastery，Raphaël Hertzog / Roland Mas） | 入口确认；章级目录托管在 debian-handbook.info，本轮未取，维持 C 级不引用章节细节 |
| `docs.kernel.org` | C 级，未取 | 200 | 入口可达；文档分区未逐条取回，维持 C 级 |
| `systemd.io` | C 级，未取（登记为引用缺口） | 200 | 入口可达；引用缺口维持第 3 节登记 |
| `web.archive.org`、`linuxcommand.org`、`man7.org`、`pubs.opengroup.org`、`tldp.org`、镜像 `vbird.org.cn`、`wiki.archlinux.org.cn` | — | 均 200 | 通道全部恢复 |
| `www.gnu.org` | 断网轮失败 | 仍失败（curl 连接层 000，重试一次同样） | 域名级问题持续存在，GNU 手册引用维持依赖既有核验轮记录（B 级），不做新引用 |
| `docs.redhat.com` | 403 反爬 | 403（预期内） | 反爬行为与既往一致，双通道仲裁结论（B 级）不变 |
| 四本英文书（The Linux Command Line 等） | C 级仅书目 | linuxcommand.org 200，出版方入口可达 | 当日续测完成 C→A：TLCL 与 USAH 目录实取升 A 级，Debian Handbook 章目录一并实取；How Linux Works 与 Linux Bible 维持 C 级，明细见 §4.2 |

复测口径：curl 带浏览器 UA，`--max-time 15`，各域首页/目录页直访一次（瞬态不重试原则与既往巡检一致，唯 `www.gnu.org` 做了一次重试以排除偶发）。

### 4.1 页内「随版本核实」标记的核实（2026-10-09）

| 条目 | 核实方式 | 结果与处置 |
|------|---------|-----------|
| KVM 页：`virt-install` 在 Arch 独立拆分包、`dnsmasq` 为可选依赖需显式装 | Arch 官方包 API（archlinux.org/packages/search/json）逐一查询 | `virt-install` 独立包在 extra（5.1.0），`qemu-full` 在 extra，`dnsmasq` 为 extra 独立包——页内写法与官方包数据一致，标记可撤（页内本就未标核实，此处留档） |
| 桌面图形栈页：RHEL/Rocky 最小化 X 组名 `base-x` | Fedora comps（pagure 原始文件）与 Rocky comps 多路取源 | 均不可达（pagure raw 404、Rocky comps 无此文件、wayback 无快照）——**未确证**。页内措辞已降级：去掉照抄式组名，改为以 `dnf group list` 实测输出为准，并注明本稿核对时无法从公开 comps 源确证 |
| 交叉编译页：`dtc` 在 RHEL 系的包来源（疑经 EPEL） | CentOS Stream 9 镜像目录（AppStream/BaseOS Packages 列表） | `dtc-1.6.0-7.el9` 就在 AppStream——EL9 直装，页内已改为「EL9 已在 AppStream；更老版本若缺则经 EPEL」，标记撤 |
| 交叉编译页：RHEL 系 gdb 是否自带多架构目标 | Fedora gdb.spec 源（src.fedoraproject.org） | spec 明确 `--enable-targets` 全目标构建——RHEL 系 gdb 一个二进制通吃，页内已改为肯定陈述，标记撤 |

### 4.1.1 页内「随版本核实」标记的核实（2026-10-10 轮）

上轮核查后新增与残留的 5 处标记逐条核实，四个页面全部撤标改肯定句：

| 条目 | 核实方式 | 结果与处置 |
|------|---------|-----------|
| SSH 页：`TrustedUserCAKeys` 条目 | 本机 man sshd_config（OpenSSH 10.2p1）直读 | 条目存在，拼写为 TrustedUserCAKeys（页内原 TrustedUserCAkeys 系笔误，一并改正）；标记撤，改为「指令以 man sshd_config 为准」 |
| 云计算页：cloud-utils-growpart 的 RHEL 系包名 | CentOS Stream 9 AppStream Packages 目录列表 | `cloud-utils-growpart-0.31-10.el9` 在库；标记撤，改为肯定句并附实测版本 |
| LDAP 页：Arch slapd 监听配置路径 | Arch Wiki OpenLDAP 页实取 | `/etc/conf.d/slapd` 的 `SLAPD_URLS` 由 slapd.service 读取；标记撤，改为肯定句（此前「systemd 单元覆盖」措辞不确，已换成实测路径） |
| LDAP 页：memberof overlay 载入方式 | man slapo-memberof(5)（manpages.ubuntu.com）+ OpenLDAP 2.6 管理指南（openldap.org，两源均 200） | 动态配置经 back-config 载入（`olcModuleLoad: memberof` + `olcOverlay: memberof`；2.5 起参数族改名 `olcMemberOfConfig`），slapd.conf 静态部署写 `overlay memberof`——语法跨 2.4/2.5/2.6 稳定，标记撤 |
| CI/CD 页：Gitea Actions 兼容程度 | docs.gitea.com 官方文档（web_reader 通道渲染取文） | 官方口径：1.19 起内置、设计上与 GitHub Actions 兼容且存在差异（有 Compared to GitHub Actions 专页）；标记撤，改为肯定句，参考资料补 Gitea 文档链接 |

### 4.2 四本英文书与 Debian Handbook 的 C→A 升级（2026-10-09 续测）

§4 表末行登记的「C→A 升级留待取回目录原文」当日续办，逐本处置如下，章题照录落点在[权威书籍调研](./authoritative-books.md) 2.1 节：

| 书 | 取回来源 | 结果 |
|----|---------|------|
| The Linux Command Line | linuxcommand.org/tlcl.php 书目页 + 官方免费 PDF `TLCL-25.12A`（SourceForge 官方项目直下，533 页） | 升 A：第 7 网络版（PDF 版权页 © 2026），4 部 36 章目录实取 |
| UNIX and Linux System Administration Handbook | 官方站 admin.com（站内自述第五版）样张目录 samples/TOC.pdf | 升 A：4 篇 31 章目录实取 |
| The Debian Handbook | debian-handbook.info 官方在线版目录页（stable，Debian 11 Bullseye） | 升 A：16 章目录实取（此书在 §4 表中原为「章级目录托管在 debian-handbook.info，本轮未取」项） |
| How Linux Works | nostarch.com 产品页实取 | 维持 C：页内无目录区块、无样章 PDF 链接 |
| The Linux Bible | Wiley 产品页实取（ISBN 9781119909792） | 维持 C：仅书目字段，目录由前端脚本渲染，静态抓取不可得 |

引用纪律随之更新：A 级三本可在正文引用章节结构（分部与章题），C 级两本仍按「书名 + 出版方 + 入口」形态引用。

### 4.3 剩余两本英文书的 C→A 升级（2026-10-10 次轮）

§4.2 表中「维持 C」的两本当日续办完毕，各找到出版方一手目录来源：

| 书 | 取回来源 | 结果 |
|----|---------|------|
| How Linux Works, 3rd Edition | nostarch.com 新版[产品页](https://nostarch.com/howlinuxworks3)（Table of contents 区块，含完整章列表）+ 官方[详细目录 PDF](https://nostarch.com/download/samples/HLW3rd_DTOC.pdf) 交叉核对 | 升 A：Introduction + 17 章。产品页章列表第 15 章误标 "The Big Picture"，详细目录 PDF 作 "Development Tools"，以 PDF 为准并在[权威书籍调研](./authoritative-books.md) 2.1 节留档。§4.2 记录的旧产品页（`/how-linux-works-3rd-edition`）已 404，「无目录区块」结论系旧版页面布局所致 |
| The Linux Bible | Wiley 官方[第 11 版产品页](https://www.wiley.com/en-us/linux-bible-11th-edition-p-9781394317462)（ISBN 978-1-394-31746-2，2025-12，896 页）+ 页内官方 TOC PDF（`media.wiley.com/product_data/excerpt/68/13943174/1394317468-12.pdf`） | 升 A：6 部 31 章（第 11 版目录）。§4.2 记录的「目录由前端脚本渲染」系旧版页面结论；另原登记 ISBN `9781119909792` 在出版方页面与公开检索均无对应，以官方页实取 ISBN 更正 |

辅助通道记录：Google Books API 当日配额超限（429）、OpenLibrary 无目录字段，均未采用；两本书的目录最终都来自出版方自有页面/样张文件，属 A 级一手来源。至此五本英文书全部升 A，逐章对照见[覆盖核对与差异表](./coverage-matrix.md) §7、§8。
