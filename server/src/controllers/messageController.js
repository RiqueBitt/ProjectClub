const fs = require('fs');
const prisma = require('../config/prisma');
const { PUBLIC_USER_FIELDS } = require('./authController');
const { getEffectivePermissions } = require('../services/authz');
const { has } = require('../services/permissions');
const automod = require('../services/automod');
const dmAutomod = require('../services/dmAutomod');
const { canSendDirectMessage } = require('../services/dmPermissions');
const xpService = require('../services/xp');
const { parseMentions } = require('../services/mentions');

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

const messageInclude = {
  author: { select: PUBLIC_USER_FIELDS },
  attachments: true,
  reactions: { include: { user: { select: PUBLIC_USER_FIELDS } } },
  replyTo: { include: { author: { select: PUBLIC_USER_FIELDS } } },
  mentions: { select: { targetType: true, targetId: true } },
  // Vote rows are intentionally not scoped to just the current user here —
  // the client needs every vote to compute per-option totals/percentages
  // and show who voted for what (see Message.jsx's PollCard), and tallies
  // the current user's own pick client-side by matching userId against
  // their own id.
  poll: { include: { votes: { select: { userId: true, optionIndex: true, user: { select: PUBLIC_USER_FIELDS } } } } },
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
            const dmPrivacy = otherSettings?.dmPrivacy || 'friends';
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
    const perms = await getEffectivePermissions(req.user.id, channelId);
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

async function listMessages(req, res, next) {
  try {
    const { conversationId, channelId, topLevelOnly, threadId } = req.query;
    await assertAccess(req, { conversationId, channelId });
    const myFilter = await prisma.userSettings.findUnique({ where: { userId: req.user.id }, select: { contentFilterLevel: true } });
    const filterLevel = myFilter?.contentFilterLevel || 'off';

    if (threadId) {
      // Whole thread: the root post + every reply to it (forum channels).
      const messages = await prisma.message.findMany({
        where: { OR: [{ id: threadId }, { replyToId: threadId }], deleted: false },
        include: messageInclude,
        orderBy: { createdAt: 'asc' },
      });
      return res.json({ messages: applyContentFilter(messages, filterLevel) });
    }

    const before = req.query.before ? new Date(req.query.before) : undefined;
    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversationId || undefined,
        channelId: channelId || undefined,
        deleted: false,
        ...(topLevelOnly === 'true' ? { replyToId: null } : {}),
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      include: messageInclude,
      orderBy: { createdAt: 'desc' },
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

async function createMessage(req, res, next) {
  try {
    const { conversationId, channelId, replyToId, title } = req.body;
    let { content } = req.body;
    const access = await assertAccess(req, { conversationId, channelId }, true);

    // Item pedido: "Filtro de spam... proteção do sistema" — checado
    // logo após confirmar que a pessoa TEM acesso pra enviar, e antes
    // de qualquer processamento mais pesado (upload, automod, etc).
    // Moderadores de canal (MANAGE_MESSAGES) ficam de fora do limite,
    // mesmo raciocínio do Modo Lento acima.
    if (!(access?.perms && has(access.perms, 'MANAGE_MESSAGES'))) {
      await checkSpamLimits(req, { conversationId, channelId }, content || null);
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
      return res.status(400).json({ error: 'Mensagem vazia.' });
    }

    // Multer's own limit (ver middleware/upload.js) — sem mais sistema de
    // boost, então o limite é fixo por tipo de conversa.
    if (req.files?.length) {
      const maxUploadMB = access?.channel ? 50 : 25;
      const maxBytes = maxUploadMB * 1024 * 1024;
      const tooBig = req.files.find((f) => f.size > maxBytes);
      if (tooBig) {
        // Os arquivos já foram enviados pro B2 (ou disco) nesse ponto —
        // o motor de armazenamento do multer sobe cada um assim que
        // termina de receber, antes desse controller rodar — então
        // "limpar" agora significa excluir de verdade (B2 + metadado no
        // MySQL), não só apagar um arquivo temporário local.
        for (const f of req.files) { await deleteFile(f.filename); }
        return res.status(400).json({ error: `Arquivos têm limite de ${maxUploadMB}MB.` });
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
      return res.status(403).json({ error: 'Você não tem permissão para criar tópicos neste canal.' });
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
        return res.status(400).json({ error: `Mensagem bloqueada pelo AutoMod: ${trigger.reason}`, automod: true });
      }
    }

    // Automod de DM (distinto do automod de canal acima) — convite de
    // outra plataforma NUNCA chega a ser enviado; ver services/dmAutomod.js.
    if (conversationId && dmAutomod.containsInviteLink(content)) {
      return res.status(400).json({ error: 'Não é permitido enviar links de convite de outras plataformas nas mensagens diretas.' });
    }

    // Resolve @mentions contra os membros/cargos reais da comunidade, para
    // que as MessageMention fiquem precisas (não apenas texto batendo) —
    // alimenta o indicador de "não lido com menção" na lista de canais.
    let mentionRows = [];
    if (access?.channel && content) {
      const [members, roles] = await Promise.all([
        prisma.user.findMany({ select: { id: true, displayName: true } }),
        prisma.role.findMany(),
      ]);
      const memberList = members.map((m) => ({ id: m.id, displayName: m.displayName }));
      mentionRows = parseMentions(content, { members: memberList, roles });
    }

    const message = await prisma.message.create({
      data: {
        content: content || null,
        title: title || null,
        authorId: req.user.id,
        conversationId: conversationId || null,
        channelId: channelId || null,
        replyToId: replyToId || null,
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
            filename: f.originalname,
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

    io?.to(roomFor({ conversationId, channelId })).emit('message:new', message);
    res.status(201).json({ message });

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
          otherMembers.forEach((m) => recipientIds.add(m.userId));
        }
        mentionRows.filter((m) => m.targetType === 'USER').forEach((m) => recipientIds.add(m.targetId));
        recipientIds.delete(req.user.id);

        await Promise.all([...recipientIds].map((uid) => sendPushToUser(uid, {
          title: authorName, body: preview, data: { conversationId: conversationId || '', channelId: channelId || '' },
        })));
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
              .then((u) => u && io?.to('community').emit('user:update', u))
              .catch(() => {});
            require('../services/achievements').checkAndUnlock(req.user.id, io); // veterano / lenda_viva
          }
        })
        .catch(() => {});
    }
  } catch (err) { next(err); }
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

async function editMessage(req, res, next) {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const existing = await prisma.message.findUnique({ where: { id } });
    if (!existing || existing.authorId !== req.user.id) return res.status(403).json({ error: 'Sem permissão.' });

    const message = await prisma.message.update({
      where: { id }, data: { content, edited: true }, include: messageInclude,
    });
    const io = req.app.get('io');
    io?.to(roomFor(existing)).emit('message:update', message);
    res.json({ message });
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
        const perms = channel && await getEffectivePermissions(req.user.id, channel.id);
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
      const perms = channel && await getEffectivePermissions(req.user.id, channel.id);
      if (!perms || !has(perms, 'MANAGE_MESSAGES')) return res.status(403).json({ error: 'Sem permissão.' });
    } else if (existing.conversationId) {
      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: existing.conversationId, userId: req.user.id } },
      });
      if (!member) return res.status(403).json({ error: 'Sem permissão.' });
    } else {
      return res.status(403).json({ error: 'Sem permissão.' });
    }

    const message = await prisma.message.update({
      where: { id }, data: { pinned: !existing.pinned }, include: messageInclude,
    });
    const io = req.app.get('io');
    io?.to(roomFor(existing)).emit('message:update', message);
    res.json({ message });
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
    const perms = channel && await getEffectivePermissions(req.user.id, channel.id);
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
    const { emoji } = req.body;
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
      await prisma.reaction.delete({ where: { id: already.id } });
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
      await prisma.reaction.create({ data: { messageId: id, userId: req.user.id, emoji } });
    }

    const message = await prisma.message.findUnique({ where: { id }, include: messageInclude });
    const io = req.app.get('io');
    io?.to(roomFor(existing)).emit('message:update', message);
    res.json({ message });
  } catch (err) { next(err); }
}

async function searchMessages(req, res, next) {
  try {
    const { conversationId, channelId, q } = req.query;
    await assertAccess(req, { conversationId, channelId });
    if (!q || q.trim().length < 2) return res.json({ messages: [] });

    const myFilter = await prisma.userSettings.findUnique({ where: { userId: req.user.id }, select: { contentFilterLevel: true } });

    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversationId || undefined,
        channelId: channelId || undefined,
        deleted: false,
        content: { contains: q },
      },
      include: messageInclude,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ messages: applyContentFilter(messages, myFilter?.contentFilterLevel || 'off') });
  } catch (err) { next(err); }
}

module.exports = {
  listMessages, createMessage, setPostIcon, editMessage, deleteMessage, togglePin, react, searchMessages, toggleArchiveTopic,
  messageInclude, assertAccess, roomFor,
};
