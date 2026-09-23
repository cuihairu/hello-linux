#!/usr/bin/env python3
"""全站链接 / 锚点 / 图片引用检查（等价于本仓库的测试套件）。

模式：
  1) 源码级：扫描 docs/**/*.md 的内部链接、锚点、图片（围栏内跳过）
  2) 产物级（可选）：docs/.vitepress/dist 存在时，校验全部 HTML 的 href/src/id

退出码：0 = 100% 通过；1 = 存在死链或错误锚点。
"""

from __future__ import annotations

import html as htmllib
import re
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urljoin

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
DIST = DOCS / ".vitepress" / "dist"
BASE = "/hello-linux/"

LINK_RE = re.compile(r"(!?)\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HTML_A_RE = re.compile(r"""<a\s[^>]*href=["']([^"']+)["']""", re.I)
HTML_IMG_RE = re.compile(r"""<img\s[^>]*src=["']([^"']+)["']""", re.I)
REF_DEF_RE = re.compile(r"^\[[^\]]+\]:\s*(\S+)", re.M)
HREF_SRC_RE = re.compile(r"""(?:href|src)=["']([^"']+)["']""")
FENCE_RE = re.compile(r"^\s*(```|~~~)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
ID_RE = re.compile(r"""\bid=["']([^"']+)["']""")
NAME_RE = re.compile(r"""\bname=["']([^"']+)["']""")

EXTERNAL_PREFIXES = (
    "http://",
    "https://",
    "//",
    "mailto:",
    "javascript:",
    "data:",
    "tel:",
)


def blank_fences(text: str) -> str:
    out: list[str] = []
    fence = False
    for line in text.splitlines():
        if FENCE_RE.match(line):
            fence = not fence
            out.append("")
            continue
        out.append("" if fence else line)
    return "\n".join(out)


def is_external(target: str) -> bool:
    return target.startswith(EXTERNAL_PREFIXES) or bool(
        re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target)
    )


def extract_headings(text: str) -> list[str]:
    heads: list[str] = []
    fence = False
    for line in text.splitlines():
        if FENCE_RE.match(line):
            fence = not fence
            continue
        if fence:
            continue
        m = HEADING_RE.match(line)
        if m:
            heads.append(m.group(2))
    return heads


def slugify_vitepress(heading: str) -> str:
    """Approximate VitePress/@mdit-vue heading id (good enough for source pre-check)."""
    t = re.sub(r"`([^`]*)`", r"\1", heading)
    t = re.sub(r"\*\*([^*]*)\*\*", r"\1", t)
    t = re.sub(r"\*([^*]*)\*", r"\1", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = t.strip().lower()
    out = []
    for ch in t:
        if ch.isalnum() or ch in "-_ " or ord(ch) > 127:
            out.append(ch)
    s = re.sub(r"\s+", "-", "".join(out).strip())
    s = re.sub(r"-+", "-", s)
    # VitePress prefixes ids that would start with a digit
    if s and (s[0].isdigit()):
        s = "_" + s
    return s


def source_anchor_set(md: Path) -> set[str]:
    anchors: set[str] = set()
    text = md.read_text(encoding="utf-8")
    for h in extract_headings(text):
        slug = slugify_vitepress(h)
        anchors.add(slug)
    for m in re.finditer(r"""(?:id|name)=["']([^"']+)["']""", text):
        anchors.add(m.group(1))
    return anchors


def md_files() -> list[Path]:
    return sorted(
        p for p in DOCS.rglob("*.md") if ".vitepress" not in p.parts
    )


def resolve_md_target(src: Path, path: str) -> Path | None:
    path = unquote(path)
    cands: list[Path] = []
    if path.startswith("/hello-linux/"):
        p2 = path[len("/hello-linux/") :]
        cands += [
            DOCS / p2,
            DOCS / f"{p2}.md",
            DIST / p2,
            DIST / f"{p2}.html",
            DOCS / "public" / p2,
        ]
        path = p2
    if path.startswith("/"):
        cands += [
            DOCS / path.lstrip("/"),
            DOCS / f"{path.lstrip('/')}.md",
            DOCS / "public" / path.lstrip("/"),
        ]
    else:
        base = src.parent / path
        cands += [base, Path(f"{base}.md"), DOCS / "public" / path]
        if base.suffix == "":
            cands.append(base.with_suffix(".md"))
    for c in cands:
        try:
            if c.exists() and c.is_file():
                return c.resolve()
        except OSError:
            continue
    return None


def html_for_md(md: Path) -> Path | None:
    if not DIST.is_dir():
        return None
    try:
        rel = md.resolve().relative_to(DOCS.resolve()).with_suffix(".html")
    except ValueError:
        return None
    h = DIST / rel
    return h if h.exists() else None


def load_ids(path: Path) -> set[str]:
    t = path.read_text(encoding="utf-8", errors="replace")
    return set(ID_RE.findall(t)) | set(NAME_RE.findall(t))


def check_source(issues: list[tuple], stats: Counter) -> None:
    id_cache: dict[Path, set[str]] = {}

    def ids_for_html(h: Path) -> set[str]:
        if h not in id_cache:
            id_cache[h] = load_ids(h)
        return id_cache[h]

    def fail(src: Path, kind: str, code: str, target: str) -> None:
        issues.append((str(src.relative_to(ROOT)), kind, code, target))

    def check(target: str, src: Path, kind: str) -> None:
        target = target.strip()
        if not target:
            fail(src, kind, "empty", target)
            return
        if is_external(target):
            stats["external"] += 1
            return
        stats[kind] += 1

        if target.startswith("#"):
            stats["anchor_same"] += 1
            a = unquote(target[1:])
            if not a:
                return
            h = html_for_md(src)
            if h is not None:
                if a not in ids_for_html(h) and htmllib.unescape(a) not in ids_for_html(h):
                    fail(src, kind, "dead-anchor-same", target)
                return
            # no dist: approximate via headings
            if a not in source_anchor_set(src):
                fail(src, kind, "dead-anchor-same", target)
            return

        if "#" in target:
            path, anc = target.split("#", 1)
            anc = unquote(anc)
        else:
            path, anc = target, None
        if not path:
            return

        stats["internal"] += 1
        resolved = resolve_md_target(src, path)
        if resolved is None:
            fail(src, kind, "dead-link", target)
            return
        stats["internal_ok"] += 1

        if anc is None:
            return
        stats["anchor_cross"] += 1
        if resolved.suffix != ".md":
            return
        h = html_for_md(resolved)
        if h is not None:
            if anc not in ids_for_html(h) and htmllib.unescape(anc) not in ids_for_html(h):
                fail(src, kind, "dead-anchor", target)
            return
        if anc not in source_anchor_set(resolved):
            fail(src, kind, "dead-anchor", target)

    for p in md_files():
        scan = blank_fences(p.read_text(encoding="utf-8"))
        for m in LINK_RE.finditer(scan):
            check(m.group(2), p, "image" if m.group(1) else "md_link")
        for m in HTML_A_RE.finditer(scan):
            check(m.group(1), p, "html_a")
        for m in HTML_IMG_RE.finditer(scan):
            check(m.group(1), p, "html_img")
        for m in REF_DEF_RE.finditer(scan):
            check(m.group(1), p, "ref_def")

    readme = ROOT / "README.md"
    if readme.exists():
        scan = blank_fences(readme.read_text(encoding="utf-8"))
        for m in LINK_RE.finditer(scan):
            t = m.group(2).strip()
            if is_external(t) or t.startswith("#"):
                stats["external"] += 1
                continue
            path = unquote(t.split("#")[0])
            if not path:
                continue
            cands = [
                ROOT / path,
                Path(f"{ROOT / path}.md"),
                DOCS / path,
                DOCS / f"{path}.md",
            ]
            if any(c.exists() for c in cands):
                stats["internal_ok"] += 1
            else:
                issues.append(("README.md", "md_link", "dead-link", t))


def check_config(issues: list[tuple], stats: Counter) -> None:
    cfg = DOCS / ".vitepress" / "config.mts"
    if not cfg.exists():
        return
    text = cfg.read_text(encoding="utf-8")
    links = re.findall(r"link:\s*'([^']+)'", text)
    stats["config_links"] = len(links)
    for link in links:
        if link.startswith("http") or link == "/":
            stats["external"] += 1
            continue
        if link.startswith("#"):
            continue
        path = link.lstrip("/").split("#")[0]
        if not path:
            continue
        src_ok = any(
            c.exists()
            for c in (
                DOCS / f"{path}.md",
                DOCS / path / "README.md",
                DOCS / path / "index.md",
                DOCS / path,
            )
        )
        dist_ok = any(
            c.exists()
            for c in (
                DIST / f"{path}.html",
                DIST / path / "index.html",
            )
        )
        if src_ok or dist_ok:
            stats["config_ok"] += 1
        else:
            issues.append(
                ("docs/.vitepress/config.mts", "config", "dead-link", link)
            )


def route_of(h: Path) -> str:
    rel = h.relative_to(DIST).as_posix()
    if rel == "index.html":
        return "/"
    if rel.endswith("/index.html"):
        return "/" + rel[: -len("index.html")]
    if rel.endswith(".html"):
        return "/" + rel[:-5]
    return "/" + rel


def check_html(issues: list[tuple], stats: Counter) -> None:
    if not DIST.is_dir():
        stats["html_skipped"] = 1
        return
    html_files = sorted(DIST.rglob("*.html"))
    if not html_files:
        stats["html_skipped"] = 1
        return

    ids: dict[Path, set[str]] = {}
    for h in html_files:
        ids[h] = load_ids(h)

    for h in html_files:
        text = h.read_text(encoding="utf-8", errors="replace")
        rel = str(h.relative_to(DIST))
        cur = route_of(h)
        cur_dir = cur if cur.endswith("/") else cur.rsplit("/", 1)[0] + "/"
        for m in HREF_SRC_RE.finditer(text):
            raw = m.group(1)
            stats["html_all"] += 1
            if raw.startswith(EXTERNAL_PREFIXES):
                stats["external"] += 1
                continue
            if raw.startswith("#"):
                stats["html_same"] += 1
                a = unquote(raw[1:])
                if a and a not in ids[h] and htmllib.unescape(a) not in ids[h]:
                    issues.append((rel, "html", "dead-anchor-same", raw))
                continue
            if raw.startswith(BASE):
                rest = raw[len(BASE) :]
            elif raw.startswith("/"):
                stats["outside_base"] += 1
                continue
            else:
                rest = urljoin(cur_dir, raw)
                if rest.startswith(BASE):
                    rest = rest[len(BASE) :]
                else:
                    rest = rest.lstrip("/")
            stats["html_int"] += 1
            if "#" in rest:
                path, anc = rest.split("#", 1)
                anc = unquote(htmllib.unescape(anc))
            else:
                path, anc = rest, None
            path = unquote(path).lstrip("/")
            if not path:
                continue
            fp = DIST / path
            if fp.is_file() and not path.endswith(".html"):
                stats["asset"] += 1
                continue
            target: Path | None = None
            if path.endswith(".html"):
                cands = [path, path[:-5], path[:-5] + "/index.html"]
            elif path.endswith("/"):
                cands = [path + "index.html", path]
            else:
                cands = [path + ".html", path, path.rstrip("/") + "/index.html"]
            for c in cands:
                if (DIST / c).is_file():
                    target = DIST / c
                    break
            if target is None and (DIST / path / "index.html").is_file():
                target = DIST / path / "index.html"
            if target is None:
                issues.append((rel, "html", "dead-link", raw))
                continue
            stats["html_page"] += 1
            if anc:
                stats["html_xanc"] += 1
                if anc not in ids[target] and htmllib.unescape(anc) not in ids[target]:
                    issues.append((rel, "html", "dead-anchor", raw))


def main() -> int:
    if not DOCS.is_dir():
        print("docs/ not found", file=sys.stderr)
        return 1

    issues: list[tuple] = []
    stats: Counter = Counter()

    check_source(issues, stats)
    check_config(issues, stats)
    check_html(issues, stats)

    # Public assets referenced by config head/logo
    for asset in ("favicon.svg",):
        p = DOCS / "public" / asset
        if not p.exists():
            issues.append(("docs/public", "asset", "missing", asset))
        else:
            stats["public_asset_ok"] += 1

    src_checked = (
        stats["md_link"]
        + stats["image"]
        + stats["html_a"]
        + stats["html_img"]
        + stats["ref_def"]
        + stats["anchor_same"]
        + stats["config_ok"]
    )
    html_checked = stats["html_same"] + stats["html_int"]
    total_checked = src_checked + html_checked
    failed = len(issues)
    passed = total_checked - failed
    rate = (100.0 * passed / total_checked) if total_checked else 100.0

    print("=== link/anchor check ===")
    print(
        "source:",
        {
            "md_link": stats["md_link"],
            "image": stats["image"] + stats["html_img"],
            "internal": stats["internal"],
            "internal_ok": stats["internal_ok"],
            "anchor_same": stats["anchor_same"],
            "anchor_cross": stats["anchor_cross"],
            "external": stats["external"],
        },
    )
    print(
        "config:",
        {"links": stats["config_links"], "ok": stats["config_ok"]},
    )
    if stats["html_skipped"]:
        print("html: skipped (dist missing — run npm run docs:build first for full check)")
    else:
        print(
            "html:",
            {
                "same": stats["html_same"],
                "int": stats["html_int"],
                "page": stats["html_page"],
                "asset": stats["asset"],
            },
        )
    print(f"issues: {failed}")
    for it in issues:
        print(" ", it)
    print(f"RESULT pass={passed} fail={failed} total={total_checked} rate={rate:.4f}%")

    if failed:
        return 1
    if stats["html_skipped"] and "--require-html" in sys.argv:
        print("ERROR: --require-html set but dist missing", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
