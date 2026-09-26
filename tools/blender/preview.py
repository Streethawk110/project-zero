"""Rendert Vorschaubilder von exportierten GLB-Modellen (Cycles, CPU).

    python tools/blender/preview.py OUT_DIR name [name ...]
"""
import math
import os
import sys

import bpy  # noqa: I001
import addon_utils
from mathutils import Vector

addon_utils.enable("io_scene_gltf2", default_set=True)
HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.environ.get("PZ_MODEL_OUT", os.path.join(HERE, "..", "..", "apps", "client", "public", "assets", "models"))


def render(name, out_dir):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, f"{name}.glb"))
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    center = (lo + hi) / 2
    size = max((hi - lo).length, 0.3)
    scene = bpy.context.scene
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    d = size * 1.25
    cam.location = center + Vector((d * 0.75, d * 0.95, d * 0.55))
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.7, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    scene.world = world
    bpy.ops.mesh.primitive_plane_add(size=size * 6, location=(center.x, center.y, lo.z))
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 12
    scene.cycles.device = "CPU"
    scene.render.resolution_x = 480
    scene.render.resolution_y = 360
    scene.render.filepath = os.path.join(out_dir, f"{name}.png")
    bpy.ops.render.render(write_still=True)


out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for n in sys.argv[2:]:
    render(n, out)
