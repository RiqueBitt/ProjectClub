"""Construtores de criatura por arquétipo. Cada carta é uma "receita"
(arquétipo + cores + peças), então todo modelo é próprio e tudo sai no
mesmo estilo: formas redondas, olhos grandes, contorno escuro.
"""
import math

import bmesh
from mathutils import Vector

from . import lib as L
from . import rigs

WHITE = "#fbfbf6"
DARK = "#1b1420"


def M(name, color, **kw):
    return L.mat(name, color, **kw)


# ------------------------------------------------------------------ peças comuns

def eyes(parts, bone, center, gap, size, look=(0, -1, 0), pupil=0.5, angry=False, color=DARK, glow=None):
    """Dois olhos grandes de desenho, virados pra frente (-Y)."""
    cx, cy, cz = center
    for side in (1, -1):
        p = (cx + side * gap, cy, cz)
        parts.append(L.sphere(f"olho{side}", bone, p, (size, size * 0.55, size * 1.12), M("olho", WHITE, rough=0.35)))
        pm = M("pupila", color, rough=0.3) if not glow else M("pupila_luz", glow, emit=glow, emit_strength=3)
        parts.append(L.sphere(f"pupila{side}", bone, (p[0] - side * size * 0.12, cy - size * 0.42, cz - size * 0.05),
                              (size * pupil, size * 0.3, size * pupil * 1.15), pm))
        if angry:
            parts.append(L.box(f"sobr{side}", bone, (p[0], cy - size * 0.35, cz + size * 0.95),
                               (size * 0.95, size * 0.25, size * 0.22), M("sobrancelha", DARK), rot=(0, side * 22, 0), bevel=0.02))


def mouth(parts, bone, center, width, material=None, smile=True):
    cx, cy, cz = center
    parts.append(L.sphere("boca", bone, (cx, cy + 0.006, cz), (width, 0.014, width * 0.42), material or M("boca", DARK)))


def horn(parts, bone, base, length, radius, material, lean=(0, 0, 0)):
    parts.append(L.cone("chifre", bone, (base[0], base[1], base[2] + length / 2), radius, radius * 0.08, length, material, rot=lean))


def flame(parts, bone, base, size, hot="#ffe066", mid="#ff7a1f"):
    """Chama estilizada: uma gota laranja com outra amarela menor na frente."""
    for i, (k, c, dy) in enumerate(((1.0, mid, 0.0), (0.58, hot, -0.12))):
        r = size * 0.30 * k
        m = M("chama" + c, c, emit=c, emit_strength=2.0, rough=1)
        z0 = base[2] + r * 0.85
        y = base[1] + dy * size
        parts.append(L.sphere(f"chama_b{i}", bone, (base[0], y, z0), (r, r, r), m))
        parts.append(L.cone(f"chama_p{i}", bone, (base[0] + r * 0.18, y, z0 + r * 1.25), r * 0.93, 0.0, r * 2.2, m, rot=(0, 8, 0)))


def crystal(parts, bone, base, size, color, lean=(0, 0, 0)):
    m = M("cristal" + color, color, rough=0.15, emit=color, emit_strength=0.6)
    parts.append(L.cone("cristal", bone, (base[0], base[1], base[2] + size * 0.5), size * 0.28, size * 0.2, size, m, rot=lean, segs=6))
    parts.append(L.cone("cristal_p", bone, (base[0], base[1], base[2] + size * 1.15), size * 0.2, 0, size * 0.3, m, rot=lean, segs=6))


def leaf(parts, bone, base, size, color="#58c14a", rot=(0, 0, 0)):
    parts.append(L.sphere("folha", bone, (base[0], base[1], base[2] + size * 0.5), (size * 0.32, size * 0.06, size * 0.55), M("folha" + color, color), rot=rot))


