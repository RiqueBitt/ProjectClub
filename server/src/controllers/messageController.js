const fs = require('fs');
const prisma = require('../config/prisma');
const { createIgnoreDuplicate } = require('../utils/prismaSafe');
const { PUBLIC_USER_FIELDS } = require('./authController');
const { getEffectivePermissions, getEffectivePermissionsForChannels, channelHasRestrictions } = require('../services/authz');
const { has } = require('../services/permissions');
const automod = require('../services/automod');
const dmAutomod = require('../services/dmAutomod');
const { canSendDirectMessage } = require('../services/dmPermissions');
const xpService = require('../services/xp');
const { resolveMentions } = require('../services/mentions');
const { maybeSendOfflineEmail } = require('../services/offlineEmailNotifier');
const { discardUploadedFiles } = require('../middleware/upload');
const { maskUserStatus } = require('../utils/presenceVisibility');
const { isValidReactionEmoji } = require('../utils/reactionEmoji');
const { sharedIdempotency } = require('../services/messageIdempotency');

// Discord-style cap: once a message already has this many *distinct* emoji
// reacted to it, nobody can pile on a brand new one — you can still toggle
// an existing emoji already on the message. Keeps the reaction row from
// growing unbounded under spam/troll piling.
const MAX_DISTINCT_REACTIONS = 20;
// Kept in sync with client/src/utils/reactions.js's own copy.
const MAX_FORUM_POST_REACTIONS = 5;
// The author of a forum post can pin at most this many emoji as their own
// post's one-click "quick react" shortcuts (see ForumComposer in
// ForumChannelView.jsx) — small and fixed on purpose, this is a curated
// shortlist, not a general reaction picker.
const MAX_FORUM_QUICK_REACTIONS = 3;

// Item pedido: "Filtro de spam... verificar frequência, verificar
// repetição... Esses limites são proteção do sistema, não apenas uma
// configuração visual." — por isso NÃO fica atrás do toggle
// spamFilterEnabled das Configurações (esse toggle é uma preferência
// pessoal de outra coisa — ver settingsController.js — enquanto isto
// aqui é proteção de todo mundo contra flood, sempre ativa). Limites
// simples e fixos por enquanto: N mensagens numa janela curta, e
// mensagem idêntica repetida rápido demais no mesmo lugar.
const SPAM_WINDOW_MS = 4000;
const SPAM_MAX_IN_WINDOW = 5;
const SPAM_REPEAT_WINDOW_MS = 10000;

async function checkSpamLimits(req, { conversationId, channelId }, content) {
  const where = { authorId: req.user.id, conversationId: conversationId || undefined, channelId: channelId || undefined };
  const since = new Date(Date.now() - SPAM_WINDOW_MS);
  const recentCount = await prisma.message.count({ where: { ...where, createdAt: { gt: since } } });
  if (recentCount >= SPAM_MAX_IN_WINDOW) {
    const e = new Error('Você está enviando mensagens rápido demais. Espere um instante.');
    e.status = 429;
    throw e;
  }
  if (content) {
    const last = await prisma.message.findFirst({ where, orderBy: { createdAt: 'desc' }, select: { content: true, createdAt: true } });
    if (last && last.content === content && (Date.now() - new Date(last.createdAt).getTime()) < SPAM_REPEAT_WINDOW_MS) {
      const e = new Error('Você acabou de mandar essa mesma mensagem.');
      e.status = 429;
      throw e;
    }
  }
}

// Item pedido: "Filtro de conteúdo... Desativado / Moderado / Alto...
// O sistema deve determinar se a mensagem deve: ser exibida / ser
// ocultada / mostrar aviso... dependendo da configuração." — aplicado
// na LEITURA (quem está vendo é quem escolheu o próprio nível), não
// no envio: a mesma mensagem pode aparecer normal pra uma pessoa e
// oculta pra outra. Reaproveita a mesma lista de palavras sinalizadas
// que o automod de DM já usa (dmAutomod.checkFlaggedWord) — não existe
// ainda uma lista/serviço de moderação de conteúdo dedicado; expandir
// isso é trabalho à parte.
function applyContentFilter(messages, level) {
  if (!level || level === 'off') return messages;
  return messages.map((m) => {
    if (!m.content) return m;
    const flag = dmAutomod.checkFlaggedWord(m.content);
    if (!flag) return m;
    if (level === 'high') {
      return { ...m, content: null, contentFiltered: true };
    }
    // 'moderate' — mantém o conteúdo, só sinaliza pro cliente mostrar
    // um aviso (a decisão de exibir borrado/com clique-pra-revelar
    // fica pro frontend, quando essa parte for feita).
    return { ...m, contentFlagged: true };
  });
}

// Autor de mensagem mais leve: cada mensagem da lista (e cada reação,
// resposta e voto de enquete) levava o perfil PÚBLICO INTEIRO do autor —
// bio, banners, links de redes, ordem das seções do perfil, conquistas em
// destaque... que só o perfil/miniperfil usam (e esses buscam o perfil
// completo por conta própria em GET /users/:id). Pra desenhar a mensagem
// (avatar, decoração, nome estilizado, tag, clã, pingente) basta o resto.
const MESSAGE_AUTHOR_OMIT = new Set([
  'bio', 'pronouns', 'bannerUrl', 'miniProfileBannerUrl', 'bannerFraming', 'miniProfileBannerFraming',
  'youtubeUrl', 'steamUrl', 'robloxUrl', 'xUrl', 'accountXp', 'displayedAchievements', 'displayedAchievementsMini',
  'idCardUrl', 'idCardFraming', 'relationshipPartnerId', 'profileSectionOrder', 'profileSectionOpacity', 'levelBarColor',
  'miniProfileColor', 'miniProfileButtonColor', 'customStatusExpiresAt', 'profileEffect',
  // Status vem do mapa de presença (presence:sync/update) — e no autor da
  // mensagem ele vazava "INVISIBLE" pra todo mundo.
  'status',
]);
const MESSAGE_AUTHOR_FIELDS = Object.fromEntries(Object.entries(PUBLIC_USER_FIELDS).filter(([k]) => !MESSAGE_AUTHOR_OMIT.has(k)));

// Quem reagiu / votou: o cliente só usa id e nome (ver utils/reactions.js
// e o PollCard em Message.jsx) — antes cada reação/voto levava o perfil
// de mensagem inteiro da pessoa (decoração, fonte, clã...), multiplicado
// por todas as reações de todas as mensagens da página.
const MINI_USER_FIELDS = { id: true, username: true, displayName: true, avatarUrl: true };

const messageInclude = {
  author: { select: MESSAGE_AUTHOR_FIELDS },
  attachments: true,
  reactions: { select: { id: true, emoji: true, userId: true, createdAt: true, user: { select: MINI_USER_FIELDS } } },
  replyTo: { include: { author: { select: MESSAGE_AUTHOR_FIELDS } } },
  mentions: { select: { targetType: true, targetId: true } },
  // Vote rows are intentionally not scoped to just the current user here —
  // the client needs every vote to compute per-option totals/percentages
  // and show who voted for what (see Message.jsx's PollCard), and tallies
  // the current user's own pick client-side by matching userId against
  // their own id.
  poll: { include: { votes: { select: { userId: true, optionIndex: true, user: { select: MINI_USER_FIELDS } } } } },
};

