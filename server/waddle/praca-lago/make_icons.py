"""Ícones redondos pro mapa a partir da arte ORIGINAL de cada sala (art/renders/<key>.png,
o 1º quadro da sala exportado pelo FFDec), no estilo dos ícones circulares do mapa de
2015: miniatura dentro de um círculo com borda branca e sombra. Saída: art/icon-<key>.png
(2x, 96 px → 48 px no mapa). Uso: python3 make_icons.py
"""
import json
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
icons = json.load(open(os.path.join(HERE, 'icons.json')))
D = 80  # diâmetro (2x) → 40 px no mapa
for ic in icons:
    if ic.get('art'):
        continue  # arte própria (ex.: o lago do dono)
    key = ic['key']
    src = Image.open(os.path.join(HERE, 'art', 'renders', f'{key}.png')).convert('RGB')
    # recorte quadrado no ponto de interesse da sala (centro por padrão)
    cx, cy = ic.get('focus', [380, 240])
    size = ic.get('zoom', 300)
    box = (max(0, cx - size // 2), max(0, cy - size // 2))
    box = (min(box[0], src.width - size), min(box[1], src.height - size))
    crop = src.crop((box[0], box[1], box[0] + size, box[1] + size)).resize((D - 8, D - 8), Image.LANCZOS)
    out = Image.new('RGBA', (D + 8, D + 8), (0, 0, 0, 0))
    # sombra
    sh = Image.new('RGBA', out.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((6, 8, D + 2, D + 4), fill=(0, 0, 0, 110))
    sh = sh.filter(ImageFilter.GaussianBlur(3))
    out.alpha_composite(sh)
    # borda branca + contorno escuro (como os ícones do mapa)
    ImageDraw.Draw(out).ellipse((3, 3, D + 3, D + 3), fill=(255, 255, 255, 255), outline=(40, 60, 90, 255), width=2)
    mask = Image.new('L', crop.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, crop.width - 1, crop.height - 1), fill=255)
    out.paste(crop, (7, 7), mask)
    out.save(os.path.join(HERE, 'art', f'icon-{key}.png'))
    print(key, out.size)
