# 源码分层分析（2026-11-08）

本文按职责而非目录名描述仓库，分析对象是 HEAD `a5e5f2e8bba34fd7d1c1d48473728602a59a104d` 的源码树。依赖锁、缓存、`node_modules` 与构建产物被视为状态，不算源码模块。

## 抽象层清单

| 层 | 职责 | 代表实现 | 状态 |
|---|---|---|---|
| L1 — 文档产品 | 持有中英双语的 Linux 教学内容和源码级证据。 | [内核源码篇](../source/README.md) | 工作树中的 Markdown 文件 |
| L2 — 站点呈现与语言投影 | 把同一组路由投影为英文/中文标签、导航、侧边栏和界面文案。 | `docs/.vitepress/config.mts` | 内存中的导航对象 |
| L3 — 静态构建与发布 | 把 Markdown、静态资源和站点配置转成 GitHub Pages 产物。 | `package.json` | 单次调用的 `docs/.vitepress/dist` |
| L4 — 站点完整性服务 | 校验链接、锚点、路由/目录覆盖、sitemap 覆盖和已生成 HTML，不访问外网。 | `scripts/check_links.py` | 对源码和当前产物只读 |
| L5 — 确定性插画服务 | 用种子生成地形/树林构图，按需输出 ANSI、HTML 或 PNG。 | `scripts/tree_art.py` | 进程内存；可选输出文件 |
| L6 — 工具验证装置 | 在临时站点或纯对象中隔离验证 Python 工具，并强制行/分支全覆盖。 | `tests/conftest.py` | pytest 临时目录 |

源码中没有 Redis、MySQL、队列或 RPC 服务。持久输入只有工作树文件与脚本参数；持久输出只有构建页面、可选插画文件和 GitHub Pages 部署结果。

## 模块/服务清单

- **文档产品**：英文与中文各有 150 篇 Markdown。内核源码篇的模块化组织写在 `docs/source/README.md:23`，中文网络配置篇的覆盖范围写在 `docs/zh/network/network-configuration.md:29`。
- **语言投影与呈现**：`project()` 把双语 `[English, Chinese]` 节点转成本地化链接（`docs/.vitepress/config.mts:16`）；根语言与 `/zh/` 语言定义消费该投影（`docs/.vitepress/config.mts:409`）。
- **构建与发布**：`docs:build` 命令声明在 `package.json:7`；CI 先构建（`.github/workflows/deploy.yml:63`），再上传 `docs/.vitepress/dist`（`.github/workflows/deploy.yml:70`），最后部署 Pages 产物（`.github/workflows/deploy.yml:84`）。
- **站点完整性服务**：`main()` 按固定顺序执行源码、配置、索引、sitemap 和 HTML 检查（`scripts/check_links.py:511`）。它把结构审计提出的路由覆盖判断变成可执行策略（`docs/zh/review/structure-audit-2026-10-19.md:79`）。
- **插画服务**：`main()` 解析 CLI，构造世界，组合字符网格，并可选写入 HTML/PNG（`scripts/tree_art.py:327`）。
- **验证装置**：pytest 只发现 `tests`（`pytest.ini:2`），通过 `tests/conftest.py:4` 导入脚本，并要求两个 Python 服务达到 100% 行/分支覆盖（`.coveragerc:2`、`.coveragerc:10`）。

## 分层细节

### L1 — 文档产品

**职责。** 用同步的中英文语料记录机制、命令、配置实践、调研和面向本仓库的术语。

**实现。** 内容是 `docs` 下的 Markdown，包括主题入口 `docs/source/README.md:1` 和长篇模块解释 `docs/zh/network/network-configuration.md:43`。根目录 `README.md` 是仓库文档而不是站点章节，介绍两个 Python 工具（`README.md:68`）。

**配置 schema。** 内容没有 schema 文件，也不要求 front matter；源码契约就是 Markdown 结构、内部链接、标题和被索引的路由。

