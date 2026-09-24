"""Durchgehende Spielfigur für das Skinning im Client (Modell „character“).

Alle Teile liegen in Rig-Koordinaten (Ruhepose, Körperbreite 1, Blick nach Rig +Z = Blender -Y).
Der Client bindet die Geometrie an die Gelenke des prozeduralen Rigs und berechnet die
Gewichte selbst (Abstand zu den Knochenstrecken). Teile:

  skin        Kopf mit Gesicht, Hals, Hände mit Fingern      (Material skin, eyewhite, iris)
  tunic       Hemd/Wams mit langen Ärmeln, Kragen, Falten     (body)
  trousers    Hose                                             (legs)
  boots       Stiefel mit Sohle und Schaftumschlag             (accent)
  belt        Gürtel mit Schnalle und Tasche, Ärmelbündchen    (accent)
  robe        Robe (nur Outfits mit robe)                      (body)
  hood        Kapuze mit Schulterkragen (Outfits mit hood)     (accent)
  plates      Schulterplatten + Brustpanzer (metal-Outfits)    (body)
  hair_0..5   Frisuren aus Strähnen (starr am Kopf)            (hair)
  beard_1..3  Bärte                                            (hair)
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector

from lib import apply_mods, bake, displace, join, lathe, mat, mesh_obj, smooth, tube, uvsphere


def B(x, y, z):
    """Rig-Koordinate → Blender."""
    return (x, -z, y)


def R(v):
    """Blender → Rig."""
    return (v[0], v[2], -v[1])


HEAD_C = (0.0, 1.835, 0.0)  # Mittelpunkt des Schädels (Kopfgelenk bei 1.73)


def skin_graph(name, verts, edges, radii, material, subsurf=2, root=0):
    """Organische Form aus einem Gerüst (Skin-Modifier + Unterteilung)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([B(*v) for v in verts], edges, [])
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.modifiers.new("skin", "SKIN")
    sv = me.skin_vertices[0].data
    for i, r in enumerate(radii):
        sv[i].radius = r if isinstance(r, tuple) else (r, r)
    sv[root].use_root = True
    if subsurf:
        o.modifiers.new("sub", "SUBSURF").levels = subsurf
    apply_mods(o)
    o.data.materials.clear()
    o.data.materials.append(mat(material))
    return o


def rig_vertices(o, fn):
    """Verformt die Punkte eines Objekts in Rig-Koordinaten: fn(x, y, z) -> (x, y, z)."""
    for v in o.data.vertices:
        x, y, z = R(v.co)
        nx, ny, nz = fn(x, y, z)
        v.co = Vector(B(nx, ny, nz))
    o.data.update()


def gauss(d2, s):
    return math.exp(-d2 / (2 * s * s))


# ---------------------------------------------------------------------------
# Kopf mit Gesicht
# ---------------------------------------------------------------------------

