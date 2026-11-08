const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mu = require('../src/services/mobileUpdate');

const apk = (tag) => ({ name: 'ProjectClub.apk', browser_download_url: `https://example.test/${tag}/ProjectClub.apk` });
const nativeJson = (tag) => ({ name: 'android-native.json', browser_download_url: `https://example.test/${tag}/android-native.json` });

test('compareVersions', () => {
  assert.equal(mu.compareVersions('v1.2.3', '1.2.3'), 0);
  assert.equal(mu.compareVersions('v1.10.0', 'v1.9.9'), 1);
  assert.equal(mu.compareVersions('v1.2.3', 'v2.0.0'), -1);
  assert.equal(mu.compareVersions('', 'v1.0.0'), null);
  assert.equal(mu.compareVersions('abc', 'v1.0.0'), null);
});

test('conteúdo novo publicado → webUpdate', () => {
  const r = mu.decideUpdate({ native: 'v1.3.0', current: '2026.10.01-1200', manifest: { webVersion: '2026.10.12-0900', latestNativeVersion: 'v1.3.0', minNativeVersion: 'v1.2.0' } });
  assert.equal(r.webUpdate, true);
  assert.equal(r.webVersion, '2026.10.12-0900');
  assert.equal(r.nativeUpdateRequired, false);
  assert.equal(r.apkUrl, null);
});

test('mesma versão → nada pra atualizar', () => {
  const r = mu.decideUpdate({ native: 'v1.3.0', current: 'abc', manifest: { webVersion: 'abc', latestNativeVersion: 'v1.3.0', minNativeVersion: 'v1.3.0' } });
  assert.equal(r.webUpdate, false);
  assert.equal(r.nativeUpdateRequired, false);
  assert.equal(r.nativeUpdateAvailable, false);
});

test('minNativeVersion: só exige .apk novo quando a nativa instalada é mais velha que a mínima', () => {
  const manifest = { webVersion: 'w', latestNativeVersion: 'v1.5.0', minNativeVersion: 'v1.4.0', apkUrl: 'https://x/apk', notes: 'plugin novo' };
  const ok = mu.decideUpdate({ native: 'v1.4.2', current: 'w', manifest });
  assert.equal(ok.nativeUpdateRequired, false);
  assert.equal(ok.nativeUpdateAvailable, true); // existe .apk mais novo, mas é opcional
  const old = mu.decideUpdate({ native: 'v1.3.9', current: 'w', manifest });
  assert.equal(old.nativeUpdateRequired, true);
  assert.equal(old.apkUrl, 'https://x/apk');
  assert.equal(old.notes, 'plugin novo');
  // versão nativa desconhecida nunca dispara
  assert.equal(mu.decideUpdate({ native: '', current: 'w', manifest }).nativeUpdateRequired, false);
  // conteúdo desconhecido (app antigo sem a versão) não pede recarregar
  assert.equal(mu.decideUpdate({ native: 'v1.4.0', current: '', manifest }).webUpdate, false);
});

test('buildManifest usa a release mais nova COM .apk e o android-native.json dela', async () => {
  const releases = [
    { tag_name: 'v1.6.0', prerelease: false, assets: [] }, // build do Android falhou nessa
    { tag_name: 'v1.5.0', prerelease: false, body: 'novidades', assets: [apk('v1.5.0'), nativeJson('v1.5.0')] },
    { tag_name: 'v1.4.0', prerelease: false, assets: [apk('v1.4.0')] },
  ];
  const fetched = [];
  const fetchJson = async (url) => { fetched.push(url); return { version: 'v1.5.0', nativeHash: 'h', minNativeVersion: 'v1.2.0' }; };
  const m = await mu.buildManifest({ releases, fetchJson, webVersion: 'w1' });
  assert.equal(m.latestNativeVersion, 'v1.5.0');
  assert.equal(m.minNativeVersion, 'v1.2.0');
  assert.equal(m.apkUrl, 'https://example.test/v1.5.0/ProjectClub.apk');
  assert.equal(m.webVersion, 'w1');
  assert.deepEqual(fetched, ['https://example.test/v1.5.0/android-native.json']);
  // v1.3.0 instalado continua servindo (mínima é v1.2.0) → sem .apk novo
  assert.equal(mu.decideUpdate({ native: 'v1.3.0', current: 'w1', manifest: m }).nativeUpdateRequired, false);
});

test('buildManifest: release antiga sem android-native.json exige a última (comportamento anterior)', async () => {
  const releases = [{ tag_name: 'v1.4.0', prerelease: false, assets: [apk('v1.4.0')] }];
  const m = await mu.buildManifest({ releases, fetchJson: async () => { throw new Error('não deveria buscar'); }, webVersion: null });
  assert.equal(m.minNativeVersion, 'v1.4.0');
  assert.equal(mu.decideUpdate({ native: 'v1.3.0', current: '', manifest: m }).nativeUpdateRequired, true);
});

test('buildManifest: android-native.json inacessível cai no comportamento anterior', async () => {
  const releases = [{ tag_name: 'v2.0.0', prerelease: false, assets: [apk('v2.0.0'), nativeJson('v2.0.0')] }];
  const m = await mu.buildManifest({ releases, fetchJson: async () => { throw new Error('404'); }, webVersion: null });
  assert.equal(m.minNativeVersion, 'v2.0.0');
});

test('readWebVersion lê client/dist/version.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcver-'));
  const file = path.join(dir, 'version.json');
  assert.equal(mu.readWebVersion(file), null);
  fs.writeFileSync(file, JSON.stringify({ web: '2026.10.12-0900' }));
  assert.equal(mu.readWebVersion(file), '2026.10.12-0900');
});

test('GET /api/mobile/update responde a decisão', async () => {
  const express = require('express');
  const original = mu.getManifest;
  mu.getManifest = async () => ({ webVersion: 'w2', latestNativeVersion: 'v1.5.0', minNativeVersion: 'v1.5.0', apkUrl: 'https://x/apk', notes: '' });
  const app = express();
  app.use('/api/mobile', require('../src/routes/mobile'));
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const a = await (await fetch(`http://127.0.0.1:${port}/api/mobile/update?native=v1.4.0&current=w1`)).json();
    assert.equal(a.webUpdate, true);
    assert.equal(a.nativeUpdateRequired, true);
    const b = await (await fetch(`http://127.0.0.1:${port}/api/mobile/update?native=v1.5.0&current=w2`)).json();
    assert.equal(b.webUpdate, false);
    assert.equal(b.nativeUpdateRequired, false);
    mu.getManifest = async () => { throw new Error('GitHub fora'); };
    const c = await (await fetch(`http://127.0.0.1:${port}/api/mobile/update?native=v1.0.0&current=w1`)).json();
    assert.equal(c.nativeUpdateRequired, false);
  } finally {
    mu.getManifest = original;
    server.close();
  }
});
