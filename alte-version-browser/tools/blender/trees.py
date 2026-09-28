"""Verzweigte Bäume mit Zweigkarten (wie SpeedTree-Bäume in großen Spielen).

Stamm → Äste → Zweige als Röhren mit Rinde; an den Ästen sitzen Karten, auf denen die in
foliage_bake.py gebackenen Zweige liegen (Material „leafcard_<art>“). Jede Karte trägt eine
Punktfarbe:  R = Windstärke (0 am Stamm … 1 an den Spitzen), G = Verdeckung im Kroneninneren
(0 dunkel … 1 außen), B = Zufallswert für Farbvariation. Die Normalen der Karten sind zur
Kronenform hin gebogen (weiche, volumige Beleuchtung statt flacher Einzelkarten).

LOD1 (Mittelstrecke) wird separat gebaut: weniger, größere Karten, gröbere Äste.
"""
import math
import random

import bpy  # noqa: I001
import bmesh
from mathutils import Matrix, Vector

import lib


class TreeMesh:
    """Sammelt Rinden- und Kartengeometrie mit Punktfarben und eigenen Normalen."""

    def __init__(self, name, card_material, bark_material="bark"):
        self.name = name
        self.card_material = card_material
        self.bark_material = bark_material
        self.bark = bmesh.new()
        self.cards = bmesh.new()
        self.bark_col = self.bark.verts.layers.float_color.new("tree")
        self.card_col = self.cards.verts.layers.float_color.new("tree")
        self.bark_uv = self.bark.loops.layers.uv.new("UVMap")
        self.card_uv = self.cards.loops.layers.uv.new("UVMap")
        self.card_normals = {}  # Vert-Index → Normale

    def tube(self, pts, radii, seg, wind):
        """Röhre entlang einer Punktkette; wind je Punkt (Liste)."""
        rings = []
        n = len(pts)
        prev_a = None
        s_acc = 0.0
        for i, p in enumerate(pts):
            d = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            if prev_a is None:
                a = d.orthogonal().normalized()
            else:
                # Rahmen mitführen (kein Verdrillen)
                a = (prev_a - d * prev_a.dot(d)).normalized()
            prev_a = a
            b = d.cross(a).normalized()
            if i > 0:
                s_acc += (pts[i] - pts[i - 1]).length
            ring = []
            for k in range(seg):
                t = k / seg * 2 * math.pi
                v = self.bark.verts.new(p + (a * math.cos(t) + b * math.sin(t)) * radii[i])
                v[self.bark_col] = (wind[i], 1.0, 0.5, 1.0)
                ring.append((v, s_acc))
            rings.append(ring)
        # Rindentextur: ~0,8 m Umfang je Kachel, längs in Metern
        rep = max(1, round(2 * math.pi * max(radii) / 0.8))
        for i in range(n - 1):
            for k in range(seg):
                k1 = (k + 1) % seg
                f = self.bark.faces.new((rings[i][k][0], rings[i][k1][0], rings[i + 1][k1][0], rings[i + 1][k][0]))
                for loop, (u, vv) in zip(f.loops, ((k, rings[i][k][1]), (k + 1, rings[i][k1][1]), (k + 1, rings[i + 1][k1][1]), (k, rings[i + 1][k][1]))):
                    loop[self.bark_uv].uv = (u / seg * rep, vv / 1.2)

    def card(self, base, up, normal, size, width, wind, ao, tint, bend_normal):
        """Karte: unten Mitte bei base, wächst entlang up; Normale zur Kronenform gebogen."""
        up = up.normalized()
        side = normal.cross(up).normalized()
        if side.length < 1e-4:
            side = up.orthogonal().normalized()
        corners = [base - side * width * 0.5, base + side * width * 0.5, base + side * width * 0.5 + up * size, base - side * width * 0.5 + up * size]
        uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
        vs = []
        for c in corners:
            v = self.cards.verts.new(c)
            v[self.card_col] = (wind, ao, tint, 1.0)
            vs.append(v)
        f = self.cards.faces.new(vs)
        for loop, uv in zip(f.loops, uvs):
            loop[self.card_uv].uv = uv
        face_n = side.cross(up).normalized()
        if face_n.dot(normal) < 0:
            face_n = -face_n
        for v, c in zip(vs, corners):
            self.card_normals[v] = (face_n * 0.35 + bend_normal(c) * 0.65).normalized()

    def finish(self):
        objs = []
        me = bpy.data.meshes.new(self.name + "_bark")
        self.bark.to_mesh(me)
        self.bark.free()
        o = bpy.data.objects.new(self.name + "_bark", me)
        bpy.context.scene.collection.objects.link(o)
        me.materials.append(lib.mat(self.bark_material))
        for p in me.polygons:
            p.use_smooth = True
        _activate_color(me)
        objs.append(o)
        # Karten
        verts = list(self.cards.verts)
        normals_by_index = {}
        self.cards.verts.index_update()
        for v in verts:
            normals_by_index[v.index] = self.card_normals[v]
        me2 = bpy.data.meshes.new(self.name + "_cards")
        self.cards.to_mesh(me2)
        self.cards.free()
        o2 = bpy.data.objects.new(self.name + "_cards", me2)
        bpy.context.scene.collection.objects.link(o2)
        me2.materials.append(lib.mat(self.card_material))
        loop_normals = [normals_by_index[lp.vertex_index] for lp in me2.loops]
        me2.normals_split_custom_set(loop_normals)
        _activate_color(me2)
        objs.append(o2)
        return objs


