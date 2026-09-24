"""Gebäude von Haldenbruck und Umgebung. Maße passen zu den Kollisionsformen in
packages/shared/src/world/props.ts (Vorderseite = Blender +Y = Spiel -Z)."""
import math
import random

from lib import (bake, beam, box, cone, cyl, extrude_shape, gable_wall, ico, join, prism_roof, rock, tube)


def _frame_side(parts, w, y, z0, z1, braces=True, seed=0):
    """Fachwerk auf einer Längsseite (entlang X, Fassade bei y)."""
    rnd = random.Random(seed)
    n = max(2, round(w / 2.2))
    for i in range(n + 1):
        x = -w / 2 + i * w / n
        parts.append(beam("post", (x, y, z0), (x, y, z1), 0.2))
    parts.append(beam("sill", (-w / 2 - 0.1, y, z0), (w / 2 + 0.1, y, z0), 0.22))
    parts.append(beam("plate", (-w / 2 - 0.1, y, z1), (w / 2 + 0.1, y, z1), 0.22))
    if braces:
        for i in range(n):
            if rnd.random() < 0.55:
                x0 = -w / 2 + i * w / n
                x1 = x0 + w / n
                if rnd.random() < 0.5:
                    parts.append(beam("brace", (x0, y, z0), (x1, y, z1), 0.16))
                else:
                    parts.append(beam("brace", (x1, y, z0), (x0, y, z1), 0.16))


def _frame_end(parts, d, x, z0, z1):
    for yy in (-d / 2, 0, d / 2):
        parts.append(beam("post", (x, yy, z0), (x, yy, z1), 0.2))
    parts.append(beam("sill", (x, -d / 2, z0), (x, d / 2, z0), 0.22))
    parts.append(beam("plate", (x, -d / 2, z1), (x, d / 2, z1), 0.22))


def _window(parts, x, y, z, facing=1, w=0.9, h=1.1, axis="y"):
    """Fenster mit Rahmen, Sprossen, Läden und Sims. facing: +1/-1 Richtung der Fassade."""
    off = 0.13 * facing
    if axis == "y":
        parts.append(box("win", (w, 0.06, h), (x, y + off * 0.6, z), material="window"))
        parts.append(box("frame", (w + 0.16, 0.08, 0.1), (x, y + off, z + h / 2 + 0.05), material="wood_dark"))
        parts.append(box("sill", (w + 0.3, 0.2, 0.08), (x, y + off + 0.05 * facing, z - h / 2 - 0.04), material="wood_dark"))
        parts.append(box("bar", (0.05, 0.08, h), (x, y + off, z), material="wood_dark"))
        parts.append(box("bar", (w, 0.08, 0.05), (x, y + off, z + 0.1), material="wood_dark"))
        for s in (-1, 1):
            parts.append(box("shutter", (w * 0.5, 0.05, h), (x + s * (w * 0.75 + 0.05), y + off + 0.02 * facing, z), material="wood"))
    else:
        parts.append(box("win", (0.06, w, h), (x + off * 0.6, y, z), material="window"))
        parts.append(box("frame", (0.08, w + 0.16, 0.1), (x + off, y, z + h / 2 + 0.05), material="wood_dark"))
        parts.append(box("sill", (0.2, w + 0.3, 0.08), (x + off + 0.05 * facing, y, z - h / 2 - 0.04), material="wood_dark"))
        parts.append(box("bar", (0.08, 0.05, h), (x + off, y, z), material="wood_dark"))
        for s in (-1, 1):
            parts.append(box("shutter", (0.05, w * 0.5, h), (x + off + 0.02 * facing, y + s * (w * 0.75 + 0.05), z), material="wood"))


