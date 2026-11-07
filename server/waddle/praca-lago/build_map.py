"""Gera as tags que swf-patches.ts insere no 1º quadro do mapa (map.swf):
o ícone do Lago (arte do dono, art/icone.png) como símbolo exportado
"pc_lago_icon" (2 quadros: normal e com o mouse em cima) + um DoAction
(map.as, compilado pelo FFDec) que põe o ícone em MAP.id_0 e liga o clique.

Uso (ver README.md): python3 build_map.py → build/map-semscript.swf + build/map-scripts/;
depois o FFDec compila map.as e extract.py --map gera praca-lago-map-tags.ts.
"""
import os
import sys
import numpy as np
import cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import swfwriter as S

ICON_W = 100  # largura no mapa (px); a arte é 2x pra ficar nítida
CID = 60001   # ids altos pra não bater com os do mapa

img = Image.open(os.path.join(HERE, 'art', 'icone.png')).convert('RGBA')
scale = ICON_W / img.width
w, h = img.width, img.height

# área de clique = só a água do lago (o resto do ícone deixa o clique passar
# pro ícone da Floresta, que no mapa de 2015 é justamente esse laguinho)
a = np.array(img)
hsv = cv2.cvtColor(a[:, :, :3], cv2.COLOR_RGB2HSV)
hh, ss, vv = (hsv[:, :, i].astype(int) for i in range(3))
water = ((hh >= 92) & (hh <= 110) & (ss >= 150) & (vv >= 140) & (a[:, :, 3] > 128)).astype(np.uint8)
water = cv2.morphologyEx(water, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(water)
big = max(range(1, n), key=lambda i: st[i, cv2.CC_STAT_AREA])
cs, _ = cv2.findContours((lab == big).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
poly = cv2.approxPolyDP(max(cs, key=cv2.contourArea), 2.0, True).reshape(-1, 2).astype(float)
if 0.5 * float(np.dot(poly[:, 0], np.roll(poly[:, 1], -1)) - np.dot(poly[:, 1], np.roll(poly[:, 0], -1))) < 0:
    poly = poly[::-1]
HIT_POLY = [(float(x), float(y)) for x, y in poly]
# registro (0,0) do símbolo = centro da água, pra cair em cima do laguinho do mapa
m = cv2.moments((lab == big).astype(np.uint8))
lcx, lcy = m['m10'] / m['m00'], m['m01'] / m['m00']
cx, cy = -lcx * scale, -lcy * scale

tags = []
BMP = CID; tags.append(S.define_bits_lossless2(BMP, img))
SHAPE = CID + 1; tags.append(S.define_shape_bitmap(SHAPE, BMP, w, h))
# a área de clique é um símbolo à parte (pc_lago_hit), posto por cima do ícone
# em MAP.id_0: no Ruffle um filho do ícone não recebia o mouse
HIT_SHAPE = CID + 3; tags.append(S.define_shape_polys(HIT_SHAPE, [HIT_POLY], (0, 255, 0, 110)))
HIT = CID + 4; tags.append(S.define_sprite(HIT, [[S.place_object2(1, HIT_SHAPE, x=cx, y=cy, sx=scale, sy=scale)]]))
SPRITE = CID + 2
hover_s = scale * 1.08
hx, hy = -lcx * hover_s, -lcy * hover_s
frame1 = [S.place_object2(1, SHAPE, x=cx, y=cy, sx=scale, sy=scale)]
frame2 = [S.place_object2(1, SHAPE, x=hx, y=hy, sx=hover_s, sy=hover_s, move=True)]
tags.append(S.define_sprite(SPRITE, [frame1, frame2]))
tags.append(S.export_assets([(SPRITE, 'pc_lago_icon'), (HIT, 'pc_lago_hit')]))
tags.append(S.do_action_empty())

OUT = os.path.join(HERE, 'build'); os.makedirs(OUT, exist_ok=True)
data = S.swf(tags + [S.show_frame(), S.end()], 760, 480, fps=24, frames=1, version=8)
open(os.path.join(OUT, 'map-semscript.swf'), 'wb').write(data)
os.makedirs(os.path.join(OUT, 'map-scripts', 'frame_1'), exist_ok=True)
open(os.path.join(OUT, 'map-scripts', 'frame_1', 'DoAction.as'), 'w').write(open(os.path.join(HERE, 'map.as')).read())
print('build/map-semscript.swf', len(data), 'bytes; ícone %dx%d' % (ICON_W, round(h * scale)))
