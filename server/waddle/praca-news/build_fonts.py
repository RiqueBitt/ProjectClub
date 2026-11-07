"""Gera as fontes (DefineFont3) usadas na tradução do jornal do Club Penguin.

O jornal de 2012 tem os textos como "texto estático" (DefineText) com fontes
recortadas: só as letras usadas em inglês, sem acentos. Para escrever em
português o servidor troca cada texto por um campo de texto (DefineEditText)
com estas fontes completas, feitas a partir da Proxima Nova (a mesma família
do jornal, das webfonts do site antigo do Club Penguin na mídia do Waddle).

Saída (../src/... não; vai pro servidor JS): server/src/services/waddle/news/fonts/
  <id>.bin   corpo da tag DefineFont3 (os 2 primeiros bytes = FontID, trocados na hora)
  fonts.json métricas (ascent/descent/leading e avanço de cada caractere, unidades da fonte SWF: EM = 20480)

Uso: python3 build_fonts.py <pasta com ProximaNova-Reg-webfont.woff2 e ProximaNova-Bold-webfont.woff2>
Precisa de: pip install fonttools brotli
"""
import json, os, struct, sys
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen

EM = 20480
CHARS = [c for c in range(32, 127)] + [c for c in range(160, 256)] + [0x2018, 0x2019, 0x201C, 0x201D, 0x2013, 0x2014, 0x2026, 0x2022, 0x20AC, 0x2122]

VARIANTS = [
    # id, arquivo, nome da fonte no SWF, escala horizontal (condensada)
    ('regular', 'ProximaNova-Reg-webfont.woff2', 'PC Proxima Regular', 1.0),
    ('semibold', 'ProximaNova-Bold-webfont.woff2', 'PC Proxima Semibold', 0.97),
    ('condensed', 'ProximaNova-Bold-webfont.woff2', 'PC Proxima Condensed', 0.80),
    ('italic', 'ProximaNova-Reg-webfont.woff2', 'PC Proxima Italic', 1.0),
]
SLANT = {'italic': 0.21}  # oblíqua (~12°): x += y * slant


class Bits:
    def __init__(self):
        self.bits = []

    def ub(self, v, n):
        for i in range(n - 1, -1, -1):
            self.bits.append((v >> i) & 1)

    def sb(self, v, n):
        self.ub(v & ((1 << n) - 1), n)

    def bytes(self):
        b = self.bits + [0] * ((8 - len(self.bits) % 8) % 8)
        return bytes(int(''.join(map(str, b[i:i + 8])), 2) for i in range(0, len(b), 8))


def nbits_s(*vals):
    n = 1
    for v in vals:
        need = (abs(v) if v >= 0 else abs(v) - 1).bit_length() + 1
        n = max(n, need)
    return n


def glyph_contours(font, gname, sx, scale, slant=0.0):
    pen = RecordingPen()
    font.getGlyphSet()[gname].draw(pen)
    contours = []
    cur = None
    for op, pts in pen.value:
        if op == 'moveTo':
            cur = [('M', pts[0])]
        elif op == 'lineTo':
            cur.append(('L', pts[0]))
        elif op == 'qCurveTo':
            # vários off-curve seguidos: on-curve implícito no meio
            offs = list(pts[:-1]); end = pts[-1]
            if end is None:  # contorno só de off-curves (sem moveTo)
                end = ((offs[0][0] + offs[-1][0]) / 2, (offs[0][1] + offs[-1][1]) / 2)
                cur = [('M', end)]
            for i, c in enumerate(offs):
                if i < len(offs) - 1:
                    nxt = offs[i + 1]
                    on = ((c[0] + nxt[0]) / 2, (c[1] + nxt[1]) / 2)
                else:
                    on = end
                cur.append(('Q', c, on))
        elif op == 'curveTo':
            raise SystemExit('fonte cúbica não suportada')
        elif op in ('closePath', 'endPath'):
            if cur:
                contours.append(cur)
            cur = None
    if cur:
        contours.append(cur)
    # coordenadas SWF: x*escala*condensação, y invertido
    def tr(p):
        return (round((p[0] + p[1] * slant) * scale * sx), round(-p[1] * scale))
    out = []
    for c in contours:
        o = []
        for seg in c:
            if seg[0] in ('M', 'L'):
                o.append((seg[0], tr(seg[1])))
            else:
                o.append(('Q', tr(seg[1]), tr(seg[2])))
        out.append(o)
    return out