async function assertAccess(req, { conversationId, channelId }, requireSend = false) {
  if (conversationId) {
    const member = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: req.user.id } },
    });
    if (!member) { const e = new Error('Sem acesso a esta conversa.'); e.status = 403; throw e; }

    // Item pedido: "Permissão de mensagem... verificar configurações"
    // — mesma checagem que createConversation já faz ao CRIAR a
    // conversa, repetida aqui porque enviar uma mensagem numa conversa
    // já existente é outro ponto de entrada separado (ex: a pessoa
    // muda de 'everyone' pra 'none' DEPOIS que a conversa já existia).
    // Checagem em services/dmPermissions.js — compartilhada com
    // conversationController.js, pra nunca mais os dois ficarem
    // desalinhados entre si (já aconteceu uma vez).
    if (requireSend) {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { isGroup: true, members: { select: { userId: true } } },
      });
      if (conversation && !conversation.isGroup) {
        const other = conversation.members.find((m) => m.userId !== req.user.id);
        if (other) {
          const allowed = await canSendDirectMessage(req.user.id, other.userId);
          if (!allowed) {
            const otherSettings = await prisma.userSettings.findUnique({ where: { userId: other.userId }, select: { dmPrivacy: true } });
            // BUG CORRIGIDO: mesmo desalinhamento já visto em
            // dmPermissions.js/conversationController.js — o padrão
            // de verdade no schema é 'everyone', não 'friends'.
            const dmPrivacy = otherSettings?.dmPrivacy || 'everyone';
            const e = new Error(dmPrivacy === 'none' ? 'Esta pessoa não está aceitando mensagens diretas.' : 'Vocês precisam ser amigos para trocar mensagens diretas.');
            e.status = 403;
            throw e;
          }
        }
      }
    }
    return null;
  }
  if (channelId) {
    const channel = await prisma.channel.findUnique({ where: { id: channelId } });
    if (!channel) { const e = new Error('Canal não encontrado.'); e.status = 404; throw e; }
    const perms = await getEffectivePermissions(req.user.id, channelId, channel);
    if (!has(perms, 'VIEW_CHANNEL')) { const e = new Error('Sem acesso a este canal.'); e.status = 403; throw e; }
    if (requireSend) {
      if (!has(perms, 'SEND_MESSAGES')) { const e = new Error('Você não tem permissão para enviar mensagens neste canal.'); e.status = 403; throw e; }

      const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { timeoutUntil: true } });
      if (me?.timeoutUntil && new Date(me.timeoutUntil) > new Date()) {
        const e = new Error(`Você está em silêncio temporário até ${new Date(me.timeoutUntil).toLocaleString('pt-BR')}.`);
        e.status = 403;
        throw e;
      }

      // "Modo Lento" (see schema.prisma's comment on Channel.slowModeSeconds)
      // — members with MANAGE_MESSAGES are exempt, same as Discord's own
      // slow mode (a moderator shouldn't be throttled by the same limit
      // they set for everyone else).
      if (channel.slowModeSeconds && !has(perms, 'MANAGE_MESSAGES')) {
        const lastOwn = await prisma.message.findFirst({
          where: { channelId, authorId: req.user.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        if (lastOwn) {
          const elapsedMs = Date.now() - new Date(lastOwn.createdAt).getTime();
          const waitMs = channel.slowModeSeconds * 1000 - elapsedMs;
          if (waitMs > 0) {
            const e = new Error(`Modo lento ativo — espere ${Math.ceil(waitMs / 1000)} segundo(s) para enviar outra mensagem.`);
            e.status = 429;
            throw e;
          }
        }
      }
    }
    return { channel, perms };
  }
  const e = new Error('conversationId ou channelId é obrigatório.'); e.status = 400; throw e;
}

function roomFor({ conversationId, channelId }) {
  return conversationId ? `conversation:${conversationId}` : `channel:${channelId}`;
}

const THREAD_MAX_REPLIES = 500;

async function listMessages(req, res, next) {
  try {
    const { conversationId, channelId, topLevelOnly, threadId } = req.query;
    // perf: o nível do filtro de conteúdo não depende da checagem de
    // acesso — busca em paralelo com ela (uma ida ao banco a menos em série
    // em toda abertura de canal/DM). Se o acesso falhar, o resultado é
    // só ignorado.
    const myFilterPromise = prisma.userSettings.findUnique({ where: { userId: req.user.id }, select: { contentFilterLevel: true } }).catch(() => null);
    // SEGURANÇA: com threadId, o acesso era checado só contra o
    // channelId/conversationId informado — qualquer um com acesso a UM
    // canal podia ler o tópico de um canal PRIVADO só passando o id dele
    // junto do canal público. Agora a sala vem da própria mensagem-raiz
    // e precisa bater com a que foi informada.
    let threadRoot = null;
    if (threadId) {
      threadRoot = await prisma.message.findUnique({
        where: { id: String(threadId) },
        select: { id: true, channelId: true, conversationId: true, deleted: true },
      });
      if (!threadRoot) return res.status(404).json({ error: 'Tópico não encontrado.' });
      if ((channelId && threadRoot.channelId !== channelId) || (conversationId && threadRoot.conversationId !== conversationId)) {
        return res.status(404).json({ error: 'Tópico não encontrado.' });
      }
      await assertAccess(req, { conversationId: threadRoot.conversationId, channelId: threadRoot.channelId });
    } else {
      await assertAccess(req, { conversationId, channelId });
    }
    const myFilter = await myFilterPromise;
    // BUG CORRIGIDO: o valor de reserva dizia 'off' (filtro
    // desativado), mas o padrão de verdade do schema é 'moderate'
    // (contentFilterLevel @default("moderate")) — pra quem nunca
    // abriu a tela de Configurações, o filtro ficava desligado por
    // engano em vez de vir ativado no nível padrão.
    const filterLevel = myFilter?.contentFilterLevel || 'moderate';

    if (threadRoot) {
      // Tópico inteiro: a raiz + respostas (canais de fórum). Limitado às
      // 500 respostas mais recentes — antes não tinha teto nenhum.
      const [root, replies] = await Promise.all([
        prisma.message.findUnique({ where: { id: threadRoot.id }, include: messageInclude }),
        prisma.message.findMany({
          where: { replyToId: threadRoot.id, deleted: false },
          include: messageInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: THREAD_MAX_REPLIES,
        }),
      ]);
      const messages = [root && !root.deleted ? root : null, ...replies.reverse()].filter(Boolean);
      return res.json({ messages: applyContentFilter(messages, filterLevel), truncated: replies.length >= THREAD_MAX_REPLIES });
    }

    // Cursor (createdAt, id): só a data empatava quando duas mensagens
    // tinham o mesmo milissegundo (comum em rajadas/bots) e uma delas
    // sumia na paginação. `beforeId` (opcional) desempata; sem ele,
    // continua aceitando o cursor antigo só por data.
    const before = req.query.before ? new Date(req.query.before) : undefined;
    const beforeId = typeof req.query.beforeId === 'string' ? req.query.beforeId : null;
    let cursorWhere = {};
    if (before && !Number.isNaN(before.getTime())) {
      cursorWhere = beforeId
        ? { OR: [{ createdAt: { lt: before } }, { createdAt: before, id: { lt: beforeId } }] }
        : { createdAt: { lt: before } };
    }
    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversationId || undefined,
        channelId: channelId || undefined,
        deleted: false,
        ...(topLevelOnly === 'true' ? { replyToId: null } : {}),
        ...cursorWhere,
      },
      include: messageInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    res.json({ messages: applyContentFilter(messages.reverse(), filterLevel) });
  } catch (err) { next(err); }
}

// A member without MENTION_EVERYONE typing "@everyone"/"@here" shouldn't be
// able to trigger a mass-ping just by typing the words — de-fang it instead
// of rejecting the whole message outright (Discord does the same: the text
// stays, it just doesn't render/notify as a real mention).
function stripUnauthorizedMentions(content) {
  if (!content) return content;
  return content.replace(/@(everyone|here)\b/gi, '@​$1');
}

