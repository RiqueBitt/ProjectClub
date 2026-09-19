const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { sendApplicationApproved, sendApplicationRejected } = require('../services/email');
const { getEveryoneRole } = require('../services/authz');
const { grantStarterHouse } = require('../services/starterHouse');
const { isPasswordStrongEnough, generatePublicId, SELF_USER_FIELDS } = require('./authController');
const { generateRefreshToken } = require('../services/tokens');

const HOW_FOUND_OPTIONS = ['Instagram', 'Facebook', 'Twitter / X', 'Whatsapp', 'Youtube', 'Discord', 'Outros'];
const INTEREST_OPTIONS = ['Vídeo Games', 'Cultura da internet', 'Assistir vídeos / conteúdo', 'Música'];
const ROLE_OPTIONS = ['Não tenho', 'Youtuber', 'Streamer', 'Designer', 'Game Developer', 'Designer Gráfico', 'Programador', 'Compositor Musical'];
const TECH_LEVEL_OPTIONS = [
  'Muito Pouco, Só fico no Instagram',
  'Mais ou menos, Uso meu telefone',
  'Normal, Uso um pouco o meu computador',
  'Intermediário, Sei mexer no computador',
  'Avançado, Uso o computador ou celular de forma extensa e sei mexer com sistemas e programas',
  'Especialista, Trabalho na área crio softwares',
];
const ALT_SOCIAL_OPTIONS = ['Nenhuma', 'Reddit', 'Bitview', 'SpaceHey', 'Fediverso', 'Newgrounds', '4Chan ou outros Chans', 'Fóruns específicos ou privados'];
const ACTIVE_MEMBER_OPTIONS = ['Sim', 'Não', 'Mais ou menos', 'Ainda não sei'];

function validateAnswers(answers) {
  if (!answers || typeof answers !== 'object') return 'Respostas do questionário ausentes.';
  const a = answers;

  if (!HOW_FOUND_OPTIONS.includes(a.howFound)) return 'Escolha por qual meio descobriu o Project Club.';
  if (a.howFound === 'Outros' && !a.howFoundOther?.trim()) return 'Escreva por qual outro meio você descobriu o Project Club.';

  if (!Array.isArray(a.interests) || a.interests.length === 0 || !a.interests.every((v) => INTEREST_OPTIONS.includes(v))) {
    return 'Escolha ao menos um interesse/hobby.';
  }
  if (!Array.isArray(a.roles) || a.roles.length === 0 || !a.roles.every((v) => ROLE_OPTIONS.includes(v))) {
    return 'Responda o que você faz (ou "Não tenho").';
  }
  if (!TECH_LEVEL_OPTIONS.includes(a.techLevel)) return 'Escolha seu nível de conhecimento sobre tecnologia.';
  if (!Array.isArray(a.altSocials) || a.altSocials.length === 0 || !a.altSocials.every((v) => ALT_SOCIAL_OPTIONS.includes(v))) {
    return 'Responda se já participou de alguma rede social alternativa (ou "Nenhuma").';
  }
  if (!ACTIVE_MEMBER_OPTIONS.includes(a.activeMember)) return 'Escolha se você seria um membro ativo.';
  if (!a.joinReason?.trim() || a.joinReason.trim().length < 20) return 'Conte um pouco mais sobre por que quer se unir à comunidade (mínimo 20 caracteres).';

  return null;
}

// Cria a conta de verdade + sessão de login, exatamente como
// approveApplication faz — reaproveitado tanto pelo fluxo normal
// (staff aprova manualmente) quanto pelo auto-aprovado abaixo (dono
// da plataforma), pra nunca duplicar a lógica de "o que significa uma
// inscrição virar conta" em dois lugares.
async function createAccountFromApplicationData({ email, username, displayName, passwordHash, birthDate }) {
  const user = await prisma.user.create({
    data: {
      email, username, displayName, passwordHash,
      publicId: generatePublicId(), emailVerified: true, birthDate,
    },
  });
  const everyoneRole = await getEveryoneRole();
  if (everyoneRole) {
    await prisma.userRole.create({ data: { userId: user.id, roleId: everyoneRole.id } }).catch(() => {});
  }
  await grantStarterHouse(user.id);
  return user;
}

