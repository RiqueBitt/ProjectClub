// shardcloud-mcp — servidor MCP (Streamable HTTP) da Shard Cloud.
//
// Conecte no Claude (Configurações → Conectores → Adicionar conector
// personalizado) com a URL:  https://<SUBDOMAIN>.shardweb.app/mcp/<MCP_TOKEN>
// O token no caminho (ou no header Authorization: Bearer) protege o servidor;
// a chave da Shard Cloud fica só aqui (SHARDCLOUD_API_KEY), nunca no cliente.
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createShard } from './shard.js';
import { copyDatabase, listTables, compareDatabases } from './mysqlCopy.js';
import { downloadRepoZip, repackForShard, renderShardcloud } from './github.js';

const PORT = Number(process.env.PORT) || 80;
const MCP_TOKEN = process.env.MCP_TOKEN || '';
if (!MCP_TOKEN || MCP_TOKEN.length < 16) { console.error('[mcp] MCP_TOKEN precisa ter pelo menos 16 caracteres (openssl rand -hex 24).'); process.exit(1); }
if (!process.env.SHARDCLOUD_API_KEY) { console.error('[mcp] SHARDCLOUD_API_KEY ausente.'); process.exit(1); }

const shard = createShard();
const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: `Erro: ${err?.message || err}` }] });
const wrap = (fn) => async (args) => { try { return text(await fn(args)); } catch (err) { return fail(err); } };

