"""Blattwerk-Atlanten: modellierte Zweige, orthografisch gerendert (Cycles).

Wie bei SpeedTree & Co.: Ein Zweig mit echten Blatt- bzw. Nadelformen wird einmal von vorn
gerendert; das Bild (Farbe + Transparenz) und seine Normalen landen auf Karten, die an den
Zweigenden der Baummodelle sitzen.

Ausgabe (apps/client/public/assets/textures):
  foliage_<art>_color.webp   RGB = Grundfarbe (sRGB), A = Deckung
  foliage_<art>_normal.webp  Normalen im Kartenraum (x rechts, y oben, z zur Kamera)

Arten: oak (Eichenzweig), spruce (Fichtenzweig), pine (Kiefernbüschel), bush (Hasel),
       grass (Grasbüschel von der Seite), dry (trockene Halme + Blüten).

  /opt/bpyenv/bin/python tools/blender/foliage_bake.py [art ...]
"""
import math
import os
import random
import sys

import bpy  # noqa: I001
import bmesh
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("PZ_TEX_OUT", os.path.join(HERE, "..", "..", "apps", "client", "public", "assets", "textures"))
SIZE = int(os.environ.get("PZ_FOLIAGE_SIZE", "1024"))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------------------------------------------------------------------------
# Materialien: jeder Teil trägt eine Punktfarbe (Grundton) und UV (u quer, v längs)
# ---------------------------------------------------------------------------

