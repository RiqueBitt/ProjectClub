import { useCallback, useEffect, useRef, useState } from 'react';
import UserAvatar from '../UserAvatar.jsx';
import { Ico } from '../PagesKit.jsx';
import { adminSearchSupporters, adminSupporterHistory, adminSetSupporterTier } from '../../api/supporters';
import '../../styles/shop.css';

// Painel → Gerenciamento de Apoio. Concede/remove Assinante e Super
// Assinante com motivo obrigatório; o histórico mostra quem fez, quando e
// por quê. Quem fez vem da sessão no servidor (nada aqui é confiado).
const TIERS = [
  { id: 'NONE', label: 'Membro' },
  { id: 'SUBSCRIBER', label: 'Assinante' },
  { id: 'SUPER', label: 'Super Assinante' },
];
const LABEL = Object.fromEntries(TIERS.map((t) => [t.id, t.label]));
const RANK = { NONE: 0, SUBSCRIBER: 1, SUPER: 2 };
const errMsg = (e) => e?.response?.data?.error || 'Não deu certo, tente de novo.';
const when = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function TierChip({ tier }) {
  return <span className={`sup-chip t-${tier.toLowerCase()}`}>{tier !== 'NONE' && <Ico name="crown" size={12} strokeWidth={2.2} />}{LABEL[tier] || tier}</span>;
}

