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

    def st(self, x, lo=0.32, hi=0.68):
        """Rauschwerte (liegen meist eng um 0,5) auf 0…1 strecken."""
        return self.remap(x, lo, hi)

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
    dry = g.smooth(0.5, 0.68, g.noise(4, detail=7, off=4.2))
    soil = g.smooth(0.7, 0.85, g.add(g.noise(6, detail=7, rough=0.6, off=9.9), g.mul(g.sub(0.5, tufts), 0.3)))
    lush = g.ramp(g.st(patches), [(0.0, "#3d5a1e"), (0.35, "#52722a"), (0.7, "#6b8433"), (1.0, "#86903f")])
    shade = g.ramp(g.st(g.add(g.mul(tufts, 0.6), g.mul(speck, 0.4))), [(0.0, "#141f0b"), (0.5, "#283b15"), (1.0, "#3f5520")])
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
    peb_keep = g.smooth(0.42, 0.5, sep.outputs[1])
    peb_size = g.lerp(0.18, 0.34, sep.outputs[2])
    peb = g.mul(g.smooth(peb_size, g.mul(peb_size, 0.7), peb_d), peb_keep)
    peb_dome = g.mul(g.m("SQRT", g.m("MAXIMUM", g.sub(1.0, g.m("DIVIDE", peb_d, peb_size)), 0.0)), peb_keep)
    crack_mask = g.smooth(0.62, 0.72, g.noise(4, detail=5, off=7.7))
    cracks = g.mul(g.smooth(0.02, 0.0, g.voronoi(6, feature="DISTANCE_TO_EDGE", off=3.3)), crack_mask)
    roots = g.mul(g.smooth(0.975, 1.0, g.noise(2, 30, detail=3, rough=0.4, kind="RIDGED_MULTIFRACTAL", off=8.2)), 0.8)
    # Trockene, staubige Erde (Feldwege): helles Graubraun, feuchtere Klumpen dunkler
    col = g.ramp(g.st(g.add(g.mul(clumps, 0.6), g.mul(big, 0.4))), [(0.0, "#3e3124"), (0.3, "#5a4834"), (0.6, "#7a6449"), (0.85, "#8e785a"), (1.0, "#a08a6a")])
    col = g.mixc(col, g.ramp(g.st(crumbs), [(0.0, "#2e241a"), (1.0, "#b09a80")]), 0.4, "OVERLAY")
    wet = g.smooth(0.55, 0.75, g.noise(2.5, detail=6, off=3.8))
    col = g.mixc(col, g.cmul(col, 0.62), g.mul(wet, 0.6))
    pebc = g.ramp(peb_r, [(0.0, "#5e554b"), (0.5, "#7b7064"), (1.0, "#9a8f7f")])
    col = g.mixc(col, g.mixc(g.cmul(pebc, 0.6), pebc, peb_dome), peb)
    col = g.mixc(col, "#2a2017", g.mul(cracks, 0.6))
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
    crack_mask = g.smooth(0.45, 0.62, g.noise(3, detail=5, off=8.8))
    cracks = g.mul(g.smooth(0.028, 0.0, g.add(g.voronoi(3, 6, feature="DISTANCE_TO_EDGE", rand=1.0, off=5.1), g.mul(g.noise(30, detail=4, off=2.6), 0.02))), crack_mask)
    lichen = g.smooth(0.64, 0.74, g.noise(8, detail=6, off=6.6))
    spots = g.smooth(0.3, 0.12, g.voronoi(70, feature="F1", off=9.2))
    shape = g.add(g.mul(big, 0.55), g.add(g.mul(mid, 0.25), g.mul(strata, 0.2)))
    col = g.ramp(g.st(shape, 0.25, 0.75), [(0.0, "#2e2b27"), (0.3, "#4c4740"), (0.55, "#6a6359"), (0.8, "#878072"), (1.0, "#a39b8c")])
    col = g.mixc(col, g.ramp(g.st(strata), [(0.0, "#584c40"), (0.5, "#6f685e"), (1.0, "#948a7a")]), 0.3)
    col = g.mixc(col, g.ramp(g.st(fine), [(0.0, "#2a2724"), (1.0, "#c4bba9")]), 0.4, "OVERLAY")
    warmth = g.st(g.noise(1.5, detail=4, off=4.4))
    col = g.mixc(col, g.mixc(g.cmul(col, 0.9), g.mixc(col, "#8a7a62", 0.3), warmth), 0.6)
    col = g.mixc(col, "#1b1917", g.mul(cracks, 0.85))
    col = g.mixc(col, "#8d9a5b", g.mul(g.mul(lichen, spots), 0.65))
    col = g.mixc(col, "#d2cdbc", g.mul(g.mul(lichen, g.sub(1.0, spots)), 0.18))
    height = g.sub(g.add(g.st(shape, 0.25, 0.75), g.mul(fine, 0.12)), g.mul(cracks, 0.5))
    rough = g.remap(fine, 0.0, 1.0, 0.95, 0.7)
    g.finish(col, rough, height, bump=1.0, bump_dist=0.45)

