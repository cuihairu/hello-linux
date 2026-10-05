"""tree_art.py 单元测试 —— 零第三方依赖，全部可在纯 pytest 下运行。

不测 snap_png（依赖 playwright 浏览器截图，属人工实跑验证项，
README 用法一节已登记）；测噪声/分形、生物群落分类、世界生成、
quadtree 划分、网格渲染、ANSI/HTML 输出与 CLI 入口。
"""

from __future__ import annotations

import random
import re
import runpy
import sys
import types
from pathlib import Path

import pytest

import tree_art as ta  # noqa: E402  # type: ignore[import-not-found]


# ---------------------------------------------------------------------------
# ValueNoise / fbm
# ---------------------------------------------------------------------------


def test_value_noise_same_seed_same_grid():
    a = ta.ValueNoise(7, size=32)
    b = ta.ValueNoise(7, size=32)
    assert a.grid == b.grid
    assert a.sample(3.3, 4.4) == b.sample(3.3, 4.4)


def test_value_noise_different_seed_differs():
    a = ta.ValueNoise(7, size=32)
    b = ta.ValueNoise(8, size=32)
    assert a.grid != b.grid


def test_value_noise_sample_in_unit_range():
    n = ta.ValueNoise(9, size=32)
    for x, y in [(0.0, 0.0), (1.5, 2.5), (30.9, 31.1), (-2.3, 5.7)]:
        v = n.sample(x, y)
        assert 0.0 <= v <= 1.0


def test_value_noise_integer_coordinates_hit_grid_exactly():
    n = ta.ValueNoise(11, size=32)
    assert n.sample(3.0, 5.0) == n.grid[5][3]


def test_value_noise_wraps_coordinates_modulo_size():
    n = ta.ValueNoise(13, size=32)
    # 正向越界与负向越界都按 size 取模
    assert n.sample(32.0, 0.0) == n.sample(0.0, 0.0)
    assert n.sample(-1.0, 0.0) == n.sample(31.0, 0.0)


def test_fbm_single_octave_equals_plain_sample():
    n = ta.ValueNoise(17, size=32)
    assert ta.fbm(n, 1.25, 2.75, octaves=1) == n.sample(1.25, 2.75)


def test_fbm_deterministic_in_unit_range():
    n = ta.ValueNoise(19, size=32)
    rng = random.Random(5)
    for _ in range(50):
        x, y = rng.uniform(0, 20), rng.uniform(0, 20)
        v1 = ta.fbm(n, x, y)
        v2 = ta.fbm(n, x, y)
        assert v1 == v2
        assert 0.0 <= v1 <= 1.0


# ---------------------------------------------------------------------------
# PALETTE / classify
# ---------------------------------------------------------------------------


def test_palette_structure_invariants():
    assert set(ta.PALETTE) == {
        ta.DEEP, ta.SHALLOW, ta.RIVER, ta.SAND, ta.GRASS,
        ta.FOREST, ta.HILLS, ta.MOUNTAIN, ta.SNOW,
    }
    for name, (label, far_set, near_set, rgb) in ta.PALETTE.items():
        assert isinstance(label, str) and label, name
        assert far_set and near_set, name          # 远/近看字符集非空
        assert len(rgb) == 3 and all(0 <= c <= 255 for c in rgb), name
    for group in (ta.CANOPY_GREENS, [ta.TRUNK_BROWN, ta.BG]):
        for rgb in group:
            assert len(rgb) == 3 and all(0 <= c <= 255 for c in rgb)


@pytest.mark.parametrize(
    "e,m,expected",
    [
        (0.0, 0.5, ta.DEEP),
        (0.2999, 0.5, ta.DEEP),
        (0.30, 0.5, ta.SHALLOW),
        (0.3799, 0.5, ta.SHALLOW),
        (0.38, 0.5, ta.SAND),
        (0.4199, 0.5, ta.SAND),
        (0.42, 0.55, ta.GRASS),
        (0.5999, 0.56, ta.GRASS),      # m 恰为阈值不算湿（要求 > 0.56）
        (0.42, 0.9, ta.FOREST),
        (0.5999, 0.5601, ta.FOREST),
        (0.60, 0.5, ta.HILLS),
        (0.7399, 0.9, ta.HILLS),
        (0.74, 0.5, ta.MOUNTAIN),
        (0.8599, 0.5, ta.MOUNTAIN),
        (0.86, 0.5, ta.SNOW),
        (1.0, 0.5, ta.SNOW),
    ],
)
def test_classify_elevation_moisture_boundaries(e, m, expected):
    assert ta.classify(e, m, False) == expected