def head():
    cx, cy, cz = HEAD_C
    h = uvsphere("head", 1.0, B(0, 0, 0), material="skin", seg=48, rings=36)
    bake(h)

    def shape(x, y, z):
        # Einheitskugel → Schädel
        x, y, z = x * 0.101, y * 0.118, z * 0.114
        # Hinterkopf voller, Stirn etwas flacher
        if z < 0 and y > -0.02:
            z *= 1.08
        # Kiefer und Kinn: unten schmaler und nach vorn
        if y < -0.015:
            k = min(1.0, (-y - 0.015) / 0.09)
            x *= 1.0 - 0.34 * k
            z += 0.012 * k * (1 if z > 0 else -0.4)
            if z < 0:
                z *= 1.0 - 0.35 * k
        # Kinn betont
        z += 0.012 * gauss(x * x + (y + 0.098) ** 2, 0.022) * (1 if z > 0 else 0)
        # Wangenknochen
        for s in (-1, 1):
            d2 = (x - s * 0.058) ** 2 + (y + 0.005) ** 2 + (z - 0.07) ** 2
            f = gauss(d2, 0.018) * 0.007
            x += s * f
            z += f * 0.5
        front = z > 0.06
        if front:
            # Augenhöhlen
            for s in (-1, 1):
                d2 = (x - s * 0.036) ** 2 + (y - 0.018) ** 2
                z -= 0.013 * gauss(d2, 0.014)
            # Stirnwulst
            z += 0.006 * gauss((y - 0.04) ** 2, 0.008) * gauss(x * x, 0.05)
            # Nase: Rücken und Spitze
            nx = gauss(x * x, 0.0115)
            if -0.05 < y < 0.03:
                t = (0.03 - y) / 0.08
                prof = 0.007 + 0.03 * t ** 1.3
                if y < -0.035:
                    prof *= max(0.0, 1 - (-0.035 - y) / 0.015)
                z += prof * nx
            # Nasenflügel
            for s in (-1, 1):
                z += 0.006 * gauss((x - s * 0.014) ** 2 + (y + 0.038) ** 2, 0.006)
            # Lippen (oben, unten) und Mundspalte
            lx = gauss(x * x, 0.02)
            z += 0.007 * lx * gauss((y + 0.056) ** 2, 0.005)
            z += 0.008 * lx * gauss((y + 0.068) ** 2, 0.005)
            z -= 0.006 * gauss(x * x, 0.02) * gauss((y + 0.062) ** 2, 0.0015)
            # Philtrum
            z += 0.002 * gauss(x * x, 0.004) * gauss((y + 0.047) ** 2, 0.006)
        return cx + x, cy + y, cz + z

    rig_vertices(h, shape)
    parts = [h]
    # Ohren: flache, gebogene Muscheln
    for s in (-1, 1):
        ear = uvsphere("ear", 1.0, B(0, 0, 0), material="skin", seg=16, rings=12)
        bake(ear)

        def ear_shape(x, y, z, s=s):
            x, y, z = x * 0.012, y * 0.031, z * 0.019
            z += -0.006 * (x * s + 0.012) / 0.024  # Muschel zeigt nach vorn
            return cx + s * 0.099 + x, cy + 0.0 + y, cz - 0.008 + z

        rig_vertices(ear, ear_shape)
        parts.append(ear)
    # Oberfläche des verformten Kopfes abfragen (für Augen, Lider, Brauen)
    verts = [R(v.co) for v in h.data.vertices]

    def surf(px, py):
        best = None
        for (vx, vy, vz) in verts:
            if vz > cz and abs(vx - px) < 0.008 and abs(vy - py) < 0.008:
                best = vz if best is None else max(best, vz)
        return best if best is not None else cz + 0.1

    # Augen: Augapfel sitzt in der Höhle, Hornhaut schließt mit der Haut ab
    for s in (-1, 1):
        ex, ey = cx + s * 0.035, cy + 0.017
        sz = surf(ex, ey)
        ez = sz - 0.0085
        eye = uvsphere("eye", 0.0128, B(ex, ey, ez), material="eyewhite", seg=18, rings=14)
        iris = uvsphere("iris", 0.0064, B(ex, ey, ez + 0.0108), material="iris", seg=16, rings=8, scale=(1, 0.3, 1))
        pupil = uvsphere("pupil", 0.0028, B(ex, ey, ez + 0.0126), material="eye", seg=10, rings=6, scale=(1, 0.25, 1))
        top = surf(ex, ey + 0.012) + 0.0015
        bot = surf(ex, ey - 0.011) + 0.001
        lid = tube("lid", [B(ex - 0.015, ey + 0.002, ez + 0.004), B(ex, ey + 0.0115, top), B(ex + 0.015, ey + 0.002, ez + 0.004)], 0.0032, 6, material="skin")
        lid2 = tube("lid2", [B(ex - 0.014, ey - 0.003, ez + 0.004), B(ex, ey - 0.0105, bot), B(ex + 0.014, ey - 0.003, ez + 0.004)], 0.0022, 6, material="skin")
        parts += [eye, iris, pupil, lid, lid2]
    # Brauen (Haarfarbe) direkt auf der Stirn
    brows = []
    for s in (-1, 1):
        pts = []
        for bx, by in ((0.016, 0.034), (0.034, 0.04), (0.053, 0.034)):
            pts.append(B(cx + s * bx, cy + by, surf(cx + s * bx, cy + by) + 0.0025))
        brows.append(tube("brow", pts, 0.0038, 5, material="hair", r_end=0.0022))
    o = join(parts + brows, "head")
    smooth(o, 60)
    return o


