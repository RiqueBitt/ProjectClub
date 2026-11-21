"""Escritor mínimo de SWF (AS2) pra salas do Club Penguin — Project Club.

Só o que a sala do Lago precisa: bitmaps (JPEG com alpha / lossless),
formas vetoriais (polígonos sólidos e retângulos com bitmap), sprites com
vários quadros, PlaceObject2 com nome e um DoAction vazio (o script AS2 é
compilado depois pelo JPEXS FFDec com -importScript).
"""
import struct
import zlib
import io
from PIL import Image


class Bits:
    def __init__(self):
        self.bits = []

    def ub(self, n, v):
        if n == 0:
            return
        self.bits.append(format(v & ((1 << n) - 1), '0%db' % n))

    def sb(self, n, v):
        self.ub(n, v)

    def fb(self, n, v):  # fixed 16.16
        self.sb(n, int(round(v * 65536)))

    def align(self):
        s = ''.join(self.bits)
        s += '0' * ((8 - len(s) % 8) % 8)
        self.bits = [s]

    def bytes(self):
        self.align()
        s = ''.join(self.bits)
        return bytes(int(s[i:i + 8], 2) for i in range(0, len(s), 8))


def sbits(*vals):
    """bits necessários pra guardar os valores com sinal."""
    n = 1
    for v in vals:
        v = int(v)
        while not (-(1 << (n - 1)) <= v < (1 << (n - 1))):
            n += 1
    return n


def rect(xmin, xmax, ymin, ymax):
    b = Bits()
    n = sbits(xmin, xmax, ymin, ymax)
    b.ub(5, n)
    for v in (xmin, xmax, ymin, ymax):
        b.sb(n, int(v))
    return b.bytes()


def matrix_bits(b, sx=1.0, sy=1.0, tx=0, ty=0):
    """MATRIX dentro de um Bits (tx/ty em twips)."""
    if sx != 1.0 or sy != 1.0:
        b.ub(1, 1)
        n = sbits(int(round(sx * 65536)), int(round(sy * 65536)))
        b.ub(5, n)
        b.fb(n, sx)
        b.fb(n, sy)
    else:
        b.ub(1, 0)
    b.ub(1, 0)  # sem rotação
    n = sbits(tx, ty) if (tx or ty) else 0
    b.ub(5, n)
    b.sb(n, int(tx))
    b.sb(n, int(ty))


def matrix(sx=1.0, sy=1.0, tx=0, ty=0):
    b = Bits()
    matrix_bits(b, sx, sy, tx, ty)
    return b.bytes()


def tag(code, body):
    if len(body) < 63:
        return struct.pack('<H', (code << 6) | len(body)) + body
    return struct.pack('<HI', (code << 6) | 63, len(body)) + body


# ---- bitmaps -------------------------------------------------------------

