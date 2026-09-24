"""Figurenteile für das prozedurale Rig (apps/client/src/render/rig.ts) und Waffen.

Jedes Teil ist ein eigenes Objekt mit dem Namen, den das Rig erwartet. Sein Ursprung liegt
im zugehörigen Gelenk, das Rig setzt die Position zurück und hängt das Teil an das Gelenk.
Rig-Raum (three.js): Y oben, Blick nach +Z. Blender: Z oben, Blick nach -Y.
"""
import math

from lib import bake, beam, box, cone, cyl, extrude_shape, ico, join, lathe, set_origin, smooth, tube, uvsphere


def B(x, y, z):
    """Rig-Koordinate (three.js) → Blender-Koordinate."""
    return (x, -z, y)


# Gelenkpositionen bei Körperbreite 1 (siehe HumanoidRig.build)
J = {
    "hips": (0, 0.95, 0), "spine": (0, 1.05, 0), "chest": (0, 1.27, 0), "neck": (0, 1.63, 0), "head": (0, 1.73, 0),
}
for side, s in (("l", 1), ("r", -1)):
    J[f"shoulder_{side}"] = (s * 0.21, 1.57, 0)
    J[f"upperarm_{side}"] = (s * 0.23, 1.55, 0)
    J[f"forearm_{side}"] = (s * 0.23, 1.26, 0)
    J[f"hand_{side}"] = (s * 0.23, 1.00, 0)
    J[f"thigh_{side}"] = (s * 0.1, 0.90, 0)
    J[f"shin_{side}"] = (s * 0.1, 0.47, 0)
    J[f"foot_{side}"] = (s * 0.1, 0.05, 0)


def limb(name, joint, length, r0, r1, material, bulge=0.12, seg=12, depth=1.0):
    """Gliedmaße vom Gelenk nach unten (Rig -Y), leicht muskulös gewölbt."""
    x, y, z = joint
    prof = [(r0 * 0.6, 0.02), (r0, -0.03)]
    for i in range(1, 6):
        t = i / 6
        r = r0 + (r1 - r0) * t
        r *= 1 + bulge * math.sin(math.pi * min(1, t * 1.4))
        prof.append((r, -0.03 - t * (length - 0.06)))
    prof += [(r1, -length + 0.02), (r1 * 0.55, -length - 0.01)]
    o = lathe(name, [(r, zz) for r, zz in reversed(prof)], seg, material)
    o.scale = (1, depth, 1)
    o.location = B(x, y, z)
    bake(o)
    return o


