// Instalador de mods do Project Club — item pedido 12 ("instalação
// automática") e 31 ("não usar o r2modmanPlus como dependência... o
// Project Club deve possuir seu próprio sistema", inspirado nos
// conceitos dele mas implementação própria). Roda só no processo
// principal do Electron (mesma razão do steamDetector.js — o navegador
// não tem acesso a essas pastas).
//
// Regra obrigatória (item 7/12): o ARQUIVO do mod nunca passa pelos
// nossos servidores nem é gravado no banco de dados — este módulo baixa
// DIRETO da URL assinada que o mod.io gera (ver server: getModDownload,
// que só repassa essa URL, nunca o arquivo em si), pra uma pasta
// temporária local, instala, e apaga o temporário. Os únicos bytes que
// tocam o Project Club são os que já estão passando pela própria máquina
// do usuário de qualquer forma.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { app } = require('electron');
const extractZip = require('extract-zip');

function tempDir() {
  const dir = path.join(app.getPath('temp'), 'projectclub-mods');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Mesmo padrão de download com progresso + redirecionamento já usado e
// testado em projectMcManager.js (ver httpsGet lá) — reimplementado aqui
// de propósito, em vez de importado, pra este módulo não depender de
// detalhes internos de outro (cada um pode evoluir/ser removido sem
// arriscar quebrar o outro).
function downloadToFile(url, destPath, onProgress, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, { headers: { 'User-Agent': 'ProjectClub-App' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume(); file.close();
        downloadToFile(res.headers.location, destPath, onProgress, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error(`Falha ao baixar o mod (HTTP ${res.statusCode}).`));
        res.resume();
        return;
      }
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress && total) onProgress(Math.round((received / total) * 100));
      });
      res.on('error', (err) => { file.close(); reject(new Error(`Conexão interrompida durante o download: ${err.message}`)); });
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        // Confere que o arquivo baixado bate com o tamanho anunciado —
        // mesma checagem contra download truncado usada no ProjectMC.
        if (total && fs.statSync(destPath).size !== total) {
          reject(new Error('O download foi interrompido antes de terminar. Tente novamente.'));
          return;
        }
        resolve();
      });
    }).on('error', (err) => { file.close(); reject(err); });
  });
}

// Item pedido 26/27: "não criar uma regra universal que simplesmente
// copie todos os arquivos para a pasta raiz... quando determinado jogo
// precisar de um mod loader ou framework, o sistema deve identificar
// isso." MVP: detecta se o jogo já tem uma instalação do BepInEx (o
// framework de mod mais comum nos jogos-exemplo do pedido — Lethal
// Company, Risk of Rain 2, Content Warning e a maioria dos jogos Unity
// moddáveis via mod.io usam ele) e instala no padrão dele
// (BepInEx/plugins/<nome>); sem BepInEx detectado, cai numa pasta
// genérica "Mods/<nome>" na raiz do jogo. Suporte a outros loaders
// específicos fica para uma fase seguinte (ver nota no final do
// arquivo) — a função abaixo é o único lugar que precisa mudar pra
// adicionar um novo loader, o resto do fluxo de instalação não muda.
function detectInstallStrategy(gameInstallPath) {
  const bepinexPluginsDir = path.join(gameInstallPath, 'BepInEx', 'plugins');
  if (fs.existsSync(path.join(gameInstallPath, 'BepInEx'))) {
    return { kind: 'bepinex', targetRoot: bepinexPluginsDir };
  }
  return { kind: 'generic', targetRoot: path.join(gameInstallPath, 'Mods') };
}

function sanitizeModFolderName(name) {
  return String(name).trim().replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) || 'mod';
}

// Fluxo principal — item pedido 12, passos 1 a 11 (identificar jogo/
// pasta, baixar, extrair, instalar, limpar temporário). Dependências e
// conflitos (passos 5 e verificação de #16/#17) ainda não são resolvidos
// automaticamente aqui — ver roadmap no final do arquivo.
async function installMod({ downloadUrl, filename, gameInstallPath, modName }, onProgress) {
  if (!fs.existsSync(gameInstallPath)) throw new Error('A pasta do jogo não foi encontrada. Talvez ele tenha sido desinstalado ou movido.');

  const folderName = sanitizeModFolderName(modName);
  const strategy = detectInstallStrategy(gameInstallPath);
  const archivePath = path.join(tempDir(), `${folderName}-${Date.now()}${path.extname(filename || '') || '.zip'}`);

  onProgress?.({ phase: 'downloading', percent: 0 });
  try {
    await downloadToFile(downloadUrl, archivePath, (percent) => onProgress?.({ phase: 'downloading', percent }));

    onProgress?.({ phase: 'extracting', percent: 0 });
    const stagingDir = `${archivePath}.staging`;
    fs.mkdirSync(stagingDir, { recursive: true });
    await extractZip(archivePath, { dir: stagingDir });

    onProgress?.({ phase: 'installing', percent: 0 });
    fs.mkdirSync(strategy.targetRoot, { recursive: true });
    const finalDir = path.join(strategy.targetRoot, folderName);
    // Item pedido 17: "nunca apagar silenciosamente arquivos de outro
    // mod" — só remove a pasta que é DESTE mod especificamente (nome
    // sanitizado único por mod), nunca o targetRoot inteiro.
    if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(stagingDir, finalDir);

    onProgress?.({ phase: 'done', percent: 100 });
    return { installedPath: finalDir, strategy: strategy.kind };
  } finally {
    fs.rm(archivePath, { force: true }, () => {});
  }
}

// Item pedido 14: "Desinstalar" — só apaga a pasta do mod específico.
function uninstallMod({ gameInstallPath, modName }) {
  const folderName = sanitizeModFolderName(modName);
  const strategy = detectInstallStrategy(gameInstallPath);
  const finalDir = path.join(strategy.targetRoot, folderName);
  if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
  return { uninstalled: true };
}

// Lista o que já está instalado NESTE jogo, olhando o disco diretamente
// (fonte de verdade é sempre a pasta real, nunca um registro que possa
// ficar desatualizado) — usado pra marcar "✓ Instalado" na UI.
function listInstalledMods(gameInstallPath) {
  const strategy = detectInstallStrategy(gameInstallPath);
  if (!fs.existsSync(strategy.targetRoot)) return [];
  return fs.readdirSync(strategy.targetRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

module.exports = { installMod, uninstallMod, listInstalledMods, detectInstallStrategy };

// ---------- Roadmap (fora do escopo desta primeira fase) ----------
// - Ativar/desativar mod sem desinstalar (mover pra fora/dentro da pasta
//   ativa, ver "perfis" item 15) — hoje só existe instalar/desinstalar.
// - Resolver e instalar dependências automaticamente (item 16) — hoje a
//   API só lista quais são; instalar cada uma ainda é manual.
// - Detecção de conflito de arquivo entre mods (item 17).
// - Suporte a outros mod loaders além do padrão BepInEx (item 27) —
//   detectInstallStrategy é o ponto de extensão único pra isso.
// - "▶ Jogar com este perfil" iniciando o jogo de verdade (item 28).