// Armazenamento mais leve (sem mudar o que a pessoa escreveu): \r\n vira
// \n, some só o espaço/linhas em branco no FIM e no COMEÇO do texto (o
// recuo de blocos de código no meio continua), texto só com espaços vira
// null, e um teto generoso (8000) evita mensagem de dezenas de KB no banco.
const MAX_CONTENT_CHARS = 8000;
function normalizeContent(raw) {
  if (raw === undefined || raw === null) return null;
  let text = String(raw).replace(/\r\n?/g, '\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
  if (!text.trim()) return null;
  if (text.length > MAX_CONTENT_CHARS) text = text.slice(0, MAX_CONTENT_CHARS);
  return text;
}
// Colunas String sem @db.Text são VARCHAR(191) no MySQL — nome de arquivo
// ou título maior que isso dava erro 500 no envio. Corta mantendo a extensão.
function fitVarchar(value, max = 191) {
  if (value === undefined || value === null) return value;
  const str = String(value);
  if (str.length <= max) return str;
  const ext = (str.match(/\.[A-Za-z0-9]{1,8}$/) || [''])[0];
  return str.slice(0, max - ext.length) + ext;
}

// Teto simples de anexos por pessoa (memória do processo): no máximo 60
// arquivos a cada 10 minutos. Barra alguém despejando uploads em loop sem
// atrapalhar quem manda um álbum de fotos de vez em quando.
const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const UPLOAD_MAX_FILES_PER_WINDOW = 60;
const uploadCounters = new Map(); // userId -> { start, count }
function checkUploadBudget(userId, files) {
  const now = Date.now();
  let entry = uploadCounters.get(userId);
  if (!entry || now - entry.start > UPLOAD_WINDOW_MS) {
    entry = { start: now, count: 0 };
    uploadCounters.set(userId, entry);
  }
  if (entry.count + files > UPLOAD_MAX_FILES_PER_WINDOW) {
    const e = new Error('Você enviou arquivos demais em pouco tempo. Espere alguns minutos.');
    e.status = 429;
    throw e;
  }
  entry.count += files;
  if (uploadCounters.size > 5000) {
    for (const [k, v] of uploadCounters) if (now - v.start > UPLOAD_WINDOW_MS) uploadCounters.delete(k);
  }
}

function roomFromQuery(query) {
  const conversationId = typeof query.conversationId === 'string' && query.conversationId ? query.conversationId : undefined;
  const channelId = typeof query.channelId === 'string' && query.channelId ? query.channelId : undefined;
  return { conversationId, channelId };
}

// SEGURANÇA/DESEMPENHO: roda ANTES do multer em POST /messages. O cliente
// manda a sala também na query (?channelId= / ?conversationId=) — assim a
// permissão de envio, silêncio temporário, modo lento e filtro de spam são
// checados antes de qualquer byte de anexo ser recebido e enviado pro B2.
// Sem a sala na query (cliente antigo em cache), segue o fluxo antigo:
// checa depois e apaga os arquivos se recusar.
async function precheckCreateMessage(req, res, next) {
  try {
    const room = roomFromQuery(req.query);
    if (!room.conversationId && !room.channelId) return next();
    const access = await assertAccess(req, room, true);
    if (!(access?.perms && has(access.perms, 'MANAGE_MESSAGES'))) {
      await checkSpamLimits(req, room, null);
    }
    // Já estourou o teto de anexos? Recusa antes de receber mais arquivos.
    const budget = uploadCounters.get(req.user.id);
    if (budget && Date.now() - budget.start <= UPLOAD_WINDOW_MS && budget.count >= UPLOAD_MAX_FILES_PER_WINDOW
      && /multipart\/form-data/i.test(req.headers['content-type'] || '')) {
      return res.status(429).json({ error: 'Você enviou arquivos demais em pouco tempo. Espere alguns minutos.' });
    }
    req.precheckedRoom = room;
    // Reenvio (fila offline do cliente) de uma mensagem que JÁ foi criada:
    // o nonce também vem na query, então dá pra devolver a mensagem pronta
    // antes de receber os anexos de novo.
    const queryNonce = typeof req.query.nonce === 'string' ? req.query.nonce : null;
    if (queryNonce) {
      const existingId = await sharedIdempotency().lookup(req.user.id, queryNonce);
      if (existingId && await respondDuplicate(req, res, existingId, queryNonce, room)) return;
    }
    next();
  } catch (err) { next(err); }
}

// Devolve a mensagem já criada por este mesmo envio (mesmo nonce). Só se
// ela for da pessoa, da mesma sala e não tiver sido apagada — senão
// devolve false e o envio segue normal.
async function respondDuplicate(req, res, messageId, nonce, room) {
  const existing = await prisma.message.findUnique({ where: { id: String(messageId) }, include: messageInclude });
  if (!existing || existing.deleted || existing.authorId !== req.user.id) return false;
  if ((existing.channelId || null) !== (room.channelId || null) || (existing.conversationId || null) !== (room.conversationId || null)) return false;
  res.status(200).json({ message: { ...existing, nonce }, duplicate: true });
  return true;
}

async function createMessage(req, res, next) {
  let failed = true;
  // Idempotência pelo nonce (ver services/messageIdempotency.js): um
  // reenvio da mesma mensagem devolve a que já existe em vez de duplicar.
  let claim = null;
  try {
    const nonce = typeof req.body?.nonce === 'string' ? req.body.nonce : null;
    const got = await sharedIdempotency().acquire(req.user.id, nonce);
    if (got.existingId) {
      const room = { conversationId: req.body.conversationId || undefined, channelId: req.body.channelId || undefined };
      if (await respondDuplicate(req, res, got.existingId, nonce, room)) {
        if (req.files?.length) discardUploadedFiles(req).catch(() => {});
        return;
      }
    }
    claim = got.claim || null;
    req.idempotencyClaim = claim;
    failed = !(await createMessageInner(req, res));
  } catch (err) {
    claim?.release();
    if (req.files?.length) await discardUploadedFiles(req).catch(() => {});
    return next(err);
  }
  if (failed) claim?.release();
  if (failed && req.files?.length) discardUploadedFiles(req).catch(() => {});
}

// Devolve true quando a mensagem foi criada (os anexos passam a pertencer
// a ela); qualquer outra saída faz o wrapper acima apagar os arquivos que
// o multer já tinha enviado.
async function createMessageInner(req, res) {
  {
    const { conversationId, channelId } = req.body;
    const replyToId = req.body.replyToId || null;
    if (req.precheckedRoom && (
      (req.precheckedRoom.conversationId || undefined) !== (conversationId || undefined)
      || (req.precheckedRoom.channelId || undefined) !== (channelId || undefined))) {
      res.status(400).json({ error: 'Sala da mensagem não confere.' });
      return false;
    }
    const title = req.body.title ? (fitVarchar(String(req.body.title).trim()) || null) : req.body.title;
    let content = normalizeContent(req.body.content);
    const access = await assertAccess(req, { conversationId, channelId }, true);

    // Item pedido: "Filtro de spam... proteção do sistema" — checado
    // logo após confirmar que a pessoa TEM acesso pra enviar, e antes
    // de qualquer processamento mais pesado (upload, automod, etc).
    // Moderadores de canal (MANAGE_MESSAGES) ficam de fora do limite,
    // mesmo raciocínio do Modo Lento acima.
    // (Com a pré-checagem já feita antes do upload, só falta a parte de
    // "mesma mensagem repetida", que depende do texto.)
    if (!(access?.perms && has(access.perms, 'MANAGE_MESSAGES'))) {
      await checkSpamLimits(req, { conversationId, channelId }, content || null);
    }
    if (req.files?.length) checkUploadBudget(req.user.id, req.files.length);

    // A mensagem respondida precisa estar na MESMA sala — antes dava pra
    // "responder" uma mensagem de um canal privado/DM alheia e o
    // messageInclude devolvia o conteúdo dela (replyTo) pra todo mundo.
    if (replyToId) {
      const target = await prisma.message.findUnique({ where: { id: String(replyToId) }, select: { channelId: true, conversationId: true } });
      if (!target || (target.channelId || null) !== (channelId || null) || (target.conversationId || null) !== (conversationId || null)) {
        res.status(400).json({ error: 'A mensagem respondida não está nesta conversa.' });
        return false;
      }
    }

    // Embed builder (see EmbedBuilderModal.jsx) — arrives as a JSON string
    // because this whole endpoint is always multipart/form-data (it also
    // carries file attachments). Same permission as sending a normal
    // message in this channel; no separate permission bit for it, it's
    // just a fancier way to format something you could already send.
    // Length/count limits mirror Discord's own embed limits, mostly to
    // keep a single message from becoming an unbounded wall of text.
    let embed = null;
    if (req.body.embed) {
      try {
        const raw = JSON.parse(req.body.embed);
        embed = {
          title: raw.title ? String(raw.title).slice(0, 256) : undefined,
          titleUrl: /^https?:\/\//.test(raw.titleUrl || '') ? String(raw.titleUrl).slice(0, 2000) : undefined,
          description: raw.description ? String(raw.description).slice(0, 4096) : undefined,
          color: /^#[0-9a-fA-F]{6}$/.test(raw.color || '') ? raw.color : undefined,
          author: (raw.author?.name || raw.author?.iconUrl)
            ? {
                name: raw.author.name ? String(raw.author.name).slice(0, 256) : undefined,
                iconUrl: raw.author.iconUrl ? String(raw.author.iconUrl).slice(0, 2000) : undefined,
                url: /^https?:\/\//.test(raw.author.url || '') ? String(raw.author.url).slice(0, 2000) : undefined,
              }
            : undefined,
          thumbnailUrl: raw.thumbnailUrl ? String(raw.thumbnailUrl).slice(0, 2000) : undefined,
          imageUrl: raw.imageUrl ? String(raw.imageUrl).slice(0, 2000) : undefined,
          footer: raw.footer ? String(raw.footer).slice(0, 2048) : undefined,
          timestamp: raw.timestamp ? new Date().toISOString() : undefined,
          fields: Array.isArray(raw.fields)
            ? raw.fields.slice(0, 25)
              .filter((f) => f && (f.name || f.value))
              .map((f) => ({ name: String(f.name || '').slice(0, 256), value: String(f.value || '').slice(0, 1024), inline: !!f.inline }))
            : undefined,
        };
        if (!embed.title && !embed.description && !embed.fields?.length && !embed.imageUrl && !embed.thumbnailUrl && !embed.author) embed = null;
      } catch { embed = null; }
    }

    // A sent sticker (see StickerManagerModal.jsx / EmojiPicker.jsx) — kept
    // out of the embed system on purpose (see Message.stickerUrl's schema
    // comment: it renders small and chrome-free, not inside an embed card).
    // Restricted to our own hosted paths (not an arbitrary URL) since,
    // unlike a GIF, a sticker is always something this server actually
    // hosts — see stickerController.createSticker.
    //
    // BUG CORRIGIDO ("a figurinha tá dando erro" — 400 "Mensagem vazia"
    // ao mandar uma): a regex só aceitava /uploads/ (o storage antigo,
    // em disco local — ver fileStorage.js). A migração pro Backblaze B2
    // trocou o caminho pra /media/<chave> nesse meio tempo, e essa
    // validação nunca foi atualizada — toda figurinha de verdade (as
    // hospedadas no B2, que é o modo real de produção) vinha com
    // stickerUrl começando em /media/, sempre rejeitada silenciosamente
    // (virava null, e como não tem mais nada na mensagem, caía direto
    // na checagem de "mensagem vazia" logo abaixo).
    let stickerUrl = null;
    if (req.body.stickerUrl) {
      const raw = String(req.body.stickerUrl);
      if (/^\/(uploads|media)\//.test(raw)) stickerUrl = raw.slice(0, 500);
    }

    if (!content && !title && !embed && !stickerUrl && (!req.files || req.files.length === 0)) {
      res.status(400).json({ error: 'Mensagem vazia.' });
      return false;
    }

    // Multer's own limit (ver middleware/upload.js) — sem mais sistema de
    // boost, então o limite é fixo por tipo de conversa.
    if (req.files?.length) {
      const maxUploadMB = access?.channel ? 50 : 25;
      const maxBytes = maxUploadMB * 1024 * 1024;
      const tooBig = req.files.find((f) => f.size > maxBytes);
      if (tooBig) {
        // Os arquivos já foram enviados pro B2 (ou disco) nesse ponto —
        // o wrapper createMessage apaga todos ao ver o `false`.
        res.status(400).json({ error: `Arquivos têm limite de ${maxUploadMB}MB.` });
        return false;
      }
    }

    // Forum post quick-react shortcuts (see MAX_FORUM_QUICK_REACTIONS above)
    // — only meaningful on an actual forum top-level post (a titled message
    // with no replyToId, in a FORUM channel); silently ignored anywhere
    // else so a stray field on a normal message/topic reply is a no-op
    // instead of an error.
    let quickReactions = '[]';
    // Item pedido: "o ícone de olho vai marcar imagem com spoiler" —
    // array de true/false na mesma ordem dos arquivos anexados; se
    // não vier nada, ou vier algo que não dá pra entender, todo
    // arquivo entra como "não é spoiler" — nunca trava o envio.
    let spoilerFlags = [];
    if (req.body.spoilerFlags) {
      try {
        const raw = JSON.parse(req.body.spoilerFlags);
        if (Array.isArray(raw)) spoilerFlags = raw;
      } catch { /* formato inesperado — segue com nenhum marcado como spoiler */ }
    }
    const isForumPost = !!(access?.channel && access.channel.type === 'FORUM' && title && !replyToId);
    if (isForumPost && req.body.quickReactionEmojis) {
      try {
        const raw = JSON.parse(req.body.quickReactionEmojis);
        const clean = (Array.isArray(raw) ? raw : [])
          .map((e) => String(e || '').trim().slice(0, 8))
          .filter(Boolean)
          .filter((e, i, arr) => arr.indexOf(e) === i)
          .slice(0, MAX_FORUM_QUICK_REACTIONS);
        quickReactions = JSON.stringify(clean);
      } catch { quickReactions = '[]'; }
    }

    // A titled reply is a topic (see Message.jsx's "Criar tópico"), distinct
    // from a titled top-level message (a forum post, which only needs the
    // usual SEND_MESSAGES) — gated behind its own permission so a server can
    // let people chat without letting everyone spin up topics.
    if (access?.perms && title && replyToId && !has(access.perms, 'CREATE_TOPICS')) {
      res.status(403).json({ error: 'Você não tem permissão para criar tópicos neste canal.' });
      return false;
    }

    if (access?.channel && content && !has(access.perms, 'MENTION_EVERYONE')) {
      content = stripUnauthorizedMentions(content);
    }

    const io = req.app.get('io');

    if (access?.channel) {
      const trigger = await automod.checkMessage({
        channelId, userId: req.user.id, content,
      });
      if (trigger) {
        await automod.applyAction(io, { userId: req.user.id, rule: trigger.rule, reason: trigger.reason });
        res.status(400).json({ error: `Mensagem bloqueada pelo AutoMod: ${trigger.reason}`, automod: true });
        return false;
      }
    }

    // Automod de DM (distinto do automod de canal acima) — convite de
    // outra plataforma NUNCA chega a ser enviado; ver services/dmAutomod.js.
    if (conversationId && automod.phishingReason(content)) {
      const reason = automod.phishingReason(content);
      await automod.applyAction(io, { userId: req.user.id, rule: { type: 'PHISHING', action: 'DELETE', config: {} }, reason });
      res.status(400).json({ error: `Mensagem bloqueada: ${reason}`, automod: true });
      return false;
    }
    if (conversationId && dmAutomod.containsInviteLink(content)) {
      res.status(400).json({ error: 'Não é permitido enviar links de convite de outras plataformas nas mensagens diretas.' });
      return false;
    }

    // Resolve @mentions contra os membros/cargos reais da comunidade, para
    // que as MessageMention fiquem precisas (não apenas texto batendo) —
    // alimenta o indicador de "não lido com menção" na lista de canais.
    // Só os nomes que aparecem depois de "@" vão pro banco (ver
    // services/mentions.js resolveMentions) — antes carregava TODOS os
    // usuários + cargos a cada mensagem com "@".
    let mentionRows = [];
    if (access?.channel && content && content.includes('@')) {
      mentionRows = await resolveMentions(prisma, content);
    }

    const message = await prisma.message.create({
      data: {
        content: content || null,
        title: title || null,
        authorId: req.user.id,
        conversationId: conversationId || null,
        channelId: channelId || null,
        replyToId,
        embed: embed ? JSON.stringify(embed) : null,
        stickerUrl,
        quickReactions,
        attachments: {
          // Item pedido: "o ícone de olho... vai marcar imagem com
          // spoiler" — o cliente manda um array JSON na mesma ordem
          // dos arquivos anexados (spoilerFlags), já que req.files
          // preserva a ordem de anexação; sem isso (mensagem antiga,
          // ou algo dando errado no parse), todo mundo entra como
          // "não é spoiler" — nunca trava o envio por causa disso.
          create: (req.files || []).map((f, i) => ({
            url: f.url,
            filename: fitVarchar(f.originalname || 'arquivo'),
            mimeType: f.mimetype,
            size: f.size,
            isSpoiler: !!spoilerFlags[i],
          })),
        },
        mentions: mentionRows.length
          ? { create: mentionRows.map((m) => ({ targetType: m.targetType, targetId: m.targetId })) }
          : undefined,
      },
      include: messageInclude,
    });

    // `nonce` (opcional, gerado pelo cliente) volta no eco do socket e na
    // resposta — o cliente usa pra trocar a mensagem otimista pela real no
    // mesmo lugar, sem duplicar. Não é salvo no banco.
    const nonce = typeof req.body.nonce === 'string' && req.body.nonce.length <= 80 ? req.body.nonce : null;
    // Lembra (por alguns minutos) que este nonce já virou esta mensagem.
    req.idempotencyClaim?.commit(message.id);
    const outgoing = nonce ? { ...message, nonce } : message;
    // Solicitações de mensagem / spam (DM com quem não é amigo).
    const inboxOf = conversationId ? await require('../services/dmInbox').classifyIncoming(io, { conversationId, senderId: req.user.id, content }) : {};
    io?.to(roomFor({ conversationId, channelId })).emit('message:new', outgoing);
    res.status(201).json({ message: outgoing });

    // Menção/resposta em canal que a pessoa NÃO está olhando: message:new
    // só vai pra sala do canal aberto, então quem foi mencionado em outro
    // canal não ficava sabendo em tempo real. Aviso leve na sala pessoal.
    if (access?.channel) {
      notifyChannelMentions(io, { message, channel: access.channel, mentionRows }).catch((err) => {
        console.error('[mention] falha ao avisar menções:', err.message);
      });
    }

    // Item pedido: "push notification de verdade no Android, mesmo com o
    // app fechado" — manda pra quem foi diretamente @mencionado (nunca
    // pra menção de cargo/@todos — poderia virar spam pra dezenas de
    // pessoas de uma vez) ou pra quem está numa DM com o autor. Roda
    // depois do res.status já ter respondido (não atrasa o envio da
    // mensagem em si esperando o Firebase) e nunca derruba nada se o
    // Firebase não estiver configurado (ver services/pushNotifications.js
    // — vira no-op silencioso sem isso).
    (async () => {
      try {
        const { sendPushToUser } = require('../services/pushNotifications');
        const preview = (content || '').slice(0, 120) || (req.files?.length ? '📎 Anexo' : stickerUrl ? '🏷️ Figurinha' : 'Nova mensagem');
        const authorName = req.user.displayName || 'Alguém';

        const recipientIds = new Set();
        if (conversationId) {
          const otherMembers = await prisma.conversationMember.findMany({
            where: { conversationId, userId: { not: req.user.id } }, select: { userId: true },
          });
          // Quem está com a conversa em Solicitações/Spam não recebe push.
          otherMembers.forEach((m) => { if (!inboxOf[m.userId] || inboxOf[m.userId] === 'main') recipientIds.add(m.userId); });
        }
        mentionRows.filter((m) => m.targetType === 'USER').forEach((m) => recipientIds.add(m.targetId));
        recipientIds.delete(req.user.id);

        await Promise.all([...recipientIds].map((uid) => sendPushToUser(uid, {
          title: authorName, body: preview,
          data: {
            conversationId: conversationId || '', channelId: channelId || '',
            link: conversationId ? `/conversations/${conversationId}` : `/channels/${channelId}`,
            tag: conversationId ? `dm:${conversationId}` : `ch:${channelId}`,
          },
        })));

        // Item pedido: verificar se todos os toggles de Configurações têm
        // efeito real. "Notificações por e-mail" descreve especificamente
        // menções (não toda mensagem de DM) — só as pessoas @mencionadas de
        // verdade, não todo membro da conversa, senão viraria um e-mail por
        // mensagem de DM recebida.
        const mentionedUserIds = mentionRows.filter((m) => m.targetType === 'USER' && m.targetId !== req.user.id).map((m) => m.targetId);
        mentionedUserIds.forEach((uid) => maybeSendOfflineEmail(uid, { type: 'mention', actorName: authorName }));
      } catch (err) {
        console.error('[push] erro ao processar notificações da mensagem:', err.message);
      }
    })();

    // Sinalização de palavrão em DM — a mensagem já foi enviada normal
    // (quem manda e quem recebe não veem nada diferente), isso só cria um
    // registro pendente pra staff revisar depois. Nunca atrasa nem quebra
    // o envio da mensagem (roda depois da resposta já ter ido).
    if (conversationId && content) {
      const flag = dmAutomod.checkFlaggedWord(content);
      if (flag) {
        const other = await prisma.conversationMember.findFirst({
          where: { conversationId, userId: { not: req.user.id } },
          select: { userId: true },
        });
        prisma.automodFlag.create({
          data: {
            messageId: message.id, conversationId, senderId: req.user.id,
            recipientId: other?.userId || req.user.id,
            matchedWord: flag.matchedWord, snippet: flag.snippet,
          },
        }).catch(() => {});
      }
    }

    // XP só é ganho em mensagens de canal (não em DM), depois da resposta já
    // ter sido enviada — não deve atrasar nem quebrar o envio da mensagem.
    if (channelId && content) {
      xpService.awardMessageXp(req.user.id, content)
        .then((result) => {
          if (result?.levelUp) {
            io?.notifyUser?.(req.user.id, 'xp:levelup', result);
            prisma.user.findUnique({ where: { id: req.user.id }, select: PUBLIC_USER_FIELDS })
              .then((u) => {
                if (!u || !io) return;
                // "Invisível" só vai cru pra própria pessoa.
                if (u.status === 'INVISIBLE') {
                  io.to(`user:${u.id}`).emit('user:update', u);
                  io.to('community').except(`user:${u.id}`).emit('user:update', maskUserStatus(u, null));
                } else io.to('community').emit('user:update', u);
              })
              .catch(() => {});
            require('../services/achievements').checkAndUnlock(req.user.id, io); // veterano / lenda_viva
          }
        })
        .catch(() => {});
    }
    // Missões (Economia): mensagem em canal conta pras missões de mensagens.
    if (channelId) require('../services/missions').track(req.user.id, 'MESSAGES', 1, io);
    return true;
  }
}

// Teto de pessoas avisadas individualmente por mensagem (menção de cargo
// grande); @everyone/@here nunca viram aviso individual — só um "ping" do
// canal pra sala da comunidade, que cada cliente filtra pelo que vê.
const MENTION_NOTIFY_CAP = 200;
async function notifyChannelMentions(io, { message, channel, mentionRows }) {
  if (!io) return;
  const authorId = message.authorId;
  const userIds = new Set();
  const replyTargetId = message.replyTo?.authorId && message.replyTo.authorId !== authorId ? message.replyTo.authorId : null;
  mentionRows.filter((m) => m.targetType === 'USER' && m.targetId).forEach((m) => userIds.add(m.targetId));
  const roleIds = mentionRows.filter((m) => m.targetType === 'ROLE' && m.targetId).map((m) => m.targetId);
  if (roleIds.length) {
    const holders = await prisma.userRole.findMany({
      where: { roleId: { in: roleIds } }, select: { userId: true }, distinct: ['userId'], take: MENTION_NOTIFY_CAP,
    });
    holders.forEach((h) => userIds.add(h.userId));
  }
  if (replyTargetId) userIds.add(replyTargetId);
  userIds.delete(authorId);

  const base = {
    messageId: message.id,
    channelId: channel.id,
    channelName: channel.name,
    authorId,
    authorName: message.author?.displayName || 'Alguém',
    preview: (message.content || '').slice(0, 140),
    createdAt: message.createdAt,
  };

  // Canal com sobrescritas de permissão: só avisa quem pode VER o canal
  // (nunca vaza nome/prévia de canal privado). Canal comum: todo mundo vê.
  const restricted = await channelHasRestrictions(channel);
  const targets = [...userIds].slice(0, MENTION_NOTIFY_CAP);
  for (const uid of targets) {
    if (restricted) {
      // eslint-disable-next-line no-await-in-loop
      const perms = await getEffectivePermissions(uid, channel.id, channel).catch(() => null);
      if (!perms || !has(perms, 'VIEW_CHANNEL')) continue;
    }
    const isMention = mentionRows.some((m) => (m.targetType === 'USER' && m.targetId === uid)) || roleIds.length > 0;
    io.to(`user:${uid}`).emit('mention:new', { ...base, reply: uid === replyTargetId && !isMention });
  }

  if (!restricted && mentionRows.some((m) => m.targetType === 'EVERYONE' || m.targetType === 'HERE')) {
    io.to('community').emit('channel:ping', { channelId: channel.id, messageId: message.id, authorId, createdAt: message.createdAt });
  }
}

// Sets/replaces the cover image on a forum post the caller authored (see
// the `icon` field added to Message above) — a separate small endpoint
// rather than folding it into createMessage's multipart body, so the
// composer can create the post first and attach the icon right after
// without needing multer to juggle two differently-named file fields in
// one request.
async function setPostIcon(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.message.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Post não encontrado.' });
    if (existing.authorId !== req.user.id) return res.status(403).json({ error: 'Sem permissão.' });
    if (!existing.title || existing.replyToId) return res.status(400).json({ error: 'Isso não é um post de fórum.' });
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada.' });

    const message = await prisma.message.update({
      where: { id }, data: { icon: req.file.url }, include: messageInclude,
    });
    const io = req.app.get('io');
    io?.to(roomFor(existing)).emit('message:update', message);
    res.json({ message });
  } catch (err) { next(err); }
}

// Editar passa pelas MESMAS regras do envio: acesso ao canal/DM ainda
// válido, silêncio temporário, AutoMod, @everyone sem permissão vira
// texto comum e as menções são recalculadas. Antes dava pra mandar algo
// inofensivo e editar pra um texto que o AutoMod teria barrado, ou pra
// um @everyone sem ter a permissão.
const MAX_EDIT_HISTORY = 50;
async function editMessage(req, res, next) {
  try {
    const { id } = req.params;
    let content = normalizeContent(req.body?.content);
    const existing = await prisma.message.findUnique({
      where: { id },
      include: { attachments: { select: { id: true } } },
    });
    if (!existing || existing.deleted || existing.authorId !== req.user.id) return res.status(403).json({ error: 'Sem permissão.' });
    if (!content && !existing.attachments.length && !existing.embed && !existing.stickerUrl && !existing.title) {
      return res.status(400).json({ error: 'A mensagem não pode ficar vazia — apague-a em vez disso.' });
    }
    if ((content || null) === (existing.content || null)) {
      const same = await prisma.message.findUnique({ where: { id }, include: messageInclude });
      return res.json({ message: same });
    }

    const room = { conversationId: existing.conversationId, channelId: existing.channelId };
    // requireSend: canal → SEND_MESSAGES + silêncio temporário (o modo
    // lento não se aplica a edição); DM → ainda pode mandar mensagem.
    let access;
    if (room.channelId) {
      const channel = await prisma.channel.findUnique({ where: { id: room.channelId } });
      if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });
      const perms = await getEffectivePermissions(req.user.id, channel.id, channel);
      if (!has(perms, 'VIEW_CHANNEL') || !has(perms, 'SEND_MESSAGES')) {
        return res.status(403).json({ error: 'Você não pode mais editar mensagens neste canal.' });
      }
      const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { timeoutUntil: true } });
      if (me?.timeoutUntil && new Date(me.timeoutUntil) > new Date()) {
        return res.status(403).json({ error: `Você está em silêncio temporário até ${new Date(me.timeoutUntil).toLocaleString('pt-BR')}.` });
      }
      access = { channel, perms };
    } else {
      access = await assertAccess(req, room, true);
    }

    const io = req.app.get('io');
    if (access?.channel) {
      if (content && !has(access.perms, 'MENTION_EVERYONE')) content = stripUnauthorizedMentions(content);
      const trigger = await automod.checkMessage({ channelId: access.channel.id, userId: req.user.id, content });
      if (trigger) {
        await automod.applyAction(io, { userId: req.user.id, rule: trigger.rule, reason: trigger.reason });
        return res.status(400).json({ error: `Edição bloqueada pelo AutoMod: ${trigger.reason}`, automod: true });
      }
    }
    if (room.conversationId && dmAutomod.containsInviteLink(content)) {
      return res.status(400).json({ error: 'Não é permitido enviar links de convite de outras plataformas nas mensagens diretas.' });
    }

    const mentionRows = access?.channel && content && content.includes('@') ? await resolveMentions(prisma, content) : [];
    const oldMentionKeys = new Set((await prisma.messageMention.findMany({ where: { messageId: id }, select: { targetType: true, targetId: true } }))
      .map((m) => `${m.targetType}:${m.targetId}`));

    const [, , , message] = await prisma.$transaction([
      // Histórico: guarda o texto ANTERIOR (o atual vive na própria mensagem).
      prisma.messageEdit.create({ data: { messageId: id, content: existing.content } }),
      prisma.messageMention.deleteMany({ where: { messageId: id } }),
      prisma.messageMention.createMany({ data: mentionRows.map((m) => ({ messageId: id, targetType: m.targetType, targetId: m.targetId })) }),
      prisma.message.update({ where: { id }, data: { content, edited: true }, include: messageInclude }),
    ]);
    // Mantém só as últimas MAX_EDIT_HISTORY versões.
    prisma.messageEdit.findMany({ where: { messageId: id }, orderBy: { editedAt: 'desc' }, skip: MAX_EDIT_HISTORY, select: { id: true } })
      .then((old) => old.length && prisma.messageEdit.deleteMany({ where: { id: { in: old.map((o) => o.id) } } }))
      .catch(() => {});

    io?.to(roomFor(existing)).emit('message:update', message);
    res.json({ message });

    // Só quem passou a ser mencionado AGORA recebe aviso (editar não
    // repete a notificação de quem já tinha sido mencionado).
    if (access?.channel) {
      const fresh = mentionRows.filter((m) => !oldMentionKeys.has(`${m.targetType}:${m.targetId}`));
      if (fresh.length) {
        notifyChannelMentions(io, { message: { ...message, replyTo: null }, channel: access.channel, mentionRows: fresh })
          .catch((err) => console.error('[mention] falha ao avisar menções da edição:', err.message));
      }
    }
  } catch (err) { next(err); }
}

