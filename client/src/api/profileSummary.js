import { api } from './client';
import { getUserProfile, getFanStatus, getTraitStatus, listProfilePollsByAuthor, listProfileVisitors } from './endpoints';

// Cabeçalho do perfil completo numa requisição só (GET /users/:id/summary,
// ver server/src/controllers/profileSummaryController.js): perfil + "sou
// fã" + traços + enquetes (+ visitantes no próprio perfil). Servidor
// antigo sem a rota (404) → busca cada parte pela rota antiga, igual antes.
let unsupported = false;

async function legacySummary(userId, isMe) {
  const soft = (p) => p.catch(() => undefined);
  const [profile, fan, traits, polls, visitors] = await Promise.all([
    getUserProfile(userId),
    soft(getFanStatus(userId)),
    soft(getTraitStatus(userId)),
    soft(listProfilePollsByAuthor(userId)),
    isMe ? soft(listProfileVisitors(userId)) : undefined,
  ]);
  return { profile, fan, traits, polls, visitors };
}

export async function getProfileSummary(userId, { isMe = false } = {}) {
  if (unsupported) return legacySummary(userId, isMe);
  try {
    const { data } = await api.get(`/users/${userId}/summary`);
    if (!data || !data.profile) throw Object.assign(new Error('resposta inesperada'), { soft: true });
    return data;
  } catch (err) {
    // Só cai pras rotas antigas quando a rota nova não existe; outros erros
    // (perfil não encontrado, sem rede) seguem como erro, igual antes.
    const routeMissing = err?.response?.status === 404 && (!err.response.data?.error || err.response.data.error === 'Rota não encontrada.');
    if (routeMissing) { unsupported = true; return legacySummary(userId, isMe); }
    if (err?.soft) return legacySummary(userId, isMe);
    throw err;
  }
}