// Item pedido: "registrar automático sem precisar de aprovação a
// conta com [e-mail do dono]" — em vez de um script de bypass rodado
// no navegador (isso serviria pra QUALQUER pessoa pular a fila de
// aprovação, não só o dono), reaproveita o mecanismo que já existe
// pra isso: PLATFORM_ADMIN_EMAIL (ver adminBootstrap.js — a mesma
// variável de ambiente que já promove essa conta a ADMIN sozinha no
// próximo login). Só a inscrição vinda EXATAMENTE desse e-mail, já
// configurado no servidor pelo próprio dono, pula a fila — o
// mecanismo é auditável (uma variável de ambiente, visível pra
// qualquer um com acesso ao servidor) e não abre nenhum atalho novo
// pra mais ninguém.
async function issueApplicationSession(res, user) {
  const { signAccessToken } = require('../services/tokens');
  const accessToken = signAccessToken(user);
  const { raw, hash, expiresAt } = generateRefreshToken();
  await prisma.refreshToken.create({ data: { tokenHash: hash, userId: user.id, expiresAt } });
  res.cookie('refreshToken', raw, {
    httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000, path: '/api/auth',
  });
  return accessToken;
}

async function submitApplication(req, res, next) {
  try {
    const { email, username, password, displayName, birthDate, answers } = req.body;
    if (!email || !username || !password || !birthDate) {
      return res.status(400).json({ error: 'Preencha e-mail, senha, ClubTag e data de nascimento.' });
    }
    const parsedBirthDate = new Date(birthDate);
    if (Number.isNaN(parsedBirthDate.getTime())) return res.status(400).json({ error: 'Data de nascimento inválida.' });
    if (parsedBirthDate > new Date()) return res.status(400).json({ error: 'Data de nascimento inválida.' });

    const answersError = validateAnswers(answers);
    if (answersError) return res.status(400).json({ error: answersError });

    if (password.length < 8) return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
    if (!isPasswordStrongEnough(password)) return res.status(400).json({ error: 'A senha deve conter letras e números.' });

    const normalizedEmail = email.toLowerCase();
    const existingUser = await prisma.user.findFirst({ where: { OR: [{ email: normalizedEmail }, { username }] } });
    if (existingUser) return res.status(409).json({ error: 'E-mail ou ClubTag já cadastrado.' });

    const existingApplication = await prisma.membershipApplication.findFirst({
      where: { email: normalizedEmail, status: 'PENDING' },
    });
    if (existingApplication) return res.status(409).json({ error: 'Você já tem uma inscrição pendente com este e-mail.' });

    const passwordHash = await bcrypt.hash(password, 12);

    // Auto-aprovação do dono da plataforma — ver comentário em
    // issueApplicationSession acima. Cria a conta direto, sem passar
    // pela fila de MembershipApplication nem precisar de nenhuma
    // staff pra aprovar.
    const adminEmail = (env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
    if (adminEmail && normalizedEmail === adminEmail) {
      const user = await createAccountFromApplicationData({
        email: normalizedEmail, username, displayName: displayName || username, passwordHash, birthDate: parsedBirthDate,
      });
      req.app.get('io')?.to('community').emit('community:update');
      const accessToken = await issueApplicationSession(res, user);
      const selfUser = await prisma.user.findUnique({ where: { id: user.id }, select: SELF_USER_FIELDS });
      return res.status(201).json({ autoApproved: true, user: selfUser, accessToken });
    }

    const application = await prisma.membershipApplication.create({
      data: {
        email: normalizedEmail, username, displayName: displayName || username,
        passwordHash, birthDate: parsedBirthDate,
        answers: JSON.stringify({
          howFound: answers.howFound,
          howFoundOther: answers.howFound === 'Outros' ? String(answers.howFoundOther).trim().slice(0, 200) : undefined,
          interests: answers.interests,
          roles: answers.roles,
          techLevel: answers.techLevel,
          altSocials: answers.altSocials,
          activeMember: answers.activeMember,
          joinReason: answers.joinReason.trim().slice(0, 1000),
        }),
      },
    });

    res.status(201).json({ applicationId: application.id });
  } catch (err) { next(err); }
}

async function adminListApplications(req, res, next) {
  try {
    const { status } = req.query;
    const applications = await prisma.membershipApplication.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, username: true, displayName: true, birthDate: true, answers: true,
        status: true, reviewedById: true, reviewedAt: true, createdAt: true,
      },
    });
    // Inscrições antigas (de antes do questionário de 8 perguntas) não têm
    // answers preenchido — cai num objeto vazio em vez de quebrar a tela.
    res.json({ applications: applications.map((a) => ({ ...a, answers: a.answers ? JSON.parse(a.answers) : {} })) });
  } catch (err) { next(err); }
}

