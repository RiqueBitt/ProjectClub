// Espelho de server/src/config/features.js — sistemas desligados no
// código (sem apagar nada). false = some da navegação, das buscas e do
// painel da staff; as rotas antigas redirecionam pra Economia.
export const FEATURES = Object.freeze({
  houses: false,   // Casas e decoração
  stickers: false, // Figurinhas colecionáveis (álbum/cápsulas) — as do chat continuam
  browser: false,  // Navegador do Project Club (abas dentro do app) — código guardado em src/browser
  cinema: false,   // Filmes e Séries (Internet Archive, catálogo, Pluto TV) — código guardado em src/cinema
});

export const isFeatureEnabled = (key) => FEATURES[key] === true;
