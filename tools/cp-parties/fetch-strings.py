#!/usr/bin/env python3
"""Textos do jogo das festas de 2013-2017 (game_strings.json originais
guardados no Wayback Machine, em inglês e português). As falas das telas das
festas ("w.p2014.halloween.dialogue.login.1"…) vêm daqui.

Saída: <out>/parties-strings.json = {"pt": {chave: texto}, "en": {...}, "snapshots": [...]}
(só chaves de festas/telas novas: w.p20xx.*, w.app.*, w.party.*).

Uso: python3 fetch-strings.py out
"""
import json
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch import get  # noqa: E402

HOSTS = ['media1.clubpenguin.com', 'media8.clubpenguin.com', 'play.clubpenguin.com']
KEEP = re.compile(r'^w\.(p20\d\d|p\d{4}|app|party|avatarSprite|questui)\b')


def lang_map(data):
    out = {}
    rows = data.get('lang') if isinstance(data, dict) else None
    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, list) and len(row) >= 2 and isinstance(row[0], str):
                out[row[0]] = row[1]
    elif isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, str):
                out[k] = v
    return out


def main():
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    result = {'pt': {}, 'en': {}, 'snapshots': []}
    for lang in ('pt', 'en'):
        for host in HOSTS:
            target = f'{host}/play/{lang}/web_service/game_configs/game_strings.json'
            cdx = ('https://web.archive.org/cdx/search/cdx?url=' + urllib.parse.quote(target)
                   + '&matchType=prefix&from=2013&to=2017&filter=statuscode:200&collapse=digest&fl=timestamp,original')
            try:
                rows = get(cdx, tries=5).decode('utf-8', 'replace').split('\n')
            except Exception as e:  # noqa: BLE001
                print(f'!! cdx {target}: {e}')
                continue
            # do mais novo pro mais velho: o texto final de cada chave é o mais recente
            for row in reversed([r for r in rows if r.strip()]):
                parts = row.split()
                if len(parts) < 2:
                    continue
                ts, orig = parts[0], parts[1]
                try:
                    data = json.loads(get(f'https://web.archive.org/web/{ts}id_/{orig}', tries=4).decode('utf-8', 'replace'))
                except Exception as e:  # noqa: BLE001
                    print(f'   !! {lang} {ts}: {e}')
                    continue
                n = 0
                for k, v in lang_map(data).items():
                    if KEEP.match(k) and k not in result[lang]:
                        result[lang][k] = v
                        n += 1
                result['snapshots'].append(f'{lang}:{ts}')
                print(f'{lang} {ts}: +{n}')
                time.sleep(1.5)
    with open(os.path.join(out_dir, 'parties-strings.json'), 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=0, sort_keys=True)
    print(f'textos: {len(result["pt"])} pt, {len(result["en"])} en')


if __name__ == '__main__':
    main()
