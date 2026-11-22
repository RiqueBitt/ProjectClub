import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import UserAvatar from './UserAvatar.jsx';
import { Ico } from './PagesKit.jsx';
import '../styles/wallet-card.css';

// Cartão da carteira (aba Economia — pedido do dono): um cartão "de banco"
// em 3D com a foto da pessoa, moedas e gemas. A bandeira "ClubPay" é fictícia.
//
// Como objeto: tem espessura de verdade (frente, verso e a borda entre os
// dois), luz que muda conforme ele gira e sombra no chão. Clicar (ou
// Enter/Espaço) vira; arrastar gira com inércia e ele assenta sozinho na
// face mais próxima; com o mouse por cima, inclina de leve na direção dele.
//
// Tudo dentro do cartão é medido em "u" (1% da largura dele — ver
// wallet-card.css), então ele pode ter qualquer tamanho sem desalinhar.
// Estilos (`variant`): DEFAULT (azul), GOLD (preto e dourado, Assinante) e
// RAINBOW (preto e arco-íris, Super Assinante) — ver server/services/walletCard.js.
// `compact`: versão menor, usada no chat ("Mostrar cartão") e na Loja.
// Nada aqui mexe em saldo: só mostra o que vem de /economy.

function fmt(n) { return Math.floor(Number(n) || 0).toLocaleString('pt-BR'); }