def weapon(parts, kind, bone, grip, scale=1.0, metal="#d8dde6", accent="#c9892f"):
    """Arma presa na mão (o osso da mão aponta pra baixo)."""
    gx, gy, gz = grip
    s = scale
    steel = M("aco", metal, rough=0.3, metal=0.6)
    wood = M("madeira", "#8a5a34")
    gold = M("dourado", accent, rough=0.35, metal=0.5)
    if kind == "sword":
        parts.append(L.cylinder("cabo", bone, (gx, gy - 0.02 * s, gz), 0.025 * s, 0.14 * s, wood, rot=(90, 0, 0)))
        parts.append(L.box("guarda", bone, (gx, gy - 0.10 * s, gz), (0.10 * s, 0.022 * s, 0.03 * s), gold, bevel=0.01))
        parts.append(L.box("lamina", bone, (gx, gy - 0.36 * s, gz), (0.045 * s, 0.25 * s, 0.014 * s), steel, bevel=0.008))
        parts.append(L.cone("ponta", bone, (gx, gy - 0.65 * s, gz), 0.045 * s, 0, 0.09 * s, steel, rot=(90, 0, 0), segs=4, scale=(1, 0.32, 1)))
    elif kind == "staff":
        parts.append(L.cylinder("cajado", bone, (gx, gy, gz + 0.22 * s), 0.022 * s, 0.9 * s, wood))
        parts.append(L.sphere("orbe", bone, (gx, gy, gz + 0.72 * s), (0.085 * s,) * 3, M("orbe" + accent, accent, emit=accent, emit_strength=2.5, rough=0.2)))
        parts.append(L.torus("aro", bone, (gx, gy, gz + 0.64 * s), 0.06 * s, 0.014 * s, gold))
    elif kind == "hammer":
        parts.append(L.cylinder("cabo", bone, (gx, gy - 0.18 * s, gz), 0.026 * s, 0.5 * s, wood, rot=(90, 0, 0)))
        parts.append(L.box("cabeca", bone, (gx, gy - 0.44 * s, gz), (0.16 * s, 0.09 * s, 0.10 * s), steel, bevel=0.025))
    elif kind == "bow":
        parts.append(L.torus("arco", bone, (gx, gy - 0.04 * s, gz), 0.26 * s, 0.018 * s, wood, rot=(0, 90, 0), scale=(1, 0.55, 1)))
    elif kind == "shield":
        parts.append(L.cylinder("escudo", bone, (gx, gy - 0.08 * s, gz), 0.22 * s, 0.045 * s, steel, rot=(90, 0, 0)))
        parts.append(L.cylinder("escudo_c", bone, (gx, gy - 0.11 * s, gz), 0.13 * s, 0.03 * s, gold, rot=(90, 0, 0)))
        parts.append(L.sphere("escudo_b", bone, (gx, gy - 0.13 * s, gz), (0.05 * s,) * 3, steel))
    elif kind == "dagger":
        parts.append(L.cylinder("cabo", bone, (gx, gy - 0.02 * s, gz), 0.02 * s, 0.09 * s, wood, rot=(90, 0, 0)))
        parts.append(L.cone("lamina", bone, (gx, gy - 0.19 * s, gz), 0.035 * s, 0, 0.26 * s, steel, rot=(90, 0, 0), segs=4, scale=(1, 0.3, 1)))
    elif kind == "flask":
        parts.append(L.sphere("frasco", bone, (gx, gy - 0.06 * s, gz + 0.02 * s), (0.09 * s,) * 3, M("vidro" + accent, accent, rough=0.1, emit=accent, emit_strength=1.2)))
        parts.append(L.cylinder("gargalo", bone, (gx, gy - 0.06 * s, gz + 0.13 * s), 0.03 * s, 0.07 * s, M("vidro_g", "#dfeff5", rough=0.1)))
    elif kind == "lantern":
        parts.append(L.torus("alca", bone, (gx, gy, gz - 0.02 * s), 0.05 * s, 0.01 * s, steel, rot=(90, 0, 0)))
        parts.append(L.box("lanterna", bone, (gx, gy, gz - 0.16 * s), (0.07 * s, 0.07 * s, 0.09 * s), M("luz" + accent, accent, emit=accent, emit_strength=3), bevel=0.02))


# ================================================================== BÍPEDE

