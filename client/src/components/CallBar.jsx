import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useVoice } from '../context/VoiceContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useStore } from '../store/useStore';
import ScreenShareModal from './modals/ScreenShareModal.jsx';
import CallIcon, { SignalBars, QUALITY_LABELS, signalTone } from './voice/CallIcons.jsx';
import ScreenQualityMenu from './voice/ScreenQualityMenu.jsx';
import MiniCallWindow from './voice/MiniCallWindow.jsx';
import { RecordingConsentModal, RecordingCapture } from './voice/CallExtras.jsx';
import { VoiceConnectionPanel } from './voice/VoiceExtras.jsx';
import '../styles/voice-extras.css';
import { api } from '../api/client';
import { getPreferredSpeakerId, setPreferredSpeakerId, getPreferredMicId, isOutputSelectionSupported, onSpeakerPreferenceChange, listAudioDevices } from '../utils/audioDevices';
import { getVoicePref, onVoicePrefsChange } from '../utils/voicePrefs';
import { RemoteTrackPlayer, resolveOutputSink, setContextSink } from '../voice/audioPlayback.js';
import { buildDiag, createOnceSet } from '../voice/playbackPlan.js';
import { CustomIcon, hasCustomIcon } from './ChannelIcon.jsx';
import { usePopoverCoordination } from '../utils/popoverCoordinator';
import '../styles/callbar.css';

// Barra de chamada (rodapé da coluna de canais) — visual refeito: status
// com sinal/ping do servidor de mídia, nome do canal clicável (abre a chamada), tempo
// de chamada, botões de ícone com dica e estado (mudo/ensurdecido em
// vermelho), menu de dispositivos e desligar. Também cuida da janelinha
// flutuante quando você sai da tela da chamada.

// Rota da tela "dona" da chamada (canal, DM ou clã).
function callViewPath(call) {
  if (!call?.channelId) return null;
  const id = String(call.channelId);
  if (id.startsWith('dm:')) return `/conversations/${id.slice(3)}`;
  if (id.startsWith('clan:')) return '/clans/mine';
  return `/channels/${id}`;
}

