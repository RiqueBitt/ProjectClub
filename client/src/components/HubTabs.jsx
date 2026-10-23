import { useNavigate } from 'react-router-dom';
import { PillTabs } from './PagesKit.jsx';
import '../styles/hub-tabs.css';

// Barra de abas compartilhada pelas áreas que foram unificadas:
//  - "Anúncios e Eventos" (/anuncios + /comunidade/eventos)
//  - Economia + Loja (/economia, /missoes, /loja)
// Cada aba continua sendo a página que já existia (mesmos dados, rotas,
// permissões e links profundos) — a unificação é de navegação, não de
// dados: nada é fundido no banco.

export const ANNOUNCE_EVENTS_TABS = [
  { id: 'anuncios', label: 'Anúncios', icon: 'megaphone', to: '/anuncios' },
  { id: 'eventos', label: 'Eventos', icon: 'calendar', to: '/comunidade/eventos' },
];

// "Loja" fica imediatamente à esquerda do Passe do clube (pedido).
export const ECONOMY_HUB_TABS = [
  { id: 'geral', label: 'Visão geral', icon: 'grid', to: '/economia' },
  { id: 'missoes', label: 'Missões', icon: 'bolt', to: '/missoes' },
  { id: 'loja', label: 'Loja', icon: 'store', to: '/loja' },
  { id: 'temporada', label: 'Passe do clube', icon: 'crown', to: '/economia?aba=temporada', className: 'pk-tab-gold' },
  { id: 'historico', label: 'Histórico', icon: 'clock', to: '/economia?aba=historico' },
];

export function hubPathFor(tabs, id) {
  return tabs.find((t) => t.id === id)?.to || tabs[0].to;
}

// Barra fina no topo das páginas que não têm abas próprias pra encaixar
// (Loja, Anúncios, Eventos). `extra` permite trocar o rótulo/contagem de
// uma aba sem duplicar a lista.
export default function HubTabs({ tabs, value, label, extra = {}, onSelect }) {
  const navigate = useNavigate();
  const shown = tabs.map((t) => ({ ...t, ...(extra[t.id] || {}) }));
  return (
    <div className="hub-tabs-bar">
      <PillTabs
        tabs={shown} value={value} label={label} className="small hub-tabs"
        onChange={(id) => {
          if (id === value) return;
          if (onSelect && onSelect(id) === false) return;
          navigate(hubPathFor(tabs, id));
        }}
      />
    </div>
  );
}