def biped(p):
    h = p.get("h", 1.0)
    heavy = p.get("heavy", False)
    w = 1.25 if heavy else 1.0
    S = lambda x, y, z: (x * w * h, y * h, z * h)
    body = M("corpo", p["body"])
    belly = M("barriga", p.get("belly", p["body"]))
    skin = M("pele", p.get("skin", p["body"]))
    limb = M("membro", p.get("limb", p["body"]))
    parts = []
    hs = p.get("head_size", 1.0)
    # tronco
    parts.append(L.sphere("quadril", "hips", S(0, 0, 0.46), (0.19 * w * h, 0.16 * h, 0.14 * h), body))
    parts.append(L.sphere("tronco", "spine", S(0, 0, 0.66), (0.22 * w * h, 0.18 * h, 0.21 * h), body))
    if p.get("belly"):
        parts.append(L.sphere("barriga", "spine", S(0, -0.075, 0.62), (0.15 * w * h, 0.12 * h, 0.16 * h), belly))
    # cabeça
    hz = 1.03
    parts.append(L.sphere("cabeca", "head", S(0, 0, hz), (0.27 * hs * h, 0.25 * hs * h, 0.25 * hs * h), skin))
    eyes(parts, "head", S(0, -0.215 * hs, hz + 0.02), 0.105 * hs * h, 0.068 * hs * h, angry=p.get("angry", False), glow=p.get("eye_glow"))
    if p.get("beak"):
        parts.append(L.cone("bico", "head", S(0, -0.30 * hs, hz - 0.05), 0.06 * h, 0.0, 0.16 * h, M("bico", p["beak"]), rot=(90, 0, 0)))
    elif p.get("snout"):
        parts.append(L.sphere("focinho", "head", S(0, -0.25 * hs, hz - 0.07), (0.10 * h, 0.09 * h, 0.07 * h), M("focinho", p["snout"])))
        parts.append(L.sphere("nariz", "head", S(0, -0.335 * hs, hz - 0.05), (0.03 * h, 0.025 * h, 0.022 * h), M("nariz", DARK)))
    else:
        mouth(parts, "head", S(0, -0.245 * hs, hz - 0.10), 0.05 * h)
    # braços e mãos
    for side, suf in ((1, "L"), (-1, "R")):
        parts.append(L.capsule("braco" + suf, "arm." + suf, S(side * 0.25, 0, 0.78), S(side * 0.27, 0, 0.58), 0.058 * h * (1.2 if heavy else 1), limb))
        parts.append(L.sphere("mao" + suf, "hand." + suf, S(side * 0.275, 0, 0.50), (0.07 * h,) * 3, skin))
        parts.append(L.capsule("perna" + suf, "leg." + suf, S(side * 0.12, 0, 0.38), S(side * 0.12, 0, 0.14), 0.07 * h * (1.2 if heavy else 1), limb))
        parts.append(L.sphere("pe" + suf, "foot." + suf, S(side * 0.12, -0.05, 0.05), (0.085 * h, 0.13 * h, 0.055 * h), M("pe", p.get("feet", DARK))))
    # orelhas / chifres
    ears = p.get("ears")
    for side in (1, -1):
        if ears == "pointy":
            parts.append(L.cone("orelha", "head", S(side * 0.24 * hs, 0, hz + 0.10), 0.07 * h, 0, 0.22 * h, skin, rot=(0, side * 55, 0)))
        elif ears == "round":
            parts.append(L.sphere("orelha", "head", S(side * 0.21 * hs, 0, hz + 0.22 * hs), (0.09 * h, 0.05 * h, 0.09 * h), skin))
        elif ears == "long":
            parts.append(L.capsule("orelha", "head", S(side * 0.12 * hs, 0, hz + 0.20 * hs), S(side * 0.16 * hs, 0.02, hz + 0.55 * hs), 0.05 * h, skin))
        if p.get("horns"):
            horn(parts, "head", S(side * 0.15 * hs, 0, hz + 0.18 * hs), 0.22 * h * p.get("horn_size", 1), 0.05 * h, M("chifre", p["horns"]), lean=(0, side * 25, 0))
    # chapéus
    hat = p.get("hat")
    hm = M("chapeu", p.get("hat_color", "#4b3a8a"))
    top = hz + 0.20 * hs
    if hat == "wizard":
        parts.append(L.cylinder("aba", "head", S(0, 0, top), 0.34 * hs * h, 0.03 * h, hm))
        parts.append(L.cone("cone", "head", S(0, 0.02, top + 0.24), 0.22 * hs * h, 0.0, 0.48 * h, hm, rot=(-8, 0, 0)))
    elif hat == "hood":
        parts.append(L.sphere("capuz", "head", S(0, 0.03, hz + 0.03), (0.30 * hs * h, 0.28 * hs * h, 0.29 * hs * h), hm))
        parts.append(L.cone("capuz_p", "head", S(0, 0.16, top + 0.10), 0.12 * h, 0, 0.26 * h, hm, rot=(-50, 0, 0)))
    elif hat == "helmet":
        em = M("elmo", p.get("hat_color", "#c9ced8"), rough=0.3, metal=0.6)
        parts.append(L.sphere("elmo", "head", S(0, 0.03, hz + 0.135), (0.285 * hs * h, 0.27 * hs * h, 0.16 * hs * h), em))
        parts.append(L.torus("elmo_aba", "head", S(0, 0.02, hz + 0.10), 0.265 * hs * h, 0.03 * h, em))
        parts.append(L.box("crista", "head", S(0, 0.02, top + 0.10), (0.03 * h, 0.2 * h, 0.09 * h), M("crista", p.get("accent", "#e23b3b")), bevel=0.02))
    elif hat == "crown":
        gold = M("coroa", "#f2c23a", rough=0.3, metal=0.6)
        parts.append(L.torus("coroa", "head", S(0, 0, top + 0.02), 0.17 * hs * h, 0.035 * h, gold))
        for a in range(5):
            ang = a * 2 * math.pi / 5
            parts.append(L.cone("ponta", "head", S(0.17 * hs * math.cos(ang), 0.17 * hs * math.sin(ang), top + 0.10), 0.04 * h, 0, 0.12 * h, gold, segs=4))
    elif hat == "halo":
        parts.append(L.torus("halo", "head", S(0, 0, top + 0.16), 0.17 * h, 0.022 * h, M("halo", "#ffe680", emit="#ffe680", emit_strength=3)))
    elif hat == "flame":
        flame(parts, "head", S(0, 0, top - 0.03), 0.36 * h)
    elif hat == "leaf":
        leaf(parts, "head", S(0, 0, top - 0.02), 0.34 * h, rot=(0, 20, 0))
    elif hat == "crystal":
        crystal(parts, "head", S(0, 0, top - 0.04), 0.26 * h, p.get("accent", "#7fe3ff"))
    # asas / capa / cauda
    acc = M("acento", p.get("accent", "#ffffff"))
    if p.get("wings"):
        wm = M("asa", p["wings"])
        for side in (1, -1):
            parts.append(L.wing("asa", "spine", S(side * 0.10, 0.17, 0.80), 0.55 * h, 0.42 * h, wm, side=side))
    if p.get("cape"):
        bm = bmesh.new()
        pts = [(-0.20, 0.17, 0.86), (0.20, 0.17, 0.86), (0.28, 0.30, 0.22), (-0.28, 0.30, 0.22)]
        vs = [bm.verts.new(Vector(S(*q))) for q in pts]
        f = bm.faces.new(vs)
        ext = bmesh.ops.extrude_face_region(bm, geom=[f])
        bmesh.ops.translate(bm, verts=[g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)], vec=Vector((0, 0.03 * h, 0)))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        parts.append(L.from_bmesh("capa", "spine", bm, M("capa", p["cape"]), smooth=False))
    if p.get("tail"):
        parts.append(L.capsule("cauda", "hips", S(0, 0.14, 0.44), S(0, 0.42, 0.56), 0.05 * h, M("cauda", p["tail"]), radius_b=0.02 * h))
    if p.get("shell"):
        parts.append(L.sphere("casco", "spine", S(0, 0.10, 0.66), (0.25 * w * h, 0.17 * h, 0.26 * h), M("casco", p["shell"])))
    if p.get("rocks"):
        rm = M("pedra", p["rocks"], rough=0.95)
        for (x, z, s) in ((0.24, 0.84, 0.11), (-0.26, 0.82, 0.13), (0, 0.90, 0.08)):
            parts.append(L.box("rocha", "spine", S(x, 0.05, z), (s * h, s * h, s * h), rm, rot=(20, 30, 15), bevel=0.03))
    if p.get("belt"):
        parts.append(L.torus("cinto", "hips", S(0, 0, 0.52), 0.20 * w * h, 0.03 * h, M("cinto", p["belt"]), scale=(1, 0.85, 1)))
    # armas
    if p.get("weapon"):
        weapon(parts, p["weapon"], "hand.R", S(-0.28, -0.02, 0.50), scale=h * p.get("weapon_size", 1), accent=p.get("accent", "#c9892f"))
    if p.get("offhand"):
        weapon(parts, p["offhand"], "hand.L", S(0.28, -0.02, 0.50), scale=h * p.get("weapon_size", 1), accent=p.get("accent", "#c9892f"))
    arm = L.armature("Rig", rigs.biped_bones(h, heavy))
    return arm, parts, rigs.biped_clips(heavy)


