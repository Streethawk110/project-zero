"""BVH lesen, Vorwärtskinematik und Quaternion-Helfer (numpy, vektorisiert über alle Bilder).

Konventionen wie im Spiel (three.js): rechtshändig, Y oben, Quaternionen als (x, y, z, w).
Rotationskanäle werden in der aufgeführten Reihenfolge multipliziert (BVH-Standard):
„Zrotation Yrotation Xrotation“ → R = Rz · Ry · Rx.
"""

from __future__ import annotations

import numpy as np


class Joint:
    def __init__(self, name: str, parent: int, offset: np.ndarray):
        self.name = name
        self.parent = parent
        self.offset = offset
        self.channels: list[str] = []
        self.ch0 = 0  # erster Kanal im Bilddatensatz
        self.end: np.ndarray | None = None  # Endpunkt (End Site) relativ zum Gelenk
        self.children: list[int] = []


class Bvh:
    def __init__(self, text: str):
        self.joints: list[Joint] = []
        tok = text.split()
        i = 0
        stack: list[int] = []
        nch = 0
        pending: str | None = None
        cur = -1
        while tok[i] != 'MOTION':
            t = tok[i]
            if t in ('ROOT', 'JOINT'):
                pending = tok[i + 1]
                i += 2
            elif t == 'End':
                pending = '__end__'
                i += 2
            elif t == '{':
                if pending == '__end__':
                    stack.append(-2)
                else:
                    parent = next((s for s in reversed(stack) if s >= 0), -1)
                    j = Joint(pending or '?', parent, np.zeros(3))
                    self.joints.append(j)
                    cur = len(self.joints) - 1
                    if parent >= 0:
                        self.joints[parent].children.append(cur)
                    stack.append(cur)
                pending = None
                i += 1
            elif t == '}':
                stack.pop()
                i += 1
            elif t == 'OFFSET':
                v = np.array([float(tok[i + 1]), float(tok[i + 2]), float(tok[i + 3])])
                if stack and stack[-1] == -2:
                    owner = next(s for s in reversed(stack) if s >= 0)
                    self.joints[owner].end = v
                else:
                    self.joints[stack[-1]].offset = v
                i += 4
            elif t == 'CHANNELS':
                n = int(tok[i + 1])
                j = self.joints[stack[-1]]
                j.channels = tok[i + 2:i + 2 + n]
                j.ch0 = nch
                nch += n
                i += 2 + n
            else:
                i += 1
        # MOTION
        i += 1
        assert tok[i] == 'Frames:'
        self.frames = int(tok[i + 1])
        assert tok[i + 2] == 'Frame' and tok[i + 3] == 'Time:'
        self.dt = float(tok[i + 4])
        vals = np.array(tok[i + 5:i + 5 + self.frames * nch], dtype=np.float64)
        self.data = vals.reshape(self.frames, nch)
        self.index = {j.name: k for k, j in enumerate(self.joints)}

    def fk(self, data: np.ndarray | None = None):
        """Weltrotationen (F, J, 3, 3) und Weltpositionen (F, J, 3) aller Gelenke."""
        d = self.data if data is None else data
        F, J = d.shape[0], len(self.joints)
        rot = np.zeros((F, J, 3, 3))
        pos = np.zeros((F, J, 3))
        for k, j in enumerate(self.joints):
            local = np.broadcast_to(np.eye(3), (F, 3, 3)).copy()
            trans = np.broadcast_to(j.offset, (F, 3)).copy()
            for c, name in enumerate(j.channels):
                v = d[:, j.ch0 + c]
                if name.endswith('position'):
                    trans[:, 'XYZ'.index(name[0])] = v if j.parent < 0 else trans[:, 'XYZ'.index(name[0])] + v
                else:
                    local = local @ axis_rot(name[0], np.radians(v))
            if j.parent < 0:
                rot[:, k] = local
                pos[:, k] = trans
            else:
                pr = rot[:, j.parent]
                rot[:, k] = pr @ local
                pos[:, k] = pos[:, j.parent] + np.einsum('fij,fj->fi', pr, trans)
        return rot, pos


def axis_rot(axis: str, a: np.ndarray) -> np.ndarray:
    c, s = np.cos(a), np.sin(a)
    o, z = np.ones_like(a), np.zeros_like(a)
    if axis == 'X':
        m = [[o, z, z], [z, c, -s], [z, s, c]]
    elif axis == 'Y':
        m = [[c, z, s], [z, o, z], [-s, z, c]]
    else:
        m = [[c, -s, z], [s, c, z], [z, z, o]]
    return np.moveaxis(np.array(m), (0, 1), (-2, -1))


# ---------------------------------------------------------------- Quaternionen (x, y, z, w)