export function buildServer() {
  const s = new McpServer({ name: 'shardcloud-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });

  // ---------------- conta ----------------
  s.tool('shard_me', 'Conta e assinatura da Shard Cloud (plano, limites, workspace).', {}, wrap(() => shard.me()));

  // ---------------- apps ----------------
  s.tool('shard_list_apps', 'Lista todos os apps (id, nome, linguagem, RAM, subdomínio, status).', {}, wrap(async () => {
    const apps = await shard.listApps();
    return (Array.isArray(apps) ? apps : []).map((a) => ({ id: a.app?.id, name: a.app?.name, language: a.app?.language, ram: a.app?.ram, subdomain: a.app?.subdomain, status: a.status, uptimeSec: a.container_uptime_seconds }));
  }));
  s.tool('shard_get_app', 'Detalhes completos de um app (config, status, métricas).', { app_id: z.string() }, wrap(({ app_id }) => shard.getApp(app_id)));
  s.tool('shard_app_status', 'Status rápido de um app (rodando/parado, RAM, vCPU, uptime).', { app_id: z.string() }, wrap(({ app_id }) => shard.appStatus(app_id)));
  s.tool('shard_app_action', 'Inicia, para ou reinicia um app.', { app_id: z.string(), action: z.enum(['start', 'stop', 'restart']) }, wrap(({ app_id, action }) => shard.setAppStatus(app_id, action)));
  s.tool('shard_app_logs', 'Lê os logs do app (stream ao vivo coletado por alguns segundos).', { app_id: z.string(), seconds: z.number().int().min(1).max(60).default(6) }, wrap(({ app_id, seconds }) => shard.logs(app_id, seconds)));
  s.tool('shard_app_http_logs', 'Logs de acesso HTTP do app (últimas N horas).', { app_id: z.string(), hours: z.number().int().min(1).max(168).default(24), cursor: z.string().optional() }, wrap(({ app_id, hours, cursor }) => shard.httpLogs(app_id, hours, 0, cursor || '')));
  s.tool('shard_app_exec', 'Roda um comando de shell DENTRO do container do app e devolve a saída.', { app_id: z.string(), command: z.string(), seconds: z.number().int().min(5).max(300).default(60) }, wrap(({ app_id, command, seconds }) => shard.exec(app_id, command, seconds)));
  s.tool('shard_app_metrics', 'Métricas de RAM/CPU/rede do app nos últimos minutos.', { app_id: z.string(), minutes: z.number().int().min(1).max(1440).default(60) }, wrap(({ app_id, minutes }) => shard.appMetrics(app_id, String(minutes))));
  s.tool('shard_app_deploys', 'Histórico de deploys do app (pra restaurar um anterior).', { app_id: z.string() }, wrap(({ app_id }) => shard.appDeploys(app_id)));
  s.tool('shard_app_restore_deploy', 'Volta o app pra um deploy anterior.', { app_id: z.string(), deploy_id: z.string() }, wrap(({ app_id, deploy_id }) => shard.restoreDeploy(app_id, deploy_id)));
  s.tool('shard_app_update_config', 'Altera nome/descrição/subdomínio/RAM/comando/entrypoint do app (campos omitidos continuam iguais).', {
    app_id: z.string(), name: z.string().optional(), description: z.string().optional(), subdomain: z.string().optional(), ram: z.number().int().optional(), custom_command: z.string().optional(), entrypoint: z.string().optional(),
  }, wrap(async ({ app_id, ...patch }) => {
    const cur = (await shard.getApp(app_id)).app || {};
    const req = {
      name: patch.name ?? cur.name, description: patch.description ?? cur.description ?? '', subdomain: patch.subdomain ?? cur.subdomain ?? '',
      ram: patch.ram ?? cur.ram, custom_command: patch.custom_command ?? cur.custom_command ?? '', entrypoint: patch.entrypoint ?? cur.entrypoint ?? '',
      is_downgrade: patch.ram != null && cur.ram != null && patch.ram < cur.ram,
    };
    await shard.updateAppResources(app_id, req);
    return { ok: true, applied: req };
  }));
  s.tool('shard_app_set_version', 'Troca a versão do runtime (ex.: node 22).', { app_id: z.string(), language: z.string(), version: z.string() }, wrap(({ app_id, language, version }) => shard.updateAppVersion(app_id, language, version)));
  s.tool('shard_language_versions', 'Versões de runtime disponíveis pra uma linguagem.', { language: z.string().default('node') }, wrap(({ language }) => shard.languageVersions(language)));
  s.tool('shard_app_web', 'Liga/desliga o acesso web público do app (subdomínio .shardweb.app).', { app_id: z.string(), enabled: z.boolean(), subdomain: z.string().optional() }, wrap(({ app_id, enabled, subdomain }) => (enabled ? shard.enableWeb(app_id, subdomain) : shard.disableWeb(app_id))));
  s.tool('shard_delete_app', 'APAGA um app (irreversível). Exige confirm=true.', { app_id: z.string(), confirm: z.boolean() }, wrap(async ({ app_id, confirm }) => { if (!confirm) throw new Error('Passe confirm=true pra apagar.'); return shard.deleteApp(app_id); }));

  // ---------------- variáveis de ambiente ----------------
  s.tool('shard_get_envs', 'Lista as variáveis de ambiente do app (valores mascarados por padrão).', { app_id: z.string(), reveal: z.boolean().default(false) }, wrap(async ({ app_id, reveal }) => {
    const envs = await shard.getEnvs(app_id);
    return (envs || []).map((e) => ({ key: e.key, value: reveal ? e.value : mask(e.value) }));
  }));
  s.tool('shard_set_envs', 'Define/atualiza variáveis (merge com as existentes). Pra remover, passe o valor null.', { app_id: z.string(), envs: z.record(z.string(), z.string().nullable()) }, wrap(async ({ app_id, envs }) => {
    const cur = (await shard.getEnvs(app_id)) || [];
    const map = new Map(cur.map((e) => [e.key, e.value]));
    for (const [k, v] of Object.entries(envs)) { if (v === null) map.delete(k); else map.set(k, String(v)); }
    const next = [...map.entries()].map(([key, value]) => ({ key, value }));
    await shard.putEnvs(app_id, next);
    return { ok: true, keys: next.map((e) => e.key) };
  }));
  s.tool('shard_replace_envs', 'SUBSTITUI todas as variáveis do app pelo conjunto informado.', { app_id: z.string(), envs: z.record(z.string(), z.string()) }, wrap(async ({ app_id, envs }) => {
    const next = Object.entries(envs).map(([key, value]) => ({ key, value: String(value) }));
    await shard.putEnvs(app_id, next);
    return { ok: true, keys: next.map((e) => e.key) };
  }));

  // ---------------- deploy ----------------
  const shardcloudSchema = z.object({
    DISPLAY_NAME: z.string().optional(), DESCRIPTION: z.string().optional(), MAIN: z.string().optional(), LANGUAGE: z.string().optional(),
    MEMORY: z.number().int().optional(), VERSION: z.string().optional(), SUBDOMAIN: z.string().optional(), CUSTOM_COMMAND: z.string().optional(),
  });
  s.tool('shard_deploy_from_github', 'Baixa um repositório do GitHub (branch/tag/commit), opcionalmente só uma subpasta, injeta o .shardcloud e cria um app novo OU atualiza o código de um app existente (app_id).', {
    owner: z.string(), repo: z.string(), ref: z.string().default('main'), subdir: z.string().optional(),
    app_id: z.string().optional().describe('Se informado, atualiza o código desse app em vez de criar um novo'),
    shardcloud: shardcloudSchema.optional().describe('Conteúdo do .shardcloud (obrigatório ao criar app novo, a menos que o repo já tenha um)'),
    extra_files: z.record(z.string(), z.string()).optional().describe('Arquivos extras {caminho: conteúdo} pra incluir no zip'),
  }, wrap(async ({ owner, repo, ref, subdir, app_id, shardcloud, extra_files }) => {
    const raw = await downloadRepoZip({ owner, repo, ref });
    const { zip, files } = repackForShard(raw, { subdir, shardcloud: shardcloud ? renderShardcloud(shardcloud) : undefined, extraFiles: extra_files || {} });
    if (app_id) { await shard.updateAppCode(app_id, zip); return { ok: true, updated: app_id, files, zipBytes: zip.length }; }
    const created = await shard.createAppFromZip(zip);
    return { ok: true, created, files, zipBytes: zip.length };
  }));
  s.tool('shard_render_shardcloud', 'Gera o texto de um arquivo .shardcloud a partir dos campos.', { config: shardcloudSchema }, wrap(({ config }) => renderShardcloud(config)));

  // ---------------- bancos ----------------
  s.tool('shard_list_databases', 'Lista os bancos (id, nome, tipo, RAM, status).', {}, wrap(async () => {
    const dbs = await shard.listDatabases();
    return (Array.isArray(dbs) ? dbs : []).map((d) => ({ id: d.database?.id, name: d.database?.name, type: d.database?.service_type, ram: d.database?.ram, size: d.database?.size, visualizer: d.database?.visualizer, replica: d.replica_status }));
  }));
  s.tool('shard_get_database', 'Detalhes de um banco.', { database_id: z.string() }, wrap(({ database_id }) => shard.getDatabase(database_id)));
  s.tool('shard_create_database', 'Cria um banco gerenciado (mysql, postgres, mongo ou redis). Devolve a URL de conexão — guarde.', {
    name: z.string(), type: z.enum(['mysql', 'postgres', 'mongo', 'redis']), ram: z.number().int().min(128).default(512), password: z.string().min(12), visualizer: z.boolean().default(false),
  }, wrap((req) => shard.createDatabase(req)));
  s.tool('shard_database_connection_url', 'URL de conexão (e do visualizador) de um banco.', { database_id: z.string() }, wrap(({ database_id }) => shard.databaseConnectionUrl(database_id)));
  s.tool('shard_database_status', 'Status de um banco.', { database_id: z.string() }, wrap(({ database_id }) => shard.databaseStatus(database_id)));
  s.tool('shard_database_action', 'Liga/desliga um banco.', { database_id: z.string(), action: z.enum(['start', 'stop']) }, wrap(({ database_id, action }) => (action === 'start' ? shard.startDatabase(database_id) : shard.stopDatabase(database_id))));
  s.tool('shard_database_metrics', 'Métricas de RAM/CPU/rede do banco.', { database_id: z.string(), minutes: z.number().int().default(60) }, wrap(({ database_id, minutes }) => shard.databaseMetrics(database_id, String(minutes))));
  s.tool('shard_database_password', 'Troca a senha do banco (a URL de conexão muda).', { database_id: z.string(), password: z.string().min(12) }, wrap(({ database_id, password }) => shard.changeDatabasePassword(database_id, password)));
  s.tool('shard_database_resources', 'Altera RAM/vCPU do banco.', { database_id: z.string(), ram: z.number().int(), vcpu: z.number().int() }, wrap(({ database_id, ram, vcpu }) => shard.updateDatabaseResources(database_id, ram, vcpu)));
  s.tool('shard_delete_database', 'APAGA um banco (irreversível). Exige confirm=true.', { database_id: z.string(), confirm: z.boolean() }, wrap(async ({ database_id, confirm }) => { if (!confirm) throw new Error('Passe confirm=true pra apagar.'); return shard.deleteDatabase(database_id); }));

  // ---------------- backups ----------------
  s.tool('shard_list_backups', 'Backups de um app/banco/VM.', { resource_id: z.string() }, wrap(({ resource_id }) => shard.listBackups(resource_id)));
  s.tool('shard_create_backup', 'Cria um backup agora.', { resource_id: z.string(), name: z.string().optional(), target_database: z.string().optional() }, wrap(({ resource_id, name, target_database }) => shard.createBackup(resource_id, { name, target_database })));
  s.tool('shard_restore_backup', 'Restaura um backup (sobrescreve o estado atual). Exige confirm=true.', { resource_id: z.string(), backup_id: z.string(), target_database: z.string().optional(), confirm: z.boolean() }, wrap(async ({ resource_id, backup_id, target_database, confirm }) => { if (!confirm) throw new Error('Passe confirm=true pra restaurar.'); return shard.restoreBackup(resource_id, backup_id, { target_database }); }));
  s.tool('shard_backup_download_url', 'Link assinado pra baixar um backup.', { resource_id: z.string(), backup_id: z.string() }, wrap(({ resource_id, backup_id }) => shard.backupDownloadUrl(resource_id, backup_id)));

  // ---------------- migração MySQL ----------------
  s.tool('mysql_tables', 'Lista tabelas e contagem de linhas de um MySQL (qualquer provedor) pela URL de conexão.', { url: z.string() }, wrap(({ url }) => listTables(url)));
  s.tool('mysql_copy', 'Copia os dados de um MySQL pra outro (ex.: Square Cloud → Shard Cloud), tabela por tabela, em lotes, com FK desligada. Upsert por chave primária (reexecutar é seguro). Use dry_run primeiro.', {
    source_url: z.string(), target_url: z.string(), tables: z.array(z.string()).optional(), truncate: z.boolean().default(false), dry_run: z.boolean().default(false),
  }, wrap(({ source_url, target_url, tables, truncate, dry_run }) => copyDatabase({ sourceUrl: source_url, targetUrl: target_url, tables, truncate, dryRun: dry_run })));
  s.tool('mysql_compare', 'Compara contagem de linhas por tabela entre dois MySQL (conferência pós-migração).', { source_url: z.string(), target_url: z.string() }, wrap(({ source_url, target_url }) => compareDatabases(source_url, target_url)));

  // ---------------- VMs ----------------
  s.tool('shard_list_vms', 'Lista as VMs.', {}, wrap(() => shard.listVms()));

  return s;
}

function mask(v) { const s = String(v ?? ''); return s.length <= 6 ? '•••' : `${s.slice(0, 3)}…${s.slice(-2)} (${s.length})`; }

// ---------------- HTTP ----------------
const app = express();
app.use(express.json({ limit: '2mb' }));
app.get('/', (_req, res) => res.json({ ok: true, name: 'shardcloud-mcp', hint: 'POST /mcp/<token>' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

function authorized(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ') && safeEq(h.slice(7), MCP_TOKEN)) return true;
  if (req.params.token && safeEq(req.params.token, MCP_TOKEN)) return true;
  return false;
}
function safeEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i += 1) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

// Sem estado: cada requisição cria transporte + servidor (simples e à prova
// de reinício; o Claude não depende de sessão).
async function handle(req, res) {
  if (!authorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = buildServer();
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp] erro:', err);
    if (!res.headersSent) res.status(500).json({ error: 'erro interno' });
  }
}
app.all('/mcp', handle);
app.all('/mcp/:token', handle);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`[mcp] shardcloud-mcp ouvindo na porta ${PORT} — conecte em /mcp/<MCP_TOKEN>`));
}
export default app;
