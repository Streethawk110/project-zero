#!/usr/bin/env python3
"""Bewegungsaufnahmen (Motion Capture) für die Spielfiguren aufbereiten.

Quelle: CMU Graphics Lab Motion Capture Database – http://mocap.cs.cmu.edu
  „The data used in this project was obtained from mocap.cs.cmu.edu.
   The database was created with funding from NSF EIA-0196217.“
Die Daten dürfen frei verwendet werden, auch kommerziell (siehe mocap.cs.cmu.edu/faqs.php).
Wir laden die BVH-Umwandlung (cgspeed) aus dem GitHub-Spiegel una-dinosauria/cmu-mocap.

Ablauf je Clip: BVH laden → Vorwärtskinematik → Ausschnitt wählen (Gangzyklen von Fersenaufsatz zu
Fersenaufsatz, sonst Bildbereich) → Blickrichtung und Vorwärtsbewegung entfernen → Nahtstelle
schließen (Schleifen) → auf 30 Bilder/s → Gelenkrotationen unseres 19-Gelenk-Rigs.

Übertragung (Retargeting): Für jedes Gelenk b wird die Weltrotation der Aufnahme S_b(t) verwendet.
Bezug ist Bild 0 jeder Datei (T-Pose). Rumpf, Kopf, Schlüsselbeine und Füße: G_b = S_b(t)·S_b(0)⁻¹ (dort
aufrecht, Blick geradeaus, Füße flach – wie unsere Ruhepose). Gliedmaßen: zusätzlich · A_b, die kürzeste
Drehung von unserer Ruherichtung des Knochens (Arme hängen) auf seine Richtung in der T-Pose. Gespeichert werden die
lokalen Rotationen L_b = G_eltern⁻¹ · G_b für unsere Ruherichtungen (Spalte „canon“ in der Datei);
der Client gleicht kleine Abweichungen seiner Figur (Frau, Körperbau) selbst aus.

Aufruf:
  python3 tools/anim/mocap.py build            # alle Clips → apps/client/public/assets/anim/clips.json
  python3 tools/anim/mocap.py info 16_15       # Tempo, Fußaufsätze, Zyklen
  python3 tools/anim/mocap.py strip 16_15 0 400 20 out.png   # Strichfiguren-Filmstreifen
"""

from __future__ import annotations

import base64
import json
import os
import sys
import urllib.request

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bvh import Bvh, arc, continuous, mat_to_quat, qinv, qmul, qrot, qslerp, quat_to_mat, yaw_quat  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.cache')
OUT = os.path.join(HERE, '..', '..', 'apps', 'client', 'public', 'assets', 'anim', 'clips.json')
URL = 'https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data/{s:03d}/{c}.bvh'
FPS = 30

# Unser Rig (Reihenfolge wie rig.ts) und die zugeordneten Gelenke der Aufnahme
JOINTS = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'upperArmL', 'foreArmL', 'handL', 'shoulderR', 'upperArmR',
          'foreArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']
PARENT = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck', 'shoulderL': 'chest', 'upperArmL': 'shoulderL',
          'foreArmL': 'upperArmL', 'handL': 'foreArmL', 'shoulderR': 'chest', 'upperArmR': 'shoulderR', 'foreArmR': 'upperArmR', 'handR': 'foreArmR',
          'thighL': 'hips', 'shinL': 'thighL', 'footL': 'shinL', 'thighR': 'hips', 'shinR': 'thighR', 'footR': 'shinR'}
SRC = {'hips': 'Hips', 'spine': 'Spine', 'chest': 'Spine1', 'neck': 'Neck1', 'head': 'Head', 'shoulderL': 'LeftShoulder', 'upperArmL': 'LeftArm',
       'foreArmL': 'LeftForeArm', 'handL': 'LeftHand', 'shoulderR': 'RightShoulder', 'upperArmR': 'RightArm', 'foreArmR': 'RightForeArm',
       'handR': 'RightHand', 'thighL': 'LeftUpLeg', 'shinL': 'LeftLeg', 'footL': 'LeftFoot', 'thighR': 'RightUpLeg', 'shinR': 'RightLeg',
       'footR': 'RightFoot'}
