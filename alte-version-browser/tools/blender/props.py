"""Requisiten, Ruinen, Sammelpunkte und Spielobjekte (Maße wie in props.ts)."""
import math
import random

from lib import (bake, beam, box, cone, cyl, extrude_shape, ico, join, lathe, rock, smooth, tube, uvsphere)


def barrel():
    prof = [(0.34, 0.0), (0.4, 0.2), (0.43, 0.55), (0.4, 0.9), (0.34, 1.1)]
    parts = [lathe("barrel", prof, 16, "wood")]
    for z in (0.12, 0.35, 0.78, 0.98):
        r = 0.36 + 0.07 * math.sin(math.pi * z / 1.1)
        parts.append(cyl("hoop", r + 0.012, 0.05, (0, 0, z), material="metal_dark", seg=16, caps=False))
    o = join(parts, "barrel")
    smooth(o, 50)
    return o


def crate():
    parts = [box("crate", (0.96, 0.96, 0.96), (0, 0, 0.48), material="wood", bevel=0.02)]
    for s in (-1, 1):
        for ax in ("x", "y"):
            loc = (s * 0.49, 0, 0.48) if ax == "x" else (0, s * 0.49, 0.48)
            size = (0.04, 1.0, 0.12) if ax == "x" else (1.0, 0.04, 0.12)
            for z in (0.08, 0.88):
                parts.append(box("slat", size, (loc[0], loc[1], z), material="wood_dark"))
            d = box("diag", (0.04, 1.18, 0.1) if ax == "x" else (1.18, 0.04, 0.1), loc, material="wood_dark")
            d.rotation_euler = (math.pi / 4, 0, 0) if ax == "x" else (0, math.pi / 4, 0)
            parts.append(d)
    return join(parts, "crate")


def wheel(name, r, x, y, z, spokes=8, width=0.1):
    parts = [cyl(name + "rim", r, width, (x, y, z), rot=(0, math.pi / 2, 0), material="wood_dark", seg=16, caps=False)]
    parts.append(cyl(name + "hub", 0.1, width + 0.1, (x, y, z), rot=(0, math.pi / 2, 0), material="metal_dark", seg=8))
    for i in range(spokes):
        a = 2 * math.pi * i / spokes
        parts.append(beam(name + "spoke", (x, y, z), (x, y + math.cos(a) * r, z + math.sin(a) * r), 0.05))
    return parts


def cart():
    parts = [box("bed", (1.5, 2.2, 0.1), (0, -0.2, 0.75), material="wood")]
    for s in (-1, 1):
        parts.append(box("side", (0.06, 2.2, 0.45), (s * 0.73, -0.2, 1.0), material="wood"))
    parts.append(box("back", (1.5, 0.06, 0.45), (0, -1.28, 1.0), material="wood"))
    for s in (-1, 1):
        parts += wheel("wheel", 0.55, s * 0.85, -0.3, 0.55)
        parts.append(beam("shaft", (s * 0.45, 0.8, 0.75), (s * 0.4, 2.3, 0.45), 0.08))
    parts.append(beam("axle", (-0.9, -0.3, 0.55), (0.9, -0.3, 0.55), 0.08))
    for i in range(3):
        parts.append(cyl("sack", 0.25, 0.55, (-0.35 + i * 0.35, -0.5 + (i % 2) * 0.4, 1.05), rot=(0.2, 1.4, 0), material="cloth", seg=10))
    return join(parts, "cart")


def fence():
    parts = []
    for x in (-1.45, 0, 1.45):
        parts.append(beam("post", (x, 0, 0), (x, 0, 1.15), 0.12))
    rnd = random.Random(2)
    for z in (0.45, 0.9):
        parts.append(beam("rail", (-1.5, 0.06, z + rnd.uniform(-0.03, 0.03)), (1.5, 0.06, z + rnd.uniform(-0.03, 0.03)), 0.08, 0.05, material="wood"))
    return join(parts, "fence")


def lamp():
    parts = [beam("post", (0, 0, 0), (0, 0, 3.0), 0.14)]
    parts.append(beam("arm", (0, 0, 2.95), (0, 0.5, 2.95), 0.08))
    parts.append(box("base", (0.4, 0.4, 0.3), (0, 0, 0.15), material="stone_block"))
    parts.append(box("lantern", (0.18, 0.18, 0.26), (0, 0.5, 2.72), material="glow_warm"))
    parts.append(cone("cap", 0.18, 0.14, (0, 0.5, 2.92), material="metal_dark", seg=4))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(beam("cage", (sx * 0.1, 0.5 + sy * 0.1, 2.58), (sx * 0.1, 0.5 + sy * 0.1, 2.86), 0.02, material="metal_dark"))
    return join(parts, "lamp")


