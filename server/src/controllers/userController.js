const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS, SELF_USER_FIELDS, ensurePublicId } = require('./authController');
const { clearIfExpired } = require('../services/customStatus');
const activityStore = require('../services/activityStore');

// Keep in sync with client/src/utils/nameStyle.js's own option lists.
const NAME_FONTS = ['NORMAL', 'PIXEL', 'CARTOON', 'MEDIEVAL', 'HANDWRITING'];
const NAME_EFFECTS = ['SOLID', 'NEON', 'GRADIENT', 'POP', 'SKETCH'];

// Item pedido: "sistema igual da Steam" pra reorganizar o perfil —
// chaves de seção conhecidas, mantidas em sincronia com
// PROFILE_SECTIONS em client/src/components/modals/UserProfileModal.jsx.
// Validado no servidor também (não só escondido na tela) — evita
// salvar uma chave inválida/lixo que quebraria a exibição depois.
const PROFILE_SECTION_KEYS = [
  'about', 'badges', 'featuredAchievements', 'tag', 'album', 'polls', 'communityActivity',
  'roles', 'memberSince', 'connections', 'mutualFriends', 'birthdays', 'relationship',
  'scraps', 'testimonials', 'traits', 'visitors',
];

async function updateProfile(req, res, next) {
  try {
    const allowed = ['displayName', 'bio', 'pronouns', 'customStatus', 'profileColor', 'profileSectionOrder'];
    // Conexões links (see UserSettingsModal.jsx's "Conexões" section under the
    // PROFILE tab / UserProfileModal.jsx's Conexões display) — plain optional
    // URLs, no OAuth verification. Sanitized to either a real http(s) link or
    // null so the profile renderer never has to guard against garbage values.
    const linkFields = ['youtubeUrl', 'steamUrl', 'robloxUrl', 'xUrl'];
    const data = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) data[key] = req.body[key];
    }
    // Guarda equivalente à seção "Cor do perfil" ficando escondida em
    // UserSettingsModal.jsx quando a staff desativa "cores_perfil" em
    // /admin → Sistema (ver adminController.js TOGGLEABLE_SYSTEMS) — sem
    // isso, alguém poderia continuar mudando a própria cor direto pela API
    // mesmo com o controle escondido na UI. Só bloqueia a EDIÇÃO: perfis
    // que já tinham uma cor salva continuam mostrando ela normalmente em
    // todo o app, isso só impede que ela seja alterada enquanto o sistema
    // estiver desligado.
    // Item pedido: "sistema igual da Steam" — ordem personalizada das
    // seções do perfil. Valida no servidor (não só confiando no que o
    // frontend mandou) que é um array de verdade, com só chaves de
    // seção conhecidas — evita salvar lixo no banco se algo mandar um
    // valor malformado.
    const VALID_SECTION_KEYS = [
      'about', 'achievements', 'album', 'polls', 'community_activity', 'roles',
      'member_since', 'connections', 'mutual_friends', 'relationship', 'traits',
      'scraps', 'testimonials', 'visitors',
    ];
    if (data.profileSectionOrder !== undefined) {
      try {
        const parsed = JSON.parse(data.profileSectionOrder);
        if (!Array.isArray(parsed) || !parsed.every((k) => typeof k === 'string' && VALID_SECTION_KEYS.includes(k))) {
          delete data.profileSectionOrder;
        }
      } catch {
        delete data.profileSectionOrder;
      }
    }

    if (data.profileColor !== undefined) {
      const settings = await prisma.platformSettings.findUnique({ where: { id: 'singleton' } });
      let disabled = [];
      try { disabled = JSON.parse(settings?.disabledSystems || '[]'); } catch { disabled = []; }
      if (disabled.includes('cores_perfil')) {
        delete data.profileColor;
      }
    }
    // Avatar de pinguim (tema Club Penguin — ver PenguinAvatar.jsx no
    // client): um "pseudo-URL" fixo em vez de um upload de arquivo de
    // verdade. Validado contra uma lista travada de cores pra esse campo
    // nunca virar um jeito de gravar uma URL arbitrária burlando o upload
    // normal de avatar (uploadAvatar, que continua sendo o único jeito de
    // setar uma foto de verdade).
    const PENGUIN_COLORS = ['blue', 'red', 'green', 'yellow', 'pink', 'purple', 'orange', 'black'];
    if (req.body.avatarUrl !== undefined) {
      const raw = String(req.body.avatarUrl || '');
      if (raw.startsWith('penguin:') && PENGUIN_COLORS.includes(raw.slice(8))) {
        data.avatarUrl = raw;
      } else if (raw === '') {
        data.avatarUrl = null;
      }
    }
    for (const key of linkFields) {
      if (req.body[key] === undefined) continue;
      const raw = (req.body[key] || '').trim();
      if (!raw) { data[key] = null; continue; }
      data[key] = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    }
    // Privacidade de pedidos de amizade (item pedido) — só as 3 opções
    // válidas passam, o resto é ignorado silenciosamente (mesma
    // estratégia de allowlist do resto desse controller).
    if (req.body.friendRequestPrivacy !== undefined) {
      const validPrivacy = ['EVERYONE', 'FRIENDS_OF_FRIENDS', 'NOBODY'];
      if (validPrivacy.includes(req.body.friendRequestPrivacy)) data.friendRequestPrivacy = req.body.friendRequestPrivacy;
    }
    // Same field/cap as the dedicated setCustomStatus endpoint (see below)
    // — this is the simpler "just save it with the rest of your profile"
    // path (UserSettingsModal.jsx), which doesn't touch
    // customStatusExpiresAt at all (that's only ever set through the
    // dedicated "Definir status personalizado" flow).
    if (req.body.customStatusEmoji !== undefined) {
      data.customStatusEmoji = req.body.customStatusEmoji ? String(req.body.customStatusEmoji).slice(0, 32) : null;
    }
    // Display-name styling shown only on the profile page itself (see
    // schema.prisma's comment on profileNameFont) — validated against a
    // fixed whitelist so a bad/garbage value can never end up picking an
    // undefined CSS class client-side.
    if (req.body.profileNameFont !== undefined && NAME_FONTS.includes(req.body.profileNameFont)) {
      data.profileNameFont = req.body.profileNameFont;
    }
    if (req.body.profileNameEffect !== undefined && NAME_EFFECTS.includes(req.body.profileNameEffect)) {
      data.profileNameEffect = req.body.profileNameEffect;
    }
    if (req.body.profileNameColor !== undefined && /^#[0-9a-fA-F]{6}$/.test(req.body.profileNameColor)) {
      data.profileNameColor = req.body.profileNameColor;
    }
    if (req.body.profileNameColor2 !== undefined && /^#[0-9a-fA-F]{6}$/.test(req.body.profileNameColor2)) {
      data.profileNameColor2 = req.body.profileNameColor2;
    }
    const user = await prisma.user.update({ where: { id: req.user.id }, data, select: SELF_USER_FIELDS });
    await broadcastUserUpdate(req, user);
    res.json({ user });
  } catch (err) { next(err); }
}

