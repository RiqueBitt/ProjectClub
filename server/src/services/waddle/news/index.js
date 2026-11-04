'use strict';
// Jornal do Club Penguin em português.
//
// O jornal de 2012 é feito de SWFs com os textos como "texto estático", em
// inglês. Quando alguém abre o jornal:
//  1. cada SWF do jornal é lido (layout.js) e seus parágrafos viram chaves;
//  2. os parágrafos que já têm tradução (banco: WaddleNewsText; e as
//     traduções revisadas em pt-seed/<data>.json) entram no lugar do texto
//     original, com as fontes completas (com acentos);
//  3. os que ainda não têm vão pra fila da IA do projeto (Pingu, com
//     prioridade baixa) — a próxima abertura já vem em português.
// Abrir o config.xml de uma edição já põe a edição inteira na fila, então
// as páginas de dentro costumam chegar traduzidas.

const fs = require('fs');
const path = require('path');
const layout = require('./layout');

const NEWS_RE = /^play\/v2\/content\/local\/en\/news\/papers\/(\d{8})\/(.+)$/;
const SEED_DIR = path.join(__dirname, 'pt-seed');
const SYSTEM = [
  'Você traduz o jornal do Club Penguin (jogo de pinguins para crianças) do inglês para o português do Brasil.',
  'Responda SOMENTE com a tradução do texto, sem aspas extras, sem comentários e sem explicar nada.',
  'Linguagem simples, divertida e natural para crianças. Mantenha a pontuação, os números e os nomes de usuário (como Nivi9).',
  'Mantenha os nomes próprios dos personagens: Gary, Gariwald, Rockhopper, Rookie, Herbert, Klutzy, Cadence, Franky, Sensei, Puffle Handler, Dot, Jet Pack Guy.',
  'Use os nomes do jogo em português: Aunt Arctic = Tia Ártica; igloo = iglu; puffle = puffle; coins = moedas; members = sócios; Gift Shop = Loja de Presentes;',
  'Stage = Teatro; Town = Centro; Plaza = Praça; Ski Village = Estação de Esqui; Ski Hill = Montanha; Dock = Doca; Beach = Praia; Lighthouse = Farol;',
  'Pizza Parlor = Pizzaria; Coffee Shop = Cafeteria; Night Club = Danceteria; Pet Shop = Pet Shop; Book Room = Sala de Livros; Mine = Mina; Forest = Floresta;',
  'Cove = Enseada; Snow Forts = Fortes de Neve; Iceberg = Iceberg; Dojo = Dojo; party = festa; catalog = catálogo; pin = broche; Tour Guide = Guia Turístico;',
  'Secret Agent = Agente Secreto; Club Penguin Times = Jornal do Club Penguin; postcard = cartão-postal; stamp = selo.',
  'Meses abreviados: Jan. = jan., Feb. = fev., Mar. = mar., Apr. = abr., May = maio, Jun. = jun., Jul. = jul., Aug. = ago., Sep. = set., Oct. = out., Nov. = nov., Dec. = dez.',
].join('\n');

// ---------------------------------------------------------------- traduções

const mem = new Map(); // chave (sha1 do inglês) → português
let seedsLoaded = false;

function loadSeeds() {
  if (seedsLoaded) return;
  seedsLoaded = true;
  let files = [];
  try { files = fs.readdirSync(SEED_DIR).filter((f) => f.endsWith('.json')); } catch { return; }
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(SEED_DIR, f), 'utf-8'));
      for (const [en, pt] of Object.entries(d)) if (typeof pt === 'string' && pt.trim()) mem.set(layout.keyOf(en), pt);
    } catch (err) { console.warn(`[jornal] tradução ${f} inválida:`, err?.message || err); }
  }
}

function db() {
  try { const p = require('../../../config/prisma'); return p && p.waddleNewsText ? p : null; } catch { return null; }
}

