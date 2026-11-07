"""Gera lago.swf (sala "Lago" do Project Club) a partir da arte do dono.

Camadas:
  background_mc  cena inteira (JPEG) + cachoeira animada (8 quadros)
  foreground_mc  só a água do lago, semi-transparente, por CIMA dos pinguins
                 (o engine põe foreground_mc na profundidade 900001) → o
                 pinguim "entra embaixo da água"
  block_mc       vetor com tudo que NÃO dá pra andar (hitTest do engine)
  triggers_mc    forest_mc (escada, topo-esquerda) e cove_mc (trilha, direita)

Uso (ver README.md): python3 build.py → build/lago-semscript.swf + build/scripts/;
depois o FFDec compila lago.as pra dentro: lago.swf.
"""
import os
import sys
import numpy as np
import cv2
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import swfwriter as S

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 760, 480

# ---------- cena (arte do dono, já em 760x480: art/cena.png) ----------
SRC = os.environ.get('LAGO_SRC', os.path.join(HERE, 'art', 'cena.png'))
src = Image.open(SRC).convert('RGBA')
if src.size != (W, H):  # arte original 1672x941: escala pela altura e corta 25px da esquerda
    scale = H / src.height
    src = src.resize((round(src.width * scale), H), Image.LANCZOS).crop((25, 0, 25 + W, H))
scene = src.convert('RGB')
a = np.array(scene)
hsv = cv2.cvtColor(a, cv2.COLOR_RGB2HSV)
h, s, v = (hsv[:, :, i].astype(int) for i in range(3))