def mat_sand(g):
    ripples = g.noise(2, 7, detail=3, rough=0.4, distort=1.5, off=0.4)
    rip = g.mul(g.add(g.m("SINE", g.mul(ripples, 14.0)), 1.0), 0.5)
    rip = g.mul(rip, g.st(g.noise(2, detail=3, off=2.9)))
    grains = g.noise(260, detail=2, rough=0.8, off=3.3)
    tint = g.noise(4, detail=6, off=6.1)
    shells = g.smooth(0.08, 0.02, g.voronoi(18, feature="F1", rand=1.0, off=8.8))
    col = g.ramp(g.st(tint), [(0.0, "#9a8664"), (0.5, "#bba684"), (1.0, "#d2c19e")])
    col = g.mixc(col, g.ramp(g.st(grains), [(0.0, "#6e5e48"), (1.0, "#f1e4c6")]), 0.4, "OVERLAY")
    col = g.mixc(col, g.cmul(col, 0.9), g.mul(rip, 0.6))
    debris = g.mul(g.smooth(0.12, 0.04, g.voronoi(30, feature="F1", off=5.2)), g.smooth(0.6, 0.7, g.noise(5, detail=4, off=1.7)))
    col = g.mixc(col, "#4a4133", g.mul(debris, 0.6))
    col = g.mixc(col, "#ece6da", g.mul(shells, 0.6))
    height = g.add(g.mul(rip, 0.3), g.add(g.mul(grains, 0.1), g.mul(shells, 0.2)))
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
    col = g.ramp(g.st(shape), [(0.0, "#a7b5c8"), (0.45, "#d6dee9"), (1.0, "#f6f9fd")])
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
    cellw = g.add(cell, g.mul(g.sub(g.noise(40, detail=4, off=6.6), 0.5), 0.012))
    stone = g.smooth(0.016, 0.03, cellw)
    t = g.remap(cellw, 0.016, 0.1)
    dome = g.m("SQRT", g.sub(1.0, g.m("POWER", g.sub(1.0, t), 2.0)))
    lumps = g.noise(45, detail=7, rough=0.62, off=2.5)
    pits = g.smooth(0.35, 0.15, g.voronoi(90, feature="F1", off=7.4))
    col_stone = g.ramp(rnd, [(0.0, "#46423d"), (0.2, "#5a5249"), (0.4, "#6e675c"), (0.6, "#7d7266"), (0.8, "#8a8274"), (1.0, "#6b6f70")])
    col_stone = g.mixc(col_stone, g.ramp(rnd2, [(0.0, "#5a5048"), (1.0, "#77756f")]), 0.3)
    col_stone = g.mixc(col_stone, g.ramp(g.st(lumps), [(0.0, "#2f2c29"), (1.0, "#bdb4a4")]), 0.4, "OVERLAY")
    col_stone = g.mixc(col_stone, "#3a3530", g.mul(pits, 0.4))
    grout = g.mixc("#2a2118", "#3c4a22", g.smooth(0.45, 0.62, g.noise(12, detail=5, off=8.1)))
    grout = g.mixc(grout, "#4a3b2c", g.mul(g.noise(70, detail=4, off=3.1), 0.5))
    edge_dark = g.smooth(0.0, 0.35, t)
    col = g.mixc(grout, g.mixc(g.cmul(col_stone, 0.55), col_stone, edge_dark), stone)
    col = g.mixc(col, g.cmul(col, 1.15), g.mul(g.smooth(0.75, 1.0, dome), 0.55))
    height = g.add(g.mul(stone, g.add(0.25, g.mul(dome, 0.6))), g.sub(g.mul(lumps, 0.15), g.mul(pits, 0.05)))
    rough = g.lerp(0.97, 0.58, g.mul(g.smooth(0.65, 1.0, dome), stone))
    g.finish(col, rough, height, bump=1.0, bump_dist=0.1)

