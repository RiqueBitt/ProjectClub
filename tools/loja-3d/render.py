"""Parede da Loja em 3D — gancho cromado, caixinha de plástico e painel perfurado.

Tudo aqui é modelado por código e renderizado no Blender (Cycles): nenhuma
imagem vem de gerador de imagem. As camadas saem com transparência em
client/public/loja/parede/ e a Loja monta por cima (styles/shop-store.css):

  caixinha.webp  plástico da caixinha + aba + as sombras que ela faz
                 (cinza neutro: a cor de cada item é aplicada no CSS)
  gancho.webp    gancho cromado + a sombra dele
  painel.webp    azulejo do painel perfurado (repete sem emenda)
  medidas.json   onde fica cada coisa dentro da imagem (em %), pro CSS

Uso:  python tools/loja-3d/render.py [caixinha|gancho|painel|tudo] [--rascunho]
(precisa do módulo bpy — `pip install bpy` — e do Pillow)
"""
import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.normpath(os.path.join(AQUI, '..', '..', 'client', 'public', 'loja', 'parede'))
TMP = os.environ.get('LOJA3D_TMP', '/tmp/l3d')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
ALVO = args[0] if args else 'tudo'
RASCUNHO = '--rascunho' in sys.argv

# ---------------------------------------------------------------- medidas (1 unidade = 20 px na tela)
PX = 20.0
W, H, D = 9.2, 10.6, 2.6          # caixinha: largura, altura, profundidade
R = 0.6                            # raio dos cantos
Y_FUNDO = -0.25                    # fundo da caixinha (logo à frente da cartela)
Y_FRENTE = Y_FUNDO - D
ABA_W, ABA_H = 3.3, 2.1            # aba de pendurar
FURO_W, FURO_H = 1.7, 0.52
Z_FURO = H / 2 + 1.28
Z_CABECA = Z_FURO + 3.0            # cabeça do gancho
# quadro da câmera, medido no plano do fundo da caixinha
QX0, QX1 = -6.0, 7.2
QZ0, QZ1 = -H / 2 - 1.8, Z_CABECA + 1.2
CAM = (40.0, 34.0)                 # câmera acima e à direita, de longe: aparecem a tampa e a lateral
DIST = 160.0


def limpar():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = 40 if RASCUNHO else 160
    s.cycles.use_denoising = True
    s.cycles.max_bounces = 10
    s.cycles.transparent_max_bounces = 16
    s.cycles.glossy_bounces = 6
    s.cycles.caustics_reflective = False
    s.cycles.caustics_refractive = False
    s.cycles.sample_clamp_indirect = 6.0
    s.render.film_transparent = True
    s.render.threads_mode = 'AUTO'
    s.view_settings.view_transform = 'Standard'
    s.view_settings.look = 'None'
    s.render.image_settings.file_format = 'OPEN_EXR'
    s.render.image_settings.color_mode = 'RGBA'
    s.render.image_settings.color_depth = '32'
    return s


def mat(nome):
    m = bpy.data.materials.new(nome)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    return m, nt, nt.nodes.new('ShaderNodeOutputMaterial')


def novo_obj(nome, mesh):
    o = bpy.data.objects.new(nome, mesh)
    bpy.context.scene.collection.objects.link(o)
    return o


def suavizar(me, angulo=0.7):
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=angulo)
    except Exception:
        pass


def ret_arredondado(w, h, r, seg=10, cx=0.0, cz=0.0):
    pts = []
    for (ox, oz, a0) in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + ox + r * math.cos(a), cz + oz + r * math.sin(a)))
    return pts


# ---------------------------------------------------------------- materiais
def ruido_bump(nt, escala, forca, distorcao=0.0, detalhe=2.0):
    tc = nt.nodes.new('ShaderNodeTexCoord')
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = escala
    n.inputs['Detail'].default_value = detalhe
    n.inputs['Distortion'].default_value = distorcao
    nt.links.new(tc.outputs['Object'], n.inputs['Vector'])
    b = nt.nodes.new('ShaderNodeBump')
    b.inputs['Strength'].default_value = forca
    b.inputs['Distance'].default_value = 0.1
    nt.links.new(n.outputs['Fac'], b.inputs['Height'])
    return b


