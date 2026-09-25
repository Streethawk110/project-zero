"""Realistische Menschen auf Basis der MakeHuman-Figur (CC0).

Quelle: MakeHuman-Basisnetz, Formvorgaben (Targets) und Game-Engine-Gewichte – alle unter CC0 1.0
(https://github.com/makehumancommunity/makehuman, LICENSE.ASSETS.md). Die Dateien werden beim ersten
Bau heruntergeladen und in tools/blender/.mh_cache zwischengespeichert (nicht im Repository).

Ablauf:
  1. Basisnetz laden, Formvorgaben anwenden (Mann/Frau, Alter, Muskeln, Gewicht)
  2. Dezimeter → Meter, Boden auf 0, auf Zielgröße skalieren
  3. Gewichte der 53 MakeHuman-Knochen auf die 19 Gelenke des Spiel-Rigs zusammenfassen
  4. Arme aus der A-Haltung in die hängende Ruhehaltung des Rigs drehen (lineares Skinning)
  5. Blender-Armatur mit den Spiel-Gelenken, Netz mit Gewichten → GLB mit Skin
"""
import math
import os
import urllib.request

import bpy  # noqa: I001
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".mh_cache")
MH = "https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data/"
MPFB = "https://raw.githubusercontent.com/makehumancommunity/mpfb2/master/src/mpfb/data/"

JOINTS = ["hips", "spine", "chest", "neck", "head",
          "shoulderL", "upperArmL", "foreArmL", "handL", "shoulderR", "upperArmR", "foreArmR", "handR",
          "thighL", "shinL", "footL", "thighR", "shinR", "footR"]
PARENT = {"hips": None, "spine": "hips", "chest": "spine", "neck": "chest", "head": "neck",
          "shoulderL": "chest", "upperArmL": "shoulderL", "foreArmL": "upperArmL", "handL": "foreArmL",
          "shoulderR": "chest", "upperArmR": "shoulderR", "foreArmR": "upperArmR", "handR": "foreArmR",
          "thighL": "hips", "shinL": "thighL", "footL": "shinL", "thighR": "hips", "shinR": "thighR", "footR": "shinR"}
# Gelenkpunkte (MakeHuman-Würfelgruppen). „l“ ist die linke Körperseite = +x (wie im Rig).
CUBES = {"hips": "joint-pelvis", "spine": "joint-spine-3", "chest": "joint-spine-2", "neck": "joint-neck", "head": "joint-head",
         "shoulderL": "joint-l-clavicle", "upperArmL": "joint-l-shoulder", "foreArmL": "joint-l-elbow", "handL": "joint-l-hand",
         "shoulderR": "joint-r-clavicle", "upperArmR": "joint-r-shoulder", "foreArmR": "joint-r-elbow", "handR": "joint-r-hand",
         "thighL": "joint-l-upper-leg", "shinL": "joint-l-knee", "footL": "joint-l-ankle",
         "thighR": "joint-r-upper-leg", "shinR": "joint-r-knee", "footR": "joint-r-ankle"}


def bone_to_joint(b):
    """Game-Engine-Knochen → Spiel-Gelenk."""
    side = "L" if b.endswith("_l") else "R" if b.endswith("_r") else ""
    base = b[:-2] if side else b
    if base in ("Root", "pelvis"):
        return "hips"
    if base in ("spine_01", "spine_02"):
        return "spine"
    if base == "spine_03":
        return "chest"
    if base == "neck_01":
        return "neck"
    if base == "head":
        return "head"
    if base == "clavicle":
        return "shoulder" + side
    if base == "upperarm":
        return "upperArm" + side
    if base == "lowerarm":
        return "foreArm" + side
    if base == "hand" or base.split("_")[0] in ("thumb", "index", "middle", "ring", "pinky"):
        return "hand" + side
    if base == "thigh":
        return "thigh" + side
    if base == "calf":
        return "shin" + side
    if base in ("foot", "ball"):
        return "foot" + side
    raise KeyError(b)


def fetch(url):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, url.split("/data/", 1)[1].replace("/", "__"))
    if not os.path.exists(path):
        print(f"[mensch] lade {url}", flush=True)
        with urllib.request.urlopen(url, timeout=60) as r, open(path + ".part", "wb") as f:
            f.write(r.read())
        os.replace(path + ".part", path)
    return path


class Base:
    """Das MakeHuman-Basisnetz: Punkte, UVs, Flächen je Gruppe."""

    def __init__(self):
        self.v = []
        self.vt = []
        self.faces = []  # (gruppe, [v], [vt])
        group = None
        for line in open(fetch(MH + "3dobjs/base.obj")):
            if line.startswith("v "):
                self.v.append([float(x) for x in line.split()[1:4]])
            elif line.startswith("vt "):
                self.vt.append([float(x) for x in line.split()[1:3]])
            elif line.startswith("g "):
                group = line.split()[1]
            elif line.startswith("f "):
                vs, ts = [], []
                for tok in line.split()[1:]:
                    p = tok.split("/")
                    vs.append(int(p[0]) - 1)
                    ts.append(int(p[1]) - 1 if len(p) > 1 and p[1] else -1)
                self.faces.append((group, vs, ts))
        self.v = np.array(self.v, dtype=np.float64)
        self.groups = {}
        for g, vs, _ in self.faces:
            self.groups.setdefault(g, set()).update(vs)

    def center(self, v, group):
        idx = list(self.groups[group])
        return v[idx].mean(axis=0)


def apply_target(v, rel, weight):
    if abs(weight) < 1e-6:
        return
    for line in open(fetch(MH + "targets/" + rel)):
        if not line or line[0] in "#\n":
            continue
        p = line.split()
        if len(p) == 4:
            v[int(p[0])] += weight * np.array([float(p[1]), float(p[2]), float(p[3])])


def load_weights(n_verts):
    """Gewichte (Game-Engine-Rig) → Matrix [Punkte × 19 Gelenke]."""
    import json
    data = json.load(open(fetch(MPFB + "rigs/standard/weights.game_engine.json")))["weights"]
    W = np.zeros((n_verts, len(JOINTS)), dtype=np.float64)
    for bone, pairs in data.items():
        j = JOINTS.index(bone_to_joint(bone))
        for vi, w in pairs:
            W[vi, j] += w
    s = W.sum(axis=1, keepdims=True)
    return np.where(s > 0, W / np.maximum(s, 1e-9), 0.0)


# Figurtypen: Formvorgaben (Datei, Gewicht) und Zielgröße in Metern
FIGURES = {
    "male": ([("macrodetails/caucasian-male-young.target", 1.0),
              ("macrodetails/universal-male-young-maxmuscle-averageweight.target", 0.35),
              ("macrodetails/proportions/male-young-averagemuscle-averageweight-idealproportions.target", 0.6)], 1.80),
    "female": ([("macrodetails/caucasian-female-young.target", 1.0),
                ("macrodetails/universal-female-young-averagemuscle-averageweight.target", 0.0),
                ("macrodetails/proportions/female-young-averagemuscle-averageweight-idealproportions.target", 0.6)], 1.68),
}


def rot_between(a, b):
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3)
    k = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + k + k @ k * (1 / (1 + c))


FIG_EXTRA = {}


