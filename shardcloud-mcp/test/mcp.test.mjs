// Sobe o servidor MCP com uma API da Shard FALSA e fala com ele pelo
// cliente oficial (Streamable HTTP): autenticação, lista de ferramentas,
// envs com merge, deploy do GitHub (zip remontado) e cópia MySQL (fake).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import AdmZip from 'adm-zip';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// --- API falsa da Shard Cloud ---
const fake = express(); fake.use(express.json());
const state = { envs: { a1: [{ key: 'DATABASE_URL', value: 'mysql://old' }] }, created: [], updated: [] };
fake.use((req, res, next) => { if (req.headers.authorization !== 'Bearer shard-key') return res.status(401).json({ error: 'no' }); next(); });
fake.get('/api/user/me', (_q, r) => r.json({ user: { email: 'x@y' }, subscription: { plan: 'core' } }));
fake.get('/api/apps', (_q, r) => r.json([{ app: { id: 'a1', name: 'projectclub', language: 'node', ram: 2048, subdomain: 'pc' }, status: 'running', container_uptime_seconds: 10 }]));
fake.get('/api/apps/a1/envs', (_q, r) => r.json(state.envs.a1));
fake.put('/api/apps/a1/envs', (q, r) => { state.envs.a1 = q.body; r.json({ ok: true }); });
fake.post('/api/apps', express.raw({ type: '*/*', limit: '50mb' }), (q, r) => { state.created.push(q.body.length); r.json({ id: 'new1' }); });
fake.put('/api/apps/a1/file', express.raw({ type: '*/*', limit: '50mb' }), (q, r) => { state.updated.push(q.body.length); r.json({ ok: true }); });
fake.get('/api/databases', (_q, r) => r.json([{ database: { id: 'd1', name: 'pc-mysql', service_type: 'mysql', ram: 512, size: 10 }, replica_status: ['ok'] }]));
fake.get('/api/databases/d1/connection-url', (_q, r) => r.json({ connection_url: 'mysql://u:p@h:3306/db' }));
// GitHub falso: zipball com pasta raiz "owner-repo-sha/"
const gh = express();
gh.get('/repos/:o/:r/zipball/:ref', (_q, r) => { const z = new AdmZip(); z.addFile('o-r-abc/package.json', Buffer.from('{"name":"x"}')); z.addFile('o-r-abc/sub/src/index.js', Buffer.from('console.log(1)')); z.addFile('o-r-abc/node_modules/x/i.js', Buffer.from('')); z.addFile('o-r-abc/.env', Buffer.from('SECRET=1')); r.type('application/zip').send(z.toBuffer()); });

let fakeSrv, ghSrv, mcpSrv, client;
before(async () => {
  fakeSrv = http.createServer(fake); await new Promise((r) => fakeSrv.listen(0, '127.0.0.1', r));
  ghSrv = http.createServer(gh); await new Promise((r) => ghSrv.listen(0, '127.0.0.1', r));
  process.env.SHARDCLOUD_API_BASE = `http://127.0.0.1:${fakeSrv.address().port}/api`;
  process.env.SHARDCLOUD_API_KEY = 'shard-key';
  process.env.MCP_TOKEN = 'segredo-do-mcp-0123456789';
  process.env.NODE_ENV = 'test';
  // GitHub falso: troca a URL no módulo via variável global de teste.
  globalThis.__GH_BASE = `http://127.0.0.1:${ghSrv.address().port}`;
  const { default: app } = await import('../src/index.js');
  mcpSrv = http.createServer(app); await new Promise((r) => mcpSrv.listen(0, '127.0.0.1', r));
});
after(async () => { try { await client?.close(); } catch {} mcpSrv?.close(); fakeSrv?.close(); ghSrv?.close(); setTimeout(() => process.exit(0), 100).unref(); });

