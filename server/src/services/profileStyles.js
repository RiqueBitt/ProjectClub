const prisma = require('../config/prisma');

// Estilos de perfil embutidos (35). Cada um muda o visual inteiro do perfil e
// do miniperfil (cores, botões, barras, fontes, molduras dos cartões) — o
// CSS fica em client/src/styles/profile-styles.css e o app nativo tem a
// versão dele em ui/profile/ProfileStyles.kt.
//
// Criados DESATIVADOS (não aparecem na Loja): a staff ativa no painel,
// escolhe coleção, preço e estoque. Nunca sobrescreve o que a staff editou.
const BUILTIN_STYLES = [
  { key: "win2000", name: "Windows 2000", description: "Janela cinza clássica com barra de título azul, caixas de grupo, botões em relevo e papel de parede de colina verde." },
  { key: "anime", name: "Anime", description: "Abertura de anime: pétalas de sakura caindo, linhas de velocidade no banner, botões fofos com sombra e nome com contorno." },
  { key: "terror", name: "Terror", description: "Sangue escorrendo, névoa, olhos que piscam no escuro, arranhões no banner e letras assombradas." },
  { key: "bugado", name: "Bugado", description: "Glitch digital: cores RGB separadas, linhas de TV, faixa de erro e texto que falha de vez em quando." },
  { key: "nostalgia", name: "Nostalgia", description: "Álbum de fotos antigo: papel envelhecido, sépia, foto polaroid e fita adesiva." },
  { key: "cyberpunk", name: "Cyberpunk 2099", description: "Neon amarelo e magenta, cantos cortados, grade digital e faixa de alerta." },
  { key: "vaporwave", name: "Vaporwave", description: "Pôr do sol retrô com grade rosa, letras neon e janelinha de computador dos anos 90." },
  { key: "pixel", name: "8-bit", description: "Videogame antigo: pixels, céu azul com nuvens, placar no topo e botões de cartucho." },
  { key: "oceano", name: "Oceano Profundo", description: "Luz entrando na água, bolhas subindo e vidro azul-turquesa." },
  { key: "floresta", name: "Floresta Encantada", description: "Musgo, letras de conto de fadas e vaga-lumes brilhando." },
  { key: "galaxia", name: "Galáxia", description: "Nebulosa roxa e azul, estrelas piscando e nome com brilho de cometa." },
  { key: "sakura", name: "Sakura", description: "Jardim japonês claro com galho de cerejeira e pétalas caindo." },
  { key: "inverno", name: "Inverno", description: "Neve caindo, gelo translúcido e letras de cartão de inverno." },
  { key: "lava", name: "Vulcão", description: "Lava escorrendo, brasas subindo e nome em chamas." },
  { key: "realeza", name: "Realeza", description: "Preto e ouro, molduras duplas e nome dourado brilhando." },
  { key: "matrix", name: "Matrix", description: "Código verde caindo, terminal e nome que pisca." },
  { key: "caderno", name: "Caderno", description: "Folha pautada, post-it, clipe e letra de caneta." },
  { key: "steampunk", name: "Steampunk", description: "Latão, engrenagens, rebites e vapor." },
  { key: "gotico", name: "Gótico", description: "Vitral colorido, arcos de catedral e veludo roxo." },
  { key: "arcade", name: "Arcade 80", description: "Fliperama com botões redondos, neon e letreiro piscando." },
  { key: "sunset", name: "Pôr do Sol", description: "Praia ao entardecer com sol se pondo no mar." },
  { key: "candy", name: "Doceria", description: "Doces, granulado colorido e botões listrados de bengala." },
  { key: "aurora", name: "Aurora Boreal", description: "Cortinas de luz verde e roxa dançando no céu." },
  { key: "deserto", name: "Deserto", description: "Dunas, sol forte e madeira de velho oeste." },
  { key: "halloween", name: "Halloween", description: "Lua cheia, morcegos voando e abóbora laranja." },
  { key: "natal", name: "Natal", description: "Luzinhas piscando, neve e listras de bengala doce." },
  { key: "lofi", name: "Lo-fi Chill", description: "Quarto à noite, chuva na janela e luz quente de luminária." },
  { key: "holografico", name: "Holográfico", description: "Cromado iridescente com reflexo de luz passando." },
  { key: "militar", name: "Tático", description: "Camuflado, mira no banner e faixa de acesso restrito." },
  { key: "faroeste", name: "Faroeste", description: "Cartaz de PROCURADO, couro e fonte de saloon." },
  { key: "medieval", name: "Pergaminho", description: "Pergaminho antigo, letra capitular e selo de cera." },
  { key: "cafe", name: "Cafeteria", description: "Madeira, quadro-negro com giz e vapor de café." },
  { key: "grafite", name: "Grafite", description: "Muro de tijolos, spray neon e letra de pichação." },
  { key: "marmore", name: "Mármore", description: "Mármore branco com veios dourados, minimalista e elegante." },
  { key: "noir", name: "Filme Noir", description: "Preto e branco, grão de filme e luz entrando pela persiana." },
];
const STYLE_KEYS = BUILTIN_STYLES.map((s) => s.key);

// Descrições da primeira versão: se a staff não mudou, troca pela nova.
const OLD_DESCRIPTIONS = new Set([
  'Janela cinza clássica, barra de título azul degradê, botões em relevo e fonte Tahoma.',
  'Tons pastel, brilhos, cantos bem redondos e tudo com cara de abertura de anime.',
  'Escuro, vermelho sangue, letras assombradas e um leve tremor na tela.',
]);

async function ensureBuiltinStyles() {
  const existing = await prisma.shopItem.findMany({ where: { kind: 'STYLE', key: { startsWith: 'style:' } }, select: { id: true, key: true, description: true } });
  const byKey = new Map(existing.map((e) => [e.key, e]));
  for (const s of BUILTIN_STYLES) {
    const key = `style:${s.key}`;
    const have = byKey.get(key);
    if (have) {
      if (OLD_DESCRIPTIONS.has(have.description || '')) await prisma.shopItem.update({ where: { id: have.id }, data: { description: s.description } });
      continue;
    }
    await prisma.shopItem.create({
      data: {
        kind: 'STYLE', key, name: s.name, description: s.description,
        data: JSON.stringify({ style: s.key }), active: false, priceCoins: 2500, priceGems: null,
        sortOrder: BUILTIN_STYLES.indexOf(s),
      },
    }).catch(() => null); // outra instância criou junto: tudo bem
  }
}

module.exports = { BUILTIN_STYLES, STYLE_KEYS, ensureBuiltinStyles };
