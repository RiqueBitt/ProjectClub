"""Pinguins 3D e bichinhos fofos da Guerra das Cartas (modelados por código).

O herói de cada jogador é o PINGUIM DELE: a cor do corpo vem da cor do
pinguim da Praça e o acessório (coroa, capuz, chapéu...) é escolhido por
`acc`. Frente = -Y, cima = +Z; altura ~1.0 antes da escala.
"""
import math
import random

from mathutils import Euler, Matrix, Vector

from . import lib
from .shapes import Mesh, look_dir, rgba, vmat

# cores de pinguim da Praça (CP) → hex do corpo
CORES = {
    "azul": "#2c63d8", "verde": "#2f9a52", "vermelho": "#d83a30", "amarelo": "#ffc21a",
    "rosa": "#ff7fb0", "roxo": "#8a45d0", "preto": "#33353c", "laranja": "#ff8a1f",
    "branco": "#e9edf4", "ciano": "#2cc4d8",
}

BRANCO = "#f6f8fc"
BICO = "#ff9a1a"
PRETO = "#16161c"


def _root(pos, yaw, scale):
    return Matrix.Translation(pos) @ Euler((0, 0, math.radians(yaw)), "XYZ").to_matrix().to_4x4() @ Matrix.Diagonal((scale, scale, scale, 1))


def penguin(name, pos=(0, 0, 0), yaw=0.0, scale=1.0, body="#2c63d8", acc=None, acc_color="#2f9a52",
            salute=False, belly=BRANCO, happy=True):
    """acc: None | 'coroa' | 'capuz' | 'mago' | 'bone' | 'viking'."""
    M = _root(pos, yaw, scale)
    m = Mesh()
    dark = tuple(max(0.0, c * 0.78) for c in rgba(body)[:3]) + (1.0,)
    # corpo (ovo) + barriga
    m.sphere(M, (0, 0.02, 0.5), (0.43, 0.39, 0.5), rgba(body))
    m.sphere(M, (0, -0.075, 0.45), (0.34, 0.31, 0.43), rgba(belly))
    m.sphere(M, (0, 0.18, 0.2), (0.27, 0.2, 0.2), rgba(body, 0.82))  # rabinho
    # olhos grandes (branco + pupila + brilho)
    for s in (-1, 1):
        m.sphere(M, (s * 0.115, -0.315, 0.76), (0.095, 0.06, 0.115), rgba("#ffffff"), segs=14, rings=8)
        m.sphere(M, (s * 0.115 + s * 0.012, -0.365, 0.765), (0.036, 0.022, 0.056), rgba(PRETO), segs=10, rings=6)
        m.sphere(M, (s * 0.115 + s * 0.02, -0.378, 0.79), (0.012, 0.01, 0.016), rgba("#ffffff"), segs=6, rings=4)
    # bico (dois pedaços) e bochechas
    m.cone(M, (0, -0.4, 0.68), 0.12, 0.025, 0.2, rgba(BICO), rot=(90, 0, 0), scl=(1, 1, 0.55))
    m.cone(M, (0, -0.385, 0.645), 0.1, 0.03, 0.15, rgba(BICO, 0.88), rot=(90, 0, 0), scl=(1, 1, 0.4))
    if happy:
        for s in (-1, 1):
            m.sphere(M, (s * 0.25, -0.27, 0.66), (0.055, 0.02, 0.035), rgba("#ff8fa8"), segs=8, rings=5)
    # pés
    for s in (-1, 1):
        m.sphere(M, (s * 0.17, -0.2, 0.045), (0.14, 0.21, 0.05), rgba(BICO), rot=(0, 0, s * -12))
    # nadadeiras
    m.sphere(M, (-0.45, 0.0, 0.5), (0.075, 0.14, 0.31), rgba(dark), rot=(0, -22, 0))
    if salute:  # continência: nadadeira direita na testa
        m.sphere(M, (0.33, -0.27, 0.93), (0.075, 0.13, 0.3), rgba(dark), rot=(-75, 58, 0))
    else:
        m.sphere(M, (0.45, 0.0, 0.5), (0.075, 0.14, 0.31), rgba(dark), rot=(0, 22, 0))

    ac = rgba(acc_color)
    if acc == "coroa":
        m.cone(M, (0, 0.0, 1.0), 0.23, 0.23, 0.1, rgba("#ffd23c"), segs=20)           # aro dourado
        m.cone(M, (0, 0.0, 1.06), 0.215, 0.235, 0.12, ac, segs=20)                    # base vermelha
        for k in range(5):
            a = 2 * math.pi * k / 5
            x, y = 0.19 * math.cos(a), 0.19 * math.sin(a)
            m.cone(M, (x, y, 1.19), 0.075, 0.0, 0.2, ac, segs=8)
            m.sphere(M, (x, y, 1.3), 0.034, rgba("#ffd23c"), segs=8, rings=6)
    elif acc == "capuz":
        v = m.sphere(M, (0, 0.05, 0.8), (0.5, 0.46, 0.4), ac, segs=24, rings=14)
        inv = M.inverted()
        m.cut_faces(v, lambda c: (inv @ c).y > -0.14 or (inv @ c).z > 0.98)   # abre o rosto
        m.cone(M, (0, 0.2, 1.1), 0.18, 0.0, 0.34, ac, rot=(-35, 0, 0), segs=12)  # ponta do capuz
    elif acc == "mago":
        m.cone(M, (0, 0.0, 1.0), 0.33, 0.33, 0.04, ac, segs=22)
        m.cone(M, (0, 0.0, 1.26), 0.24, 0.0, 0.5, ac, segs=18, rot=(-8, 0, 0))
        m.sphere(M, (0, -0.04, 1.52), 0.05, rgba("#ffd23c"), segs=8, rings=6)
    elif acc == "bone":
        m.sphere(M, (0, 0.0, 0.95), (0.4, 0.36, 0.24), ac, segs=18, rings=8)
        m.cone(M, (0, -0.38, 0.95), 0.26, 0.26, 0.04, ac, rot=(90, 0, 0), scl=(1, 1, 1))
    elif acc == "viking":
        m.sphere(M, (0, 0.0, 0.97), (0.41, 0.37, 0.25), rgba("#9aa0ad"), segs=18, rings=8)
        for s in (-1, 1):
            m.cone(M, (s * 0.44, 0, 1.05), 0.07, 0.0, 0.3, rgba("#f2ead0"), rot=(0, s * 40, 0), segs=8)
    return m.to_object(name, vmat("pinguim", rough=0.48, spec=0.5))


