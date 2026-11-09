"""check_links.py 单测：产物 HTML 层（check_html）。

校验 dist 产物内的 href/src：同页锚点、跨页锚点、BASE 前缀剥离、
目录 index 兜底、资源链接与 IO 错误路径。
覆盖率目标：行覆盖 100% + 分支覆盖 100%（.coveragerc fail_under=100）。
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import pytest

import check_links as cl  # noqa: F401  # conftest 已把 scripts 加入 sys.path
from helpers_cl import write_html


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
    # "/hello-linux/" → rest="" → path 空 → continue：计入 html_int 但不产生 issue
    assert not issues
    assert stats["html_int"] == 1


def test_check_html_dir_index_fallback(site):
    """L479：path 以 .html 结尾且 cands 全 miss，但 DIST/path/index.html 存在。

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


def test_check_html_unquoted_href_ignored(site):
    write_html(site.dist, "index.html", '<a href=/page.html>x</a><a href="/p2.html">y</a>')
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_html(issues, stats)
    # 无引号 href 不被 HREF_SRC_RE 匹配 → 不计入 html_all
    assert stats["html_all"] == 1
    assert stats["outside_base"] == 1  # /p2.html 不在 BASE 下
    assert not issues


def test_check_html_read_error_propagates(site, monkeypatch):
    write_html(site.dist, "index.html", '<a href="#x">x</a>')
    real = Path.read_text
    state = {"mode": "first", "n": 0}

    def boom(self: Path, *args, **kwargs):
        if self.suffix == ".html":
            state["n"] += 1
            if state["mode"] == "first" and state["n"] >= 1:
                raise OSError("boom-first")
            if state["mode"] == "second" and state["n"] >= 2:
                raise OSError("boom-second")
        return real(self, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", boom)
    # 首读 = load_ids（L160）抛错
    state.update(mode="first", n=0)
    with pytest.raises(OSError, match="boom-first"):
        cl.check_html([], Counter())
    # 二读 = L327 抛错
    state.update(mode="second", n=0)
    with pytest.raises(OSError, match="boom-second"):
        cl.check_html([], Counter())
