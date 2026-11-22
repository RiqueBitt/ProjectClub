"""Esqueletos e animações por arquétipo.

Convenções (Blender): Z pra cima, o personagem olha pra -Y, o lado esquerdo
dele (.L) é +X. Membros ficam na vertical, então:
- girar +X num osso que aponta pra cima inclina o topo pra frente;
- girar +X num osso que aponta pra baixo joga a ponta pra trás.

As 11 animações pedidas existem em todos os arquétipos, sempre com estes
nomes: idle, walk, run, attack, special, defense, hit, victory, defeat,
death, spawn.
"""
from .lib import Clip

CLIP_NAMES = ["idle", "walk", "run", "attack", "special", "defense", "hit", "victory", "defeat", "death", "spawn"]


def spawn_clip(frames=24):
    c = Clip("spawn", frames, loop=False)
    c.s("root", 0, (0.05, 0.05, 0.05)).s("root", 10, (1.18, 1.18, 0.82)).s("root", 16, (0.92, 0.92, 1.1)).s("root", frames, (1, 1, 1))
    c.l("root", 0, (0, 0, 0.5)).l("root", 10, (0, 0, 0)).l("root", frames, (0, 0, 0))
    return c


def death_clip(frames=36, fall=(-80, 0, 0)):
    c = Clip("death", frames, loop=False)
    c.r("root", 0, (0, 0, 0)).r("root", 6, (8, 0, 0)).r("root", 18, fall).r("root", frames, fall)
    c.l("root", 0, (0, 0, 0)).l("root", 6, (0, 0, 0.12)).l("root", 18, (0, 0, 0)).l("root", frames, (0, 0, -0.1))
    c.s("root", 0, (1, 1, 1)).s("root", 22, (1, 1, 1)).s("root", 30, (1.1, 1.1, 0.6)).s("root", frames, (0.02, 0.02, 0.02))
    return c


# ================================================================== BÍPEDE

def biped_bones(h=1.0, heavy=False):
    """Bípede "cabeçudo" (proporção de desenho). `h` escala a altura."""
    w = 1.25 if heavy else 1.0
    s = lambda p: (p[0] * w * h, p[1] * h, p[2] * h)
    return [
        ("root", s((0, 0, 0)), s((0, 0, 0.2)), None),
        ("hips", s((0, 0, 0.40)), s((0, 0, 0.58)), "root"),
        ("spine", s((0, 0, 0.58)), s((0, 0, 0.84)), "hips"),
        ("head", s((0, 0, 0.84)), s((0, 0, 1.30)), "spine"),
        ("arm.L", s((0.25, 0, 0.80)), s((0.27, 0, 0.56)), "spine"),
        ("hand.L", s((0.27, 0, 0.56)), s((0.28, 0, 0.44)), "arm.L"),
        ("arm.R", s((-0.25, 0, 0.80)), s((-0.27, 0, 0.56)), "spine"),
        ("hand.R", s((-0.27, 0, 0.56)), s((-0.28, 0, 0.44)), "arm.R"),
        ("leg.L", s((0.12, 0, 0.40)), s((0.12, 0, 0.12)), "hips"),
        ("foot.L", s((0.12, 0, 0.12)), s((0.12, -0.12, 0.03)), "leg.L"),
        ("leg.R", s((-0.12, 0, 0.40)), s((-0.12, 0, 0.12)), "hips"),
        ("foot.R", s((-0.12, 0, 0.12)), s((-0.12, -0.12, 0.03)), "leg.R"),
    ]


