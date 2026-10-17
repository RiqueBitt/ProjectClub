import { Suspense } from 'react';
import { lazyWithRetry as lazy } from '../utils/lazyWithRetry';
import ErrorBoundary from './ErrorBoundary.jsx';

// O seletor carrega a lista completa de emojis Unicode (~400 KB). Ele só
// é baixado na primeira vez que alguém abre o seletor, em vez de entrar
// no pacote inicial que todo mundo baixa ao abrir o app.
const EmojiPickerPanel = lazy(() => import('./EmojiPickerPanel.jsx'));

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