def bench():
    parts = [box("seat", (1.8, 0.4, 0.07), (0, 0, 0.46), material="wood", bevel=0.01)]
    for s in (-1, 1):
        parts.append(box("leg", (0.08, 0.36, 0.44), (s * 0.7, 0, 0.22), material="wood_dark"))
    parts.append(box("back", (1.8, 0.05, 0.3), (0, -0.2, 0.8), rot=(-0.12, 0, 0), material="wood"))
    for s in (-1, 1):
        parts.append(beam("backpost", (s * 0.7, -0.18, 0.46), (s * 0.7, -0.22, 0.95), 0.06))
    return join(parts, "bench")


def haystack():
    prof = [(1.15, 0.0), (1.15, 0.5), (1.0, 1.1), (0.65, 1.55), (0.2, 1.85), (0.0, 1.9)]
    o = lathe("hay", prof, 18, "hay")
    bake(o)
    from lib import displace, jitter
    displace(o, 0.12, 0.25, 5)
    jitter(o, 0.03, 5)
    parts = [o, beam("pole", (0, 0, 1.5), (0, 0, 2.4), 0.08)]
    return join(parts, "haystack")


def woodpile():
    parts = []
    rnd = random.Random(4)
    for row in range(3):
        n = 5 - row
        for i in range(n):
            y = -0.4 + (i + row * 0.5) * 0.19
            parts.append(cyl("log", 0.1, 2.2 + rnd.uniform(-0.1, 0.1), (rnd.uniform(-0.05, 0.05), y, 0.1 + row * 0.17),
                             rot=(0, math.pi / 2, 0), material="bark", seg=7))
    for s in (-1, 1):
        parts.append(beam("stake", (s * 1.15, -0.5, 0), (s * 1.15, -0.5, 0.9), 0.08))
        parts.append(beam("stake", (s * 1.15, 0.5, 0), (s * 1.15, 0.5, 0.9), 0.08))
    parts.append(box("cover", (2.5, 1.2, 0.05), (0, 0, 0.62), rot=(0.1, 0, 0), material="wood_dark"))
    parts.append(cyl("block", 0.28, 0.5, (0.4, 0.9, 0.25), material="bark", seg=10))
    parts.append(beam("axe", (0.4, 0.9, 0.5), (0.5, 1.2, 1.05), 0.04))
    parts.append(box("axehead", (0.04, 0.2, 0.14), (0.5, 1.22, 1.02), material="metal"))
    return join(parts, "woodpile")


def anvil():
    parts = [cyl("stump", 0.34, 0.45, (0, 0, 0.225), material="bark", seg=10)]
    parts.append(extrude_shape("anvil", [(-0.35, 0), (0.25, 0), (0.3, 0.1), (0.42, 0.13), (0.3, 0.2), (-0.3, 0.2), (-0.35, 0.12)],
                               0.2, material="metal_dark", loc=(0, 0, 0.45)))
    parts.append(box("waist", (0.2, 0.14, 0.12), (0, 0, 0.47), material="metal_dark"))
    parts.append(beam("hammer", (0.1, 0.12, 0.66), (0.35, 0.3, 0.66), 0.03))
    parts.append(box("hammerhead", (0.08, 0.14, 0.08), (0.1, 0.12, 0.66), material="metal_dark"))
    return join(parts, "anvil")


