# hello-linux 文档结构审计（2026-10-19）

范围：只读检查仓库现有文档与导航；不改现有结构。统计以仓库中的 Markdown 源文件为准，行数为 `splitlines()` 结果。`docs/.vitepress` 和 `docs/public` 是构建配置/静态资源，不计作内容主题目录。

## 量化事实

### docs 下一级主题目录

下表按目录递归统计 `.md` 文件数和总行数；根层 Markdown 共 4 篇（`index.md`、`SUMMARY.md`、`knowledge.md`、`glossary.md`），另有主题目录合计 143 篇。全站源文件合计 147 篇、41,034 行。

| 下一级目录 | Markdown 数 | 总行数 |
|---|---:|---:|
| basic | 38 | 6,818 |
| commands | 20 | 7,286 |
| hardware | 7 | 1,855 |
| network | 10 | 6,066 |
| research | 6 | 806 |
| script | 10 | 1,988 |
| security | 8 | 2,468 |
| server | 21 | 5,562 |
| source | 14 | 4,377 |
| system-management | 9 | 3,172 |
| 根层（无目录） | 4 | 636 |
| **合计** | **147** | **41,034** |

### 组织轴

按读者如何找到内容区分，现有 **3 套并行组织轴**。前两套组织内容，第三套承担导航索引；它们大体互相对账，并非三份互不相干的分类。

| 目录/载体 | 条目数 | 命名规律 | 有无编号 | 编号连续性 |
|---|---:|---|---|---|
| `docs/{basic,commands,hardware,network,research,script,security,server,source,system-management}/` | 10 个主题目录、143 篇 Markdown（含 10 篇目录 README） | 英文小写目录名；主题页以英文小写 kebab-case 为主，README 作主题入口 | 无编号前缀 | 不适用；全量文件名数字前缀为 0 |
| 上述主题目录内的子目录层级 | 21 个子目录；集中于 `basic`（9）、`commands`（5）、`server`（7） | 先主题后子主题；目录名多为英文小写，文档名以 kebab-case 为主，少量 snake_case | 无编号前缀 | 不适用；层级不是章节编号 |
| `docs/.vitepress/config.mts` sidebar + `docs/SUMMARY.md` | sidebar 配置引用 145 个内容页；SUMMARY 列出 145 个条目；另有 nav 13 项 | sidebar 分主题折叠分组；SUMMARY 用中文标题和相对路径，分别是站内导航与人工目录 | 无编号 | 不适用；同一主题内容通过两个导航入口呈现 |

仓库没有独立的“编号章节”“指南”“API”“history”顶层组织目录。`history` 等词出现在页面标题/正文中，不构成独立组织轴。数字前缀扫描范围为 `docs/**/*.md`（排除 `.vitepress`）：0 个匹配，因此不存在可列出的断档、跳号或重复编号。

### 侧边栏与文件对账

从 `docs/.vitepress/config.mts` 的全部内部 `link` 字段（nav 和 sidebar）抽取路径，并按 VitePress 的 `.md`/README 路径规则对照源文件；文件覆盖再与 `docs/SUMMARY.md` 对账：

| 对账项 | 数量 | 结果 |
|---|---:|---|
| Sidebar 中配置但源文件不存在 | 0 | 无条目 |
| 源 Markdown 存在但未进入 sidebar | 0 | 无条目（首页及 SUMMARY 是导航入口/目录，非侧栏内容页） |
| SUMMARY 列出但源文件不存在 | 0 | 无条目 |
| 源文件未被 SUMMARY 收录 | 0 | 无孤儿页 |

两组各列前 10 条：均为空（不存在可列条目）。这一结果也与 `scripts/check_links.py` 的 `index` 统计相符：`entries=145, listed=145, orphan=0, sidebar_ok=145, unlisted=0`。

## 问题清单（按严重度）

### 中：主题交叉使读者可能重复检索，边界需要读者自行辨认

