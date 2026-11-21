// Leitura PURA da resposta de /api/voice/join (sem React, sem rede — testada
// em client/test/voice-provider.test.mjs). A voz usa só o servidor de mídia
// próprio: { provider:'projectclub', projectclub:{ url, token, room, identity, iceServers } }.

export const VOICE_PROVIDER = 'projectclub';

// Devolve as credenciais validadas, ou null se a resposta não trouxer
// credenciais válidas do servidor próprio (inclusive se vier outro provedor).
export function readJoinResponse(data) {
  const d = data && typeof data === 'object' ? data : {};
  if (d.provider && d.provider !== VOICE_PROVIDER) return null;
  const p = d.projectclub && typeof d.projectclub === 'object' ? d.projectclub : null;
  if (!p || typeof p.url !== 'string' || typeof p.token !== 'string' || !p.url || !p.token) return null;
  return {
    url: p.url,
    token: p.token,
    room: p.room || null,
    identity: p.identity || null,
    iceServers: Array.isArray(p.iceServers) ? p.iceServers : [],
  };
}
