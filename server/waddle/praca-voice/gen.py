"""Gera scripts/frame_1/DoAction.as a partir de voice.as.tpl (ver README.md)."""
import re
# meia-lua do botão da barra (forma 76 do interface.swf, coordenadas locais)
CRESCENT_D = 'M6.1 -5.1 Q1.1 -5.1 -2.4 -1.65 -5.45 1.4 -5.8 5.6 L-6.1 3.35 Q-6.1 -0.4 -3.45 -3.05 -0.85 -5.65 2.9 -5.65 4.6 -5.65 6.1 -5.1'

def path_cmds(d):
    toks = re.findall(r'[MLQ]|-?\d+(?:\.\d+)?', d)
    out = []; cmd = None; nums = []
    i = 0
    while i < len(toks):
        t = toks[i]
        if t in 'MLQ': cmd = t; i += 1; continue
        if cmd in ('M', 'L'):
            out.append((cmd, float(toks[i]), float(toks[i+1]))); i += 2
            if cmd == 'M': cmd = 'L'
        elif cmd == 'Q':
            out.append(('Q', float(toks[i]), float(toks[i+1]), float(toks[i+2]), float(toks[i+3]))); i += 4
    return out

def fmt(v): return ('%.4f' % v).rstrip('0').rstrip('.')

def emit_path(cmds, xexpr, yexpr):
    lines = []
    for c in cmds:
        if c[0] == 'M': lines.append('m.moveTo(%s, %s);' % (xexpr(c[1]), yexpr(c[2])))
        elif c[0] == 'L': lines.append('m.lineTo(%s, %s);' % (xexpr(c[1]), yexpr(c[2])))
        else: lines.append('m.curveTo(%s, %s, %s, %s);' % (xexpr(c[1]), yexpr(c[2]), xexpr(c[3]), yexpr(c[4])))
    return '\n   '.join(lines)

cres_d = CRESCENT_D
cres_fn = ['function pcvCrescent(m, sx, sy, tx, ty, col)', '{', '   m.beginFill(col, 100);',
           '   ' + emit_path(path_cmds(cres_d), lambda v: 'tx + %s * sx' % fmt(v), lambda v: 'ty + %s * sy' % fmt(v)),
           '   m.endFill();', '}']

import os
HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
src = open('voice.as.tpl').read().replace('/*CRESCENT*/', '\n'.join(cres_fn))
import os
os.makedirs('scripts/frame_1', exist_ok=True)
open('scripts/frame_1/DoAction.as', 'w', encoding='utf-8').write(src)
print(len(src), 'chars')