# ================================================================== QUADRÚPEDE

def quad(p):
    h = p.get("h", 1.0)
    lg = p.get("long", 1.0)
    S = lambda x, y, z: (x * h, y * h * lg, z * h)
    body = M("corpo", p["body"])
    skin = M("pele", p.get("skin", p["body"]))
    parts = []
    fat = p.get("fat", 1.0)
    parts.append(L.sphere("corpo", "body", S(0, 0.02, 0.50), (0.24 * fat * h, 0.40 * h * lg, 0.22 * fat * h), body))
    if p.get("belly"):
        parts.append(L.sphere("barriga", "body", S(0, 0.0, 0.43), (0.19 * fat * h, 0.32 * h * lg, 0.15 * h), M("barriga", p["belly"])))
    parts.append(L.capsule("pescoco", "neck", S(0, -0.28, 0.54), S(0, -0.40, 0.70), 0.12 * h, body))
    hs = p.get("head_size", 1.0)
    parts.append(L.sphere("cabeca", "head", S(0, -0.50, 0.76), (0.19 * hs * h, 0.20 * hs * h, 0.18 * hs * h), skin))
    parts.append(L.sphere("focinho", "head", S(0, -0.66, 0.71), (0.11 * hs * h, 0.13 * hs * h, 0.09 * hs * h), M("focinho", p.get("snout", p.get("skin", p["body"])))))
    parts.append(L.sphere("nariz", "head", S(0, -0.78, 0.73), (0.035 * h, 0.03 * h, 0.028 * h), M("nariz", DARK)))
    eyes(parts, "head", S(0, -0.635, 0.82), 0.10 * hs * h, 0.055 * hs * h, angry=p.get("angry", False), glow=p.get("eye_glow"))
    for side in (1, -1):
        e = p.get("ears", "pointy")
        if e == "pointy":
            parts.append(L.cone("orelha", "head", S(side * 0.12 * hs, -0.44, 0.95), 0.06 * h, 0, 0.17 * h, skin, rot=(-10, side * 15, 0)))
        elif e == "round":
            parts.append(L.sphere("orelha", "head", S(side * 0.15 * hs, -0.46, 0.92), (0.07 * h, 0.04 * h, 0.07 * h), skin))
        elif e == "flop":
            parts.append(L.sphere("orelha", "head", S(side * 0.19 * hs, -0.47, 0.78), (0.05 * h, 0.07 * h, 0.12 * h), M("orelha", p.get("mane", p["body"]))))
        if p.get("horns"):
            horn(parts, "head", S(side * 0.10 * hs, -0.46, 0.90), 0.20 * h * p.get("horn_size", 1), 0.045 * h, M("chifre", p["horns"]), lean=(-15, side * 30, 0))
        if p.get("tusks"):
            parts.append(L.cone("presa", "head", S(side * 0.08, -0.72, 0.70), 0.028 * h, 0, 0.12 * h, M("presa", WHITE), rot=(-30, side * 20, 0)))
    for name, x, y in (("FL", 0.16, -0.20), ("FR", -0.16, -0.20), ("BL", 0.16, 0.22), ("BR", -0.16, 0.22)):
        parts.append(L.capsule("perna" + name, "leg." + name, S(x, y, 0.40), S(x, y, 0.10), 0.065 * h * fat, body))
        parts.append(L.sphere("pata" + name, "leg." + name, S(x, y - 0.02, 0.045), (0.075 * h, 0.09 * h, 0.05 * h), M("pata", p.get("feet", DARK))))
    t = p.get("tail", "thin")
    tm = M("cauda", p.get("tail_color", p["body"]))
    if t == "thin":
        parts.append(L.capsule("cauda", "tail", S(0, 0.34, 0.54), S(0, 0.62, 0.70), 0.04 * h, tm, radius_b=0.02 * h))
    elif t == "bushy":
        parts.append(L.sphere("cauda", "tail", S(0, 0.52, 0.64), (0.11 * h, 0.22 * h, 0.12 * h), tm, rot=(-25, 0, 0)))
    elif t == "flame":
        parts.append(L.capsule("cauda", "tail", S(0, 0.34, 0.54), S(0, 0.55, 0.62), 0.04 * h, body))
        flame(parts, "tail", S(0, 0.58, 0.60), 0.30 * h)
    elif t == "stub":
        parts.append(L.sphere("cauda", "tail", S(0, 0.42, 0.56), (0.06 * h,) * 3, tm))
    if p.get("mane"):
        mm = M("juba", p["mane"])
        for i in range(5):
            parts.append(L.cone("juba", "neck" if i < 3 else "body", S(0, -0.42 + i * 0.13, 0.80 - i * 0.03), 0.07 * h, 0, 0.20 * h, mm, rot=(25, 0, 0)))
    if p.get("spikes"):
        sm = M("espinho", p["spikes"])
        for i in range(4):
            parts.append(L.cone("espinho", "body", S(0, -0.18 + i * 0.16, 0.74), 0.05 * h, 0, 0.18 * h, sm))
    if p.get("shell"):
        parts.append(L.sphere("casco", "body", S(0, 0.04, 0.60), (0.30 * h, 0.40 * h * lg, 0.22 * h), M("casco", p["shell"])))
        dm = M("casco_d", p.get("shell_detail", "#ff8fb1"))
        for (x, y, z) in ((0.12, -0.12, 0.80), (-0.14, 0.10, 0.80), (0.05, 0.22, 0.79)):
            parts.append(L.capsule("coral", "body", S(x, y, z - 0.03), S(x * 1.2, y, z + 0.12), 0.03 * h, dm))
    if p.get("moss"):
        parts.append(L.sphere("musgo", "body", S(0, 0.04, 0.66), (0.22 * h, 0.34 * h * lg, 0.10 * h), M("musgo", p["moss"], rough=1)))
    if p.get("back_flame"):
        for i in range(3):
            flame(parts, "body", S(0, -0.12 + i * 0.18, 0.66), (0.26 - i * 0.03) * h)
    if p.get("frost"):
        for i in range(3):
            crystal(parts, "body", S(0, -0.10 + i * 0.17, 0.68), 0.16 * h, p["frost"], lean=(10 * (i - 1), 0, 0))
    arm = L.armature("Rig", rigs.quad_bones(h, lg))
    return arm, parts, rigs.quad_clips()


