import '../styles/profile-styles.css';

// Estilos de perfil da Loja (User.profileStyle). A chave vem do servidor;
// só as conhecidas viram classe (chave desconhecida = visual padrão).
export const PROFILE_STYLES = {
  win2000: "Windows 2000",
  anime: "Anime",
  terror: "Terror",
  bugado: "Bugado",
  nostalgia: "Nostalgia",
  cyberpunk: "Cyberpunk 2099",
  vaporwave: "Vaporwave",
  pixel: "8-bit",
  oceano: "Oceano Profundo",
  floresta: "Floresta Encantada",
  galaxia: "Galáxia",
  sakura: "Sakura",
  inverno: "Inverno",
  lava: "Vulcão",
  realeza: "Realeza",
  matrix: "Matrix",
  caderno: "Caderno",
  steampunk: "Steampunk",
  gotico: "Gótico",
  arcade: "Arcade 80",
  sunset: "Pôr do Sol",
  candy: "Doceria",
  aurora: "Aurora Boreal",
  deserto: "Deserto",
  halloween: "Halloween",
  natal: "Natal",
  lofi: "Lo-fi Chill",
  holografico: "Holográfico",
  militar: "Tático",
  faroeste: "Faroeste",
  medieval: "Pergaminho",
  cafe: "Cafeteria",
  grafite: "Grafite",
  marmore: "Mármore",
  noir: "Filme Noir",
};

export function profileStyleClass(styleOrUser) {
  const key = typeof styleOrUser === 'string' ? styleOrUser : styleOrUser?.profileStyle;
  return key && PROFILE_STYLES[key] ? ` pstyle pstyle-${key}` : '';
}
