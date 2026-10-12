// "Invisível" é um status que só a PRÓPRIA pessoa enxerga — pra todo o
// resto ela aparece offline. Antes o valor cru (INVISIBLE) ia pros outros
// clientes no presence:sync/presence:update e na lista de membros, e
// qualquer um via no DevTools quem estava "invisível" online.
function visibleStatus(status, isSelf = false) {
  if (!isSelf && status === 'INVISIBLE') return 'OFFLINE';
  return status;
}

// Devolve uma cópia do usuário com o status mascarado pra quem está vendo
// (viewerId). Não mexe no objeto original.
function maskUserStatus(user, viewerId) {
  if (!user || user.status !== 'INVISIBLE' || user.id === viewerId) return user;
  return { ...user, status: 'OFFLINE' };
}

// Versão "central" (BUG CORRIGIDO: vazamento do invisível): PUBLIC_USER_FIELDS
// (authController) inclui `status`, e é usado em dezenas de respostas e
// eventos de socket (autor de mensagem, amigos, perfil, ranking...). Em vez
// de lembrar de mascarar em cada um, a resposta HTTP inteira e cada evento
// de socket passam por aqui: qualquer objeto com `id` e status INVISIBLE
// que NÃO seja de quem está vendo vira OFFLINE. /auth/me continua igual
// (o objeto é da própria pessoa).
//
// Copy-on-write: só copia os objetos/arrays no caminho de algo que mudou —
// o original nunca é alterado (pode ser um cache em memória) e, se nada
// precisa mudar, devolve a MESMA referência.
const MAX_DEPTH = 12;
function isPlainContainer(v) {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return true;
  if (v instanceof Date || Buffer.isBuffer(v) || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function maskDeep(value, viewerId, depth = 0) {
  if (depth > MAX_DEPTH || !isPlainContainer(value)) return value;
  if (Array.isArray(value)) {
    let out = null;
    for (let i = 0; i < value.length; i += 1) {
      const item = value[i];
      const masked = maskDeep(item, viewerId, depth + 1);
      if (masked !== item) {
        if (!out) out = value.slice();
        out[i] = masked;
      }
    }
    return out || value;
  }
  let out = null;
  if (value.status === 'INVISIBLE' && typeof value.id === 'string' && value.id !== viewerId) {
    out = { ...value, status: 'OFFLINE' };
  }
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child === null || typeof child !== 'object') continue;
    const masked = maskDeep(child, viewerId, depth + 1);
    if (masked !== child) {
      if (!out) out = { ...value };
      out[key] = masked;
    }
  }
  return out || value;
}

// Middleware Express: mascara o corpo de todo res.json() pra quem pediu.
// Sem login (req.user vazio) => mascara tudo.
function maskInvisibleResponses(req, res, next) {
  const originalJson = res.json;
  res.json = function maskedJson(body) {
    let out = body;
    try { out = maskDeep(body, req.user?.id || null); } catch { out = body; }
    return originalJson.call(this, out);
  };
  next();
}

// Socket.IO: mascara os argumentos de todo emit. Pra sala `user:<id>`
// (notifyUser) quem vê é aquela pessoa; pra um socket direto, o dono do
// socket; pra broadcast (comunidade, canal, DM), ninguém em especial — o
// invisível aparece OFFLINE pra todos (o próprio status da pessoa vem do
// /auth/me e do presence:sync, que já tratam o "é você").
function viewerFromRooms(rooms) {
  if (!rooms || rooms.size !== 1) return null;
  const [room] = rooms;
  return typeof room === 'string' && room.startsWith('user:') ? room.slice(5) : null;
}

function installSocketMasking(io) {
  const sample = io.to('__mask_probe__');
  const BroadcastProto = Object.getPrototypeOf(sample);
  if (BroadcastProto && !BroadcastProto.__invisibleMasked) {
    const orig = BroadcastProto.emit;
    BroadcastProto.emit = function maskedBroadcastEmit(ev, ...args) {
      let viewer = null;
      try { viewer = viewerFromRooms(this.rooms); } catch { viewer = null; }
      return orig.call(this, ev, ...args.map((a) => (typeof a === 'function' ? a : maskDeep(a, viewer))));
    };
    Object.defineProperty(BroadcastProto, '__invisibleMasked', { value: true });
  }
  const { Socket } = require('socket.io');
  const SocketProto = Socket?.prototype;
  if (SocketProto && !SocketProto.__invisibleMasked) {
    const orig = SocketProto.emit;
    SocketProto.emit = function maskedSocketEmit(ev, ...args) {
      const viewer = this.data?.userId || this.userId || null;
      return orig.call(this, ev, ...args.map((a) => (typeof a === 'function' ? a : maskDeep(a, viewer))));
    };
    Object.defineProperty(SocketProto, '__invisibleMasked', { value: true });
  }
}

module.exports = { visibleStatus, maskUserStatus, maskDeep, maskInvisibleResponses, installSocketMasking, viewerFromRooms };