def mat_plastico_parede():
    """Paredes da caixinha: acrílico tingido — mais transparente de frente, mais
    fechado de lado — com verniz e a microtextura do plástico injetado."""
    m, nt, out = mat('plastico_parede')
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = (0.5, 0.5, 0.5, 1)
    p.inputs['Roughness'].default_value = 0.12
    p.inputs['IOR'].default_value = 1.5
    p.inputs['Specular IOR Level'].default_value = 0.8
    p.inputs['Coat Weight'].default_value = 1.0
    p.inputs['Coat Roughness'].default_value = 0.04
    b1 = ruido_bump(nt, 70.0, 0.04)
    b2 = ruido_bump(nt, 1.4, 0.06, distorcao=1.0)
    nt.links.new(b1.outputs['Normal'], b2.inputs['Normal'])
    nt.links.new(b2.outputs['Normal'], p.inputs['Normal'])
    nt.links.new(b2.outputs['Normal'], p.inputs['Coat Normal'])
    t = nt.nodes.new('ShaderNodeBsdfTransparent')
    lw = nt.nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.35
    alfa = nt.nodes.new('ShaderNodeMapRange')
    alfa.inputs['To Min'].default_value = 0.46
    alfa.inputs['To Max'].default_value = 0.92
    nt.links.new(lw.outputs['Facing'], alfa.inputs['Value'])
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(alfa.outputs['Result'], mix.inputs['Fac'])
    nt.links.new(t.outputs[0], mix.inputs[1])
    nt.links.new(p.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs['Surface'])
    return m


def mat_plastico_frente():
    """Frente da caixinha: filme transparente que só aparece no reflexo."""
    m, nt, out = mat('plastico_frente')
    g = nt.nodes.new('ShaderNodeBsdfGlossy')
    g.inputs['Roughness'].default_value = 0.035
    b = ruido_bump(nt, 0.35, 0.035, distorcao=1.0, detalhe=1.0)   # filme levemente ondulado
    nt.links.new(b.outputs['Normal'], g.inputs['Normal'])
    t = nt.nodes.new('ShaderNodeBsdfTransparent')
    lw = nt.nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.12
    nt.links.new(b.outputs['Normal'], lw.inputs['Normal'])
    ramp = nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Min'].default_value = 0.0
    ramp.inputs['From Max'].default_value = 1.0
    ramp.inputs['To Min'].default_value = 0.03
    ramp.inputs['To Max'].default_value = 0.75
    nt.links.new(lw.outputs['Fresnel'], ramp.inputs['Value'])
    mix = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(ramp.outputs['Result'], mix.inputs['Fac'])
    nt.links.new(t.outputs[0], mix.inputs[1])
    nt.links.new(g.outputs[0], mix.inputs[2])
    # véu bem leve do próprio plástico
    d = nt.nodes.new('ShaderNodeBsdfDiffuse')
    d.inputs['Color'].default_value = (0.7, 0.7, 0.7, 1)
    mix2 = nt.nodes.new('ShaderNodeMixShader')
    mix2.inputs['Fac'].default_value = 0.018
    nt.links.new(mix.outputs[0], mix2.inputs[1])
    nt.links.new(d.outputs[0], mix2.inputs[2])
    nt.links.new(mix2.outputs[0], out.inputs['Surface'])
    return m


def mat_cromado():
    m, nt, out = mat('cromado')
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = (0.86, 0.88, 0.91, 1)
    p.inputs['Metallic'].default_value = 1.0
    p.inputs['Roughness'].default_value = 0.16
    b = ruido_bump(nt, 220.0, 0.012)       # escovado finíssimo, só pra quebrar o espelho perfeito
    nt.links.new(b.outputs['Normal'], p.inputs['Normal'])
    nt.links.new(p.outputs[0], out.inputs['Surface'])
    return m


def mat_emissor(nome, cor, forca):
    m, nt, out = mat(nome)
    e = nt.nodes.new('ShaderNodeEmission')
    e.inputs['Color'].default_value = (*cor, 1)
    e.inputs['Strength'].default_value = forca
    nt.links.new(e.outputs[0], out.inputs['Surface'])
    return m


