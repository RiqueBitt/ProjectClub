const prisma = require('../config/prisma');
const { assertAccess } = require('./messageController');

// Denúncia rápida (igual ao Discord): a pessoa escolhe UMA categoria num
// botão e, se quiser, escreve detalhes. A lista é fechada — o servidor só
// aceita estas chaves (o rótulo é o que a staff lê no painel).
const REPORT_CATEGORIES = {
  spam: 'Spam',
  harassment: 'Assédio ou ódio',
  nsfw: 'Conteúdo impróprio/NSFW',
  scam: 'Golpe ou phishing',
  impersonation: 'Se passando por alguém',
  other: 'Outro',
};
const REPORT_DETAILS_MAX = 500;

// Rótulos antigos (formulário de perfil de antes) → categoria nova, pra
// clientes desatualizados (app desktop/Android) continuarem funcionando.
const LEGACY_LABELS = {
  'spam': 'spam',
  'assédio ou bullying': 'harassment',
  'conteúdo impróprio no perfil': 'nsfw',
  'perfil falso / se passando por outra pessoa': 'impersonation',
  'outro': 'other',
};

// Valida o corpo da denúncia. Formato novo: { category, details? }.
// Formato antigo: { reason } (texto livre; vira categoria "other", ou a
// categoria equivalente se for um dos rótulos antigos) + details opcional.
// Devolve { category, reason } (reason = texto que a staff lê) ou { error }.
function parseReportInput(body) {
  const b = body || {};
  if (b.details !== undefined && typeof b.details !== 'string') return { error: 'Detalhes inválidos.' };
  let details = typeof b.details === 'string' ? b.details.replace(/\s+/g, ' ').trim() : '';
  if (details.length > REPORT_DETAILS_MAX) return { error: `Os detalhes podem ter no máximo ${REPORT_DETAILS_MAX} caracteres.` };

  let category;
  if (b.category !== undefined) {
    if (typeof b.category !== 'string' || !Object.prototype.hasOwnProperty.call(REPORT_CATEGORIES, b.category)) {
      return { error: 'Motivo de denúncia inválido.' };
    }
    category = b.category;
  } else if (typeof b.reason === 'string' && b.reason.trim()) {
    const legacy = b.reason.trim();
    category = LEGACY_LABELS[legacy.toLowerCase()];
    if (!category) {
      category = 'other';
      details = [legacy.slice(0, REPORT_DETAILS_MAX), details].filter(Boolean).join(' — ').slice(0, REPORT_DETAILS_MAX);
    }
  } else {
    return { error: 'Escolha o motivo da denúncia.' };
  }
  if (category === 'other' && !details) return { error: 'Conte o que aconteceu para a equipe entender a denúncia.' };
  const label = REPORT_CATEGORIES[category];
  return { category, reason: details ? `${label}: ${details}` : label };
}

// Item pedido: "Formulário e aprovação manual" — denúncia MANUAL de uma
// mensagem, feita por qualquer usuário que já tenha acesso de ver ela
// (canal público que participa, ou DM da qual faz parte). Diferente de
// AutomodFlag (detecção automática de palavra em DM, ver
// services/dmAutomod.js) — aqui é sempre uma pessoa decidindo denunciar,
// em qualquer tipo de conversa (canal público OU DM).
async function createReport(req, res, next) {
  try {
    const { messageId } = req.body || {};
    if (!messageId || typeof messageId !== 'string') return res.status(400).json({ error: 'messageId é obrigatório.' });
    const parsed = parseReportInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, content: true, authorId: true, conversationId: true, channelId: true, deleted: true },
    });
    if (!message || message.deleted) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    if (message.authorId === req.user.id) return res.status(400).json({ error: 'Você não pode denunciar sua própria mensagem.' });

    // Reusa a mesma checagem de acesso do envio de mensagens — só pode
    // denunciar quem já tem acesso de VER a mensagem (é membro da DM, ou
    // tem VIEW_CHANNEL no canal). Sem requireSend: ver já basta pra
    // denunciar, não precisa também poder enviar ali.
    await assertAccess(req, { conversationId: message.conversationId, channelId: message.channelId });

    // Evita duplicata óbvia: mesma pessoa denunciando a mesma mensagem de
    // novo enquanto a denúncia anterior ainda está pendente.
    const existing = await prisma.report.findFirst({
      where: { messageId, reporterId: req.user.id, status: 'PENDING' },
    });
    if (existing) return res.json({ report: { id: existing.id, status: existing.status }, alreadyReported: true });

    const content = message.content || '';
    const snippet = content.length > 300 ? `${content.slice(0, 300)}…` : content;

    const report = await prisma.report.create({
      data: {
        messageId,
        reporterId: req.user.id,
        reportedUserId: message.authorId,
        conversationId: message.conversationId || null,
        channelId: message.channelId || null,
        category: parsed.category,
        reason: parsed.reason,
        snippet: snippet || '(mensagem sem texto — só anexo/figurinha)',
      },
    });
    res.json({ report: { id: report.id, status: report.status } });
  } catch (err) { next(err); }
}

// POST /users/:id/report — denúncia do PERFIL/usuário em si (não de uma
// mensagem), feita pelo botão "Denunciar" do modal de perfil. Report.kind
// = 'PROFILE', sem messageId; o snippet guarda um retrato do perfil no
// momento da denúncia (nome, @, bio) pra staff ver o que foi denunciado
// mesmo se a pessoa editar o perfil depois.
async function createProfileReport(req, res, next) {
  try {
    const { id } = req.params;
    const parsed = parseReportInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    if (id === req.user.id) return res.status(400).json({ error: 'Você não pode denunciar seu próprio perfil.' });
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, displayName: true, bio: true, pronouns: true },
    });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const existing = await prisma.report.findFirst({
      where: { kind: 'PROFILE', reportedUserId: id, reporterId: req.user.id, status: 'PENDING' },
    });
    if (existing) return res.json({ report: { id: existing.id, status: existing.status }, alreadyReported: true });

    const bio = target.bio || '';
    const snippet = [
      `Perfil: ${target.displayName} (@${target.username})`,
      target.pronouns ? `Pronomes: ${target.pronouns}` : null,
      bio ? `Bio: ${bio.length > 300 ? `${bio.slice(0, 300)}…` : bio}` : null,
    ].filter(Boolean).join('\n');

    const report = await prisma.report.create({
      data: {
        kind: 'PROFILE',
        reporterId: req.user.id,
        reportedUserId: id,
        category: parsed.category,
        reason: parsed.reason,
        snippet,
      },
    });
    res.json({ report: { id: report.id, status: report.status } });
  } catch (err) { next(err); }
}

module.exports = { createReport, createProfileReport, parseReportInput, REPORT_CATEGORIES };
