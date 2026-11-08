// Repositório de pinguins da Praça (Club Penguin) no MySQL, via Prisma.
//
// Implementa a interface PenguinRepository do Waddle Forever (ver
// server/waddle/src/server/database/database.ts): get / create / write /
// fromName / exists / createWithId. O Waddle Forever original guarda um JSON
// por pinguim em disco — aqui o JSON inteiro vai pra coluna `data` da tabela
// WaddlePenguin, então sobrevive a deploy/reinício da Shard Cloud e fica
// junto do resto do banco do Project Club.
//
// Cache em memória: o jogo lê o pinguim muitas vezes por sessão (buddies,
// iglus, cartões...) e grava a cada mudança. Leituras passam pelo cache;
// gravações são enfileiradas por id (uma por vez, na ordem), igual ao
// comportamento do repositório em arquivo do WF.

const FIRST_USER_ID = 1000;

// Moeda única: o saldo de moedas do Club Penguin É o saldo de moedas do
// Project Club (User.coins). O JSON do pinguim só espelha esse número:
//  - ao carregar um pinguim de uma conta, `coins` vem do User;
//  - quando o jogo muda o saldo (minijogo, compra), a diferença vai pro User
//    (UPDATE atômico, nunca abaixo de 0) e entra no histórico da carteira;
//  - quando o saldo muda fora do jogo (loja, baú, missão…), refreshCoins()
//    traz a diferença pro pinguim (o servidor chama a cada poucos segundos
//    pra quem está online; e ao ler do cache).
// Tudo de um pinguim passa pela mesma fila (writes) — leitura e gravação do
// saldo nunca se cruzam.
const COINS_FRESH_MS = 3000;
// Quanto o jogo pode PAGAR por dia (minijogos, cavar moedas…). Os minijogos
// de 2012 pagam centenas de moedas por partida — sem teto, o Club Penguin
// virava a fonte de moedas do Project Club inteiro. 0 = sem limite.
const DAILY_GAME_COINS = Math.max(0, parseInt(process.env.PLAZA_DAILY_COINS || '500', 10) || 0);
const DAY_TZ_OFFSET_MIN = -180; // dia do Brasil (UTC-3)

function startOfToday() {
  const now = Date.now() + DAY_TZ_OFFSET_MIN * 60000;
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - DAY_TZ_OFFSET_MIN * 60000);
}

class PrismaPenguinStore {
  constructor(prisma) {
    this.prisma = prisma;
    this.cache = new Map(); // id -> json
    this.writes = new Map(); // id -> Promise
    this.nextIdLock = Promise.resolve();
    this.owner = new Map(); // id -> userId da conta (ou null)
    this.synced = new Map(); // id -> saldo em que jogo e Project Club concordam
    this.coinsAt = new Map(); // id -> quando o saldo foi conferido no banco
    this.onCoins = null; // (id, diff) — o saldo mudou fora do jogo: avisa o pinguim online
    this.onUserCoins = null; // (userId, coins) — o jogo mudou o saldo: avisa o site
    this.onCoinCap = null; // (userId, cap) — bateu o limite do dia
    this.uncapped = new Set(); // ids cuja próxima gravação não conta no limite (painel da staff)
    this.dailyCap = DAILY_GAME_COINS;
    this.friendsAt = new Map(); // id -> quando os amigos do Project Club foram conferidos
  }

  // ---- fila por pinguim ----
  enqueue(id, task) {
    const previous = this.writes.get(id) || Promise.resolve();
    const queued = previous.catch(() => undefined).then(task);
    this.writes.set(id, queued);
    const cleanUp = () => { if (this.writes.get(id) === queued) this.writes.delete(id); };
    queued.then(cleanUp, cleanUp);
    return queued;
  }

