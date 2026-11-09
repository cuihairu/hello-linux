# Todo

## 源码分层分析 2026-11-07

### a) 抽象层清单

- L1 文档产品：维护中英双语 Linux 教学语料及其源码级证据。（`docs/source/README.md:23`）
- L2 站点呈现与语言投影：把共享路由投影为双语导航和站点文案。（`docs/.vitepress/config.mts:16`）
- L3 静态构建与发布：生成 Pages 静态产物并完成上传/部署。（`package.json:7`）
- L4 站点完整性服务：审计链接、锚点、索引、sitemap 和产物 HTML。（`scripts/check_links.py:511`）
- L5 确定性插画服务：按种子生成并输出可复现字符画。（`scripts/tree_art.py:327`）
- L6 工具验证装置：隔离测试 Python 工具并强制行/分支全覆盖。（`tests/conftest.py:4`）

### b) 超大文件候选

- [x] LAY-001 [P1] 拆分 `tests/test_check_links.py`（1480 行）——按 fixture、Markdown/协议解析、索引、sitemap、HTML 与 CLI 场景分组。（拆为 conftest 装置 + helpers_cl + parsing/source_config/html/index/sitemap/cli 七文件，151 用例与 100% 覆盖率不变）
- [x] LAY-002 [P1] 拆分 `docs/network/network-configuration.md`（1060 行）——按管理器识别、持久配置、DNS、路由、高级拓扑/性能和排障经验拆成子页。（改为总览页 + `network-configuration/` 六子页，SUMMARY/sidebar 已挂树）
- [x] LAY-003 [P1] 拆分 `docs/zh/network/network-configuration.md`（1063 行）——与英文版同步拆成同构子页，保持跨语言链接稳定。（zh 树同构六子页，站内 section 引用改为子页直链）

### c) 目录/分类不合理处

未见分类问题。