# Knochenrichtung der Nullpose der Aufnahme: Gelenk → Kindgelenk
SRC_CHILD = {'upperArmL': 'LeftForeArm', 'foreArmL': 'LeftHand', 'handL': 'LeftHandIndex1', 'upperArmR': 'RightForeArm', 'foreArmR': 'RightHand',
             'handR': 'RightHandIndex1', 'thighL': 'LeftLeg', 'shinL': 'LeftFoot', 'thighR': 'RightLeg', 'shinR': 'RightFoot'}

# Ruhepose unserer Figur (Mann, tools/blender/human.py; Rig-Raum, Füße auf 0, Blick +Z)
REST = {
    'hips': [0.0, 0.969, 0.0069], 'spine': [0.0, 1.13, -0.0163], 'chest': [0.0, 1.193, -0.0249], 'neck': [0.0, 1.5491, 0.0155],
    'head': [0.0, 1.6484, 0.0484], 'shoulderL': [0.0238, 1.4717, 0.0275], 'upperArmL': [0.199, 1.4412, 0.0222],
    'foreArmL': [0.2326, 1.1826, 0.0222], 'handL': [0.2594, 0.9142, 0.0383], 'shoulderR': [-0.0238, 1.4717, 0.0275],
    'upperArmR': [-0.199, 1.4412, 0.0222], 'foreArmR': [-0.2326, 1.1826, 0.0222], 'handR': [-0.2594, 0.9142, 0.0383],
    'thighL': [0.113, 0.9633, -0.0039], 'shinL': [0.156, 0.5239, 0.0317], 'footL': [0.2022, 0.0747, 0.0195],
    'thighR': [-0.113, 0.9633, -0.0039], 'shinR': [-0.156, 0.5239, 0.0317], 'footR': [-0.2022, 0.0747, 0.0195],
}
REST_CHILD = {'upperArmL': 'foreArmL', 'foreArmL': 'handL', 'upperArmR': 'foreArmR', 'foreArmR': 'handR', 'thighL': 'shinL', 'shinL': 'footL',
              'thighR': 'shinR', 'shinR': 'footR'}


def canon_dir(j: str) -> np.ndarray:
    """Ruherichtung eines Gliedmaßenknochens unserer Figur (Hand: wie der Unterarm)."""
    if j.startswith('hand'):
        j = 'foreArm' + j[-1]
    a, b = np.array(REST[j]), np.array(REST[REST_CHILD[j]])
    d = b - a
    return d / np.linalg.norm(d)


# ---------------------------------------------------------------- Laden

def fetch(clip: str) -> str:
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f'{clip}.bvh')
    if not os.path.exists(path):
        s = int(clip.split('_')[0])
        url = URL.format(s=s, c=clip)
        print('lade', url, file=sys.stderr)
        with urllib.request.urlopen(url, timeout=60) as r:
            data = r.read()
        with open(path + '.part', 'wb') as f:
            f.write(data)
        os.replace(path + '.part', path)
    return path