def leaf_material(name, vein=0.12, edge_dark=0.25, gloss=0.0):
    """Blattoberfläche: Grundton je Blatt, hellere Mittelrippe, Seitenadern, dunklerer Rand."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "tone"
    uv = nt.nodes.new("ShaderNodeUVMap")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(uv.outputs[0], sep.inputs[0])
    # |u| (0 Mitte .. 1 Rand)
    au = nt.nodes.new("ShaderNodeMath"); au.operation = "ABSOLUTE"
    nt.links.new(sep.outputs[0], au.inputs[0])
    # Mittelrippe
    rib = nt.nodes.new("ShaderNodeMath"); rib.operation = "LESS_THAN"; rib.inputs[1].default_value = 0.07
    nt.links.new(au.outputs[0], rib.inputs[0])
    # Seitenadern: fract(v*9 - |u|*2.2) nahe 0
    v9 = nt.nodes.new("ShaderNodeMath"); v9.operation = "MULTIPLY"; v9.inputs[1].default_value = 9.0
    nt.links.new(sep.outputs[1], v9.inputs[0])
    u2 = nt.nodes.new("ShaderNodeMath"); u2.operation = "MULTIPLY"; u2.inputs[1].default_value = 2.2
    nt.links.new(au.outputs[0], u2.inputs[0])
    sub = nt.nodes.new("ShaderNodeMath"); sub.operation = "SUBTRACT"
    nt.links.new(v9.outputs[0], sub.inputs[0]); nt.links.new(u2.outputs[0], sub.inputs[1])
    fr = nt.nodes.new("ShaderNodeMath"); fr.operation = "FRACT"
    nt.links.new(sub.outputs[0], fr.inputs[0])
    vl = nt.nodes.new("ShaderNodeMath"); vl.operation = "LESS_THAN"; vl.inputs[1].default_value = 0.07
    nt.links.new(fr.outputs[0], vl.inputs[0])
    veins = nt.nodes.new("ShaderNodeMath"); veins.operation = "MAXIMUM"
    nt.links.new(rib.outputs[0], veins.inputs[0]); nt.links.new(vl.outputs[0], veins.inputs[1])
    # Feine Fleckung
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 60.0
    noise.inputs["Detail"].default_value = 4.0
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    nm = nt.nodes.new("ShaderNodeMapRange")
    nm.inputs[1].default_value = 0.3; nm.inputs[2].default_value = 0.7
    nm.inputs[3].default_value = 0.86; nm.inputs[4].default_value = 1.1
    nt.links.new(noise.outputs[0], nm.inputs[0])
    base = nt.nodes.new("ShaderNodeMixRGB"); base.blend_type = "MULTIPLY"; base.inputs[0].default_value = 1.0
    nt.links.new(attr.outputs["Color"], base.inputs[1])
    nt.links.new(nm.outputs[0], base.inputs[2])
    # Adern heller
    vein_col = nt.nodes.new("ShaderNodeMixRGB"); vein_col.blend_type = "SCREEN"
    vein_col.inputs[2].default_value = (0.35, 0.4, 0.2, 1)
    vfac = nt.nodes.new("ShaderNodeMath"); vfac.operation = "MULTIPLY"; vfac.inputs[1].default_value = vein
    nt.links.new(veins.outputs[0], vfac.inputs[0])
    nt.links.new(vfac.outputs[0], vein_col.inputs[0])
    nt.links.new(base.outputs[0], vein_col.inputs[1])
    # Rand dunkler/bräunlicher
    edge = nt.nodes.new("ShaderNodeMapRange")
    edge.inputs[1].default_value = 0.7; edge.inputs[2].default_value = 1.0
    edge.inputs[3].default_value = 0.0; edge.inputs[4].default_value = edge_dark
    nt.links.new(au.outputs[0], edge.inputs[0])
    edge_col = nt.nodes.new("ShaderNodeMixRGB"); edge_col.blend_type = "MIX"
    edge_col.inputs[2].default_value = (0.09, 0.08, 0.03, 1)
    nt.links.new(edge.outputs[0], edge_col.inputs[0])
    nt.links.new(vein_col.outputs[0], edge_col.inputs[1])
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(edge_col.outputs[0], em.inputs[0])
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def flat_material(name):
    """Nur Punktfarbe (Zweige, Halme)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "tone"
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 120.0
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    nm = nt.nodes.new("ShaderNodeMapRange")
    nm.inputs[1].default_value = 0.3; nm.inputs[2].default_value = 0.7
    nm.inputs[3].default_value = 0.85; nm.inputs[4].default_value = 1.12
    nt.links.new(noise.outputs[0], nm.inputs[0])
    mul = nt.nodes.new("ShaderNodeMixRGB"); mul.blend_type = "MULTIPLY"; mul.inputs[0].default_value = 1.0
    nt.links.new(attr.outputs["Color"], mul.inputs[1])
    nt.links.new(nm.outputs[0], mul.inputs[2])
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(mul.outputs[0], em.inputs[0])
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def normal_material():
    """Normale im Kameraraum als Farbe (x,y,z → 0..1)."""
    m = bpy.data.materials.new("normal_pass")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    vt = nt.nodes.new("ShaderNodeVectorTransform")
    vt.vector_type = "NORMAL"; vt.convert_from = "WORLD"; vt.convert_to = "CAMERA"
    nt.links.new(geo.outputs["Normal"], vt.inputs[0])
    # Rückseiten zur Kamera drehen (Karten werden beidseitig gezeichnet)
    back = nt.nodes.new("ShaderNodeMath"); back.operation = "MULTIPLY_ADD"
    back.inputs[1].default_value = -2.0; back.inputs[2].default_value = 1.0
    nt.links.new(geo.outputs["Backfacing"], back.inputs[0])
    flip = nt.nodes.new("ShaderNodeVectorMath"); flip.operation = "SCALE"
    nt.links.new(vt.outputs[0], flip.inputs[0]); nt.links.new(back.outputs[0], flip.inputs["Scale"])
    # Blender-Kameraraum: z zeigt von der Kamera weg → für den Kartenraum umdrehen
    inv = nt.nodes.new("ShaderNodeVectorMath"); inv.operation = "MULTIPLY"
    inv.inputs[1].default_value = (1.0, 1.0, -1.0)
    nt.links.new(flip.outputs[0], inv.inputs[0])
    enc = nt.nodes.new("ShaderNodeVectorMath"); enc.operation = "MULTIPLY_ADD"
    enc.inputs[1].default_value = (0.5, 0.5, 0.5); enc.inputs[2].default_value = (0.5, 0.5, 0.5)
    nt.links.new(inv.outputs[0], enc.inputs[0])
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(enc.outputs[0], em.inputs[0])
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


