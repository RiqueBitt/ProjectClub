import UserAvatar from '../UserAvatar.jsx';
import ProfileEffectOverlay from '../ProfileEffectOverlay.jsx';
import { proxyImage } from '../../utils/imageProxy';

// Prévias usadas na Loja e no painel da staff.

// Moldura → JSON igual ao que fica em User.avatarDecoration.
export const decoValue = (d) => (d ? { id: d.id, url: d.imageUrl, s: d.scale, x: d.offsetX, y: d.offsetY } : null);
// Efeito → JSON igual ao que fica em User.profileEffect.
export const effectValue = (e) => (e ? {
  id: e.id, url: e.imageUrl,
  d: { s: e.scale, x: e.offsetX, y: e.offsetY, o: e.opacity, t: e.duration },
  m: { s: e.mScale, x: e.mOffsetX, y: e.mOffsetY, o: e.mOpacity, t: e.mDuration },
} : null);

// Mini perfil de mentira (banner + avatar + nome) com o efeito por cima.
// size: 'card' (grade da loja), 'big' (detalhe), 'mini' (320px) ou 'phone'.
export function MockProfile({ user, effect, deco, size = 'card', mobile, loop = true, wide = false }) {
  const accent = user?.profileColor || 'var(--brand)';
  const banner = user?.miniProfileBannerUrl || user?.bannerUrl;
  const av = size === 'card' ? 54 : size === 'phone' ? 92 : 76;
  const shownUser = deco !== undefined ? { ...user, avatarDecoration: deco } : user;
  return (
    <div className={`shop-mock shop-mock-${size}${wide ? ' wide' : ''}`} style={{ '--mock-accent': accent }}>
      <div className="shop-mock-banner">
        {banner && <img src={proxyImage(banner)} alt="" loading="lazy" decoding="async" />}
      </div>
      <div className="shop-mock-body">
        <div className="shop-mock-avatar"><UserAvatar user={shownUser} size={av} /></div>
        <strong>{user?.displayName || 'Você'}</strong>
        <small>@{user?.username || 'usuario'}</small>
        <div className="shop-mock-lines"><span /><span /><span /></div>
      </div>
      {effect && <ProfileEffectOverlay effect={effect} variant="box" mobile={mobile} loop={loop} />}
    </div>
  );
}
