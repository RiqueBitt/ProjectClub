const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Sem banco: só a regra de endereço (middleware/honeypot.js).
const prismaId = path.resolve(__dirname, '../src/config/prisma.js');
require.cache[prismaId] = { id: prismaId, filename: prismaId, loaded: true, exports: {} };
const { isLocalOrPrivateIp } = require('../src/middleware/honeypot');

test('honeypot: endereço da própria máquina ou de rede interna nunca conta pro bloqueio', () => {
  for (const ip of ['127.0.0.1', '::ffff:127.0.0.1', '::1', '10.0.3.7', '192.168.0.10', '172.16.5.1', '172.31.255.1', 'fd12:3456::1', 'unknown', '']) {
    assert.equal(isLocalOrPrivateIp(ip), true, ip);
  }
});

test('honeypot: IP de fora continua sendo contado', () => {
  for (const ip of ['104.22.184.88', '::ffff:179.197.228.137', '172.32.0.1', '172.15.0.1', '2804:14c::1', '8.8.8.8']) {
    assert.equal(isLocalOrPrivateIp(ip), false, ip);
  }
});