// GET /messages/:id/edits — versões anteriores de uma mensagem (a mais
// recente primeiro). Mesmo controle de acesso de ler a mensagem.
async function listEdits(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.message.findUnique({ where: { id }, select: { id: true, channelId: true, conversationId: true, deleted: true, content: true, updatedAt: true, edited: true } });
    if (!existing || existing.deleted) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    await assertAccess(req, { conversationId: existing.conversationId, channelId: existing.channelId });
    const edits = await prisma.messageEdit.findMany({
      where: { messageId: id }, orderBy: { editedAt: 'desc' }, take: MAX_EDIT_HISTORY,
      select: { id: true, content: true, editedAt: true },
    });
    res.json({ current: { content: existing.content, editedAt: existing.edited ? existing.updatedAt : null }, edits });
  } catch (err) { next(err); }
}

// POST /messages/:id/forward { channelId | conversationId } — "Encaminhar".
// Precisa poder VER a mensagem original e ENVIAR no destino. Cria uma
// mensagem nova (autor = quem encaminhou) com o texto e as referências
// dos anexos da original + metadados de onde veio (forwardedFrom).
async function forwardMessage(req, res, next) {
  try {
    const { id } = req.params;
    const target = roomFromQuery(req.body || {});
    if (!!target.channelId === !!target.conversationId) return res.status(400).json({ error: 'Escolha um canal ou uma conversa.' });
    const original = await prisma.message.findUnique({
      where: { id },
      include: { attachments: true, author: { select: { id: true, displayName: true } }, channel: { select: { id: true, name: true } } },
    });
    if (!original || original.deleted) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    await assertAccess(req, { conversationId: original.conversationId, channelId: original.channelId });
    const access = await assertAccess(req, target, true);
    if (!(access?.perms && has(access.perms, 'MANAGE_MESSAGES'))) await checkSpamLimits(req, target, null);
    if (!original.content && !original.attachments.length && !original.stickerUrl && !original.embed) {
      return res.status(400).json({ error: 'Essa mensagem não tem conteúdo para encaminhar.' });
    }

    let content = original.content || null;
    // Encaminhar nunca vira menção em massa no destino.
    if (content) content = stripUnauthorizedMentions(content);
    const io = req.app.get('io');
    if (access?.channel) {
      const trigger = await automod.checkMessage({ channelId: access.channel.id, userId: req.user.id, content });
      if (trigger) {
        await automod.applyAction(io, { userId: req.user.id, rule: trigger.rule, reason: trigger.reason });
        return res.status(400).json({ error: `Mensagem bloqueada pelo AutoMod: ${trigger.reason}`, automod: true });
      }
    }
    if (target.conversationId && dmAutomod.containsInviteLink(content)) {
      return res.status(400).json({ error: 'Não é permitido enviar links de convite de outras plataformas nas mensagens diretas.' });
    }

    const forwardedFrom = {
      messageId: original.id,
      authorId: original.authorId,
      authorName: original.author?.displayName || 'Alguém',
      channelId: original.channelId || null,
      channelName: original.channel?.name || null,
      conversationId: original.conversationId || null,
      createdAt: original.createdAt,
    };
    const message = await prisma.message.create({
      data: {
        content,
        authorId: req.user.id,
        conversationId: target.conversationId || null,
        channelId: target.channelId || null,
        embed: original.embed || null,
        stickerUrl: original.stickerUrl || null,
        forwardedFrom: JSON.stringify(forwardedFrom),
        attachments: {
          create: original.attachments.map((a) => ({
            url: a.url, filename: a.filename, mimeType: a.mimeType, size: a.size, isSpoiler: a.isSpoiler,
          })),
        },
      },
      include: messageInclude,
    });
    io?.to(roomFor(target)).emit('message:new', message);
    res.status(201).json({ message });
  } catch (err) { next(err); }
}

