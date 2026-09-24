"""Hochwertige, nahtlos kachelbare PBR-Texturen aus prozeduralen Blender-Materialien.

Für jedes Material wird ein Knotennetz (Rauschen, Voronoi-Zellen, Ziegel-/Bohlenraster,
Verwitterung, Moos, Schmutz in Fugen …) aufgebaut und mit Cycles gebacken:
  <name>_color.webp   Grundfarbe (sRGB)
  <name>_normal.webp  Normalenkarte (Tangentenraum, OpenGL/three.js)
  <name>_arm.webp     R = Umgebungsverdeckung, G = Rauheit, B = Höhe

Kachelbarkeit: Alle Rauschfunktionen werden auf einem 4D-Torus ausgewertet
(u, v → cos/sin), Raster haben ganzzahlige Wiederholungen pro Kachel.

Aufruf:  python tools/blender/textures.py [name ...]   (oder blender -b -P … -- [name ...])
Umgebung: PZ_TEX_SIZE (Standard 2048), PZ_TEX_OUT (Ausgabeordner).
"""
import math
import os
import sys
import time

import bpy  # noqa: I001
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("PZ_TEX_OUT", os.path.join(HERE, "..", "..", "apps", "client", "public", "assets", "textures"))
SIZE = int(os.environ.get("PZ_TEX_SIZE", "2048"))
TAU = math.tau


def srgb(hexstr):
    """sRGB-Hex → lineare RGBA-Farbe für Blender-Knoten."""
    h = hexstr.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, 1.0)


