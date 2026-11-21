#!/usr/bin/env python3
"""Tira de cada festa os valores padrao do cookie de progresso (VO) e o
PARTY_SERVICE (missoes/premios) das constantes. Base do
server/waddle/src/server/game-data/party-cookies.ts.
Uso: python3 party-cookies.py pasta-decompilada saida.json"""
import re,glob,json,os,collections,sys
root=sys.argv[1]
files=glob.glob(root+'/*/scripts/**/*.as',recursive=True)
def pkg_of(f):
    m=re.search(r'/world/(rooms201\d/\w+)/',f); return m.group(1) if m else None
handler_of_pkg={}; fields=collections.defaultdict(dict); service={}
def as2json(lit):
    j=re.sub(r'([{,\[])\s*([A-Za-z_]\w*)\s*:', r'\1"\2":', lit)
    return json.loads(j)
for f in files:
    p=pkg_of(f)
    if not p: continue
    src=open(f,errors='ignore').read()
    if f.endswith('CookieVO.as'):
        h=re.search(r'COOKIE_HANDLER_NAME = "([^"]+)"',src) or re.search(r'HANDLER_NAME = "([^"]+)"',src)
        if not h: continue
        h=h.group(1); handler_of_pkg[p]=h
        for m in re.finditer(r'if\(this\._jsonObject\.(\w+) == undefined\)\s*\{\s*return (.*?);\s*\}',src,re.S):
            try: fields[h][m.group(1)]=json.loads(m.group(2))
            except Exception: fields[h][m.group(1)]=m.group(2)
for f in files:
    p=pkg_of(f)
    if not p or p not in handler_of_pkg: continue
    src=open(f,errors='ignore').read()
    m=re.search(r'static var PARTY_SERVICE = (\{.*?\});\n',src)
    if m:
        try: service[handler_of_pkg[p]]=as2json(m.group(1))
        except Exception as e: print('!! service',p,e,file=sys.stderr)
out={h:{'defaults':fields[h],'service':service.get(h)} for h in sorted(set(handler_of_pkg.values()))}
json.dump(out,open(sys.argv[2],'w'),indent=1,ensure_ascii=False)
for h,v in out.items(): print(h, v['defaults'], 'service' if v['service'] else '-')