async function deleteMessage(req, res, next) {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const existing = await prisma.message.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Mensagem não encontrada.' });

    let moderated = false;
    if (existing.authorId !== req.user.id) {
      if (existing.channelId) {
        const channel = await prisma.channel.findUnique({ where: { id: existing.channelId } });
        const perms = channel && await getEffectivePermissions(req.user.id, channel.id, channel);
        const allowed = perms && (has(perms, 'MANAGE_MESSAGES') || (channel.type === 'FORUM' && has(perms, 'MANAGE_TOPICS')));
        if (!allowed) return res.status(403).json({ error: 'Sem permissão.' });
        moderated = true;
        if (channel) {
          const { logAction } = require('../services/audit');
          await logAction(req.app.get('io'), {
            actorId: req.user.id, action: 'MESSAGE_DELETE',
            targetType: 'MESSAGE', targetId: id, reason,
            metadata: { authorId: existing.authorId, channelId: existing.channelId },
          });
        }
      } else {
        return res.status(403).json({ error: 'Sem permissão.' });
      }
    }

    await prisma.message.update({ where: { id }, data: { deleted: true, content: null } });
    const io = req.app.get('io');
    io?.to(roomFor(existing)).emit('message:delete', { id, conversationId: existing.conversationId, channelId: existing.channelId });
    res.json({ ok: true, moderated });
  } catch (err) { next(err); }
}