async function approveApplication(req, res, next) {
  try {
    const { id } = req.params;
    const application = await prisma.membershipApplication.findUnique({ where: { id } });
    if (!application) return res.status(404).json({ error: 'Inscrição não encontrada.' });
    if (application.status !== 'PENDING') return res.status(400).json({ error: 'Esta inscrição já foi analisada.' });

    const clash = await prisma.user.findFirst({ where: { OR: [{ email: application.email }, { username: application.username }] } });
    if (clash) return res.status(409).json({ error: 'O e-mail ou nome de usuário desta inscrição já foi usado por outra conta.' });

    // BUG CORRIGIDO (junto com a auto-aprovação acima): esta criação de
    // conta duplicava exatamente a mesma lógica agora extraída em
    // createAccountFromApplicationData — reaproveitada aqui pra não ter
    // dois lugares definindo "o que é criar uma conta a partir de uma
    // inscrição" (birthDate copiado, everyoneRole, casa inicial).
    const user = await createAccountFromApplicationData({
      email: application.email, username: application.username, displayName: application.displayName,
      passwordHash: application.passwordHash, birthDate: application.birthDate,
    });
    // Conta nova já aparece na barra lateral/lista de membros de todo
    // mundo na hora, sem precisar recarregar a página — reaproveita o
    // mesmo evento que já dispara refreshCommunity() no cliente.
    req.app.get('io')?.to('community').emit('community:update');

    await prisma.membershipApplication.update({
      where: { id }, data: { status: 'APPROVED', reviewedById: req.user.id, reviewedAt: new Date() },
    });
    await logPlatformAction(req, { action: 'APPLICATION_APPROVE', targetType: 'APPLICATION', targetId: id, metadata: { email: application.email } });

    const loginUrl = `${env.CLIENT_ORIGIN}/login`;
    await sendApplicationApproved(application.email, loginUrl).catch(() => {});

    res.json({ ok: true, userId: user.id });
  } catch (err) { next(err); }
}

async function rejectApplication(req, res, next) {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const application = await prisma.membershipApplication.findUnique({ where: { id } });
    if (!application) return res.status(404).json({ error: 'Inscrição não encontrada.' });
    if (application.status !== 'PENDING') return res.status(400).json({ error: 'Esta inscrição já foi analisada.' });

    await prisma.membershipApplication.update({
      where: { id }, data: { status: 'REJECTED', reviewedById: req.user.id, reviewedAt: new Date() },
    });
    await logPlatformAction(req, { action: 'APPLICATION_REJECT', targetType: 'APPLICATION', targetId: id, reason, metadata: { email: application.email } });

    await sendApplicationRejected(application.email, reason).catch(() => {});

    res.json({ ok: true });
  } catch (err) { next(err); }
}

module.exports = { submitApplication, adminListApplications, approveApplication, rejectApplication };