# ---------------------------------------------------------------------------
# Geometrie-Bausteine (ein bmesh je Art, Punktfarbe "tone", UV)
# ---------------------------------------------------------------------------

class Builder:
    def __init__(self):
        self.bm = bmesh.new()
        self.tone = self.bm.verts.layers.float_color.new("tone")
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mat_index = 0

    def quad_strip(self, left, right, uvs_l, uvs_r, color, mat):
        """Streifen aus zwei Punktreihen (links/rechts) mit UVs."""
        vl = [self.bm.verts.new(p) for p in left]
        vr = [self.bm.verts.new(p) for p in right]
        for v in vl + vr:
            v[self.tone] = color
        for i in range(len(vl) - 1):
            f = self.bm.faces.new((vl[i], vr[i], vr[i + 1], vl[i + 1]))
            f.material_index = mat
            for loop, uv in zip(f.loops, (uvs_l[i], uvs_r[i], uvs_r[i + 1], uvs_l[i + 1])):
                loop[self.uv].uv = uv

    def tube(self, pts, r0, r1, color, mat, seg=5):
        """Dünner Zylinder entlang einer Punktkette (Zweige, Stiele)."""
        rings = []
        n = len(pts)
        for i, p in enumerate(pts):
            p = Vector(p)
            d = (Vector(pts[min(i + 1, n - 1)]) - Vector(pts[max(i - 1, 0)])).normalized()
            a = d.orthogonal().normalized()
            b = d.cross(a).normalized()
            r = r0 + (r1 - r0) * i / max(1, n - 1)
            ring = []
            for k in range(seg):
                t = k / seg * 2 * math.pi
                v = self.bm.verts.new(p + (a * math.cos(t) + b * math.sin(t)) * r)
                v[self.tone] = color
                ring.append(v)
            rings.append(ring)
        for i in range(n - 1):
            for k in range(seg):
                f = self.bm.faces.new((rings[i][k], rings[i][(k + 1) % seg], rings[i + 1][(k + 1) % seg], rings[i + 1][k]))
                f.material_index = mat
                for loop in f.loops:
                    loop[self.uv].uv = (0.0, 0.5)

    def finish(self, name, materials):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        for m in materials:
            me.materials.append(m)
        for p in me.polygons:
            p.use_smooth = True
        return o


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def leaf(bld, base, direction, length, width, rnd, shape, color, up=Vector((0, 0, 1)), fold=0.25, curl=0.15, mat=1):
    """Ein Blatt mit Stiel: Umriss aus shape(t) (halbe Breite 0..1), V-förmig gefaltet, gewölbt."""
    d = Vector(direction).normalized()
    side = d.cross(up).normalized()
    if side.length < 0.1:
        side = Vector((1, 0, 0))
    nrm = side.cross(d).normalized()
    stalk = length * 0.12
    p0 = Vector(base)
    bld.tube([p0, p0 + d * stalk], width * 0.05, width * 0.04, (0.2, 0.22, 0.08, 1), 0, seg=3)
    start = p0 + d * stalk
    steps = 36
    left, right, ul, ur = [], [], [], []
    for i in range(steps + 1):
        t = i / steps
        w = shape(t) * width
        # Wölbung entlang der Länge und Faltung quer
        lift = math.sin(t * math.pi) * curl * length - t * t * curl * length * 0.6
        c = start + d * (t * length) + nrm * lift
        left.append(c - side * w + nrm * (w * fold))
        right.append(c + side * w + nrm * (w * fold))
        ul.append((-1.0, t))
        ur.append((1.0, t))
    # Mittelrippe als eigene Reihe: zwei Streifen (links → Mitte, Mitte → rechts)
    mid = [start + d * (i / steps * length) + nrm * (math.sin(i / steps * math.pi) * curl * length - (i / steps) ** 2 * curl * length * 0.6) for i in range(steps + 1)]
    um = [(0.0, i / steps) for i in range(steps + 1)]
    bld.quad_strip(left, mid, ul, um, color, mat)
    bld.quad_strip(mid, right, um, ur, color, mat)


