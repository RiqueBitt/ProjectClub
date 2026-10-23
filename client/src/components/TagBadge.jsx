// A user's chosen community tag (see ServerTagTab.jsx / UserSettingsModal.jsx
// "Tags" tab) — a small emoji+text box shown right after their name.
// Renders nothing if the user hasn't picked one.
export default function TagBadge({ user }) {
  if (!user?.tagEmoji || !user?.tagText) return null;
  return <span className="server-tag-badge inline" title={`Tag de comunidade: ${user.tagText}`}>{user.tagEmoji} {user.tagText}</span>;
}