  // ---- moeda única ----
  async userCoins(userId) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { coins: true } });
    return u && Number.isFinite(u.coins) ? u.coins : null;
  }

  async addUserCoins(userId, delta) {
    if (typeof this.prisma.$executeRaw === 'function') {
      await this.prisma.$executeRaw`UPDATE \`User\` SET coins = GREATEST(0, coins + ${delta}) WHERE id = ${userId}`;
    } else {
      await this.prisma.user.update({ where: { id: userId }, data: { coins: { increment: delta } } });
    }
    return this.userCoins(userId);
  }

  // ---- amigos do Project Club = amigos no jogo ----
  /** Pinguins das contas que são amigas (amizade aceita) desta conta. */
  async friendPenguinIds(userId) {
    const fr = this.prisma.friendship;
    if (!fr || typeof fr.findMany !== 'function') return null;
    const rows = await fr.findMany({ where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] }, select: { requesterId: true, addresseeId: true }, take: 2000 });
    const friendIds = [...new Set(rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId)))];
    if (!friendIds.length) return new Map();
    const pens = await this.prisma.waddlePenguin.findMany({ where: { userId: { in: friendIds } }, select: { id: true, name: true } });
    return new Map(pens.map((p) => [Number(p.id), p.name]));
  }

  /**
   * Põe os amigos do Project Club na lista de amigos do jogo (amigos feitos
   * dentro do jogo continuam). Quem desfaz a amizade no site sai da lista
   * pelo aviso de friendEvents (index.js). Devolve os ids adicionados.
   */
  syncFriends(id, { force = false } = {}) {
    id = Number(id);
    const userId = this.owner.get(id);
    if (!userId) return Promise.resolve([]);
    if (!force && Date.now() - (this.friendsAt.get(id) || 0) < 30000) return Promise.resolve([]);
    this.friendsAt.set(id, Date.now());
    return this.enqueue(id, async () => {
      const json = this.cache.get(id);
      if (!json) return [];
      const friends = await this.friendPenguinIds(userId).catch(() => null);
      if (!friends) return [];
      friends.delete(id);
      const buddies = new Set((Array.isArray(json.buddies) ? json.buddies : []).map(Number));
      const ignored = new Set((Array.isArray(json.ignored) ? json.ignored : []).map(Number));
      const added = [];
      for (const pid of friends.keys()) if (!buddies.has(pid) && !ignored.has(pid)) { buddies.add(pid); added.push(pid); }
      if (added.length) json.buddies = [...buddies];
      return added;
    });
  }

  /** Próxima gravação deste pinguim não conta no limite diário (moedas dadas pela staff). */
  allowUncapped(id) { this.uncapped.add(Number(id)); }

  /** Quanto o jogo já pagou hoje pra esta conta. */
  async earnedToday(userId) {
    const et = this.prisma.economyTransaction;
    if (!et || typeof et.aggregate !== 'function') return 0;
    try {
      const r = await et.aggregate({ _sum: { coins: true }, where: { userId, kind: 'GAME', coins: { gt: 0 }, createdAt: { gte: startOfToday() } } });
      return r?._sum?.coins || 0;
    } catch { return 0; }
  }

  /** Confere o saldo da conta e traz pro pinguim o que mudou fora do jogo. */
  refreshCoins(id, { force = false } = {}) {
    id = Number(id);
    const userId = this.owner.get(id);
    if (!userId) return Promise.resolve();
    if (!force && Date.now() - (this.coinsAt.get(id) || 0) < COINS_FRESH_MS) return Promise.resolve();
    this.coinsAt.set(id, Date.now());
    return this.enqueue(id, async () => {
      const coins = await this.userCoins(userId);
      if (coins === null) return;
      this.coinsAt.set(id, Date.now());
      const before = this.synced.get(id);
      const json = this.cache.get(id);
      this.synced.set(id, coins);
      if (before === undefined) { if (json) json.coins = coins; return; }
      if (coins === before) return;
      const diff = coins - before;
      if (json) json.coins = Math.max(0, (Number(json.coins) || 0) + diff);
      try { this.onCoins?.(id, diff, coins); } catch { /* ok */ }
    });
  }

  /** Saldo que o jogo deve usar pro pinguim recém-lido do banco. */
  async adoptUserCoins(id, json, userId) {
    this.owner.set(id, userId || null);
    if (!userId) return;
    const coins = await this.userCoins(userId).catch(() => null);
    if (coins === null) return;
    json.coins = coins;
    this.synced.set(id, coins);
    this.coinsAt.set(id, Date.now());
  }

  async get(id) {
    id = Number(id);
    if (!Number.isInteger(id)) return null;
    const cached = this.cache.get(id);
    if (cached) {
      await this.refreshCoins(id).catch(() => {});
      await this.syncFriends(id).catch(() => {});
      return this.cache.get(id) || cached;
    }
    const row = await this.prisma.waddlePenguin.findUnique({ where: { id }, select: { data: true, userId: true } });
    if (!row) return null;
    const json = JSON.parse(row.data);
    await this.adoptUserCoins(id, json, row.userId);
    this.cache.set(id, json);
    await this.syncFriends(id).catch(() => {});
    return json;
  }

  async createWithId(id, data) {
    id = Number(id);
    await this.prisma.waddlePenguin.upsert({
      where: { id },
      create: { id, name: data.name, data: JSON.stringify(data) },
      update: {},
    });
    this.cache.set(id, data);
  }

  // Reserva o próximo id (>= FIRST_USER_ID) de forma serializada no processo
  // e à prova de corrida entre instâncias (a unicidade de `id` no banco
  // rejeita duplicata; aí tenta de novo).
  async create(data, userId = null) {
    if (userId) {
      const coins = await this.userCoins(userId).catch(() => null);
      if (coins !== null) data.coins = coins;
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const agg = await this.prisma.waddlePenguin.aggregate({ _max: { id: true } });
      const id = Math.max(FIRST_USER_ID, (agg._max.id || 0) + 1);
      try {
        await this.prisma.waddlePenguin.create({ data: { id, userId, name: data.name, data: JSON.stringify(data) } });
        this.cache.set(id, data);
        this.owner.set(id, userId || null);
        if (userId && Number.isFinite(data.coins)) { this.synced.set(id, data.coins); this.coinsAt.set(id, Date.now()); }
        return id;
      } catch (err) {
        if (err?.code !== 'P2002') throw err; // P2002 = unique violation (id ou nome)
        if (String(err?.meta?.target || '').includes('name')) throw err;
      }
    }
    throw new Error('Não consegui reservar um id de pinguim.');
  }

  write(id, data) {
    id = Number(id);
    this.cache.set(id, data);
    const snapshot = JSON.parse(JSON.stringify(data));
    return this.enqueue(id, async () => {
      // moeda única: o que o jogo ganhou/gastou vai pro saldo da conta
      const userId = this.owner.get(id);
      const before = this.synced.get(id);
      if (userId && before !== undefined && Number.isFinite(snapshot.coins)) {
        let delta = Math.trunc(snapshot.coins) - before;
        const uncapped = this.uncapped.delete(id);
        let capped = false;
        if (delta > 0 && this.dailyCap > 0 && !uncapped) {
          const room = Math.max(0, this.dailyCap - await this.earnedToday(userId));
          if (delta > room) { delta = room; capped = true; }
        }
        if (capped) { try { this.onCoinCap?.(userId, this.dailyCap); } catch { /* ok */ } }
        if (delta === 0 && capped) {
          // nada a pagar: o pinguim volta pro saldo da conta
          const diff = before - snapshot.coins;
          snapshot.coins = before;
          const json = this.cache.get(id);
          if (json) json.coins = Math.max(0, (Number(json.coins) || 0) + diff);
          try { this.onCoins?.(id, diff, before); } catch { /* ok */ }
        }
        if (delta !== 0) {
          const coins = await this.addUserCoins(userId, delta);
          if (coins !== null) {
            this.synced.set(id, coins);
            this.coinsAt.set(id, Date.now());
            try { this.onUserCoins?.(userId, coins); } catch { /* ok */ }
            // (esperado: o limite diário soma o histórico)
            try { await require('../economyLedger').recordTransaction(userId, { kind: uncapped ? 'ADMIN' : 'GAME', label: uncapped ? 'Club Penguin (equipe)' : (delta > 0 ? 'Club Penguin' : 'Compra no Club Penguin'), coins: delta }); } catch { /* histórico é opcional */ }
            if (coins !== snapshot.coins) {
              // a conta tinha outro saldo (gastou no site no meio do caminho)
              const diff = coins - snapshot.coins;
              snapshot.coins = coins;
              const json = this.cache.get(id);
              if (json) json.coins = Math.max(0, (Number(json.coins) || 0) + diff);
              try { this.onCoins?.(id, diff, coins); } catch { /* ok */ }
            }
          }
        }
      }
      await this.prisma.waddlePenguin.update({ where: { id }, data: { data: JSON.stringify(snapshot), name: data.name } });
    });
  }

  async fromName(name) {
    if (typeof name !== 'string' || !name) return null;
    // Collation padrão do MySQL é case-insensitive — bate com o WF (que compara em minúsculas).
    const row = await this.prisma.waddlePenguin.findFirst({ where: { name }, select: { id: true } });
    if (!row) return null;
    const json = await this.get(row.id);
    return json ? [row.id, json] : null;
  }

  async exists(name) {
    return (await this.fromName(name)) !== null;
  }

  // ---- extras do Project Club (não fazem parte da interface do WF) ----

  async idForUser(userId) {
    const row = await this.prisma.waddlePenguin.findUnique({ where: { userId }, select: { id: true } });
    return row ? row.id : null;
  }

  async bindUser(id, userId) {
    await this.prisma.waddlePenguin.update({ where: { id }, data: { userId } });
    this.owner.set(Number(id), userId || null);
    this.synced.delete(Number(id));
    this.forget(id);
  }

  // Derruba o cache de um pinguim (ex.: staff mexeu direto no banco).
  forget(id) {
    this.cache.delete(Number(id));
  }
}

module.exports = { PrismaPenguinStore, FIRST_USER_ID };