# ================================================================== BOLINHA

def blob(p):
    h = p.get("h", 1.0)
    S = lambda x, y, z: (x * h, y * h, z * h)
    body = M("corpo", p["body"], rough=p.get("rough", 0.5), emit=p.get("glow"), emit_strength=p.get("glow_strength", 1.0))
    parts = []
    sq = p.get("squat", 1.0)
    parts.append(L.sphere("corpo", "body", S(0, 0, 0.36 * sq), (0.38 * h, 0.36 * h, 0.36 * sq * h), body, segs=24, rings=14))
    if p.get("belly"):
        parts.append(L.sphere("barriga", "body", S(0, -0.09, 0.25 * sq), (0.25 * h, 0.26 * h, 0.20 * sq * h), M("barriga", p["belly"])))
    eyes(parts, "body", S(0, -0.31, 0.44 * sq), 0.13 * h, 0.085 * h, angry=p.get("angry", False), glow=p.get("eye_glow"))
    mouth(parts, "body", S(0, -0.352, 0.25 * sq), 0.055 * h)
    for side, suf in ((1, "L"), (-1, "R")):
        parts.append(L.sphere("braco" + suf, "arm." + suf, S(side * 0.38, 0, 0.28 * sq), (0.09 * h, 0.07 * h, 0.07 * h), body))
    topz = 0.70 * sq
    t = p.get("top")
    if t == "flame":
        flame(parts, "top", S(0, 0, topz - 0.04), 0.42 * h)
    elif t == "sprout":
        parts.append(L.capsule("caule", "top", S(0, 0, topz - 0.02), S(0, 0, topz + 0.16), 0.022 * h, M("caule", "#3f8f3a")))
        leaf(parts, "top", S(0.07, 0, topz + 0.08), 0.26 * h, rot=(0, 55, 0))
        leaf(parts, "top", S(-0.07, 0, topz + 0.08), 0.26 * h, rot=(0, -55, 0))
    elif t == "drop":
        parts.append(L.cone("gota", "top", S(0, 0, topz + 0.08), 0.13 * h, 0, 0.30 * h, body))
    elif t == "antenna":
        parts.append(L.capsule("antena", "top", S(0, 0, topz - 0.02), S(0, -0.10, topz + 0.22), 0.018 * h, M("antena", DARK)))
        parts.append(L.sphere("luz", "top", S(0, -0.12, topz + 0.26), (0.07 * h,) * 3, M("luz", p.get("accent", "#ffe680"), emit=p.get("accent", "#ffe680"), emit_strength=4)))
    elif t == "crystal":
        crystal(parts, "top", S(0, 0, topz - 0.06), 0.28 * h, p.get("accent", "#7fe3ff"))
        crystal(parts, "top", S(0.13, 0.02, topz - 0.12), 0.17 * h, p.get("accent", "#7fe3ff"), lean=(0, 25, 0))
    elif t == "rock":
        for (x, y, s) in ((0, 0, 0.14), (0.16, 0.03, 0.09), (-0.15, -0.02, 0.10)):
            parts.append(L.box("rocha", "top", S(x, y, topz - 0.02 + s * 0.5), (s * h,) * 3, M("pedra", p.get("accent", "#8d8f98"), rough=0.95), rot=(15, 25, 10), bevel=0.03))
    elif t == "tuft":
        for a in (-25, 0, 25):
            parts.append(L.cone("tufo", "top", S(a * 0.004, 0, topz + 0.08), 0.06 * h, 0, 0.24 * h, M("tufo", p.get("accent", p["body"])), rot=(0, a, 0)))
    elif t == "ears":
        for side in (1, -1):
            parts.append(L.cone("orelha", "top", S(side * 0.20, 0, topz + 0.02), 0.09 * h, 0, 0.22 * h, body, rot=(0, side * 25, 0)))
    elif t == "halo":
        parts.append(L.torus("halo", "top", S(0, 0, topz + 0.16), 0.2 * h, 0.025 * h, M("halo", "#ffe680", emit="#ffe680", emit_strength=3)))
    if p.get("wings"):
        wm = M("asa", p["wings"], alpha=p.get("wing_alpha", 1.0))
        for side in (1, -1):
            parts.append(L.wing("asa", "arm.L" if side > 0 else "arm.R", S(side * 0.30, 0.10, 0.48 * sq), 0.36 * h, 0.26 * h, wm, side=side, droop=-0.1))
    if p.get("fins"):
        fm = M("barbatana", p["fins"])
        parts.append(L.cone("barb", "top", S(0, 0.05, topz + 0.03), 0.14 * h, 0, 0.26 * h, fm, scale=(0.25, 1, 1), rot=(-15, 0, 0)))
        parts.append(L.cone("rabo", "body", S(0, 0.44, 0.30 * sq), 0.16 * h, 0.02, 0.30 * h, fm, scale=(0.25, 1, 1), rot=(-90, 0, 0)))
    arm = L.armature("Rig", rigs.blob_bones(h))
    return arm, parts, rigs.blob_clips()


