'use strict';
// Project Club Dev — área só pra administradores da plataforma editarem o
// código do Project Club. Salvar grava na branch de testes do admin no
// GitHub (dev/<usuário>); "Publicar" manda a atualização pros DONOS, que
// implementam (vai pra main → deploy) ou recusam. Nada disso vai pro banco:
// rascunhos ficam no navegador e a atualização é o Pull Request no GitHub.
// Donos = conta do PLATFORM_ADMIN_EMAIL + quem ela marcar nas configurações.
const express = require('express');
const prisma = require('../config/prisma');
const env = require('../config/env');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const { getConfig, setConfig } = require('../services/integrationConfig');
const gh = require('../services/devStudio/github');
const logRing = require('../services/devStudio/logRing');
const files = require('../services/devStudio/files');

const router = express.Router();
router.use(requireAuth, requirePlatformAdmin);

const USER_SELECT = { id: true, username: true, displayName: true, email: true, avatarUrl: true };

async function me(req) {
  if (!req._devUser) {
    const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: USER_SELECT });
    // conta do GitHub ligada (login com GitHub): commits saem no nome dela
    const link = await prisma.oAuthAccount.findFirst({ where: { userId: req.user.id, provider: 'github' }, select: { providerUserId: true } }).catch(() => null);
    req._devUser = { ...u, github: link ? await gh.githubUser(link.providerUserId) : null };
  }
  return req._devUser;
}

async function ownerIds() {
  const cfg = await getConfig('pcDev', {});
  const ids = new Set(Array.isArray(cfg.owners) ? cfg.owners.map(String) : []);
  const email = String(env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
  if (email) {
    const u = await prisma.user.findFirst({ where: { email }, select: { id: true } }).catch(() => null);
    if (u) ids.add(u.id);
  }
  return [...ids];
}

async function isOwner(req) {
  return (await ownerIds()).includes(req.user.id);
}

async function requireOwner(req, res, next) {
  try {
    if (!(await isOwner(req))) return res.status(403).json({ error: 'Só os donos do Project Club podem fazer isso.' });
    return next();
  } catch (err) { return next(err); }
}

/** Erros do GitHub viram mensagem pra tela (não 500). */
const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) {
    if (err instanceof gh.GitHubError || err?.status) return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message });
    return next(err);
  }
};

function notify(io, userIds, event, payload) {
  for (const id of userIds) {
    try { io?.to(`user:${id}`).emit(event, payload); } catch { /* sem socket */ }
  }
  try {
    const { sendPushToUser } = require('../services/pushNotifications');
    for (const id of userIds) sendPushToUser(id, { title: 'Project Club Dev', body: payload.text, data: { url: '/dev?tab=updates' } }).catch(() => {});
  } catch { /* sem push */ }
}

router.get('/status', wrap(async (req, res) => {
  const u = await me(req);
  const s = await gh.settings();
  res.json({
    configured: !!s.token,
    repo: s.repo,
    base: s.base,
    branch: gh.branchFor(u),
    isOwner: await isOwner(req),
    me: { id: u.id, username: u.username, displayName: u.displayName, github: u.github ? { login: u.github.login, avatar: u.github.avatar } : null },
  });
}));

router.get('/tree', wrap(async (req, res) => {
  res.json(await gh.tree(gh.branchFor(await me(req))));
}));

router.get('/file', wrap(async (req, res) => {
  res.json(await gh.readFile(req.query.path, gh.branchFor(await me(req))));
}));

// As automações do GitHub (.github/) têm acesso aos segredos do servidor:
// só os donos mexem nelas.
const PROTECTED = /^\.github\//;

router.post('/save', wrap(async (req, res) => {
  const u = await me(req);
  const touched = (Array.isArray(req.body?.files) ? req.body.files : []).map((f) => String(f?.path || ''));
  if (touched.some((p) => PROTECTED.test(p.replace(/^\/+/, ''))) && !(await isOwner(req))) {
    return res.status(403).json({ error: 'Os arquivos de .github/ (automações com os segredos do servidor) só os donos podem mudar.' });
  }
  const out = await gh.commitFiles(u, req.body?.files, req.body?.message);
  require('../services/audit').logAction(req.app.get('io'), {
    actorId: u.id, action: 'DEV_SAVE', targetType: 'GITHUB', targetId: out.branch,
    metadata: { files: (req.body?.files || []).map((f) => f.path).slice(0, 50), sha: out.sha },
  }).catch(() => {});
  res.json(out);
}));

router.get('/changes', wrap(async (req, res) => {
  res.json(await gh.changes(await me(req)));
}));

router.post('/sync', wrap(async (req, res) => {
  res.json(await gh.syncBranch(await me(req)));
}));

router.post('/reset', wrap(async (req, res) => {
  res.json(await gh.resetBranch(await me(req)));
}));

