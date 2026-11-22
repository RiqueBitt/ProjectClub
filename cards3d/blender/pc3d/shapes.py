"""Peças simples (esfera, cone, caixa...) com cor por vértice, para montar
personagens e cenário por código. Tudo original, nada baixado nem gerado por IA.

Cada função recebe `M` (a matriz da peça "raiz": posição/giro/escala do
personagem inteiro) e põe a peça em `loc` (local), girada `rot` (graus) e
esticada `scl`.
"""
import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

from . import lib


def rgba(h, k=1.0):
    if not isinstance(h, str):  # já é uma cor (r, g, b[, a]) linear
        r, g, b = h[:3]
        return (min(1.0, r * k), min(1.0, g * k), min(1.0, b * k), 1.0)
    r, g, b = lib.hex_rgb(h)
    return (min(1.0, r * k), min(1.0, g * k), min(1.0, b * k), 1.0)


class Mesh:
    """Um bmesh com camada de cor por vértice ("Col")."""

    def __init__(self):
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.color.new("Col")

    # -- util
    def _paint(self, verts, color, smooth):
        for v in verts:
            for l in v.link_loops:
                l[self.col] = color
            for f in v.link_faces:
                f.smooth = smooth

    @staticmethod
    def mat(M, loc=(0, 0, 0), rot=(0, 0, 0), scl=(1, 1, 1)):
        e = Euler([math.radians(a) for a in rot], "XYZ")
        return M @ Matrix.Translation(loc) @ e.to_matrix().to_4x4() @ Matrix.Diagonal((scl[0], scl[1], scl[2], 1.0))

    # -- primitivas
    def sphere(self, M, loc, r, color, rot=(0, 0, 0), segs=16, rings=10, smooth=True):
        """r = (rx, ry, rz) ou número."""
        scl = (r, r, r) if isinstance(r, (int, float)) else r
        g = bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=1.0,
                                      matrix=self.mat(M, loc, rot, scl))
        self._paint(g["verts"], color, smooth)
        return g["verts"]

    def cone(self, M, loc, r1, r2, depth, color, rot=(0, 0, 0), scl=(1, 1, 1), segs=14, smooth=True):
        g = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segs,
                                  radius1=r1, radius2=r2, depth=depth, matrix=self.mat(M, loc, rot, scl))
        self._paint(g["verts"], color, smooth)
        return g["verts"]

    def box(self, M, loc, size, color, rot=(0, 0, 0), smooth=False):
        g = bmesh.ops.create_cube(self.bm, size=1.0, matrix=self.mat(M, loc, rot, size))
        self._paint(g["verts"], color, smooth)
        return g["verts"]

    def cut_faces(self, verts, keep):
        """Apaga as faces (das `verts`) cujo centro NÃO passa em keep(centro)."""
        faces = {f for v in verts for f in v.link_faces}
        dead = [f for f in faces if not keep(f.calc_center_median())]
        bmesh.ops.delete(self.bm, geom=dead, context="FACES")

    def prism(self, pts, z0, z1, color):
        """Prisma reto de base poligonal (pts = lista de (x, y) no sentido anti-horário)."""
        lo = [self.bm.verts.new((x, y, z0)) for x, y in pts]
        hi = [self.bm.verts.new((x, y, z1)) for x, y in pts]
        faces = [self.bm.faces.new(hi), self.bm.faces.new(lo[::-1])]
        n = len(pts)
        for i in range(n):
            faces.append(self.bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i])))
        for f in faces:
            for l in f.loops:
                l[self.col] = color

    def gable(self, cx, cy, w, d, z, h, color, over=0.0):
        """Telhado de duas águas (cumeeira ao longo de Y)."""
        x0, x1 = cx - w / 2 - over, cx + w / 2 + over
        y0, y1 = cy - d / 2 - over, cy + d / 2 + over
        a = [self.bm.verts.new(p) for p in ((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z))]
        r0 = self.bm.verts.new((cx, y0, z + h))
        r1 = self.bm.verts.new((cx, y1, z + h))
        faces = [
            self.bm.faces.new((a[0], a[1], r0)), self.bm.faces.new((a[2], a[3], r1)),
            self.bm.faces.new((a[1], a[2], r1, r0)), self.bm.faces.new((a[3], a[0], r0, r1)),
            self.bm.faces.new((a[3], a[2], a[1], a[0])),
        ]
        for f in faces:
            for l in f.loops:
                l[self.col] = color

    def to_object(self, name, material, smooth_all=False):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        if material:
            me.materials.append(material)
        return ob


_MATS = {}


def vmat(name, rough=0.6, emit=0.0, spec=0.35, metal=0.0):
    """Material de cor por vértice (compatível com glTF: COLOR_0)."""
    if name in _MATS and _MATS[name].name in bpy.data.materials:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    for k in ("Specular IOR Level", "Specular"):
        if k in b.inputs:
            b.inputs[k].default_value = spec
            break
    if emit:
        nt.links.new(vc.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = emit
    _MATS[name] = m
    return m


def look_dir(direction):
    """Matriz 3x3 que leva o eixo +Z para `direction`."""
    q = Vector(direction).normalized().to_track_quat("Z", "Y")
    return q.to_euler()
