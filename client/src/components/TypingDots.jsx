import { useStore } from '../store/useStore';
import '../styles/nav.css';

// Bolinhas animadas "digitando…" pra listas (canais e DMs): aparecem ao
// lado do nome quando alguém (que não é você) está digitando naquela sala.
// O seletor devolve só um booleano — a linha só re-renderiza quando muda.
export default function TypingDots({ roomKey, myUserId, title = 'Alguém está digitando' }) {
  const someoneTyping = useStore((s) => {
    const list = s.typing[roomKey];
    if (!list || list.length === 0) return false;
    return list.some((id) => id !== myUserId);
  });
  if (!someoneTyping) return null;
  return (
    <span className="list-typing-dots" role="img" aria-label={title} title={title}>
      <i /><i /><i />
    </span>
  );
}