**协议。** Markdown 和相对链接是内部协议。术语表刻意把定义、权威出处和相关页组织在一起（`docs/glossary.md:3`、`docs/glossary.md:258`）。

**文案位置。** 教学文案与中文对应文分别位于 `docs` 和 `docs/zh`；术语文案在 `docs/glossary.md:1` 与 `docs/zh/glossary.md:1`。

**状态与生命周期。** 状态是版本控制文本，通过普通提交变化；没有任何进程在运行时持有内容。

### L2 — 站点呈现与语言投影

**职责。** 保持路由身份共享，同时呈现各语言标签、链接、导航层级和界面文字。

**实现。** `NavNode` 声明双语标签和折叠状态（`docs/.vitepress/config.mts:9`）；`project()` 递归地把根路由映射成 `/route` 或 `/zh/route`（`docs/.vitepress/config.mts:16`）。`NAV` 是精简路由列表（`docs/.vitepress/config.mts:26`），`SIDEBAR` 是完整浏览树（`docs/.vitepress/config.mts:42`）。

**配置 schema。** 站点配置就是 schema 来源：输入节点形状本地声明在 `docs/.vitepress/config.mts:9`，VitePress 类型导入在 `docs/.vitepress/config.mts:2`，导出的 `defineConfig()` 定义 base、语言、sitemap 和 head（`docs/.vitepress/config.mts:409`）。

**协议。** 没有独立路由或翻译文件。根路由是协议；`docs/SUMMARY.md` 与 `docs/zh/SUMMARY.md` 是可编辑目录，并与该协议对账。

**文案位置。** 界面文案在 `themeFor()` 内本地化，包括页面导航、页脚、编辑链接和搜索字符串（`docs/.vitepress/config.mts:346`）。站点标题和描述目前是单语言元数据（`docs/.vitepress/config.mts:410`）。

**状态与生命周期。** 导航在构建或开发服务器启动时在内存中求值，不持久化独立状态。

### L3 — 静态构建与发布

**职责。** 生成可路由静态站点，并在检查通过后把同一次构建输出升级为 GitHub Pages 发布物。

**实现。** VitePress 通过 `package.json:7` 的 `docs:build` 调用；部署顺序由 `.github/workflows/deploy.yml:63` 到 `.github/workflows/deploy.yml:84` 编排。

**配置 schema。** VitePress schema 由 `docs/.vitepress/config.mts:409` 提供；base 是 `/hello-linux/`（`docs/.vitepress/config.mts:412`），sitemap 声明在 `docs/.vitepress/config.mts:434`，head 资源在 `docs/.vitepress/config.mts:441`。CI 输入包括 Node/Python 版本和 Pages 权限（`.github/workflows/deploy.yml:21`、`.github/workflows/deploy.yml:41`）。

**协议。** 没有专属协议文件。输入是仓库文件；对接部署的协议是 `.github/workflows/deploy.yml:70` 上传的产物目录。

**文案位置。** 面向发布的仓库说明在根 README（`README.zh.md:84`）；工具运行时文案属于被调用工具。

**状态与生命周期。** `docs/.vitepress/dist` 是单次构建输出，不是源码模块。生命周期从推送或手动触发开始（`.github/workflows/deploy.yml:5`），到部署成功或校验失败结束。

### L4 — 站点完整性服务

**职责。** 在发布前证明源码链接、语言索引、配置路由、生成 HTML 和 sitemap 一致。

**实现。** CLI 契约与三种模式记录在 `scripts/check_links.py:2`；路径常量在 `scripts/check_links.py:24`；`main()` 统一编排所有检查（`scripts/check_links.py:511`）。

**配置 schema。** 没有配置文件。输入是隐含仓库路径（`scripts/check_links.py:24`）、当前 `DIST` 是否存在（`scripts/check_links.py:26`），以及可选 `--require-html`（`scripts/check_links.py:619`）。

