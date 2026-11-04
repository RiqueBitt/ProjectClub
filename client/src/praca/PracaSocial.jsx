// Chat de texto + voz por proximidade da Praça (Club Penguin).
//
// - O servidor do jogo manda pelo Socket.IO, a cada ~300 ms, quem está na
//   MESMA SALA que você e onde ('praca:presence' → { room, me, players:
//   [{ penguinId, userId, name, x, y }] }).
// - Falas da sala (do jogo ou deste painel) chegam em 'praca:chat'.
// - Escrever aqui (POST /api/plaza/say) vira o balão do seu pinguim no jogo.
// - Voz: uma sala só pra ilha inteira ('praca:ilha', o mesmo servidor de voz
//   das calls do site). O volume de cada pessoa sai da distância entre os
//   pinguins (perto = alto, longe = some; outra sala = mudo) — aplicado no
//   VoiceContext como multiplicador, sem mexer no volume que a pessoa escolheu.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useSocket } from '../context/SocketContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';

export const PRACA_VOICE_ID = 'praca:ilha';
const NEAR = 110; // até aqui: volume cheio (px do palco 760x480)
const FAR = 380;  // daqui em diante: não ouve
const MAX_LOG = 80;

/** 0–1 conforme a distância (curva suave). */
export function proximityGain(dx, dy) {
  const d = Math.hypot(dx, dy);
  if (d <= NEAR) return 1;
  if (d >= FAR) return 0;
  const t = 1 - (d - NEAR) / (FAR - NEAR);
  return t * t;
}

export function usePracaSocial({ myUserId }) {
  const { socket } = useSocket() || {};
  const voice = useVoice();
  const [presence, setPresence] = useState({ room: null, me: null, players: [] });
  const [log, setLog] = useState([]);
  const [unread, setUnread] = useState(0);
  const openRef = useRef(false);

  useEffect(() => {
    if (!socket) return undefined;
    const onPresence = (p) => setPresence(p && typeof p === 'object' ? p : { room: null, me: null, players: [] });
    const onChat = (m) => {
      if (!m?.text) return;
      setLog((l) => [...l.slice(-(MAX_LOG - 1)), m]);
      if (!openRef.current && m.userId !== myUserId) setUnread((n) => n + 1);
    };
    socket.on('praca:presence', onPresence);
    socket.on('praca:chat', onChat);
    return () => { socket.off('praca:presence', onPresence); socket.off('praca:chat', onChat); };
  }, [socket, myUserId]);

  const inVoice = voice?.call?.channelId === PRACA_VOICE_ID;
  const joining = voice?.joiningChannelId === PRACA_VOICE_ID;

  // Ganhos por proximidade enquanto estiver na voz da ilha.
  const gains = useMemo(() => {
    const me = presence.players.find((p) => p.penguinId === presence.me);
    const out = {};
    if (!me) return out;
    for (const p of presence.players) {
      if (!p.userId || p.userId === myUserId) continue;
      out[p.userId] = proximityGain(p.x - me.x, p.y - me.y);
    }
    return out;
  }, [presence, myUserId]);

  const setSpatial = voice?.setSpatialGains;
  useEffect(() => {
    if (!setSpatial) return undefined;
    if (inVoice) setSpatial(gains);
    else setSpatial(null);
    return undefined;
  }, [inVoice, gains, setSpatial]);
  // sair da página: a voz da ilha continua? não — sai junto (é voz "do lugar")
  const leaveRef = useRef(null);
  leaveRef.current = () => {
    try { if (voice?.call?.channelId === PRACA_VOICE_ID) voice.leaveChannel(); } catch { /* ok */ }
    try { voice?.setSpatialGains?.(null); } catch { /* ok */ }
  };
  useEffect(() => () => leaveRef.current?.(), []);

  const toggleVoice = useCallback(() => {
    if (!voice) return;
    if (inVoice) voice.leaveChannel();
    else voice.joinChannel(null, PRACA_VOICE_ID, 'Club Penguin · voz da ilha', 'VOICE');
  }, [voice, inVoice]);

  const send = useCallback(async (text) => {
    const t = String(text || '').trim();
    if (!t) return { ok: false };
    try { await api.post('/plaza/say', { text: t }); return { ok: true }; } catch (err) {
      return { ok: false, error: err?.response?.data?.error || 'Não deu pra enviar.' };
    }
  }, []);

  const setOpen = useCallback((open) => { openRef.current = open; if (open) setUnread(0); }, []);

  // Quem está na voz e na mesma sala, com o "quanto você ouve".
  const nearby = useMemo(() => {
    const parts = voice?.participants || {};
    return presence.players
      .filter((p) => p.userId && p.userId !== myUserId)
      .map((p) => ({ ...p, inVoice: !!parts[p.userId], speaking: !!parts[p.userId]?.speaking, gain: gains[p.userId] ?? 0 }))
      .sort((a, b) => (b.inVoice - a.inVoice) || (b.gain - a.gain));
  }, [presence, gains, voice?.participants, myUserId]);

  return {
    presence, log, unread, setOpen, send, nearby,
    voice: { inVoice, joining, muted: !!voice?.muted, toggle: toggleVoice, toggleMute: voice?.toggleMute, available: !!voice },
  };
}