def humanoid():
    parts = []

    def finish(o, joint):
        set_origin(o, B(*J[joint]))
        smooth(o, 50)
        parts.append(o)

    # Becken
    p = uvsphere("pelvis", 0.17, B(0, 0.93, 0), material="legs", seg=16, rings=10, scale=(1.05, 0.78, 0.72))
    finish(join([p], "pelvis"), "hips")
    # Bauch
    b = lathe("belly", [(0.0, 0.98), (0.14, 0.99), (0.155, 1.06), (0.15, 1.16), (0.16, 1.26), (0.0, 1.3)], 16, "body")
    b.scale = (1, 0.74, 1)
    bake(b)
    finish(join([b], "belly"), "spine")
    # Oberkörper mit Brust, Schulterlinie und Kragen
    t = lathe("torso_main", [(0.0, 1.24), (0.16, 1.25), (0.185, 1.36), (0.2, 1.48), (0.205, 1.56), (0.17, 1.62), (0.07, 1.65), (0.0, 1.66)], 18, "body")
    t.scale = (1.05, 0.68, 1)
    bake(t)
    for v in t.data.vertices:  # Brust leicht nach vorn (Blender -Y)
        if v.co.y < 0 and 1.36 < v.co.z < 1.58:
            v.co.y -= 0.02 * math.sin(math.pi * (v.co.z - 1.36) / 0.22)
    collar = cyl("collar", 0.085, 0.06, B(0, 1.635, 0), material="accent", seg=14, r2=0.075)
    strap = beam("strap", B(0.17, 1.58, 0.1), B(-0.14, 1.28, 0.1), 0.035, 0.02, material="accent")
    strap2 = beam("strap2", B(0.17, 1.58, -0.1), B(-0.14, 1.28, -0.1), 0.035, 0.02, material="accent")
    finish(join([t, collar, strap, strap2], "torso"), "chest")
    # Gürtel mit Schnalle und Tasche
    belt = cyl("beltring", 0.162, 0.055, B(0, 1.05, 0), material="body", seg=18, caps=False)
    belt.scale = (1, 0.76, 1)
    bake(belt)
    buckle = box("buckle", (0.05, 0.015, 0.04), B(0, 1.05, 0.125), material="body")
    pouch = box("pouch", (0.07, 0.04, 0.08), B(0.12, 1.0, 0.07), material="body")
    finish(join([belt, buckle, pouch], "belt"), "spine")
    # Hals
    n = cyl("neckmesh", 0.056, 0.14, B(0, 1.69, 0.005), material="skin", seg=12, r2=0.05)
    finish(join([n], "neckmesh"), "neck")
    # Kopf: Schädel, Kiefer, Ohren, Brauen
    h = uvsphere("skull", 0.115, B(0, 1.835, 0), material="skin", seg=20, rings=14, scale=(0.9, 0.98, 1.08))
    bake(h)
    for v in h.data.vertices:
        dz = v.co.z - 1.835
        fy = -v.co.y  # nach vorn
        if dz < -0.02 and fy > -0.02:  # Kinn und Kiefer schmaler, nach vorn
            k = min(1, (-dz - 0.02) / 0.08)
            v.co.x *= 1 - 0.28 * k
            v.co.y -= 0.012 * k
        if dz > 0.0 and fy < 0.03:  # Hinterkopf voller
            v.co.y += 0.01 * (dz / 0.12)
        if fy > 0.07 and -0.02 < dz < 0.05:  # Gesicht etwas abflachen (Augen liegen bei z=0.1)
            v.co.y = -min(fy, 0.098)
    ears = [uvsphere("ear", 0.028, B(s * 0.103, 1.83, -0.005), material="skin", seg=8, rings=6, scale=(0.4, 0.7, 1.0)) for s in (-1, 1)]
    brow = box("brow", (0.11, 0.022, 0.018), B(0, 1.865, 0.098), rot=(0.25, 0, 0), material="skin")
    lips = box("lips", (0.04, 0.01, 0.012), B(0, 1.765, 0.095), material="skin")
    finish(join([h, brow, lips] + ears, "head"), "head")
    for side, s in (("l", 1), ("r", -1)):
        sp = uvsphere(f"shoulderpad_{side}", 0.082, B(*J[f"shoulder_{side}"]), material="body", seg=14, rings=8, scale=(1.15, 1.0, 0.85))
        bake(sp)
        for v in sp.data.vertices:  # nur obere Schale, nach außen geneigt
            if v.co.z < J[f"shoulder_{side}"][1] - 0.02:
                v.co.z = J[f"shoulder_{side}"][1] - 0.02 - (v.co.z - J[f"shoulder_{side}"][1] + 0.02) * 0.2
        finish(join([sp], f"shoulderpad_{side}"), f"shoulder_{side}")
        ua = limb(f"upperarm_{side}", J[f"upperarm_{side}"], 0.3, 0.056, 0.045, "body", bulge=0.15, depth=0.92)
        finish(join([ua], f"upperarm_{side}"), f"upperarm_{side}")
        fa = limb(f"forearm_{side}", J[f"forearm_{side}"], 0.27, 0.047, 0.036, "body", bulge=0.12, depth=0.9)
        fx, fy, fz = J[f"forearm_{side}"]
        bracer = cyl("bracer", 0.045, 0.1, B(fx, fy - 0.19, fz), material="accent", seg=12, r2=0.04)
        finish(join([fa, bracer], f"forearm_{side}"), f"forearm_{side}")
        hx, hy, hz = J[f"hand_{side}"]
        palm = box("palm", (0.07, 0.035, 0.075), B(hx, hy - 0.04, hz), material="skin", bevel=0.01)
        fingers = box("fingers", (0.066, 0.03, 0.05), B(hx, hy - 0.1, hz + 0.008), rot=(0.25, 0, 0), material="skin", bevel=0.008)
        thumb = beam("thumb", B(hx - s * 0.02, hy - 0.03, hz + 0.015), B(hx - s * 0.03, hy - 0.08, hz + 0.04), 0.022, material="skin")
        finish(join([palm, fingers, thumb], f"hand_{side}"), f"hand_{side}")
        th = limb(f"thigh_{side}", J[f"thigh_{side}"], 0.45, 0.085, 0.062, "legs", bulge=0.12, depth=0.95)
        finish(join([th], f"thigh_{side}"), f"thigh_{side}")
        sx, sy, sz = J[f"shin_{side}"]
        sh = limb(f"shin_{side}", J[f"shin_{side}"], 0.3, 0.064, 0.05, "legs", bulge=0.18, depth=0.95)
        boot = lathe("boot", [(0.0, sy - 0.44), (0.058, sy - 0.44), (0.062, sy - 0.3), (0.066, sy - 0.18), (0.07, sy - 0.14), (0.0, sy - 0.13)], 12, "accent",
                     loc=(sx, -sz, 0))
        knee = uvsphere("knee", 0.05, B(sx, sy - 0.01, sz + 0.03), material="legs", seg=10, rings=6, scale=(1, 0.8, 1))
        finish(join([sh, boot, knee], f"shin_{side}"), f"shin_{side}")
        fx, fy, fz = J[f"foot_{side}"]
        foot = box("foot", (0.095, 0.25, 0.07), B(fx, fy - 0.03, fz + 0.05), material="accent", bevel=0.02)
        bake(foot)
        for v in foot.data.vertices:  # Spitze flacher
            if -v.co.y > fz + 0.1 and v.co.z > fy - 0.03:
                v.co.z -= 0.025
        sole = box("sole", (0.1, 0.26, 0.015), B(fx, fy - 0.066, fz + 0.05), material="accent")
        finish(join([foot, sole], f"foot_{side}"), f"foot_{side}")
    return parts


