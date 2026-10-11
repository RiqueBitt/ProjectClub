// Jogo de Cartas — definições fixas (raridades, elementos, habilidades) e
// configuração padrão. A staff muda os números (regras, recompensas,
// economia) pelo painel; o que fica em código é só o que precisa de lógica
// (uma habilidade nova precisa de código no motor, ver engine.js).

const RARITIES = ['COMUM', 'INCOMUM', 'RARA', 'EPICA', 'LENDARIA', 'MITICA'];
const RARITY_LABEL = { COMUM: 'Comum', INCOMUM: 'Incomum', RARA: 'Rara', EPICA: 'Épica', LENDARIA: 'Lendária', MITICA: 'Mítica' };

const ELEMENTS = ['FOGO', 'AGUA', 'TERRA', 'AR', 'LUZ', 'SOMBRA'];
const ELEMENT_LABEL = { FOGO: 'Fogo', AGUA: 'Água', TERRA: 'Terra', AR: 'Ar', LUZ: 'Luz', SOMBRA: 'Sombra' };
// Quem vence quem (atacante → defensor recebe bônus de dano).
// Fogo > Terra > Ar > Água > Fogo; Luz e Sombra são fortes uma contra a outra.
const ELEMENT_BEATS = { FOGO: ['TERRA'], TERRA: ['AR'], AR: ['AGUA'], AGUA: ['FOGO'], LUZ: ['SOMBRA'], SOMBRA: ['LUZ'] };

// Habilidades: `value` diz se usa abilityValue. `power` é usado no cálculo
// de "força" da carta (exibido na interface e usado pela IA).
const ABILITIES = {
  NONE: { label: 'Sem habilidade', desc: '', value: false, power: 0 },
  GUARDA: { label: 'Guarda', desc: 'Inimigos precisam atacar esta unidade primeiro.', value: false, power: 1.5 },
  INVESTIDA: { label: 'Investida', desc: 'Pode atacar no turno em que entra.', value: false, power: 1.5 },
  ESCUDO: { label: 'Escudo', desc: 'Ignora o primeiro dano que receber.', value: false, power: 2 },
  ROUBO_VIDA: { label: 'Roubo de vida', desc: 'O dano que causa cura o seu herói.', value: false, power: 1.5 },
  VENENO: { label: 'Veneno', desc: 'Destrói qualquer unidade em que causar dano.', value: false, power: 2.5 },
  FURIA: { label: 'Fúria', desc: 'Pode atacar duas vezes por turno.', value: false, power: 2.5 },
  GRITO_DANO: { label: 'Explosão', desc: 'Ao entrar: causa {v} de dano ao herói inimigo.', value: true, power: 0.9 },
  GRITO_CURA: { label: 'Bênção', desc: 'Ao entrar: cura {v} de vida do seu herói.', value: true, power: 0.6 },
  GRITO_COMPRA: { label: 'Sabedoria', desc: 'Ao entrar: compra {v} carta(s).', value: true, power: 1.6 },
  GRITO_RAIO: { label: 'Raio', desc: 'Ao entrar: causa {v} de dano à unidade inimiga mais forte.', value: true, power: 1.1 },
  AURA: { label: 'Inspirar', desc: 'Ao entrar: suas outras unidades ganham +{v} de ataque.', value: true, power: 1.2 },
  REGENERA: { label: 'Regenerar', desc: 'No início do seu turno, cura {v} de vida desta unidade.', value: true, power: 0.7 },
  ULTIMO_SUSPIRO: { label: 'Último suspiro', desc: 'Ao morrer: causa {v} de dano ao herói inimigo.', value: true, power: 0.8 },
  ENERGIA: { label: 'Canalizar', desc: 'Ao entrar: ganha {v} de energia neste turno.', value: true, power: 0.8 },
  FURTIVO: { label: 'Furtivo', desc: 'Não pode ser alvo de ataques nem feitiços até atacar.', value: false, power: 1.6 },
  CONGELA: { label: 'Gélido', desc: 'Congela as unidades em que causa dano (perdem o próximo ataque).', value: false, power: 1.6 },
  INVOCAR: { label: 'Convocar', desc: 'Ao entrar: invoca {v} Recruta(s) 1/1.', value: true, power: 1.4 },
  ESPINHOS: { label: 'Espinhos', desc: 'Quem a atacar recebe +{v} de dano.', value: true, power: 0.9 },
  PROTEGER: { label: 'Proteger', desc: 'Ao entrar: suas outras unidades ganham Escudo.', value: false, power: 2.2 },
  // Feitiços (cartas do tipo SPELL)
  FEITICO_DANO: { label: 'Disparo', desc: 'Causa {v} de dano a uma unidade ou ao herói inimigo.', value: true, power: 1.3, spell: true },
  FEITICO_AREA: { label: 'Tempestade', desc: 'Causa {v} de dano a todas as unidades inimigas.', value: true, power: 2.4, spell: true },
  FEITICO_CURA: { label: 'Cura', desc: 'Cura {v} de vida do seu herói.', value: true, power: 0.7, spell: true },
  FEITICO_COMPRA: { label: 'Visão', desc: 'Compra {v} carta(s).', value: true, power: 1.8, spell: true },
  FEITICO_BUFF: { label: 'Equipamento', desc: 'Uma unidade sua ganha +{v} de ataque e +{v} de vida.', value: true, power: 1.6, spell: true },
  FEITICO_ESCUDO: { label: 'Barreira', desc: 'Uma unidade sua ganha Escudo.', value: false, power: 2, spell: true },
  FEITICO_CONGELAR: { label: 'Congelar', desc: 'Congela uma unidade inimiga e causa {v} de dano.', value: true, power: 1.2, spell: true },
};

