#!/usr/bin/env python3
"""Lista os comandos XT (festa#acao) que as salas das festas mandam.
Entrada: pasta com as salas decompiladas pelo FFDec (-export script).
Uso: python3 party-commands.py pasta"""
import re,os,sys,glob,json,collections
root=sys.argv[1]
consts={}
files=glob.glob(root+'/*/scripts/**/*.as',recursive=True)
for f in files:
    cls=os.path.basename(f)[:-3]
    for m in re.finditer(r'static var (\w+) = "([^"]*)";',open(f,errors='ignore').read()):
        consts[(cls,m.group(1))]=m.group(2)
def res(expr):
    expr=expr.strip()
    m=re.fullmatch(r'"([^"]*)"',expr)
    if m: return m.group(1)
    m=re.fullmatch(r'(?:[\w.]+\.)?(\w+)\.(\w+)',expr)
    if m:
        v=consts.get((m.group(1),m.group(2)))
        if v is None:
            vals=collections.Counter(val for (c,n),val in consts.items() if n==m.group(2))
            v=vals.most_common(1)[0][0] if vals else '?'+m.group(2)
        return v
    return '?'+expr
out=collections.defaultdict(set)
for f in files:
    pass
    src=open(f,errors='ignore').read()
    for m in re.finditer(r'\.send\([^,]+PLAY_EXT,(.*?),\[(.*?)\],"str"',src):
        parts=[res(p) for p in re.split(r'\s\+\s',m.group(1))]
        cmd=''.join(parts)
        pkg=re.search(r'pcdec/([^/]+)/',f)
        out[cmd].add((pkg.group(1) if pkg else os.path.basename(f), m.group(2)[:40]))
for k in sorted(out): print(k, sorted(out[k])[:3])