def biped_clips(heavy=False, weapon_hand="R"):
    k = 0.75 if heavy else 1.0  # o pesado se mexe menos
    W = "arm." + weapon_hand
    O = "arm." + ("L" if weapon_hand == "R" else "R")
    clips = []

    c = Clip("idle", 60)
    c.wave_r("spine", 0, 2.5 * k).wave_r("head", 0, 3 * k, phase=0.8).wave_r("head", 2, 2 * k, phase=1.6)
    c.wave_r("arm.L", 2, 3 * k, base=(0, 0, 4)).wave_r("arm.R", 2, -3 * k, base=(0, 0, -4))
    c.wave_l("hips", 2, 0.012, cycles=1)
    clips.append(c)

    c = Clip("walk", 24)
    c.wave_r("leg.L", 0, 28 * k).wave_r("leg.R", 0, 28 * k, phase=3.1416)
    c.wave_r("foot.L", 0, 12 * k, phase=0.6).wave_r("foot.R", 0, 12 * k, phase=3.74)
    c.wave_r("arm.L", 0, 24 * k, phase=3.1416, base=(0, 0, 4)).wave_r("arm.R", 0, 24 * k, base=(0, 0, -4))
    c.wave_r("spine", 1, 6 * k).wave_r("head", 1, -4 * k)
    c.wave_l("hips", 2, 0.03, cycles=2, phase=1.57)
    clips.append(c)

    c = Clip("run", 16)
    c.wave_r("leg.L", 0, 45 * k).wave_r("leg.R", 0, 45 * k, phase=3.1416)
    c.wave_r("foot.L", 0, 25 * k, phase=0.8).wave_r("foot.R", 0, 25 * k, phase=3.94)
    c.wave_r("arm.L", 0, 50 * k, phase=3.1416, base=(0, 0, 8)).wave_r("arm.R", 0, 50 * k, base=(0, 0, -8))
    c.wave_r("spine", 0, 3, base=(14 * k, 0, 0), cycles=2).wave_r("head", 0, 3, base=(-8, 0, 0), cycles=2)
    c.wave_l("hips", 2, 0.06, cycles=2, phase=1.57)
    clips.append(c)

    c = Clip("attack", 26, loop=False)
    c.r("spine", 0, (0, 0, 0)).r("spine", 8, (-14, 0, 18 if weapon_hand == "R" else -18)).r("spine", 12, (24 * k, 0, -14)).r("spine", 26, (0, 0, 0))
    c.r(W, 0, (0, 0, 0)).r(W, 8, (-155, 0, 0)).r(W, 12, (-40, 0, 0)).r(W, 17, (-28, 0, 0)).r(W, 26, (0, 0, 0))
    c.r(O, 0, (0, 0, 0)).r(O, 8, (-30, 0, 0)).r(O, 12, (30, 0, 0)).r(O, 26, (0, 0, 0))
    c.r("leg.L", 0, (0, 0, 0)).r("leg.L", 12, (-28, 0, 0)).r("leg.L", 26, (0, 0, 0))
    c.r("leg.R", 0, (0, 0, 0)).r("leg.R", 12, (22, 0, 0)).r("leg.R", 26, (0, 0, 0))
    c.l("root", 0, (0, 0, 0)).l("root", 8, (0, 0.05, 0)).l("root", 12, (0, -0.22, 0)).l("root", 26, (0, 0, 0))
    clips.append(c)

    c = Clip("special", 44, loop=False)
    c.l("root", 0, (0, 0, 0)).l("root", 10, (0, 0, -0.08)).l("root", 20, (0, 0, 0.45)).l("root", 30, (0, -0.1, 0)).l("root", 44, (0, 0, 0))
    c.s("root", 0, (1, 1, 1)).s("root", 10, (1.08, 1.08, 0.88)).s("root", 20, (0.95, 0.95, 1.1)).s("root", 30, (1.12, 1.12, 0.85)).s("root", 44, (1, 1, 1))
    for arm, side in (("arm.L", 1), ("arm.R", -1)):
        c.r(arm, 0, (0, 0, 0)).r(arm, 10, (20, 0, side * 25)).r(arm, 20, (-170, 0, side * 20)).r(arm, 30, (-60, 0, side * 10)).r(arm, 44, (0, 0, 0))
    c.r("spine", 0, (0, 0, 0)).r("spine", 10, (18, 0, 0)).r("spine", 20, (-12, 0, 0)).r("spine", 30, (26, 0, 0)).r("spine", 44, (0, 0, 0))
    c.r("leg.L", 0, (0, 0, 0)).r("leg.L", 10, (-30, 0, 0)).r("leg.L", 20, (10, 0, 0)).r("leg.L", 30, (-25, 0, 0)).r("leg.L", 44, (0, 0, 0))
    c.r("leg.R", 0, (0, 0, 0)).r("leg.R", 10, (-30, 0, 0)).r("leg.R", 20, (10, 0, 0)).r("leg.R", 30, (-25, 0, 0)).r("leg.R", 44, (0, 0, 0))
    clips.append(c)

    c = Clip("defense", 30, loop=False)
    for arm, side in (("arm.L", 1), ("arm.R", -1)):
        c.r(arm, 0, (0, 0, 0)).r(arm, 6, (-80, side * 10, -side * 35)).r(arm, 22, (-80, side * 10, -side * 35)).r(arm, 30, (0, 0, 0))
    c.r("spine", 0, (0, 0, 0)).r("spine", 6, (-10, 0, 0)).r("spine", 22, (-10, 0, 0)).r("spine", 30, (0, 0, 0))
    c.r("head", 0, (0, 0, 0)).r("head", 6, (12, 0, 0)).r("head", 22, (12, 0, 0)).r("head", 30, (0, 0, 0))
    c.l("hips", 0, (0, 0, 0)).l("hips", 6, (0, 0, -0.06)).l("hips", 22, (0, 0, -0.06)).l("hips", 30, (0, 0, 0))
    c.r("leg.L", 0, (0, 0, 0)).r("leg.L", 6, (-12, 0, 6)).r("leg.L", 22, (-12, 0, 6)).r("leg.L", 30, (0, 0, 0))
    c.r("leg.R", 0, (0, 0, 0)).r("leg.R", 6, (10, 0, -6)).r("leg.R", 22, (10, 0, -6)).r("leg.R", 30, (0, 0, 0))
    clips.append(c)

    c = Clip("hit", 18, loop=False)
    c.r("spine", 0, (0, 0, 0)).r("spine", 3, (-22, 0, 6)).r("spine", 18, (0, 0, 0))
    c.r("head", 0, (0, 0, 0)).r("head", 3, (-18, 0, -8)).r("head", 18, (0, 0, 0))
    c.r("arm.L", 0, (0, 0, 0)).r("arm.L", 3, (-30, 0, 30)).r("arm.L", 18, (0, 0, 0))
    c.r("arm.R", 0, (0, 0, 0)).r("arm.R", 3, (-30, 0, -30)).r("arm.R", 18, (0, 0, 0))
    c.l("root", 0, (0, 0, 0)).l("root", 3, (0, 0.12, 0)).l("root", 18, (0, 0, 0))
    c.s("root", 0, (1, 1, 1)).s("root", 3, (1.08, 1.08, 0.9)).s("root", 9, (0.97, 0.97, 1.03)).s("root", 18, (1, 1, 1))
    clips.append(c)

    c = Clip("victory", 40)
    c.l("root", 0, (0, 0, 0)).l("root", 10, (0, 0, 0.22)).l("root", 20, (0, 0, 0)).l("root", 30, (0, 0, 0.22)).l("root", 40, (0, 0, 0))
    c.r("arm.L", 0, (-160, 0, 15)).r("arm.L", 10, (-175, 0, 30)).r("arm.L", 20, (-160, 0, 15)).r("arm.L", 30, (-175, 0, 30)).r("arm.L", 40, (-160, 0, 15))
    c.r("arm.R", 0, (-160, 0, -15)).r("arm.R", 10, (-175, 0, -30)).r("arm.R", 20, (-160, 0, -15)).r("arm.R", 30, (-175, 0, -30)).r("arm.R", 40, (-160, 0, -15))
    c.wave_r("head", 2, 10, cycles=1)
    c.r("leg.L", 0, (0, 0, 0)).r("leg.L", 10, (-25, 0, 0)).r("leg.L", 20, (0, 0, 0)).r("leg.L", 30, (-25, 0, 0)).r("leg.L", 40, (0, 0, 0))
    clips.append(c)

    c = Clip("defeat", 60)
    c.wave_r("spine", 0, 2, base=(28, 0, 0)).wave_r("head", 0, 3, base=(24, 0, 0), phase=1)
    c.wave_r("arm.L", 0, 3, base=(-12, 0, -6)).wave_r("arm.R", 0, 3, base=(-12, 0, 6), phase=0.5)
    c.wave_l("hips", 2, 0.01, base=(0, 0, -0.04))
    clips.append(c)

    clips.append(death_clip(fall=(-82, 0, 0)))
    clips.append(spawn_clip())
    return clips


