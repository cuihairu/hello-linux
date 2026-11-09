"""check_links.py 单测：Markdown/协议解析层。

blank_fences / is_external / extract_headings / slugify / 锚点集 /
LINK_RE / md_files / resolve_md_target / html_for_md / load_ids / route_of。
覆盖率目标：行覆盖 100% + 分支覆盖 100%（.coveragerc fail_under=100）。
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import pytest

import check_links as cl  # noqa: F401  # conftest 已把 scripts 加入 sys.path
from helpers_cl import write_html, write_md


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


def test_crlf_line_endings_in_blank_fences_and_headings():
    out = cl.blank_fences("a\r\n```\r\nx ](y)\r\n```\r\nb\r\n")
    assert out == "a\n\n\n\nb"
    assert cl.extract_headings("# Top\r\n\r\n## Sub ##\r\n") == ["Top", "Sub"]


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


def test_link_re_quoted_title_both_quote_styles(site):
    # 正则级：单/双引号标题均应提取 target
    assert cl.LINK_RE.findall('![i](pic.png "p")') == [("!", "pic.png")]
    assert cl.LINK_RE.findall("![i](pic.png 'p')") == [("!", "pic.png")]
    # 行为级：双引号标题链接正常解析
    write_md(site.docs, "target.md", "# T\n")
    write_md(
        site.docs,
        "a.md",
        "# A\n\n[ok](target.md \"the title\")\n[dead](missing.md 'gone')\n",
    )
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_source(issues, stats)
    assert stats["internal_ok"] == 1
    # 单引号标题死链不得再漏检（修复前此链接被 LINK_RE 整体忽略）
    assert any(i[3] == "missing.md" and i[2] == "dead-link" for i in issues)


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


def test_resolve_md_target_invalid_inputs_return_none(site):
    md = write_md(site.docs, "deep/n.md", "# N\n")
    assert cl.resolve_md_target(md, "") is None
    assert cl.resolve_md_target(md, "%00null") is None  # 空字节路径不存在
    assert cl.resolve_md_target(md, "%20%20") is None  # 解码后仅空白
    assert cl.resolve_md_target(md, "/no/such/abs") is None
    assert cl.resolve_md_target(md, "#frag") is None


# ---------------------------------------------------------------------------
# resolve_md_target /hello-linux 分支：path 赋值后仍用完整 path 的分支
# ---------------------------------------------------------------------------


def test_resolve_base_prefix_public_exact(site):
    md = write_md(site.docs, "a.md", "# A\n")
    (site.docs / "public" / "favicon.ico").write_bytes(b"1")
    got = cl.resolve_md_target(md, "/hello-linux/favicon.ico")
    assert got == (site.docs / "public" / "favicon.ico").resolve()


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


def test_load_ids_invalid_utf8_bytes_replaced(site):
    h = site.dist / "bad.html"
    h.write_bytes(b'<div id="ok"></div>\xff\xfe')
    assert cl.load_ids(h) == {"ok"}


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
