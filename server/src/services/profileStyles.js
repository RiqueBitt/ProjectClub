const prisma = require('../config/prisma');

// Estilos de perfil embutidos. Cada um muda o visual inteiro do perfil e
// do miniperfil (cores, botões, barras, fontes, molduras dos cartões) — o
// CSS fica em client/src/styles/profile-styles.css e o app nativo tem a
// versão dele em ui/profile/ProfileStyles.kt.
//
// Criados DESATIVADOS (não aparecem na Loja): a staff ativa no painel,
// escolhe coleção, preço e estoque. Nunca sobrescreve o que a staff editou.
const BUILTIN_STYLES = [
  { key: 'win2000', name: 'Windows 2000', description: 'Janela cinza clássica, barra de título azul degradê, botões em relevo e fonte Tahoma.' },
  { key: 'anime', name: 'Anime', description: 'Tons pastel, brilhos, cantos bem redondos e tudo com cara de abertura de anime.' },
  { key: 'terror', name: 'Terror', description: 'Escuro, vermelho sangue, letras assombradas e um leve tremor na tela.' },
  { key: 'bugado', name: 'Bugado', description: 'Glitch digital: cores RGB separadas, linhas de TV e texto que falha de vez em quando.' },
  { key: 'nostalgia', name: 'Nostalgia', description: 'Papel antigo, sépia, polaroid e fita cassete — clima de foto de família.' },
];
const STYLE_KEYS = BUILTIN_STYLES.map((s) => s.key);

async function ensureBuiltinStyles() {
  for (const s of BUILTIN_STYLES) {
    await prisma.shopItem.upsert({
      where: { key: `style:${s.key}` },
      update: {},
      create: {
        kind: 'STYLE', key: `style:${s.key}`, name: s.name, description: s.description,
        data: JSON.stringify({ style: s.key }), active: false, priceCoins: 2500, priceGems: null,
      },
    });
  }
}

module.exports = { BUILTIN_STYLES, STYLE_KEYS, ensureBuiltinStyles };
