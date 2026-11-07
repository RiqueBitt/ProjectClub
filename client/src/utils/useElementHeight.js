import { useEffect, useRef, useState } from 'react';

// Item pedido: "faça o menu ficar em cima da barra de escrever
// mensagens, porque ele está ficando sobre ela" — um valor fixo em
// pixels pra "altura da barra de composição" é frágil, porque essa
// barra CRESCE (barra de "respondendo a", arquivos anexados, etc) —
// um número fixo que funciona quando ela está no tamanho normal passa
// a ficar pequeno demais assim que ela cresce, voltando a sobrepor.
// Esse hook mede a altura REAL do elemento e se atualiza sozinho
// sempre que ela mudar (ResizeObserver), pra qualquer popover que
// precise se posicionar "logo acima" dela nunca ficar por baixo.
export function useElementHeight() {
  const ref = useRef(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setHeight(el.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      setHeight(entries[0].contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, height];
}
