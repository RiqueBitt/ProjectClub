const prisma = require('../config/prisma');
const { assertAccess } = require('./messageController');

// Item pedido: "Formulário e aprovação manual" — denúncia MANUAL de uma
// mensagem, feita por qualquer usuário que já tenha acesso de ver ela
// (canal público que participa, ou DM da qual faz parte). Diferente de
// AutomodFlag (detecção automática de palavra em DM, ver
// services/dmAutomod.js) — aqui é sempre uma pessoa decidindo denunciar,
// em qualquer tipo de conversa (canal público OU DM).
async function createReport(req, res, next) {
  try {
    const { messageId, reason } = req.body;
    if (!messageId || typeof messageId !== 'string') return res.status(400).json({ error: 'messageId é obrigatório.' });
    const cleanReason = (reason || '').toString().trim().slice(0, 500);
    if (!cleanReason) return res.status(400).json({ error: 'Descreva o motivo da denúncia.' });

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
    if (existing) return res.json({ report: existing, alreadyReported: true });

    const content = message.content || '';
    const snippet = content.length > 300 ? `${content.slice(0, 300)}…` : content;

    const report = await prisma.report.create({
      data: {
        messageId,
        reporterId: req.user.id,
        reportedUserId: message.authorId,
        conversationId: message.conversationId || null,
        channelId: message.channelId || null,
        reason: cleanReason,
        snippet: snippet || '(mensagem sem texto — só anexo/figurinha)',
      },
    });
    res.json({ report });
  } catch (err) { next(err); }
}

// POST /users/:id/report — denúncia do PERFIL/usuário em si (não de uma
// mensagem), feita pelo botão "Denunciar" do modal de perfil. Report.kind
// = 'PROFILE', sem messageId; o snippet guarda um retrato do perfil no
// momento da denúncia (nome, @, bio) pra staff ver o que foi denunciado
// mesmo se a pessoa editar o perfil depois.
const PROFILE_REPORT_REASONS = ['Spam', 'Assédio ou bullying', 'Conteúdo impróprio no perfil', 'Perfil falso / se passando por outra pessoa', 'Outro'];

async function createProfileReport(req, res, next) {
  try {
    const { id } = req.params;
    const { reason, details } = req.body || {};
    if (typeof reason !== 'string' || !reason.trim()) return res.status(400).json({ error: 'Escolha o motivo da denúncia.' });
    const category = reason.trim().slice(0, 100);
    const extra = typeof details === 'string' ? details.trim().slice(0, 500) : '';
    if (category === 'Outro' && !extra) return res.status(400).json({ error: 'Descreva o motivo da denúncia.' });
    const cleanReason = extra ? `${category}: ${extra}` : category;

    if (id === req.user.id) return res.status(400).json({ error: 'Você não pode denunciar seu próprio perfil.' });
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, displayName: true, bio: true, pronouns: true },
    });
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const existing = await prisma.report.findFirst({
      where: { kind: 'PROFILE', reportedUserId: id, reporterId: req.user.id, status: 'PENDING' },
    });
    if (existing) return res.json({ report: existing, alreadyReported: true });

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
        reason: cleanReason,
        snippet,
      },
    });
    res.json({ report: { id: report.id, status: report.status } });
  } catch (err) { next(err); }
}

module.exports = { createReport, createProfileReport, PROFILE_REPORT_REASONS };