# ================================================================== QUADRÚPEDE

def quad_bones(h=1.0, long=1.0):
    s = lambda p: (p[0] * h, p[1] * h * long, p[2] * h)
    return [
        ("root", s((0, 0, 0)), s((0, 0, 0.2)), None),
        ("body", s((0, 0.30, 0.48)), s((0, -0.28, 0.52)), "root"),
        ("neck", s((0, -0.28, 0.52)), s((0, -0.40, 0.72)), "body"),
        ("head", s((0, -0.40, 0.72)), s((0, -0.72, 0.74)), "neck"),
        ("tail", s((0, 0.30, 0.52)), s((0, 0.62, 0.70)), "body"),
        ("leg.FL", s((0.16, -0.20, 0.42)), s((0.16, -0.20, 0.04)), "body"),
        ("leg.FR", s((-0.16, -0.20, 0.42)), s((-0.16, -0.20, 0.04)), "body"),
        ("leg.BL", s((0.16, 0.22, 0.42)), s((0.16, 0.22, 0.04)), "body"),
        ("leg.BR", s((-0.16, 0.22, 0.42)), s((-0.16, 0.22, 0.04)), "body"),
    ]


def quad_clips():
    clips = []
    c = Clip("idle", 60)
    c.wave_l("body", 2, 0.012).wave_r("head", 0, 4, phase=0.7).wave_r("head", 2, 5, phase=1.9, cycles=1)
    c.wave_r("tail", 2, 18, cycles=2).wave_r("neck", 0, 2, phase=0.4)
    clips.append(c)

    c = Clip("walk", 24)
    for leg, ph in (("leg.FL", 0), ("leg.BR", 0.4), ("leg.FR", 3.1416), ("leg.BL", 3.54)):
        c.wave_r(leg, 0, 24, phase=ph)
    c.wave_l("body", 2, 0.025, cycles=2).wave_r("head", 0, 4, cycles=2).wave_r("tail", 2, 15)
    clips.append(c)

    c = Clip("run", 14)
    for leg, ph in (("leg.FL", 0), ("leg.FR", 0.5), ("leg.BL", 3.1416), ("leg.BR", 3.64)):
        c.wave_r(leg, 0, 48, phase=ph)
    c.wave_r("body", 0, 7).wave_l("body", 2, 0.06, cycles=1, phase=1.57).wave_r("head", 0, 8, phase=3.1416).wave_r("tail", 0, 20, base=(-20, 0, 0))
    clips.append(c)

    c = Clip("attack", 24, loop=False)
    c.r("body", 0, (0, 0, 0)).r("body", 8, (-12, 0, 0)).r("body", 12, (14, 0, 0)).r("body", 24, (0, 0, 0))
    c.r("neck", 0, (0, 0, 0)).r("neck", 8, (-25, 0, 0)).r("neck", 12, (30, 0, 0)).r("neck", 24, (0, 0, 0))
    c.r("head", 0, (0, 0, 0)).r("head", 8, (-15, 0, 0)).r("head", 12, (20, 0, 0)).r("head", 24, (0, 0, 0))
    c.l("root", 0, (0, 0, 0)).l("root", 8, (0, 0.08, 0.02)).l("root", 12, (0, -0.28, 0.08)).l("root", 24, (0, 0, 0))
    c.r("leg.FL", 0, (0, 0, 0)).r("leg.FL", 12, (-40, 0, 0)).r("leg.FL", 24, (0, 0, 0))
    c.r("leg.FR", 0, (0, 0, 0)).r("leg.FR", 12, (-40, 0, 0)).r("leg.FR", 24, (0, 0, 0))
    c.r("leg.BL", 0, (0, 0, 0)).r("leg.BL", 12, (35, 0, 0)).r("leg.BL", 24, (0, 0, 0))
    c.r("leg.BR", 0, (0, 0, 0)).r("leg.BR", 12, (35, 0, 0)).r("leg.BR", 24, (0, 0, 0))
    clips.append(c)

    c = Clip("special", 44, loop=False)
    c.r("body", 0, (0, 0, 0)).r("body", 12, (-35, 0, 0)).r("body", 26, (-35, 0, 0)).r("body", 34, (10, 0, 0)).r("body", 44, (0, 0, 0))
    c.r("neck", 0, (0, 0, 0)).r("neck", 12, (-40, 0, 0)).r("neck", 26, (-40, 0, 0)).r("neck", 34, (20, 0, 0)).r("neck", 44, (0, 0, 0))
    c.r("head", 0, (0, 0, 0)).r("head", 12, (-25, 0, 0)).r("head", 18, (-25, 0, 8)).r("head", 22, (-25, 0, -8)).r("head", 26, (-25, 0, 0)).r("head", 44, (0, 0, 0))
    c.r("leg.FL", 0, (0, 0, 0)).r("leg.FL", 12, (-60, 0, 0)).r("leg.FL", 26, (-50, 0, 0)).r("leg.FL", 34, (0, 0, 0))
    c.r("leg.FR", 0, (0, 0, 0)).r("leg.FR", 12, (-60, 0, 0)).r("leg.FR", 26, (-50, 0, 0)).r("leg.FR", 34, (0, 0, 0))
    c.l("root", 0, (0, 0, 0)).l("root", 26, (0, 0, 0)).l("root", 34, (0, -0.15, 0)).l("root", 44, (0, 0, 0))
    c.wave_r("tail", 2, 30, cycles=3)
    clips.append(c)

    c = Clip("defense", 30, loop=False)
    c.l("root", 0, (0, 0, 0)).l("root", 6, (0, 0.05, -0.08)).l("root", 22, (0, 0.05, -0.08)).l("root", 30, (0, 0, 0))
    c.r("neck", 0, (0, 0, 0)).r("neck", 6, (20, 0, 0)).r("neck", 22, (20, 0, 0)).r("neck", 30, (0, 0, 0))
    c.r("head", 0, (0, 0, 0)).r("head", 6, (10, 0, 0)).r("head", 22, (10, 0, 0)).r("head", 30, (0, 0, 0))
    for leg in ("leg.FL", "leg.FR"):
        c.r(leg, 0, (0, 0, 0)).r(leg, 6, (-25, 0, 0)).r(leg, 22, (-25, 0, 0)).r(leg, 30, (0, 0, 0))
    for leg in ("leg.BL", "leg.BR"):
        c.r(leg, 0, (0, 0, 0)).r(leg, 6, (25, 0, 0)).r(leg, 22, (25, 0, 0)).r(leg, 30, (0, 0, 0))
    clips.append(c)

    c = Clip("hit", 18, loop=False)
    c.r("body", 0, (0, 0, 0)).r("body", 3, (-12, 8, 0)).r("body", 18, (0, 0, 0))
    c.r("head", 0, (0, 0, 0)).r("head", 3, (-25, 0, 12)).r("head", 18, (0, 0, 0))
    c.l("root", 0, (0, 0, 0)).l("root", 3, (0, 0.14, 0)).l("root", 18, (0, 0, 0))
    c.s("root", 0, (1, 1, 1)).s("root", 3, (1.08, 1.08, 0.9)).s("root", 18, (1, 1, 1))
    clips.append(c)

    c = Clip("victory", 40)
    c.l("root", 0, (0, 0, 0)).l("root", 10, (0, 0, 0.25)).l("root", 20, (0, 0, 0)).l("root", 30, (0, 0, 0.25)).l("root", 40, (0, 0, 0))
    c.r("root", 0, (0, 0, 0)).r("root", 20, (0, 0, 180)).r("root", 40, (0, 0, 360))
    c.wave_r("tail", 2, 30, cycles=4).wave_r("head", 0, 10, cycles=2, base=(-15, 0, 0))
    clips.append(c)

    c = Clip("defeat", 60)
    c.wave_r("neck", 0, 2, base=(35, 0, 0)).wave_r("head", 0, 3, base=(20, 0, 0)).wave_r("tail", 0, 3, base=(40, 0, 0))
    c.wave_l("body", 2, 0.01, base=(0, 0, -0.08))
    clips.append(c)

    clips.append(death_clip(fall=(0, -90, 0)))
    clips.append(spawn_clip())
    return clips


