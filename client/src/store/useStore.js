import { create } from 'zustand';

// Detecta PC vs Mobile pra saber qual configuração do Editor de Interface
// aplicar — mesmo ponto de corte (900px) usado pelo resto do CSS pra virar
// o layout mobile.
function getDeviceKey() {
  return typeof window !== 'undefined' && window.innerWidth <= 900 ? 'MOBILE' : 'PC';
}

// Estado central em tempo real: categorias/canais da comunidade única,
// membros, conversas DM, mensagens por sala, amigos, presença, digitação e
// pedaços de estado de UI (canal ativo, tema etc).
export const useStore = create((set, get) => ({
  categories: [], // categorias globais, cada uma com channels: [...]
  channels: [], // canais sem categoria (categoryId null) ficam soltos aqui também, pra facilitar buscas
  members: [], // todo mundo da comunidade — { user, roles: [...] } (substitui o antigo server.members)
  roles: [], // cargos globais da comunidade
  community: { name: 'Project Club', iconUrl: null, bannerUrl: null }, // nome/ícone/banner definidos pela staff
  conversations: [],
  friends: [],
  presence: {}, // userId -> { status, customStatus }
  // Item pedido: "Rich Presence" (jogo/Spotify) — userId -> activity
  // object (ou undefined se não estiver jogando/ouvindo nada agora).
  activities: {},
  setActivity: (userId, activity) => set((s) => {
    const next = { ...s.activities };
    if (activity) next[userId] = activity; else delete next[userId];
    return { activities: next };
  }),
  typing: {}, // roomKey -> Set(userId) (mantido como array simples)
  messagesByRoom: {}, // roomKey -> Message[]
  channelReadAt: {}, // channelId -> ISO date string (override local, feedback instantâneo ao abrir)
  // Fila de toasts dispensáveis (avisos de moderação, alerta de
  // anti-raid, atualização de app disponível, etc). `action` é opcional
  // — { label, onClick } — e some sozinho quando o toast é dispensado ou
  // clicado, sem precisar mudar nenhum dos outros ~15 lugares que já
  // chamam pushNotice(message) só com texto.
  notices: [],
  viewingProfileUserId: null, // define pra abrir <UserProfileModal> daquele usuário, de qualquer lugar do app
  // Item pedido: engrenagem no cabeçalho abrindo Configurações direto,
  // sem precisar passar pelo próprio perfil primeiro — estado global
  // igual o do perfil, pra ter só UMA instância do modal (renderizada
  // uma vez em MainApp.jsx) reagindo a quem clicar em qualquer um dos
  // dois lugares que abrem isso (cabeçalho ou dentro do perfil).
  settingsModalOpen: false,
  // ID de usuário pra mostrar o miniperfil (popup compacto, aberto ao
  // clicar num avatar em mensagens/lista de membros) — tem um botão que
  // abre o perfil completo (viewingProfileUserId) de dentro dele.
  miniProfileUserId: null,
  miniProfileAnchorRect: null,
  // 'left' faz o card abrir do lado esquerdo do anchor (por cima do chat)
  // em vez de em cima/embaixo dele — usado pela barra de membros, que é
  // estreita demais (240-280px) pro card de 280px caber dentro dela sem
  // estourar a tela. null/undefined = comportamento padrão (acima do
  // anchor), usado em mensagens e na lista de amigos.
  miniProfileSide: null,
  // Quais sistemas (economy/houses/stickers) a staff desligou em
  // /admin → Sistema — atualizado a cada 30s junto com o poll de
  // manutenção em App.jsx. Usado pra esconder os itens correspondentes
  // da barra lateral de seções (AppRail.jsx) pra todo mundo.
  disabledSystems: [],
  // Quando true, <UserProfileModal> já abre com a seção de cargos expandida
  // e o dropdown de "+" adicionar cargo aberto — usado pelo item "Adicionar
  // cargo" do menu de contexto da lista de membros.
  profileAutoOpenRoleMenu: false,
  // Define uma URL pra abrir <LinkConfirmModal> antes de navegar de fato
  // pra um link clicado numa mensagem/bio — ver richTextRender.jsx.
  pendingLinkUrl: null,
  // Visualização ampliada de imagem (item pedido) — global igual o
  // miniperfil/perfil, guarda só a URL+nome do arquivo atual; qualquer
  // <img> clicável no app chama openLightbox pra abrir.
  lightboxImage: null, // { url, filename } | null
  usableEmojis: [], // emojis customizados da comunidade que este usuário pode usar
  usableStickers: [], // idem, para Sticker (ver StickerPicker.jsx)
  usableSounds: [], // idem, para SoundboardSound (ver SoundboardPanel.jsx)
  favoriteGifs: [], // GIFs salvos deste usuário — ver GifPicker.jsx aba "Favoritos"
  // Clubes (fusão com o Reddit clone) — carregado uma vez ao entrar em
  // Feeds e mantido em tempo real via socket (club:new/update/delete,
  // ver SocketContext.jsx) daí em diante. É por isso que tanto a
  // sidebar principal quanto a página de Feeds sempre mostram a mesma
  // lista, e as duas atualizam sozinhas quando a staff mexe em algo —
  // nenhuma delas faz fetch próprio depois da primeira carga.
  clubs: [],

  activeChannelId: null,
  activeConversationId: null,
  // "reddit" foi renomeado para "light" (tema "Claro" comum) — quem já
  // tinha o tema antigo salvo no navegador continua vendo o mesmo visual,
  // só migra o nome salvo.
  //
  // BUG CORRIGIDO ("tema escolhido não fica salvo, sempre volta pro
  // Claro"): esse acesso ao localStorage não tinha nenhum try/catch —
  // diferente do customBackground logo abaixo, que já era protegido.
  // Em qualquer navegador/contexto onde localStorage.getItem lança erro
  // (ex: modo privado do Safari em iOS em versões mais antigas, ou
  // localStorage bloqueado por política do navegador/rede corporativa),
  // essa exceção acontecia bem no meio da criação do estado inicial da
  // store inteira — o que corrompia a inicialização de tudo, não só do
  // tema, silenciosamente. Agora, além do try/catch, o tema também é
  // sincronizado com a CONTA do usuário (ver setPreferredTheme no
  // backend + AuthContext.jsx) — o localStorage vira só um cache rápido
  // pra evitar o "flash" de tema errado antes da sessão carregar; a
  // fonte de verdade de verdade é o banco de dados, que sobrevive a
  // trocar de navegador/dispositivo ou limpar os dados locais.
  theme: (() => {
    try {
      const saved = localStorage.getItem('theme');
      if (saved === 'reddit') { localStorage.setItem('theme', 'light'); return 'light'; }
      return saved || 'light';
    } catch {
      return 'light';
    }
  })(),
  // Configuração do Editor de Interface (staff pode reorganizar/
  // redimensionar os menus principais) — carregada uma vez ao abrir o
  // app, aplicada globalmente (AppRail, sidebar, lista de membros). null
  // até carregar de verdade, o que os componentes tratam como "usa o
  // padrão embutido" (não trava nada esperando isso chegar).
  uiLayout: null,
  uiLayoutAll: {},
  // Gradiente opcional escolhido pelo usuário que sobrepõe a cor de fundo
  // mais externa do tema (--bg-deepest) — { top: '#rrggbb', bottom: '#rrggbb' }
  // ou null pra usar o padrão do tema ativo.
  customBackground: (() => {
    try { return JSON.parse(localStorage.getItem('customBackground') || 'null'); } catch { return null; }
  })(),
  sidebarCollapsed: false,
  channelSidebarCollapsed: false,
  // Controla a gaveta deslizante de canais/DMs em telas de celular.
  mobileSidebarOpen: false,
  // Mesma ideia, mas pra lista de membros do lado direito.
  mobileMembersOpen: false,

  setCommunityStructure: ({ categories, channels, members, roles, community }) => set((s) => ({
    categories: categories ?? s.categories,
    channels: channels ?? s.channels,
    members: members ?? s.members,
    roles: roles ?? s.roles,
    community: community ?? s.community,
  })),

  upsertCategory: (category) => set((s) => ({
    categories: s.categories.some((c) => c.id === category.id)
      ? s.categories.map((c) => (c.id === category.id ? { ...c, ...category } : c))
      : [...s.categories, { ...category, channels: category.channels || [] }],
  })),
  removeCategory: (id) => set((s) => ({ categories: s.categories.filter((c) => c.id !== id) })),

  upsertChannel: (channel) => set((s) => {
    if (channel.categoryId) {
      return {
        categories: s.categories.map((cat) => {
          if (cat.id !== channel.categoryId) {
            // remove de outra categoria se estava lá (canal movido)
            return { ...cat, channels: (cat.channels || []).filter((ch) => ch.id !== channel.id) };
          }
          const exists = (cat.channels || []).some((ch) => ch.id === channel.id);
          return {
            ...cat,
            channels: exists
              ? cat.channels.map((ch) => (ch.id === channel.id ? { ...ch, ...channel } : ch))
              : [...(cat.channels || []), channel],
          };
        }),
        channels: s.channels.filter((ch) => ch.id !== channel.id),
      };
    }
    const exists = s.channels.some((ch) => ch.id === channel.id);
    return {
      categories: s.categories.map((cat) => ({ ...cat, channels: (cat.channels || []).filter((ch) => ch.id !== channel.id) })),
      channels: exists ? s.channels.map((ch) => (ch.id === channel.id ? { ...ch, ...channel } : ch)) : [...s.channels, channel],
    };
  }),
  removeChannel: (id) => set((s) => ({
    categories: s.categories.map((cat) => ({ ...cat, channels: (cat.channels || []).filter((ch) => ch.id !== id) })),
    channels: s.channels.filter((ch) => ch.id !== id),
  })),

  // Retorna todo canal, esteja ele dentro de uma categoria ou solto — usado
  // pra achar "o primeiro canal" ou resolver um channelId em qualquer tela.
  allChannels: () => {
    const s = get();
    return [...s.categories.flatMap((c) => c.channels || []), ...s.channels];
  },

  upsertRole: (role) => set((s) => ({
    roles: s.roles.some((r) => r.id === role.id) ? s.roles.map((r) => (r.id === role.id ? role : r)) : [...s.roles, role],
  })),
  removeRole: (id) => set((s) => ({ roles: s.roles.filter((r) => r.id !== id) })),
  setMembers: (members) => set({ members }),

  setConversations: (conversations) => set({ conversations }),
  upsertConversation: (conversation) => set((s) => ({
    conversations: s.conversations.some((c) => c.id === conversation.id)
      ? s.conversations.map((c) => (c.id === conversation.id ? { ...c, ...conversation } : c))
      : [...s.conversations, conversation],
  })),
  removeConversation: (id) => set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) })),
  markConversationReadLocal: (conversationId) => set((s) => ({
    conversations: s.conversations.map((c) => (c.id === conversationId ? { ...c, lastReadAt: new Date().toISOString() } : c)),
  })),

  setFriends: (friends) => set({ friends }),

  setPresence: (userId, data) => set((s) => ({ presence: { ...s.presence, [userId]: data } })),

  setActiveChannel: (id) => set({ activeChannelId: id, activeConversationId: null }),
  setActiveConversation: (id) => set({ activeConversationId: id, activeChannelId: null }),

  // Tema de categoria (facebook/clubpenguin/dark/light/amoled) e fundo
  // personalizado (degradê) são mutuamente exclusivos — só um dos dois
  // pode estar "ativo" por vez. Escolher um tema de categoria desliga o
  // degradê automaticamente; ligar o degradê desliga o destaque do tema
  // de categoria (o próprio setCustomBackground abaixo faz o mesmo na
  // direção inversa), então nunca ficam os dois marcados ao mesmo tempo.
  setTheme: (theme) => {
    try {
      localStorage.setItem('theme', theme);
      localStorage.removeItem('customBackground');
    } catch { /* localStorage indisponível — o tema ainda fica salvo na conta, ver setPreferredTheme */ }
    set({ theme, customBackground: null });
  },
  setUiLayout: (device, config) => set((s) => {
    const uiLayoutAll = { ...s.uiLayoutAll, [device]: config };
    return { uiLayoutAll, uiLayout: device === getDeviceKey() ? config : s.uiLayout };
  }),
  setUiLayoutAll: (all) => set({ uiLayoutAll: all, uiLayout: all[getDeviceKey()] }),
  setCustomBackground: (bg) => {
    try {
      if (bg) localStorage.setItem('customBackground', JSON.stringify(bg));
      else localStorage.removeItem('customBackground');
    } catch { /* localStorage indisponível — segue só em memória pra essa sessão */ }
    set({ customBackground: bg });
  },
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleChannelSidebar: () => set((s) => ({ channelSidebarCollapsed: !s.channelSidebarCollapsed })),
  openMobileSidebar: () => set({ mobileSidebarOpen: true, mobileMembersOpen: false }),
  closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
  toggleMobileSidebar: () => set((s) => ({ mobileSidebarOpen: !s.mobileSidebarOpen, mobileMembersOpen: false })),
  openMobileMembers: () => set({ mobileMembersOpen: true, mobileSidebarOpen: false }),
  closeMobileMembers: () => set({ mobileMembersOpen: false }),
  toggleMobileMembers: () => set((s) => ({ mobileMembersOpen: !s.mobileMembersOpen, mobileSidebarOpen: false })),

  pushNotice: (message, action) => set((s) => ({ notices: [...s.notices, { id: `${Date.now()}-${Math.random()}`, message, action }] })),
  dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

  openProfile: (userId) => set({ viewingProfileUserId: userId, profileAutoOpenRoleMenu: false }),
  openMiniProfile: (userId, anchorRect, side) => set({ miniProfileUserId: userId, miniProfileAnchorRect: anchorRect || null, miniProfileSide: side || null }),
  setDisabledSystems: (disabledSystems) => set({ disabledSystems }),
  closeMiniProfile: () => set({ miniProfileUserId: null, miniProfileAnchorRect: null, miniProfileSide: null }),
  // Mesma coisa que openProfile, mas já abre direto em "adicionar cargo".
  openProfileAddRole: (userId) => set({ viewingProfileUserId: userId, profileAutoOpenRoleMenu: true }),
  clearProfileAutoOpenRoleMenu: () => set({ profileAutoOpenRoleMenu: false }),
  closeProfile: () => set({ viewingProfileUserId: null, profileAutoOpenRoleMenu: false }),
  openSettings: () => set({ settingsModalOpen: true }),
  closeSettings: () => set({ settingsModalOpen: false }),
  openLinkConfirm: (url) => set({ pendingLinkUrl: url }),
  openLightbox: (url, filename) => set({ lightboxImage: { url, filename: filename || '' } }),
  closeLightbox: () => set({ lightboxImage: null }),
  closeLinkConfirm: () => set({ pendingLinkUrl: null }),
  setUsableEmojis: (emojis) => set({ usableEmojis: emojis }),
  setUsableStickers: (stickers) => set({ usableStickers: stickers }),
  setUsableSounds: (sounds) => set({ usableSounds: sounds }),
  setFavoriteGifs: (gifs) => set({ favoriteGifs: gifs }),

  setClubs: (clubs) => set({ clubs }),
  upsertClub: (club) => set((s) => ({
    clubs: s.clubs.some((c) => c.id === club.id)
      ? s.clubs.map((c) => (c.id === club.id ? club : c))
      : [club, ...s.clubs],
  })),
  removeClub: (id) => set((s) => ({ clubs: s.clubs.filter((c) => c.id !== id) })),
  upsertClubCategory: (communityId, category) => set((s) => ({
    clubs: s.clubs.map((c) => {
      if (c.id !== communityId) return c;
      const exists = c.categories.some((cat) => cat.id === category.id);
      return { ...c, categories: exists ? c.categories.map((cat) => (cat.id === category.id ? category : cat)) : [...c.categories, category] };
    }),
  })),
  removeClubCategory: (communityId, categoryId) => set((s) => ({
    clubs: s.clubs.map((c) => (c.id === communityId ? { ...c, categories: c.categories.filter((cat) => cat.id !== categoryId) } : c)),
  })),

  // Ups por usuário (item pedido: "atualizados em tempo real") — cache
  // pequeno alimentado pelo evento user:ups-update (ver SocketContext.jsx
  // e services/ups.js no backend). UserProfileModal/MiniProfileCard leem
  // daqui como override do que veio no fetch inicial, se já tiver algo
  // mais novo aqui.
  upsByUserId: {},
  setUserUps: (userId, totalUps) => set((s) => ({ upsByUserId: { ...s.upsByUserId, [userId]: totalUps } })),

  addFavoriteGifLocal: (gif) => set((s) => (
    s.favoriteGifs.some((g) => g.gifId === gif.gifId) ? {} : { favoriteGifs: [gif, ...s.favoriteGifs] }
  )),
  removeFavoriteGifLocal: (gifId) => set((s) => ({ favoriteGifs: s.favoriteGifs.filter((g) => g.gifId !== gifId) })),

  roomMessages: (roomKey) => get().messagesByRoom[roomKey] || [],
  setRoomMessages: (roomKey, messages) => set((s) => ({
    messagesByRoom: { ...s.messagesByRoom, [roomKey]: messages },
  })),
  prependRoomMessages: (roomKey, olderMessages) => set((s) => {
    const existing = s.messagesByRoom[roomKey] || [];
    const existingIds = new Set(existing.map((m) => m.id));
    const fresh = olderMessages.filter((m) => !existingIds.has(m.id));
    return { messagesByRoom: { ...s.messagesByRoom, [roomKey]: [...fresh, ...existing] } };
  }),
  addMessage: (roomKey, message) => set((s) => {
    const existing = s.messagesByRoom[roomKey] || [];
    if (existing.some((m) => m.id === message.id)) return {};
    return { messagesByRoom: { ...s.messagesByRoom, [roomKey]: [...existing, message] } };
  }),
  // Aplica dados públicos atualizados de um usuário (tag, avatar, nome...)
  // em todo lugar que já tem uma cópia em cache: lista de membros da
  // comunidade e autor de toda mensagem já carregada.
  patchUserEverywhere: (user) => set((s) => ({
    members: s.members.map((m) => (m.user.id === user.id ? { ...m, user: { ...m.user, ...user } } : m)),
    messagesByRoom: Object.fromEntries(Object.entries(s.messagesByRoom).map(([roomKey, msgs]) => [
      roomKey,
      msgs.map((m) => (m.authorId === user.id ? { ...m, author: { ...m.author, ...user } } : m)),
    ])),
  })),
  resolveOptimisticMessage: (roomKey, tempId, realMessage) => set((s) => {
    const existing = s.messagesByRoom[roomKey] || [];
    const alreadyHasReal = existing.some((m) => m.id === realMessage.id);
    const next = existing.filter((m) => m.id !== tempId);
    if (!alreadyHasReal) next.push(realMessage);
    return { messagesByRoom: { ...s.messagesByRoom, [roomKey]: next } };
  }),
  failOptimisticMessage: (roomKey, tempId) => set((s) => ({
    messagesByRoom: {
      ...s.messagesByRoom,
      [roomKey]: (s.messagesByRoom[roomKey] || []).map((m) => (
        m.id === tempId ? { ...m, pending: false, failed: true } : m
      )),
    },
  })),
  updateMessage: (roomKey, message) => set((s) => ({
    messagesByRoom: {
      ...s.messagesByRoom,
      [roomKey]: (s.messagesByRoom[roomKey] || []).map((m) => (m.id === message.id ? message : m)),
    },
  })),
  removeMessage: (roomKey, id) => set((s) => ({
    messagesByRoom: {
      ...s.messagesByRoom,
      [roomKey]: (s.messagesByRoom[roomKey] || []).filter((m) => m.id !== id),
    },
  })),

  setTypingUser: (roomKey, userId, isTyping) => set((s) => {
    const current = new Set(s.typing[roomKey] || []);
    if (isTyping) current.add(userId); else current.delete(userId);
    return { typing: { ...s.typing, [roomKey]: Array.from(current) } };
  }),

  markChannelReadLocal: (channelId) => set((s) => {
    const patchChannel = (ch) => (ch.id === channelId ? { ...ch, unreadMentions: 0 } : ch);
    return {
      channelReadAt: { ...s.channelReadAt, [channelId]: new Date().toISOString() },
      channels: s.channels.map(patchChannel),
      categories: s.categories.map((cat) => ({ ...cat, channels: (cat.channels || []).map(patchChannel) })),
    };
  }),

  bumpChannelMention: (channelId) => set((s) => {
    const patchChannel = (ch) => (ch.id === channelId ? { ...ch, unreadMentions: (ch.unreadMentions || 0) + 1 } : ch);
    return {
      channels: s.channels.map(patchChannel),
      categories: s.categories.map((cat) => ({ ...cat, channels: (cat.channels || []).map(patchChannel) })),
    };
  }),

  bumpRoomActivity: (message) => set((s) => {
    if (message.conversationId) {
      return {
        conversations: s.conversations.map((c) => (
          c.id === message.conversationId ? { ...c, lastMessage: message } : c
        )),
      };
    }
    if (message.channelId) {
      const patchChannel = (ch) => (ch.id === message.channelId ? { ...ch, lastMessage: message } : ch);
      return {
        channels: s.channels.map(patchChannel),
        categories: s.categories.map((cat) => ({ ...cat, channels: (cat.channels || []).map(patchChannel) })),
      };
    }
    return {};
  }),
}));

export function roomKeyFor({ conversationId, channelId }) {
  return conversationId ? `conversation:${conversationId}` : `channel:${channelId}`;
}

export function isConversationUnread(conversation, myUserId) {
  const last = conversation.lastMessage;
  if (!last || last.authorId === myUserId) return false;
  if (!conversation.lastReadAt) return true;
  return new Date(last.createdAt) > new Date(conversation.lastReadAt);
}

export function isChannelUnread(channel, channelReadAtMap, myUserId) {
  const last = channel.lastMessage;
  if (!last || last.authorId === myUserId) return false;
  const readAt = channelReadAtMap[channel.id] ?? channel.myReadAt;
  if (!readAt) return true;
  return new Date(last.createdAt) > new Date(readAt);
}

export function messageMentionsUser(message, myUserId, myRoleIds = []) {
  if (!message?.mentions?.length) return false;
  return message.mentions.some((m) => {
    if (m.targetType === 'EVERYONE' || m.targetType === 'HERE') return true;
    if (m.targetType === 'USER') return m.targetId === myUserId;
    if (m.targetType === 'ROLE') return myRoleIds.includes(m.targetId);
    return false;
  });
}
