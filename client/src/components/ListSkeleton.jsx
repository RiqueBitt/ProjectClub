import { useEffect, useState } from 'react';
import '../styles/speed.css';

// Esqueleto das listas (canais, membros, conversas) enquanto os dados
// chegam — mesmo visual pulsante do esqueleto do chat (.chat-skeleton),
// parado pra quem prefere menos movimento. Se nada chegar em 15s (sem
// internet e sem cópia local), some e deixa a lista mostrar o "vazio".
const WIDTHS = [72, 54, 81, 46, 63, 58, 76, 49];

export default function ListSkeleton({ variant = 'channels', rows = 7, label = 'Carregando…' }) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setExpired(true), 15000);
    return () => clearTimeout(t);
  }, []);
  if (expired) return null;

  const withAvatar = variant !== 'channels';
  return (
    <div className={`list-skeleton list-skeleton-${variant}`} role="status" aria-label={label} aria-busy="true">
      {variant === 'channels' && <span className="list-skeleton-heading" />}
      {variant === 'members' && <span className="list-skeleton-heading short" />}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="list-skeleton-row">
          {withAvatar ? <span className="list-skeleton-avatar" /> : <span className="list-skeleton-icon" />}
          <span className="list-skeleton-lines">
            <span className="list-skeleton-line" style={{ width: `${WIDTHS[i % WIDTHS.length]}%` }} />
            {variant === 'dms' && <span className="list-skeleton-line sub" style={{ width: `${WIDTHS[(i + 3) % WIDTHS.length] - 18}%` }} />}
          </span>
        </div>
      ))}
    </div>
  );
}