- `docs/security/firewall.md:3,11` 明确定位为安全策略视角，并引导读者到 `docs/network/firewall.md`；后者 `docs/network/firewall.md:9-12` 从连通性和排障角度讲同一主题。两篇自述分工清楚，属于有意识的交叉覆盖，但目前 sidebar/SUMMARY 都只呈现相同标题“防火墙”，目录层面看不出视角差异。路径：`docs/security/firewall.md`、`docs/network/firewall.md`、`docs/SUMMARY.md:129,141`、`docs/.vitepress/config.mts:556,599`。
- 开机与日志也跨主题重复：基础篇 `docs/basic/boot.md`、`docs/basic/log.md` 对应系统管理篇 `docs/system-management/boot-process.md`、`docs/system-management/logging.md`。后两页标题强调运维排错/管理，前两页是基础概念入口，现有命名有区分但用户需跨目录比较。路径：`docs/basic/boot.md`、`docs/system-management/boot-process.md`、`docs/basic/log.md`、`docs/system-management/logging.md`；导航列于 `docs/SUMMARY.md:19,86-87` 及 `docs/.vitepress/config.mts:112-122,374-403`。
- 定性：这是“主题交叉可发现性”问题，不是已证实的内容冲突；尚未逐段比对四对页面的重复率，重复程度未核实。

### 低：文件名风格有少量例外

- 大多数内容页用小写 kebab-case，如 `docs/system-management/backup-and-recovery.md`、`docs/network/network-configuration.md`；少数用 snake_case，如 `docs/basic/installation/choose_distribution.md`、`docs/basic/users/account_management.md`、`docs/commands/system/system_info.md`；大小写混合目前仅见 `docs/basic/packages/yum.md` 之外的内容名中未发现异常（扫描到的词项以小写为主）。
- 英文路径与中文标题有意并存，便于 URL 稳定、页面面向中文读者；这不是错误。根目录 `README.md`/`README.zh.md` 是清楚的语言版本对，`docs/` 内 10 个主题目录各有 `README.md` 作为目录页，不是误放的重复 README。
- 路径：示例见上；目录页见 `docs/basic/README.md`、`docs/commands/README.md` 等。文件名完整清单来自 `docs/**/*.md`。

### 未发现的候选问题（明确记录）

- 编号断档、跳号、重复：未发现；整个 docs 内容树没有数字前缀 Markdown 文件。
- Sidebar 死路径/孤儿 Markdown：未发现；两组差异均为 0。
- 源码级死链：未发现（工具结果见下）。
- 根目录临时 Markdown、重复 README：未发现临时文件。根层有 `README.md` 与 `README.zh.md`，由首行语言切换互链，属于英/中文版本，不建议合并；`.pytest_cache/README.md` 是工具缓存，不是项目文档，且被 Git 忽略/不在追踪清单中。

### 死链核验结果与限制

- 执行 `npm run docs:check`：返回 `issues: 0`、`RESULT pass=33181 fail=0 total=33181 rate=100.0000%`。源链接、锚点及索引检查通过。
- 该检查也读取已有 `docs/.vitepress/dist`（目录时间为 2026-10-13）；HTML/sitemap 汇总为 147 个 loc 可达、页面在册。由于这是历史构建产物，产物级结果不能证明当前源文件重新构建后的 HTML 一致，当前重新构建结果未核实。
- 执行 `npm run docs:build` 未能启动：`sh: 1: vitepress: not found`。因此本次没有获得当前源文件的新构建结果。外部站点链接（检查器记录 2,825 项）只按 URL 格式跳过，没有发起网络可达性核验；外链状态未核实。
- 证据路径：`package.json` 中 `docs:check`、`docs:build` 脚本；检查实现 `scripts/check_links.py`；产物目录 `docs/.vitepress/dist`。

## 判断与推荐

目录的主轴是主题目录，整体可以理解为 **3 套组织轴：主题分类、主题内层级、导航索引**。不建议把它们压成一套：主题目录适合浏览和扩展，子目录适合拆分长篇内容，sidebar 与 SUMMARY 分别服务网页导航和可编辑目录，当前二者对账为完整。建议维持“主题为主、必要时主题内分层、单一内容源由两种导航呈现”的框架；未来新增页面继续按主题归位，避免新增编号章节或平行指南/API 栏目。

