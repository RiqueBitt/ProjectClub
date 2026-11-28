"""Pódio do Ranking em 3D — três blocos de metal (ouro, prata e bronze) com o
número em relevo na frente.

Tudo aqui é modelado por código e renderizado no Blender (Cycles): nenhuma
imagem vem de gerador de imagem. O resultado sai com fundo transparente em
client/public/progresso/ e a página de Progresso põe os avatares por cima
(styles/progress.css):

  podio.webp     os três blocos + a sombra deles no chão
  medidas.json   onde fica o topo de cada bloco dentro da imagem (em %), pro CSS
  medalhao.webp  medalhão de metal visto de frente, em CINZA (a cor de cada
                 raridade/nível é aplicada no CSS) + a sombra dele

Uso:  python tools/progresso-3d/render.py [podio|medalhao|tudo] [--rascunho]
(precisa do módulo bpy — `pip install bpy` — e do Pillow)
"""
import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.normpath(os.path.join(AQUI, '..', '..', 'client', 'public', 'progresso'))
TMP = os.environ.get('PODIO3D_TMP', '/tmp/p3d')
RASCUNHO = '--rascunho' in sys.argv
_args = [x for x in sys.argv[1:] if not x.startswith('--')]
ALVO = _args[0] if _args else 'tudo'
FONTE = os.environ.get('PODIO3D_FONTE', '/usr/share/fonts/opentype/inter/InterDisplay-Black.otf')

# ---------------------------------------------------------------- medidas
W, D = 5.0, 4.4                    # largura e profundidade de cada bloco
VAO = 0.34                         # espaço entre os blocos
R = 0.55                           # raio dos cantos (visto de cima)
ALTURA = {1: 5.5, 2: 3.9, 3: 2.9}  # 1º no meio, 2º à esquerda, 3º à direita
X = {1: 0.0, 2: -(W + VAO), 3: W + VAO}
COR = {                            # cor do metal (linear)
    1: (1.00, 0.58, 0.10),
    2: (0.76, 0.80, 0.88),
    3: (0.90, 0.40, 0.17),
}
# quadro: largura total com folga pra sombra; a câmera olha um pouco de cima
QX = 9.3
CAM_Y, CAM_Z, ALVO_Z = -62.0, 17.0, 2.35
Z_BAIXO, Z_CIMA = -1.25, ALTURA[1] + 1.55


def limpar():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = 48 if RASCUNHO else 144
    s.cycles.use_denoising = True
    s.cycles.max_bounces = 8
    s.cycles.glossy_bounces = 6
    s.cycles.caustics_reflective = False
    s.cycles.caustics_refractive = False
    s.cycles.sample_clamp_indirect = 6.0
    s.render.film_transparent = True
    s.render.threads_mode = 'AUTO'
    s.view_settings.view_transform = 'Standard'
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


def novo_obj(nome, dados):
    o = bpy.data.objects.new(nome, dados)
    bpy.context.scene.collection.objects.link(o)
    return o


def suavizar(me, angulo=0.6):
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=angulo)
    except Exception:
        pass


