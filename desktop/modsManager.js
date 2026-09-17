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

// Item pedido 15: perfis (ativar/desativar sem desinstalar) — em vez de
// apagar/rebaixar o mod loader pra "descobrir" o que está ativo, mantém
// os mods DESATIVADOS numa pasta irmã, com sufixo ".disabled", do mesmo
// jeito que ferramentas como o r2modmanPlus fazem (mas implementação
// própria, sem usar ou incorporar ele — item pedido 31): o loader do
// jogo (BepInEx ou a pasta genérica) só enxerga o que está na pasta
// ativa; o que está desativado continua no disco, intacto, só invisível
// pro jogo até ser reativado.
function disabledRoot(strategy) {
  return `${strategy.targetRoot}.disabled`;
}

function modPaths(gameInstallPath, modName) {
  const folderName = sanitizeModFolderName(modName);
  const strategy = detectInstallStrategy(gameInstallPath);
  return {
    folderName,
    strategy,
    enabledDir: path.join(strategy.targetRoot, folderName),
    disabledDir: path.join(disabledRoot(strategy), folderName),
  };
}

// Fluxo principal — item pedido 12, passos 1 a 11 (identificar jogo/
// pasta, baixar, extrair, instalar, limpar temporário). Dependências e
// conflitos (passos 5 e verificação de #16/#17) ainda não são resolvidos
// automaticamente aqui — ver roadmap no final do arquivo.
// Item pedido: "faça o GameBanana e o Workshop... já baixa o mod na
// pasta do jogo com o que precisa pra funcionar" — os mods do
// GameBanana nem sempre vêm num .zip (às vezes é só um arquivo solto,
// tipo um .pak ou .dll) — o mesmo instalador que já servia o mod.io
// agora aceita os dois casos: extrai se for .zip, só copia se não for.
async function installMod({ downloadUrl, filename, gameInstallPath, modName }, onProgress) {
  if (!fs.existsSync(gameInstallPath)) throw new Error('A pasta do jogo não foi encontrada. Talvez ele tenha sido desinstalado ou movido.');

  const folderName = sanitizeModFolderName(modName);
  const strategy = detectInstallStrategy(gameInstallPath);
  const ext = path.extname(filename || '').toLowerCase();
  const archivePath = path.join(tempDir(), `${folderName}-${Date.now()}${ext || '.zip'}`);

  onProgress?.({ phase: 'downloading', percent: 0 });
  try {
    await downloadToFile(downloadUrl, archivePath, (percent) => onProgress?.({ phase: 'downloading', percent }));

    if (ext !== '.zip') {
      // Arquivo solto (não .zip): dá pra instalar direto — se for algo
      // que a gente não sabe abrir (.rar/.7z, por exemplo), avisa em
      // vez de fingir que instalou.
      if (['.rar', '.7z'].includes(ext)) {
        throw new Error(`Este mod veio num formato (${ext}) que ainda não sabemos extrair automaticamente — baixe e extraia manualmente.`);
      }
      onProgress?.({ phase: 'installing', percent: 0 });
      fs.mkdirSync(strategy.targetRoot, { recursive: true });
      const finalDir = path.join(strategy.targetRoot, folderName);
      if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
      const oldDisabledDir = path.join(disabledRoot(strategy), folderName);
      if (fs.existsSync(oldDisabledDir)) fs.rmSync(oldDisabledDir, { recursive: true, force: true });
      fs.mkdirSync(finalDir, { recursive: true });
      fs.copyFileSync(archivePath, path.join(finalDir, filename || `${folderName}${ext}`));
      onProgress?.({ phase: 'done', percent: 100 });
      return { installedPath: finalDir, strategy: strategy.kind };
    }

    onProgress?.({ phase: 'extracting', percent: 0 });
    const stagingDir = `${archivePath}.staging`;
    fs.mkdirSync(stagingDir, { recursive: true });
    await extractZip(archivePath, { dir: stagingDir });

    onProgress?.({ phase: 'installing', percent: 0 });
    fs.mkdirSync(strategy.targetRoot, { recursive: true });
    const finalDir = path.join(strategy.targetRoot, folderName);
    // Item pedido 17: "nunca apagar silenciosamente arquivos de outro
    // mod" — só remove a pasta que é DESTE mod especificamente (nome
    // sanitizado único por mod), nunca o targetRoot inteiro. Também
    // limpa uma cópia desativada antiga do MESMO mod, se existir — uma
    // instalação nova sempre volta ativada, sem deixar duas cópias
    // divergentes (uma ativa nova, uma desativada velha) do mesmo mod.
    if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
    const oldDisabledDir = path.join(disabledRoot(strategy), folderName);
    if (fs.existsSync(oldDisabledDir)) fs.rmSync(oldDisabledDir, { recursive: true, force: true });
    fs.renameSync(stagingDir, finalDir);

    onProgress?.({ phase: 'done', percent: 100 });
    return { installedPath: finalDir, strategy: strategy.kind };
  } finally {
    fs.rm(archivePath, { force: true }, () => {});
  }
}

