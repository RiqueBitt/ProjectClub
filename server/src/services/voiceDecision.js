// Decisão da cadeia de provedores de voz (item pedido) — PURO e testável.
//
// `decideProvider()` caminha pela cadeia NA ORDEM e escolhe o PRIMEIRO
// provedor que seja, ao mesmo tempo:
//   (a) disponível/configurado (envs presentes, e o gate do Daily),
//   (b) abaixo do limite mensal (com margem), e
//   (c) não desativado manualmente pela equipe.
// Se a equipe forçou um provedor (override) e ele está disponível e não
// desativado, ele vence — ignorando o limite de propósito (a equipe
// decidiu). Se nada se qualificar, cai no Jitsi (fallback final, sempre
// disponível e ilimitado).
//
// Provedor DESARMADO pelo disjuntor de saúde (services/voiceHealth.js —
// falhando pra várias pessoas) é tratado como desativado: a cadeia pula e o
// override que apontar pra ele cai no automático. Se TUDO estiver desarmado,
// usa o primeiro disponível mesmo assim ("degradado") — um provedor instável
// é melhor do que nenhum.
//
// Recebe TUDO por parâmetro (usage, override, disabled, unhealthy, env) pra
// não depender de Redis nem de process.env nos testes.
const providers = require('./voiceProviders');
const usage = require('./voiceUsage');

// Monta o "contexto" de cada provedor uma vez só (disponibilidade,
// limite, usado, %, desativado) — reaproveitado pela decisão e pelo painel.
function buildContext({ usageByProvider = {}, disabled = [], unhealthy = [], env = process.env } = {}) {
  const disabledSet = new Set(disabled);
  const unhealthySet = new Set(unhealthy || []);
  return providers.PROVIDER_ORDER.map((id) => {
    const meta = providers.getMeta(id);
    const configured = providers.isConfigured(id, env);
    const available = providers.isAvailable(id, env);
    const limit = providers.getMonthlyLimit(id, env);
    const displayLimit = providers.getDisplayLimit(id, env);
    const used = Number(usageByProvider[id] || 0);
    const over = usage.isOverLimit(used, limit);
    const isDisabled = disabledSet.has(id);
    // Motivo de o Daily (ou outro com gate) estar configurado mas indisponível.
    const gateMissing = !!(meta.gateEnv && configured && !available);
    return {
      id,
      label: meta.label,
      order: meta.order,
      isPrimary: !!meta.isPrimary,
      configured,
      available,
      disabled: isDisabled,
      unhealthy: unhealthySet.has(id),
      gateEnv: meta.gateEnv || null,
      gateMissing,
      used,
      limit,                 // teto com margem (usado na decisão)
      displayLimit,          // teto "redondo" (mostrado no painel)
      unlimited: !Number.isFinite(limit),
      percent: usage.percentOf(used, Number.isFinite(displayLimit) ? displayLimit : limit),
      over,
    };
  });
}

// Classifica cada provedor pro painel: por que está (ou não está) sendo usado.
function statusOf(ctx, activeId) {
  if (!ctx.configured) return 'nao_configurado';
  if (ctx.gateMissing) return 'falta_chave';
  if (ctx.disabled) return 'desativado';
  if (ctx.id === activeId) return 'ativo';
  if (ctx.unhealthy) return 'instavel';
  if (ctx.over) return 'esgotado';
  return 'em_espera';
}

// Decide o provedor ativo. Devolve { provider, reason, overridden }.
function decideProvider({ usageByProvider = {}, override = null, disabled = [], unhealthy = [], env = process.env } = {}) {
  const ctxList = buildContext({ usageByProvider, disabled, unhealthy, env });
  const byId = Object.fromEntries(ctxList.map((c) => [c.id, c]));

  // 1) Override manual da equipe: vence se estiver disponível, não desativado
  //    e não desarmado pelo disjuntor.
  if (override && byId[override]) {
    const o = byId[override];
    if (o.available && !o.disabled && !o.unhealthy) {
      return { provider: override, reason: 'override', overridden: true };
    }
    // Override apontando pra algo indisponível/desativado/falhando: ignora e
    // segue o automático (nunca deixa a voz presa num provedor que não dá).
  }

  // 2) Automático: primeiro disponível, saudável, abaixo do limite e não desativado.
  for (const c of ctxList) {
    if (c.available && !c.disabled && !c.over && !c.unhealthy) {
      return { provider: c.id, reason: c.isPrimary ? 'primary' : 'chain', overridden: false };
    }
  }

  // 3) Todos os que sobraram estão desarmados: usa o primeiro mesmo assim.
  for (const c of ctxList) {
    if (c.available && !c.disabled && !c.over) {
      return { provider: c.id, reason: 'degraded', overridden: false };
    }
  }

  // 4) Nada se qualificou → Jitsi (sempre disponível, ilimitado).
  return { provider: 'jitsi', reason: 'fallback', overridden: false };
}

