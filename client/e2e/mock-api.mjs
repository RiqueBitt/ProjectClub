// API simulada do Project Club para os testes de tela (sem servidor/banco).
// Cada rota devolve dados de exemplo; rotas desconhecidas devolvem listas vazias.
const IMAGES = {};
let imgN = 0;
const svg = (w, h, body) => { const k = `/mock-img/${imgN++}.svg`; IMAGES[k] = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`; return `http://localhost:4173${k}`; };
export function imageHandler(route) { const k = new URL(route.request().url()).pathname; if (k.endsWith('pendant.svg')) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path d="M128 16 32 56v64c0 60 41 104 96 120 55-16 96-60 96-120V56z" fill="#2c5fd6" stroke="#9cc3ff" stroke-width="10"/></svg>' }); return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: IMAGES[k] || '' }); }
const av = (c1, c2) => svg(64, 64, `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/>`);
const banner = svg(600, 260, `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1a3a"/><stop offset=".6" stop-color="#2c5fd6"/><stop offset="1" stop-color="#7cc1ff"/></linearGradient></defs><rect width="600" height="260" fill="url(#g)"/><text x="300" y="160" font-family="Impact,sans-serif" font-size="78" text-anchor="middle" fill="#fff" opacity=".92">PROJECT CLUB</text>`);
const userBanner = svg(400, 120, `<defs><linearGradient id="g"><stop offset="0" stop-color="#ff7a18"/><stop offset="1" stop-color="#7a1f00"/></linearGradient></defs><rect width="400" height="120" fill="url(#g)"/>`);
const now = Date.now();
const U = (id, name, extra = {}) => ({ id, publicId: '1' + id.padStart(8, '0'), username: name.toLowerCase(), displayName: name, avatarUrl: av(extra.c1 || '#555', extra.c2 || '#222'), status: 'ONLINE', platformRole: extra.role || 'USER', emailVerified: true, ...extra });
const me = U('1', 'RiqueBitt', { customPendantUrl: 'http://localhost:4173/mock-img/pendant.svg', statusBubbleColor: '#000000', bannerUrl: 'http://localhost:4173/mock-img/0.svg', profileColor: '#b3261e', c1: '#c0392b', c2: '#2c0a0a', role: 'ADMIN', email: 'admin@local.test', layoutStyle: 'normal2', idCardUrl: userBanner, customStatus: 'Quem está marcando!!!' });
const users = [me, U('2', 'Loritta', { c1: '#f6a6c1', c2: '#7d3c98', isBot: true, customStatus: 'Fan Art by Azu | Cluster 4' }), U('3', 'Rio Bot', { c1: '#8e44ad', c2: '#2c3e50', isBot: true, customStatus: 'Novo comando! /tickets' }), U('4', 'Haiz Bot', { c1: '#16a085', c2: '#0b3d33', isBot: true, customStatus: 'Quais as últimas notícias?' }), U('5', 'Lia', { c1: '#4c9fff', c2: '#7b5cff', status: 'OFFLINE' })];
const roles = [
  { id: 'r0', name: '@everyone', isDefault: true, position: 0, permissions: '0' },
  { id: 'r1', name: 'RiqueBitt', hoist: true, position: 3, color: '#ff9b3d', permissions: '8' },
  { id: 'r2', name: 'Bots', hoist: true, position: 2, color: '#7aa2ff', permissions: '0' },
];
const members = users.map((u) => ({ user: u, roleIds: u.id === '1' ? ['r1'] : u.isBot ? ['r2'] : [] }));
const ch = (id, name, type = 'TEXT', extra = {}) => ({ id, name, type, position: 0, lastMessageAt: null, ...extra });
const categories = [
  { id: 'c1', name: 'ℹ️ • Informações', position: 0, channels: [ch('ch1', '📣 | Anúncios')] },
  { id: 'c2', name: '🌐 Comunidade', position: 1, channels: [ch('ch2', '🌎 | chat geral'), ch('ch3', '🔧 | comandos'), ch('ch4', '📸 | mídias')] },
  { id: 'c3', name: '🔊 Canais de Voz', position: 2, channels: [ch('v1', '☕ | Call ¹', 'VOICE'), ch('v2', '☕ | Call ²', 'VOICE')] },
];
const msg = (id, author, content, minsAgo, extra = {}) => ({ id, authorId: author.id, author, content, createdAt: new Date(now - minsAgo * 60000).toISOString(), channelId: 'ch2', reactions: [], attachments: [], ...extra });
// Reações: 👍 vem completo no payload; 🎉 vem "enxuto" (só uma amostra das
// linhas + o total em reactionCounts) — o menu "quem reagiu" busca o resto
// em GET /messages/:id/reactions/:emoji (paginado, ver REACTORS abaixo).
const reactionRow = (emoji, u, i) => ({ id: `rx-${emoji}-${u.id}`, emoji, userId: u.id, createdAt: new Date(now - (60 - i) * 60000).toISOString(), user: { id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl } });
export const REACTORS = [users[4], users[1], users[2], users[3], ...Array.from({ length: 10 }, (_, i) => U(String(20 + i), `Fã ${i + 1}`, { c1: '#2c5fd6', c2: '#111' }))];
// Imagem grande pros testes do visualizador (pinça/zoom).
const photo = svg(800, 600, `<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a18"/><stop offset="1" stop-color="#2c5fd6"/></linearGradient></defs><rect width="800" height="600" fill="url(#p)"/><circle cx="400" cy="300" r="120" fill="#fff" opacity=".8"/>`);
const messages = [
  msg('m1', me, 'teste teste', 60),
  msg('m2', users[4], 'alguém pra call hoje à noite?', 30),
  msg('m3', me, 'bora! abro a sala de voz às 21h', 29, { attachments: [{ id: 'at1', url: photo, filename: 'foto.svg', mimeType: 'image/svg+xml' }] }),
  msg('m4', users[1], 'Lembrete: o evento de figurinhas começa amanhã 🎉', 5, {
    reactions: [
      reactionRow('👍', me, 0), reactionRow('👍', users[4], 1),
      ...REACTORS.slice(0, 3).map((u, i) => reactionRow('🎉', u, i + 2)),
    ],
    reactionCounts: { '🎉': REACTORS.length },
  }),
];
// GET /api/bootstrap (pacote de abertura, ver src/utils/bootstrap.js): monta
// cada seção chamando este mesmo mock pela rota antiga.
const BOOT_PATHS = { me: '/auth/me', community: '/community', conversations: '/conversations', friends: '/friends', clan: '/clans/mine', usableEmojis: '/users/me/usable-emojis', stickers: '/community/stickers', emojiCollections: '/community/collections/EMOJI', stickerCollections: '/community/collections/STICKER', favoriteGifs: '/users/me/favorite-gifs', clubs: '/communities', settings: '/users/me/settings', uiLayout: '/ui-layout', status: '/platform/status', announcement: '/platform/announcements/active', events: '/events' };
function subRequest(path) {
  let body;
  handler({ request: () => ({ url: () => 'http://mock/api' + path, method: () => 'GET', postData: () => null, headers: () => ({}) }), fulfill: (o) => { body = o.body; } });
  return body === undefined ? null : JSON.parse(body);
}
function bootstrapMock(route, url) {
  const only = (url.searchParams.get('only') || '').split(',').filter((k) => BOOT_PATHS[k]);
  const data = {}; const hashes = {};
  (only.length ? only : Object.keys(BOOT_PATHS)).forEach((k) => { data[k] = subRequest(BOOT_PATHS[k]); hashes[k] = 'h' + JSON.stringify(data[k]).length; });
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ v: 1, at: Date.now(), hashes, data, failed: {} }) });
}
export function handler(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname.replace(/^\/api/, '');
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (p === '/bootstrap') return bootstrapMock(route, url);
  { const m = p.match(/^\/users\/([^/]+)\/summary$/); if (m) return json({ profile: subRequest('/users/' + m[1]), fan: subRequest('/fans/' + m[1]), traits: subRequest('/traits/' + m[1]), polls: subRequest('/profile-polls/author/' + m[1]) }); }

  const clubs = [{ id: 'k1', slug: 'minecraft', name: 'Minecraft', description: 'Builds, seeds e servidores', iconUrl: null, memberCount: 182, postCount: 40 }, { id: 'k2', slug: 'setup', name: 'Setups', description: 'Mostre seu setup', iconUrl: av('#ff7a18','#7a1f00'), memberCount: 95, postCount: 12 }];
  const post = (id, title, content, c, a, score, cc, mins, extra = {}) => ({ id, title, content, type: 'TEXT', community: clubs[c], author: users[a], score, myVote: 0, commentCount: cc, createdAt: new Date(now - mins * 60000).toISOString(), ...extra });
  const posts = [
    post('p1', 'Meu novo mundo survival depois de 200 dias', 'Finalmente terminei a base principal. Ficou bem maior do que eu planejava, aceito dicas pra iluminação da parte de baixo!', 0, 4, 42, 8, 50, { type: 'IMAGE', imageUrl: banner }),
    post('p2', 'Qual teclado vocês recomendam até 300 reais?', 'Procurando um mecânico, switch marrom de preferência. Uso pra jogar e programar.', 1, 0, 17, 12, 180),
    post('p3', 'Evento de figurinhas: dicas', 'Juntei uma lista das figurinhas mais raras e onde encontrar cada uma.', 0, 1, 9, 3, 600),
  ];
  if (p === '/posts' || p === '/posts/featured') return json({ posts });
  if (p === '/communities') return json({ communities: clubs });
  if (p === '/platform/stats') return json({ memberCount: 1284, postCount: 316, messageCount: 48213 });
  if (p === '/users/1') return json({ user: { ...me, accountLevel: 7, ...(process.env.MOCK_PSTYLE ? { profileStyle: process.env.MOCK_PSTYLE, bio: 'Criador do Project Club. Bora jogar? 🎮', pronouns: 'ele/dele' } : {}) }, levelProgress: 64, badges: process.env.MOCK_PSTYLE ? [{ id: 'b1', name: 'Assinante', icon: '💜' }, { id: 'b2', name: 'Fundador', icon: '🌟' }] : [], mutualFriends: [] });
  if (p === '/updates') return json({ updates: [{ id: 'u1', title: 'Normal 2.0 chegou', version: 'v2.0', description: '- Novo layout padrão\n- Cores ajustáveis', createdAt: new Date(now - 86400000).toISOString() }, { id: 'u2', title: 'Painel da staff novo', version: 'v1.9', description: '- Visão geral com pendências', createdAt: new Date(now - 3 * 86400000).toISOString() }] });
  if (p === '/events') return json({ events: [{ id: 'e1', title: 'Evento de figurinhas', description: 'Colete figurinhas raras conversando nos canais e ganhe recompensas exclusivas.', status: 'ACTIVE', bannerUrl: banner, startsAt: new Date(now - 86400000).toISOString(), endsAt: new Date(now + 5 * 86400000).toISOString() }] });
  if (p === '/youtube/videos') return json({ videos: [1,2,3].map((i) => ({ videoId: 'v' + i, url: '#', title: 'Vídeo da comunidade #' + i, thumbnailUrl: banner })) });
  if (p === '/friends') return json({ friendships: [
    { id: 'f1', status: 'ACCEPTED', user: users[4] }, { id: 'f2', status: 'ACCEPTED', user: users[1] }, { id: 'f3', status: 'ACCEPTED', user: { ...users[2], status: 'IDLE' } },
    { id: 'f4', status: 'PENDING', isIncoming: true, user: U('6', 'Nico', { c1: '#e67e22', c2: '#6e2c00' }) },
  ] });

  if (p === '/economy/rank') return json({ level: 7, levelTitle: 'Veterano', levelName: 'Lv.7', position: 12, xp: 18420, progress: 64, xpInLevel: 1280, xpNeeded: 2000, nextLevel: 8, isMaxLevel: false });
  if (p === '/economy/leaderboard') return json({ leaderboard: [
    { ...users[1], accountLevel: 24, accountXp: 152300 }, { ...users[4], accountLevel: 19, accountXp: 98210 }, { ...users[2], accountLevel: 15, accountXp: 61200 },
    { ...users[3], accountLevel: 12, accountXp: 40110 }, { ...U('7', 'Mr Pinguim', { c1: '#34495e', c2: '#000' }), accountLevel: 9, accountXp: 25110 },
    { ...me, accountLevel: 7, accountXp: 18420, outsideTop50: true },
  ] });
  if (p === '/achievements') return json({ achievements: [
    { id: 'a1', name: 'Primeira mensagem', description: 'Envie sua primeira mensagem no chat.', rarity: 'COMMON', progressType: 'MESSAGES', unlocked: true, unlockedAt: new Date(now - 9e8).toISOString(), progress: 1, target: 1 },
    { id: 'a2', name: 'Tagarela', description: 'Envie 1.000 mensagens.', rarity: 'RARE', progressType: 'MESSAGES', unlocked: false, progress: 640, target: 1000 },
    { id: 'a3', name: 'Influente', description: 'Receba 100 votos positivos em posts.', rarity: 'EPIC', progressType: 'POST_UPVOTES', unlocked: false, progress: 37, target: 100 },
    { id: 'a4', name: 'Lenda do Club', description: 'Alcance o nível 30.', rarity: 'LEGENDARY', progressType: 'LEVEL', unlocked: false, progress: 7, target: 30 },
    { id: 'a5', name: 'Fazendo amigos', description: 'Tenha 10 amigos.', rarity: 'COMMON', progressType: 'FRIENDS', unlocked: true, unlockedAt: new Date(now - 3e8).toISOString(), progress: 10, target: 10 },
  ] });
  const tk = (id, subject, status, mins, last, lastMine, extra = {}) => ({ id, subject, status, authorId: me.id, author: me, createdAt: new Date(now - mins * 60000 - 3600000).toISOString(), updatedAt: new Date(now - mins * 60000).toISOString(), claimedBy: null, messages: [{ content: last, authorId: lastMine ? me.id : '7', createdAt: new Date(now - mins * 60000).toISOString() }], _count: { messages: 3 }, ...extra });
  const tickets = [
    tk('t1', 'Não consigo trocar meu avatar', 'OPEN', 12, 'Oi! Já testou limpar o cache do app? Se não resolver, me manda um print.', false, { claimedBy: U('7', 'Mr Pinguim') }),
    tk('t2', 'Denúncia de usuário', 'OPEN', 95, 'Ele está mandando link estranho em DM pra várias pessoas.', true),
    tk('t3', 'Sugestão: modo compacto no chat', 'CLOSED', 3000, 'Obrigado pela ideia! Entrou na lista de melhorias.', false),
  ];
  if (p === '/tickets/mine' || p === '/tickets/admin/all' || p === '/tickets') return json({ tickets });
  if (p === '/tickets/t1') return json({ ticket: { ...tickets[0], messages: [
    { id: 'm1', authorId: me.id, author: me, content: 'Quando tento enviar a foto nova aparece "erro ao enviar" e fica a antiga.', createdAt: new Date(now - 50 * 60000).toISOString() },
    { id: 'm2', authorId: me.id, author: me, content: 'Já tentei com PNG e JPG.', createdAt: new Date(now - 49 * 60000).toISOString() },
    { id: 'm3', authorId: '7', author: U('7', 'Mr Pinguim', { role: 'MODERATOR' }), content: 'Oi! Já testou limpar o cache do app? Se não resolver, me manda um print.', createdAt: new Date(now - 12 * 60000).toISOString() },
  ] } });

  if (p === '/users/me/pendants') return json({ pendants: [] });
  // Loja (sala branca). MOCK_TIER=SUBSCRIBER|SUPER simula o status de apoio:
  // o preço final vem "do servidor" já com o desconto, como na API real.
  if (p === '/supporters/admin/users') return json({ users: [{ ...users[4], supporterTier: 'SUPER' }, { ...users[1], supporterTier: 'SUBSCRIBER' }], totals: { SUPER: 1, SUBSCRIBER: 1 } });
  if (p === '/supporters/admin/history') return json({ entries: [{ id: 'sa1', userId: '5', actorId: '1', fromTier: 'SUBSCRIBER', toTier: 'SUPER', reason: 'Apoio especial no evento de outubro', createdAt: new Date(now - 2 * 86400000).toISOString(), user: users[4], actor: me }], hasMore: false });
  if (p.startsWith('/supporters/admin/')) return json({ ok: true, changed: true });
  if (p === '/users/search') { const q = (url.searchParams.get('q') || '').replace(/^@+/, '').toLowerCase(); return json({ users: users.filter((u) => `${u.displayName} ${u.username}`.toLowerCase().includes(q)) }); }
  if (p === '/decorations/admin/items') return json({ items: [
    { id: 'st1', kind: 'STYLE', key: 'style:terror', name: 'Terror', data: { style: 'terror' }, priceCoins: 2500, priceGems: null, active: false, sortOrder: 0, stock: null, sold: 0, _count: { owners: 0 } },
    { id: 'st2', kind: 'STYLE', key: 'style:anime', name: 'Anime', data: { style: 'anime' }, priceCoins: 2500, priceGems: null, active: true, sortOrder: 1, stock: 50, sold: 3, _count: { owners: 3 } },
  ], styleKeys: ['terror', 'anime'] });
  if (p === '/decorations/admin/catalog') return json({ items: [
    { id: 'st1', kind: 'style', name: 'Terror', active: false, stock: null, sold: 0, data: { style: 'terror' } },
    { id: 'd1', kind: 'deco', name: 'Coroa', active: true, stock: 10, sold: 2, imageUrl: null },
  ] });
  if (p === '/decorations/admin/collections') return json({ items: [] });
  if (p === '/decorations/trades') return json({ incoming: [], outgoing: [], history: [] });
  { const m = p.match(/^\/decorations\/limiteds\/(.+)$/); if (m) return json({ user: users.find((u) => u.id === m[1]) || me, items: [] }); }
  if (p.startsWith('/decorations/admin/')) return json({ ok: true, item: {} });
  if (p === '/decorations/shop' || p === '/decorations/history' || /^\/decorations\/.+\/buy$/.test(p) || p === '/decorations/equip' || p === '/decorations/effects/equip') return shopMock(p, json);
  if (p === '/app-catalog') return json({ items: [
    { moduleId: 'projectmc', name: 'Project MC', version: '2.3.1', description: 'Launcher de Minecraft com modpacks da comunidade e login integrado.', bannerUrl: banner, iconUrl: av('#27ae60', '#145a32'), screenshots: [] },
    { moduleId: 'editor', name: 'Club Editor', version: '1.0.4', description: 'Editor de skins e mapas para os servidores do Club.', bannerUrl: null, iconUrl: av('#8e44ad', '#2c3e50'), screenshots: [] },
  ] });

  const clubMembers = [{ ...me, clanRole: 'OWNER' }, { ...users[4], clanRole: 'ADMIN' }, { ...U('7', 'Mr Pinguim', { c1: '#2c5fd6', c2: '#0b1a3a' }), clanRole: 'MODERATOR' }, { ...users[1], clanRole: 'MEMBER' }];
  const myClub = { id: 'cl1', name: 'Os Construtores', description: 'Builds gigantes no servidor e muita resenha na call.', isPublic: true, privacyType: 'PUBLIC', icon: null, iconColor: '#F0883E', memberCount: 4, members: clubMembers, tags: [{ id: 'tg1', tag: 'BLD' }] };
  if (p === '/clans/mine') return json(process.env.MOCK_CLAN ? { clan: myClub, myRole: 'OWNER', myCapabilities: { EDIT_CLAN: true, MANAGE_ROLES: true, MANAGE_MEMBERS: true, TRANSFER_OWNERSHIP: true, MANAGE_TAGS: true, MANAGE_JOIN_REQUESTS: true, MODERATE_CLAN_CHAT: true }, pendingRequests: [{ id: 'rq1', user: users[2] }] } : { clan: null });
  if (p === '/clans') return json({ clans: [
    { id: 'c2', name: 'Pixel Arts', description: 'Desenho, pixel art e figurinhas feitas pela galera.', privacyType: 'PUBLIC', isPublic: true, icon: null, iconColor: '#EB459E', memberCount: 18 },
    { id: 'c3', name: 'Speedrunners BR', description: 'Treinos, rotas e corridas toda sexta.', privacyType: 'FRIENDS_ONLY', isPublic: false, icon: null, iconColor: '#57F287', memberCount: 7, friendMember: { displayName: 'Lia' } },
    { id: 'c4', name: 'Noite do Terror', description: '', privacyType: 'PUBLIC', isPublic: true, icon: null, iconColor: '#9147FF', memberCount: 1 },
  ] });
  if (p === '/clans/invites/mine') return json({ invites: [{ id: 'iv1', clan: { name: 'Clube do Café', iconColor: '#00B0F4', icon: null }, invitedBy: { displayName: 'Mr Pinguim' } }] });
  if (p === '/clans/icons') return json({ icons: [] });
  if (p === '/clans/cl1/messages') return json({ messages: [
    { id: 'cm1', authorId: '5', author: { ...users[4], clanRole: 'ADMIN' }, content: 'bora terminar o castelo hoje?', createdAt: new Date(now - 40 * 60000).toISOString() },
    { id: 'cm2', authorId: '5', author: { ...users[4], clanRole: 'ADMIN' }, content: 'falta só a torre leste', createdAt: new Date(now - 39 * 60000).toISOString() },
    { id: 'cm3', authorId: '1', author: { ...me, clanRole: 'OWNER' }, content: 'fechado! 21h na call do clube', createdAt: new Date(now - 10 * 60000).toISOString() },
  ] });
  // Cadeia de provedores de voz (painel da staff): ativo = livekit (modo
  // reserva, o Agora esgotou), Daily sem a chave, TRTC não configurado.
  // Ver VoiceProvidersAdmin.jsx e voice-providers.spec.
  if (p === '/voice/provider') return json({
    active: 'livekit', activeReason: 'chain', overridden: false, override: null,
    primary: 'agora', reserveMode: true,
    providers: [
      { id: 'agora', label: 'Agora', order: 1, isPrimary: true, configured: true, enabled: true, available: true, disabled: false, active: false, gateEnv: null, gateMissing: false, minutesUsed: 10000, limit: 10000, unlimited: false, percent: 100, status: 'esgotado' },
      { id: 'livekit', label: 'LiveKit', order: 2, isPrimary: false, configured: true, enabled: true, available: true, disabled: false, active: true, gateEnv: null, gateMissing: false, minutesUsed: 1200, limit: 5000, unlimited: false, percent: 24, status: 'ativo' },
      { id: 'getstream', label: 'Stream (GetStream)', order: 3, isPrimary: false, configured: true, enabled: true, available: true, disabled: false, active: false, gateEnv: null, gateMissing: false, minutesUsed: 0, limit: 10000, unlimited: false, percent: 0, status: 'em_espera' },
      { id: 'daily', label: 'Daily', order: 4, isPrimary: false, configured: true, enabled: false, available: false, disabled: false, active: false, gateEnv: 'DAILY_API_KEY', gateMissing: true, minutesUsed: 0, limit: 10000, unlimited: false, percent: 0, status: 'falta_chave' },
      { id: 'trtc', label: 'TRTC (Tencent)', order: 5, isPrimary: false, configured: false, enabled: false, available: false, disabled: false, active: false, gateEnv: null, gateMissing: false, minutesUsed: 0, limit: 10000, unlimited: false, percent: 0, status: 'nao_configurado' },
      { id: 'jitsi', label: 'Jitsi (meet.jit.si)', order: 6, isPrimary: false, configured: true, enabled: true, available: true, disabled: false, active: false, gateEnv: null, gateMissing: false, minutesUsed: 0, limit: null, unlimited: true, percent: 0, status: 'em_espera' },
    ],
  });
  // Entrar numa chamada: por padrão o Agora (o teste de modo reserva
  // sobrescreve /voice/join pra devolver jitsi). Ver voice-fallback.spec.
  if (p === '/voice/join') return json({ provider: 'agora', channelName: 'v1', reserveMode: false, activeReason: 'primary', agora: { token: 'mock-token', appId: 'mock-app', uid: me.id }, token: 'mock-token', appId: 'mock-app', uid: me.id });
  if (p === '/agora/token') return json({ token: 'mock-token', appId: 'mock-app', uid: me.id });
  if (p === '/auth/refresh') return json({ accessToken: 'x', user: me });
  if (p === '/community') return json({ categories, channels: [], members, roles, community: { name: 'Project Club', bannerUrl: banner, iconUrl: null } });
  { const m = p.match(/^\/messages\/([^/]+)\/reactions\/([^/]+)$/); if (m) {
    const emoji = decodeURIComponent(m[2]);
    const msgRow = messages.find((x) => x.id === m[1]);
    if (!msgRow) return json({ error: 'Mensagem não encontrada.' }, 404);
    const list = emoji === '🎉' ? REACTORS : msgRow.reactions.filter((r) => r.emoji === emoji).map((r) => r.user);
    const PAGE = 6;
    const start = Number(url.searchParams.get('cursor') || 0);
    const page = list.slice(start, start + PAGE).map((u) => ({ id: u.id, username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl, reactedAt: new Date(now).toISOString() }));
    return json({ emoji, count: list.length, users: page, nextCursor: start + PAGE < list.length ? String(start + PAGE) : null });
  } }
  if (p === '/messages') return json({ messages: url.searchParams.get('channelId') === 'ch2' ? messages : [] });
  if (p === '/conversations') return json({ conversations: [] });
  if (p === '/friends') return json({ friendships: [] });
  if (p === '/users/me/usable-emojis') return json({ emojis: [] });
  if (p === '/community/stickers') return json({ stickers: [] });
  if (p.startsWith('/community/collections')) return json({ collections: [] });
  if (p === '/users/me/favorite-gifs') return json({ gifs: [] });
  if (p === '/communities') return json({ communities: [] });
  if (p === '/users/me/settings') return json({ settings: {} });
  if (p === '/platform/status') return json({ disabledSystems: [], maintenance: false });
  if (p === '/clans/mine') return json(null);
  if (p === '/ui-layout') return json({});
  if (p === '/messages/scheduled') return json({ scheduled: [] });
  if (p === '/reminders') return json({ active: [], fired: [] });
  if (p === '/push/web/public-key') return json({ enabled: false, publicKey: null });
  if (p === '/admin/stats') return json({ stats: { userCount: 1284, messageCount: 48213, bannedCount: 7, newUsersLast24h: 12, newUsersLast7d: 63, pendingApplications: 3, pendingReports: 1, pendingAutomodFlags: 0, pendingModReports: 2 } });
  if (p === '/admin/audit-log') return json({ logs: [
    { id: 'l1', action: 'APPLICATION_APPROVE', actor: { displayName: 'RiqueBitt' }, createdAt: new Date(now - 4 * 60000).toISOString() },
    { id: 'l2', action: 'USER_BAN', reason: 'spam de convite em DM', actor: { displayName: 'Mr Pinguim' }, createdAt: new Date(now - 95 * 60000).toISOString() },
    { id: 'l3', action: 'BADGE_GRANT', actor: { displayName: 'RiqueBitt' }, createdAt: new Date(now - 26 * 3600000).toISOString() },
    { id: 'l4', action: 'CHANNEL_CREATE', actor: { displayName: 'RiqueBitt' }, createdAt: new Date(now - 3 * 86400000).toISOString() },
  ] });
  if (p === '/admin/users') return json({ users: users.map((u) => ({ ...u, createdAt: new Date(now - 86400000 * 20).toISOString(), level: 3, xp: 120, coins: 500 })) });
  if (p === '/admin/badges') return json({ badges: [] });
  if (p === '/applications/admin/all') return json({ applications: [] });
  const E = []; return json({ polls: E, photos: E, posts: E, items: E, users: E, comments: E, visitors: E, visits: E, totalVisits: 0, today: E, upcoming: E, birthdays: E, albums: E, media: E, badges: E, pendants: E });
}
export const ME = me;