class Take:
    """Eine Aufnahme mit Vorwärtskinematik in Metern (Maßstab: Beinlänge unserer Figur)."""

    def __init__(self, clip: str):
        self.clip = clip
        self.b = Bvh(open(fetch(clip)).read())
        self.dt = self.b.dt
        rot, pos = self.b.fk()
        I = self.b.index
        leg = sum(np.linalg.norm(self.b.joints[I[n]].offset) for n in ('LeftLeg', 'LeftFoot'))
        ours = np.linalg.norm(np.subtract(REST['shinL'], REST['thighL'])) + np.linalg.norm(np.subtract(REST['footL'], REST['shinL']))
        self.scale = ours / leg
        self.rot = rot
        self.pos = pos * self.scale
        # Boden: tiefste Fußgelenke (Knöchel liegen bei uns 7,5 cm über dem Boden)
        feet = np.concatenate([self.pos[:, I['LeftFoot'], 1], self.pos[:, I['RightFoot'], 1]])
        self.floor = float(np.percentile(feet, 2)) - REST['footL'][1]
        self.pos[..., 1] -= self.floor
        self.frames = self.b.frames

    def P(self, name: str) -> np.ndarray:
        return self.pos[:, self.b.index[name]]

    def R(self, name: str) -> np.ndarray:
        return self.rot[:, self.b.index[name]]

    def hip_center(self) -> np.ndarray:
        return (self.P('LeftUpLeg') + self.P('RightUpLeg')) / 2

    def facing(self) -> np.ndarray:
        """Blickrichtung (Gierwinkel) des Beckens je Bild: Beckenquerachse rechts→links, vorwärts = senkrecht dazu."""
        x = self.P('LeftUpLeg') - self.P('RightUpLeg')
        fw = np.cross(x, np.array([0, 1, 0]))  # links (+X) × oben = vorwärts (+Z)
        return np.arctan2(fw[:, 0], fw[:, 2])

    def contact_mask(self, side: str) -> np.ndarray:
        """Bodenkontakt je Bild: Knöchel oder Ballen nahe am Boden und (fast) in Ruhe – relativ zum Körpertempo,
        damit es auch beim Rennen (kurzer Bodenkontakt) greift."""
        a, b = self.P(f'{side}Foot'), self.P(f'{side}ToeBase')
        hc = self.hip_center()
        vb = np.r_[0, np.hypot(*np.diff(hc[:, [0, 2]], axis=0).T) / self.dt]
        vb = np.convolve(vb, np.ones(15) / 15, mode='same')
        m = np.zeros(self.frames, bool)
        for p in (a, b):
            v = np.r_[0, np.hypot(*np.diff(p[:, [0, 2]], axis=0).T) / self.dt]
            v = np.convolve(v, np.ones(3) / 3, mode='same')
            low = np.percentile(p[:, 1], 5)
            m |= (p[:, 1] < low + 0.045) & (v < np.maximum(0.45, 0.3 * vb))
        return m

    def contacts(self, side: str) -> list[int]:
        """Fußaufsätze: Beginn jeder Kontaktphase (nach mindestens 0,1 s in der Luft)."""
        m = self.contact_mask(side)
        out, air = [], 99
        for f in range(1, self.frames):
            if m[f] and air >= 12:
                out.append(f)
            air = 0 if m[f] else air + 1
        return out


# ---------------------------------------------------------------- Übertragung auf unser Rig

LIMBS = set(SRC_CHILD)


def retarget(t: Take, f0: int, f1: int, heading: float | None = None):
    """Lokale Rotationen (F, 19, 4) unseres Rigs und Hüftversatz (F, 3) für Bilder f0..f1 (einschließlich).

    heading: Gierwinkel, der als „vorwärts“ gilt (None = mittlere Blickrichtung des Beckens).
    """
    fr = np.arange(f0, f1 + 1)
    if heading is None:
        fa = t.facing()[fr]
        heading = float(np.arctan2(np.sin(fa).mean(), np.cos(fa).mean()))
    Hinv = quat_to_mat(yaw_quat(-heading))
    I = t.b.index
    G = {}
    for j in JOINTS:
        # Bezug ist Bild 0 (T-Pose der cgspeed-Umwandlung): dort stehen Füße flach, Kopf blickt geradeaus –
        # in der Nullpose (alle Winkel 0) wären die Füße um 21° gekippt und der Kopf 16° angehoben
        k = I[SRC[j]]
        S = Hinv @ t.rot[fr, k] @ t.rot[0, k].T
        if j in LIMBS:
            d = t.pos[0, I[SRC_CHILD[j]]] - t.pos[0, k]
            A = quat_to_mat(arc(canon_dir(j), d))
            S = S @ A
        G[j] = S
    L = np.zeros((len(fr), len(JOINTS), 4))
    for k, j in enumerate(JOINTS):
        p = PARENT[j]
        loc = G[j] if p is None else np.transpose(G[p], (0, 2, 1)) @ G[j]
        L[:, k] = mat_to_quat(loc)
    L = continuous(L)
    hc = np.einsum('ij,fj->fi', Hinv, t.hip_center()[fr])
    mid = (np.array(REST['thighL']) + np.array(REST['thighR'])) / 2
    root = hc - mid
    return L, root, heading