// See UserSettingsModal.jsx's "Tags" tab. `serverId: null` clears the
// active tag. Denormalizes tagEmoji/tagText onto the user row at selection
// time (see the schema.prisma comment on User.tagEmoji for why) rather than
// resolving live — requires the caller to actually be a member of that
// server, and that server to have a real tag configured (both emoji and
// text set), otherwise there'd be nothing to display.
// Broadcasts the fresh public fields to every room this person shows up
// in — their own personal room (other tabs/devices) plus every server they
// share with someone else — so a tag change (or any future PUBLIC_USER_FIELDS
// change routed through here) shows up immediately in open member lists and
// already-loaded chat messages instead of needing a page refresh (see
// SocketContext.jsx's 'user:update' handler / useStore.patchUserEverywhere).
async function broadcastUserUpdate(req, user) {
  const io = req.app.get('io');
  if (!io) return;
  // `user` aqui vem selecionado com SELF_USER_FIELDS (inclui email/2FA) —
  // correto para as próprias abas/dispositivos do dono da conta
  // (`user:${id}`), mas o resto da comunidade só pode ver a versão pública.
  const { email, emailVerified, twoFactorEnabled, ...publicUser } = user;
  io.to(`user:${user.id}`).emit('user:update', user);
  io.to('community').emit('user:update', publicUser);
}

