import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { CardView, ELEMENTS, RARITIES, RARITY_ORDER, ABILITIES, Icon, UI, abilityText } from '../cards/CardView.jsx';
import Battle from '../cards/Battle.jsx';
import PackOpening from '../cards/PackOpening.jsx';
import DeckBuilder from '../cards/DeckBuilder.jsx';
import Trades, { UserPicker } from '../cards/Trades.jsx';
import {
  cardsHome, cardsClaimStarter, cardsCollection, cardsPacks, cardsOpenPack, cardsStartPve, cardsMatch,
  cardsChallenge, cardsAcceptChallenge, cardsDeclineChallenge, cardsHistory, cardsRanking, cardsSell, cardsLevelUp, errMsg,
} from '../cards/api';
import '../styles/cards.css';

// Arena de Cartas — jogo de cartas colecionáveis do Project Club (substitui
// as Figurinhas). Jogo principal da seção Mini-Jogos.
const TABS = [
  { key: 'jogar', label: 'Jogar', icon: UI.sword },
  { key: 'colecao', label: 'Coleção', icon: UI.deck },
  { key: 'loja', label: 'Pacotes', icon: UI.pack },
  { key: 'baralhos', label: 'Baralhos', icon: UI.list },
  { key: 'trocas', label: 'Trocas', icon: UI.swap },
  { key: 'ranking', label: 'Ranking', icon: UI.trophy },
];

const BOT_LOOK = {
  FACIL: { name: 'Aprendiz Pip', color: '#4cc76b', desc: 'Bom para aprender. Comete erros e usa cartas simples.' },
  MEDIO: { name: 'Duelista Nora', color: '#3b8bff', desc: 'Joga com calma e faz boas trocas. Usa cartas Raras.' },
  DIFICIL: { name: 'Mestre Kael', color: '#b55cff', desc: 'Pensa uma jogada à frente. Cartas até Lendárias, nível 3.' },
  LENDARIO: { name: 'Arquimaga Vex', color: '#ffb020', desc: 'O maior desafio: cartas Míticas no nível máximo.' },
};

function Wallet({ wallet }) {
  return (
    <div className="tcg-wallet">
      <span title="Moedas"><Icon d={UI.coin} size={16} />{(wallet?.coins ?? 0).toLocaleString('pt-BR')}</span>
      <span title="Gemas" className="is-gem"><Icon d={UI.gem} size={16} />{(wallet?.gems ?? 0).toLocaleString('pt-BR')}</span>
    </div>
  );
}