router.post('/publish', wrap(async (req, res) => {
  const u = await me(req);
  const out = await gh.publish(u, { title: req.body?.title, description: req.body?.description });
  const owners = (await ownerIds()).filter((id) => id !== u.id);
  notify(req.app.get('io'), owners, 'dev:update', {
    number: out.number,
    text: `${out.summary}${req.body?.description ? ` — ${String(req.body.description).slice(0, 140)}` : ''}`,
    author: { id: u.id, name: u.displayName || u.username },
  });
  require('../services/audit').logAction(req.app.get('io'), {
    actorId: u.id, action: 'DEV_PUBLISH', targetType: 'GITHUB', targetId: String(out.number), metadata: { title: out.title },
  }).catch(() => {});
  res.json(out);
}));

router.get('/updates', wrap(async (req, res) => {
  const owner = await isOwner(req);
  const list = await gh.listUpdates({ state: req.query.state === 'closed' ? 'closed' : 'open' });
  // admin comum vê só as dele; donos veem todas
  res.json({ isOwner: owner, updates: owner ? list : list.filter((x) => x.author?.userId === req.user.id) });
}));

router.post('/updates/:n/approve', requireOwner, wrap(async (req, res) => {
  const u = await me(req);
  const out = await gh.approve(req.params.n, u);
  if (out.meta?.userId) {
    notify(req.app.get('io'), [out.meta.userId], 'dev:result', { number: Number(req.params.n), ok: true, text: `${u.displayName || u.username} implementou sua atualização no Project Club.` });
  }
  require('../services/audit').logAction(req.app.get('io'), { actorId: u.id, action: 'DEV_APPROVE', targetType: 'GITHUB', targetId: String(req.params.n) }).catch(() => {});
  res.json(out);
}));

router.post('/updates/:n/reject', requireOwner, wrap(async (req, res) => {
  const u = await me(req);
  const reason = String(req.body?.reason || '').slice(0, 2000);
  const out = await gh.reject(req.params.n, u, reason);
  if (out.meta?.userId) {
    notify(req.app.get('io'), [out.meta.userId], 'dev:result', { number: Number(req.params.n), ok: false, text: `${u.displayName || u.username} recusou sua atualização${reason ? `: ${reason.slice(0, 140)}` : '.'}` });
  }
  require('../services/audit').logAction(req.app.get('io'), { actorId: u.id, action: 'DEV_REJECT', targetType: 'GITHUB', targetId: String(req.params.n), reason }).catch(() => {});
  res.json(out);
}));

router.get('/logs', (req, res) => {
  res.json(logRing.since(Number(req.query.after) || 0, 800));
});

router.get('/uploads', wrap(async (req, res) => {
  res.json(await files.list(req.query.prefix, req.query.token));
}));

// Configurações (só donos): chave do GitHub e quem mais é dono.
router.get('/config', requireOwner, wrap(async (req, res) => {
  const cfg = await getConfig('pcDev', {});
  const ids = await ownerIds();
  const admins = await prisma.user.findMany({ where: { platformRole: 'ADMIN' }, select: { id: true, username: true, displayName: true, avatarUrl: true }, take: 200 });
  const t = String(cfg.githubToken || process.env.PC_DEV_GITHUB_TOKEN || '');
  res.json({
    hasToken: !!t,
    tokenHint: t ? `${t.slice(0, 4)}…${t.slice(-4)}` : null,
    repo: cfg.repo || process.env.PC_DEV_REPO || 'RiqueBitt/ProjectClub',
    owners: ids,
    mainOwner: (await prisma.user.findFirst({ where: { email: String(env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase() || '__none__' }, select: { id: true } }).catch(() => null))?.id || null,
    admins,
  });
}));

router.put('/config', requireOwner, wrap(async (req, res) => {
  const cfg = await getConfig('pcDev', {});
  const next = { ...cfg };
  if (typeof req.body?.githubToken === 'string') {
    const t = req.body.githubToken.trim();
    if (t && !/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(t)) return res.status(400).json({ error: 'Isso não parece uma chave do GitHub (começa com github_pat_ ou ghp_).' });
    next.githubToken = t || undefined;
  }
  if (typeof req.body?.repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(req.body.repo.trim())) next.repo = req.body.repo.trim();
  if (Array.isArray(req.body?.owners)) next.owners = req.body.owners.map(String).slice(0, 20);
  await setConfig('pcDev', next, req.user.id);
  require('../services/audit').logAction(req.app.get('io'), {
    actorId: req.user.id, action: 'DEV_CONFIG', targetType: 'GITHUB', targetId: next.repo || 'repo',
    metadata: { tokenChanged: typeof req.body?.githubToken === 'string', owners: next.owners || [] },
  }).catch(() => {});
  res.json({ ok: true });
}));

module.exports = router;
module.exports._ownerIds = ownerIds;