def build_figure(kind):
    base = Base()
    v = base.v.copy()
    targets, height = FIGURES[kind]
    for rel, w in targets:
        apply_target(v, rel, w)
    # Dezimeter → Meter, Füße auf den Boden, Zielgröße
    ground = base.center(v, "joint-ground")
    v = (v - ground) * 0.1
    body_idx = sorted(base.groups["body"])
    top = v[body_idx, 1].max()
    v *= height / top
    joints = {j: base.center(v, CUBES[j]) for j in JOINTS}
    W = load_weights(len(v))
    # --- Arme in die Ruhehaltung des Rigs: Oberarm fast senkrecht (leicht abgespreizt, damit die
    # Arme nicht in der Hüfte stecken), Unterarm in Verlängerung, Hand in Verlängerung
    rest = {}
    for side, sx in (("L", 1.0), ("R", -1.0)):
        rest["upperArm" + side] = np.array([0.13 * sx, -1.0, 0.0])
        rest["foreArm" + side] = np.array([0.1 * sx, -1.0, 0.06])
        rest["hand" + side] = np.array([0.06 * sx, -1.0, 0.02])
    child = {"upperArmL": "foreArmL", "foreArmL": "handL", "upperArmR": "foreArmR", "foreArmR": "handR"}
    world_R = {j: np.eye(3) for j in JOINTS}
    world_T = {j: np.zeros(3) for j in JOINTS}
    new_pos = dict(joints)
    order = ["upperArmL", "foreArmL", "handL", "upperArmR", "foreArmR", "handR"]
    for j in order:
        par = PARENT[j]
        # Gelenk mit dem Elternteil mitbewegen
        pr = world_R.get(par, np.eye(3)) if par in ("upperArmL", "foreArmL", "upperArmR", "foreArmR") else np.eye(3)
        pt = world_T.get(par, np.zeros(3)) if par in ("upperArmL", "foreArmL", "upperArmR", "foreArmR") else np.zeros(3)
        p_new = pr @ joints[j] + pt
        if j in child:
            cur_dir = pr @ (joints[child[j]] - joints[j])
        else:
            # Hand: Richtung Mittelfinger-Grundgelenk
            k = "l" if j.endswith("L") else "r"
            cur_dir = pr @ (base.center(v, f"joint-{k}-finger-3-1") - joints[j])
        R = rot_between(cur_dir, rest[j]) @ pr
        world_R[j] = R
        world_T[j] = p_new - R @ joints[j]
        new_pos[j] = p_new
    # Lineares Skinning der Punkte (nur Armgelenke bewegt; übrige Gelenke Identität)
    out = np.zeros_like(v)
    for ji, j in enumerate(JOINTS):
        w = W[:, ji:ji + 1]
        if not w.any():
            continue
        out += w * (v @ world_R[j].T + world_T[j])
    no_w = W.sum(axis=1) < 1e-6
    out[no_w] = v[no_w]
    # Für Formziele: Maßstab (Target-Einheiten → Meter) und Fingergelenke in der Ruhehaltung
    fingers = {}
    for side in ("l", "r"):
        hj = "hand" + side.upper()
        for f in range(1, 6):
            for sgm in range(1, 5):
                p0 = base.center(v, f"joint-{side}-finger-{f}-{sgm}")
                fingers[(side, f, sgm)] = world_R[hj] @ p0 + world_T[hj]
    FIG_EXTRA["scale"] = 0.1 * height / top
    FIG_EXTRA["neck_y"] = float(joints["neck"][1])
    FIG_EXTRA["fingers"] = fingers
    return base, out, new_pos, W


# ---------------------------------------------------------------------------
# Formziele (Shape Keys): Mimik, Gesichtsvarianten, Griffhände
# ---------------------------------------------------------------------------

def load_target_gz(rel):
    """MPFB-Target (gzip, Zeilen „index dx dy dz“ in MakeHuman-Einheiten) → {index: Delta}."""
    import gzip
    out = {}
    with gzip.open(fetch(MPFB + "targets/" + rel), "rt") as f:
        for line in f:
            p = line.split()
            if len(p) == 4 and line[0] not in "#":
                out[int(p[0])] = np.array([float(p[1]), float(p[2]), float(p[3])])
    return out


EXPR = "expression/units/caucasian/"
# Mimik (vom Client animiert) und Gesichtsvarianten (je Figur fest eingestellt)
SHAPES = {
    "blink": [(EXPR + "eye-left-closure.target.gz", 1.0), (EXPR + "eye-right-closure.target.gz", 1.0)],
    "jaw": [(EXPR + "mouth-open.target.gz", 1.0)],
    "smile": [(EXPR + "mouth-corner-puller.target.gz", 1.0)],
    "frown": [(EXPR + "eyebrows-left-down.target.gz", 1.0), (EXPR + "eyebrows-right-down.target.gz", 1.0),
              (EXPR + "mouth-depression.target.gz", 0.4)],
    "brows": [(EXPR + "eyebrows-left-up.target.gz", 1.0), (EXPR + "eyebrows-right-up.target.gz", 1.0)],
    "lips": [(EXPR + "mouth-pursing.target.gz", 1.0)],
    "f_nose_big": [("nose/nose-scale-horiz-incr.target.gz", 0.6), ("nose/nose-volume-incr.target.gz", 0.6), ("nose/nose-hump-incr.target.gz", 0.6)],
    "f_nose_small": [("nose/nose-scale-horiz-decr.target.gz", 0.5), ("nose/nose-volume-decr.target.gz", 0.5), ("nose/nose-point-up.target.gz", 0.5)],
    "f_jaw_strong": [("chin/chin-prominent-incr.target.gz", 0.7), ("chin/chin-width-incr.target.gz", 0.6), ("head/head-square.target.gz", 0.5)],
    "f_narrow": [("head/head-scale-horiz-decr.target.gz", 0.6), ("head/head-oval.target.gz", 0.6), ("chin/chin-width-decr.target.gz", 0.4)],
    "f_gaunt": [("cheek/l-cheek-volume-decr.target.gz", 0.8), ("cheek/r-cheek-volume-decr.target.gz", 0.8),
                ("cheek/l-cheek-bones-incr.target.gz", 0.6), ("cheek/r-cheek-bones-incr.target.gz", 0.6), ("head/head-fat-decr.target.gz", 0.5)],
    "f_round": [("head/head-round.target.gz", 0.6), ("head/head-fat-incr.target.gz", 0.6),
                ("cheek/l-cheek-volume-incr.target.gz", 0.5), ("cheek/r-cheek-volume-incr.target.gz", 0.5)],
    "f_old": [("head/head-age-incr.target.gz", 0.9), ("mouth/mouth-angles-down.target.gz", 0.5), ("neck/neck-double-incr.target.gz", 0.3)],
    "f_lips": [("mouth/mouth-upperlip-volume-incr.target.gz", 0.6), ("mouth/mouth-lowerlip-volume-incr.target.gz", 0.6)],
    "f_brow": [("forehead/forehead-nubian-incr.target.gz", 0.6), ("eyebrows/eyebrows-trans-down.target.gz", 0.5),
               ("l-eye-bag-incr", 0.0)],
}


def shape_deltas(name, n_verts):
    d = np.zeros((n_verts, 3))
    for rel, w in SHAPES[name]:
        if w == 0.0 or not rel.endswith(".gz"):
            continue
        for i, dv in load_target_gz(rel).items():
            if i < n_verts:
                d[i] += dv * w
    return d * FIG_EXTRA["scale"]


