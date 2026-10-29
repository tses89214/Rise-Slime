"""Compose a labelled contact sheet and a sample scene from the generated sprites."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
BG = (238, 240, 255, 255)
INK = (31, 37, 71, 255)


def up(img, k):
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def frame(sheet, fw, fh, col, row):
    return sheet.crop((col * fw, row * fh, (col + 1) * fw, (row + 1) * fh))


# ---------- contact sheet ----------
K = 6
parts = []
for name in ("slimes", "customers", "items", "tiles", "props"):
    parts.append((name, up(Image.open(SRC / f"{name}.png"), K)))
parts.append(("shop", up(Image.open(SRC / "shop.png"), K)))
W = max(p.width for _, p in parts) + 40
H = sum(p.height + 40 for _, p in parts) + 20
cs = Image.new("RGBA", (W, H), BG)
d = ImageDraw.Draw(cs)
y = 10
for name, p in parts:
    d.text((20, y), name, fill=INK)
    y += 18
    cs.alpha_composite(p, (20, y))
    y += p.height + 22
cs.save(OUT / "contact-sheet.png")

# ---------- sample scene (240x150 at x1, shown x4) ----------
tiles = Image.open(SRC / "tiles.png")
props = Image.open(SRC / "props.png")
slimes = Image.open(SRC / "slimes.png")
cust = Image.open(SRC / "customers.png")
items = Image.open(SRC / "items.png")
shop = Image.open(SRC / "shop.png")
sky, grass_top, grass, fence = (frame(tiles, 16, 16, i, 0) for i in range(4))
windmill, blades, _bx, oven, oven_lit, _dim, cloud = (frame(props, 32, 32, i, 0) for i in range(7))
wheat, flour, bread, coin, zzz = (frame(items, 16, 16, i, 0) for i in range(5))
meta = json.loads((SRC / "slimes.json").read_text())
names = list(meta["frames"])
cols = [n.split("/")[1] for n in names[: len(names) // 5]]


def slime(color_row, fname):
    return frame(slimes, 16, 16, cols.index(fname), color_row)


SW, SH = 240, 150
GROUND = 104
sc = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
for x in range(0, SW, 16):
    for y in range(0, GROUND, 16):
        sc.alpha_composite(sky, (x, y))
    sc.alpha_composite(grass_top, (x, GROUND))
    for y in range(GROUND + 16, SH, 16):
        sc.alpha_composite(grass, (x, y))
sc.alpha_composite(cloud, (20, 6))
sc.alpha_composite(cloud, (150, 0))
# farm
for i, x in enumerate((6, 18, 30, 42)):
    sc.alpha_composite(wheat, (x, GROUND - 16 - (2 if i % 2 else 0)))
for i, (row, fr) in enumerate(((0, "idle_0"), (1, "hop_air"), (0, "hop_squash"), (0, "idle_0"))):
    sc.alpha_composite(slime(row, fr), (2 + i * 15, GROUND + 6))
sc.alpha_composite(fence, (56, GROUND - 16))
# mill
sc.alpha_composite(windmill, (98, GROUND - 30))
sc.alpha_composite(blades, (98, GROUND - 41))
for i, (row, fr) in enumerate(((0, "spin_left"), (2, "spin_right"), (0, "idle_0"))):
    sc.alpha_composite(slime(row, fr), (70 + i * 15, GROUND + 6))
sc.alpha_composite(fence, (128, GROUND - 16))
# bakery
sc.alpha_composite(oven, (142, GROUND - 32))
for i, (row, fr) in enumerate(((3, "sleep_0"), (0, "sleep_1"), (4, "sleep_0"))):
    sc.alpha_composite(slime(row, fr), (136 + i * 14, GROUND + 6))
    sc.alpha_composite(zzz, (140 + i * 14, GROUND - 8))
# shop
sc.alpha_composite(shop, (176, GROUND - 48))
for i, row in enumerate((0, 1, 2)):
    sc.alpha_composite(frame(cust, 16, 16, i % 2, row), (178 + i * 18, GROUND + 8))
sc.alpha_composite(bread, (222, GROUND + 22))
sc.alpha_composite(coin, (4, 4))
up(sc, 4).save(OUT / "scene-preview.png")
print("ok")
