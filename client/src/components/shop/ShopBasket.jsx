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
  const totalText = [totals.coins > 0 && `${fmt(totals.coins)} moedas`, totals.gems > 0 && `${fmt(totals.gems)} gemas`].filter(Boolean).join(' + ') || 'Grátis';

  const pay = async () => {
    if (!ready) return;
    setPhase('paying'); setMessage(''); setBadIndex(null);
    try {
      const r = await checkoutBasket(valid.map((v) => ({ kind: v.item.kind, id: v.item.id, currency: v.currency, expectedPrice: v.price.final })));
      setPhase('approved');
      setTimeout(() => onPaid(r), 1300);
    } catch (e) {
      const b = e?.response?.data || {};
      setPhase('declined');
      setMessage(b.error || 'Não foi possível concluir. Tente de novo.');
      if (Number.isInteger(b.itemIndex)) setBadIndex(valid[b.itemIndex] ? `${valid[b.itemIndex].item.kind}:${valid[b.itemIndex].item.id}` : null);
    }
  };

  const screen = phase === 'paying' ? { tone: 'busy', top: 'PROCESSANDO…', sub: totalText }
    : phase === 'approved' ? { tone: 'ok', top: 'APROVADO ✓', sub: 'Itens no seu inventário' }
      : phase === 'declined' ? { tone: 'bad', top: 'RECUSADO', sub: message }
        : !valid.length ? { tone: 'idle', top: 'CESTA VAZIA', sub: 'Pegue itens nos ganchos' }
          : hasProblem ? { tone: 'bad', top: 'CONFIRA A CESTA', sub: 'Tire os itens marcados' }
            : short ? { tone: 'bad', top: 'SALDO INSUFICIENTE', sub: `Faltam ${short}` }
              : { tone: 'idle', top: 'PASSE O CARTÃO', sub: totalText };

  // Etapas de verdade: 1 conferir a cesta, 2 pagar (quando está tudo certo), 3 pronto.
  const step = phase === 'approved' ? 3 : ready || phase === 'paying' ? 2 : 1;
  const STEPS = ['Cesta', 'Pagamento', 'Pronto'];

  return (
    <div className="room-stack shop-checkout">
      <div className="room-page-head">
        <button type="button" className="room-link" onClick={onBack}><Ico name="left" size={14} /> Voltar pra Loja</button>
        <h1>Checkout</h1>
        <p>Confira os itens da sua cestinha e passe o seu cartão na maquininha pra pagar. É tudo ou nada: se algum item não puder ser comprado, nada é cobrado.</p>
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
          {basket.lines.length > 0 && (
            <div className="shop-receipt-foot">
              <button type="button" className="room-btn sm ghost" onClick={onBack}><Ico name="plus" size={14} /> Pôr mais itens</button>
              <button type="button" className="room-btn sm ghost" disabled={phase === 'paying'} onClick={basket.clear}>Esvaziar a cestinha</button>
            </div>
          )}
        </section>

        <section className="shop-pos-area" aria-label="Resumo e pagamento">
          <div className="shop-summary">
            <div className="shop-summary-line"><span>Seu saldo</span><b><Ico name="coin" size={13} /> {fmt(coins)} · <Ico name="gem" size={13} /> {fmt(gems)}</b></div>
            <div className="shop-summary-line shop-receipt-after"><span>Saldo depois</span><b><Ico name="coin" size={13} /> {fmt(Math.max(0, coins - totals.coins))} · <Ico name="gem" size={13} /> {fmt(Math.max(0, gems - totals.gems))}</b></div>
            <div className="shop-receipt-total">
              <span>Total</span>
              <strong key={totalText}>{totalText}</strong>
            </div>
          </div>
          <div className={`shop-pay${ready ? ' is-ready' : ''}${phase === 'approved' ? ' is-approved' : ''}`} aria-label="Maquininha">
            <CardSwipe
              user={user} variant={card?.cardStyle || 'DEFAULT'} coins={data?.coins} gems={data?.gems}
              disabled={!ready} phase={phase} screen={screen} onSwipe={pay}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

// A maquininha: arraste o cartão pela fenda (pra direita) até o fim do
// trilho. Soltou antes = volta. Teclado/sem arrastar: botão "Passar cartão".
function CardSwipe({ user, variant, coins, gems, disabled, phase, screen, onSwipe }) {
  const trackRef = useRef(null);
  const [x, setX] = useState(0);
  const [drag, setDrag] = useState(null);
  const max = () => Math.max(1, (trackRef.current?.clientWidth || 300) - 120);
  const done = phase === 'paying' || phase === 'approved';
  useEffect(() => { if (phase === 'declined' || phase === 'idle') setX(0); }, [phase]);
  useEffect(() => { if (done) setX(max()); }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const down = (e) => {
    if (disabled || done) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ x0: e.clientX, base: x });
  };
  const move = (e) => { if (drag) setX(Math.min(max(), Math.max(0, drag.base + e.clientX - drag.x0))); };
  const up = () => {
    if (!drag) return;
    setDrag(null);
    if (x >= max() * 0.82) { setX(max()); onSwipe(); } else setX(0);
  };
  const pct = Math.round((x / max()) * 100);

  return (
    <div className={`shop-pos ${screen.tone}`}>
      <div className="shop-pos-machine" aria-live="polite">
        <div className="shop-pos-screen">
          <strong>{screen.top}</strong>
          <span>{screen.sub}</span>
        </div>
        <div className="shop-pos-keys" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <span key={i} />)}</div>
        <span className="shop-pos-brand" aria-hidden="true">ClubPay</span>
      </div>
      <div className="shop-pos-track" ref={trackRef}>
        <span className="shop-pos-slot" aria-hidden="true" />
        <span className="shop-pos-arrow" aria-hidden="true" style={{ opacity: disabled || done ? 0 : 1 - pct / 100 }}>
          Arraste o cartão pela fenda <Ico name="arrowRight" size={14} />
        </span>
        <div
          className={`shop-pos-card${drag ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`}
          style={{ transform: `translateX(${x}px)` }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          aria-hidden="true"
        >
          <WalletCard user={user} coins={coins} gems={gems} variant={variant} compact hint={false} />
        </div>
      </div>
      <button type="button" className="room-btn primary shop-pos-btn" disabled={disabled || done} onClick={() => { setX(max()); onSwipe(); }}>
        <Ico name="check" size={15} /> Passar cartão
      </button>
    </div>
  );
}