def test_classify_river_takes_priority_over_elevation():
    assert ta.classify(0.95, 0.9, True) == ta.RIVER


def test_classify_every_result_is_a_palette_entry():
    rng = random.Random(3)
    for _ in range(500):
        e, m = rng.random(), rng.random()
        assert ta.classify(e, m, False) in ta.PALETTE


# ---------------------------------------------------------------------------
# World
# ---------------------------------------------------------------------------


def test_world_dimensions_and_grid_shapes():
    w = ta.World(30, 16, 20261002)
    assert (w.w, w.h) == (30, 16)
    assert len(w.elev) == len(w.moist) == len(w.biome) == 16
    assert all(len(row) == 30 for row in w.elev)
    assert all(len(row) == 30 for row in w.river)


def test_world_four_corners_are_sea():
    # 径向衰减使角上 d=1、e ≤ 0.0732 < 0.30 ⇒ 必为深水（河流不下切到角）
    for seed in (20261002, 1, 7):
        w = ta.World(24, 12, seed)
        assert w.biome[0][0] == ta.DEEP
        assert w.biome[0][-1] == ta.DEEP
        assert w.biome[-1][0] == ta.DEEP
        assert w.biome[-1][-1] == ta.DEEP


def test_world_same_seed_reproducible():
    a = ta.World(30, 16, 5)
    b = ta.World(30, 16, 5)
    assert a.elev == b.elev
    assert a.moist == b.moist
    assert a.biome == b.biome
    assert a.river == b.river
    assert a.rivers == b.rivers


def test_world_different_seed_differs():
    a = ta.World(30, 16, 5)
    b = ta.World(30, 16, 6)
    assert a.elev != b.elev


def test_world_rivers_bounded_and_flagged():
    w = ta.World(40, 20, 20261002)
    assert 0 <= w.rivers <= 6  # 源头上限 6
    assert any(any(row) for row in w.river)  # 该种子有河


def test_world_biome_at_water_crafted_cells():
    w = ta.World(20, 10, 3)
    w.elev[2][3] = 0.10
    w.river[2][3] = False
    assert w.biome_at_water(3, 2) is True      # 低非河 → 水
    w.elev[4][5] = 0.50
    w.river[4][5] = False
    assert w.biome_at_water(5, 4) is False     # 高程不足低 → 非水
    w.elev[6][7] = 0.10
    w.river[6][7] = True
    assert w.biome_at_water(7, 6) is False     # 河格永不计为水


def test_world_span_single_cell_and_whole():
    w = ta.World(20, 10, 3)
    span, div = w.span(0, 0, 1, 1)
    assert span == 0.0 and div == 1
    span, div = w.span(0, 0, 20, 10)
    assert span >= 0.0 and div >= 1


# ---------------------------------------------------------------------------
# _carve_rivers 控制流（白盒：受控抖动序列驱动三条难达分支）
# ---------------------------------------------------------------------------


class _SeqRng:
    """按调用顺序吐值的 rng 替身（序列用尽后回落固定 fill）。"""

    def __init__(self, seq, fill: float = 0.5):
        self._seq = list(seq)
        self._fill = fill

    def random(self) -> float:
        return self._seq.pop(0) if self._seq else self._fill


def _bare_world(w: int, h: int, elev_v: float) -> ta.World:
    """绕过噪声生成的裸世界：只填 _carve_rivers 所需字段。"""
    world = ta.World.__new__(ta.World)
    world.w, world.h = w, h
    world.elev = [[elev_v] * w for _ in range(h)]
    world.moist = [[0.0] * w for _ in range(h)]
    world.rivers = 0
    return world