def mat_wood(g):
    # Verwitterte Bohlen: unterschiedlich breite Bretter, grau ausgeblichene Oberfläche mit
    # braunem Kern in den Rillen, tiefe Maserung, Trockenrisse, Äste, Nagelköpfe, dunkle Fugen
    lu, lv, cid, row = g.grid(1, 6, jitter_rows=True)
    rnd = g.white(cid, row, 3.0)
    rnd2 = g.white(row, cid, 9.0)
    ofs = g.mul(rnd, 37.0)
    grain = g.noise(2.5, 140, detail=7, rough=0.6, distort=0.35, off=ofs)
    fibers = g.noise(6, 420, detail=3, rough=0.5, off=g.add(ofs, 3.0))
    rings = g.m("SINE", g.add(g.mul(g.noise(1.2, 30, detail=3, off=g.add(ofs, 2.2)), 55.0), g.mul(rnd, 20.0)))
    knots = g.smooth(0.1, 0.02, g.voronoi(2, 12, feature="F1", rand=1.0, off=4.1))
    knot_ring = g.mul(g.smooth(0.2, 0.1, g.voronoi(2, 12, feature="F1", rand=1.0, off=4.1)), g.sub(1.0, knots))
    checks = g.mul(g.smooth(0.965, 1.0, g.noise(1.5, 60, detail=3, rough=0.4, kind="RIDGED_MULTIFRACTAL", off=g.add(ofs, 7.0))), 1.0)
    seam = g.smooth(0.0, 0.04, g.m("MINIMUM", lv, g.sub(1.0, lv)))
    butt = g.smooth(0.0, 0.006, g.m("MINIMUM", lu, g.sub(1.0, lu)))
    nail_d = g.m("MINIMUM", g.m("ABSOLUTE", g.sub(lu, 0.03)), g.m("ABSOLUTE", g.sub(lu, 0.97)))
    nails = g.mul(g.smooth(0.012, 0.006, g.m("MAXIMUM", nail_d, g.mul(g.m("ABSOLUTE", g.sub(lv, 0.5)), 0.15))), 1.0)
    weather = g.smooth(0.25, 0.75, g.add(g.mul(rnd2, 0.6), g.mul(g.noise(3, 12, detail=4, off=5.5), 0.4)))
    brown = g.ramp(g.add(g.mul(grain, 0.6), g.mul(rings, 0.15)), [(0.0, "#3e2a1a"), (0.5, "#65472d"), (1.0, "#86623f")])
    grey = g.ramp(g.add(g.mul(grain, 0.5), g.mul(fibers, 0.5)), [(0.0, "#4f4a42"), (0.5, "#7c766a"), (1.0, "#9d968a")])
    col = g.mixc(brown, grey, g.mul(weather, g.smooth(0.3, 0.6, grain)))
    col = g.mixc(col, g.ramp(fibers, [(0.0, "#2e241a"), (1.0, "#a39580")]), 0.25, "OVERLAY")
    col = g.mixc(col, g.ramp(rnd, [(0.0, "#6b5540"), (1.0, "#9a8468")]), 0.25, "OVERLAY")
    col = g.mixc(col, "#2a1b10", g.mul(knots, 0.85))
    col = g.mixc(col, "#4a3322", g.mul(knot_ring, 0.5))
    col = g.mixc(col, "#1c140d", g.mul(checks, 0.8))
    col = g.mixc(col, "#2b2622", g.mul(nails, 0.9))
    col = g.mixc("#16100a", col, g.m("MINIMUM", seam, butt))
    height = g.sub(g.add(g.add(g.mul(grain, 0.3), g.mul(fibers, 0.08)), g.mul(g.m("MINIMUM", seam, butt), 0.6)), g.add(g.mul(checks, 0.25), g.mul(knots, 0.06)))
    rough = g.lerp(g.lerp(0.78, 0.92, weather), 0.6, nails)
    g.finish(col, rough, height, bump=1.0, bump_dist=0.025)
    g.cavity = 0.5