// Tag da comunidade (ex.: "🔥 FUNDADOR") — como agora só existe uma
// comunidade, é uma tag global configurada em PlatformSettings (ver
// platformController) que qualquer membro pode optar por exibir ou não
// junto ao próprio nome.
async function setActiveTag(req, res, next) {
  try {
    const { active } = req.body;
    if (!active) {
      const user = await prisma.user.update({
        where: { id: req.user.id }, data: { tagEmoji: null, tagText: null }, select: SELF_USER_FIELDS,
      });
      await broadcastUserUpdate(req, user);
      return res.json({ user });
    }

    const settings = await prisma.platformSettings.findUnique({ where: { id: 'singleton' } });
    if (!settings) return res.status(400).json({ error: 'A comunidade ainda não tem uma tag configurada.' });

    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { tagEmoji: '🏠', tagText: (settings.communityName || 'HUB').slice(0, 4).toUpperCase() },
      select: SELF_USER_FIELDS,
    });
    await broadcastUserUpdate(req, user);
    res.json({ user });
  } catch (err) { next(err); }
}

async function updateUsername(req, res, next) {
  try {
    const { username } = req.body;
    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'Nome de usuário inválido.' });
    }
    const taken = await prisma.user.findFirst({ where: { username, NOT: { id: req.user.id } } });
    if (taken) return res.status(409).json({ error: 'Nome de usuário já em uso.' });
    const user = await prisma.user.update({
      where: { id: req.user.id }, data: { username }, select: SELF_USER_FIELDS,
    });
    await broadcastUserUpdate(req, user);
    res.json({ user });
  } catch (err) { next(err); }
}

async function uploadAvatar(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const avatarUrl = req.file.url;
    const user = await prisma.user.update({
      where: { id: req.user.id }, data: { avatarUrl }, select: SELF_USER_FIELDS,
    });
    await broadcastUserUpdate(req, user);
    res.json({ user });
  } catch (err) { next(err); }
}

async function uploadBanner(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const bannerUrl = req.file.url;
    const user = await prisma.user.update({
      where: { id: req.user.id }, data: { bannerUrl }, select: SELF_USER_FIELDS,
    });
    await broadcastUserUpdate(req, user);
    res.json({ user });
  } catch (err) { next(err); }
}

// "Placa de identificação" (see schema.prisma's comment on User.idCardUrl)
// — shown as the background behind this user's own row in the members
// list, so it IS visible to others (unlike a purely personal setting) and
// needs the same broadcastUserUpdate every other profile-visible change
// gets, so it updates live in anyone's member list who's looking at it.
async function uploadIdCard(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const idCardUrl = req.file.url;
    const user = await prisma.user.update({
      where: { id: req.user.id }, data: { idCardUrl }, select: SELF_USER_FIELDS,
    });
    await broadcastUserUpdate(req, user);
    res.json({ user });
  } catch (err) { next(err); }
}

async function removeIdCard(req, res, next) {
  try {
    const user = await prisma.user.update({
      where: { id: req.user.id }, data: { idCardUrl: null }, select: SELF_USER_FIELDS,
    });
    await broadcastUserUpdate(req, user);
    res.json({ user });
  } catch (err) { next(err); }
}