def neck_and_hands():
    parts = []
    neck = skin_graph("neck", [(0, 1.57, -0.008), (0, 1.66, -0.004), (0, 1.76, -0.01)], [(0, 1), (1, 2)], [(0.068, 0.062), (0.06, 0.058), (0.056, 0.054)], "skin")
    parts.append(neck)
    for s in (-1, 1):
        x = s * 0.23
        # Handgelenk → Handteller → Fingeransätze → Finger (Handfläche zeigt zum Körper)
        v = [(x, 1.005, 0.0), (x, 0.965, 0.0), (x, 0.935, 0.0)]
        e = [(0, 1), (1, 2)]
        r = [(0.024, 0.02), (0.02, 0.036), (0.016, 0.034)]
        fz = [-0.018, -0.006, 0.006, 0.018]
        flen = [0.058, 0.07, 0.075, 0.065]
        for i, (z, L) in enumerate(zip(fz, flen)):
            base = len(v)
            v += [(x, 0.93, z), (x - s * 0.002, 0.93 - L * 0.45, z + 0.002), (x - s * 0.006, 0.93 - L, z + 0.004)]
            e += [(2, base), (base, base + 1), (base + 1, base + 2)]
            r += [0.0095, 0.0085, 0.0072]
        # Daumen
        base = len(v)
        v += [(x - s * 0.006, 0.975, 0.022), (x - s * 0.01, 0.95, 0.04), (x - s * 0.012, 0.925, 0.05)]
        e += [(1, base), (base, base + 1), (base + 1, base + 2)]
        r += [0.012, 0.01, 0.0085]
        hand = skin_graph("hand", v, e, r, "skin", subsurf=2)
        parts.append(hand)
    return parts


# ---------------------------------------------------------------------------
# Kleidung
# ---------------------------------------------------------------------------

def folds(o, strength=0.006, seed=1):
    bake(o)
    displace(o, strength=strength, size=0.05, seed=seed)


def tunic():
    # Rumpf mit Ärmeln: Saum → Taille → Brust → Schultern → Ellbogen → Bündchen
    v = [
        (0, 0.82, 0.0), (0, 0.95, 0.0), (0, 1.1, 0.005), (0, 1.3, 0.012), (0, 1.47, 0.0), (0, 1.585, -0.005),
    ]
    e = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5)]
    r = [(0.19, 0.15), (0.172, 0.125), (0.162, 0.118), (0.185, 0.128), (0.195, 0.12), (0.085, 0.075)]
    for s in (-1, 1):
        base = len(v)
        v += [(s * 0.16, 1.52, 0.0), (s * 0.225, 1.5, 0.0), (s * 0.235, 1.27, 0.0), (s * 0.232, 1.04, 0.004)]
        e += [(4, base), (base, base + 1), (base + 1, base + 2), (base + 2, base + 3)]
        r += [(0.07, 0.07), (0.066, 0.064), (0.054, 0.052), (0.048, 0.046)]
    o = skin_graph("tunic", v, e, r, "body", subsurf=2)
    # Falten: waagerechte Knitter in der Taille, senkrechte am Saum, Ellbogenfalten
    def crease(x, y, z):
        k = 0.0
        k += 0.004 * math.sin(y * 120 + x * 10) * gauss((y - 1.0) ** 2, 0.05)
        k += 0.005 * math.sin(math.atan2(z, x) * 14) * max(0.0, (0.95 - y) / 0.13)
        for s in (-1, 1):
            k += 0.003 * math.sin(y * 160) * gauss((x - s * 0.235) ** 2 + (y - 1.27) ** 2, 0.04)
        rr = math.hypot(x, z) or 1.0
        return x + x / rr * k, y, z + z / rr * k
    rig_vertices(o, crease)
    folds(o, 0.004, 3)
    # Kragen und Knopfleiste
    collar = lathe("collar", [(0.09, 1.57), (0.083, 1.615), (0.075, 1.635)], 24, "body")
    placket = tube("placket", [B(0, 1.56, 0.075), B(0, 1.3, 0.128), B(0, 1.02, 0.12)], 0.006, 5, material="accent")
    o = join([o, collar, placket], "tunic")
    smooth(o, 50)
    return o