def _activate_color(me):
    attr = me.color_attributes.get("tree")
    if attr:
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = me.color_attributes.find("tree")


def curve_pts(p0, d, L, droop, rise, n):
    """Ast: zuerst nach außen, dann hängend, Spitze leicht aufwärts."""
    pts = []
    for i in range(n + 1):
        t = i / n
        pts.append(p0 + d * (L * t) + Vector((0, 0, -droop * L * t * t + rise * L * t ** 3)))
    return pts


# ---------------------------------------------------------------------------
# Fichte (Weltobjekt „tree_pine“): hoher, schlanker Kegel aus Astquirlen
# ---------------------------------------------------------------------------

def spruce(lod, seed=7):
    rnd = random.Random(seed)
    H = 13.0
    tm = TreeMesh("tree_pine", "leafcard_spruce")
    # Stamm mit leichter Krümmung
    n = 12 if lod == 0 else 6
    trunk = [Vector((math.sin(i * 0.7) * 0.05 * i / n, math.cos(i * 0.5) * 0.04 * i / n, (H - 0.9) * i / n)) for i in range(n + 1)]
    radii = [0.3 * (1 - i / n) ** 0.9 + 0.025 for i in range(n + 1)]
    trunk[0].z = -0.3  # etwas in den Boden
    tm.tube(trunk, radii, 8 if lod == 0 else 5, [0.0] * (n + 1))
    # Wurzelanläufe
    if lod == 0:
        for k in range(5):
            a = k / 5 * 2 * math.pi + rnd.uniform(-0.3, 0.3)
            d = Vector((math.cos(a), math.sin(a), 0))
            tm.tube([Vector((0, 0, 0.6)) + d * 0.12, d * 0.45 + Vector((0, 0, 0.12)), d * 0.8 + Vector((0, 0, -0.1))], [0.14, 0.09, 0.03], 5, [0, 0, 0])

    def axis_at(z):
        return trunk[min(n, max(0, int(z / H * n)))]

    def bend(c):
        a = axis_at(c.z)
        radial = Vector((c.x - a.x, c.y - a.y, 0))
        if radial.length < 1e-3:
            return Vector((0, 0, 1))
        return (radial.normalized() * 0.85 + Vector((0, 0, 0.45))).normalized()

    z = 2.0
    whorl = 0
    spacing = 0.42 if lod == 0 else 0.6
    while z < H - 0.6:
        rel = (z - 2.0) / (H - 2.6)
        count = 5 if lod == 0 else 4
        L = 0.45 + 3.1 * (1 - rel) ** 1.05
        for b in range(count):
            az = whorl * 2.39996 + b / count * 2 * math.pi + rnd.uniform(-0.25, 0.25)
            d = Vector((math.cos(az), math.sin(az), 0))
            elev = math.radians(rnd.uniform(-8, 6) + rel * 22)
            d = (d * math.cos(elev) + Vector((0, 0, math.sin(elev)))).normalized()
            base = axis_at(z) + Vector((d.x, d.y, 0)) * radii[min(n, int(z / H * n))] * 0.8 + Vector((0, 0, z - axis_at(z).z))
            Lb = L * rnd.uniform(0.85, 1.1)
            droop = 0.32 * (1 - rel) + 0.06
            segs = 3 if lod == 0 else 2
            pts = curve_pts(base, d, Lb, droop, 0.12, segs)
            r0 = 0.018 + 0.028 * Lb / 3.5
            # Äste liegen fast ganz im Nadelwerk: dreikantig genügt, kurze Äste ohne Mittelstück
            bs = segs if Lb > 1.2 else 1
            bpts = pts if bs == segs else [pts[0], pts[-1]]
            tm.tube(bpts, [r0 * (1 - i / max(1, bs) * 0.8) for i in range(bs + 1)], 3, [0.1 + 0.5 * i / max(1, bs) for i in range(bs + 1)])
            # Karten entlang des Astes: flach (Zweigfläche) + steiler (Vorhang, Tiefe von der Seite)
            step = 0.6 if lod == 0 else 1.0
            t = 0.12
            while t <= 1.0:
                i0 = min(segs - 1, int(t * segs))
                p = pts[i0].lerp(pts[i0 + 1], t * segs - i0)
                tangent = (pts[i0 + 1] - pts[i0]).normalized()
                size = (1.2 if lod == 0 else 1.6) * (0.75 + 0.35 * min(1.0, Lb / 3.0)) * rnd.uniform(0.85, 1.15)
                wind = 0.35 + 0.65 * t
                ao = min(1.0, 0.25 + 0.75 * t) * (0.75 + 0.25 * rel)
                # Außen zusätzlich eine steilere Karte (Vorhang, Tiefe von der Seite); innen verdeckt
                rolls = (rnd.uniform(-0.35, 0.35),) if lod or t < 0.4 else (rnd.uniform(-0.35, 0.35), rnd.uniform(0.9, 1.3) * (1 if rnd.random() < 0.5 else -1))
                for roll in rolls:
                    nrm = Matrix.Rotation(roll, 3, tangent) @ Vector((0, 0, 1))
                    up = (tangent + Vector((0, 0, -0.15))).normalized()
                    tm.card(p - up * size * 0.15, up, nrm, size, size, wind, ao, rnd.random(), bend)
                t += step / max(Lb, 0.5)
        z += spacing * rnd.uniform(0.85, 1.15)
        whorl += 1
    # Wipfel: aufrechte Karten rund um die Spitze
    top = trunk[-1]
    for k in range(8 if lod == 0 else 4):
        a = k / 8 * 2 * math.pi
        nrm = Vector((math.cos(a), math.sin(a), 0))
        tm.card(top + Vector((0, 0, -1.6 + (k % 2) * 0.5)), Vector((0, 0, 1)) + nrm * 0.12, nrm, 1.9 - (k % 2) * 0.4, 1.0, 1.0, 1.0, rnd.random(), bend)
    return tm.finish()


