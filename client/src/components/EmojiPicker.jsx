import { Suspense } from 'react';
import { lazyWithRetry as lazy } from '../utils/lazyWithRetry';
import ErrorBoundary from './ErrorBoundary.jsx';

// O seletor carrega a lista completa de emojis Unicode (~400 KB). Ele só
// é baixado na primeira vez que alguém abre o seletor, em vez de entrar
// no pacote inicial que todo mundo baixa ao abrir o app.
const loadPanel = () => import('./EmojiPickerPanel.jsx');
const EmojiPickerPanel = lazy(loadPanel);

// Baixa o seletor quando o app fica ocioso (alguns segundos depois de
// abrir), então a 1ª abertura do menu já é instantânea — antes só começava
// a baixar no clique.
if (typeof window !== 'undefined') {
  const ric = window.requestIdleCallback || ((cb) => setTimeout(cb, 1500));
  setTimeout(() => ric(() => { loadPanel().catch(() => {}); }, { timeout: 8000 }), 4000);
}

// Fronteira de erro LOCAL: se o pedaço do seletor falhar (ex.: deploy no
// meio da sessão), só o seletor mostra o aviso — o chat continua de pé.
export default function EmojiPicker(props) {
  return (
    <ErrorBoundary compact>
      <Suspense fallback={<div className="emoji-picker-loading" style={props.style} aria-busy="true" />}>
        <EmojiPickerPanel {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}
