"""Base do pipeline 3D da Guerra das Cartas (roda no Blender, via `bpy`).

Tudo é feito por código, peça por peça (nada de modelo baixado nem gerado
por IA): primitivas arredondadas viram partes do corpo, cada parte é presa
a UM osso (estilo "boneco de brinquedo", sem deformação esquisita), e o
contorno de desenho animado é a técnica do casco invertido (Solidify com
normais viradas e material preto) — exportado junto no .glb.
"""
import math

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector

OUTLINE = "Outline"


# ------------------------------------------------------------------ cena

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _MATS.clear()
    sc = bpy.context.scene
    sc.render.fps = 30
    sc.unit_settings.system = "METRIC"


# ------------------------------------------------------------------ materiais

_MATS = {}


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(_srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def mat(name, color, rough=0.75, metal=0.0, emit=None, emit_strength=1.0, alpha=1.0):
    """Material simples (cor chapada). O sombreamento "toon" é feito no jogo."""
    key = (name, color, rough, metal, emit, alpha)
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    rgb = hex_rgb(color) if isinstance(color, str) else color
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        e = hex_rgb(emit) if isinstance(emit, str) else emit
        bsdf.inputs["Emission Color"].default_value = (*e, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    m.diffuse_color = (*rgb, alpha)
    _MATS[key] = m
    return m


def outline_mat():
    m = bpy.data.materials.get(OUTLINE)
    if m:
        return m
    m = mat(OUTLINE, "#1b1420", rough=1.0)
    m.use_backface_culling = True
    return m


# ------------------------------------------------------------------ primitivas

def _finish(obj, name, loc, rot, scale, material, bone, smooth=True, bevel=0.0):
    obj.name = name
    obj.location = loc
    obj.rotation_euler = Euler([math.radians(a) for a in rot], "XYZ")
    obj.scale = scale
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)
    if bevel > 0:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = "ANGLE"
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    obj.data.materials.append(material)
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    return obj


def sphere(name, bone, loc, scale, material, rot=(0, 0, 0), segs=18, rings=11):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=1)
    return _finish(bpy.context.active_object, name, loc, rot, scale, material, bone)


def capsule(name, bone, a, b, radius, material, segs=12, radius_b=None):
    """Cápsula (cilindro com pontas redondas) do ponto a ao ponto b."""
    a, b = Vector(a), Vector(b)
    rb = radius if radius_b is None else radius_b
    d = b - a
    length = max(d.length, 1e-4)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, cap_tris=False, segments=segs,
                          radius1=radius, radius2=rb, depth=length)
    # tampas redondas
    for r, z in ((radius, -length / 2), (rb, length / 2)):
        tmp = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=8, radius=r)
        bmesh.ops.translate(bm, verts=tmp["verts"], vec=Vector((0, 0, z)))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    obj.rotation_euler = rot
    obj.location = (a + b) / 2
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)
    # remove vértices duplicados das tampas
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(obj.data)
    bm.free()
    return _finish(obj, name, (0, 0, 0), (0, 0, 0), (1, 1, 1), material, bone)