def _rot(axis, ang):
    a = axis / np.linalg.norm(axis)
    k = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + math.sin(ang) * k + (1 - math.cos(ang)) * (k @ k)


_FW = None


def finger_weights(n_verts):
    """Rohgewichte der Fingerknochen (Game-Engine-Rig): {(seite, finger 1-5, glied 1-3): Vektor}."""
    global _FW
    if _FW is None:
        import json
        data = json.load(open(fetch(MPFB + "rigs/standard/weights.game_engine.json")))["weights"]
        names = {"thumb": 1, "index": 2, "middle": 3, "ring": 4, "pinky": 5}
        _FW = {}
        for bone, pairs in data.items():
            parts = bone.split("_")
            if parts[0] not in names:
                continue
            key = (parts[2], names[parts[0]], int(parts[1]))
            w = np.zeros(n_verts)
            for vi, wt in pairs:
                w[vi] += wt
            _FW[key] = w
    return _FW


def grip_deltas(v, side, W):
    """Faust um einen Griff: Finger je Glied einrollen, Daumen darüberlegen (Vorwärtskinematik)."""
    F = FIG_EXTRA["fingers"]
    FW = finger_weights(len(v))
    s = side
    wrist = FIG_EXTRA.get("wrist_" + s)
    hand_dir = F[(s, 3, 1)] - (wrist if wrist is not None else F[(s, 3, 1)] - np.array([0, -0.08, 0]))
    lateral = F[(s, 5, 1)] - F[(s, 2, 1)]
    palm = np.cross(lateral, hand_dir)
    palm /= np.linalg.norm(palm)
    if np.dot(palm, F[(s, 1, 4)] - F[(s, 2, 1)]) < 0:
        palm = -palm
    out = v.copy()
    total = np.zeros(len(v))
    for f, angs in ((2, (1.0, 1.35, 0.8)), (3, (1.05, 1.4, 0.8)), (4, (1.1, 1.45, 0.85)), (5, (1.15, 1.5, 0.9)), (1, (0.45, 0.6, 0.7))):
        axis = lateral if f != 1 else hand_dir
        # Vorzeichen: Fingerspitze soll zur Handfläche wandern
        tip = F[(s, f, 4)]
        test = _rot(axis, 0.3) @ (tip - F[(s, f, 1)])
        sign = 1.0 if np.dot(test - (tip - F[(s, f, 1)]), palm) > 0 else -1.0
        Rc = np.eye(3)
        Tc = np.zeros(3)
        for sgm in (1, 2, 3):
            piv = Rc @ F[(s, f, sgm)] + Tc
            ax = Rc @ (axis if not (f == 1 and sgm > 1) else lateral)
            if f == 1 and sgm > 1:
                t2 = _rot(ax, 0.3) @ (Rc @ tip + Tc - piv)
                sg2 = 1.0 if np.dot(t2 - (Rc @ tip + Tc - piv), palm) > 0 else -1.0
            else:
                sg2 = sign
            Rs = _rot(ax, sg2 * angs[sgm - 1])
            Rc = Rs @ Rc
            Tc = Rs @ (Tc - piv) + piv
            w = FW.get((s, f, sgm))
            if w is None:
                continue
            m = w > 1e-4
            out[m] += w[m, None] * ((v[m] @ Rc.T + Tc) - v[m])
            total += w
    return out - v


def add_shape_keys(o, used, v, W, names, hands=False):
    """Formziele auf ein aus make_mesh erzeugtes Netz (Punkte in derselben Reihenfolge wie used)."""
    if not o.data.shape_keys:
        o.shape_key_add(name="Basis", from_mix=False)
    n = len(v)
    for nm in names:
        d = shape_deltas(nm, n)
        if not np.abs(d[used]).max() > 1e-6:
            continue
        k = o.shape_key_add(name=nm, from_mix=False)
        for j, i in enumerate(used):
            if d[i].any():
                k.data[j].co = B(v[i] + d[i])
    if hands:
        for side, nm in (("l", "gripL"), ("r", "gripR")):
            d = grip_deltas(v, side, W)
            k = o.shape_key_add(name=nm, from_mix=False)
            for j, i in enumerate(used):
                if abs(d[i]).max() > 1e-7:
                    k.data[j].co = B(v[i] + d[i])


def B(p):
    """Rig-Raum (x, y oben, z vorn) → Blender (x, -z, y)."""
    return Vector((p[0], -p[2], p[1]))


def make_mesh(name, base, v, W, groups, material, keep=None):
    """Netz aus den Flächen der Gruppen (optional gefiltert: keep(Mittelpunkt im Rig-Raum))."""
    faces = [(vs, ts) for g, vs, ts in base.faces if g in groups and (keep is None or keep(v[vs].mean(axis=0), vs))]
    used = sorted({i for vs, _ in faces for i in vs})
    remap = {o: n for n, o in enumerate(used)}
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(B(v[i])) for i in used], [], [[remap[i] for i in vs] for vs, _ in faces])
    uv = me.uv_layers.new(name="UVMap")
    for (vs, ts), poly in zip(faces, me.polygons):
        for k in range(len(vs)):
            t = ts[k]
            uv.data[poly.loop_start + k].uv = base.vt[t] if t >= 0 else (0.0, 0.0)
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(bpy.data.materials.get(material) or bpy.data.materials.new(material))
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    for ji, j in enumerate(JOINTS):
        vg = o.vertex_groups.new(name=j)
        for n, i in enumerate(used):
            w = float(W[i, ji])
            if w > 1e-4:
                vg.add([n], w, "REPLACE")
    return o, used


def R(p):
    """Blender → Rig-Raum."""
    return np.array([p[0], p[2], -p[1]])


def offset(o, dist):
    """Hülle entlang der Punktnormalen nach außen schieben."""
    me = o.data
    me.update()
    for vtx in me.vertices:
        vtx.co += vtx.normal * dist


def folds(o, J, amp=0.0035):
    """Stauchfalten an Ellbogen, Handgelenk, Knie und Knöchel (Ringwellen um die Gliedachse)."""
    me = o.data
    me.update()
    spots = []
    for side in "LR":
        for a, b, reach in (("upperArm", "foreArm", 0.1), ("foreArm", "hand", 0.12), ("thigh", "shin", 0.1), ("shin", "foot", 0.12)):
            spots.append((J[a + side], J[b + side], reach))
    for vtx in me.vertices:
        p = R(vtx.co)
        for a, b, reach in spots:
            axis = b - a
            L = np.linalg.norm(axis)
            axis = axis / L
            t = float(np.dot(p - a, axis))
            d = t - L  # Abstand zum unteren Gelenk entlang der Achse
            if abs(d) > reach:
                continue
            radial = p - (a + axis * t)
            rl = np.linalg.norm(radial)
            if rl < 1e-4 or rl > 0.12:
                continue
            ang = math.atan2(radial[2], radial[0])
            w = (1 - abs(d) / reach) ** 1.5
            wave = math.sin(d * 95 + math.sin(ang * 2.0) * 1.8) * 0.6 + math.sin(d * 170 + ang * 3.0) * 0.4
            vtx.co += vtx.normal * (wave * amp * w)
            break


def smooth_shape(o, iterations, factor=0.8):
    """Form beruhigen (z. B. Brustpanzer, Kapuze sollen den Körper nicht nachzeichnen)."""
    m = o.modifiers.new("ruhig", "SMOOTH")
    m.factor = factor
    m.iterations = iterations
    import lib
    lib.apply_mods(o)


