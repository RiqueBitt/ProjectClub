import { useCallback, useEffect, useState } from 'react';
import { getVoiceServer, setVoiceServerConfig } from '../../api/endpoints';

// Painel da equipe — "Servidor de voz". A voz usa SÓ o servidor de mídia
// próprio (media-server/, mediasoup + coturn). Aqui a staff vê se ele está
// configurado e edita as chaves dele (URL/segredo do servidor de mídia e o
// TURN) — salvas criptografadas no servidor e aplicadas na hora, sem mexer
// na hospedagem. Segredos aparecem só mascarados; campo vazio = não muda;
// "Limpar" volta pro valor da hospedagem.
export default function VoiceServerAdmin() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [vals, setVals] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await getVoiceServer()); setErr('');
    } catch (e) {
      setErr(e?.response?.data?.error || 'Não foi possível carregar o servidor de voz.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (values) => {
    setSaving(true); setMsg('');
    try {
      setData(await setVoiceServerConfig(values));
      setVals({}); setMsg('Salvo e aplicado.');
    } catch (e) {
      setMsg(e?.response?.data?.error || 'Não foi possível salvar as chaves.');
    } finally { setSaving(false); }
  };

  const fields = data?.fields || [];
  const changed = Object.keys(vals).length > 0;

  return (
    <div data-testid="voice-server-admin" style={{ display: 'grid', gap: 14, maxWidth: 720 }}>
      <p className="dim" style={{ margin: 0 }}>
        As chamadas de voz, vídeo e tela passam pelo servidor de mídia do próprio Project Club.
      </p>
      {err && <div style={{ color: '#ed4245' }}>{err}</div>}
      {data && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <strong>{data.label || 'Servidor próprio'}</strong>
          <span
            data-testid="voice-server-status"
            style={{
              color: data.configured ? '#3ba55d' : '#ed4245',
              background: data.configured ? 'rgba(59,165,93,.15)' : 'rgba(237,66,69,.15)',
              borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600,
            }}
          >
            {data.configured ? 'configurado' : 'não configurado (sem voz)'}
          </span>
        </div>
      )}
      {fields.length > 0 && (
        <form
          style={{ display: 'grid', gap: 8 }}
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