// SECURITY: this used to have no access/permission check whatsoever — any
// authenticated user who knew (or guessed) a message id could pin/unpin it
// even if they weren't a member of the channel/conversation it lived in, or
// were a member without MANAGE_MESSAGES. Now mirrors what deleteMessage
// already enforces: pinning in a server channel requires MANAGE_MESSAGES;
// pinning in a DM/group requires actually being a participant.
async function togglePin(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.message.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Mensagem não encontrada.' });

    if (existing.channelId) {
      const channel = await prisma.channel.findUnique({ where: { id: existing.channelId } });
      const perms = channel && await getEffectivePermissions(req.user.id, channel.id, channel);
      if (!perms || !has(perms, 'MANAGE_MESSAGES')) return res.status(403).json({ error: 'Sem permissão.' });
    } else if (existing.conversationId) {
      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: existing.conversationId, userId: req.user.id } },
      });
      if (!member) return res.status(403).json({ error: 'Sem permissão.' });
    } else {
      return res.status(403).json({ error: 'Sem permissão.' });
    }

    const nowPinned = !existing.pinned;
    const message = await prisma.message.update({
      where: { id },
      data: { pinned: nowPinned, pinnedAt: nowPinned ? new Date() : null, pinnedById: nowPinned ? req.user.id : null },
      include: messageInclude,
    });
    const io = req.app.get('io');
    io?.to(roomFor(existing)).emit('message:update', message);
    // Evento próprio pra lista de fixadas / faixa "Destaques" se atualizar.
    // Leva a mensagem inteira junto: o cliente atualiza a lista de
    // fixadas direto pelo evento, sem buscar /messages/pinned de novo.
    io?.to(roomFor(existing)).emit('message:pin', {
      id, pinned: nowPinned, conversationId: existing.conversationId, channelId: existing.channelId, byUserId: req.user.id,
      message,
    });
    res.json({ message });
  } catch (err) { next(err); }
}

