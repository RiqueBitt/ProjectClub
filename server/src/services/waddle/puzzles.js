'use strict';
// Jigsaw Jam (modelo do CP Journey): quebra-cabeças montados com artes da
// comunidade do Project Club. Qualquer pinguim manda uma imagem; a staff
// aprova; resolver dá moedas (uma vez por quebra-cabeça e modo) e resolver
// TODOS os aprovados dá o prêmio de conclusão (pin/item original do jogo).
// A montagem acontece no cliente (client/src/praca/Jigsaw.jsx); o servidor
// confere o tempo mínimo e os limites, não a posição das peças.
const prisma = require('../../config/prisma');
const events = require('./events');

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ids = (arr) => (Array.isArray(arr) ? arr.map(Number).filter((n) => Number.isInteger(n) && n > 0) : []);
const MODES = { facil: { size: 3, minSeconds: 8 }, dificil: { size: 5, minSeconds: 25 } };
const SETTING_KEY = 'jigsaw';
const DEFAULTS = { coinsFacil: 25, coinsDificil: 60, completionItems: [], completionCoins: 500, completionLabel: 'Pin do Jigsaw Jam', autoApproveStaff: true, maxPending: 3 };

async function settings() {
  const row = await prisma.plazaSetting.findUnique({ where: { key: SETTING_KEY } }).catch(() => null);
  let v = {};
  try { v = row ? JSON.parse(row.value) : {}; } catch { v = {}; }
  return { ...DEFAULTS, ...v, completionItems: ids(v.completionItems) };
}

async function saveSettings(body) {
  const v = {
    coinsFacil: Math.max(0, Math.min(10000, num(body.coinsFacil))), coinsDificil: Math.max(0, Math.min(10000, num(body.coinsDificil))),
    completionItems: ids(body.completionItems), completionCoins: Math.max(0, Math.min(100000, num(body.completionCoins))), completionLabel: String(body.completionLabel || DEFAULTS.completionLabel).slice(0, 80),
    autoApproveStaff: body.autoApproveStaff !== false, maxPending: Math.max(1, Math.min(20, num(body.maxPending) || 3)),
  };
  await prisma.plazaSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value: JSON.stringify(v) }, update: { value: JSON.stringify(v) } });
  return { ...DEFAULTS, ...v };
}

async function playerState(userId) {
  const [cfg, puzzles, solves, done] = await Promise.all([
    settings(),
    prisma.plazaPuzzle.findMany({ where: { approved: true, active: true }, orderBy: { createdAt: 'asc' }, take: 100 }),
    prisma.plazaPuzzleSolve.findMany({ where: { userId } }),
    prisma.plazaPuzzleCompletion.findUnique({ where: { userId } }).catch(() => null),
  ]);
  const mine = await prisma.plazaPuzzle.findMany({ where: { authorId: userId }, orderBy: { createdAt: 'desc' }, take: 10 });
  const solvedSet = new Set(solves.map((s) => `${s.puzzleId}:${s.mode}`));
  const list = puzzles.map((p) => ({ id: p.id, title: p.title, imageUrl: p.imageUrl, solves: p.solves, facil: solvedSet.has(`${p.id}:facil`), dificil: solvedSet.has(`${p.id}:dificil`) }));
  const allDone = list.length > 0 && list.every((p) => p.facil || p.dificil);
  return {
    puzzles: list, modes: Object.fromEntries(Object.entries(MODES).map(([k, m]) => [k, { size: m.size, coins: k === 'facil' ? cfg.coinsFacil : cfg.coinsDificil }])),
    completion: { label: cfg.completionLabel, items: cfg.completionItems, coins: cfg.completionCoins, allDone, claimed: !!done, total: list.length, solved: list.filter((p) => p.facil || p.dificil).length },
    mine: mine.map((p) => ({ id: p.id, title: p.title, imageUrl: p.imageUrl, approved: p.approved, active: p.active, solves: p.solves })),
    maxPending: cfg.maxPending,
  };
}

async function submit(userId, { imageUrl, title }, { isStaff = false } = {}) {
  if (!imageUrl) throw new Error('Mande uma imagem.');
  const cfg = await settings();
  const pending = await prisma.plazaPuzzle.count({ where: { authorId: userId, approved: false, active: true } });
  if (pending >= cfg.maxPending) throw new Error(`Você já tem ${pending} arte(s) esperando aprovação. Aguarde a equipe.`);
  const row = await prisma.plazaPuzzle.create({ data: { title: String(title || 'Arte da comunidade').slice(0, 80), imageUrl: String(imageUrl).slice(0, 500), authorId: userId, approved: isStaff && cfg.autoApproveStaff } });
  return { id: row.id, approved: row.approved };
}

async function solve(userId, puzzleId, { mode, seconds }) {
  const m = MODES[mode];
  if (!m) throw new Error('Modo inválido.');
  const p = await prisma.plazaPuzzle.findUnique({ where: { id: String(puzzleId) } });
  if (!p || !p.approved || !p.active) throw new Error('Quebra-cabeça não encontrado.');
  const secs = Math.max(0, Math.floor(num(seconds)));
  if (secs < m.minSeconds) throw new Error('Rápido demais — monte o quebra-cabeça de verdade!');
  try { await prisma.plazaPuzzleSolve.create({ data: { puzzleId: p.id, userId, mode, seconds: secs } }); } catch { return { repeat: true, coins: 0 }; }
  await prisma.plazaPuzzle.update({ where: { id: p.id }, data: { solves: { increment: 1 } } }).catch(() => {});
  const cfg = await settings();
  const coins = mode === 'facil' ? cfg.coinsFacil : cfg.coinsDificil;
  const granted = await events.grant(userId, { coins });
  return { repeat: false, ...granted };
}

async function claimCompletion(userId) {
  const st = await playerState(userId);
  if (!st.completion.allDone) throw new Error('Resolva todos os quebra-cabeças primeiro.');
  if (st.completion.claimed) throw new Error('Você já pegou o prêmio.');
  try { await prisma.plazaPuzzleCompletion.create({ data: { userId } }); } catch { throw new Error('Você já pegou o prêmio.'); }
  return events.grant(userId, { coins: st.completion.coins, items: st.completion.items });
}

// ---- staff ----
async function list() {
  const rows = await prisma.plazaPuzzle.findMany({ orderBy: [{ approved: 'asc' }, { createdAt: 'desc' }], take: 200 });
  const out = [];
  for (const p of rows) {
    const author = p.authorId ? await prisma.user.findUnique({ where: { id: p.authorId }, select: { id: true, username: true, displayName: true } }).catch(() => null) : null;
    out.push({ id: p.id, title: p.title, imageUrl: p.imageUrl, approved: p.approved, active: p.active, solves: p.solves, createdAt: p.createdAt, author });
  }
  return { puzzles: out, settings: await settings() };
}
async function review(id, { approved, active, title }) {
  const data = {};
  if (typeof approved === 'boolean') data.approved = approved;
  if (typeof active === 'boolean') data.active = active;
  if (title !== undefined) data.title = String(title).slice(0, 80);
  return prisma.plazaPuzzle.update({ where: { id: String(id) }, data });
}
async function remove(id) { await prisma.plazaPuzzle.delete({ where: { id: String(id) } }); }

module.exports = { MODES, settings, saveSettings, playerState, submit, solve, claimCompletion, list, review, remove };
