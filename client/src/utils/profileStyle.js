import '../styles/profile-styles.css';

// Estilos de perfil da Loja (User.profileStyle). A chave vem do servidor;
// só as conhecidas viram classe (chave desconhecida = visual padrão).
export const PROFILE_STYLES = {
  win2000: 'Windows 2000',
  anime: 'Anime',
  terror: 'Terror',
  bugado: 'Bugado',
  nostalgia: 'Nostalgia',
};

export function profileStyleClass(styleOrUser) {
  const key = typeof styleOrUser === 'string' ? styleOrUser : styleOrUser?.profileStyle;
  return key && PROFILE_STYLES[key] ? ` pstyle pstyle-${key}` : '';
}
