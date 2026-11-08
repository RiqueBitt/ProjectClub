// Banco falso em memória (só o pedaço da API do Prisma que os serviços da
// Fase 4 usam) — os testes rodam sem o cliente Prisma gerado e sem MySQL.
//
// createFakeDb({ modelo: { pk: ['id'], unique: [['a', 'b']], defaults: {...} } })
// Suporta: findUnique/findFirst/findMany/count/aggregate/groupBy/create/
// createMany/update/updateMany/upsert/delete/deleteMany e $transaction
// (com desfazer: se a função lançar erro, o banco volta como estava).
const { randomUUID } = require('node:crypto');

function p2002(model, fields) {
  const e = new Error(`Unique constraint failed on ${model}(${fields.join(',')})`);
  e.code = 'P2002';
  return e;
}
function p2025(model) {
  const e = new Error(`Record to update not found (${model})`);
  e.code = 'P2025';
  return e;
}

const OPS = new Set(['equals', 'in', 'notIn', 'not', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith']);
const isPlainObj = (v) => v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v);
const cmp = (a, b) => {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  if (x === y) return 0;
  if (x === null || x === undefined) return -1;
  if (y === null || y === undefined) return 1;
  return x < y ? -1 : 1;
};
const eq = (a, b) => cmp(a ?? null, b ?? null) === 0;

function matchValue(v, cond) {
  if (!isPlainObj(cond) || !Object.keys(cond).every((k) => OPS.has(k))) return eq(v, cond);
  for (const [op, arg] of Object.entries(cond)) {
    if (op === 'equals' && !eq(v, arg)) return false;
    if (op === 'in' && !arg.some((a) => eq(v, a))) return false;
    if (op === 'notIn' && arg.some((a) => eq(v, a))) return false;
    if (op === 'not' && (isPlainObj(arg) ? matchValue(v, arg) : eq(v, arg))) return false;
    if (op === 'gt' && !(v !== null && v !== undefined && cmp(v, arg) > 0)) return false;
    if (op === 'gte' && !(v !== null && v !== undefined && cmp(v, arg) >= 0)) return false;
    if (op === 'lt' && !(v !== null && v !== undefined && cmp(v, arg) < 0)) return false;
    if (op === 'lte' && !(v !== null && v !== undefined && cmp(v, arg) <= 0)) return false;
    if (op === 'contains' && !String(v ?? '').includes(arg)) return false;
    if (op === 'startsWith' && !String(v ?? '').startsWith(arg)) return false;
  }
  return true;
}

function matches(row, where = {}) {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (k === 'OR') { if (!cond.some((w) => matches(row, w))) return false; continue; }
    if (k === 'AND') { if (!(Array.isArray(cond) ? cond : [cond]).every((w) => matches(row, w))) return false; continue; }
    if (k === 'NOT') { if ((Array.isArray(cond) ? cond : [cond]).some((w) => matches(row, w))) return false; continue; }
    // Chave composta: { a_b: { a, b } }
    if (!(k in row) && isPlainObj(cond) && k.includes('_') && Object.keys(cond).every((f) => !OPS.has(f))) {
      if (!Object.entries(cond).every(([f, v]) => eq(row[f], v))) return false;
      continue;
    }
    if (!matchValue(row[k], cond)) return false;
  }
  return true;
}

function applyData(row, data) {
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    if (isPlainObj(v) && ('increment' in v || 'decrement' in v)) {
      row[k] = (row[k] || 0) + (v.increment || 0) - (v.decrement || 0);
    } else if (isPlainObj(v) && 'set' in v) {
      row[k] = v.set;
    } else row[k] = v;
  }
  return row;
}

function sortRows(rows, orderBy) {
  if (!orderBy) return rows;
  const list = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const o of list) {
      const [field, dir] = Object.entries(o)[0];
      const d = typeof dir === 'object' ? dir.sort || 'asc' : dir;
      const c = cmp(a[field], b[field]);
      if (c !== 0) return d === 'desc' ? -c : c;
    }
    return 0;
  });
}

function pick(row, select) {
  if (!row || !select) return row ? { ...row } : row;
  const out = {};
  for (const [k, v] of Object.entries(select)) if (v) out[k] = row[k];
  return out;
}