def clamp_band(o, y0, y1):
    """Punkte auf ein Höhenband begrenzen → gerade Kanten (Gürtel)."""
    for vtx in o.data.vertices:
        z = vtx.co.z  # Blender-Z = Rig-Höhe
        vtx.co.z = min(max(z, y0), y1)


def transfer_weights(o, base, v, W, group="body"):
    """Gewichte vom nächstgelegenen Körperpunkt übernehmen (für frei gebaute Teile)."""
    from mathutils.kdtree import KDTree
    idx = sorted(base.groups[group])
    kd = KDTree(len(idx))
    for n, i in enumerate(idx):
        kd.insert(B(v[i]), n)
    kd.balance()
    vgs = [o.vertex_groups.get(j) or o.vertex_groups.new(name=j) for j in JOINTS]
    for vtx in o.data.vertices:
        found = kd.find_n(vtx.co, 4)
        acc = np.zeros(len(JOINTS))
        tot = 0.0
        for co, n, d in found:
            wgt = 1.0 / max(d, 1e-4)
            acc += W[idx[n]] * wgt
            tot += wgt
        acc /= max(tot, 1e-9)
        for ji, wv in enumerate(acc):
            if wv > 1e-3:
                vgs[ji].add([vtx.index], float(wv), "REPLACE")


def hood_shell(base, v, W, J, eye_y):
    """Kapuze aus Wollstoff: weit fallende Schale um den Kopf mit rundem Gesichtsausschnitt und
    eingerolltem Saum, hinten zu einem Zipfel ausgezogen, weiche Längsfalten, bis in den Nacken.
    UV kugelförmig (u = Umfang, v = Höhe), damit die Stoffwebung sichtbar wird."""
    import bmesh
    head_idx = [i for i in base.groups["body"] if v[i, 1] > J["neck"][1]]
    hv = v[head_idx]
    lo, hi = hv.min(axis=0), hv.max(axis=0)
    c = (lo + hi) / 2
    r = (hi - lo) / 2 * np.array([1.26, 1.14, 1.2]) + 0.018
    face_y = eye_y - 0.035  # Mitte des Gesichtsausschnitts
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=1.0)

    def rig_dir(co):
        return np.array([co.x, co.z, -co.y])

    kill = []
    for f in bm.faces:
        d = rig_dir(f.calc_center_median())
        p = c + d * r
        # runder (elliptischer) Gesichtsausschnitt vorn
        ex = d[0] / 0.6
        ey = (p[1] - face_y) / 0.098
        if d[2] > 0.1 and ex * ex + ey * ey < 1.0:
            kill.append(f)
        elif p[1] < J["neck"][1] - 0.07:
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.verts.ensure_lookup_table()
    rim = {vv for vv in bm.verts if vv.is_boundary}
    for vert in bm.verts:
        d = rig_dir(vert.co)
        if vert in rim and d[2] > 0.05:
            # Randpunkt genau auf die Ausschnitt-Ellipse legen (sonst treppiger Rand)
            py = c[1] + d[1] * r[1]
            ex, ey = d[0] / 0.6, (py - face_y) / 0.098
            k = 1.0 / max(math.hypot(ex, ey), 1e-6)
            d0 = ex * k * 0.6
            d1 = (face_y + ey * k * 0.098 - c[1]) / r[1]
            d = np.array([d0, d1, math.sqrt(max(0.0, 1.0 - d0 * d0 - d1 * d1))])
        p = c + d * r
        lon = math.atan2(d[0], d[2])
        lat = d[1]
        # Zipfel hinten oben
        if d[1] > -0.2 and d[2] < 0:
            p[2] -= 0.06 * max(0.0, d[1] + 0.2) * (-d[2]) ** 1.5
            p[1] += 0.015 * max(0.0, d[1]) * (-d[2])
        # unten weiter (fällt auf die Schultern)
        if d[1] < -0.3:
            k = (-d[1] - 0.3)
            p[0] = c[0] + (p[0] - c[0]) * (1.0 + k * 0.35)
            p[2] = c[2] + (p[2] - c[2]) * (1.0 + k * 0.2)
        # weiche Längsfalten, nach unten stärker, vorn am Gesicht schwächer
        fold = math.sin(lon * 9 + lat * 2.5) * 0.6 + math.sin(lon * 17 - lat * 4) * 0.4
        amp = 0.0045 * (0.4 + max(0.0, -lat) * 1.2) * (1.0 - 0.7 * max(0.0, d[2]))
        nrm = d / max(np.linalg.norm(d), 1e-9)
        p = p + nrm * fold * amp
        # Saum am Gesicht eingerollt: etwas nach außen und vorn
        if vert in rim and d[2] > 0:
            p = p + nrm * 0.012 + np.array([0, 0, 0.006])
        vert.co = B(p)
    me = bpy.data.meshes.new("hood")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("hood", me)
    bpy.context.scene.collection.objects.link(o)
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            d = np.array([co.x, co.z, -co.y]) - c
            lon = math.atan2(d[0], d[2])
            uv.data[li].uv = (lon / math.tau + 0.5, (d[1] + 0.2) * 2.5)
    for poly in me.polygons:
        poly.use_smooth = True
    me.materials.append(bpy.data.materials.get("accent") or bpy.data.materials.new("accent"))
    sol = o.modifiers.new("dicke", "SOLIDIFY")
    sol.thickness = 0.01
    import lib
    lib.apply_mods(o)
    transfer_weights(o, base, v, W)
    return o


def finish_piece(o, rig, subdiv=1):
    if subdiv:
        m = o.modifiers.new("glatt", "SUBSURF")
        m.levels = subdiv
        m.render_levels = subdiv
        import lib
        lib.apply_mods(o)
    o.parent = rig
    mod = o.modifiers.new("rig", "ARMATURE")
    mod.object = rig
    return o


