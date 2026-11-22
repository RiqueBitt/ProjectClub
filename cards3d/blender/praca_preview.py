"""Cena completa: praça nevada + pista + heróis (pinguins do Club Penguin) + unidades.

    python praca_preview.py              # → ../preview/praca.png
    python praca_preview.py --rapido     # menor/mais rápido
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from PIL import Image  # noqa: E402

from pc3d import plaza, relief  # noqa: E402
from pc3d import lib  # noqa: E402
from pc3d.shapes import Mesh, rgba, vmat  # noqa: E402

SPR = os.path.join(HERE, "..", "sprites")
PREVIEW = os.path.join(HERE, "..", "preview")
TMP = "/tmp/pc3d"
os.makedirs(TMP, exist_ok=True)


def png(rel):
    dst = os.path.join(TMP, rel.replace("/", "_").replace(".webp", ".png"))
    if not os.path.exists(dst):
        Image.open(os.path.join(SPR, rel)).save(dst)
    return dst


def arco(name, x, y, frac=1.0):
    """Arco verde de vida sob a unidade (como na referência)."""
    m = Mesh()
    I = Matrix.Identity(4)
    R = 0.9
    n = 14
    for w, z, c in ((0.2, 0.0, "#0e4a1e"), (0.12, 0.012, "#46e052")):
        for i in range(n):
            a0 = math.radians(200 + 140 * i / n)
            a1 = math.radians(200 + 140 * (i + 1) / n)
            p0 = (x + R * math.cos(a0), y - 0.25 + R * 0.42 * math.sin(a0))
            p1 = (x + R * math.cos(a1), y - 0.25 + R * 0.42 * math.sin(a1))
            col = c if i / n <= frac else "#25402b"
            m.box(I, ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, 0.14 + z),
                  (math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * 1.06, w, 0.05), rgba(col),
                  rot=(0, 0, math.degrees(math.atan2(p1[1] - p0[1], p1[0] - p0[0]))))
    return m.to_object(name, vmat("arco", rough=0.4, emit=0.6))


def main(argv):
    rapido = "--rapido" in argv
    lib.reset()
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = (1280, 720) if rapido else (1600, 900)
    sc.view_settings.view_transform = "Standard"
    try:
        sc.eevee.taa_render_samples = 24 if rapido else 40
    except Exception:
        pass
    cen = plaza.build()
    plaza.ceu(sc)
    if "--glb" in argv:  # só a praça (sem personagens) pro jogo carregar
        os.makedirs(os.path.join(HERE, "..", "assets"), exist_ok=True)
        lib.export_glb(os.path.join(HERE, "..", "assets", "praca.glb"),
                       [o for o in bpy.context.scene.objects if o.type in ("MESH", "FONT")])

    # ---- heróis: o pinguim de cada jogador (arte original do Club Penguin)
    relief.build("heroi_oponente", png("heroi/amarelo_coroa.webp"), height=4.5, thickness=0.42, pos=(0, 7.3, 0.9), yaw=0)
    relief.build("heroi_jogador", png("pinguim/verde.webp"), height=2.3, thickness=0.5, pos=(-6.6, -3.7, 0.0), yaw=12)

    # ---- unidades nas fileiras (puffles e pinguins originais)
    opp = [(-4.0, "p", "roxo"), (-2.0, "f", "green"), (0.0, "p", "azul"), (2.0, "f", "pink"), (4.0, "p", "preto")]
    me = [(-4.0, "f", "blue"), (-2.0, "p", "vermelho"), (0.0, "f", "yellow"), (2.0, "p", "verde"), (4.0, "f", "white")]
    for side, rows, y in ((1, opp, 1.9), (0, me, -1.9)):
        for i, (x, kind, cor) in enumerate(rows):
            nome = f"u_{side}_{i}"
            if kind == "p":
                relief.build(nome, png(f"pinguim/{cor}.webp"), height=1.7, thickness=0.5, pos=(x, y, 0.1), yaw=0)
            else:
                relief.build(nome, png(f"puffle/{cor}.webp"), height=1.1, thickness=0.75, pos=(x, y, 0.1), yaw=0)
            arco(f"arco_{side}_{i}", x, y, frac=1.0 if i % 3 else 0.7)

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.lens = 27
    cam.location = Vector((0, -15.5, 7.2))
    cam.rotation_euler = (Vector((0, 4.4, 2.6)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    os.makedirs(PREVIEW, exist_ok=True)
    sc.render.filepath = os.path.join(PREVIEW, "praca.png")
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main(sys.argv[1:])
