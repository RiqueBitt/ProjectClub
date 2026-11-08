import { useCallback, useEffect, useState } from 'react';
import {
  adminCreatorQueue, adminApproveCreatorItem, adminRejectCreatorItem, adminRemoveCreatorItem, adminResolveCreatorReport,
} from '../../api/fase8';
import '../../styles/fase8.css';

// Painel da equipe → Loja dos criadores (Fase 8): fila de aprovação,
// itens à venda (remover) e denúncias. Regras em services/creatorShop.js.

const KIND_LABEL = { EMOJI: 'Emoji', STICKER: 'Figurinha', FRAME: 'Moldura' };
const VIEWS = [
  { id: 'PENDING', label: 'Fila de aprovação' },
  { id: 'APPROVED', label: 'À venda' },
  { id: 'REJECTED', label: 'Recusados' },
  { id: 'REMOVED', label: 'Removidos' },
  { id: 'REPORTS', label: 'Denúncias' },
];

function ItemThumb({ item }) {
  return <a href={item.imageUrl} target="_blank" rel="noreferrer noopener" title="Abrir imagem em tamanho real"><img src={item.imageUrl} alt={item.name} loading="lazy" /></a>;
}

export default function CreatorShopAdmin() {
  const [view, setView] = useState('PENDING');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    adminCreatorQueue(view === 'REPORTS' ? 'PENDING' : view)
      .then(setData)
      .catch((err) => { setData({ items: [], reports: [], counts: {} }); setMsg(err?.response?.data?.error || 'Não foi possível carregar.'); });
  }, [view]);
  useEffect(() => { setData(null); load(); }, [load]);

  const act = async (id, fn, okMsg) => {
    setBusy(id);
    try { await fn(); setMsg(okMsg); load(); } catch (err) { setMsg(err?.response?.data?.error || 'Não deu certo.'); } finally { setBusy(null); }
  };
  const approve = (item) => act(item.id, () => adminApproveCreatorItem(item.id), `"${item.name}" aprovado e à venda.`);
  const reject = (item) => {
    const reason = window.prompt(`Motivo da recusa de "${item.name}" (o criador vai ver):`);
    if (!reason) return;
    act(item.id, () => adminRejectCreatorItem(item.id, reason), `"${item.name}" recusado.`);
  };
  const remove = (item) => {
    const reason = window.prompt(`Motivo da remoção de "${item.name}" (sai da loja e de quem comprou):`);
    if (!reason) return;
    act(item.id, () => adminRemoveCreatorItem(item.id, reason), `"${item.name}" removido.`);
  };

  const counts = data?.counts || {};
  const list = view === 'REPORTS' ? [] : data?.items || [];
  return (
    <div className="creator-admin">
      <div className="cs-toolbar">
        {VIEWS.map((v) => {
          const n = v.id === 'REPORTS' ? data?.reports?.length : counts[v.id];
          return (
            <button key={v.id} type="button" className={`pet-btn${view === v.id ? ' primary' : ''}`} onClick={() => setView(v.id)}>
              {v.label}{n ? ` (${n})` : ''}
            </button>
          );
        })}
      </div>
      {msg && <p className="cs-hint" role="status">{msg}</p>}
      {!data ? <p className="cs-hint">Carregando…</p> : view === 'REPORTS' ? (
        data.reports.length === 0 ? <p className="cs-hint">Nenhuma denúncia aberta. 🎉</p> : (
          <div className="cs-list">
            {data.reports.map((r) => (
              <div key={r.id} className="cs-row">
                {r.item && <ItemThumb item={r.item} />}
                <div className="cs-row-main">
                  <span><b>{r.item?.name || 'Item apagado'}</b>{r.item ? ` · ${KIND_LABEL[r.item.kind]} · por ${r.item.creator?.displayName || '?'}` : ''}</span>
                  <small>Motivo: {r.reason}</small>
                  <small>{new Date(r.createdAt).toLocaleString('pt-BR')}</small>
                </div>
                <div className="cs-row-actions">
                  {r.item && r.item.status === 'APPROVED' && <button type="button" className="pet-btn danger" disabled={busy === r.item.id} onClick={() => remove(r.item)}>Remover item</button>}
                  <button type="button" className="pet-btn" disabled={busy === r.id} onClick={() => act(r.id, () => adminResolveCreatorReport(r.id), 'Denúncia arquivada.')}>Arquivar</button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : list.length === 0 ? <p className="cs-hint">Nada por aqui.</p> : (
        <div className="cs-list">
          {list.map((item) => (
            <div key={item.id} className="cs-row">
              <ItemThumb item={item} />
              <div className="cs-row-main">
                <span><b>{item.kind === 'EMOJI' ? `:${item.name}:` : item.name}</b> · {KIND_LABEL[item.kind]} · {item.priceCoins} moedas</span>
                <small>por {item.creator?.displayName || '?'} (@{item.creator?.username || '?'}) · enviado em {new Date(item.createdAt).toLocaleDateString('pt-BR')}</small>
                {item.description && <small>{item.description}</small>}
                {item.status === 'APPROVED' && <small>{item.sales} vendas · {item.earnings} moedas pro criador</small>}
                {item.rejectReason && <small>Motivo: {item.rejectReason}</small>}
              </div>
              <div className="cs-row-actions">
                {item.status === 'PENDING' && (
                  <>
                    <button type="button" className="pet-btn primary" disabled={busy === item.id} onClick={() => approve(item)}>Aprovar</button>
                    <button type="button" className="pet-btn danger" disabled={busy === item.id} onClick={() => reject(item)}>Recusar</button>
                  </>
                )}
                {item.status === 'APPROVED' && <button type="button" className="pet-btn danger" disabled={busy === item.id} onClick={() => remove(item)}>Remover</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