def workbench():
    parts = [box("top", (2.2, 0.9, 0.1), (0, 0, 0.9), material="wood", bevel=0.01)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(box("leg", (0.1, 0.1, 0.85), (sx * 1.0, sy * 0.38, 0.43), material="wood_dark"))
    parts.append(box("shelf", (2.0, 0.8, 0.05), (0, 0, 0.25), material="wood_dark"))
    parts.append(box("vice", (0.2, 0.15, 0.15), (0.9, 0.42, 1.0), material="metal_dark"))
    parts.append(box("board", (0.6, 0.35, 0.03), (-0.4, 0.05, 0.97), rot=(0, 0, 0.2), material="wood"))
    parts.append(cyl("jar", 0.07, 0.16, (0.3, -0.2, 1.03), material="herb", seg=8))
    return join(parts, "workbench")


def alchemy_table():
    """Alchemietisch (wie in KCD): Tisch mit Mörser, Kolben und Rezeptbuch, daneben ein Kessel über Glut."""
    rnd = random.Random(11)

    def sl(o):
        smooth(o, 50)
        return o
    parts = [box("top", (1.8, 0.8, 0.08), (0, 0, 0.88), material="wood", bevel=0.01)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(box("leg", (0.09, 0.09, 0.84), (sx * 0.82, sy * 0.33, 0.42), material="wood_dark"))
    parts.append(box("shelf", (1.6, 0.7, 0.04), (0, 0, 0.22), material="wood_dark"))
    # Mörser und Stößel
    parts.append(sl(lathe("mortar", [(0.0, 0.0), (0.1, 0.0), (0.11, 0.05), (0.1, 0.12), (0.075, 0.12), (0.06, 0.05), (0.0, 0.04)], 14, "stone", loc=(-0.55, 0.1, 0.92))))
    parts.append(beam("pestle", (-0.55, 0.1, 0.98), (-0.47, 0.18, 1.14), 0.025, material="stone"))
    # Kolben und Flaschen
    for i, (x, y, hh) in enumerate([(0.1, 0.2, 0.26), (0.28, 0.12, 0.2), (0.4, 0.25, 0.3), (0.62, 0.05, 0.18)]):
        prof = [(0.0, 0.0), (0.07, 0.0), (0.08, hh * 0.35), (0.03, hh * 0.7), (0.025, hh), (0.0, hh)]
        parts.append(sl(lathe("flask", prof, 12, "crystal" if i % 2 == 0 else "herb", loc=(x, y, 0.92))))
    # Rezeptbuch, aufgeschlagen
    parts.append(box("book_l", (0.22, 0.3, 0.025), (-0.12, -0.2, 0.935), rot=(0, 0.08, 0.1), material="cloth_white"))
    parts.append(box("book_r", (0.22, 0.3, 0.025), (0.1, -0.18, 0.935), rot=(0, -0.08, 0.1), material="cloth_white"))
    parts.append(box("cover", (0.48, 0.33, 0.012), (-0.01, -0.19, 0.918), rot=(0, 0, 0.1), material="leather"))
    # Kräuterbündel im Regal und getrocknete Kräuter
    for i in range(5):
        parts.append(cyl("bundle", 0.05, 0.22, (-0.6 + i * 0.3, rnd.uniform(-0.2, 0.2), 0.32), rot=(math.pi / 2, 0, rnd.uniform(0, 3)), material="herb", seg=6))
    for i in range(3):
        parts.append(cyl("jar", 0.07, 0.16, (-0.4 + i * 0.3, 0.2, 0.32), material="metal_dark" if i == 1 else "stone", seg=10))
    # Kessel auf Dreibein über der Glut (neben dem Tisch)
    kx = 1.45
    for i in range(3):
        a = i * 2 * math.pi / 3
        parts.append(beam("tripod", (kx + math.cos(a) * 0.45, math.sin(a) * 0.45, 0.0), (kx, 0, 1.25), 0.035, material="metal_dark"))
    parts.append(beam("chain", (kx, 0, 1.25), (kx, 0, 0.8), 0.012, material="metal_dark"))
    parts.append(sl(lathe("cauldron", [(0.0, 0.0), (0.18, 0.02), (0.27, 0.14), (0.28, 0.28), (0.24, 0.36), (0.25, 0.38), (0.0, 0.38)], 16, "metal_dark", loc=(kx, 0, 0.42))))
    parts.append(cyl("brew", 0.23, 0.01, (kx, 0, 0.78), material="herb", seg=16))
    for i in range(6):
        a = i * math.pi / 3 + rnd.uniform(-0.2, 0.2)
        parts.append(cyl("log", 0.045, 0.5, (kx + math.cos(a) * 0.18, math.sin(a) * 0.18, 0.06), rot=(math.pi / 2, 0, a + math.pi / 2), material="bark", seg=6))
    parts.append(ico("embers", 0.16, (kx, 0, 0.05), material="glow_warm", sub=1, scale=(1, 1, 0.35)))
    for i in range(10):
        a = i * 2 * math.pi / 10
        parts.append(rock("ring", 0.09, i, (kx + math.cos(a) * 0.4, math.sin(a) * 0.4, 0.04), material="stone", sub=1))
    return join(parts, "alchemy_table")


def ruin_pillar():
    rnd = random.Random(7)
    parts = [box("base", (1.4, 1.4, 0.5), (0, 0, 0.1), material="stone_block", bevel=0.04)]
    col = cyl("shaft", 0.5, 4.4, (0, 0, 2.55), material="stone_moss", seg=12, r2=0.45)
    bake(col)
    for v in col.data.vertices:
        if v.co.z > 4.2:
            v.co.z += rnd.uniform(-0.5, 0.2)
    parts.append(col)
    for i in range(3):
        parts.append(rock("rubble", 0.3, 20 + i, loc=(math.cos(i * 2.3) * 1.0, math.sin(i * 2.3) * 1.0, 0.1), scale=(1, 1, 0.6), sub=1))
    return join(parts, "ruin_pillar")


def ruin_wall():
    rnd = random.Random(9)
    parts = []
    for row in range(6):
        z = 0.25 + row * 0.5
        x = -3.0 + (0.4 if row % 2 else 0)
        while x < 3.0:
            w = rnd.uniform(0.7, 1.2)
            w = min(w, 3.0 - x)
            if w < 0.2:
                break
            top_limit = 3.0 - abs(x) * 0.5 + rnd.uniform(-0.6, 0.3)
            if z < top_limit:
                parts.append(box("block", (w - 0.04, 0.9, 0.46), (x + w / 2, rnd.uniform(-0.04, 0.04), z),
                                 rot=(0, 0, rnd.uniform(-0.02, 0.02)), material="stone_moss" if row < 2 else "stone_block", bevel=0.04))
            x += w
    for i in range(4):
        parts.append(rock("rubble", 0.28, 30 + i, loc=(rnd.uniform(-2.5, 2.5), rnd.choice((-0.8, 0.8)), 0.05), scale=(1.2, 1, 0.6), sub=1))
    return join(parts, "ruin_wall")


def ruin_arch():
    parts = []
    for s in (-1, 1):
        parts.append(box("pier", (1.2, 1.2, 4.6), (s * 2.4, 0, 2.3), material="stone_block", bevel=0.05))
        parts.append(box("cap", (1.4, 1.4, 0.3), (s * 2.4, 0, 4.65), material="stone"))
    n = 9
    for i in range(n):
        a0 = math.pi * i / n
        a1 = math.pi * (i + 1) / n
        am = (a0 + a1) / 2
        r = 2.4
        x = -math.cos(am) * r
        z = 4.8 + math.sin(am) * r
        if i in (6,):
            continue  # herausgebrochener Stein
        parts.append(box("voussoir", (0.85, 1.0, 0.7), (x, 0, z), rot=(0, am - math.pi / 2, 0), material="stone_block", bevel=0.03))
    parts.append(box("key", (0.6, 1.1, 0.8), (0, 0, 7.3), material="stone_block"))
    return join(parts, "ruin_arch")


def bell_pillar():
    parts = [cyl("column", 0.55, 2.4, (0, 0, 1.2), material="stone_block", seg=10, r2=0.45)]
    parts.append(box("base", (1.3, 1.3, 0.3), (0, 0, 0.15), material="stone"))
    parts.append(box("top", (1.3, 0.4, 0.25), (0, 0, 2.5), material="stone"))
    for s in (-1, 1):
        parts.append(box("arm", (0.2, 0.3, 0.9), (s * 0.55, 0, 2.95), material="stone_block"))
    parts.append(beam("bar", (-0.6, 0, 3.35), (0.6, 0, 3.35), 0.1, material="metal_dark"))
    parts.append(lathe("bell", [(0.0, 3.3), (0.12, 3.28), (0.2, 3.1), (0.26, 2.9), (0.34, 2.8), (0.33, 2.76)], 14, "metal_gold"))
    parts.append(uvsphere("clapper", 0.05, (0, 0, 2.85), material="metal_dark", seg=8, rings=6))
    # Glyphe auf der Säule
    parts.append(box("glyph", (0.3, 0.05, 0.3), (0, 0.5, 1.6), rot=(0, math.pi / 4, 0), material="glow_null"))
    return join(parts, "bell_pillar")


def altar():
    parts = [box("altar", (2.4, 1.3, 1.0), (0, 0, 0.5), material="stone_block", bevel=0.04)]
    parts.append(box("slab", (2.6, 1.5, 0.12), (0, 0, 1.06), material="stone"))
    parts.append(box("cloth", (1.2, 1.52, 0.02), (0, 0, 1.13), material="cloth_white"))
    parts.append(box("clothfront", (1.2, 0.02, 0.5), (0, 0.76, 0.88), material="cloth_white"))
    for i, x in enumerate((-1.0, -0.8, 0.85, 1.05)):
        h = 0.18 + (i % 2) * 0.08
        parts.append(cyl("candle", 0.035, h, (x, 0.3 - (i % 2) * 0.2, 1.12 + h / 2), material="cloth_white", seg=8))
        parts.append(ico("flame", 0.02, (x, 0.3 - (i % 2) * 0.2, 1.14 + h), material="glow_warm", sub=1))
    parts.append(cyl("bowl", 0.22, 0.1, (0, 0, 1.2), material="metal_gold", seg=12, r2=0.15))
    return join(parts, "altar")


def statue_oda():
    parts = [box("plinth", (1.5, 1.5, 0.8), (0, 0, 0.4), material="stone_block", bevel=0.05)]
    parts.append(box("plinth2", (1.2, 1.2, 0.2), (0, 0, 0.9), material="stone"))
    robe = lathe("robe", [(0.5, 1.0), (0.45, 1.6), (0.3, 2.4), (0.25, 2.9), (0.28, 3.05), (0.0, 3.1)], 14, "stone_moss")
    parts.append(robe)
    parts.append(uvsphere("head", 0.17, (0, 0.02, 3.3), material="stone_moss", seg=12, rings=8))
    parts.append(lathe("hood", [(0.22, 3.1), (0.23, 3.35), (0.15, 3.52), (0.0, 3.56)], 12, "stone_moss", loc=(0, -0.03, 0)))
    # Erhobene Hand mit Laterne, andere Hand am Herzen
    parts.append(tube("arm", [(0.25, 0, 2.8), (0.45, 0.1, 3.05), (0.5, 0.2, 3.5)], 0.08, 6, material="stone_moss"))
    parts.append(box("lantern", (0.2, 0.2, 0.28), (0.5, 0.22, 3.72), material="glow_null"))
    parts.append(tube("arm2", [(-0.25, 0, 2.8), (-0.2, 0.25, 2.6), (0.0, 0.3, 2.6)], 0.075, 6, material="stone_moss"))
    return join(parts, "statue_oda")


def crystal_cluster(name, count, height, spread, seed, base=True):
    rnd = random.Random(seed)
    parts = []
    for i in range(count):
        h = height * (1.0 if i == 0 else rnd.uniform(0.35, 0.8))
        r = h * rnd.uniform(0.1, 0.14)
        a = rnd.uniform(0, 2 * math.pi)
        d = 0 if i == 0 else spread * rnd.uniform(0.4, 1.0)
        x, y = math.cos(a) * d, math.sin(a) * d
        tilt = 0 if i == 0 else 0.35 + rnd.uniform(0, 0.3)
        sh = cyl("shaft", r, h * 0.8, (0, 0, h * 0.4), material="crystal", seg=6)
        tip = cone("tip", r, h * 0.2, (0, 0, h * 0.9), material="crystal", seg=6)
        c = join([sh, tip], "c")
        c.rotation_euler = (math.cos(a + math.pi / 2) * tilt, math.sin(a + math.pi / 2) * tilt, rnd.uniform(0, 1))
        c.location = (x, y, -0.1)
        parts.append(c)
    if base:
        parts.append(rock("base", spread * 0.7, seed, loc=(0, 0, 0), scale=(1.2, 1.2, 0.35), material="stone", sub=2))
    return join(parts, name)


def crystal_small():
    return crystal_cluster("crystal_small", 5, 1.4, 0.35, 41)


def crystal_large():
    return crystal_cluster("crystal_large", 7, 5.0, 1.1, 42)


def crystal_node():
    return crystal_cluster("crystal_node", 6, 1.5, 0.45, 43)


def mine_cart():
    parts = []
    prof = [(-0.6, 0), (0.6, 0), (0.72, 0.65), (-0.72, 0.65)]
    tub = extrude_shape("tub", prof, 1.8, material="metal_dark", loc=(0, 0, 0.35))
    parts.append(tub)
    parts.append(box("inside", (1.3, 1.7, 0.02), (0, 0, 0.99), material="void"))
    parts.append(rock("ore", 0.45, 12, loc=(0, 0, 0.98), scale=(1.2, 1.7, 0.4), material="ore", sub=1))
    for sx in (-1, 1):
        for sy in (-0.6, 0.6):
            parts.append(cyl("wheel", 0.2, 0.08, (sx * 0.62, sy, 0.2), rot=(0, math.pi / 2, 0), material="metal_dark", seg=12))
    for s in (-1, 1):
        parts.append(box("band", (1.48, 0.06, 0.08), (0, s * 0.92, 0.9), material="metal"))
    return join(parts, "mine_cart")


def stele():
    parts = []
    slab = extrude_shape("stele", [(-0.55, 0), (0.55, 0), (0.5, 2.6), (0.3, 2.95), (-0.3, 2.95), (-0.5, 2.6)], 0.6, material="stone_moss")
    parts.append(slab)
    parts.append(box("base", (1.5, 1.0, 0.3), (0, 0, 0.1), material="stone_block"))
    # Drei Symbole: Mond, Muschel, Welle
    parts.append(cyl("moon", 0.16, 0.04, (0, 0.31, 2.3), rot=(math.pi / 2, 0, 0), material="glow_null", seg=12))
    parts.append(cyl("moonshade", 0.13, 0.05, (0.06, 0.32, 2.34), rot=(math.pi / 2, 0, 0), material="stone_moss", seg=12))
    shell = extrude_shape("shell", [(-0.16, 0), (0.16, 0), (0.1, 0.2), (0, 0.24), (-0.1, 0.2)], 0.04, material="glow_null", loc=(0, 0.31, 1.62))
    parts.append(shell)
    wave = tube("wave", [(-0.2, 0.31, 1.15), (-0.1, 0.31, 1.25), (0, 0.31, 1.15), (0.1, 0.31, 1.05), (0.2, 0.31, 1.15)], 0.025, 5, material="glow_null")
    parts.append(wave)
    return join(parts, "stele")


def raven_stone():
    parts = [rock("stone", 0.9, 51, loc=(0, 0, 0.7), scale=(1.0, 0.9, 1.2), material="stone")]
    # Rabe aus dunklem Stein auf dem Fels
    body = uvsphere("raven", 0.22, (0, 0, 1.95), material="metal_dark", seg=10, rings=8, scale=(0.8, 1.4, 0.9))
    parts.append(body)
    parts.append(uvsphere("head", 0.12, (0, 0.3, 2.18), material="metal_dark", seg=8, rings=6))
    parts.append(cone("beak", 0.05, 0.16, (0, 0.46, 2.16), rot=(-math.pi / 2, 0, 0), material="metal_dark", seg=6))
    parts.append(extrude_shape("tail", [(-0.1, 0), (0.1, 0), (0.14, -0.3), (-0.14, -0.3)], 0.04, material="metal_dark",
                               loc=(0, -0.3, 1.9), rot=(-1.2, 0, 0)))
    for s in (-1, 1):
        parts.append(extrude_shape("wing", [(0, 0), (0.1, 0.05), (0.14, -0.42), (0.02, -0.3)], 0.03, material="metal_dark",
                                   loc=(s * 0.16, 0.15, 2.0), rot=(-1.4, 0, s * 0.3)))
    return join(parts, "raven_stone")


def rest_shrine():
    parts = [cyl("base", 1.0, 0.35, (0, 0, 0.1), material="stone_block", seg=8)]
    parts.append(cyl("step", 0.8, 0.25, (0, 0, 0.4), material="stone", seg=8))
    parts.append(lathe("bowl", [(0.15, 0.5), (0.3, 0.7), (0.55, 1.0), (0.6, 1.05), (0.5, 1.02), (0.0, 0.9)], 14, "metal_dark"))
    parts.append(ico("ember", 0.35, (0, 0, 1.05), material="glow_warm", sub=1))
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        parts.append(box("stone", (0.25, 0.25, 0.9), (math.cos(a) * 0.85, math.sin(a) * 0.85, 0.7), rot=(0, 0, a), material="stone_moss"))
        parts.append(cyl("candle", 0.04, 0.12, (math.cos(a) * 0.85, math.sin(a) * 0.85, 1.21), material="cloth_white", seg=6))
    parts.append(beam("pole", (0.0, -0.95, 0.2), (0.0, -0.95, 1.9), 0.07))
    parts.append(box("pennant", (0.02, 0.5, 0.3), (0.0, -0.7, 1.7), material="cloth_red"))
    return join(parts, "rest_shrine")


def chest():
    parts = [box("body", (1.05, 0.65, 0.42), (0, 0, 0.21), material="wood", bevel=0.015)]
    lid = cyl("lid", 0.325, 1.05, (0, 0, 0.42), rot=(0, math.pi / 2, 0), material="wood", seg=12)
    bake(lid)
    for v in lid.data.vertices:
        if v.co.z < 0.42:
            v.co.z = 0.42
    parts.append(lid)
    for x in (-0.4, 0.4):
        parts.append(box("band", (0.07, 0.67, 0.43), (x, 0, 0.215), material="metal_dark"))
        parts.append(cyl("bandlid", 0.335, 0.07, (x, 0, 0.42), rot=(0, math.pi / 2, 0), material="metal_dark", seg=12))
    parts.append(box("lock", (0.14, 0.05, 0.16), (0, 0.34, 0.42), material="metal_gold"))
    return join(parts, "chest")


def expedition_wagon():
    parts = [box("bed", (2.2, 4.2, 0.14), (0, 0, 1.0), material="wood")]
    for s in (-1, 1):
        parts.append(box("side", (0.07, 4.2, 0.4), (s * 1.08, 0, 1.25), material="wood"))
        parts += wheel("wheel", 0.7, s * 1.25, -1.3, 0.7)
        parts += wheel("wheel", 0.6, s * 1.25, 1.3, 0.6)
    # Plane über Spriegeln
    for i in range(5):
        y = -1.8 + i * 0.9
        pts = [(math.cos(a) * 1.1, y, 1.4 + math.sin(a) * 1.0) for a in [math.pi * k / 8 for k in range(9)]]
        parts.append(tube("hoop", pts, 0.04, 5, material="wood_dark"))
    canvas = cyl("canvas", 1.12, 3.9, (0, 0, 1.4), rot=(math.pi / 2, 0, 0), material="cloth_white", seg=16, caps=False)
    bake(canvas)
    for v in canvas.data.vertices:
        if v.co.z < 1.4:
            v.co.z = 1.4
        v.co.z = 1.4 + (v.co.z - 1.4) * 0.92
    parts.append(canvas)
    parts.append(beam("tongue", (0, 2.1, 0.9), (0, 3.6, 0.6), 0.12))
    parts.append(box("crate", (0.6, 0.6, 0.6), (0.6, -2.5, 0.3), material="wood"))
    parts.append(box("map", (0.5, 0.4, 0.02), (-0.5, -1.9, 1.1), material="cloth_white"))
    return join(parts, "expedition_wagon")


def lore():
    parts = [box("stand", (0.12, 0.12, 0.9), (0, 0, 0.45), material="wood_dark")]
    parts.append(box("desk", (0.55, 0.4, 0.05), (0, 0, 0.95), rot=(0.4, 0, 0), material="wood"))
    parts.append(box("book", (0.44, 0.3, 0.05), (0, 0.01, 1.0), rot=(0.4, 0, 0), material="leather"))
    parts.append(box("pages", (0.4, 0.28, 0.02), (0, 0.0, 1.03), rot=(0.4, 0, 0), material="cloth_white"))
    parts.append(box("foot", (0.45, 0.45, 0.06), (0, 0, 0.03), material="wood_dark"))
    return join(parts, "lore")


def ore_node():
    parts = [rock("rock", 0.9, 61, loc=(0, 0, 0.35), scale=(1.1, 1.0, 0.85), material="stone")]
    rnd = random.Random(61)
    for i in range(6):
        a = rnd.uniform(0, 2 * math.pi)
        parts.append(rock("ore", 0.2, 62 + i, loc=(math.cos(a) * 0.75, math.sin(a) * 0.7, 0.3 + rnd.uniform(0, 0.5)), material="ore", sub=1))
    return join(parts, "ore_node")


def herb_node():
    parts = []
    rnd = random.Random(71)
    for i in range(9):
        a = i * 2.4
        h = rnd.uniform(0.25, 0.5)
        pts = [(0, 0, 0), (math.cos(a) * 0.08, math.sin(a) * 0.08, h * 0.6), (math.cos(a) * 0.18, math.sin(a) * 0.18, h)]
        parts.append(tube("stem", pts, 0.012, 4, material="leaves"))
        leaf = extrude_shape("leaf", [(0, 0), (0.05, 0.08), (0, 0.2), (-0.05, 0.08)], 0.005, material="herb",
                             loc=(math.cos(a) * 0.18, math.sin(a) * 0.18, h), rot=(0.5, 0, a))
        parts.append(leaf)
        if i % 3 == 0:
            parts.append(ico("bloom", 0.04, (math.cos(a) * 0.18, math.sin(a) * 0.18, h + 0.05), material="glow_null", sub=1))
    return join(parts, "herb_node")


def salt_node():
    parts = [rock("crust", 0.7, 81, loc=(0, 0, 0.05), scale=(1.1, 1.0, 0.35), material="salt", sub=2)]
    rnd = random.Random(81)
    for i in range(8):
        a = rnd.uniform(0, 2 * math.pi)
        d = rnd.uniform(0.1, 0.55)
        c = box("cube", (0.14, 0.14, 0.14), (math.cos(a) * d, math.sin(a) * d, 0.25 + rnd.uniform(0, 0.1)),
                rot=(rnd.uniform(0, 1), rnd.uniform(0, 1), rnd.uniform(0, 1)), material="salt")
        c.scale = (1, 1, rnd.uniform(1, 2.2))
        parts.append(c)
    return join(parts, "salt_node")


def wood_node():
    parts = [cyl("log", 0.35, 2.4, (0, 0, 0.32), rot=(0, math.pi / 2, 0.08), material="bark", seg=10)]
    parts.append(cyl("end", 0.33, 0.02, (1.21, 0.1, 0.32), rot=(0, math.pi / 2, 0.08), material="wood", seg=10))
    parts.append(tube("branch", [(0.3, 0, 0.5), (0.5, 0.3, 0.9), (0.6, 0.5, 1.1)], 0.07, 5, material="bark", r_end=0.02))
    parts.append(tube("branch", [(-0.5, 0, 0.5), (-0.7, -0.4, 0.7)], 0.06, 5, material="bark", r_end=0.02))
    parts.append(ico("moss", 0.25, (-0.2, 0.1, 0.6), material="leaves", sub=1))
    return join(parts, "wood_node")


def pressure_plate():
    parts = [cyl("rim", 1.0, 0.12, (0, 0, 0.02), material="stone_block", seg=8)]
    parts.append(cyl("plate", 0.8, 0.12, (0, 0, 0.07), material="stone", seg=8))
    parts.append(cyl("rune", 0.35, 0.02, (0, 0, 0.14), material="glow_null", seg=6))
    return join(parts, "pressure_plate")


def twin_door():
    parts = []
    for s in (-1, 1):
        parts.append(box("jamb", (0.8, 1.2, 6.4), (s * 3.6, 0, 3.2), material="stone_block", bevel=0.04))
        leaf = extrude_shape("leaf", [(-1.6, 0), (1.6, 0), (1.6, 5.2), (0.9, 5.8), (-1.6, 5.8)] if s < 0 else
                             [(-1.6, 0), (1.6, 0), (1.6, 5.8), (-0.9, 5.8), (-1.6, 5.2)], 0.6, material="stone",
                             loc=(s * 1.6, 0, 0))
        parts.append(leaf)
        parts.append(box("rune", (0.5, 0.05, 1.8), (s * 1.6, 0.31, 3.0), material="glow_null"))
        parts.append(cyl("ring", 0.35, 0.06, (s * 0.5, 0.32, 2.8), rot=(math.pi / 2, 0, 0), material="metal_dark", seg=12, caps=False))
    parts.append(box("lintel", (8.2, 1.4, 0.8), (0, 0, 6.6), material="stone_block", bevel=0.04))
    parts.append(box("eye", (0.6, 0.1, 0.6), (0, 0.7, 6.6), rot=(0, math.pi / 4, 0), material="glow_null"))
    return join(parts, "twin_door")


def lever():
    parts = [box("base", (0.5, 0.4, 0.5), (0, 0, 0.25), material="stone_block", bevel=0.03)]
    parts.append(box("slot", (0.1, 0.3, 0.02), (0, 0, 0.51), material="metal_dark"))
    parts.append(beam("arm", (0, 0, 0.5), (0, 0.25, 1.15), 0.06, material="metal_dark"))
    parts.append(uvsphere("knob", 0.07, (0, 0.27, 1.19), material="wood_dark", seg=8, rings=6))
    return join(parts, "lever")


def tide_stone():
    rnd = random.Random(91)
    o = cyl("tide", 1.45, 0.3, (0, 0, -0.15), material="stone", seg=9)
    bake(o)
    for v in o.data.vertices:
        k = 1 + rnd.uniform(-0.08, 0.05)
        v.co.x *= k
        v.co.y *= k
    return join([o], "tide_stone")


def boss_pillar():
    parts = [cyl("base", 1.5, 1.0, (0, 0, 0.3), material="stone_block", seg=8)]
    shaft = cyl("shaft", 1.0, 7.2, (0, 0, 4.4), material="crystal", seg=6, r2=0.7)
    parts.append(shaft)
    parts.append(cone("tip", 0.7, 1.2, (0, 0, 8.6), material="crystal", seg=6))
    for i in range(3):
        a = i * 2.1
        parts.append(box("band", (0.25, 2.2, 0.3), (0, 0, 2.2 + i * 2.2), rot=(0, 0, a), material="metal_dark"))
    return join(parts, "boss_pillar")


ASSETS = {
    "barrel": (barrel, None), "crate": (crate, None), "cart": (cart, None), "fence": (fence, None), "lamp": (lamp, None),
    "bench": (bench, None), "haystack": (haystack, None), "woodpile": (woodpile, None), "anvil": (anvil, None),
    "workbench": (workbench, None), "alchemy_table": (alchemy_table, None), "ruin_pillar": (ruin_pillar, None), "ruin_wall": (ruin_wall, None), "ruin_arch": (ruin_arch, None),
    "bell_pillar": (bell_pillar, None), "altar": (altar, None), "statue_oda": (statue_oda, None), "crystal_small": (crystal_small, None),
    "crystal_large": (crystal_large, None), "crystal_node": (crystal_node, None), "mine_cart": (mine_cart, None), "stele": (stele, None),
    "raven_stone": (raven_stone, None), "rest_shrine": (rest_shrine, None), "chest": (chest, None), "expedition_wagon": (expedition_wagon, None),
    "lore": (lore, None), "ore_node": (ore_node, None), "herb_node": (herb_node, None), "salt_node": (salt_node, None),
    "wood_node": (wood_node, None), "pressure_plate": (pressure_plate, None), "twin_door": (twin_door, None), "lever": (lever, None),
    "tide_stone": (tide_stone, None), "boss_pillar": (boss_pillar, None),
}
