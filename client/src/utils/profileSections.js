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

// Lê a preferência salva (string JSON) e devolve uma ordem VÁLIDA e
// COMPLETA — filtra chaves desconhecidas (segurança/compatibilidade
// futura) e garante que qualquer chave que exista no padrão mas não
// esteja na lista da pessoa entra no fim, em vez de desaparecer.
export function parseProfileSectionOrder(raw) {
  let saved = [];
  try {
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) saved = parsed.filter((k) => PROFILE_SECTION_LABELS[k]);
  } catch { saved = []; }
  const missing = DEFAULT_PROFILE_SECTION_ORDER.filter((k) => !saved.includes(k));
  return [...saved, ...missing];
}
