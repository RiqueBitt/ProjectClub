import { useEffect, useRef, useState } from 'react';
import { useVoice } from '../context/VoiceContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useStore } from '../store/useStore';
import { getMyCommunityPermissions, hasPermission } from '../utils/permissions';
import ScreenShareModal from './modals/ScreenShareModal.jsx';
import PenguinAvatar, { isPenguinAvatarUrl, penguinColorFromUrl } from './PenguinAvatar.jsx';
import UserAvatar from './UserAvatar.jsx';
import IconGlyph from './IconGlyph.jsx';

// BUG CORRIGIDO: as duas tiles abaixo (grade normal e Palco) desenhavam
// `<img src={person.avatarUrl}>` direto — quando a pessoa tinha um avatar
// de pinguim (avatarUrl = pseudo-URL "penguin:<cor>", ver PenguinAvatar.jsx
// — não é uma URL de rede de verdade), o navegador tentava mesmo assim
// carregar isso como imagem, e a CSP (img-src) bloqueava a tentativa —
// aparecia só o quadrado vazio no lugar do avatar. UserAvatar.jsx (usado
// no resto do app) já sabia tratar isso; essas duas tiles, por desenharem
// o próprio <img> na mão (por causa do tamanho/z-index customizado da
// tile), tinham ficado de fora dessa checagem.
function TileAvatarImg({ url, size = 56 }) {
  if (isPenguinAvatarUrl(url)) return <PenguinAvatar color={penguinColorFromUrl(url)} size={size} />;
  return <img src={url} alt="" style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }} />;
}
import callEndIcon from '../assets/icons/nav-hangup-jitsi.png';
import micIcon from '../assets/icons/nav-mic-jitsi.png';
import micMutedIcon from '../assets/icons/nav-mic-muted-jitsi.png';
import speakerIcon from '../assets/icons/speaker.png';
import videoCallIcon from '../assets/icons/nav-video-jitsi.png';
import screenshareIcon from '../assets/icons/nav-screenshare-jitsi.png';
import raiseHandIcon from '../assets/icons/nav-raise-hand-jitsi.png';
import volumeUpIcon from '../assets/icons/nav-volume-up-jitsi.png';
import volumeOffIcon from '../assets/icons/nav-volume-off-jitsi.png';

