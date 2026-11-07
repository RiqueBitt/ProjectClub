"""Gera as tags que swf-patches.ts insere no 1º quadro do mapa (map.swf): um ícone
clicável por entrada de icons.json (símbolos exportados pc_icon_<key> com 2 quadros,
normal e com o mouse em cima, + pc_hit_<key> com a área de clique) e o DoAction
(map.as, gerado daqui e compilado pelo FFDec) que põe tudo em MAP.id_0.

Ícones: "art" = arte própria do dono (ex.: o lago; área de clique = só a água);
sem "art" = art/icon-<key>.png, miniatura redonda da arte original da sala
(make_icons.py), área de clique = o círculo.

Uso (ver README.md): python3 build_map.py → build/map-semscript.swf + build/map-scripts/;
depois o FFDec compila e extract.py gera praca-lago-map-tags.ts.
"""
import json
import math
import os
import sys
import numpy as np
import cv2
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import swfwriter as S

icons = json.load(open(os.path.join(HERE, 'icons.json')))
CID = 60001  # ids altos pra não bater com os do mapa
tags = []
exports = []
table = []  # linhas do map.as


def water_poly(img):
    a = np.array(img)
    hsv = cv2.cvtColor(a[:, :, :3], cv2.COLOR_RGB2HSV)
    hh, ss, vv = (hsv[:, :, i].astype(int) for i in range(3))
    water = ((hh >= 92) & (hh <= 110) & (ss >= 150) & (vv >= 140) & (a[:, :, 3] > 128)).astype(np.uint8)
    water = cv2.morphologyEx(water, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(water)
    big = max(range(1, n), key=lambda i: st[i, cv2.CC_STAT_AREA])
    cs, _ = cv2.findContours((lab == big).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    poly = cv2.approxPolyDP(max(cs, key=cv2.contourArea), 2.0, True).reshape(-1, 2).astype(float)
    m = cv2.moments((lab == big).astype(np.uint8))
    return poly, (m['m10'] / m['m00'], m['m01'] / m['m00'])


def circle_poly(w, h):
    r = min(w, h) / 2 - 2
    cx, cy = w / 2, h / 2
    return np.array([(cx + r * math.cos(t), cy + r * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 28, endpoint=False)]), (cx, cy)


for ic in icons:
    key = ic['key']
    path = os.path.join(HERE, ic['art']) if ic.get('art') else os.path.join(HERE, 'art', f'icon-{key}.png')
    img = Image.open(path).convert('RGBA')
    w, h = img.size
    width = ic.get('width', w // 2)  # largura no mapa; a arte é 2x
    scale = width / w
    if ic.get('hit') == 'water':
        poly, (lcx, lcy) = water_poly(img)
    else:
        poly, (lcx, lcy) = circle_poly(w, h)
    # orientação: preenchimento à direita da aresta → horário na tela
    if 0.5 * float(np.dot(poly[:, 0], np.roll(poly[:, 1], -1)) - np.dot(poly[:, 1], np.roll(poly[:, 0], -1))) < 0:
        poly = poly[::-1]
    hit_poly = [(float(x), float(y)) for x, y in poly]
    cx, cy = -lcx * scale, -lcy * scale  # registro (0,0) = centro da área de clique
    hover_s = scale * 1.08
    hx, hy = -lcx * hover_s, -lcy * hover_s

    BMP = CID; tags.append(S.define_bits_lossless2(BMP, img)); CID += 1
    SHAPE = CID; tags.append(S.define_shape_bitmap(SHAPE, BMP, w, h)); CID += 1
    HIT_SHAPE = CID; tags.append(S.define_shape_polys(HIT_SHAPE, [hit_poly], (0, 255, 0, 110))); CID += 1
    HIT = CID; tags.append(S.define_sprite(HIT, [[S.place_object2(1, HIT_SHAPE, x=cx, y=cy, sx=scale, sy=scale)]])); CID += 1
    SPRITE = CID; CID += 1
    tags.append(S.define_sprite(SPRITE, [
        [S.place_object2(1, SHAPE, x=cx, y=cy, sx=scale, sy=scale)],
        [S.place_object2(1, SHAPE, x=hx, y=hy, sx=hover_s, sy=hover_s, move=True)],
    ]))
    exports += [(SPRITE, f'pc_icon_{key}'), (HIT, f'pc_hit_{key}')]
    table.append('   {key:"%s",x:%d,y:%d,room:"%s",sx:%d,sy:%d,hint:"%s"}' % (key, ic['x'], ic['y'], ic['room'], ic['spawn'][0], ic['spawn'][1], ic['hint']))
    print('%-8s %dx%d em (%d,%d) → %s' % (key, width, round(h * scale), ic['x'], ic['y'], ic['room']))

tags.append(S.export_assets(exports))
tags.append(S.do_action_empty())

MAP_AS = """// GERADO por build_map.py (de icons.json) — não editar à mão.
// Ícones de salas do Project Club no mapa: cada um vai pra MAP.id_0 (camada
// dos ícones base), com área de clique própria (pc_hit_*), dica e clique.
var __pcIcons = [
%s
];
var __pcHome = this.id_0 != undefined ? this.id_0 : this;
var __pcMake = function(ic)
{
   var icon = __pcHome.attachMovie("pc_icon_" + ic.key,"id_pc_" + ic.key,__pcHome.getNextHighestDepth());
   var hit = __pcHome.attachMovie("pc_hit_" + ic.key,"id_pc_" + ic.key + "_hit",__pcHome.getNextHighestDepth());
   if(icon == undefined || hit == undefined)
   {
      return undefined;
   }
   icon._x = ic.x;
   icon._y = ic.y;
   icon.gotoAndStop(1);
   hit._x = ic.x;
   hit._y = ic.y;
   hit._alpha = 0;
   hit.useHandCursor = true;
   hit.onRollOver = function()
   {
      icon.gotoAndStop(2);
      _global.getCurrentInterface().showHint(icon,ic.hint,0,28);
   };
   hit.onRollOut = function()
   {
      icon.gotoAndStop(1);
      _global.getCurrentInterface().closeHint();
   };
   hit.onReleaseOutside = hit.onRollOut;
   hit.onRelease = function()
   {
      icon.gotoAndStop(1);
      var _shell = _global.getCurrentShell();
      _global.getCurrentInterface().closeHint();
      _shell.sendHideQuestUI();
      _shell.sendJoinRoomFromMap(ic.room,ic.sx,ic.sy,0,90,90);
      _shell.showMapLegendAnimation = null;
      _root.close();
   };
};
var __pcI = 0;
while(__pcI < __pcIcons.length)
{
   __pcMake(__pcIcons[__pcI]);
   __pcI = __pcI + 1;
}
""" % ',\n'.join(table)

OUT = os.path.join(HERE, 'build'); os.makedirs(OUT, exist_ok=True)
data = S.swf(tags + [S.show_frame(), S.end()], 760, 480, fps=24, frames=1, version=8)
open(os.path.join(OUT, 'map-semscript.swf'), 'wb').write(data)
os.makedirs(os.path.join(OUT, 'map-scripts', 'frame_1'), exist_ok=True)
open(os.path.join(OUT, 'map-scripts', 'frame_1', 'DoAction.as'), 'w').write(MAP_AS)
open(os.path.join(HERE, 'map.as'), 'w').write(MAP_AS)
print('build/map-semscript.swf', len(data), 'bytes;', len(icons), 'ícones')
