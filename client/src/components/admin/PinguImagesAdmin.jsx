import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listPinguImages, deletePinguImage } from '../../api/endpoints';

// Painel da Equipe → Pingu → Imagens (Pingu Turbo): estado do provedor e
// histórico de TODOS os pedidos "@pingu desenhe …" (inclusive os recusados
// pelo filtro). "Apagar" tira a mensagem do canal e o arquivo do armazenamento.
const STATUS = {
  PENDING: 'Criando', DONE: 'Pronta', FAILED: 'Falhou', BLOCKED: 'Recusada', CANCELLED: 'Cancelada', DELETED: 'Apagada',
};
const PROVIDER = { pollinations: 'Pollinations (grátis, sem chave)', local: 'Servidor próprio (stable-diffusion)', off: 'Desligado no servidor' };
const errText = (e, f) => e?.response?.data?.error || f;
const when = (d) => (d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

export default function PinguImagesAdmin() {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState({ text: '', ok: true });
  const navigate = useNavigate();
  const flash = (text, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg({ text: '', ok: true }), 3500); };

  const load = () => listPinguImages(filter || undefined)
    .then((r) => { setRows(r.images || []); setStatus(r.status || null); })
    .catch((e) => flash(errText(e, 'Não deu pra carregar as imagens.'), false));
  useEffect(() => { load(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (row) => {
    if (!window.confirm('Apagar esta imagem? A mensagem do Pingu some do canal.')) return;
    setBusy(row.id);
    try { await deletePinguImage(row.id); flash('Imagem apagada.'); await load(); } catch (e) { flash(errText(e, 'Não deu pra apagar.'), false); } finally { setBusy(''); }
  };

  return (
    <section className="settings-block pga-form pgi">
      <h3>Imagens do Pingu</h3>
      {status && (
        <div className="pgi-status">
          <span className={`pga-status ${status.providerConfigured && status.enabled ? 'on' : ''}`}>
            {status.providerConfigured ? (status.enabled ? 'Ligado' : 'Desligado no painel') : 'Desligado'}
          </span>
          <span className="dim">
            Provedor: <b>{PROVIDER[status.provider] || status.provider}</b>
            {' · '}{status.running} criando, {status.pending} na fila (até {status.concurrency} por vez)
            {' · '}{status.ok} prontas / {status.failed} falhas desde que o servidor ligou
            {status.lastMs ? ` · última em ${(status.lastMs / 1000).toFixed(1)} s` : ''}
          </span>
          {status.lastError && <span className="pgi-err">Último erro: {status.lastError}</span>}
        </div>
      )}
      <div className="pgf-row">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar imagens">
          <option value="">Todos os pedidos</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button type="button" className="btn-secondary" onClick={load}>Atualizar</button>
        <span className="dim">{rows ? `${rows.length} pedido(s)` : 'Carregando…'}</span>
        {msg.text && <span className={`pga-msg ${msg.ok ? '' : 'err'}`} role="status">{msg.text}</span>}
      </div>
      {rows && rows.length === 0 && <p className="dim">Ninguém pediu imagem ainda.</p>}
      <ul className="pgi-list">
        {(rows || []).map((r) => (
          <li key={r.id} className={`pgi-item s-${r.status.toLowerCase()}`}>
            {r.url && r.status === 'DONE'
              ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="pgi-thumb"><img src={r.url} alt="" loading="lazy" /></a>
              : <span className="pgi-thumb pgi-thumb-empty" aria-hidden="true">{r.status === 'BLOCKED' ? '🚫' : '🎨'}</span>}
            <div className="pgi-info">
              <strong className="pgi-prompt">{r.prompt}</strong>
              <span className="dim">
                {r.user?.displayName || r.user?.username || 'Conta removida'}
                {r.channel ? ` · #${r.channel.name}` : ''} · {when(r.createdAt)} · {STATUS[r.status] || r.status} · {r.provider}
                {r.width ? ` · ${r.width}×${r.height}` : ''}
              </span>
              {r.error && <span className="pgi-err">{r.error}</span>}
            </div>
            <div className="pgf-q-actions">
              {r.link && r.status === 'DONE' && <button type="button" className="btn-secondary" onClick={() => navigate(r.link)}>Ver no canal</button>}
              {(r.status === 'DONE' || r.status === 'FAILED') && (
                <button type="button" className="btn-secondary danger" disabled={busy === r.id} onClick={() => remove(r)}>{busy === r.id ? 'Apagando…' : 'Apagar'}</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