# ---------------------------------------------------------------- objetos
def fazer_caixinha():
    perfil = ret_arredondado(W, H, R)
    bm = bmesh.new()
    tras = [bm.verts.new((x, Y_FUNDO, z)) for x, z in perfil]
    frente = [bm.verts.new((x, Y_FRENTE, z)) for x, z in perfil]
    n = len(perfil)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((tras[i], tras[j], frente[j], frente[i]))
    tampa = bm.faces.new(frente)
    bm.normal_update()
    if tampa.normal.y > 0:
        tampa.normal_flip()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    borda = [e for e in tampa.edges]
    bmesh.ops.bevel(bm, geom=borda, offset=0.26, segments=5, profile=0.5, affect='EDGES')
    bm.faces.ensure_lookup_table()
    maior = max(bm.faces, key=lambda f: f.calc_area() if abs(f.normal.y) > 0.99 else 0)
    me = bpy.data.meshes.new('caixinha')
    bm.to_mesh(me)
    bm.free()
    o = novo_obj('caixinha', me)
    me.materials.append(mat_plastico_parede())
    me.materials.append(mat_plastico_frente())
    idx = max(range(len(me.polygons)), key=lambda i: me.polygons[i].area if abs(me.polygons[i].normal.y) > 0.99 else 0)
    me.polygons[idx].material_index = 1
    suavizar(me)
    sol = o.modifiers.new('espessura', 'SOLIDIFY')
    sol.thickness = 0.07
    sol.offset = -1
    return o


def fazer_aba():
    """Aba de pendurar: chapa de plástico com o furo comprido, saindo do fundo."""
    cu = bpy.data.curves.new('aba', 'CURVE')
    cu.dimensions = '2D'
    cu.fill_mode = 'BOTH'
    cu.extrude = 0.045
    cu.bevel_depth = 0.035
    cu.bevel_resolution = 3
    z0, z1 = H / 2 - 0.5, H / 2 + ABA_H
    fora = ret_arredondado(ABA_W, z1 - z0, 0.62, cz=(z0 + z1) / 2)
    furo = ret_arredondado(FURO_W, FURO_H, FURO_H / 2 - 0.001, cz=Z_FURO)[::-1]
    for pts in (fora, furo):
        sp = cu.splines.new('POLY')
        sp.points.add(len(pts) - 1)
        for p, (x, z) in zip(sp.points, pts):
            p.co = (x, z, 0, 1)
        sp.use_cyclic_u = True
    o = bpy.data.objects.new('aba', cu)
    bpy.context.scene.collection.objects.link(o)
    o.rotation_euler = (math.radians(90), 0, 0)
    o.location = (0, Y_FUNDO - 0.06, 0)
    cu.materials.append(mat_plastico_parede())
    return o


