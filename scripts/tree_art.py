#!/usr/bin/env python3
"""多色字符画树渲染器 —— quadtree 字符组合。

世界生成：种子化 fBm 高程 + 湿度双场，岛屿径向衰减保证四缘为海；
河流从高山湿地取源、沿最陡下降刻蚀入海，入海口沉为浅滩。
配色三通道：地形高程带（沙滩/草原/丘陵/山地/雪线）、
水系（深水/浅水/河流）、生物群落（森林 canopy 多绿 + 树干棕）。
quadtree 决定字符粒度：叶区单一生物群落则整叶铺稀疏"远看"字符，
混杂叶区（海岸、河岸、林缘、山体）细分并逐格取"近看"密字符，
树以 canopy+树干双色字符组合覆写在森林叶区上。

零第三方依赖。默认输出 ANSI 真彩到终端；
--html 生成预览页（含图例），--png 经 playwright 截图出效果图。
"""

from __future__ import annotations

import argparse
import math
import random

# ---------- 噪声 ----------


class ValueNoise:
    """种子化值噪声：每倍频一张随机格，双线性 + smoothstep 插值。"""

    def __init__(self, seed: int, size: int = 256):
        self.size = size
        rng = random.Random(seed)
        self.grid = [[rng.random() for _ in range(size)] for _ in range(size)]

    def _at(self, ix: int, iy: int) -> float:
        return self.grid[iy % self.size][ix % self.size]

    @staticmethod
    def _smooth(t: float) -> float:
        return t * t * (3.0 - 2.0 * t)

    def sample(self, x: float, y: float) -> float:
        ix, iy = math.floor(x), math.floor(y)
        tx, ty = self._smooth(x - ix), self._smooth(y - iy)
        a = self._at(ix, iy) * (1 - tx) + self._at(ix + 1, iy) * tx
        b = self._at(ix, iy + 1) * (1 - tx) + self._at(ix + 1, iy + 1) * tx
        return a * (1 - ty) + b * ty


def fbm(noise: ValueNoise, x: float, y: float, octaves: int = 5,
        persistence: float = 0.5, lacunarity: float = 2.0) -> float:
    amp, freq, total, norm = 1.0, 1.0, 0.0, 0.0
    for o in range(octaves):
        total += amp * noise.sample(x * freq + o * 37.7, y * freq + o * 17.3)
        norm += amp
        amp *= persistence
        freq *= lacunarity
    return total / norm


# ---------- 生物群落与配色 ----------

DEEP, SHALLOW, RIVER = "deep", "shallow", "river"
SAND, GRASS, FOREST = "sand", "grass", "forest"
HILLS, MOUNTAIN, SNOW = "hills", "mountain", "snow"

# name: (图例名, 远看字符集, 近看字符集, 基色)
PALETTE = {
    DEEP:     ("深水", ["~", "≈", "~"],  ["≈", "~", "≈"],  (30, 64, 175)),
    SHALLOW:  ("浅水", ["~", "-"],       ["~", "-", "~"],  (56, 130, 216)),
    RIVER:    ("河流", ["≈"],            ["≈", "~", "≈"],  (14, 165, 233)),
    SAND:     ("沙滩", [".", ","],       [".", ",", ":"],  (217, 192, 122)),
    GRASS:    ("草原", ['"', ","],       ['"', ";", ",", "'"], (95, 143, 60)),
    FOREST:   ("森林", ['"', ":"],       ['"', ":", "'"],  (47, 93, 42)),
    HILLS:    ("丘陵", ["∩", "~"],       ["∩", "⌒", "~"],  (138, 143, 74)),
    MOUNTAIN: ("山地", ["▲", "^"],       ["▲", "^", "▲"],  (125, 127, 132)),
    SNOW:     ("雪线", ["*", "·"],       ["*", "·", "*"],  (232, 236, 242)),
}
CANOPY_GREENS = [(63, 125, 51), (93, 168, 68), (47, 107, 42), (72, 146, 58)]
TRUNK_BROWN = (122, 82, 48)
BG = (10, 13, 18)


def classify(e: float, m: float, is_river: bool) -> str:
    if is_river:
        return RIVER
    if e < 0.30:
        return DEEP
    if e < 0.38:
        return SHALLOW
    if e < 0.42:
        return SAND
    if e < 0.60:
        return FOREST if m > 0.56 else GRASS
    if e < 0.74:
        return HILLS
    if e < 0.86:
        return MOUNTAIN
    return SNOW


# ---------- 世界生成 ----------