def trousers():
    v = [(0, 0.97, 0.0), (0, 0.9, 0.0)]
    e = [(0, 1)]
    r = [(0.17, 0.125), (0.16, 0.12)]
    for s in (-1, 1):
        base = len(v)
        v += [(s * 0.095, 0.84, 0.0), (s * 0.1, 0.66, 0.004), (s * 0.1, 0.47, 0.012), (s * 0.1, 0.25, 0.0), (s * 0.1, 0.12, 0.0)]
        e += [(1, base), (base, base + 1), (base + 1, base + 2), (base + 2, base + 3), (base + 3, base + 4)]
        r += [(0.088, 0.09), (0.078, 0.08), (0.063, 0.065), (0.058, 0.06), (0.052, 0.052)]
    o = skin_graph("trousers", v, e, r, "legs", subsurf=2)

    def knee(x, y, z):
        k = 0.003 * math.sin(y * 140) * gauss((y - 0.47) ** 2, 0.05)
        return x, y, z + k

    rig_vertices(o, knee)
    folds(o, 0.004, 5)
    smooth(o, 50)
    return o


def boots():
    parts = []
    for s in (-1, 1):
        x = s * 0.1
        v = [(x, 0.4, 0.0), (x, 0.2, 0.0), (x, 0.07, -0.01), (x, 0.045, 0.06), (x, 0.035, 0.13)]
        e = [(0, 1), (1, 2), (2, 3), (3, 4)]
        r = [(0.07, 0.072), (0.064, 0.066), (0.058, 0.062), (0.05, 0.035), (0.045, 0.028)]
        b = skin_graph("boot", v, e, r, "accent", subsurf=2)
        # Sohle flach auf den Boden legen
        rig_vertices(b, lambda px, py, pz: (px, max(py, 0.004), pz))
        cuff = uvsphere("cuff", 1.0, B(x, 0.395, 0.0), material="accent", seg=20, rings=8, scale=(0.078, 0.078, 0.028))
        sole = uvsphere("sole", 1.0, B(x, 0.012, 0.05), material="legs", seg=16, rings=6, scale=(0.052, 0.13, 0.012))
        parts += [b, cuff, sole]
    o = join(parts, "boots")
    smooth(o, 50)
    return o


def belt():
    parts = []
    ring = uvsphere("belt", 1.0, B(0, 0.975, 0.0), material="accent", seg=32, rings=6, scale=(0.178, 0.132, 0.024))
    parts.append(ring)
    parts.append(uvsphere("buckle", 1.0, B(0, 0.975, 0.135), material="metal", seg=12, rings=6, scale=(0.022, 0.006, 0.02)))
    parts.append(uvsphere("pouch", 1.0, B(0.13, 0.93, 0.08), material="accent", seg=12, rings=8, scale=(0.04, 0.03, 0.05)))
    for s in (-1, 1):
        parts.append(uvsphere("cuff", 1.0, B(s * 0.232, 1.045, 0.004), material="accent", seg=16, rings=6, scale=(0.05, 0.048, 0.016)))
    o = join(parts, "belt")
    smooth(o, 40)
    return o


def robe():
    prof = [(0.16, 1.12), (0.19, 0.95), (0.22, 0.8), (0.27, 0.55), (0.31, 0.25), (0.34, 0.06)]
    o = lathe("robe", [(r, y) for r, y in prof], 40, "body")
    bake(o)
    # lathe ist um Blender-Z gebaut = Rig-Y: passt. Falten entlang des Umfangs, vorn leicht offen
    def fold(x, y, z):
        a = math.atan2(z, x)
        rr = math.hypot(x, z)
        k = 1 + 0.05 * math.sin(a * 11) * (1.02 - y) + 0.03 * math.sin(a * 23 + y * 6) * (1.02 - y)
        return x / rr * rr * k if rr else x, y, z * k * 0.82
    rig_vertices(o, fold)
    # Innenseite sichtbar machen
    o.data.flip_normals() if False else None
    folds(o, 0.004, 7)
    smooth(o, 50)
    return o


