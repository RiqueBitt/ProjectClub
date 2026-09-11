import { useEffect, useState } from 'react';

// Item pedido: "no app do Project Club, faça igual ao launcher, e crie
// uma barra que não seja do Windows, de fechar aba, minimizar, aumentar
// etc" — mesmo padrão visual/funcional do ProjectMC (launcher de
// Minecraft, AppSystemBar.vue: 3 botões simples com hover semi-
// transparente, o de fechar com hover vermelho). Só renderiza de
// verdade dentro do app desktop (window.electronAPI existe) — no
// navegador normal ou no app mobile a janela continua com a moldura
// nativa de sempre, então não faz sentido nenhum mostrar isso ali.
export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const isElectron = typeof window !== 'undefined' && !!window.electronAPI?.windowMinimize;

  useEffect(() => {
    if (!isElectron) return;
    window.electronAPI.windowIsMaximized().then(setIsMaximized).catch(() => {});
    // O estado também pode mudar por outro caminho além dos botões
    // daqui (duplo-clique na barra, Win+Up, arrastar pro topo da tela)
    // — sem esse listener, o ícone maximizar/restaurar ficaria
    // dessincronizado do estado real da janela nesses casos.
    const unsubscribe = window.electronAPI.onWindowMaximizedChanged?.(setIsMaximized);
    return () => unsubscribe?.();
  }, [isElectron]);

  if (!isElectron) return null;

  return (
    <div className="app-title-bar">
      <div className="app-title-bar-drag" onDoubleClick={() => window.electronAPI.windowMaximizeToggle()} />
      <div className="app-title-bar-controls">
        <button
          type="button"
          className="app-title-bar-btn"
          aria-label="Minimizar"
          onClick={() => window.electronAPI.windowMinimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><rect y="4.5" width="10" height="1" fill="currentColor" /></svg>
        </button>
        <button
          type="button"
          className="app-title-bar-btn"
          aria-label={isMaximized ? 'Restaurar' : 'Maximizar'}
          onClick={() => window.electronAPI.windowMaximizeToggle()}
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="1.5" y="0" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="0" y="2" width="8" height="8" fill="var(--bg-primary, #1a1a1a)" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          )}
        </button>
        <button
          type="button"
          className="app-title-bar-btn app-title-bar-btn--close"
          aria-label="Fechar"
          onClick={() => window.electronAPI.windowClose()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.2" />
            <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
