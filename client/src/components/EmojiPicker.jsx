import { Suspense, lazy } from 'react';

// O seletor carrega a lista completa de emojis Unicode (~400 KB). Ele só
// é baixado na primeira vez que alguém abre o seletor, em vez de entrar
// no pacote inicial que todo mundo baixa ao abrir o app.
const EmojiPickerPanel = lazy(() => import('./EmojiPickerPanel.jsx'));

export default function EmojiPicker(props) {
  return (
    <Suspense fallback={<div className="emoji-picker-loading" style={props.style} aria-busy="true" />}>
      <EmojiPickerPanel {...props} />
    </Suspense>
  );
}