def hood():
    parts = []
    cx, cy, cz = HEAD_C
    shell = uvsphere("hood", 1.0, B(0, 0, 0), material="accent", seg=40, rings=28)
    bake(shell)

    def hood_shape(x, y, z):
        x, y, z = x * 0.138, y * 0.152, z * 0.142
        # spitz nach hinten oben auslaufend
        if y > 0 and z < 0:
            z -= 0.03 * (y / 0.152) * (-z / 0.142)
        return cx + x, cy + 0.012 + y, cz - 0.01 + z

    rig_vertices(shell, hood_shape)
    # Gesichtsöffnung ausschneiden
    bm = bmesh.new()
    bm.from_mesh(shell.data)
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        x, y, z = R(c)
        if z > cz + 0.035 and (y - cy) < 0.085 and abs(x - cx) < 0.095:
            kill.append(f)
        elif (y - cy) < -0.1:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(shell.data)
    bm.free()
    mod = shell.modifiers.new("dicke", "SOLIDIFY")
    mod.thickness = 0.008
    apply_mods(shell)
    parts.append(shell)
    # Gugel: Schulterkragen mit Falten
    cape = lathe("cape", [(0.1, 1.68), (0.17, 1.62), (0.24, 1.53), (0.28, 1.42), (0.285, 1.37)], 40, "accent")
    bake(cape)
    rig_vertices(cape, lambda x, y, z: (x * (1 + 0.04 * math.sin(math.atan2(z, x) * 12) * (1.66 - y) * 3), y, z * (1 + 0.04 * math.sin(math.atan2(z, x) * 12) * (1.66 - y) * 3)))
    parts.append(cape)
    o = join(parts, "hood")
    folds(o, 0.003, 9)
    smooth(o, 50)
    return o


def plates():
    parts = []
    for s in (-1, 1):
        p = uvsphere("pauldron", 1.0, B(s * 0.215, 1.54, 0.0), material="body", seg=24, rings=12, scale=(0.078, 0.07, 0.07))
        bake(p)
        rig_vertices(p, lambda x, y, z: (x, max(y, 1.49), z))
        parts.append(p)
        for i in range(3):
            band = uvsphere("lame", 1.0, B(s * 0.225, 1.5 - i * 0.035, 0.0), material="body", seg=20, rings=6, scale=(0.078 - i * 0.004, 0.012, 0.07))
            parts.append(band)
    cuirass = skin_graph("cuirass", [(0, 1.06, 0.004), (0, 1.2, 0.01), (0, 1.34, 0.018), (0, 1.47, 0.004)], [(0, 1), (1, 2), (2, 3)],
                         [(0.178, 0.132), (0.176, 0.13), (0.198, 0.142), (0.2, 0.13)], "body", subsurf=2)
    parts.append(cuirass)
    parts.append(tube("ridge", [B(0, 1.47, 0.132), B(0, 1.32, 0.162), B(0, 1.1, 0.14)], 0.005, 6, material="body"))
    for yy in (1.08, 1.13):
        parts.append(lathe("faulds", [(0.185, yy), (0.2, yy - 0.05)], 32, "body"))
    o = join(parts, "plates")
    smooth(o, 35)
    return o


# ---------------------------------------------------------------------------
# Haare und Bärte aus Strähnen
# ---------------------------------------------------------------------------

def scalp_point(theta, phi, lift=0.0):
    """Punkt auf der Schädeloberfläche (theta: um die Hochachse, phi: vom Scheitel abwärts)."""
    cx, cy, cz = HEAD_C
    sx, sy, sz = 0.106, 0.124, 0.122
    x = math.sin(phi) * math.sin(theta) * (sx + lift)
    z = math.sin(phi) * math.cos(theta) * (sz + lift)
    y = math.cos(phi) * (sy + lift)
    if z < 0:
        z *= 1.06
    return (cx + x, cy + y, cz + z)


