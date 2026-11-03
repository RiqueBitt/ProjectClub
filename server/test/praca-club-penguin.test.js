// Praça = Club Penguin (Waddle Forever embutido). Sem banco de verdade: o
// Prisma é um stub em memória só com o que o jogo usa (WaddlePenguin, User,
// PetPenguin). A mídia vem de uma pasta temporária com os poucos arquivos
// gerados/necessários; o que não existir cai no 404 normal (aqui não tem o
// bucket), o que já basta pra provar a cola HTTP + WebSocket + conta.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

const src = (rel) => path.resolve(__dirname, '../src', rel);
const stub = (rel, exports) => { require.cache[src(rel)] = { id: src(rel), filename: src(rel), loaded: true, exports }; };

// ---- Prisma em memória -----------------------------------------------------
const db = { waddle: new Map(), users: new Map(), pets: new Map() };
const user = { id: 'u1', username: 'riquebitt', displayName: 'Rique Bitt', isPlatformBanned: false, suspendedUntil: null, accountDisabledAt: null };
db.users.set(user.id, user);
db.pets.set(user.id, { color: 'red' });
const P2002 = (target) => Object.assign(new Error('unique'), { code: 'P2002', meta: { target } });
const prismaStub = {
  user: { findUnique: async ({ where }) => db.users.get(where.id) || null },
  petPenguin: { findUnique: async ({ where }) => db.pets.get(where.userId) || null },
  waddlePenguin: {
    findUnique: async ({ where }) => {
      if (where.id !== undefined) return db.waddle.get(where.id) || null;
      if (where.userId !== undefined) return [...db.waddle.values()].find((r) => r.userId === where.userId) || null;
      return null;
    },
    findFirst: async ({ where }) => [...db.waddle.values()].find((r) => r.name.toLowerCase() === String(where.name).toLowerCase()) || null,
    aggregate: async () => ({ _max: { id: db.waddle.size ? Math.max(...db.waddle.keys()) : null } }),
    create: async ({ data }) => {
      if (db.waddle.has(data.id)) throw P2002('id');
      if ([...db.waddle.values()].some((r) => r.name.toLowerCase() === data.name.toLowerCase())) throw P2002('name');
      const row = { userId: null, ...data }; db.waddle.set(data.id, row); return row;
    },
    upsert: async ({ where, create }) => { if (!db.waddle.has(where.id)) db.waddle.set(where.id, { userId: null, ...create }); return db.waddle.get(where.id); },
    update: async ({ where, data }) => { const row = db.waddle.get(where.id); Object.assign(row, data); return row; },
  },
};
stub('config/prisma.js', prismaStub);
stub('services/automod.js', { checkMessage: async ({ content }) => (/bloqueada/i.test(content) ? { rule: 'teste' } : null) });
stub('services/dmAutomod.js', { containsInviteLink: (t) => /discord\.gg/i.test(t) });