# ================================================================== VOADOR

def flyer(p):
    h = p.get("h", 1.0)
    span = p.get("span", 1.0)
    S = lambda x, y, z: (x * h, y * h, z * h)
    body = M("corpo", p["body"], emit=p.get("glow"), emit_strength=p.get("glow_strength", 1.0))
    parts = []
    parts.append(L.sphere("corpo", "body", S(0, 0.02, 0.64), (0.20 * h, 0.30 * h, 0.19 * h), body))
    if p.get("belly"):
        parts.append(L.sphere("barriga", "body", S(0, -0.02, 0.58), (0.15 * h, 0.22 * h, 0.13 * h), M("barriga", p["belly"])))
    hs = p.get("head_size", 1.0)
    parts.append(L.sphere("cabeca", "head", S(0, -0.32, 0.78), (0.18 * hs * h, 0.18 * hs * h, 0.17 * hs * h), M("pele", p.get("skin", p["body"]))))
    eyes(parts, "head", S(0, -0.465, 0.82), 0.085 * hs * h, 0.055 * hs * h, angry=p.get("angry", False), glow=p.get("eye_glow"))
    if p.get("beak"):
        parts.append(L.cone("bico", "head", S(0, -0.54, 0.74), 0.055 * h, 0, 0.17 * h * p.get("beak_size", 1), M("bico", p["beak"]), rot=(98, 0, 0)))
    elif p.get("snout"):
        parts.append(L.sphere("focinho", "head", S(0, -0.50, 0.73), (0.10 * h, 0.13 * h, 0.08 * h), M("focinho", p["snout"])))
    if p.get("crest"):
        for i in range(3):
            parts.append(L.cone("crista", "head", S(0, -0.30 + i * 0.07, 0.96 - i * 0.02), 0.045 * h, 0, 0.18 * h, M("crista", p["crest"]), rot=(20 + i * 12, 0, 0)))
    if p.get("ears"):
        for side in (1, -1):
            parts.append(L.cone("orelha", "head", S(side * 0.12, -0.28, 0.96), 0.07 * h, 0, 0.22 * h, body, rot=(0, side * 20, 0)))
    if p.get("horns"):
        for side in (1, -1):
            horn(parts, "head", S(side * 0.09, -0.26, 0.92), 0.2 * h, 0.04 * h, M("chifre", p["horns"]), lean=(-25, side * 25, 0))
    wm = M("asa", p.get("wings", p["body"]), alpha=p.get("wing_alpha", 1.0))
    for side, suf in ((1, "L"), (-1, "R")):
        parts.append(L.wing("asa" + suf, "wing." + suf, S(side * 0.14, -0.02, 0.70), 0.60 * h * span, 0.44 * h, wm, side=side, ribs=4 if p.get("bat") else 3))
    tm = M("cauda", p.get("tail_color", p.get("wings", p["body"])))
    tk = p.get("tail", "fan")
    if tk == "fan":
        for a in (-22, 0, 22):
            parts.append(L.sphere("pena", "tail", S(a * 0.004, 0.42, 0.60), (0.05 * h, 0.17 * h, 0.02 * h), tm, rot=(0, 0, a)))
    elif tk == "long":
        parts.append(L.capsule("cauda", "tail", S(0, 0.28, 0.62), S(0, 0.80, 0.54), 0.06 * h, body, radius_b=0.015 * h))
    elif tk == "flame":
        flame(parts, "tail", S(0, 0.40, 0.56), 0.34 * h)
    for side in (1, -1):
        parts.append(L.capsule("perna", "legs", S(side * 0.07, 0.02, 0.52), S(side * 0.07, 0.0, 0.40), 0.022 * h, M("perna", p.get("beak", DARK))))
    if p.get("aura_flame"):
        flame(parts, "head", S(0, -0.30, 0.92), 0.26 * h)
    arm = L.armature("Rig", rigs.flyer_bones(h, span))
    return arm, parts, rigs.flyer_clips()


