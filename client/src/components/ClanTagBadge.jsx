// A tag de clã que este usuário escolheu mostrar (ver ClanPage.jsx —
// aba "Tags") — mesma ideia de TagBadge.jsx (tag de comunidade), só
// que vem de user.clanTag.tag em vez de tagEmoji/tagText. Renderiza
// nada se a pessoa não tiver escolhido nenhuma tag do clã dela.
export default function ClanTagBadge({ user }) {
  if (!user?.clanTag?.tag) return null;
  return <span className="server-tag-badge inline clan-tag-badge" title={`Tag de clã: ${user.clanTag.tag}`}>⚔️ {user.clanTag.tag}</span>;
}
