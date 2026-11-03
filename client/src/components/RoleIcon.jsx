// Ícone de um cargo: imagem enviada (URL "/media/..." ou https) ou emoji.
// Antes, alguns lugares imprimiam o ícone como texto e a imagem aparecia
// como o caminho do arquivo ("/media/....webp IA").
export const isRoleIconImage = (icon) => typeof icon === 'string' && (/^\//.test(icon) || /^https?:\/\//i.test(icon));

export default function RoleIcon({ icon, className = 'role-icon-inline' }) {
  if (!icon) return null;
  if (isRoleIconImage(icon)) return <img src={icon} alt="" className={className} loading="lazy" decoding="async" />;
  return <span className="role-icon-emoji" aria-hidden="true">{icon} </span>;
}
