"""Beleuchtete Vorschau gebackener Texturen (flache Sonne, damit das Relief sichtbar wird).
   python tools/blender/preview_tex.py TEXDIR OUT.png name [name ...]"""
import math
import os
import sys

import bpy  # noqa: I001

tex_dir, out, names = sys.argv[1], sys.argv[2], sys.argv[3:]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 24
sc.view_settings.view_transform = "AgX"
cols = min(4, len(names))
rows = (len(names) + cols - 1) // cols
sc.render.resolution_x = 360 * cols
sc.render.resolution_y = 360 * rows
for i, n in enumerate(names):
    bpy.ops.mesh.primitive_plane_add(size=2, location=((i % cols) * 2.05, -(i // cols) * 2.05, 0))
    o = bpy.context.active_object
    m = bpy.data.materials.new(n)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    def img(kind, noncolor):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(os.path.join(tex_dir, f"{n}_{kind}.webp"))
        if noncolor:
            t.image.colorspace_settings.name = "Non-Color"
        return t
    c = img("color", False)
    nm = img("normal", True)
    arm = img("arm", True)
    nt.links.new(c.outputs[0], bsdf.inputs["Base Color"])
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(arm.outputs[0], sep.inputs[0])
    nt.links.new(sep.outputs[1], bsdf.inputs["Roughness"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nm.outputs[0], nmap.inputs["Color"])
    nt.links.new(nmap.outputs[0], bsdf.inputs["Normal"])
    o.data.materials.append(m)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = 2.05 * max(cols, rows)
cam.location = ((cols - 1) * 2.05 / 2, -(rows - 1) * 2.05 / 2, 10)
sc.collection.objects.link(cam)
sc.camera = cam
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 4
sun.rotation_euler = (math.radians(62), 0, math.radians(40))
sc.collection.objects.link(sun)
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.6, 0.75, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.6
sc.world = w
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
