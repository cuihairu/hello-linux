"""check_links.py 单测：源码扫描层（check_source / check_config）与不可测点登记。

check_source 扫 docs 下 Markdown 与根 README；check_config 校验 config.mts 的
nav/sidebar 链接。文末 COVERAGE_NOTES 登记 scripts/check_links.py 的不可达分支。
覆盖率目标：行覆盖 100% + 分支覆盖 100%（.coveragerc fail_under=100）。
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import pytest

import check_links as cl  # noqa: F401  # conftest 已把 scripts 加入 sys.path
from helpers_cl import REPO_ROOT, write_html, write_md


# ---------------------------------------------------------------------------
# check_source
# ---------------------------------------------------------------------------


def test_check_source_empty_external_and_kinds(site):
    write_md(
        site.docs,
        "t.md",
        "\n".join(
            [
                "# T",
                '<a href=" ">space</a>',  # strip 后空 → empty
                '<a href="https://ex.com">x</a>',
                "<img src=\"/hello-linux/no-such.png\">",
                "[ref]: https://example.com/r",
                "![img](https://ex.com/i.png)",
                "[ext](http://a/b)",
                "[](#)",  # 同页空锚点
                "[ok-ext](https://x)",
            ]
        ),
    )
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_source(issues, stats)
    assert stats["external"] >= 3
    assert any(i[2] == "empty" for i in issues)
    assert stats["anchor_same"] >= 1
    assert any(i[2] == "dead-link" for i in issues)  # html img 内链死链


def test_check_source_same_anchor_with_and_without_html(site):
    md = write_md(
        site.docs,
        "doc.md",
        "# Title\n\n[ok](#title)\n[bad](#nope)\n[](#)\n",
    )
    # 无 dist 页 → 走 headings 近似
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_source(issues, stats)
    assert stats["anchor_same"] == 3
    assert len(issues) == 1
    assert issues[0][2] == "dead-anchor-same"
    # 有 dist 页：id 匹配 / 不匹配
    write_html(
        site.dist,
        "doc.html",
        '<html><body><h1 id="title">t</h1></body></html>',
    )
    issues2: list[tuple] = []
    stats2: Counter = Counter()
    cl.check_source(issues2, stats2)
    # #title 命中 html id；#nope 仍死
    assert not any(i[3] == "#title" for i in issues2)
    assert any(i[3] == "#nope" and i[2] == "dead-anchor-same" for i in issues2)
    # unescape 分支：锚点带实体
    md.write_text("# T\n\n[ent](#a&amp;b)\n", encoding="utf-8")
    write_html(site.dist, "doc.html", '<div id="a&b"></div>')
    issues3: list[tuple] = []
    stats3: Counter = Counter()
    cl.check_source(issues3, stats3)
    assert not issues3


def test_check_source_cross_anchor_and_dead_link(site):
    # file.pdf 存在 → 覆盖 resolved.suffix != ".md" 分支（L219）
    write_md(
        site.docs,
        "src.md",
        "# S\n\n[t](other#sec)\n[d](missing-page)\n[n](file.pdf#p)\n",
    )
    write_md(site.docs, "other.md", "# O\n\n## sec\n")
    (site.docs / "file.pdf").write_bytes(b"%PDF-1.4")
    # dist 上 other 有页
    write_html(site.dist, "src.html", "")
    write_html(site.dist, "other.html", '<h2 id="sec">s</h2>')
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_source(issues, stats)
    assert stats["internal"] == 3
    assert stats["internal_ok"] == 2  # missing-page 失败
    assert stats["anchor_cross"] == 2
    assert any(i[2] == "dead-link" for i in issues)
    # 非 .md 带锚点：不查锚
    assert not any(i[2] == "dead-anchor" for i in issues)
    # 无 dist：源码近似锚点
    (site.dist / "other.html").unlink()
    (site.dist / "src.html").unlink()
    issues2: list[tuple] = []
    stats2: Counter = Counter()
    cl.check_source(issues2, stats2)
    # other.md 有 ## sec → slug sec 存在
    assert not any(i[2] == "dead-anchor" for i in issues2)
    # 死锚（无 dist → source_anchor_set）
    write_md(site.docs, "src.md", "# S\n\n[x](other#no-such)\n")
    issues3: list[tuple] = []
    cl.check_source(issues3, Counter())
    assert any(i[2] == "dead-anchor" for i in issues3)
    # 有 dist 且锚点缺失 → L223
    write_html(site.dist, "other.html", "<html></html>")
    issues4: list[tuple] = []
    cl.check_source(issues4, Counter())
    assert any(i[2] == "dead-anchor" for i in issues4)


def test_check_source_html_img_and_ref_def(site):
    write_md(
        site.docs,
        "m.md",
        "\n".join(
            [
                "# M",
                '<img src="./pic.png" alt="x">',
                '[ref2]: ./target.md',
            ]
        ),
    )
    (site.docs / "pic.png").write_bytes(b"p")
    write_md(site.docs, "target.md", "# T\n")
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_source(issues, stats)
    assert stats["html_img"] == 1
    assert stats["ref_def"] == 1
    assert stats["internal_ok"] == 2
    assert not issues


def test_check_source_readme_ok_and_dead(site):
    # 真实 fixture README 在 root
    (site.root / "README.md").write_text(
        "# R\n\n[l](docs/index.md)\n[dead](no/such.md)\n[ext](https://x)\n[anc](#top)\n[nopath](#)\n",
        encoding="utf-8",
    )
    write_md(site.docs, "index.md", "# I\n")
    issues: list[tuple] = []
    stats: Counter = Counter()
    # 会同时扫 docs 下 md（index.md 无链接）+ README
    cl.check_source(issues, stats)
    assert stats["internal_ok"] >= 1
    assert stats["external"] >= 2
    assert any(i[0] == "README.md" and i[2] == "dead-link" for i in issues)


def test_check_source_readme_missing_file(site, monkeypatch):
    (site.root / "README.md").unlink()
    issues: list[tuple] = []
    cl.check_source(issues, Counter())
    assert issues == []


def test_check_source_relative_candidates_for_readme(site):
    # 候选：ROOT/path、ROOT/path.md、DOCS/path、DOCS/path.md
    (site.root / "LICENSE").write_text("x", encoding="utf-8")
    (site.root / "README.md").write_text("[l](LICENSE)\n", encoding="utf-8")
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_source(issues, stats)
    assert stats["internal_ok"] == 1
    assert not issues


def test_check_source_md_read_error_propagates(site, monkeypatch):
    write_md(site.docs, "m.md", "# M\n[ok](#m)\n")
    real = Path.read_text

    def boom(self: Path, *args, **kwargs):
        if self.suffix == ".md" and self.parent == site.docs:
            raise OSError("disk error")
        return real(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", boom)
    with pytest.raises(OSError, match="disk error"):
        cl.check_source([], Counter())


def test_check_source_invalid_utf8_propagates(site):
    # docs 下 md 含非法字节 → L229 严格 utf-8 读抛错（不吞不 replace）
    (site.docs / "bad.md").write_bytes(b"# B\n\xff\xfe bad\n")
    with pytest.raises(UnicodeDecodeError):
        cl.check_source([], Counter())
    # docs 干净但 README 含非法字节 → L243 同样抛错
    (site.docs / "bad.md").unlink()
    (site.root / "README.md").write_bytes(b"[l](x)\n\xff\xfe\n")
    with pytest.raises(UnicodeDecodeError):
        cl.check_source([], Counter())


# ---------------------------------------------------------------------------
# check_config
# ---------------------------------------------------------------------------


def test_check_config_missing_file(site):
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_config(issues, stats)
    assert issues == []
    assert stats["config_links"] == 0


def test_check_config_paths(site):
    write_md(site.docs, "basic/overview.md", "# O\n")
    write_md(site.docs, "basic/README.md", "# R\n")
    write_md(site.docs, "index.md", "# I\n")
    write_md(site.docs, "dirpage/index.md", "# D\n")
    (site.docs / "filepage").mkdir()
    (site.docs / "filepage").joinpath("x").write_text("x", encoding="utf-8")
    write_html(site.dist, "onlydist.html", "<html></html>")
    write_html(site.dist, "dironly/index.html", "<html></html>")
    cfg = site.vpc / "config.mts"
    cfg.write_text(
        "\n".join(
            [
                "export default {",
                "  themeConfig: {",
                "    nav: [",
                "      { text: 'h', link: '/' },",
                "      { text: 'e', link: 'https://example.com/x' },",
                "      { text: 'a', link: '#anchor' },",
                "      { text: 'p', link: '/basic/overview' },",
                "      { text: 'r', link: '/basic/README' },",
                "      { text: 'i', link: '/index' },",
                "      { text: 'd', link: '/dirpage' },",
                "      { text: 'f', link: '/filepage' },",
                "      { text: 'dist', link: '/onlydist' },",
                "      { text: 'dironly', link: '/dironly' },",
                "      { text: 'empty', link: '/#frag' },",
                "      { text: 'dead', link: '/no/such/page' },",
                "    ]",
                "  }",
                "}",
            ]
        ),
        encoding="utf-8",
    )
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_config(issues, stats)
    # http + "/"
    assert stats["external"] == 2
    assert stats["config_external"] == 2
    assert stats["config_links"] == 12
    # 成功：overview.md / README.md / index / dirpage/index / filepage(dir) / onlydist / dironly
    assert stats["config_ok"] == 7
    # 空 path 跳过 + # 跳过 不计 ok
    dead = [i for i in issues if i[2] == "dead-link"]
    assert dead == [("docs/.vitepress/config.mts", "config", "dead-link", "/no/such/page")]


def test_check_config_fragment_link_counts_ok(site):
    write_md(site.docs, "page.md", "# P\n")
    cfg = site.vpc / "config.mts"
    cfg.write_text(
        "nav: [ { link: '/page#top' }, { link: '#x' }, "
        "{ link: 'http://e' }, { link: '/#f' } ]\n",
        encoding="utf-8",
    )
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_config(issues, stats)
    assert stats["config_links"] == 4
    assert stats["config_ok"] == 1
    assert stats["external"] == 1
    assert not issues


def test_check_config_invalid_utf8_and_no_links(site):
    cfg = site.vpc / "config.mts"
    cfg.write_bytes(b"nav: [ { link: '/' } ]\n\xff\xfe")
    with pytest.raises(UnicodeDecodeError):
        cl.check_config([], Counter())
    # 合法但无 link 字段 → 计数 0、不进循环、不误报
    cfg.write_text("export default { themeConfig: {} }\n", encoding="utf-8")
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_config(issues, stats)
    assert stats["config_links"] == 0
    assert stats["config_ok"] == 0
    assert issues == []


def test_check_config_read_error_propagates(site, monkeypatch):
    cfg = site.vpc / "config.mts"
    cfg.write_text("nav: [ { link: '/' } ]\n", encoding="utf-8")
    real = Path.read_text

    def boom(self: Path, *args, **kwargs):
        if self.name == "config.mts":
            raise OSError("boom-cfg")
        return real(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", boom)
    with pytest.raises(OSError, match="boom-cfg"):
        cl.check_config([], Counter())


# ---------------------------------------------------------------------------
# 不可测点登记核验
# ---------------------------------------------------------------------------


def test_no_cover_pragmas_are_registered_with_reason():
    """不可测点登记核验：pragma 行号清单、行内理由、COVERAGE_NOTES 三者同步。"""
    src = (REPO_ROOT / "scripts" / "check_links.py").read_text(encoding="utf-8")
    pragma_lines: list[int] = []
    for i, line in enumerate(src.splitlines()):
        if "pragma: no cover" in line:
            pragma_lines.append(i + 1)
            # 不可测点必须随行登记不可达理由（不许无理由排除）
            assert "不可达" in line, f"L{i + 1} pragma 缺少理由"
    # 不可测点全集：2 处控制流不可达的防御分支；增删必须同步本清单与登记
    assert pragma_lines == [209, 252]
    notes = Path(__file__).read_text(encoding="utf-8")
    for ln in pragma_lines:
        assert f"L{ln}-{ln + 1}" in notes, f"pragma L{ln} 未在 COVERAGE_NOTES 登记"


# ---------------------------------------------------------------------------
# COVERAGE_NOTES — 不可达分支（pragma 已在源码标注）
# ---------------------------------------------------------------------------
#
# 1) check_source.check() L209-210 `if not path: return`
#    可达条件：target 含 '#' 且 split 首段为空 ⇒ target 以 '#' 开头。
#    但 L188 已对 startswith('#') 整支 return，L180 已吞空串。
#    ⇒ 此防御分支在控制流上不可达。源码标 `# pragma: no cover`。
#
# 2) check_source README L252-253 `if not path: continue`
#    path = unquote(t.split('#')[0])。t 不以 '#' 开头（L247 已 continue）
#    且非空（LINK_RE 要求 [^)\s]+），则 split 首段非空；unquote 不会把
#    非空串解码为空串 ⇒ 不可达。源码标 `# pragma: no cover`。
#
# 已知非不可达、但需说明的边界：
# - L221 suffix != '.md'：链接到存在的非 md 文件带锚点（测试已覆盖）。
# - L479 目录兜底：path 含 '../' 逃出 rglob 收集，避免读目录崩溃。
# - 源码级 slug 近似 ≠ VitePress 真实算法：hardening.md 中文标题锚点
#   在无 dist 时会误报（slugify 不处理全角冒号/引号），有 dist 时走
#   html_for_md 精确校验 → 通过。test_real_site_* 无 dist 时 skipif 跳过。
# - `if __name__ == "__main__"`：test_main_script_entry 用 runpy 执行。
