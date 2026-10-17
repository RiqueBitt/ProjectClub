// Normalização PURA da resposta de /api/voice/provider e /api/voice/join.
// Sem React, sem rede — fácil de testar (client/test/voice-provider.test.mjs).
//
// O servidor decide qual provedor de mídia usar numa CADEIA ordenada
// (servidor próprio → LiveKit → Daily → TRTC → Jitsi), passando pro próximo
// quando um cai ou estoura o limite mensal gratuito dele. O cliente só
// obedece — mas nunca confia cegamente: se vier algo estranho (inclusive um
// provedor que não existe mais, como os antigos Agora/Stream), assume
// 'projectclub' (o servidor próprio) como padrão seguro.

// Ordem e rótulos espelhando o servidor (services/voiceProviders.js). O
// servidor é a fonte da verdade; isto é só pra UI e pra escolher o engine.
export const PROVIDER_ORDER = ['projectclub', 'livekit', 'daily', 'trtc', 'jitsi'];
export const PRIMARY_PROVIDER = 'projectclub';

// Lista completa de provedores válidos (os 5 da cadeia). Mantida como
// `PROVIDERS` por compatibilidade com quem já importava daqui.
export const PROVIDERS = PROVIDER_ORDER;

export const PROVIDER_LABELS = {
  projectclub: 'Project Club',
  livekit: 'LiveKit',
  daily: 'Daily',
  trtc: 'TRTC',
  jitsi: 'Jitsi',
};

// Quais provedores têm um engine de CLIENTE completo e pronto hoje.
// projectclub: servidor próprio (mediasoupEngine.js). livekit: engine
// completo (livekitEngine.js). jitsi: fallback final via IFrame API
// (jitsiEngine.js). daily/trtc: servidor pronto (token mintado + painel),
// engine de cliente ainda PENDENTE (pendingEngines.js) — o cliente anuncia
// isso ao servidor (clientReady) e a cadeia os pula automaticamente.
export const CLIENT_READY = {
  projectclub: true,
  livekit: true,
  jitsi: true,
  daily: false,
  trtc: false,
};

// Provedores que o cliente anuncia ao servidor como suportados
// (clientReady=...), na ordem da cadeia.
export const CLIENT_READY_PROVIDERS = PROVIDER_ORDER.filter((id) => CLIENT_READY[id]);

export function providerLabel(id) {
  return PROVIDER_LABELS[id] || id || '—';
}

// É "modo reserva" quando o ativo veio DEPOIS do primário (o servidor
// próprio) na cadeia.
export function isReserveMode(provider) {
  return !!provider && provider !== PRIMARY_PROVIDER;
}

export function isClientReady(provider) {
  return !!CLIENT_READY[provider];
}

// Normaliza a resposta de /api/voice/join (ou do antigo /api/voice/provider):
// garante um provedor válido (senão o servidor próprio), e carrega os campos
// de uso quando vierem. `fallbackActive` = está em modo reserva (ativo !=
// servidor próprio).
export function normalizeProviderResponse(data) {
  const d = data && typeof data === 'object' ? data : {};
  const provider = PROVIDERS.includes(d.provider) ? d.provider : PRIMARY_PROVIDER;
  const minutesUsed = Number.isFinite(d.minutesUsed) ? d.minutesUsed : 0;
  const limit = Number.isFinite(d.limit) && d.limit > 0 ? d.limit : null;
  return {
    provider,
    reason: typeof d.reason === 'string' ? d.reason
      : (typeof d.activeReason === 'string' ? d.activeReason : (provider === PRIMARY_PROVIDER ? 'ok' : 'reserva')),
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
// provedor (ex.: { provider:'livekit', livekit:{ url, token, ... } }).
export function readJoinResponse(data) {
  const base = normalizeProviderResponse(data);
  const d = data && typeof data === 'object' ? data : {};

  if (base.provider === 'jitsi') {
    const j = d.jitsi && typeof d.jitsi === 'object' ? d.jitsi : null;
    const valid = j && typeof j.domain === 'string' && typeof j.room === 'string' && j.domain && j.room;
    return { ...base, jitsi: valid ? { domain: j.domain, room: j.room, jwt: j.jwt || null } : null };
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

  if (base.provider === 'livekit') {
    const l = d.livekit && typeof d.livekit === 'object' ? d.livekit : null;
    const valid = l && typeof l.url === 'string' && typeof l.token === 'string' && l.url && l.token;
    return { ...base, livekit: valid ? { url: l.url, token: l.token, room: l.room || null, identity: l.identity || null } : null };
  }

  // Provedores pendentes no cliente (daily/trtc): repassa as
  // credenciais cruas sob a chave do provedor (o engine pendente decide).
  const raw = d[base.provider] && typeof d[base.provider] === 'object' ? d[base.provider] : null;
  return { ...base, [base.provider]: raw };
}
