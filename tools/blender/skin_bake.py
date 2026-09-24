"""Hauttexturen für die MakeHuman-Figuren (UV-Layout der Basisfigur).

Für jeden Texel wird die zugehörige Stelle auf dem 3D-Körper bestimmt (Rasterung der Flächen im
UV-Raum). Daraus entstehen – nahtlos, weil im 3D-Raum berechnet – Poren, Rötungen (Wangen, Nase,
Ohren, Lippen, Knöchel), Augenbrauen aus Härchen, Schatten um die Augen, Falten und bei Männern
Bartstoppeln.

Ausgabe (apps/client/public/assets/textures):
  skin_<art>_color.webp   Grundfarbe für einen mittleren Hautton (Client färbt relativ dazu um)
  skin_<art>_normal.webp  Normalen (Poren, Falten) im Tangentenraum
  skin_<art>_arm.webp     R = Hohlraum-Verdeckung, G = Rauheit, B = Haarmaske (Brauen/Stoppeln → Haarfarbe)

  /opt/bpyenv/bin/python tools/blender/skin_bake.py [male female]
"""
import os
import sys

import bpy  # noqa: I001
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import human  # noqa: E402

OUT = os.environ.get("PZ_TEX_OUT", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "apps", "client", "public", "assets", "textures"))
SIZE = int(os.environ.get("PZ_SKIN_SIZE", "2048"))
BASE_TONE = np.array([0.58, 0.40, 0.31])  # mittlerer Hautton (linear)


def rasterize(base, v, size):
    """Positions- und Normalenkarte im UV-Raum der Körperflächen."""
    vt = np.array(base.vt)
    pos = np.zeros((size, size, 3), np.float32)
    nrm = np.zeros((size, size, 3), np.float32)
    cov = np.zeros((size, size), bool)
    # Punktnormalen (Flächennormalen gemittelt)
    vn = np.zeros_like(v)
    body = [(vs, ts) for g, vs, ts in base.faces if g == "body"]
    for vs, _ in body:
        p = v[vs]
        n = np.cross(p[1] - p[0], p[2] - p[0])
        vn[vs] += n
    vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-9)
    for vs, ts in body:
        for tri in ((0, 1, 2), (0, 2, 3)) if len(vs) == 4 else ((0, 1, 2),):
            uv = vt[[ts[i] for i in tri]] * size
            P = v[[vs[i] for i in tri]]
            N = vn[[vs[i] for i in tri]]
            x0, y0 = np.floor(uv.min(axis=0)).astype(int) - 1
            x1, y1 = np.ceil(uv.max(axis=0)).astype(int) + 1
            x0, y0 = max(x0, 0), max(y0, 0)
            x1, y1 = min(x1, size - 1), min(y1, size - 1)
            if x1 < x0 or y1 < y0:
                continue
            xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            a, b, c = uv
            den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(den) < 1e-12:
                continue
            l0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
            l1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
            l2 = 1 - l0 - l1
            m = (l0 >= -0.02) & (l1 >= -0.02) & (l2 >= -0.02)
            if not m.any():
                continue
            yy = ys[m].astype(int)
            xx = xs[m].astype(int)
            w = np.stack([l0[m], l1[m], l2[m]], axis=1)
            pos[yy, xx] = w @ P
            nn = w @ N
            nrm[yy, xx] = nn / np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-9)
            cov[yy, xx] = True
    return pos, nrm, cov


def hash3(ix, iy, iz):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0


def vnoise(p, scale):
    """3D-Wertrauschen (glatt interpoliert), p: (..., 3) in Metern, scale: Zellen pro Meter."""
    q = p * scale
    i = np.floor(q).astype(np.int64)
    f = q - i
    f = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                out = out + w * hash3(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz)
    return out


def fbm(p, scale, octaves=4):
    s, a, tot = 0, 1.0, 0
    for o in range(octaves):
        s = s + a * vnoise(p + o * 7.31, scale * 2 ** o)
        tot += a
        a *= 0.5
    return s / tot


def gauss(p, c, r):
    d = (p - c) / r
    return np.exp(-np.sum(d * d, axis=-1))


