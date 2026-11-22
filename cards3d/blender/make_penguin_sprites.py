"""Pinguim ORIGINAL do Club Penguin (SWF `penguin_no_shadow`, renderizado com o Ruffle)
sem o aro azul do chão e recolorido pras cores de pinguim da Praça
(`player_colors.json`). Uso: python make_penguin_sprites.py <render.png> <player_colors.json> <saida>
"""
import colorsys, json, os, sys
import numpy as np
from PIL import Image

src, colors_json, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
im = Image.open(src).convert("RGBA")
a = np.asarray(im).astype(np.float32)
rgb, al = a[..., :3], a[..., 3]
# 1) tira o aro azul claro do chão (cor ~ #3399ff)
ring = np.array([51, 153, 255], np.float32)
d = np.linalg.norm(rgb - ring, axis=-1)
al = np.where(d < 70, 0, al)
a[..., 3] = al
Image.fromarray(a.astype(np.uint8), "RGBA")  # (conferência)
# recorta
box = Image.fromarray(a.astype(np.uint8), "RGBA").getbbox()
pad = 6
box = (box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad)
a = a[box[1]:box[3], box[0]:box[2]]
rgb, al = a[..., :3] / 255.0, a[..., 3]
# 2) corpo = pixels de matiz azul e saturação alta
mx, mn = rgb.max(-1), rgb.min(-1)
sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
hue = np.zeros_like(mx)
dl = np.maximum(mx - mn, 1e-6)
hue = np.where(mx == b, (4 + (r - g) / dl) / 6, np.where(mx == g, (2 + (b - r) / dl) / 6, ((g - b) / dl % 6) / 6))
body = (hue > 0.55) & (hue < 0.72) & (sat > 0.35)
V0 = 0.67  # valor do azul principal
names = {1: "azul", 2: "verde", 3: "rosa", 4: "preto", 5: "vermelho", 6: "laranja", 7: "amarelo", 8: "roxo",
         9: "marrom", 10: "salmao", 11: "verde-escuro", 12: "ciano", 13: "lima", 14: "cinza", 15: "turquesa",
         16: "creme", 17: "lilas"}
cfg = json.load(open(colors_json))
man = {}
for k, name in names.items():
    h = cfg[str(k)]
    t = np.array([(int(h, 16) >> 16) & 255, (int(h, 16) >> 8) & 255, int(h, 16) & 255], np.float32) / 255.0
    ratio = (mx / V0)[..., None]
    new = np.clip(t[None, None, :] * ratio, 0, 1)
    o = np.where(body[..., None], new, rgb)
    res = np.dstack([o, al / 255.0])
    Image.fromarray((res * 255).astype(np.uint8), "RGBA").save(f"{out}/{name}.webp", "WEBP", quality=92, method=6)
    man[name] = {"hex": h, "file": f"{name}.webp"}
json.dump(man, open(f"{out}/manifest.json", "w"), indent=1)
print(len(man), "cores,", a.shape[1], "x", a.shape[0])
