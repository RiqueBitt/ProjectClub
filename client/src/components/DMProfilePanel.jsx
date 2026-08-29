import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { getUserProfile } from '../api/endpoints';
import { STATUS_LABEL, STATUS_COLOR } from '../utils/status';
import { renderRichContent } from '../utils/richTextRender.jsx';
import { profileAccentVars } from '../utils/profileAccent';
import TagBadge from './TagBadge.jsx';
import StatusEmoji from './StatusEmoji.jsx';
import UserAvatar from './UserAvatar.jsx';
import likeIcon from '../assets/icons/like.png';
import dislikeIcon from '../assets/icons/dislike.png';
import youtubeIcon from '../assets/icons/social-youtube.png';
import steamIcon from '../assets/icons/social-steam.png';
import robloxIcon from '../assets/icons/social-roblox.png';
import xIcon from '../assets/icons/social-x.png';
import { proxyImage } from '../utils/imageProxy';

// The right-hand rail's DM counterpart to MembersList — reuses the exact
// same `.members-list` grid slot/width/collapse-button styling (see
// global.css) so a 1:1 conversation gets a persistent "who am I talking
// to" panel instead of the chat window being the only thing on screen,
// same as how a server always keeps its member list visible alongside the
// chat. Deliberately only renders for real 1:1 DMs — a group conversation
// has no single "other person" to show a profile for, so it renders
// nothing (the toggle button still exists, it just has nothing to open).
export default function DMProfilePanel({ onToggle }) {
  const { conversationId } = useParams();
  const { user: me } = useAuth();
  const conversations = useStore((s) => s.conversations);
  const conversation = conversations.find((c) => c.id === conversationId);
  const other = conversation && !conversation.isGroup ? conversation.members.find((m) => m.id !== me.id) : null;
  const presence = useStore((s) => (other ? s.presence[other.id] : null));
  const usableEmojis = useStore((s) => s.usableEmojis);
  const bioEmojiMap = Object.fromEntries(usableEmojis.map((e) => [e.name, e.url]));

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!other) { setData(null); return; }
    setLoading(true);
    getUserProfile(other.id).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [other?.id]);

  if (!conversation) return null;

  if (conversation.isGroup) {
    return (
      <aside className="members-list dm-profile-panel">
        <button className="icon-btn members-collapse" onClick={onToggle}>›</button>
        <div className="dim dm-profile-empty">Conversas em grupo não têm um perfil único para mostrar aqui.</div>
      </aside>
    );
  }

  const user = data?.user;
  const status = presence?.status || user?.status || 'ONLINE';

  return (
    <aside
      className={`members-list dm-profile-panel ${user?.idCardUrl ? 'has-id-card' : ''} ${user && !user.idCardUrl ? 'dm-profile-accented' : ''}`}
      style={user?.idCardUrl
        ? { backgroundImage: `linear-gradient(180deg, var(--bg-secondary) 25%, transparent), url(${user.idCardUrl})` }
        // Sem "placa de identificação" própria: aplica o mesmo tratamento de
        // cor de perfil (degradê suave no topo + texto legível) usado no
        // perfil completo e no miniperfil, em vez de deixar essa área do
        // painel de DM sem nenhuma personalização (ver .dm-profile-accented
        // em global.css).
        : (user ? profileAccentVars(user.profileColor) : undefined)}
    >
      <button className="icon-btn members-collapse" onClick={onToggle}>›</button>
      {loading && <div className="dim dm-profile-empty">Carregando...</div>}
      {!loading && user && (
        <>
          <div className="profile-banner" style={{ background: user.bannerUrl ? undefined : (user.profileColor || '#F2894D') }}>
            {user.bannerUrl && <img src={proxyImage(user.bannerUrl)} alt="" />}
          </div>
          <div className="profile-modal-body">
            <div className="profile-avatar-row">
              <div className="avatar-wrap large">
                <div className="avatar xlarge">
                  <UserAvatar user={user} size={96} />
                </div>
                <span className="status-dot large" style={{ background: STATUS_COLOR[status] }} title={STATUS_LABEL[status]} />
              </div>
            </div>

            <h2 className="profile-display-name">{user.displayName} <TagBadge user={user} /></h2>
            <div className="profile-username">@{user.username}</div>

            <div className="profile-votes-row">
              <span className="profile-vote-btn like" title="Ups"><img className="ui-icon-sm" src={likeIcon} alt="" /> {data.totalUps ?? data.likeCount}</span>
              <span className="profile-vote-btn dislike" title={`Dar Down (${data.dislikeCount ?? 0})`}><img className="ui-icon-sm" src={dislikeIcon} alt="" /> {data.dislikeCount}</span>
            </div>

            {(user.customStatus || user.customStatusEmoji) && (
              <div className="profile-custom-status-balloon">
                <StatusEmoji emoji={user.customStatusEmoji} /> {user.customStatus}
              </div>
            )}

            {data.badges?.length > 0 && (
              <div className="profile-badges-row">
                {data.badges.map((b) => (
                  <span key={b.id} className="profile-badge" title={`${b.name}${b.description ? ' — ' + b.description : ''}`}>
                    {b.icon}
                  </span>
                ))}
              </div>
            )}

            <hr />

            {user.bio && (
              <div className="profile-section">
                <div className="profile-section-label">SOBRE MIM</div>
                <div className="profile-section-body">{renderRichContent(user.bio, { emojiMap: bioEmojiMap })}</div>
              </div>
            )}

            {user.pronouns && (
              <div className="profile-section">
                <div className="profile-section-label">PRONOMES</div>
                <div className="profile-section-body">{user.pronouns}</div>
              </div>
            )}

            <div className="profile-section">
              <div className="profile-section-label">MEMBRO DESDE</div>
              <div className="profile-section-body">{new Date(user.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
            </div>

            {(user.youtubeUrl || user.steamUrl || user.robloxUrl || user.xUrl) && (
              <div className="profile-section">
                <div className="profile-section-label">CONEXÕES</div>
                <div className="profile-connections-row">
                  {user.youtubeUrl && (
                    <a className="profile-connection" href={user.youtubeUrl} target="_blank" rel="noreferrer" title="YouTube">
                      <span className="profile-connection-icon"><img className="ui-icon-sm" src={youtubeIcon} alt="" /></span> YouTube
                    </a>
                  )}
                  {user.steamUrl && (
                    <a className="profile-connection" href={user.steamUrl} target="_blank" rel="noreferrer" title="Steam">
                      <span className="profile-connection-icon"><img className="ui-icon-sm" src={steamIcon} alt="" /></span> Steam
                    </a>
                  )}
                  {user.robloxUrl && (
                    <a className="profile-connection" href={user.robloxUrl} target="_blank" rel="noreferrer" title="Roblox">
                      <span className="profile-connection-icon"><img className="ui-icon-sm" src={robloxIcon} alt="" /></span> Roblox
                    </a>
                  )}
                  {user.xUrl && (
                    <a className="profile-connection" href={user.xUrl} target="_blank" rel="noreferrer" title="X (Twitter)">
                      <span className="profile-connection-icon"><img className="ui-icon-sm" src={xIcon} alt="" /></span> X
                    </a>
                  )}
                </div>
              </div>
            )}

            {data.mutualServers?.length > 0 && (
              <div className="profile-section">
                <div className="profile-section-label">SERVIDORES EM COMUM — {data.mutualServers.length}</div>
                <div className="profile-mutual-list">
                  {data.mutualServers.map((s) => (
                    <div key={s.id} className="profile-mutual-item">
                      <div className="avatar tiny" style={{ background: '#F2894D' }}>
                        {s.icon ? <img src={s.icon} alt="" /> : s.name[0]?.toUpperCase()}
                      </div>
                      <span className="truncate">{s.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.mutualFriends?.length > 0 && (
              <div className="profile-section">
                <div className="profile-section-label">AMIGOS EM COMUM — {data.mutualFriends.length}</div>
                <div className="profile-mutual-list">
                  {data.mutualFriends.map((f) => (
                    <div key={f.id} className="profile-mutual-item">
                      <div className="avatar tiny">
                        <UserAvatar user={f} size={24} />
                      </div>
                      <span className="truncate">{f.displayName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {!loading && !user && <div className="dim dm-profile-empty">Não foi possível carregar este perfil.</div>}
    </aside>
  );
}
