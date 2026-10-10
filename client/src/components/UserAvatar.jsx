import PenguinAvatar, { isPenguinAvatarUrl, penguinColorFromUrl } from './PenguinAvatar.jsx';
import { proxyImage } from '../utils/imageProxy';
import '../styles/avatar-deco.css';

// Avatar compartilhado — usado em todo lugar que hoje mostra a foto do
// usuário (barra de navegação, lista de membros, mensagens, perfil...).
// Além da foto normal, entende o "pseudo-URL" que o seletor de avatar de
// pinguim grava em avatarUrl (ver PenguinAvatar.jsx) e desenha o SVG do
// pinguim no lugar — sem precisar de upload nem mudar o schema do backend
// (avatarUrl continua sendo uma string comum).
// Moldura da loja (User.avatarDecoration = JSON {id,url,s,x,y}).
const decoCache = new Map();
export function parseDecoration(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw.url ? raw : null;
  if (decoCache.has(raw)) return decoCache.get(raw);
  let v = null;
  try { const o = JSON.parse(raw); if (o?.url) v = o; } catch { v = null; }
  decoCache.set(raw, v);
  return v;
}

// A moldura ocupa exatamente o espaço do avatar (como no Discord): a foto
// encolhe um pouco por dentro e a moldura fica em volta, então nada passa
// da caixa e nenhum contêiner com overflow:hidden corta as bordas.
export function DecorationOverlay({ deco, size }) {
  if (!deco) return null;
  return (
    <img
      className="avatar-decoration" src={proxyImage(deco.url)} alt="" aria-hidden="true" draggable="false"
      style={{
        position: 'absolute', inset: 0, width: size, height: size, maxWidth: 'none', pointerEvents: 'none', zIndex: 2,
        objectFit: 'contain',
        transform: (deco.x || deco.y) ? `translate(${Number(deco.x) || 0}%, ${Number(deco.y) || 0}%)` : undefined,
      }}
    />
  );
}

const OUTER_KEYS = ['margin', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom', 'position', 'top', 'left', 'right', 'bottom', 'alignSelf', 'gridArea', 'order'];

export default function UserAvatar({ user, size = 32, className = '', style = {}, noDecoration = false }) {
  const deco = noDecoration ? null : parseDecoration(user?.avatarDecoration);
  if (!deco) return <BaseAvatar user={user} size={size} className={className} style={style} />;
  const scale = Math.min(2, Math.max(1, Number(deco.s) || 1.2));
  const inner = Math.round(size / scale);
  const outer = { position: 'relative', width: size, height: size, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
  for (const k of OUTER_KEYS) if (style[k] !== undefined) outer[k] = style[k];
  return (
    <span className="avatar-deco-wrap" style={outer}>
      <BaseAvatar user={user} size={inner} className={className} style={stripOuter(style)} />
      <DecorationOverlay deco={deco} size={size} />
    </span>
  );
}

function stripOuter(style) {
  const out = { ...style };
  for (const k of OUTER_KEYS) delete out[k];
  return out;
}

function BaseAvatar({ user, size, className, style }) {
  const url = user?.avatarUrl;
  // BUG CORRIGIDO: 'var(--brand)' é a cor de destaque do TEMA — uma
  // variável de CSS que muda dependendo do tema escolhido por QUEM ESTÁ
  // VENDO a tela (claro/escuro/Club Penguin/etc — ver global.css), não um
  // valor fixo da pessoa dona do perfil. Pra quem não definiu (ou não
  // pode definir, com o sistema "Cores de perfil" desligado pela staff —
  // ver userController.js) uma cor própria, isso fazia o fundo do avatar
  // "herdar" o tema de quem está olhando, e mudar de cor dependendo de
  // QUEM abre o perfil — inclusive repetindo a cor do próprio tema de
  // quem está vendo. O resto do app já usa uma cor fixa e neutra
  // ('#F2894D') como reserva pra esse caso (ver ChatWindow.jsx,
  // VoiceChannelView.jsx, IncomingCallBanner.jsx, DMProfilePanel.jsx) —
  // só este componente, sendo o mais usado de todos, tinha ficado com a
  // reserva errada.
  const bg = user?.profileColor || '#F2894D';

  const wrapperStyle = {
    width: size, height: size, borderRadius: '50%', overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: bg, flexShrink: 0, ...style,
  };

  if (url && isPenguinAvatarUrl(url)) {
    return (
      <div className={`avatar ${className}`} style={wrapperStyle}>
        <PenguinAvatar color={penguinColorFromUrl(url)} size={size} />
      </div>
    );
  }

  if (url) {
    return (
      <div className={`avatar ${className}`} style={wrapperStyle}>
        <img src={proxyImage(url)} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  return (
    <div className={`avatar ${className}`} style={{ ...wrapperStyle, color: '#fff', fontWeight: 700, fontSize: size * 0.45 }}>
      {(user?.displayName || '?')[0]?.toUpperCase()}
    </div>
  );
}