def mat_plaster(g):
    # Gekalkter Lehmputz: wolkige Kellenstruktur, mehrere Kalkschichten, Laufspuren von Regen,
    # Haarrisse, abgeplatzte Stellen mit Lehm darunter, Schmutz
    trowel = g.noise(5, detail=8, rough=0.58, distort=0.9, off=0.1)
    swirl = g.noise(16, detail=5, rough=0.5, distort=2.5, off=3.7)
    grain = g.noise(200, detail=3, off=2.2)
    runs = g.noise(14, 1.5, detail=6, rough=0.6, off=5.3)
    run_m = g.mul(g.smooth(0.5, 0.72, runs), g.smooth(0.45, 0.65, g.noise(3, detail=4, off=1.9)))
    crack_mask = g.smooth(0.62, 0.72, g.noise(4, detail=4, off=6.2))
    cracks = g.mul(g.smooth(0.01, 0.0, g.voronoi(5, feature="DISTANCE_TO_EDGE", off=4.4)), crack_mask)
    fall_n = g.noise(2.5, detail=9, rough=0.66, off=9.1)
    fallen = g.smooth(0.63, 0.637, fall_n)
    rim = g.sub(g.smooth(0.61, 0.63, fall_n), fallen)
    wash = g.st(g.noise(2, detail=5, off=8.4))
    col = g.ramp(g.st(trowel), [(0.0, "#a89b82"), (0.4, "#c4b89f"), (0.75, "#d6ccb6"), (1.0, "#e2d9c6")])
    col = g.mixc(col, g.ramp(g.st(swirl), [(0.0, "#b5a88f"), (1.0, "#efe7d6")]), 0.35, "OVERLAY")
    col = g.mixc(col, g.ramp(grain, [(0.0, "#9c917c"), (1.0, "#f3eee2")]), 0.22, "OVERLAY")
    col = g.mixc(col, "#ece6d8", g.mul(wash, 0.35))
    col = g.mixc(col, "#877a62", g.mul(run_m, 0.5))
    dirt = g.smooth(0.5, 0.8, g.noise(3, detail=7, rough=0.62, off=7.3))
    col = g.mixc(col, g.ramp(grain, [(0.0, "#6f6453"), (1.0, "#a59a86")]), g.mul(dirt, 0.4))
    col = g.mixc(col, "#6b604f", g.mul(cracks, 0.75))
    loam = g.ramp(g.noise(60, detail=6, off=3.9), [(0.0, "#5c4632"), (0.5, "#7a5f42"), (1.0, "#957757")])
    straw = g.smooth(0.85, 0.95, g.noise(90, 8, detail=2, kind="RIDGED_MULTIFRACTAL", off=6.1))
    loam = g.mixc(loam, "#a88f5a", g.mul(straw, 0.5))
    col = g.mixc(col, loam, fallen)
    col = g.mixc(col, "#8a7c66", g.mul(rim, 0.6))
    height = g.sub(g.add(g.add(g.mul(trowel, 0.25), g.mul(swirl, 0.15)), g.mul(grain, 0.06)), g.add(g.mul(fallen, 0.5), g.mul(cracks, 0.2)))
    rough = g.lerp(g.lerp(0.93, 0.85, trowel), 0.97, fallen)
    g.finish(col, rough, height, bump=1.0, bump_dist=0.05)
    g.cavity = 0.35


