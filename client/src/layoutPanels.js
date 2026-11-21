// Painéis que compõem a grade principal do app (.app-shell) e suas
// posições PADRÃO (as mesmas que o CSS normal já usa) — usado tanto pela
// seção "Posição dos painéis" do Editor de Interface (pages/
// InterfaceEditorPage.jsx), pra desenhar a grade arrastável, quanto pelo
// app normal (components/PanelSlot.jsx), pra aplicar a posição
// customizada por cima do padrão quando a staff já salvou uma.
//
// PC: grade de 2 colunas × 4 linhas (a mesma do .app-shell real: 1fr |
// auto  ×  navbar | menu superior | conteúdo | callbar). A antiga
// coluna de 88px (barra de seções) e a coluna da barra lateral de canais
// não existem mais — "Canais"/"Amigos" viraram dropdowns do TopMenu.jsx,
// que ocupa a própria linha 2 em vez de uma coluna lateral. O antigo
// painel "userpanel" (perfil abaixo do campo de digitação) também saiu —
// o único perfil do usuário agora vive no rodapé da MainSidebar, que não
// é um painel arrastável aqui, é parte fixa da barra lateral.
// MOBILE: grade de 1 coluna × 2 linhas — no celular o menu superior e a
// barra lateral de canais/DMs viram gavetas que deslizam por cima
// (position: fixed), não fazem parte da grade visível, então só os
// painéis que continuam na grade normal aparecem no editor mobile.
export const PC_PANELS = {
  navbar: { label: 'Barra superior', gridColumn: '1 / -1', gridRow: '1' },
  topMenu: { label: 'Menu superior (Canais/Amigos/...)', gridColumn: '1 / -1', gridRow: '2' },
  main: { label: 'Área principal (chat)', gridColumn: '1', gridRow: '3 / -1' },
  membersList: { label: 'Lista de membros', gridColumn: '2', gridRow: '3 / -1' },
  callbar: { label: 'Barra de chamada', gridColumn: '1', gridRow: '4' },
};

export const MOBILE_PANELS = {
  navbar: { label: 'Barra superior', gridColumn: '1', gridRow: '1' },
  main: { label: 'Área principal (chat)', gridColumn: '1', gridRow: '1' },
  callbar: { label: 'Barra de chamada', gridColumn: '1', gridRow: '2' },
};

export const GRID_DIMENSIONS = {
  PC: { columns: 2, rows: 4 },
  MOBILE: { columns: 1, rows: 2 },
};

export function panelsForDevice(device) {
  return device === 'MOBILE' ? MOBILE_PANELS : PC_PANELS;
}
