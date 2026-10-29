"""Generate Rise & Slime original pixel-art sprites (matches the design canvas)."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)

INK = "#1F2547"


def hx(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4)) + (255,)


def shade(c, f):
    r, g, b, a = hx(c)
    return (int(r * f), int(g * f), int(b * f), 255)


def tint(c, f):
    r, g, b, a = hx(c)
    return (int(r + (255 - r) * f), int(g + (255 - g) * f), int(b + (255 - b) * f), 255)


# ---------- slimes (16x16 frames) ----------
# Each shape: list of (x0, x1) per row, top to bottom; eyes: (row, x) pairs for the top-left of 1x2 eyes.
SHAPES = {
    "normal": dict(rows=[(3, 8), (2, 9), (1, 10), (1, 10), (0, 11), (0, 11), (0, 11), (0, 11), (0, 11), (1, 10)],
                   eyes=[(4, 3), (4, 8)], hi=(2, 2), w=12),
    "squash": dict(rows=[(3, 10), (1, 12), (0, 13), (0, 13), (0, 13), (0, 13), (0, 13), (1, 12)],
                   eyes=[(2, 4), (2, 9)], hi=(1, 2), w=14),
    "stretch": dict(rows=[(3, 6), (2, 7), (1, 8), (1, 8), (0, 9), (0, 9), (0, 9), (0, 9), (0, 9), (0, 9), (0, 9), (1, 8)],
                    eyes=[(4, 2), (4, 7)], hi=(2, 2), w=10),
}


def draw_slime(color, shape="normal", lift=0, lean=0, eyes="open", look=0):
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    px = img.load()
    s = SHAPES[shape]
    h = len(s["rows"])
    ox = (16 - s["w"]) // 2
    oy = 16 - h - lift
    base, dark, light = hx(color), shade(color, 0.78), tint(color, 0.55)
    for r, (x0, x1) in enumerate(s["rows"]):
        dx = lean if r < h // 2 else 0
        for x in range(x0, x1 + 1):
            c = dark if r >= h - 2 else base
            px[ox + x + dx, oy + r] = c
    hr, hc = s["hi"]
    if look > 0:
        hc = s["w"] - hc - 2  # highlight moves to the side it turns toward
    for x in (hc, hc + 1):
        px[ox + x + (lean if hr < h // 2 else 0), oy + hr] = light
    for er, ec in s["eyes"]:
        dx = (lean if er < h // 2 else 0) + look * 2
        if eyes == "open":
            px[ox + ec + dx, oy + er] = hx(INK)
            px[ox + ec + dx, oy + er + 1] = hx(INK)
        else:  # closed: short horizontal line on the lower eye row
            for x in (ec - 1, ec) if ec < s["w"] // 2 else (ec, ec + 1):
                px[ox + x + dx, oy + er + 1] = hx(INK)
    return img


SLIME_COLORS = {
    "normal": "#5B9BD5",
    "leafy": "#6CC24A",
    "rocky": "#A0785A",
    "fiery": "#E2604A",
    "lucky": "#F2C94C",
}
SLIME_FRAMES = [
    ("idle_0", dict()),
    ("idle_blink", dict(eyes="closed")),
    ("hop_squash", dict(shape="squash")),
    ("hop_stretch", dict(shape="stretch")),
    ("hop_air", dict(lift=3)),
    ("sleep_0", dict(eyes="closed")),
    ("sleep_1", dict(shape="squash", eyes="closed")),
    ("spin_left", dict(look=-1)),
    ("spin_right", dict(look=1)),
]
SLIME_ANIMS = {
    "idle": {"frames": ["idle_0", "idle_0", "idle_0", "idle_blink"], "fps": 4, "repeat": -1},
    "hop": {"frames": ["hop_squash", "hop_stretch", "hop_air", "hop_stretch", "idle_0"], "fps": 10, "repeat": -1},
    "sleep": {"frames": ["sleep_0", "sleep_1"], "fps": 1.5, "repeat": -1},
    "spin": {"frames": ["spin_left", "idle_0", "spin_right", "idle_0"], "fps": 6, "repeat": -1},
}


def sheet(frames_by_row, fw, fh):
    rows = len(frames_by_row)
    cols = max(len(r) for r in frames_by_row)
    img = Image.new("RGBA", (cols * fw, rows * fh), (0, 0, 0, 0))
    for ri, row in enumerate(frames_by_row):
        for ci, fr in enumerate(row):
            img.paste(fr, (ci * fw, ri * fh))
    return img


def atlas(name, frames_by_row, row_names, col_names, fw, fh, anims=None):
    data = {"image": f"{name}.png", "frameWidth": fw, "frameHeight": fh, "frames": {}}
    for ri, rn in enumerate(row_names):
        for ci, cn in enumerate(col_names[ri] if isinstance(col_names[0], list) else col_names):
            key = f"{rn}/{cn}" if rn else cn
            data["frames"][key] = {"x": ci * fw, "y": ri * fh, "w": fw, "h": fh}
    if anims:
        data["animations"] = anims
    return data


slime_rows = [[draw_slime(c, **kw) for _, kw in SLIME_FRAMES] for c in SLIME_COLORS.values()]
img = sheet(slime_rows, 16, 16)
img.save(OUT / "slimes.png")
meta = atlas("slimes", slime_rows, list(SLIME_COLORS), [n for n, _ in SLIME_FRAMES], 16, 16, SLIME_ANIMS)
meta["note"] = "Rows are mutation colors; animations list frame names within one row. Tiers are drawn with integer scale (e.g. x3 / x4 / x5)."
(OUT / "slimes.json").write_text(json.dumps(meta, indent=2))

# ---------- customers (16x16, 2-frame walk) ----------
CUST = {"pink": "#E59AC2", "purple": "#A98BD8", "teal": "#8FD3C6", "lime": "#C6DE6E"}


def draw_customer(color, step, bread=False):
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c, dk = hx(color), shade(color, 0.78)
    ox, oy = 3, 4 - (1 if step else 0)
    d.rectangle([ox + 1, oy, ox + 2, oy + 1], fill=c)
    d.rectangle([ox + 6, oy, ox + 7, oy + 1], fill=c)
    d.rectangle([ox, oy + 2, ox + 8, oy + 7], fill=c)
    d.rectangle([ox, oy + 7, ox + 8, oy + 7], fill=dk)
    if step:
        d.rectangle([ox + 2, oy + 8, ox + 3, oy + 10], fill=dk)
        d.rectangle([ox + 5, oy + 8, ox + 6, oy + 10], fill=dk)
    else:
        d.rectangle([ox + 1, oy + 8, ox + 2, oy + 9], fill=dk)
        d.rectangle([ox + 6, oy + 8, ox + 7, oy + 9], fill=dk)
    d.rectangle([ox + 2, oy + 4, ox + 2, oy + 5], fill=hx(INK))
    d.rectangle([ox + 6, oy + 4, ox + 6, oy + 5], fill=hx(INK))
    d.point((ox + 4, oy + 6), fill=hx(INK))
    if bread:  # a loaf hugged in front of the belly
        d.ellipse([ox - 1, oy + 6, ox + 9, oy + 10], fill=hx("#D9923B"), outline=hx(INK))
        d.point((ox + 2, oy + 7), fill=hx("#F7D774"))
        d.point((ox + 5, oy + 7), fill=hx("#F7D774"))
    return img


cust_rows = [[draw_customer(c, 0), draw_customer(c, 1), draw_customer(c, 0, True), draw_customer(c, 1, True)] for c in CUST.values()]
sheet(cust_rows, 16, 16).save(OUT / "customers.png")
(OUT / "customers.json").write_text(json.dumps(atlas(
    "customers", cust_rows, list(CUST), ["walk_0", "walk_1", "carry_0", "carry_1"], 16, 16,
    {"walk": {"frames": ["walk_0", "walk_1"], "fps": 4, "repeat": -1},
     "carry": {"frames": ["carry_0", "carry_1"], "fps": 4, "repeat": -1}}), indent=2))

# ---------- items (16x16) ----------


def item_wheat():
    """A wheat ear: grains in staggered pairs up a stem, awns on top, two leaves."""
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    gold, dark, light, green = hx("#E9B949"), hx("#C98A12"), hx("#F7D774"), hx("#7A9A2E")
    d.rectangle([7, 8, 8, 15], fill=green)  # stem
    d.rectangle([4, 12, 6, 12], fill=green)  # leaves
    d.rectangle([3, 11, 3, 11], fill=green)
    d.rectangle([9, 13, 11, 13], fill=green)
    d.rectangle([12, 12, 12, 12], fill=green)
    for y in (2, 4, 6, 8):  # grains: left/right pairs, each with a darker underside
        d.rectangle([5, y, 7, y + 1], fill=gold)
        d.rectangle([8, y, 10, y + 1], fill=gold)
        d.point((5, y + 1), fill=dark)
        d.point((10, y + 1), fill=dark)
        d.point((7, y + 1), fill=dark)
        d.point((8, y + 1), fill=dark)
    d.rectangle([7, 0, 8, 1], fill=light)  # tip
    d.point((6, 0), fill=light)  # awns
    d.point((9, 0), fill=light)
    d.point((5, 1), fill=light)
    d.point((10, 1), fill=light)
    return img


def item_flour():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([3, 4, 12, 15], fill=hx("#F3E6C7"), outline=hx(INK))
    d.rectangle([5, 2, 10, 4], fill=hx("#E3C48D"), outline=hx(INK))
    d.rectangle([6, 8, 9, 11], fill=hx("#E3C48D"))
    return img


def item_bread():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([2, 7, 13, 13], fill=hx("#D9954A"), outline=hx(INK))
    d.rectangle([3, 5, 12, 7], fill=hx("#B5673A"), outline=hx(INK))
    d.rectangle([3, 7, 12, 7], fill=hx("#B5673A"))
    for x in (5, 8, 11):
        d.point((x, 6), fill=hx("#F2C27A"))
    return img


def item_coin():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([5, 2, 10, 13], fill=hx("#F5C342"))
    d.rectangle([3, 4, 12, 11], fill=hx("#F5C342"))
    d.rectangle([4, 3, 11, 12], fill=hx("#F5C342"))
    d.rectangle([7, 5, 8, 10], fill=hx("#C98A12"))
    d.rectangle([5, 2, 6, 2], fill=hx("#FCE38A"))
    return img


def item_zzz():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    z = hx("#5B5FC7")
    for (x, y, s) in ((1, 9, 6), (9, 2, 5)):
        d.rectangle([x, y, x + s - 1, y], fill=z)
        d.rectangle([x, y + s - 1, x + s - 1, y + s - 1], fill=z)
        for i in range(1, s - 1):
            d.point((x + s - 1 - i, y + i), fill=z)
    return img


def item_note():
    """Beamed eighth notes: the music toggle."""
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ink = hx(INK)
    d.rectangle([5, 3, 12, 5], fill=ink)
    d.rectangle([5, 3, 6, 12], fill=ink)
    d.rectangle([11, 3, 12, 10], fill=ink)
    d.ellipse([2, 10, 6, 14], fill=ink)
    d.ellipse([8, 8, 12, 12], fill=ink)
    return img


def item_speaker():
    """Speaker with sound waves: the sound-effects toggle."""
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ink = hx(INK)
    d.rectangle([1, 6, 4, 9], fill=ink)
    d.polygon([(4, 6), (8, 2), (8, 13), (4, 9)], fill=ink)
    for x, y0, y1 in ((10, 6, 9), (12, 4, 11), (14, 2, 13)):
        d.rectangle([x, y0, x, y1], fill=ink)
    return img


def item_star():
    """Gold star: achievements."""
    import math
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pts = []
    for k in range(10):
        r = 7.5 if k % 2 == 0 else 3.2
        a = -math.pi / 2 + k * math.pi / 5
        pts.append((7.5 + r * math.cos(a), 8.5 + r * math.sin(a)))
    d.polygon(pts, fill=hx("#F5C342"), outline=hx(INK))
    return img


ITEMS = {"wheat": item_wheat(), "flour": item_flour(), "bread": item_bread(), "coin": item_coin(), "zzz": item_zzz(), "note": item_note(), "speaker": item_speaker(), "star": item_star()}
items_row = [list(ITEMS.values())]
sheet(items_row, 16, 16).save(OUT / "items.png")
(OUT / "items.json").write_text(json.dumps(atlas("items", items_row, [""], list(ITEMS), 16, 16), indent=2))

# ---------- props (32x32) ----------


def prop_windmill():
    """Tower + red roof; the blades are a separate prop so they can turn."""
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(9, 14), (23, 14), (27, 31), (5, 31)], fill=hx("#F3E3C3"), outline=hx(INK))
    d.polygon([(6, 14), (26, 14), (16, 6)], fill=hx("#E2604A"), outline=hx(INK))
    d.rectangle([13, 22, 19, 31], fill=hx("#8A5A3B"), outline=hx(INK))
    d.rectangle([14, 17, 18, 20], fill=hx("#BFE3FF"), outline=hx(INK))
    return img


def prop_blades(angle):
    """Four sails on a cross, drawn with the hub at the sprite centre. angle 0 = '+', 45 = 'x'."""
    import math
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c = 15.5
    for k in range(4):
        a = math.radians(angle + 90 * k)
        dx, dy = math.cos(a), math.sin(a)
        px, py = -dy, dx
        pt = lambda t, o: (c + dx * t + px * o, c + dy * t + py * o)
        d.polygon([pt(5, 1), pt(15, 1), pt(15, 5), pt(5, 5)], fill=hx("#FFFFFF"), outline=hx(INK))
        d.line([pt(0, 0), pt(15, 0)], fill=hx("#8A5A3B"), width=2)
    d.ellipse([13, 13, 18, 18], fill=hx("#8A5A3B"), outline=hx(INK))
    return img


def prop_oven(lit):
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([22, 0, 27, 8], fill=hx("#8A5A3B"), outline=hx(INK))
    d.rectangle([1, 6, 30, 31], fill=hx("#B5674A"), outline=hx(INK))
    for y in (12, 18, 24):
        d.line([2, y, 29, y], fill=hx("#9C5640"))
    d.rectangle([8, 17, 23, 31], fill=hx("#F08A24" if lit else "#4A2A1E"), outline=hx(INK))
    if lit == "dim":  # embers: the low end of the flicker
        d.rectangle([9, 18, 22, 30], fill=hx("#B8561A"))
        d.rectangle([13, 26, 18, 30], fill=hx("#F08A24"))
    elif lit:
        d.rectangle([11, 22, 20, 30], fill=hx("#FFD36B"))
    return img


def prop_cloud():
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    w = (255, 255, 255, 255)
    d.rectangle([2, 18, 29, 25], fill=w)
    d.rectangle([7, 13, 18, 18], fill=w)
    d.rectangle([15, 10, 24, 18], fill=w)
    d.rectangle([2, 25, 29, 25], fill=hx("#DDEFFF"))
    return img


PROPS = {"windmill": prop_windmill(),
         "blades_0": prop_blades(0), "blades_22": prop_blades(22), "blades_45": prop_blades(45), "blades_68": prop_blades(68),
         "oven": prop_oven(False), "oven_lit": prop_oven(True), "oven_lit_dim": prop_oven("dim"), "cloud": prop_cloud()}
props_row = [list(PROPS.values())]
sheet(props_row, 32, 32).save(OUT / "props.png")
pmeta = atlas("props", props_row, [""], list(PROPS), 32, 32,
              {"oven_baking": {"frames": ["oven_lit", "oven_lit_dim", "oven_lit", "oven_lit_dim", "oven_lit"], "fps": 4, "repeat": -1},
               "blades_turn": {"frames": ["blades_0", "blades_22", "blades_45", "blades_68"], "fps": 8, "repeat": -1}})
(OUT / "props.json").write_text(json.dumps(pmeta, indent=2))

# ---------- shop front (64x48): a cosy bakery ----------
shop = Image.new("RGBA", (64, 48), (0, 0, 0, 0))
d = ImageDraw.Draw(shop)
INKC, WOOD, GLOW = hx(INK), hx("#8A5A3B"), hx("#FFE9A8")
d.rectangle([47, 0, 54, 9], fill=hx("#B5674A"), outline=INKC)  # chimney
d.rectangle([46, 0, 55, 1], fill=hx("#8E4A36"), outline=INKC)
d.rectangle([3, 20, 60, 47], fill=hx("#F6DDB0"), outline=INKC)  # warm cream wall
d.rectangle([4, 39, 59, 46], fill=hx("#E8C58A"))  # lower wall band
d.polygon([(0, 14), (7, 5), (56, 5), (63, 14)], fill=hx("#B5674A"), outline=INKC)  # tiled roof
for y in (8, 11):
    d.line([(4 if y == 11 else 6, y), (59 if y == 11 else 57, y)], fill=hx("#8E4A36"))
for i in range(8):  # striped awning with a scalloped edge
    x0 = 2 + i * 7
    c = hx("#FF9EC4" if i % 2 == 0 else "#FFFFFF")
    d.rectangle([x0, 14, x0 + 6, 19], fill=c)
    d.ellipse([x0, 17, x0 + 6, 22], fill=c, outline=INKC)
d.rectangle([2, 13, 61, 14], fill=INKC)
d.ellipse([26, 3, 37, 13], fill=hx("#FFF6E0"), outline=INKC)  # round plaque with a loaf
d.ellipse([28, 6, 35, 11], fill=hx("#D9923B"), outline=INKC)
d.point((30, 7), fill=hx("#F7D774"))
d.point((33, 7), fill=hx("#F7D774"))
# shop window, lit warm, bread on the shelf
d.rectangle([7, 24, 31, 39], fill=GLOW, outline=INKC)
d.rectangle([6, 23, 32, 24], fill=WOOD)
d.line([19, 25, 19, 38], fill=WOOD)
d.rectangle([8, 33, 30, 34], fill=WOOD)  # shelf
for x in (9, 14):
    d.ellipse([x, 28, x + 5, 33], fill=hx("#D9923B"), outline=INKC)
    d.point((x + 2, 29), fill=hx("#F7D774"))
d.rectangle([21, 29, 29, 33], fill=hx("#E9B949"), outline=INKC)  # baguette
d.line([22, 30, 28, 30], fill=hx("#C98A12"))
d.ellipse([21, 36, 25, 39], fill=hx("#D9923B"), outline=INKC)  # roll on the lower shelf
d.ellipse([26, 36, 30, 39], fill=hx("#D9923B"), outline=INKC)
d.rectangle([6, 40, 32, 44], fill=WOOD, outline=INKC)  # flower box
for x, c in ((8, "#FF9EC4"), (12, "#FFFFFF"), (16, "#F5C342"), (20, "#FF9EC4"), (24, "#FFFFFF"), (28, "#F5C342")):
    d.rectangle([x, 38, x + 1, 39], fill=hx(c))
    d.point((x, 40), fill=hx("#4FAF6A"))
# door with a round window and a little OPEN flag
d.rectangle([38, 25, 54, 47], fill=WOOD, outline=INKC)
d.ellipse([42, 28, 50, 36], fill=GLOW, outline=INKC)
d.line([46, 28, 46, 36], fill=WOOD)
d.rectangle([41, 40, 51, 45], fill=hx("#A06E4A"))
d.point((51, 38), fill=hx("#F5C342"))
d.rectangle([56, 28, 60, 34], fill=hx("#FFF6E0"), outline=INKC)  # hanging sign
d.line([58, 26, 58, 28], fill=INKC)
d.point((58, 31), fill=hx("#E2604A"))
shop.save(OUT / "shop.png")

# ---------- tiles (16x16) ----------


def tile_sky():
    return Image.new("RGBA", (16, 16), hx("#BFE3FF"))


def tile_grass_top():
    img = Image.new("RGBA", (16, 16), hx("#8EDB9A"))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 15, 1], fill=hx("#4FAF6A"))
    for x in (2, 7, 12):
        d.point((x, 2), fill=hx("#4FAF6A"))
    for (x, y) in ((4, 8), (10, 6), (13, 12), (6, 13)):
        d.point((x, y), fill=hx("#7BC98A"))
    return img


def tile_grass():
    img = Image.new("RGBA", (16, 16), hx("#8EDB9A"))
    d = ImageDraw.Draw(img)
    for (x, y) in ((3, 4), (11, 2), (7, 10), (14, 13), (1, 13)):
        d.point((x, y), fill=hx("#7BC98A"))
    return img


def tile_fence():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    wood, dk = hx("#C79A6B"), hx("#8A5A3B")
    for x in (2, 11):
        d.rectangle([x, 3, x + 2, 15], fill=wood, outline=dk)
    d.rectangle([0, 6, 15, 8], fill=wood, outline=dk)
    d.rectangle([0, 11, 15, 12], fill=wood, outline=dk)
    return img


TILES = {"sky": tile_sky(), "grass_top": tile_grass_top(), "grass": tile_grass(), "fence": tile_fence()}
tiles_row = [list(TILES.values())]
sheet(tiles_row, 16, 16).save(OUT / "tiles.png")
(OUT / "tiles.json").write_text(json.dumps(atlas("tiles", tiles_row, [""], list(TILES), 16, 16), indent=2))

print("ok")