def mat_thatch(g):
    # Altes Reetdach: lagenweise gebundene Halmbündel (Halme verlaufen dachabwärts), ausgeblichen
    # graubraun, dunkle Lagenschatten, Moos und Algen, einzelne helle neue Halme
    lu, lv, cid, row = g.grid(6, 4, jitter_rows=True)
    rnd = g.white(cid, row, 5.0)
    strands = g.noise(220, 5, detail=4, rough=0.6, kind="RIDGED_MULTIFRACTAL", off=0.3)
    strands2 = g.noise(120, 3, detail=4, rough=0.6, off=g.mul(rnd, 20.0))
    clump = g.noise(14, 2, detail=5, off=6.2)
    layer = g.m("POWER", lv, 0.55)
    tips = g.smooth(0.12, 0.0, lv)
    moss = g.smooth(0.58, 0.72, g.add(g.noise(5, detail=7, off=5.5), g.mul(g.sub(0.5, lv), 0.2)))
    fresh = g.smooth(0.82, 0.92, g.noise(160, 2, detail=2, off=9.4))
    col = g.ramp(g.add(g.mul(strands, 0.55), g.mul(strands2, 0.45)), [(0.0, "#4a3f2c"), (0.45, "#7d6c4c"), (0.8, "#a08c66"), (1.0, "#b8a680")])
    col = g.mixc(col, g.ramp(rnd, [(0.0, "#5a4c36"), (1.0, "#9a8866")]), 0.3, "OVERLAY")
    col = g.mixc(col, g.ramp(g.st(clump), [(0.0, "#4a4032"), (1.0, "#8e7f64")]), 0.4, "OVERLAY")
    col = g.mixc(col, "#b9a577", g.mul(fresh, 0.35))
    col = g.mixc(g.cmul(col, 0.55), col, g.add(g.mul(layer, 0.8), g.mul(clump, 0.2)))
    col = g.mixc(col, g.ramp(g.noise(90, detail=5, off=1.9), [(0.0, "#26301a"), (1.0, "#5d6a2e")]), g.mul(moss, 0.75))
    col = g.mixc(col, "#2a2218", g.mul(tips, 0.3))
    height = g.add(g.add(g.mul(strands, 0.3), g.mul(clump, 0.15)), g.add(g.mul(layer, 0.55), g.mul(moss, 0.1)))
    g.finish(col, g.lerp(0.9, 0.96, moss), height, bump=1.2, bump_dist=0.035)
    g.cavity = 0.6
    _ = lu


