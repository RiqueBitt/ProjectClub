import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
from pc3d import lib, penguin
lib.reset()
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"; sc.render.resolution_x = 1200; sc.render.resolution_y = 520
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.88, 1, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 1.2
sc.world = w
sun = bpy.data.objects.new("s", bpy.data.lights.new("s", "SUN")); sc.collection.objects.link(sun); sun.data.energy = 3; sun.rotation_euler = (math.radians(50), 0, math.radians(25))
P = penguin
P.penguin("a", (-2.4,0,0), body=P.CORES["amarelo"], acc="coroa", acc_color="#d82a2a", salute=True)
P.penguin("b", (-0.9,0,0), body=P.CORES["verde"], acc="capuz", acc_color="#2c7a3a")
P.penguin("c", (0.5,0,0), body=P.CORES["roxo"], acc="mago", acc_color="#5a2aa0")
P.penguin("d", (1.8,0,0), body=P.CORES["azul"], acc="viking")
P.puffle("e", (3.0,0,0), cor="#3fb3ff")
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); sc.collection.objects.link(cam); cam.data.lens = 45
cam.location = (0.3, -8, 1.6); cam.rotation_euler = (Vector((0.3, 0, 0.8)) - cam.location).to_track_quat("-Z", "Y").to_euler(); sc.camera = cam
sc.render.filepath = "/tmp/teste_pinguim.png"; bpy.ops.render.render(write_still=True)
