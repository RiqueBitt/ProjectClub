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
import dockBarSvg from './assets/dock-bar.svg?raw';
import dockButtonArt from './assets/dock-button.png';

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
// A barra de baixo do jogo está na tela?
//
// O cliente do Club Penguin esconde a barra em minigame, editando o iglu, em
// salas "solo", na abertura… Não há evento disso pra página, então a cada
// ~0,4 s lemos duas faixas finas do quadro do jogo exatamente onde fica a
// borda de cima da barra (palco 760x480): o aro ciano (y≈441–443) e o azul do
// corpo (y≈444–445.5), de x=110 a x=640. As duas faixas só batem quando a
// barra está lá. Se não der pra ler o quadro (renderizador sem leitura), os
// botões ficam visíveis como antes.
const DOCK_STRIP = { x: 110, w: 530 };
const DOCK_RIM = { y: 441, h: 2.5, rgb: [0, 185, 242], tol: 70 };
const DOCK_BODY = { y: 444, h: 1.5, rgb: [2, 128, 205], tol: 55 };
const PROBE_W = 48;

function bandMatches(data, row, ref) {
  let ok = 0;
  for (let i = 0; i < PROBE_W; i += 1) {
    const o = (row * PROBE_W + i) * 4;
    const d = Math.abs(data[o] - ref.rgb[0]) + Math.abs(data[o + 1] - ref.rgb[1]) + Math.abs(data[o + 2] - ref.rgb[2]);
    if (data[o + 3] > 200 && d <= ref.tol) ok += 1;
  }
  return ok / PROBE_W;
}

export function useGameDockVisible(playerRef, enabled) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!enabled) { setVisible(true); return undefined; }
    const probe = document.createElement('canvas');
    probe.width = PROBE_W; probe.height = 2;
    const ctx = probe.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    let current = true; let pending = null; let streak = 0;
    const tick = () => {
      const c = playerRef.current?.shadowRoot?.querySelector('canvas');
      if (!c || !c.width || !c.height) return;
      const kx = c.width / 760; const ky = c.height / 480;
      let data;
      try {
        ctx.clearRect(0, 0, PROBE_W, 2);
        ctx.drawImage(c, DOCK_STRIP.x * kx, DOCK_RIM.y * ky, DOCK_STRIP.w * kx, DOCK_RIM.h * ky, 0, 0, PROBE_W, 1);
        ctx.drawImage(c, DOCK_STRIP.x * kx, DOCK_BODY.y * ky, DOCK_STRIP.w * kx, DOCK_BODY.h * ky, 0, 1, PROBE_W, 1);
        data = ctx.getImageData(0, 0, PROBE_W, 2).data;
      } catch { return; }
      // quadro ilegível (tudo transparente): não dá pra saber → mostra
      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque += 1;
      const next = opaque === 0 ? true : (bandMatches(data, 0, DOCK_RIM) >= 0.8 && bandMatches(data, 1, DOCK_BODY) >= 0.8);
      // troca só depois de 2 leituras iguais (sem piscar nas transições)
      if (next === current) { pending = null; streak = 0; return; }
      if (pending === next) streak += 1; else { pending = next; streak = 1; }
      if (streak >= 2) { current = next; pending = null; streak = 0; setVisible(next); }
    };
    const id = setInterval(tick, 400);
    tick();
    return () => clearInterval(id);
  }, [enabled, playerRef]);
  return visible;
}

// ---------------------------------------------------------------------------
// Botões FAZENDO PARTE da barra de baixo do jogo, com a arte do PRÓPRIO jogo
// (tirada do interface.swf): o desenho vetorial da barra (assets/dock-bar.svg)
// e o botão redondo da barra já com os efeitos dele (assets/dock-button.png).
// O pedaço novo é um trecho reto da barra + a ponta direita original, colado
// depois do botão de configurações, com os dois botões no mesmo espaçamento
// dos outros (30 px). Posições em pixels do palco 760x480, medidas no quadro
// do jogo:
//   barra: y 435 (contorno) → 476.25 (moldura branca do jogo cobre o resto)
//   botões: 27,875 px, canto em y 447,31; configurações em x 619,23
// Dali pra direita o jogo não tem botão nenhum (os do iglu ficam acima,
// y<410, e o de salvar só aparece com a barra escondida — quando estes botões
// também somem). Ícones: microfone (falar) e headset (ouvir); desligado =
// risco vermelho de "proibido" por cima.

