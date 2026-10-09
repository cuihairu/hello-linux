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

## 2. 本轮修订（3 处，均注明触发）

1. **存储篇 LVM 指向落地**。`docs/hardware/storage.md` 里「LVM 的实操归基础篇与系统管理篇」的链接此前指向 `../system-management/README.md`，该 README 并无 LVM 实操内容，属于有指向、无落点；现指向新页 [LVM 逻辑卷管理](../system-management/lvm.md)。（触发：差异表「部分覆盖→本轮修订」行）
2. **基础篇软件安装章目录补齐第三系**。`docs/basic/packages.md` 章导语由「本章两页」改为三页并补 Pacman 页介绍条目；`docs/basic/README.md` 覆盖范围注从「Arch 的 pacman 在发行版简介有对照」改为指向新页。（触发：差异表同上）
3. **README 篇章表与参考资料补入研究篇**。中英双语 README 的内容表各补一行研究篇，参考资料各补一条站内调研入口；`docs/index.md` 首页特性卡片补研究篇并订正五处章节数（基础 36→37、硬件 6→7、系统管理 8→9、服务器 16→17、安全 7→8）。（触发：差异表同上）

接线记录：`docs/SUMMARY.md` 补 5 页与新「研究篇」节；`docs/.vitepress/config.mts` nav 补研究篇、sidebar 补 6 页与 `/research/` 组；`docs/security/hardening.md` MAC 段落补 SELinux 实战与 AppArmor 实战两处链接。

## 3. 登记不补（2，避免下一轮重复排查）

- **嵌入式交叉编译专题**（触发：应用场景调研 1.2 节——全仓 `交叉编译` 零命中）。涉及设备树、内核裁剪、交叉工具链与启动引导，是一整块独立体系，本轮只以场景页给出阅读路径（源码篇[设备驱动框架](../source/driver-framework.md)与硬件篇[计算机体系结构](../hardware/architecture.md)是现有入口），专题页留待下一轮。
- **LDAP 统一账号**（触发：应用场景调研 1.4 节——运维主线缺「多机账号一致性」）。鸟哥服务器篇第十一章有整章，本仓散落提及无专页，下一轮并入系统管理篇或服务器篇。
- 另登记一处引用缺口：systemd 文档（`systemd.io`）本仓无直接引用，系统管理篇相关页目前靠 ArchWiki 与 RHEL 文档支撑，下一轮补引用。

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
| 四本英文书（The Linux Command Line 等） | C 级仅书目 | linuxcommand.org 200，出版方入口可达 | 维持 C 级：目录未取回，仍不得在正文中引用其章节结构；C→A 升级留待取回目录原文 |

复测口径：curl 带浏览器 UA，`--max-time 15`，各域首页/目录页直访一次（瞬态不重试原则与既往巡检一致，唯 `www.gnu.org` 做了一次重试以排除偶发）。
