// Presença (quem está online agora, e em quais sockets/abas) — vive no
// Redis, não em memória do processo, justamente pra funcionar certo se a
// plataforma um dia rodar em mais de uma instância (hoje é só uma, mas o
// código já fica pronto pra isso). Uma chave por usuário
// (`presence:sockets:<userId>`), guardando o conjunto de socket ids
// conectados agora — quando o último socket sai, o Redis apaga a chave
// sozinho (comportamento nativo de SET vazio), então "está online" é
// simplesmente "essa chave existe".
const { redis } = require('../config/redis');

const keyFor = (userId) => `presence:sockets:${userId}`;

// BUG CORRIGIDO ("continua aparecendo online mesmo sem a web aberta"): a
// chave acima nunca tinha um TTL — a ÚNICA forma dela ser limpa era o
// evento 'disconnect' do socket rodar e chamar removeSocket(). Isso
// funciona bem numa desconexão normal (fechar a aba, cair a rede), mas
// toda vez que o PROCESSO do servidor reinicia (um deploy, um crash, um
// restart manual) — o que aconteceu várias vezes só nesta sessão — o
// processo morre e leva junto qualquer conexão de socket ativa, SEM
// nunca disparar 'disconnect' pra elas (não tem quem rode o handler,
// o processo que rodaria já não existe mais). O socket id de quem
// estava conectado na hora do restart ficava preso no Redis PARA
// SEMPRE — como esse mesmo id nunca mais vai se reconectar (uma
// reconexão de verdade sempre ganha um id NOVO), a chave nunca mais
// esvaziava sozinha, e a pessoa continuava aparecendo online (ou
// ausente, dependendo de quanto tempo já tinha passado) pro resto de
// todo mundo, indefinidamente, até alguém reiniciar o servidor nessa
// conta específica de novo por coincidência.
// A correção: toda entrada na chave agora expira sozinha se não for
// "renovada" periodicamente enquanto a conexão realmente existir (ver
// scheduleHeartbeat em sockets/index.js, que chama refreshPresence a
// cada ~30s enquanto o socket está de verdade conectado). Se o processo
// morrer no meio disso, ninguém mais renova a chave, e ela expira
// sozinha em no máximo PRESENCE_TTL_SECONDS — a pessoa se autocorrige
// pra offline em vez de ficar presa online pra sempre.
const PRESENCE_TTL_SECONDS = 90;

// Adiciona um socket e devolve quantos sockets esse usuário tem conectados
// agora NO TOTAL (não só o que acabou de entrar) — quem chama usa isso
// pra saber se essa foi a PRIMEIRA conexão (== 1) e precisa avisar todo
// mundo que a pessoa ficou online.
async function addSocket(userId, socketId) {
  const key = keyFor(userId);
  await redis.sadd(key, socketId);
  await redis.expire(key, PRESENCE_TTL_SECONDS);
  return redis.scard(key);
}

// Remove um socket e devolve quantos sobraram — 0 significa que a pessoa
// não tem mais nenhuma aba/dispositivo conectado.
async function removeSocket(userId, socketId) {
  const key = keyFor(userId);
  await redis.srem(key, socketId);
  return redis.scard(key);
}

// Chamado periodicamente (ver sockets/index.js) enquanto uma conexão
// realmente segue viva — só "reseta o relógio" da expiração automática
// acima, sem mexer em quem está no conjunto. Se isso parar de ser
// chamado (processo morreu, ou esse socket específico já se desconectou
// e teve seu próprio heartbeat cancelado), a chave se autolimpa sozinha.
async function refreshPresence(userId) {
  await redis.expire(keyFor(userId), PRESENCE_TTL_SECONDS);
}

async function isOnline(userId) {
  return (await redis.scard(keyFor(userId))) > 0;
}

async function getSocketIds(userId) {
  return redis.smembers(keyFor(userId));
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
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'presence:sockets:*', 'COUNT', 200);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
      totalCleared += keys.length;
    }
  } while (cursor !== '0');
  return totalCleared;
}

module.exports = { addSocket, removeSocket, refreshPresence, isOnline, getSocketIds, clearAll, PRESENCE_TTL_SECONDS };