// Mensagens fixadas de um canal/conversa (mais recente primeiro).
// Mesmo controle de acesso de listMessages (VIEW_CHANNEL / participante).
async function listPinned(req, res, next) {
  try {
    const { conversationId, channelId } = req.query;
    await assertAccess(req, { conversationId, channelId });
    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversationId || undefined,
        channelId: channelId || undefined,
        pinned: true,
        deleted: false,
      },
      include: messageInclude,
      orderBy: [{ pinnedAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    res.json({ messages });
  } catch (err) { next(err); }
}

// Only a server admin/moderator (MANAGE_MESSAGES — the same permission that
// already gates deleting other people's messages) can archive a topic, not
// whoever started it — matches the user's "admin do servidor pode arquivar"
// request. Archiving just flips a flag: the topic and its replies stay
// intact and readable, but TopicThreadModal.jsx disables posting new
// replies to it once archived.
async function toggleArchiveTopic(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await prisma.message.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Tópico não encontrado.' });
    if (!existing.title || !existing.replyToId) return res.status(400).json({ error: 'Esta mensagem não é um tópico.' });
    if (!existing.channelId) return res.status(400).json({ error: 'Tópicos de conversas diretas não podem ser arquivados.' });

    const channel = await prisma.channel.findUnique({ where: { id: existing.channelId } });
    const perms = channel && await getEffectivePermissions(req.user.id, channel.id, channel);
    if (!perms || !has(perms, 'MANAGE_MESSAGES')) return res.status(403).json({ error: 'Sem permissão.' });

    const message = await prisma.message.update({
      where: { id }, data: { archived: !existing.archived }, include: messageInclude,
    });
    const io = req.app.get('io');
    io?.to(roomFor(existing)).emit('message:update', message);
    res.json({ message });
  } catch (err) { next(err); }
}

// SECURITY: this used to skip assertAccess entirely — any authenticated
// user could react to any message on the platform, including ones in
// private channels or DMs they weren't part of, and ADD_REACTIONS (a real
// permission bit that role/channel overwrites can revoke) was never
// actually checked anywhere. Both are enforced now, the same way
// createMessage already enforces SEND_MESSAGES.
async function react(req, res, next) {
  try {
    const { id } = req.params;
    const { emoji } = req.body || {};
    if (!isValidReactionEmoji(emoji)) return res.status(400).json({ error: 'Emoji inválido.' });
    const existing = await prisma.message.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Mensagem não encontrada.' });

    const access = await assertAccess(req, { conversationId: existing.conversationId, channelId: existing.channelId });
    if (access?.perms && !has(access.perms, 'ADD_REACTIONS')) {
      return res.status(403).json({ error: 'Você não tem permissão para reagir neste canal.' });
    }

    const already = await prisma.reaction.findUnique({
      where: { messageId_userId_emoji: { messageId: id, userId: req.user.id, emoji } },
    }).catch(() => null);

    if (already) {
      // deleteMany: dois cliques seguidos não estouram P2025 (já apagada).
      await prisma.reaction.deleteMany({ where: { id: already.id } });
    } else {
      // Only a brand-new emoji on this message counts against the cap —
      // someone adding themselves to an emoji that's already there doesn't
      // grow the distinct count, so that's still always allowed.
      const distinctEmojis = await prisma.reaction.findMany({
        where: { messageId: id }, distinct: ['emoji'], select: { emoji: true },
      });
      const isNewEmoji = !distinctEmojis.some((r) => r.emoji === emoji);
      // Forum posts get a much tighter cap than a regular message — 5
      // reactions total is plenty for "pick your favorite few", whereas a
      // busy channel message reasonably wants the full 20.
      let cap = MAX_DISTINCT_REACTIONS;
      if (existing.channelId) {
        const channel = await prisma.channel.findUnique({ where: { id: existing.channelId }, select: { type: true } });
        if (channel?.type === 'FORUM') cap = MAX_FORUM_POST_REACTIONS;
      }
      if (isNewEmoji && distinctEmojis.length >= cap) {
        return res.status(400).json({ error: `Este post já atingiu o limite de ${cap} emojis diferentes.` });
      }
      // Clique duplo / dois aparelhos: o 2º create perdia a corrida da
      // UNIQUE (P2002) e virava 500 — agora só não conta de novo.
      const created = await createIgnoreDuplicate(prisma.reaction, { data: { messageId: id, userId: req.user.id, emoji } });
      if (created) require('../services/missions').trackReaction(req.user.id, id, existing.authorId, req.app.get('io')); // missões de reação
      // "Alguém reage às minhas mensagens" (Configurações → Notificações).
      if (created && existing.authorId && existing.authorId !== req.user.id) {
        (async () => {
          const prefs = await require('./settingsController').getExtraPrefs(existing.authorId);
          const mode = prefs.notifyReactions || 'all';
          if (mode === 'none' || (mode === 'dm' && !existing.conversationId)) return;
          req.app.get('io')?.notifyUser?.(existing.authorId, 'reaction:you', {
            emoji, messageId: id, channelId: existing.channelId, conversationId: existing.conversationId,
            by: { id: req.user.id, displayName: req.user.displayName }, preview: String(existing.content || '').slice(0, 80),
          });
        })().catch(() => {});
      }
    }

    const message = await prisma.message.findUnique({ where: { id }, include: messageInclude });
    const io = req.app.get('io');
    io?.to(roomFor(existing)).emit('message:update', message);
    res.json({ message });
  } catch (err) { next(err); }
}

