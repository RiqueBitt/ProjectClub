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

class PrismaPenguinStore {
  constructor(prisma) {
    this.prisma = prisma;
    this.cache = new Map(); // id -> json
    this.writes = new Map(); // id -> Promise
    this.nextIdLock = Promise.resolve();
  }

  async get(id) {
    id = Number(id);
    if (!Number.isInteger(id)) return null;
    const cached = this.cache.get(id);
    if (cached) return cached;
    const row = await this.prisma.waddlePenguin.findUnique({ where: { id }, select: { data: true } });
    if (!row) return null;
    const json = JSON.parse(row.data);
    this.cache.set(id, json);
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
    for (let attempt = 0; attempt < 5; attempt++) {
      const agg = await this.prisma.waddlePenguin.aggregate({ _max: { id: true } });
      const id = Math.max(FIRST_USER_ID, (agg._max.id || 0) + 1);
      try {
        await this.prisma.waddlePenguin.create({ data: { id, userId, name: data.name, data: JSON.stringify(data) } });
        this.cache.set(id, data);
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
    const content = JSON.stringify(data);
    const previous = this.writes.get(id) || Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      await this.prisma.waddlePenguin.update({ where: { id }, data: { data: content, name: data.name } });
    });
    this.writes.set(id, queued);
    const cleanUp = () => { if (this.writes.get(id) === queued) this.writes.delete(id); };
    queued.then(cleanUp, cleanUp);
    return queued;
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
  }

  // Derruba o cache de um pinguim (ex.: staff mexeu direto no banco).
  forget(id) {
    this.cache.delete(Number(id));
  }
}

module.exports = { PrismaPenguinStore, FIRST_USER_ID };