// ---------------------------------------------------------------------------

function Icon({ d, size = 18 }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
const I = {
  chat: 'M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12Z',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3',
  micOff: 'M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.1 5.7M19 11a7 7 0 0 1-.6 2.8M12 18v3',
  headset: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 0 2 2h1v-5H6a2 2 0 0 0-2 2ZM20 15a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2Z',
  leave: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h11',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z',
  close: 'M18 6 6 18M6 6l12 12',
};

function ChatLog({ log, myUserId }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [log]);
  return (
    <ol className="psoc-log" ref={ref} aria-live="polite">
      {log.length === 0 && <li className="psoc-empty">Ninguém falou nesta sala ainda. Diga oi!</li>}
      {log.map((m) => (
        <li key={m.id} className={m.userId && m.userId === myUserId ? 'is-me' : ''}>
          <b>{m.name}</b>
          <span>{m.text}</span>
        </li>
      ))}
    </ol>
  );
}

function ChatInput({ send, autoFocus }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true); setErr('');
    const r = await send(text);
    setBusy(false);
    if (r.ok) setText(''); else setErr(r.error || '');
  };
  return (
    <form className="psoc-input" onSubmit={submit}>
      <input
        value={text} onChange={(e) => setText(e.target.value.slice(0, 64))} maxLength={64}
        placeholder="Escreva pra sala…" aria-label="Mensagem" autoFocus={autoFocus} enterKeyHint="send"
        // o jogo (Ruffle) não pode pegar as teclas enquanto digita aqui
        onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()}
      />
      <button type="submit" disabled={busy || !text.trim()} aria-label="Enviar"><Icon d={I.send} /></button>
      {err && <small className="psoc-err">{err}</small>}
    </form>
  );
}

