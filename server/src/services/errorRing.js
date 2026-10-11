// Últimos erros do servidor e das telas, só em memória (aba "Saúde" do
// painel da staff). Os mesmos que já iam pro log ([erro 5xx] no
// errorHandler e [erro-de-tela] em /api/system/client-error) — guardados
// aqui também num buffer circular pequeno, pra staff ver sem abrir o log.
// Nada de dados pessoais além do que já ia pro log; some num restart.
const MAX = 50;
const ring = [];
let total = 0;
const startedAt = Date.now();

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n);

// kind: 'server' (5xx de uma rota) | 'client' (erro de tela) | 'process'
function recordError(kind, { message, where, path, status, stack } = {}) {
  total += 1;
  ring.push({
    at: new Date().toISOString(),
    kind,
    status: Number.isFinite(status) ? status : null,
    where: clip(where, 60) || null,
    path: clip(path, 160) || null,
    message: clip(message, 300) || 'Erro sem mensagem',
    stack: stack ? clip(stack, 600) : null,
  });
  if (ring.length > MAX) ring.splice(0, ring.length - MAX);
}

function recentErrors(limit = 20) {
  return ring.slice(-limit).reverse();
}

function errorStats() {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const lastHour = ring.filter((e) => new Date(e.at).getTime() > hourAgo).length;
  return { total, lastHour, since: new Date(startedAt).toISOString() };
}

module.exports = { recordError, recentErrors, errorStats, MAX };
