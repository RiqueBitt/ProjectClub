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
// Recebe TUDO por parâmetro (usage, override, disabled, env) pra não
// depender de Redis nem de process.env nos testes.
const providers = require('./voiceProviders');
const usage = require('./voiceUsage');

// Monta o "contexto" de cada provedor uma vez só (disponibilidade,
// limite, usado, %, desativado) — reaproveitado pela decisão e pelo painel.
function buildContext({ usageByProvider = {}, disabled = [], env = process.env } = {}) {
  const disabledSet = new Set(disabled);
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
  if (ctx.over) return 'esgotado';
  return 'em_espera';
}

// Decide o provedor ativo. Devolve { provider, reason, overridden }.
function decideProvider({ usageByProvider = {}, override = null, disabled = [], env = process.env } = {}) {
  const ctxList = buildContext({ usageByProvider, disabled, env });
  const byId = Object.fromEntries(ctxList.map((c) => [c.id, c]));

  // 1) Override manual da equipe: vence se estiver disponível e não desativado.
  if (override && byId[override]) {
    const o = byId[override];
    if (o.available && !o.disabled) {
      return { provider: override, reason: 'override', overridden: true };
    }
    // Override apontando pra algo indisponível/desativado: ignora e segue
    // o automático (nunca deixa a voz presa num provedor que não dá).
  }

  // 2) Automático: primeiro disponível, abaixo do limite e não desativado.
  for (const c of ctxList) {
    if (c.available && !c.disabled && !c.over) {
      return { provider: c.id, reason: c.isPrimary ? 'primary' : 'chain', overridden: false };
    }
  }

  // 3) Nada se qualificou → Jitsi (sempre disponível, ilimitado).
  return { provider: 'jitsi', reason: 'fallback', overridden: false };
}

// Dados completos pro painel da staff (sem segredo nenhum).
function buildPanel({ usageByProvider = {}, override = null, disabled = [], env = process.env } = {}) {
  const decision = decideProvider({ usageByProvider, override, disabled, env });
  const ctxList = buildContext({ usageByProvider, disabled, env });
  const list = ctxList.map((c) => ({
    id: c.id,
    label: c.label,
    order: c.order,
    isPrimary: c.isPrimary,
    configured: c.configured,
    enabled: c.available && !c.disabled,
    available: c.available,
    disabled: c.disabled,
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
    primary: providers.PRIMARY_PROVIDER,
    reserveMode: providers.isReserve(decision.provider),
    providers: list,
  };
}

module.exports = { buildContext, decideProvider, buildPanel, statusOf };
