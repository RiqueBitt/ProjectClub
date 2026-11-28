const test = require('node:test');
const assert = require('node:assert');
const { lookupIp, isPrivateIp, normalizeIp } = require('../src/services/ipGeo');

const reply = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => body });

test('ipGeo: IP privado/inválido não é consultado', async () => {
  for (const ip of ['10.0.0.1', '192.168.1.5', '127.0.0.1', '100.64.0.9', '::1', 'fd00::1', 'lixo', '']) {
    assert.ok(isPrivateIp(ip), ip);
    assert.equal(await lookupIp(ip, { fetchImpl: () => { throw new Error('não devia chamar'); } }), null);
  }
  assert.equal(normalizeIp('::ffff:179.1.2.3'), '179.1.2.3');
  assert.equal(normalizeIp('1.2.3.4:80'), null);
});

test('ipGeo: lê o ipwho.is', async () => {
  const g = await lookupIp('179.197.10.1', { fetchImpl: reply({
    success: true, country: 'Brasil', country_code: 'BR', region: 'Minas Gerais', region_code: 'MG', city: 'Belo Horizonte',
    latitude: -19.9, longitude: -43.9, timezone: { id: 'America/Sao_Paulo' }, connection: { isp: 'Claro', asn: 28573 },
  }) });
  assert.equal(g.city, 'Belo Horizonte');
  assert.equal(g.region, 'Minas Gerais');
  assert.equal(g.countryCode, 'BR');
  assert.equal(g.asn, 'AS28573');
});

test('ipGeo: cai pro ip-api.com quando o primeiro falha', async () => {
  let n = 0;
  const fetchImpl = async (url) => {
    n += 1;
    if (url.startsWith('https://ipwho.is')) return { ok: false, status: 429, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ status: 'success', country: 'Brasil', countryCode: 'BR', regionName: 'São Paulo', region: 'SP', city: 'Campinas', district: 'Centro', isp: 'Vivo', proxy: false, hosting: true, mobile: true }) };
  };
  const g = await lookupIp('200.10.20.30', { fetchImpl });
  assert.equal(n, 2);
  assert.equal(g.city, 'Campinas');
  assert.equal(g.district, 'Centro');
  assert.equal(g.proxy, true, 'hospedagem conta como proxy/VPN');
  assert.equal(g.mobile, true);
});

test('ipGeo: os dois fora → null', async () => {
  assert.equal(await lookupIp('8.8.4.4', { fetchImpl: reply({}, false) }), null);
});