function CardModal({ card, home, onClose, onChanged }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const lvIdx = (card.level || 1) - 1;
  const needCopies = home.economy.levelUpCopies[lvIdx] ?? home.economy.levelUpCopies.at(-1);
  const needCoins = home.economy.levelUpCoins[lvIdx] ?? home.economy.levelUpCoins.at(-1);
  const maxed = (card.level || 1) >= home.rules.levelCap;
  const sellValue = home.economy.sellValues[card.rarity] || 0;
  const run = async (fn) => {
    setBusy(true); setErr('');
    try { const r = await fn(); onChanged(r); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const ab = ABILITIES[card.ability];
  return (
    <div className="tcg-modal" role="dialog" aria-label={card.name} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tcg-modal-box">
        <button type="button" className="tcg-icon-btn tcg-modal-x" onClick={onClose} aria-label="Fechar"><Icon d={UI.close} /></button>
        <CardView card={card} size="lg" />
        <div className="tcg-modal-info">
          <h2 data-no-translate>{card.name}</h2>
          <p className="tcg-tags">
            <span style={{ '--c': RARITIES[card.rarity]?.color }}>{RARITIES[card.rarity]?.label}</span>
            <span style={{ '--c': ELEMENTS[card.element]?.color }}>{ELEMENTS[card.element]?.label}</span>
            <span>{card.collection}</span>
            <span>Força {card.power}</span>
          </p>
          {ab?.label && <p><b>{ab.label}:</b> {abilityText(card.ability, card.abilityValue)}</p>}
          {card.description && <p>{card.description}</p>}
          {card.flavor && <p className="tcg-flavor">“{card.flavor}”</p>}
          <p className="tcg-dim">Elemento forte contra: {(home.meta.elements.find((e) => e.key === card.element)?.beats || []).map((b) => ELEMENTS[b]?.label).join(', ') || '—'} (+{home.rules.elementBonus} de dano)</p>
          {card.quantity > 0 ? (
            <div className="tcg-modal-actions">
              <div className="tcg-stat-row"><span>Você tem <b>{card.quantity}</b></span><span>Nível <b>{card.level}</b>/{home.rules.levelCap}</span></div>
              {!maxed && (
                <button type="button" className="tcg-btn primary" disabled={busy || card.quantity < needCopies + 1} onClick={() => run(() => cardsLevelUp(card.id))}>
                  <Icon d={UI.up} />Evoluir para Nv {card.level + 1} · {needCopies} cópia(s) + {needCoins} moedas
                </button>
              )}
              {home.enabled.sell && (
                <button type="button" className="tcg-btn" disabled={busy || card.quantity < 2} onClick={() => run(() => cardsSell(card.id, 1))}>
                  <Icon d={UI.coin} />Vender 1 repetida (+{sellValue})
                </button>
              )}
              {card.quantity < 2 && <small className="tcg-dim">Evoluir e vender usam só cópias repetidas.</small>}
            </div>
          ) : <p className="tcg-dim">Você ainda não tem esta carta. Abra pacotes ou troque com outros jogadores.</p>}
          {err && <p className="tcg-error">{err}</p>}
        </div>
      </div>
    </div>
  );
}

function CollectionTab({ cards, home, onChanged }) {
  const [q, setQ] = useState('');
  const [el, setEl] = useState('');
  const [rar, setRar] = useState('');
  const [onlyOwned, setOnlyOwned] = useState(false);
  const [sort, setSort] = useState('cost');
  const [open, setOpen] = useState(null);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = cards.filter((c) => (!el || c.element === el) && (!rar || c.rarity === rar) && (!onlyOwned || c.quantity > 0) && (!t || c.name.toLowerCase().includes(t)));
    const s = {
      cost: (a, b) => a.cost - b.cost || a.name.localeCompare(b.name),
      rarity: (a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) || a.cost - b.cost,
      power: (a, b) => b.power - a.power,
      owned: (a, b) => b.quantity - a.quantity,
    }[sort];
    return [...list].sort(s);
  }, [cards, q, el, rar, onlyOwned, sort]);
  const owned = cards.filter((c) => c.quantity > 0).length;
  const current = open ? cards.find((c) => c.id === open) : null;
  return (
    <div>
      <div className="tcg-progress">
        <span>Coleção: <b>{owned}</b> de <b>{cards.length}</b> cartas</span>
        <span className="tcg-bar"><i style={{ width: `${cards.length ? (owned / cards.length) * 100 : 0}%` }} /></span>
      </div>
      <div className="tcg-filters">
        <label className="tcg-search"><Icon d={UI.search} size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar carta" aria-label="Buscar carta" /></label>
        <div className="tcg-chips">
          <button type="button" className={!el ? 'on' : ''} onClick={() => setEl('')}>Todos</button>
          {Object.entries(ELEMENTS).map(([k, v]) => <button key={k} type="button" className={el === k ? 'on' : ''} style={{ '--el': v.color }} onClick={() => setEl(el === k ? '' : k)}><Icon d={v.glyph} size={12} />{v.label}</button>)}
        </div>
        <div className="tcg-chips">
          <button type="button" className={!rar ? 'on' : ''} onClick={() => setRar('')}>Todas</button>
          {RARITY_ORDER.map((r) => <button key={r} type="button" className={rar === r ? 'on' : ''} style={{ '--el': RARITIES[r].color }} onClick={() => setRar(rar === r ? '' : r)}>{RARITIES[r].label}</button>)}
        </div>
        <label className="tcg-check"><input type="checkbox" checked={onlyOwned} onChange={(e) => setOnlyOwned(e.target.checked)} />Só as que tenho</label>
        <select className="tcg-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
          <option value="cost">Custo</option><option value="rarity">Raridade</option><option value="power">Força</option><option value="owned">Quantidade</option>
        </select>
      </div>
      <div className="tcg-grid">
        {shown.map((c) => <CardView key={c.id} card={c} size="md" showQty quantity={c.quantity} dim={!c.quantity} onClick={() => setOpen(c.id)} />)}
        {!shown.length && <p className="tcg-empty">Nenhuma carta com esse filtro.</p>}
      </div>
      {current && <CardModal card={current} home={home} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </div>
  );
}

function PacksTab({ home, onOpened }) {
  const [packs, setPacks] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);
  const [opening, setOpening] = useState(null);
  const load = () => cardsPacks().then((d) => setPacks(d.packs)).catch((e) => setErr(errMsg(e)));
  useEffect(() => { load(); }, []);
  const open = async (p, currency) => {
    setBusy(p.id + currency); setErr('');
    try {
      const r = await cardsOpenPack(p.id, currency);
      setOpening({ pack: p, cards: r.cards, currency });
      onOpened(r.wallet);
      load();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(null); }
  };
  if (!home.enabled.packs) return <p className="tcg-empty">A loja de pacotes está fechada no momento.</p>;
  return (
    <div>
      {err && <p className="tcg-error">{err}</p>}
      <div className="tcg-packs">
        {packs === null && <p className="tcg-empty">Carregando…</p>}
        {packs?.map((p) => {
          const total = Object.values(p.weights).reduce((s, n) => s + Number(n || 0), 0) || 1;
          const limit = p.dailyLimit ? p.dailyLimit - p.openedToday : null;
          return (
            <div key={p.id} className="tcg-pack" style={{ '--pack': p.color }}>
              <div className="tcg-pack-art">
                {p.imageUrl ? <img src={p.imageUrl} alt="" /> : <span className="tcg-pack-gfx"><Icon d={UI.pack} size={54} sw={1.5} /></span>}
                <span className="tcg-pack-n">{p.cardsPerPack} cartas</span>
              </div>
              <div className="tcg-pack-body">
                <h3 data-no-translate>{p.name}</h3>
                {p.description && <p>{p.description}</p>}
                <div className="tcg-odds" aria-label="Chances por carta">
                  {RARITY_ORDER.filter((r) => Number(p.weights[r]) > 0).map((r) => (
                    <span key={r} style={{ '--c': RARITIES[r].color }}><i />{RARITIES[r].label} {((Number(p.weights[r]) / total) * 100).toFixed(Number(p.weights[r]) / total < 0.01 ? 2 : 1)}%</span>
                  ))}
                </div>
                {p.guaranteed && <small className="tcg-dim">Garantia: pelo menos 1 carta {RARITIES[p.guaranteed]?.label} ou melhor.</small>}
                {limit !== null && <small className="tcg-dim">Hoje: {Math.max(0, limit)} de {p.dailyLimit} restantes.</small>}
                <div className="tcg-pack-buy">
                  {p.priceCoins !== null && p.priceCoins !== undefined && (
                    <button type="button" className="tcg-btn primary" disabled={!!busy || limit === 0 || (home.wallet?.coins ?? 0) < p.priceCoins} onClick={() => open(p, 'coins')}>
                      <Icon d={UI.coin} />{busy === p.id + 'coins' ? 'Abrindo…' : p.priceCoins.toLocaleString('pt-BR')}
                    </button>
                  )}
                  {p.priceGems !== null && p.priceGems !== undefined && (
                    <button type="button" className="tcg-btn gem" disabled={!!busy || limit === 0 || (home.wallet?.gems ?? 0) < p.priceGems} onClick={() => open(p, 'gems')}>
                      <Icon d={UI.gem} />{busy === p.id + 'gems' ? 'Abrindo…' : p.priceGems.toLocaleString('pt-BR')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="tcg-dim tcg-note">As chances são por carta. Cada pacote é sorteado no servidor no momento da compra.</p>
      {opening && (
        <PackOpening
          pack={opening.pack} cards={opening.cards}
          canAgain={(() => { const p = packs?.find((x) => x.id === opening.pack.id); const price = opening.currency === 'gems' ? p?.priceGems : p?.priceCoins; return p && (home.wallet?.[opening.currency] ?? 0) >= price && (!p.dailyLimit || p.openedToday < p.dailyLimit); })()}
          onAgain={() => { const p = packs.find((x) => x.id === opening.pack.id); setOpening(null); open(p, opening.currency); }}
          onClose={() => setOpening(null)}
        />
      )}
    </div>
  );
}

function PlayTab({ home, me, onStartMatch, onReload }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [history, setHistory] = useState([]);
  const [picking, setPicking] = useState(false);
  const [sent, setSent] = useState('');
  useEffect(() => { cardsHistory().then((d) => setHistory(d.matches)).catch(() => {}); }, []);
  const start = async (difficulty) => {
    setBusy(difficulty); setErr('');
    try { onStartMatch(await cardsStartPve(difficulty)); } catch (e) { setErr(errMsg(e)); } finally { setBusy(''); }
  };
  const challenge = async (u) => {
    setErr(''); setSent('');
    try { await cardsChallenge(u.id); setSent(`Desafio enviado para ${u.displayName}. Assim que aceitar, a partida começa.`); setPicking(false); onReload(); } catch (e) { setErr(errMsg(e)); }
  };
  const accept = async (id) => {
    setErr('');
    try { onStartMatch(await cardsAcceptChallenge(id)); } catch (e) { setErr(errMsg(e)); onReload(); }
  };
  const p = home.player;
  return (
    <div className="tcg-play">
      {err && <p className="tcg-error">{err}</p>}
      {sent && <p className="tcg-ok">{sent}</p>}
      {home.activeMatch && (
        <div className="tcg-resume">
          <span><Icon d={UI.sword} size={18} />Você tem uma partida {home.activeMatch.mode === 'PVP' ? 'PvP' : 'contra bot'} em andamento.</span>
          <button type="button" className="tcg-btn primary" onClick={async () => { try { onStartMatch(await cardsMatch(home.activeMatch.id)); } catch (e) { setErr(errMsg(e)); } }}>Continuar</button>
        </div>
      )}
      {home.challenges.filter((c) => c.incoming).map((c) => (
        <div key={c.id} className="tcg-resume is-challenge">
          <UserAvatar user={c.from || {}} size={30} />
          <span><b data-no-translate>{c.from?.displayName}</b> desafiou você para um duelo!</span>
          <button type="button" className="tcg-btn ghost" onClick={() => cardsDeclineChallenge(c.id).then(onReload)}>Recusar</button>
          <button type="button" className="tcg-btn primary" onClick={() => accept(c.id)}>Aceitar</button>
        </div>
      ))}

      <h3 className="tcg-h3">Contra bots</h3>
      <div className="tcg-bots">
        {home.meta.difficulties.map((d) => {
          const look = BOT_LOOK[d.key] || {};
          return (
            <div key={d.key} className="tcg-bot" style={{ '--c': look.color }}>
              <span className="tcg-bot-face"><Icon d={UI.bot} size={34} /></span>
              <strong>{look.name}</strong>
              <em>{d.label}</em>
              <p>{look.desc}</p>
              <span className="tcg-bot-meta"><Icon d={UI.heart} size={13} fill />{d.heroHp} de vida · <Icon d={UI.coin} size={13} />+{home.rewards[d.key]} por vitória</span>
              <button type="button" className="tcg-btn primary" disabled={!!busy || !home.enabled.pve} onClick={() => start(d.key)}>{busy === d.key ? 'Preparando…' : 'Jogar'}</button>
            </div>
          );
        })}
      </div>
      <p className="tcg-dim tcg-note">Partidas com recompensa hoje: {p.rewardsToday}/{home.rewards.dailyRewardedMatches}. Sequência de vitórias dá bônus de moedas.</p>

      <h3 className="tcg-h3">Contra jogadores</h3>
      {!home.enabled.pvp ? <p className="tcg-empty">Partidas PvP estão desativadas.</p> : picking ? (
        <div>
          <div className="tcg-section-head"><p>Quem você quer desafiar? O desafio vale por 5 minutos.</p><button type="button" className="tcg-btn ghost" onClick={() => setPicking(false)}>Voltar</button></div>
          <UserPicker meId={me.id} actionLabel="Desafiar" onPick={challenge} />
        </div>
      ) : (
        <div className="tcg-pvp">
          <div>
            <p>Desafie amigos para um duelo ao vivo. Turnos de {home.rules.turnSeconds}s, vale ranking e <b>+{home.rewards.pvpWin}</b> moedas por vitória.</p>
            {home.challenges.filter((c) => !c.incoming).map((c) => (
              <p key={c.id} className="tcg-dim">Aguardando <b data-no-translate>{c.to?.displayName}</b> aceitar… <button type="button" className="tcg-link" onClick={() => cardsDeclineChallenge(c.id).then(onReload)}>cancelar</button></p>
            ))}
          </div>
          <button type="button" className="tcg-btn primary" onClick={() => setPicking(true)}><Icon d={UI.users} />Desafiar alguém</button>
        </div>
      )}

      <h3 className="tcg-h3">Últimas partidas</h3>
      <div className="tcg-history">
        {history.map((m) => (
          <div key={m.id} className={`tcg-hist${m.won ? ' is-win' : ' is-loss'}`}>
            <span className="tcg-hist-res">{m.won ? 'Vitória' : 'Derrota'}</span>
            <span className="tcg-hist-vs">vs <b data-no-translate>{m.opponent?.displayName}</b>{m.mode === 'PVE' ? ' (bot)' : ''}</span>
            <span className="tcg-hist-coins">{m.reward > 0 ? <><Icon d={UI.coin} size={13} />+{m.reward}</> : '—'}</span>
            <span className="tcg-dim">{new Date(m.endedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        ))}
        {!history.length && <p className="tcg-empty">Nenhuma partida ainda. Que tal começar contra a Aprendiz Pip?</p>}
      </div>
    </div>
  );
}

function RankingTab() {
  const [by, setBy] = useState('rating');
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); cardsRanking(by).then(setData).catch(() => setData({ players: [] })); }, [by]);
  return (
    <div>
      <div className="tcg-chips">
        <button type="button" className={by === 'rating' ? 'on' : ''} onClick={() => setBy('rating')}>Ranking PvP</button>
        <button type="button" className={by === 'wins' ? 'on' : ''} onClick={() => setBy('wins')}>Vitórias contra bots</button>
      </div>
      <div className="tcg-rank">
        {data === null && <p className="tcg-empty">Carregando…</p>}
        {data?.players.map((r) => (
          <div key={r.user.id} className={`tcg-rank-row${r.rank <= 3 ? ` is-top${r.rank}` : ''}`}>
            <span className="tcg-rank-n">{r.rank}</span>
            <UserAvatar user={r.user} size={32} />
            <span className="tcg-rank-name" data-no-translate>{r.user.displayName}</span>
            {by === 'rating' ? <><b>{r.rating}</b><small>{r.pvpWins}V · {r.pvpLosses}D</small></> : <><b>{r.wins}</b><small>vitórias</small></>}
          </div>
        ))}
        {data?.players.length === 0 && <p className="tcg-empty">Ninguém no ranking ainda.</p>}
      </div>
    </div>
  );
}

export default function CardsGamePage() {
  const { user } = useAuth();
  const { socket } = useSocket() || {};
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('aba')) ? params.get('aba') : 'jogar';
  const [home, setHome] = useState(null);
  const [cards, setCards] = useState([]);
  const [match, setMatch] = useState(null);
  const [err, setErr] = useState('');
  const [starter, setStarter] = useState(null);
  const tradeWith = params.get('trocar');
  const [tradeTarget, setTradeTarget] = useState(null);

  const loadHome = useCallback(() => cardsHome().then((h) => { setHome(h); return h; }).catch((e) => setErr(errMsg(e, 'Não foi possível abrir o Jogo de Cartas.'))), []);
  const loadCards = useCallback(() => cardsCollection().then((d) => setCards(d.cards)).catch(() => {}), []);
  useEffect(() => { loadHome(); loadCards(); }, [loadHome, loadCards]);

  // Abre partida pela URL (?partida=id), ex.: vinda de um desafio aceito.
  useEffect(() => {
    const id = params.get('partida');
    if (id && (!match || match.id !== id)) cardsMatch(id).then(setMatch).catch((e) => setErr(errMsg(e)));
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?desafiar=userId / ?trocar=userId (vindo do perfil)
  useEffect(() => {
    const id = params.get('desafiar');
    if (!id) return;
    cardsChallenge(id).then(() => { setErr(''); loadHome(); }).catch((e) => setErr(errMsg(e)));
    setParams((p) => { const n = new URLSearchParams(p); n.delete('desafiar'); return n; }, { replace: true });
  }, [params, setParams, loadHome]);
  useEffect(() => {
    if (!tradeWith) return;
    import('../cards/api').then(({ cardsUserCollection }) => cardsUserCollection(tradeWith)).then((d) => setTradeTarget(d.user)).catch(() => {});
  }, [tradeWith]);

  // Desafios/trocas em tempo real.
  useEffect(() => {
    if (!socket) return undefined;
    const reload = () => loadHome();
    const onMatch = (msg) => { if (msg?.started && !match) cardsMatch(msg.id).then(setMatch).catch(() => {}); else reload(); };
    socket.on('cards:challenge', reload);
    socket.on('cards:trade', reload);
    socket.on('cards:match', onMatch);
    return () => { socket.off('cards:challenge', reload); socket.off('cards:trade', reload); socket.off('cards:match', onMatch); };
  }, [socket, loadHome, match]);

  const setTab = (k) => setParams(k === 'jogar' ? {} : { aba: k });
  const setWallet = (wallet) => wallet && setHome((h) => (h ? { ...h, wallet } : h));
  const refreshAll = () => { loadHome(); loadCards(); };

  const startMatch = (m) => { setMatch(m); setParams((p) => { const n = new URLSearchParams(p); n.set('partida', m.id); return n; }, { replace: true }); };
  const exitMatch = () => { setMatch(null); setParams((p) => { const n = new URLSearchParams(p); n.delete('partida'); return n; }, { replace: true }); refreshAll(); };

  if (match) {
    return (
      <div className="tcg-page is-battle">
        <Battle key={match.id} initial={match} onExit={exitMatch} onRematch={async (d) => { try { startMatch(await cardsStartPve(d)); } catch (e) { setErr(errMsg(e)); exitMatch(); } }} />
      </div>
    );
  }

  return (
    <div className="tcg-page">
      <div className="tcg-inner">
        <header className="tcg-hero">
          <button type="button" className="tcg-icon-btn" onClick={() => navigate('/minijogos')} aria-label="Voltar para Mini-Jogos"><Icon d={UI.back} /></button>
          <span className="tcg-logo"><Icon d={UI.deck} size={26} /></span>
          <div className="tcg-hero-text">
            <h1>Arena de Cartas</h1>
            <p>Colecione, monte seu baralho e duele contra bots e amigos.</p>
          </div>
          {home && (
            <div className="tcg-hero-stats">
              <span><b>{home.player.wins + home.player.pvpWins}</b> vitórias</span>
              <span><b>{home.player.rating}</b> rating</span>
              <span><b>{home.collection.distinct}</b> cartas únicas</span>
            </div>
          )}
          <Wallet wallet={home?.wallet} />
        </header>

        {err && <p className="tcg-error">{err}</p>}

        {home?.starterAvailable && (
          <div className="tcg-starter">
            <span className="tcg-starter-icon"><Icon d={UI.pack} size={30} /></span>
            <div><strong>Pacote inicial grátis!</strong><p>Ganhe {Math.max(home.rules.deckSize, home.economy?.starterCards || 0)} cartas para montar seu primeiro baralho e começar a jogar.</p></div>
            <button type="button" className="tcg-btn primary" onClick={async () => {
              try { const r = await cardsClaimStarter(); setStarter(r.cards); refreshAll(); } catch (e) { setErr(errMsg(e)); }
            }}>Pegar cartas</button>
          </div>
        )}

        <nav className="tcg-tabs" role="tablist" aria-label="Seções do jogo">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
              <Icon d={t.icon} size={16} />{t.label}
              {t.key === 'trocas' && home?.tradesPending > 0 && <span className="tcg-badge">{home.tradesPending}</span>}
              {t.key === 'jogar' && home?.challenges?.some((c) => c.incoming) && <span className="tcg-badge">!</span>}
            </button>
          ))}
        </nav>

        {!home && !err && <p className="tcg-empty">Carregando…</p>}
        {home && tab === 'jogar' && <PlayTab home={home} me={user} onStartMatch={startMatch} onReload={loadHome} />}
        {home && tab === 'colecao' && <CollectionTab cards={cards} home={home} onChanged={(r) => { setWallet(r?.wallet); refreshAll(); }} />}
        {home && tab === 'loja' && <PacksTab home={home} onOpened={(w) => { setWallet(w); loadCards(); loadHome(); }} />}
        {home && tab === 'baralhos' && <DeckBuilder collection={cards} rules={home.rules} onChanged={loadHome} />}
        {home && tab === 'trocas' && (home.enabled.trades
          ? <Trades me={{ ...user, coins: home.wallet?.coins }} myCollection={cards} maxCoins={home.economy.tradeMaxCoins} onChanged={refreshAll} startWith={tradeTarget} />
          : <p className="tcg-empty">As trocas estão desativadas no momento.</p>)}
        {home && tab === 'ranking' && <RankingTab />}
      </div>
      {starter && (
        <PackOpening pack={{ name: 'Pacote inicial', color: '#7c5cff' }} cards={starter.map((c) => ({ ...c, isNew: true }))} onClose={() => setStarter(null)} />
      )}
    </div>
  );
}