// Número de enfeite, sempre o mesmo pra mesma pessoa (não é número de nada).
function fakeNumber(seed) {
  let h = 2166136261;
  for (const ch of String(seed || 'project-club')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return String(h % 10000).padStart(4, '0');
}

// "03/24" a partir da data de criação da conta (se vier).
function memberSince(createdAt) {
  const d = createdAt ? new Date(createdAt) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`;
}

// Floco de neve da bandeira (traço). Usado no selo, na marca d'água e no holograma.
const FLAKE = 'M12 2.5v19M3.8 7.25l16.4 9.5M20.2 7.25 3.8 16.75M9.6 4.3 12 6.2l2.4-1.9M9.6 19.7l2.4-1.9 2.4 1.9M4.2 10.6l2.85-1.1-.45-3M19.8 13.4l-2.85 1.1.45 3M19.8 10.6l-2.85-1.1.45-3M4.2 13.4l2.85 1.1-.45 3';

function Flake({ className, strokeWidth = 1.5 }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={FLAKE} />
    </svg>
  );
}

// Bandeira fictícia: floco de neve num losango + "ClubPay".
function ClubPayMark() {
  return (
    <span className="wcard-brand" aria-label="Bandeira ClubPay (fictícia)">
      <span className="wcard-brand-gem" aria-hidden="true"><Flake strokeWidth={1.9} /></span>
      <span className="wcard-brand-name">Club<b>Pay</b></span>
    </span>
  );
}

// Molas do giro (graus e graus por segundo).
const STIFFNESS = 150;
const DAMPING = 17;
const MAX_SPIN = 1500;
const DRAG_DEG_PER_PX = 0.6;
const REST_GLARE = { x: 26, y: 18 };

const VARIANTS = { DEFAULT: '', GOLD: ' wcard--gold', RAINBOW: ' wcard--rainbow' };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const prefersReduced = () => typeof window !== 'undefined'
  && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.classList.contains('reduced-motion-pref')
    || document.documentElement.hasAttribute('data-lite'));

export default function WalletCard({ user, coins, gems, level, variant = 'DEFAULT', compact = false, hint = true }) {
  const [back, setBack] = useState(false);       // qual face está (ou vai ficar) virada pra frente
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false); // some com a dica depois da primeira mexida
  const rootRef = useRef(null);
  const sceneRef = useRef(null); // guarda as variáveis de luz/giro (o cartão e a sombra leem daqui)
  const raf = useRef(0);
  // Estado físico fora do React: muda a cada quadro e vai direto pro CSS.
  const phys = useRef({
    angle: 0, vel: 0, target: 0, t: 0,
    tx: 0, ty: 0, wantTx: 0, wantTy: 0,
    gx: REST_GLARE.x, gy: REST_GLARE.y, wantGx: REST_GLARE.x, wantGy: REST_GLARE.y,
    drag: null,
  });

  const paint = useCallback(() => {
    const el = sceneRef.current;
    if (!el) return;
    const p = phys.current;
    const theta = p.angle + p.ty;
    const rad = (theta * Math.PI) / 180;
    // A luz vem da esquerda e de cima: cada face escurece ao virar pra longe dela.
    const lit = (deg) => Math.max(0, Math.cos(((deg - 22) * Math.PI) / 180));
    const s = el.style;
    s.setProperty('--ry', `${theta.toFixed(2)}deg`);
    s.setProperty('--rx', `${p.tx.toFixed(2)}deg`);
    s.setProperty('--gx', `${clamp(p.gx + Math.sin(rad) * 62, -45, 145).toFixed(1)}%`);
    s.setProperty('--gy', `${clamp(p.gy - p.tx * 2.4, -30, 130).toFixed(1)}%`);
    s.setProperty('--shade-front', (0.3 * (1 - lit(theta))).toFixed(3));
    s.setProperty('--shade-back', (0.3 * (1 - lit(theta - 180))).toFixed(3));
    s.setProperty('--holo', `${(theta * 2.2 + p.tx * 6).toFixed(1)}deg`);
    s.setProperty('--cos', Math.max(0.06, Math.abs(Math.cos(rad))).toFixed(3));
  }, []);

  const tick = useCallback((now) => {
    const p = phys.current;
    const dt = Math.min(0.034, p.t ? (now - p.t) / 1000 : 0.016);
    p.t = now;
    if (!p.drag) {
      const acc = -STIFFNESS * (p.angle - p.target) - DAMPING * p.vel;
      p.vel += acc * dt;
      p.angle += p.vel * dt;
    }
    const ease = Math.min(1, dt * 11);
    p.tx += (p.wantTx - p.tx) * ease;
    p.ty += (p.wantTy - p.ty) * ease;
    p.gx += (p.wantGx - p.gx) * ease;
    p.gy += (p.wantGy - p.gy) * ease;
    const still = !p.drag
      && Math.abs(p.vel) < 0.6 && Math.abs(p.angle - p.target) < 0.05
      && Math.abs(p.wantTx - p.tx) < 0.02 && Math.abs(p.wantTy - p.ty) < 0.02
      && Math.abs(p.wantGx - p.gx) < 0.1 && Math.abs(p.wantGy - p.gy) < 0.1;
    if (still) { p.angle = p.target; p.vel = 0; p.t = 0; raf.current = 0; paint(); return; }
    paint();
    raf.current = requestAnimationFrame(tick);
  }, [paint]);

  const wake = useCallback(() => {
    if (prefersReduced()) {
      const p = phys.current;
      if (!p.drag) { p.angle = p.target; p.vel = 0; }
      p.tx = p.wantTx; p.ty = p.wantTy; p.gx = p.wantGx; p.gy = p.wantGy;
      paint();
      return;
    }
    if (!raf.current) raf.current = requestAnimationFrame(tick);
  }, [paint, tick]);

  useEffect(() => { paint(); return () => cancelAnimationFrame(raf.current); }, [paint]);

  const settle = (target, kick = 0) => {
    const p = phys.current;
    p.target = target;
    p.vel = clamp(p.vel + kick, -MAX_SPIN, MAX_SPIN);
    setBack(Math.abs(Math.round(target / 180)) % 2 === 1);
    wake();
  };
  const flip = (dir = 1) => {
    const p = phys.current;
    setTouched(true);
    settle(Math.round(p.target / 180) * 180 + 180 * dir, 260 * dir);
  };

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const p = phys.current;
    rootRef.current?.setPointerCapture?.(e.pointerId);
    p.drag = { x: e.clientX, y: e.clientY, base: p.angle, moved: false, lastX: e.clientX, lastT: performance.now() };
    p.vel = 0;
    setDragging(true);
    wake();
  };
  const onPointerMove = (e) => {
    const p = phys.current;
    const rect = rootRef.current?.getBoundingClientRect();
    if (p.drag) {
      const d = p.drag;
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) > 6) d.moved = true;
      if (d.moved) {
        const now = performance.now();
        const next = d.base + dx * DRAG_DEG_PER_PX;
        const dt = Math.max(1, now - d.lastT) / 1000;
        // Velocidade suavizada do arrasto: é ela que vira "impulso" ao soltar.
        p.vel = clamp(p.vel * 0.55 + (((e.clientX - d.lastX) * DRAG_DEG_PER_PX) / dt) * 0.45, -MAX_SPIN, MAX_SPIN);
        d.lastX = e.clientX; d.lastT = now;
        p.angle = next;
        p.wantTx = clamp((d.y - e.clientY) * 0.06, -9, 9);
        p.wantTy = 0;
      }
      wake();
      return;
    }
    if (!rect || e.pointerType === 'touch') return;
    const px = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const py = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    p.wantTy = (px - 0.5) * 16;
    p.wantTx = (0.5 - py) * 12;
    p.wantGx = px * 100; p.wantGy = py * 100;
    wake();
  };
  const endDrag = () => {
    const p = phys.current;
    const d = p.drag;
    if (!d) return;
    p.drag = null;
    setDragging(false);
    p.wantTx = 0; p.wantTy = 0;
    if (!d.moved) { flip(1); return; }
    setTouched(true);
    // Onde ele pararia sozinho com o impulso do arrasto → face mais próxima disso.
    settle(Math.round((p.angle + p.vel * 0.16) / 180) * 180);
  };
  const onPointerLeave = () => {
    const p = phys.current;
    if (p.drag) return;
    p.wantTx = 0; p.wantTy = 0; p.wantGx = REST_GLARE.x; p.wantGy = REST_GLARE.y;
    wake();
  };
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); flip(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); flip(1); }
  };

  const number = useMemo(() => fakeNumber(user?.id), [user?.id]);
  const since = useMemo(() => memberSince(user?.createdAt), [user?.createdAt]);
  const name = user?.displayName || user?.username || 'Membro';
  const lvl = Number(level) > 0 ? Math.floor(Number(level)) : null;

  return (
    <div className={`wcard-stage${compact ? ' is-compact' : ''}`}>
      <div className="wcard-scene" ref={sceneRef}>
        <div
          ref={rootRef}
          className={`wcard${VARIANTS[variant] || ''}${dragging ? ' is-dragging' : ''}`}
          role="button" tabIndex={0}
          aria-label={`Cartão da carteira de ${name}: ${fmt(coins)} moedas e ${fmt(gems)} gemas${lvl ? `, nível ${lvl}` : ''}. ${back ? 'Mostrando o verso' : 'Mostrando a frente'}. Enter vira o cartão.`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          onPointerLeave={onPointerLeave} onKeyDown={onKeyDown}
        >
          <div className="wcard-float">
            <div className="wcard-body">
              {/* Frente */}
              <div className="wcard-face wcard-front" aria-hidden={back || undefined}>
                <span className="wcard-art" aria-hidden="true"><Flake className="wcard-watermark" strokeWidth={0.2} /></span>
                <div className="wcard-top">
                  <span className="wcard-bank"><Flake className="wcard-bank-mark" strokeWidth={2} />Project Club</span>
                  <span className="wcard-photo">
                    <UserAvatar user={user} size={64} noDecoration style={{ width: '100%', height: '100%' }} />
                  </span>
                </div>
                <div className="wcard-mid" aria-hidden="true">
                  <span className="wcard-chip">
                    <svg viewBox="0 0 50 38" fill="none" stroke="currentColor" strokeWidth="1.1">
                      <path d="M17 0v10a4 4 0 0 1-4 4H0M33 0v10a4 4 0 0 0 4 4h13M0 24h13a4 4 0 0 1 4 4v10M50 24H37a4 4 0 0 0-4 4v10M17 14v10M33 14v10M17 19h16" />
                    </svg>
                  </span>
                  <svg className="wcard-contactless" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                    <path d="M6.5 9.5a4 4 0 0 1 0 5M10 7a7.5 7.5 0 0 1 0 10M13.5 4.5a11 11 0 0 1 0 15M17 2a14.5 14.5 0 0 1 0 20" />
                  </svg>
                </div>
                <div className="wcard-balances">
                  <span className="wcard-bal coins"><Ico name="coin" size={22} /><b>{fmt(coins)}</b><small>moedas</small></span>
                  <span className="wcard-bal gems"><Ico name="gem" size={22} /><b>{fmt(gems)}</b><small>gemas</small></span>
                </div>
                <div className="wcard-bottom">
                  <span className="wcard-holder">
                    <strong className="truncate">{name}</strong>
                    {lvl && <small>Nível {lvl}</small>}
                  </span>
                  <ClubPayMark />
                </div>
                <span className="wcard-shade" aria-hidden="true" />
                <span className="wcard-glare" aria-hidden="true" />
              </div>

              {/* Espessura: fatias entre a frente e o verso + as duas laterais. */}
              <span className="wcard-slab s1" aria-hidden="true" />
              <span className="wcard-slab s2" aria-hidden="true" />
              <span className="wcard-slab s3" aria-hidden="true" />
              <span className="wcard-slab s4" aria-hidden="true" />
              <span className="wcard-slab s5" aria-hidden="true" />
              <span className="wcard-side l" aria-hidden="true" />
              <span className="wcard-side r" aria-hidden="true" />

              {/* Verso: tarja, assinatura + final do número, código, dados e o holograma. */}
              <div className="wcard-face wcard-back" aria-hidden={!back || undefined}>
                <span className="wcard-stripe" aria-hidden="true" />
                <div className="wcard-sign">
                  <span className="wcard-sign-strip">
                    <svg className="wcard-scribble" viewBox="0 0 120 30" aria-hidden="true">
                      <path d="M4 20c6-10 10-14 13-12s-4 14-1 14 7-14 11-14-1 12 3 12 6-9 9-9 2 8 6 8 5-6 8-6c4 0 3 5 7 5s5-4 9-4 7 3 11 2 10-3 15-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="wcard-sr">Assinatura de {name}</span>
                  </span>
                  <span className="wcard-cvv" aria-hidden="true">{number.slice(1, 4)}</span>
                </div>
                <dl className="wcard-facts">
                  <div><dt>Final</dt><dd>•••• {number}</dd></div>
                  {since && <div><dt>Membro desde</dt><dd>{since}</dd></div>}
                  {lvl && <div><dt>Nível</dt><dd>{lvl}</dd></div>}
                </dl>
                <p className="wcard-legal">ClubPay é a bandeira de faz de conta do Project Club. Moedas e gemas valem só aqui dentro.</p>
                <span className="wcard-holo" aria-hidden="true"><Flake strokeWidth={1.6} /></span>
                <span className="wcard-shade" aria-hidden="true" />
                <span className="wcard-glare" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
        <span className="wcard-shadow" aria-hidden="true" />
      </div>
      {hint && <p className={`wcard-hint${touched ? ' is-used' : ''}`} aria-hidden="true">Arraste para girar, toque para virar</p>}
    </div>
  );
}
