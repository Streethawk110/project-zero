"""Beleuchtete Vorschau der Blattwerk-Atlanten (Karte mit Alpha + Normalenkarte vor grauem Grund).
   /opt/bpyenv/bin/python tools/blender/preview_foliage.py OUT.png art [art ...]"""
import math
import os
import sys

import bpy  # noqa: I001

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(HERE, "..", "..", "apps", "client", "public", "assets", "textures")
out, names = sys.argv[1], sys.argv[2:]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 32
sc.view_settings.view_transform = "AgX"
sc.render.resolution_x = 520 * len(names)
sc.render.resolution_y = 520
for i, n in enumerate(names):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(i * 1.05, 0, 0))
    o = bpy.context.active_object
    m = bpy.data.materials.new(n)
    m.use_nodes = True
    m.blend_method = "HASHED" if hasattr(m, "blend_method") else None
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    c = nt.nodes.new("ShaderNodeTexImage")
    c.image = bpy.data.images.load(os.path.join(TEX, f"foliage_{n}_color.webp"))
    nm = nt.nodes.new("ShaderNodeTexImage")
    nm.image = bpy.data.images.load(os.path.join(TEX, f"foliage_{n}_normal.webp"))
    nm.image.colorspace_settings.name = "Non-Color"
    nt.links.new(c.outputs[0], bsdf.inputs["Base Color"])
    nt.links.new(c.outputs[1], bsdf.inputs["Alpha"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nm.outputs[0], nmap.inputs["Color"])
    nt.links.new(nmap.outputs[0], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.6
    o.data.materials.append(m)
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.3))
g = bpy.context.active_object
gm = bpy.data.materials.new("bg")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.35, 0.36, 0.38, 1)
g.data.materials.append(gm)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = 1.05 * len(names)
cam.location = ((len(names) - 1) * 1.05 / 2, 0, 5)
sc.collection.objects.link(cam)
sc.camera = cam
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.5
sun.rotation_euler = (math.radians(50), 0, math.radians(35))
sc.collection.objects.link(sun)
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.65, 0.8, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.5
sc.world = w
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
