"""Recorta o puffle de frente (quadro 1 do SWF original) de cada cor.

Entrada: <src>/<cor>/<cor>_01.png (renderizado do SWF do Club Penguin com o
Ruffle — ver README). Saída: sprites/puffle/<cor>.webp + manifest.json.
Os quadros do SWF só mudam por dentro de clipes aninhados, então usamos uma
imagem por cor e a animação (pulo, esmagar, balançar) é feita no jogo.
"""
import json, os, sys
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else "/tmp/shots/puffle"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sprites", "puffle")
os.makedirs(OUT, exist_ok=True)
man = {}
for color in sorted(os.listdir(SRC)):
    im = Image.open(f"{SRC}/{color}/{color}_01.png").convert("RGBA")
    b = im.getbbox()
    pad = 4
    im = im.crop((b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad))
    im.save(f"{OUT}/{color}.webp", "WEBP", quality=90, method=6)
    man[color] = {"file": f"{color}.webp", "w": im.width, "h": im.height}
    print(color, im.size, os.path.getsize(f"{OUT}/{color}.webp") // 1024, "KB")
json.dump(man, open(f"{OUT}/manifest.json", "w"), indent=1)
