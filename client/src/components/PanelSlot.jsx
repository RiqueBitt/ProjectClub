import { cloneElement } from 'react';
import { useStore } from '../store/useStore';

// Envolve UM painel real do app-shell (NavBar, ChannelSidebar, etc) e, se
// a staff já salvou uma posição customizada pra ele no Editor de
// Interface (client/src/pages/InterfaceEditorPage.jsx, seção "Posição dos
// painéis"), sobrescreve o grid-column/grid-row via style inline — sem
// isso, cada painel continua na posição padrão que o CSS normal já
// define. Não precisa de nenhuma div extra: injeta o style direto no
// elemento filho. A config já vem certa pro dispositivo atual (PC/Mobile)
// via useStore().uiLayout, que o MainApp.jsx já mantém atualizado.
export default function PanelSlot({ panelId, children }) {
  const panelPositions = useStore((s) => s.uiLayout?.panelPositions);
  if (!children) return null;

  const override = panelPositions?.[panelId];
  if (!override) return children;

  return cloneElement(children, {
    style: { ...(children.props.style || {}), gridColumn: override.gridColumn, gridRow: override.gridRow },
  });
}
