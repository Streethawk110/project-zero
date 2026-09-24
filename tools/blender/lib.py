"""Gemeinsame Helfer für die Blender-Skripte von Project Zero.

Konventionen:
  * Blender: Z oben. Vorderseiten von Gebäuden/Requisiten zeigen nach +Y
    (im glTF daraus -Z, passend zur Spielkonvention „Yaw 0 = Blick nach -Z").
  * Figuren und Kreaturen blicken nach -Y (glTF +Z = Rig-Vorderseite im Spiel).
  * Materialnamen werden im Spiel auf prozedurale PBR-Materialien abgebildet
    (wood, wood_dark, plaster, roof, roof_thatch, stone, stone_block, stone_moss,
    bark, metal, metal_dark, metal_gold, cloth_*, leather, crystal, glow_warm,
    glow_null, leaves, leaves_pine, skin, hay, salt, ore, herb, water …).
"""
import math
import os
import random

import bpy  # noqa: I001  (muss vor addon_utils geladen werden)
import addon_utils
import bmesh
from mathutils import Matrix, Vector

addon_utils.enable("io_scene_gltf2", default_set=True)

OUT_DIR = os.environ.get("PZ_MODEL_OUT", os.path.join(os.path.dirname(__file__), "..", "..", "apps", "client", "public", "assets", "models"))

