import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
from PIL import Image
from pc3d import lib, relief
lib.reset()
S = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sprites")
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"; sc.render.resolution_x = 1400; sc.render.resolution_y = 560
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.88, 1, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sc.world = w
sun = bpy.data.objects.new("s", bpy.data.lights.new("s", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 1.7; sun.rotation_euler = (math.radians(55), 0, math.radians(30))
def png(p, d):
    Image.open(p).save(d); return d
for n in ("amarelo", "verde", "roxo"):
    png(f"{S}/pinguim/{n}.webp", f"/tmp/pc_{n}.png")
for n in ("blue", "red", "pink", "purple"):
    png(f"{S}/puffle/{n}.webp", f"/tmp/pc_p{n}.png")
x = -4.3
for n, hgt, yaw in (("amarelo", 1.5, 18), ("verde", 1.1, -18), ("roxo", 1.1, 0)):
    relief.build("p_"+n, f"/tmp/pc_{n}.png", height=hgt, thickness=0.5, pos=(x, 0, 0), yaw=yaw); x += 1.5
for n in ("blue", "red", "pink", "purple"):
    relief.build("pf_"+n, f"/tmp/pc_p{n}.png", height=0.9, thickness=0.75, pos=(x, 0, 0), yaw=(-20 if n=="red" else 20 if n=="pink" else 0)); x += 1.25
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); sc.collection.objects.link(cam); cam.data.lens = 50
cam.location = (0.0, -11.5, 1.6); cam.rotation_euler = (Vector((0.3, 0, 0.7)) - cam.location).to_track_quat("-Z", "Y").to_euler(); sc.camera = cam
sc.render.filepath = "/tmp/teste_relevo.png"; bpy.ops.render.render(write_still=True)