# ================================================================== BOLINHA (gosma, espírito, girino)

def blob_bones(h=1.0):
    s = lambda p: (p[0] * h, p[1] * h, p[2] * h)
    return [
        ("root", s((0, 0, 0)), s((0, 0, 0.2)), None),
        ("body", s((0, 0, 0)), s((0, 0, 0.55)), "root"),
        ("top", s((0, 0, 0.55)), s((0, 0, 0.85)), "body"),
        ("arm.L", s((0.30, 0, 0.35)), s((0.42, 0, 0.22)), "body"),
        ("arm.R", s((-0.30, 0, 0.35)), s((-0.42, 0, 0.22)), "body"),
    ]


def blob_clips():
    def squash(c, bone, f, sq):
        c.s(bone, f, (1 + sq * 0.5, 1 + sq * 0.5, 1 - sq))

    clips = []
    c = Clip("idle", 48)
    for i in range(9):
        f = 48 * i / 8
        squash(c, "body", f, 0.05 * (1 if i % 2 else -1) * (0 if i in (0, 8) else 1))
    c.wave_r("top", 1, 6).wave_r("arm.L", 0, 10).wave_r("arm.R", 0, 10, phase=3.1)
    clips.append(c)

    for name, frames, hop in (("walk", 20, 0.14), ("run", 14, 0.26)):
        c = Clip(name, frames)
        c.l("root", 0, (0, 0, 0)).l("root", frames / 2, (0, 0, hop)).l("root", frames, (0, 0, 0))
        squash(c, "body", 0, 0.18)
        squash(c, "body", frames * 0.25, -0.12)
        squash(c, "body", frames * 0.5, -0.05)
        squash(c, "body", frames * 0.85, 0.05)
        squash(c, "body", frames, 0.18)
        c.r("body", 0, (8, 0, 0)).r("body", frames / 2, (-6, 0, 0)).r("body", frames, (8, 0, 0))
        c.wave_r("arm.L", 0, 30).wave_r("arm.R", 0, 30, phase=3.14)
        clips.append(c)

    c = Clip("attack", 24, loop=False)
    squash(c, "body", 0, 0)
    squash(c, "body", 7, 0.28)
    squash(c, "body", 12, -0.25)
    squash(c, "body", 24, 0)
    c.l("root", 0, (0, 0, 0)).l("root", 7, (0, 0.05, 0)).l("root", 12, (0, -0.35, 0.15)).l("root", 24, (0, 0, 0))
    c.r("body", 0, (0, 0, 0)).r("body", 7, (-15, 0, 0)).r("body", 12, (25, 0, 0)).r("body", 24, (0, 0, 0))
    clips.append(c)

    c = Clip("special", 44, loop=False)
    squash(c, "body", 0, 0)
    squash(c, "body", 12, 0.3)
    squash(c, "body", 22, -0.3)
    squash(c, "body", 32, 0.35)
    squash(c, "body", 44, 0)
    c.l("root", 0, (0, 0, 0)).l("root", 12, (0, 0, 0)).l("root", 22, (0, 0, 0.6)).l("root", 32, (0, 0, 0)).l("root", 44, (0, 0, 0))
    c.r("root", 0, (0, 0, 0)).r("root", 22, (0, 0, 360)).r("root", 44, (0, 0, 360))
    clips.append(c)

    c = Clip("defense", 30, loop=False)
    squash(c, "body", 0, 0)
    squash(c, "body", 6, 0.3)
    squash(c, "body", 22, 0.3)
    squash(c, "body", 30, 0)
    c.r("arm.L", 0, (0, 0, 0)).r("arm.L", 6, (-60, 0, -40)).r("arm.L", 22, (-60, 0, -40)).r("arm.L", 30, (0, 0, 0))
    c.r("arm.R", 0, (0, 0, 0)).r("arm.R", 6, (-60, 0, 40)).r("arm.R", 22, (-60, 0, 40)).r("arm.R", 30, (0, 0, 0))
    clips.append(c)

    c = Clip("hit", 18, loop=False)
    squash(c, "body", 0, 0)
    squash(c, "body", 3, 0.35)
    squash(c, "body", 8, -0.15)
    squash(c, "body", 18, 0)
    c.l("root", 0, (0, 0, 0)).l("root", 3, (0, 0.15, 0)).l("root", 18, (0, 0, 0))
    clips.append(c)

    c = Clip("victory", 30)
    c.l("root", 0, (0, 0, 0)).l("root", 15, (0, 0, 0.35)).l("root", 30, (0, 0, 0))
    squash(c, "body", 0, 0.2)
    squash(c, "body", 8, -0.15)
    squash(c, "body", 22, -0.1)
    squash(c, "body", 30, 0.2)
    c.r("arm.L", 0, (-150, 0, 0)).r("arm.L", 15, (-170, 0, 20)).r("arm.L", 30, (-150, 0, 0))
    c.r("arm.R", 0, (-150, 0, 0)).r("arm.R", 15, (-170, 0, -20)).r("arm.R", 30, (-150, 0, 0))
    clips.append(c)

    c = Clip("defeat", 60)
    for i in range(5):
        squash(c, "body", 60 * i / 4, 0.22 + (0.03 if i % 2 else 0))
    c.wave_r("top", 0, 3, base=(20, 0, 0))
    clips.append(c)

    c = Clip("death", 32, loop=False)
    squash(c, "body", 0, 0)
    squash(c, "body", 8, -0.3)
    squash(c, "body", 18, 0.6)
    c.s("root", 0, (1, 1, 1)).s("root", 18, (1.2, 1.2, 1)).s("root", 32, (0.02, 0.02, 0.02))
    clips.append(c)
    clips.append(spawn_clip())
    return clips