def test_carve_rivers_lake_when_path_hits_local_depression():
    # 36×36 全域 0.95（非湿非水），仅 S/P1/P2 三格处于湿区。
    # 受控抖动让 S→P1→P2 连续三步判为「上坡」⇒ 第三步 stuck=3 就地成湖。
    w = _bare_world(36, 36, 0.95)
    w.moist[1][1] = 0.9
    w.elev[1][1] = 0.70   # S 源头（湿区候选，分最高先入列）
    w.elev[1][2] = 0.705  # P1
    w.elev[2][2] = 0.706  # P2
    rng = _SeqRng(
        # S 扫描 8 邻：P1 居第 5 位取 0 抖动(0.705)、P2 第 8 位 0 抖动(0.706)
        [0.5, 0.5, 0.5, 0.5, 0.0, 0.5, 0.5, 0.0]
        # P1 扫描：S 第 4 位 1.0→0.712、P2 第 7 位 0.4→0.7108（严格最小且 ≥0.709）
        + [0.5, 0.5, 0.5, 1.0, 0.5, 0.5, 0.4, 0.5]
        # P2 扫描：S 第 1 位 1.0→0.712、P1 第 2 位 0.5→0.711 ≥ 0.710 ⇒ stuck=3
        + [1.0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
    )
    w._carve_rivers(rng)
    assert w.rivers == 1          # 仅 S 入选：P1/P2 距源 1~1.4 格 < 6 被间距拒绝
    assert w.river[1][1] is True  # 源
    assert w.river[1][2] is True  # P1
    assert w.river[2][2] is True  # P2 就地成湖（stuck≥3 标记后 break）
    assert w.river[3][2] is False  # 成湖后不再延伸


def test_carve_rivers_loop_exhaustion_falls_to_else():
    # w=2 ⇒ 单源循环上限 w*2=4 次；抖动把路径梳成竖直下行 4 个全为新格，
    # 不回河、不入海、不成湖 ⇒ for 按条件耗尽走 else（pass）。
    w = _bare_world(2, 8, 0.70)
    w.moist[0][0] = 0.9
    rng = _SeqRng(
        # (0,0)：3 个在界邻居，目标 (0,1) 居第 2 位
        [1.0, 0.0, 1.0]
        # (0,1)、(0,2)、(0,3)：各 5 个在界邻居，目标 (0,y+1) 均居第 4 位
        + [1.0, 1.0, 1.0, 0.0, 1.0] * 3
    )
    w._carve_rivers(rng)
    assert w.rivers == 6  # 其余湿格同样入列（间距 2/6 < 1 格距）凑满 6 源上限
    assert w.river[0][0] is True
    assert w.river[1][0] is True
    assert w.river[2][0] is True
    assert w.river[3][0] is True  # 恰好 4 次新格迭代后耗尽 → else 分支


# ---------------------------------------------------------------------------
# build_quadtree
# ---------------------------------------------------------------------------


class StubWorld:
    """只实现 quadtree 所需接口的均匀世界替身。"""

    def __init__(self, w, h, span, diversity):
        self.w, self.h = w, h
        self._span, self._div = span, diversity

    def span(self, x, y, w, h):  # noqa: ARG002
        return self._span, self._div


def test_quadtree_uniform_world_is_single_leaf():
    leaves = ta.build_quadtree(StubWorld(20, 10, 0.0, 1))
    assert len(leaves) == 1
    leaf = leaves[0]
    assert (leaf.x, leaf.y, leaf.w, leaf.h) == (0, 0, 20, 10)
    assert leaf.busy is False


def test_quadtree_busy_world_subdivides():
    # 根 20×10 忙 → 四分为 10×5；10×5 仍忙 → 再四分为 5×2/5×3（w<6 停）
    leaves = ta.build_quadtree(StubWorld(20, 10, 0.5, 1))
    assert len(leaves) == 16
    assert sum(l.w * l.h for l in leaves) == 200  # 面积守恒


def test_quadtree_respects_max_depth_zero():
    leaves = ta.build_quadtree(StubWorld(20, 10, 0.5, 1), max_depth=0)
    assert len(leaves) == 1
    assert leaves[0].busy is True


def test_quadtree_size_gate_stops_subdivision():
    # w<6 或 h<3 时即便忙也不再细分
    assert len(ta.build_quadtree(StubWorld(4, 10, 0.5, 1))) == 1
    assert len(ta.build_quadtree(StubWorld(20, 2, 0.5, 1))) == 1


def test_quadtree_covers_world_exactly_no_overlap():
    w = ta.World(40, 20, 20261002)
    leaves = ta.build_quadtree(w)
    occ = [[0] * w.w for _ in range(w.h)]
    for l in leaves:
        assert l.x >= 0 and l.y >= 0
        assert l.x + l.w <= w.w and l.y + l.h <= w.h
        for j in range(l.y, l.y + l.h):
            for i in range(l.x, l.x + l.w):
                occ[j][i] += 1
    assert all(all(c == 1 for c in row) for row in occ)


# ---------------------------------------------------------------------------
# render_grid
# ---------------------------------------------------------------------------


def _allowed_chars() -> set[str]:
    allowed: set[str] = set()
    for _, far_set, near_set, _ in ta.PALETTE.values():
        allowed.update(far_set)
        allowed.update(near_set)
    allowed.update({"&", "%", "@", "|"})  # 树冠 + 树干
    return allowed


def test_render_grid_shape_charset_and_colors():
    w = ta.World(40, 20, 42)
    chars, colors = ta.render_grid(w, 42)
    allowed = _allowed_chars()
    assert len(chars) == len(colors) == 20
    assert all(len(row) == 40 for row in chars)
    assert all(len(ch) == 1 and ch in allowed for row in chars for ch in row)
    assert all(
        len(rgb) == 3 and all(0 <= c <= 255 for c in rgb)
        for row in colors for rgb in row
    )


def test_render_grid_deterministic_per_seed():
    w = ta.World(30, 16, 42)
    a_chars, a_colors = ta.render_grid(w, 7)
    b_chars, b_colors = ta.render_grid(w, 7)
    assert a_chars == b_chars
    assert a_colors == b_colors
    c_chars, _ = ta.render_grid(w, 8)
    assert a_chars != c_chars


def test_render_grid_paints_trees_on_forest():
    w = ta.World(40, 20, 42)
    chars, colors = ta.render_grid(w, 42)
    trees = sum(r.count("&") + r.count("%") + r.count("@") for r in chars)
    assert trees > 0
    trunks = sum(r.count("|") for r in chars)
    assert trunks > 0
    # 树干必为树干棕
    assert ta.TRUNK_BROWN in [
        colors[j][i]
        for j in range(len(colors))
        for i in range(len(colors[0]))
        if chars[j][i] == "|"
    ]


# ---------------------------------------------------------------------------
# ANSI 输出
# ---------------------------------------------------------------------------


def test_ansi_escape_exact_format():
    assert ta.ansi_escape((1, 2, 3)) == "\x1b[38;2;1;2;3m"
    assert ta.ansi_escape((255, 254, 253)) == "\x1b[38;2;255;254;253m"


def test_render_ansi_line_structure_and_run_compression():
    chars = [["a", "b"], ["c", "d"]]
    colors = [[(1, 2, 3), (1, 2, 3)], [(4, 5, 6), (7, 8, 9)]]
    out = ta.render_ansi(chars, colors)
    lines = out.split("\n")
    assert len(lines) == 2 + 2  # 背景行 + 每行 + 复位行
    assert lines[0] == "\x1b[48;2;10;13;18m"
    assert lines[-1] == "\x1b[0m"
    # 同色相邻只发一次转义（run 压缩）
    assert lines[1] == "\x1b[38;2;1;2;3mab\x1b[39m"
    assert lines[2] == "\x1b[38;2;4;5;6mc\x1b[38;2;7;8;9md\x1b[39m"
    assert out.count("\x1b[38;2;1;2;3m") == 1


def test_render_ansi_real_world_roundtrip():
    w = ta.World(24, 12, 5)
    chars, colors = ta.render_grid(w, 5)
    out = ta.render_ansi(chars, colors)
    assert out.startswith("\x1b[48;2;")
    assert out.endswith("\x1b[0m")
    # 每个字符网格行对应一个带行终止转义的输出行
    assert out.count("\x1b[39m") == 12


# ---------------------------------------------------------------------------
# HTML 输出
# ---------------------------------------------------------------------------


def test_render_html_doctype_seed_dims_and_legend():
    w = ta.World(24, 12, 5)
    chars, colors = ta.render_grid(w, 5)
    html = ta.render_html(chars, colors, 5)
    assert html.startswith("<!doctype html>")
    assert 'lang="zh-CN"' in html
    assert "seed 5" in html
    assert "24×12" in html
    assert 'id="scene"' in html
    for label, _, _, _ in ta.PALETTE.values():
        assert label in html  # 图例收录全部生物群落


def test_render_html_escapes_ampersand_and_runs_spans():
    chars = [["&", "x", "y"]]
    colors = [[(1, 2, 3), (1, 2, 3), (4, 5, 6)]]
    html = ta.render_html(chars, colors, 9)
    scene = html.split('<pre id="scene">')[1].split("</pre>")[0]
    # 同色两格合并为一个 span，& 转义为 &amp;
    assert scene == '<span style="color:#010203">&amp;x</span><span style="color:#040506">y</span>'
    assert not re.search(r"&(?!amp;)", html)  # 全文无裸 &


def test_render_html_empty_row_skips_span_append():
    # 空行：循环体不执行、run 仍空 ⇒ 尾部 span 追加分支不触发
    html = ta.render_html([[]], [[]], 0)
    assert '<pre id="scene"></pre>' in html


def test_snap_png_drives_playwright(monkeypatch):
    calls: dict = {}

    class _Loc:
        def screenshot(self, path):
            calls["shot"] = path

    class _Page:
        def goto(self, url):
            calls["goto"] = url

        def locator(self, sel):
            calls["locator"] = sel
            return _Loc()

    class _Browser:
        def new_page(self, device_scale_factor=None):
            calls["dsf"] = device_scale_factor
            return _Page()

        def close(self):
            calls["closed"] = True

    class _Chromium:
        def launch(self):
            return _Browser()

    class _Pw:
        chromium = _Chromium()

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    pkg = types.ModuleType("playwright")
    api = types.ModuleType("playwright.sync_api")
    api.sync_playwright = lambda: _Pw()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "playwright", pkg)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", api)

    ta.snap_png("/tmp/scene.html", "/tmp/scene.png")
    assert calls["goto"] == "file:///tmp/scene.html"
    assert calls["locator"] == "body"
    assert calls["dsf"] == 2
    assert calls["shot"] == "/tmp/scene.png"
    assert calls["closed"] is True