def smooth01(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def bake(kind):
    base, v, J, W = human.build_figure(kind)
    male = kind == "male"
    print(f"[haut] {kind}: rastere {SIZE}²", flush=True)
    pos, nrm, cov = rasterize(base, v, SIZE)
    P = pos[cov]
    N = nrm[cov]
    # Orientierungspunkte des Gesichts
    eyeL = base.center(v, "helper-l-eye")
    eyeR = base.center(v, "helper-r-eye")
    mouth = base.center(v, "joint-mouth")
    jaw = base.center(v, "joint-jaw")
    head_idx = [i for i in base.groups["body"] if v[i, 1] > J["neck"][1]]
    hv = v[head_idx]
    nose_i = head_idx[int(np.argmax(np.where(np.abs(hv[:, 0]) < 0.01, hv[:, 2], -9)))]
    nose = v[nose_i]
    front = nrm[cov][:, 2]
    y_neck = J["neck"][1]
    is_head = P[:, 1] > y_neck - 0.03
    is_face = is_head & (P[:, 2] > J["head"][2] + 0.0) & (np.abs(P[:, 0]) < 0.085)
    # --- Farbe
    tone = np.tile(BASE_TONE, (len(P), 1))
    # großflächige Unregelmäßigkeit + Poren
    blot = fbm(P, 30, 3)
    pore = vnoise(P, 1400)
    fine = vnoise(P, 420)
    tone *= (0.93 + 0.12 * blot)[:, None]
    tone *= (0.97 + 0.05 * fine)[:, None]
    red = np.array([0.72, 0.30, 0.26])
    redness = (gauss(P, eyeL + np.array([0.012, -0.035, 0.01]), np.array([0.03, 0.022, 0.03])) * 0.35 +
               gauss(P, eyeR + np.array([-0.012, -0.035, 0.01]), np.array([0.03, 0.022, 0.03])) * 0.35 +
               gauss(P, nose, np.array([0.016, 0.016, 0.02])) * 0.025 +
               gauss(P, mouth, np.array([0.035, 0.03, 0.03])) * 0.12)
    # Ohren (seitlich am Kopf auf Augenhöhe)
    for sx in (1, -1):
        ear = np.array([sx * (abs(eyeL[0]) + 0.045), eyeL[1] - 0.01, J["head"][2] - 0.01])
        redness += gauss(P, ear, np.array([0.02, 0.035, 0.025])) * 0.4
    # Knöchel/Hände etwas röter
    redness += (P[:, 1] < J["handL"][1] + 0.02) * 0.12
    tone = tone * (1 - redness[:, None] * 0.55) + (tone * red / BASE_TONE * 0.9) * redness[:, None] * 0.55
    # Lippen: Ellipse um den Mund, obere/untere Lippe
    lip_d = ((P[:, 0] - mouth[0]) / 0.025) ** 2 + ((P[:, 1] - mouth[1]) / 0.011) ** 2
    lips = smooth01(1.0 - lip_d, 0.0, 0.45) * (P[:, 2] > mouth[2] - 0.012)
    lip_col = np.array([0.45, 0.2, 0.19]) if not male else np.array([0.44, 0.24, 0.21])
    tone = tone * (1 - lips[:, None] * 0.8) + lip_col * lips[:, None] * 0.8
    # Augenhöhlen leicht dunkler/kühler, Lidfalte
    sock = np.zeros(len(P))
    for e in (eyeL, eyeR):
        sock += gauss(P, e + np.array([0, 0.004, 0.0]), np.array([0.024, 0.017, 0.03]))
    tone *= (1 - sock * 0.18)[:, None]
    tone[:, 2] *= 1 + sock * 0.06
    # Augenbrauen: gebogenes Band über den Augen, aus Härchen (gerichtetes Rauschen)
    brow = np.zeros(len(P))
    brow_dir = np.zeros(len(P))
    for e, sx in ((eyeL, 1), (eyeR, -1)):
        dx = (P[:, 0] - e[0]) * sx  # nach außen positiv; Braue von -0,026 (innen) bis +0,034 (außen)
        t = np.clip((dx + 0.026) / 0.06, 0, 1)
        # Bogen: höchster Punkt bei ~60 %, außen abfallend; innen dicker, außen spitz zulaufend
        arch = e[1] + 0.02 + 0.007 * np.sin(np.clip(t, 0, 1) * np.pi * 0.85) - 0.004 * t * t
        half = (0.0068 if male else 0.0042) * (1.0 - 0.7 * t ** 1.5)
        inside = smooth01(half - np.abs(P[:, 1] - arch), 0.0, 0.0018)
        band = inside * smooth01(dx, -0.027, -0.02) * smooth01(0.036 - dx, 0.0, 0.006) * (P[:, 2] > e[2] - 0.02)
        brow = np.maximum(brow, band)
        brow_dir = np.where(band > 0, t, brow_dir)
    # Härchen: längliche Striche, innen steiler aufwärts, außen flach
    strand_p = P * np.array([1.0, 1.0, 1.0])
    strands = vnoise(np.stack([strand_p[:, 0] * 3.0 + strand_p[:, 1] * (1.5 - brow_dir), strand_p[:, 1] * 0.8, strand_p[:, 2]], axis=1), 1800)
    brow_mask = brow * (0.45 + 0.55 * smooth01(strands, 0.4, 0.6)) * (0.7 if not male else 0.9)
    # Bartstoppeln (Mann): Kinn, Kiefer, Oberlippe, Wangen unten
    stub = np.zeros(len(P))
    if male:
        below_cheek = smooth01(eyeL[1] - 0.065 - P[:, 1], 0.0, 0.02)
        above_neck = smooth01(P[:, 1] - (jaw[1] - 0.05), 0.0, 0.02)
        sidez = P[:, 2] > J["head"][2] - 0.045
        stub = below_cheek * above_neck * sidez * is_head * (1 - lips)
        stub *= 1 - gauss(P, nose, np.array([0.02, 0.012, 0.02]))
        dots = smooth01(vnoise(P, 3200), 0.6, 0.85)
        stub = stub * (0.2 + 0.8 * dots) * 0.6
        tone *= (1 - stub[:, None] * np.array([0.34, 0.3, 0.22]))
    # Sommersprossen/Flecken sehr dezent
    spots = smooth01(vnoise(P, 700), 0.82, 0.9) * is_face * 0.15
    tone *= (1 - spots[:, None] * np.array([0.3, 0.45, 0.55]))
    # --- Höhe: Poren, Falten
    height = (pore - 0.5) * 0.35 + (fine - 0.5) * 0.25
    fore = smooth01(P[:, 1] - (eyeL[1] + 0.045), 0.0, 0.01) * smooth01(eyeL[1] + 0.1 - P[:, 1], 0.0, 0.01) * is_face
    height += np.sin(P[:, 1] * 1100 + vnoise(P, 60) * 4) * 0.25 * fore * (0.25 if male else 0.1)
    for sx in (1, -1):
        # Nasolabialfalte: Linie von Nasenflügel zum Mundwinkel
        a = nose + np.array([sx * 0.018, -0.005, -0.012])
        b = mouth + np.array([sx * 0.03, -0.012, -0.012])
        ab = b - a
        t = np.clip(((P - a) @ ab) / (ab @ ab), 0, 1)
        d = np.linalg.norm(P - (a + np.outer(t, ab)), axis=1)
        height -= np.exp(-(d / 0.0025) ** 2) * 0.6 * is_face
        # Krähenfüße
        e = eyeL if sx == 1 else eyeR
        cf = gauss(P, e + np.array([sx * 0.03, 0, -0.01]), np.array([0.01, 0.012, 0.02]))
        height += np.sin((P[:, 1] - e[1]) * 1500 + (P[:, 0]) * 400 * sx) * cf * 0.25
    height -= brow_mask * 0.15
    # Rauheit: T-Zone glänzender, Lippen feucht
    rough = 0.6 - 0.06 * gauss(P, nose, np.array([0.02, 0.05, 0.05])) - 0.08 * gauss(P, np.array([0, eyeL[1] + 0.06, eyeL[2]]), np.array([0.04, 0.03, 0.05]))
    rough = rough - lips * 0.22 + (fine - 0.5) * 0.06
    cavity = np.clip(1.0 + (height - 0.0) * 0.25, 0.7, 1.0)
    hair = np.clip(np.maximum(brow_mask, stub * 0.9), 0, 1)
    # Brauen dunkel (Farbe kommt im Client aus der Haarfarbe über die Maske)
    tone *= (1 - brow_mask[:, None] * 0.75)

    def img(vals, ch):
        a = np.zeros((SIZE, SIZE, ch), np.float32)
        a[cov] = vals if vals.ndim == 2 else vals[:, None]
        return a
    col = img(tone, 3)
    hmap = img(height, 1)[..., 0]
    arm = np.zeros((SIZE, SIZE, 3), np.float32)
    arm[cov, 0] = cavity
    arm[cov, 1] = np.clip(rough, 0.2, 0.9)
    arm[cov, 2] = hair
    # Normale aus der Höhe (Texelraum); Stärke grob auf Millimeter abgestimmt
    gx = (np.roll(hmap, -1, 1) - np.roll(hmap, 1, 1)) * 0.5
    gy = (np.roll(hmap, -1, 0) - np.roll(hmap, 1, 0)) * 0.5
    k = 2.2
    n = np.stack([-gx * k, -gy * k, np.ones_like(gx)], axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    nimg = n * 0.5 + 0.5
    # Ränder der UV-Inseln ausweiten (keine Nähte in den Mipmaps)
    import foliage_bake as fb
    alpha = cov.astype(np.float32)
    col = fb.dilate(col, alpha, 12)
    arm = fb.dilate(arm, alpha, 12)
    nimg = fb.dilate(nimg.astype(np.float32), alpha, 12)
    col_srgb = fb.linear_to_srgb(np.clip(col, 0, 1))
    # Blender-Bilder beginnen unten links wie die UVs → keine Spiegelung nötig
    fb.save_webp(col_srgb, os.path.join(OUT, f"skin_{kind}_color.webp"), False, False)
    fb.save_webp(nimg, os.path.join(OUT, f"skin_{kind}_normal.webp"), False, True)
    fb.save_webp(arm, os.path.join(OUT, f"skin_{kind}_arm.webp"), False, True)
    print(f"[haut] {kind}: fertig ({cov.mean():.0%} belegt)", flush=True)


def bake_eye(size=512):
    """Augapfel-Textur passend zu human.eye_uvs (Iris in der Mitte, Radius ~ Winkel vom Blick).
    RGB = Lederhaut/Irisstruktur (grau), A = Irismaske (Client färbt mit der Augenfarbe)."""
    y, x = np.mgrid[0:size, 0:size]
    u = (x + 0.5) / size - 0.5
    w = (y + 0.5) / size - 0.5
    r = np.sqrt(u * u + w * w) * 2  # 0 Mitte … 1 Rand (= 90° vom Blick)
    ang = np.arctan2(w, u)
    R_IRIS, R_PUPIL = 0.235, 0.075
    p3 = np.stack([np.cos(ang) * 3, np.sin(ang) * 3, r * 40], axis=-1)
    fib = vnoise(np.stack([np.cos(ang) * 20, np.sin(ang) * 20, r * 6], axis=-1), 6)  # radiale Fasern
    crypt = vnoise(p3, 1.3)
    iris_v = 0.55 + 0.35 * fib + 0.15 * crypt
    iris_v *= 0.75 + 0.25 * smooth01(r, R_PUPIL, R_PUPIL + 0.08)  # innen dunkler (Kragen)
    ring = smooth01(r, R_IRIS - 0.06, R_IRIS)  # dunkler Limbusring
    iris_v *= 1 - ring * 0.6
    sclera = np.stack([np.full_like(r, 0.86), np.full_like(r, 0.83), np.full_like(r, 0.8)], axis=-1)
    veins = smooth01(vnoise(np.stack([np.cos(ang) * 30, np.sin(ang) * 30, r * 3], axis=-1), 5), 0.72, 0.8) * smooth01(r, 0.55, 0.95)
    sclera = sclera * (1 - veins[..., None] * np.array([0.1, 0.45, 0.45]))
    sclera *= (1 - smooth01(r, 0.7, 1.0) * 0.25)[..., None]  # zum Rand hin im Lidschatten
    col = np.where((r < R_IRIS)[..., None], iris_v[..., None].repeat(3, -1), sclera)
    col = np.where((r < R_PUPIL)[..., None], 0.015, col)
    mask = (r < R_IRIS).astype(np.float32) * (r >= R_PUPIL)
    import foliage_bake as fb
    rgba = np.concatenate([fb.linear_to_srgb(np.clip(col, 0, 1)), mask[..., None]], axis=2).astype(np.float32)
    fb.save_webp(rgba, os.path.join(OUT, "eye_color.webp"), True, False)
    print("[haut] Augen fertig", flush=True)


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    for k in argv or ["male", "female", "eye"]:
        bake_eye() if k == "eye" else bake(k)