def fazer_gancho():
    cromo = mat_cromado()
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=0.6, location=(0, -0.56, Z_CABECA))
    cab = bpy.context.active_object
    cab.name = 'gancho_cabeca'
    cab.scale = (1, 0.92, 1)
    suavizar(cab.data, 3.0)
    cab.data.materials.append(cromo)
    cu = bpy.data.curves.new('haste', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 0.23
    cu.bevel_resolution = 8
    cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER')
    pts = [
        ((0, -0.55, Z_CABECA - 0.2), (0, -0.6, Z_CABECA - 1.0)),
        ((0, -0.95, Z_FURO + 0.75), (0, -0.98, Z_FURO + 0.35)),
        ((0, -0.62, Z_FURO - 0.02), (0, -0.4, Z_FURO - 0.05)),
        ((0, -0.05, Z_FURO + 0.12), (0, 0.1, Z_FURO + 0.2)),
    ]
    sp.bezier_points.add(len(pts) - 1)
    for bp, (co, hr) in zip(sp.bezier_points, pts):
        bp.co = co
        bp.handle_right = hr
        bp.handle_left = tuple(2 * c - h for c, h in zip(co, hr))
    sp.resolution_u = 24
    h = bpy.data.objects.new('gancho_haste', cu)
    bpy.context.scene.collection.objects.link(h)
    cu.materials.append(cromo)
    return [cab, h]


def plano(nome, cx, cz, w, h, y):
    bm = bmesh.new()
    vs = [bm.verts.new((cx + sx * w / 2, y, cz + sz * h / 2)) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bm.faces.new(vs)
    me = bpy.data.meshes.new(nome)
    bm.to_mesh(me)
    bm.free()
    o = novo_obj(nome, me)
    m, nt, out = mat(nome + '_mat')
    d = nt.nodes.new('ShaderNodeBsdfDiffuse')
    d.inputs['Color'].default_value = (0.5, 0.5, 0.5, 1)
    nt.links.new(d.outputs[0], out.inputs['Surface'])
    me.materials.append(m)
    return o


def luzes():
    s = bpy.context.scene
    w = bpy.data.worlds.new('estudio')
    s.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Incoming'], sep.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -0.6
    mr.inputs['From Max'].default_value = 0.8
    mr.inputs['To Min'].default_value = 0.03
    mr.inputs['To Max'].default_value = 0.6
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], bg.inputs['Strength'])
    bg.inputs['Color'].default_value = (0.92, 0.95, 1.0, 1)
    nt.links.new(bg.outputs[0], out.inputs['Surface'])

    def area(nome, loc, alvo, tam, forca, cor=(1, 1, 1), tam_y=None):
        l = bpy.data.lights.new(nome, 'AREA')
        l.energy = forca
        l.color = cor
        l.size = tam
        if tam_y:
            l.shape = 'RECTANGLE'
            l.size_y = tam_y
        o = bpy.data.objects.new(nome, l)
        s.collection.objects.link(o)
        o.location = loc
        o.rotation_euler = (Vector(alvo) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        return o

    # luz principal: de cima, à esquerda e à frente (sombra cai pra direita e pra baixo)
    area('principal', (-13, -24, 22), (0, 0, 1), 8, 5600, (1.0, 0.98, 0.95))
    # preenchimento frio pela direita, fraco
    area('preenche', (20, -26, 4), (0, 0, 0), 16, 900, (0.85, 0.92, 1.0))
    # contraluz rasante por cima: acende as quinas
    area('quina', (2, -6, 26), (0, -1.5, 4), 8, 1500).data.use_shadow = False

    # faixas de luz que só aparecem no reflexo do plástico (os riscos de brilho na frente)
    def faixa(nome, cx, cz, larg, comp, giro, forca, y=None):
        o = plano(nome, 0, 0, larg, comp, 0)
        o.location = (cx, -DIST - 0.25 if y is None else y, cz)
        o.rotation_euler = (0, math.radians(giro), 0)
        o.data.materials.clear()
        o.data.materials.append(mat_emissor(nome, (1, 1, 1), forca))
        o.visible_camera = False
        o.visible_diffuse = False
        o.visible_shadow = False
        o.visible_transmission = False
        return o

    # (o reflexo de um ponto (x, z) da frente cai em (2x - CAM.x, 2z - CAM.z) lá atrás da câmera)
    cx, cz = -CAM[0], -CAM[1]
    faixa('faixa1', cx - 3.4, cz, 2.4, 90, 30, 9.0)
    faixa('faixa2', cx + 0.6, cz, 0.7, 90, 30, 7.0)
    faixa('faixa3', cx + 7.2, cz - 4.0, 1.1, 90, 30, 4.0)
    # a parede atrás também reflete: clara por cima (tampa), escura do lado (lateral)
    faixa('parede_cima', 0, H / 2 + 14, 60, 28, 0, 1.1, y=0.02)
    faixa('parede_lado', 20, -8, 30, 30, 0, 0.22, y=0.02)


def camera(res_x):
    s = bpy.context.scene
    c = bpy.data.cameras.new('cam')
    o = bpy.data.objects.new('cam', c)
    s.collection.objects.link(o)
    s.camera = o
    qw, qh = QX1 - QX0, QZ1 - QZ0
    o.location = (CAM[0], Y_FUNDO - DIST, CAM[1])
    o.rotation_euler = (math.radians(90), 0, 0)
    c.sensor_fit = 'HORIZONTAL'
    c.sensor_width = 36
    c.lens = 36 * DIST / qw
    c.shift_x = ((QX0 + QX1) / 2 - CAM[0]) / qw
    c.shift_y = ((QZ0 + QZ1) / 2 - CAM[1]) / qw
    c.clip_start, c.clip_end = 1, 400
    s.render.resolution_x = res_x
    s.render.resolution_y = round(res_x * qh / qw)
    s.render.resolution_percentage = 100
    return o


def na_tela(p):
    s = bpy.context.scene
    v = world_to_camera_view(s, s.camera, Vector(p))
    return round(v.x * 100, 3), round((1 - v.y) * 100, 3)


# ---------------------------------------------------------------- pós: EXR linear -> PNG/WebP com transparência
def oetf(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def ler_exr(caminho):
    img = bpy.data.images.load(caminho)
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1]


def para_rgba(px):
    """Linear pré-multiplicado -> sRGB com alfa reto. Brilho que passa do que o
    alfa comporta (reflexo sobre parte transparente) vira branco por cima."""
    lp, a = px[..., :3], np.clip(px[..., 3:4], 0, 1)
    s = np.clip(lp / np.maximum(a, 1e-5), 0, 1)
    e = np.clip(lp - a * s, 0, None)
    emax = e.max(axis=-1, keepdims=True)
    hl = oetf(emax)
    ce = np.where(emax > 1e-6, e / np.maximum(emax, 1e-6), 1.0)
    cb = oetf(s)
    ao = hl + a * (1 - hl)
    co = (ce * hl + cb * a * (1 - hl)) / np.maximum(ao, 1e-5)
    return np.concatenate([np.clip(co, 0, 1), np.clip(ao, 0, 1)], axis=-1)


def salvar(rgba, nome, qualidade=92, largura=None):
    """Guarda o PNG inteiro em TMP e o WebP do site (reduzido pra `largura`, se vier)."""
    from PIL import Image
    os.makedirs(SAIDA, exist_ok=True)
    im = Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA' if rgba.shape[-1] == 4 else 'RGB')
    im.save(os.path.join(TMP, nome + '.png'))
    if largura and im.width > largura:
        im = im.resize((largura, round(im.height * largura / im.width)), Image.LANCZOS)
    im.save(os.path.join(SAIDA, nome + '.webp'), 'WEBP', quality=qualidade, method=6, alpha_quality=90)
    return im


def renderizar(nome):
    s = bpy.context.scene
    os.makedirs(TMP, exist_ok=True)
    s.render.filepath = os.path.join(TMP, nome + '.exr')
    bpy.ops.render.render(write_still=True)
    return ler_exr(s.render.filepath)


# ---------------------------------------------------------------- cenas
def cena_pendurado(qual):
    """caixinha = só o plástico; sombra = a sombra que a caixinha faz na cartela;
    gancho = o gancho e a sombra dele (na cartela e na aba)."""
    s = limpar()
    luzes()
    camera(330 if RASCUNHO else 660)
    caixa, aba, gancho = fazer_caixinha(), fazer_aba(), fazer_gancho()
    cartela = plano('cartela', 0, 0, 80, 80, -0.06)
    if qual == 'caixinha':
        cartela.hide_render = True
        for o in gancho:
            o.hide_render = True
    elif qual == 'sombra':
        cartela.is_shadow_catcher = True
        for o in (caixa, aba):
            o.visible_camera = False
        for o in gancho:
            o.hide_render = True
    else:
        cartela.is_shadow_catcher = True
        caixa.hide_render = True
        aba.is_shadow_catcher = True      # a sombra da haste em cima da aba
    if qual == 'sombra' and not RASCUNHO:
        # sombra é borrada: metade do tamanho basta (e o render sai 4x mais rápido)
        s.render.resolution_percentage = 50
        s.cycles.samples = 128
    if qual == 'gancho':
        # só o pedaço de cima do quadro tem gancho
        s.render.use_border = True
        s.render.border_min_x, s.render.border_max_x = 0.28, 0.66
        s.render.border_min_y, s.render.border_max_y = 0.66, 1.0
    px = para_rgba(renderizar(qual))
    if qual != 'caixinha':
        px[..., 3] = np.clip((px[..., 3] - 0.035) / 0.965, 0, 1)      # tira o véu do apanhador de sombra
    if qual == 'sombra':
        h, w = px.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w]
        borda = np.minimum.reduce([xx, w - 1 - xx, h - 1 - yy]) / (0.07 * w)   # some antes de chegar na beirada
        px[..., 3] *= np.clip(borda, 0, 1) ** 1.5
        px[..., :3] = 0
    # renderiza em 660 px e entrega em 528 (2x do quadro de 264 px): mais nítido e mais leve
    salvar(px, qual, qualidade=80 if qual == 'sombra' else 84, largura=528)
    if qual == 'caixinha':
        cantos = {
            'quadro_px': [round((QX1 - QX0) * PX, 2), round((QZ1 - QZ0) * PX, 2)],
            'frente': [*na_tela((-W / 2, Y_FRENTE, H / 2)), *na_tela((W / 2, Y_FRENTE, -H / 2))],
            'fundo': [*na_tela((-W / 2, Y_FUNDO, H / 2)), *na_tela((W / 2, Y_FUNDO, -H / 2))],
            'furo': list(na_tela((0, Y_FUNDO, Z_FURO))),
            'cabeca': list(na_tela((0, -0.5, Z_CABECA))),
            'topo_aba': list(na_tela((0, Y_FUNDO, H / 2 + ABA_H))),
        }
        with open(os.path.join(SAIDA, 'medidas.json'), 'w') as f:
            json.dump(cantos, f, indent=1)
        print('MEDIDAS', json.dumps(cantos))