def cone(name, bone, loc, r1, r2, depth, material, rot=(0, 0, 0), segs=12, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cone_add(vertices=segs, radius1=r1, radius2=r2, depth=depth)
    obj = bpy.context.active_object
    obj.scale = scale
    return _finish(obj, name, loc, rot, scale, material, bone)


def box(name, bone, loc, scale, material, rot=(0, 0, 0), bevel=0.08):
    bpy.ops.mesh.primitive_cube_add(size=2)
    obj = bpy.context.active_object
    return _finish(obj, name, loc, rot, scale, material, bone, smooth=bevel > 0, bevel=bevel / max(min(scale), 1e-3))


def cylinder(name, bone, loc, radius, depth, material, rot=(0, 0, 0), segs=16, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=segs, radius=radius, depth=depth)
    obj = bpy.context.active_object
    return _finish(obj, name, loc, rot, scale, material, bone)


def torus(name, bone, loc, major, minor, material, rot=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=20, minor_segments=8)
    obj = bpy.context.active_object
    return _finish(obj, name, loc, rot, scale, material, bone)


def from_bmesh(name, bone, bm, material, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return _finish(obj, name, (0, 0, 0), (0, 0, 0), (1, 1, 1), material, bone, smooth=smooth)


def wing(name, bone, root, span, chord, material, side=1, ribs=3, droop=0.15):
    """Asa achatada com recortes (penas ou membrana), saindo de `root` para o lado `side`."""
    bm = bmesh.new()
    pts = []
    for i in range(ribs + 1):
        t = i / ribs
        x = side * span * t
        y = -chord * (1 - 0.65 * t) * 0.5
        z = -droop * t * t
        pts.append((x, y, z))
    back = []
    for i in range(ribs, -1, -1):
        t = i / ribs
        x = side * span * t
        notch = 0.18 * chord if (i not in (0, ribs) and i % 1 == 0) else 0
        y = chord * (1 - 0.65 * t) * 0.5 - notch
        z = -droop * t * t
        back.append((x, y, z))
    verts = [bm.verts.new(Vector(p) + Vector(root)) for p in pts + back]
    face = bm.faces.new(verts if side > 0 else list(reversed(verts)))
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    vs = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=vs, vec=Vector((0, 0, 0.035)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return from_bmesh(name, bone, bm, material, smooth=False)


# ------------------------------------------------------------------ esqueleto

def armature(name, bones):
    """bones: [(nome, cabeça, cauda, pai_ou_None)] em coordenadas do Blender (Z pra cima, frente = -Y)."""
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    made = {}
    for bname, head, tail, parent in bones:
        b = data.edit_bones.new(bname)
        b.head = head
        b.tail = tail
        b.roll = 0
        if parent:
            b.parent = made[parent]
        made[bname] = b
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
    return arm


def add_outline(body, thickness):
    """Contorno de desenho (casco invertido). No jogo ele é gerado pelo motor
    a partir da mesma malha; aqui serve pras prévias."""
    body.data.materials.append(outline_mat())
    sol = body.modifiers.new("contorno", "SOLIDIFY")
    sol.thickness = thickness
    sol.offset = 1.0
    sol.use_flip_normals = True
    sol.use_rim = False
    sol.material_offset = 999
    sol.use_quality_normals = True
    # o contorno vem antes do esqueleto na pilha, pra deformar junto
    while body.modifiers.find("contorno") > 0:
        bpy.context.view_layer.objects.active = body
        bpy.ops.object.modifier_move_up(modifier="contorno")


def assemble(name, parts, arm, outline=0.0):
    """Junta as partes num objeto só, põe o contorno e prende no esqueleto."""
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = name
    bpy.ops.object.select_all(action="DESELECT")
    # junta materiais iguais (as partes repetem os mesmos)
    seen = {}
    for i, slot in enumerate(body.material_slots):
        seen.setdefault(slot.material.name, i)
    if outline > 0:
        add_outline(body, outline)
    body.parent = arm
    mod = body.modifiers.new("esqueleto", "ARMATURE")
    mod.object = arm
    return body


# ------------------------------------------------------------------ animação

class Clip:
    """Uma animação: chaves por osso. `rot[bone] = [(frame, (x, y, z) em graus)]`,
    `loc[bone] = [(frame, (x, y, z))]`, `scale[bone] = [(frame, (x, y, z))]`."""

    def __init__(self, name, frames, loop=True):
        self.name = name
        self.frames = frames
        self.loop = loop
        self.rot = {}
        self.loc = {}
        self.scale = {}

    def r(self, bone, frame, xyz):
        self.rot.setdefault(bone, []).append((frame, xyz))
        return self

    def l(self, bone, frame, xyz):
        self.loc.setdefault(bone, []).append((frame, xyz))
        return self

    def s(self, bone, frame, xyz):
        self.scale.setdefault(bone, []).append((frame, xyz))
        return self

    def wave_r(self, bone, axis, amp, phase=0.0, base=(0, 0, 0), cycles=1, steps=8):
        """Rotação senoidal (em laço perfeito) num eixo."""
        for i in range(steps + 1):
            f = self.frames * i / steps
            a = amp * math.sin(2 * math.pi * cycles * i / steps + phase)
            v = list(base)
            v[axis] += a
            self.r(bone, f, tuple(v))
        return self

    def wave_l(self, bone, axis, amp, phase=0.0, base=(0, 0, 0), cycles=1, steps=8):
        for i in range(steps + 1):
            f = self.frames * i / steps
            a = amp * math.sin(2 * math.pi * cycles * i / steps + phase)
            v = list(base)
            v[axis] += a
            self.l(bone, f, tuple(v))
        return self


def bake(arm, clips):
    """Grava cada Clip como uma faixa NLA (o exportador glTF vira uma animação por faixa)."""
    arm.animation_data_create()
    for clip in clips:
        act = bpy.data.actions.new(clip.name)
        act.use_fake_user = True
        arm.animation_data.action = act
        for pb in arm.pose.bones:
            pb.rotation_euler = (0, 0, 0)
            pb.location = (0, 0, 0)
            pb.scale = (1, 1, 1)
        bones = set(clip.rot) | set(clip.loc) | set(clip.scale)
        for bname in bones:
            pb = arm.pose.bones.get(bname)
            if pb is None:
                raise KeyError(f"{clip.name}: osso {bname} não existe")
            for f, xyz in clip.rot.get(bname, []):
                pb.rotation_euler = tuple(math.radians(a) for a in xyz)
                pb.keyframe_insert("rotation_euler", frame=f + 1)
            for f, xyz in clip.loc.get(bname, []):
                pb.location = xyz
                pb.keyframe_insert("location", frame=f + 1)
            for f, xyz in clip.scale.get(bname, []):
                pb.scale = xyz
                pb.keyframe_insert("scale", frame=f + 1)
        # curvas suaves (ease) em tudo
        for fc in _fcurves(act):
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
                kp.easing = "AUTO"
        track = arm.animation_data.nla_tracks.new()
        track.name = clip.name
        strip = track.strips.new(clip.name, 1, act)
        strip.name = clip.name
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def _fcurves(act):
    if hasattr(act, "fcurves") and len(getattr(act, "fcurves", [])):
        return list(act.fcurves)
    out = []
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []):
                out.extend(bag.fcurves)
    return out


# ------------------------------------------------------------------ exportar

def export_glb(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
        for c in o.children:
            c.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_force_sampling=True,
        export_frame_step=1,
        export_def_bones=False,
        export_optimize_animation_size=True,
        export_texcoords=False,
        export_normals=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )


def mirror_x(p):
    return (-p[0], p[1], p[2])


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))
