// Inventário das rotas da API: caminho, método e o que cada uma exige
// (login, cargo, segredo). Lê os arquivos de server/src/routes sem subir o
// servidor nem abrir conexão com banco.
//
//   node server/scripts/route-inventory.js            → tabela resumida
//   node server/scripts/route-inventory.js --json     → tudo em JSON
//   node server/scripts/route-inventory.js --public   → só as rotas sem login
//
// O teste server/test/routeInventory.test.js usa `inventory()` pra barrar
// rota nova sem proteção que não esteja na lista de rotas públicas
// conhecidas (server/test/fixtures/public-routes.json).
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.resolve(__dirname, '../src');
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'];
// Guardas que provam quem é a pessoa (ou o serviço) antes do controlador.
const AUTH_GUARDS = ['requireAuth', 'requirePlatformAdmin', 'requireStaff', 'requireOwner', 'requireAdmin', 'requireInternal', 'requireCommunityPermission'];
const ROLE_GUARDS = ['requirePlatformAdmin', 'requireStaff', 'requireOwner', 'requireAdmin', 'requireInternal', 'requireCommunityPermission'];

// Divide "a, b(c, d), e" nas vírgulas de fora.
function splitArgs(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === '\\') { cur += text[i + 1] || ''; i += 1; } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth += 1;
    if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Texto entre o "(" em `open` e o ")" que fecha.
function callBody(src, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') i += 1; else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (ch === '(') depth += 1;
    if (ch === ')') { depth -= 1; if (depth === 0) return src.slice(open + 1, i); }
  }
  return '';
}

// Variáveis locais que são um conjunto de guardas (ex.: `const staff = [requireAuth, requireStaff]`).
function localGuardSets(src) {
  const sets = {};
  const re = /const\s+(\w+)\s*=\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(src))) {
    const names = m[2].split(',').map((s) => s.trim()).filter((s) => /^\w+(\(.*\))?$/.test(s));
    if (names.some((n) => AUTH_GUARDS.some((g) => n.startsWith(g)))) sets[m[1]] = names;
  }
  return sets;
}

