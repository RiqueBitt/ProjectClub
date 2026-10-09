import { useEffect, useRef, useState } from 'react';
import { useVoice } from '../context/VoiceContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useStore } from '../store/useStore';
import { getMyCommunityPermissions, hasPermission } from '../utils/permissions';
import ScreenShareModal from './modals/ScreenShareModal.jsx';
import UserAvatar from './UserAvatar.jsx';
import { usePopoverCoordination } from '../utils/popoverCoordinator';

// ============================================================
// Canal de voz — visual refeito.
// Toda a lógica de chamada continua no VoiceContext (entrar, sair,
// mutar, câmera, tela, volume por pessoa, palco); aqui só a tela:
// lobby antes de entrar, cabeçalho com contador e tempo, grade de
// participantes (ou destaque quando alguém transmite a tela) e a
// barra de controles flutuante.
// ============================================================

const ICONS = {
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3',
  micOff: 'M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 4.9 2.3M19 11a7 7 0 0 1-1.1 3.8M5 11a7 7 0 0 0 11 5.7M12 18v3M3 3l18 18',
  headphones: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2v-3Zm16 0a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2v-3Z',
  headphonesOff: 'M4 15v-3a8 8 0 0 1 13.7-5.7M20 12v3M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2v-3Zm16 0a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2M3 3l18 18',
  camera: 'M3 7h12v10H3zM15 10l6-3v10l-6-3',
  screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
  leave: 'M5 15c4.5-3.5 9.5-3.5 14 0l-1.5 3-3-1v-2.2a8 8 0 0 0-5 0V17l-3 1L5 15Z',
  hand: 'M7 11V6a1.5 1.5 0 0 1 3 0v4M10 9V4.5a1.5 1.5 0 0 1 3 0V9M13 9V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-12.5 4.3L4 14.6a1.5 1.5 0 0 1 2.3-1.9L7 13.5V8',
  speaker: 'M4 9v6h4l5 4V5L8 9H4ZM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  stage: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM6 11a6 6 0 0 0 12 0M12 17v4M8 21h8',
  volume: 'M4 9v6h4l5 4V5L8 9H4ZM16 9a4 4 0 0 1 0 6',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  shrink: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  people: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 19v-1a4 4 0 0 0-3-3.87M15.5 4.13a3 3 0 0 1 0 5.74',
};
function Icon({ name, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

// Tempo desde que a sala ficou ocupada (vem do servidor via roster).
function useElapsed(startedAt) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startedAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return null;
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function CallHeader({ channel, count, isStage }) {
  const voice = useVoice();
  const elapsed = useElapsed(voice?.rosterStartedAt?.[channel.id]);
  return (
    <header className="vc-head">
      <span className="vc-head-icon"><Icon name={isStage ? 'stage' : 'speaker'} size={18} /></span>
      {/* O nome do canal já está no cabeçalho do chat logo acima. */}
      <p className="vc-head-text truncate">{channel.topic || (isStage ? 'Palco' : 'Canal de voz')}</p>
      <span className="vc-chip"><span className="vc-live" /> Ao vivo</span>
      <span className="vc-chip"><Icon name="people" size={15} /> {count}</span>
      {elapsed && <span className="vc-chip vc-mono">{elapsed}</span>}
    </header>
  );
}

export default function VoiceChannelView({ channel }) {
  const voice = useVoice();
  const { user } = useAuth();
  const members = useStore((s) => s.members);
  const roles = useStore((s) => s.roles);

  const inThisCall = voice?.call?.channelId === channel.id;
  const isStage = channel.type === 'STAGE';
  const memberFor = (userId) => members.find((m) => m.user.id === userId)?.user;

  // ---------- Lobby (antes de entrar) ----------
  if (!inThisCall) {
    const rawRoster = voice?.roster?.[channel.id] || [];
    const roster = [...new Map(rawRoster.map((p) => [p.userId, p])).values()];
    const busy = voice?.joiningChannelId === channel.id;
    const inOtherCall = !!voice?.call && !inThisCall;

    return (
      <div className="vc vc-lobby">
        <div className="vc-lobby-card">
          <span className="vc-lobby-icon"><Icon name={isStage ? 'stage' : 'speaker'} size={30} /></span>
          <h2>{channel.name}</h2>
          {channel.topic && <p className="vc-lobby-topic">{channel.topic}</p>}

          {roster.length > 0 ? (
            <div className="vc-lobby-people">
              <div className="vc-stack">
                {roster.slice(0, 6).map((p) => <UserAvatar key={p.userId} user={memberFor(p.userId)} size={44} />)}
                {roster.length > 6 && <span className="vc-stack-more">+{roster.length - 6}</span>}
              </div>
              <p>
                <span className="vc-live" /> {roster.length === 1
                  ? `${memberFor(roster[0].userId)?.displayName || 'Alguém'} está na sala`
                  : `${roster.length} pessoas na sala`}
              </p>
            </div>
          ) : (
            <p className="vc-lobby-empty">A sala está vazia. Entre e chame o pessoal.</p>
          )}

          <button
            type="button" className="vc-join" disabled={busy}
            onClick={() => voice?.joinChannel(null, channel.id, channel.name, channel.type)}
          >
            <Icon name={isStage ? 'stage' : 'mic'} size={18} />
            {busy ? 'Entrando…' : isStage ? 'Entrar no palco' : 'Entrar na chamada'}
          </button>
          {inOtherCall && <p className="vc-lobby-note">Você vai sair da chamada atual ({voice.call?.channelName || 'outra sala'}).</p>}
        </div>
      </div>
    );
  }

  if (isStage) {
    return <StageView roles={roles} members={members} channel={channel} memberFor={memberFor} />;
  }

  // ---------- Dentro da chamada ----------
  const { participants, remoteCameraStreams, remoteScreenStreams, cameraOn, screenOn, muted, volumes, localSpeaking } = voice;
  const allUserIds = [...new Set([user.id, ...Object.keys(participants)])];

  const screens = [
    ...Object.entries(remoteScreenStreams).map(([uid, stream]) => ({ key: `screen-${uid}`, uid, stream, mine: false })),
    ...(screenOn && voice.localScreenStream ? [{ key: 'screen-me', uid: user.id, stream: voice.localScreenStream, mine: true }] : []),
  ];
  const spotlight = screens.length > 0;

  const tiles = allUserIds.map((uid) => {
    const isMe = uid === user.id;
    const person = isMe ? user : memberFor(uid);
    const state = isMe ? { muted, video: cameraOn, screenSharing: screenOn, speaking: localSpeaking } : (participants[uid] || {});
    return (
      <PersonTile
        key={uid} uid={uid} person={person} isMe={isMe} state={state}
        connecting={!isMe && !participants[uid]}
        cameraStream={isMe ? voice.localCameraStream : remoteCameraStreams[uid]}
        volume={volumes[uid] ?? 1}
        onVolume={(v) => voice.setParticipantVolume(uid, v)}
      />
    );
  });

  return (
    <div className="vc">
      <CallHeader channel={channel} count={allUserIds.length} />
      <div className={`vc-stage${spotlight ? ' is-spotlight' : ''}`}>
        {spotlight ? (
          <>
            <div className={`vc-screens vc-screens-${Math.min(screens.length, 2)}`}>
              {screens.map((s) => (
                <div key={s.key} className="vc-screen">
                  {/* Sem tela cheia na própria tela: evita o "espelho infinito". */}
                  <VideoTile stream={s.stream} muted allowFullscreen={!s.mine} />
                  <span className="vc-label"><Icon name="screen" size={14} /> {s.mine ? 'Sua tela' : (memberFor(s.uid)?.displayName || 'Tela')}</span>
                </div>
              ))}
            </div>
            <div className="vc-strip">{tiles}</div>
          </>
        ) : (
          <div className={`vc-grid vc-grid-${Math.min(allUserIds.length, 5)}`}>{tiles}</div>
        )}
      </div>
      <VoiceCallControls voice={voice} micLocked={false} />
    </div>
  );
}

function PersonTile({ uid, person, isMe, state, connecting, cameraStream, volume, onVolume, extra }) {
  const [volOpen, setVolOpen] = useState(false);
  usePopoverCoordination(volOpen, () => setVolOpen(false));
  const color = person?.profileColor || 'var(--brand)';
  return (
    <div
      className={`vc-tile${state.speaking && !state.muted ? ' is-speaking' : ''}${cameraStream ? ' has-video' : ''}${connecting ? ' is-connecting' : ''}`}
      style={{ '--tile-color': color }}
      onMouseLeave={() => setVolOpen(false)}
    >
      {cameraStream && !connecting ? (
        <VideoTile stream={cameraStream} muted={isMe} />
      ) : (
        <div className="vc-tile-avatar">
          <UserAvatar user={person || { displayName: uid }} size={84} />
        </div>
      )}
      {connecting && <span className="vc-tile-connecting">Conectando…</span>}

      <span className="vc-label">
        {state.muted ? <span className="vc-label-muted"><Icon name="micOff" size={14} /></span> : null}
        <span className="truncate">{person?.displayName || uid}{isMe ? ' (você)' : ''}</span>
        {state.screenSharing && <Icon name="screen" size={14} />}
      </span>

      {extra}

      {!isMe && !connecting && (
        <div className={`vc-vol${volOpen ? ' open' : ''}`}>
          <button type="button" className="vc-vol-btn" onClick={() => setVolOpen((v) => !v)} aria-label={`Volume de ${person?.displayName || 'participante'}`} title="Volume">
            <Icon name="volume" size={16} />
          </button>
          {volOpen && (
            <label className="vc-vol-pop">
              <span>{Math.round(volume * 100)}%</span>
              <input type="range" min="0" max="1" step="0.05" value={volume} onChange={(e) => onVolume(parseFloat(e.target.value))} />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function StageView({ roles, members, channel, memberFor }) {
  const voice = useVoice();
  const { user } = useAuth();
  const { participants, remoteCameraStreams, cameraOn, muted, myRole, handsRaised, volumes, localSpeaking } = voice;

  const myPerms = getMyCommunityPermissions(roles, members, user.id, user.platformRole);
  const isModerator = user.platformRole === 'ADMIN'
    || hasPermission(myPerms, 'MUTE_MEMBERS') || hasPermission(myPerms, 'MOVE_MEMBERS') || hasPermission(myPerms, 'MANAGE_CHANNELS');

  const allIds = [...new Set([user.id, ...Object.keys(participants)])];
  const roleOf = (uid) => (uid === user.id ? myRole : (participants[uid]?.role || 'audience'));
  const speakers = allIds.filter((uid) => roleOf(uid) === 'speaker');
  const audience = allIds.filter((uid) => roleOf(uid) === 'audience');

  return (
    <div className="vc">
      <CallHeader channel={channel} count={allIds.length} isStage />
      <div className="vc-stage vc-stage-scroll">
        <h3 className="vc-section">No palco · {speakers.length}</h3>
        {speakers.length === 0 && <p className="vc-muted">Ninguém no palco ainda.</p>}
        <div className={`vc-grid vc-grid-${Math.min(speakers.length || 1, 5)}`}>
          {speakers.map((uid) => {
            const isMe = uid === user.id;
            const person = isMe ? user : memberFor(uid);
            const state = isMe ? { muted, video: cameraOn, speaking: localSpeaking } : (participants[uid] || {});
            return (
              <PersonTile
                key={uid} uid={uid} person={person} isMe={isMe} state={state} connecting={false}
                cameraStream={isMe ? voice.localCameraStream : remoteCameraStreams[uid]}
                volume={volumes[uid] ?? 1} onVolume={(v) => voice.setParticipantVolume(uid, v)}
                extra={(isMe || isModerator) && (
                  <button
                    type="button" className="vc-tile-action"
                    onClick={() => (isMe ? voice.stepDownFromStage() : voice.setParticipantRole(uid, 'audience'))}
                  >
                    {isMe ? 'Descer do palco' : 'Tirar do palco'}
                  </button>
                )}
              />
            );
          })}
        </div>

        <h3 className="vc-section">Plateia · {audience.length}</h3>
        <ul className="vc-audience">
          {audience.map((uid) => {
            const isMe = uid === user.id;
            const person = isMe ? user : memberFor(uid);
            return (
              <li key={uid} className={handsRaised[uid] ? 'has-hand' : ''}>
                <UserAvatar user={person || { displayName: uid }} size={32} />
                <span className="truncate">{person?.displayName || uid}{isMe ? ' (você)' : ''}</span>
                {handsRaised[uid] && <span className="vc-hand" title="Pediu para falar"><Icon name="hand" size={15} /></span>}
                {isModerator && !isMe && (
                  <button type="button" className="vc-link" onClick={() => voice.setParticipantRole(uid, 'speaker')}>Convidar</button>
                )}
              </li>
            );
          })}
        </ul>

        {myRole === 'audience' && (
          <button type="button" className={`vc-hand-btn${handsRaised[user.id] ? ' active' : ''}`} onClick={() => voice.raiseHand(!handsRaised[user.id])}>
            <Icon name="hand" size={18} /> {handsRaised[user.id] ? 'Mão levantada · cancelar' : 'Pedir para falar'}
          </button>
        )}
      </div>
      <VoiceCallControls voice={voice} micLocked={myRole === 'audience'} />
    </div>
  );
}

function ControlButton({ icon, label, onClick, disabled, active, danger, title }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title || label} aria-label={label} aria-pressed={active || undefined}
      className={`vc-ctrl${active ? ' is-active' : ''}${danger ? ' is-danger' : ''}`}
    >
      <Icon name={icon} size={21} />
      <span className="vc-ctrl-label">{label}</span>
    </button>
  );
}

function VoiceCallControls({ voice, micLocked }) {
  const { muted, micMissing, deafened, cameraOn, screenOn } = voice;
  const [showScreenShareMenu, setShowScreenShareMenu] = useState(false);
  const isNativeApp = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
  const screenShareSupported = !isNativeApp && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  const lockedTitle = 'Você está na plateia: peça para falar';

  return (
    <div className="vc-dock-wrap">
      <div className="vc-dock" role="toolbar" aria-label="Controles da chamada">
        <ControlButton
          icon={micLocked ? 'hand' : (muted || micMissing ? 'micOff' : 'mic')}
          label={micLocked ? 'Plateia' : micMissing ? 'Sem microfone' : muted ? 'Ativar mic' : 'Silenciar'}
          title={micLocked ? lockedTitle : micMissing ? 'Microfone não encontrado: clique para tentar de novo' : undefined}
          onClick={voice.toggleMute} disabled={micLocked} danger={muted || micMissing}
        />
        <ControlButton
          icon={deafened ? 'headphonesOff' : 'headphones'}
          label={deafened ? 'Voltar a ouvir' : 'Ensurdecer'}
          onClick={voice.toggleDeafen} danger={deafened}
        />
        <ControlButton
          icon="camera" label={cameraOn ? 'Desligar câmera' : 'Câmera'}
          title={micLocked ? lockedTitle : undefined}
          onClick={voice.toggleCamera} disabled={micLocked} active={cameraOn}
        />
        <ControlButton
          icon="screen" label={screenOn ? 'Parar tela' : 'Transmitir tela'}
          title={micLocked ? lockedTitle
            : !screenShareSupported ? (isNativeApp ? 'Transmitir tela ainda não funciona no app Android: use o navegador' : 'Este navegador não permite transmitir a tela')
              : undefined}
          onClick={() => (screenOn ? voice.toggleScreenShare() : setShowScreenShareMenu(true))}
          disabled={micLocked || !screenShareSupported} active={screenOn}
        />
        <span className="vc-dock-sep" aria-hidden="true" />
        <button type="button" className="vc-ctrl vc-leave" onClick={voice.leaveChannel} aria-label="Sair da chamada" title="Sair da chamada">
          <Icon name="leave" size={22} />
          <span className="vc-ctrl-label">Sair</span>
        </button>
      </div>
      {showScreenShareMenu && (
        <ScreenShareModal
          onClose={() => setShowScreenShareMenu(false)}
          onShare={(options) => voice.toggleScreenShare(options)}
        />
      )}
    </div>
  );
}

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
    <div ref={wrapRef} className="video-tile-wrap vc-video">
      <video ref={ref} autoPlay playsInline muted={muted} />
      {allowFullscreen && (
        <button
          type="button" className="vc-fullscreen" onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'} title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        >
          <Icon name={isFullscreen ? 'shrink' : 'expand'} size={18} />
        </button>
      )}
    </div>
  );
}