def mat_roof(g):
    # Gealterte Biberschwanz-Tonziegel: versetzte Reihen, gerundete Unterkante, jeder Ziegel eigene
    # Farbe/Neigung, Ruß und Schmutz, Moospolster in den Überlappungen, Flechten, einzelne Bruchstücke
    lu, lv, cid, row = g.grid(7, 9, shift=0.5)
    rnd = g.white(cid, row, 1.0)
    rnd2 = g.white(cid, row, 4.0)
    rnd3 = g.white(cid, row, 7.0)
    cx = g.sub(lu, 0.5)
    # Biberschwanz: unten gerundet (lv klein = Unterkante sichtbar)
    arc = g.sub(lv, g.mul(g.sub(1.0, g.m("SQRT", g.m("MAXIMUM", g.sub(1.0, g.mul(g.mul(cx, cx), 3.6)), 0.0))), 0.9))
    body = g.smooth(-0.02, 0.03, arc)
    side = g.smooth(0.0, 0.05, g.m("MINIMUM", lu, g.sub(1.0, lu)))
    tile = g.mul(body, side)
    thick = g.mul(g.m("POWER", g.m("MAXIMUM", lv, 0.0), 0.6), g.add(0.7, g.mul(rnd2, 0.3)))
    surf = g.noise(40, detail=6, rough=0.6, off=2.2)
    grime = g.noise(9, detail=7, off=8.8)
    soot = g.st(g.noise(2, 4, detail=5, off=5.7), 0.4, 0.7)
    moss = g.mul(g.smooth(0.5, 0.66, g.noise(5, detail=7, off=3.3)), g.smooth(0.5, 0.0, lv))
    lichen = g.mul(g.smooth(0.6, 0.7, g.noise(8, detail=6, off=1.4)), g.smooth(0.25, 0.08, g.voronoi(70, feature="F1", off=6.6)))
    col = g.ramp(rnd, [(0.0, "#4e2e24"), (0.3, "#643a2b"), (0.6, "#744634"), (0.85, "#80543f"), (1.0, "#6a4a3c")])
    col = g.mixc(col, g.ramp(g.st(surf), [(0.0, "#3a2219"), (1.0, "#b98567")]), 0.45, "OVERLAY")
    col = g.mixc(col, g.cmul(col, 0.6), g.smooth(0.75, 0.95, rnd3))
    col = g.mixc(col, "#8f7d6a", g.mul(g.smooth(0.1, 0.0, rnd3), 0.5))
    col = g.mixc(col, g.ramp(g.st(grime), [(0.0, "#2a1d17"), (1.0, "#6b5a4c")]), g.add(g.mul(soot, 0.5), 0.15))
    col = g.mixc(col, g.cmul(col, 0.7), g.smooth(0.6, 1.0, lv))
    col = g.mixc(col, g.ramp(g.noise(120, detail=4, off=4.2), [(0.0, "#2c3a18"), (1.0, "#687a33")]), g.mul(moss, 0.85))
    col = g.mixc(col, "#b3b08a", g.mul(lichen, 0.6))
    col = g.mixc("#2a1e17", col, tile)
    height = g.add(g.mul(tile, g.add(thick, g.mul(surf, 0.08))), g.mul(moss, 0.15))
    rough = g.lerp(0.95, g.lerp(0.8, 0.95, moss), tile)
    g.finish(col, rough, height, bump=1.3, bump_dist=0.035)
    g.cavity = 0.55