// Tempo desde que você entrou (mm:ss ou h:mm:ss).
function useCallElapsed(startedAt) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return null;
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Item pedido: "melhorando o sistema de conectar com microfone e
// saídas de áudio... o mais fácil possível" — antes, trocar de
// mic/saída DURANTE uma chamada só era possível saindo do fluxo e
// abrindo Configurações → Voz e Áudio. Esse menu rápido reaproveita a
// MESMA lógica já validada lá (switchMicrophone, getPreferred*Id),
// só que acessível com um clique direto na barra de chamada — sem
// sair de onde já está.
function AudioDeviceQuickMenu({ voice }) {
  const [open, setOpen] = useState(false);
  usePopoverCoordination(open, () => setOpen(false));
  const [mics, setMics] = useState([]);
  const [speakers, setSpeakers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // Força re-render depois de trocar (as preferências moram no storage).
  const [, setPickTick] = useState(0);
  const menuRef = useRef(null);

  const refreshDevices = async () => {
    try {
      const { mics: m, speakers: s } = await listAudioDevices();
      setMics(m);
      setSpeakers(s);
    } catch { /* sem permissão de mídia ainda — lista fica vazia */ }
    setLoaded(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    refreshDevices();
    const onDocClick = (e) => { if (!menuRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDocClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const currentMicId = getPreferredMicId();
  const currentSpeakerId = getPreferredSpeakerId();

  return (
    <div className={`audio-device-quick-menu-wrap cb-devwrap${open ? ' is-open' : ''}`} ref={menuRef}>
      <button
        type="button" className="cb-caret"
        aria-label="Escolher microfone e saída de áudio" aria-expanded={open} data-tip="Microfone e saída"
        onClick={() => setOpen((v) => !v)}
      >
        <CallIcon name="caretUp" size={14} strokeWidth={2.4} />
      </button>
      {open && (
        <div className="audio-device-quick-menu cb-devmenu" role="dialog" aria-label="Dispositivos de áudio">
          <div className="cb-devmenu-label"><CallIcon name="mic" size={14} /> Microfone</div>
          {!loaded && <div className="cb-devmenu-empty">Procurando…</div>}
          {loaded && mics.length === 0 && <div className="cb-devmenu-empty">Nenhum microfone encontrado</div>}
          {mics.map((d) => {
            const active = d.deviceId === currentMicId || (!currentMicId && d === mics[0]);
            return (
              <button
                key={d.deviceId} type="button" role="menuitemradio" aria-checked={active}
                className={`audio-device-quick-menu-item cb-devmenu-item${active ? ' active' : ''}`}
                onClick={async () => { await voice.switchMicrophone(d.deviceId); setPickTick((n) => n + 1); setOpen(false); }}
              >
                <span className="truncate">{d.label || 'Microfone'}</span>
                {active && <CallIcon name="check" size={15} strokeWidth={2.4} />}
              </button>
            );
          })}
          {isOutputSelectionSupported() && (
            <>
              <div className="cb-devmenu-sep" />
              <div className="cb-devmenu-label"><CallIcon name="headphones" size={14} /> Saída de áudio</div>
              {loaded && speakers.length === 0 && <div className="cb-devmenu-empty">Nenhuma saída encontrada</div>}
              {speakers.map((d) => {
                const active = d.deviceId === currentSpeakerId || (!currentSpeakerId && d === speakers[0]);
                return (
                  <button
                    key={d.deviceId} type="button" role="menuitemradio" aria-checked={active}
                    className={`audio-device-quick-menu-item cb-devmenu-item${active ? ' active' : ''}`}
                    onClick={() => { setPreferredSpeakerId(d.deviceId); setPickTick((n) => n + 1); setOpen(false); }}
                  >
                    <span className="truncate">{d.label || 'Saída de áudio'}</span>
                    {active && <CallIcon name="check" size={15} strokeWidth={2.4} />}
                  </button>
                );
              })}
            </>
          )}
          <div className="cb-devmenu-sep" />
          <button
            type="button" className="cb-devmenu-item cb-devmenu-settings"
            onClick={() => { setOpen(false); useStore.getState().openSettings?.(); }}
          >
            <CallIcon name="gear" size={15} />
            <span className="truncate">Abrir configurações</span>
          </button>
        </div>
      )}
    </div>
  );
}

// Botão de ícone da barra: dica própria (data-tip) + estados.
function CbButton({ icon, label, tip, onClick, disabled, state, className = '', pressed }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className={`cb-btn${state ? ` is-${state}` : ''} ${className}`}
      aria-label={label} aria-pressed={pressed} data-tip={tip || label}
    >
      <CallIcon name={icon} size={18} />
    </button>
  );
}

export default function CallBar() {
  const voice = useVoice();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showScreenShareMenu, setShowScreenShareMenu] = useState(false);
  // Painel "Voz conectada" (clique no status): estado, ping e perda no envio.
  const [showConn, setShowConn] = useState(false);
  usePopoverCoordination(showConn, () => setShowConn(false));
  const connWrapRef = useRef(null);
  useEffect(() => {
    if (!showConn) return undefined;
    const onDown = (e) => { if (!connWrapRef.current?.contains(e.target)) setShowConn(false); };
    const onKey = (e) => { if (e.key === 'Escape') setShowConn(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [showConn]);
  // Janelinha flutuante escondida pela pessoa: volta na próxima chamada
  // ou depois de abrir a tela da chamada de novo.
  const [miniHidden, setMiniHidden] = useState(false);
  const callId = voice?.call?.channelId;
  const viewPath = callViewPath(voice?.call);
  const onCallView = !!viewPath && location.pathname === viewPath;
  useEffect(() => { setMiniHidden(false); }, [callId]);
  useEffect(() => { if (onCallView) setMiniHidden(false); }, [onCallView]);
  const elapsed = useCallElapsed(voice?.callStartedAt);
  // Canal da chamada (pro ícone personalizado) — hook antes do return.
  const callChannelId = voice?.call?.channelId || null;
  const callChannel = useStore((s) => (callChannelId ? (s.channels.find((c) => c.id === callChannelId) || s.categories.flatMap((cat) => cat.channels || []).find((c) => c.id === callChannelId) || null) : null));
  if (!voice?.call) return null;

  const { call, muted, micMissing, deafened, cameraOn, screenOn, participants, myRole } = voice;
  // Most mobile browsers (iOS Safari especially) don't expose the Screen
  // Capture API to web pages at all. The Android app is a separate,
  // trickier case: since it's Chromium-based under the hood, the WebView
  // *does* define getDisplayMedia as a function — it just doesn't actually
  // implement the underlying capture picker, so calling it fails at
  // runtime instead of failing this feature check. That's worse than
  // simply being undefined: the button looked available and then silently
  // did nothing. window.Capacitor.isNativePlatform() is how the page tells
  // "running inside the actual Android app" apart from "a mobile browser
  // that just happens to lack the API", so this case gets its own accurate
  // message instead of both being lumped under one generic one.
  const isNativeApp = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
  // Item pedido: compartilhamento de tela no Android — agora tem um
  // caminho próprio (plugin nativo + canvas, ver
  // native/androidScreenShare.js), então deixa de estar bloqueado
  // nessa plataforma especificamente. iOS continua sem suporte (não foi
  // implementado ali) — window.Capacitor.getPlatform() distingue as
  // duas dentro do "app nativo" genérico.
  const isAndroidApp = isNativeApp && window.Capacitor?.getPlatform?.() === 'android';
  const screenShareSupported = isAndroidApp || (!isNativeApp && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia);
  const participantCount = Object.keys(participants).length + 1;
  const micLocked = call.channelType === 'STAGE' && myRole === 'audience';

  const myQuality = voice.netQuality?.[String(user?.id)] ?? 0;
  const tone = signalTone(myQuality);
  const pingText = voice.myRtt != null ? `${voice.myRtt} ms` : null;
  const statusText = call.channelType === 'DM' ? 'Em chamada' : 'Conectado por voz';
  const signalTip = pingText ? `${QUALITY_LABELS[myQuality] || QUALITY_LABELS[0]} · ping ${pingText}` : (QUALITY_LABELS[myQuality] || QUALITY_LABELS[0]);

  const micTip = micLocked ? 'Você é plateia: peça para falar'
    : micMissing ? 'Microfone não conectado: clique para tentar de novo'
      : muted ? 'Ativar microfone' : 'Silenciar';
  const screenTip = !screenShareSupported
    ? (isNativeApp ? 'Compartilhar tela não é suportado no app iOS: use pelo navegador' : 'Compartilhar tela não é suportado neste navegador')
    : screenOn ? 'Parar de compartilhar tela' : 'Compartilhar tela';
  const canPickScreenQuality = screenOn && !isAndroidApp && typeof voice.setScreenShareQuality === 'function';

  return (
    <div className={`call-bar cb cb-tone-${tone}`}>
      <div className="cb-inner">
      <div className="cb-info">
      <div className="cb-head">
        <div ref={connWrapRef} style={{ display: 'contents' }}>
          <div
            className="cb-status" data-tip={showConn ? undefined : signalTip} tabIndex={0} aria-label={signalTip} role="button"
            aria-expanded={showConn} onClick={() => setShowConn((v) => !v)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowConn((v) => !v); } }}
          >
            <SignalBars quality={myQuality} />
            <span className="cb-status-text truncate">{voice.reconnecting ? (voice.connectionInfo?.label || 'Reconectando') : statusText}</span>
            {pingText && <span className="cb-ping">{pingText}</span>}
          </div>
          {showConn && <VoiceConnectionPanel voice={voice} className="cb-conn-pop" />}
        </div>
        {/* Modo reserva (Jitsi): avisa discretamente que a mídia está no
            provedor de backup. Ver docs/voice-fallback.md. */}
        {voice.fallbackActive && (
          <span className="cb-backup" data-tip={`Chamada em modo reserva (provedor ${voice.providerLabel || 'de backup'})`} aria-label="Chamada em modo reserva">
            {voice.reconnectingProvider ? 'Reconectando…' : `Modo reserva${voice.providerLabel ? ` · ${voice.providerLabel}` : ''}`}
          </span>
        )}
        {voice.reconnecting && (
          <span className="cb-backup cb-reconnecting" role="status" aria-live="polite">Reconectando…</span>
        )}
        {elapsed && <span className="cb-time" aria-label="Tempo de chamada">{elapsed}</span>}
      </div>

      {/* Ícone personalizado do canal (emoji/imagem) também na barra da chamada. */}
      <div className="cb-chan-row">
        <button
          type="button" className="cb-chan" onClick={() => viewPath && navigate(viewPath)}
          disabled={!viewPath || onCallView} data-tip={onCallView ? undefined : 'Abrir a chamada'}
          aria-label={onCallView ? (call.channelName || 'Chamada') : 'Abrir a chamada'}
        >
          {hasCustomIcon(callChannel) ? <CustomIcon item={callChannel} className="cb-chan-custom-icon" /> : <CallIcon name="speaker" size={14} />}
          <span className="truncate">{call.channelName}</span>
          {!onCallView && <CallIcon name="chevron" size={14} className="cb-chan-go" />}
        </button>
        <span className="cb-count" aria-label="Pessoas na chamada" data-tip="Pessoas na chamada">
          <CallIcon name="people" size={13} /> {participantCount}
        </span>
      </div>

      </div>

      <div className="call-bar-controls cb-controls" role="toolbar" aria-label="Controles da chamada">
        <div className={`cb-split${muted || micMissing ? ' is-off' : ''}`}>
          <CbButton
            icon={micLocked ? 'hand' : (muted || micMissing ? 'micOff' : 'mic')}
            label={micTip} onClick={voice.toggleMute} disabled={micLocked}
            state={!micLocked && (muted || micMissing) ? 'off' : null} pressed={!micLocked ? muted : undefined}
          />
          {!micLocked && <AudioDeviceQuickMenu voice={voice} />}
        </div>
        <CbButton
          icon={deafened ? 'headphonesOff' : 'headphones'}
          label={deafened ? 'Voltar a ouvir' : 'Ensurdecer'}
          onClick={voice.toggleDeafen} state={deafened ? 'off' : null} pressed={deafened}
        />
        <CbButton
          icon="camera" label={cameraOn ? 'Desligar câmera' : 'Ligar câmera'}
          onClick={voice.toggleCamera} state={cameraOn ? 'on' : null} pressed={cameraOn}
        />
        <div className={`cb-split${screenOn ? ' is-on' : ''}${canPickScreenQuality ? '' : ' is-single'}`}>
          <CbButton
            icon={screenOn ? 'screenOn' : 'screen'} label={screenTip}
            onClick={() => (screenOn || isAndroidApp ? voice.toggleScreenShare() : setShowScreenShareMenu(true))}
            disabled={!screenShareSupported} state={screenOn ? 'on' : null} pressed={screenOn}
          />
          {canPickScreenQuality && <ScreenQualityMenu voice={voice} className="cb-sqm" />}
        </div>
        <CbButton icon="hangup" label="Desconectar" onClick={voice.leaveChannel} className="cb-hangup" />
      </div>
      </div>

      <RemoteAudioSinks />
      {/* Pedido de consentimento de gravação (N): precisa aparecer em
          qualquer tela, por isso vive aqui na barra (sempre montada
          durante a chamada), não só na tela do canal. */}
      <RecordingConsentModal voice={voice} />
      <RecordingCapture voice={voice} meId={user?.id} />
      {showScreenShareMenu && (
        <ScreenShareModal
          onClose={() => setShowScreenShareMenu(false)}
          onShare={(options) => voice.toggleScreenShare(options)}
        />
      )}
      {!onCallView && !miniHidden && (
        <MiniCallWindow voice={voice} onBack={() => viewPath && navigate(viewPath)} onHide={() => setMiniHidden(true)} />
      )}
    </div>
  );
}

// <audio> invisíveis que tocam o microfone de cada pessoa da chamada —
// montados na barra (sempre presente durante a call), não na tela do canal,
// pra o áudio seguir tocando enquanto você navega pelo app.
//
// Reprodução: voice/audioPlayback.js (RemoteTrackPlayer) — um <audio> por
// faixa remota como caminho principal; Web Audio só pra >100% / auto nivelar
// com o AudioContext rodando; auto-cura e nova tentativa no próximo gesto.
// Volume por pessoa, ensurdecer e saída escolhida continuam valendo.
function RemoteAudioSinks() {
  const voice = useVoice();
  const { remoteAudioStreams, deafened, volumes } = voice;
  const remoteScreenAudioStreams = voice.remoteScreenAudioStreams || {};
  const streamVolumes = voice.streamVolumes || {};
  // Item pedido E ("auto nivelar volume"): quando ligado, cada voz passa
  // por um compressor leve que aproxima os volumes — quem fala baixo fica
  // mais audível e quem fala alto não estoura. Local-only (só no SEU áudio).
  const [autoLevel, setAutoLevel] = useState(() => getVoicePref('autoLevelVolume') === true);
  useEffect(() => onVoicePrefsChange((p) => setAutoLevel(p.autoLevelVolume === true)), []);
  // Saída de áudio escolhida, conferida contra os aparelhos de verdade:
  // null = não dá pra saber (sem permissão) → não mexe.
  const [sinkId, setSinkId] = useState(null);
  useEffect(() => {
    let alive = true;
    const resolve = async () => {
      let saved = '';
      try { saved = getPreferredSpeakerId(); } catch { /* sem storage */ }
      if (!isOutputSelectionSupported()) { if (alive) setSinkId(null); return; }
      const r = await resolveOutputSink(saved);
      if (!alive) return;
      if (r.stale) {
        // Saída salva que não existe mais neste aparelho (fone desconectado,
        // id de outro navegador): esquece e usa a padrão — antes o som ia pra
        // "lugar nenhum" e a pessoa não ouvia a call.
        try { localStorage.removeItem('voice.preferredSpeakerId'); } catch { /* ok */ }
      }
      setSinkId(r.sinkId);
      if (r.sinkId != null) setContextSink(r.sinkId);
    };
    resolve();
    // Troca de saída em tempo real (menu/configurações) e fone plugado/tirado.
    const unsubscribe = onSpeakerPreferenceChange(() => { resolve(); });
    const md = navigator.mediaDevices;
    try { md?.addEventListener?.('devicechange', resolve); } catch { /* ok */ }
    return () => {
      alive = false;
      try { unsubscribe(); } catch { /* ok */ }
      try { md?.removeEventListener?.('devicechange', resolve); } catch { /* ok */ }
    };
  }, []);
  const callKey = `${voice.call?.channelId || ''}|${voice.callStartedAt || ''}`;
  return (
    <>
      {Object.entries(remoteAudioStreams).map(([userId, stream]) => (
        <AudioSink
          key={userId} userId={userId} stream={stream}
          volume={deafened ? 0 : (volumes[userId] ?? 1)} autoLevel={autoLevel} sinkId={sinkId}
          getInboundBytes={voice.getInboundAudioBytes} provider={voice.provider} callKey={callKey}
        />
      ))}
      {/* Som da tela de cada pessoa: player próprio, com o "volume da
          transmissão" (separado do volume da voz). */}
      {Object.entries(remoteScreenAudioStreams).map(([userId, stream]) => (
        <AudioSink
          key={`${userId}#tela`} userId={userId} stream={stream}
          volume={deafened ? 0 : (streamVolumes[userId] ?? 1)} autoLevel={false} sinkId={sinkId}
          getInboundBytes={null} provider={voice.provider} callKey={`${callKey}#tela`}
        />
      ))}
    </>
  );
}

// Aviso de autoplay bloqueado: no máximo 1 a cada 30s (antes era 1 por pessoa).
let lastBlockedNoticeAt = 0;
function noticeAutoplayBlocked() {
  if (Date.now() - lastBlockedNoticeAt < 30000) return;
  lastBlockedNoticeAt = Date.now();
  try {
    useStore.getState().pushNotice('O navegador bloqueou a reprodução automática do áudio da chamada — toque ou clique em qualquer lugar da tela pra ativar o som.');
  } catch { /* ok */ }
}

// Diagnóstico "voz-diag": 1 por call por pessoa remota, compacto, com os
// bytes RTP recebidos dela (prova se é rede ou reprodução).
const diagOnce = createOnceSet();

// Uma pessoa pode ter mais de uma faixa de áudio (microfone + áudio da tela):
// cada uma no seu <audio>.
function AudioSink({ stream, ...rest }) {
  const [tracks, setTracks] = useState(() => (stream ? stream.getAudioTracks() : []));
  useEffect(() => {
    if (!stream) { setTracks([]); return undefined; }
    const update = () => setTracks(stream.getAudioTracks());
    update();
    try { stream.addEventListener('addtrack', update); stream.addEventListener('removetrack', update); } catch { /* ok */ }
    return () => {
      try { stream.removeEventListener('addtrack', update); stream.removeEventListener('removetrack', update); } catch { /* ok */ }
    };
  }, [stream]);
  return tracks.map((t) => <TrackSink key={t.id} track={t} {...rest} />);
}

function TrackSink({ track, userId, volume, autoLevel, sinkId, getInboundBytes, provider, callKey }) {
  const playerRef = useRef(null);
  // Valores mais recentes pra quem roda fora do render (timers do player).
  const latestRef = useRef({});
  latestRef.current = { volume, autoLevel, sinkId, getInboundBytes, provider, callKey };

  useEffect(() => {
    let player = null;
    try {
      player = new RemoteTrackPlayer({
        track, userId,
        getInboundBytes: () => latestRef.current.getInboundBytes?.(userId) ?? null,
        onBlocked: noticeAutoplayBlocked,
      });
    } catch (err) {
      console.error('[voz] não foi possível tocar o áudio de', userId, err);
      return undefined;
    }
    playerRef.current = player;
    const l = latestRef.current;
    player.setAutoLevel(l.autoLevel);
    player.setVolume(l.volume);
    if (l.sinkId != null) player.setSinkId(l.sinkId);

    const diagTimer = setTimeout(() => {
      try {
        const cur = latestRef.current;
        if (!diagOnce.first(`${cur.callKey}|${userId}`)) return;
        const st = player.state();
        const info = buildDiag({
          userId, provider: cur.provider, mode: st.mode, el: player.el, track,
          ctxState: st.ctx, inboundBytes: cur.getInboundBytes?.(userId) ?? null,
          sinkCustom: !!st.sinkId, ua: navigator.userAgent,
        });
        info.h = st.heals;
        if (st.blocked) info.bl = 1;
        api.post('/system/client-error', { where: 'voz-diag', path: window.location.pathname, message: JSON.stringify(info) }).catch(() => {});
      } catch { /* diagnóstico nunca atrapalha */ }
    }, 8000);

    return () => {
      clearTimeout(diagTimer);
      if (playerRef.current === player) playerRef.current = null;
      try { player.dispose(); } catch { /* já desmontado */ }
    };
  }, [track, userId]);

  useEffect(() => { try { playerRef.current?.setVolume(volume); } catch { /* ok */ } }, [volume]);
  useEffect(() => { try { playerRef.current?.setAutoLevel(autoLevel); } catch { /* ok */ } }, [autoLevel]);
  useEffect(() => { try { if (sinkId != null) playerRef.current?.setSinkId(sinkId); } catch { /* ok */ } }, [sinkId]);

  return null;
}
