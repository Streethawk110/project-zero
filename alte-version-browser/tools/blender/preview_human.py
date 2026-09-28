"""Vorschau der Menschen (Cycles): Ruhehaltung und Testpose nebeneinander.
   /opt/bpyenv/bin/python tools/blender/preview_human.py OUT.png [nah]"""
import math
import os
import sys

import bpy  # noqa: I001

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import human  # noqa: E402

out = sys.argv[1]
close = len(sys.argv) > 2
lib.reset()
sc = bpy.context.scene
OUTFITS = [
    ("male", {"tunic", "tunic_skirt", "trousers", "boots", "belt"}, (0.32, 0.25, 0.16), (0.14, 0.12, 0.1), (0.2, 0.12, 0.07), False),
    ("female", {"tunic", "tunic_skirt", "trousers", "boots", "belt", "hood", "hood_cowl"}, (0.22, 0.27, 0.35), (0.12, 0.12, 0.12), (0.4, 0.33, 0.18), True),
    ("male", {"tunic", "trousers", "boots", "robe", "hood", "hood_cowl"}, (0.08, 0.13, 0.25), (0.05, 0.08, 0.15), (0.5, 0.4, 0.15), False),
    ("female", {"tunic", "tunic_skirt", "trousers", "boots", "belt", "plates", "pauldrons"}, (0.5, 0.5, 0.52), (0.15, 0.13, 0.12), (0.3, 0.1, 0.08), True),
]
for i, (kind, show, cb, cl, ca, posed) in enumerate(OUTFITS):
    objs = human.human(kind)
    rig = objs[0]
    rig.location.x = i * 1.0 - 1.5
    for o in objs[1:]:
        if o.name.split(".")[0] not in show | {"skin", "eyes", "lashes"}:
            o.hide_render = True
        else:
            mat = bpy.data.materials.new(f"{o.name}_{i}")
            mat.use_nodes = True
            bsdf = mat.node_tree.nodes["Principled BSDF"]
            base = o.data.materials[0].name.split(".")[0]
            col = {"body": cb, "legs": cl, "accent": ca}.get(base)
            if col:
                bsdf.inputs["Base Color"].default_value = (*col, 1)
                bsdf.inputs["Roughness"].default_value = 0.85 if base != "body" or i != 3 else 0.35
                if i == 3 and base == "body":
                    bsdf.inputs["Metallic"].default_value = 0.9
                o.data.materials[0] = mat
    if posed:
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.mode_set(mode="POSE")
        pb = rig.pose.bones
        for b, e in (("upperArmL", (-30, 0, 0)), ("foreArmL", (-60, 0, 0)), ("thighR", (-25, 0, 0)), ("shinR", (40, 0, 0)), ("head", (0, 15, 0))):
            pb[b].rotation_mode = "XYZ"; pb[b].rotation_euler = tuple(math.radians(x) for x in e)
        bpy.ops.object.mode_set(mode="OBJECT")
bpy.ops.mesh.primitive_plane_add(size=40)
g = bpy.context.active_object
gm = bpy.data.materials.new("g"); gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.3, 0.3, 0.3, 1)
g.data.materials.append(gm)
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 32; sc.cycles.use_denoising = True
sc.view_settings.view_transform = "AgX"
sc.render.resolution_x = 1400; sc.render.resolution_y = 900
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
if close:
    cam.data.lens = 85; cam.location = (-1.5, -1.6, 1.62); cam.rotation_euler = (math.radians(90), 0, 0)
    sc.render.resolution_x = 900; sc.render.resolution_y = 900
else:
    cam.data.lens = 40; cam.location = (0, -5.2, 1.0); cam.rotation_euler = (math.radians(90), 0, 0)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 4
sun.rotation_euler = (math.radians(50), 0, math.radians(-30)); sc.collection.objects.link(sun)
w = bpy.data.worlds.new("w"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.75, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 0.7
sc.world = w
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
