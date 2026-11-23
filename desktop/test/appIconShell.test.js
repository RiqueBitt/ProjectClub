'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pngsToIco, applySystemIcon } = require('../appIconShell');

test('pngsToIco monta cabeçalho e deslocamentos certos', () => {
  const b = pngsToIco([{ size: 256, data: Buffer.from('a') }, { size: 16, data: Buffer.from('bb') }]);
  assert.strictEqual(b.readUInt16LE(2), 1);
  assert.strictEqual(b.readUInt16LE(4), 2);
  assert.strictEqual(b.readUInt8(6), 0); // 256 vira 0
  assert.strictEqual(b.readUInt8(22), 16);
  assert.strictEqual(b.readUInt32LE(18), 38);
  assert.strictEqual(b.readUInt32LE(34), 39);
  assert.strictEqual(b.length, 41);
});

test('Linux: troca o Icon= do .desktop do Project Club e volta ao original', { skip: process.platform !== 'linux' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-icon-'));
  const apps = path.join(home, '.local', 'share', 'applications');
  fs.mkdirSync(apps, { recursive: true });
  const f = path.join(apps, 'projectclub.desktop');
  fs.writeFileSync(f, '[Desktop Entry]\nName=Project Club\nExec=/opt/x/ProjectClub.AppImage %U\nIcon=appimagekit-projectclub\n');
  const other = path.join(apps, 'outro.desktop');
  fs.writeFileSync(other, '[Desktop Entry]\nName=Outro\nExec=/usr/bin/outro\nIcon=outro\n');
  const oldHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const app = { getPath: () => path.join(home, 'Desktop') };
    const n = applySystemIcon({ app, img: {}, userDataDir: '/tmp/ud', defaultIconPng: '/x/icon.png' });
    assert.strictEqual(n, 1);
    assert.match(fs.readFileSync(f, 'utf8'), /^Icon=\/tmp\/ud\/app-icon\.png$/m);
    assert.match(fs.readFileSync(f, 'utf8'), /^X-ProjectClub-OriginalIcon=appimagekit-projectclub$/m);
    assert.match(fs.readFileSync(other, 'utf8'), /^Icon=outro$/m);
    applySystemIcon({ app, img: null, userDataDir: '/tmp/ud', defaultIconPng: '/x/icon.png' });
    assert.match(fs.readFileSync(f, 'utf8'), /^Icon=appimagekit-projectclub$/m);
  } finally { process.env.HOME = oldHome; }
});

test('Windows: acha os atalhos também nas subpastas (fixados do Windows 11, pasta do menu Iniciar)', () => {
  const { windowsShortcuts } = require('../appIconShell');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-lnk-'));
  const mk = (rel) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); return f; };
  const want = [
    mk('Roaming/Microsoft/Windows/Start Menu/Programs/Project Club.lnk'),
    mk('Roaming/Microsoft/Windows/Start Menu/Programs/Project Club/Project Club.lnk'),
    mk('Roaming/Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar/Project Club.lnk'),
    mk('Roaming/Microsoft/Internet Explorer/Quick Launch/User Pinned/ImplicitAppShortcuts/abc123/Project Club.lnk'),
    mk('Desktop/Project Club.lnk'),
  ];
  mk('Roaming/Microsoft/Windows/Start Menu/Programs/leia-me.txt');
  const old = { APPDATA: process.env.APPDATA, ProgramData: process.env.ProgramData, PUBLIC: process.env.PUBLIC };
  process.env.APPDATA = path.join(tmp, 'Roaming');
  process.env.ProgramData = path.join(tmp, 'ProgramData');
  process.env.PUBLIC = path.join(tmp, 'Public');
  try {
    const got = windowsShortcuts({ getPath: () => path.join(tmp, 'Desktop') });
    assert.deepEqual([...got].sort(), [...want].sort());
  } finally {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