def oak_shape(t):
    # Eichenblatt: verkehrt eiförmig (breiteste Stelle im oberen Drittel), 4–5 runde Lappen je
    # Seite mit tiefen, runden Buchten, kurzer Keil am Ansatz, runde Spitze
    body = math.sin(math.pi * min(1.0, t ** 0.8)) ** 0.8 * (0.5 + 0.55 * t)
    ph = t * 4.5 * 2 * math.pi
    lobe = 0.5 + 0.5 * math.cos(ph)
    lobes = 0.5 + 0.5 * lobe ** 0.45
    return max(0.015, body * lobes * 0.6)


def hazel_shape(t):
    # Rundlich-herzförmig mit feiner Zähnung
    body = math.sin(math.pi * min(1.0, t ** 0.62))
    teeth = 1.0 + 0.06 * math.sin(t * 60.0)
    return max(0.02, body * teeth * 0.62)


def oak_twig(rnd, hazel=False):
    """Belaubter Zweig, der die Karte (-0.5..0.5)² füllt; wächst von unten Mitte nach oben."""
    bld = Builder()
    greens = [(0.055, 0.105, 0.022), (0.07, 0.12, 0.028), (0.045, 0.085, 0.02), (0.085, 0.13, 0.035), (0.06, 0.1, 0.03)]
    if hazel:
        greens = [(0.07, 0.13, 0.03), (0.085, 0.15, 0.04), (0.06, 0.11, 0.028), (0.1, 0.155, 0.045)]
    bark = (0.09, 0.065, 0.04, 1)
    stem = [(0.0, -0.5, 0.0), (0.02, -0.25, 0.02), (-0.01, 0.0, 0.03), (0.015, 0.22, 0.02), (0.0, 0.4, 0.0)]
    bld.tube(stem, 0.012, 0.004, bark, 0, seg=5)
    # Seitenzweige
    twigs = []
    for k in range(7):
        t = 0.12 + k * 0.12
        s = -1 if k % 2 else 1
        p = Vector(stem[0]).lerp(Vector(stem[-1]), t)
        a = math.radians(rnd.uniform(35, 60)) * s
        L = rnd.uniform(0.22, 0.34) * (1.1 - t * 0.4)
        e = p + Vector((math.sin(a), math.cos(a), 0)) * L
        mid = p.lerp(e, 0.5) + Vector((0, 0.03, 0.02))
        bld.tube([p, mid, e], 0.007, 0.003, bark, 0, seg=4)
        twigs.append((p, e))
    twigs.append((Vector(stem[2]), Vector(stem[-1])))
    shape = hazel_shape if hazel else oak_shape
    n_leaves = 0
    for (a, b) in twigs:
        # Blätter büschelig am Ende (Eiche) bzw. wechselständig (Hasel)
        count = 9 if hazel else 12
        for i in range(count):
            t = (0.35 + 0.65 * i / (count - 1)) if not hazel else (0.2 + 0.8 * i / (count - 1))
            base = a.lerp(b, t)
            dirv = (b - a).normalized()
            ang = rnd.uniform(-1.1, 1.1) + (0.5 if i % 2 else -0.5)
            dv = Matrix.Rotation(ang, 3, "Z") @ dirv
            dv.z = rnd.uniform(-0.25, 0.45)
            L = rnd.uniform(0.12, 0.17) if not hazel else rnd.uniform(0.1, 0.15)
            W = L * (0.62 if not hazel else 0.8)
            c = rnd.choice(greens)
            k = rnd.uniform(0.8, 1.2)
            leaf(bld, base, dv, L, W, rnd, shape, (c[0] * k, c[1] * k, c[2] * k, 1), fold=rnd.uniform(0.15, 0.35), curl=rnd.uniform(0.05, 0.2))
            n_leaves += 1
    return bld.finish("twig", [flat_material("bark"), leaf_material("leaf", vein=0.1 if hazel else 0.14)])