// Tema de interface (facebook/light/dark/amoled/clubpenguin) — salvo na
// CONTA, não só no localStorage do navegador (ver comentário no
// schema.prisma sobre User.preferredTheme). O cliente já aplica o tema
// na hora localmente; essa chamada só garante que ele sobrevive a trocar
// de navegador/dispositivo ou limpar dados locais.
async function setPreferredTheme(req, res, next) {
  try {
    const { theme } = req.body;
    const allowed = ['facebook', 'light', 'dark', 'amoled', 'clubpenguin'];
    if (!allowed.includes(theme)) return res.status(400).json({ error: 'Tema inválido.' });
    const user = await prisma.user.update({
      where: { id: req.user.id }, data: { preferredTheme: theme }, select: SELF_USER_FIELDS,
    });
    res.json({ user });
  } catch (err) { next(err); }
}

async function setStatus(req, res, next) {
  try {
    const { status } = req.body;
    const allowed = ['ONLINE', 'IDLE', 'DND', 'INVISIBLE'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Status inválido.' });
    const user = await prisma.user.update({
      where: { id: req.user.id }, data: { status }, select: SELF_USER_FIELDS,
    });
    const io = req.app.get('io');
    io?.emitPresenceUpdate?.(user);
    // Escolha manual de status (pelo dropdown) sempre vence o que o
    // sweep de inatividade decidiu sozinho — ver onManualStatusChange em
    // sockets/index.js.
    io?.onManualStatusChange?.(req.user.id, status);
    res.json({ user });
  } catch (err) { next(err); }
}

// Discord-style custom status: free text + emoji, shown as a balloon next
// to the avatar, with an optional auto-clear time. Duration is expressed in
// minutes from "now" (null/0 = doesn't expire on its own).
async function setCustomStatus(req, res, next) {
  try {
    const { text, emoji, durationMinutes } = req.body;
    const data = {
      customStatus: text ? String(text).slice(0, 128) : null,
      customStatusEmoji: emoji ? String(emoji).slice(0, 32) : null,
      customStatusExpiresAt: durationMinutes ? new Date(Date.now() + Number(durationMinutes) * 60 * 1000) : null,
    };
    const user = await prisma.user.update({ where: { id: req.user.id }, data, select: SELF_USER_FIELDS });
    req.app.get('io')?.emitPresenceUpdate?.(user);
    res.json({ user });
  } catch (err) { next(err); }
}

async function searchUsers(req, res, next) {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ users: [] });
    const users = await prisma.user.findMany({
      where: {
        NOT: { id: req.user.id },
        OR: [
          { username: { contains: q } },
          { displayName: { contains: q } },
        ],
      },
      select: PUBLIC_USER_FIELDS,
      take: 20,
    });
    res.json({ users });
  } catch (err) { next(err); }
}