// Item pedido 14: "Desinstalar" — apaga a pasta do mod específico, esteja
// ela ativada ou desativada no momento.
function uninstallMod({ gameInstallPath, modName }) {
  const { enabledDir, disabledDir } = modPaths(gameInstallPath, modName);
  if (fs.existsSync(enabledDir)) fs.rmSync(enabledDir, { recursive: true, force: true });
  if (fs.existsSync(disabledDir)) fs.rmSync(disabledDir, { recursive: true, force: true });
  return { uninstalled: true };
}

// Lista o que já está instalado NESTE jogo, olhando o disco diretamente
// (fonte de verdade é sempre a pasta real, nunca um registro que possa
// ficar desatualizado) — usado pra marcar "✓ Instalado" na UI. Separado
// em ativados/desativados (item pedido 15).
function listInstalledMods(gameInstallPath) {
  const strategy = detectInstallStrategy(gameInstallPath);
  const readNames = (dir) => (fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : []);
  return {
    enabled: readNames(strategy.targetRoot),
    disabled: readNames(disabledRoot(strategy)),
  };
}

// Item pedido 15: "Ativar"/"Desativar" — move a pasta do mod inteira
// entre a área ativa e a área desativada. Nunca apaga nada (item pedido
// 17: "nunca apagar silenciosamente arquivos de outro mod") — só troca
// de lugar a pasta do PRÓPRIO mod que foi pedido.
function setModEnabled({ gameInstallPath, modName, enabled }) {
  const { enabledDir, disabledDir, strategy } = modPaths(gameInstallPath, modName);
  if (enabled) {
    if (!fs.existsSync(disabledDir)) return { changed: false }; // já ativado (ou nunca instalado)
    fs.mkdirSync(strategy.targetRoot, { recursive: true });
    fs.renameSync(disabledDir, enabledDir);
  } else {
    if (!fs.existsSync(enabledDir)) return { changed: false }; // já desativado (ou nunca instalado)
    fs.mkdirSync(disabledRoot(strategy), { recursive: true });
    fs.renameSync(enabledDir, disabledDir);
  }
  return { changed: true };
}

// Item pedido 15/28: aplica um PERFIL inteiro de uma vez — recebe a
// lista de nomes de mod que devem ficar ativos; tudo que está instalado
// mas NÃO está nessa lista é desativado, e tudo que está nessa lista (e
// já foi instalado alguma vez) é ativado. Mods da lista que nunca foram
// instalados são reportados em `missing` (a UI decide se oferece
// instalar — ver roadmap: instalação automática de dependências ainda
// não dispara isso sozinha).
function applyProfileMods({ gameInstallPath, enabledModNames }) {
  const wanted = new Set(enabledModNames.map(sanitizeModFolderName));
  const current = listInstalledMods(gameInstallPath);
  const changed = [];

  for (const name of current.enabled) {
    if (!wanted.has(name)) { setModEnabled({ gameInstallPath, modName: name, enabled: false }); changed.push(name); }
  }
  for (const name of current.disabled) {
    if (wanted.has(name)) { setModEnabled({ gameInstallPath, modName: name, enabled: true }); changed.push(name); }
  }

  const installedNames = new Set([...current.enabled, ...current.disabled]);
  const missing = [...wanted].filter((name) => !installedNames.has(name));
  return { changed, missing };
}

