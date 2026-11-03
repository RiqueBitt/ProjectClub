// Fase 5 — segurança das sessões (Configurações → Segurança → Dispositivos
// conectados) e o aviso in-app de novo acesso.
//
// Tudo aqui recebe o `db` (Prisma) injetado pra poder ser testado sem banco;
// o Prisma de verdade só é carregado quando ninguém passa um.
const getPrisma = () => require('../config/prisma');

// Motivos de revogação que NÃO encerram a sessão (o aparelho continua o
// mesmo, só trocou de token): rotação normal e o token novo abandonado na
// recuperação de sessão (ver authController.refresh).
const NON_TERMINAL_REASONS = new Set(['ROTATED', 'ABANDONED']);

// "Chrome no Windows", "Safari no iPhone", "App desktop"... — só pra
// mostrar na lista de sessões, no e-mail e no aviso de novo acesso.
// Heurística simples de propósito (sem dependência nova).
function describeDevice(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return 'Dispositivo desconhecido';
  let browser = 'Navegador';
  if (/Electron\//i.test(ua)) browser = 'App desktop';
  else if (/Edg(e|A|iOS)?\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  let os = '';
  if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone/i.test(ua)) os = 'iPhone';
  else if (/iPad/i.test(ua)) os = 'iPad';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  if (/ProjectClub|Capacitor|wv\)/i.test(ua) && os === 'Android') browser = 'App';
  return os ? `${browser} no ${os}` : browser;
}

// IP mascarado — o suficiente pra pessoa reconhecer "essa é minha rede de
// casa", sem expor o endereço inteiro na tela.
function maskIp(ip) {
  if (!ip) return null;
  const clean = String(ip).replace(/^::ffff:/i, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(clean)) {
    const parts = clean.split('.');
    return `${parts[0]}.${parts[1]}.x.x`;
  }
  if (clean.includes(':')) {
    const groups = clean.split(':').filter(Boolean);
    return `${groups.slice(0, 2).join(':')}:…`;
  }
  return null;
}

// Segue a corrente de rotação (replacedById) a partir de um token.
async function followChain(db, startId, limit = 200) {
  const chain = [];
  const seen = new Set();
  let id = startId;
  while (id && !seen.has(id) && chain.length < limit) {
    seen.add(id);
    // eslint-disable-next-line no-await-in-loop
    const row = await db.refreshToken.findUnique({ where: { id } });
    if (!row) break;
    chain.push(row);
    id = row.replacedById;
  }
  return chain;
}

// O "lembrar login" (cookie pcKeep) criado junto com o token `rid` ainda
// vale? Não vale se QUALQUER token da corrente daquela sessão foi
// encerrado de propósito (sair, "Sair deste dispositivo", troca de senha,
// ban, roubo...). Cookie antigo sem `rid` ou linha já apagada pela faxina:
// segue a regra antiga (só a derrubada geral por Redis invalida).
async function keepSessionAlive(rid, { db = getPrisma() } = {}) {
  if (!rid) return true;
  const chain = await followChain(db, rid);
  if (!chain.length) return true;
  return !chain.some((t) => t.revoked && !NON_TERMINAL_REASONS.has(t.revokedReason || ''));
}

// Encerra UMA sessão (aparelho) inteira: o token atual e qualquer token que
// esteja nascendo dela numa rotação simultânea. Todos os tokens de uma
// sessão herdam o mesmo sessionStartedAt (ver issueSession), então o filtro
// por dono + sessionStartedAt pega até o filho que ainda não foi ligado
// por replacedById. Linhas antigas sem sessionStartedAt: segue a corrente.
// Sempre restrito ao DONO (userId) — nunca toca sessão de outra conta.
async function revokeSessionFamily(session, reason, { db = getPrisma(), now = new Date() } = {}) {
  if (!session?.id || !session.userId) return 0;
  const data = { revoked: true, revokedAt: now, revokedReason: reason };
  let total = 0;
  if (session.sessionStartedAt) {
    const r = await db.refreshToken.updateMany({
      where: { userId: session.userId, sessionStartedAt: session.sessionStartedAt, revoked: false },
      data,
    });
    total += r?.count || 0;
  }
  const chain = await followChain(db, session.id);
  const ids = chain.filter((t) => t.userId === session.userId && !t.revoked).map((t) => t.id);
  if (ids.length) {
    const r = await db.refreshToken.updateMany({ where: { id: { in: ids }, userId: session.userId, revoked: false }, data });
    total += r?.count || 0;
  }
  return total;
}

// Aviso in-app (sininho/Notificações + push) de novo acesso. Só usa o que
// o próprio pedido já trouxe (aparelho pelo user-agent e a rede mascarada)
// — nenhuma consulta externa de geolocalização.
function buildLoginNotice({ userAgent, ip, when = new Date(), sessionId = null }) {
  const device = describeDevice(userAgent);
  const network = maskIp(ip);
  const whenText = new Date(when).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parts = [device, network ? `rede ${network}` : null, whenText].filter(Boolean);
  return {
    kind: 'SECURITY',
    title: 'Novo acesso à sua conta',
    body: `${parts.join(' · ')}. Se não foi você, toque em "Não fui eu" para encerrar a sessão e trocar a senha.`,
    link: '/seguranca/sessoes',
    data: { type: 'new_login', device, network, sessionId },
  };
}

module.exports = {
  describeDevice, maskIp, followChain, keepSessionAlive, revokeSessionFamily, buildLoginNotice,
  NON_TERMINAL_REASONS,
};
