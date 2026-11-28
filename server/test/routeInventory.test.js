const test = require('node:test');
const assert = require('node:assert');
const { inventory, routesOfFile } = require('../scripts/route-inventory');

// Rotas que funcionam SEM login, de propósito (login, cadastro, páginas
// públicas, chamadas com segredo próprio). Rota nova sem `requireAuth` que
// não estiver nesta lista faz o teste falhar: ou ela ganha a proteção, ou
// entra aqui conscientemente.
const PUBLIC = require('./fixtures/public-routes.json');

test('inventário: a API tem rotas e a grande maioria exige login', () => {
  const all = inventory();
  assert.ok(all.length > 800, `esperava o inventário completo, veio ${all.length}`);
  assert.ok(all.filter((r) => r.auth).length / all.length > 0.9);
});

test('inventário: nenhuma rota sem login fora da lista de rotas públicas conhecidas', () => {
  const pub = inventory().filter((r) => !r.auth).map((r) => `${r.method} ${r.path}`).sort();
  const unexpected = pub.filter((r) => !PUBLIC.includes(r));
  assert.deepEqual(unexpected, [], `rota(s) sem login que não estão em test/fixtures/public-routes.json:\n${unexpected.join('\n')}`);
});

test('inventário: a lista de rotas públicas não guarda rota que já não existe', () => {
  const pub = new Set(inventory().filter((r) => !r.auth).map((r) => `${r.method} ${r.path}`));
  assert.deepEqual(PUBLIC.filter((r) => !pub.has(r)), []);
});

test('inventário: rotas de administração e de equipe exigem cargo', () => {
  const all = inventory();
  for (const prefix of ['/api/admin', '/api/dev', '/api/staff-ops', '/api/internal']) {
    const routes = all.filter((r) => r.path === prefix || r.path.startsWith(`${prefix}/`));
    assert.ok(routes.length > 0, `sem rotas em ${prefix}?`);
    const open = routes.filter((r) => !r.role.length).map((r) => `${r.method} ${r.path}`);
    assert.deepEqual(open, [], `rotas de ${prefix} sem guarda de cargo`);
  }
});

test('inventário: router.use com caminho só protege o que está embaixo dele', (t) => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-rotas-')), 'x.js');
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  fs.writeFileSync(file, `
    const router = express.Router();
    router.get('/aberta', ctrl.a);
    router.use('/admin', requireAuth, requirePlatformAdmin);
    router.get('/admin/tudo', ctrl.b);
    router.get('/administrar', ctrl.c);
    router.use(requireAuth);
    router.post('/depois', ctrl.d);
  `);
  const byPath = Object.fromEntries(routesOfFile(file).map((r) => [r.path, r.guards]));
  assert.deepEqual(byPath['/aberta'], []);
  assert.deepEqual(byPath['/admin/tudo'], ['requireAuth', 'requirePlatformAdmin']);
  assert.deepEqual(byPath['/administrar'], []);
  assert.deepEqual(byPath['/depois'], ['requireAuth']);
});
