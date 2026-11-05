#!/usr/bin/env python3
"""Liga as telas das festas (release: parties-ui-index.json) às festas e monta
as chaves extras de paths.json.

Entradas:
  parties-data.json      (server/src/services/waddle) — ganha "ui" por festa:
                         {caminho em play/v2/content/: arquivo}
  parties-ui-index.json  (release waddle-parties) — telas de cada festa
  parties-paths-union.json (release) — paths.json originais de 2013-2017
  party-keys.json        (tools/cp-parties) — chaves que as salas de cada
                         festa pedem (tiradas do código das salas)
Saída:
  parties-paths.json     (server/src/services/waddle) — {global, local} com as
                         chaves dos paths.json originais + as que casam com as
                         telas de cada festa pelo nome.

Uso: python3 build-ui.py parties-data.json parties-ui-index.json parties-paths-union.json party-keys.json parties-paths.json [parties-strings.json]

Com parties-strings.json: telas de fala (character_dialogue_*) só entram se os
textos dessa festa existem (sem eles o jogo mostraria a chave no balão).
"""
import json
import re
import sys

# chaves que são texto (falas, comunicador), não arquivos
TEXT_KEY = re.compile(r'dialogue\.|communicator|_text$|\.text\b|\.title\b|\.desc|\.msg\b|\.string|\.button|\.label', re.I)
SYNONYMS = {
    'partyinterface': ['quest', 'interface'],
    'questui': ['quest', 'interface'],
    'elevator': ['elevator'],
    'elevatorui': ['elevator'],
    'catalog': ['party'], 'catalogue': ['party'],
    'login': ['login'],
    'map': ['map'],
}


def key_tokens(key):
    parts = key.split('.')[1:]
    # tira o ano/código da festa (p2014, p1012…) e o nome da festa
    if parts and re.fullmatch(r'p\d{4}', parts[0]):
        parts = parts[2:] if len(parts) > 2 else parts[1:]
    toks = []
    for p in parts:
        for t in re.split(r'[_\W]+', p.lower()):
            if t and not t.isdigit():
                toks.extend(SYNONYMS.get(t, [t]))
    return toks, parts


def best_file(key, ui_paths):
    toks, parts = key_tokens(key)
    if not toks:
        return None
    num = next((p for p in reversed(parts) if p.isdigit()), None)
    scored = []
    for route in ui_paths:
        name = route.rsplit('/', 1)[-1][:-4]
        ntoks = set(re.split(r'_+', name))
        score = sum(1 for t in toks if t in ntoks or any(n.startswith(t) and len(t) >= 4 for n in ntoks))
        if num and num in name:
            score += 0.5
        if score:
            scored.append((score, -len(ntoks), -len(name), route))
    if not scored:
        return None
    scored.sort(reverse=True)
    if len(scored) > 1 and scored[0][:3] == scored[1][:3]:
        return None  # empate: não chuta
    return scored[0][3]


# casos que o nome não resolve (conferidos no código das salas)
OVERRIDES = {
    'w.p2014.halloween.ghost.1': 'local/en/close_ups/character_dialogue_ghost_intro.swf',
    'w.p2014.halloween.ghost.2': 'local/en/close_ups/character_dialogue_ghost_defeated.swf',
}


def main():
    data_file, ui_index_file, union_file, keys_file, out_file = sys.argv[1:6]
    strings = set()
    if len(sys.argv) > 6:
        st = json.load(open(sys.argv[6], encoding='utf-8'))
        strings = set(st.get('pt', {})) | set(st.get('en', {}))
    data = json.load(open(data_file, encoding='utf-8'))
    ui_index = json.load(open(ui_index_file, encoding='utf-8'))
    union = json.load(open(union_file, encoding='utf-8'))
    keys = json.load(open(keys_file, encoding='utf-8'))
    out = {'global': dict(union.get('global') or {}), 'local': dict(union.get('local') or {})}
    known = set(out['global']) | set(out['local'])
    added = 0
    for p in data['parties']:
        entries = ui_index.get(p['slug']) or []
        p['ui'] = {e['path']: e['name'] for e in entries}
        party_keys = keys.get(p['slug'], [])
        text_keys = [k for k in party_keys if TEXT_KEY.search(k)]
        has_text = bool(text_keys) and sum(1 for k in text_keys if k in strings) >= len(text_keys) / 2
        for key in party_keys:
            if key in known or TEXT_KEY.search(key):
                continue
            route = OVERRIDES.get(key) if OVERRIDES.get(key) in p['ui'] else best_file(key, p['ui'].keys())
            if not route:
                continue
            if 'character_dialogue' in route and not has_text:
                continue  # fala sem texto: melhor não abrir
            if route.startswith('local/en/'):
                out['local'][key] = route[len('local/en/'):]
            elif route.startswith('global/'):
                out['global'][key] = route[len('global/'):]
            known.add(key)
            added += 1
        print(f"{p['slug']}: {len(p['ui'])} telas", file=sys.stderr)
    with open(data_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=0, sort_keys=True)
    print(f'chaves: {len(out["global"])} global + {len(out["local"])} local ({added} casadas pelo nome)', file=sys.stderr)


if __name__ == '__main__':
    main()
