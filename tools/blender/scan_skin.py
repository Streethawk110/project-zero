"""Fotografische Gesichtshaut aus einem Kopfscan auf die MakeHuman-Figur übertragen.

Quelle: „Lee Perry-Smith“-Kopfscan von Infinite-Realities (CC BY 3.0), wie er im three.js-Repository
liegt (examples/models/gltf/LeePerrySmith). Die Dateien werden beim Backen nach .mh_cache geladen und
nicht ins Repository übernommen; im Repository landen nur die daraus gebackenen Hauttexturen
(Namensnennung in der README).

Ablauf:
1. Scan laden, in den Rig-Raum drehen (Blender: z oben, −y vorn → Rig: y oben, z vorn).
2. An vier Orientierungspunkten (Augen, Nasenspitze, Mund) auf das Gesicht der Figur skalieren
   (getrennt in Breite und Höhe) und verschieben.
3. Für jeden Kopf-Texel der Figur einen Strahl entlang der Normalen auf den Scan werfen, dort die
   Scan-UV bestimmen und Farbe und Normalen (Tangentenraum des Scans → Tangentenraum der Figur) lesen.
"""
import os
import urllib.request

import numpy as np

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".mh_cache")
BASE_URL = "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/LeePerrySmith/"
FILES = ["LeePerrySmith.glb", "Map-COL.jpg", "Infinite-Level_02_Tangent_SmoothUV.jpg"]
# Orientierungspunkte in der Farbtextur (Pixel, 1024², Ursprung oben links): Augenmitten (nicht die
# roten Punkte an den inneren Augenwinkeln), Nasenspitze, Mundspalte
LM_PX = {"eye_a": (437, 304), "eye_b": (585, 304), "nose": (512.5, 400), "mouth": (512.5, 478)}


def fetch():
    os.makedirs(CACHE, exist_ok=True)
    paths = {}
    for f in FILES:
        p = os.path.join(CACHE, "lps__" + f)
        if not os.path.exists(p):
            print(f"[scan] lade {f}", flush=True)
            urllib.request.urlretrieve(BASE_URL + f, p)
        paths[f] = p
    return paths


def load_image(path):
    """Bild über Blender laden (Zeilen von oben nach unten, RGB 0…1, sRGB-Werte)."""
    import bpy
    im = bpy.data.images.load(path)
    im.colorspace_settings.name = "Non-Color"
    w, h = im.size
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1, :, :3].copy()
    bpy.data.images.remove(im)
    return a