def make_armature(name, pos):
    arm = bpy.data.armatures.new(name + "_rig")
    ob = bpy.data.objects.new(name + "_rig", arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    tails = {"head": np.array([0, 0.2, 0]), "handL": np.array([0, -0.08, 0]), "handR": np.array([0, -0.08, 0]),
             "footL": np.array([0, -0.03, 0.12]), "footR": np.array([0, -0.03, 0.12])}
    kids = {}
    for j in JOINTS:
        if PARENT[j]:
            kids.setdefault(PARENT[j], []).append(j)
    for j in JOINTS:
        eb = arm.edit_bones.new(j)
        eb.head = B(pos[j])
        if j in tails:
            eb.tail = B(pos[j] + tails[j])
        else:
            c = [k for k in kids.get(j, []) if not k.startswith(("shoulder", "thigh"))] or kids.get(j, [])
            t = pos[c[0]] if c else pos[j] + np.array([0, 0.1, 0])
            if np.linalg.norm(t - pos[j]) < 1e-3:
                t = pos[j] + np.array([0, 0.1, 0])
            eb.tail = B(t)
        eb.use_deform = True
    for j in JOINTS:
        if PARENT[j]:
            arm.edit_bones[j].parent = arm.edit_bones[PARENT[j]]
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def eye_uvs(o, centers):
    """Augapfel: UV so, dass die Iris vorn in der Bildmitte liegt (Blickrichtung +z)."""
    me = o.data
    uv = me.uv_layers[0]
    for poly in me.polygons:
        for k, li in enumerate(poly.loop_indices):
            p = R(me.vertices[me.loops[li].vertex_index].co)
            c = min(centers, key=lambda q: np.linalg.norm(q - p))
            d = p - c
            d = d / max(1e-6, np.linalg.norm(d))
            # Vorderseite: Projektion; Rückseite an den Rand (Lederhaut)
            r = 0.5 * (math.acos(max(-1.0, min(1.0, d[2]))) / (math.pi / 2)) if d[2] > -0.99 else 1.0
            a = math.atan2(d[1], d[0])
            uv.data[li].uv = (0.5 + math.cos(a) * r * 0.5, 0.5 + math.sin(a) * r * 0.5)


# ---------------------------------------------------------------------------
# Haare und Bärte aus Haarkarten (Strähnenbild: foliage_hair / foliage_curly)
# ---------------------------------------------------------------------------

class Scalp:
    """Kopfoberfläche zum Führen der Haarkarten (Projektion + Normale), im Rig-Raum."""

    def __init__(self, base, v, J):
        from mathutils.bvhtree import BVHTree
        self.J = J
        faces = [vs for g, vs, _ in base.faces if g == "body" and v[vs].mean(axis=0)[1] > J["neck"][1] - 0.03]
        used = sorted({i for f in faces for i in f})
        remap = {o: n for n, o in enumerate(used)}
        self.verts = [B(v[i]) for i in used]
        self.faces = [[remap[i] for i in f] for f in faces]
        self.tree = BVHTree.FromPolygons(self.verts, self.faces)
        hv = v[used]
        self.lo, self.hi = hv.min(axis=0), hv.max(axis=0)
        self.c = (self.lo + self.hi) / 2
        self.eye_y = None

    def project(self, p, lift):
        loc, n, _, _ = self.tree.find_nearest(B(p))
        if loc is None:
            return p, np.array([0.0, 1.0, 0.0])
        q = R(loc)
        nn = R(n)
        nn /= max(np.linalg.norm(nn), 1e-9)
        return q + nn * lift, nn

    def sample(self, rnd, count, keep):
        """Zufällige Wurzelpunkte auf der Kopfhaut (flächengewichtet)."""
        tris = []
        for f in self.faces:
            for t in ((0, 1, 2), (0, 2, 3)) if len(f) == 4 else ((0, 1, 2),):
                a, b_, c = (R(self.verts[f[i]]) for i in t)
                tris.append((a, b_, c, np.linalg.norm(np.cross(b_ - a, c - a)) / 2))
        areas = np.cumsum([t[3] for t in tris])
        out = []
        tries = 0
        while len(out) < count and tries < count * 60:
            tries += 1
            k = int(np.searchsorted(areas, rnd.random() * areas[-1]))
            a, b_, c, _ = tris[min(k, len(tris) - 1)]
            u, w = rnd.random(), rnd.random()
            if u + w > 1:
                u, w = 1 - u, 1 - w
            p = a + (b_ - a) * u + (c - a) * w
            if keep(p):
                out.append(p)
        return out


def hair_mesh(name, cards, material):
    """cards: Liste von (Punkte, Breiten, Normalen, Ton) → Bänder mit UV (u quer, v längs)."""
    import bmesh
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    col = bm.verts.layers.float_color.new("tree")
    for pts, widths, norms, (ao, tint, u0) in cards:
        n = len(pts)
        # zu den Spitzen hin schmal (keine stumpfen Enden)
        widths = [w * (1.0 - 0.8 * (i / max(1, n - 1)) ** 1.6) for i, w in enumerate(widths)]
        left, right = [], []
        for i in range(n):
            d = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            d /= max(np.linalg.norm(d), 1e-9)
            side = np.cross(d, norms[i])
            side /= max(np.linalg.norm(side), 1e-9)
            for arr, sgn in ((left, -1), (right, 1)):
                vv = bm.verts.new(B(pts[i] + side * widths[i] * 0.5 * sgn))
                vv[col] = (0.0, ao * (0.55 + 0.45 * i / max(1, n - 1)), tint, 1.0)
                arr.append(vv)
        for i in range(n - 1):
            f = bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
            t0, t1 = i / (n - 1), (i + 1) / (n - 1)
            for loop, uv in zip(f.loops, ((0.0, t0), (1.0, t0), (1.0, t1), (0.0, t1))):
                loop[uvl].uv = uv
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(bpy.data.materials.get(material) or bpy.data.materials.new(material))
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    attr = me.color_attributes.get("tree")
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.find("tree")
    vg = o.vertex_groups.new(name="head")
    vg.add(list(range(len(me.vertices))), 1.0, "REPLACE")
    for j in JOINTS:
        if j != "head":
            o.vertex_groups.new(name=j)
    return o


def grow(scalp, root, direction, length, steps, lift, gravity, rnd, below=None, face=None):
    """Strähne über die Kopfhaut führen; unterhalb des Kopfes frei nach unten fallen lassen.
    face = (x-Mitte, halbe Breite, z-Grenze, y-Oberkante): Strähnen weichen dem Gesicht seitlich aus."""
    pts, norms = [], []
    p, n = scalp.project(root, lift)
    d = np.array(direction, dtype=float)
    step = length / steps
    free = False
    for i in range(steps + 1):
        pts.append(p.copy())
        norms.append(n.copy())
        # Richtung: tangential zur Kopfhaut + Schwerkraft + etwas Zufall
        # (frei hängend nicht mehr an die Kopfhaut-Tangente binden: am Nacken zeigt die Normale nach unten,
        # die Projektion würde die Schwerkraft aufheben und Strähnen stünden waagerecht ab)
        if not free:
            d = d - n * np.dot(d, n)
        d = d / max(np.linalg.norm(d), 1e-9)
        g = max(gravity, 0.9) if free else gravity
        d = d + np.array([0, -g, 0]) + np.array([rnd.uniform(-0.08, 0.08), 0, rnd.uniform(-0.08, 0.08)])
        d /= max(np.linalg.norm(d), 1e-9)
        q = p + d * step
        if not free and (below is not None and q[1] < below):
            free = True
        if free:
            # frei hängend: leicht nach außen vom Kopfzentrum weg
            out = q - scalp.c
            out[1] = 0
            out /= max(np.linalg.norm(out), 1e-9)
            p = q + out * step * 0.15
        else:
            p, n = scalp.project(q, lift)
        if face is not None:
            fx, fw, fz, fy = face
            if p[2] > fz and p[1] < fy and abs(p[0] - fx) < fw:
                p[0] = fx + math.copysign(fw, p[0] - fx if abs(p[0] - fx) > 1e-4 else 1.0)
                d[0] += math.copysign(0.6, p[0] - fx)
    return pts, norms


def hair_style(style, base, v, J, W, rnd_seed=5):
    import random
    rnd = random.Random(rnd_seed + style * 13)
    sc = Scalp(base, v, J)
    eye_y = base.center(v, "helper-l-eye")[1]
    cz = sc.c[2]
    y_neck = J["neck"][1]
    crown = np.array([sc.c[0], sc.hi[1], cz - 0.03])

    def hairline(p, front_y=eye_y + 0.074, back_y=y_neck + 0.045):
        ang = abs(math.atan2(p[0] - sc.c[0], p[2] - cz))  # 0 vorn … π hinten
        y = front_y + (back_y - front_y) * (ang / math.pi) ** 1.3
        # Schläfen etwas zurückgesetzt, über den Ohren frei
        if 0.9 < ang < 1.9 and p[1] < eye_y + 0.03:
            return False
        return p[1] > y

    cards = []
    atlas = "hair"
    face = (sc.c[0], 0.068, cz + 0.02, eye_y + 0.045)
    if style == 3:  # kahl
        return None
    if style == 0:  # kurz: nach hinten gekämmt, kurz
        for layer, (cnt, lift, L) in enumerate(((340, 0.003, 0.06), (280, 0.007, 0.075), (180, 0.011, 0.07))):
            for r in sc.sample(rnd, cnt, hairline):
                dirv = r - crown + np.array([0, 0, -0.06])
                dirv = np.array([dirv[0] * 0.6, -0.2, -0.8]) if r[2] > cz else dirv
                pts, ns = grow(sc, r, dirv, L * rnd.uniform(0.8, 1.2), 4, lift, 0.25, rnd, face=face)
                cards.append((pts, [0.022] * 5, ns, (0.5 + layer * 0.25, rnd.random(), rnd.choice((0.0, 0.25, 0.5)))))
    elif style in (2, 5):  # lang / wirr
        long_ = style == 2
        atlas = "hair" if long_ else "curly"
        for layer, (cnt, lift) in enumerate(((320, 0.004), (300, 0.009), (220, 0.015))):
            for r in sc.sample(rnd, cnt, hairline):
                # vom Mittelscheitel zur Seite und nach unten; vorne erst nach hinten/seitlich
                side = math.copysign(1.0, r[0] - sc.c[0] if abs(r[0] - sc.c[0]) > 0.003 else rnd.choice((-1, 1)))
                dirv = np.array([side * 0.8, -0.35, -0.5 if r[2] > cz else (r[2] - cz) * 4])
                if not long_:
                    dirv += np.array([rnd.uniform(-0.6, 0.6), rnd.uniform(-0.2, 0.3), rnd.uniform(-0.6, 0.6)])
                L = rnd.uniform(0.3, 0.38) if long_ else rnd.uniform(0.1, 0.16)
                steps = 9 if long_ else 5
                pts, ns = grow(sc, r, dirv, L, steps, lift, 0.35 if long_ else 0.15, rnd, below=y_neck + 0.03, face=face)
                w = [0.026] * (steps + 1)
                cards.append((pts, w, ns, (0.45 + layer * 0.27, rnd.random(), rnd.choice((0.0, 0.25, 0.5)))))
    elif style == 1:  # Zopf: straff nach hinten zur Nackenbinde, dann geflochtener Zopf
        tie = np.array([sc.c[0], y_neck + 0.07, sc.lo[2] - 0.01])
        for layer, (cnt, lift) in enumerate(((260, 0.004), (180, 0.009))):
            for r in sc.sample(rnd, cnt, hairline):
                pts = [r]
                p = r
                for i in range(6):
                    t = (i + 1) / 6
                    q = r + (tie - r) * t
                    p, n_ = sc.project(q, lift)
                    pts.append(p)
                ns = [sc.project(q, 0)[1] for q in pts]
                cards.append((pts, [0.03] * 6 + [0.02], ns, (0.5 + layer * 0.3, rnd.random(), 0.0)))
        # Zopf: drei verdrillte Stränge
        for strand in range(3):
            pts, ns = [], []
            for i in range(14):
                t = i / 13
                ph = t * 9 + strand * 2.09
                pts.append(tie + np.array([math.sin(ph) * 0.012, -t * 0.34, -0.02 - math.cos(ph) * 0.01 - t * 0.02]))
                ns.append(np.array([0, 0, -1.0]))
            cards.append((pts, [0.034 * (1 - 0.4 * i / 13) for i in range(14)], ns, (0.8, rnd.random(), 0.25)))
            ns2 = [np.array([1.0, 0, 0])] * 14
            cards.append((pts, [0.03 * (1 - 0.4 * i / 13) for i in range(14)], ns2, (0.8, rnd.random(), 0.5)))
    elif style == 4:  # Kriegerknoten: Seiten sehr kurz, Oberkopf zum Knoten
        knot = crown + np.array([0, 0.02, -0.03])
        def top(p):
            return hairline(p) and p[1] > eye_y + 0.09
        for r in sc.sample(rnd, 260, top):
            pts = []
            for i in range(6):
                t = i / 5
                q = r + (knot - r) * t
                pts.append(sc.project(q, 0.005 + 0.01 * t)[0] if t < 0.9 else q)
            ns = [sc.project(q, 0)[1] for q in pts]
            cards.append((pts, [0.028] * 5 + [0.018], ns, (0.7, rnd.random(), 0.0)))
        for r in sc.sample(rnd, 240, lambda p: hairline(p) and not top(p)):
            # vorn nach hinten gestrichen (nicht in die Stirn hängen), seitlich/hinten nach unten
            dv = np.array([0, 0.3, -1.0]) if r[2] > cz + 0.03 else np.array([0, -1.0, -0.3])
            pts, ns = grow(sc, r, dv, 0.02, 2, 0.002, 0.0 if r[2] > cz + 0.03 else 0.3, rnd)
            cards.append((pts, [0.03, 0.03, 0.02], ns, (0.45, rnd.random(), 0.5)))
        # Knoten: kleine Kugel aus Karten
        for i in range(40):
            a = i * 2.4
            h = (i % 8) / 8
            d = np.array([math.cos(a) * math.sqrt(1 - h * h), h * 0.8 + 0.1, math.sin(a) * math.sqrt(1 - h * h)])
            p0 = knot + d * 0.025
            p1 = knot + d * 0.045 + np.array([0, 0.01, 0])
            cards.append(([p0, (p0 + p1) / 2, p1], [0.035, 0.035, 0.02], [d, d, d], (0.8, rnd.random(), 0.25)))
    o = hair_mesh(f"hair_{style}", cards, "hair_" + atlas)
    # Grundkappe: eng anliegende, haarfarbene Schicht auf der Kopfhaut (keine helle Haut zwischen Karten)
    # Kappe etwas hinter dem Haaransatz enden lassen: die Kante verschwindet unter den Strähnen
    cap_keep = lambda p: hairline(p, front_y=eye_y + 0.088, back_y=y_neck + 0.06)
    cap, cused = make_mesh(f"hair_{style}_cap", base, v, W, {"body"}, "hair_cap", lambda c, vs: c[1] > y_neck - 0.03 and cap_keep(c))
    offset(cap, 0.0025)
    add_keys_after_offset(cap, cused, v, SKULL_KEYS)
    follow_keys(o, base, v, SKULL_KEYS)
    return [o, cap]


def beard_style(style, base, v, J, W):
    import random
    rnd = random.Random(77 + style)
    if style < 2:
        return None  # 0 keiner, 1 Stoppeln (Hauttextur)
    sc = Scalp(base, v, J)
    # Mundlinie zwischen den Zahnreihen (joint-mouth liegt deutlich höher im Kopf)
    ut, lt = base.center(v, "helper-upper-teeth"), base.center(v, "helper-lower-teeth")
    mouth = np.array([0.0, (ut[1] + lt[1]) / 2, ut[2] + 0.012])
    jaw = base.center(v, "joint-jaw")
    eye_y = base.center(v, "helper-l-eye")[1]
    cz = sc.c[2]

    def beard_area(p):
        if p[2] < cz - 0.02:
            return False
        dx = abs(p[0] - mouth[0])
        # Bartlinie: an den Koteletten hoch, über den Wangen bis knapp über den Mundwinkel
        side = p[2] < cz + 0.03 and dx > 0.06  # Koteletten: seitlich, Richtung Ohr
        top = eye_y - 0.025 if side else mouth[1] + 0.026 + 0.3 * max(0.0, dx - 0.03)
        if p[1] > top or p[1] < jaw[1] - 0.07:
            return False
        lip = (dx / 0.028) ** 2 + ((p[1] - mouth[1]) / 0.011) ** 2 < 1
        if lip:
            return False
        if style == 3:  # Kinnbart: nur Kinn und Oberlippe
            return dx < 0.035 and (p[1] < mouth[1] - 0.012 or abs(p[1] - (mouth[1] + 0.017)) < 0.007)
        return True
    cards = []
    for layer, (cnt, lift) in enumerate(((900, 0.0012), (700, 0.0028), (420, 0.0045))):
        for r in sc.sample(rnd, cnt, beard_area):
            mus = r[1] > mouth[1] and abs(r[0] - mouth[0]) < 0.045
            dirv = np.array([(r[0] - mouth[0]) * 2.5, -1.0, 0.25]) if mus else np.array([(r[0] - mouth[0]) * 0.8, -1.0, 0.3])
            L = (0.016 if mus else 0.03 if style == 2 else 0.024) * rnd.uniform(0.7, 1.2) * (0.85 + 0.2 * layer)
            pts, ns = grow(sc, r, dirv, L, 3, lift, 0.25, rnd, below=jaw[1] - 0.035)
            w = 0.0045 + 0.0015 * layer
            cards.append((pts, [w, w, w * 0.9, w * 0.6], ns, (0.5 + layer * 0.2, rnd.random(), 0.0)))
    o = hair_mesh(f"beard_{style}", cards, "hair_curly")
    beard_follow_jaw(o, base, v)
    return o


FACE_KEYS = [k for k in SHAPES if k.startswith("f_")] + ["brows", "frown"]
# Formziele, die den Schädel verändern (für Haarkappe und Strähnen – Nase/Lippen/Mimik brauchen sie nicht)
SKULL_KEYS = ["f_jaw_strong", "f_narrow", "f_round", "f_old", "f_brow"]
# Bart: Kiefer, Wangen, Kinn
BEARD_KEYS = ["f_jaw_strong", "f_narrow", "f_gaunt", "f_round", "f_old"]


def beard_follow_jaw(o, base, v):
    """Bart folgt Kiefer und Gesichtsform (siehe follow_keys)."""
    follow_keys(o, base, v, ["jaw"] + BEARD_KEYS)


def follow_keys(o, base, v, names):
    """Haarkarten/Bart übernehmen Formziele von der nächsten Hautstelle (Kopf): sonst bleiben Haare starr,
    während Gesichtsvarianten den Schädel verformen – die Kopfhaut sticht dann durch."""
    from mathutils.kdtree import KDTree
    n = len(v)
    deltas = {nm: shape_deltas(nm, n) for nm in names}
    moved = np.zeros(n, dtype=bool)
    for d in deltas.values():
        moved |= np.abs(d).max(axis=1) > 1e-6
    idx = [i for i in sorted(base.groups["body"]) if moved[i] or v[i, 1] > FIG_EXTRA.get("neck_y", 0)]
    kd = KDTree(len(idx))
    for k_, i in enumerate(idx):
        kd.insert(B(v[i]), k_)
    kd.balance()
    near = []
    for vt in o.data.vertices:
        hits = kd.find_n(vt.co, 3)
        near.append([(idx[h[1]], 1.0 / max(h[2], 1e-4)) for h in hits])
    if not o.data.shape_keys:
        o.shape_key_add(name="Basis", from_mix=False)
    for nm, d in deltas.items():
        vals = []
        for lst in near:
            tot = sum(w for _, w in lst)
            vals.append(sum((d[i] * w for i, w in lst), np.zeros(3)) / max(tot, 1e-9))
        if max(float(np.abs(x).max()) for x in vals) < 5e-4:
            continue
        k = o.shape_key_add(name=nm, from_mix=False)
        for vt, dv in zip(o.data.vertices, vals):
            k.data[vt.index].co = vt.co + B(dv)


def add_keys_after_offset(o, used, v, names):
    """Formziele für ein (schon nach außen versetztes) Netz aus Körperpunkten: Delta auf die aktuelle Lage."""
    n = len(v)
    if not o.data.shape_keys:
        o.shape_key_add(name="Basis", from_mix=False)
    for nm in names:
        d = shape_deltas(nm, n)
        if not np.abs(d[used]).max() > 1e-6:
            continue
        k = o.shape_key_add(name=nm, from_mix=False)
        for j, i in enumerate(used):
            if d[i].any():
                k.data[j].co = o.data.vertices[j].co + B(d[i])


def human(kind):
    base, v, J, W = build_figure(kind)
    name = "human_" + kind
    rig = make_armature(name, J)
    objs = [rig]
    yb = (J["hips"][1] + J["spine"][1]) / 2 + 0.02  # Gürtellinie
    y_neck = J["neck"][1]
    y_wrist = J["handL"][1]
    y_knee = J["shinL"][1]
    y_ankle = J["footL"][1]
    ji = {j: i for i, j in enumerate(JOINTS)}
    ARM = [ji[j] for j in ("upperArmL", "foreArmL", "handL", "upperArmR", "foreArmR", "handR")]
    HAND = [ji["handL"], ji["handR"]]

    def wsum(vs, cols):
        return float(W[vs][:, cols].sum(axis=1).mean())

    def is_arm(c, vs):
        return wsum(vs, ARM) > 0.5

    # Haut: nur, was nie bedeckt ist (Kopf, Hals, Hände) – spart Geometrie, nichts sticht durch
    def skin_keep(c, vs):
        return c[1] > y_neck - 0.045 or (wsum(vs, HAND) > 0.5 and c[1] < y_wrist + 0.03)
    skin, used = make_mesh("skin", base, v, W, {"body"}, "skin", skin_keep)
    FIG_EXTRA["wrist_l"] = J["handL"]
    FIG_EXTRA["wrist_r"] = J["handR"]
    add_shape_keys(skin, used, v, W, list(SHAPES), hands=True)
    objs.append(finish_piece(skin, rig, 0))
    # Zähne und Zunge (sichtbar beim Sprechen), folgen Kiefer und Mimik
    mouth, mused = make_mesh("mouth", base, v, W, {"helper-upper-teeth", "helper-lower-teeth", "helper-tongue"}, "teeth")
    add_shape_keys(mouth, mused, v, W, ["jaw", "smile", "lips"])
    objs.append(finish_piece(mouth, rig, 0))
    objs.append(finish_piece(mouth_cavity(base, v, J), rig, 0))
    eyes, _ = make_mesh("eyes", base, v, W, {"helper-l-eye", "helper-r-eye"}, "eyeball")
    finish_piece(eyes, rig, 2)
    eye_uvs(eyes, [base.center(v, "helper-l-eye"), base.center(v, "helper-r-eye")])
    objs.append(eyes)

    def piece(pname, group, material, keep, dist, fold=0.0, subdiv=1, calm=0, band=None):
        o, _ = make_mesh(pname, base, v, W, {group}, material, keep)
        offset(o, dist)
        if calm:
            # erst nach außen schieben, dann beruhigen: bleibt eine geschlossene, glatte Schale
            smooth_shape(o, calm, 0.6)
        if band:
            clamp_band(o, *band)
        if fold:
            folds(o, J, fold)
        return finish_piece(o, rig, subdiv)

    # Hemd/Tunika: Rumpf bis zur Gürtellinie, Ärmel bis ans Handgelenk, Saum aus dem Rock bis übers Knie
    objs.append(piece("tunic", "helper-tights", "body",
                      lambda c, vs: c[1] < y_neck - 0.005 and (c[1] > yb - 0.05 or is_arm(c, vs)) and (not is_arm(c, vs) or c[1] > y_wrist + 0.025),
                      0.012, 0.004, band=(-1.0, y_neck - 0.018)))
    objs.append(piece("tunic_skirt", "helper-skirt", "body", lambda c, vs: c[1] > y_knee + 0.14, 0.018, 0.0))
    # Hose bis zum Knöchel, Stiefel bis zur halben Wade
    objs.append(piece("trousers", "helper-tights", "legs",
                      lambda c, vs: c[1] < yb + 0.04 and c[1] > y_ankle + 0.02 and not is_arm(c, vs), 0.005, 0.003))
    objs.append(piece("boots", "helper-tights", "accent",
                      lambda c, vs: c[1] < (y_knee + y_ankle) / 2 + 0.03 and not is_arm(c, vs), 0.014, 0.002))
    objs.append(piece("belt", "helper-tights", "accent", lambda c, vs: abs(c[1] - yb) < 0.034 and not is_arm(c, vs), 0.024, 0.0, 0,
                      band=(yb - 0.024, yb + 0.024)))
    # Robe (bis zu den Knöcheln)
    objs.append(piece("robe", "helper-skirt", "body", lambda c, vs: True, 0.03, 0.0))
    # Kapuze: Schale um den Kopf mit Gesichtsöffnung, beruhigt (keine Ohren/Nase), dazu ein Kragen
    head_c = J["head"]
    eye_y = base.center(v, "helper-l-eye")[1]

    def hood_keep(c, vs):
        if c[1] < y_neck + 0.01:
            return False
        face = c[2] > head_c[2] + 0.02 and c[1] < eye_y + 0.07 and abs(c[0]) < 0.075
        return not face
    objs.append(finish_piece(hood_shell(base, v, W, J, eye_y), rig, 0))
    objs.append(piece("hood_cowl", "helper-tights", "accent",
                      lambda c, vs: c[1] > y_neck - 0.22 and c[1] < y_neck + 0.02 and not is_arm(c, vs), 0.03, 0.0, 1, calm=8,
                      band=(y_neck - 0.2, y_neck + 0.03)))
    # Brustpanzer (glatt gewölbt) und Schulterstücke
    objs.append(piece("plates", "helper-tights", "body",
                      lambda c, vs: c[1] > yb and c[1] < y_neck - 0.06 and not is_arm(c, vs), 0.045, 0.0, 1, calm=60))
    objs.append(piece("pauldrons", "helper-tights", "body",
                      lambda c, vs: is_arm(c, vs) and c[1] > J["upperArmL"][1] - 0.13, 0.05, 0.0, 1, calm=20))
    for st in range(6):
        h = hair_style(st, base, v, J, W)
        if h is not None:
            for part in h:
                objs.append(finish_piece(part, rig, 0))
    if kind == "male":
        for st in range(4):
            bo = beard_style(st, base, v, J, W)
            if bo is not None:
                objs.append(finish_piece(bo, rig, 0))
    print(f"[mensch] {kind}: Größe {v[:, 1].max():.2f} m, Gürtel {yb:.2f}, Hals {y_neck:.2f}", flush=True)
    return objs


def mouth_cavity(base, v, J):
    """Dunkle Mundhöhle hinter den Lippen (sonst sieht man bei offenem Mund durch den Kopf).
    Unterer Teil folgt dem Kiefer-Formziel, damit die Höhle mitöffnet."""
    import bmesh
    teeth = base.center(v, "helper-upper-teeth")
    lower = base.center(v, "helper-lower-teeth")
    c = np.array([teeth[0], (teeth[1] + lower[1]) / 2 + 0.012, teeth[2]])
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=10, radius=1.0)
    bmesh.ops.scale(bm, vec=(0.024, 0.026, 0.022), verts=bm.verts)
    me = bpy.data.meshes.new("mouth_cavity")
    bm.to_mesh(me)
    bm.free()
    # Mittelpunkt etwas hinter die Zähne (Rig-Raum z = vorn)
    ctr = np.array([c[0], (c[1] + teeth[1]) / 2 - 0.006, teeth[2] - 0.022])
    for vt in me.vertices:
        vt.co += B(ctr)
    # Flächen nach innen zeigen lassen (von vorn sieht man die Innenseite)
    for poly in me.polygons:
        poly.flip()
    me.materials.append(bpy.data.materials.get("mouth_inner") or bpy.data.materials.new("mouth_inner"))
    o = bpy.data.objects.new("mouth_cavity", me)
    bpy.context.scene.collection.objects.link(o)
    vg = o.vertex_groups.new(name="head")
    vg.add(list(range(len(me.vertices))), 1.0, "REPLACE")
    # Kiefer: untere Hälfte mit dem Mundöffnen nach unten verschieben
    jaw = shape_deltas("jaw", len(v))
    chin_drop = float(np.abs(jaw[:, 1]).max()) * 0.85
    o.shape_key_add(name="Basis", from_mix=False)
    k = o.shape_key_add(name="jaw", from_mix=False)
    for i, vt in enumerate(me.vertices):
        if vt.co.z < B(ctr).z:
            k.data[i].co = vt.co + Vector((0, 0, -chin_drop))
    for p in me.polygons:
        p.use_smooth = True
    return o


