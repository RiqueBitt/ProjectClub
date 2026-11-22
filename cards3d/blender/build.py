"""Gera os modelos da Guerra das Cartas 3D.

    python build.py                 # todas as criaturas → ../assets/units/<slug>.glb
    python build.py lobo-brasa      # só uma
    python build.py --preview a b   # também renderiza prévias em ../preview/

Roda com o Blender como módulo Python (`pip install bpy`) ou com
`blender -b -P build.py -- ...`.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from pc3d import creatures, lib, recipes  # noqa: E402

OUT = os.path.join(HERE, "..", "assets", "units")
PREVIEW = os.path.join(HERE, "..", "preview")


def all_recipes():
    out = dict(recipes.R)
    for el, r in recipes.ELEMENTALS.items():
        out[f"elemental-{el.lower()}"] = r
    return out


def render_preview(slug, arm, clip="idle", frame=None, size=384):
    """Foto de conferência (não vai pro jogo)."""
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = size
    sc.render.resolution_y = size
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.85, 0.95, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    sc.world = world
    bpy.ops.mesh.primitive_plane_add(size=20)
    ground = bpy.context.active_object
    ground.data.materials.append(lib.mat("chao", "#7cc45a", rough=1))
    for t in arm.animation_data.nla_tracks:
        t.mute = True
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.location, pb.rotation_euler, pb.scale = (0, 0, 0), (0, 0, 0), (1, 1, 1)
    body = arm.children[0]
    h = max(v.co.z for v in body.data.vertices)
    w = max(max(abs(v.co.x), abs(v.co.y)) for v in body.data.vertices) * 2
    span = max(h, w)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.lens = 60
    target = Vector((0, 0, h * 0.48))
    cam.location = target + Vector((span * 1.3, -span * 2.3, span * 0.85))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sun = bpy.data.objects.new("sol", bpy.data.lights.new("sol", "SUN"))
    sc.collection.objects.link(sun)
    sun.data.energy = 2.6
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    # põe a animação pedida
    if clip:
        act = bpy.data.actions.get(clip)
        arm.animation_data.action = act
        for t in arm.animation_data.nla_tracks:
            t.mute = True
        sc.frame_set(int(frame if frame is not None else 1))
    os.makedirs(PREVIEW, exist_ok=True)
    sc.render.filepath = os.path.join(PREVIEW, f"{slug}{'' if clip in ('idle', None) else '_' + clip}.png")
    bpy.ops.render.render(write_still=True)


def main(argv):
    preview = "--preview" in argv
    names = [a for a in argv if not a.startswith("--")]
    table = all_recipes()
    todo = names or sorted(table)
    os.makedirs(OUT, exist_ok=True)
    for slug in todo:
        arm, body = creatures.build(table[slug])
        path = os.path.join(OUT, f"{slug}.glb")
        lib.export_glb(path, [arm])
        tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
        print(f"[ok] {slug}: {os.path.getsize(path) // 1024} KB, ~{tris} tris", flush=True)
        if preview:
            lib.add_outline(body, 0.02 * table[slug].get("h", 1.0))
            render_preview(slug, arm)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    main(args)