def mat_stone(g):
    # Lagerhaftes Bruchsteinmauerwerk: Steinreihen mit wechselnden Längen, unregelmäßig
    # behauene, gewölbte Steine mit gerundeten Ecken, breite zurückliegende Kalkmörtelfugen
    # mit Schmutz, Meißelspuren, Kantenabplatzer, Flechten
    nu, nv = 3, 6
    lu, lv, cid, row = g.grid(nu, nv, jitter_rows=True)
    rnd = g.white(cid, row, 2.0)
    rnd2 = g.white(cid, row, 6.0)
    rnd3 = g.white(row, cid, 8.0)
    # Manche Steine sind geteilt (zwei kurze statt eines langen)
    split = g.smooth(0.55, 0.56, rnd3)
    lu2 = g.lerp(lu, g.m("FRACT", g.mul(lu, 2.0)), split)
    wob1 = g.noise(9, detail=6, rough=0.62, off=1.2)
    wob2 = g.noise(9, detail=6, rough=0.62, off=4.6)
    # Abstand zum Steinrand in Metern-ähnlichen Einheiten (Stein ist breiter als hoch)
    du = g.mul(g.m("MINIMUM", lu2, g.sub(1.0, lu2)), g.lerp(1.0 / nu, 0.5 / nu, split))
    dv = g.mul(g.m("MINIMUM", lv, g.sub(1.0, lv)), 1.0 / nv)
    du = g.add(du, g.mul(g.sub(g.st(wob1), 0.5), 0.05))
    dv = g.add(dv, g.mul(g.sub(g.st(wob2), 0.5), 0.034))
    # Gerundete Ecken: weicher Minimum-Ersatz
    corner = g.m("SQRT", g.add(g.mul(g.m("MAXIMUM", g.sub(0.03, du), 0.0), g.m("MAXIMUM", g.sub(0.03, du), 0.0)), g.mul(g.m("MAXIMUM", g.sub(0.03, dv), 0.0), g.m("MAXIMUM", g.sub(0.03, dv), 0.0))))
    de = g.sub(g.m("MINIMUM", g.m("MINIMUM", du, dv), 0.03), corner)
    joint = g.lerp(0.006, 0.013, rnd2)
    stone = g.smooth(joint, g.add(joint, 0.006), de)
    t = g.remap(de, 0.005, 0.045)
    dome = g.m("SQRT", g.sub(1.0, g.m("POWER", g.sub(1.0, t), 2.0)))
    face = g.noise(9, detail=9, rough=0.62, distort=0.5, off=3.3)
    chisel = g.noise_diag(40, 4, 1.0, detail=3, rough=0.5, off=4.9)
    fine = g.noise(120, detail=5, rough=0.6, off=5.5)
    pits = g.smooth(0.28, 0.08, g.voronoi(150, feature="F1", off=7.1))
    chips = g.mul(g.smooth(0.7, 0.78, g.noise(22, detail=6, off=7.7)), g.smooth(0.35, 0.0, t))
    base = g.ramp(rnd, [(0.0, "#5c5549"), (0.25, "#726a5c"), (0.5, "#8a806d"), (0.75, "#9d927d"), (1.0, "#7e7870")])
    warm = g.ramp(rnd2, [(0.0, "#807d78"), (0.5, "#8f8470"), (1.0, "#9c8466")])
    col = g.mixc(base, warm, 0.35)
    col = g.mixc(col, g.ramp(g.st(face), [(0.0, "#443f38"), (1.0, "#c2b8a4")]), 0.4, "OVERLAY")
    col = g.mixc(col, g.ramp(g.st(fine), [(0.0, "#39352e"), (1.0, "#cfc6b4")]), 0.3, "OVERLAY")
    col = g.mixc(col, "#3d3831", g.mul(pits, 0.3))
    col = g.mixc(col, "#b1a793", g.mul(chips, 0.45))
    col = g.mixc(g.cmul(col, 0.72), col, g.smooth(0.0, 0.6, t))
    lichen = g.mul(g.smooth(0.66, 0.76, g.noise(6, detail=6, off=6.6)), g.smooth(0.3, 0.1, g.voronoi(55, feature="F1", off=9.2)))
    col = g.mixc(col, "#8f9460", g.mul(lichen, 0.5))
    mortar = g.ramp(g.noise(70, detail=5, off=8.1), [(0.0, "#6a6356"), (0.5, "#8d8574"), (1.0, "#a39b8a")])
    mortar = g.mixc(mortar, "#3a3229", g.mul(g.smooth(0.45, 0.75, g.noise(9, detail=5, off=2.4)), 0.65))
    col = g.mixc(mortar, col, stone)
    height = g.add(g.mul(stone, g.add(0.3, g.mul(dome, 0.5))), g.sub(g.add(g.mul(g.st(face), 0.2), g.mul(chisel, 0.03)), g.add(g.mul(pits, 0.04), g.mul(chips, 0.1))))
    rough = g.lerp(0.97, g.lerp(0.9, 0.78, fine), stone)
    g.finish(col, rough, height, bump=1.4, bump_dist=0.06)
    g.cavity = 0.55


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
    # Geschmiedetes Eisen: Zunder und Hammerschlag, Kratzer an Kanten, Anlauffarben,
    # Rost in Vertiefungen und Flecken
    ham = g.voronoi(16, feature="F1", off=0.3)
    ham2 = g.voronoi(40, feature="F1", off=1.9)
    scratches = g.smooth(0.9, 1.0, g.noise(220, 3, detail=2, rough=0.4, kind="RIDGED_MULTIFRACTAL", off=2.2))
    rust_n = g.noise(6, detail=9, rough=0.62, off=4.4)
    rust = g.smooth(0.58, 0.72, g.add(rust_n, g.mul(g.sub(0.5, ham), 0.35)))
    pitting = g.mul(g.smooth(0.3, 0.1, g.voronoi(160, feature="F1", off=6.3)), rust)
    scale_n = g.noise(20, detail=6, off=1.1)
    # Bei Metallen ist die Grundfarbe die Reflexionsfarbe (Eisen ≈ 0,5 linear) – dunkel wirkt es durch Rauheit
    col = g.ramp(g.st(scale_n), [(0.0, "#7a7c80"), (0.5, "#8e9095"), (1.0, "#a3a5aa")])
    col = g.mixc(col, g.ramp(ham2, [(0.0, "#a9acb2"), (1.0, "#75777c")]), 0.3)
    col = g.mixc(col, "#c4c7cd", g.mul(scratches, 0.45))
    col = g.mixc(col, g.ramp(rust_n, [(0.0, "#35200f"), (0.4, "#5a3219"), (0.7, "#744324"), (1.0, "#8a5a33")]), rust)
    col = g.mixc(col, "#2a150b", g.mul(pitting, 0.6))
    height = g.sub(g.add(g.mul(ham, 0.3), g.mul(ham2, 0.1)), g.add(g.mul(rust, 0.04), g.mul(pitting, 0.1)))
    rough = g.lerp(g.lerp(0.55, 0.3, scratches), 0.92, rust)
    g.finish(col, rough, height, bump=0.6, bump_dist=0.01, metal=1.0)
    g.metal_mask = g.sub(1.0, rust)
    g.cavity = 0.3


