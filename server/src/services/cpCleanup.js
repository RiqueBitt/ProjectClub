const fs = require('fs');
const path = require('path');

// O Club Penguin (Praça e Mini-Jogos) foi removido da plataforma em
// nov/2026, a pedido do dono (as emojis :cp_*: ficaram — services/cpEmotes.js).
// O código saiu do repositório, mas
// instalações antigas ainda têm no disco a mídia que o jogo baixava (SWFs,
// músicas, mapas; pode passar de 1 GB) em server/data/waddle (ou na pasta de
// WADDLE_DATA_DIR / WADDLE_MEDIA_DIR). Isto apaga essas pastas no boot, uma
// vez, sem travar a inicialização. Os pinguins salvos ficavam no banco
// (tabela WaddlePenguin) e continuam lá; as tabelas do jogo não são apagadas
// porque o `prisma db push` roda sem --accept-data-loss.

const SERVER_ROOT = path.resolve(__dirname, '../..');

function leftoverDirs(env = process.env) {
  const dirs = new Set([path.join(SERVER_ROOT, 'data', 'waddle')]);
  if (env.WADDLE_DATA_DIR) dirs.add(path.resolve(env.WADDLE_DATA_DIR));
  if (env.WADDLE_MEDIA_DIR) dirs.add(path.resolve(env.WADDLE_MEDIA_DIR));
  // Nunca apaga a raiz do servidor nem algo fora dele por engano (variável
  // apontando pra "/" ou pra pasta do app).
  return [...dirs].filter((d) => {
    const rel = path.relative(SERVER_ROOT, d);
    const inside = rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    return inside ? rel.split(path.sep).length >= 2 : /waddle|praca|penguin/i.test(path.basename(d));
  });
}

async function folderSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    // eslint-disable-next-line no-await-in-loop
    const entries = await fs.promises.readdir(cur, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      // eslint-disable-next-line no-await-in-loop
      else total += (await fs.promises.stat(p).catch(() => ({ size: 0 }))).size;
    }
  }
  return total;
}

async function removeLeftovers({ env = process.env, log = console.log } = {}) {
  const out = { removed: [], bytes: 0 };
  for (const dir of leftoverDirs(env)) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await fs.promises.stat(dir).then((s) => s.isDirectory()).catch(() => false);
    if (!exists) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const bytes = await folderSize(dir);
      // eslint-disable-next-line no-await-in-loop
      await fs.promises.rm(dir, { recursive: true, force: true });
      out.removed.push(dir);
      out.bytes += bytes;
      log(`[club-penguin] apagado ${dir} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
    } catch (err) {
      log(`[club-penguin] não deu pra apagar ${dir}: ${err.message}`);
    }
  }
  return out;
}

module.exports = { removeLeftovers, leftoverDirs };
