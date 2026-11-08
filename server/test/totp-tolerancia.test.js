'use strict';
// O código 2FA dos 30s anteriores (digitado no fim da janela ou com o
// relógio do celular um pouco atrasado) precisa ser aceito, como era na v12.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { generateSecret, generate, verify } = require('otplib');

test('código da janela anterior passa com epochTolerance 30', async () => {
  const secret = generateSecret();
  const prev = await generate({ secret, epoch: Math.floor(Date.now() / 1000) - 30 });
  assert.strictEqual((await verify({ secret, token: prev })).valid, false); // padrão do v13: só a janela atual
  assert.strictEqual((await verify({ secret, token: prev, epochTolerance: 30 })).valid, true);
  const old = await generate({ secret, epoch: Math.floor(Date.now() / 1000) - 120 });
  assert.strictEqual((await verify({ secret, token: old, epochTolerance: 30 })).valid, false); // 2 min atrás continua recusado
});

test('login usa epochTolerance na verificação do 2FA', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/controllers/authController.js'), 'utf8');
  assert.match(src, /epochTolerance:\s*30/);
});
