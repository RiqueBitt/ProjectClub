// Interruptores de CÓDIGO (não de banco) pra sistemas inteiros que o dono
// pediu pra tirar do ar sem apagar nada: nem código, nem dados no banco.
// false = rotas respondem 404, nada é concedido em segundo plano (ex: casa
// inicial no cadastro) e o cliente esconde tudo (ver client/src/utils/features.js).
// Pra religar: troque pra true aqui E no arquivo do cliente.
const FEATURES = Object.freeze({
  houses: false,   // Casas, móveis, mapas, galeria e recados das casas
  stickers: false, // Figurinhas colecionáveis: álbum e cápsulas (NÃO as figurinhas do chat)
  browser: true,   // Navegador do Project Club: conferir páginas/sugestões (/api/browser)
  cinema: false,   // Filmes e Séries: Internet Archive (/api/archive) e catálogo/Pluto (/api/catalog)
  // Guerra das Cartas (jogo de cartas: /api/cards, salas, batalhas, convites,
  // trocas, mercado, torneios). DESATIVADO TEMPORARIAMENTE: as rotas
  // respondem 503 "temporariamente desativado", a varredura de turnos não
  // liga e as missões CARDS_* somem da lista. Baús diários e o resto da
  // Economia NÃO dependem disto e continuam funcionando.
  cardsWar: false,
});

function isFeatureEnabled(key) {
  return FEATURES[key] === true;
}

// Middleware: bloqueia o router inteiro com 404 quando o sistema está desligado.
// opts.status/opts.message trocam a resposta (ex: 503 pra "temporariamente
// desativado", quando o sistema vai voltar).
function requireFeature(key, opts = {}) {
  const status = opts.status || 404;
  const message = opts.message || 'Este sistema foi desativado.';
  return function featureGate(req, res, next) {
    if (isFeatureEnabled(key)) return next();
    return res.status(status).json({ error: message, featureDisabled: key, temporarilyDisabled: status === 503 });
  };
}

const CARDS_WAR_OFF_MSG = 'O Guerra das Cartas está temporariamente desativado.';

module.exports = { FEATURES, isFeatureEnabled, requireFeature, CARDS_WAR_OFF_MSG };
