#!/usr/bin/env python3
"""Gera server/src/services/waddle/parties-data.json a partir do índice baixado.

Entrada: parties.json (datas, nomes, quais são de outras marcas) e o index.json
da release waddle-parties (arquivos de cada página, na ordem da tabela
"Sala | Música"). Pra cada festa:
  - rooms: sala do jogo → arquivo. A sala sai do nome do arquivo
    (Rooms<Sala>-<Festa>.swf). Se a sala aparece mais de uma vez (fases da
    festa: construção, fogos…), vale a primeira fora de "construção"/"pré".
  - music: sala → id da música (o link de música logo depois da sala).
  - musicFiles: músicas que o WF não tem e vieram junto (id → arquivo).
  - haveMusic: ids de música que o WF já tem.
  - map: mapa da ilha decorado da festa (ContentMap-*.swf), quando existe.

Uso: python3 build-data.py parties.json index.json have-music.txt saida.json
"""
import json
import re
import sys

ROOMS = set('''town coffee book cave cavemine cove dance lounge light forest lake shop dock village rink dojo boiler
dojoext dojofire dojowater dojohide forts agent agentcom agentlobbysolo agentlobbymulti agentvr sport mtn shack eco
lodge attic pizza plaza pet berg mine beach beacon stage boxdimension underwater shipquarters shipnest ship shiphold
pitch'''.split()) | {f'party{i}' for i in range(1, 28)} | {'party', 'party99'}
ALIASES = {'agentlobby': 'agentlobbymulti', 'hq': 'agentcom', 'mtnwalk': 'mtn', 'skihill': 'mtn'}
SKIP_SECTION = re.compile(r'constru|pre-?party|sneak|teaser|beta', re.I)


def room_of(name):
    m = re.match(r'^Rooms([A-Za-z0-9]+?)(?:_\d+)?[-_]', name)
    if not m:
        m = re.match(r'^Rooms([A-Za-z0-9]+)', name)
    if not m:
        return None
    key = m.group(1).lower()
    key = ALIASES.get(key, key)
    return key if key in ROOMS else None


def main():
    cfg = json.load(open(sys.argv[1], encoding='utf-8'))
    index = json.load(open(sys.argv[2], encoding='utf-8'))
    have = {int(l) for l in open(sys.argv[3]) if l.strip().isdigit()}
    pages = {p['slug']: p for p in index['parties']}
    out = []
    for p in cfg['parties']:
        page = pages.get(p['slug'], {'files': []})
        files = page.get('files', [])
        rooms, music, music_files, have_music = {}, {}, {}, set()
        fallback = {}
        for i, f in enumerate(files):
            room = room_of(f['name'])
            if room is None:
                continue
            nxt = files[i + 1] if i + 1 < len(files) else None
            mid = None
            if nxt is not None:
                mm = re.match(r'^Music(\d+)\.swf$', nxt['name'], re.I)
                if mm:
                    mid = int(mm.group(1))
            suffixed = bool(re.search(r'_\d+\.swf$', f['name']))
            target = fallback if (SKIP_SECTION.search(f.get('section') or '') or suffixed) else rooms
            if room in target:
                continue
            target[room] = f['name']
            if mid is not None and target is rooms:
                music[room] = mid
                if mid in have:
                    have_music.add(mid)
                elif not nxt.get('have'):
                    music_files[str(mid)] = nxt['name']
        # sala que só existe numa fase alternativa: usa essa mesmo
        for room, name in fallback.items():
            rooms.setdefault(room, name)
        if not rooms:
            print(f'-- {p["slug"]}: nenhuma sala', file=sys.stderr)
        island_map = next((f['name'] for f in files if f['name'].lower().startswith('contentmap-')), None)
        out.append({
            'slug': p['slug'], 'name': p['name'], 'label': p['label'], 'year': p['year'],
            'start': p['start'], 'end': p['end'], 'licensed': bool(p.get('licensed')),
            'rooms': rooms, 'music': music, 'musicFiles': music_files, 'haveMusic': sorted(have_music),
            **({'map': island_map} if island_map else {}),
        })
        print(f'{p["slug"]}: {len(rooms)} salas, {len(music)} músicas ({len(music_files)} novas)', file=sys.stderr)
    data = {
        '_comment': 'Gerado por tools/cp-parties/build-data.py — não editar à mão.',
        'source': index.get('source'), 'generatedAt': index.get('generatedAt'), 'parties': out,
    }
    with open(sys.argv[4], 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
