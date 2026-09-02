// Item pedido: "sistema igual da Steam" — ordem personalizada das
// seções do perfil, escolhida em Configurações → Colunas. Essa lista é
// a fonte única de verdade das chaves válidas + o rótulo amigável de
// cada uma — usada tanto pela tela de configuração (SectionOrderEditor,
// dentro de UserSettingsModal.jsx) quanto pelo próprio perfil
// (UserProfileModal.jsx), pra nunca ficarem dessincronizadas.
export const PROFILE_SECTION_LABELS = {
  about: 'Sobre',
  achievements: 'Conquistas em destaque',
  album: 'Álbum de fotos',
  polls: 'Enquetes',
  community_activity: 'Atividade em clubes',
  roles: 'Cargos na comunidade',
  member_since: 'Membro desde',
  connections: 'Conexões',
  mutual_friends: 'Amigos em comum',
  relationship: 'Relacionamento',
  traits: 'O que acham de você',
  scraps: 'Recados',
  testimonials: 'Depoimentos',
  visitors: 'Quem visitou seu perfil',
};

// A ordem padrão (a mesma que já ficou definida na reorganização do
// perfil) — usada quando a pessoa nunca mexeu nas Colunas, ou como
// base pra completar a lista dela se um item novo for adicionado no
// futuro (uma seção que existe mas não está na preferência salva
// ainda entra no fim, em vez de sumir).
export const DEFAULT_PROFILE_SECTION_ORDER = [
  'about', 'achievements', 'album', 'polls', 'community_activity',
  'roles', 'member_since', 'connections', 'mutual_friends', 'relationship',
  'traits', 'scraps', 'testimonials', 'visitors',
];

// Item pedido: "pode desativar qualquer uma também" — cada item agora
// é um objeto { key, hidden }, não só uma string. Lida com o formato
// ANTIGO também (array de strings puras, de antes dessa mudança) —
// nesse caso, nada estava oculto, então todo mundo vira hidden:false.
export function parseProfileSectionOrder(raw) {
  let saved = [];
  try {
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) {
      saved = parsed
        .map((item) => (typeof item === 'string' ? { key: item, hidden: false } : item))
        .filter((item) => item && PROFILE_SECTION_LABELS[item.key]);
    }
  } catch { saved = []; }
  const savedKeys = saved.map((item) => item.key);
  const missing = DEFAULT_PROFILE_SECTION_ORDER.filter((k) => !savedKeys.includes(k)).map((key) => ({ key, hidden: false }));
  return [...saved, ...missing];
}

// Mesma coisa, mas só as chaves VISÍVEIS, na ordem — o que
// UserProfileModal.jsx de fato usa pra renderizar.
export function visibleProfileSectionOrder(raw) {
  return parseProfileSectionOrder(raw).filter((item) => !item.hidden).map((item) => item.key);
}
