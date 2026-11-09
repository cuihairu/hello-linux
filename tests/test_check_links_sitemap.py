"""check_links.py 单测：sitemap 层（check_sitemap）。

sitemap.xml 与 dist 产物页的双向对账：loc 死链、页面缺失、
404 豁免、无 dist / 无 config / 未声明 sitemap 时的静默跳过。
覆盖率目标：行覆盖 100% + 分支覆盖 100%（.coveragerc fail_under=100）。
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import pytest

import check_links as cl  # noqa: F401  # conftest 已把 scripts 加入 sys.path
from helpers_cl import write_html


def _write_sitemap(site, locs: list[str]) -> None:
    body = "".join(f"<url><loc>{loc}</loc></url>" for loc in locs)
    (site.dist / "sitemap.xml").write_text(
        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>',
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# check_sitemap
# ---------------------------------------------------------------------------


def test_check_sitemap_skips_without_dist(site, monkeypatch):
    monkeypatch.setattr(cl, "DIST", site.root / "nope")
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_sitemap(issues, stats)
    assert issues == []
    assert not stats


def test_check_sitemap_missing_file_no_config_is_silent(site):
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_sitemap(issues, stats)  # 无 sitemap.xml 且无 config.mts ⇒ 跳过
    assert issues == []
    assert not stats


def test_check_sitemap_missing_file_without_sitemap_config_is_silent(site):
    (site.vpc / "config.mts").write_text("export default {}", encoding="utf-8")
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_sitemap(issues, stats)  # config 未声明 sitemap ⇒ 不校验
    assert issues == []
    assert not stats


def test_check_sitemap_missing_file_with_sitemap_config_flags(site):
    (site.vpc / "config.mts").write_text(
        "sitemap: { hostname: 'https://example.com' }", encoding="utf-8"
    )
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_sitemap(issues, stats)
    assert issues == [
        ("docs/.vitepress/dist/sitemap.xml", "sitemap", "missing", "config 声明了 sitemap")
    ]
    assert stats["smap_missing_file"] == 1


def test_check_sitemap_full_pass(site):
    d = site.dist
    write_html(d, "index.html", "<html></html>")
    write_html(d, "guide.html", "<html></html>")
    write_html(d, "sub/index.html", "<html></html>")
    write_html(d, "clean/index.html", "<html></html>")
    write_html(d, "other.html", "<html></html>")
    write_html(d, "404.html", "<html></html>")
    _write_sitemap(
        site,
        [
            "https://cuihairu.github.io/hello-linux/",  # 首页（rel 为空）
            "https://cuihairu.github.io/hello-linux/index.html",
            "https://cuihairu.github.io/hello-linux/guide.html",
            "https://cuihairu.github.io/hello-linux/sub/",  # 目录形态
            "https://cuihairu.github.io/hello-linux/clean",  # 无后缀，走第三候选
            "https://elsewhere.example.com/other.html",  # 非 BASE 前缀
        ],
    )
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_sitemap(issues, stats)
    assert issues == []
    assert stats["smap_locs"] == 6
    assert stats["smap_loc_ok"] == 6
    assert stats["smap_loc_dead"] == 0
    # 404.html 不入 sitemap，豁免后不计 page_missing
    assert stats["smap_page_ok"] == 5
    assert stats["smap_page_missing"] == 0


def test_check_sitemap_flags_dead_loc(site):
    _write_sitemap(site, ["https://cuihairu.github.io/hello-linux/gone.html"])
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_sitemap(issues, stats)
    assert issues == [
        (
            "docs/.vitepress/dist/sitemap.xml",
            "sitemap",
            "dead-loc",
            "https://cuihairu.github.io/hello-linux/gone.html",
        )
    ]
    assert stats["smap_locs"] == 1
    assert stats["smap_loc_dead"] == 1
    assert stats["smap_loc_ok"] == 0
    assert stats["smap_page_ok"] == 0


def test_check_sitemap_flags_page_missing(site):
    d = site.dist
    write_html(d, "index.html", "<html></html>")
    write_html(d, "extra.html", "<html></html>")
    write_html(d, "404.html", "<html></html>")
    _write_sitemap(site, ["https://cuihairu.github.io/hello-linux/"])
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_sitemap(issues, stats)
    assert issues == [
        ("docs/.vitepress/dist/sitemap.xml", "sitemap", "not-in-sitemap", "/extra")
    ]
    assert stats["smap_page_ok"] == 1
    assert stats["smap_page_missing"] == 1
