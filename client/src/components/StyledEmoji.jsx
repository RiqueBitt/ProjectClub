import { useState } from 'react';
import { useStore } from '../store/useStore';
import { emojiImageUrl } from '../utils/emojiStyle';

// Item pedido: "5 variantes de visual dos meus emoji" — usado no lugar
// de {emoji} puro em qualquer lugar que precisa respeitar o estilo
// escolhido pela pessoa. Fallback gracioso: se a imagem do CDN falhar
// (emoji raro que não existe naquele conjunto específico, CDN fora do
// ar), cai pro texto normal em vez de mostrar um ícone quebrado —
// nunca deixa o emoji "sumir" da tela.
export default function StyledEmoji({ emoji, size = 20, className }) {
  const style = useStore((s) => s.emojiStyle);
  const [failed, setFailed] = useState(false);
  const url = style !== 'native' && !failed ? emojiImageUrl(emoji, style) : null;

  if (!url) return <span className={className}>{emoji}</span>;

  return (
    <img
      src={url} alt={emoji} draggable={false}
      className={`styled-emoji ${className || ''}`}
      style={{ width: size, height: size, verticalAlign: 'middle' }}
      onError={() => setFailed(true)}
    />
  );
}
