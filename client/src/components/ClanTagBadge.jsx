import { CLAN_TAGS_ENABLED } from '../utils/featureFlags';

// A tag de clã que este usuário escolheu mostrar (ver ClanPage.jsx —
// aba "Tags") — mesma ideia de TagBadge.jsx (tag de comunidade), só
// que vem de user.clanTag.tag em vez de tagEmoji/tagText. Renderiza
// nada se a pessoa não tiver escolhido nenhuma tag do clã dela, ou
// se CLAN_TAGS_ENABLED estiver desligado (ver featureFlags.js).
export default function ClanTagBadge({ user }) {
  if (!CLAN_TAGS_ENABLED) return null;
  if (!user?.clanTag?.tag) return null;
  return <span className="server-tag-badge inline clan-tag-badge" title={`Tag de clã: ${user.clanTag.tag}`}>⚔️ {user.clanTag.tag}</span>;
}
