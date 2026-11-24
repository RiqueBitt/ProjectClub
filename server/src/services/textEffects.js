const prisma = require('../config/prisma');

// Efeitos de texto da Loja (ShopItem kind TEXTFX). Pintam o NOME da pessoa
// com um efeito animado exclusivo — no lugar dos antigos efeitos de perfil,
// que saíram da Loja (ver disableProfileEffects abaixo).
//
// Equipar grava User.profileNameEffect = "FX_<CHAVE>" (rota
// POST /api/decorations/text-effects/equip). As configurações de perfil só
// aceitam os 16 efeitos grátis, então ninguém equipa um destes sem ter.
// O desenho de cada um fica em client/src/utils/nameStyle.js (FX_STYLES) e
// as animações em client/src/styles/name-fx.css.
//
// Criados ATIVOS e com preço (pedido do dono: "criar alguns para vender").
// Depois de criados, a staff edita à vontade — o boot nunca sobrescreve.
const BUILTIN_TEXT_EFFECTS = [
  { key: 'aurora', name: 'Aurora', description: 'Verde, azul e roxo correndo pelo nome como a aurora boreal, com brilho suave.', priceCoins: 2500, rarity: 'RARA' },
  { key: 'lava', name: 'Lava', description: 'Vermelho e laranja subindo pelas letras como lava quente, com brasa em volta.', priceCoins: 2500, rarity: 'RARA' },
  { key: 'galaxia', name: 'Galáxia', description: 'Roxo e azul de nebulosa passando pelo nome, com estrelinhas piscando.', priceCoins: 3500, rarity: 'EPICA' },
  { key: 'holografico', name: 'Holográfico', description: 'Reflexo iridescente rosa, ciano e lilás deslizando pelas letras.', priceCoins: 3500, rarity: 'EPICA' },
  { key: 'ouro', name: 'Ouro Real', description: 'Letras de ouro com um reflexo de luz passando de tempos em tempos.', priceCoins: 5000, rarity: 'LENDARIA' },
  { key: 'eletrico', name: 'Elétrico', description: 'Azul elétrico com o brilho piscando como uma descarga de energia.', priceCoins: 3000, rarity: 'EPICA' },
  { key: 'doce', name: 'Bala Listrada', description: 'Listras rosa e brancas andando pelo nome, como bala de festa.', priceCoins: 2000, rarity: 'INCOMUM' },
  { key: 'synthwave', name: 'Synthwave', description: 'Rosa neon com uma sombra ciano que vibra no ritmo dos anos 80.', priceCoins: 3000, rarity: 'EPICA' },
];
const TEXT_EFFECT_KEYS = BUILTIN_TEXT_EFFECTS.map((e) => e.key);
const itemKeyOf = (key) => `textfx:${key}`;
// Valor gravado em User.profileNameEffect pra um item TEXTFX.
function fxValueOf(item) {
  const k = String(item?.key || '').replace(/^textfx:/, '');
  return TEXT_EFFECT_KEYS.includes(k) ? `FX_${k.toUpperCase()}` : null;
}

async function ensureBuiltinTextEffects() {
  const existing = await prisma.shopItem.findMany({ where: { kind: 'TEXTFX' }, select: { key: true } });
  const have = new Set(existing.map((e) => e.key));
  let order = 0;
  for (const fx of BUILTIN_TEXT_EFFECTS) {
    order += 1;
    if (have.has(itemKeyOf(fx.key))) continue;
    await prisma.shopItem.create({
      data: {
        kind: 'TEXTFX', key: itemKeyOf(fx.key), name: fx.name, description: fx.description,
        priceCoins: fx.priceCoins, rarity: fx.rarity, active: true, sortOrder: order,
        data: JSON.stringify({ fx: fx.key }),
      },
    }).catch(() => { /* corrida entre dois boots: a chave é única */ });
  }
}

// Efeitos de perfil saíram da Loja (pedido do dono: "vamos remover os efeitos
// de perfil e colocar os efeitos de texto no lugar"). Desativar faz a vitrine,
// a cestinha (Node e Rust), presentes e coleções pararem de vender sozinhos;
// quem já tinha continua com o item no histórico, só não aparece mais.
async function disableProfileEffects() {
  await prisma.profileEffect.updateMany({ where: { active: true }, data: { active: false } });
}

module.exports = { BUILTIN_TEXT_EFFECTS, TEXT_EFFECT_KEYS, itemKeyOf, fxValueOf, ensureBuiltinTextEffects, disableProfileEffects };
