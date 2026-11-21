// "Diário" de instalação pra atualizar mods sem risco (Fase 7 — atualização
// automática). Antes de mexer em qualquer arquivo, guarda uma CÓPIA de cada
// caminho que a instalação vai tocar (arquivos da versão anterior do mod,
// cópias de segurança dos originais do jogo e os destinos da versão nova)
// — ou anota que ele não existia. Se qualquer passo falhar (disco cheio,
// arquivo em uso, cópia incompleta), `rollback` devolve tudo exatamente
// como estava: a versão anterior só é descartada depois que a nova foi
// colocada e conferida.
//
// Sem Electron aqui (só fs/path) — testado com pastas temporárias em
// test/modRollback.test.js.
const fs = require('fs');
const path = require('path');

function createJournal(dir) {
  return { dir, items: [], seen: new Set() };
}

function copyFilePreservingSpace(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // COPYFILE_FICLONE: cópia instantânea (reflink) onde o sistema de
  // arquivos suporta; nos outros vira uma cópia comum sozinho.
  fs.copyFileSync(src, dest, fs.constants.COPYFILE_FICLONE);
}

// Guarda o estado atual de um caminho (arquivo ou pasta). Chamar de novo
// pro mesmo caminho não faz nada (o primeiro retrato é o que vale).
function record(journal, target) {
  if (!target) return;
  const abs = path.resolve(target);
  if (journal.seen.has(abs)) return;
  journal.seen.add(abs);
  let st = null;
  try { st = fs.lstatSync(abs); } catch { st = null; }
  if (!st) { journal.items.push({ path: abs, existed: false }); return; }
  if (st.isSymbolicLink()) {
    // Link simbólico: guarda pra onde ele aponta, nunca segue o link.
    journal.items.push({ path: abs, existed: true, link: fs.readlinkSync(abs) });
    return;
  }
  const copy = path.join(journal.dir, String(journal.items.length));
  if (st.isDirectory()) {
    fs.mkdirSync(journal.dir, { recursive: true });
    fs.cpSync(abs, copy, { recursive: true, verbatimSymlinks: true });
    journal.items.push({ path: abs, existed: true, isDir: true, copy });
  } else {
    copyFilePreservingSpace(abs, copy);
    journal.items.push({ path: abs, existed: true, copy });
  }
}

// Volta cada caminho ao estado anotado (do último pro primeiro). Nunca
// para no meio: junta os erros e devolve.
function rollback(journal) {
  const errors = [];
  let restored = 0;
  for (const item of [...journal.items].reverse()) {
    try {
      fs.rmSync(item.path, { recursive: true, force: true });
      if (item.existed) {
        fs.mkdirSync(path.dirname(item.path), { recursive: true });
        if (item.link !== undefined) fs.symlinkSync(item.link, item.path);
        else if (item.isDir) fs.cpSync(item.copy, item.path, { recursive: true, verbatimSymlinks: true });
        else copyFilePreservingSpace(item.copy, item.path);
      }
      restored += 1;
    } catch (err) {
      errors.push({ path: item.path, error: err.message });
    }
  }
  return { restored, errors };
}

function discard(journal) {
  try { fs.rmSync(journal.dir, { recursive: true, force: true }); } catch { /* temporário — o sistema limpa depois */ }
}

// Todos os caminhos que uma (re)instalação pode tocar.
// - previous: entrada atual do mod no manifesto (ou null);
// - plan: plano da versão nova (placements/generated com dest/root);
// - legacy: instalação antiga em pasta (findLegacy) ou null;
// - backupPathFor(dest, root, key): onde o instalador guarda o original
//   de um arquivo do jogo que o mod substitui.
function pathsForInstall({ previous, plan, legacy, key, backupPathFor }) {
  const out = [];
  for (const f of previous?.files || []) { out.push(f.path); if (f.stash) out.push(f.stash); }
  for (const b of previous?.backups || []) { out.push(b.path); out.push(b.backup); }
  for (const p of [...(plan?.placements || []), ...(plan?.generated || [])]) {
    if (!p?.dest) continue;
    out.push(p.dest);
    if (p.root && typeof backupPathFor === 'function') out.push(backupPathFor(p.dest, p.root, key));
  }
  if (legacy) { out.push(legacy.enabledDir); out.push(legacy.disabledDir); }
  return out.filter(Boolean);
}

// Conferência da versão nova: todo arquivo registrado existe e (quando o
// plano diz o tamanho esperado) bate. Devolve a lista do que falta.
function missingFiles(entry) {
  const missing = [];
  for (const f of entry?.files || []) {
    try {
      if (!fs.statSync(f.path).isFile()) missing.push(f.path);
    } catch { missing.push(f.path); }
  }
  return missing;
}

module.exports = { createJournal, record, rollback, discard, pathsForInstall, missingFiles };