def smooth_quats(q: np.ndarray, sigma: float) -> np.ndarray:
    """Gauß-Glättung entlang der Zeit (Vorzeichen vorher angeglichen), Ränder gespiegelt."""
    if sigma <= 0:
        return q
    r = int(3 * sigma)
    w = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    w /= w.sum()
    pad = np.concatenate([q[r:0:-1], q, q[-2:-r - 2:-1]], 0)
    out = np.zeros_like(q)
    for i, wi in enumerate(w):
        out += wi * pad[i:i + len(q)]
    return out / np.linalg.norm(out, axis=-1, keepdims=True)


def close_loop(L: np.ndarray, root: np.ndarray):
    """Letztes Bild = erstes Bild: Restfehler je Gelenk gleichmäßig über den Zyklus verteilen."""
    N = len(L) - 1
    k = (np.arange(N + 1) / N)[:, None]
    delta = qmul(L[N], qinv(L[0]))  # Start → Ende (je Gelenk)
    corr = qslerp(np.broadcast_to([0, 0, 0, 1.0], delta.shape), qinv(delta), k[..., None].repeat(len(JOINTS), 1)[..., 0])
    L = qmul(corr, L)
    root = root - k * (root[N] - root[0])
    return continuous(L[:N]), root[:N]


def resample(L: np.ndarray, root: np.ndarray, src_dt: float, loop: bool):
    """Auf 30 Bilder/s (Schleifen: gleichmäßig über die Periode, damit die Naht stimmt)."""
    n = len(L)
    T = (n if loop else n - 1) * src_dt
    m = max(2, int(round(T * FPS)))
    ts = np.arange(m) * (T / m if loop else T / (m - 1))
    x = ts / src_dt
    i0 = np.floor(x).astype(int)
    a = x - i0
    i1 = (i0 + 1) % n if loop else np.minimum(i0 + 1, n - 1)
    i0 = np.minimum(i0, n - 1)
    Lo = qslerp(L[i0], L[i1], a[:, None].repeat(len(JOINTS), 1))
    Ro = root[i0] * (1 - a)[:, None] + root[i1] * a[:, None]
    return continuous(Lo), Ro, T


def pack(L: np.ndarray, root: np.ndarray) -> dict:
    q = np.clip(np.round(L.reshape(-1) * 32767), -32767, 32767).astype('<i2')
    p = np.clip(np.round(root.reshape(-1) * 10000), -32767, 32767).astype('<i2')
    return {'q': base64.b64encode(q.tobytes()).decode(), 'p': base64.b64encode(p.tobytes()).decode()}


def gait_clip(clip: str, start: int = 0, cycles: int = 1, sigma: float = 1.5, head: float = 1.0, flip: bool = False):
    """Gangzyklus von Fersenaufsatz links bis Fersenaufsatz links (erster Aufsatz ab Bild start).

    Blickrichtung: Laufrichtung, eingerastet auf vorwärts/rückwärts/seitwärts relativ zum Becken – so wandern
    die Füße genau entlang der Bewegung, auch wenn die Person leicht schräg läuft.
    """
    t = Take(clip)
    Lc = [f for f in t.contacts('Left') if f >= start]
    f0, f1 = Lc[0], Lc[cycles]
    # Fußaufsätze als Phase im Zyklus (links = 0) – für Schrittgeräusche
    steps = [0.0] + [round((r - f0) / (f1 - f0), 3) for r in t.contacts('Right') if f0 < r < f1]
    hc = t.hip_center()
    d = hc[f1] - hc[f0]
    travel = float(np.arctan2(d[0], d[2]))
    fa = t.facing()[f0:f1 + 1]
    face = float(np.arctan2(np.sin(fa).mean(), np.cos(fa).mean()))
    rel = np.degrees(np.arctan2(np.sin(travel - face), np.cos(travel - face)))
    snap = min((0, 90, 180, -90, -180), key=lambda a: abs(rel - a))
    heading = travel - np.radians(snap)
    L, root, _ = retarget(t, f0, f1, heading)
    if head < 1:
        L = calm_head(L, head)
    if flip:
        L, root = mirror(L, root)
        snap = -snap
    L = smooth_quats(L, sigma)
    dist = float(np.hypot(d[0], d[2]))
    L, root = close_loop(L, root)
    root[:, [0, 2]] -= root[:, [0, 2]].mean(0)
    L, root, T = resample(L, root, t.dt, True)
    return {'src': clip, 'range': [f0, f1], 'loop': True, 'dur': round(T, 4), 'speed': round(dist / T, 3), 'dist': round(dist, 3),
            'dir': int(snap if snap != -180 else 180), 'steps': steps, **pack(L, root)}