**协议。** 代码内解析 Markdown、HTML 属性、标题 ID 和 sitemap `<loc>`。正则定义在 `scripts/check_links.py:29` 到 `scripts/check_links.py:37`；sitemap 协议提取器在 `scripts/check_links.py:380`。协议定义没有专属文件。

**文案位置。** 用户可见输出是控制台文本和问题元组，由 `main()` 组装（`scripts/check_links.py:557`）。

**状态与生命周期。** 服务读取源码和已有产物但不写文件；以 CLI 运行（`scripts/check_links.py:625`），也在 CI 中作为检查步骤运行（`.github/workflows/deploy.yml:65`）。

### L5 — 确定性插画服务

**职责。** 把种子化的程序化世界转成可复现的终端、HTML 或 PNG 构图。

**实现。** 噪声与分形采样分别在 `scripts/tree_art.py:25`、`scripts/tree_art.py:48`；地形状态与河流雕刻由 `World` 承担（`scripts/tree_art.py:103`、`scripts/tree_art.py:128`）；四叉树细分与网格组合分别在 `scripts/tree_art.py:203`、`scripts/tree_art.py:222`。

**配置 schema。** CLI 定义种子、尺寸、输出目标和 quiet 模式（`scripts/tree_art.py:328`）；色板与生物群落字符是仓库常量（`scripts/tree_art.py:66`），不是外部配置。

**协议。** ANSI 转义序列（`scripts/tree_art.py:256`）和生成的 HTML 文档（`scripts/tree_art.py:275`）是内联输出协议；PNG 截图通过 Playwright 和 Chromium 访问本地 `file://` 页面（`scripts/tree_art.py:313`）。没有专属协议文件。

**文案位置。** 终端统计和生成 HTML 的标题/图例使用脚本内中文文案，见 `scripts/tree_art.py:295` 与 `scripts/tree_art.py:350`。

**状态与生命周期。** 世界状态在进程内存中；可选 HTML/PNG 是调用者指定文件，站点构建不会读回它们。

### L6 — 工具验证装置

**职责。** 在隔离环境中测试两个 Python 服务，并强制完整分支级行为覆盖。

**实现。** 链接检查场景导入服务，并把仓库根替换成临时假站点（`tests/test_check_links.py:22`、`tests/test_check_links.py:31`）。插画场景覆盖纯生成、渲染、CLI 和截图接缝（`tests/test_tree_art.py:27`、`tests/test_tree_art.py:501`）。

**配置 schema。** pytest 输入在 `pytest.ini:1`；覆盖范围和 100% 门槛在 `.coveragerc:2`、`.coveragerc:10`。套件由 `package.json:10` 的 `docs:test` 与 `docs:cov` 调用。

**协议。** 没有线协议。装置使用 pytest fixture、monkeypatch、临时文件、进程输出捕获和直接导入。

**文案位置。** 测试意图和覆盖说明写在测试 docstring 中，如 `tests/test_check_links.py:1`、`tests/test_tree_art.py:1`。

**状态与生命周期。** 测试分配临时状态并由 pytest 释放；生命周期是一次本地或 CI 调用（`package.json:11`、`.github/workflows/deploy.yml:67`）。

## 调用面

| 调用方 | 通道 | 被调方 | 契约 |
|---|---|---|---|
| 开发者或 CI | shell/npm | VitePress 构建 | 读取 Markdown、资源和 `config.mts`；写入 `docs/.vitepress/dist` |
| 开发者或 CI | shell/Python | `check_links.py` | 读取源码和可选产物；返回退出码与控制台报告 |
| 开发者或 CI | shell/pytest | Python 单测装置 | 导入 `check_links` 与 `tree_art`；返回测试和覆盖结果 |
| CI | workflow step | GitHub Pages artifact API | 上传并部署一次 Pages 产物 |
| 用户 | CLI | `tree_art.py` | 输入种子与尺寸；输出 ANSI/HTML/PNG |
| `tree_art.py` | Python import | Playwright | 通过 `file://` 打开生成 HTML，并截取 body |