def needle_sprig(rnd, pine=False):
    """Nadelzweig: Hauptachse mit Seitentrieben, rundum Nadeln (Flaschenbürste)."""
    bld = Builder()
    bark = (0.1, 0.07, 0.045, 1)
    if pine:
        # Kiefer: lange Nadeln in Büscheln an den Triebspitzen
        tips = []
        for k in range(5):
            a = math.radians(-50 + k * 25 + rnd.uniform(-8, 8))
            base = Vector((0, -0.48, 0))
            e = base + Vector((math.sin(a) * 0.55, 0.62 + rnd.uniform(-0.05, 0.08), 0))
            m = base.lerp(e, 0.5) + Vector((rnd.uniform(-0.04, 0.04), 0, 0.02))
            bld.tube([base, m, e], 0.012, 0.006, bark, 0, seg=5)
            tips.append((m, e))
        for (m, e) in tips:
            axis = (e - m).normalized()
            for j in range(160):
                t = rnd.uniform(0.0, 1.05)
                p = m.lerp(e, min(t, 1.0))
                phi = rnd.uniform(0, 2 * math.pi)
                side = axis.orthogonal().normalized()
                side = Matrix.Rotation(phi, 3, axis) @ side
                dv = (side * 0.85 + axis * rnd.uniform(0.35, 0.8)).normalized()
                L = rnd.uniform(0.16, 0.24)
                g = rnd.uniform(0.8, 1.15)
                col = (0.05 * g, 0.1 * g, 0.045 * g, 1)
                needle(bld, p, dv, L, 0.0045, col)
        return bld.finish("sprig", [flat_material("bark"), flat_material("needle")])
    # Fichte: flacher Zweig mit Seitentrieben, kurze Nadeln rundum
    stem = [Vector((0.0, -0.5, 0.0)), Vector((0.01, -0.1, 0.01)), Vector((-0.01, 0.25, 0.0)), Vector((0.0, 0.47, -0.01))]
    bld.tube(stem, 0.01, 0.004, bark, 0, seg=5)
    shoots = [(stem[0], stem[-1])]
    for k in range(9):
        t = 0.08 + k * 0.1
        s = -1 if k % 2 else 1
        p = stem[0].lerp(stem[-1], t)
        a = math.radians(rnd.uniform(50, 65)) * s
        L = 0.42 * (1.05 - t * 0.7) + rnd.uniform(-0.03, 0.03)
        e = p + Vector((math.sin(a), math.cos(a), -0.02)) * L
        bld.tube([p, p.lerp(e, 0.5) + Vector((0, 0.01, 0.01)), e], 0.006, 0.003, bark, 0, seg=4)
        shoots.append((p, e))
        # Zweite Ordnung
        for q in range(4):
            t2 = 0.2 + q * 0.2
            p2 = p.lerp(e, t2)
            a2 = a + math.radians(45) * (1 if q % 2 else -1)
            e2 = p2 + Vector((math.sin(a2), math.cos(a2), 0)) * L * (0.45 - q * 0.06)
            bld.tube([p2, e2], 0.004, 0.002, bark, 0, seg=3)
            shoots.append((p2, e2))
    for (a, b) in shoots:
        axis = (b - a)
        n = int(axis.length / 0.0055)
        axis_n = axis.normalized()
        for j in range(n):
            p = a.lerp(b, j / max(1, n))
            for r in range(6):
                phi = rnd.uniform(0, 2 * math.pi)
                side = Matrix.Rotation(phi, 3, axis_n) @ axis_n.orthogonal().normalized()
                dv = (side + axis_n * rnd.uniform(0.3, 0.7)).normalized()
                L = rnd.uniform(0.04, 0.058)
                tip = j / max(1, n)
                g = rnd.uniform(0.8, 1.15) * (1.0 + 0.35 * max(0.0, tip - 0.8) * 5)  # hellere, frische Triebspitzen
                col = (0.035 * g, 0.075 * g, 0.045 * g, 1)
                needle(bld, p, dv, L, 0.005, col)
    return bld.finish("sprig", [flat_material("bark"), flat_material("needle")])