function BanLine() {
  return (
    <svg className="pvb-ban" viewBox="0 0 100 100" aria-hidden="true">
      <line x1="20" y1="20" x2="80" y2="80" stroke="#000" strokeWidth="19" strokeLinecap="round" />
      <line x1="20" y1="20" x2="80" y2="80" stroke="#e8141b" strokeWidth="11" strokeLinecap="round" />
      <line x1="23" y1="21" x2="47" y2="45" stroke="#ff7a7a" strokeWidth="3" strokeLinecap="round" opacity=".8" />
    </svg>
  );
}

function VoiceBtn({ on, icon, hint, label, onClick, glow, busy }) {
  return (
    <button
      type="button" onClick={onClick}
      className={`pvb-btn${on ? ' is-on' : ' is-off'}${glow ? ' is-active' : ''}${busy ? ' is-busy' : ''}`}
      aria-pressed={on} aria-label={`${label}: ${on ? 'ligado' : 'desligado'}`}
    >
      <img className="pvb-icon" src={icon} alt="" draggable="false" />
      {!on && <BanLine />}
      <span className="pvb-hint" aria-hidden="true">{hint}</span>
    </button>
  );
}

// Caminhos vetoriais da barra (já em coordenadas do palco: x 94–666, y 435–480).
const DOCK_PATHS = (dockBarSvg.match(/<path[^>]*\/>/g) || []).join('');

// (máscara em vez de clipPath: a máscara recorta o grupo já pintado, sem
// deixar fio claro nas emendas entre as camadas da barra)
// O pedaço de barra é desenhado num SVG do tamanho do palco inteiro, nas
// coordenadas do próprio jogo — assim cai no mesmo subpixel que o Ruffle usa
// pra barra original (sem degrau na emenda).
//   trecho reto: a barra de x=400 em diante, deslocada pra começar em 647,1
//   (em cima, desde 643: cobre o começo da curva da ponta original, acima
//   do botão de configurações)
//   ponta: a ponta original (x 646–668) deslocada 60 px pra direita
function DockExtensionArt() {
  return (
    <svg className="pvb-art" viewBox="0 0 760 480" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <mask id="pvb-clip-mid" maskUnits="userSpaceOnUse" x="0" y="0" width="760" height="480"><rect x="647.1" y="430" width="59.4" height="46.25" fill="#fff" /><rect x="643" y="430" width="5" height="17" fill="#fff" /></mask>
        <mask id="pvb-clip-end" maskUnits="userSpaceOnUse" x="0" y="0" width="760" height="480"><rect x="706" y="430" width="30" height="46.25" fill="#fff" /></mask>
      </defs>
      <g mask="url(#pvb-clip-mid)"><g transform="translate(247.1 0)" dangerouslySetInnerHTML={{ __html: DOCK_PATHS }} /></g>
      <g mask="url(#pvb-clip-end)"><g transform="translate(60 0)" dangerouslySetInnerHTML={{ __html: DOCK_PATHS }} /></g>
    </svg>
  );
}

export function PracaVoiceButtons({ v }) {
  if (!v.available) return null;
  const busy = v.joining && !v.inVoice;
  return (
    <>
    <DockExtensionArt />
    <div className="pvb" role="toolbar" aria-label="Voz por proximidade" style={{ '--pvb-btn': `url("${dockButtonArt}")` }}>
      <VoiceBtn
        on={v.talk} icon={micIcon} label="Falar" onClick={v.toggleTalk}
        glow={v.speaking} busy={busy && v.talk}
        hint={v.talk ? 'Microfone ligado' : 'Microfone desligado'}
      />
      <VoiceBtn
        on={v.listen} icon={headsetIcon} label="Ouvir" onClick={v.toggleListen}
        glow={v.someoneNearTalking} busy={busy && v.listen}
        hint={v.listen ? 'Ouvindo quem está perto' : 'Sem ouvir ninguém'}
      />
    </div>
    </>
  );
}