function guardsIn(args, sets) {
  const found = new Set();
  for (const a of args) {
    const name = a.replace(/^\.\.\./, '');
    for (const g of AUTH_GUARDS) if (new RegExp(`(^|[^\\w])${g}\\b`).test(name)) found.add(g);
    const set = sets[name.replace(/\(.*$/, '')];
    if (set) for (const n of set) for (const g of AUTH_GUARDS) if (n.startsWith(g)) found.add(g);
  }
  return [...found];
}

// Rotas de um arquivo: [{ router, method, path, guards }]
function routesOfFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sets = localGuardSets(src);
  // Quais variáveis do arquivo são um Router (`const x = express.Router()`).
  const routerNames = new Set();
  let d;
  const reDecl = /(?:const|let|var)\s+(\w+)\s*=\s*(?:express\.)?Router\(/g;
  while ((d = reDecl.exec(src))) routerNames.add(d[1]);
  const routers = {}; // nome → [{ prefix, guards }] ligadas até ali por router.use(...)
  const out = [];
  const re = /(^|[^\w.])(\w+)\.(use|get|post|put|patch|delete|all)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const [, , name, method] = m;
    if (!routerNames.has(name)) continue;
    const open = m.index + m[0].length - 1;
    const args = splitArgs(callBody(src, open));
    routers[name] = routers[name] || [];
    if (method === 'use') {
      // router.use(guarda) vale pra tudo que vem depois;
      // router.use('/admin', guarda) só pros caminhos que começam com /admin.
      const scoped = args.length && /^['"`]/.test(args[0]);
      const prefix = scoped ? args[0].replace(/^['"`]|['"`]$/g, '') : '';
      const guards = guardsIn(scoped ? args.slice(1) : args, sets);
      if (guards.length) routers[name].push({ prefix, guards });
      continue;
    }
    if (!METHODS.includes(method) || !args.length || !/^['"`\[/]/.test(args[0])) continue;
    const routePath = args[0].replace(/^['"`]|['"`]$/g, '');
    const inherited = routers[name]
      .filter((u) => !u.prefix || routePath === u.prefix || routePath.startsWith(`${u.prefix}/`))
      .flatMap((u) => u.guards);
    const guards = [...new Set([...inherited, ...guardsIn(args.slice(1), sets)])];
    out.push({ router: name, method: method.toUpperCase(), path: routePath, guards });
  }
  return out;
}

// Onde cada arquivo de rotas está montado (app.use('/api/x', ...)): no
// app.js e nos arquivos de rota que se montam sozinhos (`mount(app)`).
function mounts() {
  const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
  const vars = {}; // variável → arquivo
  let m;
  const reVar = /const\s+(\w+)\s*=\s*require\('\.\/routes\/(\w+)'\)(?:\.(\w+))?/g;
  while ((m = reVar.exec(app))) vars[m[1]] = { file: m[2], prop: m[3] || null };
  const out = [];
  const reUse = /app\.use\(\s*'(\/api[^']*)'\s*,/g;
  while ((m = reUse.exec(app))) {
    const args = splitArgs(callBody(app, m.index + 'app.use'.length));
    const last = args[args.length - 1];
    const extra = guardsIn(args.slice(1, -1), {});
    const inline = /require\('\.\/routes\/(\w+)'\)(?:\.(\w+))?/.exec(last);
    const target = inline ? { file: inline[1], prop: inline[2] || null } : vars[last];
    if (target) out.push({ prefix: m[1], ...target, guards: extra });
  }
  for (const f of fs.readdirSync(path.join(SRC, 'routes'))) {
    const src = fs.readFileSync(path.join(SRC, 'routes', f), 'utf8');
    const re = /app\.use\(\s*'(\/api[^']*)'\s*,/g;
    while ((m = re.exec(src))) {
      const args = splitArgs(callBody(src, m.index + 'app.use'.length));
      out.push({ prefix: m[1], file: f.replace(/\.js$/, ''), prop: args[args.length - 1], guards: guardsIn(args.slice(1, -1), {}) });
    }
  }
  return out;
}

// Rotas declaradas direto no app (app.get('/api/...')).
function appLevelRoutes() {
  const app = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
  const out = [];
  const re = /app\.(get|post|put|patch|delete)\(\s*'(\/(?:api|media)[^']*)'\s*,/g;
  let m;
  while ((m = re.exec(app))) {
    const args = splitArgs(callBody(app, m.index + `app.${m[1]}`.length));
    out.push({ file: 'app.js', method: m[1].toUpperCase(), path: m[2], guards: guardsIn(args.slice(1), {}) });
  }
  return out;
}

function inventory() {
  const all = appLevelRoutes().map((r) => ({
    ...r, auth: r.guards.some((g) => AUTH_GUARDS.includes(g)), role: r.guards.filter((g) => ROLE_GUARDS.includes(g)),
  }));
  for (const mt of mounts()) {
    const file = path.join(SRC, 'routes', `${mt.file}.js`);
    if (!fs.existsSync(file)) continue;
    let routes = routesOfFile(file);
    // arquivo com mais de um router: `.api`, `.router`, `.publicRouter` escolhem qual
    const names = [...new Set(routes.map((r) => r.router))];
    if (names.length > 1) {
      const want = mt.prop && names.includes(mt.prop) ? mt.prop : (mt.prop ? null : (names.includes('router') ? 'router' : names[0]));
      if (want) routes = routes.filter((r) => r.router === want);
    }
    for (const r of routes) {
      const guards = [...new Set([...mt.guards, ...r.guards])];
      all.push({
        file: `routes/${mt.file}.js`,
        method: r.method,
        path: `${mt.prefix}${r.path === '/' ? '' : r.path}`,
        guards,
        auth: guards.some((g) => AUTH_GUARDS.includes(g)),
        role: guards.filter((g) => ROLE_GUARDS.includes(g)),
      });
    }
  }
  return all;
}

module.exports = { inventory, routesOfFile, mounts, splitArgs };

if (require.main === module) {
  const all = inventory();
  const arg = process.argv[2];
  if (arg === '--json') {
    console.log(JSON.stringify(all, null, 1));
  } else if (arg === '--public') {
    for (const r of all.filter((x) => !x.auth)) console.log(`${r.method} ${r.path}  (${r.file})`);
  } else {
    const byFile = {};
    for (const r of all) {
      const f = byFile[r.file] || (byFile[r.file] = { total: 0, pub: 0, role: 0 });
      f.total += 1; if (!r.auth) f.pub += 1; if (r.role.length) f.role += 1;
    }
    console.log('arquivo'.padEnd(34), 'rotas', 'sem login', 'com cargo');
    for (const [f, v] of Object.entries(byFile)) console.log(f.padEnd(34), String(v.total).padStart(5), String(v.pub).padStart(9), String(v.role).padStart(9));
    console.log(`\ntotal: ${all.length} rotas · ${all.filter((x) => !x.auth).length} sem login · ${all.filter((x) => x.role.length).length} com cargo`);
  }
}
