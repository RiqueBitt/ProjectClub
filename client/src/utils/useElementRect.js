import { useEffect, useRef, useState } from 'react';

// BUG CORRIGIDO ("o menu de GIF/emoji está passando da tela de
// usuário online, não pode ultrapassar"): a correção anterior ancorava
// o menu a uma distância FIXA da borda direita da JANELA INTEIRA
// (right: 16px) — só que a coluna de chat não vai até a borda da
// janela: a lista de membros ("usuários online") ocupa uma faixa
// própria à direita dela (ver --members-width em .app-shell,
// global.css). Ancorar relativo à janela inteira colocava o menu
// literalmente ATRÁS/DENTRO dessa faixa. Esse hook mede a posição
// REAL da coluna de chat (não um valor de largura fixo — a lista de
// membros pode estar mais larga/estreita, ou nem existir dependendo
// da página), e se atualiza sozinho se ela mudar de tamanho.
export function useElementRect() {
  const ref = useRef(null);
  const [rect, setRect] = useState(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setRect(el.getBoundingClientRect());
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, []);

  return [ref, rect];
}
