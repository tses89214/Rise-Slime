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


def draw_customer(color, step):
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
    return img


cust_rows = [[draw_customer(c, 0), draw_customer(c, 1)] for c in CUST.values()]
sheet(cust_rows, 16, 16).save(OUT / "customers.png")
(OUT / "customers.json").write_text(json.dumps(atlas(
    "customers", cust_rows, list(CUST), ["walk_0", "walk_1"], 16, 16,
    {"walk": {"frames": ["walk_0", "walk_1"], "fps": 4, "repeat": -1}}), indent=2))

# ---------- items (16x16) ----------


def item_wheat():
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([7, 6, 8, 15], fill=hx("#7A9A2E"))
    d.rectangle([9, 10, 10, 10], fill=hx("#7A9A2E"))
    d.rectangle([6, 1, 9, 6], fill=hx("#E9B949"))
    d.rectangle([4, 3, 5, 6], fill=hx("#E9B949"))
    d.rectangle([10, 3, 11, 6], fill=hx("#E9B949"))
    d.rectangle([7, 1, 8, 1], fill=hx("#F7D774"))
    d.rectangle([6, 6, 9, 6], fill=hx("#C98A12"))
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


ITEMS = {"wheat": item_wheat(), "flour": item_flour(), "bread": item_bread(), "coin": item_coin(), "zzz": item_zzz()}
items_row = [list(ITEMS.values())]
sheet(items_row, 16, 16).save(OUT / "items.png")
(OUT / "items.json").write_text(json.dumps(atlas("items", items_row, [""], list(ITEMS), 16, 16), indent=2))

# ---------- props (32x32) ----------


def prop_millstone():
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([2, 4, 29, 31], fill=hx("#B8B2A7"), outline=hx(INK))
    d.ellipse([3, 5, 28, 30], outline=hx("#9C958A"))
    d.ellipse([12, 14, 19, 21], fill=hx("#7E776B"), outline=hx(INK))
    return img


def prop_oven(lit):
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([22, 0, 27, 8], fill=hx("#8A5A3B"), outline=hx(INK))
    d.rectangle([1, 6, 30, 31], fill=hx("#B5674A"), outline=hx(INK))
    for y in (12, 18, 24):
        d.line([2, y, 29, y], fill=hx("#9C5640"))
    d.rectangle([8, 17, 23, 31], fill=hx("#F08A24" if lit else "#4A2A1E"), outline=hx(INK))
    if lit:
        d.rectangle([11, 22, 20, 30], fill=hx("#FFD36B"))
    return img


def prop_sacks():
    img = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for (x0, y0, x1, y1) in ((1, 16, 14, 31), (17, 16, 30, 31), (9, 3, 22, 18)):
        d.rectangle([x0, y0, x1, y1], fill=hx("#E3C48D"), outline=hx(INK))
        d.rectangle([x0 + 4, y0, x1 - 4, y0 + 2], fill=hx("#C9A870"))
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


PROPS = {"millstone": prop_millstone(), "oven": prop_oven(False), "oven_lit": prop_oven(True),
         "sacks": prop_sacks(), "cloud": prop_cloud()}
props_row = [list(PROPS.values())]
sheet(props_row, 32, 32).save(OUT / "props.png")
pmeta = atlas("props", props_row, [""], list(PROPS), 32, 32,
              {"oven_baking": {"frames": ["oven", "oven_lit"], "fps": 2, "repeat": -1}})
(OUT / "props.json").write_text(json.dumps(pmeta, indent=2))

# ---------- shop front (64x48) ----------
shop = Image.new("RGBA", (64, 48), (0, 0, 0, 0))
d = ImageDraw.Draw(shop)
d.rectangle([2, 10, 61, 47], fill=(255, 255, 255, 255), outline=hx(INK))
for i in range(8):
    x0 = 1 + i * 8
    d.rectangle([x0, 2, x0 + 7, 11], fill=hx("#FF9EC4" if i % 2 == 0 else "#FFFFFF"))
d.rectangle([0, 2, 63, 11], outline=hx(INK))
d.rectangle([7, 18, 26, 32], fill=hx("#BFE3FF"), outline=hx(INK))
d.line([16, 18, 16, 32], fill=hx(INK))
d.rectangle([38, 22, 53, 47], fill=hx("#8A5A3B"), outline=hx(INK))
d.point((50, 35), fill=hx("#F5C342"))
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
