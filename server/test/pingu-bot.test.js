// Pingu (IA): quando responde e o que pode sair na resposta.
const test = require('node:test');
const assert = require('node:assert');
const { _test: t } = require('../src/services/pinguBot');

t.setPinguId('pingu-id');

test('responde quando chamam @pingu (sem ligar pra maiúsculas)', () => {
  assert.equal(t.isForPingu({ authorId: 'a', content: '@pingu bom dia' }), true);
  assert.equal(t.isForPingu({ authorId: 'a', content: 'oi @Pingu, tudo bem?' }), true);
});

test('não responde a e-mail, outro nome nem a si mesmo', () => {
  assert.equal(t.isForPingu({ authorId: 'a', content: 'manda pra x@pingu.com' }), false);
  assert.equal(t.isForPingu({ authorId: 'a', content: '@pinguim oi' }), false);
  assert.equal(t.isForPingu({ authorId: 'pingu-id', content: '@pingu oi' }), false);
});

test('responde a menção resolvida e a resposta a uma mensagem dele', () => {
  assert.equal(t.isForPingu({ authorId: 'a', content: 'oi' }, [{ targetType: 'USER', targetId: 'pingu-id' }]), true);
  assert.equal(t.isForPingu({ authorId: 'a', content: 'e aí?', replyTo: { authorId: 'pingu-id' } }), true);
});

test('a pergunta sai sem o @pingu', () => {
  assert.equal(t.cleanQuestion('@pingu bom dia'), 'bom dia');
  assert.equal(t.cleanQuestion('oi @Pingu, qual o melhor jeito de ganhar moedas?'), 'oi qual o melhor jeito de ganhar moedas?');
});

test('a resposta sai sem pensamento, sem imagem e sem @todos', () => {
  const out = t.cleanAnswer('<think>hmm</think>Olá! ![gato](https://x/y.png) Avisa @todos e @everyone');
  assert.ok(!out.includes('<think>'));
  assert.ok(!out.includes('!['));
  assert.ok(!/@todos\b/.test(out) && !/@everyone\b/.test(out));
  assert.ok(out.startsWith('Olá!'));
});

test('resposta muito longa é cortada', () => {
  assert.ok(t.cleanAnswer('a'.repeat(5000)).length <= 1800);
});
