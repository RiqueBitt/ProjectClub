import { useStore } from '../../store/useStore';
import { useMsgExtras, toggleIgnore } from '../../utils/messageExtras';

// Ações extras do perfil (igual ao Discord): "Adquira este visual",
// "Compartilhar perfil" e "Ignorar".
const idOf = (raw) => { try { return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw).id || null : null; } catch { return null; } };

// Itens da Loja que a pessoa está usando, no formato do link da Loja.
export function lookQuery(user) {
  if (!user) return '';
  const parts = [];
  const d = idOf(user.avatarDecoration); if (d) parts.push(`deco:${d}`);
  const e = idOf(user.profileEffect); if (e) parts.push(`effect:${e}`);
  const f = idOf(user.profileFont); if (f) parts.push(`font:${f}`);
  if (user.profileStyle) parts.push(`style:${user.profileStyle}`);
  return parts.join(',');
}

export function profileLink(user) {
  const base = window.location.origin.startsWith('http') ? window.location.origin : 'https://projectclub.shardweb.app';
  return `${base}/u/${user.id}`;
}

export async function shareProfile(user) {
  const url = profileLink(user);
  try {
    if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
      await navigator.share({ title: `${user.displayName} no Project Club`, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    useStore.getState().pushNotice('Link do perfil copiado.');
  } catch { /* cancelado */ }
}

export function IgnoreButton({ user }) {
  const ignored = useMsgExtras((s) => s.ignored.has(user.id));
  return (
    <button type="button" className="btn-secondary" title="Esconde as mensagens dessa pessoa pra você (ela não fica sabendo)" onClick={() => toggleIgnore(user)}>
      {ignored ? 'Parar de ignorar' : 'Ignorar'}
    </button>
  );
}