// Full profile view (used by the "click an avatar" modal) — public fields
// plus badges, account age, and — when viewing someone other than yourself —
// servers and friends you have in common. Kept as one endpoint instead of
// several so the modal only needs a single round-trip.
async function getUser(req, res, next) {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({ where: { id }, select: PUBLIC_USER_FIELDS });
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!user.publicId) user.publicId = await ensurePublicId(user.id, user.publicId);

    // Item pedido: status de relacionamento — busca os dados do
    // parceiro só se existir um confirmado (evita uma query aninhada
    // desnecessária pro caso comum de não ter parceiro nenhum).
    let relationshipPartner = null;
    if (user.relationshipPartnerId) {
      relationshipPartner = await prisma.user.findUnique({
        where: { id: user.relationshipPartnerId },
        select: { id: true, displayName: true, username: true, avatarUrl: true, profileColor: true },
      });
    }

    // Item pedido: aniversariantes — só um booleano de "é hoje", nunca
    // a data completa (nem no PUBLIC_USER_FIELDS genérico) — evita
    // expor a idade da pessoa em qualquer resposta de perfil.
    let isBirthdayToday = false;
    {
      const rawUser = await prisma.user.findUnique({ where: { id }, select: { birthDate: true } });
      if (rawUser?.birthDate) {
        const today = new Date();
        const bd = rawUser.birthDate;
        isBirthdayToday = bd.getUTCDate() === today.getUTCDate() && bd.getUTCMonth() === today.getUTCMonth();
      }
    }

    const badgeRows = await prisma.userBadge.findMany({ where: { userId: id }, include: { badge: true }, orderBy: { badge: { priority: 'asc' } } });
    // awardedAt lives on the UserBadge join row (when THIS user unlocked it),
    // not on the Badge itself (which is shared across everyone who has it) —
    // has to be merged in by hand or the "Data desbloqueada" on the badge
    // browser modal has nothing to show.
    const badges = badgeRows.map((b) => ({ ...b.badge, awardedAt: b.awardedAt }));

    let mutualFriends = [];
    if (id !== req.user.id) {
      const [myFriendships, theirFriendships] = await Promise.all([
        prisma.friendship.findMany({
          where: { status: 'ACCEPTED', OR: [{ requesterId: req.user.id }, { addresseeId: req.user.id }] },
        }),
        prisma.friendship.findMany({
          where: { status: 'ACCEPTED', OR: [{ requesterId: id }, { addresseeId: id }] },
        }),
      ]);
      const otherIdOf = (f, selfId) => (f.requesterId === selfId ? f.addresseeId : f.requesterId);
      const myFriendIds = new Set(myFriendships.map((f) => otherIdOf(f, req.user.id)));
      const theirFriendIds = new Set(theirFriendships.map((f) => otherIdOf(f, id)).filter((fid) => fid !== req.user.id));
      const commonFriendIds = [...myFriendIds].filter((fid) => theirFriendIds.has(fid));
      if (commonFriendIds.length > 0) {
        mutualFriends = await prisma.user.findMany({
          where: { id: { in: commonFriendIds } }, select: { id: true, displayName: true, username: true, avatarUrl: true, profileColor: true },
        });
      }
    }

    const [likeCount, dislikeCount, myVoteRow, postUpvotes, commentUpvotes] = await Promise.all([
      prisma.profileVote.count({ where: { toUserId: id, value: 1 } }),
      prisma.profileVote.count({ where: { toUserId: id, value: -1 } }),
      prisma.profileVote.findUnique({ where: { fromUserId_toUserId: { fromUserId: req.user.id, toUserId: id } } }),
      // Ups totais (item pedido: "Ups recebidos em posts ou no perfil
      // devem contar para os Ups gerais") — soma votos positivos que a
      // pessoa recebeu no Feed (posts + comentários), não só no perfil.
      prisma.postVote.count({ where: { value: 1, post: { authorId: id } } }),
      prisma.postCommentVote.count({ where: { value: 1, comment: { authorId: id } } }),
    ]);
    const totalUps = likeCount + postUpvotes + commentUpvotes;

    // Resolve as conquistas escolhidas pra exibir (guardadas como array
    // de `key` no JSON de User.displayedAchievements/Mini) pros objetos
    // completos (ícone/nome/raridade) — assim a tela do perfil não
    // precisa de uma segunda chamada só pra isso.
    let displayedAchievements = [];
    let displayedAchievementsMini = [];
    try {
      const profileKeys = JSON.parse(user.displayedAchievements || '[]');
      const miniKeys = JSON.parse(user.displayedAchievementsMini || '[]');
      const allKeys = [...new Set([...profileKeys, ...miniKeys])];
      if (allKeys.length > 0) {
        const defs = await prisma.achievement.findMany({ where: { key: { in: allKeys } } });
        const byKey = Object.fromEntries(defs.map((d) => [d.key, d]));
        displayedAchievements = profileKeys.map((k) => byKey[k]).filter(Boolean);
        displayedAchievementsMini = miniKeys.map((k) => byKey[k]).filter(Boolean);
      }
    } catch { /* JSON inválido — trata como vazio */ }

    // Progresso até o próximo nível (pra barra de progresso no perfil).
    const { LEVELS, nextLevel } = require('../data/levelsCatalog');
    const currentLevelData = LEVELS.find((l) => l.level === user.accountLevel) || LEVELS[0];
    const next = nextLevel(user.accountLevel);
    let levelProgress = 100;
    if (next) {
      const xpInLevel = user.accountXp - currentLevelData.minXp;
      const xpNeeded = next.minXp - currentLevelData.minXp;
      levelProgress = Math.max(0, Math.min(100, Math.floor((xpInLevel / xpNeeded) * 100)));
    }

    const activity = await activityStore.getActivity(id);

    res.json({
      user: clearIfExpired(user), badges, mutualFriends,
      likeCount, dislikeCount, myVote: myVoteRow?.value || 0, levelProgress, totalUps,
      displayedAchievements, displayedAchievementsMini,
      activity, relationshipPartner, isBirthdayToday,
    });
  } catch (err) { next(err); }
}

