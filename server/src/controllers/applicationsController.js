const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { verifyRecaptcha } = require('../services/recaptcha');
const { sendApplicationApproved, sendApplicationRejected } = require('../services/email');
const { getEveryoneRole } = require('../services/authz');
const { grantStarterHouse } = require('../services/starterHouse');
const { isPasswordStrongEnough, generatePublicId } = require('./authController');

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

async function submitApplication(req, res, next) {
  try {
    const { email, username, password, displayName, birthDate, answers, recaptchaToken } = req.body;
    if (!email || !username || !password || !birthDate) {
      return res.status(400).json({ error: 'Preencha e-mail, senha, ClubTag e data de nascimento.' });
    }
    const parsedBirthDate = new Date(birthDate);
    if (Number.isNaN(parsedBirthDate.getTime())) return res.status(400).json({ error: 'Data de nascimento inválida.' });
    if (parsedBirthDate > new Date()) return res.status(400).json({ error: 'Data de nascimento inválida.' });

    const answersError = validateAnswers(answers);
    if (answersError) return res.status(400).json({ error: answersError });

    const captcha = await verifyRecaptcha(recaptchaToken);
    if (!captcha.ok) return res.status(400).json({ error: captcha.reason });

    if (password.length < 8) return res.status(400).json({ error: 'A senha deve ter pelo menos 8 caracteres.' });
    if (!isPasswordStrongEnough(password)) return res.status(400).json({ error: 'A senha deve conter letras e números.' });

    const existingUser = await prisma.user.findFirst({ where: { OR: [{ email: email.toLowerCase() }, { username }] } });
    if (existingUser) return res.status(409).json({ error: 'E-mail ou ClubTag já cadastrado.' });

    const existingApplication = await prisma.membershipApplication.findFirst({
      where: { email: email.toLowerCase(), status: 'PENDING' },
    });
    if (existingApplication) return res.status(409).json({ error: 'Você já tem uma inscrição pendente com este e-mail.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const application = await prisma.membershipApplication.create({
      data: {
        email: email.toLowerCase(), username, displayName: displayName || username,
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

    const user = await prisma.user.create({
      data: {
        email: application.email, username: application.username, displayName: application.displayName,
        passwordHash: application.passwordHash, publicId: generatePublicId(), emailVerified: true,
      },
    });

    const everyoneRole = await getEveryoneRole();
    if (everyoneRole) {
      await prisma.userRole.create({ data: { userId: user.id, roleId: everyoneRole.id } }).catch(() => {});
    }
    await grantStarterHouse(user.id);
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