def puffle(name, pos=(0, 0, 0), yaw=0.0, scale=1.0, cor="#3fb3ff", seed=1):
    """Bolinha de pelo com topete, olhões e sorriso."""
    rnd = random.Random(seed)
    M = _root(pos, yaw, scale)
    m = Mesh()
    base = rgba(cor)
    m.sphere(M, (0, 0, 0.36), (0.46, 0.4, 0.36), base, segs=22, rings=14)
    # pelos (cones) espalhados na metade de cima
    for _ in range(30):
        th = rnd.uniform(0, 2 * math.pi)
        ph = rnd.uniform(0.15, 1.25)
        d = Vector((math.sin(ph) * math.cos(th), math.sin(ph) * math.sin(th) * 0.9, math.cos(ph)))
        p = Vector((0.46 * d.x, 0.4 * d.y, 0.36 + 0.36 * d.z))
        if d.y < -0.35 and d.z < 0.55:
            continue  # deixa o rosto limpo
        e = look_dir(d + Vector((0, 0, 0.25)))
        m.cone(M, tuple(p * 0.96), 0.075, 0.0, 0.26 * rnd.uniform(0.7, 1.15), base,
               rot=tuple(math.degrees(a) for a in e), segs=6)
    # olhos
    for s in (-1, 1):
        m.sphere(M, (s * 0.15, -0.33, 0.47), (0.115, 0.07, 0.13), rgba("#ffffff"), segs=14, rings=8)
        m.sphere(M, (s * 0.15 + s * 0.02, -0.395, 0.47), (0.04, 0.025, 0.06), rgba(PRETO), segs=10, rings=6)
    # sorriso
    for i in range(9):
        t = -1 + i / 4
        m.sphere(M, (t * 0.2, -0.385 + 0.0 * t, 0.285 - 0.075 * (1 - t * t)), 0.024, rgba(PRETO), segs=6, rings=4)
    return m.to_object(name, vmat("puffle3d", rough=0.8, spec=0.15))


def arco_vida(name, pos, largura=1.5, cor="#3ddc4a", frac=1.0):
    """Arco verde sob a unidade (como na referência)."""
    m = Mesh()
    M = Matrix.Translation(pos)
    n = 16
    R = largura / 1.6
    for layer, (w, z, c) in enumerate(((0.17, 0.0, rgba("#0f4a1c")), (0.1, 0.012, rgba(cor)))):
        for i in range(n):
            a0 = math.radians(205 + 130 * i / n)
            a1 = math.radians(205 + 130 * (i + 1) / n)
            if (i / n) > frac:
                c = rgba("#26402b")
            pts = []
            for a in (a0, a1):
                pts.append((R * math.cos(a), R * math.sin(a) * 0.55 + 0.6))
            (x0, y0), (x1, y1) = pts
            m.box(M, ((x0 + x1) / 2, (y0 + y1) / 2 - 0.55, 0.12 + z), (math.hypot(x1 - x0, y1 - y0) * 1.04, w, 0.04),
                  c, rot=(0, 0, math.degrees(math.atan2(y1 - y0, x1 - x0))))
    return m.to_object(name, vmat("arco", rough=0.4, emit=0.5))
