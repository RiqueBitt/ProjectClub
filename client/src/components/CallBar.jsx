import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useVoice } from '../context/VoiceContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useStore } from '../store/useStore';
import ScreenShareModal from './modals/ScreenShareModal.jsx';
import CallIcon, { SignalBars, QUALITY_LABELS, signalTone } from './voice/CallIcons.jsx';
import ScreenQualityMenu from './voice/ScreenQualityMenu.jsx';
import MiniCallWindow from './voice/MiniCallWindow.jsx';
import { getPreferredSpeakerId, setPreferredSpeakerId, getPreferredMicId, isOutputSelectionSupported, onSpeakerPreferenceChange, listAudioDevices } from '../utils/audioDevices';
import { usePopoverCoordination } from '../utils/popoverCoordinator';
import '../styles/callbar.css';

// Barra de chamada (rodapé da coluna de canais) — visual refeito: status
// com sinal/ping do Agora, nome do canal clicável (abre a chamada), tempo
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
  // Janelinha flutuante escondida pela pessoa: volta na próxima chamada
  // ou depois de abrir a tela da chamada de novo.
  const [miniHidden, setMiniHidden] = useState(false);
  const callId = voice?.call?.channelId;
  const viewPath = callViewPath(voice?.call);
  const onCallView = !!viewPath && location.pathname === viewPath;
  useEffect(() => { setMiniHidden(false); }, [callId]);
  useEffect(() => { if (onCallView) setMiniHidden(false); }, [onCallView]);
  const elapsed = useCallElapsed(voice?.callStartedAt);
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
        <div className="cb-status" data-tip={signalTip} tabIndex={0} aria-label={signalTip}>
          <SignalBars quality={myQuality} />
          <span className="cb-status-text truncate">{statusText}</span>
          {pingText && <span className="cb-ping">{pingText}</span>}
        </div>
        {elapsed && <span className="cb-time" aria-label="Tempo de chamada">{elapsed}</span>}
      </div>

      <div className="cb-chan-row">
        <button
          type="button" className="cb-chan" onClick={() => viewPath && navigate(viewPath)}
          disabled={!viewPath || onCallView} data-tip={onCallView ? undefined : 'Abrir a chamada'}
          aria-label={onCallView ? (call.channelName || 'Chamada') : 'Abrir a chamada'}
        >
          <CallIcon name="speaker" size={14} />
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

// Invisible <audio> elements that actually play back every remote peer's
// mic — kept mounted at the app-shell level (not inside the per-channel
// voice view) so audio keeps flowing even while you're browsing text
// channels or other servers during the call.
function RemoteAudioSinks() {
  const voice = useVoice();
  const { remoteAudioStreams, deafened, volumes } = voice;
  return (
    <>
      {Object.entries(remoteAudioStreams).map(([userId, stream]) => (
        <AudioSink key={userId} stream={stream} volume={deafened ? 0 : (volumes[userId] ?? 1)} />
      ))}
    </>
  );
}

