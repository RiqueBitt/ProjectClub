// Saúde dos provedores de voz ("disjuntor"). Problema real: um provedor
// configurado mas falhando em produção (ex.: sem rota até o gateway) e a
// cadeia continuava mandando gente pra ele — cada um ficava alguns segundos
// tentando até o cliente desistir e pedir o próximo.
//
// Como funciona:
//  - O cliente avisa que um provedor falhou (POST /api/voice/report) — ou o
//    servidor percebe sozinho: a mesma pessoa pedindo /api/voice/join de novo
//    em segundos SEM o provedor que acabou de receber (é o failover do
//    cliente). Também testamos o /health do servidor de mídia próprio.
//  - Falhas de PESSOAS DIFERENTES (≥ VOICE_HEALTH_MIN_USERS, padrão 2) dentro
//    da janela (VOICE_HEALTH_WINDOW_MIN, padrão 5 min) desarmam o provedor por
//    um tempo (VOICE_HEALTH_COOLDOWN_MIN, padrão 10 min; dobra a cada nova
//    queda seguida, até 2h). Uma pessoa sozinha (rede ruim, abuso) nunca tira
//    um provedor do ar pra todo mundo.
//  - Desarmado = a cadeia pula ele (como se estivesse desativado), o override
//    que apontar pra ele cai no automático, e a sala "fixada" nele migra.
//    Passado o tempo, ele volta a ser tentado (meio-aberto); se falhar de
//    novo, desarma por mais tempo.
//
// Guarda no Redis (vale pra todas as instâncias) com reserva em memória se o
// Redis cair. Tudo é injetável (store/now/env) pra testar sem Redis.
const providers = require('./voiceProviders');

function options(env = process.env) {
  const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : d; };
  return {
    windowMs: n(env.VOICE_HEALTH_WINDOW_MIN, 5) * 60000,
    minUsers: Math.max(1, Math.floor(n(env.VOICE_HEALTH_MIN_USERS, 2))),
    cooldownMs: n(env.VOICE_HEALTH_COOLDOWN_MIN, 10) * 60000,
    maxCooldownMs: n(env.VOICE_HEALTH_MAX_COOLDOWN_MIN, 120) * 60000,
    userThrottleMs: n(env.VOICE_HEALTH_USER_THROTTLE_S, 20) * 1000,
    tripsMemoryMs: 6 * 3600 * 1000,
  };
}

// ---- puro ----
function shouldTrip(failures, now, o) {
  const users = new Set(failures.filter((f) => now - f.at <= o.windowMs).map((f) => String(f.userId)));
  return users.size >= o.minUsers;
}
function cooldownFor(trips, o) {
  return Math.min(o.maxCooldownMs, o.cooldownMs * 2 ** Math.max(0, trips - 1));
}

// ---- stores ----
function memoryStore(nowFn = Date.now) {
  const kv = new Map(); // key -> { v, exp }
  const z = new Map();  // key -> Map(member -> score)
  const live = (k) => { const e = kv.get(k); if (!e) return null; if (e.exp && e.exp <= nowFn()) { kv.delete(k); return null; } return e; };
  return {
    async get(k) { return live(k)?.v ?? null; },
    async set(k, v, ttlMs) { kv.set(k, { v, exp: ttlMs ? nowFn() + ttlMs : 0 }); },
    async setNx(k, v, ttlMs) { if (live(k)) return false; kv.set(k, { v, exp: nowFn() + ttlMs }); return true; },
    async del(k) { kv.delete(k); z.delete(k); },
    async incr(k, ttlMs) { const cur = Number(live(k)?.v || 0) + 1; kv.set(k, { v: String(cur), exp: nowFn() + ttlMs }); return cur; },
    async zadd(k, score, member) { if (!z.has(k)) z.set(k, new Map()); z.get(k).set(member, score); },
    async zrangeAfter(k, minScore) {
      const m = z.get(k); if (!m) return [];
      for (const [mem, s] of m) if (s < minScore) m.delete(mem);
      return [...m.entries()].map(([member, score]) => ({ member, score }));
    },
  };
}

