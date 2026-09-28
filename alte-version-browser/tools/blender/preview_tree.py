"""Vorschau der Bäume mit echten Materialien (Rinde + Zweigkarten mit Alpha/Normalen), Cycles.
   /opt/bpyenv/bin/python tools/blender/preview_tree.py OUT.png [lod]"""
import math
import os
import sys

import bpy  # noqa: I001

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import trees  # noqa: E402

TEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "apps", "client", "public", "assets", "textures")
out = sys.argv[1]
lod = int(sys.argv[2]) if len(sys.argv) > 2 else 0
lib.reset()
sc = bpy.context.scene


def img_node(nt, path, noncolor=False):
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(path)
    if noncolor:
        t.image.colorspace_settings.name = "Non-Color"
    return t


def setup_card(m, kind):
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    c = img_node(nt, os.path.join(TEX, f"foliage_{kind}_color.webp"))
    n = img_node(nt, os.path.join(TEX, f"foliage_{kind}_normal.webp"), True)
    attr = nt.nodes.new("ShaderNodeAttribute"); attr.attribute_name = "tree"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(attr.outputs["Color"], sep.inputs[0])
    mul = nt.nodes.new("ShaderNodeMixRGB"); mul.blend_type = "MULTIPLY"; mul.inputs[0].default_value = 1
    ao = nt.nodes.new("ShaderNodeMapRange"); ao.inputs[3].default_value = 0.35; ao.inputs[4].default_value = 1.0
    nt.links.new(sep.outputs[1], ao.inputs[0])
    comb = nt.nodes.new("ShaderNodeCombineColor")
    for i in range(3):
        nt.links.new(ao.outputs[0], comb.inputs[i])
    nt.links.new(c.outputs[0], mul.inputs[1]); nt.links.new(comb.outputs[0], mul.inputs[2])
    nt.links.new(mul.outputs[0], bsdf.inputs["Base Color"])
    nt.links.new(c.outputs[1], bsdf.inputs["Alpha"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(n.outputs[0], nm.inputs["Color"])
    nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.65
    bsdf.inputs["Subsurface Weight"].default_value = 0.0
    try:
        bsdf.inputs["Transmission Weight"].default_value = 0.15
    except KeyError:
        pass


def setup_bark(m):
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    c = img_node(nt, os.path.join(TEX, "bark_color.webp"))
    n = img_node(nt, os.path.join(TEX, "bark_normal.webp"), True)
    nt.links.new(c.outputs[0], bsdf.inputs["Base Color"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(n.outputs[0], nm.inputs["Color"])
    nt.links.new(nm.outputs[0], bsdf.inputs["Normal"])


x = 0
for fn, kind in ((trees.spruce, "spruce"), (trees.oak, "oak"), (trees.hazel, "bush"), (trees.dead, None)):
    objs = fn(lod)
    for o in objs:
        o.location.x = x
    x += 9 if kind != "bush" else 5
for m in bpy.data.materials:
    if m.name.startswith("leafcard_"):
        setup_card(m, m.name.split("_", 1)[1])
    elif m.name == "bark":
        setup_bark(m)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
g = bpy.context.active_object
gm = bpy.data.materials.new("ground"); gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.12, 0.13, 0.07, 1)
g.data.materials.append(gm)
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 48
sc.cycles.use_denoising = True
sc.view_settings.view_transform = "AgX"
sc.render.resolution_x = 1600
sc.render.resolution_y = 900
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.lens = 30
cam.location = (x / 2 - 4.5, -30, 6.5)
cam.rotation_euler = (math.radians(86), 0, 0)
sc.collection.objects.link(cam)
sc.camera = cam
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 4.5
sun.data.angle = math.radians(1.5)
sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
sc.collection.objects.link(sun)
w = bpy.data.worlds.new("w"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.62, 0.82, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.8
sc.world = w
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
