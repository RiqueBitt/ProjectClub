"""Praça nevada da Guerra das Cartas 3D: pista de gelo redonda, montes de neve,
prédios com neve no telhado, pinheiros, montanhas, postes, bancos e céu.
Tudo ORIGINAL, feito por código (nada baixado nem gerado por IA).

Eixos: +Y = lado do oponente (fundo), -Y = lado do jogador (câmera), +Z = cima.
"""
import math
import random

import bpy
from mathutils import Matrix, Vector

from .shapes import Mesh, rgba, vmat

I = Matrix.Identity(4)

NEVE = "#f4f9ff"
NEVE_AZUL = "#d6e8f7"
GELO = "#a9dcf3"
GELO_CLARO = "#dff4ff"
PINHEIRO = "#1c6b52"
MADEIRA = "#8a5a34"
TIJOLO = "#a0462f"


def _text(txt, loc, size, color, rot=(90, 0, 0), extrude=0.06, emit=1.0, bold=True):
    cu = bpy.data.curves.new("txt_" + txt, "FONT")
    cu.body = txt
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.size = size
    cu.extrude = extrude
    cu.bevel_depth = 0.01
    ob = bpy.data.objects.new("txt_" + txt, cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = [math.radians(a) for a in rot]
    m = bpy.data.materials.new("txt_" + txt)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    r, g, bl = (int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    b.inputs["Base Color"].default_value = (r ** 2.2, g ** 2.2, bl ** 2.2, 1)
    b.inputs["Emission Color"].default_value = (r ** 2.2, g ** 2.2, bl ** 2.2, 1)
    b.inputs["Emission Strength"].default_value = emit
    cu.materials.append(m)
    return ob


def _pine(m, snow, x, y, s, rnd):
    h = s
    m.cone(I, (x, y, 0.3 * h), 0.16 * h, 0.12 * h, 0.6 * h, rgba("#5a3a22"), segs=8)
    for k, (z, r) in enumerate(((0.75, 0.62), (1.25, 0.48), (1.7, 0.33))):
        c = 0.85 + 0.2 * rnd.random()
        m.cone(I, (x, y, z * h), r * h, 0.04 * h, 0.8 * h, rgba(PINHEIRO, c), segs=10)
        snow.cone(I, (x, y, (z + 0.12) * h), r * h * 0.8, 0.03 * h, 0.6 * h, rgba(NEVE), segs=10)


def _lamp(m, lum, x, y, s=1.0):
    m.cone(I, (x, y, 1.1 * s), 0.07 * s, 0.09 * s, 2.2 * s, rgba("#2a2a38"), segs=8)
    m.box(I, (x, y, 2.35 * s), (0.34 * s, 0.34 * s, 0.1 * s), rgba("#2a2a38"))
    lum.box(I, (x, y, 2.58 * s), (0.26 * s, 0.26 * s, 0.4 * s), rgba("#ffd98a"))
    m.cone(I, (x, y, 2.88 * s), 0.26 * s, 0.03 * s, 0.22 * s, rgba("#2a2a38"), segs=4)
    m.cone(I, (x, y, 2.97 * s), 0.2 * s, 0.02 * s, 0.14 * s, rgba(NEVE), segs=4)


def _bench(m, x, y, w=2.0, yaw=0.0):
    R = Matrix.Translation((x, y, 0)) @ Matrix.Rotation(math.radians(yaw), 4, "Z")
    m.box(R, (0, 0, 0.45), (w, 0.55, 0.1), rgba(MADEIRA))
    m.box(R, (0, 0.25, 0.8), (w, 0.1, 0.5), rgba("#7a4c2a"))
    for s in (-1, 1):
        m.box(R, (s * (w / 2 - 0.15), 0, 0.22), (0.1, 0.4, 0.44), rgba("#4a3320"))
    m.box(R, (0, 0, 0.52), (w * 0.98, 0.5, 0.06), rgba(NEVE))


def _house(m, lum, snow, cx, cy, w, d, h, wall, roof, door="#3a2a1f", win_rows=2, win_cols=3, roof_h=None, awning=None):
    roof_h = roof_h or w * 0.34
    m.box(I, (cx, cy, h / 2), (w, d, h), rgba(wall))
    m.box(I, (cx, cy, 0.12), (w + 0.3, d + 0.3, 0.24), rgba("#6a6f7c"))  # base de pedra
    m.gable(cx, cy, w, d, h, roof_h, rgba(roof), over=0.35)
    snow.gable(cx, cy, w * 0.97, d + 0.35, h + 0.12, roof_h * 0.97, rgba(NEVE), over=0.4)
    fy = cy - d / 2 - 0.02
    m.box(I, (cx, fy, 0.9), (0.9, 0.08, 1.7), rgba(door))
    for r in range(win_rows):
        for c in range(win_cols):
            wx = cx + (c - (win_cols - 1) / 2) * (w / (win_cols + 0.4))
            wz = 1.0 + h * 0.3 + r * (h * 0.36)
            if r == 0 and abs(wx - cx) < 0.9:
                continue
            m.box(I, (wx, fy - 0.01, wz), (0.62, 0.1, 0.8), rgba("#f4ead2"))
            lum.box(I, (wx, fy - 0.03, wz), (0.5, 0.1, 0.68), rgba("#ffcf6a"))
            m.box(I, (wx, fy - 0.06, wz), (0.5, 0.05, 0.06), rgba("#f4ead2"))
            m.box(I, (wx, fy - 0.06, wz), (0.06, 0.05, 0.68), rgba("#f4ead2"))
    if awning:
        m.box(I, (cx, fy - 0.35, 2.3), (w * 0.8, 0.8, 0.12), rgba(awning), rot=(-12, 0, 0))
        snow.box(I, (cx, fy - 0.3, 2.42), (w * 0.8, 0.8, 0.08), rgba(NEVE), rot=(-12, 0, 0))


def build(seed=3):
    rnd = random.Random(seed)
    m, lum, snow, ice = Mesh(), Mesh(), Mesh(), Mesh()

    # chão de neve e pista de gelo
    m.cone(I, (0, 8, -0.4), 70, 70, 0.8, rgba(NEVE_AZUL, 0.97), segs=48, smooth=False)
    ice.cone(I, (0, 0, 0.05), 1.0, 1.0, 0.1, rgba(GELO), scl=(8.6, 5.3, 1), segs=64, smooth=False)
    ice.cone(I, (0, 0, 0.11), 1.0, 1.0, 0.04, rgba(GELO_CLARO), scl=(6.6, 3.7, 1), segs=64, smooth=False)
    ice.cone(I, (0, 0, 0.125), 1.0, 1.0, 0.02, rgba("#e9f8ff"), scl=(3.4, 1.9, 1), segs=48, smooth=False)

    # montes de neve em volta da pista
    for k in range(70):
        a = 2 * math.pi * k / 70 + rnd.uniform(-0.03, 0.03)
        ex, ey = 9.3 + rnd.uniform(-0.3, 0.7), 6.0 + rnd.uniform(-0.2, 0.6)
        x, y = ex * math.cos(a), ey * math.sin(a)
        r = rnd.uniform(0.7, 1.25)
        snow.sphere(I, (x, y, 0.05), (r * 1.2, r, r * rnd.uniform(0.5, 0.72)), rgba(rnd.choice((NEVE, NEVE, NEVE_AZUL))), segs=12, rings=8)
    # blocos de gelo azul (como na referência)
    for x, y, yaw in ((-10.4, 2.6, 15), (-10.0, 0.2, -10), (10.4, 2.4, -14), (10.0, 0.0, 10)):
        m.box(I, (x, y, 0.55), (1.7, 1.3, 1.1), rgba("#a5c8e6"), rot=(0, 0, yaw))
        snow.box(I, (x, y, 1.12), (1.8, 1.4, 0.2), rgba(NEVE), rot=(0, 0, yaw))
    # cercas de madeira nas pontas
    for sx in (-1, 1):
        for k in range(5):
            x = sx * (12.2 + k * 0.75)
            m.box(I, (x, 3.2 - k * 0.5, 0.55), (0.18, 0.18, 1.1), rgba("#6b4528"))
            snow.box(I, (x, 3.2 - k * 0.5, 1.12), (0.24, 0.24, 0.1), rgba(NEVE))
        m.box(I, (sx * 14.0, 2.2, 0.85), (3.6, 0.1, 0.12), rgba("#7a4c2a"), rot=(0, 0, sx * 15))
        m.box(I, (sx * 14.0, 2.2, 0.55), (3.6, 0.1, 0.12), rgba("#7a4c2a"), rot=(0, 0, sx * 15))

    # palco do fundo (onde o herói do oponente fica)
    snow.sphere(I, (0, 7.6, 0.0), (4.6, 1.9, 1.0), rgba(NEVE), segs=24, rings=12)
    m.box(I, (0, 7.9, 0.45), (5.2, 0.8, 0.9), rgba("#c9d6e3"))
    snow.box(I, (0, 7.9, 0.95), (5.3, 0.9, 0.14), rgba(NEVE))

    # prédios
    _house(m, lum, snow, -9.0, 13.5, 7.0, 5.5, 6.0, TIJOLO, "#6d3a2c", win_rows=2, win_cols=3, awning="#cf4a3a")
    _house(m, lum, snow, 10.0, 13.5, 7.0, 5.5, 5.6, "#8a3a2e", "#5a3a4e", win_rows=2, win_cols=3, awning="#2cb9c9")
    # clube de dança (fachada escura, neon ciano, bola de discoteca)
    m.box(I, (0, 15.5, 4.2), (8.0, 4.0, 8.4), rgba("#2e3546"))
    m.box(I, (0, 13.4, 0.12), (8.4, 0.4, 0.24), rgba("#6a6f7c"))
    m.box(I, (0, 13.4, 7.35), (8.2, 0.7, 1.6), rgba("#3a4258"))
    snow.box(I, (0, 15.5, 8.52), (8.3, 4.3, 0.28), rgba(NEVE))
    lum.box(I, (0, 13.32, 3.1), (2.6, 0.1, 3.4), rgba("#2ad2f0"))        # porta iluminada
    m.box(I, (0, 13.36, 3.1), (2.9, 0.06, 3.7), rgba("#1a2030"))
    for sx in (-1, 1):
        lum.box(I, (sx * 3.2, 13.3, 2.6), (0.18, 0.1, 4.6), rgba("#2ad2f0"))
        m.box(I, (sx * 3.2, 13.42, 1.6), (1.0, 0.5, 2.4), rgba("#1b1f2c"))  # caixas de som
    for k in range(7):
        lum.box(I, (-3.3 + k * 1.1, 13.3, 8.05), (0.5, 0.1, 0.3), rgba(("#ff5a5a", "#ffd23c", "#5aff8a", "#5ac8ff", "#c58bff")[k % 5]))
    lum.sphere(I, (0, 14.6, 9.9), 1.3, rgba("#c9d8ee"), segs=10, rings=6, smooth=False)  # bola de discoteca
    m.cone(I, (0, 14.6, 8.9), 0.08, 0.08, 1.0, rgba("#9aa0ad"), segs=6)
    for sx in (-1, 1):  # estrela dourada na porta
        pass
    lum.sphere(I, (0, 13.25, 4.9), (0.45, 0.08, 0.45), rgba("#ffd23c"), segs=5, rings=3)

    # pinheiros
    spots = []
    for _ in range(46):
        x = rnd.uniform(-34, 34)
        y = rnd.uniform(6, 34)
        if abs(x) < 15 and y < 20:
            continue
        if -14 < x < 14 and 11 < y < 19:
            continue
        spots.append((x, y, rnd.uniform(2.2, 4.4)))
    for x, y, s in spots:
        _pine(m, snow, x, y, s, rnd)
    for x, y, s in ((-13.5, 5.5, 3.0), (-17, 9, 3.6), (14.2, 5.2, 3.2), (17.5, 8.5, 3.8), (-15.6, -1.5, 3.4), (16, -2.2, 3.0)):
        _pine(m, snow, x, y, s, rnd)

    # montanhas
    for x, y, r, h in ((-26, 46, 20, 17), (-4, 52, 24, 22), (22, 48, 20, 16), (45, 44, 16, 13), (-46, 42, 16, 12)):
        m.cone(I, (x, y, h / 2), r, 0.4, h, rgba("#7f9cc2"), segs=7, smooth=False)
        snow.cone(I, (x, y, h * 0.78), r * 0.42, 0.4, h * 0.44, rgba("#ffffff"), segs=7, smooth=False)

    # postes, bancos
    for x, y in ((-6.6, 9.3), (6.8, 9.3), (-12.5, 3.2), (12.5, 3.2)):
        _lamp(m, lum, x, y, 1.15)
    _bench(m, -5.4, 9.2, 2.4)
    _bench(m, 5.6, 9.2, 2.4)
    _bench(m, -11.2, -1.2, 2.0, 70)
    _bench(m, 11.2, -1.2, 2.0, -70)

    objs = [
        m.to_object("cenario", vmat("cenario", rough=0.85, emit=0.18)),
        snow.to_object("neve", vmat("neve", rough=0.95, emit=0.3)),
        ice.to_object("gelo", vmat("gelo", rough=0.12, spec=0.7, emit=0.22)),
        lum.to_object("luzes", vmat("luzes", rough=0.5, emit=2.0)),
    ]
    # placas com texto (fachadas)
    _text("CAFÉ", (-5.15, 10.45, 4.55), 0.62, "#ffb13a", rot=(90, 0, 0), emit=1.2)
    _text("DANCE CLUB", (0, 13.0, 7.35), 0.95, "#ffd23c", rot=(90, 0, 0), emit=1.4)
    _text("LOJA PINGUIM", (10.0, 10.62, 4.6), 0.82, "#ffffff", rot=(90, 0, 0))
    m2 = Mesh()
    m2.box(I, (10.0, 10.66, 4.6), (5.4, 0.12, 1.3), rgba("#7a3aa8"))
    m2.box(I, (10.0, 10.64, 4.6), (5.55, 0.08, 1.45), rgba("#c58bff"))
    m2.box(I, (6.3, 10.66, 5.5), (1.3, 0.14, 1.1), rgba("#e04aa8"))
    m2.box(I, (6.3, 10.62, 5.5), (0.22, 0.16, 1.14), rgba("#ffd23c"))
    m2.box(I, (6.3, 10.62, 5.5), (1.34, 0.16, 0.2), rgba("#ffd23c"))
    m2.box(I, (-4.0, 10.7, 4.9), (2.0, 0.12, 3.0), rgba("#7a3a1c"))
    objs.append(m2.to_object("placas", vmat("placas", rough=0.6, emit=0.4)))
    return objs


def ceu(sc):
    """Céu em degradê + sol."""
    w = bpy.data.worlds.new("ceu")
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    ramp.color_ramp.elements[0].position = 0.5
    ramp.color_ramp.elements[0].color = (0.62, 0.84, 0.98, 1)
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.elements[1].color = (0.08, 0.36, 0.82, 1)
    bg.inputs["Strength"].default_value = 1.15
    sc.world = w
    sun = bpy.data.objects.new("sol", bpy.data.lights.new("sol", "SUN"))
    sc.collection.objects.link(sun)
    sun.data.energy = 3.2
    sun.data.angle = math.radians(4)
    sun.data.color = (1.0, 0.96, 0.88)
    sun.rotation_euler = (math.radians(52), math.radians(-8), math.radians(-28))
    # nuvens
    c = Mesh()
    rnd = random.Random(5)
    for k in range(10):
        x, y, z = rnd.uniform(-45, 45), 60, rnd.uniform(14, 30)
        for _ in range(5):
            r = rnd.uniform(2.5, 5)
            c.sphere(I, (x + rnd.uniform(-5, 5), y, z + rnd.uniform(-1, 1)), (r * 1.4, r * 0.7, r * 0.6), rgba("#ffffff"), segs=12, rings=8)
    c.to_object("nuvens", vmat("nuvens", rough=1.0, emit=0.9))
