// Espelho de server/src/config/features.js — sistemas desligados no
// código (sem apagar nada). false = some da navegação, das buscas e do
// painel da staff; as rotas antigas redirecionam pra Economia.
export const FEATURES = Object.freeze({
  houses: false,   // Casas e decoração
  stickers: false, // Figurinhas colecionáveis (álbum/cápsulas) — as do chat continuam
  browser: true,   // Navegador do Project Club (abas dentro do app) — código guardado em src/browser
  cinema: false,   // Filmes e Séries (Internet Archive, catálogo, Pluto TV) — código guardado em src/cinema
  // Guerra das Cartas DESATIVADA (pedido do dono, nov/2026): some do menu, da
  // busca, da Loja (aba Cartas/versos), do perfil, do Início e dos canais em
  // destaque; /cartas mostra "Em breve" (CardsDisabledPage). Baús/Economia continuam.
  cardsWar: false,
  // Praça: Club Penguin completo (Waddle Forever embutido no servidor).
  plaza: true,
  // Cartão do servidor de Minecraft no Início. DESLIGADO (pedido do dono, nov/2026);
  // a integração continua no painel (Integrações) e no Pingu.
  minecraftHome: false,
  // Botão "Festa" dentro do Club Penguin (quests, loja do evento, mascotes,
  // Jigsaw…). DESLIGADO por enquanto (pedido do dono, nov/2026) — o servidor
  // e o painel da staff continuam; só o botão no jogo some.
  plazaFesta: false,
});

export const isFeatureEnabled = (key) => FEATURES[key] === true;
