# 内容复核（2026-10-19）

## 复核范围

先执行 `git fetch origin && git pull --rebase origin main`：工作区干净，分支已是最新，无 rebase 冲突。实际复核最近 4 个提交（符合约定的 3–4 个范围）：

- `dee3df3` Align docs with notes voice（C：定位与口径）
- `e64ead6` Clarify cross-topic notes（B：跨主题重复收敛）
- `887a770` Unify docs navigation（A：导航统一）
- `6f24a13` Add docs structure audit（结构审计基线）

复核时发现的技术错误在独立提交 `0d1aa79` 修正；上述被复核提交历史未改写。

## 四项核查

### 1. 内容丢失

**结论：发现一项具体信息在合并时未迁移，已补回并校正适用范围；未发现 SUMMARY 内容性条目被精简删除。**

- `e64ead6` 将 `docs/network/firewall.md` 原 `:92-98` 的三系差异说明和示例合并到安全篇。前后对照：原 `:96-98` 写明 firewalld 的 `public` 区允许 `ssh、dhcpv6-client、cockpit 等服务`；合并后 `docs/security/firewall.md:170` 却断言它“只放行 ssh 和 dhcpv6-client”，漏了 cockpit 情形并把示例概括成绝对规则。
- 修复后 `docs/security/firewall.md:170,186` 说明常见服务包含 `ssh`、`dhcpv6-client`，启用 Web 控制台的环境还可能包含 `cockpit`，并要求以当前 `firewall-cmd --list-all` 为准；`:309` 的操作清单也改为检查实际白名单，而非要求 `public` 只有 ssh。`:336` 补充了 Red Hat 文档来源。Red Hat RHEL 9 文档示例确有 `cockpit dhcpv6-client ssh`：[Red Hat firewalld 配置](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_firewalls_and_packet_filters/using-and-configuring-firewalld)。修复提交：`0d1aa79`。
- 其余合并内容对照：`docs/basic/boot.md:7` 新增系统管理篇排错链接，原有 BIOS/UEFI、GRUB 配置与救援说明均保留；`docs/system-management/boot-process.md:3` 将通用启动链概述改为指向基础篇，但本页的五阶段诊断与救援内容仍在（如 `:17-36`、`:61`）；`docs/system-management/logging.md:16` 将 journald/rsyslog 概念改为链接基础篇，检索、保留、管线等运维内容仍在（如 `:16`、`:18`、`:285`）。没有发现其他独有技术内容被删。
- `docs/SUMMARY.md:3` 仅增加其作为侧栏派生索引的维护说明；原有目录条目保留，并在 `:183-186` 增加审计/复核报告入口。此次不是大幅精简 SUMMARY。

### 2. 表述被改错

**结论：README 和首页没有发现数字与实际不符；阅读路径语义调整没有把技术含义改反。**

- `README.md:18,40` 与 `README.zh.md:18,40` 将“从零学习”“每章都有示例”改为个人笔记定位及“许多笔记包含实践示例”，范围更谨慎。`README.md:104`、`README.zh.md:104` 将 126/128 改称历史巡检快照，没有继续冒充当前计数。
- `docs/index.md:9-43` 删除“38章、20章”等旧计数，改为主题摘要。按复核基线实际清点：148 个已跟踪 Markdown 文件、146 个索引内容条目、10 个主题目录；148 包含目录/首页及结构审计文档等，不等于主题页数。`npm run docs:check` 的索引结果为 `entries=146, listed=146, orphan=0`，与侧栏对账。此报告入库并加入导航后，内容条目相应增加 1。
- `docs/knowledge.md:8` 把“按概念→命令→服务→排错”的学习骨架改为内容脉络，并明确不要求固定顺序；`docs/research/application-scenarios.md:39-72` 将编号阅读路线改成无序相关页面索引。其链接主题仍与描述相符，安装到服务、桌面、嵌入式、运维相关页面都保留在应用场景页；语义变化是取消必读顺序，不是改变技术步骤的含义。
- 复核基线有 148 个已跟踪 Markdown；新增本报告后为 149 个，SUMMARY/sidebar 当前收录 147 个内容页。`docs:check` 源文件与索引检查通过，但其 sitemap 读取的是 148 页旧构建产物；未核实：本轮没有重新构建 VitePress，不能据此声称新报告已进入构建产物。

### 3. 链接与导航

**结论：新增、改名的导航项均有对应文件；抽查目标主题相符；仓库链接检查通过。**

- `docs/.vitepress/config.mts:556,599` 与 `docs/SUMMARY.md:131,143` 将两个同名防火墙入口分别改为“策略设计”→ `security/firewall.md` 和“连通排障”→ `network/firewall.md`。目标页面主题与标签一致，两个页面正文也互相说明分工（`docs/security/firewall.md:3`、`docs/network/firewall.md:3`）。
- `docs/.vitepress/config.mts:726-750` 新增 `/knowledge` 和 `/review/` 侧栏；`docs/knowledge.md`、审计页及本报告均存在。SUMMARY 的知识点、结构审计与内容复核条目分别指向对应文件。README 里的 SUMMARY URL 和首页 `/SUMMARY` 仍指向目录页。
- `npm run docs:check`（报告导航加入后）结果：`issues=0`、`pass=33683 fail=0`；索引 147/147、无孤儿页；脚本列出的 sitemap 为旧产物 148/148，未包含尚未重新构建的本报告。
- 未核实：除用于确认 cockpit 示例的 Red Hat 页面外，没有对本轮未改动的外部引用做可达性巡检；静态仓库检查不证明所有外站当前可访问。

### 4. 未通过的项目与待拍板事项

**结论：无未修复的明确错误；无须用户拍板的内容删并取舍。** 防火墙独有的 cockpit 信息已迁至权威页并准确限定，其他拆分均保留不同角度，没有删除整篇页面。

## 问题清单

| 严重度 | 问题 | 状态 / 提交 |
|---|---|---|
| 中 | firewalld `public` 区白名单被概括为只有 ssh、dhcpv6-client，漏掉 cockpit 情形；见修复前 `docs/security/firewall.md:170,309` 与被合并段落 `docs/network/firewall.md:96-98` | 已修，`0d1aa79` |

## 验收结论

发现 1 个明确技术错误，已在独立提交修正；结构、其余表述、导航和索引核查未见其他问题。修复提交已完成，最终 `docs:check` 为 0 issues；**报告与修复提交推送后，这批改动可视为已验收**。本次未重新构建 VitePress，构建产物状态未核实。
