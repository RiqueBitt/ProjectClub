import { useEffect, useMemo, useRef, useState } from 'react';
import UserAvatar from './UserAvatar.jsx';
import { Ico } from './PagesKit.jsx';
import '../styles/wallet-card.css';

// Cartão da carteira (aba Economia, nov/2026 — pedido do dono): um
// "cartão de crédito" 3D com a foto da pessoa, moedas e gemas. Clicar (ou
// Enter/Espaço) vira o cartão; arrastar pro lado gira ele pra frente ou pra
// trás e, ao soltar, ele assenta na face mais próxima. Parado, flutua de
// leve e um reflexo acompanha o mouse. A bandeira "ClubPay" é fictícia.
// Estilos (`variant`): DEFAULT (azul), GOLD (preto e dourado, Assinante) e
// RAINBOW (preto e arco-íris, Super Assinante) — ver server/services/walletCard.js.
// `compact`: versão menor, usada no chat ("Mostrar cartão") e na Loja.
// Nada aqui mexe em saldo: só mostra o que vem de /economy/me.

function fmt(n) { return Math.floor(Number(n) || 0).toLocaleString('pt-BR'); }

// Número de enfeite, sempre o mesmo pra mesma pessoa (não é número de nada).
function fakeNumber(seed) {
  let h = 2166136261;
  for (const ch of String(seed || 'project-club')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return String(h % 10000).padStart(4, '0');
}

// Bandeira fictícia: floco de neve dentro de um losango + "ClubPay".
function ClubPayMark() {
  return (
    <span className="wcard-brand" aria-label="Bandeira ClubPay (fictícia)">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="5" y="5" width="22" height="22" rx="6" transform="rotate(45 16 16)" fill="rgba(255,255,255,.16)" stroke="rgba(255,255,255,.7)" strokeWidth="1.4" />
        <path d="M16 9v14M10 12.5l12 7M22 12.5l-12 7M14 9.8l2 1.6 2-1.6M14 22.2l2-1.6 2 1.6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="wcard-brand-name">Club<b>Pay</b></span>
    </span>
  );
}

const SNAP_MS = 520;

const VARIANTS = { DEFAULT: '', GOLD: ' wcard--gold', RAINBOW: ' wcard--rainbow' };

export default function WalletCard({ user, coins, gems, level, variant = 'DEFAULT', compact = false, hint = true }) {
  const [angle, setAngle] = useState(0);         // rotação Y "assentada" (múltiplos de 180)
  const [drag, setDrag] = useState(null);        // { startX, base, moved }
  const [tilt, setTilt] = useState({ x: 0, y: 0, px: 50, py: 50 });
  const [snapping, setSnapping] = useState(false);
  const cardRef = useRef(null);
  const snapTimer = useRef(null);
  useEffect(() => () => clearTimeout(snapTimer.current), []);

  const settleTo = (deg) => {
    setSnapping(true);
    setAngle(deg);
    clearTimeout(snapTimer.current);
    snapTimer.current = setTimeout(() => setSnapping(false), SNAP_MS);
  };
  const flip = (dir = 1) => settleTo(Math.round(angle / 180) * 180 + 180 * dir);

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    cardRef.current?.setPointerCapture?.(e.pointerId);
    setDrag({ startX: e.clientX, base: angle, moved: false, current: angle });
  };
  const onPointerMove = (e) => {
    const rect = cardRef.current?.getBoundingClientRect();
    if (drag) {
      const dx = e.clientX - drag.startX;
      const current = drag.base + dx * 0.9;
      setDrag((d) => (d ? { ...d, current, moved: d.moved || Math.abs(dx) > 6 } : d));
      return;
    }
    if (!rect || e.pointerType === 'touch') return;
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    setTilt({ x: (50 - py) / 6, y: (px - 50) / 5, px, py });
  };
  const endDrag = () => {
    if (!drag) return;
    if (!drag.moved) flip(1);
    else settleTo(Math.round(drag.current / 180) * 180);
    setDrag(null);
  };
  const onPointerLeave = () => { if (!drag) setTilt({ x: 0, y: 0, px: 50, py: 50 }); };
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); flip(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); flip(1); }
  };

  const rotY = drag ? drag.current : angle;
  const showingBack = Math.abs(Math.round(rotY / 180)) % 2 === 1;
  const number = useMemo(() => fakeNumber(user?.id), [user?.id]);
  const name = user?.displayName || user?.username || 'Membro';

  return (
    <div className={`wcard-stage${compact ? ' is-compact' : ''}`}>
      <div
        ref={cardRef}
        className={`wcard${VARIANTS[variant] || ''}${drag ? ' is-dragging' : ''}${snapping ? ' is-snapping' : ''}${showingBack ? ' is-back' : ''}`}
        role="button" tabIndex={0}
        aria-label={`Cartão da carteira de ${name}: ${fmt(coins)} moedas e ${fmt(gems)} gemas${level ? `, nível ${level}` : ''}. ${showingBack ? 'Mostrando o verso' : 'Mostrando a frente'}. Enter vira o cartão.`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onPointerLeave={onPointerLeave} onKeyDown={onKeyDown}
        style={{ '--rx': `${drag ? 0 : tilt.x}deg`, '--ry': `${rotY + (drag ? 0 : tilt.y)}deg`, '--px': `${tilt.px}%`, '--py': `${tilt.py}%` }}
      >
        <div className="wcard-float">
          <div className="wcard-inner">
            {/* Frente */}
            <div className="wcard-face wcard-front">
              <span className="wcard-sheen" aria-hidden="true" />
              <div className="wcard-top">
                <span className="wcard-bank">Project Club</span>
                <span className="wcard-contactless" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8.5 8.5a5 5 0 0 1 0 7M12 6a8.5 8.5 0 0 1 0 12M15.5 3.5a12 12 0 0 1 0 17" /></svg>
                </span>
              </div>
              <div className="wcard-mid">
                <span className="wcard-chip" aria-hidden="true"><i /><i /><i /></span>
                <span className="wcard-photo"><UserAvatar user={user} size={compact ? 40 : 52} /></span>
              </div>
              <div className="wcard-balances">
                <span className="wcard-bal coins"><Ico name="coin" size={17} /><b>{fmt(coins)}</b><small>moedas</small></span>
                <span className="wcard-bal gems"><Ico name="gem" size={17} /><b>{fmt(gems)}</b><small>gemas</small></span>
              </div>
              <div className="wcard-bottom">
                <span className="wcard-holder">
                  <small>Titular</small>
                  <strong className="truncate">{name}</strong>
                </span>
                <ClubPayMark />
              </div>
            </div>

            {/* Verso: tarja, "assinatura autorizada", assinatura + final do número, CVV e a estrelinha. */}
            <div className="wcard-face wcard-back">
              <span className="wcard-sheen" aria-hidden="true" />
              <span className="wcard-stripe" aria-hidden="true" />
              <span className="wcard-sig-label">Assinatura autorizada</span>
              <div className="wcard-sign">
                <span className="wcard-sign-strip">
                  <svg className="wcard-scribble" viewBox="0 0 120 30" aria-hidden="true">
                    <path d="M4 20c6-10 10-14 13-12s-4 14-1 14 7-14 11-14-1 12 3 12 6-9 9-9 2 8 6 8 5-6 8-6c4 0 3 5 7 5s5-4 9-4 7 3 11 2 10-3 15-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Assinatura de {name}</span>
                  <b>{number}</b>
                </span>
                <span className="wcard-cvv">{number.slice(1, 4)}</span>
              </div>
              <span className="wcard-star" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor" /></svg>
              </span>
            </div>
          </div>
        </div>
      </div>
      {hint && <p className="wcard-hint" aria-hidden="true">Toque pra virar · arraste pra girar</p>}
    </div>
  );
}