# ---------------------------------------------------------------------------
# CLI 入口 main()
# ---------------------------------------------------------------------------


def test_main_quiet_writes_html_only(tmp_path, monkeypatch, capsys):
    html = tmp_path / "out.html"
    monkeypatch.setattr(
        sys, "argv",
        ["tree_art.py", "--seed", "9", "--w", "24", "--h", "12",
         "--quiet", "--html", str(html)],
    )
    ta.main()
    assert capsys.readouterr().out == ""
    text = html.read_text(encoding="utf-8")
    assert "seed 9" in text and "24×12" in text


def test_main_prints_ansi_and_stats(capsys, monkeypatch):
    monkeypatch.setattr(
        sys, "argv",
        ["tree_art.py", "--seed", "9", "--w", "24", "--h", "12"],
    )
    ta.main()
    out = capsys.readouterr().out
    assert "\x1b[48;2;" in out          # ANSI 背景
    assert "seed 9 · " in out
    assert "河流" in out and "树" in out


def test_main_png_requires_html(monkeypatch):
    monkeypatch.setattr(
        sys, "argv",
        ["tree_art.py", "--quiet", "--w", "16", "--h", "8", "--png", "x.png"],
    )
    with pytest.raises(AssertionError, match="--png 需要 --html"):
        ta.main()


def test_main_script_entry(monkeypatch, tmp_path, capsys):
    """__main__ 守卫：真实脚本以 quiet 模式全量执行并落 HTML。"""
    html = tmp_path / "entry.html"
    monkeypatch.setattr(
        sys, "argv",
        ["tree_art.py", "--seed", "3", "--w", "16", "--h", "8",
         "--quiet", "--html", str(html)],
    )
    script = Path(ta.__file__)
    assert script.is_file()
    runpy.run_path(str(script), run_name="__main__")
    assert html.is_file()
    assert capsys.readouterr().out == ""
