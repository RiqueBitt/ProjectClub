import { useStore } from '../store/useStore';
import { proxyImage } from '../utils/imageProxy';
import StyledEmoji from './StyledEmoji.jsx';

// user.customStatusEmoji is either a plain unicode emoji character, or a
// `:name:` shortcode referencing one of the user's usable custom emojis
// (see EmojiPicker.jsx's onPick) — this is the one place that distinction
// gets resolved, so every place a status emoji is shown (MainSidebar,
// DMProfilePanel, UserProfileModal...) renders it the same way instead of
// just dumping the raw shortcode text on screen.
export default function StatusEmoji({ emoji, className }) {
  const usableEmojis = useStore((s) => s.usableEmojis);
  if (!emoji) return null;
  const match = emoji.match(/^:(.+):$/);
  if (match) {
    const found = usableEmojis?.find((e) => e.name === match[1]);
    // Bug fix: this used to render nothing at all when the shortcode
    // didn't match a custom emoji the *viewer* currently has access to
    // (e.g. it belongs to a server only the status-setter is in) — instead
    // of silently disappearing, fall back to the plain shortcode text so
    // something always shows up next to the status, same as any other
    // "can't render this, show the raw text" fallback in the app.
    if (!found) return <span className={className}>{emoji}</span>;
    return <img className={`status-emoji-img ${className || ''}`} src={proxyImage(found.url)} alt="" />;
  }
  // Item pedido: "adicione [estilo de emoji]... em tudo" — emoji unicode
  // (não shortcode de servidor) respeita o estilo escolhido pela pessoa.
  return <StyledEmoji emoji={emoji} size={18} className={className} />;
}
