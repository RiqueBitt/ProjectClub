import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { emojiImageUrl } from '../utils/emojiStyle';

// Item pedido: "5 variantes de visual dos meus emoji" — usado no lugar
// de {emoji} puro em qualquer lugar que precisa respeitar o estilo
// escolhido pela pessoa.
//
// BUG CORRIGIDO ("tem tema de emoji que não tem os emojis do tema...
// fica com a imagem corrompida"): alguns emojis raros/recentes não
// existem em todos os conjuntos (Fluent e OpenMoji, em especial, têm
// cobertura incompleta) — a imagem falha ao carregar. Só trocar pro
// texto DEPOIS do erro (onError) deixava o ícone de "imagem quebrada"
// do próprio navegador aparecer por um instante antes disso. Agora
// mostra o texto normal (como se já fosse o resultado final) desde o
// início, e só troca pra imagem quando ela realmente confirma que
// carregou (onLoad) — nunca existe uma janela de tempo em que um
// ícone quebrado pode aparecer na tela.
export default function StyledEmoji({ emoji, size, className }) {
  const style = useStore((s) => s.emojiStyle);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = style !== 'native' ? emojiImageUrl(emoji, style) : null;

  // Reseta ao trocar de emoji/estilo — sem isso, uma instância de
  // componente reaproveitada pra outro emoji ficaria presa no estado
  // (loaded/failed) do emoji anterior até a próxima falha/sucesso.
  useEffect(() => { setLoaded(false); setFailed(false); }, [emoji, style]);

  if (!url || failed || !loaded) {
    return (
      <span className={className} style={size ? { fontSize: size } : undefined}>
        {emoji}
        {url && !failed && (
          <img src={url} alt="" draggable={false} style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
        )}
      </span>
    );
  }

  const dimension = size ?? '1em';
  return (
    <img
      src={url} alt={emoji} draggable={false}
      className={`styled-emoji ${className || ''}`}
      style={{ width: dimension, height: dimension, verticalAlign: 'middle' }}
      onError={() => setFailed(true)}
    />
  );
}