def needle(bld, p, d, L, w, col):
    """Nadel mit dachförmigem Querschnitt (zwei schmale Flächen) – gibt der Normalenkarte Relief."""
    side = d.cross(Vector((0, 0, 1)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d).normalized()
    if up.z < 0:
        up = -up
    tip = p + d * L
    ridge0 = p + up * w * 0.5
    ridge1 = tip
    l0, r0 = p - side * w, p + side * w
    bld.quad_strip([l0, tip], [ridge0, ridge1], [(-1, 0), (-1, 1)], [(0, 0), (0, 1)], col, 1)
    bld.quad_strip([ridge0, ridge1], [r0, tip], [(0, 0), (0, 1)], [(1, 0), (1, 1)], col, 1)


def grass_clump(rnd, dry=False):
    """Grasbüschel von der Seite (für senkrechte Grasbüschel-Karten): Halme wachsen vom unteren Rand."""
    bld = Builder()
    greens = [(0.06, 0.11, 0.025), (0.08, 0.13, 0.03), (0.05, 0.09, 0.022), (0.1, 0.13, 0.04), (0.12, 0.12, 0.05)]
    drys = [(0.22, 0.18, 0.09), (0.28, 0.23, 0.12), (0.18, 0.15, 0.08), (0.14, 0.13, 0.06)]
    blades = 70 if not dry else 40
    for i in range(blades):
        x0 = rnd.uniform(-0.42, 0.42)
        H = rnd.uniform(0.45, 0.95) if not dry else rnd.uniform(0.6, 0.97)
        lean = rnd.uniform(-0.35, 0.35) + x0 * 0.3
        W = rnd.uniform(0.008, 0.016)
        pal = drys if (dry or rnd.random() < 0.12) else greens
        c = rnd.choice(pal)
        k = rnd.uniform(0.85, 1.15)
        steps = 10
        left, right, ul, ur = [], [], [], []
        depth = rnd.uniform(-0.2, 0.2)
        for s in range(steps + 1):
            t = s / steps
            x = x0 + lean * t * t * H
            y = -0.5 + t * H * (1 - 0.15 * abs(lean) * t)
            w = W * (1 - t ** 1.6)
            twist = math.sin(t * 2 + i) * 0.4
            left.append(Vector((x - w * math.cos(twist), y, depth - w * math.sin(twist))))
            right.append(Vector((x + w * math.cos(twist), y, depth + w * math.sin(twist))))
            ul.append((-1.0, t))
            ur.append((1.0, t))
        # Unten dunkler (Eigenschatten im Büschel), oben heller
        bld.quad_strip(left, right, ul, ur, (c[0] * k, c[1] * k, c[2] * k, 1), 1)
        if dry and rnd.random() < 0.5:
            # Rispe / Samenstand
            top = Vector((x0 + lean * H, -0.5 + H * (1 - 0.15 * abs(lean)), depth))
            for j in range(12):
                d = Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-1, -0.2), rnd.uniform(-0.2, 0.2))).normalized()
                bld.tube([top + Vector((0, -j * 0.008, 0)), top + Vector((0, -j * 0.008, 0)) + d * 0.03], 0.004, 0.002, (0.3, 0.25, 0.14, 1), 1, seg=3)
    if not dry:
        # Einzelne kleine Blüten (Wiese)
        for j in range(6):
            x = rnd.uniform(-0.35, 0.35)
            y = rnd.uniform(-0.1, 0.35)
            col = rnd.choice([(0.6, 0.55, 0.45, 1), (0.55, 0.45, 0.08, 1), (0.35, 0.3, 0.55, 1)])
            bld.tube([Vector((x, -0.5, 0.1)), Vector((x + 0.02, y, 0.1))], 0.003, 0.002, (0.07, 0.12, 0.03, 1), 1, seg=3)
            for k in range(6):
                a = k / 6 * 2 * math.pi
                bld.tube([Vector((x + 0.02, y, 0.11)), Vector((x + 0.02 + math.cos(a) * 0.018, y + math.sin(a) * 0.018, 0.11))], 0.007, 0.004, col, 1, seg=3)
    return bld.finish("clump", [flat_material("stem"), flat_material("blade")])