function VoiceBlock({ s }) {
  const v = s.voice;
  if (!v.available) return null;
  return (
    <section className="psoc-voice">
      <header>
        <span className="psoc-title"><Icon d={I.headset} /> Voz por proximidade</span>
        {v.inVoice && <span className="psoc-live">ao vivo</span>}
      </header>
      {!v.inVoice ? (
        <>
          <p className="psoc-muted">Fale com quem está perto do seu pinguim — quanto mais longe, mais baixo; em outra sala, ninguém ouve.</p>
          <button type="button" className="psoc-btn primary" onClick={v.toggle} disabled={v.joining}>{v.joining ? 'Conectando…' : 'Entrar na voz'}</button>
        </>
      ) : (
        <>
          <div className="psoc-row">
            <button type="button" className={`psoc-btn${v.muted ? ' danger' : ''}`} onClick={v.toggleMute}><Icon d={v.muted ? I.micOff : I.mic} /> {v.muted ? 'Mudo' : 'Microfone'}</button>
            <button type="button" className="psoc-btn" onClick={v.toggle}><Icon d={I.leave} /> Sair</button>
          </div>
          <ul className="psoc-near">
            {s.nearby.filter((p) => p.inVoice).length === 0 && <li className="psoc-muted">Ninguém da sala na voz agora.</li>}
            {s.nearby.filter((p) => p.inVoice).map((p) => (
              <li key={p.penguinId} className={p.speaking ? 'is-speaking' : ''}>
                <span className="psoc-name">{p.name}</span>
                <span className="psoc-meter" title={`${Math.round(p.gain * 100)}%`}><i style={{ width: `${Math.round(p.gain * 100)}%` }} /></span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Painel lateral (computador). */
export function PracaSocialPanel({ s, myUserId, onClose }) {
  useEffect(() => { s.setOpen(true); return () => s.setOpen(false); }, [s.setOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <aside className="psoc-panel" aria-label="Chat e voz da sala">
      <div className="psoc-head">
        <span className="psoc-title"><Icon d={I.chat} /> Sala{s.presence.room ? ` · ${s.presence.players.length} ${s.presence.players.length === 1 ? 'pinguim' : 'pinguins'}` : ''}</span>
        {onClose && <button type="button" className="psoc-x" onClick={onClose} aria-label="Fechar"><Icon d={I.close} /></button>}
      </div>
      <VoiceBlock s={s} />
      <ChatLog log={s.log} myUserId={myUserId} />
      <ChatInput send={s.send} />
    </aside>
  );
}

/** Celular / tela cheia: botões flutuantes + folha de chat. */
export function PracaSocialFloating({ s, myUserId }) {
  const [open, setOpenState] = useState(false);
  const setOpen = (o) => { setOpenState(o); s.setOpen(o); };
  const v = s.voice;
  const last = s.log[s.log.length - 1];
  // última fala aparece por 6 s num balãozinho (com o chat fechado)
  const [peek, setPeek] = useState(null);
  useEffect(() => {
    if (!last) return undefined;
    setPeek(last);
    const t = setTimeout(() => setPeek(null), 6000);
    return () => clearTimeout(t);
  }, [last?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="psoc-fab" role="toolbar" aria-label="Chat e voz">
        <button type="button" className="psoc-fab-btn" onClick={() => setOpen(!open)} aria-pressed={open} aria-label="Chat da sala">
          <Icon d={I.chat} size={20} />
          {s.unread > 0 && <em>{s.unread > 9 ? '9+' : s.unread}</em>}
        </button>
        {v.available && (
          <button type="button" className={`psoc-fab-btn${v.inVoice ? ' on' : ''}`} onClick={v.toggle} disabled={v.joining} aria-pressed={v.inVoice} aria-label={v.inVoice ? 'Sair da voz' : 'Entrar na voz por proximidade'}>
            <Icon d={I.headset} size={20} />
          </button>
        )}
        {v.inVoice && (
          <button type="button" className={`psoc-fab-btn${v.muted ? ' off' : ''}`} onClick={v.toggleMute} aria-pressed={v.muted} aria-label={v.muted ? 'Ligar microfone' : 'Silenciar microfone'}>
            <Icon d={v.muted ? I.micOff : I.mic} size={20} />
          </button>
        )}
      </div>
      {!open && peek && (
        <button type="button" className="psoc-peek" onClick={() => setOpen(true)}><b>{peek.name}:</b> {peek.text}</button>
      )}
      {open && (
        <div className="psoc-sheet" role="dialog" aria-label="Chat da sala">
          <div className="psoc-head">
            <span className="psoc-title"><Icon d={I.chat} /> Chat da sala</span>
            <button type="button" className="psoc-x" onClick={() => setOpen(false)} aria-label="Fechar"><Icon d={I.close} /></button>
          </div>
          <ChatLog log={s.log} myUserId={myUserId} />
          <ChatInput send={s.send} autoFocus />
        </div>
      )}
    </>
  );
}