async function getMany(keys) {
  loadSeeds();
  const out = new Map();
  const missing = [];
  for (const k of keys) { if (mem.has(k)) out.set(k, mem.get(k)); else missing.push(k); }
  const prisma = db();
  if (missing.length && prisma) {
    try {
      const rows = await prisma.waddleNewsText.findMany({ where: { key: { in: missing } }, select: { key: true, pt: true } });
      for (const r of rows) { mem.set(r.key, r.pt); out.set(r.key, r.pt); }
    } catch (err) { console.warn('[jornal] banco indisponível:', err?.message || err); }
  }
  return out;
}

async function put(seg, pt) {
  mem.set(seg.key, pt);
  const prisma = db();
  if (!prisma) return;
  try {
    await prisma.waddleNewsText.upsert({ where: { key: seg.key }, create: { key: seg.key, en: seg.text, pt }, update: { pt } });
  } catch (err) { console.warn('[jornal] não salvou tradução:', err?.message || err); }
}

// ---------------------------------------------------------------- IA

/** Textos que não precisam de IA (assinaturas, listas de nomes de usuário). */
function identity(text) {
  const t = text.trim();
  if (/^[–—-]\s*\S+$/.test(t)) return t;
  const words = t.split(/\s+/);
  if (words.length >= 4) {
    const common = /\b(the|and|of|to|is|in|you|your|for|with|on|at|our|are|this|that|it|be|a|an)\b/i;
    const namey = words.filter((w) => /\d/.test(w) || /^[A-Z][a-z0-9]*$/.test(w)).length;
    if (!common.test(t) && namey / words.length >= 0.8) return t;
  }
  if (/^[A-Z0-9]+$/.test(t) && /\d/.test(t)) return t; // MISTY2355
  return null;
}

