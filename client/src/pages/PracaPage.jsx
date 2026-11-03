import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSocket } from '../context/SocketContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import PetPenguinSvg from '../components/pet/PetPenguinSvg.jsx';
import { PENGUIN_COLORS } from '../components/PenguinAvatar.jsx';
import '../styles/fase8.css';

// Praça virtual 2D (Fase 8). O servidor (sockets/plaza.js) é quem manda:
// valida limites do mapa, tamanho do passo e frequência. Aqui o próprio
// boneco anda na hora (previsão local) e os outros deslizam suavemente até
// a última posição recebida (interpolação).

const SPEED = 220; // px do mundo por segundo
const SEND_MS = 70; // ~14 envios/s (o servidor aceita até 15/s)
const BUBBLE_MS = 6000;
const COLOR_KEYS = Object.keys(PENGUIN_COLORS);
const KEY_DIRS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
};

const colorFor = (m) => {
  if (m.color && PENGUIN_COLORS[m.color]) return m.color;
  if (typeof m.avatarUrl === 'string' && m.avatarUrl.startsWith('penguin:')) return m.avatarUrl.slice(8);
  let h = 0;
  for (const ch of String(m.userId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLOR_KEYS[h % COLOR_KEYS.length];
};

const inZone = (z, p) => p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;

// Mapa desenhado em SVG (sem imagens externas).
function PlazaMap({ map }) {
  const { w, h, zones } = map;
  const z = Object.fromEntries(zones.map((zz) => [zz.id, zz]));
  const trees = [[520, 120], [600, 90], [980, 110], [1060, 160], [540, 860], [1000, 900], [60, 520], [1540, 520], [300, 470], [1300, 470]];
  return (
    <svg className="praca-map" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs>
        <pattern id="praca-snow" width="60" height="60" patternUnits="userSpaceOnUse">
          <rect width="60" height="60" fill="#EAF5FC" />
          <circle cx="12" cy="18" r="1.6" fill="#FFFFFF" />
          <circle cx="44" cy="40" r="1.2" fill="#FFFFFF" />
          <circle cx="30" cy="54" r="1" fill="#D6EAF7" />
        </pattern>
        <radialGradient id="praca-water" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#9ED8FF" />
          <stop offset="100%" stopColor="#4FA8E0" />
        </radialGradient>
      </defs>
      <rect width={w} height={h} fill="url(#praca-snow)" />
      {/* caminhos */}
      <path d={`M0 ${h / 2 + 20} H${w}`} stroke="#D3C3A6" strokeWidth="70" strokeLinecap="round" opacity="0.55" />
      <path d={`M${w / 2} 0 V${h}`} stroke="#D3C3A6" strokeWidth="70" strokeLinecap="round" opacity="0.55" />
      <circle cx={w / 2} cy={h / 2 - 20} r="160" fill="#DCCDB2" opacity="0.6" />
      {/* jardim */}
      {z.jardim && (
        <g>
          <rect x={z.jardim.x} y={z.jardim.y} width={z.jardim.w} height={z.jardim.h} rx="40" fill="#BFE3B4" />
          {[[150, 160], [260, 140], [380, 190], [200, 280], [330, 300]].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <circle cx={x} cy={y} r="9" fill="#F28AA8" />
              <circle cx={x + 16} cy={y + 6} r="7" fill="#F0C93E" />
              <circle cx={x - 12} cy={y + 10} r="6" fill="#9B6FD1" />
            </g>
          ))}
        </g>
      )}
      {/* lago gelado */}
      {z.lago && (
        <g>
          <ellipse cx={z.lago.x + z.lago.w / 2} cy={z.lago.y + z.lago.h / 2} rx={z.lago.w / 2} ry={z.lago.h / 2} fill="#BFE6FA" stroke="#9ACFEA" strokeWidth="6" />
          <path d={`M${z.lago.x + 90} ${z.lago.y + 110} l60 -20 M${z.lago.x + 200} ${z.lago.y + 170} l70 10 M${z.lago.x + 150} ${z.lago.y + 220} l40 -25`} stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" opacity="0.8" />
        </g>
      )}
      {/* fonte */}
      {z.fonte && (
        <g>
          <circle cx={z.fonte.x + z.fonte.w / 2} cy={z.fonte.y + z.fonte.h / 2} r={z.fonte.w / 2} fill="#B7B9C2" />
          <circle cx={z.fonte.x + z.fonte.w / 2} cy={z.fonte.y + z.fonte.h / 2} r={z.fonte.w / 2 - 16} fill="url(#praca-water)" />
          <circle cx={z.fonte.x + z.fonte.w / 2} cy={z.fonte.y + z.fonte.h / 2} r="22" fill="#B7B9C2" />
          <circle className="praca-fountain-drop" cx={z.fonte.x + z.fonte.w / 2} cy={z.fonte.y + z.fonte.h / 2} r="10" fill="#E6F6FF" />
        </g>
      )}
      {/* palco */}
      {z.palco && (
        <g>
          <rect x={z.palco.x} y={z.palco.y} width={z.palco.w} height={z.palco.h} rx="18" fill="#C9935D" />
          <rect x={z.palco.x} y={z.palco.y} width={z.palco.w} height="34" rx="14" fill="#B33B3B" />
          {Array.from({ length: 8 }).map((_, i) => (
            <path key={i} d={`M${z.palco.x + 20 + i * 46} ${z.palco.y + 34} q8 18 0 36`} stroke="#9B2F2F" strokeWidth="6" fill="none" />
          ))}
          <path d={`M${z.palco.x + 30} ${z.palco.y + 70} H${z.palco.x + z.palco.w - 30}`} stroke="#A9773F" strokeWidth="3" />
        </g>
      )}
      {/* café */}
      {z.cafe && (
        <g>
          <rect x={z.cafe.x} y={z.cafe.y} width={z.cafe.w} height={z.cafe.h} rx="24" fill="#E9D8C3" />
          {[[160, 730], [300, 760], [200, 850], [360, 860]].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <circle cx={x} cy={y} r="24" fill="#8B5E3C" />
              <circle cx={x} cy={y} r="18" fill="#A9774F" />
              <circle cx={x - 6} cy={y - 4} r="5" fill="#FFFFFF" />
            </g>
          ))}
        </g>
      )}
      {/* árvores de neve */}
      {trees.map(([x, y]) => (
        <g key={`t${x}-${y}`}>
          <rect x={x - 5} y={y + 18} width="10" height="16" fill="#8B5E3C" />
          <path d={`M${x} ${y - 34} L${x + 26} ${y + 20} L${x - 26} ${y + 20} Z`} fill="#3E8E5C" />
          <path d={`M${x} ${y - 34} L${x + 12} ${y - 8} L${x - 12} ${y - 8} Z`} fill="#FFFFFF" opacity="0.85" />
        </g>
      ))}
    </svg>
  );
}