def box_blur(img, r):
    """Weichzeichnen: dreimal Kastenfilter (≈ Gauß) mit Radius r in beide Richtungen."""
    out = img.copy()
    for _ in range(3):
        for ax in (0, 1):
            c = np.cumsum(np.pad(out, [(r + 1, r) if a == ax else (0, 0) for a in range(3)], mode="edge"), axis=ax)
            if ax == 0:
                out = (c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1)
            else:
                out = (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)
    return out


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def bilinear(img, u, v):
    """Abtastung mit der UV des importierten Scans (v = Bildzeile von oben, empirisch geprüft)."""
    h, w = img.shape[:2]
    x = np.clip(u * w - 0.5, 0, w - 1.001)
    y = np.clip(v * h - 0.5, 0, h - 1.001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = (x - x0)[:, None], (y - y0)[:, None]
    a = img[y0, x0] * (1 - fx) + img[y0, x0 + 1] * fx
    b = img[y0 + 1, x0] * (1 - fx) + img[y0 + 1, x0 + 1] * fx
    return a * (1 - fy) + b * fy


class Scan:
    def __init__(self):
        import bpy
        paths = fetch()
        self.col = load_image(paths["Map-COL.jpg"])
        self.nrm = load_image(paths["Infinite-Level_02_Tangent_SmoothUV.jpg"])
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=paths["LeePerrySmith.glb"])
        objs = [o for o in bpy.data.objects if o not in before]
        mesh_o = next(o for o in objs if o.type == "MESH")
        me = mesh_o.data
        me.calc_loop_triangles()
        M = np.array(mesh_o.matrix_world)
        co = np.array([v.co[:] for v in me.vertices])
        co = co @ M[:3, :3].T + M[:3, 3]
        # Blender (x, y, z) → Rig (x, z, −y)
        self.v = np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)
        uvl = me.uv_layers[0].data
        self.tris = np.array([t.vertices[:] for t in me.loop_triangles])
        self.tuv = np.array([[uvl[l].uv[:] for l in t.loops] for t in me.loop_triangles])
        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)
        # Weichzeichnen nur innerhalb der belegten UV-Inseln (sonst blutet der orange Hintergrund der
        # Textur in die Ränder, z. B. am Kinn)
        mask = self.uv_mask(self.col.shape[0])
        m3 = mask[..., None]
        num = box_blur(self.col * m3, 4)
        den = box_blur(np.repeat(m3, 3, axis=2), 4)
        self.col_blur = np.where(den > 1e-3, num / np.maximum(den, 1e-3), self.col)

    def uv_mask(self, size):
        m = np.zeros((size, size), np.float32)
        for uv in self.tuv:
            px = uv[:, 0] * size
            py = uv[:, 1] * size  # Zeile von oben (siehe bilinear)
            x0, x1 = int(max(px.min() - 1, 0)), int(min(px.max() + 1, size - 1))
            y0, y1 = int(max(py.min() - 1, 0)), int(min(py.max() + 1, size - 1))
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            (ax, ay), (bx, by), (cx, cy) = zip(px, py)
            den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(den) < 1e-9:
                continue
            l0 = ((by - cy) * (xs - cx) + (cx - bx) * (ys - cy)) / den
            l1 = ((cy - ay) * (xs - cx) + (ax - cx) * (ys - cy)) / den
            inside = (l0 >= -0.05) & (l1 >= -0.05) & (1 - l0 - l1 >= -0.05)
            m[y0:y1 + 1, x0:x1 + 1] = np.maximum(m[y0:y1 + 1, x0:x1 + 1], inside)
        return m

    def uv_point(self, u, v):
        for k, uv in enumerate(self.tuv):
            a, b, c = uv
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-12:
                continue
            l0 = ((b[1] - c[1]) * (u - c[0]) + (c[0] - b[0]) * (v - c[1])) / den
            l1 = ((c[1] - a[1]) * (u - c[0]) + (a[0] - c[0]) * (v - c[1])) / den
            l2 = 1 - l0 - l1
            if min(l0, l1, l2) >= -1e-4:
                P = self.v[self.tris[k]]
                return l0 * P[0] + l1 * P[1] + l2 * P[2]
        raise ValueError(f"UV {u, v} nicht auf dem Scan")

    def landmarks(self):
        out = {}
        for k, (px, py) in LM_PX.items():
            # UV v des importierten Scans = Bildzeile von oben. Liegt der Punkt in einem Loch (Augen),
            # den Mittelwert der Treffer auf einem Ring darum nehmen
            try:
                out[k] = self.uv_point(px / 1024, py / 1024)
            except ValueError:
                ring = []
                for a in np.linspace(0, 2 * np.pi, 16, endpoint=False):
                    for r in (14, 20, 28):
                        try:
                            ring.append(self.uv_point((px + r * np.cos(a)) / 1024, (py + r * 0.6 * np.sin(a)) / 1024))
                            break
                        except ValueError:
                            continue
                out[k] = np.mean(ring, axis=0)
        # Nasenspitze: vorderster Punkt in der Nähe des Texturpunkts
        near = np.linalg.norm(self.v - out["nose"], axis=1) < 0.6
        out["nose"] = self.v[near][np.argmax(self.v[near][:, 2])]
        return out

    def fit(self, eyes_our, nose_our, mouth_our):
        """Scan auf die Figur skalieren/verschieben (Breite nach Augenabstand, Höhe nach Auge–Mund)."""
        lm = self.landmarks()
        ea, eb = lm["eye_a"], lm["eye_b"]
        s_eyes = (ea + eb) / 2
        o_eyes = (eyes_our[0] + eyes_our[1]) / 2
        sx = abs(eyes_our[0][0] - eyes_our[1][0]) / abs(ea[0] - eb[0])
        sy = (o_eyes[1] - mouth_our[1]) / (s_eyes[1] - lm["mouth"][1])
        sz = (sx + sy) / 2
        s = np.array([sx, sy, sz])
        v = (self.v - s_eyes) * s
        # Tiefe: Nasenspitzen übereinander
        nose_s = (lm["nose"] - s_eyes) * s
        off = np.array([o_eyes[0], o_eyes[1], nose_our[2] - nose_s[2]])
        self.vf = v + off
        print(f"[scan] Skalierung {sx:.4f} {sy:.4f}, Abweichung Mund {((lm['mouth'] - s_eyes) * s + off - mouth_our).round(4)}", flush=True)
        # Tangentenrahmen je Dreieck (T = dP/du, B = dP/dv)
        P = self.vf[self.tris]
        e1, e2 = P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]
        d1, d2 = self.tuv[:, 1] - self.tuv[:, 0], self.tuv[:, 2] - self.tuv[:, 0]
        r = d1[:, 0] * d2[:, 1] - d2[:, 0] * d1[:, 1]
        r = np.where(np.abs(r) < 1e-12, 1e-12, r)
        self.T = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2]) / r[:, None]
        self.B = (e2 * d1[:, 0:1] - e1 * d2[:, 0:1]) / r[:, None]
        n = np.cross(e1, e2)
        self.N = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
        from mathutils.bvhtree import BVHTree
        from mathutils import Vector
        self.bvh = BVHTree.FromPolygons([Vector(p) for p in self.vf], [tuple(int(i) for i in t) for t in self.tris])

    def project(self, P, N, T, B, max_d=0.03):
        """Für Punkte P mit Normalen N und Tangentenrahmen (T, B) der Figur: Farbe (linear), Normale
        (Tangentenraum der Figur), geglättete Farbe und Trefferabstand (inf = kein Treffer)."""
        from mathutils import Vector
        n = len(P)
        col = np.zeros((n, 3), np.float32)
        colb = np.zeros((n, 3), np.float32)
        nts = np.tile(np.array([0, 0, 1.0], np.float32), (n, 1))
        dist = np.full(n, np.inf, np.float32)
        hit_f = np.full(n, -1)
        hit_p = np.zeros((n, 3))
        for i in range(n):
            p, nn = P[i], N[i]
            best = None
            for sgn in (1.0, -1.0):
                o = Vector(p + nn * max_d * sgn)
                loc, _, idx, d = self.bvh.ray_cast(o, Vector(-nn * sgn), max_d * 2)
                if loc is not None:
                    dd = abs(d - max_d)
                    if best is None or dd < best[0]:
                        best = (dd, idx, loc)
            if best is not None:
                dist[i], hit_f[i], hit_p[i] = best[0], best[1], best[2][:]
        ok = hit_f >= 0
        f = hit_f[ok]
        Pt = self.vf[self.tris[f]]
        # baryzentrische Koordinaten des Treffers
        v0, v1, v2 = Pt[:, 1] - Pt[:, 0], Pt[:, 2] - Pt[:, 0], hit_p[ok] - Pt[:, 0]
        d00, d01, d11 = (v0 * v0).sum(1), (v0 * v1).sum(1), (v1 * v1).sum(1)
        d20, d21 = (v2 * v0).sum(1), (v2 * v1).sum(1)
        den = np.where(np.abs(d00 * d11 - d01 * d01) < 1e-18, 1e-18, d00 * d11 - d01 * d01)
        b1 = (d11 * d20 - d01 * d21) / den
        b2 = (d00 * d21 - d01 * d20) / den
        b0 = 1 - b1 - b2
        uv = self.tuv[f]
        u = b0 * uv[:, 0, 0] + b1 * uv[:, 1, 0] + b2 * uv[:, 2, 0]
        v = b0 * uv[:, 0, 1] + b1 * uv[:, 1, 1] + b2 * uv[:, 2, 1]
        raw = bilinear(self.col, u, v)
        # Einfarbige Füllflächen der Scan-Textur (Mundinneres, Halsboden, Hintergrund) sind keine Haut:
        # solche Treffer verwerfen (werden später aus der Nachbarschaft gefüllt)
        fill = np.abs(raw - np.array([174, 122, 111]) / 255.0).max(axis=1) < 0.035
        bad = np.where(ok)[0][fill]
        dist[bad] = np.inf
        col[ok] = srgb_to_linear(raw)
        colb[ok] = srgb_to_linear(bilinear(self.col_blur, u, v))
        ns = bilinear(self.nrm, u, v) * 2 - 1
        ns[:, 1] = -ns[:, 1]  # Grün zeigt im Bild nach oben, dP/dv zeigt hier nach unten
        # Tangentenraum Scan → Welt → Tangentenraum Figur (nur die Neigung, Geometrie bleibt die eigene)
        def unit(x):
            return x / np.maximum(np.linalg.norm(x, axis=1, keepdims=True), 1e-12)
        Ts, Bs, Ns = unit(self.T[f]), unit(self.B[f]), self.N[f]
        Ts = unit(Ts - Ns * (Ts * Ns).sum(1, keepdims=True))
        Bs = unit(Bs - Ns * (Bs * Ns).sum(1, keepdims=True))
        To, Bo, No = unit(T[ok]), unit(B[ok]), N[ok]
        To = unit(To - No * (To * No).sum(1, keepdims=True))
        Bo = unit(Bo - No * (Bo * No).sum(1, keepdims=True))
        w = ns[:, 0:1] * Ts + ns[:, 1:2] * Bs  # Neigungsanteil in Weltrichtung
        out = np.stack([(w * To).sum(1), (w * Bo).sum(1), ns[:, 2]], axis=1)
        nts[ok] = unit(out)
        # Lippen des Scans (Ellipse in der Scan-Textur): dort übernimmt die Figur ihre eigenen Lippen
        lipm = np.zeros(n, np.float32)
        dx, dy = (u * 1024 - 512.5) / 62.0, (v * 1024 - 479.0) / 22.0
        lipm[ok] = np.clip(1.25 - np.sqrt(dx * dx + dy * dy), 0, 1)
        return col, nts, colb, dist, lipm


def smooth01(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