function sanitize(raw, seg) {
  let t = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  t = t.replace(/^(tradução|traducao|translation)\s*:\s*/i, '').trim();
  const first = t.split('\n').map((l) => l.trim()).filter(Boolean);
  t = first.join(' ');
  if ((/^".*"$/.test(t) && !/^"/.test(seg.text)) || (/^“.*”$/.test(t) && !/^“/.test(seg.text))) t = t.slice(1, -1).trim();
  if (!t) return null;
  if (/[぀-ヿ㐀-鿿가-힯Ѐ-ӿ]/.test(t)) return null; // saiu outra língua
  if (t.length > seg.text.length * 3 + 40) return null;
  if (t === seg.text && seg.text.split(/\s+/).length >= 3) return null; // não traduziu
  return t;
}

const queue = [];
const queued = new Set();
const tries = new Map();
let working = false;
let pausedUntil = 0;

function enqueue(segs) {
  for (const s of segs) {
    if (queued.has(s.key) || (tries.get(s.key) || 0) >= 3) continue;
    queued.add(s.key);
    queue.push(s);
  }
  if (queue.length) setImmediate(work);
}

async function work() {
  if (working || Date.now() < pausedUntil) return;
  working = true;
  let pingu;
  try { pingu = require('../../pinguBot'); } catch { pingu = null; }
  try {
    while (queue.length) {
      const seg = queue[0];
      const known = await getMany([seg.key]);
      if (known.has(seg.key)) { queue.shift(); queued.delete(seg.key); continue; }
      const same = identity(seg.text);
      if (same !== null) { await put(seg, same); queue.shift(); queued.delete(seg.key); continue; }
      if (!pingu || !pingu.isOnline()) {
        // IA fora do ar: tenta de novo daqui a pouco
        pausedUntil = Date.now() + 5 * 60 * 1000;
        setTimeout(work, 5 * 60 * 1000 + 1000).unref?.();
        break;
      }
      let pt = null;
      try {
        const user = `${seg.upper ? 'Este texto é um TÍTULO (responda em letras maiúsculas).\n' : ''}Traduza para o português do Brasil:\n${seg.text}`;
        // eslint-disable-next-line no-await-in-loop
        const res = await pingu.askModel([{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], {
          priority: pingu.PRIORITY.BACKGROUND, numPredict: Math.min(700, 48 + Math.ceil(seg.text.length * 0.7)), temperature: 0.2, timeoutMs: 240000,
        });
        pt = sanitize(res?.text, seg);
      } catch (err) {
        if (err?.code === 'OFFLINE' || err?.code === 'BUSY') {
          pausedUntil = Date.now() + 2 * 60 * 1000;
          setTimeout(work, 2 * 60 * 1000 + 1000).unref?.();
          break;
        }
      }
      queue.shift(); queued.delete(seg.key);
      if (pt) await put(seg, pt);
      else tries.set(seg.key, (tries.get(seg.key) || 0) + 1);
    }
  } finally { working = false; }
}

// ---------------------------------------------------------------- servir

const analysisCache = new Map(); // rota+tamanho → análise
const outCache = new Map(); // rota+tamanho+traduzidos → bytes
const prefetched = new Map(); // edição → quando

function analysisOf(route, data) {
  const key = `${route}:${data.length}`;
  if (analysisCache.has(key)) return analysisCache.get(key);
  let a = null;
  try { a = layout.analyze(data); } catch (err) { console.warn('[jornal] não li', route, err?.message || err); }
  if (analysisCache.size > 400) analysisCache.clear();
  analysisCache.set(key, a);
  return a;
}

async function translatedFor(route, data) {
  const a = analysisOf(route, data);
  if (!a || !a.texts.length) return data;
  const segs = layout.segmentsOf(a);
  const tr = await getMany(segs.map((s) => s.key));
  const missing = segs.filter((s) => !tr.has(s.key));
  if (missing.length) enqueue(missing);
  if (!tr.size) return data;
  const key = `${route}:${data.length}:${tr.size}`;
  if (outCache.has(key)) return outCache.get(key);
  let out = data;
  try {
    const r = layout.translateSwf(a, tr);
    if (r.data) out = r.data;
  } catch (err) { console.warn('[jornal] não montei', route, err?.message || err); }
  if (outCache.size > 200) outCache.clear();
  outCache.set(key, out);
  return out;
}

async function prefetchIssue(w, date) {
  const last = prefetched.get(date) || 0;
  if (Date.now() - last < 30 * 60 * 1000) return;
  prefetched.set(date, Date.now());
  const fsrv = w.http.getFileServer();
  const base = `play/v2/content/local/en/news/papers/${date}/`;
  const cfg = await fsrv.resolve(`${base}config.xml`);
  const xml = Buffer.isBuffer(cfg) ? cfg.toString('utf-8') : String(cfg || '');
  const urls = [...new Set([...xml.matchAll(/url="(content\/[^"]+\.swf)"/g)].map((m) => m[1]))];
  for (const u of urls) {
    const route = base + u;
    if (!fsrv.knowsRoute(route)) continue;
    // eslint-disable-next-line no-await-in-loop
    const data = await fsrv.resolve(route).catch(() => null);
    if (!Buffer.isBuffer(data)) continue;
    const a = analysisOf(route, data);
    if (!a) continue;
    const segs = layout.segmentsOf(a);
    // eslint-disable-next-line no-await-in-loop
    const tr = await getMany(segs.map((s) => s.key));
    enqueue(segs.filter((s) => !tr.has(s.key)));
  }
}

const isNewsRoute = (route) => NEWS_RE.test(route);

/** Responde a rota do jornal (true) ou deixa pro servidor do jogo (false). */
async function handle(w, route, req, res) {
  if (process.env.WADDLE_LANG === 'en') return false;
  const m = route.match(NEWS_RE);
  if (!m) return false;
  if (!/\.swf$/i.test(m[2])) {
    if (m[2] === 'config.xml') prefetchIssue(w, m[1]).catch(() => {});
    return false;
  }
  const data = await w.http.getFileServer().resolve(route);
  if (!Buffer.isBuffer(data)) return false;
  prefetchIssue(w, m[1]).catch(() => {});
  const out = await translatedFor(route, data);
  // sem cache longo: quando a tradução fica pronta, a próxima abertura já pega
  res.set('Content-Type', 'application/x-shockwave-flash').set('Cache-Control', 'no-cache').send(out);
  return true;
}

function status() {
  return { queued: queue.length, working, pausedUntil, known: mem.size };
}

module.exports = { handle, isNewsRoute, status, _test: { identity, sanitize, translatedFor, enqueue } };