def mat_to_quat(m: np.ndarray) -> np.ndarray:
    """Rotationsmatrizen (..., 3, 3) → Quaternionen (..., 4), w ≥ 0."""
    m = np.asarray(m)
    shp = m.shape[:-2]
    m = m.reshape(-1, 3, 3)
    q = np.zeros((m.shape[0], 4))
    tr = m[:, 0, 0] + m[:, 1, 1] + m[:, 2, 2]
    for i in range(m.shape[0]):
        a = m[i]
        if tr[i] > 0:
            s = np.sqrt(tr[i] + 1.0) * 2
            q[i] = [(a[2, 1] - a[1, 2]) / s, (a[0, 2] - a[2, 0]) / s, (a[1, 0] - a[0, 1]) / s, 0.25 * s]
        elif a[0, 0] > a[1, 1] and a[0, 0] > a[2, 2]:
            s = np.sqrt(1.0 + a[0, 0] - a[1, 1] - a[2, 2]) * 2
            q[i] = [0.25 * s, (a[0, 1] + a[1, 0]) / s, (a[0, 2] + a[2, 0]) / s, (a[2, 1] - a[1, 2]) / s]
        elif a[1, 1] > a[2, 2]:
            s = np.sqrt(1.0 + a[1, 1] - a[0, 0] - a[2, 2]) * 2
            q[i] = [(a[0, 1] + a[1, 0]) / s, 0.25 * s, (a[1, 2] + a[2, 1]) / s, (a[0, 2] - a[2, 0]) / s]
        else:
            s = np.sqrt(1.0 + a[2, 2] - a[0, 0] - a[1, 1]) * 2
            q[i] = [(a[0, 2] + a[2, 0]) / s, (a[1, 2] + a[2, 1]) / s, 0.25 * s, (a[1, 0] - a[0, 1]) / s]
    q /= np.linalg.norm(q, axis=-1, keepdims=True)
    q[q[:, 3] < 0] *= -1
    return q.reshape(*shp, 4)


def quat_to_mat(q: np.ndarray) -> np.ndarray:
    q = np.asarray(q)
    x, y, z, w = q[..., 0], q[..., 1], q[..., 2], q[..., 3]
    m = np.stack([
        np.stack([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], -1),
        np.stack([2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], -1),
        np.stack([2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)], -1),
    ], -2)
    return m


def qmul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ax, ay, az, aw = np.moveaxis(np.asarray(a), -1, 0)
    bx, by, bz, bw = np.moveaxis(np.asarray(b), -1, 0)
    return np.stack([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ], -1)


def qinv(q: np.ndarray) -> np.ndarray:
    q = np.array(q, dtype=np.float64)
    q[..., :3] *= -1
    return q


def qslerp(a: np.ndarray, b: np.ndarray, t) -> np.ndarray:
    a = np.asarray(a, dtype=np.float64)
    b = np.array(b, dtype=np.float64)
    t = np.asarray(t, dtype=np.float64)[..., None] if np.ndim(t) else t
    d = np.sum(a * b, -1, keepdims=True)
    b = np.where(d < 0, -b, b)
    d = np.abs(d)
    th = np.arccos(np.clip(d, -1, 1))
    s = np.sin(th)
    small = s < 1e-6
    wa = np.where(small, 1 - t, np.sin((1 - t) * th) / np.where(small, 1, s))
    wb = np.where(small, t, np.sin(t * th) / np.where(small, 1, s))
    r = wa * a + wb * b
    return r / np.linalg.norm(r, axis=-1, keepdims=True)


def arc(u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Kürzeste Drehung, die Richtung u auf v bringt (Quaternion)."""
    u = u / np.linalg.norm(u)
    v = v / np.linalg.norm(v)
    c = np.cross(u, v)
    d = float(np.dot(u, v))
    if d < -0.999999:
        ax = np.cross(u, [1, 0, 0])
        if np.linalg.norm(ax) < 1e-6:
            ax = np.cross(u, [0, 1, 0])
        ax /= np.linalg.norm(ax)
        return np.array([ax[0], ax[1], ax[2], 0.0])
    q = np.array([c[0], c[1], c[2], 1 + d])
    return q / np.linalg.norm(q)


def qrot(q: np.ndarray, v: np.ndarray) -> np.ndarray:
    return np.einsum('...ij,...j->...i', quat_to_mat(q), v)


def yaw_quat(a) -> np.ndarray:
    a = np.asarray(a, dtype=np.float64)
    return np.stack([np.zeros_like(a), np.sin(a / 2), np.zeros_like(a), np.cos(a / 2)], -1)


def continuous(q: np.ndarray) -> np.ndarray:
    """Vorzeichen entlang der Zeitachse (Achse 0) angleichen (für Glättung/Interpolation)."""
    q = q.copy()
    for f in range(1, q.shape[0]):
        flip = np.sum(q[f] * q[f - 1], -1) < 0
        q[f][flip] *= -1
    return q
