"""Monta a arena + puffles do Club Penguin e renderiza fotos de conferência.

    python arena_preview.py            # → ../preview/arena_tatica.png e arena_cena.png
    python arena_preview.py --glb      # também exporta ../assets/arena.glb (só o tabuleiro)
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from pc3d import arena, lib  # noqa: E402

SPR = os.path.join(HERE, "..", "sprites", "puffle")
PREVIEW = os.path.join(HERE, "..", "preview")

# (lado, faixa, cor do puffle)
ELENCO = [
    (0, 0, "blue"), (0, 1, "red"), (0, 3, "yellow"), (0, 4, "white"),
    (1, 0, "green"), (1, 2, "pink"), (1, 3, "purple"), (1, 4, "black"),
]


def cena(size=(1280, 720)):
    lib.reset()
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = size
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    try:
        sc.eevee.taa_render_samples = 32
    except Exception:
        pass
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.5, 0.42, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.4
    sc.world = w
    sun = bpy.data.objects.new("sol", bpy.data.lights.new("sol", "SUN"))
    sc.collection.objects.link(sun)
    sun.data.energy = 2.2
    sun.rotation_euler = (math.radians(48), math.radians(8), math.radians(18))
    return sc


def camera(sc, loc, target, lens):
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.lens = lens
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    return cam


def render(path):
    os.makedirs(PREVIEW, exist_ok=True)
    bpy.context.scene.render.filepath = os.path.join(PREVIEW, path)
    bpy.ops.render.render(write_still=True)


def main(argv):
    sc = cena()
    info = arena.build(seed=7)
    if "--glb" in argv:  # só o tabuleiro (sem bonecos) pro jogo carregar
        os.makedirs(os.path.join(HERE, "..", "assets"), exist_ok=True)
        lib.export_glb(os.path.join(HERE, "..", "assets", "arena.glb"), [o for o in bpy.context.scene.objects if o.type == "MESH"])
    png = {}
    for _, _, c in ELENCO:
        # o Blender lê PNG sem surpresa; converte o WebP uma vez
        dst = f"/tmp/pc3d_{c}.png"
        if not os.path.exists(dst):
            from PIL import Image
            Image.open(os.path.join(SPR, f"{c}.webp")).save(dst)
        png[c] = dst
    for side, i, c in ELENCO:
        arena.standee(f"puffle_{side}_{i}", png[c], info["slots"][(side, i)] + Vector((0, -0.05 if side == 0 else 0.05, 0)),
                      height=1.15, tilt=14)

    camera(sc, (0, -9.2, 8.8), (0, 0.15, 0.2), 38)
    render("arena_tatica.png")
    if "--rapido" in argv:
        return
    for o in list(sc.objects):
        if o.name == "cam":
            bpy.data.objects.remove(o)
    camera(sc, (-2.2, -6.1, 1.5), (0.4, 0.4, 0.7), 34)
    render("arena_cena.png")


if __name__ == "__main__":
    main(sys.argv[1:])