function createFakeDb(models = {}, seed = {}) {
  const store = {};
  const db = { _store: store, _log: [] };

  for (const [name, cfg] of Object.entries(models)) {
    store[name] = (seed[name] || []).map((r) => ({ ...(cfg.defaults || {}), ...r }));
    const pk = cfg.pk || ['id'];
    const uniques = [pk, ...(cfg.unique || [])];
    const rows = () => store[name];
    const checkUnique = (candidate, ignore) => {
      for (const fields of uniques) {
        if (fields.some((f) => candidate[f] === null || candidate[f] === undefined)) continue;
        const clash = rows().find((r) => r !== ignore && fields.every((f) => eq(r[f], candidate[f])));
        if (clash) throw p2002(name, fields);
      }
    };
    const findOne = (where) => rows().find((r) => matches(r, where)) || null;

    db[name] = {
      async findUnique({ where, select } = {}) { return pick(findOne(where), select); },
      async findFirst({ where, select, orderBy } = {}) { return pick(sortRows(rows().filter((r) => matches(r, where)), orderBy)[0] || null, select); },
      async findMany({ where, orderBy, take, skip, select } = {}) {
        let list = sortRows(rows().filter((r) => matches(r, where)), orderBy);
        if (skip) list = list.slice(skip);
        if (take !== undefined) list = list.slice(0, take);
        return list.map((r) => pick(r, select));
      },
      async count({ where } = {}) { return rows().filter((r) => matches(r, where)).length; },
      async aggregate({ where, _sum, _count } = {}) {
        const list = rows().filter((r) => matches(r, where));
        const out = {};
        if (_sum) { out._sum = {}; for (const f of Object.keys(_sum)) out._sum[f] = list.length ? list.reduce((a, r) => a + (r[f] || 0), 0) : null; }
        if (_count) out._count = { _all: list.length };
        return out;
      },
      async groupBy({ by, where, _sum, _count, orderBy, take } = {}) {
        const groups = new Map();
        for (const r of rows().filter((x) => matches(x, where))) {
          const key = JSON.stringify(by.map((f) => r[f]));
          if (!groups.has(key)) groups.set(key, { rows: [], vals: Object.fromEntries(by.map((f) => [f, r[f]])) });
          groups.get(key).rows.push(r);
        }
        let out = [...groups.values()].map((g) => {
          const o = { ...g.vals };
          if (_sum) { o._sum = {}; for (const f of Object.keys(_sum)) o._sum[f] = g.rows.reduce((a, r) => a + (r[f] || 0), 0); }
          if (_count) {
            o._count = { _all: g.rows.length };
            if (isPlainObj(_count)) for (const f of Object.keys(_count)) if (f !== '_all') o._count[f] = g.rows.filter((r) => r[f] !== null && r[f] !== undefined).length;
          }
          return o;
        });
        if (orderBy) {
          const o = Array.isArray(orderBy) ? orderBy[0] : orderBy;
          const [agg, spec] = Object.entries(o)[0];
          const [field, dir] = Object.entries(spec)[0];
          out = out.sort((a, b) => (dir === 'desc' ? -1 : 1) * cmp(a[agg]?.[field] ?? 0, b[agg]?.[field] ?? 0));
        }
        return take ? out.slice(0, take) : out;
      },
      async create({ data, select } = {}) {
        const row = { ...(cfg.defaults || {}) };
        applyData(row, data);
        if (pk.length === 1 && pk[0] === 'id' && !row.id) row.id = randomUUID();
        if (cfg.timestamps !== false) { row.createdAt = row.createdAt || new Date(); row.updatedAt = new Date(); }
        checkUnique(row);
        rows().push(row);
        db._log.push(['create', name, row]);
        return pick(row, select);
      },
      async createMany({ data, skipDuplicates } = {}) {
        let count = 0;
        for (const d of data) {
          try { await db[name].create({ data: d }); count += 1; } catch (e) { if (!(skipDuplicates && e.code === 'P2002')) throw e; }
        }
        return { count };
      },
      async update({ where, data, select } = {}) {
        const row = findOne(where);
        if (!row) throw p2025(name);
        const next = applyData({ ...row }, data);
        if (cfg.timestamps !== false) next.updatedAt = new Date();
        checkUnique(next, row);
        Object.assign(row, next);
        db._log.push(['update', name, row]);
        return pick(row, select);
      },
      async updateMany({ where, data } = {}) {
        const list = rows().filter((r) => matches(r, where));
        for (const r of list) { applyData(r, data); if (cfg.timestamps !== false) r.updatedAt = new Date(); }
        return { count: list.length };
      },
      async upsert({ where, create, update, select } = {}) {
        const row = findOne(where);
        if (row) return db[name].update({ where, data: update, select });
        return db[name].create({ data: create, select });
      },
      async delete({ where } = {}) {
        const row = findOne(where);
        if (!row) throw p2025(name);
        store[name] = rows().filter((r) => r !== row);
        return row;
      },
      async deleteMany({ where } = {}) {
        const before = rows().length;
        store[name] = rows().filter((r) => !matches(r, where));
        return { count: before - store[name].length };
      },
    };
  }

  db.$transaction = async (arg) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    const snapshot = structuredClone(store);
    try {
      return await arg(db);
    } catch (err) {
      for (const k of Object.keys(store)) store[k] = snapshot[k];
      throw err;
    }
  };
  return db;
}