# ---------------------------------------------------------------------------
# Eiche: kurzer, kräftiger Stamm, der sich in knorrige Hauptäste teilt; breite Krone
# ---------------------------------------------------------------------------

def oak(lod, seed=21):
    rnd = random.Random(seed)
    tm = TreeMesh("tree_oak", "leafcard_oak")
    crown_c = Vector((0, 0, 6.2))

    def bend(c):
        v = c - crown_c
        v.z *= 1.4
        return v.normalized() if v.length > 1e-3 else Vector((0, 0, 1))

    tips = []

    def grow(p, d, L, r, depth, wind0):
        segs = (3 if depth < 2 else 2) if lod == 0 else 2
        pts = [p]
        dd = d.copy()
        for i in range(segs):
            # knorriger Verlauf
            dd = (dd + Vector((rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25), rnd.uniform(-0.1, 0.2)))).normalized()
            pts.append(pts[-1] + dd * (L / segs))
        radii = [r * (1 - 0.35 * i / segs) for i in range(segs + 1)]
        winds = [min(1.0, wind0 + 0.25 * i / segs) for i in range(segs + 1)]
        tm.tube(pts, radii, max(3, 8 - depth * 2) if lod == 0 else max(3, 5 - depth * 2), winds)
        end = pts[-1]
        max_depth = 3 if lod == 0 else 2
        if depth >= max_depth or r < 0.035:
            tips.append((end, dd, winds[-1]))
            return
        kids = rnd.choice((2, 3, 3))
        for k in range(kids):
            ang = math.radians(rnd.uniform(25, 50))
            az = k / kids * 2 * math.pi + rnd.uniform(-0.6, 0.6)
            perp = dd.orthogonal().normalized()
            perp = Matrix.Rotation(az, 3, dd) @ perp
            nd = (dd * math.cos(ang) + perp * math.sin(ang)).normalized()
            # Äste streben nach außen und oben (Licht)
            out = Vector((end.x, end.y, 0))
            if out.length > 0.1:
                nd = (nd + out.normalized() * 0.3 + Vector((0, 0, 0.15))).normalized()
            grow(end, nd, L * rnd.uniform(0.62, 0.78), r * 0.62, depth + 1, winds[-1] + 0.1)
        # Kleine Zweige entlang des Astes tragen ebenfalls Laub
        if depth >= 1:
            tips.append((pts[segs // 2 + 1], dd, winds[segs // 2 + 1]))

    trunk = [Vector((0, 0, -0.3)), Vector((0.05, 0.02, 1.2)), Vector((0.02, -0.06, 2.4)), Vector((-0.06, 0.03, 3.2)), Vector((-0.04, 0.05, 3.75))]
    tm.tube(trunk, [0.52, 0.44, 0.4, 0.34, 0.18], 12 if lod == 0 else 7, [0, 0, 0.02, 0.05, 0.08])
    if lod == 0:
        for k in range(6):
            a = k / 6 * 2 * math.pi + rnd.uniform(-0.3, 0.3)
            d = Vector((math.cos(a), math.sin(a), 0))
            tm.tube([Vector((0, 0, 0.8)) + d * 0.2, d * 0.62 + Vector((0, 0, 0.15)), d * 1.1 + Vector((0, 0, -0.12))], [0.22, 0.13, 0.04], 5, [0, 0, 0])
    limbs = 4
    for k in range(limbs):
        az = k / limbs * 2 * math.pi + rnd.uniform(-0.4, 0.4)
        d = Vector((math.cos(az) * 0.62, math.sin(az) * 0.62, 0.78)).normalized()
        # Hauptäste beginnen im Stamm (keine sichtbare Nahtstelle)
        start = Vector((trunk[3].x, trunk[3].y, 2.75 + k * 0.18)) + Vector((math.cos(az), math.sin(az), 0)) * 0.12
        grow(start, d, rnd.uniform(2.8, 3.4), 0.25, 0, 0.1)
    # Kronenmitte auffüllen: Laubbüschel auf einer Ellipsoidschale um die Krone
    fill = 60 if lod == 0 else 18
    for j in range(fill):
        u, v = rnd.random(), rnd.random()
        th, ph = 2 * math.pi * u, math.acos(2 * v - 1)
        dirv = Vector((math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th), math.cos(ph) * 0.8 + 0.1))
        p = crown_c + Vector((dirv.x * 3.4, dirv.y * 3.4, dirv.z * 2.6)) * rnd.uniform(0.55, 0.95)
        tips.append((p, dirv.normalized(), 0.8))
    # Laub an den Spitzen: Büschel aus Karten, nach außen gerichtet
    per_tip = 7 if lod == 0 else 3
    size0 = 1.35 if lod == 0 else 2.2
    for (p, d, w) in tips:
        for j in range(per_tip):
            out = (bend(p) * 0.6 + d * 0.4 + Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), rnd.uniform(-0.3, 0.5)))).normalized()
            nrm = out.orthogonal().normalized()
            nrm = Matrix.Rotation(rnd.uniform(0, 2 * math.pi), 3, out) @ nrm
            size = size0 * rnd.uniform(0.8, 1.2)
            base = p - out * size * 0.2 + Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(-0.2, 0.2)))
            dist = (base - crown_c).length / 4.2
            ao = max(0.15, min(1.0, dist ** 1.3))
            tm.card(base, out, nrm, size, size, min(1.0, w + 0.3), ao, rnd.random(), bend)
    return tm.finish()