| 问题 | 严重度 | 理由 |
|---|---|---|
| 跨主题同名入口（防火墙等）未在目录标题表达视角 | 中 | 页面正文已交代分工，但导航标题相同，发现成本较高；不构成死链或已证实冲突 |
| 少量 snake_case 与 kebab-case 混用 | 低 | 影响 URL/文件名一致性，但不影响现有链接；改名需同步引用，收益小于机械风险 |
| 无法用当前依赖重建站点 | 中（核验风险） | VitePress 未安装使本次不能证明新构建结果；旧 dist 检查通过但不能替代新构建 |

### 其实不乱、不用动

- 10 个顶层目录名称表达主题，且每个主题有 README 入口；目录深度集中在需要细分的大篇章，没有按序号把内容拆散。
- 不存在数字章节编号，因此没有断号/跳号债务。
- sidebar 与 SUMMARY 对 145 篇内容页完整收录，当前检查无孤儿页、无配置死路径；不需要为了“看起来统一”重排全部页面。
- `README.md`/`README.zh.md` 是显式语言版本对；主题目录里的 README 是各自入口页，不是重复文件。
- 防火墙在安全与网络两个目录的正文分别说明策略和连通性/排障视角，属于合理的跨学科复用；适合改善导航文案，不应仅因同名就删除其一。

## 三期收口方案

| 阶段 | 动作清单 | 影响范围 | 风险（链接/搜索/外链） | 用户拍板 |
|---|---|---|---|---|
| 一期：机械整理（约 1 小时，不改 URL） | 建立一份新增页核对清单：改文件名时先全仓搜索引用；给交叉主题页面标题/摘要增加视角说明（可先只改 sidebar 文案）；明确后续统一 kebab-case 的规则，新文件遵循规则，旧名暂不批量改。 | 少量导航标题、后续贡献规范 | 不改 URL 时链接和外链风险低；若只调整显示标题，搜索索引内容不变。按用户要求，本次审计不执行此期改动。 | **无需拍板**可先定新文件命名约定；现有页面是否加视角副标题可由维护者决定。 |
| 二期：导航与重定向 | 若决定调整路径或合并同类入口，先列旧 URL→新 URL 映射；更新 `config.mts`、`SUMMARY.md`、正文交叉引用与 README；增加 VitePress redirect 配置/兼容页并重新构建对账。 | sidebar、SUMMARY、站内 Markdown 链接、部署 URL | 路径调整会影响搜索收录和外部书签；无重定向时外链会断。redirect 方案降低但不能消除搜索迁移风险。 | **必须用户拍板**是否变更公开 URL、是否接受搜索索引迁移，以及旧 URL 保留多久。 |
| 三期：内容删并与章节重构 | 对重复候选页逐段比较，确定主页面与专门视角；如需合并则迁移独有内容、改标题/导航、保留旧 URL 重定向，并更新引用和目录。优先评估防火墙、开机、日志，避免仅按主题词机械合并。 | 4 组候选页面及其链接/章节结构；可能影响全文搜索 | 内容删除/合并可能丢失独有解释、改变搜索关键词命中和外部引用；必须逐页审阅并保留重定向。 | **必须用户拍板**内容边界、主归属、是否删除重复章节、URL 兼容期限；不能由结构审计单方面决定。 |

## 最该先做的三件事

1. 在有依赖的环境重新运行 `npm ci`、`npm run docs:build` 与 `npm run docs:check`，确认新产物而非旧 dist 通过；当前构建因缺少 VitePress 未核实。
2. 为 sidebar/SUMMARY 中同名的跨主题条目标明视角（优先防火墙），保持页面与 URL 不变，降低读者误认为重复内容的概率。
3. 先做防火墙、开机、日志页面的逐段重合度与独有内容盘点，再由维护者决定是否需要二/三期路径调整或合并；当前证据不足以直接删并。
