"""Kreaturenteile für die Rigs in apps/client/src/render/creatures.ts.

Jedes Teil liegt im lokalen Raum seiner Rig-Gruppe (Ursprung = Gruppenursprung, keine Drehung).
Kreaturen blicken im Rig nach +Z, in Blender also nach -Y.
"""
import math
import random

from lib import bake, cone, displace, ico, jitter, join, lathe, smooth, tube, uvsphere


def B(x, y, z):
    return (x, -z, y)


def along_forward(o):
    """Dreht einen um Blender-Z gedrehten Körper so, dass +Z nach vorn (Blender -Y) zeigt."""
    o.rotation_euler = (math.pi / 2, 0, 0)
    bake(o)
    return o


def glassrunner():
    # Rumpf: schlank, tiefe Brust, hochgezogene Flanke
    body = lathe("body", [(0.0, -0.78), (0.12, -0.74), (0.22, -0.6), (0.27, -0.35), (0.26, -0.05), (0.3, 0.25), (0.31, 0.45),
                          (0.26, 0.62), (0.16, 0.74), (0.0, 0.78)], 16, "hide")
    along_forward(body)
    for v in body.data.vertices:
        v.co.x *= 0.82
        if v.co.z < 0:  # Brust tiefer, Bauch hochgezogen
            k = -v.co.y  # vorn positiv
            v.co.z *= 1.15 if k > 0.1 else 0.85
    rnd = random.Random(7)
    jitter(body, 0.006, 7)
    smooth(body, 60)
    body.name = "body"
    # Hals: vom Halsgelenk (0, 0, 0) zum Kopf (0, 0.5, 0.2)
    neck = tube("neck", [B(0, -0.05, -0.05), B(0, 0.2, 0.06), B(0, 0.42, 0.16), B(0, 0.55, 0.2)], 0.14, 10, material="hide", r_end=0.085)
    neck = join([neck], "neck")
    smooth(neck, 60)
    # Kopf: lange Schnauze nach vorn, Kiefer, Ohren
    skull = lathe("skull", [(0.0, -0.1), (0.09, -0.08), (0.11, 0.0), (0.09, 0.1), (0.06, 0.22), (0.035, 0.32), (0.0, 0.35)], 12, "hide")
    along_forward(skull)
    for v in skull.data.vertices:
        v.co.x *= 0.85
        if v.co.z < 0:
            v.co.z *= 0.75
    ears = []
    for s in (-1, 1):
        e = cone("ear", 0.035, 0.12, B(s * 0.07, 0.1, -0.04), rot=(0.4, s * -0.5, 0), material="hide", seg=5)
        ears.append(e)
    nose = uvsphere("nose", 0.03, B(0, 0.0, 0.33), material="metal_dark", seg=8, rings=6)
    head = join([skull, nose] + ears, "head")
    smooth(head, 50)
    for i, o in enumerate((body, neck, head)):
        o.location = (i * 1.5, 0, 0)
    return [body, neck, head]


def colossus():
    body = uvsphere("body", 1.0, (0, 0, 0), material="bark", seg=24, rings=16, scale=(1.1, 1.5, 0.9))
    bake(body)
    displace(body, 0.22, 0.35, 31)
    rnd = random.Random(31)
    for v in body.data.vertices:
        # Buckel über den Schultern, flacher Bauch
        front = -v.co.y
        if v.co.z > 0.3 and front > 0.2:
            v.co.z += 0.25 * min(1, (front - 0.2) / 0.8)
        if v.co.z < -0.5:
            v.co.z = -0.5 - (v.co.z + 0.5) * 0.5
    ridges = []
    for i in range(7):
        y = -1.2 + i * 0.38
        pts = [(math.cos(a) * 1.05, y, math.sin(a) * 0.95) for a in [math.pi * (0.1 + 0.8 * k / 6) for k in range(7)]]
        ridges.append(tube("ridge", pts, 0.09 + rnd.uniform(0, 0.05), 5, material="bark"))
    body = join([body] + ridges, "body")
    smooth(body, 45)
    head = uvsphere("head", 0.5, (0, 0, 0), material="bark", seg=16, rings=12, scale=(1.0, 1.2, 0.85))
    bake(head)
    displace(head, 0.1, 0.2, 33)
    brow = tube("brow", [B(-0.35, 0.22, 0.35), B(0, 0.28, 0.48), B(0.35, 0.22, 0.35)], 0.1, 6, material="bark")
    horns = [tube("horn", [B(s * 0.3, 0.3, 0.1), B(s * 0.55, 0.55, 0.0), B(s * 0.62, 0.85, -0.25)], 0.1, 6, material="bark", r_end=0.02) for s in (-1, 1)]
    jaw = uvsphere("jaw", 0.3, B(0, -0.25, 0.3), material="bark", seg=12, rings=8, scale=(1.1, 1.1, 0.6))
    head = join([head, brow, jaw] + horns, "head")
    smooth(head, 45)
    head.location = (3, 0, 0)
    return [body, head]


def moth():
    body = lathe("body", [(0.0, -0.46), (0.08, -0.42), (0.14, -0.3), (0.16, -0.12), (0.12, 0.02), (0.14, 0.12), (0.15, 0.25),
                          (0.12, 0.34), (0.0, 0.38)], 14, "fur")
    along_forward(body)
    jitter(body, 0.01, 5)
    for v in body.data.vertices:  # Hinterleib in Segmente gliedern
        fz = -v.co.y
        if fz < -0.02:
            k = 1 - 0.12 * abs(math.sin((fz + 0.46) / 0.1 * math.pi))
            v.co.x *= k
            v.co.z *= k
    ruff = ico("ruff", 0.15, B(0, 0.02, 0.14), material="fur", sub=2, scale=(1.1, 1.1, 0.9))
    bake(ruff)
    displace(ruff, 0.05, 0.05, 9)
    o = join([body, ruff], "body")
    smooth(o, 70)
    return [o]


ASSETS = {"glassrunner": (glassrunner, None), "colossus": (colossus, None), "moth": (moth, None)}
