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
import micIcon from './assets/mic.png';
import headsetIcon from './assets/headset.png';

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

  // Entra/sai da voz da ilha conforme os botões. Uma tentativa por clique:
  // se a entrada falhar, os botões voltam a "desligado" (sem ficar tentando
  // de novo em loop e enchendo a tela de avisos).
  const triedRef = useRef(false);
  const wasJoiningRef = useRef(false);
  useEffect(() => {
    if (!voice) return;
    if (wasJoiningRef.current && !joining && !inVoice && triedRef.current) {
      triedRef.current = false;
      setWant({ talk: false, listen: false });
    }
    wasJoiningRef.current = joining;
    if (inVoice) triedRef.current = false;
    if (wantVoice && !inVoice && !joining && !triedRef.current) {
      triedRef.current = true;
      voice.joinChannel(null, PRACA_VOICE_ID, 'Club Penguin · voz da ilha', 'VOICE');
    } else if (!wantVoice && inVoice) voice.leaveChannel();
  }, [wantVoice, inVoice, joining]); // eslint-disable-line react-hooks/exhaustive-deps
  // novo clique depois de uma falha libera outra tentativa
  useEffect(() => { if (!wantVoice) triedRef.current = false; }, [wantVoice]);

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
// Botões no estilo da barra do Club Penguin (mesmas cores e anéis dos botões
// redondos do jogo), num painelzinho de menu do jogo por cima do palco.
// Ícones desenhados no traço do jogo: microfone (falar) e headset (ouvir).
// Desligado = risco vermelho de "proibido" por cima do ícone.

function BanLine() {
  return (
    <svg className="pvb-ban" viewBox="0 0 100 100" aria-hidden="true">
      <line x1="20" y1="20" x2="80" y2="80" stroke="#000" strokeWidth="19" strokeLinecap="round" />
      <line x1="20" y1="20" x2="80" y2="80" stroke="#e8141b" strokeWidth="11" strokeLinecap="round" />
      <line x1="23" y1="21" x2="47" y2="45" stroke="#ff7a7a" strokeWidth="3" strokeLinecap="round" opacity=".8" />
    </svg>
  );
}

function VoiceBtn({ on, icon, label, title, onClick, glow, busy }) {
  return (
    <div className="pvb-slot">
      <button
        type="button" onClick={onClick}
        className={`pvb-btn${on ? ' is-on' : ' is-off'}${glow ? ' is-active' : ''}${busy ? ' is-busy' : ''}`}
        aria-pressed={on} aria-label={`${label}: ${on ? 'ligado' : 'desligado'}`} title={title}
      >
        <img className="pvb-icon" src={icon} alt="" draggable="false" />
        {!on && <BanLine />}
      </button>
      <span className="pvb-label" aria-hidden="true">{label}</span>
    </div>
  );
}

export function PracaVoiceButtons({ v }) {
  if (!v.available) return null;
  const busy = v.joining && !v.inVoice;
  return (
    <div className="pvb" role="toolbar" aria-label="Voz por proximidade">
      <VoiceBtn
        on={v.talk} icon={micIcon} label="Falar" onClick={v.toggleTalk}
        glow={v.speaking} busy={busy && v.talk}
        title={v.talk ? 'Microfone ligado — clique pra desligar' : 'Microfone desligado — clique pra falar com quem está perto'}
      />
      <VoiceBtn
        on={v.listen} icon={headsetIcon} label="Ouvir" onClick={v.toggleListen}
        glow={v.someoneNearTalking} busy={busy && v.listen}
        title={v.listen ? 'Ouvindo quem está perto — clique pra parar de ouvir' : 'Sem ouvir ninguém — clique pra ouvir quem está perto'}
      />
    </div>
  );
}