// Like/dislike another user's profile. Voting again with the same value
// removes the vote (tap-to-toggle, like a message reaction); voting with
// the opposite value flips it in place. Can't vote on your own profile —
// there's no UI path to it (the buttons don't render for isMe), but the
// server is the actual boundary, not the client.
async function voteProfile(req, res, next) {
  try {
    const { id } = req.params;
    const { value } = req.body;
    if (id === req.user.id) return res.status(400).json({ error: 'Você não pode votar no seu próprio perfil.' });
    if (![1, -1].includes(value)) return res.status(400).json({ error: 'Valor de voto inválido.' });

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const existing = await prisma.profileVote.findUnique({ where: { fromUserId_toUserId: { fromUserId: req.user.id, toUserId: id } } });
    let myVote = value;
    if (existing && existing.value === value) {
      await prisma.profileVote.delete({ where: { id: existing.id } });
      myVote = 0;
    } else {
      await prisma.profileVote.upsert({
        where: { fromUserId_toUserId: { fromUserId: req.user.id, toUserId: id } },
        update: { value },
        create: { fromUserId: req.user.id, toUserId: id, value },
      });
    }

    const [likeCount, dislikeCount] = await Promise.all([
      prisma.profileVote.count({ where: { toUserId: id, value: 1 } }),
      prisma.profileVote.count({ where: { toUserId: id, value: -1 } }),
    ]);
    require('../services/ups').emitUpsUpdate(req.app.get('io'), id);
    require('../services/achievements').checkAndUnlock(id, req.app.get('io')); // carismatico / amado_por_todos
    res.json({ likeCount, dislikeCount, myVote });
  } catch (err) { next(err); }
}

// Escolher quais conquistas aparecem no perfil (até 6) e no miniperfil
// (até 4) — validado no servidor: só pode escolher conquista que já
// desbloqueou de verdade, e nunca mais que o limite de cada slot. Salvo
// na conta (User.displayedAchievements/Mini), então sobrevive a sair e
// entrar de novo.
async function setDisplayedAchievements(req, res, next) {
  try {
    const { slot, achievementIds } = req.body;
    if (!['profile', 'mini'].includes(slot)) return res.status(400).json({ error: 'Slot inválido.' });
    if (!Array.isArray(achievementIds)) return res.status(400).json({ error: 'Lista inválida.' });
    const limit = slot === 'profile' ? 6 : 4;
    if (achievementIds.length > limit) return res.status(400).json({ error: `Escolha no máximo ${limit} conquistas.` });

    const unlocked = await prisma.userAchievement.findMany({ where: { userId: req.user.id }, select: { achievementId: true } });
    const unlockedIds = new Set(unlocked.map((a) => a.achievementId));
    if (achievementIds.some((id) => !unlockedIds.has(id))) {
      return res.status(400).json({ error: 'Você só pode exibir conquistas que já desbloqueou.' });
    }

    const field = slot === 'profile' ? 'displayedAchievements' : 'displayedAchievementsMini';
    const user = await prisma.user.update({
      where: { id: req.user.id }, data: { [field]: JSON.stringify(achievementIds) }, select: SELF_USER_FIELDS,
    });
    res.json({ user });
  } catch (err) { next(err); }
}

module.exports = {
  updateProfile, updateUsername, uploadAvatar, uploadBanner, uploadIdCard, removeIdCard,
  setStatus, setCustomStatus, searchUsers, getUser, setActiveTag, voteProfile, setPreferredTheme,
  setDisplayedAchievements,
};
