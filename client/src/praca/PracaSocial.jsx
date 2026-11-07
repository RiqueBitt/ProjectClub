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
//   próprio Project Club). Quem está na MESMA SALA do jogo se ouve no volume
//   normal; outra sala = mudo (pedido do dono, nov/2026: sem abaixar pela
//   distância). Aplicado no VoiceContext como multiplicador 0/1 — sem mexer no
//   volume escolhido. Durante um minijogo a pessoa continua na voz da sala de
//   onde saiu (o servidor mantém a última sala na presença).
// - Dois botões dentro da barra do jogo: FALAR (microfone) e OUVIR
//   (escutar os outros). Ligar qualquer um entra na voz; desligar os dois sai.
//   "Ouvir" desligado zera o volume de todo mundo (não usa o "ensurdecer" do
//   site, que também cortaria o microfone).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useVoice } from '../context/VoiceContext.jsx';
import { useStore } from '../store/useStore';

export const PRACA_VOICE_ID = 'praca:ilha';
const PREFS_KEY = 'pc.praca.voice';

/** Volume de quem está na mesma sala: sempre cheio (a distância não abaixa mais). */
export function proximityGain() {
  return 1;
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

  const speaking = inVoice && want.talk && !!voice?.localSpeaking;
  // Pinguins falando agora na sala (balão com o alto-falante em cima deles).
  const speakingPenguins = useMemo(() => {
    if (!inVoice) return '';
    const ids = [];
    if (speaking && presence.me) ids.push(presence.me);
    for (const p of presence.players || []) {
      if (p.userId && p.userId !== myUserId && parts[p.userId]?.speaking) ids.push(p.penguinId);
    }
    return ids.sort((a, b) => a - b).join(',');
  }, [inVoice, speaking, presence, parts, myUserId]);

  return {
    room: presence.room, // sala do jogo em que o pinguim está (jukebox da Danceteria)
    available: !!voice,
    talk: want.talk, listen: want.listen, inVoice, joining,
    speaking,
    speakingPenguins,
    someoneNearTalking,
    toggleTalk, toggleListen,
  };
}

// ---------------------------------------------------------------------------
// Botões Falar/Ouvir DENTRO da barra do jogo.
//
// Os botões são desenhados pelo próprio jogo: o servidor acrescenta um script
// ao interface.swf (server/waddle/praca-voice) que encurta a caixa do chat e
// põe dois botões iguais aos da barra no espaço que sobra. Como fazem parte da
// barra, somem junto com ela (minigame, edição do iglu, telas cheias…).
// A conversa com a página é pelo ExternalInterface do Ruffle:
//   jogo → página: window.pracaVoiceToggle('talk' | 'listen'), window.pracaVoiceReady()
//   página → jogo: player.pracaVoiceState(falar, ouvir, falando, ouvindoAlguém, conectando)
//                  player.pracaSpeaking("1000,1003") — quem está falando (balão no pinguim)
export function useInGameVoiceButtons(playerRef, v) {
  const vRef = useRef(v);
  vRef.current = v;
  const push = useCallback(() => {
    const s = vRef.current;
    try {
      playerRef.current?.pracaVoiceState?.(!!s.talk, !!s.listen, !!s.speaking, !!s.someoneNearTalking, !!(s.joining && !s.inVoice));
    } catch { /* o jogo ainda não registrou os botões */ }
  }, [playerRef]);
  useEffect(() => {
    window.pracaVoiceToggle = (kind) => {
      const s = vRef.current;
      // fora da chamada do Flash (o Ruffle não gosta de reentrada)
      setTimeout(() => { if (kind === 'talk') s.toggleTalk(); else if (kind === 'listen') s.toggleListen(); }, 0);
    };
    window.pracaVoiceReady = () => { setTimeout(push, 0); };
    return () => { delete window.pracaVoiceToggle; delete window.pracaVoiceReady; };
  }, [push]);
  useEffect(() => { push(); }, [v.talk, v.listen, v.speaking, v.someoneNearTalking, v.joining, v.inVoice, push]);
  // balões de "falando" em cima dos pinguins
  useEffect(() => {
    try { playerRef.current?.pracaSpeaking?.(v.speakingPenguins || ''); } catch { /* jogo carregando */ }
  }, [v.speakingPenguins, playerRef]);
}

// Limite diário de moedas do Club Penguin (o saldo é o do Project Club): avisa
// uma vez por dia quando o jogo para de pagar.
export function usePracaCoinCap() {
  const { socket } = useSocket() || {};
  useEffect(() => {
    if (!socket) return undefined;
    const onCap = ({ cap } = {}) => {
      const key = `pc.praca.cap.${new Date().toLocaleDateString('pt-BR')}`;
      try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { /* ok */ }
      useStore.getState().pushNotice(cap ? `Você já ganhou as ${cap} moedas de hoje no Club Penguin. Amanhã o jogo volta a pagar!` : 'Você já ganhou as moedas de hoje no Club Penguin. Amanhã o jogo volta a pagar!');
    };
    socket.on('praca:coin-cap', onCap);
    return () => { socket.off('praca:coin-cap', onCap); };
  }, [socket]);
}
