// "Está no celular": guarda, por pessoa, de que tipo de aparelho é cada
// conexão aberta (socket). Se TODAS as conexões dela forem de celular (app
// Android nativo ou site aberto no celular), a bolinha verde vira um ícone
// de celular pra todo mundo — igual ao Discord. Em memória do processo
// (o servidor roda numa instância só); some sozinho quando o socket cai.
const sockets = new Map(); // userId -> Map<socketId, boolean (é celular)>

function isMobileUserAgent(ua) {
  const s = String(ua || '');
  if (/Electron\//i.test(s)) return false; // app de PC
  if (/ProjectClub\/[\d.]+.*Nativo|ProjectClubNativo/i.test(s)) return true; // app Android
  return /Android|iPhone|iPad|iPod|Mobile/i.test(s);
}

function onMobile(userId) {
  const m = sockets.get(userId);
  if (!m || m.size === 0) return false;
  for (const mobile of m.values()) if (!mobile) return false;
  return true;
}

// Devolve true se o "está no celular" da pessoa mudou com esta conexão.
function add(userId, socketId, mobile) {
  const before = onMobile(userId);
  if (!sockets.has(userId)) sockets.set(userId, new Map());
  sockets.get(userId).set(socketId, !!mobile);
  return before !== onMobile(userId);
}

function remove(userId, socketId) {
  const m = sockets.get(userId);
  if (!m) return false;
  const before = onMobile(userId);
  m.delete(socketId);
  if (m.size === 0) sockets.delete(userId);
  return before !== onMobile(userId);
}

module.exports = { isMobileUserAgent, onMobile, add, remove };