// Um provedor serve pra SALA (independente do aparelho de quem pergunta)?
function usableForRoom(id, { usageByProvider = {}, disabled = [], unhealthy = [], env = process.env } = {}) {
  const c = buildContext({ usageByProvider, disabled, unhealthy, env }).find((x) => x.id === id);
  return !!(c && c.available && !c.disabled && !c.over && !c.unhealthy);
}

// "Todo mundo do mesmo canal no MESMO provedor" — PURO.
//   decided        = escolha da cadeia pra ESTE aparelho (sem o que ele não suporta)
//   globalProvider = escolha da cadeia sem restrição de aparelho
//   sticky         = provedor fixado na sala (ou null)
//   active         = tem gente na sala (ou a fixação é recentíssima: alguém
//                    está entrando agora e ainda não apareceu na lista)
//   stickyForRoom  = a fixação ainda serve pra sala (disponível/saudável/…)
//   stickyForMe    = … e este aparelho também consegue usá-la
// Devolve { provider, write (gravar nova fixação), migrate (avisar a sala
// pra trocar junto) }.
function resolveRoomProvider({ decided, globalProvider, sticky, active, stickyForRoom, stickyForMe }) {
  if (!sticky || !active) return { provider: decided, write: true, migrate: false };
  if (stickyForRoom && stickyForMe) return { provider: sticky, write: false, migrate: false };
  if (stickyForRoom) {
    // A sala está num provedor bom, mas ESTE aparelho não consegue usá-lo
    // (não suporta / acabou de falhar nele). Se a escolha dele é a escolha
    // geral da cadeia, a sala inteira vai junto pra lá (converge pra um só);
    // senão ele entra sozinho no que dá, sem arrastar a sala.
    if (decided === globalProvider && decided !== sticky) return { provider: decided, write: true, migrate: true };
    return { provider: decided, write: false, migrate: false };
  }
  // A fixação ficou ruim (desarmada/desativada/estourada): a sala migra.
  return { provider: decided, write: true, migrate: decided !== sticky };
}

// Dados completos pro painel da staff (sem segredo nenhum).
function buildPanel({ usageByProvider = {}, override = null, disabled = [], unhealthy = [], health = null, env = process.env } = {}) {
  const decision = decideProvider({ usageByProvider, override, disabled, unhealthy, env });
  const ctxList = buildContext({ usageByProvider, disabled, unhealthy, env });
  const list = ctxList.map((c) => ({
    id: c.id,
    label: c.label,
    order: c.order,
    isPrimary: c.isPrimary,
    configured: c.configured,
    enabled: c.available && !c.disabled,
    available: c.available,
    disabled: c.disabled,
    healthy: !c.unhealthy,
    health: health && health[c.id] ? health[c.id] : null,
    active: c.id === decision.provider,
    gateEnv: c.gateEnv,
    gateMissing: c.gateMissing,
    minutesUsed: c.used,
    limit: Number.isFinite(c.displayLimit) ? c.displayLimit : null,
    unlimited: c.unlimited,
    percent: c.percent,
    status: statusOf(c, decision.provider),
  }));
  return {
    active: decision.provider,
    activeReason: decision.reason,
    overridden: decision.overridden,
    override: override || null,
    // Override ignorado porque o provedor forçado está falhando/indisponível.
    overrideIgnored: !!(override && decision.provider !== override),
    primary: providers.PRIMARY_PROVIDER,
    reserveMode: providers.isReserve(decision.provider),
    providers: list,
  };
}

module.exports = { buildContext, decideProvider, buildPanel, statusOf, usableForRoom, resolveRoomProvider };
