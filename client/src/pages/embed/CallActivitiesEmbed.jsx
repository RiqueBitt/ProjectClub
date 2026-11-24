import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSocket } from '../../context/SocketContext.jsx';
import { useYouTubeWatch, YouTubeStage, YouTubePicker, ActivitiesMenu, YouTubeToast } from '../../components/voice/YouTubeWatch.jsx';
import { CallMusicPicker } from '../../music/MusicPlayer.jsx';
import { DicePicker, CallDicePopup, useCallDice } from '../../components/activities/Dice.jsx';
import { SoundboardPanel } from '../../components/voice/Soundboard.jsx';
import '../../styles/voice.css';
import '../../styles/call-activities-embed.css';

// Atividades da call DENTRO do app Android (WebView transparente por cima da
// tela nativa da chamada). São os MESMOS componentes do PC — palco do vídeo/
// música, escolher vídeo/música, dados (com a mesma rolagem) e soundboard —
// pra ficar idêntico e sincronizado com quem está no PC.
//
// A voz continua no app nativo: esta página só "acompanha" a sala
// (socket activity:watch, sem ocupar a vaga). Conversa com o app pela ponte
// window.PcCall: avisa quanto espaço precisa (layout) e recebe comandos em
// window.__pcActivities (abrir o menu, quem está na call).
const bridge = () => (typeof window !== 'undefined' ? window.PcCall : null);

export default function CallActivitiesEmbed() {
  const { channelId } = useParams();
  const { socket } = useSocket() || {};
  const [viewers, setViewers] = useState([]);
  const [panel, setPanel] = useState(null); // 'menu' | 'youtube' | 'music' | 'dice' | 'soundboard'
  const [notInCall, setNotInCall] = useState(false);
  const stageRef = useRef(null);

  // Fundo transparente: por baixo aparece a tela nativa da chamada.
  useLayoutEffect(() => {
    document.documentElement.classList.add('pc-call-embed');
    return () => document.documentElement.classList.remove('pc-call-embed');
  }, []);

  useEffect(() => {
    if (!socket || !channelId) return undefined;
    const watch = () => socket.emit('activity:watch', { channelId });
    const onNot = (p) => { if (p?.channelId === channelId) setNotInCall(true); };
    const onJoinedAgain = () => setNotInCall(false);
    watch();
    socket.on('connect', watch);
    socket.on('activity:not-in-call', onNot);
    socket.on('yt:state', onJoinedAgain);
    // O app entra na call um pouco antes: tenta de novo enquanto não deu.
    const retry = setInterval(() => { if (notInCallRef.current) watch(); }, 4000);
    return () => {
      clearInterval(retry);
      socket.off('connect', watch);
      socket.off('activity:not-in-call', onNot);
      socket.off('yt:state', onJoinedAgain);
      socket.emit('activity:unwatch', { channelId });
    };
  }, [socket, channelId]);
  const notInCallRef = useRef(notInCall); notInCallRef.current = notInCall;

  const yt = useYouTubeWatch(channelId);
  const dice = useCallDice(channelId);
  const active = yt.active ? (yt.state?.mode === 'music' ? 'music' : 'youtube') : null;
  const close = useCallback(() => setPanel(null), []);

  const pick = useCallback((kind) => {
    if (kind === 'dice' || kind === 'soundboard') { setPanel(kind); return; }
    const want = kind || 'youtube';
    if (active && active !== want) { yt.setError?.(`Já tem uma atividade na chamada (${active === 'music' ? 'Música' : 'YouTube - Assistir juntos'}). Encerre antes de abrir outra.`); setPanel(null); return; }
    setPanel(want);
  }, [active, yt]);

  // Comandos do app nativo.
  useEffect(() => {
    window.__pcActivities = {
      open: (kind) => (kind && kind !== 'menu' ? pick(kind) : setPanel((p) => (p === 'menu' ? null : 'menu'))),
      close: () => setPanel(null),
      setViewers: (list) => setViewers(Array.isArray(list) ? list : []),
    };
    return () => { delete window.__pcActivities; };
  }, [pick]);

  // Quanto espaço a camada precisa na tela do app:
  //  full   = menu/escolha/dados aparecendo (cobre a área da chamada)
  //  stage  = só o palco do vídeo/música (altura em px)
  //  hidden = nada (a camada fica minúscula, mas viva pra ouvir os eventos)
  const mode = panel || dice.current || yt.error ? 'full' : (yt.active ? 'stage' : 'hidden');
  const [stageH, setStageH] = useState(0);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === 'undefined') { setStageH(0); return undefined; }
    const ro = new ResizeObserver(() => setStageH(Math.ceil(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [yt.active]);
  useEffect(() => {
    try { bridge()?.layout?.(JSON.stringify({ mode, height: stageH })); } catch { /* sem app */ }
  }, [mode, stageH]);

  return (
    <div className={`cae cae-${mode}`}>
      {yt.active && (
        <div className="cae-stage" ref={stageRef}>
          <div className="vc-screens vc-screens-1">
            <YouTubeStage yt={yt} viewers={viewers} onAdd={(kind) => pick(kind || 'youtube')} />
          </div>
        </div>
      )}
      {mode === 'full' && !dice.current && (panel === 'menu' || panel === 'soundboard') && (
        <button type="button" className="cae-backdrop" aria-label="Fechar" onClick={close} />
      )}
      {panel === 'menu' && (
        <div className="cae-sheet ytw-act-pop" role="menu" aria-label="Atividades">
          <ActivitiesMenu onPick={pick} active={active} soundboard />
        </div>
      )}
      {panel === 'soundboard' && <div className="cae-sheet cae-sb"><SoundboardPanel channelId={channelId} /></div>}
      {panel === 'youtube' && <YouTubePicker yt={yt} onClose={close} />}
      {panel === 'music' && <CallMusicPicker yt={yt} onClose={close} />}
      {panel === 'dice' && <DicePicker where="call" onRoll={dice.roll} onClose={close} />}
      {dice.current && <CallDicePopup key={`${dice.current.user?.id}-${dice.current.at}`} event={dice.current} onDone={dice.done} />}
      {panel && notInCall && <p className="cae-warn" role="status">Entrando na chamada… as atividades aparecem em instantes.</p>}
      <YouTubeToast yt={yt} />
    </div>
  );
}
