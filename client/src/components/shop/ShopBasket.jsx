import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkoutBasket } from '../../api/decorations';
import { getMyEconomy } from '../../api/endpoints';
import WalletCard from '../WalletCard.jsx';
import { Ico } from '../PagesKit.jsx';
import '../../styles/shop-store.css';

// Loja de conveniência (nov/2026, pedido do dono): os itens ficam
// pendurados em ganchos; a pessoa arrasta pra cestinha (canto inferior
// direito), abre a cestinha e, no checkout, passa o cartão da carteira
// na maquininha pra confirmar. A compra é uma só, TUDO OU NADA, conferida
// no servidor (POST /decorations/checkout).

const STORE_KEY = 'shopBasket:v1';
const MAX_ITEMS = 20;
const fmt = (n) => Math.floor(Number(n) || 0).toLocaleString('pt-BR');

// ---------- Estado da cestinha (salvo neste navegador) ----------
export function useBasket() {
  const [lines, setLines] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []; } catch { return []; }
  });
  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(lines)); } catch { /* sem storage */ } }, [lines]);
  const key = (kind, id) => `${kind}:${id}`;
  const has = useCallback((item) => lines.some((l) => key(l.kind, l.id) === key(item.kind, item.id)), [lines]);
  const add = useCallback((item, currency) => {
    let added = false;
    setLines((ls) => {
      if (ls.length >= MAX_ITEMS || ls.some((l) => key(l.kind, l.id) === key(item.kind, item.id))) return ls;
      added = true;
      return [...ls, { kind: item.kind, id: item.id, currency }];
    });
    return added;
  }, []);
  const remove = useCallback((kind, id) => setLines((ls) => ls.filter((l) => key(l.kind, l.id) !== key(kind, id))), []);
  const setCurrency = useCallback((kind, id, currency) => setLines((ls) => ls.map((l) => (key(l.kind, l.id) === key(kind, id) ? { ...l, currency } : l))), []);
  const clear = useCallback(() => setLines([]), []);
  return { lines, has, add, remove, setCurrency, clear, setLines, full: lines.length >= MAX_ITEMS };
}

// ---------- Arrastar do gancho pra cestinha ----------
// O próprio pacote sai do gancho (o gancho fica vazio) e vai junto com o
// mouse, balançando conforme a velocidade, como se estivesse pendurado nos
// dedos. Perto da cestinha ele encolhe; soltando em cima dela, cai dentro.
// Soltando fora, volta pro gancho. Mouse: começa depois de mexer 6px.
// Toque: segurar ~0,3s (pra não brigar com a rolagem da página). Um
// clique sem arrastar continua abrindo o item.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const basketEl = () => document.querySelector('.shop-basket-fab');
const basketRect = () => basketEl()?.getBoundingClientRect() || null;

