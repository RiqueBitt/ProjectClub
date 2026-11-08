// Presença (quem está online agora, e em quais sockets/abas) — vive no
// Redis, não em memória do processo, justamente pra funcionar certo se a
// plataforma um dia rodar em mais de uma instância (hoje é só uma, mas o
// código já fica pronto pra isso). Uma chave por usuário
// (`presence:sockets:<userId>`), guardando o conjunto de socket ids
// conectados agora — quando o último socket sai, o Redis apaga a chave
// sozinho (comportamento nativo de SET vazio), então "está online" é
// simplesmente "essa chave existe".
const { redis } = require('../config/redis');

// Formato antigo (SET simples) — só lido/limpo pra transição; nada novo
// é gravado nele.
const legacyKeyFor = (userId) => `presence:sockets:${userId}`;
// Formato atual: SORTED SET, membro = socket id, score = último batimento
// (ms). Ver "CAUSA RAIZ da presença desencontrada" abaixo.
const keyFor = (userId) => `presence:live:${userId}`;

// BUG CORRIGIDO ("continua aparecendo online mesmo sem a web aberta"): a
// chave inteira expira sozinha se ninguém renovar (processo morreu sem
// rodar 'disconnect'), em no máximo PRESENCE_TTL_SECONDS.
const PRESENCE_TTL_SECONDS = 90;
const MEMBER_TTL_MS = PRESENCE_TTL_SECONDS * 1000;

// CAUSA RAIZ da presença desencontrada (logs "[presença] corrigido X:
// ONLINE -> OFFLINE (sem sessão real)"): o TTL acima valia pra CHAVE
// inteira, não pra cada socket. Um socket id "morto" (de antes de um
// deploy/restart, ou de uma conexão que caiu enquanto o 'connection'
// ainda estava rodando e por isso nunca chegou a registrar o
// 'disconnect') ficava no conjunto pra sempre enquanto QUALQUER outra aba
// viva da pessoa continuasse renovando a chave. Quando a última aba
// verdadeira fechava, removeSocket() devolvia 1 (o fantasma), o servidor
// achava que ainda havia uma conexão e nunca marcava OFFLINE — até a
// chave expirar e a varredura de 2 min corrigir no banco.
// Agora cada socket tem o PRÓPRIO relógio (score = último batimento):
// quem parou de bater há mais de MEMBER_TTL_MS simplesmente não conta, e
// é podado em toda operação.
function liveFloor() { return Date.now() - MEMBER_TTL_MS; }

// Adiciona um socket e devolve quantos sockets VIVOS esse usuário tem
// agora no total — quem chama usa isso pra saber se essa foi a PRIMEIRA
// conexão (== 1) e precisa avisar todo mundo que a pessoa ficou online.
async function addSocket(userId, socketId) {
  const key = keyFor(userId);
  const res = await redis.multi()
    .zremrangebyscore(key, '-inf', `(${liveFloor()}`)
    .zadd(key, Date.now(), socketId)
    .expire(key, PRESENCE_TTL_SECONDS)
    .zcard(key)
    .exec();
  return Number(res?.[3]?.[1]) || 1;
}

// Remove um socket e devolve quantos VIVOS sobraram — 0 significa que a
// pessoa não tem mais nenhuma aba/dispositivo conectado.
async function removeSocket(userId, socketId) {
  const key = keyFor(userId);
  const res = await redis.multi()
    .zrem(key, socketId)
    .zremrangebyscore(key, '-inf', `(${liveFloor()}`)
    .zcard(key)
    .exec();
  return Number(res?.[2]?.[1]) || 0;
}

// Batimento de UM socket (ver scheduleHeartbeat em sockets/index.js):
// renova o relógio dele e o da chave. Também recoloca o socket se a
// chave tiver sido apagada no meio (ex.: "Reload" do painel da staff) —
// antes o batimento só fazia EXPIRE, que não recria nada, e a pessoa
// conectada de verdade ficava "sem sessão" até recarregar a página.
// Sem socketId (chamadas antigas), só renova a chave.
async function refreshPresence(userId, socketId) {
  const key = keyFor(userId);
  if (!socketId) {
    await redis.expire(key, PRESENCE_TTL_SECONDS);
    return;
  }
  await redis.multi()
    .zadd(key, Date.now(), socketId)
    .expire(key, PRESENCE_TTL_SECONDS)
    .exec();
}

async function isOnline(userId) {
  return (await redis.zcount(keyFor(userId), liveFloor(), '+inf')) > 0;
}

async function getSocketIds(userId) {
  return redis.zrangebyscore(keyFor(userId), liveFloor(), '+inf');
}

// Ids de quem tem pelo menos um socket vivo agora (SCAN, sem travar o
// Redis). Usado pela varredura de segurança e pela aba "Saúde" da staff.
async function listOnlineUserIds() {
  const prefix = 'presence:live:';
  const ids = [];
  let cursor = '0';
  do {
    // eslint-disable-next-line no-await-in-loop
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
    cursor = nextCursor;
    if (keys.length) {
      const floor = liveFloor();
      const pipe = redis.pipeline();
      keys.forEach((k) => pipe.zcount(k, floor, '+inf'));
      // eslint-disable-next-line no-await-in-loop
      const counts = await pipe.exec();
      keys.forEach((k, i) => { if (Number(counts?.[i]?.[1]) > 0) ids.push(k.slice(prefix.length)); });
    }
  } while (cursor !== '0');
  return ids;
}

// "Reload User" (painel de staff → Reload) — apaga TODAS as chaves de
// presença de uma vez, fazendo todo mundo aparecer offline pra todo
// mundo até a própria conexão se autorrenovar (heartbeat periódico, ver
// scheduleHeartbeat em sockets/index.js) ou a pessoa recarregar a
// página (o que reconecta na hora, sem esperar o próximo heartbeat).
// NÃO mexe em sessão, token, nem em nenhum dado de conta — só nessas
// chaves de presença, que são só um cache temporário de "quem tá com o
// site aberto agora", não uma fonte de verdade de conta nenhuma.
// Usa SCAN em vez de KEYS de propósito — KEYS varre o Redis inteiro de
// uma vez e pode travar o servidor por um instante se houver muitas
// chaves; SCAN faz isso aos poucos, sem bloquear outras operações
// acontecendo em paralelo (chamadas normais de presença de quem está
// usando o site nesse exato momento).
async function clearAll() {
  let cursor = '0';
  let totalCleared = 0;
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'presence:*', 'COUNT', 200);
    cursor = nextCursor;
    const ours = keys.filter((k) => k.startsWith('presence:live:') || k.startsWith('presence:sockets:'));
    if (ours.length > 0) {
      await redis.del(...ours);
      totalCleared += ours.length;
    }
  } while (cursor !== '0');
  return totalCleared;
}

module.exports = {
  addSocket, removeSocket, refreshPresence, isOnline, getSocketIds, listOnlineUserIds, clearAll,
  PRESENCE_TTL_SECONDS, _keys: { keyFor, legacyKeyFor },
};