// ---------- Thunderstore (item pedido: "pegue a interface e tudo do
// Gale [Thunderstore Mod Manager] e funda com o que eu já tenho") ----------
// Pacotes do Thunderstore seguem uma convenção PÚBLICA fixa (documentada
// pelo próprio Thunderstore, nada específico do Gale): o .zip carrega
// manifest.json/icon.png/README.md/CHANGELOG.md na raiz, junto com o
// conteúdo de verdade do mod — às vezes tudo solto na raiz, às vezes
// dentro de UMA pasta com o nome do pacote. E o pacote "BepInExPack" de
// cada jogo é especial: seu conteúdo não é um plugin, é o PRÓPRIO
// instalador do framework BepInEx — precisa ser extraído direto na
// RAIZ da pasta do jogo (onde fica o .exe), não dentro de
// BepInEx/plugins como um mod comum (ver isLoader abaixo).
const THUNDERSTORE_METADATA_FILES = new Set(['manifest.json', 'icon.png', 'readme.md', 'changelog.md']);

// Desembrulha um nível de pasta quando o pacote coloca tudo dentro de
// UMA pasta só (em vez de solto na raiz do zip) — sem isso, o conteúdo
// real ficaria uma pasta mais fundo do que devia.
function unwrapSingleThunderstoreFolder(stagingDir) {
  const entries = fs.readdirSync(stagingDir, { withFileTypes: true });
  const nonMetaFiles = entries.filter((e) => e.isFile() && !THUNDERSTORE_METADATA_FILES.has(e.name.toLowerCase()));
  const dirs = entries.filter((e) => e.isDirectory());
  if (nonMetaFiles.length === 0 && dirs.length === 1) {
    return path.join(stagingDir, dirs[0].name);
  }
  return stagingDir;
}

// Copia recursivamente MESCLANDO com o que já existir no destino (nunca
// apaga nada que já estava lá) — usado só pra instalar o BepInExPack na
// raiz do jogo, onde já existem outros arquivos do próprio jogo que não
// podem ser tocados (item pedido 17: nunca apagar silenciosamente
// arquivos de outro mod/do próprio jogo).
function copyMergeDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyMergeDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Item pedido: instalação "de um clique" tipo Gale — chamado uma vez
// por pacote da árvore de dependência (já resolvida pelo backend, ver
// thunderstoreService.js), na ordem certa, pelo ModsPage.jsx. Não
// resolve dependência nenhuma aqui — só instala UM pacote, sabendo
// se ele é o framework (isLoader) ou um mod comum.
async function installThunderstorePackage({ downloadUrl, filename, gameInstallPath, fullName, isLoader }, onProgress) {
  if (!fs.existsSync(gameInstallPath)) throw new Error('A pasta do jogo não foi encontrada. Talvez ele tenha sido desinstalado ou movido.');

  const folderName = sanitizeModFolderName(fullName);
  const archivePath = path.join(tempDir(), `${folderName}-${Date.now()}.zip`);

  onProgress?.({ phase: 'downloading', percent: 0 });
  try {
    await downloadToFile(downloadUrl, archivePath, (percent) => onProgress?.({ phase: 'downloading', percent }));

    onProgress?.({ phase: 'extracting', percent: 0 });
    const stagingRoot = `${archivePath}.staging`;
    fs.mkdirSync(stagingRoot, { recursive: true });
    await extractZip(archivePath, { dir: stagingRoot });
    const contentDir = unwrapSingleThunderstoreFolder(stagingRoot);

    onProgress?.({ phase: 'installing', percent: 0 });

    if (isLoader) {
      // BepInExPack: mescla direto na raiz do jogo.
      copyMergeDir(contentDir, gameInstallPath);
      fs.rmSync(stagingRoot, { recursive: true, force: true });
      onProgress?.({ phase: 'done', percent: 100 });
      return { installedPath: gameInstallPath, strategy: 'bepinex-loader' };
    }

    // Mod comum: agora que o loader (instalado antes dele, na mesma
    // sequência que o ModsPage.jsx já garante) faz detectInstallStrategy
    // enxergar BepInEx, este mod cai na mesma pasta BepInEx/plugins que
    // QUALQUER outra fonte (mod.io/GameBanana/arquivo local) já usa —
    // reaproveitando listInstalledMods/setModEnabled/uninstallMod acima
    // sem precisar de nenhuma versão "Thunderstore" separada delas.
    const strategy = detectInstallStrategy(gameInstallPath);
    fs.mkdirSync(strategy.targetRoot, { recursive: true });
    const finalDir = path.join(strategy.targetRoot, folderName);
    if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
    const oldDisabledDir = path.join(disabledRoot(strategy), folderName);
    if (fs.existsSync(oldDisabledDir)) fs.rmSync(oldDisabledDir, { recursive: true, force: true });
    fs.renameSync(contentDir, finalDir);
    fs.rmSync(stagingRoot, { recursive: true, force: true });

    onProgress?.({ phase: 'done', percent: 100 });
    return { installedPath: finalDir, strategy: strategy.kind };
  } finally {
    fs.rm(archivePath, { force: true }, () => {});
  }
}

