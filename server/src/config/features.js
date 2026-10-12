// Interruptores de CÓDIGO (não de banco) pra sistemas inteiros que o dono
// pediu pra tirar do ar sem apagar nada: nem código, nem dados no banco.
// false = rotas respondem 404, nada é concedido em segundo plano (ex: casa
// inicial no cadastro) e o cliente esconde tudo (ver client/src/utils/features.js).
// Pra religar: troque pra true aqui E no arquivo do cliente.
const FEATURES = Object.freeze({
  houses: false,   // Casas, móveis, mapas, galeria e recados das casas
  stickers: false, // Figurinhas colecionáveis: álbum e cápsulas (NÃO as figurinhas do chat)
  browser: false,  // Navegador do Project Club: conferir páginas/sugestões (/api/browser)
  cinema: false,   // Filmes e Séries: Internet Archive (/api/archive) e catálogo/Pluto (/api/catalog)
});

function isFeatureEnabled(key) {
  return FEATURES[key] === true;
}

// Middleware: bloqueia o router inteiro com 404 quando o sistema está desligado.
function requireFeature(key) {
  return function featureGate(req, res, next) {
    if (isFeatureEnabled(key)) return next();
    return res.status(404).json({ error: 'Este sistema foi desativado.', featureDisabled: key });
  };
}

module.exports = { FEATURES, isFeatureEnabled, requireFeature };