def hair_strands(rnd, curly=False):
    """Haarkarten-Atlas: vier Büschel nebeneinander (je ein Viertel der Breite, u = 0, ¼, ½, ¾).
    Wurzel unten (v=0), Spitzen oben (v=1). Jedes Büschel ist an der Wurzel breit und läuft zur Spitze
    schmal zu, Haare unterschiedlich lang (lichte, fransige Spitzen), mit Lücken – so wirkt eine Karte
    wie eine Haarsträhne statt wie ein Band. Das vierte Büschel ist locker (abstehende Einzelhaare)."""
    bld = Builder()
    for c in range(4):
        cx = -0.5 + (c + 0.5) / 4
        loose = c == 3
        n = 110 if loose else rnd.choice((300, 360, 420))
        root_w = 0.085 if not loose else 0.1
        tip_w = rnd.uniform(0.035, 0.06) if not loose else 0.09
        for i in range(n):
            off = max(-1.0, min(1.0, rnd.gauss(0, 0.45)))
            start = abs(rnd.gauss(0, 0.06)) + (0.1 * rnd.random() if loose else 0)
            L = min(1.0 - start - 0.01, (1.0 - rnd.random() ** 1.4 * 0.65) if not loose else rnd.uniform(0.3, 0.8))
            steps = 14
            phase = rnd.uniform(0, 6.28)
            amp = rnd.uniform(0.002, 0.006) * (3.5 if curly else 1)
            freq = rnd.uniform(3, 6) * (2.2 if curly else 1)
            pts = []
            for st in range(steps + 1):
                t = st / steps
                # Büschel: Abstand zur Mitte schrumpft von Wurzel- auf Spitzenbreite
                wid = root_w + (tip_w - root_w) * min(1.0, (t * L + start) / 0.95) ** 0.8
                x = cx + off * wid + math.sin(t * freq + phase) * amp * (0.3 + t)
                pts.append(Vector((x, -0.5 + start + t * L, rnd.uniform(-0.01, 0.01))))
            # innen dunkler (Tiefe), einzelne helle Haare
            g = rnd.uniform(0.45, 0.85) * (0.8 + 0.2 * abs(off)) + (0.15 if rnd.random() < 0.08 else 0.0)
            w = rnd.uniform(0.0009, 0.0017)
            left, right, ul, ur = [], [], [], []
            for st, p in enumerate(pts):
                t = st / steps
                ww = w * (1 - t ** 2 * 0.85)
                left.append(p - Vector((ww, 0, 0)))
                right.append(p + Vector((ww, 0, 0)))
                ul.append((-1, t))
                ur.append((1, t))
            bld.quad_strip(left, right, ul, ur, (g, g, g, 1), 1)
    return bld.finish("hair", [flat_material("root"), flat_material("strand")])


# ---------------------------------------------------------------------------
# Rendern: Farbe (mit Alpha) und Normalen; 2× überabgetastet, Ränder ausgeweitet
# ---------------------------------------------------------------------------