class World:
    def __init__(self, w: int, h: int, seed: int):
        self.w, self.h = w, h
        elev_n = ValueNoise(seed)
        moist_n = ValueNoise(seed + 101)
        rng = random.Random(seed + 7)
        self.elev = [[0.0] * w for _ in range(h)]
        self.moist = [[0.0] * w for _ in range(h)]
        self.biome: list[list[str]] = [[GRASS] * w for _ in range(h)]
        cx, cy = (w - 1) / 2, (h - 1) / 2
        for y in range(h):
            for x in range(w):
                nx, ny = x / w * 4.0, y / h * 2.6          # 纵横频率分离，匹配字符宽高比
                e = fbm(elev_n, nx, ny, octaves=5)
                d = math.hypot((x - cx) / cx, (y - cy) / cy) / math.sqrt(2)
                e = max(0.0, min(1.0, e * 1.22 * (1.06 - d ** 2.4)))
                m = fbm(moist_n, nx + 11.3, ny + 5.9, octaves=4)
                self.elev[y][x], self.moist[y][x] = e, m
        self.rivers = 0
        self._carve_rivers(rng)
        for y in range(h):
            for x in range(w):
                self.biome[y][x] = classify(self.elev[y][x], self.moist[y][x],
                                            self.river[y][x])

    def _carve_rivers(self, rng: random.Random) -> None:
        w, h = self.w, self.h
        self.river = [[False] * w for _ in range(h)]
        wet = [(self.moist[y][x] + self.elev[y][x] * 0.3, x, y)
               for y in range(h) for x in range(w)
               if 0.60 <= self.elev[y][x] <= 0.84]
        wet.sort(reverse=True)
        sources, step = [], max(1, len(wet) // 24)
        for i in range(0, len(wet), step):
            _, x, y = wet[i]
            if all(math.hypot(x - sx, y - sy) > min(w, h) / 6 for _, sx, sy in sources):
                sources.append((self.moist[y][x], x, y))
            if len(sources) >= 6:
                break
        for _, sx, sy in sources:
            x, y = sx, sy
            stuck = 0
            for _ in range(w * 2):
                if self.river[y][x]:
                    break
                self.river[y][x] = True
                best, bx, by = None, x, y
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dx == dy == 0:
                            continue
                        nx, ny = x + dx, y + dy
                        if not (0 <= nx < w and 0 <= ny < h):
                            continue
                        e = self.elev[ny][nx] + rng.random() * 0.012
                        if self.biome_at_water(nx, ny):
                            self.river[ny][nx] = False
                            best, bx, by = -1.0, nx, ny      # 入海：沉为河口
                            break
                        if best is None or e < best:
                            best, bx, by = e, nx, ny
                    if best == -1.0:
                        break
                if best == -1.0:
                    self.river[by][bx] = False
                    x, y = bx, by
                    break
                if best >= self.elev[y][x] + 0.004:
                    stuck += 1
                    if stuck >= 3:                            # 局部洼地：成湖收尾
                        self.river[y][x] = True
                        break
                else:
                    stuck = 0
                x, y = bx, by
            else:
                pass
        self.rivers = len(sources)

    def biome_at_water(self, x: int, y: int) -> bool:
        e = self.elev[y][x]
        return not self.river[y][x] and (e < 0.38)

    # 供 quadtree 用：叶区高程跨度与生物群落多样性
    def span(self, x: int, y: int, w: int, h: int) -> tuple[float, int]:
        es = [self.elev[j][i] for j in range(y, y + h) for i in range(x, x + w)]
        bs = {self.biome[j][i] for j in range(y, y + h) for i in range(x, x + w)}
        return max(es) - min(es), len(bs)


# ---------- quadtree 字符组合 ----------


class Leaf:
    __slots__ = ("x", "y", "w", "h", "busy")

    def __init__(self, x, y, w, h, busy):
        self.x, self.y, self.w, self.h, self.busy = x, y, w, h, busy


def build_quadtree(world: World, max_depth: int = 5) -> list[Leaf]:
    leaves: list[Leaf] = []

    def node(x: int, y: int, w: int, h: int, depth: int) -> None:
        span, diversity = world.span(x, y, w, h)
        busy = diversity >= 2 or span > 0.07
        if depth < max_depth and busy and w >= 6 and h >= 3:
            hw, hh = w // 2, h // 2
            node(x, y, hw, hh, depth + 1)
            node(x + hw, y, w - hw, hh, depth + 1)
            node(x, y + hh, hw, h - hh, depth + 1)
            node(x + hw, y + hh, w - hw, h - hh, depth + 1)
        else:
            leaves.append(Leaf(x, y, w, h, busy))

    node(0, 0, world.w, world.h, 0)
    return leaves


def render_grid(world: World, seed: int) -> tuple[list[list[str]], list[list[tuple]]]:
    """返回 (字符网格, 颜色网格)。quadtree 叶决定粒度，森林叶叠加树组合。"""
    rng = random.Random(seed + 31)
    w, h = world.w, world.h
    chars = [[" "] * w for _ in range(h)]
    colors: list[list[tuple]] = [[BG] * w for _ in range(h)]
    for leaf in build_quadtree(world):
        far, busy = not leaf.busy, leaf.busy
        for j in range(leaf.y, leaf.y + leaf.h):
            for i in range(leaf.x, leaf.x + leaf.w):
                b = world.biome[j][i]
                name, far_set, near_set, base = PALETTE[b]
                glyphs = far_set if far else near_set
                ch = glyphs[rng.randrange(len(glyphs))]
                dl = rng.randint(-8, 8)
                chars[j][i] = ch
                colors[j][i] = tuple(max(0, min(255, c + dl)) for c in base)
        # 森林叶区：叠加 canopy + 树干 组合，湿度越高越密
        if busy:
            for j in range(leaf.y, min(leaf.y + leaf.h - 1, world.h - 1)):
                for i in range(leaf.x, min(leaf.x + leaf.w, world.w)):
                    if (world.biome[j][i] == FOREST
                            and world.biome[j + 1][i] == FOREST
                            and rng.random() < 0.16 + world.moist[j][i] * 0.22):
                        chars[j][i] = "&%@"[rng.randrange(3)]
                        colors[j][i] = CANOPY_GREENS[rng.randrange(len(CANOPY_GREENS))]
                        chars[j + 1][i] = "|"
                        colors[j + 1][i] = TRUNK_BROWN
    return chars, colors


# ---------- 输出 ----------


def ansi_escape(rgb: tuple) -> str:
    return f"\x1b[38;2;{rgb[0]};{rgb[1]};{rgb[2]}m"


def render_ansi(chars, colors) -> str:
    out = ["\x1b[48;2;%d;%d;%dm" % BG]
    for row_c, row_k in zip(colors, chars):
        last = None
        line = []
        for c, ch in zip(row_c, row_k):
            if c != last:
                line.append(ansi_escape(c))
                last = c
            line.append(ch)
        out.append("".join(line) + "\x1b[39m")
    out.append("\x1b[0m")
    return "\n".join(out)


def render_html(chars, colors, seed: int) -> str:
    def hexc(rgb):
        return "#%02x%02x%02x" % rgb

    rows = []
    for row_c, row_k in zip(colors, chars):
        parts, last, run = [], None, []
        for c, ch in zip(row_c, row_k):
            if c != last and run:
                parts.append(f'<span style="color:{hexc(last)}">{"".join(run)}</span>')
                run = []
            last = c
            run.append(ch if ch != "&" else "&amp;")
        if run:
            parts.append(f'<span style="color:{hexc(last)}">{"".join(run)}</span>')
        rows.append("".join(parts))
    legend = " ".join(
        f'<span style="color:{hexc(v[3])}">▙</span>{k}'
        for k, v in PALETTE.items()
    )
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>多色字符画树 · quadtree 字符组合</title>
<style>
  body {{ background:{hexc(BG)}; margin:0; padding:28px 32px;
         font-family:'JetBrains Mono','DejaVu Sans Mono',monospace; }}
  h1 {{ color:#c8d2e0; font-size:14px; font-weight:600; margin:0 0 4px; }}
  p.cap {{ color:#5c6a7d; font-size:11px; margin:0 0 14px; }}
  pre#scene {{ font-size:13px; line-height:1.12; margin:0; }}
  .legend {{ color:#8494a8; font-size:12px; margin-top:14px; letter-spacing:1px; }}
</style></head><body>
<h1>多色字符画树 · quadtree 字符组合</h1>
<p class="cap">seed {seed} · {len(chars[0])}×{len(chars)} · 复杂叶区细分密字符，均匀叶区整叶稀字符</p>
<pre id="scene">{chr(10).join(rows)}</pre>
<div class="legend">{legend}</div>
</body></html>"""


def snap_png(html_path: str, png_path: str) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(device_scale_factor=2)
        page.goto(f"file://{html_path}")
        page.locator("body").screenshot(path=png_path)
        browser.close()


# ---------- 入口 ----------


def main() -> None:
    ap = argparse.ArgumentParser(description="多色字符画树渲染器（quadtree 字符组合）")
    ap.add_argument("--seed", type=int, default=20261002)
    ap.add_argument("--w", type=int, default=160)
    ap.add_argument("--h", type=int, default=64)
    ap.add_argument("--html", help="输出预览 HTML 路径")
    ap.add_argument("--png", help="截图 PNG 路径（依赖 playwright，配合 --html）")
    ap.add_argument("--quiet", action="store_true", help="不向终端打印 ANSI 版")
    args = ap.parse_args()

    world = World(args.w, args.h, args.seed)
    chars, colors = render_grid(world, args.seed)

    if not args.quiet:
        small = World(min(args.w, 104), min(args.h, 40), args.seed)
        sc, sk = render_grid(small, args.seed)
        print(render_ansi(sc, sk))
        n_tree = sum(r.count("&") + r.count("%") + r.count("@") for r in chars)
        stats: dict[str, int] = {}
        for row in world.biome:
            for b in row:
                stats[b] = stats.get(b, 0) + 1
        total = args.w * args.h
        print(f"\nseed {args.seed} · 河流 {world.rivers} 条 · 树 {n_tree} 棵 · " +
              " ".join(f"{PALETTE[k][0]}{100 * v // total}%" for k, v in
                       sorted(stats.items(), key=lambda kv: -kv[1])))

    if args.html:
        with open(args.html, "w", encoding="utf-8") as f:
            f.write(render_html(chars, colors, args.seed))
    if args.png:
        assert args.html, "--png 需要 --html"
        snap_png(args.html, args.png)


if __name__ == "__main__":
    main()