function redisStore(redis) {
  return {
    async get(k) { return redis.get(k); },
    async set(k, v, ttlMs) { if (ttlMs) await redis.set(k, v, 'PX', Math.max(1, Math.round(ttlMs))); else await redis.set(k, v); },
    async setNx(k, v, ttlMs) { return (await redis.set(k, v, 'PX', Math.max(1, Math.round(ttlMs)), 'NX')) === 'OK'; },
    async del(k) { await redis.del(k); },
    async incr(k, ttlMs) { const n = await redis.incr(k); await redis.pexpire(k, Math.round(ttlMs)); return n; },
    async zadd(k, score, member) { await redis.zadd(k, score, member); await redis.pexpire(k, 3600 * 1000); },
    async zrangeAfter(k, minScore) {
      await redis.zremrangebyscore(k, '-inf', `(${minScore}`);
      const flat = await redis.zrange(k, 0, -1, 'WITHSCORES');
      const out = [];
      for (let i = 0; i < flat.length; i += 2) out.push({ member: flat[i], score: Number(flat[i + 1]) });
      return out;
    },
  };
}

// Redis com reserva em memória (Redis fora do ar nunca derruba a voz).
function fallbackStore(primary, backup) {
  const wrap = (name) => async (...args) => {
    try { return await primary[name](...args); } catch { return backup[name](...args); }
  };
  return Object.fromEntries(Object.keys(backup).map((k) => [k, wrap(k)]));
}

const K = {
  fail: (p) => `voice:health:fail:${p}`,
  down: (p) => `voice:health:down:${p}`,
  trips: (p) => `voice:health:trips:${p}`,
  rl: (p, u) => `voice:health:rl:${p}:${u}`,
};