// ---- mídia mínima ----------------------------------------------------------
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-media-'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-data-'));
process.env.WADDLE_MEDIA_DIR = mediaDir;
process.env.WADDLE_DATA_DIR = dataDir;
delete process.env.WADDLE_MEDIA_URL;
process.env.WADDLE_MEDIA_RELEASE = ''; // sem rede nos testes
const realMedia = process.env.WADDLE_TEST_REAL_MEDIA; // opcional: cópia completa da mídia
const put = (rel, content) => { const f = path.join(mediaDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
if (!realMedia) {
  put('default/websites/classic-cpip-boots.html', '<html><head></head><body><object data="/boots.swf"><param name="flashvars" value="lang=en"></object></body></html>');
  // modo calendário (padrão) cai na era moderna (AS3): página com o cliente novo
  put('default/websites/classic-as3.html', '<html><head></head><body><object data="/play/v2/client/club_penguin.swf"><param name="flashvars" value="play=/play/&lang=en"></object></body></html>');
  put('default/websites/classic/css/baseline.css', 'body{}');
}

const waddle = require('../src/services/waddle');
const { signAccessToken } = require('../src/services/tokens');

let server; let base; let token;
test.before(async () => {
  const app = express();
  waddle.mountHttp(app);
  app.use((req, res) => res.status(404).send('site'));
  server = http.createServer(app);
  waddle.attachUpgrade(server);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  token = signAccessToken(user);
});
// O mundo do WF mantém timers (ticks das salas, jogos) que seguram o processo;
// cada arquivo de teste roda num processo próprio, então encerrar aqui é seguro.
test.after(() => { server.close(); setTimeout(() => process.exit(process.exitCode || 0), 200).unref(); });

test('o jogo sobe e responde só às rotas dele; o site continua dono do resto', async () => {
  const cfg = await waddle.getWaddle();
  assert.ok(cfg.settings.settings.version.startsWith('20'));
  // arquivo gerado dinamicamente pelo WF (não precisa de mídia)
  const setup = await fetch(`${base}/setup.xml`);
  assert.equal(setup.status, 200);
  assert.match(await setup.text(), /<Worlds>/);
  // página do site (não é do jogo) → cai no fallback
  const site = await fetch(`${base}/praca`);
  assert.equal(site.status, 404);
  assert.equal(await site.text(), 'site');
  // arquivo do site original do CP (dentro da pasta websites/<site>/)
  const css = await fetch(`${base}/css/baseline.css`);
  assert.equal(css.status, realMedia ? 200 : 200);
});

test('config da Praça cria o pinguim da conta com a cor do mascote e nome único', async () => {
  const cfg = await waddle.getConfig(user);
  assert.equal(cfg.entry.swf, '/play/v2/client/club_penguin.swf');
  assert.equal(cfg.as3, true);
  assert.match(cfg.version, /^2012-\d\d-\d\d$/); // calendário: hoje mapeado em 2012
  assert.equal(cfg.penguin.name, 'Rique Bitt');
  assert.equal(cfg.penguin.color, 5); // red
  assert.ok(cfg.penguin.id >= 1000);
  assert.deepEqual(cfg.socketProxy.map((p) => p.path), ['/waddle/ws/login', '/waddle/ws/world']);
  // segunda chamada reaproveita (não cria outro)
  const again = await waddle.getConfig(user);
  assert.equal(again.penguin.id, cfg.penguin.id);
  // mascotes foram criados com ids fixos
  assert.ok(db.waddle.get(1), 'Rockhopper & cia. existem');
  // outro usuário com o mesmo nome de exibição ganha nome diferente
  const u2 = { ...user, id: 'u2', username: 'outro' }; db.users.set('u2', u2);
  const cfg2 = await waddle.getConfig(u2);
  assert.notEqual(cfg2.penguin.name, cfg.penguin.name);
  assert.match(cfg2.penguin.name, /^Rique Bit|^Outro$/);
});

function wsClient(kind, query) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/waddle/ws/${kind}${query}`);
  const got = [];
  ws.on('message', (d) => got.push(d.toString().replace(/\0$/, '')));
  const send = (s) => ws.send(Buffer.from(`${s}\0`));
  return { ws, got, send, open: () => new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); ws.once('unexpected-response', (_, r) => rej(new Error(`HTTP ${r.statusCode}`))); }) };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('WebSocket exige o token do Project Club', async () => {
  await assert.rejects(wsClient('login', '').open(), /401/);
  await assert.rejects(wsClient('login', '?token=lixo').open(), /401/);
});

test('login pelo WebSocket é forçado pro pinguim da conta (o nick digitado é ignorado)', async () => {
  const sizeBefore = db.waddle.size;
  const c = wsClient('login', `?token=${token}`);
  await c.open();
  c.send("<msg t='sys'><body action='verChk' r='0'><ver v='153' /></body></msg>");
  c.send("<msg t='sys'><body action='rndK' r='-1'></body></msg>");
  c.send("<msg t='sys'><body action='login' z='w1' r='0'><login z='w1'><nick><![CDATA[Rockhopper]]></nick><pword><![CDATA[x]]></pword></login></body></msg>");
  await wait(400);
  assert.ok(c.got.some((m) => m.includes('apiOK')));
  const l = c.got.find((m) => m.startsWith('%xt%l%'));
  assert.ok(l, 'resposta de login');
  const { id } = await waddle.ensurePenguin(user);
  assert.equal(l.split('%')[4], String(id)); // id do pinguim da conta, não do Rockhopper
  assert.equal(db.waddle.size, sizeBefore, 'nenhum pinguim novo foi criado pelo login');
  c.ws.close();
});

test('mundo: entra, fala (com automod) e abrir em outro lugar derruba a sessão antiga', async () => {
  const { id } = await waddle.ensurePenguin(user);
  const a = wsClient('world', `?token=${token}`);
  await a.open();
  a.send("<msg t='sys'><body action='verChk' r='0'><ver v='153' /></body></msg>");
  a.send("<msg t='sys'><body action='rndK' r='-1'></body></msg>");
  // cliente moderno (2012, modo calendário): manda o ID no login do mundo —
  // o servidor troca pelo ID do pinguim da conta mesmo se vier outro número
  a.send("<msg t='sys'><body action='login' r='0'><login z='w1'><nick><![CDATA[1]]></nick><pword><![CDATA[y]]></pword></login></body></msg>");
  await wait(300);
  a.send(`%xt%s%j#js%-1%${id}%${id}%en%`);
  await wait(300);
  assert.ok(a.got.some((m) => m.startsWith('%xt%js%')), 'joinServer respondido');
  a.send(`%xt%s%j#jr%-1%100%0%0%`); // entra na Cidade
  await wait(300);
  assert.ok(a.got.some((m) => m.startsWith('%xt%jr%')), 'entrou na sala');
  const before = a.got.length;
  a.send(`%xt%s%m#sm%-1%${id}%oi gente%`);
  a.send(`%xt%s%m#sm%-1%${id}%mensagem bloqueada%`);
  a.send(`%xt%s%m#sm%-1%${id}%entra no discord.gg/abc%`);
  await wait(300);
  const chats = a.got.slice(before).filter((m) => m.startsWith('%xt%sm%'));
  assert.equal(chats.length, 1, 'só a fala limpa passou');
  assert.match(chats[0], /oi gente/);
  // segunda aba
  const b = wsClient('world', `?token=${token}`);
  const closed = new Promise((r) => a.ws.once('close', (code) => r(code)));
  await b.open();
  assert.equal(await closed, 4001);
  b.ws.close();
});
