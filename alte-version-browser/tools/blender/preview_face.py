"""Nahaufnahme der Gesichter (Cycles, Hautshader mit Streuung, Textur, Augen).
   /opt/bpyenv/bin/python tools/blender/preview_face.py OUT.png"""
import math
import os
import sys

import bpy  # noqa: I001

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
import human  # noqa: E402

TEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "apps", "client", "public", "assets", "textures")
out = sys.argv[1]
lib.reset()
sc = bpy.context.scene


def img(nt, name, noncolor=False):
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(os.path.join(TEX, name))
    if noncolor:
        t.image.colorspace_settings.name = "Non-Color"
    return t


def skin_mat(kind, hair_col):
    m = bpy.data.materials.new("skin_" + kind)
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes["Principled BSDF"]
    c = img(nt, f"skin_{kind}_color.webp")
    n = img(nt, f"skin_{kind}_normal.webp", True)
    a = img(nt, f"skin_{kind}_arm.webp", True)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(a.outputs[0], sep.inputs[0])
    mix = nt.nodes.new("ShaderNodeMixRGB"); mix.blend_type = "MULTIPLY"
    mix.inputs[2].default_value = (*hair_col, 1)
    nt.links.new(sep.outputs[2], mix.inputs[0]); nt.links.new(c.outputs[0], mix.inputs[1])
    nt.links.new(mix.outputs[0], bs.inputs["Base Color"])
    nt.links.new(sep.outputs[1], bs.inputs["Roughness"])
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = 0.8
    nt.links.new(n.outputs[0], nm.inputs["Color"]); nt.links.new(nm.outputs[0], bs.inputs["Normal"])
    bs.inputs["Subsurface Weight"].default_value = 0.35
    bs.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.2)
    bs.inputs["Subsurface Scale"].default_value = 0.004
    return m


def eye_mat(iris):
    m = bpy.data.materials.new("eye")
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes["Principled BSDF"]
    c = img(nt, "eye_color.webp")
    mix = nt.nodes.new("ShaderNodeMixRGB"); mix.blend_type = "MULTIPLY"
    mix.inputs[2].default_value = (*iris, 1)
    nt.links.new(c.outputs[1], mix.inputs[0]); nt.links.new(c.outputs[0], mix.inputs[1])
    nt.links.new(mix.outputs[0], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.05
    return m


def hair_mat(atlas, col):
    m = bpy.data.materials.new("hair")
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes["Principled BSDF"]
    c = img(nt, f"foliage_{atlas}_color.webp")
    attr = nt.nodes.new("ShaderNodeAttribute"); attr.attribute_name = "tree"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(attr.outputs["Color"], sep.inputs[0])
    mul = nt.nodes.new("ShaderNodeMixRGB"); mul.blend_type = "MULTIPLY"; mul.inputs[0].default_value = 1
    mul.inputs[2].default_value = (*col, 1)
    nt.links.new(c.outputs[0], mul.inputs[1])
    mul2 = nt.nodes.new("ShaderNodeMixRGB"); mul2.blend_type = "MULTIPLY"; mul2.inputs[0].default_value = 1
    nt.links.new(mul.outputs[0], mul2.inputs[1])
    comb = nt.nodes.new("ShaderNodeCombineColor")
    for k in range(3):
        nt.links.new(sep.outputs[1], comb.inputs[k])
    nt.links.new(comb.outputs[0], mul2.inputs[2])
    nt.links.new(mul2.outputs[0], bs.inputs["Base Color"])
    nt.links.new(c.outputs[1], bs.inputs["Alpha"])
    bs.inputs["Roughness"].default_value = 0.45
    return m


GALLERY = [("male", 0, 2, (0.06, 0.04, 0.025), (0.25, 0.4, 0.55)), ("female", 2, 0, (0.3, 0.18, 0.07), (0.3, 0.22, 0.1)),
           ("male", 5, 3, (0.2, 0.1, 0.04), (0.3, 0.45, 0.3)), ("female", 1, 0, (0.03, 0.02, 0.015), (0.3, 0.22, 0.1)),
           ("male", 4, 1, (0.12, 0.08, 0.05), (0.3, 0.25, 0.15)), ("male", 3, 2, (0.25, 0.25, 0.25), (0.35, 0.35, 0.35))]
for i, (kind, hair_s, beard_s, hair, iris) in enumerate(GALLERY):
    objs = human.human(kind)
    objs[0].location.x = (i - 2.5) * 0.42
    for o in objs[1:]:
        n = o.name.split(".")[0]
        if n == "skin":
            o.data.materials[0] = skin_mat(kind, hair)
        elif n == "eyes":
            o.data.materials[0] = eye_mat(iris)
        elif n == f"hair_{hair_s}_cap":
            cm = bpy.data.materials.new("cap"); cm.use_nodes = True
            cm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*[x * 0.6 for x in hair], 1)
            cm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.7
            o.data.materials[0] = cm
        elif n == f"hair_{hair_s}" or n == f"beard_{beard_s}":
            o.data.materials[0] = hair_mat(o.data.materials[0].name.split("_", 1)[1].split(".")[0], hair)
        elif n in ("tunic", "trousers", "boots", "belt"):
            cm = bpy.data.materials.new("c"); cm.use_nodes = True
            cm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.25, 0.2, 0.14, 1)
            cm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
            o.data.materials[0] = cm
        else:
            o.hide_render = True
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 64; sc.cycles.use_denoising = True
sc.view_settings.view_transform = "AgX"
sc.render.resolution_x = 1800; sc.render.resolution_y = 700
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 50; cam.location = (0, -2.9, 1.45); cam.rotation_euler = (math.radians(90), 0, 0)
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3.5; sun.data.angle = math.radians(3)
sun.rotation_euler = (math.radians(55), 0, math.radians(-35)); sc.collection.objects.link(sun)
w = bpy.data.worlds.new("w"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.72, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 0.8
sc.world = w
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
