// Normalização PURA da resposta de /api/voice/provider e /api/voice/join.
// Sem React, sem rede — fácil de testar (client/test/voice-provider.test.mjs).
//
// O servidor decide qual provedor de mídia usar numa CADEIA ordenada
// (servidor próprio → Agora → Stream), passando pro próximo quando um
// estoura o limite mensal gratuito dele ou não conecta. O cliente só obedece —
// mas nunca confia cegamente: se vier algo estranho, assume 'agora' como
// padrão seguro (o caminho já testado em produção).

// Ordem e rótulos espelhando o servidor (services/voiceProviders.js). O
// servidor é a fonte da verdade; isto é só pra UI e pra escolher o engine.
export const PROVIDER_ORDER = ['projectclub', 'agora', 'getstream'];
export const PRIMARY_PROVIDER = 'agora';

// Lista completa de provedores válidos (inclui os 6 da cadeia). Mantida
// como `PROVIDERS` por compatibilidade com quem já importava daqui.
export const PROVIDERS = PROVIDER_ORDER;

export const PROVIDER_LABELS = {
  projectclub: 'Project Club',
  agora: 'Agora',
  getstream: 'Stream',
};

// Quais provedores têm um engine de CLIENTE completo e pronto hoje.
// agora: embutido no VoiceContext. projectclub/getstream: engines próprios
// (mediasoupEngine.js / getstreamEngine.js).
// O cliente anuncia isso ao servidor (clientReady).
export const CLIENT_READY = {
  projectclub: true,
  agora: true,
  getstream: true,
};

// Provedores que o cliente anuncia ao servidor como suportados
// (clientReady=...), na ordem da cadeia.
export const CLIENT_READY_PROVIDERS = PROVIDER_ORDER.filter((id) => CLIENT_READY[id]);

export function providerLabel(id) {
  return PROVIDER_LABELS[id] || id || '—';
}

// Provedores que NÃO são "reserva": o servidor próprio (vem antes do
// primário na cadeia — é o caminho preferido) e o primário (agora).
const NOT_RESERVE = new Set(['projectclub', PRIMARY_PROVIDER]);

// É "modo reserva" quando o ativo veio DEPOIS do primário na cadeia.
export function isReserveMode(provider) {
  return !!provider && !NOT_RESERVE.has(provider);
}

export function isClientReady(provider) {
  return !!CLIENT_READY[provider];
}

// Normaliza a resposta de /api/voice/join (ou do antigo /api/voice/provider):
// garante um provedor válido (senão agora), e carrega os campos de uso quando
// vierem. `fallbackActive` = está em modo reserva (ativo != agora).
export function normalizeProviderResponse(data) {
  const d = data && typeof data === 'object' ? data : {};
  const provider = PROVIDERS.includes(d.provider) ? d.provider : 'agora';
  const minutesUsed = Number.isFinite(d.minutesUsed) ? d.minutesUsed : 0;
  const limit = Number.isFinite(d.limit) && d.limit > 0 ? d.limit : null;
  return {
    provider,
    reason: typeof d.reason === 'string' ? d.reason
      : (typeof d.activeReason === 'string' ? d.activeReason : (provider === 'agora' ? 'ok' : 'reserva')),
    minutesUsed,
    limit,
    fallbackActive: isReserveMode(provider),
    reserveMode: typeof d.reserveMode === 'boolean' ? d.reserveMode : isReserveMode(provider),
  };
}

// Decide se uma chamada EM ANDAMENTO precisa trocar de provedor, dado o
// provedor atual e o que o servidor passou a recomendar. Só troca quando
// realmente muda — evita re-join à toa.
export function shouldSwitchProvider(currentProvider, recommendedProvider) {
  if (!PROVIDERS.includes(recommendedProvider)) return false;
  return currentProvider !== recommendedProvider;
}

// Extrai e VALIDA as credenciais do provedor escolhido de uma resposta de
// /api/voice/join. Devolve a base normalizada + as credenciais sob a chave do
// provedor (ex.: { provider:'getstream', getstream:{ apiKey, token, callId } }).
export function readJoinResponse(data) {
  const base = normalizeProviderResponse(data);
  const d = data && typeof data === 'object' ? data : {};

  if (base.provider === 'agora') {
    const a = d.agora && typeof d.agora === 'object' ? d.agora : null;
    const valid = a && typeof a.token === 'string' && typeof a.appId === 'string' && a.token && a.appId;
    return { ...base, agora: valid ? { token: a.token, appId: a.appId, uid: a.uid } : null };
  }

  if (base.provider === 'projectclub') {
    const p = d.projectclub && typeof d.projectclub === 'object' ? d.projectclub : null;
    const valid = p && typeof p.url === 'string' && typeof p.token === 'string' && p.url && p.token;
    return {
      ...base,
      projectclub: valid
        ? { url: p.url, token: p.token, room: p.room || null, identity: p.identity || null, iceServers: Array.isArray(p.iceServers) ? p.iceServers : [] }
        : null,
    };
  }

  if (base.provider === 'getstream') {
    const g = d.getstream && typeof d.getstream === 'object' ? d.getstream : null;
    const valid = g && typeof g.apiKey === 'string' && typeof g.token === 'string' && g.apiKey && g.token && g.callId;
    return { ...base, getstream: valid ? { apiKey: g.apiKey, token: g.token, userId: g.userId || null, callId: String(g.callId) } : null };
  }

  return { ...base, [base.provider]: null };
}
