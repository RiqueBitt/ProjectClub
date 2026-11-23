'use strict';
// O instalador só leva os arquivos listados em package.json → build.files.
// Já aconteceu de um módulo novo (appIconShell.js) ficar de fora: no app
// instalado o require falhava em silêncio e o ícone escolhido nunca chegava
// aos atalhos do Windows. Este teste segue todos os require('./...') a partir
// do main.js e dos preloads e confere que cada arquivo entra no pacote.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const files = require('../package.json').build.files.filter((f) => typeof f === 'string');
const include = files.filter((f) => !f.startsWith('!'));
const exclude = files.filter((f) => f.startsWith('!')).map((f) => f.slice(1));

function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '{') { const end = glob.indexOf('}', i); re += `(${glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`; i = end; }
    else re += c.replace(/[.+^$()|[\]\\?]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const inc = include.map(globToRe);
const exc = exclude.map(globToRe);
const packaged = (rel) => inc.some((r) => r.test(rel)) && !exc.some((r) => r.test(rel));

function localRequires(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/(?:require|lazy)\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) out.add(m[1]);
  return [...out];
}

function resolveLocal(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]) {
    try { if (fs.statSync(cand).isFile()) return cand; } catch { /* próximo */ }
  }
  return null;
}

test('todo arquivo que o app usa entra no instalador', () => {
  const pkgMain = require('../package.json').main || 'main.js';
  const queue = [pkgMain, 'preload.js', 'screenPickerPreload.js', 'conexaoPreload.js', 'browserGuestPreload.js']
    .map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
  const seen = new Set();
  const missing = [];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (rel !== 'package.json' && !packaged(rel)) missing.push(rel); // o package.json sempre vai
    if (!file.endsWith('.js')) continue;
    for (const spec of localRequires(file)) {
      const dep = resolveLocal(file, spec);
      if (dep && !path.relative(ROOT, dep).startsWith('..') && !dep.includes(`${path.sep}node_modules${path.sep}`)) queue.push(dep);
    }
  }
  assert.ok(seen.has(path.join(ROOT, 'appIconShell.js')), 'o main.js usa o appIconShell.js');
  assert.deepEqual(missing, [], `fora de package.json → build.files: ${missing.join(', ')}`);
});
