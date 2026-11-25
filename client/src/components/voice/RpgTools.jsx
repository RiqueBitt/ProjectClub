import { useEffect, useState } from 'react';
import { getBlackoutSheets, openBlackoutSession } from '../../api/endpoints';
import UserAvatar from '../UserAvatar.jsx';

// Ferramentas da mesa de RPG (nov/2026):
// - Compêndio: o site do BLACKOUT inteiro (poderes, trilhas, níveis, fichas)
//   num painel por cima da mesa, pra todo mundo consultar sem sair da call.
// - Fichas (só o mestre): a ficha atual de cada jogador sentado, guardada
//   na conta dele.

const SKIP = new Set(['id', '_id', 'mesaP', 'nome']);
function FichaResumo({ f }) {
  if (!f) return <p className="rpg-tools-empty">Ainda não escolheu uma ficha no compêndio.</p>;
  const campos = Object.entries(f)
    .filter(([k, v]) => !SKIP.has(k) && (typeof v === 'string' || typeof v === 'number') && String(v).trim() && String(v).length < 80)
    .slice(0, 12);
  return (
    <div className="rpg-ficha">
      <div className="rpg-ficha-top"><strong>{f.nome || 'Sem nome'}</strong>{f.mesaP?.lv ? <span className="rpg-ficha-lv">Nível {f.mesaP.lv}</span> : null}</div>
      {campos.length > 0 && (
        <dl className="rpg-ficha-campos">
          {campos.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>))}
        </dl>
      )}
    </div>
  );
}

function FichasDoMestre({ channelId, players, personOf }) {
  const [data, setData] = useState({});
  useEffect(() => {
    let alive = true;
    players.filter(Boolean).forEach((uid) => {
      getBlackoutSheets(uid, channelId)
        .then((d) => { if (alive) setData((m) => ({ ...m, [uid]: d })); })
        .catch(() => { if (alive) setData((m) => ({ ...m, [uid]: { error: true } })); });
    });
    return () => { alive = false; };
  }, [channelId, players]);
  const seated = players.filter(Boolean);
  if (!seated.length) return <p className="rpg-tools-empty">Nenhum jogador sentado ainda.</p>;
  return (
    <div className="rpg-fichas">
      {seated.map((uid) => {
        const d = data[uid];
        const atual = d?.fichas?.find((f) => f.id === d.atual) || d?.fichas?.[0] || null;
        const u = personOf(uid) || { id: uid };
        return (
          <section key={uid} className="rpg-fichas-item">
            <header><UserAvatar user={u} size={24} /> <strong>{u.displayName || 'Jogador'}</strong>{d?.fichas?.length > 1 && <small>{d.fichas.length} fichas</small>}</header>
            {!d ? <p className="rpg-tools-empty">Carregando…</p> : d.error ? <p className="rpg-tools-empty">Não deu pra ver a ficha.</p> : <FichaResumo f={atual} />}
          </section>
        );
      })}
    </div>
  );
}

export default function RpgTools({ channelId, iAmMaster, players, personOf }) {
  const [open, setOpen] = useState(null); // 'compendio' | 'fichas' | null
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (open !== 'compendio' || src) return;
    openBlackoutSession().then((d) => setSrc(d?.url || '/blackout/')).catch(() => setErr('Não deu pra abrir o compêndio.'));
  }, [open, src]);
  return (
    <>
      <div className="rpg-tools" role="toolbar" aria-label="Ferramentas da mesa">
        <button type="button" className={open === 'compendio' ? 'on' : ''} onClick={() => setOpen(open === 'compendio' ? null : 'compendio')}>📖 Compêndio</button>
        {iAmMaster && <button type="button" className={open === 'fichas' ? 'on' : ''} onClick={() => setOpen(open === 'fichas' ? null : 'fichas')}>📋 Fichas dos jogadores</button>}
      </div>
      {open && (
        <div className={`rpg-drawer is-${open}`} role="dialog" aria-label={open === 'compendio' ? 'Compêndio BLACKOUT' : 'Fichas dos jogadores'}>
          <div className="rpg-drawer-head">
            <strong>{open === 'compendio' ? 'Compêndio BLACKOUT' : 'Fichas dos jogadores'}</strong>
            <button type="button" className="rpg-link" onClick={() => setOpen(null)}>Fechar</button>
          </div>
          {open === 'compendio'
            ? (err ? <p className="rpg-tools-empty">{err}</p> : src ? <iframe className="rpg-drawer-frame" src={src} title="Compêndio BLACKOUT" /> : <p className="rpg-tools-empty">Abrindo…</p>)
            : <FichasDoMestre channelId={channelId} players={players} personOf={personOf} />}
        </div>
      )}
    </>
  );
}
