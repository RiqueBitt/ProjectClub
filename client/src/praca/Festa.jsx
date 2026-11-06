// Janela "Festa" — DENTRO do Club Penguin (por cima da tela do jogo, no
// visual das janelas do jogo, igual ao Jukebox). Mostra os eventos da Praça:
// quests sociais com recompensa, moeda do evento e loja temporária, mascotes
// com agenda (Pingu…), calendário do advento, Coins for Change, códigos de
// desbloqueio e os amigos que estão na ilha (com "ir até ele").
// Servidor: server/src/services/waddle/events.js (/api/plaza/events…).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useSocket } from '../context/SocketContext.jsx';
import '../styles/jukebox.css';
import '../styles/festa.css';

const STAGE_W = 760; const STAGE_H = 480;
const WIN_W = 470; const WIN_H = 400;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const Icon = ({ d, size = 18 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path fill="currentColor" d={d} /></svg>
);
const I = {
  close: 'M6.3 6.3a1.2 1.2 0 0 1 1.7 0l4 4 4-4a1.2 1.2 0 1 1 1.7 1.7l-4 4 4 4a1.2 1.2 0 0 1-1.7 1.7l-4-4-4 4a1.2 1.2 0 0 1-1.7-1.7l4-4-4-4a1.2 1.2 0 0 1 0-1.7z',
  check: 'M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 12-12-1.4-1.4z',
  star: 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z',
  go: 'M5 12h12.2l-4.6-4.6L14 6l7 7-7 7-1.4-1.4 4.6-4.6H5z',
};

function useStageBox(stageRef, on) {
  const [box, setBox] = useState(null);
  useLayoutEffect(() => {
    const stage = stageRef?.current;
    if (!on || !stage) { setBox(null); return undefined; }
    const parent = stage.offsetParent || stage.parentElement;
    const measure = () => {
      const r = stage.getBoundingClientRect(); const p = parent.getBoundingClientRect();
      if (r.width < 50) { setBox(null); return; }
      setBox((b) => {
        const nb = { left: Math.round(r.left - p.left), top: Math.round(r.top - p.top), width: Math.round(r.width), height: Math.round(r.height) };
        return b && b.left === nb.left && b.top === nb.top && b.width === nb.width && b.height === nb.height ? b : nb;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage); ro.observe(parent);
    window.addEventListener('resize', measure);
    const t = setInterval(measure, 1500);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); clearInterval(t); };
  }, [stageRef, on]);
  return box;
}

const when = (iso) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const hm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export default function Festa({ active, stageRef, playerRef, user, isStaff }) {
  const { socket } = useSocket() || {};
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('quests');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [pos, setPos] = useState({ x: (STAGE_W - WIN_W) / 2, y: 30 });
  const dragRef = useRef(null);
  const box = useStageBox(stageRef, active);

  const load = useCallback(async () => {
    try { const { data: d } = await api.get('/plaza/events'); setData(d); } catch { /* sem festa ou offline */ }
  }, []);
  useEffect(() => { if (active) load(); }, [active, load]);
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(load, open ? 20000 : 60000);
    return () => clearInterval(t);
  }, [active, open, load]);

  const say = useCallback((text, kind = 'ok') => { setNotice({ text, kind }); window.clearTimeout(say.t); say.t = window.setTimeout(() => setNotice(null), 4500); }, []);

  useEffect(() => {
    if (!socket) return undefined;
    const onDone = () => { load(); say('Quest concluída! Pegue a recompensa na janela Festa.'); };
    const onMeet = (p) => { load(); say(`Você encontrou ${p?.name || 'um mascote'}! Brinde recebido.`); };
    socket.on('praca:quest-done', onDone);
    socket.on('praca:mascot-meet', onMeet);
    return () => { socket.off('praca:quest-done', onDone); socket.off('praca:mascot-meet', onMeet); };
  }, [socket, load, say]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const call = useCallback(async (key, fn, okText) => {
    if (busy) return;
    setBusy(key);
    try {
      const { data: r } = await fn();
      await load();
      say(typeof okText === 'function' ? okText(r) : okText);
    } catch (err) { say(err?.response?.data?.error || 'Não deu certo. Tente de novo.', 'error'); }
    finally { setBusy(''); }
  }, [busy, load, say]);

  const rewardText = (r) => [r.coins ? `${r.coins} moedas` : null, r.eventCoins ? `${r.eventCoins} fichas` : null, r.items?.length ? `${r.items.length} ${r.items.length === 1 ? 'item' : 'itens'}` : null].filter(Boolean).join(' + ') || 'recompensa';

  const goTo = (roomKey) => {
    const p = playerRef?.current;
    try { if (roomKey && typeof p?.pracaJoinRoom === 'function' && p.pracaJoinRoom(roomKey, 380, 300) === true) { setOpen(false); return; } } catch { /* ok */ }
    say('Não deu pra ir até lá agora.', 'error');
  };

  const claimable = useMemo(() => {
    if (!data) return 0;
    let n = 0;
    for (const ev of data.events) {
      n += ev.quests.filter((q) => q.done && !q.claimed).length;
      n += (ev.cfc?.goals || []).filter((g) => g.claimable).length;
      n += (ev.advent?.days || []).filter((d) => d.open && !d.claimed).length;
    }
    return n;
  }, [data]);

  // arrastar pelo título
  const onDragStart = (e) => { if (e.button !== 0 || e.target.closest('button')) return; dragRef.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onDragMove = (e) => { const d = dragRef.current; if (!d) return; const k = box ? box.width / STAGE_W : 1; setPos({ x: clamp(d.px + (e.clientX - d.x) / k, -WIN_W + 80, STAGE_W - 80), y: clamp(d.py + (e.clientY - d.y) / k, 0, STAGE_H - 60) }); };
  const onDragEnd = () => { dragRef.current = null; };

  if (!active || !box) return null;
  const k = box.width / STAGE_W;
  const zoom = clamp(0.7 / k, 1, Math.min((box.width - 8) / (WIN_W * k), (box.height - 8) / (WIN_H * k)));
  const winStyle = zoom > 1 ? { left: (STAGE_W - WIN_W * zoom) / 2, top: (STAGE_H - WIN_H * zoom) / 2, transform: `scale(${zoom})`, transformOrigin: '0 0' } : { left: pos.x, top: pos.y };
  const hasEvents = !!data?.events?.length;
  const tabs = [
    ['quests', 'Quests'], ['loja', 'Loja'], ['mascotes', 'Mascotes'], ['amigos', 'Amigos'], ['codigo', 'Código'],
    ...(data?.events?.some((e) => e.advent) ? [['advento', 'Advento']] : []),
    ...(data?.events?.some((e) => e.cfc) ? [['cfc', 'Doações']] : []),
  ];

  return (
    <div className="cpjb-layer cpf-layer" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      <div className="cpjb-canvas" style={{ transform: `scale(${k})` }}>
        {!open && (
          <button type="button" className={`cpf-fab${claimable ? ' has-new' : ''}`} onClick={() => setOpen(true)} title="Festa: quests, loja, mascotes e amigos na ilha">
            <span className="cpf-fab-ico" aria-hidden="true">🎉</span>
            <span>{hasEvents ? data.events[0].name : 'Festa'}</span>
            {claimable > 0 && <b className="cpf-fab-n">{claimable}</b>}
          </button>
        )}
        <section className={`cpjb-win cpf-win${open ? ' is-open' : ''}`} style={winStyle} role="dialog" aria-label="Festa da ilha" aria-hidden={!open}>
          <header className="cpjb-title" onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
            <span className="cpf-badge" aria-hidden="true">🎉</span>
            <div className="cpjb-title-text">
              <h2>{hasEvents ? data.events[0].name : 'Festa'}</h2>
              {notice
                ? <span className={`cpjb-say${notice.kind === 'error' ? ' is-error' : ''}`} role="status">{notice.text}</span>
                : <span>{hasEvents ? `${data.events[0].wallet.balance} ${data.events[0].currencyName} · até ${new Date(data.events[0].endsAt).toLocaleDateString('pt-BR')}` : 'Sem evento rolando agora — mascotes e amigos continuam aqui'}</span>}
            </div>
            <button type="button" className="cpjb-x" onClick={() => setOpen(false)} aria-label="Fechar" tabIndex={open ? 0 : -1}><Icon d={I.close} size={18} /></button>
          </header>

          <nav className="cpjb-tabs cpf-tabs" role="tablist">
            {tabs.map(([k2, label]) => (
              <button key={k2} type="button" role="tab" aria-selected={tab === k2} className={tab === k2 ? 'is-on' : ''} onClick={() => setTab(k2)} tabIndex={open ? 0 : -1}>{label}</button>
            ))}
          </nav>

          <div className="cpjb-panel cpf-panel">
            {tab === 'quests' && (
              !hasEvents ? <Empty text="Nenhuma festa com quests agora. Fique de olho no Novidades!" /> : data.events.map((ev) => (
                <div key={ev.slug} className="cpf-block">
                  {data.events.length > 1 && <h3>{ev.name}</h3>}
                  {!ev.quests.length && <Empty text="Essa festa não tem quests." />}
                  <ul className="cpf-list">
                    {ev.quests.map((q) => (
                      <li key={q.key} className={`cpf-quest${q.claimed ? ' is-claimed' : q.done ? ' is-done' : ''}`}>
                        <span className="cpf-q-main">
                          <b>{q.title}</b>
                          <small>{q.desc}{q.type === 'visit' && q.rooms.length ? ` (${q.rooms.map((r) => r.name).join(', ')})` : ''}</small>
                          <span className="cpf-prog"><i style={{ width: `${Math.round((q.progress / q.target) * 100)}%` }} /></span>
                          <small className="cpf-reward">{q.progress}/{q.target} · {rewardText(q.reward)}</small>
                        </span>
                        {q.claimed ? <span className="cpf-ok"><Icon d={I.check} size={16} /></span>
                          : q.done ? <button type="button" className="cpjb-pill is-green is-small" disabled={busy === q.key} onClick={() => call(q.key, () => api.post(`/plaza/events/${ev.slug}/quests/${q.key}/claim`), (r) => `Recompensa: ${rewardText(r)}!`)}>Pegar</button>
                            : q.type === 'visit' && q.rooms.length ? <button type="button" className="cpjb-mini" title="Ir até a sala" onClick={() => goTo(q.rooms.find((r) => r.key)?.key)}><Icon d={I.go} size={14} /></button> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}

            {tab === 'loja' && (
              !hasEvents ? <Empty text="A loja só abre durante uma festa." /> : data.events.map((ev) => (
                <div key={ev.slug} className="cpf-block">
                  <p className="cpjb-hint">Você tem <b>{ev.wallet.balance} {ev.currencyName}</b> (ganhou {ev.wallet.earned} nesta festa). Ganhe mais completando quests.</p>
                  {!ev.shop.length && <Empty text="A loja desta festa ainda está vazia." />}
                  <ul className="cpf-list">
                    {ev.shop.map((s) => (
                      <li key={s.key} className={`cpf-shop${s.bought ? ' is-claimed' : ''}`}>
                        <span className="cpf-q-main"><b>{s.label}</b><small>{s.itemIds.length} {s.itemIds.length === 1 ? 'item' : 'itens'} · {s.price} {ev.currencyName}</small></span>
                        {s.bought ? <span className="cpf-ok"><Icon d={I.check} size={16} /></span>
                          : <button type="button" className="cpjb-pill is-yellow is-small" disabled={busy === s.key || ev.wallet.balance < s.price} onClick={() => call(s.key, () => api.post(`/plaza/events/${ev.slug}/shop/${s.key}`), 'Comprado! Já está no seu inventário.')}>Comprar</button>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}

            {tab === 'mascotes' && (
              !data?.mascots?.length ? <Empty text="Nenhuma visita de mascote marcada. O Pingu e a equipe avisam no Novidades!" /> : (
                <ul className="cpf-list">
                  {data.mascots.map((m) => (
                    <li key={m.id} className={`cpf-mascot${m.active ? ' is-live' : ''}${m.met ? ' is-claimed' : ''}`}>
                      <span className="cpf-q-main">
                        <b>{m.name}{m.active && <em className="cpf-live">{m.inRoom ? 'na ilha agora' : m.onIsland ? 'chegando' : 'aguardando'}</em>}</b>
                        <small>{m.roomName} · {when(m.startsAt)} – {hm(m.endsAt)}{m.hasBackground ? ' · fundo de brinde' : ''}</small>
                        {m.note && <small>{m.note}</small>}
                      </span>
                      {m.met ? <span className="cpf-ok" title="Você já encontrou"><Icon d={I.star} size={16} /></span>
                        : m.active && m.roomKey ? <button type="button" className="cpjb-pill is-green is-small" onClick={() => goTo(m.roomKey)}><Icon d={I.go} size={14} /> Ir</button> : null}
                    </li>
                  ))}
                </ul>
              )
            )}

            {tab === 'amigos' && (
              !data?.friends?.length ? <Empty text="Nenhum amigo seu está na ilha agora." /> : (
                <ul className="cpf-list">
                  {data.friends.map((f) => (
                    <li key={f.id} className="cpf-friend">
                      <span className="cpf-avatar" style={f.avatarUrl ? { backgroundImage: `url("${f.avatarUrl}")` } : undefined}>{!f.avatarUrl && (f.displayName || '?').slice(0, 1)}</span>
                      <span className="cpf-q-main"><b>{f.displayName}</b><small>@{f.username} · {f.roomName}</small></span>
                      <button type="button" className="cpjb-pill is-green is-small" disabled={!f.roomKey} onClick={() => goTo(f.roomKey)}><Icon d={I.go} size={14} /> Ir até</button>
                    </li>
                  ))}
                </ul>
              )
            )}

            {tab === 'codigo' && <CodeForm busy={busy === 'code'} onRedeem={(code) => call('code', () => api.post('/plaza/codes/redeem', { code }), (r) => `Código resgatado: ${rewardText(r)}!`)} />}

            {tab === 'advento' && data.events.filter((e) => e.advent).map((ev) => (
              <div key={ev.slug} className="cpf-block">
                <p className="cpjb-hint">Um presente por dia até o Natal. Abra os dias que já passaram!</p>
                <div className="cpf-advent">
                  {ev.advent.days.map((d) => (
                    <button key={d.day} type="button" className={`cpf-day${d.claimed ? ' is-claimed' : d.open ? ' is-open' : ''}`} disabled={!d.open || d.claimed || busy === `adv${d.day}`} onClick={() => call(`adv${d.day}`, () => api.post(`/plaza/events/${ev.slug}/advent/${d.day}`), (r) => `Dia ${d.day}: ${rewardText(r)}!`)} title={d.claimed ? 'Já aberto' : d.open ? 'Abrir' : 'Ainda não chegou'}>
                      <b>{d.day}</b>{d.claimed && <Icon d={I.check} size={12} />}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {tab === 'cfc' && data.events.filter((e) => e.cfc).map((ev) => (
              <div key={ev.slug} className="cpf-block">
                <p className="cpjb-hint">Coins for Change: a comunidade doa moedas e, a cada meta batida, quem doou ganha a recompensa. Já doadas: <b>{ev.cfc.total}</b> por {ev.cfc.donors} {ev.cfc.donors === 1 ? 'pinguim' : 'pinguins'}. Você doou {ev.cfc.mine}.</p>
                <DonateForm busy={busy === 'donate'} onDonate={(amount) => call('donate', () => api.post(`/plaza/events/${ev.slug}/donate`, { amount }), 'Obrigado por doar!')} />
                <ul className="cpf-list">
                  {ev.cfc.goals.map((g) => (
                    <li key={g.index} className={`cpf-quest${g.claimed ? ' is-claimed' : g.reached ? ' is-done' : ''}`}>
                      <span className="cpf-q-main">
                        <b>{g.label}</b>
                        <span className="cpf-prog"><i style={{ width: `${Math.min(100, Math.round((ev.cfc.total / g.amount) * 100))}%` }} /></span>
                        <small className="cpf-reward">{Math.min(ev.cfc.total, g.amount)}/{g.amount} moedas · {rewardText(g)}</small>
                      </span>
                      {g.claimed ? <span className="cpf-ok"><Icon d={I.check} size={16} /></span>
                        : g.claimable ? <button type="button" className="cpjb-pill is-green is-small" disabled={busy === `cfc${g.index}`} onClick={() => call(`cfc${g.index}`, () => api.post(`/plaza/events/${ev.slug}/cfc/${g.index}/claim`), (r) => `Recompensa: ${rewardText(r)}!`)}>Pegar</button> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {isStaff && <p className="cpf-staff">Equipe: edite tudo em Painel → Club Penguin → Eventos.</p>}
        </section>
      </div>
    </div>
  );
}

function Empty({ text }) { return <div className="cpjb-empty"><span>{text}</span></div>; }

function CodeForm({ busy, onRedeem }) {
  const [code, setCode] = useState('');
  return (
    <form className="cpjb-search cpf-code" onSubmit={(e) => { e.preventDefault(); if (code.trim()) { onRedeem(code.trim()); setCode(''); } }}>
      <span className="cpjb-field">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Digite o código" aria-label="Código de desbloqueio" maxLength={40} autoComplete="off" onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }} />
      </span>
      <button type="submit" className="cpjb-pill is-green" disabled={busy || !code.trim()}>Resgatar</button>
      <p className="cpjb-hint">Códigos saem no Novidades, nas lives e nas visitas dos mascotes. Cada um vale uma vez por pinguim.</p>
    </form>
  );
}

function DonateForm({ busy, onDonate }) {
  const [amount, setAmount] = useState(100);
  return (
    <form className="cpjb-search cpf-code" onSubmit={(e) => { e.preventDefault(); onDonate(amount); }}>
      <span className="cpjb-field">
        <input type="number" min="1" max="100000" value={amount} onChange={(e) => setAmount(Number(e.target.value))} aria-label="Moedas pra doar" onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }} />
      </span>
      <button type="submit" className="cpjb-pill is-yellow" disabled={busy || amount < 1}>Doar moedas</button>
    </form>
  );
}