export default function PracaPage() {
  const { socket, connected } = useSocket();
  const { user } = useAuth();
  const voice = useVoice();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState(null); // plaza:state
  const [members, setMembers] = useState([]); // perfis (posições ficam em refs)
  const [rooms, setRooms] = useState([]);
  const [bubbles, setBubbles] = useState({}); // userId -> { id, text }
  const [toast, setToast] = useState('');
  const [replaced, setReplaced] = useState(false);
  const [chat, setChat] = useState('');
  const [inVoiceZone, setInVoiceZone] = useState(false);
  const [walking, setWalking] = useState({}); // userId -> bool (só pra animação de passo)

  const viewportRef = useRef(null);
  const worldRef = useRef(null);
  const radiusRef = useRef(null);
  const camRef = useRef(null); // { cx, cy, scale } da câmera atual
  const els = useRef(new Map()); // userId -> elemento
  const pos = useRef(new Map()); // userId -> { x, y, rx, ry, dir }
  const me = useRef({ x: 800, y: 620, dir: 'down', target: null, lastSent: 0, sentX: 800, sentY: 620 });
  const keys = useRef(new Set());
  const bubbleTimers = useRef(new Map());
  const toastTimer = useRef(0);
  const stateRef = useRef(null);
  stateRef.current = state;
  const wantedRoom = params.get('sala') || null;

  const flash = useCallback((msg) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3500);
  }, []);

  // ---- Socket ----
  useEffect(() => {
    if (!socket) return undefined;
    const join = () => socket.emit('plaza:join', { room: wantedRoom });
    const onState = (s) => {
      setReplaced(false);
      pos.current = new Map(s.members.map((m) => [m.userId, { x: m.x, y: m.y, rx: m.x, ry: m.y, dir: m.dir }]));
      Object.assign(me.current, { x: s.me.x, y: s.me.y, sentX: s.me.x, sentY: s.me.y, target: null });
      setMembers(s.members.map(({ x, y, dir, ...rest }) => rest)); // eslint-disable-line no-unused-vars
      setRooms(s.rooms || []);
      setState(s);
    };
    const onJoined = ({ member }) => {
      pos.current.set(member.userId, { x: member.x, y: member.y, rx: member.x, ry: member.y, dir: member.dir });
      const { x, y, dir, ...profile } = member; // eslint-disable-line no-unused-vars
      setMembers((list) => [...list.filter((m) => m.userId !== member.userId), profile]);
    };
    const onLeft = ({ userId }) => {
      pos.current.delete(userId);
      setMembers((list) => list.filter((m) => m.userId !== userId));
    };
    const onSnapshot = ({ p }) => {
      const myId = user?.id;
      for (const [id, x, y, dir] of p) {
        if (id === myId) {
          // Servidor corrigiu (passo grande demais, borda...): volta pra lá.
          if (Math.hypot(x - me.current.x, y - me.current.y) > 90) Object.assign(me.current, { x, y, sentX: x, sentY: y, target: null });
          continue;
        }
        const cur = pos.current.get(id);
        if (cur) Object.assign(cur, { x, y, dir });
        else pos.current.set(id, { x, y, rx: x, ry: y, dir });
      }
    };
    const onBubble = (b) => {
      setBubbles((all) => ({ ...all, [b.userId]: { id: b.id, text: b.text } }));
      window.clearTimeout(bubbleTimers.current.get(b.userId));
      bubbleTimers.current.set(b.userId, window.setTimeout(() => {
        setBubbles((all) => { const next = { ...all }; if (next[b.userId]?.id === b.id) delete next[b.userId]; return next; });
      }, BUBBLE_MS));
    };
    const onError = ({ error }) => flash(error);
    const onReplaced = () => { setReplaced(true); setState(null); };
    const onRooms = (r) => setRooms(r.rooms || []);
    socket.on('plaza:state', onState);
    socket.on('plaza:member-joined', onJoined);
    socket.on('plaza:member-left', onLeft);
    socket.on('plaza:snapshot', onSnapshot);
    socket.on('plaza:bubble', onBubble);
    socket.on('plaza:error', onError);
    socket.on('plaza:replaced', onReplaced);
    socket.on('plaza:rooms', onRooms);
    socket.on('connect', join);
    if (socket.connected) join();
    const roomsTimer = window.setInterval(() => socket.emit('plaza:rooms'), 10_000);
    return () => {
      socket.emit('plaza:leave');
      socket.off('plaza:state', onState);
      socket.off('plaza:member-joined', onJoined);
      socket.off('plaza:member-left', onLeft);
      socket.off('plaza:snapshot', onSnapshot);
      socket.off('plaza:bubble', onBubble);
      socket.off('plaza:error', onError);
      socket.off('plaza:replaced', onReplaced);
      socket.off('plaza:rooms', onRooms);
      socket.off('connect', join);
      window.clearInterval(roomsTimer);
    };
  }, [socket, wantedRoom, user?.id, flash]);

  useEffect(() => () => { for (const t of bubbleTimers.current.values()) window.clearTimeout(t); window.clearTimeout(toastTimer.current); }, []);

  // ---- Teclado ----
  useEffect(() => {
    const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    const down = (e) => {
      if (!KEY_DIRS[e.code] || typing() || e.ctrlKey || e.metaKey || e.altKey) return;
      keys.current.add(KEY_DIRS[e.code]);
      me.current.target = null;
      e.preventDefault();
    };
    const up = (e) => { if (KEY_DIRS[e.code]) keys.current.delete(KEY_DIRS[e.code]); };
    const blur = () => keys.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  // ---- Laço de animação ----
  useEffect(() => {
    if (!state) return undefined;
    let raf = 0;
    let last = performance.now();
    const walkingNow = new Map();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = stateRef.current;
      if (!s) { raf = requestAnimationFrame(tick); return; }
      const W = s.map.w;
      const H = s.map.h;
      const m = me.current;
      // Movimento local: teclas têm prioridade sobre o toque/clique.
      let vx = 0;
      let vy = 0;
      if (keys.current.has('left')) vx -= 1;
      if (keys.current.has('right')) vx += 1;
      if (keys.current.has('up')) vy -= 1;
      if (keys.current.has('down')) vy += 1;
      if (!vx && !vy && m.target) {
        const dx = m.target.x - m.x;
        const dy = m.target.y - m.y;
        const d = Math.hypot(dx, dy);
        if (d < 3) m.target = null;
        else { vx = dx / d; vy = dy / d; }
      }
      const moving = !!(vx || vy);
      if (moving) {
        const len = Math.hypot(vx, vy) || 1;
        const step = Math.min(SPEED * dt, m.target ? Math.hypot(m.target.x - m.x, m.target.y - m.y) : Infinity);
        m.x = Math.max(0, Math.min(W, m.x + (vx / len) * step));
        m.y = Math.max(0, Math.min(H, m.y + (vy / len) * step));
        m.dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : (vy > 0 ? 'down' : 'up');
      }
      // Envia no ritmo que o servidor aceita, sem passar do passo máximo.
      if ((m.x !== m.sentX || m.y !== m.sentY) && now - m.lastSent >= SEND_MS) {
        m.lastSent = now;
        m.sentX = Math.round(m.x);
        m.sentY = Math.round(m.y);
        socket?.emit('plaza:move', { x: m.sentX, y: m.sentY, dir: m.dir });
      }
      // Outros: desliza até a última posição recebida.
      const k = Math.min(1, dt * 12);
      for (const [id, p] of pos.current) {
        if (id === user?.id) { p.rx = m.x; p.ry = m.y; p.dir = m.dir; } else { p.rx += (p.x - p.rx) * k; p.ry += (p.y - p.ry) * k; }
        const el = els.current.get(id);
        if (el) {
          el.style.transform = `translate(${p.rx}px, ${p.ry}px)`;
          el.style.zIndex = String(Math.round(p.ry));
          const isWalking = id === user?.id ? moving : Math.hypot(p.x - p.rx, p.y - p.ry) > 1.5;
          if (walkingNow.get(id) !== isWalking) { walkingNow.set(id, isWalking); el.classList.toggle('is-walking', isWalking); }
          const flip = p.dir === 'left' ? -1 : 1;
          const fig = el.firstChild?.firstChild;
          if (fig && fig.dataset.flip !== String(flip)) { fig.dataset.flip = String(flip); fig.style.transform = `scaleX(${flip})`; }
        }
      }
      // Câmera segue o próprio boneco.
      const vp = viewportRef.current;
      if (vp && worldRef.current) {
        const vw = vp.clientWidth;
        const vh = vp.clientHeight;
        const scale = Math.max(0.45, Math.min(1, vw / 900));
        let cx = vw / 2 - m.x * scale;
        let cy = vh / 2 - m.y * scale;
        cx = W * scale < vw ? (vw - W * scale) / 2 : Math.min(0, Math.max(vw - W * scale, cx));
        cy = H * scale < vh ? (vh - H * scale) / 2 : Math.min(0, Math.max(vh - H * scale, cy));
        worldRef.current.style.transform = `translate(${cx}px, ${cy}px) scale(${scale})`;
        camRef.current = { cx, cy, scale };
      }
      if (radiusRef.current) radiusRef.current.style.transform = `translate(${m.x - s.radius}px, ${m.y - s.radius}px)`;
      const voiceZone = s.voice ? s.map.zones.some((z) => z.voice && inZone(z, m)) : false;
      setInVoiceZone((v) => (v === voiceZone ? v : voiceZone));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, socket, user?.id]);

  // Clique/toque no mapa: anda até lá.
  const onPointerDown = (e) => {
    const vp = viewportRef.current;
    const cam = camRef.current;
    if (!vp || !cam || !worldRef.current || e.target.closest('button, input, select')) return;
    vp.focus({ preventScroll: true });
    const { cx, cy, scale } = cam;
    const rect = vp.getBoundingClientRect();
    const x = (e.clientX - rect.left - cx) / scale;
    const y = (e.clientY - rect.top - cy) / scale;
    const W = state?.map.w || 1600;
    const H = state?.map.h || 1000;
    me.current.target = { x: Math.max(0, Math.min(W, x)), y: Math.max(0, Math.min(H, y)) };
    // Marquinha de onde vai.
    const mark = document.createElement('div');
    mark.className = 'praca-target';
    mark.style.left = `${me.current.target.x}px`;
    mark.style.top = `${me.current.target.y}px`;
    worldRef.current.appendChild(mark);
    window.setTimeout(() => mark.remove(), 650);
  };

  const pad = (dir, on) => (e) => {
    e.preventDefault();
    if (on) { keys.current.add(dir); me.current.target = null; } else keys.current.delete(dir);
  };

  const send = (e) => {
    e.preventDefault();
    const text = chat.trim();
    if (!text || !socket) return;
    socket.emit('plaza:say', { text });
    setChat('');
  };

  const changeRoom = (room) => {
    const next = new URLSearchParams(params);
    if (room === '1') next.delete('sala'); else next.set('sala', room);
    setParams(next, { replace: true });
  };

  const roomOptions = useMemo(() => {
    const list = [...rooms];
    if (state && !list.some((r) => r.id === state.room)) list.push({ id: state.room, label: state.label, count: members.length });
    list.sort((a, b) => Number(a.id) - Number(b.id));
    const nextId = String((list.reduce((mx, r) => Math.max(mx, Number(r.id)), 0) || 0) + 1);
    return [...list, { id: nextId, label: `Praça ${nextId} (nova)`, count: 0, isNew: true }];
  }, [rooms, state, members.length]);

  const voiceChannel = state?.voice;
  const inThatCall = !!voiceChannel && voice?.call?.channelId === voiceChannel.id;

  return (
    <div className="praca-page">
      <div className="praca-top">
        <h1>{state?.label || 'Praça'}</h1>
        <span className="praca-count">{state ? `${members.length}/${state.cap} pinguins aqui` : connected ? 'Entrando…' : 'Conectando…'}</span>
        <span className="praca-spacer" />
        {state && (
          <label>
            <span className="sr-only">Escolher praça</span>
            <select value={state.room} onChange={(e) => changeRoom(e.target.value)} aria-label="Escolher praça">
              {roomOptions.map((r) => (
                <option key={r.id} value={r.id} disabled={!r.isNew && r.id !== state.room && r.count >= (state.cap || 50)}>
                  {r.isNew ? r.label : `${r.label} · ${r.count}`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div
        className="praca-viewport" ref={viewportRef} tabIndex={0} onPointerDown={onPointerDown}
        aria-label="Mapa da Praça. Use WASD ou as setas para andar, ou toque/clique onde quer ir."
      >
        {toast && <div className="praca-toast" role="status">{toast}</div>}
        {replaced && (
          <div className="praca-status" style={{ pointerEvents: 'auto' }}>
            <div style={{ textAlign: 'center' }}>
              <p>Você abriu a Praça em outra aba ou aparelho.</p>
              <button type="button" className="pet-btn primary" onClick={() => socket?.emit('plaza:join', { room: wantedRoom })}>Voltar pra cá</button>
            </div>
          </div>
        )}
        {!state && !replaced && <div className="praca-status">{connected ? 'Entrando na Praça…' : 'Conectando…'}</div>}
        {state && (
          <div className="praca-world" ref={worldRef} style={{ width: state.map.w, height: state.map.h }}>
            <PlazaMap map={state.map} />
            {state.map.zones.map((z) => (
              <span key={z.id} className="praca-zone-label" style={{ left: z.x + z.w / 2, top: z.y + 14 }}>{z.label}</span>
            ))}
            <div className="praca-radius" ref={radiusRef} style={{ width: state.radius * 2, height: state.radius * 2 }} title="Quem está dentro do círculo ouve você" />
            {members.map((m) => (
              <div
                key={m.userId}
                className={`praca-avatar${m.userId === user?.id ? ' is-me' : ''}`}
                ref={(el) => { if (el) els.current.set(m.userId, el); else els.current.delete(m.userId); }}
              >
                <div className="praca-avatar-inner">
                  <div className="praca-figure">
                    <PetPenguinSvg size={44} color={colorFor(m)} stage={Math.max(1, m.stage ?? 1)} equipped={m.equipped || {}} animated={false} mood="feliz" title={m.displayName} />
                  </div>
                  <span className="praca-name">{m.displayName}</span>
                  {bubbles[m.userId] && <div className="praca-bubble">{bubbles[m.userId].text}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
        {state && inVoiceZone && voiceChannel && (
          <div className="praca-voice">
            <span>🎤 {voiceChannel.name}</span>
            {inThatCall ? <span>Você já está na call</span> : (
              <button type="button" className="pet-btn primary" onClick={() => voice?.joinChannel?.(null, voiceChannel.id, voiceChannel.name, voiceChannel.type || 'VOICE')}>Entrar na call</button>
            )}
          </div>
        )}
        <div className="praca-pad" aria-hidden="true">
          {[['', null], ['▲', 'up'], ['', null], ['◀', 'left'], ['', null], ['▶', 'right'], ['', null], ['▼', 'down'], ['', null]].map(([label, dir], i) => (
            dir ? (
              <button key={i} type="button" tabIndex={-1} onPointerDown={pad(dir, true)} onPointerUp={pad(dir, false)} onPointerLeave={pad(dir, false)} onPointerCancel={pad(dir, false)}>{label}</button>
            ) : <span key={i} />
          ))}
        </div>
      </div>

      <form className="praca-chat" onSubmit={send}>
        <input
          value={chat} onChange={(e) => setChat(e.target.value)} maxLength={state?.chatMax || 120} disabled={!state}
          placeholder="Fale com quem está perto (até 120 caracteres)…" aria-label="Mensagem para quem está perto"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.currentTarget.blur(); viewportRef.current?.focus(); } }}
        />
        <button type="submit" className="pet-btn primary" disabled={!state || !chat.trim()}>Falar</button>
      </form>
      <div className="praca-hint">Ande com WASD/setas ou tocando no mapa. Só quem está dentro do círculo azul vê o que você fala.</div>
    </div>
  );
}
