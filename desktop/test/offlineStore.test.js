// Arquivos do modo offline (offlineStore.js): conta, cópia do pinguim e VPNs
// usadas — gravação atômica, validação do formato e resumo pra tela.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOfflineStore, validateSnapshot, SNAPSHOT_FORMAT } = require('../offlineStore');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pc-offline-'));
const snapshot = (over = {}) => ({
  format: SNAPSHOT_FORMAT, version: 1, savedAt: '2026-11-06T10:00:00.000Z',
  user: { id: 7, username: 'rique', displayName: 'Rique' },
  penguin: { id: 1000, data: { name: 'Rique', color: 5, coins: 1234, is_member: true, inventory: [1, 2, 3, 101], puffles: [{ id: 1 }], stamps: [10, 11, 12] } },
  game: { version: '2012-11-06', calendarYear: 2012 },
  ...over,
});

test('conta: guarda só o necessário e lê de volta', () => {
  const s = createOfflineStore(tmp());
  assert.equal(s.getAccount(), null);
  const saved = s.setAccount({ id: 7, username: 'rique', displayName: 'Rique', avatarUrl: 'https://x/a.png', token: 'NUNCA' });
  assert.equal(saved.token, undefined);
  assert.equal(s.getAccount().username, 'rique');
  assert.equal(s.setAccount({ id: 'x' }), null, 'id inválido não grava');
  assert.equal(s.setAccount({ id: 8, username: 'b', avatarUrl: 'javascript:alert(1)' }).avatarUrl, null, 'avatar só http(s)');
});

test('praça: valida a cópia, grava por conta e resume pra tela', () => {
  const s = createOfflineStore(tmp());
  assert.equal(validateSnapshot(null), 'cópia vazia');
  assert.equal(validateSnapshot({ format: 'outro' }), 'formato desconhecido');
  assert.equal(validateSnapshot(snapshot({ penguin: { id: 1, data: { name: 'x' } } })), 'pinguim incompleto');
  assert.equal(validateSnapshot(snapshot()), null);
  assert.equal(s.savePraca({ format: 'outro' }).ok, false);
  const r = s.savePraca(snapshot());
  assert.equal(r.ok, true);
  assert.equal(r.items, 4);
  assert.equal(r.coins, 1234);
  assert.ok(fs.existsSync(s.pracaFile(7)));
  assert.ok(!fs.existsSync(`${s.pracaFile(7)}.${process.pid}.tmp`), 'sem arquivo temporário sobrando');
  assert.equal(s.getPraca(7).penguin.id, 1000);
  assert.equal(s.getPraca(8), null);
  const sum = s.pracaSummary(7);
  assert.deepEqual({ name: sum.name, coins: sum.coins, items: sum.items, puffles: sum.puffles, stamps: sum.stamps, member: sum.member }, { name: 'Rique', coins: 1234, items: 4, puffles: 1, stamps: 3, member: true });
  // cópia nova substitui a antiga (é só saída: nunca mistura)
  s.savePraca(snapshot({ penguin: { id: 1000, data: { ...snapshot().penguin.data, coins: 99 } } }));
  assert.equal(s.pracaSummary(7).coins, 99);
});

test('vpn: lembra as últimas configurações sem expor o texto na lista', () => {
  const s = createOfflineStore(tmp());
  assert.deepEqual(s.listVpn(), []);
  s.rememberVpn({ id: 'a', country: 'JP', countryName: 'Japão' }, 'client\nremote 1.2.3.4 1194');
  s.rememberVpn({ id: 'b', country: 'BR', countryName: 'Brasil' }, 'client\nremote 5.6.7.8 443');
  s.rememberVpn({ id: 'a', country: 'JP', countryName: 'Japão' }, 'client\nremote 1.2.3.4 1195');
  const list = s.listVpn();
  assert.deepEqual(list.map((x) => x.id), ['a', 'b'], 'reconectar move pro topo, sem duplicar');
  assert.equal(list[0].config, undefined, 'lista não carrega a configuração');
  assert.match(s.vpnConfig('a').config, /1195/);
  assert.equal(s.vpnConfig('zzz'), null);
  for (let i = 0; i < 12; i++) s.rememberVpn({ id: `s${i}` }, 'client');
  assert.ok(s.listVpn().length <= 8, 'no máximo 8 guardadas');
});
