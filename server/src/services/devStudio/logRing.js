'use strict';
// Logs ao vivo do servidor pro Project Club Dev: guarda as últimas linhas do
// console na memória (nada em disco nem no banco). Segredos conhecidos
// (variáveis de ambiente com cara de senha) são trocados por ***.
const MAX = 3000;
const ring = [];
let seq = 0;
let installed = false;

function secrets() {
  const out = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (!v || v.length < 8) continue;
    if (/SECRET|PASS|KEY|TOKEN|DATABASE_URL|REDIS_URL|PRIVATE/i.test(k)) out.push(v);
  }
  return out.sort((a, b) => b.length - a.length);
}
let hidden = null;

function scrub(line) {
  hidden ??= secrets();
  let s = line;
  for (const v of hidden) if (s.includes(v)) s = s.split(v).join('***');
  return s.replace(/(Bearer\s+)[A-Za-z0-9._-]{12,}/g, '$1***');
}

function push(level, args) {
  let text;
  try {
    text = args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? (a.stack || a.message) : JSON.stringify(a))).join(' ');
  } catch { text = args.map(String).join(' '); }
  seq += 1;
  ring.push({ id: seq, at: Date.now(), level, text: scrub(text).slice(0, 4000) });
  if (ring.length > MAX) ring.splice(0, ring.length - MAX);
}

function install() {
  if (installed) return;
  installed = true;
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      try { push(level === 'info' ? 'log' : level, args); } catch { /* nunca atrapalha o log */ }
      orig(...args);
    };
  }
}

/** Linhas depois de `after` (id), no máximo `limit`. */
function since(after = 0, limit = 500) {
  const out = ring.filter((l) => l.id > after);
  return { lines: out.slice(-limit), last: seq };
}

module.exports = { install, since, _push: push, _scrub: scrub };
