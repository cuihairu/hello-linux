"""check_links.py 单测：索引核对层（check_index）。

SUMMARY.md 双语言树（根树 + zh/ 树）与 config sidebar 的一致性：
条目收集、孤儿页、未入导航、豁免页（index.md / SUMMARY.md 自身）。
覆盖率目标：行覆盖 100% + 分支覆盖 100%（.coveragerc fail_under=100）。
"""

from __future__ import annotations

from collections import Counter

import check_links as cl  # noqa: F401  # conftest 已把 scripts 加入 sys.path
from helpers_cl import write_md


# ---------------------------------------------------------------------------
# check_index
# ---------------------------------------------------------------------------


def test_check_index_skips_without_summary(site):
    write_md(site.docs, "a.md", "# A\n")
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_index(issues, stats)
    assert issues == []
    assert stats["index_entries"] == 0


def test_check_index_full_pass(site):
    write_md(site.docs, "index.md", "# I\n")
    write_md(site.docs, "guide.md", "# G\n")
    write_md(site.docs, "basic/overview.md", "# O\n")
    (site.docs / "SUMMARY.md").write_text(
        "\n".join(
            [
                "# 目录",
                "",
                "- [首页](./index.md)",
                "- [指南](./guide.md)",
                "- [概览](./basic/overview.md)",
                "- [外站](https://example.com)",
                "- [锚点](#anchor)",
            ]
        ),
        encoding="utf-8",
    )
    (site.vpc / "config.mts").write_text(
        "\n".join(
            [
                "export default {",
                "  themeConfig: {",
                "    nav: [",
                "      { text: 'i', link: '/' },",
                "      { text: 's', link: '/SUMMARY' },",
                "      { text: 'x', link: '/index' },",
                "      { text: 'g', link: '/guide' },",
                "      { text: 'o', link: '/basic/overview' },",
                "    ]",
                "  }",
                "}",
            ]
        ),
        encoding="utf-8",
    )
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_index(issues, stats)
    assert issues == []
    assert stats["index_entries"] == 3  # index.md、guide.md、basic/overview.md
    assert stats["index_listed"] == 2
    assert stats["index_exempt"] == 2  # index.md + SUMMARY.md 自身
    assert stats["index_orphan"] == 0
    assert stats["index_sidebar_ok"] == 3  # /index、/guide、/basic/overview
    assert stats["index_unlisted"] == 0


def test_check_index_flags_orphan(site):
    write_md(site.docs, "listed.md", "# L\n")
    write_md(site.docs, "hidden/orphan.md", "# H\n")
    write_md(site.docs, "index.md", "# I\n")
    (site.docs / "SUMMARY.md").write_text("- [L](./listed.md)\n", encoding="utf-8")
    (site.vpc / "config.mts").write_text(
        "themeConfig: { nav: [{ link: '/listed' }] }", encoding="utf-8"
    )
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_index(issues, stats)
    assert ("docs/hidden/orphan.md", "index", "orphan-page", "not in SUMMARY.md") in issues
    assert stats["index_orphan"] == 1
    assert stats["index_listed"] == 1
    assert stats["index_sidebar_ok"] == 1
    assert stats["index_unlisted"] == 0


def test_check_index_flags_unlisted_when_config_missing(site):
    write_md(site.docs, "guide.md", "# G\n")
    (site.docs / "SUMMARY.md").write_text("- [G](./guide.md)\n", encoding="utf-8")
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_index(issues, stats)  # config.mts 不存在 ⇒ 全部条目视为未入导航
    assert ("docs/SUMMARY.md", "index", "not-in-sidebar", "/guide") in issues
    assert stats["index_unlisted"] == 1
    assert stats["index_sidebar_ok"] == 0


def test_check_index_flags_unlisted_route(site):
    write_md(site.docs, "guide.md", "# G\n")
    (site.docs / "SUMMARY.md").write_text("- [G](./guide.md#intro)\n", encoding="utf-8")
    (site.vpc / "config.mts").write_text(
        "themeConfig: { nav: [{ link: '/other' }] }", encoding="utf-8"
    )
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_index(issues, stats)
    assert ("docs/SUMMARY.md", "index", "not-in-sidebar", "/guide") in issues
    assert stats["index_entries"] == 1  # 锚点剥离后仍是一个条目
    assert stats["index_unlisted"] == 1


def test_check_index_checks_both_locale_trees(site):
    """双语树：根 SUMMARY 只核对英文页，zh/SUMMARY 只核对 /zh/ 下的中文页。"""
    write_md(site.docs, "index.md", "# I\n")
    write_md(site.docs, "guide.md", "# G\n")
    write_md(site.docs, "zh/index.md", "# 中文首页\n")
    write_md(site.docs, "zh/guide.md", "# 中文指南\n")
    write_md(site.docs, "zh/SUMMARY.md", "- [指南](./guide.md)\n")
    (site.docs / "SUMMARY.md").write_text("- [G](./guide.md)\n", encoding="utf-8")
    (site.vpc / "config.mts").write_text(
        "themeConfig: { nav: [{ link: '/guide' }] }", encoding="utf-8"
    )
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_index(issues, stats)
    assert issues == []
    assert stats["index_entries"] == 2  # 每棵树一个条目
    assert stats["index_listed"] == 2
    assert stats["index_exempt"] == 4  # 两棵树各自的 index.md + SUMMARY.md
    assert stats["index_orphan"] == 0
    assert stats["index_sidebar_ok"] == 2  # 同一 config route 命中两棵树
    assert stats["index_unlisted"] == 0


def test_check_index_flags_zh_orphan(site):
    """/zh/ 下的孤儿页由 zh/SUMMARY.md 报出，不波及根树。"""
    write_md(site.docs, "index.md", "# I\n")
    write_md(site.docs, "zh/zh-orphan.md", "# H\n")
    write_md(site.docs, "zh/SUMMARY.md", "# 中文目录\n")
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_index(issues, stats)
    assert (
        "docs/zh/zh-orphan.md",
        "index",
        "orphan-page",
        "not in SUMMARY.md",
    ) in issues
    assert stats["index_orphan"] == 1
    assert stats["index_listed"] == 0
    assert stats["index_exempt"] == 1  # 仅 zh/SUMMARY.md；根树无 SUMMARY 整树跳过


def test_check_index_zh_tree_without_summary_is_skipped(site):
    """只有根 SUMMARY 时，zh/ 整树不参与索引核对。"""
    write_md(site.docs, "index.md", "# I\n")
    write_md(site.docs, "listed.md", "# L\n")
    write_md(site.docs, "zh/hidden.md", "# H\n")
    (site.docs / "SUMMARY.md").write_text("- [L](./listed.md)\n", encoding="utf-8")
    (site.vpc / "config.mts").write_text(
        "themeConfig: { nav: [{ link: '/listed' }] }", encoding="utf-8"
    )
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_index(issues, stats)
    assert issues == []  # zh/ 无 SUMMARY ⇒ 整树跳过
    assert stats["index_listed"] == 1
    assert stats["index_orphan"] == 0
    assert stats["index_exempt"] == 2  # 根 index.md + SUMMARY.md
