"""Arena da Guerra das Cartas 3D — tabuleiro em faixas ("lanes") com piso de
hexágonos, estilo desenho animado (cores chapadas, linhas neon entre as
faixas, plataformas nos slots). Tudo ORIGINAL do Project Club, feito por
código: nada de modelo baixado nem imagem gerada por IA.

Layout (unidades do Blender, +Y = lado do oponente, -Y = lado do jogador):

    y = +SLOT_D .. 0   → fileira do oponente
    y = 0 .. -SLOT_D   → fileira do jogador
    x = faixa 0..4, cada uma com SLOT_W de largura, centradas em x = 0
"""
import math
import random

import bmesh
import bpy
from mathutils import Vector

from . import lib

SLOT_W = 2.1
SLOT_D = 2.7
LANES = 5

# nome → (hex claro, hex escuro, cor da linha neon, detalhe)
TERRENOS = {
    "campo":   ("#b7d93a", "#8fb52a", "#e6ff3a", "trigo"),
    "agua":    ("#3f93d8", "#2a6fb4", "#4fe6ff", "ondas"),
    "pantano": ("#4a5a50", "#33403a", "#9fe39a", "poças"),
    "lava":    ("#e9622a", "#b8401c", "#ffb13a", "brasas"),
    "luz":     ("#f3d66a", "#d9b24a", "#fff6b0", "brilhos"),
    "sombra":  ("#7a5cc4", "#553a96", "#d6a0ff", "cristais"),
    "ar":      ("#cfeaf7", "#a9d3ea", "#ffffff", "nuvens"),
}

PADRAO = ["campo", "agua", "luz", "sombra", "lava"]


def lane_x(i):
    return (i - (LANES - 1) / 2) * SLOT_W


def slot_pos(side, i):
    """Centro do slot. side 0 = jogador (perto), 1 = oponente (longe)."""
    return Vector((lane_x(i), SLOT_D / 2 if side == 1 else -SLOT_D / 2, 0.0))


# ------------------------------------------------------------------ materiais

