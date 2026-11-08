// Club Penguin em segundo plano.
//
// Antes, sair da página do jogo (ir pro chat, loja, perfil…) desmontava o
// Ruffle: o pinguim saía da ilha e, ao voltar, tudo carregava de novo. Agora o
// jogo fica montado aqui, fora das rotas, depois da primeira vez que a pessoa
// abre /praca:
//  - na página /praca ele aparece normal (mesmo lugar e tamanho de sempre);
//  - fora dela ele continua conectado (mesma sala, voz por proximidade,
//    moedas, amigos), mas sem desenhar nada: o palco vira 1×1 px, a qualidade
//    cai pra "low" (sem anti-aliasing, quase nada de memória de vídeo) e o som
//    do jogo fica mudo. Voltar devolve tudo como estava, sem carregar.
// Um aviso pequeno no canto mostra que ele está rodando, com "Voltar" e
// "Fechar". Esquecido em segundo plano por muito tempo, ele fecha sozinho.
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const PracaPage = lazy(() => import('../pages/PracaPage.jsx'));

export const PRACA_PATH = '/praca';
const IDLE_CLOSE_MS = 60 * 60 * 1000; // 1 h esquecido em segundo plano → fecha

export default function PracaKeepAlive({ fallback = null }) {
  const location = useLocation();
  const onPraca = location.pathname === PRACA_PATH;
  const [alive, setAlive] = useState(onPraca);

  useEffect(() => { if (onPraca) setAlive(true); }, [onPraca]);

  const close = useCallback(() => setAlive(false), []);

  // fecha sozinho depois de muito tempo em segundo plano
  useEffect(() => {
    if (!alive || onPraca) return undefined;
    const t = window.setTimeout(close, IDLE_CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [alive, onPraca, close]);

  if (!alive) return null;
  return (
    <Suspense fallback={onPraca ? fallback : null}>
      <PracaPage background={!onPraca} onClose={close} />
    </Suspense>
  );
}