// Echo/feedback remover for remote playback.
//
// The "eco que vai afinando até ficar fino e travar" report is a classic
// acoustic feedback runaway: mic -> speaker -> picked up by mic again ->
// sent back -> played again, each pass a little louder than the last (this
// is *acoustic* feedback through the air, not something getUserMedia's own
// echoCancellation can fully catch — that flag cancels echo the browser can
// correlate with audio IT is playing on ITS OWN output, it can't reach
// across the room to a different physical device/speaker). Left unchecked,
// each pass also pushes further into clipping, and clipping harmonics are
// what make a runaway loop sound like it's rising in pitch right before it
// cuts out.
//
// Instead of feeding the remote stream straight to an <audio> element, it's
// routed through a small Web Audio graph:
//   MediaStreamAudioSourceNode -> DynamicsCompressorNode (hard limiter) -> GainNode -> destination
// The compressor is the actual "echo remover" here: it hard-caps how loud
// the output can get, so a feedback loop's per-pass amplification has
// nowhere to grow — it gets squashed back down every time round, instead of
// climbing until it clips and cuts out. This doesn't replace using
// headphones (nothing running purely in the browser can undo *acoustic*
// feedback between two separate physical devices), but it stops the
// runaway/rising-pitch/cutoff failure mode.
function AudioSink({ stream, volume }) {
  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const gainRef = useRef(null);

  useEffect(() => {
    if (!stream) return undefined;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      // No Web Audio support at all — fall back to plain playback rather
      // than silence, even without the limiter.
      // BUG CORRIGIDO: faltava chamar .play() aqui — só definir srcObject
      // num <audio> sem o atributo autoplay NUNCA começa a tocar sozinho.
      // Esse caminho (só usado em navegadores raros sem AudioContext) IA
      // pro DOM certinho mas nunca produzia som nenhum, com o mesmo
      // silêncio sem erro visível do bug de cima.
      if (audioRef.current) {
        audioRef.current.srcObject = stream;
        audioRef.current.play().catch(() => {
          useStore.getState().pushNotice('O navegador bloqueou a reprodução automática do áudio da chamada — toque ou clique em qualquer lugar da tela pra ativar o som.');
        });
      }
      return undefined;
    }
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    // BUG CORRIGIDO ("voz sai fraca/desanimada"): o limitador de dinâmica
    // (DynamicsCompressor) que existia aqui foi criado na época da malha
    // própria de WebRTC, pra evitar um loop de eco que ia se
    // realimentando e ficando cada vez mais alto até travar — um risco
    // real numa topologia peer-to-peer. Migrado pro Agora (SFU
    // centralizado, com cancelamento de eco de verdade cuidado pela
    // própria infraestrutura deles), esse risco específico não existe
    // mais — mas o compressor continuava ativo, achatando a dinâmica de
    // QUALQUER fala normal (não só picos de eco), o que é exatamente o
    // que deixa uma voz soando "morta"/sem vida. Sem ele, a faixa de
    // áudio vai direto da fonte pro ganho, sem coloração nenhuma no meio.
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gainRef.current = gain;
    source.connect(gain);
    // Em vez de mandar direto pro alto-falante padrão (ctx.destination),
    // manda pra um <audio> escondido — só um elemento HTML de mídia
    // suporta escolher a saída de áudio (setSinkId), então é a única forma
    // de deixar o usuário escolher fones/caixa de som numa chamada e ainda
    // manter o limitador de eco/volume por cima.
    const destinationNode = ctx.createMediaStreamDestination();
    gain.connect(destinationNode);
    // BUG CORRIGIDO ("não sai áudio nenhum, no PC ou no celular"): esse
    // .play() tinha um .catch(() => {}) que ENGOLIA silenciosamente
    // qualquer falha — e navegadores (principalmente celular, mas às
    // vezes PC também) bloqueiam reprodução automática de áudio se
    // considerarem que já passou tempo/eventos demais desde o último
    // gesto de verdade da pessoa (clicar em "Entrar no canal" conta,
    // mas até esse áudio remoto chegar — depois de toda a negociação
    // WebRTC/ICE — esse gesto já pode ter "expirado" na visão do
    // navegador). Resultado: a chamada conecta perfeitamente (o outro
    // lado aparece na tela, o ícone de "falando" pisca certinho), mas
    // NENHUM som sai — sem erro nenhum visível em lugar nenhum, porque o
    // catch vazio escondia exatamente esse erro. Agora, se o play()
    // falhar, um aviso real aparece pra pessoa E a reprodução é
    // tentada de novo automaticamente assim que ela interagir com a
    // página de qualquer jeito (clique/toque/tecla) — sem precisar
    // sair e entrar de novo no canal pra "destravar" o áudio.
    let retryCleanup = null;
    const tryPlay = () => {
      if (!audioRef.current) return;
      audioRef.current.play().catch(() => {
        if (retryCleanup) return; // já tem uma tentativa de retry armada
        useStore.getState().pushNotice('O navegador bloqueou a reprodução automática do áudio da chamada — toque ou clique em qualquer lugar da tela pra ativar o som.');
        const retry = () => {
          ctx.resume().catch(() => {});
          audioRef.current?.play().then(() => { retryCleanup?.(); retryCleanup = null; }).catch(() => {});
        };
        document.addEventListener('click', retry);
        document.addEventListener('touchend', retry);
        document.addEventListener('keydown', retry);
        retryCleanup = () => {
          document.removeEventListener('click', retry);
          document.removeEventListener('touchend', retry);
          document.removeEventListener('keydown', retry);
        };
      });
    };
    if (audioRef.current) {
      audioRef.current.srcObject = destinationNode.stream;
      tryPlay();
      const preferredSpeakerId = getPreferredSpeakerId();
      if (preferredSpeakerId && isOutputSelectionSupported()) {
        audioRef.current.setSinkId(preferredSpeakerId).catch(() => {});
      }
    }
    // Autoplay-policy: a context created outside a direct click handler can
    // start 'suspended'. Joining a call always starts from a button click,
    // so this should already be allowed, but resume() defensively in case
    // it isn't (e.g. a peer's audio arriving slightly after that gesture).
    ctx.resume().catch(() => {});

    // Troca de saída de áudio em tempo real (menu de configurações) — sem
    // isso, teria que sair e voltar da chamada pra aplicar a escolha.
    const unsubscribe = onSpeakerPreferenceChange((speakerId) => {
      if (audioRef.current && isOutputSelectionSupported()) {
        audioRef.current.setSinkId(speakerId || '').catch(() => {});
      }
    });

    return () => {
      retryCleanup?.();
      unsubscribe();
      // BUG CORRIGIDO: aqui ainda citava o `compressor` (removido) — o erro
      // interrompia a limpeza e o ganho/destino ficavam conectados.
      try { source.disconnect(); gain.disconnect(); destinationNode.disconnect(); } catch { /* already torn down */ }
      // Sem isso, o elemento <audio> escondido podia continuar tocando o
      // que já tinha em buffer mesmo depois do grafo WebAudio desconectado
      // — parar e limpar o srcObject explicitamente garante silêncio
      // imediato assim que a chamada com essa pessoa termina.
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.srcObject = null;
      }
      destinationNode.stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      if (audioCtxRef.current === ctx) audioCtxRef.current = null;
    };
  }, [stream]);

  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = volume;
    else if (audioRef.current) audioRef.current.volume = Math.min(1, volume); // no-Web-Audio fallback path (<audio> não passa de 100%)
  }, [volume]);

  // Kept mounted (hidden) purely so autoplay-permission behavior for this
  // tab doesn't change from before; actual playback happens through the
  // AudioContext graph above once Web Audio is available.
  return <audio ref={audioRef} hidden />;
}