module.exports = {
  installMod, uninstallMod, listInstalledMods, setModEnabled, applyProfileMods, detectInstallStrategy,
  installLocalFile, listConfigFiles, readConfigFile, writeConfigFile,
  saveModpackLocally, listLocalModpacks, loadLocalModpack, deleteLocalModpack,
  installThunderstorePackage,
};

// ---------- Pasta local de Modpacks (item pedido: "criar uma pasta do
// Project Club chamada modpacks onde salva os modpacks criados... pra
// assim ficar salvos") ----------
// Fica dentro da PRÓPRIA pasta de dados do Project Club (não do jogo)
// — sobrevive mesmo se o servidor cair ou a conta mudar de dispositivo
// sem sincronizar ainda: um arquivo de texto (.json) por modpack,
// organizado por jogo, com o nome de cada mod que faz parte dele. Não
// substitui o registro no servidor (que sincroniza entre
// computadores da mesma conta) — é uma cópia local, sempre disponível
// mesmo offline.
function modpacksRootDir() {
  const dir = path.join(app.getPath('userData'), 'Modpacks');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function gameSlug(gameKey) {
  return sanitizeModFolderName(String(gameKey));
}

function modpackFilePath(gameKey, packName) {
  const dir = path.join(modpacksRootDir(), gameSlug(gameKey));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${sanitizeModFolderName(packName)}.json`);
}

function saveModpackLocally({ gameKey, gameDisplayName, packName, mods }) {
  const data = { name: packName, game: gameDisplayName, mods, updatedAt: new Date().toISOString() };
  fs.writeFileSync(modpackFilePath(gameKey, packName), JSON.stringify(data, null, 2), 'utf8');
  return { saved: true, path: modpackFilePath(gameKey, packName) };
}

function listLocalModpacks(gameKey) {
  const dir = path.join(modpacksRootDir(), gameSlug(gameKey));
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, e.name), 'utf8')); } catch { return null; }
    })
    .filter(Boolean);
}

function loadLocalModpack(gameKey, packName) {
  const filePath = modpackFilePath(gameKey, packName);
  if (!fs.existsSync(filePath)) throw new Error('Modpack não encontrado localmente.');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function deleteLocalModpack(gameKey, packName) {
  const filePath = modpackFilePath(gameKey, packName);
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  return { deleted: true };
}

// Item pedido: "adicione mods de um arquivo local" — mesmo fluxo de
// installMod, só que sem baixar nada: o arquivo já está no computador
// da pessoa (escolhido pelo diálogo nativo, ver main.js). Se for um
// .zip, extrai; qualquer outra extensão (.dll solto, por exemplo) só
// copia direto pra dentro da própria pasta do mod.
async function installLocalFile({ filePath, gameInstallPath, modName }, onProgress) {
  if (!fs.existsSync(gameInstallPath)) throw new Error('A pasta do jogo não foi encontrada.');
  if (!fs.existsSync(filePath)) throw new Error('O arquivo selecionado não existe mais.');

  const { enabledDir, disabledDir, strategy } = modPaths(gameInstallPath, modName);
  onProgress?.({ phase: 'installing', percent: 0 });
  fs.mkdirSync(strategy.targetRoot, { recursive: true });
  if (fs.existsSync(enabledDir)) fs.rmSync(enabledDir, { recursive: true, force: true });
  if (fs.existsSync(disabledDir)) fs.rmSync(disabledDir, { recursive: true, force: true });

  if (path.extname(filePath).toLowerCase() === '.zip') {
    fs.mkdirSync(enabledDir, { recursive: true });
    await extractZip(filePath, { dir: enabledDir });
  } else {
    fs.mkdirSync(enabledDir, { recursive: true });
    fs.copyFileSync(filePath, path.join(enabledDir, path.basename(filePath)));
  }
  onProgress?.({ phase: 'done', percent: 100 });
  return { installedPath: enabledDir };
}

// ---------- Configuração dos mods (item pedido: "poder configurar
// mods") ----------
// A maioria dos mods de BepInEx grava as opções configuráveis em
// arquivos de texto simples (formato INI) dentro de BepInEx/config —
// um por mod. Em vez de tentar entender e desenhar um formulário
// pra CADA formato de configuração possível (impossível de fazer
// direito pra todo mod que existe), a edição aqui é de TEXTO puro: a
// pessoa vê o arquivo exatamente como ele é e edita à vontade — mesmo
// modelo que qualquer editor de config de verdade usa por baixo.
function configDir(gameInstallPath) {
  return path.join(gameInstallPath, 'BepInEx', 'config');
}

// Nunca deixa escapar da pasta de config (sem "..", sem caminho
// absoluto) — o nome do arquivo vem de uma lista que a gente mesmo
// gerou em listConfigFiles, mas confere de novo aqui por segurança,
// já que esse valor viaja até o processo principal via IPC.
function safeConfigPath(gameInstallPath, filename) {
  const base = configDir(gameInstallPath);
  const resolved = path.resolve(base, filename);
  if (!resolved.startsWith(path.resolve(base) + path.sep) || path.basename(filename) !== filename) {
    throw new Error('Nome de arquivo de configuração inválido.');
  }
  return resolved;
}

function listConfigFiles(gameInstallPath) {
  const dir = configDir(gameInstallPath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.cfg'))
    .map((e) => e.name)
    .sort();
}

function readConfigFile(gameInstallPath, filename) {
  return fs.readFileSync(safeConfigPath(gameInstallPath, filename), 'utf8');
}

function writeConfigFile(gameInstallPath, filename, content) {
  fs.writeFileSync(safeConfigPath(gameInstallPath, filename), content, 'utf8');
  return { saved: true };
}

// ---------- Roadmap (fora do escopo desta fase) ----------
// - Detecção de conflito de arquivo entre mods (item 17).
// - Suporte a outros mod loaders além do padrão BepInEx (item 27) —
//   detectInstallStrategy é o ponto de extensão único pra isso.
// - Instalar uma coleção inteira de uma vez (item 19).
// - Thunderstore: resolução de dependência em árvore já existe (ver
//   thunderstoreService.js no backend) e a instalação de cada pacote
//   também (installThunderstorePackage acima) — o que falta é detecção
//   de CONFLITO entre pacotes instalados juntos, igual o item 17 acima
//   já cobre pras outras fontes.
