import { CLAN_TAGS_ENABLED } from '../utils/featureFlags';
import ClanIcon from './ClanIcon.jsx';

// A tag de clã que este usuário escolheu mostrar (ver ClanPage.jsx —
// aba "Tags") — mesma ideia de TagBadge.jsx (tag de comunidade), só
// que vem de user.clanTag.tag em vez de tagEmoji/tagText. Renderiza
// nada se a pessoa não tiver escolhido nenhuma tag do clã dela, ou
// se CLAN_TAGS_ENABLED estiver desligado (ver featureFlags.js).
//
// Item pedido: "use o ícone do clã na tag em vez do emoji das
// espadas" — mostra o ícone de verdade do clã dono da tag (com a cor
// escolhida pra ele), caindo pro ícone genérico ⚔️ só se o clã nunca
// teve um ícone próprio escolhido.
export default function ClanTagBadge({ user }) {
  if (!CLAN_TAGS_ENABLED) return null;
  if (!user?.clanTag?.tag) return null;
  const clan = user.clanTag.clan;
  return (
    <span className="server-tag-badge inline clan-tag-badge" title={`Tag de clã: ${user.clanTag.tag}`}>
      <ClanIcon icon={clan?.icon} color={clan?.iconColor} size={14} /> {user.clanTag.tag}
    </span>
  );
}
