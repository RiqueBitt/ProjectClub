import { useEffect, useRef, useState } from 'react';
import { useVoice } from '../context/VoiceContext.jsx';
import { useStore } from '../store/useStore';
import IconGlyph from './IconGlyph.jsx';
import ScreenShareModal from './modals/ScreenShareModal.jsx';
import speakerIcon from '../assets/icons/speaker.png';
// Ícones adaptados do Jitsi Meet (Apache-2.0) — mesmo pacote de SVGs usado
// na barra de chamada deles, convertidos pra PNG no mesmo padrão visual
// já usado no resto do projeto (preto sólido, funciona com mask-image).
import micIcon from '../assets/icons/nav-mic-jitsi.png';
import micMutedIcon from '../assets/icons/nav-mic-muted-jitsi.png';
import videoCallIcon from '../assets/icons/nav-video-jitsi.png';
import callEndIcon from '../assets/icons/nav-hangup-jitsi.png';
import screenshareIcon from '../assets/icons/nav-screenshare-jitsi.png';
import volumeUpIcon from '../assets/icons/nav-volume-up-jitsi.png';
import volumeOffIcon from '../assets/icons/nav-volume-off-jitsi.png';
import raiseHandIcon from '../assets/icons/nav-raise-hand-jitsi.png';
import { getPreferredSpeakerId, isOutputSelectionSupported, onSpeakerPreferenceChange } from '../utils/audioDevices';

export default function CallBar() {
  const voice = useVoice();
  const [showScreenShareMenu, setShowScreenShareMenu] = useState(false);
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

  return (
    <div className="call-bar">
      <div className="call-bar-info"><img className="ui-icon-sm" src={speakerIcon} alt="" /> {call.channelType === 'DM' ? 'Em chamada' : 'Conectado por voz'}</div>
      <div className="call-bar-channel truncate">{call.channelName}</div>
      <div className="call-bar-controls">
        <button
          className={`icon-btn ${muted ? 'danger-toggle' : ''}`}
          title={micLocked ? 'Você é plateia — peça para falar' : (micMissing ? 'Microfone não conectado — toque para tentar de novo' : (muted ? 'Ativar microfone' : 'Silenciar'))}
          onClick={voice.toggleMute}
          disabled={micLocked}
        >
          {micLocked ? <IconGlyph src={raiseHandIcon} size={18} /> : (micMissing ? '🎙️🚫' : <IconGlyph src={muted ? micMutedIcon : micIcon} size={18} />)}
        </button>
        <button className={`icon-btn ${deafened ? 'danger-toggle' : ''}`} title={deafened ? 'Reativar áudio' : 'Ensurdecer'} onClick={voice.toggleDeafen}>
          <IconGlyph src={deafened ? volumeOffIcon : volumeUpIcon} size={18} />
        </button>
        <button className={`icon-btn ${cameraOn ? 'on' : ''}`} title="Câmera" onClick={voice.toggleCamera}><IconGlyph src={videoCallIcon} size={18} /></button>
        <button
          className={`icon-btn ${screenOn ? 'on' : ''}`}
          title={screenShareSupported ? (screenOn ? 'Parar de compartilhar tela' : 'Compartilhar tela') : (isNativeApp ? 'Compartilhar tela não é suportado no app iOS — use pelo navegador' : 'Compartilhar tela não é suportado neste navegador')}
          onClick={() => (screenOn || isAndroidApp ? voice.toggleScreenShare() : setShowScreenShareMenu(true))}
          disabled={!screenShareSupported}
        >
          <IconGlyph src={screenshareIcon} size={18} />
        </button>
        <button className="icon-btn danger-toggle" title="Desconectar" onClick={voice.leaveChannel}><IconGlyph src={callEndIcon} size={18} /></button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>{participantCount}</span>
      </div>
      <RemoteAudioSinks />
      {showScreenShareMenu && (
        <ScreenShareModal
          onClose={() => setShowScreenShareMenu(false)}
          onShare={(options) => voice.toggleScreenShare(options)}
        />
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
      try { source.disconnect(); compressor.disconnect(); gain.disconnect(); destinationNode.disconnect(); } catch { /* already torn down */ }
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
    else if (audioRef.current) audioRef.current.volume = volume; // no-Web-Audio fallback path
  }, [volume]);

  // Kept mounted (hidden) purely so autoplay-permission behavior for this
  // tab doesn't change from before; actual playback happens through the
  // AudioContext graph above once Web Audio is available.
  return <audio ref={audioRef} hidden />;
}