def _door(parts, x, y, w=1.3, h=2.3, facing=1):
    off = 0.11 * facing
    parts.append(box("door", (w, 0.1, h), (x, y + off, 0.6 + h / 2), material="wood_dark", bevel=0.02))
    for zz in (0.9, 2.2):
        parts.append(box("hinge", (w * 0.8, 0.04, 0.06), (x - 0.05, y + off + 0.06 * facing, zz), material="metal_dark"))
    parts.append(box("lintel", (w + 0.4, 0.24, 0.24), (x, y + off, 0.6 + h + 0.12), material="wood_dark"))
    parts.append(box("step", (w + 0.6, 0.7, 0.3), (x, y + 0.35 * facing, 0.15), material="stone_block", bevel=0.03))


def timber_house(w, d, wall_h, roof_h, *, floors=1, plinth=0.6, roof_mat="roof", seed=0, windows=None, door_x=0.0,
                 chimney=True, jetty=False, lower_mat="plaster"):
    parts = []
    # Sockel (reicht unter den Boden, damit Hanglagen nicht schweben)
    parts.append(box("plinth", (w + 0.3, d + 0.3, plinth + 0.8), (0, 0, plinth / 2 - 0.4), material="stone_block", bevel=0.05))
    z0 = plinth
    floor_h = (wall_h - plinth) / floors
    for f in range(floors):
        zb = z0 + f * floor_h
        zt = zb + floor_h
        grow = 0.25 if (jetty and f > 0) else 0.0
        ww, dd = w + grow * 2, d + grow * 2
        mat = lower_mat if f == 0 else "plaster"
        parts.append(box("wall", (ww - 0.12, dd - 0.12, floor_h), (0, 0, zb + floor_h / 2), material=mat))
        if mat == "plaster":
            _frame_side(parts, ww, dd / 2, zb, zt, seed=seed + f)
            _frame_side(parts, ww, -dd / 2, zb, zt, seed=seed + 7 + f)
            _frame_end(parts, dd, ww / 2, zb, zt)
            _frame_end(parts, dd, -ww / 2, zb, zt)
        # Fenster
        nx = windows if windows else max(1, int(ww // 2.6))
        for i in range(nx):
            x = -ww / 2 + (i + 0.5) * ww / nx
            if f == 0 and abs(x - door_x) < 1.2:
                continue
            _window(parts, x, dd / 2, zb + floor_h * 0.55, 1)
            if (i + f) % 2 == 0:
                _window(parts, x, -dd / 2, zb + floor_h * 0.55, -1)
        for s in (-1, 1):
            _window(parts, s * ww / 2, 0, zb + floor_h * 0.55, s, axis="x")
    _door(parts, door_x, d / 2)
    # Dach mit Giebeln
    top = z0 + floors * floor_h
    ww = w + (0.5 if jetty and floors > 1 else 0)
    dd = d + (0.5 if jetty and floors > 1 else 0)
    parts.append(prism_roof("roof", ww, dd, roof_h, (0, 0, top), overhang=0.55, material=roof_mat, thickness=0.18))
    for s in (-1, 1):
        parts.append(gable_wall("gable", dd, roof_h, (s * ww / 2, 0, top), rot_z=math.pi / 2, material="plaster"))
        parts.append(beam("gablebeam", (s * ww / 2 + s * 0.02, -dd / 2, top), (s * ww / 2 + s * 0.02, 0, top + roof_h), 0.16))
        parts.append(beam("gablebeam", (s * ww / 2 + s * 0.02, dd / 2, top), (s * ww / 2 + s * 0.02, 0, top + roof_h), 0.16))
        parts.append(beam("king", (s * ww / 2 + s * 0.02, 0, top), (s * ww / 2 + s * 0.02, 0, top + roof_h), 0.16))
    parts.append(beam("ridge", (-ww / 2 - 0.6, 0, top + roof_h + 0.05), (ww / 2 + 0.6, 0, top + roof_h + 0.05), 0.2))
    if chimney:
        cx = ww * 0.28
        parts.append(box("chimney", (0.8, 0.8, roof_h + 1.4), (cx, -dd * 0.18, top + (roof_h + 1.4) / 2), material="stone_block", bevel=0.03))
        parts.append(box("chimneycap", (1.0, 1.0, 0.15), (cx, -dd * 0.18, top + roof_h + 1.45), material="stone"))
    return parts


def house_a():
    return join(timber_house(8, 6, 4.1, 2.9, seed=1, roof_mat="roof_thatch"), "house_a")


def house_b():
    return join(timber_house(10, 7, 6.2, 2.8, floors=2, seed=2, jetty=True, door_x=-1.5), "house_b")


def inn():
    parts = timber_house(12, 9, 6.6, 3.3, floors=2, seed=3, jetty=True, door_x=0, windows=4)
    # Wirtshausschild am Ausleger
    parts.append(beam("arm", (2.0, 4.6, 3.6), (2.0, 6.0, 3.6), 0.12))
    parts.append(box("sign", (0.9, 0.06, 0.6), (2.0, 5.7, 3.1), material="wood", bevel=0.02))
    parts.append(box("signmark", (0.5, 0.08, 0.3), (2.0, 5.7, 3.1), material="metal_gold"))
    # Vordach über der Tür
    parts.append(box("porchroof", (3.2, 1.6, 0.12), (0, 5.2, 3.2), rot=(-0.25, 0, 0), material="roof"))
    for s in (-1, 1):
        parts.append(beam("porchpost", (s * 1.5, 5.9, 0), (s * 1.5, 5.9, 3.0), 0.16))
    # Laternen neben der Tür
    for s in (-1, 1):
        parts.append(box("lantern", (0.22, 0.22, 0.32), (s * 1.1, 4.75, 2.5), material="glow_warm"))
        parts.append(box("lanterncap", (0.3, 0.3, 0.06), (s * 1.1, 4.75, 2.7), material="metal_dark"))
    return join(parts, "inn")


def smithy():
    parts = []
    # Hinterer Werkstattbau (Spiel: +1.3 in Z → Blender -1.3 in Y)
    back = timber_house(8, 4.4, 4.0, 2.0, seed=4, chimney=False, lower_mat="stone_block")
    for o in back:
        o.location.y -= 1.3
    parts += back
    # Offenes Vordach über dem Arbeitsbereich
    parts.append(box("leanto", (8.4, 3.6, 0.14), (0, 2.5, 3.5), rot=(0.22, 0, 0), material="roof"))
    for x in (-3.9, 0, 3.9):
        parts.append(beam("leanpost", (x, 4.1, 0), (x, 4.1, 3.2), 0.2))
    parts.append(beam("leanbeam", (-4.1, 4.1, 3.15), (4.1, 4.1, 3.15), 0.2))
    # Esse (Spiel -1.5/-2.2 → Blender -1.5/+2.2)
    parts.append(box("forge", (1.3, 1.3, 1.0), (-1.5, 2.2, 0.5), material="stone_block", bevel=0.05))
    parts.append(box("coals", (0.9, 0.9, 0.1), (-1.5, 2.2, 1.02), material="glow_warm"))
    parts.append(cyl("hood", 0.7, 1.0, (-1.5, 2.2, 2.2), material="stone_block", r2=0.3, seg=8))
    parts.append(box("flue", (0.5, 0.5, 3.0), (-1.5, 2.2, 3.9), material="stone_block"))
    parts.append(cyl("quench", 0.45, 0.6, (0.6, 2.9, 0.3), material="wood_dark", seg=12))
    parts.append(cyl("quenchwater", 0.4, 0.05, (0.6, 2.9, 0.58), material="water", seg=12))
    parts.append(box("rack", (2.0, 0.1, 1.4), (2.5, 0.95, 1.5), material="wood_dark"))
    for i in range(4):
        parts.append(box("tool", (0.05, 0.03, 0.7), (1.8 + i * 0.45, 1.02, 1.4), material="metal_dark"))
    return join(parts, "smithy")


def chapel():
    parts = []
    w, d, wall_h = 7.0, 12.0, 6.0
    parts.append(box("plinth", (w + 0.4, d + 0.4, 1.2), (0, 0, -0.1), material="stone_block", bevel=0.05))
    parts.append(box("nave", (w, d, wall_h), (0, 0, 0.5 + wall_h / 2), material="stone_block", bevel=0.04))
    # Strebepfeiler
    for s in (-1, 1):
        for i in range(4):
            y = -d / 2 + 1.5 + i * 3
            parts.append(box("buttress", (0.6, 0.8, 4.2), (s * (w / 2 + 0.3), y, 2.4), rot=(0, s * -0.08, 0), material="stone_block"))
            parts.append(extrude_shape("archwin", [(-0.45, 0), (0.45, 0), (0.45, 1.6), (0, 2.1), (-0.45, 1.6)], 0.12,
                                       material="window", loc=(s * (w / 2 + 0.02), y + 1.5, 2.4), rot=(0, 0, math.pi / 2)))
    # Dach (First entlang Y)
    r = prism_roof("roof", d, w, 4.2, (0, 0, 0.5 + wall_h), overhang=0.4, material="roof", thickness=0.2)
    r.rotation_euler = (0, 0, math.pi / 2)
    parts.append(r)
    for s in (-1, 1):
        parts.append(gable_wall("gable", w, 4.2, (0, s * d / 2, 0.5 + wall_h), material="stone_block", thickness=0.3))
    # Portal
    parts.append(extrude_shape("portal", [(-1.1, 0), (1.1, 0), (1.1, 2.4), (0, 3.4), (-1.1, 2.4)], 0.3, material="stone_block",
                               loc=(0, d / 2 + 0.1, 0.5)))
    parts.append(extrude_shape("door", [(-0.8, 0), (0.8, 0), (0.8, 2.2), (0, 3.0), (-0.8, 2.2)], 0.1, material="wood_dark",
                               loc=(0, d / 2 + 0.27, 0.5)))
    parts.append(cyl("rosette", 0.8, 0.12, (0, d / 2 + 0.05, 8.2), rot=(math.pi / 2, 0, 0), material="window", seg=16))
    parts.append(cyl("rosetteframe", 0.95, 0.1, (0, d / 2 + 0.02, 8.2), rot=(math.pi / 2, 0, 0), material="stone", seg=16))
    # Turm hinten (Spiel +5 in Z → Blender -5 in Y)
    ty = -5.0
    parts.append(box("tower", (3.2, 3.2, 12.0), (0, ty, 6.0), material="stone_block", bevel=0.05))
    parts.append(box("belfry", (3.5, 3.5, 0.3), (0, ty, 12.1), material="stone"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(box("belfrypost", (0.5, 0.5, 2.0), (sx * 1.45, ty + sy * 1.45, 13.2), material="stone_block"))
    parts.append(cyl("bell", 0.45, 0.7, (0, ty, 13.3), material="metal_gold", r2=0.25, seg=12))
    parts.append(box("belfrytop", (3.6, 3.6, 0.3), (0, ty, 14.3), material="stone"))
    parts.append(cone("spire", 2.4, 4.5, (0, ty, 16.7), material="roof", seg=4))
    parts[-1].rotation_euler = (0, 0, math.pi / 4)
    parts.append(beam("finial", (0, ty, 18.9), (0, ty, 19.8), 0.08, material="metal_gold"))
    return join(parts, "chapel")


def vogthaus():
    parts = timber_house(11, 8, 6.8, 3.4, floors=2, seed=5, jetty=True, lower_mat="stone_block", windows=4)
    # Wappenbanner des Ordens
    for s in (-1, 1):
        parts.append(beam("bannerpole", (s * 2.2, 4.4, 5.2), (s * 2.2, 5.3, 5.2), 0.08))
        parts.append(box("banner", (0.8, 0.04, 1.6), (s * 2.2, 5.25, 4.35), material="cloth_blue"))
        parts.append(box("bannermark", (0.3, 0.06, 0.3), (s * 2.2, 5.25, 4.5), material="metal_gold"))
    # Freitreppe
    for i in range(3):
        parts.append(box("stair", (2.6 - i * 0.3, 0.6, 0.2), (0, 4.6 + 0.6 * (2 - i), 0.1 + i * 0.2), material="stone_block"))
    return join(parts, "vogthaus")


def kontor():
    parts = timber_house(9, 7, 5.2, 2.8, floors=2, seed=6, roof_mat="roof")
    # Ladebalken mit Seilzug
    parts.append(beam("hoist", (0, 3.4, 5.6), (0, 5.0, 5.6), 0.2))
    parts.append(beam("rope", (0, 4.9, 5.5), (0, 4.9, 2.6), 0.03, material="rope"))
    parts.append(box("crate", (0.7, 0.7, 0.7), (0, 4.9, 2.2), material="wood", bevel=0.03))
    parts.append(box("loadingdoor", (1.2, 0.1, 1.6), (0, 3.62, 4.4), material="wood_dark"))
    return join(parts, "kontor")


def stall():
    parts = []
    for sx in (-1.4, 1.4):
        for sy in (-0.9, 0.9):
            parts.append(beam("post", (sx, sy, 0), (sx, sy, 2.4 if sy < 0 else 2.0), 0.1))
    parts.append(box("table", (2.9, 1.2, 0.08), (0, 0.4, 0.9), material="wood"))
    parts.append(box("tablefront", (2.9, 0.05, 0.8), (0, 1.0, 0.5), material="wood_dark"))
    parts.append(box("canopy", (3.2, 2.2, 0.04), (0, 0, 2.2), rot=(-0.19, 0, 0), material="cloth_red"))
    for i in range(5):
        parts.append(box("flap", (0.62, 0.03, 0.3), (-1.28 + i * 0.64, 1.1, 1.92), material="cloth_white" if i % 2 else "cloth_red"))
    for i in range(3):
        parts.append(cyl("basket", 0.22, 0.2, (-0.9 + i * 0.9, 0.4, 1.04), material="hay", seg=10))
    return join(parts, "stall")


def well():
    parts = []
    n = 12
    for i in range(n):
        a = 2 * math.pi * i / n
        parts.append(box("stone", (0.62, 0.36, 0.9), (math.cos(a) * 0.95, math.sin(a) * 0.95, 0.45), rot=(0, 0, a + math.pi / 2),
                         material="stone_block", bevel=0.04))
    parts.append(cyl("rim", 1.2, 0.1, (0, 0, 0.93), material="stone", seg=16))
    parts.append(cyl("water", 0.78, 0.04, (0, 0, 0.4), material="water", seg=16))
    for s in (-1, 1):
        parts.append(beam("post", (s * 1.0, 0, 0.9), (s * 1.0, 0, 2.6), 0.16))
    parts.append(cyl("winch", 0.1, 2.2, (0, 0, 2.2), rot=(0, math.pi / 2, 0), material="wood"))
    parts.append(beam("rope", (0.1, 0, 2.15), (0.1, 0, 1.4), 0.025, material="rope"))
    parts.append(cyl("bucket", 0.16, 0.26, (0.1, 0, 1.25), material="wood_dark", r2=0.19, seg=10))
    parts.append(prism_roof("roof", 2.4, 1.4, 0.7, (0, 0, 2.6), overhang=0.2, material="roof", thickness=0.08))
    return join(parts, "well")


def palisade():
    parts = []
    rnd = random.Random(11)
    n = 9
    for i in range(n):
        x = -2.1 + (i + 0.5) * 4.2 / n
        h = 3.3 + rnd.uniform(-0.15, 0.2)
        r = 0.23 + rnd.uniform(-0.02, 0.02)
        parts.append(cyl("log", r, h + 0.6, (x, rnd.uniform(-0.04, 0.04), (h - 0.6) / 2), material="bark", seg=7))
        parts.append(cone("tip", r, 0.55, (x, 0, h + 0.27), material="wood", seg=7))
    for z in (1.0, 2.6):
        parts.append(beam("rail", (-2.15, -0.28, z), (2.15, -0.28, z), 0.14))
    return join(parts, "palisade")


def tower():
    parts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(beam("leg", (sx * 1.75, sy * 1.75, -0.5), (sx * 1.55, sy * 1.55, 6.2), 0.3))
    for z in (2.2, 4.4):
        for (a, b) in [((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))]:
            parts.append(beam("ring", (a[0] * 1.68, a[1] * 1.68, z), (b[0] * 1.68, b[1] * 1.68, z), 0.16))
    for (a, b) in [((-1, 1), (1, 1)), ((-1, -1), (1, -1))]:
        parts.append(beam("x", (a[0] * 1.7, a[1] * 1.7, 0.2), (b[0] * 1.62, b[1] * 1.62, 4.4), 0.14))
    parts.append(box("floor", (3.8, 3.8, 0.2), (0, 0, 6.2), material="wood"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(beam("roofpost", (sx * 1.7, sy * 1.7, 6.3), (sx * 1.7, sy * 1.7, 8.0), 0.16))
    for s in (-1, 1):
        parts.append(box("parapet", (3.8, 0.08, 1.0), (0, s * 1.86, 6.8), material="wood"))
        parts.append(box("parapet", (0.08, 3.8, 1.0), (s * 1.86, 0, 6.8), material="wood"))
    rf = cone("roof", 3.2, 1.8, (0, 0, 8.9), material="roof_thatch", seg=4)
    rf.rotation_euler = (0, 0, math.pi / 4)
    parts.append(rf)
    parts.append(cyl("brazier", 0.3, 0.3, (0, 0, 6.5), material="metal_dark", r2=0.4, seg=8))
    parts.append(ico("fire", 0.22, (0, 0, 6.72), material="glow_warm", sub=1))
    # Leiter
    for s in (-1, 1):
        parts.append(beam("ladder", (s * 0.25, 2.1, 0), (s * 0.25, 1.9, 6.2), 0.07))
    for i in range(12):
        z = 0.4 + i * 0.5
        parts.append(beam("rung", (-0.25, 2.1 - z * 0.032, z), (0.25, 2.1 - z * 0.032, z), 0.05))
    return join(parts, "tower")


def mine_entrance():
    parts = []
    for s in (-1, 1):
        parts.append(box("post", (0.55, 0.55, 4.9), (s * 3.2, 0, 2.2), material="wood_dark", bevel=0.03))
        parts.append(beam("strut", (s * 3.2, 0, 3.4), (s * 2.3, 0, 4.4), 0.2))
    parts.append(box("lintel", (7.8, 0.7, 0.7), (0, 0, 4.75), material="wood_dark", bevel=0.03))
    # Felsmassiv um den Stollen (hinter und neben dem Rahmen, Öffnung bleibt frei)
    parts.append(rock("rocktop", 2.6, 3, loc=(0, -2.6, 6.6), scale=(2.1, 1.2, 0.8)))
    for s in (-1, 1):
        parts.append(rock("rockside", 2.3, 4 + s, loc=(s * 5.2, -2.0, 2.4), scale=(0.9, 1.3, 1.4)))
    parts.append(box("tunnel", (6.6, 3.0, 5.0), (0, -1.8, 2.3), material="stone"))
    parts.append(box("void", (6.0, 0.2, 4.4), (0, -0.28, 2.2), material="void"))
    parts.append(box("lantern", (0.25, 0.25, 0.35), (2.5, 0.35, 3.0), material="glow_warm"))
    parts.append(box("sign", (1.6, 0.08, 0.5), (0, 0.4, 4.75), material="wood"))
    # Gleise
    for s in (-1, 1):
        parts.append(box("rail", (0.08, 5.0, 0.08), (s * 0.55, 1.5, 0.05), material="metal_dark"))
    for i in range(7):
        parts.append(box("sleeper", (1.5, 0.2, 0.1), (0, -0.6 + i * 0.7, 0.02), material="wood_dark"))
    return join(parts, "mine_entrance")


def mine_house():
    parts = []
    parts.append(box("floor", (7.2, 6.2, 0.9), (0, 0, 0.0), material="stone"))
    for s in (-1, 1):
        parts.append(box("wall", (7.0, 0.14, 3.2), (0, s * 3.0, 2.0), material="wood"))
        parts.append(box("wall", (0.14, 6.0, 3.2), (s * 3.5, 0, 2.0), material="wood"))
    for x in (-3.5, 0, 3.5):
        for s in (-1, 1):
            parts.append(beam("post", (x, s * 3.0, 0.4), (x, s * 3.0, 3.6), 0.2))
    parts.append(box("door", (1.2, 0.1, 2.1), (-1.5, 3.08, 1.45), material="wood_dark"))
    _window(parts, 1.7, 3.0, 2.1, 1, w=0.8, h=0.8)
    parts.append(prism_roof("roof", 7.0, 6.0, 2.0, (0, 0, 3.6), overhang=0.45, material="wood_dark", thickness=0.14))
    for s in (-1, 1):
        parts.append(gable_wall("gable", 6.0, 2.0, (s * 3.5, 0, 3.6), rot_z=math.pi / 2, material="wood"))
    parts.append(box("stovepipe", (0.3, 0.3, 2.4), (2.2, -1.2, 4.6), material="metal_dark"))
    return join(parts, "mine_house")


def fish_hut():
    parts = []
    for sx in (-2.8, 0, 2.8):
        for sy in (-2.3, 2.3):
            parts.append(beam("stilt", (sx, sy, -1.0), (sx, sy, 0.8), 0.22))
    parts.append(box("deck", (6.4, 5.4, 0.16), (0, 0, 0.8), material="wood"))
    for s in (-1, 1):
        parts.append(box("wall", (5.6, 0.12, 2.4), (0, s * 1.9, 2.1), material="wood_dark"))
        parts.append(box("wall", (0.12, 3.8, 2.4), (s * 2.8, 0, 2.1), material="wood_dark"))
    parts.append(box("door", (1.0, 0.08, 1.9), (0.8, 1.97, 1.85), material="wood"))
    parts.append(prism_roof("roof", 5.6, 3.8, 1.6, (0, 0, 3.3), overhang=0.5, material="roof_thatch", thickness=0.2))
    for s in (-1, 1):
        parts.append(gable_wall("gable", 3.8, 1.6, (s * 2.8, 0, 3.3), rot_z=math.pi / 2, material="wood_dark"))
    # Netze zum Trocknen
    parts.append(beam("netpole", (-2.4, 2.5, 0.8), (-2.4, 2.5, 2.8), 0.08))
    parts.append(beam("netpole", (-0.4, 2.5, 0.8), (-0.4, 2.5, 2.8), 0.08))
    parts.append(box("net", (1.9, 0.02, 1.6), (-1.4, 2.5, 1.9), rot=(0.1, 0, 0), material="rope"))
    for i in range(3):
        parts.append(cyl("barrel", 0.3, 0.7, (1.8 + i * 0.1, -2.5 + i * 0.7, 1.23), material="wood", seg=10))
    return join(parts, "fish_hut")


def dock():
    parts = []
    for i in range(24):
        y = -7 + (i + 0.5) * 14 / 24
        parts.append(box("plank", (3.0, 0.55, 0.1), (0, y, 1.14), rot=(0, 0, (i % 3 - 1) * 0.01), material="wood"))
    for y in (-6.8, -3.4, 0, 3.4, 6.8):
        for s in (-1, 1):
            parts.append(cyl("pile", 0.16, 3.6, (s * 1.45, y, -0.6), material="wood_dark", seg=8))
    for s in (-1, 1):
        parts.append(beam("stringer", (s * 1.3, -7, 0.98), (s * 1.3, 7, 0.98), 0.22))
    parts.append(cyl("bollard", 0.14, 0.5, (1.2, 6.5, 1.45), material="wood_dark", seg=8))
    parts.append(tube("rope", [(1.2, 6.5, 1.5), (1.4, 6.9, 1.2), (1.6, 7.4, 0.4)], 0.03, material="rope"))
    return join(parts, "dock")


def watchpost():
    parts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(beam("leg", (sx * 1.8, sy * 1.8, -0.4), (sx * 1.8, sy * 1.8, 4.2), 0.26))
    parts.append(box("floor", (4.2, 4.2, 0.18), (0, 0, 3.0), material="wood"))
    for s in (-1, 1):
        parts.append(box("rail", (4.2, 0.08, 0.1), (0, s * 2.0, 3.9), material="wood_dark"))
        parts.append(box("rail", (0.08, 4.2, 0.1), (s * 2.0, 0, 3.9), material="wood_dark"))
    parts.append(box("canvas", (4.4, 4.4, 0.05), (0, 0, 4.3), rot=(0.06, 0, 0), material="cloth"))
    for s in (-1, 1):
        parts.append(beam("ladder", (s * 0.25, 2.3, 0), (s * 0.25, 1.9, 3.0), 0.06))
    for i in range(6):
        z = 0.4 + i * 0.45
        parts.append(beam("rung", (-0.25, 2.3 - z * 0.13, z), (0.25, 2.3 - z * 0.13, z), 0.05))
    return join(parts, "watchpost")


def shipwreck():
    parts = []
    # Rumpf aus Spanten, leicht gekippt und halb versunken
    ribs = 14
    for i in range(ribs):
        y = -9.5 + i * 19 / (ribs - 1)
        k = math.sin(math.pi * (i + 0.5) / ribs) ** 0.6
        half = 3.0 * k + 0.2
        pts = []
        for j in range(9):
            a = math.pi * j / 8
            pts.append((-math.cos(a) * half, y, 5.4 - math.sin(a) * 4.6 * (0.6 + 0.4 * k)))
        if i in (4, 9):
            pts = pts[:5]  # gebrochene Spanten
        parts.append(tube("rib", pts, 0.14, 5, material="wood_dark"))
    parts.append(tube("keel", [(0, -10.5, 2.2), (0, -9, 0.9), (0, 0, 0.6), (0, 9, 0.9), (0, 10.8, 3.0)], 0.25, 6, material="wood_dark"))
    # Beplankung auf einer Seite
    for row in range(5):
        z = 1.3 + row * 0.8
        span = 8.5 - row * 0.4 if row != 2 else 5.0
        for s in (1,):
            x = s * (2.2 + row * 0.18)
            parts.append(box("plank", (0.1, span * 2, 0.4), (x, -1.0 + row * 0.3, z), rot=(0, s * 0.35, 0), material="wood"))
    parts.append(box("deckpart", (4.0, 5.0, 0.14), (0.2, 5.5, 5.3), rot=(0.04, 0.1, 0), material="wood"))
    parts.append(beam("mast", (0.3, 2.0, 1.0), (1.2, 2.3, 8.5), 0.35))
    parts.append(beam("mastbroken", (1.5, 2.5, 0.4), (4.5, 8.5, 0.9), 0.3))
    parts.append(box("sail", (0.04, 3.2, 2.5), (1.0, 2.2, 5.8), rot=(0.2, 0.1, 0.3), material="cloth_white"))
    obj = join(parts, "shipwreck")
    obj.rotation_euler = (0, 0.22, 0)
    bake(obj)
    return obj


ASSETS = {
    "house_a": (house_a, 0.5), "house_b": (house_b, 0.5), "inn": (inn, 0.5), "smithy": (smithy, 0.5), "chapel": (chapel, 0.5),
    "vogthaus": (vogthaus, 0.5), "kontor": (kontor, 0.5), "stall": (stall, None), "well": (well, None), "palisade": (palisade, 0.5),
    "tower": (tower, 0.5), "mine_entrance": (mine_entrance, None), "mine_house": (mine_house, None), "fish_hut": (fish_hut, None),
    "dock": (dock, None), "watchpost": (watchpost, None), "shipwreck": (shipwreck, None),
}
