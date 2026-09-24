"""Bäume, Büsche und Felsen (mit LOD-Stufen für die Fernsicht)."""
import math
import random

from lib import bake, cone, cyl, displace, ico, jitter, join, rock, smooth, taper, tube


def _trunk(h, r0, r1, seed, seg=8, lean=0.25):
    rnd = random.Random(seed)
    pts = []
    for i in range(7):
        t = i / 6
        pts.append((math.sin(t * 2.1 + seed) * lean * t, math.cos(t * 1.7 + seed) * lean * t, t * h))
    o = tube("trunk", pts, r0, seg, material="bark", r_end=r1)
    # Wurzelansatz
    roots = []
    for k in range(4):
        a = k * math.pi / 2 + rnd.uniform(-0.3, 0.3)
        roots.append(tube("root", [(0, 0, 0.5), (math.cos(a) * r0 * 1.4, math.sin(a) * r0 * 1.4, 0.12), (math.cos(a) * r0 * 2.3, math.sin(a) * r0 * 2.3, -0.2)],
                          r0 * 0.45, 5, material="bark", r_end=r0 * 0.15))
    return [o] + roots


def tree_pine():
    rnd = random.Random(101)
    parts = _trunk(8.2, 0.34, 0.05, 1, lean=0.12)  # endet in der obersten Krone
    tiers = 7
    for i in range(tiers):
        t = i / (tiers - 1)
        r = 2.7 * (1 - t) + 0.55
        z = 2.3 + t * 6.9
        c = cone("tier", r, 2.3 - t * 0.6, (0, 0, z), material="leaves_pine", seg=11)
        bake(c)
        for v in c.data.vertices:
            if v.co.z < z - 0.5:
                v.co.z -= rnd.uniform(0.1, 0.55)  # hängende Zweigspitzen
                v.co.x *= rnd.uniform(0.85, 1.12)
                v.co.y *= rnd.uniform(0.85, 1.12)
        c.rotation_euler.z = rnd.uniform(0, 1)
        parts.append(c)
    o = join(parts, "tree_pine")
    smooth(o, 60)
    return o


def tree_oak():
    rnd = random.Random(202)
    parts = _trunk(4.2, 0.48, 0.3, 2, lean=0.2)
    ends = []
    for k in range(5):
        a = k * 2 * math.pi / 5 + rnd.uniform(-0.3, 0.3)
        d = rnd.uniform(1.6, 2.4)
        top = (math.cos(a) * d, math.sin(a) * d, rnd.uniform(5.6, 6.8))
        mid = (math.cos(a) * d * 0.45, math.sin(a) * d * 0.45, 4.6)
        parts.append(tube("branch", [(0, 0, 3.6), mid, top], 0.22, 6, material="bark", r_end=0.07))
        ends.append(top)
    ends.append((0, 0, 7.0))
    for i, e in enumerate(ends):
        blob = ico("crown", 1.9 if i < 5 else 2.2, e, material="leaves", sub=2, scale=(1.0, 1.0, 0.8))
        bake(blob)
        displace(blob, 0.55, 0.7, 200 + i)
        parts.append(blob)
    o = join(parts, "tree_oak")
    smooth(o, 70)
    return o


def tree_dead():
    rnd = random.Random(303)
    parts = _trunk(5.8, 0.36, 0.08, 3, lean=0.35)
    for k in range(6):
        a = rnd.uniform(0, 2 * math.pi)
        z0 = rnd.uniform(2.2, 4.8)
        d = rnd.uniform(1.0, 2.2)
        pts = [(0, 0, z0), (math.cos(a) * d * 0.5, math.sin(a) * d * 0.5, z0 + 0.6), (math.cos(a + 0.4) * d, math.sin(a + 0.4) * d, z0 + rnd.uniform(0.6, 1.8))]
        parts.append(tube("branch", pts, 0.12, 5, material="bark", r_end=0.02))
    o = join(parts, "tree_dead")
    smooth(o, 60)
    return o


def bush():
    parts = []
    rnd = random.Random(404)
    for i in range(4):
        a = i * 1.7
        b = ico("bush", rnd.uniform(0.55, 0.8), (math.cos(a) * 0.45, math.sin(a) * 0.45, 0.5), material="leaves", sub=2, scale=(1, 1, 0.75))
        bake(b)
        displace(b, 0.22, 0.3, 400 + i)
        parts.append(b)
    o = join(parts, "bush")
    smooth(o, 80)
    return o


def rock_large():
    parts = [rock("rock", 1.9, 501, loc=(0, 0, 0.7), scale=(1.1, 0.95, 0.8))]
    parts.append(rock("rock2", 0.9, 502, loc=(1.5, 0.8, 0.2), scale=(1, 1, 0.7)))
    o = join(parts, "rock_large")
    smooth(o, 40)
    return o


def rock_small():
    o = join([rock("rock", 0.8, 511, loc=(0, 0, 0.3), scale=(1.1, 1.0, 0.75))], "rock_small")
    smooth(o, 40)
    return o


def cliff_rock():
    parts = [rock("cliff", 3.6, 521, loc=(0, 0, 3.2), scale=(1.1, 0.9, 1.35))]
    parts.append(rock("cliff2", 2.6, 522, loc=(1.8, 1.2, 6.2), scale=(1.0, 0.9, 1.0)))
    parts.append(rock("cliff3", 2.2, 523, loc=(-2.4, -0.8, 1.0), scale=(1.1, 1.1, 0.8)))
    o = join(parts, "cliff_rock")
    smooth(o, 35)
    return o


ASSETS = {
    "tree_pine": (tree_pine, 0.3), "tree_oak": (tree_oak, 0.25), "tree_dead": (tree_dead, 0.4), "bush": (bush, 0.35),
    "rock_large": (rock_large, 0.3), "rock_small": (rock_small, 0.4), "cliff_rock": (cliff_rock, 0.3),
}
