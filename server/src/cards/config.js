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
  },
  enabled: { pve: true, pvp: true, trades: true, packs: true, sell: true },
};

function mergeSettings(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    out[k] = { ...DEFAULT_SETTINGS[k], ...(s[k] && typeof s[k] === 'object' ? s[k] : {}) };
  }
  out.economy.sellValues = { ...DEFAULT_SETTINGS.economy.sellValues, ...(s.economy?.sellValues || {}) };
  return out;
}

// "Força" exibida da carta (0-100), proporcional ao custo — usada na
// interface e pela IA para avaliar cartas.
function cardPower(c, level = 1) {
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
  return ab.desc.replace('{v}', String(value || 0));
}

module.exports = {
  RARITIES, RARITY_LABEL, ELEMENTS, ELEMENT_LABEL, ELEMENT_BEATS, ABILITIES, DIFFICULTIES,
  DEFAULT_SETTINGS, mergeSettings, cardPower, levelStats, abilityText,
};
