"""Transforma a ARTE ORIGINAL do Club Penguin (PNG/WebP com transparência) em
um objeto 3D com volume ("relevo inflado"): o contorno da imagem vira a
silhueta, a distância até a borda vira espessura (barriga redonda) e a própria
arte vai de textura na frente. De frente fica EXATAMENTE como no Club Penguin;
girando, tem corpo de verdade, pega luz e faz sombra.
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix
from scipy import ndimage


def _alpha_mask(path):
    from PIL import Image
    im = Image.open(path).convert("RGBA")
    return np.asarray(im)[..., 3] > 40, im.size


def _image(path):
    key = os.path.abspath(path)
    for im in bpy.data.images:
        if im.get("pc3d_path") == key:
            return im
    im = bpy.data.images.load(key)
    im["pc3d_path"] = key
    im.alpha_mode = "STRAIGHT"
    return im


def _material(name, image, glow=0.45, back=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Smart"
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    mul.inputs[7].default_value = (0.72, 0.72, 0.78, 1) if back else (1, 1, 1, 1)
    nt.links.new(tex.outputs["Color"], mul.inputs[6])
    nt.links.new(mul.outputs[2], b.inputs["Base Color"])
    nt.links.new(mul.outputs[2], b.inputs["Emission Color"])
    nt.links.new(tex.outputs["Alpha"], b.inputs["Alpha"])
    b.inputs["Emission Strength"].default_value = glow  # mantém as cores vivas, como no desenho
    b.inputs["Roughness"].default_value = 0.85
    for k in ("Specular IOR Level", "Specular"):
        if k in b.inputs:
            b.inputs[k].default_value = 0.1
            break
    try:
        m.surface_render_method = "DITHERED"
    except Exception:
        pass
    m.blend_method = "HASHED" if hasattr(m, "blend_method") else None
    return m


def build(name, path, height=1.0, thickness=0.55, pos=(0, 0, 0), yaw=0.0, tilt=0.0, step=4,
          glow=0.12, roundness=1.0, feet_flat=True):
    """Cria o objeto. `height` = altura no mundo; `thickness` = espessura relativa à largura."""
    mask, (w, h) = _alpha_mask(path)
    # espessura: distância até a borda (em pixels), perfil de círculo
    dist = ndimage.distance_transform_edt(mask)
    R = max(1.0, dist.max() * roundness)
    t = np.minimum(dist, R) / R
    prof = 1 - (1 - t) ** 2.2  # borda com inclinação finita (não estica a textura)
    depth = prof * thickness * (w / 2.0)  # em pixels
    s = height / h  # pixels → mundo
    # malha em grade (só células perto da silhueta)
    gx = np.arange(0, w + step, step)
    gy = np.arange(0, h + step, step)
    near = ndimage.binary_dilation(mask, iterations=step + 1)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UV")
    idx = {}

    def vert(ix, iy, side):
        key = (ix, iy, side)
        if key in idx:
            return idx[key]
        px = min(gx[ix], w - 1)
        py = min(gy[iy], h - 1)
        d = depth[int(py), int(px)] if mask[int(py), int(px)] else 0.0
        v = bm.verts.new(((gx[ix] - w / 2) * s, side * d * s, (h - gy[iy]) * s))
        idx[key] = v
        return v

    for iy in range(len(gy) - 1):
        for ix in range(len(gx) - 1):
            cx, cy = min(gx[ix] + step // 2, w - 1), min(gy[iy] + step // 2, h - 1)
            if not near[int(cy), int(cx)]:
                continue
            for side in (-1, 1):  # -1 = frente (vira para -Y), +1 = costas
                vs = [vert(ix, iy, side), vert(ix + 1, iy, side), vert(ix + 1, iy + 1, side), vert(ix, iy + 1, side)]
                try:
                    f = bm.faces.new(vs if side == -1 else vs[::-1])
                except ValueError:
                    continue
                f.material_index = 0 if side == -1 else 1
                f.smooth = True
                for l, v in zip(f.loops, vs if side == -1 else vs[::-1]):
                    u = (v.co.x / s + w / 2) / w
                    if side == 1:
                        u = 1 - u
                    l[uv].uv = (u, v.co.z / s / h)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    img = _image(path)
    me.materials.append(_material(name + "_frente", img, glow))
    me.materials.append(_material(name + "_costas", img, glow * 0.7, back=True))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = pos
    ob.rotation_euler = Euler((math.radians(tilt), 0, math.radians(yaw)), "XYZ")
    return ob
