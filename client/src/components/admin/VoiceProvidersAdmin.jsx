import { useCallback, useEffect, useRef, useState } from 'react';
import { getVoiceProviders, setVoiceOverride, toggleVoiceProvider } from '../../api/endpoints';

// Painel da equipe — "Chamadas / Provedores de voz" (item pedido).
// Mostra um cartão por provedor da cadeia (Agora → LiveKit → ... → Jitsi):
// status, barra de uso "X / Y min (Z%)", qual está ativo, e os controles de
// forçar um provedor (override), voltar ao automático e ligar/desligar um
// provedor na cadeia. Atualiza sozinho a cada 10s lendo /api/voice/provider.

const STATUS = {
  ativo: { label: 'ativo', color: '#3ba55d', bg: 'rgba(59,165,93,.15)' },
  em_espera: { label: 'em espera', color: '#8aa0b4', bg: 'rgba(138,160,180,.15)' },
  esgotado: { label: 'esgotado', color: '#e0a106', bg: 'rgba(224,161,6,.15)' },
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

export default function VoiceProvidersAdmin() {
  const [panel, setPanel] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
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
            {p.gateMissing && p.gateEnv && (
              <div style={{ fontSize: 12, color: '#d97706', marginTop: 8 }}>Falta definir <code>{p.gateEnv}</code> no servidor.</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button" className="btn"
                onClick={() => doOverride(p.id)}
                disabled={!p.enabled || p.active || busy === `ov:${p.id}`}
                title={!p.enabled ? 'Provedor indisponível' : 'Forçar este provedor como ativo'}
              >
                Forçar ativo
              </button>
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
