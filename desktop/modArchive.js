// Extração de arquivos de mod. .zip usa o extract-zip (já era usado
// antes); .7z usa o 7za que vem empacotado no app (pacote 7zip-bin —
// binário próprio pra Windows e Linux, sem depender de nada instalado
// no PC). .rar NÃO é suportado: o 7za "standalone" não abre RAR e não
// existe extrator RAR confiável em JS puro — vira "formato não
// suportado" com explicação, em vez de fingir que instalou.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const extractZip = require('extract-zip');

const ARCHIVE_EXTS = ['.zip', '.7z'];
const UNSUPPORTED_ARCHIVES = ['.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz'];

function unsupportedArchiveError(ext) {
  const err = new Error(`Formato não suportado (${ext}): o Project Club ainda não sabe extrair esse tipo de arquivo. Extraia no PC e use "Adicionar mod do PC" com a pasta zipada (.zip).`);
  err.code = 'UNSUPPORTED_FORMAT';
  return err;
}

// Dentro do app empacotado o binário fica em app.asar.unpacked (não dá
// pra executar nada de dentro do .asar). No Linux o AppImage é somente
// leitura e o 7za vem sem permissão de execução — então copia uma vez
// pra uma pasta gravável e dá chmod lá.
let sevenZipPathCache = null;
function sevenZipPath(writableDir) {
  if (sevenZipPathCache && fs.existsSync(sevenZipPathCache)) return sevenZipPathCache;
  let bin;
  try {
    // eslint-disable-next-line global-require
    bin = require('7zip-bin').path7za.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  } catch { return null; }
  if (!fs.existsSync(bin)) return null;
  if (process.platform !== 'win32') {
    try {
      fs.accessSync(bin, fs.constants.X_OK);
    } catch {
      const dir = path.join(writableDir || os.tmpdir(), 'projectclub-bin');
      fs.mkdirSync(dir, { recursive: true });
      const copy = path.join(dir, '7za');
      if (!fs.existsSync(copy) || fs.statSync(copy).size !== fs.statSync(bin).size) fs.copyFileSync(bin, copy);
      fs.chmodSync(copy, 0o755);
      bin = copy;
    }
  }
  sevenZipPathCache = bin;
  return bin;
}

function run7z(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`Falha ao extrair o .7z: ${(stderr || stdout || err.message).toString().trim().split('\n').pop()}`));
      else resolve();
    });
  });
}

// Extrai `archivePath` pra `destDir` (criada se preciso). Confere depois
// que nada caiu fora de destDir ("zip slip").
async function extractArchive(archivePath, destDir, { writableDir } = {}) {
  const ext = path.extname(archivePath).toLowerCase();
  fs.mkdirSync(destDir, { recursive: true });
  if (ext === '.zip') {
    await extractZip(archivePath, { dir: path.resolve(destDir) });
    return;
  }
  if (ext === '.7z') {
    const bin = sevenZipPath(writableDir);
    if (!bin) throw unsupportedArchiveError(ext);
    // x: extrai mantendo pastas; -o<dir>: destino; -y: responde "sim"; -bd: sem barra de progresso
    await run7z(bin, ['x', archivePath, `-o${path.resolve(destDir)}`, '-y', '-bd']);
    // Remove links simbólicos que viessem dentro do pacote (o 7za já
    // troca ".." por "_" nos nomes, então nada sai da pasta).
    listAll(destDir);
    return;
  }
  throw unsupportedArchiveError(ext || '(sem extensão)');
}

function listAll(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isSymbolicLink()) { fs.rmSync(abs, { force: true }); continue; } // nunca segue link de dentro do pacote
    out.push(path.relative(base, abs));
    if (e.isDirectory()) listAll(abs, base, out);
  }
  return out;
}

function isArchive(filename) {
  return ARCHIVE_EXTS.includes(path.extname(filename || '').toLowerCase());
}
function isUnsupportedArchive(filename) {
  return UNSUPPORTED_ARCHIVES.includes(path.extname(filename || '').toLowerCase());
}

module.exports = { extractArchive, isArchive, isUnsupportedArchive, unsupportedArchiveError, sevenZipPath, ARCHIVE_EXTS, UNSUPPORTED_ARCHIVES };