def lod1(objs):
    """Vereinfachte Figur für die Entfernung: Netze auf ~25 %, Haare nur als Grundkappe, keine Bärte."""
    import lib
    rig = objs[0]
    out = [rig]
    for o in objs[1:]:
        n = o.name.split(".")[0]
        if (n.startswith("hair_") and not n.endswith("_cap")) or n.startswith("beard_"):
            continue
        c = o.copy()
        c.data = o.data.copy()
        bpy.context.scene.collection.objects.link(c)
        # Armatur-Modifikator bleibt, davor vereinfachen
        if c.data.shape_keys:
            c.shape_key_clear()
        if n in ("mouth", "mouth_cavity"):
            bpy.data.objects.remove(c, do_unlink=True)
            continue
        arm = [m for m in c.modifiers if m.type == "ARMATURE"]
        for m in arm:
            c.modifiers.remove(m)
        d = c.modifiers.new("lod", "DECIMATE")
        d.ratio = 0.3 if n in ("skin", "eyes") else 0.22
        lib.apply_mods(c)
        mod = c.modifiers.new("rig", "ARMATURE")
        mod.object = rig
        c.parent = rig
        c.name = n + "_lod1"
        out.append(c)
    return out


def build(kind):
    objs = human(kind)
    return {"lod0": objs, "lod1": lod1(objs)}


ASSETS = {
    "human_male": (lambda: build("male"), None),
    "human_female": (lambda: build("female"), None),
}
