// A group DM's icon: the custom photo if one was uploaded (Conversation.
// icon — see conversationController.uploadIcon), otherwise a mosaic built
// from the group's own members' avatars instead of a generic placeholder —
// same idea as WhatsApp/Telegram group defaults. Members are already
// returned oldest-joined-first by the server (see conversationController's
// `orderBy: { joinedAt: 'asc' }`), so simply taking the first N here is
// exactly "the oldest members" the group has, matching what a 5+-member
// group should show instead of trying to cram everyone in.
import PenguinAvatar, { isPenguinAvatarUrl, penguinColorFromUrl } from './PenguinAvatar.jsx';

// BUG CORRIGIDO: mesma causa do resto dos avatares desse app — um membro
// com avatar de pinguim (avatarUrl = "penguin:<cor>", pseudo-URL, não uma
// URL de rede de verdade) fazia esse <img> tentar carregar isso como
// imagem de verdade e a CSP (img-src) bloqueava, deixando a célula do
// mosaico vazia.
function MosaicAvatarImg({ url }) {
  if (isPenguinAvatarUrl(url)) return <PenguinAvatar color={penguinColorFromUrl(url)} size={20} />;
  return <img src={url} alt="" />;
}

export default function ConversationIcon({ conversation, size = 'small' }) {
  if (conversation.icon) {
    return (
      <div className={`avatar ${size} group-icon`}>
        <img src={conversation.icon} alt="" />
      </div>
    );
  }
  const members = (conversation.members || []).slice(0, 4);
  const cellClass = members.length <= 2 ? 'two' : members.length === 3 ? 'three' : 'four';
  return (
    <div className={`avatar ${size} group-mosaic group-mosaic-${cellClass}`}>
      {members.map((m) => (
        <div key={m.id} className="group-mosaic-cell" style={{ background: m.profileColor || '#5865f2' }}>
          {m.avatarUrl ? <MosaicAvatarImg url={m.avatarUrl} /> : (m.displayName?.[0]?.toUpperCase() || '?')}
        </div>
      ))}
    </div>
  );
}
