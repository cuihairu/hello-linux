"""check_links.py 单测：CLI/入口层与端到端集成。

main() 的退出码与输出契约（docs 缺失、--require-html 优先级、favicon、
空站点 100% 口径）、__main__ 守卫、并发构建防误杀、真实仓库
docs:build → check_links 全链路、注入/修复往返、npm scripts 口径一致性。
覆盖率目标：行覆盖 100% + 分支覆盖 100%（.coveragerc fail_under=100）。
"""

from __future__ import annotations

import json
import os
import re
import runpy
import shutil
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

import pytest

import check_links as cl  # noqa: F401  # conftest 已把 scripts 加入 sys.path
from helpers_cl import REPO_ROOT, RESULT_RE, write_html, write_md


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def test_main_docs_missing(monkeypatch, capsys):
    # docs 缺失分支（L391）优先于 --require-html（L461）：早退且不报 require 错误
    monkeypatch.setattr(cl, "DOCS", Path("/nonexistent/docs-for-test"))
    monkeypatch.setattr(sys, "argv", ["check_links.py", "--require-html"])
    assert cl.main() == 1
    err = capsys.readouterr().err
    assert "docs/ not found" in err
    assert "ERROR: --require-html" not in err


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
    # config 报告行应体现 '/' 这一外部链接，避免 links/ok 差数被误读为死链
    assert "config:" in out
    assert "'external': 1" in out


def test_main_fail_returns_1(site, monkeypatch, capsys):
    write_md(site.docs, "bad.md", "# B\n\n[d](missing.md)\n")
    monkeypatch.setattr(sys, "argv", ["check_links.py"])
    assert cl.main() == 1
    out = capsys.readouterr().out
    assert "dead-link" in out


def test_main_html_skipped_paths(site, monkeypatch, capsys):
    write_md(site.docs, "ok.md", "# O\n")
    monkeypatch.setattr(sys, "argv", ["check_links.py"])
    # fixture 的 dist 目录存在但为空（rglob 无 html）→ html_skipped
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


@pytest.mark.skipif(
    not cl.DIST.is_dir(),
    reason="需先 npm run docs:build；无 dist 时源码级中文锚点近似误报 hardening.md",
)
def test_main_script_entry(site, monkeypatch, capsys):
    """覆盖 __main__ 守卫：真实仓库全量执行须全绿退出（不再 in (0,1) 宽容）。"""
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
    assert ei.value.code == 0
    out = capsys.readouterr().out
    m = RESULT_RE.search(out)
    assert m, out
    assert int(m[1]) == int(m[3]) and int(m[2]) == 0
    assert float(m[4]) == 100.0


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
# 并发构建防误杀
# ---------------------------------------------------------------------------

# 真实构建进程的 argv0 形态；排除 grep/python 等仅在命令文本里含关键词的进程
_BUILD_ARGV0 = {"node", "sh", "bash", "npm", "pnpm", "yarn", "bun", "vitepress"}


def _concurrent_vitepress_build() -> bool:
    """检测本仓库 cwd 内是否有真实 vitepress build 进程（防构建竞态，仅 Linux）。

    三重限定防误杀：cwd 必须属于本仓库（其他项目的 build 无关）、argv0 必须
    是构建进程形态（排除含关键词的文本命令）、排除自身进程树。
    """
    try:
        names = os.listdir("/proc")
    except OSError:
        return False
    repo = str(REPO_ROOT)
    ancestors: set[int] = set()
    pid = os.getpid()
    while pid > 1 and pid not in ancestors:
        ancestors.add(pid)
        try:
            with open(
                f"/proc/{pid}/stat", encoding="utf-8", errors="replace"
            ) as f:
                fields = f.read().rsplit(")", 1)[1].split()
            pid = int(fields[1])
        except (OSError, ValueError, IndexError):
            break
    for name in names:
        if not name.isdigit() or int(name) in ancestors:
            continue
        try:
            cwd = os.readlink(f"/proc/{name}/cwd")
        except OSError:
            continue
        if cwd != repo and not cwd.startswith(repo + os.sep):
            continue  # 其他项目的 build 与本仓库 .vitepress 无关
        try:
            with open(f"/proc/{name}/cmdline", "rb") as f:
                cmd = f.read().replace(b"\0", b" ").decode("utf-8", "replace")
        except OSError:
            continue
        argv0 = Path(cmd.split(" ", 1)[0]).name if cmd else ""
        if argv0 not in _BUILD_ARGV0:
            continue
        if "vitepress" in cmd and "build" in cmd:
            return True
    return False