# ================================================================== VOADOR

def flyer_bones(h=1.0, span=1.0):
    s = lambda p: (p[0] * h, p[1] * h, p[2] * h)
    sx = lambda p: (p[0] * h * span, p[1] * h, p[2] * h)
    return [
        ("root", s((0, 0, 0)), s((0, 0, 0.2)), None),
        ("body", s((0, 0.22, 0.62)), s((0, -0.20, 0.66)), "root"),
        ("head", s((0, -0.20, 0.66)), s((0, -0.48, 0.78)), "body"),
        ("wing.L", s((0.14, -0.02, 0.70)), sx((0.70, -0.02, 0.70)), "body"),
        ("wing.R", s((-0.14, -0.02, 0.70)), sx((-0.70, -0.02, 0.70)), "body"),
        ("tail", s((0, 0.22, 0.62)), s((0, 0.55, 0.58)), "body"),
        ("legs", s((0, 0.02, 0.56)), s((0, 0.02, 0.36)), "body"),
    ]


def flyer_clips():
    def flap(c, amp, cycles, base=0):
        c.wave_r("wing.L", 0, amp, base=(base, 0, 0), cycles=cycles, steps=8 * cycles)
        c.wave_r("wing.R", 0, amp, base=(base, 0, 0), cycles=cycles, steps=8 * cycles)

    clips = []
    c = Clip("idle", 40)
    flap(c, 28, 2, base=10)
    c.wave_l("root", 2, 0.05, cycles=2, steps=16).wave_r("head", 2, 8).wave_r("tail", 0, 8)
    clips.append(c)

    c = Clip("walk", 20)
    flap(c, 35, 2, base=5)
    c.wave_l("root", 2, 0.06, cycles=2, steps=16).r("body", 0, (10, 0, 0)).r("body", 20, (10, 0, 0))
    clips.append(c)

    c = Clip("run", 12)
    flap(c, 45, 2)
    c.wave_l("root", 2, 0.05, cycles=2, steps=16).r("body", 0, (18, 0, 0)).r("body", 12, (18, 0, 0))
    clips.append(c)

    c = Clip("attack", 24, loop=False)
    c.r("body", 0, (0, 0, 0)).r("body", 8, (-25, 0, 0)).r("body", 13, (35, 0, 0)).r("body", 24, (0, 0, 0))
    c.l("root", 0, (0, 0, 0)).l("root", 8, (0, 0.1, 0.15)).l("root", 13, (0, -0.4, -0.12)).l("root", 24, (0, 0, 0))
    for w in ("wing.L", "wing.R"):
        c.r(w, 0, (0, 0, 0)).r(w, 8, (60, 0, 0)).r(w, 13, (-45, 0, 0)).r(w, 24, (0, 0, 0))
    clips.append(c)

    c = Clip("special", 44, loop=False)
    c.l("root", 0, (0, 0, 0)).l("root", 16, (0, 0, 0.55)).l("root", 30, (0, 0, 0.55)).l("root", 44, (0, 0, 0))
    c.r("root", 0, (0, 0, 0)).r("root", 30, (0, 0, 720)).r("root", 44, (0, 0, 720))
    for w in ("wing.L", "wing.R"):
        c.r(w, 0, (0, 0, 0)).r(w, 16, (70, 0, 0)).r(w, 30, (70, 0, 0)).r(w, 36, (-40, 0, 0)).r(w, 44, (0, 0, 0))
    clips.append(c)

    c = Clip("defense", 30, loop=False)
    for w in ("wing.L", "wing.R"):
        c.r(w, 0, (0, 0, 0)).r(w, 6, (-10, 0, 0)).r(w, 22, (-10, 0, 0)).r(w, 30, (0, 0, 0))
    c.r("wing.L", 6, (-10, 0, -70)).r("wing.L", 22, (-10, 0, -70))
    c.r("wing.R", 6, (-10, 0, 70)).r("wing.R", 22, (-10, 0, 70))
    c.l("root", 0, (0, 0, 0)).l("root", 6, (0, 0.05, -0.08)).l("root", 22, (0, 0.05, -0.08)).l("root", 30, (0, 0, 0))
    clips.append(c)

    c = Clip("hit", 18, loop=False)
    c.r("body", 0, (0, 0, 0)).r("body", 3, (-20, 15, 0)).r("body", 18, (0, 0, 0))
    c.l("root", 0, (0, 0, 0)).l("root", 3, (0, 0.18, 0.05)).l("root", 18, (0, 0, 0))
    for w in ("wing.L", "wing.R"):
        c.r(w, 0, (0, 0, 0)).r(w, 3, (50, 0, 0)).r(w, 18, (0, 0, 0))
    clips.append(c)

    c = Clip("victory", 30)
    flap(c, 50, 3, base=20)
    c.l("root", 0, (0, 0, 0)).l("root", 15, (0, 0, 0.35)).l("root", 30, (0, 0, 0))
    c.r("root", 0, (0, 0, 0)).r("root", 30, (0, 0, 360))
    clips.append(c)

    c = Clip("defeat", 60)
    c.wave_r("wing.L", 0, 3, base=(-35, 0, 0)).wave_r("wing.R", 0, 3, base=(-35, 0, 0), phase=1)
    c.wave_r("head", 0, 3, base=(30, 0, 0)).wave_l("root", 2, 0.01, base=(0, 0, -0.25))
    clips.append(c)

    c = death_clip(fall=(0, 90, 0))
    c.l("root", 18, (0, 0, -0.35)).l("root", 36, (0, 0, -0.4))
    clips.append(c)
    clips.append(spawn_clip())
    return clips


