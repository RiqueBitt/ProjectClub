// Espelho de server/src/config/features.js — sistemas desligados no
// código (sem apagar nada). false = some da navegação, das buscas e do
// painel da staff; as rotas antigas redirecionam pra Economia.
export const FEATURES = Object.freeze({
  houses: false,   // Casas e decoração
  stickers: false, // Figurinhas colecionáveis (álbum/cápsulas) — as do chat continuam
  browser: true,   // Navegador do Project Club (abas dentro do app) — código guardado em src/browser
  cinema: false,   // Filmes e Séries (Internet Archive, catálogo, Pluto TV) — código guardado em src/cinema
  // Guerra das Cartas DESATIVADA TEMPORARIAMENTE: some do menu, da busca, da
  // Loja (aba Cartas/versos), do perfil e do Início; /cartas mostra "Em breve"
  // (CardsDisabledPage) e o CardsNotifier não liga. Baús/Economia continuam.
  cardsWar: false,
});

export const isFeatureEnabled = (key) => FEATURES[key] === true;
