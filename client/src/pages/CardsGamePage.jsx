import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { Icon, UI } from '../cards/CardView.jsx';
import Battle from '../cards/Battle.jsx';
import PackOpening from '../cards/PackOpening.jsx';
import PacksTab from '../cards/PacksShop.jsx';
import DeckBuilder from '../cards/DeckBuilder.jsx';
import Trades from '../cards/Trades.jsx';
import ArenaHome from '../cards/ArenaHome.jsx';
import Collection from '../cards/Collection.jsx';
import Market from '../cards/Market.jsx';
import Tournaments from '../cards/Tournaments.jsx';
import WelcomeModal from '../cards/WelcomeModal.jsx';
import {
  cardsHome, cardsClaimStarter, cardsCollection, cardsStartPve, cardsMatch, cardsChallenge, cardsRanking,
  cardsUserCollection, cardsWatch, cardsReplay, errMsg,
} from '../cards/api';
import '../styles/cards.css';

// Arena de Cartas — jogo de cartas colecionáveis do Project Club (substitui
// as Figurinhas). Jogo principal da seção Mini-Jogos.
const TABS = [
  { key: 'jogar', label: 'Início', icon: UI.sword },
  { key: 'colecao', label: 'Coleção', icon: UI.deck },
  { key: 'loja', label: 'Pacotes', icon: UI.pack },
  { key: 'baralhos', label: 'Baralhos', icon: UI.list },
  { key: 'mercado', label: 'Mercado', icon: UI.coin },
  { key: 'trocas', label: 'Trocas', icon: UI.swap },
  { key: 'torneios', label: 'Torneios', icon: UI.trophy },
  { key: 'ranking', label: 'Ranking', icon: UI.star },
];

function Wallet({ wallet }) {
  return (
    <div className="tcg-wallet">
      <span title="Moedas"><Icon d={UI.coin} size={16} />{(wallet?.coins ?? 0).toLocaleString('pt-BR')}</span>
      <span title="Gemas" className="is-gem"><Icon d={UI.gem} size={16} />{(wallet?.gems ?? 0).toLocaleString('pt-BR')}</span>
    </div>
  );
}