# ---------------------------------------------------------------------------
# Haselbusch
# ---------------------------------------------------------------------------

def hazel(lod, seed=31):
    rnd = random.Random(seed)
    tm = TreeMesh("bush", "leafcard_bush")
    c = Vector((0, 0, 1.1))

    def bend(p):
        v = p - c
        return v.normalized() if v.length > 1e-3 else Vector((0, 0, 1))

    stems = 8 if lod == 0 else 5
    for k in range(stems):
        a = k / stems * 2 * math.pi + rnd.uniform(-0.3, 0.3)
        lean = rnd.uniform(0.25, 0.5)
        d = Vector((math.cos(a) * lean, math.sin(a) * lean, 1)).normalized()
        L = rnd.uniform(1.8, 2.5)
        pts = curve_pts(Vector((math.cos(a) * 0.08, math.sin(a) * 0.08, -0.1)), d, L, -0.05, 0.0, 3)
        tm.tube(pts, [0.035, 0.028, 0.02, 0.012], 5 if lod == 0 else 3, [0.05, 0.3, 0.6, 0.9])
        n_cards = 7 if lod == 0 else 3
        for j in range(n_cards):
            t = 0.3 + 0.7 * j / max(1, n_cards - 1)
            p = pts[0].lerp(pts[-1], t)
            out = (bend(p) + Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), rnd.uniform(0, 0.6)))).normalized()
            nrm = Matrix.Rotation(rnd.uniform(0, 2 * math.pi), 3, out) @ out.orthogonal().normalized()
            size = (1.0 if lod == 0 else 1.5) * rnd.uniform(0.8, 1.2)
            tm.card(p - out * size * 0.2, out, nrm, size, size, 0.4 + 0.6 * t, 0.35 + 0.65 * t, rnd.random(), bend)
    return tm.finish()