def encode_shape(contours):
    b = Bits()
    b.ub(1, 4)  # NumFillBits
    b.ub(0, 4)  # NumLineBits
    first = True
    x = y = 0
    for c in contours:
        start = c[0][1]
        # StyleChangeRecord: moveTo (+ fill0 = 1 no primeiro)
        b.ub(0, 1)
        b.ub(0, 1); b.ub(0, 1); b.ub(0, 1)
        b.ub(1 if first else 0, 1)  # StateFillStyle0
        b.ub(1, 1)  # StateMoveTo
        n = nbits_s(start[0], start[1])
        b.ub(n, 5); b.sb(start[0], n); b.sb(start[1], n)
        if first:
            b.ub(1, 1)
            first = False
        x, y = start
        pts = c[1:]
        # fecha o contorno
        if pts and (pts[-1][1] if pts[-1][0] == 'L' else pts[-1][2]) != start:
            pts = pts + [('L', start)]
        elif not pts:
            continue
        for seg in pts:
            if seg[0] == 'L':
                dx, dy = seg[1][0] - x, seg[1][1] - y
                if dx == 0 and dy == 0:
                    continue
                n = max(2, nbits_s(dx, dy))
                b.ub(1, 1); b.ub(1, 1); b.ub(n - 2, 4)
                b.ub(1, 1)  # GeneralLineFlag
                b.sb(dx, n); b.sb(dy, n)
                x, y = seg[1]
            else:
                cdx, cdy = seg[1][0] - x, seg[1][1] - y
                adx, ady = seg[2][0] - seg[1][0], seg[2][1] - seg[1][1]
                n = max(2, nbits_s(cdx, cdy, adx, ady))
                b.ub(1, 1); b.ub(0, 1); b.ub(n - 2, 4)
                b.sb(cdx, n); b.sb(cdy, n); b.sb(adx, n); b.sb(ady, n)
                x, y = seg[2]
    b.ub(0, 6)  # EndShapeRecord
    return b.bytes()


def encode_rect(x0, x1, y0, y1):
    b = Bits()
    n = nbits_s(x0, x1, y0, y1)
    b.ub(n, 5)
    for v in (x0, x1, y0, y1):
        b.sb(v, n)
    return b.bytes()


def build(path, name, sx, slant=0.0):
    f = TTFont(path)
    upm = f['head'].unitsPerEm
    scale = EM / upm
    cmap = f.getBestCmap()
    hmtx = f['hmtx']
    chars = [c for c in CHARS if c in cmap]
    shapes, adv, bounds = [], [], []
    for c in chars:
        g = cmap[c]
        cont = glyph_contours(f, g, sx, scale, slant)
        shapes.append(encode_shape(cont))
        a = round(hmtx[g][0] * scale * sx)
        adv.append(a)
        xs = [p[1][0] for co in cont for p in co] + [p[2][0] for co in cont for p in co if p[0] == 'Q']
        ys = [p[1][1] for co in cont for p in co] + [p[2][1] for co in cont for p in co if p[0] == 'Q']
        bounds.append(encode_rect(min(xs), max(xs), min(ys), max(ys)) if xs else encode_rect(0, 0, 0, 0))
    ascent = round(f['hhea'].ascent * scale)
    descent = round(-f['hhea'].descent * scale)
    leading = round(f['hhea'].lineGap * scale)
    nb = name.encode('utf-8')
    n = len(chars)
    # tabela de offsets (u32, relativa ao início da própria tabela)
    off = 4 * n + 4
    offsets = []
    for s in shapes:
        offsets.append(off)
        off += len(s)
    code_off = off
    body = struct.pack('<H', 0)
    body += bytes([0x80 | 0x08 | 0x04, 1, len(nb)]) + nb
    body += struct.pack('<H', n)
    body += b''.join(struct.pack('<I', o) for o in offsets) + struct.pack('<I', code_off)
    body += b''.join(shapes)
    body += b''.join(struct.pack('<H', c) for c in chars)
    body += struct.pack('<HHh', ascent, descent, leading)
    body += b''.join(struct.pack('<h', max(-32768, min(32767, a))) for a in adv)
    body += b''.join(bounds)
    body += struct.pack('<H', 0)  # kerning
    metrics = {'name': name, 'ascent': ascent, 'descent': descent, 'leading': leading,
               'advances': {chr(c): a for c, a in zip(chars, adv)}}
    return body, metrics


def main():
    src = sys.argv[1]
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, '..', '..', 'src', 'services', 'waddle', 'news', 'fonts')
    os.makedirs(out, exist_ok=True)
    meta = {}
    for vid, fn, name, sx in VARIANTS:
        body, m = build(os.path.join(src, fn), name, sx, SLANT.get(vid, 0.0))
        open(os.path.join(out, vid + '.bin'), 'wb').write(body)
        meta[vid] = m
        print(vid, name, len(body), 'bytes', len(m['advances']), 'glifos')
    json.dump(meta, open(os.path.join(out, 'fonts.json'), 'w'), ensure_ascii=False)


if __name__ == '__main__':
    main()
