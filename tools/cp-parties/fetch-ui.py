#!/usr/bin/env python3
"""Baixa as TELAS das festas de 2013-2017 (close-ups, catálogos, avisos de
sócio) da cópia da Club Penguin Archives e os paths.json originais do jogo
guardados no Wayback Machine.

Roda no GitHub Actions. Saída em out/parties/pcparties-ui/:
  - os SWFs (um por tela; quando existe versão em português, vem ela);
  - index.json: telas de cada festa ({slug: [{name, path, size, sha256}]});
  - paths-union.json: todas as chaves de paths.json de 2013-2017 (global/local).

`path` é o caminho que o jogo pede, relativo a play/v2/content/
(ex.: local/en/close_ups/quest_interface.swf).

Uso: python3 fetch-ui.py parties.json out
"""
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import PageParser, get  # noqa: E402

# Close_ups<Nome>-<Festa>.swf, PTClose_ups<Nome>-<Festa>.swf,
# Close_ups<Nome>-pt-<Festa>.swf, Catalogues<Nome>-<Festa>.swf, Membership…
UI = re.compile(r'^(?P<lang>EN|PT|FR|ES|DE|RU)?(?P<kind>Close_ups|Catalogues|Membership)(?P<name>[A-Za-z0-9_&]+?)(?:\.swf)?'
                r'(?:-(?P<lang2>en|pt|fr|es|de|ru))?(?:-(?P<party>[^.]+))?\.swf$')
# arquivos globais das festas de 2015+ (content/features.swf é a "configuração"
# da festa: missões, transformações, puffles pra adotar)
CONTENT = re.compile(r'^(?P<kind>Content)(?P<name>Party_icon|Features|Prompts|Logo)-(?P<party>[^.]+)\.swf$')
# fantasias das transformações das festas (w.avatarSprite.olaf → avatar/sprites/olaf.swf)
AVATAR = re.compile(r'^(?P<kind>AvatarSprites)(?P<name>[A-Za-z0-9_]+?)(?:-(?P<party>[^.]+))?\.swf$')
KIND_DIR = {'Close_ups': 'local/en/close_ups', 'Catalogues': 'local/en/catalogues', 'Membership': 'global/membership',
            'Content': 'global/content', 'AvatarSprites': 'global/avatar/sprites'}
LANG_RANK = {'pt': 0, '': 1, 'en': 2}

WAYBACK_TARGETS = [
    'media1.clubpenguin.com/play/en/web_service/game_configs/paths.json',
    'media8.clubpenguin.com/play/en/web_service/game_configs/paths.json',
    'play.clubpenguin.com/play/en/web_service/game_configs/paths.json',
]


def ui_path(m):
    name = m.group('name').strip('_').lower()
    if m.group('kind') == 'Content' and name == 'logo':
        return 'global/logo/logo.swf'
    return f"{KIND_DIR[m.group('kind')]}/{name}.swf"


def fetch_wayback(out_dir):
    union = {'global': {}, 'local': {}}
    snaps = []
    for target in WAYBACK_TARGETS:
        cdx = ('https://web.archive.org/cdx/search/cdx?url=' + urllib.parse.quote(target)
               + '&matchType=prefix&from=2013&to=2017&filter=statuscode:200&collapse=digest&fl=timestamp,original')
        try:
            rows = get(cdx, tries=5).decode('utf-8', 'replace').split('\n')
        except Exception as e:  # noqa: BLE001
            print(f'!! cdx {target}: {e}')
            continue
        for row in rows:
            parts = row.split()
            if len(parts) < 2:
                continue
            ts, orig = parts[0], parts[1]
            try:
                raw = get(f'https://web.archive.org/web/{ts}id_/{orig}', tries=4)
                data = json.loads(raw.decode('utf-8', 'replace'))
            except Exception as e:  # noqa: BLE001
                print(f'   !! {ts}: {e}')
                continue
            snaps.append(ts)
            for sec in union:
                for k, v in (data.get(sec) or {}).items():
                    if isinstance(v, str) and v:
                        union[sec].setdefault(k, v)
            time.sleep(1.5)
    with open(os.path.join(out_dir, 'paths-union.json'), 'w', encoding='utf-8') as f:
        json.dump({'snapshots': sorted(snaps), **union}, f, ensure_ascii=False, indent=0)
    print(f'paths.json: {len(snaps)} cópias, {len(union["global"])} global + {len(union["local"])} local')


def main():
    cfg = json.load(open(sys.argv[1], encoding='utf-8'))
    out = sys.argv[2]
    files_dir = os.path.join(out, 'parties', 'pcparties-ui')
    os.makedirs(files_dir, exist_ok=True)
    base = cfg['base']
    index = {}
    seen = {}
    for p in cfg['parties']:
        slug = p['slug']
        page_url = base + urllib.parse.quote(slug, safe=':_-&') + '.html'
        try:
            raw = get(page_url).decode('utf-8', 'replace')
        except Exception as e:  # noqa: BLE001
            print(f'!! {slug}: {e}')
            continue
        parser = PageParser()
        parser.feed(raw)
        best = {}  # path -> (rank, url, name)
        for link in parser.links:
            url = urllib.parse.urljoin(page_url, link['href'])
            name = urllib.parse.unquote(url.split('?')[0].rsplit('/', 1)[-1])
            m = UI.match(name) or CONTENT.match(name) or AVATAR.match(name)
            if not m:
                continue
            gd = m.groupdict()
            lang = (gd.get('lang') or gd.get('lang2') or '').lower()
            if lang not in LANG_RANK:
                continue
            # fases da festa (_2, _3…): fica a primeira
            path = ui_path(m)
            rank = (LANG_RANK[lang], 1 if re.search(r'_\d+$', gd.get('party') or '') else 0)
            if path not in best or rank < best[path][0]:
                best[path] = (rank, url, name)

        def fetch_one(item):
            path, (rank, url, name) = item
            if url in seen:
                return path, seen[url]
            try:
                data = get(url)
            except Exception as e:  # noqa: BLE001
                print(f'   !! {name}: {e}')
                return path, None
            if data[:3] not in (b'FWS', b'CWS', b'ZWS'):
                return path, None
            with open(os.path.join(files_dir, name), 'wb') as f:
                f.write(data)
            info = {'name': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
            seen[url] = info
            return path, info

        entries = []
        with ThreadPoolExecutor(max_workers=8) as pool:
            for path, info in pool.map(fetch_one, sorted(best.items())):
                if info:
                    entries.append({**info, 'path': path})
        index[slug] = entries
        print(f'{slug}: {len(entries)} telas')
    with open(os.path.join(files_dir, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    fetch_wayback(files_dir)
    total = sum(v['size'] for v in seen.values() if v)
    print(f'total: {len(seen)} arquivos, {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