# ---------------------------------------------------------------- painel perfurado
PASSO = 2.1            # distância entre furos (42 px)
N_FUROS = 6            # o azulejo tem 6 x 6 furos (252 px) e repete sem emenda
RAIO_FURO = 0.33
ESP_PAINEL = 0.2


def ruido_periodico(nt, voltas, detalhe=2.0, rugosidade=0.55):
    """Ruído que fecha nas quatro beiradas do azulejo: as coordenadas x e z
    viram dois círculos (4 dimensões), então o desenho emenda sozinho."""
    lado = PASSO * N_FUROS
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Position'], sep.inputs[0])

    def onda(saida, fn):
        m = nt.nodes.new('ShaderNodeMath')
        m.operation = 'MULTIPLY'
        m.inputs[1].default_value = 2 * math.pi / lado
        nt.links.new(saida, m.inputs[0])
        t = nt.nodes.new('ShaderNodeMath')
        t.operation = fn
        nt.links.new(m.outputs[0], t.inputs[0])
        r = nt.nodes.new('ShaderNodeMath')
        r.operation = 'MULTIPLY'
        r.inputs[1].default_value = voltas
        nt.links.new(t.outputs[0], r.inputs[0])
        return r.outputs[0]

    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(onda(sep.outputs['X'], 'COSINE'), comb.inputs['X'])
    nt.links.new(onda(sep.outputs['X'], 'SINE'), comb.inputs['Y'])
    nt.links.new(onda(sep.outputs['Z'], 'COSINE'), comb.inputs['Z'])
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.noise_dimensions = '4D'
    n.inputs['Scale'].default_value = 1.0
    n.inputs['Detail'].default_value = detalhe
    n.inputs['Roughness'].default_value = rugosidade
    nt.links.new(comb.outputs[0], n.inputs['Vector'])
    nt.links.new(onda(sep.outputs['Z'], 'SINE'), n.inputs['W'])
    return n