# ---------------- Waffen ----------------
# Griff im Ursprung, Klinge nach Rig -Y (Blender -Z).

def _blade(name, length, width, start, material="metal", tip=0.12, thickness=0.012):
    pts = [(-width / 2, 0), (width / 2, 0), (width / 2 * 0.9, -(length - tip)), (0, -length), (-width / 2 * 0.9, -(length - tip))]
    return extrude_shape(name, pts, thickness, material=material, loc=(0, 0, start))


def w_sword():
    parts = [cyl("grip", 0.019, 0.17, (0, 0, -0.035), material="leather", seg=8)]
    parts.append(uvsphere("pommel", 0.03, (0, 0, 0.065), material="metal_dark", seg=10, rings=6))
    parts.append(box("guard", (0.22, 0.03, 0.03), (0, 0, -0.13), material="metal_dark", bevel=0.008))
    parts.append(_blade("blade", 0.86, 0.055, -0.145))
    parts.append(box("fuller", (0.012, 0.016, 0.55), (0, 0, -0.45), material="metal_dark"))
    return join(parts, "w_sword")


def w_axe():
    parts = [cyl("haft", 0.021, 0.8, (0, 0, -0.3), material="wood_dark", seg=8)]
    parts.append(cyl("wrap", 0.024, 0.16, (0, 0, -0.02), material="leather", seg=8))
    parts.append(extrude_shape("head", [(0.0, 0.05), (0.07, 0.04), (0.2, 0.1), (0.22, -0.1), (0.07, -0.05), (0.0, -0.05)], 0.02,
                               material="metal", loc=(0, 0, -0.62)))
    parts.append(box("socket", (0.06, 0.05, 0.1), (0, 0, -0.62), material="metal_dark"))
    return join(parts, "w_axe")


def w_mace():
    parts = [cyl("haft", 0.021, 0.7, (0, 0, -0.25), material="wood_dark", seg=8)]
    parts.append(cyl("wrap", 0.024, 0.15, (0, 0, -0.02), material="leather", seg=8))
    parts.append(uvsphere("core", 0.06, (0, 0, -0.62), material="metal", seg=10, rings=8))
    for i in range(6):
        a = i * math.pi / 3
        parts.append(box("flange", (0.02, 0.07, 0.14), (math.cos(a) * 0.055, math.sin(a) * 0.055, -0.62), rot=(0, 0, a + math.pi / 2), material="metal"))
    parts.append(cone("spike", 0.025, 0.06, (0, 0, -0.71), rot=(math.pi, 0, 0), material="metal", seg=6))
    return join(parts, "w_mace")


def w_dagger():
    parts = [cyl("grip", 0.016, 0.12, (0, 0, -0.03), material="leather", seg=8)]
    parts.append(box("guard", (0.08, 0.02, 0.02), (0, 0, -0.095), material="metal_dark"))
    parts.append(_blade("blade", 0.3, 0.04, -0.1, thickness=0.01))
    return join(parts, "w_dagger")