# ================================================================== SERPENTE

SERP_SEGS = 6


def serpent_bones(h=1.0):
    s = lambda p: (p[0] * h, p[1] * h, p[2] * h)
    bones = [("root", s((0, 0, 0)), s((0, 0, 0.2)), None)]
    prev = "root"
    y0 = 0.75
    for i in range(SERP_SEGS):
        y1 = y0 - 0.22
        z0 = 0.16 + (0.10 * max(0, i - 3))
        z1 = 0.16 + (0.10 * max(0, i - 2))
        name = f"seg{i}"
        bones.append((name, s((0, y0, z0)), s((0, y1, z1)), prev))
        prev = name
        y0 = y1
    bones.append(("head", s((0, y0, 0.16 + 0.10 * (SERP_SEGS - 2))), s((0, y0 - 0.32, 0.16 + 0.10 * (SERP_SEGS - 2) + 0.06)), prev))
    return bones


def serpent_clips():
    def slither(c, amp, cycles=1, lift=0.0):
        for i in range(SERP_SEGS):
            c.wave_r(f"seg{i}", 2, amp * (0.5 + i / SERP_SEGS), phase=i * 0.9, cycles=cycles, steps=8 * cycles,
                     base=(-lift * (1 if i >= SERP_SEGS - 2 else 0), 0, 0))
        c.wave_r("head", 2, -amp * 0.6, phase=SERP_SEGS * 0.9, cycles=cycles, steps=8 * cycles)

    clips = []
    c = Clip("idle", 60)
    slither(c, 6)
    c.wave_r("head", 0, 6, phase=1)
    clips.append(c)
    c = Clip("walk", 30)
    slither(c, 16, cycles=1)
    clips.append(c)
    c = Clip("run", 18)
    slither(c, 24, cycles=1)
    clips.append(c)

    c = Clip("attack", 24, loop=False)
    for i in range(SERP_SEGS - 2, SERP_SEGS):
        n = f"seg{i}"
        c.r(n, 0, (0, 0, 0)).r(n, 8, (-25, 0, 0)).r(n, 12, (25, 0, 0)).r(n, 24, (0, 0, 0))
    c.r("head", 0, (0, 0, 0)).r("head", 8, (-20, 0, 0)).r("head", 12, (30, 0, 0)).r("head", 24, (0, 0, 0))
    c.l("root", 0, (0, 0, 0)).l("root", 8, (0, 0.1, 0)).l("root", 12, (0, -0.35, 0)).l("root", 24, (0, 0, 0))
    clips.append(c)

    c = Clip("special", 44, loop=False)
    for i in range(SERP_SEGS):
        n = f"seg{i}"
        c.r(n, 0, (0, 0, 0)).r(n, 14, (-12, 0, 30)).r(n, 30, (-12, 0, 30)).r(n, 44, (0, 0, 0))
    c.r("head", 0, (0, 0, 0)).r("head", 14, (-30, 0, 0)).r("head", 22, (-30, 0, 20)).r("head", 30, (25, 0, 0)).r("head", 44, (0, 0, 0))
    clips.append(c)

    c = Clip("defense", 30, loop=False)
    for i in range(SERP_SEGS):
        n = f"seg{i}"
        c.r(n, 0, (0, 0, 0)).r(n, 6, (0, 0, 35 if i % 2 else -35)).r(n, 22, (0, 0, 35 if i % 2 else -35)).r(n, 30, (0, 0, 0))
    c.r("head", 0, (0, 0, 0)).r("head", 6, (20, 0, 0)).r("head", 22, (20, 0, 0)).r("head", 30, (0, 0, 0))
    clips.append(c)

    c = Clip("hit", 18, loop=False)
    c.r("head", 0, (0, 0, 0)).r("head", 3, (-30, 0, 20)).r("head", 18, (0, 0, 0))
    c.r(f"seg{SERP_SEGS - 1}", 0, (0, 0, 0)).r(f"seg{SERP_SEGS - 1}", 3, (-20, 0, 0)).r(f"seg{SERP_SEGS - 1}", 18, (0, 0, 0))
    c.l("root", 0, (0, 0, 0)).l("root", 3, (0, 0.15, 0)).l("root", 18, (0, 0, 0))
    clips.append(c)

    c = Clip("victory", 40)
    slither(c, 20, cycles=2, lift=20)
    c.l("root", 0, (0, 0, 0)).l("root", 10, (0, 0, 0.15)).l("root", 20, (0, 0, 0)).l("root", 30, (0, 0, 0.15)).l("root", 40, (0, 0, 0))
    clips.append(c)

    c = Clip("defeat", 60)
    for i in range(SERP_SEGS):
        c.wave_r(f"seg{i}", 2, 2, base=(15 if i >= SERP_SEGS - 2 else 0, 0, 0))
    c.wave_r("head", 0, 3, base=(30, 0, 0))
    clips.append(c)

    clips.append(death_clip(fall=(0, 80, 0)))
    clips.append(spawn_clip())
    return clips


ARCHETYPES = {
    "biped": (biped_bones, biped_clips),
    "quad": (quad_bones, quad_clips),
    "blob": (blob_bones, blob_clips),
    "flyer": (flyer_bones, flyer_clips),
    "serpent": (serpent_bones, serpent_clips),
}
