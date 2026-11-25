import { useEffect, useState } from 'react';
import { getBlackoutSheets, openBlackoutSession } from '../../api/endpoints';
import UserAvatar from '../UserAvatar.jsx';

// Ferramentas da mesa de RPG (nov/2026):
// - Compêndio: o site do BLACKOUT inteiro (poderes, trilhas, níveis, fichas)
//   num painel por cima da mesa, pra todo mundo consultar sem sair da call.
// - Fichas da mesa (quem está sentado): escolher a própria ficha (nome,
//   classe e PV da classe vão pro lugar) e ver as fichas dos aliados.

const SKIP = new Set(['id', '_id', 'mesaP', 'nome', '_pv', '_classe']);
function FichaResumo({ f }) {
  if (!f) return <p className="rpg-tools-empty">Ainda não escolheu uma ficha no compêndio.</p>;
  const campos = Object.entries(f)
    .filter(([k, v]) => !SKIP.has(k) && (typeof v === 'string' || typeof v === 'number') && String(v).trim() && String(v).length < 80)
    .slice(0, 12);
  return (
    <div className="rpg-ficha">
      <div className="rpg-ficha-top"><strong>{f.nome || 'Sem nome'}</strong>{f.mesaP?.lv ? <span className="rpg-ficha-lv">Nível {f.mesaP.lv}</span> : null}</div>
      {(f._classe || f._pv) && <div className="rpg-ficha-sub">{f._classe || 'Sem classe'}{f._pv ? ` · ${f._pv} PV` : ''}</div>}
      {campos.length > 0 && (
        <dl className="rpg-ficha-campos">
          {campos.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>))}
        </dl>
      )}
    </div>
  );
}

function FichasDaMesa({ channelId, players, personOf, pinned }) {
  const [data, setData] = useState({});
  const key = players.filter(Boolean).join(',');
  useEffect(() => {
    let alive = true;
    key.split(',').filter(Boolean).forEach((uid) => {
      getBlackoutSheets(uid, channelId)
        .then((d) => { if (alive) setData((m) => ({ ...m, [uid]: d })); })
        .catch(() => { if (alive) setData((m) => ({ ...m, [uid]: { error: true } })); });
    });
    return () => { alive = false; };
  }, [channelId, key]);
  const seated = players.filter(Boolean);
  if (!seated.length) return <p className="rpg-tools-empty">Nenhum jogador sentado ainda.</p>;
  return (
    <div className="rpg-fichas">
      {seated.map((uid) => {
        const d = data[uid];
        const pin = pinned(uid);
        const atual = d?.fichas?.find((f) => f.id === (pin || d.atual)) || d?.fichas?.[0] || null;
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

// O jogador escolhe qual das fichas dele vai pra mesa (nome, classe e PV).
function MinhaFicha({ myChar, onPick }) {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(null);
  useEffect(() => { getBlackoutSheets('me').then(setD).catch(() => setD({ fichas: [] })); }, []);
  if (!d) return <p className="rpg-tools-empty">Carregando suas fichas…</p>;
  if (!d.fichas.length) return <p className="rpg-tools-empty">Você ainda não tem fichas. Crie uma no Compêndio (Personagem) e ela aparece aqui.</p>;
  return (
    <div className="rpg-pick">
      <strong className="rpg-pick-title">Sua ficha na mesa</strong>
      <div className="rpg-pick-list">
        {d.fichas.map((f) => (
          <button
            key={f.id} type="button" className={`rpg-pick-item${myChar?.fichaId === f.id ? ' on' : ''}`} disabled={busy === f.id}
            onClick={async () => { setBusy(f.id); await onPick(myChar?.fichaId === f.id ? null : f.id); setBusy(null); }}
          >
            <strong>{f.nome || 'Sem nome'}</strong>
            <small>{f._classe || 'Sem classe'} · Nv {f.mesaP?.lv || 1}{f._pv ? ` · ${f._pv} PV` : ''}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function RpgTools({ channelId, iAmMaster, seated, mySeat, myChar, players, personOf, onPick, charOf }) {
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
        {seated && <button type="button" className={open === 'fichas' ? 'on' : ''} onClick={() => setOpen(open === 'fichas' ? null : 'fichas')}>📋 Fichas da mesa</button>}
      </div>
      {open && (
        <div className={`rpg-drawer is-${open}`} role="dialog" aria-label={open === 'compendio' ? 'Compêndio BLACKOUT' : 'Fichas da mesa'}>
          <div className="rpg-drawer-head">
            <strong>{open === 'compendio' ? 'Compêndio BLACKOUT' : 'Fichas da mesa'}</strong>
            <button type="button" className="rpg-link" onClick={() => setOpen(null)}>Fechar</button>
          </div>
          {open === 'compendio'
            ? (err ? <p className="rpg-tools-empty">{err}</p> : src ? <iframe className="rpg-drawer-frame" src={src} title="Compêndio BLACKOUT" /> : <p className="rpg-tools-empty">Abrindo…</p>)
            : (
              <div className="rpg-fichas-wrap">
                {typeof mySeat === 'number' && mySeat >= 0 && <MinhaFicha myChar={myChar} onPick={onPick} />}
                <FichasDaMesa channelId={channelId} players={players} personOf={personOf} pinned={(uid) => charOf?.(uid)?.fichaId || null} />
              </div>
            )}
        </div>
      )}
    </>
  );
}
