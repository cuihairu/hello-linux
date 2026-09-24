"""scripts/check_links.py 单测。

覆盖率目标：行覆盖 100% + 分支覆盖 100%（.coveragerc fail_under=100）。不可达分支见文末 COVERAGE_NOTES。
"""

from __future__ import annotations

import runpy
import sys
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import check_links as cl  # noqa: E402  # type: ignore[import-not-found]


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def site(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> SimpleNamespace:
    """隔离的假站点：ROOT/DOCS/DIST/BASE 全部指向 tmp。"""
    root = tmp_path / "root"
    docs = root / "docs"
    dist = docs / ".vitepress" / "dist"
    vpc = docs / ".vitepress"
    public = docs / "public"
    for d in (dist, public):
        d.mkdir(parents=True, exist_ok=True)
    (public / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    (root / "README.md").write_text("# README\n", encoding="utf-8")
    monkeypatch.setattr(cl, "ROOT", root)
    monkeypatch.setattr(cl, "DOCS", docs)
    monkeypatch.setattr(cl, "DIST", dist)
    monkeypatch.setattr(cl, "BASE", "/hello-linux/")
    return SimpleNamespace(root=root, docs=docs, dist=dist, vpc=vpc, public=public)


def write_md(base: Path, rel: str, text: str) -> Path:
    p = base / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


def write_html(base: Path, rel: str, text: str) -> Path:
    p = base / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
# blank_fences / is_external / extract_headings / slugify
# ---------------------------------------------------------------------------


def test_blank_fences_toggles_and_blanks():
    text = "a\n```\ncode ](x)\n```\nb\n~~~\nmore ](y)\n~~~\nc"
    out = cl.blank_fences(text)
    lines = out.splitlines()
    assert lines[0] == "a"
    assert lines[1] == ""
    assert lines[2] == ""
    assert lines[3] == ""
    assert lines[4] == "b"
    assert lines[5] == ""
    assert lines[6] == ""
    assert lines[7] == ""
    assert lines[8] == "c"


def test_blank_fences_odd_fence_blanks_to_eof():
    out = cl.blank_fences("x\n```\nnever closed")
    # splitlines 不保留末尾空行：join 后为 "x\n\n"
    assert out == "x\n\n"
    assert out.splitlines() == ["x", ""]


@pytest.mark.parametrize(
    "target,expected",
    [
        ("http://a", True),
        ("https://a", True),
        ("//cdn", True),
        ("mailto:x@y", True),
        ("javascript:void(0)", True),
        ("data:text/plain,x", True),
        ("tel:123", True),
        ("ftp://host", True),
        ("./page.md", False),
        ("/hello-linux/x", False),
        ("#anchor", False),
        ("page.md#a", False),
        # 带盘符的 Windows 路径按 scheme 解析 → 视为外部
        (r"C:\Windows\system32", True),
        # 通用 scheme 形式（不依赖 EXTERNAL_PREFIXES 白名单）
        ("foo:bar", True),
    ],
)
def test_is_external(target: str, expected: bool):
    assert cl.is_external(target) is expected


def test_extract_headings_skips_fences_and_strips_trailing_hashes():
    text = "# Top\n```\n# Not\n```\n## Sub ##\n"
    assert cl.extract_headings(text) == ["Top", "Sub"]


def test_extract_headings_h6():
    assert cl.extract_headings("###### six\n") == ["six"]


@pytest.mark.parametrize(
    "heading,slug",
    [
        ("Simple", "simple"),
        ("With `code`", "with-code"),
        ("**Bold** title", "bold-title"),
        ("*Italic*", "italic"),
        ("[link text](https://x)", "link-text"),
        ("Hello   World", "hello-world"),
        ("a---b", "a-b"),
        ("中文章节", "中文章节"),
        ("123 start", "_123-start"),
        ("a!@#$b", "ab"),
        ("", ""),
        # 全角数字：isalnum 为真、isdigit 为真 → 保留并加 "_" 前缀
        ("１２３ start", "_１２３-start"),
        # ASCII 控制字符（\x01）被丢弃
        ("a\x01b", "ab"),
    ],
)
def test_slugify_vitepress(heading: str, slug: str):
    assert cl.slugify_vitepress(heading) == slug


def test_source_anchor_set_from_headings_and_attrs(site):
    md = write_md(
        site.docs,
        "a.md",
        "# H1\n\nname-id\n\n<div id=\"custom-id\"></div>\n\n[ref]\n",
    )
    anchors = cl.source_anchor_set(md)
    assert "h1" in anchors
    assert "custom-id" in anchors


# ---------------------------------------------------------------------------
# md_files / resolve_md_target / html_for_md / load_ids
# ---------------------------------------------------------------------------


def test_md_files_sorted_and_skips_vitepress(site):
    write_md(site.docs, "z.md", "# z\n")
    write_md(site.docs, "a.md", "# a\n")
    write_md(site.docs, ".vitepress/hidden.md", "# h\n")
    files = cl.md_files()
    names = [p.name for p in files]
    assert names == sorted(names)
    assert "hidden.md" not in names
    assert names == ["a.md", "z.md"]


def test_resolve_base_prefix_and_dist_html(site):
    md = write_md(site.docs, "basic/x.md", "# X\n")
    write_html(site.dist, "basic/y.html", "<html></html>")
    write_md(site.docs, "public/logo.svg", "svg", encoding="utf-8") if False else None
    (site.docs / "public" / "logo.png").write_bytes(b"x")
    # /hello-linux/ + 相对
    assert cl.resolve_md_target(md, "/hello-linux/basic/x") == md.resolve()
    assert cl.resolve_md_target(md, "/hello-linux/basic/x.md") == md.resolve()
    # dist html
    got = cl.resolve_md_target(md, "/hello-linux/basic/y")
    assert got == (site.dist / "basic/y.html").resolve()
    # public
    assert cl.resolve_md_target(md, "/hello-linux/logo.png") == (
        site.docs / "public" / "logo.png"
    ).resolve()


def test_resolve_absolute_and_relative(site):
    md = write_md(site.docs, "deep/nested.md", "# N\n")
    target = write_md(site.docs, "other/t.md", "# T\n")
    # 绝对 /path
    assert cl.resolve_md_target(md, "/other/t") == target.resolve()
    assert cl.resolve_md_target(md, "/other/t.md") == target.resolve()
    assert cl.resolve_md_target(md, "/public-fallback-x") is None
    # 相对 ../other/t
    rel = cl.resolve_md_target(md, "../other/t.md")
    assert rel == target.resolve()
    # 无后缀 → with_suffix(".md")
    rel2 = cl.resolve_md_target(md, "../other/t")
    assert rel2 == target.resolve()
    # public 相对
    (site.docs / "public" / "img.png").write_bytes(b"i")
    assert cl.resolve_md_target(md, "../public/img.png") == (
        site.docs / "public" / "img.png"
    ).resolve()
        # 不存在
    assert cl.resolve_md_target(md, "nope") is None
    # unquote：相对路径先解码再解析
    write_md(site.docs, "deep/space name.md", "# S\n")
    assert cl.resolve_md_target(md, "space%20name.md") is not None


def test_resolve_oserror_swallowed(site, monkeypatch):
    md = write_md(site.docs, "a.md", "# A\n")
    real_exists = Path.exists

    def boom(self: Path) -> bool:
        if "missing" in str(self):
            raise OSError("EIO")
        return real_exists(self)

    monkeypatch.setattr(Path, "exists", boom)
    assert cl.resolve_md_target(md, "missing.md") is None


def test_html_for_md_variants(site, monkeypatch):
    md = write_md(site.docs, "p.md", "# P\n")
    # 无 dist
    monkeypatch.setattr(cl, "DIST", site.root / "no-dist")
    assert cl.html_for_md(md) is None
    # dist 有
    monkeypatch.setattr(cl, "DIST", site.dist)
    write_html(site.dist, "p.html", "<html></html>")
    assert cl.html_for_md(md) == site.dist / "p.html"
    # md 在 docs 外 → ValueError
    outside = site.root / "outside.md"
    outside.write_text("# O\n", encoding="utf-8")
    assert cl.html_for_md(outside) is None
    # docs 内但 dist 无对应页
    write_md(site.docs, "nohtml.md", "# N\n")
    assert cl.html_for_md(site.docs / "nohtml.md") is None


def test_load_ids_id_and_name(site):
    h = write_html(site.dist, "x.html", """<div id="i1"></div><a name="n1"></a>""")
    assert cl.load_ids(h) == {"i1", "n1"}


# ---------------------------------------------------------------------------
# resolve_md_target /hello-linux 分支：path 赋值后仍用完整 path 的分支
# ---------------------------------------------------------------------------


def test_resolve_base_prefix_public_exact(site):
    md = write_md(site.docs, "a.md", "# A\n")
    (site.docs / "public" / "favicon.ico").write_bytes(b"1")
    got = cl.resolve_md_target(md, "/hello-linux/favicon.ico")
    assert got == (site.docs / "public" / "favicon.ico").resolve()


# ---------------------------------------------------------------------------
# route_of
# ---------------------------------------------------------------------------


def test_route_of_branches(site):
    d = site.dist
    assert cl.route_of(d / "index.html") == "/"
    assert cl.route_of(d / "sub" / "index.html") == "/sub/"
    assert cl.route_of(d / "page.html") == "/page"
    # 非 .html（rglob 不会产出，但函数对任意后缀有定义）
    assert cl.route_of(d / "asset.css") == "/asset.css"


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
    assert stats["config_links"] == 12
    # 成功：overview.md / README.md / index / dirpage/index / filepage(dir) / onlydist / dironly
    assert stats["config_ok"] == 7
    # 空 path 跳过 + # 跳过 不计 ok
    dead = [i for i in issues if i[2] == "dead-link"]
    assert dead == [("docs/.vitepress/config.mts", "config", "dead-link", "/no/such/page")]


# ---------------------------------------------------------------------------
# check_html
# ---------------------------------------------------------------------------


def test_check_html_skipped(site, monkeypatch):
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_html(issues, stats)
    assert stats["html_skipped"] == 1
    monkeypatch.setattr(cl, "DIST", site.root / "missing-dist")
    stats2: Counter = Counter()
    cl.check_html(issues, stats2)
    assert stats2["html_skipped"] == 1
    # dist 存在但无 html
    empty = site.root / "empty-dist"
    empty.mkdir()
    monkeypatch.setattr(cl, "DIST", empty)
    stats3: Counter = Counter()
    cl.check_html(issues, stats3)
    assert stats3["html_skipped"] == 1


def test_check_html_all_branches(site):
    d = site.dist
    write_html(
        d,
        "index.html",
        "\n".join(
            [
                "<html><head></head><body>",
                '<a href="https://ex.com/x">ext</a>',
                '<a href="#sec">same</a>',
                '<a href="#">empty-same</a>',
                '<a href="/hello-linux/page.html">base-page</a>',
                '<a href="/hello-linux/assets/app.css">asset-missing-wait</a>',
                '<a href="/outside/logo.png">outside</a>',
                '<a href="./page.html">rel-html</a>',
                '<a href="sub/">rel-slash-dir</a>',
                '<a href="plain">rel-plain</a>',
                '<a href="/hello-linux/cross#frag">cross</a>',
                '<a href="/hello-linux/cross#bad">cross-bad</a>',
                '<a href="/hello-linux/page#also-bad">page-bad-anc</a>',
                '<a href="/hello-linux/no-such-page">dead</a>',
                '<img src="/hello-linux/assets/ok.png">',
                "</body></html>",
            ]
        ),
    )
    write_html(d, "page.html", '<html><body id="sec"><a name="n1">x</a></body></html>')
    write_html(d, "cross.html", '<html><div id="frag">f</div></html>')
    write_html(d, "sub/index.html", "<html></html>")
    write_html(d, "plain.html", "<html></html>")
    (d / "assets").mkdir()
    (d / "assets" / "ok.png").write_bytes(b"png")
    # urljoin 相对不落 BASE：从 index 根目录出去的 ../x → /x → lstrip
    # 在 sub/index 里放一个 .. 链接
    write_html(
        d,
        "sub/index.html",
        '<a href="../escaped.html">esc</a><a href="/hello-linux/sub#x">subx</a>',
    )
    # path 以 / 结尾的 cands：href "sub/" 已测；再测 path 无后缀且仅 index 兜底
    write_html(d, "onlydir/index.html", "<html></html>")
    # 在 index 加 onlydir（无斜杠无后缀）已在 plain 逻辑覆盖 cands[2]
    # html 同页锚点 unescape：id 含实体
    write_html(
        d,
        "ent.html",
        '<div id="a&b">e</div><a href="#a&amp;b">ok</a><a href="#missing-ent">bad</a>',
    )
    # 追加 link 到 index 以覆盖 ent 与 onlydir
    text = (d / "index.html").read_text(encoding="utf-8")
    text = text.replace(
        "</body></html>",
        '<a href="/hello-linux/ent.html">e</a>'
        '<a href="/hello-linux/onlydir">od</a>'
        '<a href="./ent.html#missing-ent">badx</a>'
        "</body></html>",
    )
    (d / "index.html").write_text(text, encoding="utf-8")

    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_html(issues, stats)
    assert stats["html_skipped"] == 0
    assert stats["external"] >= 1
    assert stats["html_same"] >= 2
    assert stats["outside_base"] == 1
    assert stats["html_int"] >= 10
    assert stats["asset"] == 1
    assert stats["html_page"] >= 6
    assert stats["html_xanc"] >= 2
    kinds = {(i[2]) for i in issues}
    assert "dead-link" in kinds  # no-such-page
    assert "dead-anchor" in kinds  # cross#bad / page#also-bad / ent bad
    assert "dead-anchor-same" in kinds  # #missing-ent same? ent 是同页在 ent.html
    # outside_base 不产生 issue
    assert not any("outside" in i[3] for i in issues if len(i) > 3)


def test_check_html_relative_not_under_base(site):
    """urljoin 结果不以 BASE 开头 → lstrip；以 BASE 开头 → 剥前缀（L351）。"""
    d = site.dist
    # L351：cur_dir='/'，相对 href 'hello-linux/page.html'
    # urljoin → '/hello-linux/page.html' 以 BASE 开头
    write_html(d, "index.html", '<a href="hello-linux/page.html">join-base</a>')
    write_html(d, "page.html", "<html></html>")
    # 不以 BASE 开头：子目录 ../page.html → /page.html → lstrip
    write_html(d, "nested/inner.html", '<a href="../page.html">up</a>')
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_html(issues, stats)
    assert stats["html_page"] >= 2
    assert not issues


def test_check_html_path_empty_continue(site):
    """href 正好是 BASE → rest 空 → continue。"""
    d = site.dist
    write_html(d, "index.html", '<a href="/hello-linux/">root</a>')
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_html(issues, stats)
    # "/hello-linux/" → rest="" → path 空 → continue，不计入 html_int 之后的 dead
    assert not issues
    assert stats["html_int"] == 1  # 计入 html_int 后 path 空 return
    # 等等：html_int 在 path 拆分前 +1，path 空 continue 仍算 html_int
    assert stats["html_int"] == 1


def test_check_html_dir_index_fallback(site):
    """L379：path 以 .html 结尾且 cands 全 miss，但 DIST/path/index.html 存在。

    path 含 `../` 逃出 DIST.rglob 收集范围（rglob 不会把 ../x.html 目录
    当成 html 文件），从而避免 load_ids 读目录崩溃。
    """
    d = site.dist
    esc = site.vpc / "x.html"  # dist 的兄弟目录，rglob 从 dist 出发扫不到
    esc.mkdir(parents=True, exist_ok=True)
    (esc / "index.html").write_text("<html></html>", encoding="utf-8")
    write_html(d, "index.html", '<a href="/hello-linux/../x.html">esc</a>')
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_html(issues, stats)
    # cands: ../x.html（目录）、../x、../x/index.html 均非文件
    # 兜底: (DIST / "../x.html" / "index.html").is_file() → True
    assert stats["html_page"] >= 1
    assert not any(i[2] == "dead-link" for i in issues)


def test_check_html_relative_asset(site):
    """相对路径指向已存在非 html 资源。"""
    d = site.dist
    (d / "style.css").write_text("body{}", encoding="utf-8")
    write_html(d, "index.html", '<link href="./style.css" rel="stylesheet">')
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_html(issues, stats)
    assert stats["asset"] == 1
    assert not issues


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def test_main_docs_missing(monkeypatch, capsys):
    monkeypatch.setattr(cl, "DOCS", Path("/nonexistent/docs-for-test"))
    assert cl.main() == 1
    err = capsys.readouterr().err
    assert "docs/ not found" in err


def test_main_happy_path_with_dist(site, monkeypatch, capsys):
    write_md(site.docs, "index.md", "# I\n\n[ok](#i)\n")
    write_html(site.dist, "index.html", '<h1 id="i">i</h1><a href="#i">x</a>')
    cfg = site.vpc / "config.mts"
    cfg.write_text("nav: [ { link: '/' } ]\n", encoding="utf-8")
    # config link '/' → external，ok=0；仍 exit 0
    monkeypatch.setattr(sys, "argv", ["check_links.py"])
    assert cl.main() == 0
    out = capsys.readouterr().out
    assert "RESULT pass=" in out
    assert "html:" in out
    assert "issues: 0" in out


def test_main_fail_returns_1(site, monkeypatch, capsys):
    write_md(site.docs, "bad.md", "# B\n\n[d](missing.md)\n")
    monkeypatch.setattr(sys, "argv", ["check_links.py"])
    assert cl.main() == 1
    out = capsys.readouterr().out
    assert "dead-link" in out


def test_main_html_skipped_paths(site, monkeypatch, capsys):
    write_md(site.docs, "ok.md", "# O\n")
    monkeypatch.setattr(sys, "argv", ["check_links.py"])
    # dist 目录存在但空 → html_skipped
    # fixture 已建空 dist？需要清掉 html — fixture dist 为空目录，rglob 无 html → skipped
    assert cl.main() == 0
    out = capsys.readouterr().out
    assert "html: skipped" in out
    # --require-html 且 skipped → 1
    monkeypatch.setattr(sys, "argv", ["check_links.py", "--require-html"])
    assert cl.main() == 1
    assert "ERROR: --require-html" in capsys.readouterr().err


def test_main_favicon_missing(site, monkeypatch, capsys):
    (site.public / "favicon.svg").unlink()
    write_md(site.docs, "ok.md", "# O\n")
    monkeypatch.setattr(sys, "argv", ["check_links.py"])
    assert cl.main() == 1
    out = capsys.readouterr().out
    assert "missing" in out


def test_main_script_entry(site, monkeypatch, capsys):
    """覆盖 __main__ 守卫：以 __name__=='__main__' 执行模块。"""
    write_md(site.docs, "index.md", "# I\n")
    (site.public / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["check_links.py"])
    # runpy 按真实 __file__ 重载模块（独立命名空间），ROOT/DOCS 指向真实仓库
    raw_file = cl.__file__
    assert raw_file is not None
    script = Path(raw_file)
    assert script.is_file()
    with pytest.raises(SystemExit) as ei:
        runpy.run_path(str(script), run_name="__main__")
    assert ei.value.code in (0, 1)


# ---------------------------------------------------------------------------
# 集成：真实站点（不 monkeypatch 模块全局）
# ---------------------------------------------------------------------------


@pytest.mark.skipif(
    not cl.DIST.is_dir(),
    reason="需先 npm run docs:build；无 dist 时源码级中文锚点近似误报 hardening.md",
)
def test_real_site_source_and_config_pass():
    """真实仓库：源码级 + config 应 0 issues（依赖 dist 精确锚点）。"""
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_source(issues, stats)
    cl.check_config(issues, stats)
    assert issues == [], issues
    assert stats["md_link"] > 0
    assert stats["config_ok"] > 0


# ---------------------------------------------------------------------------
# 边界与错误路径（CRLF / 非法输入 / IO 失败 / 引号形式 / 退出码优先级）
# ---------------------------------------------------------------------------


def test_crlf_line_endings_in_blank_fences_and_headings():
    out = cl.blank_fences("a\r\n```\r\nx ](y)\r\n```\r\nb\r\n")
    assert out == "a\n\n\n\nb"
    assert cl.extract_headings("# Top\r\n\r\n## Sub ##\r\n") == ["Top", "Sub"]


def test_load_ids_invalid_utf8_bytes_replaced(site):
    h = site.dist / "bad.html"
    h.write_bytes(b'<div id="ok"></div>\xff\xfe')
    assert cl.load_ids(h) == {"ok"}


def test_resolve_md_target_invalid_inputs_return_none(site):
    md = write_md(site.docs, "deep/n.md", "# N\n")
    assert cl.resolve_md_target(md, "") is None
    assert cl.resolve_md_target(md, "%00null") is None  # 空字节路径不存在
    assert cl.resolve_md_target(md, "%20%20") is None  # 解码后仅空白
    assert cl.resolve_md_target(md, "/no/such/abs") is None
    assert cl.resolve_md_target(md, "#frag") is None


def test_link_re_double_quoted_title_only(site):
    write_md(site.docs, "target.md", "# T\n")
    write_md(site.docs, "a.md", '# A\n\n[ok](target.md "the title")\n')
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_source(issues, stats)
    assert stats["internal_ok"] == 1
    assert not issues
    # 单引号标题不匹配 LINK_RE（\s+"…" 仅双引号）
    assert cl.LINK_RE.findall("![i](pic.png 'p')") == []


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


def test_check_html_unquoted_href_ignored(site):
    write_html(site.dist, "index.html", '<a href=/page.html>x</a><a href="/p2.html">y</a>')
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_html(issues, stats)
    # 无引号 href 不被 HREF_SRC_RE 匹配 → 不计入 html_all
    assert stats["html_all"] == 1
    assert stats["outside_base"] == 1  # /p2.html 不在 BASE 下
    assert not issues


def test_main_zero_checked_reports_full_rate(site, monkeypatch, capsys):
    # 空站点：无 md 链接、无 config、dist 为空 → total=0 仍报 100%
    monkeypatch.setattr(sys, "argv", ["check_links.py"])
    assert cl.main() == 0
    out = capsys.readouterr().out
    assert "total=0 rate=100.0000%" in out
    assert "html: skipped" in out


def test_main_dead_link_takes_precedence_over_require_html(site, monkeypatch, capsys):
    write_md(site.docs, "bad.md", "# B\n\n[d](missing.md)\n")
    monkeypatch.setattr(sys, "argv", ["check_links.py", "--require-html"])
    assert cl.main() == 1
    captured = capsys.readouterr()
    assert "dead-link" in captured.out
    # 先命中 failed 分支 → 不打印 --require-html 错误
    assert "ERROR: --require-html" not in captured.err


# ---------------------------------------------------------------------------
# COVERAGE_NOTES — 不可达分支（pragma 已在源码标注）
# ---------------------------------------------------------------------------
#
# 1) check_source.check() L205-206 `if not path: return`
#    可达条件：target 含 '#' 且 split 首段为空 ⇒ target 以 '#' 开头。
#    但 L185 已对 startswith('#') 整支 return，L177 已吞空串。
#    ⇒ 此防御分支在控制流上不可达。源码标 `# pragma: no cover`。
#
# 2) check_source README L248-249 `if not path: continue`
#    path = unquote(t.split('#')[0])。t 不以 '#' 开头（L244 已 continue）
#    且非空（LINK_RE 要求 [^)\s]+），则 split 首段非空；unquote 不会把
#    非空串解码为空串 ⇒ 不可达。源码标 `# pragma: no cover`。
#
# 已知非不可达、但需说明的边界：
# - L219 suffix != '.md'：链接到存在的非 md 文件带锚点（测试已覆盖）。
# - L379 目录兜底：path 含 '../' 逃出 rglob 收集，避免读目录崩溃。
# - 源码级 slug 近似 ≠ VitePress 真实算法：hardening.md 中文标题锚点
#   在无 dist 时会误报（slugify 不处理全角冒号/引号），有 dist 时走
#   html_for_md 精确校验 → 通过。test_real_site_* 无 dist 时 skipif 跳过。
# - `if __name__ == "__main__"`：test_main_script_entry 用 runpy 执行。