export default function VoiceChannelView({ channel }) {
  const voice = useVoice();
  const { user } = useAuth();
  const members = useStore((s) => s.members);
  const roles = useStore((s) => s.roles);

  const inThisCall = voice?.call?.channelId === channel.id;
  const isStage = channel.type === 'STAGE';
  const memberFor = (userId) => members.find((m) => m.user.id === userId)?.user;

  if (!inThisCall) {
    // Item pedido: "mostre diretamente quem já está na call, com seus
    // avatares e o botão Entrar, sem precisar abrir uma camada/modal
    // antes" — usa o roster do canal (voice.roster, sincronizado por
    // socket, sabe quem está na call SEM precisar você mesmo estar
    // dentro dela) direto nessa mesma tela de prévia, em vez de só um
    // botão isolado sem contexto nenhum de quem já está lá.
    //
    // BUG EVITADO ("perfis duplicados ao clicar rápido"): dedupe por
    // userId com um Map antes de desenhar — mesmo que o roster do
    // servidor viesse com alguma entrada repetida por qualquer motivo
    // (ex: eventos de entrar/sair se cruzando), a tela nunca desenha o
    // mesmo avatar duas vezes.
    const rawRoster = voice?.roster?.[channel.id] || [];
    const dedupedRoster = [...new Map(rawRoster.map((p) => [p.userId, p])).values()];
    const busy = voice?.joiningChannelId === channel.id;

    return (
      <div className="voice-view">
        <div className="voice-join-panel">
          <span className="voice-join-icon"><IconGlyph src={isStage ? micIcon : speakerIcon} size={22} /></span>
          <div>{channel.name}</div>
          {channel.topic && <div className="dim">{channel.topic}</div>}
          {dedupedRoster.length > 0 && (
            <div className="voice-join-preview-avatars">
              {dedupedRoster.slice(0, 8).map((p) => {
                const person = memberFor(p.userId);
                return (
                  <div key={p.userId} className="voice-join-preview-avatar" title={person?.displayName || p.userId}>
                    <UserAvatar user={person} size={40} />
                  </div>
                );
              })}
              <span className="dim voice-join-preview-count">
                {dedupedRoster.length} {dedupedRoster.length === 1 ? 'pessoa' : 'pessoas'} já na call
              </span>
            </div>
          )}
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => voice?.joinChannel(null, channel.id, channel.name, channel.type)}
          >
            {busy ? 'Entrando...' : `Entrar ${isStage ? 'no palco' : 'na chamada'}`}
          </button>
        </div>
      </div>
    );
  }

  if (isStage) {
    return <StageView roles={roles} members={members} channel={channel} memberFor={memberFor} />;
  }

  const { participants, remoteCameraStreams, remoteScreenStreams, cameraOn, screenOn, muted, volumes, localSpeaking } = voice;
  // BUG CORRIGIDO ("clicar rápido várias vezes mostra o mesmo perfil
  // duplicado no canal"): isso montava a lista de quem mostrar juntando
  // o PRÓPRIO id (sempre, na mão) com as chaves do mapa de participantes
  // — sem nunca checar se o próprio id também já tinha entrado nesse
  // mapa por algum evento fora de ordem (bem provável durante
  // sair/entrar rápido, quando eventos de 'entrou'/'saiu' antigos podem
  // chegar depois dos novos). Se isso acontecesse, seu id aparecia DUAS
  // vezes na lista — uma vez do jeito manual, outra vinda do mapa — e
  // sua própria pessoa virava dois quadradinhos na tela. `Set` garante
  // que cada id (o seu ou de qualquer outra pessoa) nunca aparece mais
  // de uma vez, não importa de onde ele veio.
  const allUserIds = [...new Set([user.id, ...Object.keys(participants)])];
  // A peer id in allUserIds without a `participants` entry yet (or without
  // an established camera/audio stream) means we're still mid-handshake —
  // show a connecting spinner instead of an empty/broken tile.
  const isConnecting = (uid) => uid !== user.id && !participants[uid];

  return (
    <div className="voice-view">
      <div className="voice-tiles-grid">
        {allUserIds.map((uid) => {
          const isMe = uid === user.id;
          const person = isMe ? user : memberFor(uid);
          const state = isMe ? { muted, video: cameraOn, screenSharing: screenOn, speaking: localSpeaking } : (participants[uid] || {});
          const cameraStream = isMe ? voice.localCameraStream : remoteCameraStreams[uid];
          const connecting = isConnecting(uid);
          return (
            <div key={uid} className={`voice-tile ${state.speaking ? 'speaking' : ''}`}>
              {connecting ? (
                <div className="voice-connecting">
                  <div className="voice-connecting-ring-wrap">
                    <div className="voice-tile-avatar" style={{ width: 56, height: 56, background: person?.profileColor || '#F2894D' }}>
                      {person?.avatarUrl ? <TileAvatarImg url={person.avatarUrl} /> : (person?.displayName?.[0]?.toUpperCase() || '?')}
                    </div>
                  </div>
                  <span>Conectando...</span>
                </div>
              ) : cameraStream ? (
                <VideoTile stream={cameraStream} muted={isMe} />
              ) : (
                <div className="voice-tile-avatar" style={{ background: person?.profileColor || '#F2894D' }}>
                  {person?.avatarUrl ? <TileAvatarImg url={person.avatarUrl} /> : (person?.displayName?.[0]?.toUpperCase() || '?')}
                </div>
              )}
              <div className="voice-status-badges">
                {state.muted && <span className="voice-status-badge muted" title="Microfone mudo"><IconGlyph src={micMutedIcon} size={13} /></span>}
                {state.video && <span className="voice-status-badge camera" title="Câmera ligada">📷</span>}
                {state.screenSharing && <span className="voice-status-badge screen" title="Compartilhando tela"><IconGlyph src={screenshareIcon} size={13} /></span>}
              </div>
              <span className="voice-tile-name">
                {person?.displayName || uid}{isMe ? ' (você)' : ''}
              </span>
              {!isMe && (
                <div className="voice-participant-controls" style={{ position: 'absolute', top: 6, right: 6 }}>
                  <input
                    type="range" min="0" max="1" step="0.05"
                    value={volumes[uid] ?? 1}
                    onChange={(e) => voice.setParticipantVolume(uid, parseFloat(e.target.value))}
                    title="Volume"
                  />
                </div>
              )}
            </div>
          );
        })}
        {Object.entries(remoteScreenStreams).map(([uid, stream]) => (
          <div key={`screen-${uid}`} className="voice-tile voice-tile-screen">
            <VideoTile stream={stream} muted allowFullscreen />
            <span className="voice-tile-name">🖥️ {memberFor(uid)?.displayName || uid}</span>
          </div>
        ))}
        {/* Item pedido: de volta ao vídeo ao vivo da própria tela — só
            que sem o botão de tela cheia (allowFullscreen omitido de
            propósito). O "espelho infinito" (cursor duplicado, fundo
            preto — ver histórico) só fica realmente ruim em tela
            CHEIA; numa caixinha pequena como essa, o efeito é bem mais
            discreto e a pessoa ainda consegue confirmar visualmente
            que está compartilhando a coisa certa, sem o risco de
            ampliar o problema clicando em "tela cheia". */}
        {screenOn && voice.localScreenStream && (
          <div className="voice-tile voice-tile-screen">
            <VideoTile stream={voice.localScreenStream} muted />
            <span className="voice-tile-name">🖥️ Sua tela</span>
          </div>
        )}
      </div>
      <VoiceCallControls voice={voice} micLocked={false} channelId={channel.id} />
    </div>
  );
}