// Modelos usados nos testes da Fase 4 (chaves e únicos iguais ao schema).
const FASE4_MODELS = {
  user: { defaults: { coins: 0, gems: 0, accountLevel: 1, accountXp: 0, clanId: null, platformRole: 'USER', birthDate: null, isPlatformBanned: false, accountDisabledAt: null, suspendedUntil: null } },
  platformSettings: { defaults: { disabledSystems: '[]' } },
  jobRun: { pk: ['key'], defaults: { doneAt: null, info: null } },
  rewardGrant: { pk: ['key', 'userId'] },
  activityCounter: { pk: ['scope', 'scopeId', 'periodKey'], defaults: { messages: 0, voiceMinutes: 0, forumPosts: 0, reactions: 0, xp: 0, points: 0 } },
  clanWeekResult: { pk: ['weekKey'] },
  clan: {},
  clanIcon: {},
  referralCode: { pk: ['userId'], unique: [['code']] },
  referral: { unique: [['inviteeId'], ['applicationId']], defaults: { status: 'PENDING', inviteeId: null, applicationId: null, inviteeIp: null, monthKey: null, inviterCoins: 0, inviteeCoins: 0, rewardedAt: null, note: null } },
  refreshToken: {},
  monthlyRecap: { pk: ['userId', 'monthKey'] },
  userAchievement: { unique: [['userId', 'achievementId']] },
  achievement: { unique: [['key']], defaults: { enabled: true, hidden: false } },
  post: { defaults: { score: 0 } },
  postOfWeek: { pk: ['weekKey'] },
  raffleTicket: { unique: [['weekKey', 'userId']], defaults: { count: 0, spent: 0 } },
  raffleDraw: { pk: ['weekKey'] },
  playGroup: { defaults: { status: 'OPEN', fullNotifiedAt: null, description: null } },
  playGroupMember: { unique: [['groupId', 'userId']], defaults: { remindedAt: null } },
  role: { defaults: { permissions: '0', position: 1, isDefault: false, selfAssignable: false } },
  userRole: { unique: [['userId', 'roleId']] },
  communityGoal: { unique: [['weekKey', 'metric']], defaults: { reachedAt: null, rewardedAt: null, rewardCoins: 0, title: null } },
  seasonClaim: { pk: ['userId', 'dayKey'] },
  coupon: { unique: [['code']], defaults: { kind: 'PERCENT', uses: 0, maxUses: null, minPrice: null, expiresAt: null, active: true } },
  couponUse: { unique: [['couponId', 'userId']] },
  reputationThanks: { unique: [['giverId', 'receiverId', 'dayKey']] },
  message: { defaults: { deletedAt: null } },
  coinTip: {},
  tipDaily: { pk: ['userId', 'dayKey'], defaults: { sent: 0 } },
  conversation: {},
  conversationMember: {},
  reaction: {},
};

// Banco já com todos os modelos da Fase 4 (+ `seed` opcional).
function fase4Db(seed = {}) {
  return createFakeDb(FASE4_MODELS, seed);
}

// Avisos e extrato falsos que só guardam o que receberam.
function spies() {
  const notices = [];
  const ledger = [];
  return {
    notices, ledger,
    notify: async (io, userId, n) => { notices.push({ userId, ...n }); return n; },
    ledgerFn: (userId, t) => { ledger.push({ userId, ...t }); },
  };
}

module.exports = { createFakeDb, FASE4_MODELS, fase4Db, spies };