const url = (p) => new URL(`http://127.0.0.1:${mcpSrv.address().port}${p}`);
async function connect(path) { const c = new Client({ name: 't', version: '1' }); await c.connect(new StreamableHTTPClientTransport(url(path))); return c; }
const callText = async (name, args) => { const r = await client.callTool({ name, arguments: args }); const t = r.content[0].text; try { return JSON.parse(t); } catch { return t; } };

test('sem token → 401; com token no caminho → lista as ferramentas', async () => {
  const res = await fetch(url('/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
  assert.equal(res.status, 401);
  client = await connect('/mcp/segredo-do-mcp-0123456789');
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ['shard_list_apps', 'shard_set_envs', 'shard_deploy_from_github', 'shard_create_database', 'mysql_copy', 'mysql_compare', 'shard_list_backups']) assert.ok(names.includes(n), n);
  assert.ok(tools.length >= 35);
});

test('conta e apps passam pela API com o Bearer certo', async () => {
  assert.equal((await callText('shard_me', {})).subscription.plan, 'core');
  const apps = await callText('shard_list_apps', {});
  assert.deepEqual(apps, [{ id: 'a1', name: 'projectclub', language: 'node', ram: 2048, subdomain: 'pc', status: 'running', uptimeSec: 10 }]);
});

test('envs: mascara por padrão, merge sem perder as outras, null remove', async () => {
  const masked = await callText('shard_get_envs', { app_id: 'a1' });
  assert.notEqual(masked[0].value, 'mysql://old');
  await callText('shard_set_envs', { app_id: 'a1', envs: { REDIS_URL: 'redis://x', NOVA: '1' } });
  assert.deepEqual(state.envs.a1.map((e) => e.key).sort(), ['DATABASE_URL', 'NOVA', 'REDIS_URL']);
  await callText('shard_set_envs', { app_id: 'a1', envs: { NOVA: null } });
  assert.deepEqual(state.envs.a1.map((e) => e.key).sort(), ['DATABASE_URL', 'REDIS_URL']);
  const revealed = await callText('shard_get_envs', { app_id: 'a1', reveal: true });
  assert.equal(revealed.find((e) => e.key === 'DATABASE_URL').value, 'mysql://old');
});

test('deploy do GitHub: zip remontado na raiz, sem node_modules/.env, com .shardcloud; cria ou atualiza', async () => {
  const r = await callText('shard_deploy_from_github', { owner: 'o', repo: 'r', ref: 'main', shardcloud: { DISPLAY_NAME: 'PC', MAIN: 'src/index.js', MEMORY: 1024, SUBDOMAIN: 'pc' } });
  assert.equal(r.created.id, 'new1');
  assert.equal(state.created.length, 1);
  const r2 = await callText('shard_deploy_from_github', { owner: 'o', repo: 'r', ref: 'main', subdir: 'sub', app_id: 'a1', shardcloud: { MAIN: 'src/index.js', MEMORY: 256 } });
  assert.equal(r2.updated, 'a1');
  assert.equal(r2.files, 2, 'só src/index.js + .shardcloud');
});

test('render do .shardcloud', async () => {
  const t = await callText('shard_render_shardcloud', { config: { DISPLAY_NAME: 'Project Club', MAIN: 'server/src/index.js', MEMORY: 2048, VERSION: 'recommended', SUBDOMAIN: 'projectclub', CUSTOM_COMMAND: 'npm run deploy:start' } });
  assert.equal(t, 'DISPLAY_NAME=Project Club\nMAIN=server/src/index.js\nMEMORY=2048\nVERSION=recommended\nSUBDOMAIN=projectclub\nCUSTOM_COMMAND=npm run deploy:start\n');
});

test('bancos: lista e URL de conexão', async () => {
  const dbs = await callText('shard_list_databases', {});
  assert.equal(dbs[0].type, 'mysql');
  assert.equal((await callText('shard_database_connection_url', { database_id: 'd1' })).connection_url, 'mysql://u:p@h:3306/db');
});

test('ações destrutivas exigem confirm=true', async () => {
  const r = await client.callTool({ name: 'shard_delete_app', arguments: { app_id: 'a1', confirm: false } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /confirm=true/);
});
