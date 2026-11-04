// Voz por proximidade da Praça (Club Penguin) — controles DENTRO do jogo.
//
// O chat de escrever é o próprio chat do Club Penguin (a barra de texto do
// jogo, junto das mensagens prontas): nada de painel do Project Club.
//
// Voz:
// - O servidor do jogo manda pelo Socket.IO, a cada ~300 ms, quem está na
//   MESMA SALA que você e onde ('praca:presence' → { room, me, players:
//   [{ penguinId, userId, name, x, y }] }).
// - Uma sala de voz só pra ilha inteira ('praca:ilha', o servidor de voz do
//   próprio Project Club). O volume de cada pessoa sai da distância entre os
//   pinguins (perto = alto, longe = some; outra sala = mudo), aplicado no
//   VoiceContext como multiplicador — sem mexer no volume escolhido.
// - Dois botões desenhados por cima do jogo: FALAR (microfone) e OUVIR
//   (escutar os outros). Ligar qualquer um entra na voz; desligar os dois sai.
//   "Ouvir" desligado zera o volume de todo mundo (não usa o "ensurdecer" do
//   site, que também cortaria o microfone).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';

export const PRACA_VOICE_ID = 'praca:ilha';
const NEAR = 110; // até aqui: volume cheio (px do palco 760x480)
const FAR = 380;  // daqui em diante: não ouve
const PREFS_KEY = 'pc.praca.voice';

/** 0–1 conforme a distância (curva suave). */
export function proximityGain(dx, dy) {
  const d = Math.hypot(dx, dy);
  if (d <= NEAR) return 1;
  if (d >= FAR) return 0;
  const t = 1 - (d - NEAR) / (FAR - NEAR);
  return t * t;
}

function readPrefs() {
  try { const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); return { talk: !!p.talk, listen: !!p.listen }; } catch { return { talk: false, listen: false }; }
}

export function usePracaVoice({ myUserId, active }) {
  const { socket } = useSocket() || {};
  const voice = useVoice();
  const [presence, setPresence] = useState({ room: null, me: null, players: [] });
  // O que a pessoa quer (lembrado): falar e/ou ouvir.
  const [want, setWant] = useState(readPrefs);
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(want)); } catch { /* ok */ } }, [want]);

  useEffect(() => {
    if (!socket) return undefined;
    const onPresence = (p) => setPresence(p && typeof p === 'object' ? p : { room: null, me: null, players: [] });
    socket.on('praca:presence', onPresence);
    return () => { socket.off('praca:presence', onPresence); };
  }, [socket]);

  const inVoice = voice?.call?.channelId === PRACA_VOICE_ID;
  const joining = voice?.joiningChannelId === PRACA_VOICE_ID;
  const wantVoice = active && (want.talk || want.listen);

  // Entra/sai da voz da ilha conforme os botões.
  useEffect(() => {
    if (!voice) return;
    if (wantVoice && !inVoice && !joining) voice.joinChannel(null, PRACA_VOICE_ID, 'Club Penguin · voz da ilha', 'VOICE');
    else if (!wantVoice && inVoice) voice.leaveChannel();
  }, [wantVoice, inVoice, joining]); // eslint-disable-line react-hooks/exhaustive-deps

  // Microfone acompanha o botão FALAR.
  const muted = !!voice?.muted;
  useEffect(() => {
    if (!voice || !inVoice) return;
    if (want.talk === muted) voice.toggleMute(); // quer falar e está mudo → desmuta; e vice-versa
  }, [inVoice, want.talk, muted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Volume por distância (ou zero com OUVIR desligado).
  const gains = useMemo(() => {
    const out = {};
    if (!want.listen) return out; // ninguém é ouvido
    const me = presence.players.find((p) => p.penguinId === presence.me);
    if (!me) return out;
    for (const p of presence.players) {
      if (!p.userId || p.userId === myUserId) continue;
      out[p.userId] = proximityGain(p.x - me.x, p.y - me.y);
    }
    return out;
  }, [presence, myUserId, want.listen]);

  const setSpatial = voice?.setSpatialGains;
  useEffect(() => {
    if (!setSpatial) return;
    setSpatial(inVoice ? gains : null);
  }, [inVoice, gains, setSpatial]);

  // Saiu da página: sai da voz da ilha (é voz "do lugar").
  const leaveRef = useRef(null);
  leaveRef.current = () => {
    try { if (voice?.call?.channelId === PRACA_VOICE_ID) voice.leaveChannel(); } catch { /* ok */ }
    try { voice?.setSpatialGains?.(null); } catch { /* ok */ }
  };
  useEffect(() => () => leaveRef.current?.(), []);

  const toggleTalk = useCallback(() => setWant((w) => ({ ...w, talk: !w.talk })), []);
  const toggleListen = useCallback(() => setWant((w) => ({ ...w, listen: !w.listen })), []);

  // Alguém por perto falando agora (brilho no botão OUVIR).
  const parts = voice?.participants || {};
  const someoneNearTalking = inVoice && want.listen && Object.entries(gains).some(([uid, g]) => g > 0.05 && parts[uid]?.speaking);

  return {
    available: !!voice,
    talk: want.talk, listen: want.listen, inVoice, joining,
    speaking: inVoice && want.talk && !!voice?.localSpeaking,
    someoneNearTalking,
    toggleTalk, toggleListen,
  };
}

// ---------------------------------------------------------------------------
// Botões no estilo do Club Penguin, por cima do palco do jogo (escalam junto).

function MicIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.2a3.2 3.2 0 0 0-3.2 3.2v5.4a3.2 3.2 0 0 0 6.4 0V6.4A3.2 3.2 0 0 0 12 3.2Z" fill="currentColor" />
      <path d="M5.6 11.2a6.4 6.4 0 0 0 12.8 0M12 17.6v3.2M8.8 20.8h6.4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      {off && <path d="M4 4l16 16" stroke="#ff4b4b" strokeWidth="3" strokeLinecap="round" />}
    </svg>
  );
}
function EarIcon({ off }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 14v-2a8 8 0 0 1 16 0v2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="3" y="13" width="5" height="7.5" rx="2.2" fill="currentColor" />
      <rect x="16" y="13" width="5" height="7.5" rx="2.2" fill="currentColor" />
      {off && <path d="M4 4l16 16" stroke="#ff4b4b" strokeWidth="3" strokeLinecap="round" />}
    </svg>
  );
}

export function PracaVoiceButtons({ v }) {
  if (!v.available) return null;
  const busy = v.joining && !v.inVoice;
  return (
    <div className="pvb" role="toolbar" aria-label="Voz por proximidade">
      <button
        type="button" onClick={v.toggleTalk}
        className={`pvb-btn${v.talk ? ' is-on' : ' is-off'}${v.speaking ? ' is-speaking' : ''}${busy && v.talk ? ' is-busy' : ''}`}
        aria-pressed={v.talk} title={v.talk ? 'Falar: ligado (toque pra desligar o microfone)' : 'Falar: desligado (toque pra ligar o microfone)'}
      >
        <MicIcon off={!v.talk} />
        <span className="pvb-label">Falar</span>
      </button>
      <button
        type="button" onClick={v.toggleListen}
        className={`pvb-btn${v.listen ? ' is-on' : ' is-off'}${v.someoneNearTalking ? ' is-hearing' : ''}${busy && v.listen ? ' is-busy' : ''}`}
        aria-pressed={v.listen} title={v.listen ? 'Ouvir: ligado (você ouve quem está perto)' : 'Ouvir: desligado'}
      >
        <EarIcon off={!v.listen} />
        <span className="pvb-label">Ouvir</span>
      </button>
    </div>
  );
}