def strand(points, width, name="strand"):
    """Flache, sich verjüngende Haarsträhne (Karte mit Dicke)."""
    return tube(name, [B(*p) for p in points], width, 4, material="hair", r_end=width * 0.25)


def hair_cap(depth=0.58, front=0.44):
    """Kopfhaut-Schale in Haarfarbe (verdeckt Lücken zwischen den Strähnen)."""
    cx, cy, cz = HEAD_C
    s = uvsphere("cap", 1.0, B(0, 0, 0), material="hair", seg=32, rings=20)
    bake(s)
    keep = []

    def cap_shape(x, y, z):
        phi = math.acos(max(-1.0, min(1.0, y)))
        th = math.atan2(x, z)
        lim = depth * math.pi if abs(th) > 1.0 else front * math.pi
        if phi > lim:
            phi = lim
        return scalp_point(th, phi, 0.0045)

    rig_vertices(s, cap_shape)
    keep.append(s)
    return keep


def hair_style(style, seed=3):
    rnd = random.Random(seed + style * 17)
    parts = []
    if style == 3:  # kahl
        return None
    if style in (0, 1, 4):  # kurz / mit Zopf / mit Knoten
        parts += hair_cap(0.5, 0.33)
        n = 900
        for i in range(n):
            th = rnd.uniform(-math.pi, math.pi)
            front = abs(th) < 1.0
            lim = (0.4 if front else 0.6) * math.pi
            phi0 = rnd.uniform(0.0, lim * 0.7)
            # vom Scheitel nach unten gekämmt, am Rand etwas über die Kopfhaut hinaus
            L = min(lim + 0.05, phi0 + rnd.uniform(0.25, 0.45)) - phi0
            pts = []
            for k in range(4):
                t = k / 3
                ph = phi0 + L * t
                pts.append(scalp_point(th + rnd.uniform(-0.02, 0.02) * t, ph, 0.0065 + 0.003 * math.sin(t * math.pi) - 0.004 * t * t))
            parts.append(strand(pts, rnd.uniform(0.0028, 0.0045)))
        if style == 1:  # Zopf
            for k in range(9):
                y = HEAD_C[1] - 0.05 - k * 0.028
                z = HEAD_C[2] - 0.125 - k * 0.006
                sgn = 1 if k % 2 else -1
                parts.append(uvsphere("braid", 1.0, B(0.006 * sgn, y, z), material="hair", seg=10, rings=8, scale=(0.022 - k * 0.001, 0.02 - k * 0.001, 0.018)))
            parts.append(uvsphere("tie", 1.0, B(0, HEAD_C[1] - 0.3, HEAD_C[2] - 0.18), material="accent", seg=10, rings=6, scale=(0.014, 0.014, 0.01)))
        if style == 4:  # Kriegerknoten
            bun_c = (HEAD_C[0], HEAD_C[1] + 0.105, HEAD_C[2] - 0.075)
            parts.append(uvsphere("bun", 1.0, B(*bun_c), material="hair", seg=16, rings=12, scale=(0.045, 0.04, 0.045)))
            for i in range(40):
                a = i / 40 * math.tau
                p0 = (bun_c[0] + math.cos(a) * 0.04, bun_c[1] + math.sin(a * 2) * 0.01, bun_c[2] + math.sin(a) * 0.04)
                p1 = (bun_c[0] + math.cos(a + 0.8) * 0.02, bun_c[1] + 0.035, bun_c[2] + math.sin(a + 0.8) * 0.02)
                parts.append(strand([p0, ((p0[0] + p1[0]) / 2, p0[1] + 0.03, (p0[2] + p1[2]) / 2), p1], 0.005))
    if style == 2:  # lang, bis auf die Schultern
        parts += hair_cap(0.6, 0.34)
        for i in range(900):
            th = rnd.uniform(-math.pi, math.pi)
            if abs(th) < 0.55:
                continue  # Gesicht frei
            pts = []
            root = scalp_point(th, rnd.uniform(0.05, 0.35), 0.006)
            side = scalp_point(th, 0.55 * math.pi, 0.02)
            end_y = rnd.uniform(1.5, 1.6)
            fall = (side[0] * 1.15, end_y, side[2] * 1.05 - 0.02)
            mid = scalp_point(th, 0.45 * math.pi, 0.014)
            pts = [root, mid, side, ((side[0] + fall[0]) / 2, (side[1] + fall[1]) / 2, (side[2] + fall[2]) / 2 - 0.01), fall]
            parts.append(strand(pts, rnd.uniform(0.0035, 0.006)))
    if style == 5:  # wild
        parts += hair_cap(0.55, 0.4)
        for i in range(260):
            th = rnd.uniform(-math.pi, math.pi)
            phi = rnd.uniform(0.0, 0.5 * math.pi if abs(th) > 1.0 else 0.35 * math.pi)
            root = scalp_point(th, phi, 0.004)
            out = Vector(root) - Vector(HEAD_C)
            out.normalize()
            tip = Vector(root) + out * rnd.uniform(0.03, 0.06) + Vector((rnd.uniform(-0.02, 0.02), rnd.uniform(-0.01, 0.03), rnd.uniform(-0.02, 0.02)))
            mid = (Vector(root) + tip) / 2 + out * 0.008
            parts.append(strand([root, tuple(mid), tuple(tip)], rnd.uniform(0.005, 0.008)))
    o = join(parts, f"hair_{style}")
    smooth(o, 60)
    return o


