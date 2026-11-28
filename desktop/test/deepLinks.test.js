// Links projectclub:// → endereço bonito do site (aceita nome OU id antigo).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDeepLink } = require('../deepLinks');

test('links bonitos: canal, dm, perfil, fórum e evento', () => {
  assert.equal(parseDeepLink('projectclub://canal/chat-geral'), '/canal/chat-geral');
  assert.equal(parseDeepLink('projectclub://dm/holanda'), '/dm/holanda');
  assert.equal(parseDeepLink('projectclub://perfil/Bia.x'), '/perfil/Bia.x');
  assert.equal(parseDeepLink('projectclub://forum/como-instalar-mods'), '/forum/como-instalar-mods');
  assert.equal(parseDeepLink('projectclub://evento/noite-de-jogos'), '/evento/noite-de-jogos');
});

test('formatos antigos (com id) continuam abrindo, agora na rota bonita', () => {
  const id = 'bcec6258-a00a-419c-bf33-01c2984f4161';
  assert.equal(parseDeepLink(`projectclub://channel/${id}`), `/canal/${id}`);
  assert.equal(parseDeepLink(`projectclub://user/${id}`), `/perfil/${id}`);
  assert.equal(parseDeepLink(`projectclub://post/${id}`), `/forum/${id}`);
  assert.equal(parseDeepLink(`projectclub:///post/${id}`), `/forum/${id}`);
  assert.equal(parseDeepLink('projectclub://invite/abc12'), '/cartas?sala=ABC12');
});

test('recusa qualquer coisa fora do padrão', () => {
  for (const bad of ['projectclub://canal/..', 'projectclub://canal/a b', 'projectclub://canal/%2e%2e', 'projectclub://canal/x/y',
    'projectclub://loja/x', 'projectclub://__proto__/x', 'projectclub://canal/<script>', 'https://canal/x', 'lixo']) {
    assert.equal(parseDeepLink(bad), null, bad);
  }
});