function createTracker({ store, now = Date.now, env = process.env, log = console } = {}) {
  const probe = { down: false, fails: 0, lastError: null, lastAt: 0, everOk: false }; // servidor próprio (só nesta instância)

  async function getDown(provider) {
    const raw = await store.get(K.down(provider));
    if (!raw) return null;
    try { const d = JSON.parse(raw); return d.until > now() ? d : null; } catch { return null; }
  }

  // Registra uma falha. Devolve { counted, tripped, down }.
  async function recordFailure(provider, userId, reason = 'client') {
    if (!providers.PROVIDERS[provider]) return { counted: false, tripped: false };
    const o = options(env);
    const uid = String(userId || 'anon').slice(0, 64);
    // Uma falha por pessoa a cada ~20s (o cliente às vezes reporta em rajada).
    const fresh = await store.setNx(K.rl(provider, uid), '1', o.userThrottleMs);
    if (!fresh) return { counted: false, tripped: false };
    const t = now();
    await store.zadd(K.fail(provider), t, uid);
    if (await getDown(provider)) return { counted: true, tripped: false, down: true };
    const failures = (await store.zrangeAfter(K.fail(provider), t - o.windowMs)).map((f) => ({ userId: f.member, at: f.score }));
    if (!shouldTrip(failures, t, o)) return { counted: true, tripped: false, down: false };
    const trips = await store.incr(K.trips(provider), o.tripsMemoryMs);
    const ms = cooldownFor(trips, o);
    await store.set(K.down(provider), JSON.stringify({ until: t + ms, reason: String(reason).slice(0, 80), users: failures.length, trips, since: t }), ms);
    await store.del(K.fail(provider));
    log.warn?.(`[voz] provedor ${provider} DESARMADO por ${Math.round(ms / 60000)} min (${failures.length} pessoas com falha em ${Math.round(o.windowMs / 60000)} min; motivo: ${reason})`);
    return { counted: true, tripped: true, down: true, until: t + ms };
  }

  // Equipe zera a saúde (ex.: depois de trocar as chaves no painel).
  async function reset(provider) {
    await store.del(K.down(provider));
    await store.del(K.fail(provider));
    await store.del(K.trips(provider));
    if (provider === 'projectclub') { probe.down = false; probe.fails = 0; }
  }

  async function getUnhealthy() {
    const out = [];
    for (const id of providers.PROVIDER_ORDER) {
      // eslint-disable-next-line no-await-in-loop
      if (await getDown(id)) out.push(id);
    }
    if (probe.down && !out.includes('projectclub')) out.push('projectclub');
    return out;
  }

  async function describe() {
    const o = options(env);
    const out = {};
    for (const id of providers.PROVIDER_ORDER) {
      // eslint-disable-next-line no-await-in-loop
      const down = await getDown(id);
      // eslint-disable-next-line no-await-in-loop
      const recent = (await store.zrangeAfter(K.fail(id), now() - o.windowMs)).length;
      const probeDown = id === 'projectclub' && probe.down;
      out[id] = {
        healthy: !down && !probeDown,
        downUntil: down ? down.until : null,
        reason: down ? down.reason : (probeDown ? `servidor de mídia não responde (${probe.lastError || 'sem resposta'})` : null),
        recentFailures: recent,
      };
    }
    return out;
  }

  // ---- teste ativo do servidor de mídia próprio (GET /health) ----
  function healthUrl(e = env) {
    const raw = String(e.MEDIA_SERVER_URL || '').trim();
    if (!raw) return null;
    try {
      const u = new URL(raw);
      u.protocol = u.protocol === 'ws:' ? 'http:' : 'https:';
      u.pathname = '/health'; u.search = '';
      return u.toString();
    } catch { return null; }
  }

  async function probeOnce({ fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
    const url = healthUrl();
    if (!url || !providers.isConfigured('projectclub', env)) { probe.down = false; probe.fails = 0; return null; }
    let ok = false;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetchImpl(url, { signal: ctrl.signal, headers: { 'cache-control': 'no-store' } });
        ok = r.ok;
        if (!ok) probe.lastError = `HTTP ${r.status}`;
      } finally { clearTimeout(timer); }
    } catch (err) { probe.lastError = err?.name === 'AbortError' ? 'timeout' : (err?.message || 'erro'); }
    probe.lastAt = now();
    const wasDown = probe.down;
    // Só desarma se o teste JÁ funcionou alguma vez desde que o processo
    // subiu: se a hospedagem do backend simplesmente não alcança a VM (rede/
    // TLS da hospedagem), o servidor de mídia pode estar ótimo pros clientes
    // — aí não tiramos ele da cadeia por um falso negativo.
    if (ok) { probe.everOk = true; probe.fails = 0; probe.down = false; probe.lastError = null; } else {
      probe.fails += 1;
      if (probe.fails >= 2 && probe.everOk) probe.down = true;
      else if (probe.fails === 2 && !probe.everOk) log.warn?.(`[voz] teste do servidor de mídia (${url}) nunca funcionou daqui (${probe.lastError}) — ignorando o teste ativo`);
    }
    if (probe.down !== wasDown) log.warn?.(`[voz] servidor de mídia próprio ${probe.down ? 'FORA DO AR' : 'voltou'} (${url}${probe.lastError ? `: ${probe.lastError}` : ''})`);
    return { ok, down: probe.down, changed: probe.down !== wasDown };
  }

  let probeTimer = null;
  function startProbe({ intervalMs = 30000, onChange } = {}) {
    if (probeTimer || process.env.NODE_ENV === 'test') return;
    const tick = () => probeOnce().then((r) => { if (r?.changed) onChange?.(r); }).catch(() => {});
    tick();
    probeTimer = setInterval(tick, intervalMs);
    probeTimer.unref?.();
  }
  function stopProbe() { if (probeTimer) clearInterval(probeTimer); probeTimer = null; }

  return { recordFailure, reset, getUnhealthy, getDown, describe, probeOnce, startProbe, stopProbe, healthUrl, _probe: probe };
}

// Instância padrão (Redis + memória).
let defaultTracker = null;
function tracker() {
  if (!defaultTracker) {
    const { redis } = require('../config/redis');
    defaultTracker = createTracker({ store: fallbackStore(redisStore(redis), memoryStore()) });
  }
  return defaultTracker;
}

module.exports = {
  options, shouldTrip, cooldownFor, memoryStore, redisStore, fallbackStore, createTracker, tracker,
};