# ---------------------------------------------------------------- materiais
def mat_metal(nome, cor, rugosidade, escovado=0.0, pe_escuro=0.0):
    """Metal acetinado. `escovado` > 0 põe riscos finos na horizontal (o
    escovado do bloco); o número fica liso e mais polido. `pe_escuro` > 0
    escurece o metal perto do chão (o bloco "assenta" em vez de flutuar)."""
    m, nt, out = mat(nome)
    p = nt.nodes.new('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = (*cor, 1)
    if pe_escuro > 0:
        tc0 = nt.nodes.new('ShaderNodeTexCoord')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(tc0.outputs['Object'], sep.inputs[0])
        mr = nt.nodes.new('ShaderNodeMapRange')
        mr.interpolation_type = 'SMOOTHSTEP'
        mr.inputs['From Min'].default_value = 0.0
        mr.inputs['From Max'].default_value = 2.8
        mr.inputs['To Min'].default_value = 1.0 - pe_escuro
        mr.inputs['To Max'].default_value = 1.0
        nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
        mx = nt.nodes.new('ShaderNodeVectorMath')
        mx.operation = 'SCALE'
        mx.inputs[0].default_value = cor
        nt.links.new(mr.outputs['Result'], mx.inputs['Scale'])
        nt.links.new(mx.outputs['Vector'], p.inputs['Base Color'])
    p.inputs['Metallic'].default_value = 1.0
    p.inputs['Roughness'].default_value = rugosidade
    if escovado > 0:
        tc = nt.nodes.new('ShaderNodeTexCoord')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (0.35, 0.35, 60.0)   # esticado na horizontal
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = 3.0
        n.inputs['Detail'].default_value = 3.0
        nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
        nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
        b = nt.nodes.new('ShaderNodeBump')
        b.inputs['Strength'].default_value = escovado
        b.inputs['Distance'].default_value = 0.02
        nt.links.new(n.outputs['Fac'], b.inputs['Height'])
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
def contorno(w, d, r, seg=12):
    pts = []
    for (ox, oy, a0) in ((w / 2 - r, d / 2 - r, 0), (-w / 2 + r, d / 2 - r, 90), (-w / 2 + r, -d / 2 + r, 180), (w / 2 - r, -d / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts


def fazer_bloco(lugar):
    h = ALTURA[lugar]
    bm = bmesh.new()
    base = [bm.verts.new((x, y, 0)) for x, y in contorno(W, D, R)]
    face = bm.faces.new(base)
    ret = bmesh.ops.extrude_face_region(bm, geom=[face])
    bmesh.ops.translate(bm, vec=(0, 0, h), verts=[v for v in ret['geom'] if isinstance(v, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(f'bloco{lugar}')
    bm.to_mesh(me)
    bm.free()
    o = novo_obj(f'bloco{lugar}', me)
    o.location = (X[lugar], 0, 0)
    # quina de cima arredondada (pega luz) — só nas arestas vivas
    bv = o.modifiers.new('quina', 'BEVEL')
    bv.width = 0.2
    bv.segments = 6
    bv.limit_method = 'ANGLE'
    bv.angle_limit = math.radians(50)
    suavizar(me, 0.9)
    me.materials.append(mat_metal(f'metal{lugar}', COR[lugar], 0.26, escovado=0.06, pe_escuro=0.42))
    return o


def fazer_numero(lugar):
    """Número em relevo na frente do bloco, mais polido e mais claro que ele."""
    h = ALTURA[lugar]
    cu = bpy.data.curves.new(f'num{lugar}', 'FONT')
    cu.body = str(lugar)
    try:
        cu.font = bpy.data.fonts.load(FONTE)
    except Exception:
        pass                                   # sem a fonte, vai a padrão do Blender
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.size = {1: 3.5, 2: 2.9, 3: 2.45}[lugar]
    cu.extrude = 0.11
    cu.bevel_depth = 0.035
    cu.bevel_resolution = 3
    cu.resolution_u = 16
    o = novo_obj(f'num{lugar}', cu)
    o.rotation_euler = (math.radians(90), 0, 0)
    o.location = (X[lugar], -D / 2 - 0.1, h / 2)
    # centraliza pelo desenho do número (a caixa da fonte sobra embaixo)
    bpy.context.view_layer.update()
    bb = [Vector(c) for c in o.bound_box]
    cx = (min(v.x for v in bb) + max(v.x for v in bb)) / 2
    cy = (min(v.y for v in bb) + max(v.y for v in bb)) / 2
    o.location.x -= cx
    o.location.z -= cy
    escuro = tuple(c * 0.5 for c in COR[lugar])
    cu.materials.append(mat_metal(f'polido{lugar}', escuro, 0.18))
    return o


def plano(nome, loc, tam_x, tam_y, rot=(0, 0, 0)):
    bm = bmesh.new()
    vs = [bm.verts.new((sx * tam_x / 2, sy * tam_y / 2, 0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    bm.faces.new(vs)
    me = bpy.data.meshes.new(nome)
    bm.to_mesh(me)
    bm.free()
    o = novo_obj(nome, me)
    o.location = loc
    o.rotation_euler = rot
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
    bg.inputs['Color'].default_value = (0.75, 0.82, 1.0, 1)
    bg.inputs['Strength'].default_value = 0.05
    nt.links.new(bg.outputs[0], out.inputs['Surface'])

    def area(nome, loc, alvo, tam, forca, cor=(1, 1, 1), tam_y=None, sombra=True):
        l = bpy.data.lights.new(nome, 'AREA')
        l.energy = forca
        l.color = cor
        l.size = tam
        if tam_y:
            l.shape = 'RECTANGLE'
            l.size_y = tam_y
        l.use_shadow = sombra
        o = novo_obj(nome, l)
        o.location = loc
        o.rotation_euler = (Vector(alvo) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        return o

    # principal: de cima, à esquerda e à frente — acende os topos e dá a sombra pra direita
    area('principal', (-12, -16, 24), (0, 0, 2), 14, 4200, (1.0, 0.97, 0.92))
    # preenchimento frio pela direita
    area('preenche', (22, -22, 8), (0, 0, 2), 18, 800, (0.82, 0.90, 1.0), sombra=False)
    # contraluz por trás e por cima: risca as quinas de cima
    area('contra', (4, 16, 20), (0, 0, 4), 16, 2600, (1.0, 0.98, 0.96), sombra=False)

    # cartões de luz que só aparecem no reflexo do metal (a câmera não vê)
    def cartao(nome, loc, tam_x, tam_y, alvo, forca, cor=(1, 1, 1)):
        o = plano(nome, loc, tam_x, tam_y)
        o.rotation_euler = (Vector(alvo) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        o.data.materials.append(mat_emissor(nome, cor, forca))
        o.visible_camera = False
        o.visible_shadow = False
        o.visible_diffuse = False
        return o

    # A frente dos blocos é um espelho fosco: como a câmera olha de cima, ela
    # reflete o que está ATRÁS e ABAIXO da câmera (z de -19 a -8, mais ou menos).
    # Três faixas, da mais clara (em cima) pra mais escura: o degradê da frente.
    yb = CAM_Y - 8
    cartao('frente_clara', (0, yb, -9.0), 110, 5.0, (0, 0, 2), 2.7, (1.0, 0.97, 0.92))
    cartao('frente_media', (0, yb, -13.5), 110, 4.0, (0, 0, 2), 1.15, (1.0, 0.98, 0.95))
    cartao('frente_escura', (0, yb, -19.5), 110, 8.0, (0, 0, 2), 0.34, (0.9, 0.94, 1.0))
    # risco de brilho na diagonal, atravessando as três frentes
    risco = cartao('risco', (-3.0, yb + 0.5, -13.0), 2.6, 60, (-3.0, 0, 2), 7.5)
    risco.rotation_euler.rotate_axis('Z', math.radians(-32))
    # O topo reflete o que está lá atrás, acima dos blocos: uma parede clara.
    cartao('fundo', (0, 40, 13), 130, 13, (0, 0, 4), 1.45, (1.0, 0.99, 0.97))
    # teto: acende as quinas arredondadas
    cartao('teto', (0, -4, 40), 70, 50, (0, 0, 0), 1.1)


def camera(res_x):
    s = bpy.context.scene
    c = bpy.data.cameras.new('cam')
    o = novo_obj('cam', c)
    s.camera = o
    o.location = (0, CAM_Y, CAM_Z)
    alvo = Vector((0, 0, ALVO_Z))
    o.rotation_euler = (alvo - o.location).to_track_quat('-Z', 'Y').to_euler()
    dist = (alvo - o.location).length
    c.sensor_fit = 'HORIZONTAL'
    c.sensor_width = 36
    c.lens = 36 * dist / (2 * QX)
    c.clip_start, c.clip_end = 1, 400
    s.render.resolution_x = res_x
    s.render.resolution_y = res_x      # provisório: o quadro certo sai das medidas abaixo
    s.render.resolution_percentage = 100
    bpy.context.view_layer.update()    # sem isso a câmera ainda está na origem na conta abaixo
    # altura do quadro: do chão à frente (com a sombra) até acima do topo do 1º
    baixo = world_to_camera_view(s, o, Vector((0, -D / 2 - 1.2, Z_BAIXO)))
    cima = world_to_camera_view(s, o, Vector((0, D / 2, Z_CIMA)))
    # com resolução quadrada, v vai de 0 a 1 na mesma escala de u; recorta a faixa usada
    v0, v1 = baixo.y, cima.y
    alt = v1 - v0
    c.shift_y = ((v0 + v1) / 2 - 0.5)
    s.render.resolution_y = round(res_x * alt)
    return o


def na_tela(p):
    s = bpy.context.scene
    v = world_to_camera_view(s, s.camera, Vector(p))
    return round(v.x * 100, 3), round((1 - v.y) * 100, 3)


# ---------------------------------------------------------------- pós: EXR linear -> WebP com transparência
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
    """Linear pré-multiplicado -> sRGB com alfa reto."""
    lp, a = px[..., :3], np.clip(px[..., 3:4], 0, 1)
    cor = oetf(np.clip(lp / np.maximum(a, 1e-5), 0, 1))
    return np.concatenate([cor, a], axis=-1)


def salvar(rgba, nome, largura, qualidade=90):
    from PIL import Image
    os.makedirs(SAIDA, exist_ok=True)
    im = Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), 'RGBA')
    im.save(os.path.join(TMP, nome + '.png'))
    if im.width > largura:
        im = im.resize((largura, round(im.height * largura / im.width)), Image.LANCZOS)
    im.save(os.path.join(SAIDA, nome + '.webp'), 'WEBP', quality=qualidade, method=6, alpha_quality=92)
    return im


def cena_podio():
    s = limpar()
    for lugar in (1, 2, 3):
        fazer_bloco(lugar)
        fazer_numero(lugar)
    chao = plano('chao', (0, 0, 0), 80, 80)
    chao.is_shadow_catcher = True
    luzes()
    camera(800 if RASCUNHO else 1600)
    bpy.context.view_layer.update()

    medidas = {'_': 'posições em % da imagem (x a partir da esquerda, y a partir de cima)', 'blocos': {}}
    for lugar in (1, 2, 3):
        x, h = X[lugar], ALTURA[lugar]
        cx, cy = na_tela((x, 0, h))                      # meio do topo
        _, y_frente = na_tela((x, -D / 2, h))            # quina da frente do topo
        _, y_fundo = na_tela((x, D / 2, h))              # quina de trás do topo
        x0, _ = na_tela((x - W / 2, -D / 2, h))
        x1, _ = na_tela((x + W / 2, -D / 2, h))
        _, y_chao = na_tela((x, -D / 2, 0))
        medidas['blocos'][str(lugar)] = {
            'x': cx, 'topo': cy, 'topo_frente': y_frente, 'topo_fundo': y_fundo,
            'esquerda': x0, 'direita': x1, 'chao': y_chao,
        }

    os.makedirs(TMP, exist_ok=True)
    s.render.filepath = os.path.join(TMP, 'podio.exr')
    bpy.ops.render.render(write_still=True)
    im = salvar(para_rgba(ler_exr(s.render.filepath)), 'podio', 800 if RASCUNHO else 1280)
    medidas['proporcao'] = round(s.render.resolution_x / s.render.resolution_y, 4)
    medidas['largura'], medidas['altura'] = im.size
    with open(os.path.join(SAIDA, 'medidas.json'), 'w') as f:
        json.dump(medidas, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print('PODIO-OK', im.size, json.dumps(medidas['blocos']))


# ---------------------------------------------------------------- medalhão
def cena_medalhao():
    """Medalhão redondo visto de frente: aro alto, um friso e o miolo rebaixado
    (onde entra o ícone). Sai em cinza neutro: o CSS pinta com a cor que quiser
    usando o claro/escuro daqui (background-blend-mode: luminosity)."""
    s = limpar()
    s.cycles.samples = 48 if RASCUNHO else 192
    # perfil (raio, altura) girado em volta do eixo Z
    perfil = [(0.0, 0.20), (1.30, 0.20), (1.36, 0.215), (1.40, 0.26), (1.43, 0.30), (1.47, 0.26), (1.50, 0.23),
              (1.56, 0.25), (1.62, 0.33), (1.68, 0.40), (1.76, 0.44), (1.84, 0.43), (1.92, 0.37), (1.97, 0.27),
              (2.00, 0.14), (2.00, 0.0)]
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0, z)) for r, z in perfil]
    es = [bm.edges.new((vs[i], vs[i + 1])) for i in range(len(vs) - 1)]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=160, use_duplicate=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('medalhao')
    bm.to_mesh(me)
    bm.free()
    o = novo_obj('medalhao', me)
    suavizar(me, 1.2)
    me.materials.append(mat_metal('metal_medalhao', (0.62, 0.62, 0.62), 0.28, escovado=0.0))

    chao = plano('chao', (0, 0, 0), 30, 30)
    chao.is_shadow_catcher = True

    w = bpy.data.worlds.new('estudio')
    s.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = (0.8, 0.86, 1.0, 1)
    bg.inputs['Strength'].default_value = 0.12
    nt.links.new(bg.outputs[0], out.inputs['Surface'])

    def area(nome, loc, alvo, tam, forca, sombra=True):
        l = bpy.data.lights.new(nome, 'AREA')
        l.energy = forca
        l.size = tam
        l.use_shadow = sombra
        ob = novo_obj(nome, l)
        ob.location = loc
        ob.rotation_euler = (Vector(alvo) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        return ob

    # luz de cima e da esquerda (na tela): aro claro em cima/esquerda, sombra pra baixo/direita
    area('principal', (-5.5, 6.5, 9), (0, 0, 0), 6, 760)
    area('preenche', (6, -5, 7), (0, 0, 0), 10, 160, sombra=False)

    def cartao(nome, loc, tam_x, tam_y, forca):
        c = plano(nome, loc, tam_x, tam_y)
        c.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        c.data.materials.append(mat_emissor(nome, (1, 1, 1), forca))
        c.visible_camera = False
        c.visible_shadow = False
        c.visible_diffuse = False
        return c

    # o miolo é um espelho fosco virado pra câmera: reflete o que está em volta dela
    cartao('alto', (-7, 9, 16), 26, 16, 1.05)       # claro em cima/esquerda
    cartao('meio', (3, -2, 20), 20, 16, 0.36)
    cartao('baixo', (8, -10, 14), 22, 14, 0.08)    # escuro embaixo/direita

    c = bpy.data.cameras.new('cam')
    cam = novo_obj('cam', c)
    s.camera = cam
    cam.location = (0.22, -0.22, 20)               # o quadro sobra um pouco pro lado da sombra
    c.type = 'ORTHO'
    c.ortho_scale = 4.9
    res = 192 if RASCUNHO else 512
    s.render.resolution_x = s.render.resolution_y = res
    s.render.resolution_percentage = 100
    bpy.context.view_layer.update()

    os.makedirs(TMP, exist_ok=True)
    s.render.filepath = os.path.join(TMP, 'medalhao.exr')
    bpy.ops.render.render(write_still=True)
    im = salvar(para_rgba(ler_exr(s.render.filepath)), 'medalhao', 192 if RASCUNHO else 384, qualidade=92)
    cx, cy = na_tela((0, 0, 0.2))
    r0, _ = na_tela((1.30, 0, 0.2))
    print('MEDALHAO-OK', im.size, 'centro', cx, cy, 'miolo raio %', round(r0 - cx, 2))


if ALVO in ('podio', 'tudo'):
    cena_podio()
if ALVO in ('medalhao', 'tudo'):
    cena_medalhao()
