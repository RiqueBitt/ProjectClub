import { useEffect, useRef } from 'react';
import { useVoice } from '../context/VoiceContext.jsx';
import { useStore } from '../store/useStore';
import phoneIcon from '../assets/icons/phone.png';
import callEndIcon from '../assets/icons/nav-hangup-jitsi.png';
import PenguinAvatar, { isPenguinAvatarUrl, penguinColorFromUrl } from './PenguinAvatar.jsx';

// BUG CORRIGIDO: <img src={caller.avatarUrl}> quebrava (bloqueado pela CSP
// img-src) quando quem está ligando tem avatar de pinguim (pseudo-URL
// "penguin:<cor>", não uma URL de rede de verdade) — ver PenguinAvatar.jsx.
function CallerAvatarImg({ url }) {
  if (isPenguinAvatarUrl(url)) return <PenguinAvatar color={penguinColorFromUrl(url)} size={32} />;
  return <img src={url} alt="" />;
}

// Fixed banner shown at the top of the screen the moment a DM call starts
// ringing for us (see VoiceContext.jsx's dm-call:ringing handler) — this is
// the "menu em cima para aceitar ou rejeitar" that was previously missing
// entirely (a call would just silently ring with a toast/sound and no way
// to answer it short of manually opening the DM and pressing the call
// button yourself, which also never actually declined it for the caller).
export default function IncomingCallBanner() {
  const voice = useVoice();
  const conversations = useStore((s) => s.conversations);
  const ringRef = useRef(null);

  const incoming = voice?.incomingCall;

  // Loops the ringing sound for as long as the banner is up, instead of the
  // single one-shot play SocketContext.jsx already fires the instant the
  // call comes in — a call that isn't answered in a second or two should
  // keep audibly ringing, not go silent while still visually "ringing".
  useEffect(() => {
    if (!incoming) return undefined;
    const el = new Audio('/sounds/dm-call-ringing.mp3');
    el.loop = true;
    el.volume = 0.5;
    ringRef.current = el;
    el.play().catch(() => {}); // autoplay can be blocked outside a gesture — not fatal, banner still shows
    return () => {
      el.pause();
      el.src = '';
      if (ringRef.current === el) ringRef.current = null;
    };
  }, [incoming?.conversationId]);

  if (!incoming) return null;

  const convo = conversations.find((c) => c.id === incoming.conversationId);
  const caller = convo?.members?.find((m) => m.id === incoming.fromUserId);
  const label = convo?.isGroup ? convo.name : (caller?.displayName || incoming.callerName || 'Alguém');
  const initial = (caller?.displayName || incoming.callerName || label || '?')[0]?.toUpperCase() || '?';

  return (
    <div className="incoming-call-banner">
      <div className="incoming-call-info">
        <span className="incoming-call-avatar" style={{ background: caller?.profileColor || '#F2894D' }}>
          {caller?.avatarUrl ? <CallerAvatarImg url={caller.avatarUrl} /> : initial}
        </span>
        <div className="incoming-call-text">
          <div className="incoming-call-name truncate">{label}</div>
          <div className="incoming-call-sub">Chamada de voz recebida</div>
        </div>
      </div>
      <div className="incoming-call-actions">
        <button className="incoming-call-btn decline" title="Recusar" onClick={voice.declineIncomingCall}>
          <img className="ui-icon" src={callEndIcon} alt="" />
        </button>
        <button className="incoming-call-btn accept" title="Atender" onClick={voice.answerIncomingCall}>
          <img className="ui-icon" src={phoneIcon} alt="" />
        </button>
      </div>
    </div>
  );
}
