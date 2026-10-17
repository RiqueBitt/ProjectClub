import { markChannelRead, markConversationRead } from '../api/endpoints';

// "Marcar como lido" agrupado. Antes o chat mandava um POST .../read a
// CADA mensagem nova que chegava com a sala aberta — num canal
// movimentado isso dava 2-3 requisições por segundo por pessoa (visto nos
// logs). Agora: no máximo uma por sala a cada 2s, e só se existe mensagem
// mais nova do que a última leitura já enviada. A parte visual (bolinhas
// de não lido) continua sendo atualizada na hora pelo store — isso aqui
// só controla a ida ao servidor.
const WINDOW_MS = 2000;
// Margem pra diferença de relógio entre o aparelho e o servidor quando a
// resposta não traz o horário oficial (conversas).
const CLOCK_SLACK_MS = 5000;
const rooms = new Map(); // `${kind}:${id}` -> { sentAt, coveredAt, newestAt, timer, inFlight }

const toMs = (v) => {
  if (!v) return 0;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : 0;
};

function send(kind, id, st) {
  st.sentAt = Date.now();
  st.inFlight = true;
  const sentClock = Date.now();
  const req = kind === 'channel' ? markChannelRead(id) : markConversationRead(id);
  return req.then((d) => {
    const serverAt = toMs(d?.lastReadAt);
    st.coveredAt = Math.max(st.coveredAt, serverAt || (sentClock - CLOCK_SLACK_MS));
  }).catch(() => {
    // Falhou: deixa a próxima chamada tentar de novo.
  }).finally(() => { st.inFlight = false; });
}

// `newestAt`: createdAt da mensagem mais nova visível na sala (ou nada,
// ao abrir a sala antes das mensagens chegarem).
export function queueRead(kind, id, newestAt) {
  if (!id) return;
  const key = `${kind}:${id}`;
  let st = rooms.get(key);
  if (!st) { st = { sentAt: 0, coveredAt: 0, newestAt: 0, timer: null, inFlight: false }; rooms.set(key, st); }
  st.newestAt = Math.max(st.newestAt, toMs(newestAt));
  // Já enviada uma leitura que cobre a mensagem mais nova: nada a fazer.
  if (st.sentAt && st.newestAt && st.newestAt <= st.coveredAt) return;
  const wait = st.sentAt + WINDOW_MS - Date.now();
  if (wait <= 0 && !st.inFlight) { send(kind, id, st); return; }
  if (st.timer) return; // já tem um envio agendado pro fim da janela
  st.timer = setTimeout(() => {
    st.timer = null;
    if (st.newestAt && st.newestAt <= st.coveredAt) return;
    send(kind, id, st);
  }, Math.max(wait, 200));
}

// Testes / troca de conta.
export function _resetReadMarker() {
  rooms.forEach((st) => clearTimeout(st.timer));
  rooms.clear();
}