@pytest.mark.skipif(
    not Path("/proc").is_dir(),
    reason="并发探测依赖 /proc（仅 Linux）",
)
def test_concurrent_build_guard_three_states(tmp_path):
    """guard 三态：本仓构建=命中、他仓构建=不误杀、非构建进程文本=不误杀。"""

    def probe(cwd: str, argv: list[str]) -> bool:
        proc = subprocess.Popen(
            argv, cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        try:
            time.sleep(0.3)
            return _concurrent_vitepress_build()
        finally:
            proc.terminate()
            proc.wait(timeout=10)

    # T1: 本仓库 cwd + 构建形态 argv0(sh) + 关键词 → 竞态命中
    assert probe(str(REPO_ROOT), ["sh", "-c", "sleep 30 # vitepress build"]) is True
    # T2: 其他项目 cwd 同命令 → 不误杀
    assert probe(str(tmp_path), ["sh", "-c", "sleep 30 # vitepress build"]) is False
    # T3: 本仓库 cwd 但 argv0 为 python（文本含关键词）→ 不误杀
    assert (
        probe(str(REPO_ROOT), ["python3", "-c", "print('vitepress build')"]) is False
    )


# ---------------------------------------------------------------------------
# 端到端集成：真实 docs:build → 链接检查全链路 / 输出契约 / 口径一致性
# ---------------------------------------------------------------------------


def test_e2e_real_docs_build_then_link_check():
    """核心全链路（CI 主链路本地复刻）：docs:build → check_links --require-html。"""
    if shutil.which("npm") is None:
        pytest.skip("npm 不可用")
    if not (REPO_ROOT / "node_modules" / ".bin" / "vitepress").exists():
        pytest.skip("node_modules 未安装（先 npm ci）")
    if _concurrent_vitepress_build():
        pytest.skip("检测到并发 vitepress build，跳过以避免构建竞态")

    build = subprocess.run(
        ["npm", "run", "docs:build"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert build.returncode == 0, build.stdout[-2000:] + build.stderr[-2000:]

    check = subprocess.run(
        [sys.executable, "scripts/check_links.py", "--require-html"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert check.returncode == 0, check.stdout + check.stderr
    assert "ERROR" not in check.stderr
    assert "issues: 0" in check.stdout

    m = RESULT_RE.search(check.stdout)
    assert m, check.stdout
    passed, failed, total, rate = (
        int(m[1]),
        int(m[2]),
        int(m[3]),
        float(m[4]),
    )
    assert total > 0 and failed == 0 and passed == total
    assert rate == 100.0
    # 产物级 HTML 确有被校验（防空跑 / 空 dist）
    assert re.search(r"'same': [1-9]\d*", check.stdout), check.stdout
    assert re.search(r"'int': [1-9]\d*", check.stdout), check.stdout


@pytest.mark.skipif(
    not cl.DIST.is_dir(),
    reason="需先 npm run docs:build；无 dist 时产物级校验被跳过",
)
def test_e2e_real_dist_html_green():
    """真实 dist：产物级 HTML 0 issues，且统计非空（非空跑）。"""
    issues: list[tuple] = []
    stats: Counter = Counter()
    cl.check_html(issues, stats)
    assert issues == [], issues
    assert stats["html_all"] > 0
    assert stats["html_same"] > 0
    assert stats["html_int"] > 0
    assert stats["html_page"] > 0
    assert stats["asset"] > 0


def test_e2e_fixture_inject_repair_roundtrip(site, monkeypatch, capsys):
    """行为级往返：干净站 → 注入死链 → 修复，退出码与 RESULT 输出一致。"""
    write_md(site.docs, "index.md", "# I\n\n[ok](#i)\n[g](guide)\n")
    write_md(site.docs, "guide.md", "# G\n")
    write_html(
        site.dist,
        "index.html",
        '<html><body><h1 id="i">i</h1><a href="#i">x</a></body></html>',
    )
    write_html(site.dist, "guide.html", "<html></html>")
    cfg = site.vpc / "config.mts"
    cfg.write_text("nav: [ { link: '/index' } ]\n", encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["check_links.py"])

    # 1) 干净站 → 0，输出算术自洽
    assert cl.main() == 0
    out = capsys.readouterr().out
    m = RESULT_RE.search(out)
    assert m, out
    passed, failed, total, rate = (
        int(m[1]),
        int(m[2]),
        int(m[3]),
        float(m[4]),
    )
    assert total > 0 and passed + failed == total
    assert rate == pytest.approx(100.0 * (total - failed) / total)
    assert failed == 0 and "issues: 0" in out
    assert "html:" in out and "skipped" not in out

    # 2) 注入死链 → 1，fail=1 且 rate < 100
    write_md(site.docs, "bad.md", "# B\n\n[d](missing.md)\n")
    assert cl.main() == 1
    out2 = capsys.readouterr().out
    m2 = RESULT_RE.search(out2)
    assert m2, out2
    assert int(m2[2]) == 1 and int(m2[2]) < int(m2[3])
    assert "dead-link" in out2
    assert float(m2[4]) < 100.0

    # 3) 修复死链 → 0，fail 归零
    write_md(site.docs, "missing.md", "# M\n")
    assert cl.main() == 0
    out3 = capsys.readouterr().out
    m3 = RESULT_RE.search(out3)
    assert m3 and int(m3[2]) == 0 and "issues: 0" in out3


def test_docs_cov_is_docs_test_plus_coverage_only():
    """口径一致性：docs:cov = docs:test + 纯覆盖率参数，跑同一测试集。"""
    pkg = json.loads((REPO_ROOT / "package.json").read_text(encoding="utf-8"))
    scripts = pkg["scripts"]
    test_cmd = scripts["docs:test"]
    cov_cmd = scripts["docs:cov"]
    # 两套命令的 pytest 调用与测试集落点必须一致
    assert "-m pytest tests/" in test_cmd
    assert cov_cmd.startswith(test_cmd), (test_cmd, cov_cmd)
    tail = cov_cmd[len(test_cmd) :]
    assert "--cov=check_links" in tail
    assert "--cov-branch" in tail
    # 尾部不得引入任何测试选择器（否则两套口径会跑出不同用例集）
    for flag in ("-k ", " -m ", "--deselect", "--ignore", "--maxfail"):
        assert flag not in tail, flag
    ini = (REPO_ROOT / "pytest.ini").read_text(encoding="utf-8")
    assert "testpaths = tests" in ini