def pose_dist(La: np.ndarray, Lb: np.ndarray) -> np.ndarray:
    """Unterschied zweier Posen (Summe der Gelenkwinkel, Rumpf und Beine doppelt)."""
    d = np.abs(np.sum(La * Lb, -1)).clip(0, 1)
    w = np.array([2, 2, 2, 1, 1, 1, 1, 1, 0.5, 1, 1, 1, 0.5, 2, 2, 1, 2, 2, 1])
    return (2 * np.arccos(d) * w).sum(-1)


def best_loop(t: 'Take', f0: int, lo: int, hi: int) -> int:
    """Endbild zwischen lo und hi, dessen Pose (und Hüftlage) dem Startbild am nächsten kommt."""
    L, root, _ = retarget(t, f0, hi)
    cand = np.arange(lo - f0, hi - f0 + 1)
    d = pose_dist(L[cand], L[0][None]) + 8 * np.linalg.norm(root[cand] - root[0], axis=-1)
    return int(f0 + cand[int(np.argmin(d))])


def calm_head(L: np.ndarray, k: float) -> np.ndarray:
    """Hals und Kopf nur zum Anteil k mitnehmen (Blick übernimmt das Spiel: Blickziel, Umsehen)."""
    ident = np.broadcast_to([0, 0, 0, 1.0], L.shape[:1] + (4,))
    for j in ('neck', 'head'):
        i = JOINTS.index(j)
        L[:, i] = qslerp(ident, L[:, i], np.full(len(L), k))
    return L


def mirror(L: np.ndarray, root: np.ndarray):
    """Spiegeln links ↔ rechts (unser Rig ist symmetrisch): Gelenke tauschen, Drehungen an der YZ-Ebene spiegeln."""
    idx = [JOINTS.index(j[:-1] + ('R' if j.endswith('L') else 'L')) if j[-1] in 'LR' and j not in ('hips',) else JOINTS.index(j) for j in JOINTS]
    M = L[:, idx].copy()
    M[..., 1] *= -1
    M[..., 2] *= -1
    R = root.copy()
    R[:, 0] *= -1
    return M, R


def auto_loop(t: 'Take', lo: int, hi: int, min_len: float, max_len: float, active: float = 0) -> tuple[int, int]:
    """Schleifenstück im Bereich lo..hi suchen: Anfangs- und Endpose (samt kurz danach) möglichst gleich;
    active > 0 bevorzugt Stücke mit viel Armbewegung (Gesten beim Reden)."""
    hi = min(hi, t.frames - 8)
    L, root, _ = retarget(t, lo, hi)
    n = len(L)
    a, b = int(min_len / t.dt), int(max_len / t.dt)
    arms = [JOINTS.index(j) for j in ('upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR')]
    sp = np.r_[0, 2 * np.arccos(np.clip(np.abs(np.sum(L[1:, arms] * L[:-1, arms], -1)), 0, 1)).sum(-1) / t.dt]
    csp = np.cumsum(sp)
    best, arg = 1e9, (lo, lo + a)
    for i in range(0, n - a - 7, 6):
        j = np.arange(i + a, min(n - 7, i + b), 2)
        if not len(j):
            continue
        d = pose_dist(L[j], L[i][None]) + pose_dist(L[j + 6], L[i + 6][None]) + 10 * np.linalg.norm(root[j] - root[i], axis=-1)
        if active:
            d = d - active * (csp[j] - csp[i]) / (j - i)
        k = int(np.argmin(d))
        if d[k] < best:
            best, arg = float(d[k]), (lo + i, lo + int(j[k]))
    return arg


