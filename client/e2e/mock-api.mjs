// API simulada do Project Club para os testes de tela (sem servidor/banco).
// Cada rota devolve dados de exemplo; rotas desconhecidas devolvem listas vazias.
const IMAGES = {};
let imgN = 0;
const svg = (w, h, body) => { const k = `/mock-img/${imgN++}.svg`; IMAGES[k] = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`; return `http://localhost:4173${k}`; };
export function imageHandler(route) { const k = new URL(route.request().url()).pathname; return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: IMAGES[k] || '' }); }
const av = (c1, c2) => svg(64, 64, `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/>`);
const banner = svg(600, 260, `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1a3a"/><stop offset=".6" stop-color="#2c5fd6"/><stop offset="1" stop-color="#7cc1ff"/></linearGradient></defs><rect width="600" height="260" fill="url(#g)"/><text x="300" y="160" font-family="Impact,sans-serif" font-size="78" text-anchor="middle" fill="#fff" opacity=".92">PROJECT CLUB</text>`);
const userBanner = svg(400, 120, `<defs><linearGradient id="g"><stop offset="0" stop-color="#ff7a18"/><stop offset="1" stop-color="#7a1f00"/></linearGradient></defs><rect width="400" height="120" fill="url(#g)"/>`);
const now = Date.now();
const U = (id, name, extra = {}) => ({ id, publicId: '1' + id.padStart(8, '0'), username: name.toLowerCase(), displayName: name, avatarUrl: av(extra.c1 || '#555', extra.c2 || '#222'), status: 'ONLINE', platformRole: extra.role || 'USER', emailVerified: true, ...extra });
const me = U('1', 'RiqueBitt', { c1: '#c0392b', c2: '#2c0a0a', role: 'ADMIN', email: 'admin@local.test', layoutStyle: 'normal2', idCardUrl: userBanner, customStatus: 'Quem está marcando!!!' });
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
const messages = [
  msg('m1', me, 'teste teste', 60),
  msg('m2', users[4], 'alguém pra call hoje à noite?', 30),
  msg('m3', me, 'bora! abro a sala de voz às 21h', 29),
  msg('m4', users[1], 'Lembrete: o evento de figurinhas começa amanhã 🎉', 5),
];
export function handler(route) {
  const req = route.request();
  const url = new URL(req.url());
  const p = url.pathname.replace(/^\/api/, '');
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

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
  if (p === '/users/1') return json({ user: { ...me, accountLevel: 7 }, levelProgress: 64, badges: [], mutualFriends: [] });
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
  if (p === '/app-catalog') return json({ items: [
    { moduleId: 'projectmc', name: 'Project MC', version: '2.3.1', description: 'Launcher de Minecraft com modpacks da comunidade e login integrado.', bannerUrl: banner, iconUrl: av('#27ae60', '#145a32'), screenshots: [] },
    { moduleId: 'editor', name: 'Club Editor', version: '1.0.4', description: 'Editor de skins e mapas para os servidores do Club.', bannerUrl: null, iconUrl: av('#8e44ad', '#2c3e50'), screenshots: [] },
  ] });
  if (p === '/auth/refresh') return json({ accessToken: 'x', user: me });
  if (p === '/community') return json({ categories, channels: [], members, roles, community: { name: 'Project Club', bannerUrl: banner, iconUrl: null } });
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