const DIFFICULTIES = {
  FACIL: { label: 'Fácil', maxRarity: 'INCOMUM', level: 1, heroHp: 25 },
  MEDIO: { label: 'Médio', maxRarity: 'RARA', level: 2, heroHp: 30 },
  DIFICIL: { label: 'Difícil', maxRarity: 'LENDARIA', level: 3, heroHp: 32 },
  LENDARIO: { label: 'Lendário', maxRarity: 'MITICA', level: 5, heroHp: 35 },
};

const DEFAULT_SETTINGS = {
  rules: {
    startHp: 30, deckSize: 20, maxCopies: 2, maxCopiesLegendary: 1, startHand: 4, maxHand: 8,
    maxEnergy: 10, boardSize: 5, turnSeconds: 75, elementBonus: 1, maxTimeouts: 3, levelCap: 5,
  },
  rewards: {
    FACIL: 25, MEDIO: 50, DIFICIL: 100, LENDARIO: 180, pveLoss: 5,
    pvpWin: 150, pvpLoss: 20, dailyRewardedMatches: 20, pvpRewardsPerOpponentPerDay: 3, minTurnsForReward: 3,
    streakBonus: 10, streakBonusMax: 50,
  },
  economy: {
    sellValues: { COMUM: 5, INCOMUM: 12, RARA: 30, EPICA: 80, LENDARIA: 200, MITICA: 500 },
    levelUpCopies: [1, 2, 3, 4], // cópias extras gastas pra ir do nível 1→2, 2→3, 3→4, 4→5
    levelUpCoins: [40, 100, 220, 450],
    tradeMaxCoins: 5000, maxOpenTrades: 10, starterCards: 20,
    foilChance: 4, foilSellMultiplier: 3, marketTax: 10, maxListings: 10, dailyDealPercent: 25,
  },
  season: {
    minGames: 5,
    // Recompensa no fim do mês, por divisão alcançada.
    rewards: { BRONZE: 50, PRATA: 150, OURO: 300, PLATINA: 500, DIAMANTE: 800, LENDARIO: 1200 },
    gems: { BRONZE: 0, PRATA: 0, OURO: 2, PLATINA: 5, DIAMANTE: 10, LENDARIO: 20 },
  },
  enabled: { pve: true, pvp: true, trades: true, packs: true, sell: true, market: true },
};

function mergeSettings(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    out[k] = { ...DEFAULT_SETTINGS[k], ...(s[k] && typeof s[k] === 'object' ? s[k] : {}) };
  }
  out.economy.sellValues = { ...DEFAULT_SETTINGS.economy.sellValues, ...(s.economy?.sellValues || {}) };
  out.season.rewards = { ...DEFAULT_SETTINGS.season.rewards, ...(s.season?.rewards || {}) };
  out.season.gems = { ...DEFAULT_SETTINGS.season.gems, ...(s.season?.gems || {}) };
  out.seedVersion = s.seedVersion || 1;
  return out;
}

// "Força" exibida da carta (0-100), proporcional ao custo — usada na
// interface e pela IA para avaliar cartas.
function cardPower(c, level = 1) {
  if (c.kind === 'SPELL') {
    const ab = ABILITIES[c.ability] || ABILITIES.NONE;
    const v = (c.abilityValue || 0) + Math.floor((level - 1) / 2);
    return Math.round(Math.min(100, (ab.value ? ab.power * v : ab.power * 3) * 4 + 6));
  }
  const st = levelStats(c, level);
  const ab = ABILITIES[c.ability] || ABILITIES.NONE;
  const abVal = ab.value ? ab.power * Math.max(0, c.abilityValue || 0) : ab.power;
  return Math.round(Math.min(100, (st.attack * 1.1 + st.health + abVal) * 4));
}

// Bônus de nível: +1 de vida por nível e +1 de ataque nos níveis 3 e 5.
function levelStats(c, level = 1) {
  const lv = Math.max(1, Math.min(10, level | 0));
  return {
    attack: Math.max(0, (c.attack | 0) + Math.floor((lv - 1) / 2)),
    health: Math.max(1, (c.health | 0) + (lv - 1)),
  };
}

function abilityText(ability, value) {
  const ab = ABILITIES[ability] || ABILITIES.NONE;
  return ab.desc.replace(/\{v\}/g, String(value || 0));
}

// Divisões do ranking da temporada (por rating da temporada).
const DIVISIONS = [
  { key: 'BRONZE', label: 'Bronze', min: 0, color: '#c07a45' },
  { key: 'PRATA', label: 'Prata', min: 1100, color: '#c9d1d9' },
  { key: 'OURO', label: 'Ouro', min: 1250, color: '#ffd34d' },
  { key: 'PLATINA', label: 'Platina', min: 1400, color: '#5fe0d0' },
  { key: 'DIAMANTE', label: 'Diamante', min: 1550, color: '#7cc4ff' },
  { key: 'LENDARIO', label: 'Lendário', min: 1700, color: '#ff4fa3' },
];
function divisionOf(rating) {
  let d = DIVISIONS[0];
  for (const x of DIVISIONS) if (rating >= x.min) d = x;
  return d;
}

module.exports = {
  DIVISIONS, divisionOf,
  RARITIES, RARITY_LABEL, ELEMENTS, ELEMENT_LABEL, ELEMENT_BEATS, ABILITIES, DIFFICULTIES,
  DEFAULT_SETTINGS, mergeSettings, cardPower, levelStats, abilityText,
};