def work_clip(clip: str, lo: int, hi: int, min_len: float = 2.0, max_len: float = 6.0, head: float = 0.8, sigma: float = 2.0,
              active: float = 0, legs: bool = False, flip: bool = False):
    """Wiederkehrende Tätigkeit (Hämmern, Hacken, Fegen …) als Schleife: bestes Stück automatisch."""
    t = Take(clip)
    f0, f1 = auto_loop(t, lo, hi, min_len, max_len, active)
    return span_clip(clip, f0, f1, loop=True, sigma=sigma, head=head, legs=legs, flip=flip)


LOWER = ['hips', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']


def standing_legs(n: int):
    """Beine und Becken aus einer ruhigen Standaufnahme (n Bilder, bei Bedarf wiederholt)."""
    t = Take('113_21')
    L, root, _ = retarget(t, 150, 150 + max(n, 300))
    L, root = L[:n], root[:n]
    return L, root


def span_clip(clip: str, f0: int, f1: int, loop: bool = False, sigma: float = 1.5, heading: float | None = None, keep_xz: bool = False,
              search: int = 0, head: float = 1.0, legs: bool = False, flip: bool = False, anchor_end: bool = False):
    """Bildbereich (z. B. Stehen, Reden, Arbeit); loop=True schließt die Naht (search: Endbild ± so viele Bilder suchen).
    legs: Becken und Beine aus einer Standaufnahme (wenn die Person z. B. ein Bein weit abspreizt)."""
    t = Take(clip)
    if loop and search:
        f1 = best_loop(t, f0, f1 - search, f1 + search)
    L, root, hd = retarget(t, f0, f1, heading)
    if legs:
        SL, sroot = standing_legs(len(L))
        for j in LOWER:
            L[:, JOINTS.index(j)] = SL[:, JOINTS.index(j)]
        root = sroot
        L = continuous(L)
    if flip:
        L, root = mirror(L, root)
    if head < 1:
        L = calm_head(L, head)
    L = smooth_quats(L, sigma)
    if loop:
        L, root = close_loop(L, root)
    if not keep_xz:
        root[:, [0, 2]] -= root[-1 if anchor_end else 0, [0, 2]] if not loop else root[:, [0, 2]].mean(0)
    L, root, T = resample(L, root, t.dt, loop)
    return {'src': clip, 'range': [f0, f1], 'loop': loop, 'dur': round(T, 4), **pack(L, root)}


CLIPS = {
    # Gangarten (Schleifen, linker Fersenaufsatz = Phase 0)
    'walk': lambda: gait_clip('16_15', 140),
    'walk_fast': lambda: gait_clip('16_21', 45),
    'jog': lambda: gait_clip('16_36', 80),
    'run': lambda: gait_clip('16_55', 100),
    'sprint': lambda: gait_clip('143_01', 5),
    'walk_back': lambda: gait_clip('143_39', 240, head=0.4),
    'walk_left': lambda: gait_clip('143_40', 180, head=0.4),
    'walk_right': lambda: gait_clip('143_40', 180, head=0.4, flip=True),
    # Stehen (Varianten wechseln sich ab)
    'idle': lambda: span_clip('111_28', 130, 470, loop=True, search=40, sigma=3, head=0.5),
    'idle2': lambda: span_clip('113_21', 150, 400, loop=True, search=40, sigma=3, head=0.35),
    'idle3': lambda: span_clip('143_30', 20, 360, sigma=2, head=0.8),  # Strecken und Gähnen (einmal)
    # Reden (Gesten)
    'talk': lambda: work_clip('18_08', 150, 2080, 3, 7, head=0.6, active=1.5),
    'talk2': lambda: work_clip('19_08', 150, 2080, 3, 7, head=0.6, active=0.5),
    'talk3': lambda: work_clip('80_48', 150, 1100, 3, 7, head=0.6, active=1.0, legs=True),
    # Arbeit
    'work_hammer': lambda: work_clip('62_07', 150, 1100, 1.5, 4),
    'work_chop': lambda: work_clip('79_01', 130, 580, 1.5, 4),
    'work_rake': lambda: work_clip('79_87', 130, 780, 2, 5),
    'work_dig': lambda: work_clip('79_04', 130, 900, 2, 5),
    'work_sweep': lambda: work_clip('79_55', 130, 630, 1.5, 4),
    'work_wash': lambda: work_clip('79_44', 130, 1000, 2, 5, legs=True),
    'work_write': lambda: work_clip('79_31', 130, 570, 2, 4, legs=True),
    'work_fish': lambda: work_clip('79_34', 130, 740, 2, 5),
    'work_sew': lambda: work_clip('79_05', 130, 980, 2, 5, legs=True),
    'work_mix': lambda: work_clip('79_13', 130, 650, 1.5, 4, legs=True),
    'work_slice': lambda: work_clip('79_09', 130, 830, 1.5, 4, legs=True),
    'work_train': lambda: work_clip('02_07', 150, 2200, 2, 5),
    'work_carry': lambda: work_clip('79_25', 130, 590, 2, 5),
    # Sitzen
    'sit': lambda: span_clip('114_05', 200, 1500, loop=True, search=120, sigma=3, head=0.5),
    'sit_down': lambda: span_clip('113_15', 170, 300, sigma=2, anchor_end=True),
    'stand_up': lambda: span_clip('113_15', 600, 710, sigma=2),
    'sit_ground': lambda: span_clip('82_05', 200, 1400, loop=True, search=120, sigma=3, head=0.5),
    # Gesten
    'wave': lambda: work_clip('143_25', 60, 640, 1.0, 2.5, head=0.8, flip=True),
    'bow': lambda: span_clip('113_02', 50, 330, sigma=2),
    'curtsey': lambda: span_clip('141_26', 150, 330, sigma=2),
    'cheer': lambda: work_clip('79_69', 130, 800, 1.5, 3.5),
    'laugh': lambda: work_clip('79_70', 130, 740, 2, 4),
    # Hantieren
    'interact': lambda: work_clip('139_06', 200, 420, 1.2, 2.2),
    'pickup': lambda: span_clip('111_17', 60, 340, sigma=2),
    'work_serve': lambda: work_clip('80_27', 130, 1050, 2, 5, legs=True),
    'work_saw': lambda: work_clip('62_03', 150, 1200, 1.5, 4),
}


def build(names: list[str] | None = None):
    out = {'fps': FPS, 'joints': JOINTS, 'canon': {j: [round(float(x), 5) for x in canon_dir(j)] for j in sorted(LIMBS)},
           'credit': 'CMU Graphics Lab Motion Capture Database, mocap.cs.cmu.edu (NSF EIA-0196217)', 'clips': {}}
    if names and os.path.exists(OUT):
        out['clips'] = json.load(open(OUT))['clips']
    for name, fn in CLIPS.items():
        if names and name not in names:
            continue
        c = fn()
        out['clips'][name] = c
        extra = f", {c['speed']} m/s" if 'speed' in c else ''
        print(f'{name:14s} {c["src"]:7s} {c["range"]} {c["dur"]:.2f} s{extra}')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('geschrieben', os.path.relpath(OUT), f'{os.path.getsize(OUT) / 1024:.0f} KB')


# ---------------------------------------------------------------- Werkzeuge

def info(clip: str):
    t = Take(clip)
    hc = t.hip_center()
    v = np.diff(hc, axis=0) / t.dt
    sp = np.hypot(v[:, 0], v[:, 2])
    print(f'{clip}: {t.frames} Bilder ({t.frames * t.dt:.1f} s), Maßstab {t.scale:.4f} m/Einheit, Boden {t.floor:.3f}')
    L, R = t.contacts('Left'), t.contacts('Right')
    print('  Fersenaufsatz links :', L)
    print('  Fersenaufsatz rechts:', R)
    for a, b in zip(L, L[1:]):
        d = hc[b] - hc[a]
        print(f'  Zyklus {a}–{b}: {(b - a) * t.dt:.2f} s, Strecke {np.hypot(d[0], d[2]):.2f} m, Tempo {np.hypot(d[0], d[2]) / ((b - a) * t.dt):.2f} m/s, Richtung {np.degrees(np.arctan2(d[0], d[2])):.0f}°')
    step = max(1, t.frames // 40)
    for f in range(0, t.frames, step):
        print(f'  {f:5d} Tempo {sp[min(f, len(sp) - 1)]:.2f}  Hüfte {hc[f, 1]:.2f}  Blick {np.degrees(t.facing()[f]):6.0f}°  L {t.P("LeftFoot")[f, 1]:.2f} R {t.P("RightFoot")[f, 1]:.2f}')


BONES = [('Hips', 'LowerBack'), ('LowerBack', 'Spine'), ('Spine', 'Spine1'), ('Spine1', 'Neck1'), ('Neck1', 'Head'), ('Spine1', 'LeftArm'),
         ('LeftArm', 'LeftForeArm'), ('LeftForeArm', 'LeftHand'), ('LeftHand', 'LeftHandIndex1'), ('Spine1', 'RightArm'), ('RightArm', 'RightForeArm'),
         ('RightForeArm', 'RightHand'), ('RightHand', 'RightHandIndex1'), ('Hips', 'LeftUpLeg'), ('LeftUpLeg', 'LeftLeg'), ('LeftLeg', 'LeftFoot'),
         ('LeftFoot', 'LeftToeBase'), ('Hips', 'RightUpLeg'), ('RightUpLeg', 'RightLeg'), ('RightLeg', 'RightFoot'), ('RightFoot', 'RightToeBase')]


def strip(clip: str, f0: int, f1: int, step: int, out: str):
    """Filmstreifen aus Strichfiguren: oben Seitenansicht, unten Vorderansicht (links blau, rechts rot)."""
    from PIL import Image, ImageDraw
    t = Take(clip)
    frames = list(range(f0, min(f1, t.frames), step))
    W, H, S = 150, 230, 110
    img = Image.new('RGB', (W * len(frames), H * 2), (245, 245, 240))
    dr = ImageDraw.Draw(img)
    fac = t.facing()
    for i, f in enumerate(frames):
        hc = t.hip_center()[f]
        yaw = fac[f]
        c, s = np.cos(-yaw), np.sin(-yaw)
        for row in range(2):
            ox, oy = W * i + W / 2, H * row + H - 12

            def pr(p):
                d = p - hc
                x, z = c * d[0] + s * d[2], -s * d[0] + c * d[2]
                # Seitenansicht: vorwärts nach rechts; Vorderansicht: Figur links = Bild rechts
                u = z if row == 0 else x
                return ox + u * S, oy - p[1] * S
            for a, b in BONES:
                col = (40, 90, 200) if 'Left' in a + b else (200, 50, 40) if 'Right' in a + b else (30, 30, 30)
                dr.line([pr(t.P(a)[f]), pr(t.P(b)[f])], fill=col, width=3)
            dr.line([ox - W / 2 + 4, oy, ox + W / 2 - 4, oy], fill=(150, 150, 150))
            dr.text((ox - W / 2 + 4, H * row + 4), f'{f}', fill=(0, 0, 0))
    img.save(out)
    print('gespeichert', out)


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'build'
    if cmd == 'build':
        build(sys.argv[2:] or None)
    elif cmd == 'info':
        for c in sys.argv[2:]:
            info(c)
    elif cmd == 'strip':
        strip(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), sys.argv[6])
    elif cmd == 'fetch':
        for c in sys.argv[2:]:
            fetch(c)
