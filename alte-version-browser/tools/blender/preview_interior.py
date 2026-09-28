"""Blick in die Innenräume (Cycles): Kamera in der Tür, Sonne draußen, Herdfeuer drinnen.
   /opt/bpyenv/bin/python tools/blender/preview_interior.py OUT.png house_a|house_b|inn"""
import math
import os
import sys

import bpy  # noqa: I001

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import buildings  # noqa: E402

out, name = sys.argv[1], sys.argv[2]
lib.reset()
getattr(buildings, name)()
dims = {"house_a": (8, 6), "house_b": (10, 7), "inn": (12, 9)}[name]
w, d = dims
door_x = -1.5 if name == "house_b" else 0.0
cols = {"stone_block": (0.35, 0.33, 0.3), "plaster": (0.75, 0.7, 0.6), "wood": (0.35, 0.22, 0.12), "wood_dark": (0.18, 0.11, 0.06),
        "hay": (0.6, 0.5, 0.25), "cloth_red": (0.45, 0.08, 0.06), "cloth_white": (0.8, 0.78, 0.7), "cloth": (0.45, 0.4, 0.3),
        "metal_dark": (0.08, 0.08, 0.09), "roof_thatch": (0.5, 0.42, 0.22), "roof": (0.35, 0.18, 0.12), "window": (0.3, 0.4, 0.45), "stone": (0.4, 0.4, 0.38)}
for m in bpy.data.materials:
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    if not bs:
        continue
    base = m.name.split(".")[0]
    if base == "glow_warm":
        bs.inputs["Emission Color"].default_value = (1.0, 0.45, 0.15, 1)
        bs.inputs["Emission Strength"].default_value = 30
    c = cols.get(base)
    if c:
        bs.inputs["Base Color"].default_value = (*c, 1)
        bs.inputs["Roughness"].default_value = 0.8
bpy.ops.mesh.primitive_plane_add(size=80)
sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 64; sc.cycles.use_denoising = True
sc.view_settings.view_transform = "AgX"; sc.view_settings.exposure = 1.0
sc.render.resolution_x = 1280; sc.render.resolution_y = 720
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 18
cam.location = (door_x, d / 2 - 0.4, 2.3)
cam.rotation_euler = (math.radians(78), 0, math.radians(180))
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 4
sun.rotation_euler = (math.radians(45), 0, math.radians(160)); sc.collection.objects.link(sun)
fire = bpy.data.objects.new("fire", bpy.data.lights.new("fire", "POINT")); fire.data.energy = 250; fire.data.color = (1, 0.55, 0.25)
fire.location = (w * 0.28, -d / 2 + 0.9, 1.9); sc.collection.objects.link(fire)
wd = bpy.data.worlds.new("w"); wd.use_nodes = True
wd.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.6, 0.75, 1); wd.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sc.world = wd
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