# ---------------------------------------------------------------------------
# Toter Baum: verzweigtes, kahles Geäst
# ---------------------------------------------------------------------------

def dead(lod, seed=41):
    rnd = random.Random(seed)
    tm = TreeMesh("tree_dead", "leafcard_oak")

    def grow(p, d, L, r, depth):
        segs = 3 if lod == 0 else 2
        pts = [p]
        dd = d.copy()
        for i in range(segs):
            dd = (dd + Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.3, 0.3), rnd.uniform(-0.15, 0.1)))).normalized()
            pts.append(pts[-1] + dd * (L / segs))
        tm.tube(pts, [r * (1 - 0.4 * i / segs) for i in range(segs + 1)], max(3, 8 - depth * 2) if lod == 0 else 3, [0.05 * depth] * (segs + 1))
        if depth >= (3 if lod == 0 else 2) or r < 0.03:
            return
        for k in range(rnd.choice((1, 2, 2, 3))):
            perp = Matrix.Rotation(rnd.uniform(0, 2 * math.pi), 3, dd) @ dd.orthogonal().normalized()
            ang = math.radians(rnd.uniform(25, 60))
            grow(pts[-1] if k == 0 else pts[rnd.randint(1, segs)], (dd * math.cos(ang) + perp * math.sin(ang)).normalized(), L * 0.65, r * 0.6, depth + 1)

    trunk = [Vector((0, 0, -0.3)), Vector((0.1, 0.05, 2.0)), Vector((0.25, -0.05, 3.8)), Vector((0.2, 0.1, 5.4)), Vector((0.24, 0.14, 6.0))]
    tm.tube(trunk, [0.38, 0.3, 0.22, 0.1, 0.02], 10 if lod == 0 else 6, [0, 0, 0, 0, 0.05])
    for k in range(4):
        z = 2.2 + k * 0.8
        az = k * 2.4 + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(az), math.sin(az), 0.5)).normalized()
        grow(Vector((0.1 + 0.03 * k, 0, z)), d, rnd.uniform(1.4, 2.2), 0.1, 1)
    objs = tm.finish()
    # Keine Karten: das (leere) Kartenobjekt entfernen
    bpy.data.objects.remove(objs[1])
    return objs[:1]


def build(fn):
    def run():
        lod0 = fn(0)
        lod1 = fn(1)
        for o in lod1:
            o.name = o.name + "_lod1"
        return {"lod0": lod0, "lod1": lod1}
    return run


ASSETS = {
    "tree_pine": (build(spruce), None),
    "tree_oak": (build(oak), None),
    "bush": (build(hazel), None),
    "tree_dead": (build(dead), None),
}