function RankingTab({ divisions }) {
  const [by, setBy] = useState('season');
  const [data, setData] = useState(null);
  useEffect(() => { setData(null); cardsRanking(by).then(setData).catch(() => setData({ players: [] })); }, [by]);
  return (
    <div>
      <div className="tcg-chips">
        <button type="button" className={by === 'season' ? 'on' : ''} onClick={() => setBy('season')}>Temporada</button>
        <button type="button" className={by === 'rating' ? 'on' : ''} onClick={() => setBy('rating')}>PvP geral</button>
        <button type="button" className={by === 'wins' ? 'on' : ''} onClick={() => setBy('wins')}>Vitórias contra bots</button>
      </div>
      {by === 'season' && (
        <div className="tcg-divs">
          {divisions.map((d) => <span key={d.key} style={{ '--c': d.color }}><i />{d.label} <small>{d.min}+</small></span>)}
        </div>
      )}
      <div className="tcg-rank">
        {data === null && <p className="tcg-empty">Carregando…</p>}
        {data?.players.map((r) => (
          <div key={r.user.id} className={`tcg-rank-row${r.rank <= 3 ? ` is-top${r.rank}` : ''}`}>
            <span className="tcg-rank-n">{r.rank}</span>
            <UserAvatar user={r.user} size={32} />
            <span className="tcg-rank-name" data-no-translate>{r.user.displayName}</span>
            {by === 'season' && <span className="tcg-rank-div" style={{ '--c': r.division?.color }}>{r.division?.label}</span>}
            {by === 'season' ? <><b>{r.seasonRating}</b><small>{r.seasonWins}V · {r.seasonLosses}D</small></>
              : by === 'rating' ? <><b>{r.rating}</b><small>{r.pvpWins}V · {r.pvpLosses}D</small></>
                : <><b>{r.wins}</b><small>vitórias</small></>}
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
  const [match, setMatch] = useState(null); // { data, mode, frames }
  const [err, setErr] = useState('');
  const [starter, setStarter] = useState(null);
  // Boas-vindas: abre sozinho no primeiro acesso (enquanto o pacote não foi pego).
  const [welcome, setWelcome] = useState(false);
  useEffect(() => {
    let later = false;
    try { later = sessionStorage.getItem('pc-cards-welcome') === '1'; } catch { /* ignora */ }
    if (home?.starterAvailable && !later) setWelcome(true);
  }, [home?.starterAvailable]);
  const tradeWith = params.get('trocar');
  const [tradeTarget, setTradeTarget] = useState(null);
  const openCard = params.get('carta');

  const loadHome = useCallback(() => cardsHome().then((h) => { setHome(h); return h; }).catch((e) => setErr(errMsg(e, 'Não foi possível abrir o Jogo de Cartas.'))), []);
  const loadCards = useCallback(() => cardsCollection().then((d) => setCards(d.cards)).catch(() => {}), []);
  useEffect(() => { loadHome(); loadCards(); }, [loadHome, loadCards]);

  const setParam = (k, v) => setParams((p) => { const n = new URLSearchParams(p); if (v === null || v === undefined) n.delete(k); else n.set(k, v); return n; }, { replace: true });

  // Link compartilhado de carta (?carta=) abre na Coleção.
  useEffect(() => {
    if (openCard && tab !== 'colecao') setParams((p) => { const n = new URLSearchParams(p); n.set('aba', 'colecao'); return n; }, { replace: true });
  }, [openCard, tab, setParams]);

  // Abre partida/assistir/replay pela URL (links de avisos e do chat).
  useEffect(() => {
    const id = params.get('partida');
    const w = params.get('assistir');
    const r = params.get('replay');
    if (id && match?.data?.id !== id) cardsMatch(id).then((m) => setMatch({ data: m, mode: 'play' })).catch((e) => { setErr(errMsg(e)); setParam('partida', null); });
    else if (w && match?.data?.id !== w) cardsWatch(w).then((m) => setMatch({ data: m, mode: 'watch' })).catch((e) => { setErr(errMsg(e)); setParam('assistir', null); });
    else if (r && match?.data?.id !== r) {
      cardsReplay(r).then((d) => setMatch({ data: { id: d.id, mode: d.mode, boardId: d.boardId, view: d.frames[0].view }, mode: 'replay', frames: d.frames })).catch((e) => { setErr(errMsg(e)); setParam('replay', null); });
    }
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?desafiar=userId / ?trocar=userId (vindo do perfil)
  useEffect(() => {
    const id = params.get('desafiar');
    if (!id) return;
    cardsChallenge(id).then(() => { setErr(''); loadHome(); }).catch((e) => setErr(errMsg(e)));
    setParam('desafiar', null);
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!tradeWith) return;
    cardsUserCollection(tradeWith).then((d) => setTradeTarget(d.user)).catch(() => {});
  }, [tradeWith]);

  // Desafios/trocas/mercado em tempo real.
  useEffect(() => {
    if (!socket) return undefined;
    const reload = () => loadHome();
    const onMatch = (msg) => {
      if (msg?.started && !match) setParam('partida', msg.id);
      else reload();
    };
    const onMarket = () => { reload(); loadCards(); };
    socket.on('cards:challenge', reload);
    socket.on('cards:trade', reload);
    socket.on('cards:match', onMatch);
    socket.on('cards:market', onMarket);
    return () => { socket.off('cards:challenge', reload); socket.off('cards:trade', reload); socket.off('cards:match', onMatch); socket.off('cards:market', onMarket); };
  }, [socket, loadHome, loadCards, match]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTab = (k) => setParams(k === 'jogar' ? {} : { aba: k });
  const setWallet = (wallet) => wallet && setHome((h) => (h ? { ...h, wallet } : h));
  const refreshAll = () => { loadHome(); loadCards(); };

  const startMatch = (m) => { setMatch({ data: m, mode: 'play' }); setParams((p) => { const n = new URLSearchParams(p); n.set('partida', m.id); n.delete('assistir'); n.delete('replay'); return n; }, { replace: true }); };
  const exitMatch = (opts) => {
    setMatch(null);
    setParams((p) => { const n = new URLSearchParams(p); n.delete('partida'); n.delete('assistir'); n.delete('replay'); if (opts?.replay) n.set('replay', opts.replay); return n; }, { replace: true });
    refreshAll();
  };

  if (match) {
    return (
      <div className="tcg-page is-battle">
        <Battle
          key={`${match.mode}-${match.data.id}`} initial={match.data} mode={match.mode} frames={match.frames} boards={home?.boards || []}
          onExit={exitMatch}
          onRematch={async (d) => { try { startMatch(await cardsStartPve(d)); } catch (e) { setErr(errMsg(e)); exitMatch(); } }}
        />
      </div>
    );
  }

  return (
    <div className="tcg-page">
      <div className="tcg-inner">
        <header className="tcg-hero">
          <button type="button" className="tcg-icon-btn" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/inicio'))} aria-label="Voltar"><Icon d={UI.back} /></button>
          <span className="tcg-logo"><Icon d={UI.deck} size={26} /></span>
          <div className="tcg-hero-text">
            <h1>Arena de Cartas</h1>
            <p>Colecione, monte seu baralho e duele contra bots e amigos.</p>
          </div>
          <Wallet wallet={home?.wallet} />
        </header>

        {err && <p className="tcg-error">{err}</p>}

        {home?.starterAvailable && !welcome && (
          <div className="tcg-starter">
            <span className="tcg-starter-icon"><Icon d={UI.pack} size={30} /></span>
            <div><strong>Seu pacote de boas-vindas está esperando!</strong><p>Ganhe {home.starterCount || home.rules.deckSize} cartas comuns e comece a batalhar agora.</p></div>
            <button type="button" className="tcg-btn primary" onClick={() => setWelcome(true)}>Pegar cartas</button>
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
        {home && tab === 'jogar' && <ArenaHome home={home} me={user} cards={cards} onStartMatch={startMatch} onReload={loadHome} onWatch={(id) => setParam('assistir', id)} onReplay={(id) => setParam('replay', id)} />}
        {home && tab === 'colecao' && <Collection cards={cards} home={home} onChanged={(r) => { setWallet(r?.wallet); refreshAll(); }} openId={openCard} onOpenChange={(id) => setParam('carta', id)} />}
        {home && tab === 'loja' && <PacksTab home={home} onOpened={(w) => { setWallet(w); loadCards(); loadHome(); }} />}
        {home && tab === 'baralhos' && <DeckBuilder collection={cards} rules={home.rules} onChanged={loadHome} />}
        {home && tab === 'mercado' && <Market me={user} wallet={home.wallet} onWallet={setWallet} onChanged={refreshAll} />}
        {home && tab === 'trocas' && (home.enabled.trades
          ? <Trades me={{ ...user, coins: home.wallet?.coins }} myCollection={cards} maxCoins={home.economy.tradeMaxCoins} onChanged={refreshAll} startWith={tradeTarget} />
          : <p className="tcg-empty">As trocas estão desativadas no momento.</p>)}
        {home && tab === 'torneios' && <Tournaments me={user} onWatch={(id) => setParam('assistir', id)} onReload={loadHome} />}
        {home && tab === 'ranking' && <RankingTab divisions={home.meta.divisions} />}
      </div>
      {welcome && home?.starterAvailable && (
        <WelcomeModal
          home={home} user={user} cards={cards}
          onClaim={async () => { const r = await cardsClaimStarter(); setWelcome(false); setStarter(r.cards); refreshAll(); }}
          onLater={() => { setWelcome(false); try { sessionStorage.setItem('pc-cards-welcome', '1'); } catch { /* ignora */ } }}
        />
      )}
      {starter && (
        <PackOpening
          pack={{ name: 'Pacote de boas-vindas', color: '#7c5cff' }} cards={starter.map((c) => ({ ...c, isNew: true }))}
          onClose={() => setStarter(null)}
          extraAction={{ label: 'Batalhar agora!', onClick: async () => { setStarter(null); try { startMatch(await cardsStartPve('FACIL')); } catch (e) { setErr(errMsg(e)); } } }}
        />
      )}
    </div>
  );
}