class G:
    """Kleiner Baukasten für Knotennetze mit kachelbaren Koordinaten."""

    def __init__(self, mat):
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.L = self.nt.links
        tc = self.n("ShaderNodeTexCoord")
        sep = self.n("ShaderNodeSeparateXYZ")
        self.L.new(tc.outputs["UV"], sep.inputs[0])
        self.u = sep.outputs[0]
        self.v = sep.outputs[1]

    def n(self, kind, **props):
        node = self.nt.nodes.new(kind)
        for k, val in props.items():
            setattr(node, k, val)
        return node

    def link(self, a, b):
        self.L.new(a, b)

    def val(self, x):
        node = self.n("ShaderNodeValue")
        node.outputs[0].default_value = x
        return node.outputs[0]

    def _s(self, x):
        return x if not isinstance(x, (int, float)) else self.val(float(x))

    def m(self, op, a, b=None, clamp=False):
        node = self.n("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.link(self._s(a), node.inputs[0])
        if b is not None:
            self.link(self._s(b), node.inputs[1])
        return node.outputs[0]

    def add(self, a, b):
        return self.m("ADD", a, b)

    def mul(self, a, b):
        return self.m("MULTIPLY", a, b)

    def sub(self, a, b):
        return self.m("SUBTRACT", a, b)

    def lerp(self, a, b, t):
        node = self.n("ShaderNodeMix", data_type="FLOAT")
        self.link(self._s(t), node.inputs["Factor"])
        self.link(self._s(a), node.inputs["A"])
        self.link(self._s(b), node.inputs["B"])
        return node.outputs["Result"]

    def smooth(self, a, b, x):
        node = self.n("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
        self.link(self._s(x), node.inputs["Value"])
        for sock, v in ((node.inputs["From Min"], a), (node.inputs["From Max"], b)):
            if isinstance(v, (int, float)):
                sock.default_value = v
            else:
                self.link(v, sock)
        return node.outputs["Result"]

    def remap(self, x, a, b, c=0.0, d=1.0, clamp=True):
        node = self.n("ShaderNodeMapRange", clamp=clamp)
        self.link(self._s(x), node.inputs["Value"])
        node.inputs["From Min"].default_value = a
        node.inputs["From Max"].default_value = b
        node.inputs["To Min"].default_value = c
        node.inputs["To Max"].default_value = d
        return node.outputs["Result"]

    def torus(self, fu, fv=None, u=None, v=None, off=0.0):
        """4D-Koordinaten (Vektor, W), fu/fv = Strukturen pro Kachel in u/v."""
        fv = fu if fv is None else fv
        u = self.u if u is None else u
        v = self.v if v is None else v
        au = self.mul(u, TAU)
        av = self.mul(v, TAU)
        ru, rv = fu / TAU, fv / TAU
        comb = self.n("ShaderNodeCombineXYZ")
        self.link(self.add(self.mul(self.m("COSINE", au), ru), off), comb.inputs[0])
        self.link(self.mul(self.m("SINE", au), ru), comb.inputs[1])
        self.link(self.mul(self.m("COSINE", av), rv), comb.inputs[2])
        return comb.outputs[0], self.mul(self.m("SINE", av), rv)

    def noise(self, fu, fv=None, detail=6.0, rough=0.55, lac=2.0, distort=0.0, kind="FBM", off=0.0, u=None, v=None, color=False):
        vec, w = self.torus(fu, fv, u, v, off)
        node = self.n("ShaderNodeTexNoise", noise_dimensions="4D")
        try:
            node.noise_type = kind
        except Exception:
            pass
        self.link(vec, node.inputs["Vector"])
        self.link(w, node.inputs["W"])
        node.inputs["Scale"].default_value = 1.0
        node.inputs["Detail"].default_value = detail
        node.inputs["Roughness"].default_value = rough
        node.inputs["Lacunarity"].default_value = lac
        node.inputs["Distortion"].default_value = distort
        return node.outputs["Color" if color else "Fac"]

    def noise_diag(self, fa, fb, sign=1.0, **kw):
        """Rauschen entlang der Diagonalen (bleibt kachelbar, da u±v ganzzahlig periodisch ist)."""
        a = self.add(self.u, self.mul(self.v, sign))
        b = self.sub(self.u, self.mul(self.v, sign))
        return self.noise(fa, fb, u=a, v=b, **kw)

    def voronoi(self, fu, fv=None, feature="F1", rand=1.0, off=0.0, u=None, v=None, out="Distance"):
        vec, w = self.torus(fu, fv, u, v, off)
        node = self.n("ShaderNodeTexVoronoi", voronoi_dimensions="4D", feature=feature)
        self.link(vec, node.inputs["Vector"])
        self.link(w, node.inputs["W"])
        node.inputs["Scale"].default_value = 1.0
        node.inputs["Randomness"].default_value = rand
        return node.outputs[out]

    def ramp(self, x, stops, interp="LINEAR"):
        node = self.n("ShaderNodeValToRGB")
        cr = node.color_ramp
        cr.interpolation = interp
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        cr.elements[0].position = stops[0][0]
        cr.elements[0].color = srgb(stops[0][1])
        for pos, col in stops[1:]:
            e = cr.elements.new(pos)
            e.color = srgb(col)
        self.link(self._s(x), node.inputs[0])
        return node.outputs[0]

    @staticmethod
    def _rgba(sockets, name):
        return [s for s in sockets if s.name == name and s.type == "RGBA"][0]

    def mixc(self, a, b, t, blend="MIX"):
        node = self.n("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        self.link(self._s(t), node.inputs["Factor"])
        for sock, c in ((self._rgba(node.inputs, "A"), a), (self._rgba(node.inputs, "B"), b)):
            if isinstance(c, str):
                sock.default_value = srgb(c)
            else:
                self.link(c, sock)
        return self._rgba(node.outputs, "Result")

    def cmul(self, c, k):
        """Farbe mit Skalar multiplizieren."""
        node = self.n("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        node.inputs["Factor"].default_value = 1.0
        self.link(c, self._rgba(node.inputs, "A"))
        comb = self.n("ShaderNodeCombineXYZ")
        for i in range(3):
            self.link(self._s(k), comb.inputs[i])
        self.link(comb.outputs[0], self._rgba(node.inputs, "B"))
        return self._rgba(node.outputs, "Result")

    def grid(self, nu, nv, shift=0.5, jitter_rows=False):
        """Ziegel-/Bohlenraster: lokale Koordinaten und Zell-IDs (ganzzahlig, kachelbar)."""
        row = self.m("FLOOR", self.mul(self.v, nv))
        odd = self.m("MODULO", row, 2.0)
        if jitter_rows:
            sh = self.white(row, 7.0, nv)
        else:
            sh = self.mul(odd, shift)
        uu = self.add(self.mul(self.u, nu), sh)
        col = self.m("FLOOR", uu)
        lu = self.m("FRACT", uu)
        lv = self.m("FRACT", self.mul(self.v, nv))
        colw = self.m("MODULO", self.add(col, nu * 4.0), float(nu))
        return lu, lv, colw, row

    def white(self, a, b, salt=0.0):
        comb = self.n("ShaderNodeCombineXYZ")
        self.link(self._s(a), comb.inputs[0])
        self.link(self._s(b), comb.inputs[1])
        self.link(self._s(salt), comb.inputs[2])
        node = self.n("ShaderNodeTexWhiteNoise", noise_dimensions="3D")
        self.link(comb.outputs[0], node.inputs["Vector"])
        return node.outputs["Value"]

    def edge(self, lu, lv, w):
        """0 in der Fuge, 1 im Stein (weiche Kanten)."""
        eu = self.m("MINIMUM", lu, self.sub(1.0, lu))
        ev = self.m("MINIMUM", lv, self.sub(1.0, lv))
        e = self.m("MINIMUM", eu, ev)
        return self.smooth(0.0, w, e)

    def finish(self, color, rough, height, bump=1.0, bump_dist=0.02, metal=0.0):
        """Principled BSDF mit Relief; Höhe separat für das Backen (Emission)."""
        bsdf = self.n("ShaderNodeBsdfPrincipled")
        out = self.n("ShaderNodeOutputMaterial")
        self.link(color, bsdf.inputs["Base Color"])
        self.link(self._s(rough), bsdf.inputs["Roughness"])
        bsdf.inputs["Metallic"].default_value = metal
        b = self.n("ShaderNodeBump")
        b.inputs["Strength"].default_value = bump
        b.inputs["Distance"].default_value = bump_dist
        self.link(self._s(height), b.inputs["Height"])
        self.link(b.outputs["Normal"], bsdf.inputs["Normal"])
        self.link(bsdf.outputs[0], out.inputs["Surface"])
        # Höhenausgabe für den Emissions-Bake
        em = self.n("ShaderNodeEmission")
        self.link(self._s(height), em.inputs["Color"])
        self.height_emit = em
        self.bsdf = bsdf
        self.out = out


# ---------------------------------------------------------------------------
# Materialien
# ---------------------------------------------------------------------------

def mat_grass(g):
    # Dichte Wiese aus der Vogelperspektive: feines Halmgewirr in vielen Richtungen, Büschel,
    # helle Halmspitzen, trockene Stellen, dunkle Zwischenräume
    fib = []
    for i, (a, b, sg) in enumerate(((150, 14, 0), (14, 150, 0), (120, 11, 1.0), (120, 11, -1.0), (95, 18, 0), (18, 95, 0))):
        n = g.noise_diag(a, b, sg, detail=2, rough=0.5, off=i * 1.7) if sg else g.noise(a, b, detail=2, rough=0.5, off=i * 1.7)
        fib.append(g.smooth(0.5, 0.75, n))
    blades = fib[0]
    for f in fib[1:]:
        blades = g.m("MAXIMUM", blades, f)
    speck = g.noise(300, detail=2, rough=0.7, off=3.3)
    tufts = g.noise(10, detail=6, rough=0.6, off=5.1)
    patches = g.noise(2.5, detail=6, rough=0.6, off=1.3)
    dry = g.smooth(0.56, 0.74, g.noise(4, detail=7, off=4.2))
    soil = g.smooth(0.7, 0.85, g.add(g.noise(6, detail=7, rough=0.6, off=9.9), g.mul(g.sub(0.5, tufts), 0.3)))
    lush = g.ramp(patches, [(0.0, "#3f6a1c"), (0.5, "#5a8a26"), (1.0, "#7ca23a")])
    shade = g.ramp(g.add(g.mul(tufts, 0.6), g.mul(speck, 0.4)), [(0.0, "#16240b"), (0.5, "#2c4414"), (1.0, "#43611d")])
    col = g.mixc(shade, lush, g.add(g.mul(blades, 0.75), g.mul(tufts, 0.25)))
    col = g.mixc(col, g.ramp(speck, [(0.0, "#88a64a"), (1.0, "#c3d27a")]), g.mul(g.smooth(0.8, 1.0, blades), 0.35))
    dryc = g.ramp(g.add(g.mul(blades, 0.6), g.mul(speck, 0.4)), [(0.0, "#4a4526"), (0.6, "#9a8b4d"), (1.0, "#c9b97a")])
    col = g.mixc(col, dryc, g.mul(dry, 0.55))
    soilc = g.ramp(g.noise(90, detail=5, off=5.5), [(0.0, "#2a1f16"), (1.0, "#5b4733")])
    col = g.mixc(col, soilc, g.mul(soil, g.sub(1.0, g.mul(blades, 0.7))))
    height = g.add(g.mul(blades, 0.55), g.add(g.mul(tufts, 0.35), g.mul(speck, 0.1)))
    rough = g.remap(blades, 0.0, 1.0, 0.96, 0.74)
    g.finish(col, rough, height, bump=1.0, bump_dist=0.035)

def mat_dirt(g):
    # Erdboden: Klumpen, feine Krümel, verstreute Kiesel mit Schatten, vereinzelte Risse, Wurzelreste
    clumps = g.noise(10, detail=8, rough=0.62, distort=0.6, off=0.5)
    crumbs = g.noise(160, detail=4, rough=0.6, off=2.0)
    big = g.noise(3, detail=6, off=6.3)
    peb_d = g.voronoi(16, feature="F1", rand=1.0, off=1.0)
    peb_c = g.voronoi(16, feature="F1", rand=1.0, off=1.0, out="Color")
    sep = g.n("ShaderNodeSeparateColor")
    g.link(peb_c, sep.inputs[0])
    peb_r = sep.outputs[0]
    peb_keep = g.smooth(0.5, 0.6, sep.outputs[1])
    peb_size = g.lerp(0.18, 0.34, sep.outputs[2])
    peb = g.mul(g.smooth(peb_size, g.mul(peb_size, 0.7), peb_d), peb_keep)
    peb_dome = g.mul(g.m("SQRT", g.m("MAXIMUM", g.sub(1.0, g.m("DIVIDE", peb_d, peb_size)), 0.0)), peb_keep)
    crack_mask = g.smooth(0.62, 0.72, g.noise(4, detail=5, off=7.7))
    cracks = g.mul(g.smooth(0.02, 0.0, g.voronoi(6, feature="DISTANCE_TO_EDGE", off=3.3)), crack_mask)
    roots = g.mul(g.smooth(0.975, 1.0, g.noise(2, 30, detail=3, rough=0.4, kind="RIDGED_MULTIFRACTAL", off=8.2)), 0.8)
    col = g.ramp(g.add(g.mul(clumps, 0.6), g.mul(big, 0.4)), [(0.0, "#2a1e14"), (0.4, "#45331f"), (0.75, "#5f4a33"), (1.0, "#75603f")])
    col = g.mixc(col, g.ramp(crumbs, [(0.0, "#1e160f"), (1.0, "#8a7458")]), 0.38, "OVERLAY")
    pebc = g.ramp(peb_r, [(0.0, "#5e554b"), (0.5, "#7b7064"), (1.0, "#9a8f7f")])
    col = g.mixc(col, g.mixc(g.cmul(pebc, 0.6), pebc, peb_dome), peb)
    col = g.mixc(col, "#150f0a", g.mul(cracks, 0.75))
    col = g.mixc(col, "#5a4431", roots)
    height = g.add(g.add(g.mul(clumps, 0.4), g.mul(crumbs, 0.12)), g.sub(g.add(g.mul(peb_dome, 0.5), g.mul(roots, 0.2)), g.mul(cracks, 0.35)))
    rough = g.lerp(0.93, 0.72, peb)
    g.finish(col, rough, height, bump=1.0, bump_dist=0.16)

def mat_rock(g):
    # Fels: kräftiges mehrstufiges Relief, Schichtung, wenige unregelmäßige Risse, Flechten
    big = g.noise(2.5, detail=10, rough=0.6, distort=0.4, kind="RIDGED_MULTIFRACTAL", off=1.7)
    mid = g.noise(9, detail=8, rough=0.58, off=3.1)
    strata = g.noise(1.5, 12, detail=6, rough=0.55, distort=0.8, off=0.1)
    fine = g.noise(70, detail=7, rough=0.6, off=2.8)
    crack_mask = g.smooth(0.55, 0.7, g.noise(3, detail=5, off=8.8))
    cracks = g.mul(g.smooth(0.03, 0.0, g.voronoi(4, 7, feature="DISTANCE_TO_EDGE", rand=1.0, off=5.1)), crack_mask)
    lichen = g.smooth(0.64, 0.74, g.noise(8, detail=6, off=6.6))
    spots = g.smooth(0.3, 0.12, g.voronoi(70, feature="F1", off=9.2))
    shape = g.add(g.mul(big, 0.55), g.add(g.mul(mid, 0.25), g.mul(strata, 0.2)))
    col = g.ramp(shape, [(0.0, "#34312d"), (0.35, "#524d46"), (0.65, "#716a60"), (1.0, "#958d80")])
    col = g.mixc(col, g.ramp(strata, [(0.0, "#5c5248"), (1.0, "#8b8378")]), 0.25)
    col = g.mixc(col, g.ramp(fine, [(0.0, "#2a2724"), (1.0, "#bdb4a4")]), 0.35, "OVERLAY")
    col = g.mixc(col, "#1b1917", g.mul(cracks, 0.85))
    col = g.mixc(col, "#8d9a5b", g.mul(g.mul(lichen, spots), 0.65))
    col = g.mixc(col, "#d2cdbc", g.mul(g.mul(lichen, g.sub(1.0, spots)), 0.18))
    height = g.sub(g.add(shape, g.mul(fine, 0.12)), g.mul(cracks, 0.4))
    rough = g.remap(fine, 0.0, 1.0, 0.95, 0.7)
    g.finish(col, rough, height, bump=1.0, bump_dist=0.45)

def mat_sand(g):
    ripples = g.noise(3, 26, detail=3, rough=0.4, distort=2.5, off=0.4)
    rip = g.m("SINE", g.mul(ripples, 30.0))
    grains = g.noise(260, detail=2, rough=0.8, off=3.3)
    tint = g.noise(4, detail=6, off=6.1)
    shells = g.smooth(0.08, 0.02, g.voronoi(18, feature="F1", rand=1.0, off=8.8))
    col = g.ramp(tint, [(0.0, "#a8916a"), (0.5, "#c7b088"), (1.0, "#d9c7a0")])
    col = g.mixc(col, g.ramp(grains, [(0.0, "#7e6c52"), (1.0, "#f1e4c6")]), 0.35, "OVERLAY")
    col = g.mixc(col, "#ece6da", g.mul(shells, 0.6))
    height = g.add(g.mul(rip, 0.25), g.add(g.mul(grains, 0.08), g.mul(shells, 0.2)))
    g.finish(col, g.remap(grains, 0.0, 1.0, 0.95, 0.8), height, bump=0.7, bump_dist=0.02)


def mat_forest(g):
    # Waldboden: mehrere Lagen Laub (je Blatt eigene Farbe/Neigung), Nadeln, Moospolster, Zweige
    def leaf_layer(fu, fv, off, diag=0.0):
        if diag:
            a = g.add(g.u, g.mul(g.v, diag))
            b = g.sub(g.u, g.mul(g.v, diag))
            d = g.voronoi(fu, fv, feature="F1", rand=1.0, off=off, u=a, v=b)
            c = g.voronoi(fu, fv, feature="F1", rand=1.0, off=off, u=a, v=b, out="Color")
        else:
            d = g.voronoi(fu, fv, feature="F1", rand=1.0, off=off)
            c = g.voronoi(fu, fv, feature="F1", rand=1.0, off=off, out="Color")
        sp = g.n("ShaderNodeSeparateColor")
        g.link(c, sp.inputs[0])
        wob = g.noise(fu * 4, fv * 4, detail=2, off=off + 0.5)
        shape = g.smooth(g.lerp(0.62, 0.72, wob), 0.36, d)
        return shape, sp.outputs[0], sp.outputs[1], d
    l1, r1, k1, d1 = leaf_layer(26, 13, 0.3)
    l2, r2, k2, d2 = leaf_layer(13, 26, 3.7)
    l3, r3, k3, d3 = leaf_layer(18, 9, 6.1, diag=1.0)
    l2 = g.mul(l2, g.smooth(0.3, 0.5, k2))
    l3 = g.mul(l3, g.smooth(0.45, 0.65, k3))
    litter_col = lambda r: g.ramp(r, [(0.0, "#4a2c16"), (0.3, "#6e4220"), (0.55, "#8c5a2a"), (0.75, "#a2702f"), (1.0, "#5a4a26")])
    soil = g.ramp(g.noise(40, detail=6, off=1.1), [(0.0, "#1a120c"), (1.0, "#3a2819")])
    col = g.mixc(soil, g.mixc(g.cmul(litter_col(r1), 0.6), litter_col(r1), g.remap(d1, 0.5, 0.0)), l1)
    col = g.mixc(col, g.mixc(g.cmul(litter_col(r2), 0.7), litter_col(r2), g.remap(d2, 0.5, 0.0)), l2)
    col = g.mixc(col, g.mixc(g.cmul(litter_col(r3), 0.75), litter_col(r3), g.remap(d3, 0.5, 0.0)), l3)
    veins = g.mul(g.smooth(0.02, 0.0, g.voronoi(18, feature="DISTANCE_TO_EDGE", off=0.3)), 0.0)
    needles = g.m("MAXIMUM", g.noise_diag(140, 8, 1.0, detail=2, kind="RIDGED_MULTIFRACTAL", off=2.1), g.noise_diag(140, 8, -1.0, detail=2, kind="RIDGED_MULTIFRACTAL", off=4.4))
    needles = g.smooth(0.8, 0.95, needles)
    col = g.mixc(col, "#7a5a33", g.mul(needles, 0.7))
    moss_m = g.smooth(0.6, 0.72, g.noise(4, detail=7, off=6.6))
    mossfine = g.noise(150, detail=5, off=3.9)
    col = g.mixc(col, g.ramp(mossfine, [(0.0, "#23361a"), (0.6, "#4d6d26"), (1.0, "#7d9a3c")]), moss_m)
    twigs = g.smooth(0.97, 1.0, g.noise(2, 45, detail=2, rough=0.3, kind="RIDGED_MULTIFRACTAL", off=7.3))
    col = g.mixc(col, "#4a3826", g.mul(twigs, 0.9))
    height = g.add(g.add(g.add(g.mul(l1, 0.3), g.mul(l2, 0.45)), g.mul(l3, 0.55)), g.add(g.mul(moss_m, g.add(0.35, g.mul(mossfine, 0.25))), g.add(g.mul(twigs, 0.4), g.mul(needles, 0.1))))
    rough = g.lerp(0.86, 0.97, moss_m)
    g.finish(col, rough, g.add(height, veins), bump=1.0, bump_dist=0.05)

def mat_glass(g):
    # „Glasnarbe“: verbrannter Boden, von Kristalladern durchzogen
    ground = g.noise(6, detail=8, off=0.6)
    shards = g.voronoi(14, feature="F2", off=1.8)
    edges = g.smooth(0.035, 0.0, g.voronoi(9, feature="DISTANCE_TO_EDGE", off=2.2))
    veins = g.smooth(0.02, 0.0, g.voronoi(4, feature="DISTANCE_TO_EDGE", off=4.4))
    col = g.ramp(ground, [(0.0, "#1b1d22"), (0.5, "#2c3038"), (1.0, "#4b4f58")])
    col = g.mixc(col, g.ramp(shards, [(0.0, "#6fbac4"), (0.5, "#2a5a66"), (1.0, "#16242a")]), g.mul(g.sub(1.0, edges), 0.35))
    col = g.mixc(col, "#9ff4ff", g.mul(veins, 0.9))
    height = g.add(g.mul(shards, 0.5), g.sub(g.mul(ground, 0.3), g.mul(edges, 0.3)))
    rough = g.lerp(0.35, 0.9, g.sub(1.0, g.mul(g.sub(1.0, edges), 0.7)))
    g.finish(col, rough, height, bump=1.0, bump_dist=0.03)


def mat_snow(g):
    # Schnee: Windverwehungen (Sastrugi), feine Körnung, bläuliche Mulden, Glitzer
    drift = g.noise(2, 8, detail=6, rough=0.55, distort=1.4, off=0.2)
    sastrugi = g.noise(4, 22, detail=4, rough=0.5, distort=2.0, kind="RIDGED_MULTIFRACTAL", off=3.3)
    fine = g.noise(150, detail=4, off=2.2)
    sparkle = g.smooth(0.8, 0.92, g.noise(500, detail=1, off=4.4))
    shape = g.add(g.mul(drift, 0.6), g.mul(sastrugi, 0.4))
    col = g.ramp(shape, [(0.0, "#aebccf"), (0.45, "#dbe3ee"), (1.0, "#f8fbff")])
    col = g.mixc(col, g.ramp(fine, [(0.0, "#c2cddc"), (1.0, "#ffffff")]), 0.25, "OVERLAY")
    height = g.add(shape, g.mul(fine, 0.06))
    rough = g.lerp(0.7, 0.3, sparkle)
    g.finish(col, rough, height, bump=1.0, bump_dist=0.12)

def mat_cobble(g):
    # Kopfsteinpflaster: gerundete, abgetretene Steine, Moos und Erde in breiten Fugen
    cell = g.voronoi(8, feature="DISTANCE_TO_EDGE", rand=0.8, off=0.3)
    idc = g.voronoi(8, feature="F1", rand=0.8, off=0.3, out="Color")
    sep = g.n("ShaderNodeSeparateColor")
    g.link(idc, sep.inputs[0])
    rnd = sep.outputs[0]
    rnd2 = sep.outputs[1]
    stone = g.smooth(0.006, 0.016, cell)
    t = g.remap(cell, 0.006, 0.06)
    dome = g.m("SQRT", g.sub(1.0, g.m("POWER", g.sub(1.0, t), 2.0)))
    lumps = g.noise(45, detail=7, rough=0.62, off=2.5)
    pits = g.smooth(0.35, 0.15, g.voronoi(90, feature="F1", off=7.4))
    col_stone = g.ramp(rnd, [(0.0, "#4d4945"), (0.3, "#5f5850"), (0.55, "#6e6961"), (0.8, "#7c7064"), (1.0, "#8d877c")])
    col_stone = g.mixc(col_stone, g.ramp(rnd2, [(0.0, "#5a5048"), (1.0, "#77756f")]), 0.3)
    col_stone = g.mixc(col_stone, g.ramp(lumps, [(0.0, "#2f2c29"), (1.0, "#bdb4a4")]), 0.32, "OVERLAY")
    col_stone = g.mixc(col_stone, "#3a3530", g.mul(pits, 0.4))
    grout = g.mixc("#241c14", "#344020", g.smooth(0.45, 0.65, g.noise(12, detail=5, off=8.1)))
    grout = g.mixc(grout, "#4a3b2c", g.mul(g.noise(70, detail=4, off=3.1), 0.5))
    edge_dark = g.smooth(0.0, 0.35, t)
    col = g.mixc(grout, g.mixc(g.cmul(col_stone, 0.55), col_stone, edge_dark), stone)
    col = g.mixc(col, g.cmul(col, 1.15), g.mul(g.smooth(0.75, 1.0, dome), 0.55))
    height = g.add(g.mul(dome, 0.75), g.sub(g.mul(lumps, 0.15), g.mul(pits, 0.05)))
    rough = g.lerp(0.97, 0.58, g.mul(g.smooth(0.65, 1.0, dome), stone))
    g.finish(col, rough, height, bump=1.0, bump_dist=0.1)

def mat_wood(g):
    # Gehobelte Bohlen: Maserung, Jahresringe, Äste, Fugen, Abnutzung
    lu, lv, cid, row = g.grid(1, 6, jitter_rows=True)
    rnd = g.white(cid, row, 3.0)
    grain = g.noise(3, 120, detail=6, rough=0.55, distort=0.4, off=g.mul(rnd, 50.0) if False else 0.0)
    rings = g.m("SINE", g.add(g.mul(g.noise(1.5, 40, detail=3, off=2.2), 60.0), g.mul(rnd, 20.0)))
    knots = g.smooth(0.12, 0.03, g.voronoi(3, 14, feature="F1", rand=1.0, off=4.1))
    seam = g.edge(lu, lv, 0.04)
    seam_v = g.smooth(0.0, 0.035, g.m("MINIMUM", lv, g.sub(1.0, lv)))
    col = g.ramp(g.add(g.mul(grain, 0.6), g.mul(rings, 0.2)), [(0.0, "#4a3120"), (0.5, "#7a5535"), (1.0, "#9c7449")])
    col = g.mixc(col, g.ramp(rnd, [(0.0, "#5e4028"), (1.0, "#a47c52")]), 0.35, "OVERLAY")
    col = g.mixc(col, "#2d1c10", g.mul(knots, 0.8))
    col = g.mixc("#1b120b", col, seam_v)
    height = g.sub(g.add(g.mul(grain, 0.3), g.mul(seam_v, 0.6)), g.mul(knots, 0.1))
    rough = g.lerp(0.9, 0.62, g.mul(grain, 0.5))
    g.finish(col, rough, height, bump=0.8, bump_dist=0.02)
    _ = seam


def mat_plaster(g):
    # Kalkputz: wolkige Kelle, feine Körnung, Risse, Wasserflecken, abgeplatzte Stellen
    trowel = g.noise(6, detail=7, rough=0.55, distort=0.8, off=0.1)
    grain = g.noise(180, detail=3, off=2.2)
    cracks = g.smooth(0.012, 0.0, g.voronoi(3, feature="DISTANCE_TO_EDGE", off=4.4))
    crack_mask = g.smooth(0.6, 0.7, g.noise(4, detail=4, off=6.2))
    stains = g.smooth(0.55, 0.8, g.noise(2, 5, detail=6, off=7.7))
    chips = g.smooth(0.72, 0.76, g.noise(8, detail=8, off=9.1))
    col = g.ramp(trowel, [(0.0, "#bdb29c"), (0.5, "#d8cfbb"), (1.0, "#ebe4d4")])
    col = g.mixc(col, g.ramp(grain, [(0.0, "#a09580"), (1.0, "#f4efe3")]), 0.2, "OVERLAY")
    col = g.mixc(col, "#8f8470", g.mul(stains, 0.45))
    col = g.mixc(col, "#7b6a58", g.mul(chips, 0.9))
    col = g.mixc(col, "#5e554a", g.mul(g.mul(cracks, crack_mask), 0.8))
    swirl = g.noise(14, detail=5, rough=0.5, distort=2.5, off=3.7)
    col = g.mixc(col, g.ramp(swirl, [(0.0, "#b3a78f"), (1.0, "#efe8da")]), 0.3, "OVERLAY")
    height = g.sub(g.add(g.add(g.mul(trowel, 0.3), g.mul(swirl, 0.25)), g.mul(grain, 0.08)), g.add(g.mul(chips, 0.45), g.mul(g.mul(cracks, crack_mask), 0.25)))
    g.finish(col, g.lerp(0.93, 0.84, trowel), height, bump=1.0, bump_dist=0.05)


def mat_thatch(g):
    # Strohdach: dichte Halme in Bündeln, verwittert, dunkler zwischen den Lagen
    strands = g.noise(160, 4, detail=4, rough=0.6, kind="RIDGED_MULTIFRACTAL", off=0.3)
    strands2 = g.noise(90, 3, detail=4, rough=0.6, off=2.1)
    lu, lv, cid, row = g.grid(8, 5, jitter_rows=True)
    layer = g.m("POWER", lv, 0.7)
    rnd = g.white(cid, row, 5.0)
    moss = g.smooth(0.62, 0.75, g.noise(5, detail=6, off=5.5))
    col = g.ramp(g.add(g.mul(strands, 0.6), g.mul(strands2, 0.4)), [(0.0, "#4a3a1e"), (0.5, "#8a7040"), (1.0, "#c3a866")])
    col = g.mixc(col, g.ramp(rnd, [(0.0, "#6f5a33"), (1.0, "#a88d55")]), 0.3, "OVERLAY")
    col = g.mixc(g.cmul(col, 0.45), col, layer)
    col = g.mixc(col, "#4e5a2a", g.mul(moss, 0.55))
    height = g.add(g.mul(strands, 0.4), g.mul(layer, 0.6))
    g.finish(col, 0.93, height, bump=1.1, bump_dist=0.03)
    _ = lu


def mat_roof(g):
    # Mönch-Nonne-artige Tonziegel: Reihen, runde Kanten, Farbvariation, Flechten, Schmutz
    lu, lv, cid, row = g.grid(8, 10, shift=0.5)
    rnd = g.white(cid, row, 1.0)
    curve = g.m("SINE", g.mul(lu, math.pi))
    overlap = g.m("POWER", lv, 1.6)
    tile_h = g.mul(curve, g.add(0.4, g.mul(overlap, 0.6)))
    gap = g.smooth(0.0, 0.06, g.m("MINIMUM", lu, g.sub(1.0, lu)))
    lichen = g.smooth(0.62, 0.72, g.noise(7, detail=6, off=3.3))
    spots = g.smooth(0.25, 0.1, g.voronoi(60, feature="F1", off=6.6))
    grime = g.noise(40, detail=6, off=8.8)
    col = g.ramp(rnd, [(0.0, "#7a3526"), (0.5, "#9a4a32"), (1.0, "#b0603f")])
    col = g.mixc(col, g.ramp(grime, [(0.0, "#3a2018"), (1.0, "#c07a5a")]), 0.35, "OVERLAY")
    col = g.mixc(g.cmul(col, 0.35), col, g.mul(gap, g.add(0.35, g.mul(overlap, 0.65))))
    col = g.mixc(col, "#a4a86a", g.mul(g.mul(lichen, spots), 0.7))
    height = g.mul(tile_h, gap)
    g.finish(col, g.lerp(0.85, 0.7, curve), height, bump=1.3, bump_dist=0.03)


def mat_stone(g):
    # Bruchsteinmauer: unregelmäßige Quader, tiefe Mörtelfugen, Kantenabrieb, Feuchte unten
    lu, lv, cid, row = g.grid(4, 7, jitter_rows=True)
    rnd = g.white(cid, row, 2.0)
    wob = g.noise(20, detail=4, off=1.2)
    e = g.edge(g.add(lu, g.mul(g.sub(wob, 0.5), 0.12)), g.add(lv, g.mul(g.sub(wob, 0.5), 0.1)), 0.09)
    face = g.noise(12, detail=8, rough=0.6, off=3.3)
    fine = g.noise(90, detail=5, off=5.5)
    chips = g.smooth(0.7, 0.78, g.noise(30, detail=6, off=7.7))
    col = g.ramp(g.add(g.mul(rnd, 0.5), g.mul(face, 0.5)), [(0.0, "#5a554c"), (0.5, "#7b746a"), (1.0, "#9a9285")])
    col = g.mixc(col, g.ramp(fine, [(0.0, "#3e3a34"), (1.0, "#b8b0a2")]), 0.3, "OVERLAY")
    col = g.mixc(col, "#4a453d", g.mul(chips, 0.5))
    col = g.mixc("#3b352c", col, e)
    height = g.sub(g.add(g.mul(e, 0.7), g.mul(face, 0.25)), g.mul(chips, 0.1))
    g.finish(col, g.lerp(0.95, 0.82, e), height, bump=1.5, bump_dist=0.05)


def mat_bark(g):
    furrow = g.noise(14, 2.5, detail=7, rough=0.6, distort=0.9, kind="RIDGED_MULTIFRACTAL", off=0.4)
    plates = g.voronoi(10, 3, feature="DISTANCE_TO_EDGE", off=1.7)
    fine = g.noise(80, 25, detail=5, off=2.9)
    moss = g.smooth(0.6, 0.72, g.noise(4, detail=6, off=5.2))
    ridge = g.smooth(0.0, 0.25, plates)
    col = g.ramp(g.add(g.mul(furrow, 0.6), g.mul(fine, 0.4)), [(0.0, "#1c140e"), (0.4, "#3e2d20"), (0.8, "#5f4a38"), (1.0, "#7b6653")])
    col = g.mixc(g.cmul(col, 0.4), col, ridge)
    col = g.mixc(col, "#44552a", g.mul(moss, 0.6))
    height = g.add(g.mul(ridge, 0.6), g.mul(furrow, 0.4))
    g.finish(col, 0.93, height, bump=1.6, bump_dist=0.05)


def mat_metal(g):
    # Geschmiedetes Eisen: Hammerschlag, Kratzer, Anlauffarben, Rost in Vertiefungen
    ham = g.voronoi(18, feature="F1", off=0.3)
    scratches = g.smooth(0.9, 1.0, g.noise(200, 3, detail=2, rough=0.4, kind="RIDGED_MULTIFRACTAL", off=2.2))
    rust_n = g.noise(6, detail=8, rough=0.6, off=4.4)
    rust = g.smooth(0.6, 0.72, g.add(rust_n, g.mul(g.sub(0.5, ham), 0.3)))
    col = g.ramp(g.noise(30, detail=5, off=1.1), [(0.0, "#3b3d42"), (0.5, "#5c5f66"), (1.0, "#7c8089")])
    col = g.mixc(col, "#a9adb5", g.mul(scratches, 0.5))
    col = g.mixc(col, g.ramp(rust_n, [(0.0, "#4a2512"), (0.5, "#8a4a22"), (1.0, "#b0692e")]), rust)
    height = g.sub(g.mul(ham, 0.3), g.mul(rust, 0.05))
    rough = g.lerp(g.lerp(0.42, 0.25, scratches), 0.9, rust)
    g.finish(col, rough, height, bump=0.5, bump_dist=0.01, metal=1.0)
    g.metal_mask = g.sub(1.0, rust)


def mat_cloth(g):
    # Leinengewebe: Kette und Schuss, Fadenverdickungen, Flecken
    warp = g.m("SINE", g.mul(g.u, TAU * 220))
    weft = g.m("SINE", g.mul(g.v, TAU * 220))
    check = g.m("SINE", g.add(g.mul(g.u, TAU * 110), g.mul(g.v, TAU * 110)))
    weave = g.add(g.mul(g.m("ABSOLUTE", warp), g.smooth(-0.2, 0.2, check)), g.mul(g.m("ABSOLUTE", weft), g.smooth(0.2, -0.2, check)))
    slub = g.noise(40, 4, detail=4, off=2.2)
    stain = g.smooth(0.6, 0.8, g.noise(3, detail=6, off=4.4))
    col = g.ramp(g.add(g.mul(weave, 0.5), g.mul(slub, 0.5)), [(0.0, "#8a8170"), (1.0, "#d6ccb8")])
    col = g.mixc(col, "#6a604f", g.mul(stain, 0.35))
    g.finish(col, 0.95, g.add(g.mul(weave, 0.6), g.mul(slub, 0.2)), bump=0.4, bump_dist=0.004)


def mat_leather(g):
    pores = g.voronoi(160, feature="F1", off=0.2)
    wrinkles = g.noise(8, detail=7, rough=0.6, distort=1.5, kind="RIDGED_MULTIFRACTAL", off=2.3)
    wear = g.smooth(0.55, 0.75, g.noise(5, detail=6, off=4.4))
    col = g.ramp(g.noise(12, detail=6, off=1.1), [(0.0, "#3a2416"), (0.5, "#5c3a22"), (1.0, "#744a2c")])
    col = g.mixc(col, "#8e6242", g.mul(wear, 0.5))
    col = g.mixc(col, "#24160d", g.mul(g.smooth(0.2, 0.05, pores), 0.4))
    height = g.add(g.mul(pores, 0.2), g.mul(wrinkles, 0.5))
    g.finish(col, g.lerp(0.72, 0.5, wear), height, bump=0.6, bump_dist=0.008)


def mat_skin(g):
    pores = g.voronoi(300, feature="F1", off=0.1)
    fine = g.noise(40, detail=6, off=1.4)
    blotch = g.noise(5, detail=5, off=3.3)
    col = g.ramp(blotch, [(0.0, "#e0b394"), (0.5, "#e8bea0"), (1.0, "#f0cbb0")])
    col = g.mixc(col, "#d59a86", g.mul(g.smooth(0.5, 0.8, blotch), 0.25))
    height = g.add(g.mul(pores, 0.3), g.mul(fine, 0.2))
    g.finish(col, g.lerp(0.62, 0.45, fine), height, bump=0.25, bump_dist=0.003)


MATERIALS = {
    # Gelände (Reihenfolge wie im Splat-Array des Clients)
    "grass": mat_grass, "dirt": mat_dirt, "rock": mat_rock, "sand": mat_sand,
    "forest": mat_forest, "glass": mat_glass, "snow": mat_snow, "cobble": mat_cobble,
    # Modelle
    "wood": mat_wood, "plaster": mat_plaster, "thatch": mat_thatch, "roof": mat_roof, "stone": mat_stone,
    "bark": mat_bark, "metal": mat_metal, "cloth": mat_cloth, "leather": mat_leather, "skin": mat_skin,
}
SMALL = {"cloth", "leather", "skin", "metal"}


# ---------------------------------------------------------------------------
# Backen
# ---------------------------------------------------------------------------

def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_plane_add(size=2)
    plane = bpy.context.active_object
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 1
    sc.render.bake.margin = 0
    sc.render.bake.use_clear = True
    return plane


def bake(plane, mat, kind, size, colorspace="sRGB", **kw):
    img = bpy.data.images.new(f"bake_{kind}", size, size, alpha=False, float_buffer=(colorspace != "sRGB"))
    img.colorspace_settings.name = colorspace if colorspace != "sRGB" else "sRGB"
    tn = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tn.image = img
    mat.node_tree.nodes.active = tn
    bpy.context.view_layer.objects.active = plane
    plane.select_set(True)
    bpy.ops.object.bake(type=kind, **kw)
    arr = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    mat.node_tree.nodes.remove(tn)
    bpy.data.images.remove(img)
    return arr.reshape(size, size, 4)


def save(arr, path, noncolor=False):
    """RGB-Array (0..1) als WebP speichern, ohne Farbumrechnung (Werte werden 1:1 geschrieben)."""
    h, w = arr.shape[:2]
    img = bpy.data.images.new("out", w, h, alpha=False)
    img.colorspace_settings.name = "Non-Color" if noncolor else "sRGB"
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(arr[..., :3], 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = "WEBP"
    img.save(filepath=path, quality=92)
    bpy.data.images.remove(img)


def blur(a, r):
    """Kachelnder Kastenfilter (Radius r) für die Umgebungsverdeckung."""
    out = a.copy()
    for axis in (0, 1):
        acc = np.zeros_like(out)
        for d in range(-r, r + 1):
            acc += np.roll(out, d, axis=axis)
        out = acc / (2 * r + 1)
    return out


def build(name):
    t0 = time.time()
    size = SIZE if name not in SMALL else max(512, SIZE // 2)
    plane = setup_scene()
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    plane.data.materials.append(mat)
    g = G(mat)
    MATERIALS[name](g)
    # Farbe (nur Grundfarbe, ohne Licht)
    color = bake(plane, mat, "DIFFUSE", size, pass_filter={"COLOR"})
    # Normalen (Tangentenraum)
    normal = bake(plane, mat, "NORMAL", size, colorspace="Non-Color", normal_space="TANGENT")
    # Rauheit
    rough = bake(plane, mat, "ROUGHNESS", size, colorspace="Non-Color")
    # Höhe über Emission
    nt = mat.node_tree
    nt.links.new(g.height_emit.outputs[0], g.out.inputs["Surface"])
    height = bake(plane, mat, "EMIT", size, colorspace="Non-Color")[..., 0]
    lo, hi = float(height.min()), float(height.max())
    height = (height - lo) / max(1e-6, hi - lo)
    # Umgebungsverdeckung aus der Höhe (Vertiefungen gegenüber der Umgebung)
    ao = np.ones_like(height)
    for r, k in ((2, 1.6), (8, 1.1), (24, 0.7)):
        rr = max(1, int(r * size / 1024))
        ao -= np.clip(blur(height, rr) - height, 0, 1) * k
    ao = np.clip(ao, 0.25, 1.0)
    # Blender speichert Pixel von unten nach oben; die Bildkoordinaten passen so zu UV (v nach oben).
    os.makedirs(OUT, exist_ok=True)
    save(color, os.path.join(OUT, f"{name}_color.webp"))
    nrm = normal.copy()
    save(nrm, os.path.join(OUT, f"{name}_normal.webp"), noncolor=True)
    arm = np.stack([ao, rough[..., 0], height], axis=-1)
    save(arm, os.path.join(OUT, f"{name}_arm.webp"), noncolor=True)
    print(f"[textur] {name}: {size}px in {time.time() - t0:.1f}s")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    names = [a for a in argv if not a.startswith("-")] or list(MATERIALS)
    for n in names:
        build(n)


main()