def render(obj, ortho=1.0):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 6
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 0
    sc.render.film_transparent = True
    sc.render.resolution_x = SIZE * 2
    sc.render.resolution_y = SIZE * 2
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "16"
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.filter_size = 1.2
    cam = bpy.data.objects.get("cam")
    if not cam:
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = ortho
    cam.location = (0, 0, 5)
    cam.rotation_euler = (0, 0, 0)
    cam.data.clip_end = 20
    sc.camera = cam
    w = bpy.data.worlds.new("w")
    sc.world = w

    def shot():
        path = os.path.join(bpy.app.tempdir or "/tmp", "foliage_shot.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        a = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
        bpy.data.images.remove(img)
        return a

    col = shot()
    nmat = normal_material()
    saved = list(obj.data.materials)
    for i in range(len(obj.data.materials)):
        obj.data.materials[i] = nmat
    nrm = shot()
    for i, m in enumerate(saved):
        obj.data.materials[i] = m
    return col, nrm


def downsample(a):
    h, w = a.shape[:2]
    return a.reshape(h // 2, 2, w // 2, 2, a.shape[2]).mean(axis=(1, 3))


def dilate(rgb, alpha, iters=24):
    """Farbe in transparente Bereiche ausweiten (sonst dunkle Säume in den Mipmaps)."""
    rgb = rgb.copy()
    known = alpha > 0.02
    for _ in range(iters):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(alpha.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            sh_k = np.roll(np.roll(known, dy, 0), dx, 1)
            sh_c = np.roll(np.roll(rgb, dy, 0), dx, 1)
            acc += sh_c * sh_k[..., None]
            cnt += sh_k
        grow = (~known) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        known = known | grow
    rgb[~known] = rgb[known].mean(axis=0) if known.any() else 0
    return rgb


def save_webp(arr, path, alpha, noncolor):
    h, w = arr.shape[:2]
    img = bpy.data.images.new("out", w, h, alpha=alpha)
    img.colorspace_settings.name = "Non-Color" if noncolor else "sRGB"
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :arr.shape[2]] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = "WEBP"
    img.save(filepath=path, quality=90)
    bpy.data.images.remove(img)


def linear_to_srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055)


def bake(kind):
    reset()
    rnd = random.Random({"oak": 11, "bush": 12, "spruce": 13, "pine": 14, "grass": 15, "dry": 16, "hair": 17, "curly": 18}[kind])
    if kind == "oak":
        obj = oak_twig(rnd)
    elif kind == "bush":
        obj = oak_twig(rnd, hazel=True)
    elif kind == "spruce":
        obj = needle_sprig(rnd)
    elif kind == "pine":
        obj = needle_sprig(rnd, pine=True)
    elif kind == "grass":
        obj = grass_clump(rnd)
    elif kind in ("hair", "curly"):
        obj = hair_strands(rnd, kind == "curly")
    else:
        obj = grass_clump(rnd, dry=True)
    col, nrm = render(obj)
    col = downsample(col)
    nrm = downsample(nrm)
    alpha = col[..., 3]
    # PNG speichert unvormultipliziert (gerade Alpha)
    rgb = col[..., :3]
    rgb = dilate(rgb, alpha)
    n = nrm[..., :3].copy()
    n[alpha < 0.02] = (0.5, 0.5, 1.0)
    n = dilate(n, alpha, 8)
    os.makedirs(OUT, exist_ok=True)
    out_rgba = np.concatenate([rgb, alpha[..., None]], axis=2)
    # Blender liefert die Pixel linear; die WebP-Datei ist sRGB-kodiert
    out_rgba[..., :3] = linear_to_srgb(out_rgba[..., :3])
    save_webp(out_rgba, os.path.join(OUT, f"foliage_{kind}_color.webp"), True, False)
    save_webp(n, os.path.join(OUT, f"foliage_{kind}_normal.webp"), False, True)
    cover = float((alpha > 0.5).mean())
    print(f"[laub] {kind}: {SIZE}px, Deckung {cover:.0%}", flush=True)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    for k in (argv or ["oak", "bush", "spruce", "pine", "grass", "dry"]):
        bake(k)
