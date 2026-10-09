import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import { getUserProfile } from '../api/endpoints';
import { STATUS_LABEL } from '../utils/status';
import PresenceDot from './PresenceDot.jsx';
import { renderRichContent } from '../utils/richTextRender.jsx';
import { profileAccentVars } from '../utils/profileAccent';
import TagBadge from './TagBadge.jsx';
import ClanTagBadge from './ClanTagBadge.jsx';
import ActivityBadge from './ActivityBadge.jsx';
import ActivityIcon from './ActivityIcon.jsx';
import UserAvatar from './UserAvatar.jsx';
import likeIcon from '../assets/icons/like.png';
import dislikeIcon from '../assets/icons/dislike.png';
import youtubeIcon from '../assets/icons/social-youtube.png';
import steamIcon from '../assets/icons/social-steam.png';
import robloxIcon from '../assets/icons/social-roblox.png';
import xIcon from '../assets/icons/social-x.png';
import { proxyImage } from '../utils/imageProxy';
import { nameStyleProps, nameStyleClassName } from '../utils/nameStyle';
import { badgeHasImage } from '../utils/badgeRarity';
import { PfIcon, PfCard } from './modals/UserProfileModal.jsx';
import '../styles/profile.css';
import BannerImage from './ProfileBanner.jsx';
import { useLiveRefresh } from '../utils/liveRefresh';

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

  const openProfile = useStore((s) => s.openProfile);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!other) { setData(null); return; }
    setLoading(true);
    getUserProfile(other.id).then((result) => {
      setData(result);
      if (result?.activity) useStore.getState().setActivity(other.id, result.activity);
    }).catch(() => setData(null)).finally(() => setLoading(false));
  }, [other?.id]);

  // Tempo real (11s): perfil da outra pessoa da DM, em silêncio.
  useLiveRefresh(async ({ put, ok }) => {
    const result = await getUserProfile(other.id);
    put(setData)(result);
    if (ok() && result?.activity) useStore.getState().setActivity(other.id, result.activity);
  }, { enabled: !!other?.id && !!data, key: other?.id });

  if (!conversation) return null;

  if (conversation.isGroup) {
    return (
      <aside className="members-list dm-profile-panel dmp">
        <button className="icon-btn members-collapse" onClick={onToggle}>›</button>
        <div className="dmp-empty">
          <span className="pf-empty-icon"><PfIcon name="users" size={18} /></span>
          Conversas em grupo não têm um perfil único para mostrar aqui.
        </div>
      </aside>
    );
  }

  const user = data?.user;
  const status = presence?.status || user?.status || 'ONLINE';

  return (
    <aside
      className={`members-list dm-profile-panel dm-profile-accented dmp`}
      // Item pedido: a "placa de identificação" (idCardUrl) não usa mais
      // imagem própria de fundo aqui — sempre a cor do perfil da pessoa
      // (mesmo tratamento do perfil completo e do miniperfil), pra ficar
      // consistente em todo canto que mostra um perfil.
      style={user ? profileAccentVars(user.profileColor) : undefined}
    >
      <button className="icon-btn members-collapse" onClick={onToggle}>›</button>
      {loading && (
        <div className="dmp-skeleton" aria-label="Carregando perfil">
          <span className="pf-sk pf-sk-banner" />
          <span className="pf-sk dmp-sk-avatar" />
          <span className="pf-sk dmp-sk-line" style={{ width: '60%' }} />
          <span className="pf-sk dmp-sk-line" style={{ width: '40%' }} />
          <span className="pf-sk dmp-sk-card" />
        </div>
      )}
      {!loading && user && (
        <>
          <div className="dmp-banner profile-banner" style={{ background: user.bannerUrl ? undefined : 'transparent' }}>
            <BannerImage url={user.bannerUrl} framing={user.bannerFraming} />
          </div>
          <div className="dmp-head">
            <div className="avatar-wrap large">
              <div className="avatar xlarge">
                <UserAvatar user={user} size={80} />
              </div>
              <PresenceDot status={status} large title={STATUS_LABEL[status]} />
            </div>

            <h2 className="profile-display-name"><span className={nameStyleClassName(user, { fullEffect: true })} style={nameStyleProps(user, { fullEffect: true })}>{user.displayName}</span> <TagBadge user={user} /> <ClanTagBadge user={user} /></h2>
            <div className="profile-username">@{user.username}{user.pronouns && <span className="profile-pronouns-inline"> · {user.pronouns}</span>}</div>

            <div className="profile-custom-status-balloon">
              <ActivityIcon userId={user.id} customStatusEmoji={user.customStatusEmoji} customStatus={user.customStatus} />
            </div>
            <ActivityBadge userId={user.id} />

            <button type="button" className="dmp-open-full" onClick={() => openProfile(user.id)}>
              <PfIcon name="user" size={15} /> Ver perfil completo
            </button>
          </div>

          <div className="dmp-stats">
            <div className="dmp-stat" title="Ups">
              <b><img src={likeIcon} alt="" /> {data.totalUps ?? data.likeCount}</b>
              <span>Ups</span>
            </div>
            <div className="dmp-stat" title={`Downs (${data.dislikeCount ?? 0})`}>
              <b><img src={dislikeIcon} alt="" /> {data.dislikeCount ?? 0}</b>
              <span>Downs</span>
            </div>
            <div className="dmp-stat" title="Nível">
              <b>{user.accountLevel ?? 1}</b>
              <span>Nível</span>
            </div>
          </div>

          <div className="dmp-cards">
            {user.bio && (
              <PfCard icon="user" title="Sobre mim">
                <div className="pf-bio profile-section-body">{renderRichContent(user.bio, { emojiMap: bioEmojiMap })}</div>
              </PfCard>
            )}

            <PfCard icon="calendar" title="Membro desde">
              <div className="dmp-meta">{new Date(user.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
            </PfCard>

            {data.badges?.length > 0 && (
              <PfCard icon="medal" title="Insígnias" count={data.badges.length}>
                <div className="dmp-icons">
                  {data.badges.map((b) => (
                    <span key={b.id} className="dmp-icon" title={`${b.name}${b.description ? ' — ' + b.description : ''}`}>
                      {badgeHasImage(b) ? <img src={proxyImage(b.iconUrl)} alt="" /> : b.icon}
                    </span>
                  ))}
                </div>
              </PfCard>
            )}

            {data.displayedAchievements?.length > 0 && (
              <PfCard icon="trophy" title="Conquistas" count={data.displayedAchievements.length}>
                <div className="dmp-icons">
                  {data.displayedAchievements.map((a) => (
                    <span key={a.id} className="dmp-icon" title={`${a.name}${a.description ? ' — ' + a.description : ''}`}>
                      {a.iconUrl ? <img src={proxyImage(a.iconUrl)} alt="" /> : <PfIcon name="trophy" size={18} />}
                    </span>
                  ))}
                </div>
              </PfCard>
            )}

            {(user.youtubeUrl || user.steamUrl || user.robloxUrl || user.xUrl) && (
              <PfCard icon="link" title="Conexões">
                <div className="pf-connections">
                  {user.youtubeUrl && (
                    <a className="pf-connection" href={user.youtubeUrl} target="_blank" rel="noreferrer" title="YouTube">
                      <img src={youtubeIcon} alt="" /> YouTube
                    </a>
                  )}
                  {user.steamUrl && (
                    <a className="pf-connection" href={user.steamUrl} target="_blank" rel="noreferrer" title="Steam">
                      <img src={steamIcon} alt="" /> Steam
                    </a>
                  )}
                  {user.robloxUrl && (
                    <a className="pf-connection" href={user.robloxUrl} target="_blank" rel="noreferrer" title="Roblox">
                      <img src={robloxIcon} alt="" /> Roblox
                    </a>
                  )}
                  {user.xUrl && (
                    <a className="pf-connection" href={user.xUrl} target="_blank" rel="noreferrer" title="X (Twitter)">
                      <img src={xIcon} alt="" /> X
                    </a>
                  )}
                </div>
              </PfCard>
            )}

            {data.mutualServers?.length > 0 && (
              <PfCard icon="grid" title="Servidores em comum" count={data.mutualServers.length}>
                <div className="pf-people">
                  {data.mutualServers.map((s) => (
                    <div key={s.id} className="pf-person">
                      <span className="dmp-server-icon">
                        {s.icon ? <img src={s.icon} alt="" /> : s.name[0]?.toUpperCase()}
                      </span>
                      <span className="pf-person-name">{s.name}</span>
                    </div>
                  ))}
                </div>
              </PfCard>
            )}

            {data.mutualFriends?.length > 0 && (
              <PfCard icon="users" title="Amigos em comum" count={data.mutualFriends.length}>
                <div className="pf-people">
                  {data.mutualFriends.map((f) => (
                    <div key={f.id} className="pf-person">
                      <UserAvatar user={f} size={24} />
                      <span className="pf-person-name">{f.displayName}</span>
                    </div>
                  ))}
                </div>
              </PfCard>
            )}
          </div>
        </>
      )}
      {!loading && !user && (
        <div className="dmp-empty">
          <span className="pf-empty-icon"><PfIcon name="alert" size={18} /></span>
          Não foi possível carregar este perfil.
        </div>
      )}
    </aside>
  );
}