def beard(style, seed=5):
    rnd = random.Random(seed + style * 31)
    cx, cy, cz = HEAD_C
    parts = []

    def jaw_point(u, v, lift):
        # u: -1..1 von Ohr zu Ohr, v: 0 (Wange) .. 1 (Kinn unten)
        a = u * 1.25
        y = cy - 0.02 - v * 0.085
        rx = 0.1 * (1 - 0.32 * v) + lift
        rz = 0.112 * (1 - 0.05 * v) + lift
        return (cx + math.sin(a) * rx, y, cz + math.cos(a) * rz * (0.8 + 0.2 * v))

    if style == 1:  # kurzer Vollbart
        for i in range(360):
            u, v = rnd.uniform(-1, 1), rnd.uniform(0.1, 1.0)
            p0 = jaw_point(u, v, 0.002)
            p1 = jaw_point(u * 0.97, min(1.08, v + 0.08), 0.008)
            parts.append(strand([p0, p1], 0.0035))
        # Schnurrbart
        for i in range(60):
            u = rnd.uniform(-1, 1)
            p0 = (cx + u * 0.022, cy - 0.046, cz + 0.112)
            p1 = (cx + u * 0.03, cy - 0.054, cz + 0.114)
            parts.append(strand([p0, p1], 0.003))
    elif style == 2:  # langer Vollbart
        for i in range(420):
            u, v = rnd.uniform(-1, 1), rnd.uniform(0.1, 1.0)
            p0 = jaw_point(u, v, 0.002)
            L = 0.03 + 0.06 * (1 - abs(u)) * v
            p1 = (p0[0] * 0.9 + cx * 0.1, p0[1] - L * 0.6, p0[2] + 0.01)
            p2 = (p0[0] * 0.8 + cx * 0.2, p0[1] - L, p0[2] + 0.005)
            parts.append(strand([p0, p1, p2], 0.0045))
    elif style == 3:  # Kinnbart
        for i in range(120):
            u, v = rnd.uniform(-0.3, 0.3), rnd.uniform(0.6, 1.0)
            p0 = jaw_point(u, v, 0.002)
            p1 = (p0[0] * 0.8 + cx * 0.2, p0[1] - 0.035, p0[2] + 0.004)
            parts.append(strand([p0, p1], 0.004))
    if not parts:
        return None
    o = join(parts, f"beard_{style}")
    smooth(o, 60)
    return o


def character():
    objs = []
    skin = join([head()] + neck_and_hands(), "skin")
    smooth(skin, 60)
    objs.append(skin)
    for fn in (tunic, trousers, boots, belt, robe, hood, plates):
        objs.append(fn())
    for st in range(6):
        h = hair_style(st)
        if h:
            objs.append(h)
    for st in (1, 2, 3):
        b = beard(st)
        if b:
            objs.append(b)
    for o in objs:
        bake(o)
    return objs


ASSETS = {"character": (character, None)}