export function useDragToBasket(onDrop) {
  const state = useRef(null);
  const [dragging, setDragging] = useState(false);

  const teardown = (s) => {
    cancelAnimationFrame(s.raf);
    clearTimeout(s.timer);
    window.removeEventListener('pointermove', s.move);
    window.removeEventListener('pointerup', s.up);
    window.removeEventListener('pointercancel', s.cancel);
    basketEl()?.classList.remove('is-target', 'is-over');
  };
  const finish = (s) => {
    s.layer?.remove();
    s.el.classList.remove('is-lifted');
    if (state.current === s) state.current = null;
    setDragging(false);
  };
  useEffect(() => () => { const s = state.current; if (s) { teardown(s); finish(s); } }, []);

  const overBasket = (x, y) => {
    const r = basketRect();
    return !!r && x >= r.left - 24 && x <= r.right + 24 && y >= r.top - 24 && y <= r.bottom + 24;
  };

  // Desenha o pacote: posição do mouse, balanço (mola) e tamanho pela distância da cesta.
  const frame = (s) => {
    const vx = s.px - s.lastX;
    s.lastX = s.px;
    s.target = clamp(-vx * 1.6, -28, 28);                 // inclina pra trás do movimento
    s.vel = (s.vel + (s.target - s.angle) * 0.18) * 0.78;  // mola com amortecimento
    s.angle += s.vel;
    const r = basketRect();
    let scale = 1;
    if (r) {
      const d = Math.hypot(s.px - (r.left + r.width / 2), s.py - (r.top + r.height / 2));
      scale = clamp(0.4 + d / 520, 0.4, 1);                 // encolhe chegando perto da cesta
    }
    s.card.style.left = `${s.px - s.dx}px`;
    s.card.style.top = `${s.py - s.dy}px`;
    s.card.style.transform = `rotate(${s.angle.toFixed(2)}deg) scale(${(scale * 1.03).toFixed(3)})`;
    s.raf = requestAnimationFrame(() => frame(s));
  };

  const start = (s) => {
    const rect = s.el.getBoundingClientRect();
    const ghost = s.el.cloneNode(true);
    ghost.classList.add('shop-drag-ghost');
    s.rect = rect; s.dx = s.x0 - rect.left; s.dy = s.y0 - rect.top;
    Object.assign(ghost.style, {
      width: `${rect.width}px`, height: `${rect.height}px`, left: `${rect.left}px`, top: `${rect.top}px`,
      transformOrigin: `${s.dx}px ${s.dy}px`,
    });
    // Camada própria no <body> com a classe da Loja (cores do tema valem no clone).
    const layer = document.createElement('div');
    layer.className = 'shop-room shop-drag-layer';
    layer.appendChild(ghost);
    document.body.appendChild(layer);
    s.layer = layer; s.card = ghost; s.active = true;
    s.px = s.x0; s.py = s.y0; s.lastX = s.x0; s.angle = 0; s.vel = 0;
    s.el.classList.add('is-lifted'); // o gancho fica vazio
    basketEl()?.classList.add('is-target');
    setDragging(true);
    try { navigator.vibrate?.(12); } catch { /* sem vibração */ }
    s.raf = requestAnimationFrame(() => frame(s));
  };

  // Cai dentro da cesta.
  const dropIn = (s) => {
    const r = basketRect();
    const c = s.card;
    c.style.transition = 'left .26s ease-in, top .26s ease-in, transform .26s ease-in, opacity .26s ease-in';
    if (r) {
      c.style.left = `${r.left + r.width / 2 - s.dx}px`;
      c.style.top = `${r.top + r.height / 2 - s.dy}px`;
    }
    c.style.transform = 'rotate(0deg) scale(.08)';
    c.style.opacity = '0';
    setTimeout(() => finish(s), 270);
  };
  // Volta pro gancho.
  const flyBack = (s) => {
    const c = s.card;
    const rect = s.el.getBoundingClientRect();
    c.style.transition = 'left .34s cubic-bezier(.2,.8,.2,1.15), top .34s cubic-bezier(.2,.8,.2,1.15), transform .34s ease-out';
    c.style.left = `${rect.left}px`;
    c.style.top = `${rect.top}px`;
    c.style.transform = 'rotate(0deg) scale(1)';
    setTimeout(() => finish(s), 360);
  };

  const onPointerDown = (e, item) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('.room-wish, .room-variant, .room-card-foot button')) return;
    if (state.current) return; // ainda terminando a animação anterior
    const el = e.currentTarget;
    const s = { item, el, x0: e.clientX, y0: e.clientY, active: false, touch: e.pointerType === 'touch' };
    s.move = (ev) => {
      if (!s.active) {
        const moved = Math.hypot(ev.clientX - s.x0, ev.clientY - s.y0);
        if (s.touch) { if (moved > 10) { teardown(s); state.current = null; } return; } // rolou a página
        if (moved < 6) return;
        start(s);
      }
      ev.preventDefault();
      s.px = ev.clientX; s.py = ev.clientY;
      basketEl()?.classList.toggle('is-over', overBasket(ev.clientX, ev.clientY));
    };
    s.up = (ev) => {
      teardown(s);
      if (!s.active) { state.current = null; return; }
      // Engole o clique que vem logo depois de soltar (não abre o item).
      const swallow = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 50);
      if (overBasket(ev.clientX, ev.clientY)) { dropIn(s); onDrop(item); } else flyBack(s);
    };
    s.cancel = () => { teardown(s); if (s.active) flyBack(s); else state.current = null; };
    if (s.touch) s.timer = setTimeout(() => start(s), 320);
    window.addEventListener('pointermove', s.move, { passive: false });
    window.addEventListener('pointerup', s.up);
    window.addEventListener('pointercancel', s.cancel);
    state.current = s;
  };
  return { onPointerDown, dragging };
}