// "Quem reagiu" (menu do chip de reação): lista paginada de quem reagiu
// com UM emoji numa mensagem. Mesma checagem de acesso de ler a mensagem
// (canal com VIEW_CHANNEL, DM/grupo só pra membro) — sem isso dava pra
// descobrir quem participa de um canal privado só pelo id da mensagem.
// Cursor (createdAt,id) estável, do mais antigo pro mais novo (mesma
// ordem que os chips/tooltip mostram).
const REACTORS_PAGE = 50;
const REACTORS_PAGE_MAX = 100;
function parseReactorsCursor(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const sep = raw.indexOf('|');
  if (sep <= 0) return null;
  const at = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || !id || id.length > 64) return null;
  return { at, id };
}

async function listReactors(req, res, next) {
  try {
    const { id } = req.params;
    const emoji = req.params.emoji;
    if (!isValidReactionEmoji(emoji)) return res.status(400).json({ error: 'Emoji inválido.' });
    const existing = await prisma.message.findUnique({
      where: { id: String(id) },
      select: { id: true, conversationId: true, channelId: true, deleted: true },
    });
    if (!existing || existing.deleted) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    await assertAccess(req, { conversationId: existing.conversationId, channelId: existing.channelId });

    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, REACTORS_PAGE_MAX) : REACTORS_PAGE;
    const cursor = parseReactorsCursor(req.query.cursor);
    const where = { messageId: existing.id, emoji };
    const pageWhere = cursor
      ? { ...where, OR: [{ createdAt: { gt: cursor.at } }, { createdAt: cursor.at, id: { gt: cursor.id } }] }
      : where;
    const [count, rows] = await Promise.all([
      prisma.reaction.count({ where }),
      prisma.reaction.findMany({
        where: pageWhere,
        select: { id: true, createdAt: true, user: { select: MINI_USER_FIELDS } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      }),
    ]);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    res.json({
      emoji,
      count,
      users: page.filter((r) => r.user).map((r) => ({ ...r.user, reactedAt: r.createdAt })),
      nextCursor: hasMore && last ? `${new Date(last.createdAt).toISOString()}|${last.id}` : null,
    });
  } catch (err) { next(err); }
}

// Filtros da busca (estilo Discord), misturados ao texto livre:
//   from:@nome  from:nome   has:file|image|link|video   before:AAAA-MM-DD   after:AAAA-MM-DD
// O resto vira o texto procurado (LIKE). Paginação por cursor
// (createdAt,id) de 25 em 25.
const SEARCH_PAGE = 25;
const { parseSearchQuery, resolveChannelFilter } = require('../services/searchQuery');

async function searchMessages(req, res, next) {
  try {
    const { q } = req.query;
    let { conversationId, channelId } = req.query;
    const parsed = parseSearchQuery(q);
    const hasFilters = parsed.from || parsed.has.size || parsed.before || parsed.after || parsed.in || parsed.pinned != null;
    if (!hasFilters && parsed.text.length < 2) return res.json({ messages: [], nextCursor: null });

    // Canais de texto que a pessoa pode ver (mesma regra da barra lateral)
    // — calculado só quando precisa (busca global ou filtro in:/em:).
    let visibleChannelsCache = null;
    const visibleChannels = async () => {
      if (visibleChannelsCache) return visibleChannelsCache;
      const channels = await prisma.channel.findMany({ where: { type: { notIn: ['VOICE', 'STAGE'] } }, select: { id: true, name: true, categoryId: true, isPrivate: true } });
      const privates = channels.filter((c) => c.isPrivate);
      const permMap = privates.length ? await getEffectivePermissionsForChannels(req.user.id, privates) : new Map();
      visibleChannelsCache = channels.filter((c) => !c.isPrivate || has(permMap.get(c.id) || 0n, 'VIEW_CHANNEL'));
      return visibleChannelsCache;
    };

    // in:#canal / em:#canal — procura num canal pelo nome (vale dentro da
    // busca global ou pra "pular" de canal a partir de outro). SEGURANÇA:
    // só entre os canais que a pessoa pode ver — antes buscava em todos
    // e um canal privado com o nome certo devolvia 403 (vazava que ele
    // existe). Agora um canal invisível simplesmente "não existe" aqui.
    if (parsed.in) {
      const targetId = resolveChannelFilter(parsed.in, await visibleChannels());
      if (!targetId) return res.json({ messages: [], nextCursor: null, inChannel: null });
      channelId = targetId; conversationId = undefined;
    }

    // Escopo: uma sala (checa acesso) OU busca GLOBAL — todos os canais que a
    // pessoa pode ver + as conversas dela. Nunca vaza canal privado: a lista
    // vem das permissões efetivas (mesma regra da barra lateral).
    let scope;
    if (conversationId || channelId) {
      await assertAccess(req, { conversationId, channelId });
      scope = { conversationId: conversationId || undefined, channelId: channelId || undefined };
    } else {
      const [visibleList, memberships] = await Promise.all([
        visibleChannels(),
        prisma.conversationMember.findMany({ where: { userId: req.user.id }, select: { conversationId: true } }),
      ]);
      const visible = visibleList.map((c) => c.id);
      const convs = memberships.map((m) => m.conversationId);
      if (!visible.length && !convs.length) return res.json({ messages: [], nextCursor: null });
      scope = { OR: [...(visible.length ? [{ channelId: { in: visible } }] : []), ...(convs.length ? [{ conversationId: { in: convs } }] : [])] };
    }

    const and = [];
    if (parsed.pinned != null) and.push({ pinned: parsed.pinned });
    if (parsed.text) and.push({ content: { contains: parsed.text } });
    if (parsed.before) and.push({ createdAt: { lt: parsed.before } });
    if (parsed.after) and.push({ createdAt: { gt: new Date(parsed.after.getTime() + 24 * 3600 * 1000 - 1) } });
    if (parsed.from) {
      const authors = await prisma.user.findMany({
        where: { OR: [{ username: parsed.from }, { displayName: parsed.from }] }, select: { id: true }, take: 10,
      });
      if (!authors.length) return res.json({ messages: [], nextCursor: null });
      and.push({ authorId: { in: authors.map((a) => a.id) } });
    }
    if (parsed.has.has('file')) and.push({ attachments: { some: {} } });
    if (parsed.has.has('image')) and.push({ attachments: { some: { mimeType: { startsWith: 'image/' } } } });
    if (parsed.has.has('video')) and.push({ attachments: { some: { mimeType: { startsWith: 'video/' } } } });
    if (parsed.has.has('link')) and.push({ OR: [{ content: { contains: 'http://' } }, { content: { contains: 'https://' } }] });

    // Cursor "createdAtISO|id" da página anterior.
    const [cAt, cId] = typeof req.query.cursor === 'string' ? req.query.cursor.split('|') : [];
    const cursorDate = cAt ? new Date(cAt) : null;
    if (cursorDate && !Number.isNaN(cursorDate.getTime()) && cId) {
      and.push({ OR: [{ createdAt: { lt: cursorDate } }, { createdAt: cursorDate, id: { lt: cId } }] });
    }

    const myFilter = await prisma.userSettings.findUnique({ where: { userId: req.user.id }, select: { contentFilterLevel: true } });
    const rows = await prisma.message.findMany({
      where: {
        ...scope,
        deleted: false,
        AND: and,
      },
      // Na busca global o resultado mostra "em #canal".
      include: { ...messageInclude, channel: { select: { id: true, name: true, type: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: SEARCH_PAGE + 1,
    });
    const hasMore = rows.length > SEARCH_PAGE;
    const messages = hasMore ? rows.slice(0, SEARCH_PAGE) : rows;
    const last = messages[messages.length - 1];
    res.json({
      messages: applyContentFilter(messages, myFilter?.contentFilterLevel || 'moderate'),
      nextCursor: hasMore && last ? `${new Date(last.createdAt).toISOString()}|${last.id}` : null,
    });
  } catch (err) { next(err); }
}

module.exports = {
  listMessages, listPinned, createMessage, precheckCreateMessage, setPostIcon, editMessage, listEdits, forwardMessage,
  deleteMessage, togglePin, react, listReactors, searchMessages, toggleArchiveTopic,
  messageInclude, assertAccess, roomFor, parseSearchQuery, createMessageInner,
};
