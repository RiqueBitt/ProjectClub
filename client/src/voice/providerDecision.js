// Normalização PURA da resposta de /api/voice/provider e /api/voice/join.
// Sem React, sem rede — fácil de testar (client/test/voice-provider.test.mjs).
//
// O servidor decide qual provedor de mídia usar (Agora normal ou Jitsi
// reserva, quando o Agora está perto do limite mensal). O cliente só
// obedece — mas nunca confia cegamente: se vier algo estranho, assume
// 'agora' como padrão seguro (o caminho já testado em produção).

export const PROVIDERS = ['agora', 'jitsi'];

export function normalizeProviderResponse(data) {
  const d = data && typeof data === 'object' ? data : {};
  const provider = PROVIDERS.includes(d.provider) ? d.provider : 'agora';
  const minutesUsed = Number.isFinite(d.minutesUsed) ? d.minutesUsed : 0;
  const limit = Number.isFinite(d.limit) && d.limit > 0 ? d.limit : null;
  return {
    provider,
    reason: typeof d.reason === 'string' ? d.reason : (provider === 'jitsi' ? 'reserva' : 'ok'),
    minutesUsed,
    limit,
    fallbackActive: provider === 'jitsi',
  };
}

// Decide se uma chamada EM ANDAMENTO precisa trocar de provedor, dado o
// provedor atual e o que o servidor passou a recomendar. Só troca quando
// realmente muda — evita re-join à toa.
export function shouldSwitchProvider(currentProvider, recommendedProvider) {
  if (!PROVIDERS.includes(recommendedProvider)) return false;
  return currentProvider !== recommendedProvider;
}

// Extrai as credenciais do provedor escolhido de uma resposta de
// /api/voice/join. Devolve { provider, agora?, jitsi? } já validado.
export function readJoinResponse(data) {
  const base = normalizeProviderResponse(data);
  const d = data && typeof data === 'object' ? data : {};
  if (base.provider === 'jitsi') {
    const j = d.jitsi && typeof d.jitsi === 'object' ? d.jitsi : null;
    const valid = j && typeof j.domain === 'string' && typeof j.room === 'string' && j.domain && j.room;
    return { ...base, jitsi: valid ? { domain: j.domain, room: j.room, jwt: j.jwt || null } : null };
  }
  const a = d.agora && typeof d.agora === 'object' ? d.agora : null;
  const valid = a && typeof a.token === 'string' && typeof a.appId === 'string' && a.token && a.appId;
  return { ...base, agora: valid ? { token: a.token, appId: a.appId, uid: a.uid } : null };
}
