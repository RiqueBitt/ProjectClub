import { useCallback, useEffect, useRef, useState } from 'react';
import { getVoiceProviders, setVoiceOverride, toggleVoiceProvider, setVoiceUsage, setVoiceProviderConfig, resetVoiceHealth } from '../../api/endpoints';
import { CLIENT_READY } from '../../voice/providerDecision';

// Painel da equipe — "Chamadas / Provedores de voz" (item pedido).
// Mostra um cartão por provedor da cadeia (servidor próprio → LiveKit → ... → Jitsi):
// status, barra de uso "X / Y min (Z%)", qual está ativo, e os controles de
// forçar um provedor (override), voltar ao automático e ligar/desligar um
// provedor na cadeia. Atualiza sozinho a cada 10s lendo /api/voice/provider.

const STATUS = {
  ativo: { label: 'ativo', color: '#3ba55d', bg: 'rgba(59,165,93,.15)' },
  em_espera: { label: 'em espera', color: '#8aa0b4', bg: 'rgba(138,160,180,.15)' },
  esgotado: { label: 'esgotado', color: '#e0a106', bg: 'rgba(224,161,6,.15)' },
  // Disjuntor de saúde (server/src/services/voiceHealth.js): falhas de 2+
  // pessoas em poucos minutos — a cadeia pula até o provedor voltar.
  instavel: { label: 'Instável', color: '#f04747', bg: 'rgba(240,71,71,.15)' },
  falta_chave: { label: 'configurado (falta chave)', color: '#d97706', bg: 'rgba(217,119,6,.15)' },
  nao_configurado: { label: 'não configurado', color: '#72767d', bg: 'rgba(114,118,125,.12)' },
  desativado: { label: 'desativado', color: '#ed4245', bg: 'rgba(237,66,69,.15)' },
};

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.em_espera;
  return <span style={{ color: s.color, background: s.bg, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{s.label}</span>;
}

function UsageBar({ percent, unlimited }) {
  const pct = Math.max(0, Math.min(100, percent || 0));
  const color = unlimited ? '#5865f2' : pct >= 95 ? '#ed4245' : pct >= 75 ? '#e0a106' : '#3ba55d';
  return (
    <div style={{ height: 8, borderRadius: 999, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
      <div style={{ width: unlimited ? '100%' : `${pct}%`, height: '100%', background: color, opacity: unlimited ? 0.35 : 1, transition: 'width .4s' }} />
    </div>
  );
}

// Chaves do provedor, editáveis aqui mesmo (salvas criptografadas no
// servidor e aplicadas na hora — sem mexer na hospedagem). Segredos
// aparecem só mascarados; campo vazio = não muda. "Limpar" volta pro valor
// da hospedagem.
function KeysEditor({ provider, onSaved }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const fields = provider.fields || [];
  if (!fields.length) return null;
  const changed = Object.keys(vals).length > 0;
  const save = async (values) => {
    setSaving(true); setMsg('');
    try {
      const panel = await setVoiceProviderConfig(provider.id, values);
      setVals({}); setMsg('Salvo e aplicado.'); onSaved(panel);
    } catch (e) {
      setMsg(e?.response?.data?.error || 'Não foi possível salvar as chaves.');
    } finally { setSaving(false); }
  };
  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Fechar chaves' : 'Configurar chaves'}
      </button>
      {open && (
        <form
          style={{ display: 'grid', gap: 8, marginTop: 10 }}
          onSubmit={(e) => { e.preventDefault(); if (changed) save(vals); }}
          autoComplete="off"
        >
          {fields.map((f) => (
            <label key={f.env} style={{ display: 'grid', gap: 4, fontSize: 12, color: '#b9c4d0' }}>
              <span>
                {f.label}
                {f.set && <span style={{ color: '#3ba55d' }}> · definido{f.source === 'painel' ? ' pelo painel' : f.source === 'hospedagem' ? ' na hospedagem' : ''}</span>}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type={f.secret ? 'password' : 'text'}
                  autoComplete="off" spellCheck={false}
                  placeholder={f.set ? (f.value || 'definido') : 'não definido'}
                  value={vals[f.env] ?? ''}
                  onChange={(e) => setVals((s) => ({ ...s, [f.env]: e.target.value }))}
                  style={{ flex: 1, minWidth: 0, padding: '6px 8px', borderRadius: 6, border: '1px solid #3a4453', background: '#1a1f26', color: '#e6edf3', fontSize: 13 }}
                />
                {f.source === 'painel' && (
                  <button type="button" className="btn" disabled={saving} onClick={() => save({ [f.env]: '' })} title="Volta pro valor da hospedagem">Limpar</button>
                )}
              </div>
            </label>
          ))}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="submit" className="btn" disabled={!changed || saving}>{saving ? 'Salvando…' : 'Salvar chaves'}</button>
            {msg && <span style={{ fontSize: 12, color: msg.startsWith('Salvo') ? '#3ba55d' : '#ed4245' }}>{msg}</span>}
          </div>
        </form>
      )}
    </div>
  );
}

export default function VoiceProvidersAdmin() {
  const [panel, setPanel] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [usageInputs, setUsageInputs] = useState({});
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await getVoiceProviders();
      setPanel(data); setErr('');
    } catch (e) {
      setErr(e?.response?.data?.error || 'Não foi possível carregar os provedores de voz.');
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 10000);
    return () => clearInterval(timer.current);
  }, [load]);

  const doOverride = async (provider) => {
    setBusy(`ov:${provider || 'auto'}`);
    try { setPanel(await setVoiceOverride(provider)); } catch (e) { setErr(e?.response?.data?.error || 'Falha ao aplicar o override.'); } finally { setBusy(''); }
  };
  const doToggle = async (id, disabled) => {
    setBusy(`tg:${id}`);
    try { setPanel(await toggleVoiceProvider(id, disabled)); } catch (e) { setErr(e?.response?.data?.error || 'Falha ao ligar/desligar o provedor.'); } finally { setBusy(''); }
  };
  const doHealthReset = async (id) => {
    setBusy(`hr:${id}`);
    try { setPanel(await resetVoiceHealth(id)); } catch (e) { setErr(e?.response?.data?.error || 'Falha ao zerar a saúde do provedor.'); } finally { setBusy(''); }
  };
  const doSetUsage = async (id) => {
    const val = usageInputs[id];
    if (val === '' || val == null || Number(val) < 0) return;
    setBusy(`us:${id}`);
    try {
      setPanel(await setVoiceUsage(id, Number(val)));
      setUsageInputs((s) => ({ ...s, [id]: '' }));
    } catch (e) { setErr(e?.response?.data?.error || 'Falha ao definir o uso.'); } finally { setBusy(''); }
  };

  if (!panel) return <div className="voice-prov-admin"><p style={{ color: '#8aa0b4' }}>{err || 'Carregando provedores de voz…'}</p></div>;

  return (
    <div className="voice-prov-admin" data-testid="voice-providers-admin">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, color: '#8aa0b4' }}>Provedor ativo agora</div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>
            {panel.providers.find((p) => p.id === panel.active)?.label || panel.active}
            {panel.reserveMode && <span style={{ marginLeft: 8, fontSize: 13, color: '#e0a106' }}>• modo reserva</span>}
            {panel.overridden && <span style={{ marginLeft: 8, fontSize: 13, color: '#5865f2' }}>• forçado</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={() => doOverride(null)} disabled={!panel.override || busy === 'ov:auto'}>
            Voltar ao automático
          </button>
          <button type="button" className="btn" onClick={load}>Atualizar</button>
        </div>
      </div>
      {err && <p style={{ color: '#ed4245', fontSize: 13 }}>{err}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {panel.providers.map((p) => (
          <div
            key={p.id}
            data-testid={`voice-provider-${p.id}`}
            style={{
              border: `1px solid ${p.active ? 'rgba(59,165,93,.6)' : 'rgba(255,255,255,.08)'}`,
              borderRadius: 14, padding: 14, background: 'rgba(255,255,255,.03)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
              <strong style={{ fontSize: 15 }}>{p.label}{p.isPrimary && <span style={{ color: '#8aa0b4', fontWeight: 400, fontSize: 12 }}> (principal)</span>}</strong>
              <StatusBadge status={p.status} />
            </div>
            <div style={{ fontSize: 13, color: '#b9c4d0', marginBottom: 6 }}>
              {p.unlimited ? 'Uso ilimitado (gratuito)' : `${(p.minutesUsed || 0).toLocaleString('pt-BR')} / ${(p.limit || 0).toLocaleString('pt-BR')} min (${p.percent || 0}%)`}
            </div>
            <UsageBar percent={p.percent} unlimited={p.unlimited} />
            {!p.unlimited && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: '#8aa0b4' }}>Uso real deste mês:</span>
                <input
                  type="number" min="0" inputMode="numeric"
                  placeholder={`${p.minutesUsed || 0}`}
                  value={usageInputs[p.id] ?? ''}
                  onChange={(e) => setUsageInputs((s) => ({ ...s, [p.id]: e.target.value }))}
                  style={{ width: 90, padding: '4px 6px', borderRadius: 6, border: '1px solid #3a4453', background: '#1a1f26', color: '#e6edf3', fontSize: 13 }}
                />
                <span style={{ fontSize: 12, color: '#8aa0b4' }}>min</span>
                <button
                  type="button" className="btn"
                  onClick={() => doSetUsage(p.id)}
                  disabled={busy === `us:${p.id}` || (usageInputs[p.id] ?? '') === ''}
                  title="Informar quantos minutos este provedor já gastou no mês (ex.: o que aparece no painel do LiveKit). A cadeia passa a usar esse número pra trocar no limite."
                >
                  Definir
                </button>
              </div>
            )}
            {CLIENT_READY[p.id] === false && (
              <div style={{ fontSize: 12, color: '#8aa0b4', marginTop: 8 }}>O site ainda não tem o player deste provedor — a cadeia pula ele nas chamadas.</div>
            )}
            {!p.configured && (p.fields || []).length > 0 && (
              <div style={{ fontSize: 12, color: '#d97706', marginTop: 8 }}>Faltam as chaves — clique em “Configurar chaves”.</div>
            )}
            {p.gateMissing && p.gateEnv && (
              <div style={{ fontSize: 12, color: '#d97706', marginTop: 8 }}>Falta definir <code>{p.gateEnv}</code> no servidor.</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button" className="btn"
                onClick={() => doOverride(p.id)}
                disabled={!p.enabled || p.active || busy === `ov:${p.id}`}
                title={!p.enabled ? (p.disabled ? 'Desativado da cadeia — reative primeiro' : 'Configure as chaves primeiro') : 'Forçar este provedor como ativo'}
              >
                Forçar ativo
              </button>
              {p.status === 'instavel' && (
                <button
                  type="button" className="btn"
                  onClick={() => doHealthReset(p.id)}
                  disabled={busy === `hr:${p.id}`}
                  title="Zera o disjuntor de saúde: a cadeia volta a usar este provedor já"
                >
                  Tentar de novo agora
                </button>
              )}
              {p.id !== 'jitsi' && (
                <button
                  type="button" className="btn"
                  onClick={() => doToggle(p.id, !p.disabled)}
                  disabled={busy === `tg:${p.id}`}
                >
                  {p.disabled ? 'Reativar na cadeia' : 'Desativar da cadeia'}
                </button>
              )}
            </div>
            <KeysEditor provider={p} onSaved={setPanel} />
          </div>
        ))}
      </div>
      <p style={{ fontSize: 12, color: '#72767d', marginTop: 14 }}>
        A cadeia usa cada provedor até o limite mensal gratuito e passa pro próximo automaticamente, sem derrubar ninguém.
        Forçar um provedor ignora o limite dele. O Jitsi é o último recurso e não pode ser desativado.
      </p>
    </div>
  );
}
