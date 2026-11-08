import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useStore } from '../../store/useStore';
import UserAvatar from '../UserAvatar.jsx';
import CallIcon from './CallIcons.jsx';
import { useVideoViewport } from '../../voice/useVideoViewport';

// Janelinha flutuante da chamada (estilo picture-in-picture): aparece
// quando você está numa chamada e sai da tela dela. Mostra quem está
// falando (ou a transmissão/câmera de alguém), mudo, desligar e "Voltar".
// Dá pra arrastar; ao soltar ela gruda no canto mais próximo, e o canto
// fica lembrado.
const CORNER_KEY = 'pc.miniCallCorner';
const CORNERS = ['br', 'bl', 'tr', 'tl'];
function loadCorner() {
  try {
    const c = localStorage.getItem(CORNER_KEY);
    return CORNERS.includes(c) ? c : 'br';
  } catch { return 'br'; }
}
function saveCorner(c) {
  try { localStorage.setItem(CORNER_KEY, c); } catch { /* sem storage */ }
}

// Vídeo pequeno: avisa o engine (camada baixa do simulcast basta).
function MiniVideo({ stream, uid = null, kind = 'camera', report = null }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  useVideoViewport(ref, { uid, kind, report, enabled: !!uid && !!stream });
  return <video ref={ref} autoPlay playsInline muted />;
}

export default function MiniCallWindow({ voice, onBack, onHide }) {
  const { user } = useAuth();
  const members = useStore((s) => s.members);
  const conversations = useStore((s) => s.conversations);
  const [corner, setCorner] = useState(loadCorner);
  const [drag, setDrag] = useState(null); // { x, y } durante o arrasto
  const boxRef = useRef(null);
  const dragRef = useRef(null);

  const findUser = (uid) => {
    if (uid === user?.id) return user;
    const m = members?.find((x) => x.user?.id === uid)?.user;
    if (m) return m;
    for (const c of conversations || []) {
      const u = c.members?.find((x) => x.id === uid);
      if (u) return u;
    }
    return null;
  };

  const { call, participants, localSpeaking, muted, deafened, remoteScreenStreams, remoteCameraStreams } = voice;
  const ids = [user?.id, ...Object.keys(participants || {}).filter((uid) => uid !== user?.id)].filter(Boolean);
  const isSpeaking = (uid) => (uid === user?.id ? localSpeaking && !muted : !!participants[uid]?.speaking && !participants[uid]?.muted);
  // Quem está falando vai pra frente da fila.
  const ordered = [...ids].sort((a, b) => Number(isSpeaking(b)) - Number(isSpeaking(a)));

  // Prioridade do "vídeo" da janelinha: tela de alguém > câmera de alguém.
  const screenUid = Object.keys(remoteScreenStreams || {})[0];
  const camUid = !screenUid ? Object.keys(remoteCameraStreams || {})[0] : null;
  const videoStream = screenUid ? remoteScreenStreams[screenUid] : (camUid ? remoteCameraStreams[camUid] : null);
  const videoOwner = screenUid || camUid;
  const speakers = ordered.filter(isSpeaking);

  // ----- Arrastar (ponteiro: mouse e toque) -----
  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (e.target.closest('button')) return;
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, w: rect.width, h: rect.height, moved: false, sx: e.clientX, sy: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
    d.moved = true;
    const x = Math.min(Math.max(0, e.clientX - d.dx), window.innerWidth - d.w);
    const y = Math.min(Math.max(0, e.clientY - d.dy), window.innerHeight - d.h);
    setDrag({ x, y });
  };
  const onPointerUp = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (!d?.moved) { setDrag(null); return; }
    const cx = e.clientX - d.dx + d.w / 2;
    const cy = e.clientY - d.dy + d.h / 2;
    const next = `${cy < window.innerHeight / 2 ? 't' : 'b'}${cx < window.innerWidth / 2 ? 'l' : 'r'}`;
    setCorner(next);
    saveCorner(next);
    setDrag(null);
  };

  const ownerName = videoOwner ? (findUser(videoOwner)?.displayName || 'Alguém') : null;

  return createPortal(
    <div
      ref={boxRef}
      className={`mcw mcw-${corner}${drag ? ' is-dragging' : ''}`}
      style={drag ? { left: drag.x, top: drag.y, right: 'auto', bottom: 'auto' } : undefined}
      role="region" aria-label="Chamada em andamento"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
    >
      <div className="mcw-view" onDoubleClick={onBack}>
        {videoStream ? (
          <>
            <MiniVideo stream={videoStream} uid={videoOwner} kind={screenUid ? 'screen' : 'camera'} report={voice.reportVideoViewport} />
            <span className="mcw-badge">
              {screenUid ? <span className="mcw-live">AO VIVO</span> : <CallIcon name="camera" size={12} />}
              <span className="truncate">{ownerName}</span>
            </span>
          </>
        ) : (
          <div className={`mcw-people mcw-people-${Math.min(ordered.length, 4)}`}>
            {ordered.slice(0, 4).map((uid) => {
              const u = findUser(uid);
              return (
                <span key={uid} className={`mcw-person${isSpeaking(uid) ? ' is-speaking' : ''}`} title={u?.displayName || ''}>
                  <UserAvatar user={u || { displayName: '?' }} size={ordered.length > 2 ? 34 : 44} />
                </span>
              );
            })}
            {ordered.length > 4 && <span className="mcw-more">+{ordered.length - 4}</span>}
          </div>
        )}
        <span className="mcw-grip" aria-hidden="true"><CallIcon name="grip" size={14} strokeWidth={3} /></span>
        <button type="button" className="mcw-hide" onClick={onHide} aria-label="Ocultar janelinha" title="Ocultar janelinha">
          <CallIcon name="minimize" size={14} strokeWidth={2.4} />
        </button>
      </div>

      <div className="mcw-info">
        <span className="mcw-title truncate">{call.channelName || 'Chamada'}</span>
        <span className={`mcw-sub truncate${speakers.length ? ' is-speaking' : ''}`}>
          {speakers.length > 0
            ? <>Falando: {speakers.map((uid) => findUser(uid)?.displayName || 'Alguém').join(', ')}</>
            : <>{ids.length === 1 ? 'Só você na chamada' : `${ids.length} pessoas na chamada`}</>}
        </span>
      </div>

      <div className="mcw-actions">
        <button
          type="button" className={`mcw-btn${muted ? ' is-off' : ''}`} onClick={voice.toggleMute}
          aria-label={muted ? 'Ativar microfone' : 'Silenciar'} aria-pressed={muted} title={muted ? 'Ativar microfone' : 'Silenciar'}
        >
          <CallIcon name={muted ? 'micOff' : 'mic'} size={17} />
        </button>
        <button
          type="button" className={`mcw-btn${deafened ? ' is-off' : ''}`} onClick={voice.toggleDeafen}
          aria-label={deafened ? 'Voltar a ouvir' : 'Ensurdecer'} aria-pressed={deafened} title={deafened ? 'Voltar a ouvir' : 'Ensurdecer'}
        >
          <CallIcon name={deafened ? 'headphonesOff' : 'headphones'} size={17} />
        </button>
        <button type="button" className="mcw-back" onClick={onBack} title="Voltar para a chamada">
          <CallIcon name="expand" size={15} /> Voltar
        </button>
        <button type="button" className="mcw-btn mcw-hangup" onClick={voice.leaveChannel} aria-label="Desligar" title="Desligar">
          <CallIcon name="hangup" size={19} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