def _vertex_color_mat(name, rough=0.95, emit=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    attr = nt.nodes.new("ShaderNodeVertexColor")  # o glTF entende este nó (COLOR_0)
    attr.layer_name = "Col"
    nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        nt.links.new(attr.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emit
    return m


def _rgba(h, k=1.0):
    r, g, b = lib.hex_rgb(h)
    return (min(1, r * k), min(1, g * k), min(1, b * k), 1.0)


def _mesh_obj(name, bm, mat):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat:
        me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = False
    return ob


# ------------------------------------------------------------------ pedaços

def _hex_prism(bm, col, cx, cy, r, h, color):
    """Hexágono com ombro chanfrado (pega luz na borda, como nas fotos)."""
    ring = lambda rad, z: [bm.verts.new((cx + rad * math.cos(math.radians(60 * k + 30)),
                                         cy + rad * math.sin(math.radians(60 * k + 30)), z)) for k in range(6)]
    b = ring(r, 0.0)
    s = ring(r, h - 0.025)
    t = ring(r - 0.03, h)
    faces = []
    for lo, hi in ((b, s), (s, t)):
        for k in range(6):
            faces.append(bm.faces.new((lo[k], lo[(k + 1) % 6], hi[(k + 1) % 6], hi[k])))
    faces.append(bm.faces.new(t))
    for f in faces:
        for l in f.loops:
            l[col] = color


def _hex_floor(name, x0, x1, y0, y1, c1, c2, seed, r=0.27, h=0.07):
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Col")
    rnd = random.Random(seed)
    dx = r * math.sqrt(3) * 1.0
    dy = r * 1.5
    gap = 0.93
    j = 0
    y = y0 + r
    while y <= y1 - r * 0.4:
        x = x0 + (dx / 2 if j % 2 else 0) + dx / 2
        while x <= x1 - dx / 2 + 1e-6:
            k = rnd.random()
            base = c1 if k < 0.62 else c2
            tint = 0.94 + 0.12 * rnd.random()
            _hex_prism(bm, col, x, y, r * gap, h, _rgba(base, tint))
            x += dx
        y += dy
        j += 1
    return _mesh_obj(name, bm, _vertex_color_mat("hex_piso", emit=0.55))


def _box(bm, col, x0, x1, y0, y1, z0, z1, color):
    v = [bm.verts.new(p) for p in (
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
    for idx in ((4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
        f = bm.faces.new([v[i] for i in idx])
        for l in f.loops:
            l[col] = color


def _neon(name, x0, x1, y0, y1, color, z=0.075, w=0.05):
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Col")
    _box(bm, col, x0 - w, x0 + w, y0, y1, 0.0, z, _rgba(color))
    _box(bm, col, x1 - w, x1 + w, y0, y1, 0.0, z, _rgba(color))
    return _mesh_obj(name, bm, _vertex_color_mat("neon", rough=0.4, emit=2.0))


def _pad(name, cx, cy, side):
    """Plataforma redonda (botão do slot), com aro e brilho."""
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Col")
    w, d, h = 1.35, 0.62, 0.09
    # base escura + tampa mais clara e menor
    _box(bm, col, cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, 0.06, 0.06 + h, _rgba("#1d4a2a"))
    _box(bm, col, cx - w / 2 + 0.07, cx + w / 2 - 0.07, cy - d / 2 + 0.06, cy + d / 2 - 0.06, 0.06 + h, 0.06 + h + 0.035, _rgba("#2f8a45"))
    _box(bm, col, cx - 0.13, cx + 0.13, cy - 0.1, cy + 0.1, 0.06 + h + 0.035, 0.06 + h + 0.06, _rgba("#c8ff6a"))
    return _mesh_obj(name, bm, _vertex_color_mat("pad", rough=0.6))


def _tufts(name, x0, x1, y0, y1, color, seed, n=70, hmin=0.25, hmax=0.6):
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Col")
    rnd = random.Random(seed)
    for _ in range(n):
        cx = rnd.uniform(x0 + 0.1, x1 - 0.1)
        cy = rnd.uniform(y0 + 0.1, y1 - 0.1)
        for _b in range(5):
            ox, oy = rnd.uniform(-0.07, 0.07), rnd.uniform(-0.05, 0.05)
            hh = rnd.uniform(hmin, hmax)
            lean = Vector((rnd.uniform(-0.12, 0.12), rnd.uniform(-0.08, 0.08), 0))
            w = 0.028
            a = bm.verts.new((cx + ox - w, cy + oy, 0.07))
            b = bm.verts.new((cx + ox + w, cy + oy, 0.07))
            c = bm.verts.new((cx + ox + lean.x, cy + oy + lean.y, 0.07 + hh))
            f = bm.faces.new((a, b, c))
            k = 0.85 + 0.3 * rnd.random()
            for l in f.loops:
                l[col] = _rgba(color, k)
    return _mesh_obj(name, bm, _vertex_color_mat("tufo", rough=0.8, emit=0.35))


def _blobs(name, x0, x1, y0, y1, color, seed, n=8, r=(0.1, 0.22), z=0.075, emit=0.0, segs=14):
    """Manchas achatadas (poças, ondas, brasas...)."""
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Col")
    rnd = random.Random(seed)
    for _ in range(n):
        cx = rnd.uniform(x0 + 0.25, x1 - 0.25)
        cy = rnd.uniform(y0 + 0.3, y1 - 0.3)
        rr = rnd.uniform(*r)
        sx = rnd.uniform(1.2, 1.9)
        vs = [bm.verts.new((cx + rr * sx * math.cos(a), cy + rr * math.sin(a), z))
              for a in (2 * math.pi * k / segs for k in range(segs))]
        f = bm.faces.new(vs)
        for l in f.loops:
            l[col] = _rgba(color, 0.9 + 0.2 * rnd.random())
    return _mesh_obj(name, bm, _vertex_color_mat("mancha", rough=0.5, emit=emit))


def _crystals(name, x0, x1, y0, y1, color, seed, n=7):
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Col")
    rnd = random.Random(seed)
    for _ in range(n):
        cx = rnd.uniform(x0 + 0.2, x1 - 0.2)
        cy = rnd.uniform(y0 + 0.25, y1 - 0.25)
        hh = rnd.uniform(0.25, 0.6)
        r = rnd.uniform(0.07, 0.13)
        base = [bm.verts.new((cx + r * math.cos(a), cy + r * math.sin(a), 0.07)) for a in (0, 2.09, 4.19)]
        tip = bm.verts.new((cx + rnd.uniform(-0.05, 0.05), cy, 0.07 + hh))
        for i in range(3):
            f = bm.faces.new((base[i], base[(i + 1) % 3], tip))
            for l in f.loops:
                l[col] = _rgba(color, 0.75 + 0.5 * (i / 2))
    return _mesh_obj(name, bm, _vertex_color_mat("cristal", rough=0.25, emit=0.9))


def _puffs(name, x0, x1, y0, y1, seed, n=5):
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Col")
    rnd = random.Random(seed)
    for _ in range(n):
        cx = rnd.uniform(x0 + 0.3, x1 - 0.3)
        cy = rnd.uniform(y0 + 0.3, y1 - 0.3)
        for _k in range(3):
            r = rnd.uniform(0.1, 0.19)
            geo = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=r)
            vs = geo["verts"]
            bmesh.ops.translate(bm, verts=vs, vec=(cx + rnd.uniform(-0.2, 0.2), cy + rnd.uniform(-0.1, 0.1), 0.15 + r))
            for v in vs:
                for l in v.link_loops:
                    l[col] = _rgba("#ffffff", 0.97)
    return _mesh_obj(name, bm, _vertex_color_mat("nuvem", rough=1.0, emit=0.5))


DETALHES = {
    "trigo": lambda n, a, b, c, d, cor, s: _tufts(n, a, b, c, d, "#e9f03a", s, n=45, hmin=0.12, hmax=0.34),
    "ondas": lambda n, a, b, c, d, cor, s: _blobs(n, a, b, c, d, "#7fd0f5", s, n=9, r=(0.07, 0.14), emit=0.5),
    "poças": lambda n, a, b, c, d, cor, s: _blobs(n, a, b, c, d, "#26302b", s, n=7, r=(0.12, 0.22)),
    "brasas": lambda n, a, b, c, d, cor, s: _blobs(n, a, b, c, d, "#ffcf5a", s, n=10, r=(0.04, 0.09), emit=2.5, z=0.08),
    "brilhos": lambda n, a, b, c, d, cor, s: _blobs(n, a, b, c, d, "#fffbe0", s, n=10, r=(0.03, 0.07), emit=2.0, z=0.08, segs=4),
    "cristais": lambda n, a, b, c, d, cor, s: _crystals(n, a, b, c, d, "#c58bff", s),
    "nuvens": lambda n, a, b, c, d, cor, s: _puffs(n, a, b, c, d, s),
}


# ------------------------------------------------------------------ cenário

def _wood(name, x0, x1, y0, y1, z0, z1, c1, c2, seed, planks=1):
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Col")
    rnd = random.Random(seed)
    n = max(1, planks)
    for i in range(n):
        a = x0 + (x1 - x0) * i / n
        b = x0 + (x1 - x0) * (i + 1) / n - 0.02
        _box(bm, col, a, b, y0, y1, z0, z1, _rgba(c1 if rnd.random() < 0.5 else c2, 0.9 + 0.2 * rnd.random()))
    return _mesh_obj(name, bm, _vertex_color_mat("madeira", rough=0.9))


def build(lanes=None, seed=7):
    """Monta a arena na cena atual. Devolve {"slots": {(side, i): Vector}, "terrenos": [...]}."""
    lanes = list(lanes or PADRAO)[:LANES]
    while len(lanes) < LANES:
        lanes.append(PADRAO[len(lanes)])
    half_w = LANES * SLOT_W / 2

    # mesa: feltro escuro + moldura de madeira
    _wood("mesa", -half_w - 2.2, half_w + 2.2, -SLOT_D - 1.9, SLOT_D + 1.4, -0.4, 0.0, "#4b3320", "#3d2a1a", seed)
    _wood("moldura_f", -half_w - 0.25, half_w + 0.25, -SLOT_D - 0.28, -SLOT_D - 0.02, 0.0, 0.2, "#8a5a34", "#7a4c2a", seed + 1, planks=1)
    _wood("moldura_t", -half_w - 0.25, half_w + 0.25, SLOT_D + 0.02, SLOT_D + 0.28, 0.0, 0.2, "#8a5a34", "#7a4c2a", seed + 2)
    _wood("moldura_e", -half_w - 0.28, -half_w - 0.02, -SLOT_D - 0.28, SLOT_D + 0.28, 0.0, 0.2, "#8a5a34", "#7a4c2a", seed + 3)
    _wood("moldura_d", half_w + 0.02, half_w + 0.28, -SLOT_D - 0.28, SLOT_D + 0.28, 0.0, 0.2, "#8a5a34", "#7a4c2a", seed + 4)

    # parede de tábuas ao fundo (casa na árvore) + luz quente
    wall = bmesh.new()
    colw = wall.loops.layers.color.new("Col")
    rw = random.Random(seed + 9)
    for k in range(14):
        _box(wall, colw, -16 + k * 2.3, -16 + (k + 1) * 2.3 - 0.08, SLOT_D + 5.5, SLOT_D + 6.0, -0.4, 9.0,
             _rgba(["#a8794a", "#96673c", "#b8885a", "#8a5a34"][rw.randrange(4)], 0.9 + 0.2 * rw.random()))
    _mesh_obj("parede", wall, _vertex_color_mat("parede", emit=0.35))
    lamp = bpy.data.objects.new("lamp", bpy.data.lights.new("lamp", "POINT"))
    bpy.context.scene.collection.objects.link(lamp)
    lamp.location = (0, SLOT_D + 2.0, 6.0)
    lamp.data.energy = 900
    lamp.data.color = (1.0, 0.85, 0.6)

    slots = {}
    for i, t in enumerate(lanes):
        c1, c2, neon, det = TERRENOS[t]
        x0 = lane_x(i) - SLOT_W / 2
        x1 = lane_x(i) + SLOT_W / 2
        bmb = bmesh.new()
        colb = bmb.loops.layers.color.new("Col")
        _box(bmb, colb, x0, x1, -SLOT_D, SLOT_D, 0.0, 0.05, _rgba(c2, 0.55))
        _mesh_obj(f"base_{i}", bmb, _vertex_color_mat("base_faixa"))
        _hex_floor(f"piso_{i}", x0, x1, -SLOT_D, SLOT_D, c1, c2, seed * 10 + i)
        _neon(f"linha_{i}", x0 + 0.04, x1 - 0.04, -SLOT_D, SLOT_D, neon)
        DETALHES[det](f"det_{i}", x0 + 0.1, x1 - 0.1, -SLOT_D, SLOT_D, neon, seed * 100 + i)
        for side in (0, 1):
            p = slot_pos(side, i)
            slots[(side, i)] = p
            _pad(f"pad_{side}_{i}", p.x, p.y + (-0.78 if side == 0 else 0.78), side)
    # linha do meio (divide os lados)
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Col")
    _box(bm, col, -half_w, half_w, -0.03, 0.03, 0.0, 0.085, _rgba("#1a2218"))
    _mesh_obj("divisoria", bm, _vertex_color_mat("divisoria"))
    return {"slots": slots, "terrenos": lanes}


# ------------------------------------------------------------------ sprites

def _load_image(path):
    for im in bpy.data.images:
        if im.filepath == path:
            return im
    im = bpy.data.images.load(path)
    im.alpha_mode = "STRAIGHT"
    return im


def standee(name, image_path, pos, height=1.25, tilt=12.0, shadow=True):
    """Boneco de papelão (billboard vertical) com o pé em `pos`."""
    im = _load_image(image_path)
    w, h = im.size
    width = height * w / h
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UV")
    vs = [bm.verts.new(p) for p in ((-width / 2, 0, 0), (width / 2, 0, 0), (width / 2, 0, height), (-width / 2, 0, height))]
    f = bm.faces.new(vs)
    for l, uvc in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        l[uv].uv = uvc
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = im
    tex.interpolation = "Smart"
    em = nt.nodes.new("ShaderNodeEmission")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(tex.outputs["Alpha"], mix.inputs["Fac"])
    nt.links.new(tr.outputs["BSDF"], mix.inputs[1])
    nt.links.new(em.outputs["Emission"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    me.materials.append(m)
    ob.location = (pos.x, pos.y, pos.z + 0.09)
    ob.rotation_euler = (math.radians(tilt), 0, 0)
    if shadow:
        bm2 = bmesh.new()
        col = bm2.loops.layers.color.new("Col")
        segs = 20
        vs = [bm2.verts.new((pos.x + width * 0.34 * math.cos(a), pos.y + 0.13 * math.sin(a), 0.082))
              for a in (2 * math.pi * k / segs for k in range(segs))]
        f2 = bm2.faces.new(vs)
        for l in f2.loops:
            l[col] = (0.0, 0.0, 0.0, 1.0)
        sm = bpy.data.materials.get("sombra_chao")
        if sm is None:
            sm = bpy.data.materials.new("sombra_chao")
            sm.use_nodes = True
            n = sm.node_tree
            n.nodes.clear()
            tr = n.nodes.new("ShaderNodeBsdfTransparent")
            bk = n.nodes.new("ShaderNodeEmission")
            bk.inputs["Color"].default_value = (0, 0, 0, 1)
            mx = n.nodes.new("ShaderNodeMixShader")
            mx.inputs["Fac"].default_value = 0.32
            ot = n.nodes.new("ShaderNodeOutputMaterial")
            n.links.new(tr.outputs["BSDF"], mx.inputs[1])
            n.links.new(bk.outputs["Emission"], mx.inputs[2])
            n.links.new(mx.outputs["Shader"], ot.inputs["Surface"])
        _mesh_obj(name + "_sombra", bm2, sm)
    return ob