def define_bits_lossless2(cid, img):
    """DefineBitsLossless2 (ARGB premultiplicado) a partir de PIL RGBA."""
    img = img.convert('RGBA')
    w, h = img.size
    px = bytearray()
    for r, g, b, a in img.getdata():
        px += bytes((a, r * a // 255, g * a // 255, b * a // 255))
    body = struct.pack('<HBHH', cid, 5, w, h) + zlib.compress(bytes(px), 9)
    return tag(36, body)


def define_bits_jpeg3(cid, img, quality=90):
    """DefineBitsJPEG3: JPEG + canal alpha (zlib). img PIL RGBA."""
    img = img.convert('RGBA')
    # o Flash/Ruffle tratam o RGB do JPEG3 como premultiplicado pelo alpha
    import numpy as np
    arr = np.array(img).astype(np.uint16)
    al = arr[:, :, 3:4]
    rgb = Image.fromarray(((arr[:, :, :3] * al + 127) // 255).astype(np.uint8), 'RGB')
    buf = io.BytesIO()
    rgb.save(buf, format='JPEG', quality=quality, optimize=True)
    jpg = buf.getvalue()
    alpha = zlib.compress(img.getchannel('A').tobytes(), 9)
    body = struct.pack('<HI', cid, len(jpg)) + jpg + alpha
    return tag(35, body)


def define_bits_jpeg2(cid, img, quality=90):
    rgb = img.convert('RGB')
    buf = io.BytesIO()
    rgb.save(buf, format='JPEG', quality=quality, optimize=True)
    return tag(21, struct.pack('<H', cid) + buf.getvalue())


# ---- formas --------------------------------------------------------------

def _edges(b, nbits, pts_twips):
    """linhas retas entre pontos consecutivos (já posicionado no 1º)."""
    px, py = pts_twips[0]
    for x, y in pts_twips[1:]:
        dx, dy = x - px, y - py
        b.ub(1, 1)  # edge
        b.ub(1, 1)  # straight
        b.ub(4, nbits - 2)
        b.ub(1, 1)  # general line
        b.sb(nbits, dx)
        b.sb(nbits, dy)
        px, py = x, y


def define_shape_polys(cid, polys, rgba):
    """DefineShape3 com vários polígonos (lista de listas de (x,y) em px)
    preenchidos com uma cor sólida. Buracos: polígono com orientação
    oposta (fill à direita das arestas = regra do Flash)."""
    pts = [(int(round(x * 20)), int(round(y * 20))) for p in polys for x, y in p]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    bounds = rect(min(xs), max(xs), min(ys), max(ys))
    b = Bits()
    # fill styles
    body = bytes([1, 0x00]) + bytes(rgba) + bytes([0])  # 1 fill sólido, 0 line styles
    b.ub(4, 1)  # NumFillBits
    b.ub(4, 0)  # NumLineBits
    first = True
    for poly in polys:
        tw = [(int(round(x * 20)), int(round(y * 20))) for x, y in poly]
        if tw[0] != tw[-1]:
            tw.append(tw[0])
        deltas = [tw[i + 1][j] - tw[i][j] for i in range(len(tw) - 1) for j in (0, 1)]
        nbits = max(2, sbits(*deltas))
        # style change: moveTo (+ fill1 na 1ª vez)
        b.ub(1, 0)
        b.ub(1, 0)  # new styles
        b.ub(1, 0)  # line style
        b.ub(1, 1 if first else 0)  # fill style 1
        b.ub(1, 0)  # fill style 0
        b.ub(1, 1)  # move to
        mb = sbits(tw[0][0], tw[0][1])
        b.ub(5, mb)
        b.sb(mb, tw[0][0])
        b.sb(mb, tw[0][1])
        if first:
            b.ub(1, 1)  # fill1 = 1
            first = False
        _edges(b, nbits, tw)
    b.ub(6, 0)  # end
    return tag(32, struct.pack('<H', cid) + bounds + body + b.bytes())


def define_shape_bitmap(cid, bitmap_id, w, h, x=0, y=0):
    """DefineShape3: retângulo (x,y,w,h em px) preenchido com o bitmap."""
    x0, y0, x1, y1 = x * 20, y * 20, (x + w) * 20, (y + h) * 20
    bounds = rect(x0, x1, y0, y1)
    mb = Bits()
    matrix_bits(mb, 20.0, 20.0, x0, y0)
    fill = bytes([1, 0x41]) + struct.pack('<H', bitmap_id) + mb.bytes() + bytes([0])
    b = Bits()
    b.ub(4, 1); b.ub(4, 0)
    b.ub(1, 0); b.ub(1, 0); b.ub(1, 0); b.ub(1, 1); b.ub(1, 0); b.ub(1, 1)
    n = sbits(x0, y0)
    b.ub(5, n); b.sb(n, x0); b.sb(n, y0)
    b.ub(1, 1)
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    nbits = max(2, sbits(x1 - x0, y1 - y0, -(x1 - x0), -(y1 - y0)))
    _edges(b, nbits, pts)
    b.ub(6, 0)
    return tag(32, struct.pack('<H', cid) + bounds + fill + b.bytes())


# ---- controle ------------------------------------------------------------

def place_object2(depth, cid=None, name=None, x=0, y=0, move=False, sx=1.0, sy=1.0):
    flags = 0
    if cid is not None:
        flags |= 0x02
    flags |= 0x04  # matrix
    if name:
        flags |= 0x20
    if move:
        flags |= 0x01
    body = bytes([flags]) + struct.pack('<H', depth)
    if cid is not None:
        body += struct.pack('<H', cid)
    body += matrix(sx, sy, tx=x * 20, ty=y * 20)
    if name:
        body += name.encode('utf-8') + b'\0'
    return tag(26, body)


def export_assets(pairs):
    """ExportAssets: [(cid, nome)] → dá pra attachMovie(nome) em AS2."""
    body = struct.pack('<H', len(pairs))
    for cid, name in pairs:
        body += struct.pack('<H', cid) + name.encode('utf-8') + b'\0'
    return tag(56, body)


def show_frame():
    return tag(1, b'')


def end():
    return tag(0, b'')


def define_sprite(cid, frames):
    """frames: lista de listas de tags (sem ShowFrame)."""
    body = struct.pack('<HH', cid, len(frames))
    for f in frames:
        body += b''.join(f) + show_frame()
    body += end()
    return tag(39, body)


def do_action_empty():
    return tag(12, b'\x00')


def swf(tags, w=760, h=480, fps=24, frames=1, version=8, bg=(0, 0, 0)):
    body = rect(0, w * 20, 0, h * 20) + struct.pack('<HH', fps << 8, frames)
    body += tag(69, struct.pack('<I', 0))  # FileAttributes
    body += tag(9, bytes(bg))
    body += b''.join(tags)
    return b'FWS' + bytes([version]) + struct.pack('<I', 8 + len(body)) + body