# ---------- água do lago ----------
water = ((h >= 92) & (h <= 110) & (s >= 170) & (v >= 150)).astype(np.uint8)
water[:110, :] = 0
water = cv2.morphologyEx(water, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
water = cv2.morphologyEx(water, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
n, lab = cv2.connectedComponents(water)
lake = (lab == lab[300, 400]).astype(np.uint8)
inv = 1 - lake
n2, lab2, st, _ = cv2.connectedComponentsWithStats(inv)
for i in range(1, n2):
    if st[i, cv2.CC_STAT_AREA] < 600:
        lake[lab2 == i] = 1

# ---------- onde dá pra andar ----------
dark = v < 75
green = (h >= 30) & (h <= 90) & (s >= 70) & (v >= 60)
rock = (s < 70) & (v < 190) & (~dark)
snow = (s < 70) & (v >= 190)
snowshade = (h >= 95) & (h <= 125) & (s >= 20) & (s < 170) & (v >= 170)
wood = (h >= 5) & (h <= 25) & (s >= 90)
walk = (((snow | snowshade | wood) & ~dark & ~green & ~rock) | (lake == 1)).astype(np.uint8)
walk[:100, :] = 0
walk = cv2.morphologyEx(walk, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
n, lab = cv2.connectedComponents(walk)
walk = (lab == lab[300, 400]).astype(np.uint8)
walk = cv2.morphologyEx(walk, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
inv = 1 - walk
n2, lab2, st, _ = cv2.connectedComponentsWithStats(inv)
for i in range(1, n2):
    if st[i, cv2.CC_STAT_AREA] < 800:
        walk[lab2 == i] = 1
# escada (topo-esquerda) e deque (embaixo-esquerda): têm linhas escuras, entram na mão
STAIRS = np.array([[95, 142], [172, 122], [78, 36], [34, 54]], np.int32)
DOCK = np.array([[28, 352], [182, 352], [200, 368], [200, 402], [40, 412], [22, 392]], np.int32)
cv2.fillPoly(walk, [STAIRS], 1)
cv2.fillPoly(walk, [DOCK], 1)
# o pinguim precisa chegar nos gatilhos: topo da escada e borda direita
cv2.fillPoly(walk, [np.array([[30, 30], [80, 30], [80, 60], [30, 60]], np.int32)], 1)
walk[205:310, 735:760] = 1
walk = cv2.morphologyEx(walk, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

block = (1 - walk).astype(np.uint8)
OUT = os.path.join(HERE, 'build'); os.makedirs(OUT, exist_ok=True)
cv2.imwrite(os.path.join(OUT, 'bloqueio.png'), block * 255)

# ---------- cachoeira ----------
m = ((h >= 92) & (h <= 110) & (s >= 120) & (v >= 150)).astype(np.uint8)
m[:, :570] = 0; m[:, 720:] = 0; m[165:, :] = 0
n, lab, st, _ = cv2.connectedComponentsWithStats(m)
big = max(range(1, n), key=lambda i: st[i, cv2.CC_STAT_AREA])
wf = cv2.morphologyEx((lab == big).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
x, y, w, hh = st[big, 0] - 4, st[big, 1] - 4, st[big, 2] + 8, st[big, 3] + 8
crop = a[y:y + hh, x:x + w].astype(np.float32)
mk = wf[y:y + hh, x:x + w]
mk_in = cv2.erode(mk, np.ones((7, 7), np.uint8))
b0, b1 = 22, hh - 26
L = b1 - b0
band = np.zeros_like(mk_in); band[b0:b1, :] = 1
soft = cv2.GaussianBlur((mk_in * band).astype(np.float32), (9, 9), 0)[:, :, None]
A = crop[b0:b1]
fill = cv2.inpaint(A.astype(np.uint8), (1 - mk_in[b0:b1]).astype(np.uint8), 5, cv2.INPAINT_TELEA).astype(np.float32)
NF = 8
wf_frames = []
rows = np.arange(L)[:, None, None].astype(np.float32)
for k in range(NF):
    sh = int(round(k * L / NF))
    c1 = np.roll(fill, sh, axis=0); c2 = np.roll(fill, sh + L // 2, axis=0)
    d = (rows - sh) % L
    w1 = np.minimum(d, L - d) / (L / 2)
    out = crop.copy(); out[b0:b1] = c1 * w1 + c2 * (1 - w1)
    out = crop * (1 - soft) + out * soft
    wf_frames.append(Image.fromarray(np.dstack([out.astype(np.uint8), (mk * 255).astype(np.uint8)]), 'RGBA'))
WF_X, WF_Y, WF_W, WF_H = int(x), int(y), int(w), int(hh)

# ---------- água em cima dos pinguins ----------
alpha = cv2.GaussianBlur(lake.astype(np.float32), (5, 5), 0)
WATER_ALPHA = 0.62
water_img = Image.fromarray(np.dstack([a, (alpha * 255 * WATER_ALPHA).astype(np.uint8)]), 'RGBA')
ys, xs = np.where(lake > 0)
wx0, wy0, wx1, wy1 = int(xs.min()) - 4, int(ys.min()) - 4, int(xs.max()) + 5, int(ys.max()) + 5
wx0, wy0 = max(0, wx0), max(0, wy0); wx1, wy1 = min(W, wx1), min(H, wy1)
water_img = water_img.crop((wx0, wy0, wx1, wy1))


# ---------- vetorização do bloqueio ----------
def signed_area(p):
    x = p[:, 0]; y = p[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def polys_from_mask(mask, eps=1.2):
    cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    polys = []
    for i, c in enumerate(cs):
        ap = cv2.approxPolyDP(c, eps, True).reshape(-1, 2).astype(float)
        if len(ap) < 3 or abs(signed_area(ap)) < 4:
            continue
        hole = hier[0][i][3] != -1
        # Flash: preenchimento à DIREITA da aresta → contorno externo horário
        # na tela (área com sinal > 0 em y pra baixo), buraco anti-horário.
        sa = signed_area(ap)
        if (not hole and sa < 0) or (hole and sa > 0):
            ap = ap[::-1]
        polys.append([(float(px), float(py)) for px, py in ap])
    return polys


block_polys = polys_from_mask(block)
print('bloqueio: %d polígonos, %d vértices' % (len(block_polys), sum(len(p) for p in block_polys)))

FOREST_TRIG = [(30, 28), (84, 28), (84, 62), (30, 62)]        # topo da escada
COVE_TRIG = [(742, 205), (760, 205), (760, 310), (742, 310)]  # trilha da direita

# ---------- SWF ----------
tags = []
cid = 1
BG_BMP = cid; tags.append(S.define_bits_jpeg2(BG_BMP, scene, 92)); cid += 1
BG_SHAPE = cid; tags.append(S.define_shape_bitmap(BG_SHAPE, BG_BMP, W, H)); cid += 1
wf_shapes = []
for fr in wf_frames:
    bid = cid; tags.append(S.define_bits_lossless2(bid, fr)); cid += 1
    sid = cid; tags.append(S.define_shape_bitmap(sid, bid, WF_W, WF_H)); cid += 1
    wf_shapes.append(sid)
WF_SPRITE = cid; cid += 1
frames = []
for i, sid in enumerate(wf_shapes):
    frames.append([S.place_object2(1, sid, move=(i > 0))])
    frames.append([])  # segura 2 quadros (12 fps)
tags.append(S.define_sprite(WF_SPRITE, frames))
BG_SPRITE = cid; cid += 1
tags.append(S.define_sprite(BG_SPRITE, [[S.place_object2(1, BG_SHAPE), S.place_object2(2, WF_SPRITE, name='waterfall_mc', x=WF_X, y=WF_Y)]]))

WATER_BMP = cid; tags.append(S.define_bits_jpeg3(WATER_BMP, water_img, 92)); cid += 1
WATER_SHAPE = cid; tags.append(S.define_shape_bitmap(WATER_SHAPE, WATER_BMP, water_img.width, water_img.height)); cid += 1
FG_SPRITE = cid; cid += 1
tags.append(S.define_sprite(FG_SPRITE, [[S.place_object2(1, WATER_SHAPE, name='water_mc', x=wx0, y=wy0)]]))

BLOCK_SHAPE = cid; tags.append(S.define_shape_polys(BLOCK_SHAPE, block_polys, (255, 0, 0, 128))); cid += 1
BLOCK_SPRITE = cid; cid += 1
tags.append(S.define_sprite(BLOCK_SPRITE, [[S.place_object2(1, BLOCK_SHAPE)]]))

FOREST_SHAPE = cid; tags.append(S.define_shape_polys(FOREST_SHAPE, [FOREST_TRIG], (0, 255, 0, 128))); cid += 1
COVE_SHAPE = cid; tags.append(S.define_shape_polys(COVE_SHAPE, [COVE_TRIG], (0, 255, 0, 128))); cid += 1
FOREST_SPR = cid; cid += 1; tags.append(S.define_sprite(FOREST_SPR, [[S.place_object2(1, FOREST_SHAPE)]]))
COVE_SPR = cid; cid += 1; tags.append(S.define_sprite(COVE_SPR, [[S.place_object2(1, COVE_SHAPE)]]))
TRIG_SPRITE = cid; cid += 1
tags.append(S.define_sprite(TRIG_SPRITE, [[S.place_object2(1, FOREST_SPR, name='forest_mc'), S.place_object2(2, COVE_SPR, name='cove_mc')]]))

# linha do tempo principal (mesmas profundidades das salas originais)
tags.append(S.place_object2(1, BG_SPRITE, name='background_mc'))
tags.append(S.place_object2(149, FG_SPRITE, name='foreground_mc'))
tags.append(S.place_object2(155, TRIG_SPRITE, name='triggers_mc'))
tags.append(S.place_object2(161, BLOCK_SPRITE, name='block_mc'))
tags.append(S.do_action_empty())
tags.append(S.show_frame())
tags.append(S.end())

data = S.swf(tags, W, H, fps=24, frames=1, version=8, bg=(0, 0, 0))
open(os.path.join(OUT, 'lago-semscript.swf'), 'wb').write(data)
print('build/lago-semscript.swf', len(data), 'bytes')

os.makedirs(os.path.join(OUT, 'scripts', 'frame_1'), exist_ok=True)
open(os.path.join(OUT, 'scripts', 'frame_1', 'DoAction.as'), 'w').write(open(os.path.join(HERE, 'lago.as')).read())

# prévia das camadas
prev = np.array(scene).astype(float)
prev[block == 1] = prev[block == 1] * 0.5 + np.array([255, 0, 0]) * 0.5
cv2.fillPoly(prev, [np.array(FOREST_TRIG, np.int32), np.array(COVE_TRIG, np.int32)], (0, 255, 0))
Image.fromarray(prev.astype(np.uint8)).save(os.path.join(OUT, 'previa.png'))
