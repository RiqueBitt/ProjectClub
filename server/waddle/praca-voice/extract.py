import struct, zlib, base64, sys
import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
d=open('voice.swf','rb').read()
body = zlib.decompress(d[8:]) if d[:3]==b'CWS' else d[8:]
nb = body[0]>>3; off = (5+4*nb+7)//8 + 4
tags=[]
while off < len(body):
    h=struct.unpack_from('<H',body,off)[0]; code=h>>6; ln=h&63; hl=2
    if ln==63: ln=struct.unpack_from('<I',body,off+2)[0]; hl=6
    tags.append((code, body[off:off+hl+ln])); off+=hl+ln
    if code==0: break
act=[t for c,t in tags if c==12]
print([c for c,t in tags], len(act[0]))
# força cabeçalho longo (6 bytes) — tamanho independente
raw=act[0]; h=struct.unpack_from('<H',raw,0)[0]; ln=h&63
bodyb = raw[6:] if ln==63 else raw[2:]
tagb = struct.pack('<HI',(12<<6)|63,len(bodyb))+bodyb
b64=base64.b64encode(tagb).decode()
out=sys.argv[1] if len(sys.argv) > 1 else '../src/server/file-server/praca-voice-action.ts'
open(out,'w').write("""/**
 * GERADO (Project Club) — não editar à mão.
 * Tag DoAction (AVM1) com os botões de voz Falar/Ouvir dentro da barra do jogo.
 * Fonte: server/waddle/praca-voice/voice.as.tpl (compilada com o JPEXS FFDec);
 * inserida no 1º quadro do interface.swf por swf-patches.ts.
 */
export const PRACA_VOICE_DOACTION = Buffer.from(
  '"""+b64+"""',
  'base64',
);
""")
print('ok', len(tagb))