def w_bow():
    pts = []
    for i in range(13):
        t = -1 + 2 * i / 12
        y3 = 0.65 * t
        z3 = -0.28 * (1 - t * t) + 0.04 * t ** 4  # Wurfarme mit leichtem Rückschwung
        pts.append(B(0, y3, z3))
    parts = [tube("limbs", pts, 0.02, 6, material="wood_dark")]
    parts.append(cyl("grip", 0.026, 0.14, B(0, 0, -0.28), material="leather", seg=8))
    parts.append(beam("string", B(0, 0.65, 0.04), B(0, -0.65, 0.04), 0.004, material="cloth_white"))
    return join(parts, "w_bow")


def w_staff():
    parts = [cyl("shaft", 0.024, 1.7, (0, 0, -0.35), material="wood_dark", seg=8, r2=0.02)]
    parts.append(cyl("ferrule", 0.028, 0.06, (0, 0, -1.18), material="metal_dark", seg=8))
    for i in range(3):
        a = i * 2 * math.pi / 3
        parts.append(tube("claw", [(0, 0, 0.44), (math.cos(a) * 0.07, math.sin(a) * 0.07, 0.52), (math.cos(a) * 0.03, math.sin(a) * 0.03, 0.62)],
                          0.012, 5, material="wood_dark", r_end=0.004))
    orb = ico("orb", 0.06, (0, 0, 0.53), material="glow_null", sub=1)
    orb.scale = (0.8, 0.8, 1.3)
    parts.append(orb)
    parts.append(cyl("band", 0.03, 0.04, (0, 0, 0.42), material="metal_gold", seg=8))
    return join(parts, "w_staff")


def w_shield():
    # Wie das Ersatzmodell vor der Drehung: Scheibe quer zur X-Achse, Buckel nach -X.
    parts = [cyl("board", 0.34, 0.035, (0, -0.05, -0.08), rot=(0, math.pi / 2, 0), material="wood", seg=24)]
    parts.append(cyl("rim", 0.35, 0.045, (0, -0.05, -0.08), rot=(0, math.pi / 2, 0), material="metal_dark", seg=24, caps=False))
    parts.append(lathe("boss", [(0.09, 0.0), (0.085, 0.02), (0.06, 0.045), (0.0, 0.055)], 14, "metal", loc=(0, 0, 0)))
    boss = parts[-1]
    boss.rotation_euler = (0, -math.pi / 2, 0)
    boss.location = (-0.015, -0.05, -0.08)
    for k in (-1, 1):
        parts.append(box("plankline", (0.04, 0.012, 0.66), (-0.02, -0.05 + k * 0.12, -0.08), material="wood_dark"))
    parts.append(box("handle", (0.03, 0.12, 0.03), (0.035, -0.05, -0.08), material="leather"))
    return join(parts, "w_shield")


def w_quiver():
    parts = [cyl("body", 0.06, 0.5, (0, 0, 0), material="leather", seg=10, r2=0.052)]
    parts.append(cyl("rim", 0.064, 0.04, (0, 0, 0.24), material="metal_dark", seg=10, caps=False))
    for i in range(5):
        a = i * 1.26
        x, y = math.cos(a) * 0.03, math.sin(a) * 0.03
        parts.append(beam("arrow", (x, y, 0.1), (x * 1.3, y * 1.3, 0.42), 0.008, material="wood"))
        parts.append(box("fletch", (0.03, 0.004, 0.07), (x * 1.3, y * 1.3, 0.39), rot=(0, 0, a), material="cloth_white"))
    parts.append(beam("strap", (0.06, 0, 0.2), (0.06, 0, -0.2), 0.025, 0.008, material="leather"))
    return join(parts, "w_quiver")


def w_focus():
    c = ico("crystal", 0.07, B(0, -0.08, -0.05), material="crystal", sub=0)
    c.scale = (0.8, 0.8, 1.3)
    ring = cyl("ring", 0.075, 0.015, B(0, -0.08, -0.05), rot=(math.pi / 2, 0, 0), material="metal_gold", seg=16, caps=False)
    chain = beam("chain", B(0, -0.08, -0.05), B(0, 0.0, -0.02), 0.006, material="metal_gold")
    return join([c, ring, chain], "w_focus")


def weapons():
    objs = []
    for i, fn in enumerate((w_sword, w_axe, w_mace, w_dagger, w_bow, w_staff, w_shield, w_quiver, w_focus)):
        o = fn()
        smooth(o, 40)
        set_origin(o, (0, 0, 0))
        o.location = (i * 0.5, 0, 0)  # nur zur Übersicht in der Datei; das Spiel setzt die Position zurück
        objs.append(o)
    return objs


ASSETS = {"humanoid": (humanoid, None), "weapons": (weapons, None)}