def cena_painel():
    s = limpar()
    s.render.film_transparent = False
    lado = PASSO * N_FUROS
    folga = PASSO            # renderiza um furo a mais de cada lado e recorta o miolo
    # chapa com os furos (um a mais em volta), feita furo a furo pra borda sair redonda
    bm = bmesh.new()
    seg = 40
    tot = N_FUROS + 2
    x0 = -lado / 2 - folga
    for i in range(tot):
        for j in range(tot):
            cx, cz = x0 + (i + 0.5) * PASSO, x0 + (j + 0.5) * PASSO
            aro_f = [bm.verts.new((cx + RAIO_FURO * math.cos(2 * math.pi * k / seg), 0, cz + RAIO_FURO * math.sin(2 * math.pi * k / seg))) for k in range(seg)]
            aro_t = [bm.verts.new((v.co.x, ESP_PAINEL, v.co.z)) for v in aro_f]
            h = PASSO / 2
            quad = []
            for k in range(seg):          # contorno do quadrado da célula, na mesma ordem angular do furo
                a = 2 * math.pi * k / seg
                c, sn = math.cos(a), math.sin(a)
                t = h / max(abs(c), abs(sn))
                quad.append(bm.verts.new((cx + c * t, 0, cz + sn * t)))
            for k in range(seg):
                n = (k + 1) % seg
                bm.faces.new((quad[k], quad[n], aro_f[n], aro_f[k]))       # frente da chapa
                bm.faces.new((aro_f[k], aro_f[n], aro_t[n], aro_t[k]))     # parede de dentro do furo
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # câmera reta + chapa "deitada" na profundidade = mesma vista de cima e da direita da caixinha
    for v in bm.verts:
        v.co.x += CAM[0] / DIST * v.co.y
        v.co.z += CAM[1] / DIST * v.co.y
    me = bpy.data.meshes.new('painel')
    bm.to_mesh(me)
    bm.free()
    o = novo_obj('painel', me)
    for p in me.polygons:
        p.use_smooth = abs(p.normal.y) < 0.9
    bev = o.modifiers.new('quina', 'BEVEL')
    bev.width = 0.035
    bev.segments = 2
    bev.limit_method = 'ANGLE'
    bev.angle_limit = math.radians(50)

    m, nt, out = mat('eucatex')
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    p.inputs['Roughness'].default_value = 0.62
    p.inputs['Coat Weight'].default_value = 0.25
    p.inputs['Coat Roughness'].default_value = 0.35
    mancha = ruido_periodico(nt, 1.3, detalhe=3.0)
    cor = nt.nodes.new('ShaderNodeMix')
    cor.data_type = 'RGBA'
    cor.inputs['A'].default_value = (0.600, 0.235, 0.040, 1)
    cor.inputs['B'].default_value = (0.700, 0.300, 0.065, 1)
    nt.links.new(mancha.outputs['Fac'], cor.inputs['Factor'])
    nt.links.new(cor.outputs['Result'], p.inputs['Base Color'])
    fibra = ruido_periodico(nt, 26.0, detalhe=4.0, rugosidade=0.7)
    b = nt.nodes.new('ShaderNodeBump')
    b.inputs['Strength'].default_value = 0.22
    b.inputs['Distance'].default_value = 0.02
    nt.links.new(fibra.outputs['Fac'], b.inputs['Height'])
    nt.links.new(b.outputs['Normal'], p.inputs['Normal'])
    nt.links.new(p.outputs[0], out.inputs['Surface'])
    me.materials.append(m)

    # a parede clara atrás do painel: a luz que passa pelo furo acende um pedaço dela
    fundo = plano('parede', 0, 0, lado * 2, lado * 2, ESP_PAINEL + 0.1)
    fundo.data.materials[0].node_tree.nodes['Diffuse BSDF'].inputs['Color'].default_value = (0.86, 0.66, 0.40, 1)

    w = bpy.data.worlds.new('claro')
    s.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.42
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (1.0, 0.93, 0.84, 1)
    sol = bpy.data.lights.new('sol', 'SUN')
    sol.energy = 3.4
    sol.angle = math.radians(9)
    so = bpy.data.objects.new('sol', sol)
    s.collection.objects.link(so)
    so.rotation_euler = Vector((13, 24, -22)).to_track_quat('-Z', 'Y').to_euler()   # mesma direção da luz principal

    c = bpy.data.cameras.new('cam')
    co = bpy.data.objects.new('cam', c)
    s.collection.objects.link(co)
    s.camera = co
    c.type = 'ORTHO'
    c.ortho_scale = lado + 2 * folga
    co.location = (0, -50, 0)
    co.rotation_euler = (math.radians(90), 0, 0)
    px_azulejo = 252 if RASCUNHO else 504
    res = round(px_azulejo * (lado + 2 * folga) / lado)
    s.render.resolution_x = s.render.resolution_y = res
    s.cycles.samples = 48 if RASCUNHO else 192
    px = renderizar('painel')
    rgb = oetf(px[..., :3])
    m0 = (res - px_azulejo) // 2
    rgb = rgb[m0:m0 + px_azulejo, m0:m0 + px_azulejo]
    salvar(rgb, 'painel', qualidade=88)


if ALVO in ('painel', 'tudo'):
    cena_painel()
for nome in ('caixinha', 'sombra', 'gancho'):
    if ALVO in (nome, 'tudo', 'pendurado'):
        cena_pendurado(nome)
