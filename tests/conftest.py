"""测试装置：scripts 目录入 sys.path，并提供隔离假站点 fixture。

覆盖率目标：行覆盖 100% + 分支覆盖 100%（.coveragerc fail_under=100）。
用例按场景拆在 test_check_links_*.py；不可达分支的登记见
test_check_links_source_config.py 文末 COVERAGE_NOTES。
"""

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import check_links as cl  # noqa: E402  # type: ignore[import-not-found]


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