// ---------- Loja ----------
const ring = (c1, c2) => svg(128, 128, `<defs><linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><circle cx="64" cy="64" r="56" fill="none" stroke="url(#r)" stroke-width="10"/><circle cx="64" cy="10" r="9" fill="${c1}"/><circle cx="112" cy="84" r="6" fill="${c2}"/>`);
const sparkle = (c) => svg(300, 400, `<g fill="${c}" opacity=".9"><path d="M60 60l8 20 20 8-20 8-8 20-8-20-20-8 20-8z"/><path d="M230 140l6 14 14 6-14 6-6 14-6-14-14-6 14-6z"/><path d="M120 300l10 24 24 10-24 10-10 24-10-24-24-10 24-10z"/><circle cx="250" cy="330" r="6"/><circle cx="40" cy="220" r="4"/></g>`);
const shopBanner = (c1, c2, t) => svg(900, 360, `<defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="900" height="360" fill="url(#b)"/><g fill="#fff" opacity=".18"><circle cx="720" cy="90" r="120"/><circle cx="820" cy="300" r="70"/></g><text x="640" y="220" font-family="Impact,sans-serif" font-size="64" text-anchor="middle" fill="#fff" opacity=".85">${t}</text>`);
const day = 86400000;
const D = (id, name, c1, c2, extra = {}) => ({ id, name, imageUrl: ring(c1, c2), scale: 1.25, offsetX: 0, offsetY: 0, priceCoins: 300, priceGems: null, active: true, featured: false, exclusiveTier: null, discountEligible: true, description: null, collectionId: null, createdAt: new Date(now - 30 * day).toISOString(), popularity: 3, ...extra });
const F = (id, name, c, extra = {}) => ({ id, name, imageUrl: sparkle(c), scale: 1, offsetX: 0, offsetY: 0, opacity: .9, duration: 4, mScale: 1, mOffsetX: 0, mOffsetY: 0, mOpacity: .9, mDuration: 4, priceCoins: 600, priceGems: 6, active: true, featured: false, exclusiveTier: null, discountEligible: true, description: null, collectionId: null, createdAt: new Date(now - 20 * day).toISOString(), popularity: 5, ...extra });
const shopState = { owned: new Set(['d2']), equipped: 'd2', equippedFx: null };
function shopMock(p, json) {
  const tier = process.env.MOCK_TIER || 'NONE';
  const disc = tier === 'NONE' ? 0 : 15;
  const priced = (i) => {
    const one = (base) => (base == null ? { base: null, discount: 0, final: null, source: null } : { base, discount: i.discountEligible ? disc : 0, final: i.discountEligible && disc ? base - Math.floor(base * disc / 100) : base, source: i.discountEligible && disc ? 'SUBSCRIBER' : null });
    return { coins: one(i.priceCoins), gems: one(i.priceGems), discount: i.discountEligible ? disc : 0 };
  };
  const rank = { NONE: 0, SUBSCRIBER: 1, SUPER: 2 };
  const shape = (i) => {
    const via = i.exclusiveTier && rank[tier] >= rank[i.exclusiveTier];
    const owned = shopState.owned.has(i.id) || !!via;
    return { ...i, owned, ownedVia: shopState.owned.has(i.id) ? 'PURCHASE' : via ? 'SUPPORTER' : null, locked: !!i.exclusiveTier && !owned, pricing: i.exclusiveTier ? null : priced(i) };
  };
  const decorations = [
    D('d1', 'Aurora Boreal', '#22d3ee', '#a855f7', { featured: true, description: 'Gradiente que lembra o céu do norte, com dois pontinhos de luz.', createdAt: new Date(now - 2 * day).toISOString(), popularity: 41, collectionId: 'c1' }),
    D('d2', 'Clássica Azul', '#1f6feb', '#60a5fa', { priceCoins: 150, popularity: 88 }),
    D('d3', 'Brasa', '#f97316', '#dc2626', { featured: true, priceCoins: 450, priceGems: 4, description: 'Para quem chega pegando fogo no chat.', popularity: 25, collectionId: 'c1' }),
    D('d4', 'Menta', '#10b981', '#a7f3d0', { priceCoins: 1200, discountEligible: false, description: 'Edição limitada — fora do desconto de Assinante.', createdAt: new Date(now - 1 * day).toISOString() }),
    D('dx1', 'Selo do Apoiador', '#7c3aed', '#c4b5fd', { priceCoins: null, exclusiveTier: 'SUBSCRIBER', description: 'Moldura exclusiva de quem apoia o Project Club.' }),
    D('dx2', 'Coroa Dourada', '#f59e0b', '#fde68a', { priceCoins: null, exclusiveTier: 'SUPER', description: 'Só para Super Assinantes.' }),
  ];
  const effects = [
    F('e1', 'Chuva de Estrelas', '#facc15', { featured: true, description: 'Estrelinhas douradas caindo pelo perfil.', createdAt: new Date(now - 3 * day).toISOString(), popularity: 63, collectionId: 'c1' }),
    F('e2', 'Neblina Roxa', '#a855f7', { priceCoins: 900, priceGems: null, popularity: 12 }),
    F('e3', 'Faíscas', '#38bdf8', { priceCoins: 0, priceGems: null, description: 'Grátis por tempo limitado.', createdAt: new Date(now - 1 * day).toISOString() }),
    F('ex1', 'Brilho de Apoio', '#c084fc', { priceCoins: null, priceGems: null, exclusiveTier: 'SUBSCRIBER' }),
  ];
  if (p === '/decorations/shop') {
    const col = { id: 'c1', name: 'Noite Elétrica', description: 'Molduras e efeitos com cores de neon para destacar seu perfil à noite.', bannerUrl: shopBanner('#1e1b4b', '#7c3aed', 'NOITE ELÉTRICA'), logoUrl: null, accentColor: '#7c3aed', active: true, featured: true, sortOrder: 0, bundlePriceCoins: 1100, bundlePriceGems: null, discountEligible: true, offer: { discount: 20, startsAt: null, endsAt: new Date(now + 2 * day).toISOString(), active: true }, createdAt: new Date(now - 5 * day).toISOString() };
    col.pricing = { coins: (() => { const b = 1100; const viaOffer = Math.ceil(b * 0.8); const viaSub = disc ? b - Math.floor(b * disc / 100) : Infinity; return viaSub < viaOffer ? { base: b, discount: disc, final: viaSub, source: 'SUBSCRIBER' } : { base: b, discount: 20, final: viaOffer, source: 'OFFER' }; })(), gems: { base: null, discount: 0, final: null, source: null } };
    const col2 = { id: 'c2', name: 'Verão no Club', description: 'Cores quentes para o seu perfil.', bannerUrl: shopBanner('#f97316', '#facc15', 'VERÃO'), accentColor: '#f97316', active: true, featured: true, bundlePriceCoins: null, bundlePriceGems: null, discountEligible: true, offer: null, pricing: {} };
    return json({
      decorations: decorations.map(shape), effects: effects.map(shape), collections: [col, col2],
      styles: process.env.MOCK_STYLES ? [["win2000", "Windows 2000"], ["anime", "Anime"], ["terror", "Terror"], ["bugado", "Bugado"], ["nostalgia", "Nostalgia"], ["cyberpunk", "Cyberpunk 2099"], ["vaporwave", "Vaporwave"], ["pixel", "8-bit"], ["oceano", "Oceano Profundo"], ["floresta", "Floresta Encantada"], ["galaxia", "Galáxia"], ["sakura", "Sakura"], ["inverno", "Inverno"], ["lava", "Vulcão"], ["realeza", "Realeza"], ["matrix", "Matrix"], ["caderno", "Caderno"], ["steampunk", "Steampunk"], ["gotico", "Gótico"], ["arcade", "Arcade 80"], ["sunset", "Pôr do Sol"], ["candy", "Doceria"], ["aurora", "Aurora Boreal"], ["deserto", "Deserto"], ["halloween", "Halloween"], ["natal", "Natal"], ["lofi", "Lo-fi Chill"], ["holografico", "Holográfico"], ["militar", "Tático"], ["faroeste", "Faroeste"], ["medieval", "Pergaminho"], ["cafe", "Cafeteria"], ["grafite", "Grafite"], ["marmore", "Mármore"], ["noir", "Filme Noir"]].map(([k, n], i) => ({ id: 'st-' + k, kind: 'STYLE', key: 'style:' + k, name: n, data: { style: k }, priceCoins: 2500, priceGems: null, active: true, sortOrder: i, stock: null, sold: 0, limited: false, remaining: null, owned: false, createdAt: new Date(now - 30 * day).toISOString(), popularity: 0, pricing: { coins: { base: 2500, final: 2500, discount: 0 } } })) : [],
      coins: 2480, gems: 12, supporter: { tier, label: tier, discount: disc },
      equippedId: shopState.equipped, equippedEffectId: shopState.equippedFx,
    });
  }
  if (p === '/decorations/history') return json({ purchases: [{ id: 'h1', kind: 'SHOP', label: 'Loja: moldura Clássica Azul', coins: -150, gems: 0, createdAt: new Date(now - 4 * day).toISOString() }], received: [], hasMore: false });
  const m = p.match(/^\/decorations\/(?:effects\/|collections\/)?([^/]+)\/buy$/);
  if (m) { shopState.owned.add(m[1]); return json({ ok: true, paid: 0, coins: 2000, gems: 12 }); }
  return json({ user: me });
}
