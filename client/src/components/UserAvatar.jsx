import PenguinAvatar, { isPenguinAvatarUrl, penguinColorFromUrl } from './PenguinAvatar.jsx';
import { proxyImage } from '../utils/imageProxy';

// Avatar compartilhado — usado em todo lugar que hoje mostra a foto do
// usuário (barra de navegação, lista de membros, mensagens, perfil...).
// Além da foto normal, entende o "pseudo-URL" que o seletor de avatar de
// pinguim grava em avatarUrl (ver PenguinAvatar.jsx) e desenha o SVG do
// pinguim no lugar — sem precisar de upload nem mudar o schema do backend
// (avatarUrl continua sendo uma string comum).
export default function UserAvatar({ user, size = 32, className = '', style = {} }) {
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
        <img src={proxyImage(url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }

  return (
    <div className={`avatar ${className}`} style={{ ...wrapperStyle, color: '#fff', fontWeight: 700, fontSize: size * 0.45 }}>
      {(user?.displayName || '?')[0]?.toUpperCase()}
    </div>
  );
}