// Discord's Stage: speakers can be seen/heard by everyone; the audience is
// muted by default and must raise a hand to be invited up by a moderator
// (anyone who could mute/move members in this server).
function StageView({ roles, members, channel, memberFor }) {
  const voice = useVoice();
  const { user } = useAuth();
  const { participants, remoteCameraStreams, cameraOn, muted, myRole, handsRaised, volumes, localSpeaking } = voice;

  const myPerms = getMyCommunityPermissions(roles, members, user.id, user.platformRole);
  const isModerator = user.platformRole === 'ADMIN'
    || hasPermission(myPerms, 'MUTE_MEMBERS') || hasPermission(myPerms, 'MOVE_MEMBERS') || hasPermission(myPerms, 'MANAGE_CHANNELS');

  // Mesma correção de duplicata do allUserIds acima, aplicada aqui pro
  // canal tipo Palco (Stage) — que tem sua própria lista separada de
  // "quem mostrar" (speakers/audience).
  const allIds = [...new Set([user.id, ...Object.keys(participants)])];
  const roleOf = (uid) => (uid === user.id ? myRole : (participants[uid]?.role || 'audience'));
  const speakers = allIds.filter((uid) => roleOf(uid) === 'speaker');
  const audience = allIds.filter((uid) => roleOf(uid) === 'audience');

  return (
    <div className="voice-view">
      <div style={{ width: '100%', maxWidth: 960 }}>
        <div className="permission-group-label">PALCO — {speakers.length}</div>
        <div className="voice-tiles-grid">
          {speakers.map((uid) => {
            const isMe = uid === user.id;
            const person = isMe ? user : memberFor(uid);
            const state = isMe ? { muted, video: cameraOn, speaking: localSpeaking } : (participants[uid] || {});
            const cameraStream = isMe ? voice.localCameraStream : remoteCameraStreams[uid];
            return (
              <div key={uid} className={`voice-tile ${state.speaking ? 'speaking' : ''}`}>
                {cameraStream ? (
                  <VideoTile stream={cameraStream} muted={isMe} />
                ) : (
                  <div className="voice-tile-avatar" style={{ background: person?.profileColor || '#F2894D' }}>
                    {person?.displayName?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <span className="voice-tile-name">{state.muted ? <IconGlyph src={micMutedIcon} size={13} /> : <IconGlyph src={micIcon} size={13} />} {person?.displayName || uid}{isMe ? ' (você)' : ''}</span>
                {isMe && (
                  <button className="icon-btn-small" style={{ position: 'absolute', top: 6, right: 6 }} onClick={voice.stepDownFromStage}>Descer do palco</button>
                )}
                {!isMe && isModerator && (
                  <button className="icon-btn-small" style={{ position: 'absolute', top: 6, right: 6 }} onClick={() => voice.setParticipantRole(uid, 'audience')}>Remover do palco</button>
                )}
                {!isMe && (
                  <input
                    type="range" min="0" max="1" step="0.05" value={volumes[uid] ?? 1}
                    onChange={(e) => voice.setParticipantVolume(uid, parseFloat(e.target.value))}
                    style={{ position: 'absolute', bottom: 28, left: 8 }}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="permission-group-label" style={{ marginTop: 20 }}>PLATEIA — {audience.length}</div>
        <ul className="settings-member-list">
          {audience.map((uid) => {
            const isMe = uid === user.id;
            const person = isMe ? user : memberFor(uid);
            return (
              <li key={uid}>
                {handsRaised[uid] ? <IconGlyph src={raiseHandIcon} size={13} style={{ marginRight: 4 }} /> : ''}{person?.displayName || uid}{isMe ? ' (você)' : ''}
                {isModerator && !isMe && (
                  <button className="btn-link" onClick={() => voice.setParticipantRole(uid, 'speaker')}>Convidar para o palco</button>
                )}
              </li>
            );
          })}
        </ul>

        {myRole === 'audience' && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <button className={`btn-secondary ${handsRaised[user.id] ? 'active-toggle' : ''}`} onClick={() => voice.raiseHand(!handsRaised[user.id])}>
              {handsRaised[user.id] ? '✋ Mão levantada — cancelar' : '✋ Pedir para falar'}
            </button>
          </div>
        )}
      </div>
      <VoiceCallControls voice={voice} micLocked={myRole === 'audience'} channelId={channel.id} />
    </div>
  );
}

// Big, clearly-labeled mute / deafen / leave controls, shown directly in the
// call screen itself (not just the small persistent bar in the sidebar) so
// they're obvious no matter what's happening on screen.
function VoiceCallControls({ voice, micLocked, channelId }) {
  const { muted, micMissing, deafened, cameraOn, screenOn } = voice;
  const [showScreenShareMenu, setShowScreenShareMenu] = useState(false);
  // Mesma checagem usada em CallBar.jsx: o WebView do app Android define
  // getDisplayMedia mas não implementa de verdade (falha em runtime em vez
  // de simplesmente não existir), então isNativeApp precisa de um caso à parte.
  const isNativeApp = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
  const screenShareSupported = !isNativeApp && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  return (
    <div className="voice-call-controls" style={{ position: 'relative' }}>
      <button
        className={`voice-control-btn ${muted ? 'danger-toggle' : ''}`}
        onClick={voice.toggleMute}
        disabled={micLocked}
        title={micLocked ? 'Você é plateia — peça para falar' : (micMissing ? 'Microfone não conectado — clique para tentar de novo' : (muted ? 'Ativar microfone' : 'Silenciar microfone'))}
      >
        <span className="voice-control-icon">{micLocked ? <IconGlyph src={raiseHandIcon} size={16} /> : (micMissing ? '🎙️🚫' : <IconGlyph src={muted ? micMutedIcon : micIcon} size={16} />)}</span>
        <span className="voice-control-label">{micLocked ? 'Plateia' : (micMissing ? 'Sem microfone' : (muted ? 'Ativar mic' : 'Silenciar'))}</span>
      </button>
      <button
        className={`voice-control-btn ${deafened ? 'danger-toggle' : ''}`}
        onClick={voice.toggleDeafen}
        title={deafened ? 'Voltar a ouvir os outros' : 'Parar de ouvir os outros'}
      >
        <span className="voice-control-icon">{deafened ? <IconGlyph src={volumeOffIcon} size={16} /> : <IconGlyph src={volumeUpIcon} size={16} />}</span>
        <span className="voice-control-label">{deafened ? 'Reativar áudio' : 'Ensurdecer'}</span>
      </button>
      <button
        className={`voice-control-btn ${cameraOn ? 'on' : ''}`}
        onClick={voice.toggleCamera}
        disabled={micLocked}
        title={micLocked ? 'Você é plateia — peça para falar' : (cameraOn ? 'Desligar câmera' : 'Ligar câmera')}
      >
        <span className="voice-control-icon"><IconGlyph src={videoCallIcon} size={16} /></span>
        <span className="voice-control-label">{cameraOn ? 'Desligar câmera' : 'Câmera'}</span>
      </button>
      <button
        className={`voice-control-btn ${screenOn ? 'on' : ''}`}
        onClick={() => (screenOn ? voice.toggleScreenShare() : setShowScreenShareMenu(true))}
        disabled={micLocked || !screenShareSupported}
        title={
          micLocked ? 'Você é plateia — peça para falar'
            : screenShareSupported ? (screenOn ? 'Parar de compartilhar tela' : 'Compartilhar tela')
              : (isNativeApp ? 'Compartilhar tela ainda não é suportado no app Android — use pelo navegador' : 'Compartilhar tela não é suportado neste navegador')
        }
      >
        <span className="voice-control-icon"><IconGlyph src={screenshareIcon} size={16} /></span>
        <span className="voice-control-label">{screenOn ? 'Parar tela' : 'Transmitir tela'}</span>
      </button>
      <button
        className="voice-control-btn voice-control-leave"
        onClick={voice.leaveChannel}
        title="Sair da chamada"
      >
        <span className="voice-control-icon"><IconGlyph src={callEndIcon} size={16} /></span>
        <span className="voice-control-label">Sair da call</span>
      </button>
      {showScreenShareMenu && (
        <ScreenShareModal
          onClose={() => setShowScreenShareMenu(false)}
          onShare={(options) => voice.toggleScreenShare(options)}
        />
      )}
    </div>
  );
}

// `allowFullscreen` só é passado pelas tiles de transmissão de tela
// (própria ou de outra pessoa) — câmera continua exatamente como antes,
// sem o botão. O pedido de tela cheia (Fullscreen API) é feito no
// wrapper (`wrapRef`), não no <video> cru: assim o botão de sair (✕)
// continua podendo ser desenhado POR CIMA do vídeo mesmo em tela cheia —
// pedir fullscreen direto no <video> tira esse controle do navegador e a
// gente perde a chance de colocar um X customizado nele.
function VideoTile({ stream, muted, allowFullscreen }) {
  const ref = useRef(null);
  const wrapRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  useEffect(() => {
    if (!allowFullscreen) return undefined;
    const onChange = () => setIsFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [allowFullscreen]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement === wrapRef.current) {
      document.exitFullscreen().catch(() => {});
    } else if (wrapRef.current?.requestFullscreen) {
      wrapRef.current.requestFullscreen().catch(() => {});
    }
  };

  return (
    <div ref={wrapRef} className="video-tile-wrap">
      <video ref={ref} autoPlay playsInline muted={muted} />
      {allowFullscreen && (
        <button
          type="button"
          className="video-tile-fullscreen-btn"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        >
          {isFullscreen ? '✕' : '⛶'}
        </button>
      )}
    </div>
  );
}
