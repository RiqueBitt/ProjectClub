import ChannelSidebar from './ChannelSidebar.jsx';
import DonationGoalBar from './DonationGoalBar.jsx';
import ClubRail from './ClubRail.jsx';
import { useStore } from '../store/useStore';

// Layout "Normal 2.0": uma coluna só à esquerda, no estilo Discord —
// banner da comunidade no topo e os canais/categorias embaixo. A lista de
// canais é o MESMO ChannelSidebar dos outros layouts (permissões, arrastar,
// menus de contexto, salas de voz), só embutido aqui.
//
// O menu de botões que ficava aqui (Início, Fórum, Social, Economia,
// Progresso, Suporte) virou canais em destaque coloridos (pedido do dono,
// nov/2026): Início, Amigos, Progresso e Suporte agora estão em
// FeaturedChannels.jsx (só neste layout); Economia já estava lá; o Fórum
// saiu do menu (a rota /comunidades continua existindo).
// Usa a classe .main-sidebar, então no celular vira a mesma gaveta
// lateral dos outros layouts, sem regra nova de toque/abrir/fechar.
// O Navegador fica só no globo da barra de título (app de Windows/Linux).

// Compatibilidade: quem importava useBadges daqui continua funcionando.
export { useBadges } from '../utils/navBadges';

// Visual novo (styles/club.css): a barra de ícones (ClubRail.jsx) fica do
// lado dos canais, dentro da mesma coluna — no celular ela some (CSS) e a
// gaveta continua com os canais em destaque de sempre.
export default function Normal2Sidebar({ activeChannelId }) {
  const club = useStore((s) => s.layoutPrefs.visual) === 'club';
  return (
    <aside className={`main-sidebar n2-sidebar${club ? ' has-club-rail' : ''}`}>
      {club && <ClubRail />}
      <ChannelSidebar activeChannelId={activeChannelId} embedded sentenceCase topSlot={<DonationGoalBar />} />
    </aside>
  );
}