export default function SupportersAdmin() {
  const [q, setQ] = useState('');
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);

  const search = useCallback((term) => {
    adminSearchSupporters(term).then(setResult).catch((e) => setError(errMsg(e)));
  }, []);
  const loadHistory = useCallback((userId) => {
    adminSupporterHistory(userId ? { userId } : {}).then(setHistory).catch(() => setHistory({ entries: [] }));
  }, []);
  useEffect(() => { search(''); loadHistory(null); }, [search, loadHistory]);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => search(q.trim()), 300);
    return () => clearTimeout(timer.current);
  }, [q, search]);

  const pick = (u) => { setSelected(u); loadHistory(u?.id || null); };
  const onChanged = (userId, tier) => {
    setResult((r) => (r ? { ...r, users: r.users.map((u) => (u.id === userId ? { ...u, supporterTier: tier } : u)) } : r));
    setSelected((s) => (s && s.id === userId ? { ...s, supporterTier: tier } : s));
    search(q.trim());
    loadHistory(userId);
  };

  return (
    <div className="sup-admin">
      <div className="sup-totals">
        <div><small>Super Assinantes</small><strong>{result?.totals?.SUPER ?? '—'}</strong></div>
        <div><small>Assinantes</small><strong>{result?.totals?.SUBSCRIBER ?? '—'}</strong></div>
        <p className="shop-muted">Assinante: 15% de desconto em itens elegíveis da Loja e itens exclusivos. Super Assinante herda tudo do Assinante e tem destaque superior. Nenhuma categoria dá permissão de staff.</p>
      </div>
      {error && <div className="shop-notice bad">{error}</div>}
      <div className="sup-grid">
        <section className="sup-panel">
          <label className="shop-search">
            <Ico name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, @ ou ID" aria-label="Buscar usuário" />
          </label>
          <small className="shop-muted">{q.trim() ? 'Resultados da busca' : 'Apoiadores atuais'}</small>
          <ul className="sup-list">
            {(result?.users || []).map((u) => (
              <li key={u.id}>
                <button type="button" className={selected?.id === u.id ? 'on' : ''} onClick={() => pick(u)}>
                  <UserAvatar user={u} size={32} />
                  <span className="sup-name"><strong className="truncate">{u.displayName}</strong><small className="truncate">@{u.username}</small></span>
                  <TierChip tier={u.supporterTier} />
                </button>
              </li>
            ))}
            {result && result.users.length === 0 && <li className="shop-muted sup-none">{q.trim() ? 'Ninguém encontrado.' : 'Ainda não há apoiadores.'}</li>}
          </ul>
        </section>
        <section className="sup-panel">
          {selected ? <TierEditor key={selected.id} user={selected} onChanged={onChanged} onClose={() => pick(null)} /> : (
            <div className="shop-empty"><strong>Escolha alguém</strong><span>Busque e selecione um usuário para ver ou mudar a categoria de apoio.</span></div>
          )}
          <h3 className="sup-h">{selected ? `Histórico de ${selected.displayName}` : 'Últimas alterações'}</h3>
          <ul className="sup-history">
            {(history?.entries || []).map((h) => (
              <li key={h.id}>
                <div className="sup-history-line">
                  {!selected && <strong>{h.user?.displayName || 'Usuário removido'}</strong>}
                  <TierChip tier={h.fromTier} /> <Ico name="arrowRight" size={13} /> <TierChip tier={h.toTier} />
                </div>
                {h.reason && <p>"{h.reason}"</p>}
                <small className="shop-muted">por {h.actor?.displayName || 'staff'} · {when(h.createdAt)}</small>
              </li>
            ))}
            {history && history.entries.length === 0 && <li className="shop-muted sup-none">Sem alterações registradas.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

function TierEditor({ user, onChanged, onClose }) {
  const current = user.supporterTier || 'NONE';
  const [tier, setTier] = useState(current);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const lowering = RANK[tier] < RANK[current];
  const apply = async () => {
    if (tier === current) return;
    if (reason.trim().length < 3) { setMsg({ bad: true, text: 'Escreva o motivo (fica no histórico).' }); return; }
    if (lowering && !confirming) { setMsg(null); setConfirming(true); return; }
    setBusy(true); setMsg(null);
    try {
      await adminSetSupporterTier(user.id, tier, reason.trim());
      setMsg({ text: `${user.displayName} agora é ${LABEL[tier]}.` });
      setReason(''); setConfirming(false);
      onChanged(user.id, tier);
    } catch (e) { setMsg({ bad: true, text: errMsg(e) }); }
    setBusy(false);
  };
  return (
    <div className="sup-editor">
      <div className="sup-editor-head">
        <UserAvatar user={user} size={44} />
        <div className="sup-editor-who"><strong>{user.displayName}</strong><small className="shop-muted">@{user.username} · ID {user.publicId || user.id}</small></div>
        <button type="button" className="shop-btn ghost" onClick={onClose} aria-label="Fechar"><Ico name="close" size={14} /></button>
      </div>
      <div className="sup-editor-now">Categoria atual: <TierChip tier={current} /></div>
      <div className="sup-tier-pick" role="radiogroup" aria-label="Nova categoria">
        {TIERS.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={tier === t.id} className={tier === t.id ? 'on' : ''} onClick={() => { setTier(t.id); setConfirming(false); }}>{t.label}</button>
        ))}
      </div>
      <label className="sup-reason">Motivo
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder={lowering ? 'Ex.: assinatura encerrada' : 'Ex.: apoio confirmado em outubro'} />
      </label>
      {confirming && (
        <div className="shop-notice bad" role="alert">
          {tier === 'NONE' ? 'Remover todo o apoio' : `Rebaixar para ${LABEL[tier]}`} de {user.displayName}? A pessoa perde o desconto e os exclusivos{tier === 'SUBSCRIBER' ? ' de Super Assinante' : ''} (itens comprados continuam). Clique de novo para confirmar.
        </div>
      )}
      {msg && <div className={`shop-notice${msg.bad ? ' bad' : ''}`} role="status">{msg.text}</div>}
      <div className="deco-actions">
        <button type="button" className={`shop-btn ${lowering ? 'danger' : 'primary'}`} disabled={busy || tier === current} onClick={apply}>
          {busy ? 'Salvando…' : confirming ? 'Confirmar remoção' : tier === current ? 'Sem mudanças' : lowering ? 'Remover/rebaixar' : 'Conceder'}
        </button>
      </div>
    </div>
  );
}
