"""build/map.swf (compilado pelo FFDec) → ../src/server/file-server/praca-lago-map-tags.ts

Pega todas as tags de definição + o DoAction do 1º quadro (tudo menos
FileAttributes, SetBackgroundColor, ShowFrame e End) e guarda em base64:
swf-patches.ts insere esses bytes antes do 1º ShowFrame do map.swf.
"""
import base64
import os
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'build', 'map.swf')
out = os.path.join(HERE, '..', 'src', 'server', 'file-server', 'praca-lago-map-tags.ts')

d = open(src, 'rb').read()
body = zlib.decompress(d[8:]) if d[:3] == b'CWS' else d[8:]
nb = body[0] >> 3
off = (5 + 4 * nb + 7) // 8 + 4
keep = []
codes = []
while off < len(body):
    h = struct.unpack_from('<H', body, off)[0]
    code = h >> 6; ln = h & 63; hl = 2
    if ln == 63:
        ln = struct.unpack_from('<I', body, off + 2)[0]; hl = 6
    raw = body[off:off + hl + ln]
    off += hl + ln
    if code == 0:
        break
    if code in (69, 9, 1):
        continue
    codes.append(code)
    keep.append(raw)
blob = b''.join(keep)
assert 12 in codes and 56 in codes, codes
open(out, 'w').write("""/**
 * GERADO (Project Club) — não editar à mão: server/waddle/praca-lago/ (python3 build_map.py …).
 * Tags do ícone do Lago no mapa (bitmap + sprite "pc_lago_icon" exportado) e o
 * DoAction (map.as) que o coloca em MAP.id_0 e liga o clique; swf-patches.ts
 * insere tudo no 1º quadro do map.swf.
 */
export const PRACA_LAGO_MAP_TAGS = Buffer.from(
  '""" + base64.b64encode(blob).decode() + """',
  'base64',
);
""")
print('tags', codes, len(blob), 'bytes →', os.path.relpath(out, HERE))
