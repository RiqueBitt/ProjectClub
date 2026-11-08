"""Ícones redondos pro mapa a partir da arte ORIGINAL de cada sala, no estilo dos
ícones do mapa de 2015 (miniatura num círculo com borda branca grossa e sombra).

art/renders/<key>.png = a sala renderizada no Ruffle em 2x (1520×960), como no jogo
(sem as camadas de gatilho/bloqueio, que são invisíveis). focus/zoom em icons.json
estão em coordenadas 1x da sala (760×480). Saída: art/icon-<key>.png em 2x.
Uso: python3 make_icons.py
"""
import json
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
icons = json.load(open(os.path.join(HERE, 'icons.json')))
D = 92      # diâmetro da miniatura (2x) → 46 px no mapa
RING = 7    # borda branca (2x)
PAD = 10    # espaço pra sombra
for ic in icons:
    if ic.get('art'):
        continue  # arte própria (ex.: o lago do dono)
    key = ic['key']
    src = Image.open(os.path.join(HERE, 'art', 'renders', f'{key}.png')).convert('RGB')
    s2 = src.width / 760  # render está em 2x
    cx, cy = (v * s2 for v in ic.get('focus', [380, 240]))
    size = ic.get('zoom', 260) * s2
    x0 = int(min(max(0, cx - size / 2), src.width - size)); y0 = int(min(max(0, cy - size / 2), src.height - size))
    crop = src.crop((x0, y0, int(x0 + size), int(y0 + size))).resize((D, D), Image.LANCZOS)
    crop = crop.filter(ImageFilter.UnsharpMask(radius=1, percent=60, threshold=2))
    W = D + 2 * RING + 2 * PAD
    out = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    sh = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((PAD + 1, PAD + 4, W - PAD + 1, W - PAD + 4), fill=(20, 40, 70, 120))
    out.alpha_composite(sh.filter(ImageFilter.GaussianBlur(4)))
    ring = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse((PAD, PAD, W - PAD, W - PAD), fill=(255, 255, 255, 255), outline=(52, 78, 110, 255), width=2)
    out.alpha_composite(ring)
    mask = Image.new('L', (D, D), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, D - 1, D - 1), fill=255)
    out.paste(crop, (PAD + RING, PAD + RING), mask)
    # brilho suave em cima (como os ícones do mapa)
    gloss = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(gloss).ellipse((PAD + RING + 10, PAD + RING + 4, W - PAD - RING - 10, PAD + RING + D * 0.45), fill=(255, 255, 255, 46))
    out.alpha_composite(gloss)
    out.save(os.path.join(HERE, 'art', f'icon-{key}.png'))
    print(key, out.size)