各层之间没有 Redis、MySQL、HTTP API、消息队列或另一方的常驻进程调用。

## 配置输入与生命周期

| 输入 | 消费者 | 作用 |
|---|---|---|
| 工作树 Markdown 与资源 | VitePress、完整性服务 | 形成站点路由、页面文本和被检查目标 |
| 根路由与双语标签 | 语言投影、构建 | 生成两棵导航树和界面文案 |
| `package.json` 脚本 | 开发者/CI shell | 构建、预览、完整性检查、测试和覆盖 |
| workflow 触发器与 runner 变量 | 部署 workflow | 控制 CI 生命周期和产物升级 |
| `--require-html` | 完整性服务 | 产物级阶段不可用时拒绝通过 |
| 种子、宽高、输出路径 | 插画服务 | 生成确定性世界和可选输出文件 |
| pytest 与 coverage 设置 | 验证装置 | 临时站点测试与全分支门槛 |

常规生命周期：编辑 L1/L2 源；L3 构建；L4 校验源码与产物；L6 验证 Python 行为；最后发布 L3 输出。L5 独立运行，只服务插画需求。

## 拆分理由

1. **内容与路由呈现分离。** 语料每语言 150 篇，而一个 `project()` 从共享路由派生两棵呈现树（`docs/.vitepress/config.mts:4`、`docs/.vitepress/config.mts:16`）。路由漂移因此是数据错误，不是人工同步遗漏。
2. **路由呈现与完整性策略分离。** 投影层信任声明路由；`check_index()` 独立比对每篇内容页、`SUMMARY.md` 和配置路由（`scripts/check_links.py:322`）。后者是前者的守卫。
3. **产物生产与产物发布分离。** VitePress 只结束在本地 `dist`；workflow 明确先构建、上传、再部署（`.github/workflows/deploy.yml:63`、`.github/workflows/deploy.yml:70`、`.github/workflows/deploy.yml:84`）。构建失败不会被误认为发布成功。
4. **站点完整性与单测验证分离。** `check_links.py` 审计真实语料和当前产物（`scripts/check_links.py:511`）；测试装置在隔离临时站点中验证工具行为（`tests/test_check_links.py:31`）。真实数据审计与确定性回归生命周期不同。
5. **源码检查与产物检查是同一完整性服务中的独立阶段。** 构建前用源码近似锚点，构建后从 HTML 提取 ID（`scripts/check_links.py:194`、`scripts/check_links.py:225`）；`--require-html` 显式暴露该差别（`scripts/check_links.py:619`）。
6. **sitemap 对账是独立不变量。** 它不只是“链接能解析”：每条 `<loc>` 必须可达产物，每个生成页也必须在册（`scripts/check_links.py:383`、`scripts/check_links.py:423`）。这保护路由变化后的可发现性。
7. **插画独立。** CLI 构造世界并写调用者指定文件，但不被 VitePress 或发布检查导入（`scripts/tree_art.py:327`、`scripts/tree_art.py:354`）。其正确性无需发布站点即可测试。
8. **Playwright 是后置可选适配器。** 它只在 `snap_png()` 内导入（`scripts/tree_art.py:314`），因此 ANSI/HTML 生成保持无第三方依赖且可独立测试。
9. **协议解析局部化在唯一消费者旁边。** Markdown、HTML 和 sitemap 语法编码在完整性检查旁（`scripts/check_links.py:29`、`scripts/check_links.py:380`）；当前没有值得独立成包或协议文件的第二个消费者。
10. **覆盖门槛是仓库级约束，不是顺手加的测试参数。** coverage 同时限定两个 Python 脚本，并要求 100% 行/分支覆盖（`.coveragerc:2`、`.coveragerc:10`）。工具变更因此必须携带行为证据。

## 相关页

- [英文术语表](/glossary.md)
- [术语表](/zh/glossary.md)
- [Source Layer Analysis (2026-11-08)](/review/source-layer-analysis.md)
- [文档结构审计](./structure-audit-2026-10-19.md)
