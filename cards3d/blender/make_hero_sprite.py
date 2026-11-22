"""Pinguim do jogador (cor da Praça) + item de cabeça original do Club Penguin.

    python make_hero_sprite.py <pinguim.webp> <item.png> <saida.webp> [escala=0.5] [base_y=80]

`item.png` = papel do item (clothing/paper/<id>.swf) renderizado com o Ruffle
na mesma densidade do pinguim (10 px por unidade do palco).
"""
import sys
from PIL import Image

base = Image.open(sys.argv[1]).convert("RGBA")
item = Image.open(sys.argv[2]).convert("RGBA")
item = item.crop(item.getbbox())
scale = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
base_y = int(sys.argv[5]) if len(sys.argv) > 5 else 80
item = item.resize((round(item.width * scale), round(item.height * scale)), Image.LANCZOS)
top = base_y - item.height
shift = max(0, -top)
W = max(base.width, item.width)
canvas = Image.new("RGBA", (W, base.height + shift), (0, 0, 0, 0))
canvas.alpha_composite(base, ((W - base.width) // 2, shift))
canvas.alpha_composite(item, ((W - item.width) // 2, top + shift))
canvas.crop(canvas.getbbox()).save(sys.argv[3], "WEBP", quality=92, method=6)
print(canvas.size)
