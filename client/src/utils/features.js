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
  // (O Club Penguin / Praça e os Mini-Jogos foram removidos em nov/2026.)
  // Cartão do servidor de Minecraft no Início. DESLIGADO (pedido do dono, nov/2026);
  // a integração continua no painel (Integrações) e no Pingu.
  minecraftHome: false,
  // Mascote pinguim do perfil (Fase 8: "Meu pinguim", mascote no perfil grande
  // e no mini-perfil). DESLIGADO (pedido do dono, nov/2026): some do perfil,
  // da busca e a rota /meu-pinguim redireciona; a API continua guardada.
  profilePet: false,
});

export const isFeatureEnabled = (key) => FEATURES[key] === true;
