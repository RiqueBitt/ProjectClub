// Catálogo de figurinhas — extraído 1:1 de config/stickers.json e
// config/stickerRarities.json do bot Robbie. Preços da Máquina de Cápsulas
// também vêm do capsuleMachine.json original (100/450/800 moedas p/ 1/5/10).
const STICKER_RARITIES = [
  { id: "comum", name: "Comum", color: "#b0b6c0", weight: 100 },
  { id: "rara", name: "Rara", color: "#3b82f6", weight: 35 },
  { id: "mitica", name: "M\u00edtica", color: "#a855f7", weight: 12 },
  { id: "lendaria", name: "Lend\u00e1ria", color: "#f59e0b", weight: 4 },
  { id: "ultra_lendaria", name: "Ultra Lend\u00e1ria", color: "#ff4fd8", weight: 2 },
];

const STICKERS = [
  { id: "iglo1", name: "Festa", description: "Festa", imageUrl: "https://i.imgur.com/fKl1cUM.png", rarityId: "ultra_lendaria", slotIndex: 0 },
  { id: "banda", name: "Banda", description: "Banda", imageUrl: "https://i.imgur.com/XySUA3I.png", rarityId: "ultra_lendaria", slotIndex: 1 },
  { id: "infos", name: "Infos", description: "Infos", imageUrl: "https://i.imgur.com/eWYJdlr.png", rarityId: "rara", slotIndex: 2 },
  { id: "infos2", name: "Infos 2", description: "Infos 2", imageUrl: "https://i.imgur.com/UVxOBLS.png", rarityId: "comum", slotIndex: 3 },
  { id: "pinguim", name: "Pinguim", description: "Pimguim", imageUrl: "https://i.imgur.com/fkfdHCK.png", rarityId: "comum", slotIndex: 4 },
  { id: "seta1", name: "Seta1", description: "Seta1", imageUrl: "https://i.imgur.com/fL7ioNj.png", rarityId: "rara", slotIndex: 5 },
  { id: "Seta2", name: "Seta2", description: "Seta 2", imageUrl: "https://i.imgur.com/ByQ4Ho6.png", rarityId: "rara", slotIndex: 6 },
  { id: "lesma1", name: "Lesma", description: "Lesma", imageUrl: "https://i.imgur.com/U1A9o1O.png", rarityId: "rara", slotIndex: 7 },
  { id: "lesma2", name: "Lesma 2", description: "Lesma 2", imageUrl: "https://i.imgur.com/EUpEdZV.png", rarityId: "ultra_lendaria", slotIndex: 8 },
  { id: "alpha", name: "alpha", description: "alpha", imageUrl: "https://i.imgur.com/PJMXo5z.png", rarityId: "ultra_lendaria", slotIndex: 9 },
];

const CAPSULE_PRICES = { 1: 100, 5: 450, 10: 800 };

module.exports = { STICKER_RARITIES, STICKERS, CAPSULE_PRICES };