def mat_cloth(g):
    # Leinengewebe: Kette und Schuss, Fadenverdickungen, Flecken
    warp = g.m("SINE", g.mul(g.u, TAU * 220))
    weft = g.m("SINE", g.mul(g.v, TAU * 220))
    check = g.m("SINE", g.add(g.mul(g.u, TAU * 110), g.mul(g.v, TAU * 110)))
    weave = g.add(g.mul(g.m("ABSOLUTE", warp), g.smooth(-0.2, 0.2, check)), g.mul(g.m("ABSOLUTE", weft), g.smooth(0.2, -0.2, check)))
    slub = g.noise(40, 4, detail=4, off=2.2)
    stain = g.smooth(0.6, 0.8, g.noise(3, detail=6, off=4.4))
    col = g.ramp(g.add(g.mul(weave, 0.5), g.mul(g.st(slub), 0.5)), [(0.0, "#7e7564"), (1.0, "#d6ccb8")])
    col = g.mixc(col, g.ramp(g.st(g.noise(4, detail=5, off=6.1)), [(0.0, "#a39a88"), (1.0, "#d8cfbd")]), 0.4, "MULTIPLY")
    col = g.mixc(col, "#5e5445", g.mul(stain, 0.4))
    g.finish(col, 0.95, g.add(g.mul(weave, 0.6), g.mul(slub, 0.2)), bump=0.4, bump_dist=0.004)


def mat_leather(g):
    pores = g.voronoi(160, feature="F1", off=0.2)
    wrinkles = g.noise(8, detail=7, rough=0.6, distort=1.5, kind="RIDGED_MULTIFRACTAL", off=2.3)
    wear = g.smooth(0.55, 0.75, g.noise(5, detail=6, off=4.4))
    col = g.ramp(g.st(g.noise(12, detail=6, off=1.1)), [(0.0, "#3a2416"), (0.5, "#5c3a22"), (1.0, "#744a2c")])
    col = g.mixc(col, "#8e6242", g.mul(wear, 0.55))
    col = g.mixc(col, "#2a1a10", g.mul(g.smooth(0.8, 0.95, wrinkles), 0.5))
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
    # Farbe (nur Grundfarbe, ohne Licht); Metall liefert im Diffus-Pass sonst Schwarz
    metal_in = g.bsdf.inputs["Metallic"]
    metal_val = metal_in.default_value
    metal_in.default_value = 0.0
    color = bake(plane, mat, "DIFFUSE", size, pass_filter={"COLOR"})
    metal_in.default_value = metal_val
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
    # Hohlraum-Verschattung wie in Foto-Scans: Fugen und Rillen auch im direkten Licht dunkler
    cav = getattr(g, "cavity", 0.35)
    if cav > 0:
        color[..., :3] *= (1.0 - cav + cav * ao)[..., None] ** 1.0
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
