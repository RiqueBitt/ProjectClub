#!/usr/bin/env python3
"""Baixa as festas de 2013-2017 da cópia da Club Penguin Archives (Solero).

Roda no GitHub Actions (o servidor de desenvolvimento não alcança o site). Para
cada página em parties.json:
  - guarda o HTML (pra tirar datas e nomes depois);
  - acha todos os links .swf da página (salas, catálogos, cartões…), com o
    texto do link e o título da seção em que aparecem;
  - baixa cada arquivo uma vez para out/parties/pcparties/<arquivo>.
No fim grava out/parties/pcparties/index.json com tudo (sha256 e tamanho).

Só baixa salas (Rooms*.swf) e músicas (Music<id>.swf) — o resto da página
(catálogos, cartões, telas) é enorme e não é usado. Músicas que o Waddle
Forever já tem (have-music.txt) não são baixadas de novo.

Só biblioteca padrão do Python. Uso: python3 fetch.py parties.json out [have-music.txt]
"""
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser

UA = 'ProjectClub-archiver/1.0 (+https://projectclub.shardweb.app)'


def get(url, tries=4):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise last


class PageParser(HTMLParser):
    """Links .swf com o texto do link e a seção (h2/h3/h4) onde estão."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.section = ''
        self._in_heading = False
        self._heading_buf = []
        self._link = None
        self._link_buf = []
        self.title = ''
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('h1', 'h2', 'h3', 'h4'):
            self._in_heading = True
            self._heading_buf = []
        elif tag == 'title':
            self._in_title = True
        elif tag == 'a':
            href = a.get('href') or ''
            if re.search(r'\.swf(\?|$)', href, re.I):
                self._link = href
                self._link_buf = []

    def handle_endtag(self, tag):
        if tag in ('h1', 'h2', 'h3', 'h4') and self._in_heading:
            self._in_heading = False
            text = ' '.join(''.join(self._heading_buf).split())
            text = re.sub(r'\[\s*edit\s*\]', '', text).strip()
            if tag != 'h1' and text:
                self.section = text
        elif tag == 'title':
            self._in_title = False
        elif tag == 'a' and self._link is not None:
            self.links.append({
                'href': self._link,
                'text': ' '.join(''.join(self._link_buf).split()),
                'section': self.section,
            })
            self._link = None

    def handle_data(self, data):
        if self._in_heading:
            self._heading_buf.append(data)
        if self._in_title:
            self.title += data
        if self._link is not None:
            self._link_buf.append(data)


def infobox_text(raw):
    m = re.search(r'<table[^>]*class="[^"]*infobox[^"]*"[^>]*>(.*?)</table>', raw, re.S | re.I)
    if not m:
        return ''
    t = re.sub(r'<br\s*/?>', '\n', m.group(1), flags=re.I)
    t = re.sub(r'</t[rh]>', '\n', t, flags=re.I)
    t = re.sub(r'</td>', ' | ', t, flags=re.I)
    t = re.sub(r'<[^>]+>', '', t)
    t = html.unescape(t)
    return '\n'.join(' '.join(l.split()) for l in t.splitlines() if l.strip())


def main():
    cfg = json.load(open(sys.argv[1], encoding='utf-8'))
    out = sys.argv[2]
    files_dir = os.path.join(out, 'parties', 'pcparties')
    pages_dir = os.path.join(out, 'pages')
    os.makedirs(files_dir, exist_ok=True)
    os.makedirs(pages_dir, exist_ok=True)
    base = cfg['base']
    have_music = set()
    if len(sys.argv) > 3 and os.path.exists(sys.argv[3]):
        have_music = {l.strip() for l in open(sys.argv[3]) if l.strip()}
    wanted = re.compile(r'^(Rooms[A-Za-z0-9]+[-_].*|Music\d+(_\d+)?)\.swf$', re.I)
    seen = {}
    parties = []
    for p in cfg['parties']:
        slug = p['slug']
        page_url = base + urllib.parse.quote(slug, safe=':_-&') + '.html'
        try:
            raw = get(page_url).decode('utf-8', 'replace')
        except Exception as e:  # noqa: BLE001
            print(f'!! {slug}: página falhou: {e}')
            parties.append({**p, 'error': str(e), 'files': []})
            continue
        with open(os.path.join(pages_dir, re.sub(r'[^A-Za-z0-9_.-]', '_', slug) + '.html'), 'w', encoding='utf-8') as f:
            f.write(raw)
        parser = PageParser()
        parser.feed(raw)
        picked = []
        for link in parser.links:
            url = urllib.parse.urljoin(page_url, link['href'])
            name = urllib.parse.unquote(url.split('?')[0].rsplit('/', 1)[-1])
            if not name.lower().endswith('.swf') or not wanted.match(name):
                continue
            picked.append((url, name, link))

        def fetch_one(item):
            url, name = item
            try:
                data = get(url)
            except Exception as e:  # noqa: BLE001
                print(f'   !! {name}: {e}')
                return url, None
            if data[:3] not in (b'FWS', b'CWS', b'ZWS'):
                print(f'   !! {name}: não é SWF')
                return url, None
            with open(os.path.join(files_dir, name), 'wb') as f:
                f.write(data)
            return url, {'name': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

        todo = []
        for url, name, link in picked:
            mm = re.match(r'^Music(\d+)\.swf$', name, re.I)
            if (mm and mm.group(1) in have_music) or url in seen or (url, name) in todo:
                continue
            todo.append((url, name))
        with ThreadPoolExecutor(max_workers=8) as pool:
            for url, info in pool.map(fetch_one, todo):
                seen[url] = info

        files = []
        for url, name, link in picked:
            mm = re.match(r'^Music(\d+)\.swf$', name, re.I)
            if mm and mm.group(1) in have_music:
                files.append({'name': name, 'have': True, 'url': url, 'text': link['text'], 'section': link['section']})
                continue
            info = seen.get(url)
            if info:
                files.append({**info, 'url': url, 'text': link['text'], 'section': link['section']})
        title = re.sub(r'\s*[-|–].*$', '', parser.title).strip() or slug.replace('_', ' ')
        parties.append({**p, 'title': title, 'infobox': infobox_text(raw), 'files': files})
        print(f'{slug}: {len(files)} arquivos')
    index = {'source': base, 'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'parties': parties}
    with open(os.path.join(files_dir, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    total = sum(v['size'] for v in seen.values() if v)
    print(f'total: {sum(1 for v in seen.values() if v)} arquivos, {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
