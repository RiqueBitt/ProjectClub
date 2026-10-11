import { useState } from 'react';
import '../../styles/game-library.css';

// Peças da Biblioteca de jogos usadas na página (/jogos/biblioteca) e
// na seção "Jogos" do perfil completo.

const PATHS = {
  gamepad: 'M6 9h12a4 4 0 0 1 3.9 4.8l-.8 3.6a2.3 2.3 0 0 1-3.9 1L15 16H9l-2.2 2.4a2.3 2.3 0 0 1-3.9-1l-.8-3.6A4 4 0 0 1 6 9ZM8 11.5v3M6.5 13h3M15.5 12.5h.01M17.5 14.5h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  search: 'm20 20-4.2-4.2M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  back: 'm15 18-6-6 6-6',
  play: 'M8 5v14l11-7L8 5Z',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
};
export function GlIcon({ name, size = 16, strokeWidth = 1.9 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

// "45 min", "12,5 horas", "1 hora".
export function formatPlaytime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  if (s < 60) return s > 0 ? 'menos de 1 min' : '0 min';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  const h = s / 3600;
  const txt = h < 100 ? h.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : Math.round(h).toLocaleString('pt-BR');
  return `${txt} ${txt === '1' ? 'hora' : 'horas'}`;
}

// Só o número de horas (para os totais grandes).
export function formatHoursShort(seconds) {
  const h = (Number(seconds) || 0) / 3600;
  if (h > 0 && h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  return `${h < 100 ? h.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : Math.round(h).toLocaleString('pt-BR')} h`;
}

export function formatLastSession(date, playingNow) {
  if (playingNow) return 'Agora';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(d)) / 86400000);
  if (days <= 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  if (days < 7) return `Há ${days} dias`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).replace('.', '');
}

function hueFor(key) {
  let h = 0;
  for (const ch of String(key || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

// Capa estilo Steam (proporção 460x215). Steam App ID -> capa pelo nosso
// proxy; sem ele (ou se falhar), degradê com logo/nome.
export function GameCapsule({ game, size = 'md' }) {
  const [failed, setFailed] = useState(false);
  const src = game.steamAppId && !failed ? `/api/proxy/steam/${game.steamAppId}/header` : null;
  const hue = hueFor(game.gameKey || game.name);
  return (
    <span className={`gl-capsule gl-capsule-${size}`} style={{ '--gl-hue': hue }}>
      {src ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="gl-capsule-fallback">
          {game.iconUrl && !game.steamAppId && <img className="gl-capsule-logo" src={game.iconUrl} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
          <span className="gl-capsule-name">{game.name}</span>
        </span>
      )}
      {game.playingNow && <span className="gl-capsule-live">Jogando</span>}
    </span>
  );
}

// Linha da lista (capa grande + nome + TEMPO DE JOGO + ÚLTIMA SESSÃO).
export function GameRow({ game, compact = false }) {
  return (
    <div className={`gl-row ${compact ? 'is-compact' : ''} ${game.playingNow ? 'is-live' : ''}`}>
      <GameCapsule game={game} size={compact ? 'sm' : 'md'} />
      <div className="gl-row-main">
        <div className="gl-row-name" title={game.name}>{game.name}</div>
        <div className="gl-row-stats">
          <div className="gl-row-stat">
            <span className="gl-row-stat-label">Tempo de jogo</span>
            <span className="gl-row-stat-value">{formatPlaytime(game.totalSeconds)}</span>
          </div>
          <div className="gl-row-stat">
            <span className="gl-row-stat-label">Última sessão</span>
            <span className={`gl-row-stat-value ${game.playingNow ? 'is-live' : ''}`}>{formatLastSession(game.lastPlayedAt, game.playingNow)}</span>
          </div>
          {!compact && game.sessions > 0 && (
            <div className="gl-row-stat gl-row-stat-hide-sm">
              <span className="gl-row-stat-label">Sessões</span>
              <span className="gl-row-stat-value">{game.sessions.toLocaleString('pt-BR')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const VIS_LABEL = { everyone: 'Todos', friends: 'Amigos', nobody: 'Ninguém' };
export function visibilityLabel(v) { return VIS_LABEL[v] || 'Amigos'; }

// Biblioteca fechada pela privacidade da pessoa.
export function LockedLibrary({ name, visibility }) {
  return (
    <div className="gl-empty gl-locked">
      <span className="gl-empty-icon"><GlIcon name="lock" size={22} /></span>
      <h3>Biblioteca privada</h3>
      <p>
        {visibility === 'friends'
          ? `${name || 'Essa pessoa'} mostra os jogos só para amigos. Adicione como amigo para ver.`
          : `${name || 'Essa pessoa'} preferiu não mostrar os jogos.`}
      </p>
    </div>
  );
}

export function EmptyLibrary({ isMe, name }) {
  return (
    <div className="gl-empty">
      <span className="gl-empty-icon"><GlIcon name="gamepad" size={22} /></span>
      <h3>{isMe ? 'Sua biblioteca está vazia' : 'Nenhum jogo ainda'}</h3>
      <p>
        {isMe
          ? 'Jogue com o app de desktop do Project Club aberto — o tempo de cada jogo é registrado aqui sozinho.'
          : `${name || 'Essa pessoa'} ainda não tem tempo de jogo registrado.`}
      </p>
    </div>
  );
}

export function LibrarySkeleton({ rows = 4 }) {
  return (
    <div className="gl-list">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="gl-row gl-skeleton" />)}
    </div>
  );
}
