"""check_links 测试共享辅助（fixture 见 conftest.py，按场景分组的用例见 test_check_links_*.py）。"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

RESULT_RE = re.compile(r"RESULT pass=(\d+) fail=(\d+) total=(\d+) rate=([\d.]+)%")


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