PREVIEW_COLORS = {
    "wood": (0.42, 0.29, 0.18), "wood_dark": (0.25, 0.17, 0.11), "plaster": (0.82, 0.77, 0.66), "roof": (0.45, 0.24, 0.18),
    "roof_thatch": (0.6, 0.5, 0.28), "stone": (0.5, 0.49, 0.46), "stone_block": (0.55, 0.53, 0.5), "stone_moss": (0.45, 0.5, 0.4),
    "bark": (0.3, 0.22, 0.16), "metal": (0.6, 0.62, 0.65), "metal_dark": (0.2, 0.2, 0.22), "metal_gold": (0.8, 0.63, 0.3),
    "cloth_red": (0.5, 0.15, 0.12), "cloth_blue": (0.17, 0.27, 0.41), "cloth_white": (0.85, 0.82, 0.76), "cloth_green": (0.23, 0.32, 0.19),
    "cloth": (0.54, 0.49, 0.4), "leather": (0.35, 0.23, 0.15), "crystal": (0.62, 0.97, 1.0), "glow_warm": (1.0, 0.7, 0.4),
    "glow_null": (0.62, 0.97, 1.0), "leaves": (0.29, 0.42, 0.18), "leaves_pine": (0.18, 0.29, 0.16), "skin": (0.88, 0.7, 0.57),
    "hay": (0.85, 0.76, 0.48), "salt": (0.93, 0.92, 0.88), "ore": (0.69, 0.48, 0.38), "herb": (0.6, 0.72, 0.66), "water": (0.16, 0.27, 0.29),
    "legs": (0.3, 0.26, 0.22), "accent": (0.4, 0.3, 0.2), "eyewhite": (0.9, 0.88, 0.85), "iris": (0.25, 0.18, 0.1), "body": (0.55, 0.48, 0.36), "hair": (0.23, 0.15, 0.09), "eye": (0.1, 0.1, 0.1),
    "hide": (0.42, 0.35, 0.29), "fur": (0.29, 0.25, 0.35), "window": (0.1, 0.12, 0.14), "void": (0.01, 0.01, 0.012), "rope": (0.62, 0.52, 0.36),
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        c = PREVIEW_COLORS.get(name.split(".")[0], (0.6, 0.6, 0.6))
        m.diffuse_color = (*c, 1.0)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (*c, 1.0)
    return m


def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_obj(name, bm, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    if material:
        me.materials.append(mat(material))
    return _link(obj)


def box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), material="wood", bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    o = mesh_obj(name, bm, material)
    o.location = loc
    o.rotation_euler = rot
    if bevel > 0:
        add_bevel(o, bevel, 2)
    return o


def cyl(name, r, h, loc=(0, 0, 0), rot=(0, 0, 0), material="wood", seg=12, r2=None, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    o = mesh_obj(name, bm, material)
    o.location = loc
    o.rotation_euler = rot
    return o


def cone(name, r, h, loc=(0, 0, 0), rot=(0, 0, 0), material="wood", seg=12):
    return cyl(name, r, h, loc, rot, material, seg, r2=0.0)


def ico(name, r, loc=(0, 0, 0), material="stone", sub=2, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    o = mesh_obj(name, bm, material)
    o.location = loc
    o.scale = scale
    return o


def uvsphere(name, r, loc=(0, 0, 0), material="stone", seg=16, rings=10, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    o = mesh_obj(name, bm, material)
    o.location = loc
    o.scale = scale
    return o


def beam(name, p0, p1, w=0.18, d=None, material="wood_dark"):
    """Quaderbalken zwischen zwei Punkten."""
    p0, p1 = Vector(p0), Vector(p1)
    d = w if d is None else d
    length = (p1 - p0).length
    o = box(name, (w, d, length), material=material)
    direction = (p1 - p0).normalized()
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction)
    o.location = (p0 + p1) / 2
    return o


def prism_roof(name, width, depth, height, loc, overhang=0.4, material="roof", thickness=0.15):
    """Satteldach: First entlang X."""
    w = width / 2 + overhang
    d = depth / 2 + overhang
    bm = bmesh.new()
    verts = [
        bm.verts.new((-w, -d, 0)), bm.verts.new((w, -d, 0)), bm.verts.new((w, 0, height)), bm.verts.new((-w, 0, height)),
        bm.verts.new((-w, d, 0)), bm.verts.new((w, d, 0)),
    ]
    bm.faces.new((verts[0], verts[1], verts[2], verts[3]))
    bm.faces.new((verts[3], verts[2], verts[5], verts[4]))
    bm.normal_update()
    o = mesh_obj(name, bm, material)
    o.location = loc
    mod = o.modifiers.new("dicke", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = -1
    apply_mods(o)
    return o


def gable_wall(name, width, height, loc, rot_z=0.0, material="plaster", thickness=0.2):
    """Giebeldreieck (Wand unter dem Dach)."""
    bm = bmesh.new()
    a = bm.verts.new((-width / 2, 0, 0))
    b = bm.verts.new((width / 2, 0, 0))
    c = bm.verts.new((0, 0, height))
    bm.faces.new((a, b, c))
    o = mesh_obj(name, bm, material)
    o.location = loc
    o.rotation_euler = (0, 0, rot_z)
    mod = o.modifiers.new("dicke", "SOLIDIFY")
    mod.thickness = thickness
    apply_mods(o)
    return o


def add_bevel(o, width, seg=2):
    mod = o.modifiers.new("fase", "BEVEL")
    mod.width = width
    mod.segments = seg
    mod.limit_method = "ANGLE"
    apply_mods(o)


def subdivide(o, levels=1, simple=False):
    mod = o.modifiers.new("unterteilung", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    if simple:
        mod.subdivision_type = "SIMPLE"
    apply_mods(o)


def displace(o, strength=0.2, size=0.6, seed=0):
    tex = bpy.data.textures.new(f"rauschen{seed}", type="CLOUDS")
    tex.noise_scale = size
    tex.noise_depth = 3
    mod = o.modifiers.new("verschiebung", "DISPLACE")
    mod.texture = tex
    mod.strength = strength
    mod.mid_level = 0.5
    mod.texture_coords = "OBJECT"
    empty = bpy.data.objects.new(f"offset{seed}", None)
    empty.location = (seed * 13.7, seed * 7.1, seed * 3.3)
    _link(empty)
    mod.texture_coords_object = empty
    apply_mods(o)
    bpy.data.objects.remove(empty)


def jitter(o, amount=0.05, seed=0):
    rnd = random.Random(seed)
    for v in o.data.vertices:
        v.co.x += rnd.uniform(-amount, amount)
        v.co.y += rnd.uniform(-amount, amount)
        v.co.z += rnd.uniform(-amount, amount)


def apply_mods(o):
    bpy.context.view_layer.objects.active = o
    for mod in list(o.modifiers):
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier=mod.name)


def apply_transform(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)


def join(objs, name):
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def smooth(o, angle=35):
    for p in o.data.polygons:
        p.use_smooth = True
    try:
        with bpy.context.temp_override(object=o, active_object=o, selected_editable_objects=[o]):
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except Exception:
        pass


def decimate(o, ratio):
    c = o.copy()
    c.data = o.data.copy()
    _link(c)
    mod = c.modifiers.new("reduzieren", "DECIMATE")
    mod.ratio = ratio
    apply_mods(c)
    return c


def bake(o):
    """Übernimmt Position, Drehung und Skalierung in die Geometrie."""
    o.data.transform(o.matrix_basis.copy())
    o.matrix_basis = Matrix.Identity(4)
    o.data.update()
    return o


def set_origin(o, point):
    """Legt den Objektursprung auf `point` (Weltkoordinaten), die Geometrie bleibt an ihrem Platz."""
    bake(o)
    p = Vector(point)
    o.data.transform(Matrix.Translation(-p))
    o.location = p
    return o


def clear_except(keep):
    for o in list(bpy.context.scene.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)


def box_uv(o, scale=0.5):
    """Würfelprojektion in Weltkoordinaten: 1/scale Meter pro Texturkachel, nahtlos über Objekte hinweg."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    uv = bm.loops.layers.uv.verify()
    mw = o.matrix_world
    rot = mw.to_3x3()
    for f in bm.faces:
        n = rot @ f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for loop in f.loops:
            co = mw @ loop.vert.co
            if ax == 0:
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            elif ax == 1:
                u, v = co.x * (-1 if n.y > 0 else 1), co.z
            else:
                u, v = co.x, co.y
            loop[uv].uv = (u * scale, v * scale)
    bm.to_mesh(o.data)
    bm.free()


def export(name, objs=None, lod_ratio=None, uv_scale=None):
    """Exportiert die Szene (oder gegebene Objekte) als GLB; optional mit LOD1-Datei."""
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"{name}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    targets = objs if objs is not None else [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.context.view_layer.update()
    for o in targets:
        if not o.data.uv_layers:
            dims = max(o.dimensions) if o.dimensions else 1.0
            box_uv(o, uv_scale if uv_scale else (0.5 if dims > 3 else 1.0))
    for o in targets:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                              export_texcoords=True, export_normals=True, export_materials="EXPORT", export_extras=False,
                              export_animations=False, export_skins=False)
    entry = {"file": f"{name}.glb"}
    if lod_ratio:
        lods = []
        for o in targets:
            lods.append(decimate(o, lod_ratio))
        bpy.ops.object.select_all(action="DESELECT")
        for o in lods:
            o.select_set(True)
        lpath = os.path.join(OUT_DIR, f"{name}_lod1.glb")
        bpy.ops.export_scene.gltf(filepath=lpath, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                                  export_materials="EXPORT", export_animations=False, export_skins=False)
        entry["lod1"] = f"{name}_lod1.glb"
    tris = sum(len(p.vertices) - 2 for o in targets for p in o.data.polygons)
    print(f"[blender] {name}: {tris} Dreiecke -> {path}")
    return entry


def mirror_x(o):
    """Kopie eines Objekts, an der YZ-Ebene gespiegelt."""
    c = o.copy()
    c.data = o.data.copy()
    _link(c)
    bake(c)
    c.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
    c.data.flip_normals()
    return c


def taper(o, axis=2, k_min=1.0, k_max=0.6):
    """Verjüngt die Geometrie entlang einer Achse (lokal)."""
    vs = o.data.vertices
    lo = min(v.co[axis] for v in vs)
    hi = max(v.co[axis] for v in vs)
    span = max(1e-6, hi - lo)
    for v in vs:
        t = (v.co[axis] - lo) / span
        k = k_min + (k_max - k_min) * t
        for a in range(3):
            if a != axis:
                v.co[a] *= k
    o.data.update()
    return o


def lathe(name, profile, seg=16, material="stone", loc=(0, 0, 0)):
    """Drehkörper aus einem Profil [(radius, z), ...] um die Z-Achse."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)))
        rings.append(ring)
    for j in range(len(rings) - 1):
        for i in range(seg):
            a, b = rings[j][i], rings[j][(i + 1) % seg]
            c, d = rings[j + 1][(i + 1) % seg], rings[j + 1][i]
            bm.faces.new((a, b, c, d))
    if profile[0][0] > 1e-4:
        bm.faces.new(list(reversed(rings[0])))
    if profile[-1][0] > 1e-4:
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    o = mesh_obj(name, bm, material)
    o.location = loc
    return o


def tube(name, points, r=0.05, seg=6, material="wood_dark", r_end=None):
    """Röhre entlang einer Punktliste (für Äste, Rippen, Bögen)."""
    pts = [Vector(p) for p in points]
    bm = bmesh.new()
    rings = []
    n = len(pts)
    for i, p in enumerate(pts):
        t = pts[min(n - 1, i + 1)] - pts[max(0, i - 1)]
        t.normalize()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        u = t.cross(up).normalized()
        v = t.cross(u).normalized()
        rr = r if r_end is None else r + (r_end - r) * (i / max(1, n - 1))
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            ring.append(bm.verts.new(p + (u * math.cos(a) + v * math.sin(a)) * rr))
        rings.append(ring)
    for j in range(n - 1):
        for k in range(seg):
            bm.faces.new((rings[j][k], rings[j][(k + 1) % seg], rings[j + 1][(k + 1) % seg], rings[j + 1][k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bm.normal_update()
    return mesh_obj(name, bm, material)


def extrude_shape(name, pts2d, depth, material="wood", loc=(0, 0, 0), rot=(0, 0, 0)):
    """Extrudiert ein 2D-Polygon (x, z) um `depth` entlang Y (zentriert)."""
    bm = bmesh.new()
    front = [bm.verts.new((x, -depth / 2, z)) for x, z in pts2d]
    back = [bm.verts.new((x, depth / 2, z)) for x, z in pts2d]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(pts2d)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[j], front[i], back[i], back[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = mesh_obj(name, bm, material)
    o.location = loc
    o.rotation_euler = rot
    return o


def rock(name, r, seed, loc=(0, 0, 0), scale=(1, 1, 1), material="stone", sub=3, strength=None):
    o = ico(name, r, loc, material, sub, scale)
    bake(o)
    displace(o, strength=r * 0.45 if strength is None else strength, size=r * 0.45, seed=seed)
    jitter(o, r * 0.03, seed)
    o.location = (0, 0, 0)
    return o
