const prisma = require('../config/prisma');

// Monitor de status: confere a cada minuto o banco, o tempo real (Redis) e
// as chamadas de voz. Alimenta a página pública /status e avisa a staff
// (aviso + push) quando algo cai e quando volta.

const COMPONENTS = [
  { id: 'api', label: 'Site e aplicativo' },
  { id: 'database', label: 'Banco de dados' },
  { id: 'realtime', label: 'Mensagens em tempo real' },
  { id: 'voice', label: 'Chamadas de voz' },
];
const state = Object.fromEntries(COMPONENTS.map((c) => [c.id, { status: 'ok', latencyMs: null, fails: 0, incidentId: null, checkedAt: null }]));

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('demorou demais')), ms))]);
async function timed(fn) {
  const t = Date.now();
  try { await withTimeout(fn(), 5000); return { ok: true, ms: Date.now() - t }; } catch (e) { return { ok: false, ms: Date.now() - t, error: e?.message || String(e) }; }
}

async function checkAll() {
  const { redis } = require('../config/redis');
  const providers = require('./voiceProviders');
  const [db, rt] = await Promise.all([
    timed(() => prisma.$queryRaw`SELECT 1`),
    timed(() => redis.ping()),
  ]);
  const voiceOk = providers.PROVIDER_ORDER.some((id) => providers.isAvailable(id));
  return {
    api: { ok: true, ms: 0 },
    database: db,
    realtime: rt,
    voice: { ok: voiceOk, ms: null, error: voiceOk ? null : 'nenhum provedor de voz disponível' },
  };
}

async function alertStaff(io, title, body) {
  const staff = await prisma.user.findMany({ where: { platformRole: 'ADMIN' }, select: { id: true } }).catch(() => []);
  for (const s of staff) await require('./notices').createNotice(io, s.id, { kind: 'STATUS', title, body, link: '/status' }).catch(() => null);
}

async function tick(io) {
  const results = await checkAll().catch(() => null);
  if (!results) return;
  for (const c of COMPONENTS) {
    const r = results[c.id];
    const st = state[c.id];
    st.checkedAt = new Date();
    st.latencyMs = r.ms;
    if (r.ok) {
      st.fails = 0;
      if (st.status !== 'ok') {
        st.status = 'ok';
        if (st.incidentId) {
          await prisma.statusIncident.update({ where: { id: st.incidentId }, data: { endedAt: new Date() } }).catch(() => null);
          st.incidentId = null;
          alertStaff(io, `✅ ${c.label} voltou`, 'Funcionando normalmente de novo.');
        }
      }
    } else {
      st.fails += 1;
      // 2 falhas seguidas = fora do ar (evita alarme por um soluço de rede).
      if (st.fails >= 2 && st.status === 'ok') {
        st.status = 'down';
        const inc = await prisma.statusIncident.create({ data: { component: c.id, detail: String(r.error || '').slice(0, 300) } }).catch(() => null);
        st.incidentId = inc?.id || null;
        alertStaff(io, `⚠️ ${c.label} fora do ar`, r.error ? `Erro: ${String(r.error).slice(0, 200)}` : 'O monitor não conseguiu falar com este serviço.');
      } else if (st.fails === 1 && st.status === 'ok') {
        st.status = 'degraded';
      }
    }
    if (r.ok && st.latencyMs > 2000 && c.id !== 'voice') st.status = 'degraded';
  }
}

// Disponibilidade dos últimos N dias a partir das quedas registradas.
async function uptime(days = 30) {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await prisma.statusIncident.findMany({ where: { OR: [{ endedAt: null }, { endedAt: { gte: since } }] }, orderBy: { startedAt: 'desc' }, take: 200 }).catch(() => []);
  const total = days * 86400000;
  const out = {};
  for (const c of COMPONENTS) {
    const down = rows.filter((r) => r.component === c.id).reduce((a, r) => {
      const s = Math.max(new Date(r.startedAt).getTime(), since.getTime());
      const e = r.endedAt ? new Date(r.endedAt).getTime() : Date.now();
      return a + Math.max(0, e - s);
    }, 0);
    out[c.id] = Math.max(0, Math.round((1 - down / total) * 10000) / 100);
  }
  return { byComponent: out, incidents: rows.slice(0, 15) };
}

// GET /api/platform/health-status (público, sem login).
async function publicStatus(req, res, next) {
  try {
    const up = await uptime(30);
    const components = COMPONENTS.map((c) => ({ id: c.id, label: c.label, status: state[c.id].status, latencyMs: state[c.id].latencyMs, uptime30d: up.byComponent[c.id] }));
    const overall = components.some((c) => c.status === 'down') ? 'down' : components.some((c) => c.status === 'degraded') ? 'degraded' : 'ok';
    res.set('Cache-Control', 'no-store');
    res.json({
      overall, checkedAt: state.api.checkedAt, components,
      incidents: up.incidents.map((i) => ({ id: i.id, component: COMPONENTS.find((c) => c.id === i.component)?.label || i.component, startedAt: i.startedAt, endedAt: i.endedAt })),
    });
  } catch (err) { next(err); }
}

function startStatusMonitor(io) {
  const run = () => tick(io).catch((e) => console.error('[status]', e?.message || e));
  setTimeout(run, 15 * 1000);
  setInterval(run, 60 * 1000).unref?.();
}

module.exports = { startStatusMonitor, publicStatus, uptime };
