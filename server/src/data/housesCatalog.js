const FURNITURE_CATEGORIES = [
  { id: "geral", name: "Outros" },
  { id: "sofas", name: "Sof\u00e1s" },
  { id: "cadeiras", name: "Cadeiras" },
  { id: "mesas", name: "Mesas" },
  { id: "camas", name: "Camas" },
  { id: "eletronicos", name: "Eletr\u00f4nicos" },
  { id: "decoracao", name: "Decora\u00e7\u00e3o" },
  { id: "floricultura", name: "Floricultura" },
];

const FURNITURE_ITEMS = [
  { id: "mov_694_furniture_icon", categoryId: "decoracao", name: "Item #694", price: 12, width: 181, height: 220, imageUrl: "/uploads/furniture/mov_694_furniture_icon.png" },
  { id: "mov_ancient_tree", categoryId: "floricultura", name: "\u00c1rvore Anci\u00e3", price: 100, width: 220, height: 191, imageUrl: "/uploads/furniture/mov_ancient_tree.png" },
  { id: "mov_barrel_chair", categoryId: "cadeiras", name: "Barrel Chair", price: 12, width: 170, height: 220, imageUrl: "/uploads/furniture/mov_barrel_chair.png" },
  { id: "mov_big_screen_tv", categoryId: "eletronicos", name: "Tv Grande", price: 100, width: 220, height: 167, imageUrl: "/uploads/furniture/mov_big_screen_tv.png" },
  { id: "mov_bird_bath", categoryId: "decoracao", name: "Bird Bath", price: 35, width: 178, height: 220, imageUrl: "/uploads/furniture/mov_bird_bath.png" },
  { id: "mov_black_designer_couch", categoryId: "sofas", name: "Black Designer Couch", price: 100, width: 220, height: 121, imageUrl: "/uploads/furniture/mov_black_designer_couch.png" },
  { id: "mov_bonsai_tree_icon", categoryId: "floricultura", name: "Bonsai", price: 100, width: 220, height: 217, imageUrl: "/uploads/furniture/mov_bonsai_tree_icon.png" },
  { id: "mov_boss_desk", categoryId: "eletronicos", name: "Computador", price: 100, width: 220, height: 144, imageUrl: "/uploads/furniture/mov_boss_desk.png" },
  { id: "mov_furniture_icons_2347", categoryId: "eletronicos", name: "Tv Pequena", price: 100, width: 214, height: 220, imageUrl: "/uploads/furniture/mov_furniture_icons_2347.png" },
  { id: "mov_surfboardsfurniture", categoryId: "decoracao", name: "Pranchas de Surf", price: 12, width: 156, height: 220, imageUrl: "/uploads/furniture/mov_surfboardsfurniture.png" },
  { id: "cabeca_de_servo", categoryId: "decoracao", name: "Cabe\u00e7a De Alce", price: 100, width: 200, height: 200, imageUrl: "/uploads/furniture/cabeca_de_servo.png" },
  { id: "arvore", categoryId: "floricultura", name: "\u00c1rvore", price: 100, width: 200, height: 200, imageUrl: "/uploads/furniture/arvore.png" },
  { id: "tapete_de_map", categoryId: "decoracao", name: "Tapete de Map", price: 100, width: 200, height: 200, imageUrl: "/uploads/furniture/tapete_de_map.png" },
  { id: "puff", categoryId: "cadeiras", name: "Puff", price: 100, width: 200, height: 200, imageUrl: "/uploads/furniture/puff.png" },
  { id: "lago", categoryId: "floricultura", name: "Lago", price: 100, width: 200, height: 200, imageUrl: "/uploads/furniture/lago.png" },
  { id: "geladeira", categoryId: "eletronicos", name: "Geladeira", price: 100, width: 200, height: 200, imageUrl: "/uploads/furniture/geladeira.png" },
  { id: "fogao", categoryId: "eletronicos", name: "Fog\u00e3o", price: 100, width: 200, height: 200, imageUrl: "/uploads/furniture/fogao.png" },
  { id: "estante_com_trofeus", categoryId: "decoracao", name: "Estante com Trof\u00e9us", price: 100, width: 200, height: 200, imageUrl: "/uploads/furniture/estante_com_trofeus.png" },
  { id: "estante", categoryId: "decoracao", name: "Estante", price: 100, width: 200, height: 200, imageUrl: "/uploads/furniture/estante.png" },
  { id: "baloes", categoryId: "decoracao", name: "Bal\u00f5es", price: 100, width: 200, height: 200, imageUrl: "/uploads/furniture/baloes.png" },
];

const HOUSE_CATALOG = [
  { id: "iglu_basico", name: "Iglu B\u00e1sico", price: 0, backgroundColor: "#BFEFFF" },
  { id: "casa_de_doces", name: "Iglu de Doces", price: 250, backgroundColor: "#FFD9B3" },
  { id: "iglu_de_neve", name: "Iglu de Neve", price: 320, backgroundColor: "#E3F7FF" },
  { id: "iglu_de_pedra", name: "Iglu de Pedra", price: 400, backgroundColor: "#D9E8FF" },
  { id: "iglu_azul_luxuoso", name: "Iglu Azul Luxuoso", price: 500, backgroundColor: "#FFE0F0" },
  { id: "iglu_grande_de_doces", name: "Iglu Grande de Doces", price: 650, backgroundColor: "#E8FFE0" },
  { id: "iglu_deluxe_de_pedra", name: "Iglu Deluxe de Pedra", price: 750, backgroundColor: "#F0E0FF" },
  { id: "iglu_de_neve_luxuoso", name: "Iglu de Neve Luxuoso", price: 830, backgroundColor: "#FFF3D0" },
  { id: "iglu_de_dois_andares", name: "Iglu de Dois Andares", price: 950, backgroundColor: "#D0FFF3" },
  { id: "iglu_de_dois_andares_de_doces", name: "Iglu de Dois Andares de Doces", price: 1100, backgroundColor: "#FFDCDC" },
  { id: "iglu_de_neve_de_dois_andares", name: "Iglu de Neve de Dois Andares", price: 1250, backgroundColor: "#BFEFFF" },
  { id: "iglu_com_quintal", name: "Iglu com Quintal", price: 1390, backgroundColor: "#FFD9B3" },
];

module.exports = { FURNITURE_CATEGORIES, FURNITURE_ITEMS, HOUSE_CATALOG };