// ---------- Botão da cestinha (canto inferior direito) ----------
export function BasketFab({ count, onOpen, bump }) {
  return createPortal(
    <button type="button" className={`shop-basket-fab${bump ? ' bump' : ''}${count ? ' has-items' : ''}`} onClick={onOpen} aria-label={`Cestinha: ${count} ${count === 1 ? 'item' : 'itens'}. Abrir o checkout`} title="Abrir a cestinha">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 10h18l-1.6 9.2a2 2 0 0 1-2 1.8H6.6a2 2 0 0 1-2-1.8z" /><path d="M7.5 10 11 4M16.5 10 13 4" /><path d="M9 14v3M12 14v3M15 14v3" />
      </svg>
      {count > 0 && <span className="shop-basket-count">{count}</span>}
      <span className="shop-basket-drop" aria-hidden="true">Solte aqui</span>
    </button>,
    document.body,
  );
}

// ---------- Checkout com a maquininha ----------
export function CheckoutPage({ basket, items, data, user, priceOf, sellsIn, kindLabel, Preview, onBack, onPaid }) {
  const [card, setCard] = useState(null); // { cardStyle, coins, gems }
  useEffect(() => { getMyEconomy().then(setCard).catch(() => setCard({ cardStyle: 'DEFAULT' })); }, []);
  const [phase, setPhase] = useState('idle'); // idle | paying | approved | declined
  const [message, setMessage] = useState('');
  const [badIndex, setBadIndex] = useState(null);
  // Linha saindo da cesta: encolhe e some antes de sair de verdade.
  const [leaving, setLeaving] = useState(() => new Set());
  const removeRow = (kind, id) => {
    const k = `${kind}:${id}`;
    const quick = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (quick) { basket.remove(kind, id); return; }
    setLeaving((cur) => new Set(cur).add(k));
    setTimeout(() => {
      basket.remove(kind, id);
      setLeaving((cur) => { const n = new Set(cur); n.delete(k); return n; });
    }, 260);
  };

  // Junta as linhas da cesta com os itens atuais da Loja (preço do momento).
  const rows = useMemo(() => basket.lines.map((l) => {
    const item = items.find((i) => i.kind === l.kind && i.id === l.id);
    if (!item) return { line: l, missing: true };
    const options = sellsIn(item);
    const currency = options.includes(l.currency) ? l.currency : options[0];
    const price = currency ? priceOf(item, currency) : null;
    const blocked = item.owned ? 'Você já tem' : item.locked || item.exclusiveTier ? 'Exclusivo' : (item.limited && item.remaining <= 0) ? 'Esgotado' : !price ? 'Indisponível' : null;
    return { line: l, item, options, currency, price, blocked };
  }), [basket.lines, items, priceOf, sellsIn]);

  const valid = rows.filter((r) => !r.missing && !r.blocked);
  const totals = valid.reduce((t, r) => ({ ...t, [r.currency]: t[r.currency] + r.price.final }), { coins: 0, gems: 0 });
  const coins = data?.coins ?? 0;
  const gems = data?.gems ?? 0;
  const short = totals.coins > coins ? 'moedas' : totals.gems > gems ? 'gemas' : null;
  const hasProblem = rows.some((r) => r.missing || r.blocked);
  const ready = valid.length > 0 && !hasProblem && !short && phase !== 'paying' && phase !== 'approved';
  // número e data do cupom (o número muda quando muda o que está na cesta)
  const ticketNo = String(basket.lines.reduce((h, l) => (h * 31 + [...`${l.kind}${l.id}`].reduce((a, c) => a + c.charCodeAt(0), 0)) % 99991, 7)).padStart(5, '0');
  const ticketDate = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const totalText = [totals.coins > 0 && `${fmt(totals.coins)} moedas`, totals.gems > 0 && `${fmt(totals.gems)} gemas`].filter(Boolean).join(' + ') || 'Grátis';

  // Dá pra passar o cartão mesmo sem saldo: a maquininha "consulta" e recusa.
  const canSwipe = valid.length > 0 && !hasProblem && phase !== 'paying' && phase !== 'approved';
  const pay = async () => {
    if (!canSwipe) return;
    if (short) {
      setPhase('paying'); setMessage(''); setBadIndex(null);
      setTimeout(() => { setPhase('declined'); setMessage(`Saldo insuficiente (faltam ${short})`); }, 1400);
      return;
    }
    setPhase('paying'); setMessage(''); setBadIndex(null);
    // a rodinha do "processando" aparece pelo menos um pouquinho, mesmo se a resposta vier na hora
    const t0 = Date.now();
    const hold = () => new Promise((r) => setTimeout(r, Math.max(0, 1300 - (Date.now() - t0))));
    try {
      const r = await checkoutBasket(valid.map((v) => ({ kind: v.item.kind, id: v.item.id, currency: v.currency, expectedPrice: v.price.final })));
      await hold();
      setPhase('approved');
      setTimeout(() => onPaid(r), 2200);
    } catch (e) {
      const b = e?.response?.data || {};
      await hold();
      setPhase('declined');
      setMessage(b.error || 'Não foi possível concluir. Tente de novo.');
      if (Number.isInteger(b.itemIndex)) setBadIndex(valid[b.itemIndex] ? `${valid[b.itemIndex].item.kind}:${valid[b.itemIndex].item.id}` : null);
    }
  };

  const screen = phase === 'paying' ? { tone: 'busy', top: 'PROCESSANDO…', sub: 'Não remova o cartão' }
    : phase === 'approved' ? { tone: 'ok', top: 'PAGAMENTO APROVADO', sub: 'Itens no seu inventário' }
      : phase === 'declined' ? { tone: 'bad', top: 'CARTÃO RECUSADO', sub: message }
        : !valid.length ? { tone: 'idle', top: 'CESTA VAZIA', sub: 'Pegue itens nos ganchos' }
          : hasProblem ? { tone: 'bad', top: 'CONFIRA A CESTA', sub: 'Tire os itens marcados' }
              : { tone: 'idle', top: 'PASSE O CARTÃO', sub: totalText };

  // Etapas de verdade: 1 conferir a cesta, 2 pagar (quando está tudo certo), 3 pronto.
  const step = phase === 'approved' ? 3 : ready || phase === 'paying' ? 2 : 1;
  const STEPS = ['Cesta', 'Pagamento', 'Pronto'];

  return (
    <div className="room-stack shop-checkout">
      <div className="room-page-head">
        <button type="button" className="room-link" onClick={onBack}><Ico name="left" size={14} /> Voltar pra Loja</button>
        <h1>Checkout</h1>
        <p>Confira a cestinha e passe o cartão na maquininha. Se algum item não puder ser comprado, nada é cobrado.</p>
      </div>
      <ol className="shop-steps" aria-label="Etapas do checkout">
        {STEPS.map((label, i) => (
          <li key={label} className="shop-step-wrap" style={{ display: 'contents' }}>
            {i > 0 && <span className={`shop-step-line${step > i ? ' done' : ''}`} aria-hidden="true" />}
            <span className={`shop-step${step === i + 1 ? ' on' : ''}${step > i + 1 ? ' done' : ''}`} aria-current={step === i + 1 ? 'step' : undefined}>
              <i>{step > i + 1 ? <Ico name="check" size={13} strokeWidth={2.6} /> : i + 1}</i><span>{label}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="shop-checkout-grid">
        <section className="shop-receipt" aria-label="Itens da cestinha">
          {/* Cupom da cestinha: folha de recibo de papel (bordas picotadas,
              letra de impressora, total e código de barras no pé). */}
          <header className="shop-ticket-head" aria-hidden="true">
            <strong>PROJECT CLUB</strong>
            <span>LOJA · CUPOM Nº {ticketNo}</span>
            <span>{ticketDate}</span>
          </header>
          <h2>Sua cestinha <small>{basket.lines.length} {basket.lines.length === 1 ? 'item' : 'itens'}</small></h2>
          {rows.length === 0 && (
            <div className="shop-empty-basket">
              <span>Sua cestinha está vazia. Arraste itens dos ganchos pra cá ou toque em "Pôr na cesta".</span>
              <button type="button" className="room-btn primary" onClick={onBack}><Ico name="bag" size={15} /> Ver os itens da Loja</button>
            </div>
          )}
          <ul>
            {rows.map((r, idx) => {
              const k = `${r.line.kind}:${r.line.id}`;
              return (
                <li key={k} style={{ '--i': idx }} className={`shop-receipt-row${r.missing || r.blocked || badIndex === k ? ' is-bad' : ''}${leaving.has(k) ? ' is-leaving' : ''}`}>
                  <span className="shop-receipt-art">{r.item ? <Preview item={r.item} user={user} mode="mini" /> : <Ico name="close" size={18} />}</span>
                  <span className="shop-receipt-text">
                    <strong className="truncate">{r.item?.name || 'Item que saiu da Loja'}</strong>
                    <small>{r.item ? kindLabel(r.item.kind) : 'Não está mais à venda'}{r.blocked ? ` · ${r.blocked}` : ''}</small>
                  </span>
                  {r.options?.length > 1 && !r.blocked && (
                    <span className="shop-receipt-cur" role="group" aria-label="Pagar com">
                      {r.options.map((c) => (
                        <button key={c} type="button" className={r.currency === c ? 'on' : ''} aria-pressed={r.currency === c} disabled={phase === 'paying'} onClick={() => basket.setCurrency(r.line.kind, r.line.id, c)}>
                          <Ico name={c === 'gems' ? 'gem' : 'coin'} size={13} /> {fmt(priceOf(r.item, c).final)}
                        </button>
                      ))}
                    </span>
                  )}
                  {r.price && !r.blocked && r.options.length === 1 && (
                    <span className={`shop-receipt-price ${r.currency}`}><Ico name={r.currency === 'gems' ? 'gem' : 'coin'} size={14} /> {r.price.final === 0 ? 'Grátis' : fmt(r.price.final)}</span>
                  )}
                  {(!r.price || r.blocked) && <span />}
                  <button type="button" className="shop-receipt-x" aria-label={`Tirar ${r.item?.name || 'item'} da cestinha`} title="Tirar da cestinha" disabled={phase === 'paying' || leaving.has(k)} onClick={() => removeRow(r.line.kind, r.line.id)}><Ico name="close" size={15} /></button>
                </li>
              );
            })}
          </ul>
          {rows.length > 0 && (
            <div className="shop-ticket-sum">
              <div><span>{valid.length} {valid.length === 1 ? 'item' : 'itens'}</span><span>{totals.coins > 0 ? `${fmt(totals.coins)} moedas` : '—'}</span></div>
              {totals.gems > 0 && <div><span>Em gemas</span><span>{fmt(totals.gems)} gemas</span></div>}
              <div className="shop-ticket-total"><span>TOTAL</span><span key={totalText}>{totalText}</span></div>
              <div className="shop-ticket-bars" aria-hidden="true" />
              <p className="shop-ticket-thanks">Obrigado pela preferência!</p>
            </div>
          )}
          {basket.lines.length > 0 && (
            <div className="shop-receipt-foot">
              <button type="button" className="room-btn sm ghost" onClick={onBack}><Ico name="plus" size={14} /> Pôr mais itens</button>
              <button type="button" className="room-btn sm ghost" disabled={phase === 'paying'} onClick={basket.clear}>Esvaziar a cestinha</button>
            </div>
          )}
        </section>

        <section className="shop-pos-area" aria-label="Resumo e pagamento">
          <div className={`shop-pay${ready ? ' is-ready' : ''}${phase === 'approved' ? ' is-approved' : ''}`} aria-label="Maquininha">
            <CardSwipe
              user={user} variant={card?.cardStyle || 'DEFAULT'} coins={data?.coins} gems={data?.gems}
              disabled={!canSwipe && phase !== 'declined'} phase={phase} screen={screen} onSwipe={pay} onRetry={() => setPhase('idle')}
            />
          </div>
          <div className="shop-summary">
            <div className="shop-summary-line"><span>Seu saldo</span><b><Ico name="coin" size={13} /> {fmt(coins)} · <Ico name="gem" size={13} /> {fmt(gems)}</b></div>
            <div className="shop-summary-line shop-receipt-after"><span>Saldo depois</span><b><Ico name="coin" size={13} /> {fmt(Math.max(0, coins - totals.coins))} · <Ico name="gem" size={13} /> {fmt(Math.max(0, gems - totals.gems))}</b></div>
            <div className="shop-receipt-total">
              <span>Total</span>
              <strong key={totalText}>{totalText}</strong>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// A maquininha: arraste o cartão pela fenda (pra direita) até o fim do
// trilho. Soltou antes = volta. Teclado/sem arrastar: botão "Passar cartão".
// Maquininha de cartão (estilo Gertec): tela com a marca ClubPay, teclado de
// verdade, fenda do chip embaixo e fenda da tarja na lateral. O cartão fica
// embaixo: arraste até a maquininha — em cima da tela é por APROXIMAÇÃO, na
// lateral direita é PASSAR NA TARJA e na fenda de baixo é INSERIR O CHIP. Cada
// jeito tem a animação dele. Os botões fazem o mesmo sem arrastar.
const POS_W = 300;
const POS_H = 560;
const TERM = { x: 45, y: 0, w: 210, h: 380 };
const CARD = { w: 168, h: 106, x: 66, y: 432 };
const KEYS = [['1', 'QZ'], ['2', 'ABC'], ['3', 'DEF'], ['pw', ''], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['x', 'CANCEL'], ['7', 'PRS'], ['8', 'TUV'], ['9', 'WXY'], ['c', 'CLEAR'], ['up', ''], ['0', '#@'], ['dn', ''], ['ok', 'ENTER']];

function ClubPayMark({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <defs><linearGradient id="cp-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6ab0ff" /><stop offset="1" stopColor="#2f6fe6" /></linearGradient></defs>
      <rect x="1" y="1" width="22" height="22" rx="7" fill="url(#cp-g)" />
      <path d="M15.6 8.4a5 5 0 1 0 0 7.2" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="16.6" cy="12" r="1.6" fill="#fff" />
    </svg>
  );
}

function CardSwipe({ user, variant, coins, gems, disabled, phase, screen, onSwipe, onRetry }) {
  const stageRef = useRef(null);
  const [pos, setPos] = useState({ x: CARD.x, y: CARD.y });
  const [drag, setDrag] = useState(null);
  const [mode, setMode] = useState(null);        // tap | insert | swipe (animação em curso/feita)
  const [hover, setHover] = useState(null);      // zona embaixo do cartão enquanto arrasta
  const done = phase === 'paying' || phase === 'approved';
  // recusado: o cartão volta pra baixo depois de um tempinho, pronto pra tentar de novo
  useEffect(() => {
    if (phase === 'idle') { setMode(null); setPos({ x: CARD.x, y: CARD.y }); }
    if (phase === 'declined') { const t = setTimeout(() => { setMode(null); setPos({ x: CARD.x, y: CARD.y }); }, 1600); return () => clearTimeout(t); }
    return undefined;
  }, [phase]);

  // Ao soltar: em qual área o cartão ficou MAIS em cima (a que cobre mais)?
  // Tela = aproximação · fenda de baixo = chip · lateral direita = tarja.
  const ZONES = {
    tap: { x: TERM.x + 10, y: 40, w: TERM.w - 20, h: 160 },
    insert: { x: TERM.x + 6, y: TERM.h - 45, w: TERM.w - 12, h: 100 },
    swipe: { x: TERM.x + TERM.w - 28, y: 80, w: 110, h: 230 },
  };
  const zoneAt = (x, y) => {
    let best = null;
    let most = CARD.w * CARD.h * 0.12;      // precisa cobrir pelo menos um pedacinho
    for (const [name, z] of Object.entries(ZONES)) {
      const ox = Math.max(0, Math.min(x + CARD.w, z.x + z.w) - Math.max(x, z.x));
      const oy = Math.max(0, Math.min(y + CARD.h, z.y + z.h) - Math.max(y, z.y));
      if (ox * oy > most) { most = ox * oy; best = name; }
    }
    return best;
  };
  const scale = () => { const r = stageRef.current?.getBoundingClientRect(); return r ? r.width / POS_W : 1; };
  const pay = (how) => {
    if (disabled || done || mode) return;
    if (phase === 'declined') onRetry?.();
    setDrag(null); setHover(null);
    setMode(how);
    setTimeout(() => onSwipe(), how === 'swipe' ? 900 : 1100);
  };
  const down = (e) => {
    if (disabled || done || mode) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ px: e.clientX, py: e.clientY, x: pos.x, y: pos.y, k: scale() });
  };
  const move = (e) => {
    if (!drag) return;
    const x = drag.x + (e.clientX - drag.px) / drag.k;
    const y = drag.y + (e.clientY - drag.py) / drag.k;
    setPos({ x, y });
    setHover(zoneAt(x, y));
  };
  const up = () => {
    if (!drag) return;
    const z = zoneAt(pos.x, pos.y);
    setDrag(null); setHover(null);
    if (z) pay(z); else setPos({ x: CARD.x, y: CARD.y });
  };
  const idle = screen.tone === 'idle';

  return (
    <div className={`shop-pos ${screen.tone}${disabled && !done ? ' is-off' : ''}`}>
      <div className="pos-stage" ref={stageRef}>
        <div className={`pos-term${hover ? ` hot-${hover}` : ''}${mode ? ` m-${mode}` : ''}`} aria-live="polite">
          <span className="pos-printer" aria-hidden="true"><i /></span>
          <span className="pos-brandline" aria-hidden="true">ClubPay</span>
          <div className="shop-pos-screen pos-screen">
            <span className="pos-screen-top" aria-hidden="true"><ClubPayMark size={16} /> ClubPay <svg className="pos-nfc" viewBox="0 0 24 24" width="14" height="14"><path d="M8 7c2.5 3 2.5 7 0 10M12 5c3.6 4.2 3.6 9.8 0 14M16 3c4.6 5.4 4.6 12.6 0 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></span>
            {screen.tone === 'busy' && <span className="pos-spinner" aria-hidden="true" />}
            {screen.tone === 'ok' && <span className="pos-badge ok" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30"><path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>}
            {screen.tone === 'bad' && phase === 'declined' && <span className="pos-badge bad" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></span>}
            <strong>{screen.top}</strong>
            <span>{screen.sub}</span>
            {idle && !disabled && <small className="pos-how">Aproxime · Insira · Passe</small>}
            <span className="pos-waves" aria-hidden="true"><i /><i /><i /></span>
          </div>
          <div className="pos-keys" aria-hidden="true">
            {KEYS.map(([k, sub]) => (
              <span key={k} className={`pos-key k-${k}`}>
                {k === 'pw' ? <svg viewBox="0 0 16 16" width="11" height="11"><path d="M8 2v6M4.5 4.5a5 5 0 1 0 7 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                  : k === 'up' ? '⌃' : k === 'dn' ? '⌄' : ['x', 'c', 'ok'].includes(k) ? null : <b>{k}</b>}
                {sub && <small>{sub}</small>}
              </span>
            ))}
          </div>
          <span className="pos-side-slot" aria-hidden="true" />
          <span className="pos-chip-slot" aria-hidden="true" />
        </div>
        <div
          className={`shop-pos-card pos-card${drag ? ' is-dragging' : ''}${disabled && !done ? ' is-disabled' : ''}${mode ? ` a-${mode}` : ''}${mode === 'tap' && phase !== 'idle' ? ' is-back' : ''}`}
          style={mode ? undefined : { transform: `translate(${pos.x}px, ${pos.y}px)` }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          role="button" tabIndex={disabled || done ? -1 : 0} aria-label="Cartão: arraste até a maquininha. No teclado: Enter aproxima, seta pra baixo insere o chip, seta pra direita passa na tarja"
          onKeyDown={(e) => { const k = { Enter: 'tap', ' ': 'tap', ArrowDown: 'insert', ArrowRight: 'swipe' }[e.key]; if (k) { e.preventDefault(); pay(k); } }}
        >
          <div className="pos-card-in"><WalletCard user={user} coins={coins} gems={gems} variant={variant} compact hint={false} /></div>
        </div>
        {!disabled && !done && !mode && <span className="pos-tip" aria-hidden="true">Arraste o cartão até a maquininha</span>}
      </div>
    </div>
  );
}