# ================================================================== SERPENTE

def serpent(p):
    h = p.get("h", 1.0)
    body = M("corpo", p["body"])
    belly = M("barriga", p.get("belly", p["body"]))
    parts = []
    bones = rigs.serpent_bones(h)
    segs = [b for b in bones if b[0].startswith("seg")]
    n = len(segs)
    for i, (name, a, b, _) in enumerate(segs):
        r = (0.07 + 0.09 * math.sin(math.pi * (i + 0.6) / (n + 0.6))) * h * p.get("thick", 1.0)
        parts.append(L.capsule(name, name, a, b, r, body))
        if p.get("spikes") and i > 0:
            mid = L.lerp(a, b, 0.5)
            parts.append(L.cone("espinho", name, (mid[0], mid[1], mid[2] + r + 0.05 * h), 0.04 * h, 0, 0.16 * h, M("espinho", p["spikes"])))
        if p.get("frost") and i in (2, 4):
            mid = L.lerp(a, b, 0.5)
            crystal(parts, name, (mid[0], mid[1], mid[2] + r - 0.02), 0.15 * h, p["frost"])
    hd = [b for b in bones if b[0] == "head"][0]
    hc = L.lerp(hd[1], hd[2], 0.5)
    hs = p.get("head_size", 1.0)
    parts.append(L.sphere("cabeca", "head", hc, (0.17 * hs * h, 0.22 * hs * h, 0.15 * hs * h), body))
    parts.append(L.sphere("queixo", "head", (hc[0], hc[1] - 0.04 * h, hc[2] - 0.06 * h), (0.13 * hs * h, 0.18 * hs * h, 0.08 * hs * h), belly))
    eyes(parts, "head", (hc[0], hc[1] - 0.15 * hs * h, hc[2] + 0.07 * hs * h), 0.09 * hs * h, 0.055 * hs * h, angry=p.get("angry", True), glow=p.get("eye_glow"))
    if p.get("horns"):
        for side in (1, -1):
            horn(parts, "head", (hc[0] + side * 0.09 * h, hc[1] + 0.06 * h, hc[2] + 0.10 * h), 0.22 * h, 0.04 * h, M("chifre", p["horns"]), lean=(-35, side * 25, 0))
    if p.get("fins"):
        fm = M("barbatana", p["fins"])
        for side in (1, -1):
            parts.append(L.cone("barb", "head", (hc[0] + side * 0.17 * h, hc[1] + 0.05 * h, hc[2]), 0.11 * h, 0, 0.22 * h, fm, rot=(0, side * 80, 0), scale=(1, 0.25, 1)))
    if p.get("fangs"):
        for side in (1, -1):
            parts.append(L.cone("presa", "head", (hc[0] + side * 0.06 * h, hc[1] - 0.20 * hs * h, hc[2] - 0.08 * h), 0.022 * h, 0, 0.10 * h, M("presa", WHITE), rot=(180, 0, 0)))
    arm = L.armature("Rig", bones)
    return arm, parts, rigs.serpent_clips()


BUILDERS = {"biped": biped, "quad": quad, "blob": blob, "flyer": flyer, "serpent": serpent}


def build(recipe, outline=0.0):
    L.reset()
    arm, parts, clips = BUILDERS[recipe["kind"]](recipe)
    body = L.assemble("Corpo", parts, arm, outline=outline * recipe.get("h", 1.0))
    L.bake(arm, clips)
    return arm, body
