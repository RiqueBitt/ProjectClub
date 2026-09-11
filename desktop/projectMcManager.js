// ProjectMC — módulo opcional de launcher de Minecraft do Project Club.
//
// Item pedido: "o ProjectMC NÃO deve ser criado como um novo aplicativo
// independente... deve funcionar como um complemento opcional do próprio
// Project Club... os arquivos necessários devem ser adicionados dentro da
// própria pasta de instalação do Project Club."
//
// O ProjectMC em si (o launcher de Minecraft — build gerado a partir do
// projeto goldapple-launcher, um fork do X Minecraft Launcher) é um
// aplicativo Electron GRANDE E COMPLEXO por conta própria (múltiplos
// pacotes, build próprio) — reescrever/embutir o código-fonte dele
// DENTRO do processo do Project Club não é viável nem desejável (ele
// precisa do próprio processo principal Electron pra funcionar). O que
// este módulo faz de verdade é o que o pedido descreve: gerenciar a
// PRESENÇA dele dentro da pasta de instalação do Project Club — baixar,
// atualizar, abrir e remover — como se fosse "só mais uma pasta" dentro
// da instalação, nunca um instalador/atalho separado.
//
// Item pedido (depois de uma sequência longa de bugs "Invalid package
// app.asar", todos causados direta ou indiretamente pela complexidade de
// baixar+extrair+verificar um zip com centenas de arquivos do lado de
// fora): "criar uma pasta com o .exe do launcher... em vez de baixar
// vários arquivos, baixar o .exe... quando clicar em jogar ele abre o
// .exe". O pacote publicado agora é um ÚNICO arquivo por plataforma —
// um .exe portátil no Windows (target 'portable' do electron-builder, se
// auto-extrai sozinho usando o próprio mecanismo do NSIS toda vez que
// roda) e um .AppImage no Linux (já era um arquivo único por natureza).
// Este módulo não extrai, não verifica estrutura de pacote nenhuma — só
// baixa o arquivo e roda ele, exatamente como abrir qualquer outro
// programa instalado no PC.
//
// Item pedido: "a arquitetura deve ser preparada para que futuramente
// outros jogos ou aplicativos também possam ser adicionados da mesma
// forma" — por isso quase tudo aqui recebe um `id` de módulo (MODULES
// abaixo) em vez de ter "projectmc" hardcoded em cada função; adicionar
// um segundo jogo/app no futuro é só adicionar uma entrada nova nesse
// catálogo, com seu próprio manifestUrl/exeName.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn, execSync, execFileSync } = require('child_process');
const extractZip = require('extract-zip');

// Item pedido: "os arquivos necessários devem ser adicionados dentro da
// própria pasta de instalação do Project Club... Project Club → arquivos
// principais → pasta/arquivos do ProjectMC → executável" — a instalação
// NSIS "por usuário" (o padrão deste projeto, ver desktop/package.json)
// grava em %LOCALAPPDATA%\Programs\..., que é gravável sem elevar
// permissão nenhuma, então dá pra criar uma subpasta "modules" ali
// dentro de verdade. Se por algum motivo a pasta de instalação NÃO for
// gravável (ex: instalação "por máquina", feita como administrador no
// Windows, ou um AppImage no Linux — que roda a partir de um ponto de
// montagem squashfs SOMENTE LEITURA, nunca gravável), cai pros dados do
// próprio usuário (userData) em vez de falhar silenciosamente — só muda
// ONDE fica, nunca quebra.
function canWriteTo(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

// No Windows, só considera a pasta de instalação (Program Files ou
// similar) gravável se o processo estiver REALMENTE elevado agora — não
// basta "conseguir escrever um arquivo de teste ali", já que o Windows
// pode silenciosamente redirecionar essa escrita pra
// %LocalAppData%\VirtualStore\... (UAC Virtualization) sem avisar nada,
// de um jeito que só o PRÓPRIO processo que escreveu enxerga de volta —
// outros processos (como o próprio .exe do ProjectMC rodando depois)
// podem não ver a mesma coisa. "net session" só tem sucesso rodando
// elevado de verdade (falha com "access is denied" caso contrário).
function isElevatedOnWindows() {
  if (process.platform !== 'win32') return true; // n/a fora do Windows
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function resolveModulesRoot() {
  const installDir = path.dirname(app.getPath('exe'));
  const canUseInstallDir = isElevatedOnWindows() && canWriteTo(installDir);
  return canUseInstallDir ? path.join(installDir, 'modules') : path.join(app.getPath('userData'), 'modules');
}

// Catálogo dos módulos "jogo/app" que o Project Club sabe gerenciar.
// IMPORTANTE SOBRE O NOME: o repositório de onde os pacotes publicados
// são baixados ainda se chama "goldapple-launcher-releases" no GitHub —
// renomear esse repositório em si está fora do que esta integração
// consegue fazer (é uma ação de administração da conta do GitHub, não
// uma mudança de código) — mas em qualquer lugar que o Project Club
// MOSTRA ou GRAVA esse módulo (nome exibido, nome da pasta, nome do
// executável esperado), ele já é tratado como "ProjectMC" de ponta a
// ponta, como pedido.
const MODULES = {
  projectmc: {
    displayName: 'ProjectMC',
    description: 'Launcher de Minecraft do Project Club',
    folder: 'ProjectMC',
    manifestUrl: 'https://api.github.com/repos/RiqueBitt/goldapple-launcher-releases/releases',
    packageType: 'single-file',
    exeName: { win32: 'ProjectMC.exe', linux: 'ProjectMC.AppImage' },
  },
  // Item pedido: "adicione esse projeto aqui, ele é um tipo de editor
  // de imagem chamado PhotoProject... adicione ele na aba aplicativo
  // Windows e Linux" — diferente do ProjectMC (Electron, empacotado
  // como um único .exe/.AppImage portátil), o PhotoProject é um app
  // Qt/C++ nativo — o pacote publicado é um .zip (Windows, gerado com
  // windeployqt: o binário + as DLLs do Qt do lado) ou .tar.gz (Linux:
  // o binário + as bibliotecas do Qt + um script "photoproject.sh" que
  // ajusta LD_LIBRARY_PATH/QT_PLUGIN_PATH antes de rodar o binário
  // real) — precisa extrair pra uma pasta, não dá pra rodar um único
  // arquivo solto. packageType 'archive' abaixo é o que diferencia
  // esse fluxo do 'single-file' do ProjectMC.
  photoproject: {
    displayName: 'PhotoProject',
    description: 'Editor de imagem do Project Club',
    folder: 'PhotoProject',
    manifestUrl: 'https://api.github.com/repos/RiqueBitt/PhotoProject_releases-/releases',
    packageType: 'archive',
    assetExt: { win32: '.zip', linux: '.tar.gz' },
    exeName: { win32: 'patchy.exe', linux: 'photoproject.sh' },
  },
};

function getModule(id) {
  const mod = MODULES[id];
  if (!mod) throw new Error(`Módulo desconhecido: ${id}`);
  return mod;
}

// Resolve o nome de arquivo certo pra plataforma atual. Sem entrada pra
// plataforma atual (ex: macOS, que este projeto não distribui) — erro
// claro em vez de tentar rodar um binário que não existe.
function getExeName(mod) {
  const name = mod.exeName[process.platform];
  if (!name) throw new Error(`${mod.displayName} não tem um pacote disponível para esta plataforma (${process.platform}).`);
  return name;
}

function moduleDir(id) {
  return path.join(resolveModulesRoot(), getModule(id).folder);
}

function versionFilePath(id) {
  return path.join(moduleDir(id), '.version');
}

function getInstalledVersion(id) {
  try {
    return fs.readFileSync(versionFilePath(id), 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

function isInstalled(id) {
  const mod = getModule(id);
  try {
    return fs.existsSync(path.join(moduleDir(id), getExeName(mod)));
  } catch {
    return false;
  }
}

function getStatus(id) {
  const mod = getModule(id);
  return {
    id,
    displayName: mod.displayName,
    description: mod.description,
    installed: isInstalled(id),
    version: getInstalledVersion(id),
  };
}

// GET https simples com suporte a redirecionamento — usado tanto pra ler
// o manifest (JSON pequeno, a resposta da API de releases do GitHub)
// quanto pra baixar o pacote em si — sem precisar de nenhuma biblioteca
// nova além do "https" nativo do Node.
//
// Confere bytes recebidos contra Content-Length antes de resolver — se a
// conexão cair no meio (rede instável, timeout, proxy cortando cedo), o
// evento 'end' de um stream HTTP ainda assim dispara, e sem essa
// checagem o download "truncado" passaria como sucesso silenciosamente.
function httpsGet(url, { asJson = false, onProgress } = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ProjectClub-App' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        httpsGet(res.headers.location, { asJson, onProgress }, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} ao acessar ${url}`));
        res.resume();
        return;
      }
      res.on('error', (err) => reject(new Error(`Conexão interrompida durante o download: ${err.message}`)));
      if (asJson) {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
        });
        return;
      }
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      const chunks = [];
      res.on('data', (c) => {
        received += c.length;
        chunks.push(c);
        if (onProgress && total) onProgress(Math.round((received / total) * 100));
      });
      res.on('end', () => {
        if (total && received !== total) {
          reject(new Error(`Download incompleto: recebidos ${received} de ${total} bytes esperados — a conexão pode ter caído no meio. Tente instalar de novo.`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    }).on('error', reject);
  });
}

// Traduz a resposta da API de releases do GitHub num formato simples e
// neutro (version/downloadUrl). Se o manifest de origem mudar de lugar
// no futuro (um domínio próprio, por exemplo), só esta função precisa
// mudar — o resto do módulo não sabe nem se importa de onde isso veio.
//
// O repositório goldapple-launcher-releases recebe releases de DOIS
// processos diferentes: este projeto (build-projectmc-release.yml, tags
// "v1.1.0" — formato semântico, com pontos) e o workflow de release
// pública do launcher em si (outro repositório, tags "v37" — só um
// número, sem pontos). Filtra só tags no formato semântico (com pontos)
// — o formato que só este projeto usa — pegando a mais recente dentre
// essas, ignorando qualquer release "v37"-like publicada por outro
// processo.
function isSemverTag(tagName) {
  return /^v?\d+\.\d+\.\d+$/i.test(tagName || '');
}

// Escolhe o asset certo pra plataforma atual — agora um arquivo único
// (.exe no Windows, .AppImage no Linux), não mais um .zip pra extrair.
function pickAssetForPlatform(assets, mod) {
  // Item pedido: PhotoProject usa packageType 'archive' — o asset
  // publicado é um .zip/.tar.gz (assetExt), não o mesmo arquivo do
  // executável final (exeName), que só existe DEPOIS de extrair.
  const ext = mod.packageType === 'archive'
    ? mod.assetExt[process.platform]
    : path.extname(getExeName(mod).toLowerCase()); // '.exe' ou '.appimage'
  if (!ext) throw new Error(`${mod.displayName} não tem um pacote disponível para esta plataforma (${process.platform}).`);
  return assets.find((a) => a.name.toLowerCase().endsWith(ext.toLowerCase())) || null;
}

async function fetchLatestRelease(id) {
  const mod = getModule(id);
  const releases = await httpsGet(mod.manifestUrl, { asJson: true });
  const release = (Array.isArray(releases) ? releases : [])
    .filter((r) => isSemverTag(r.tag_name))
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))[0];
  if (!release) throw new Error(`Nenhuma versão de ${mod.displayName} publicada no formato esperado (vX.Y.Z) foi encontrada.`);
  const asset = pickAssetForPlatform(release.assets || [], mod);
  if (!asset) throw new Error(`A versão mais recente de ${mod.displayName} não tem um pacote publicado para esta plataforma (${process.platform}).`);
  return { version: (release.tag_name || '').replace(/^v/i, ''), downloadUrl: asset.browser_download_url };
}

async function checkForUpdate(id) {
  const installed = getInstalledVersion(id);
  const latest = await fetchLatestRelease(id);
  return {
    installed,
    latest: latest.version,
    updateAvailable: !installed || installed !== latest.version,
  };
}

// Mata qualquer processo do módulo que ainda esteja rodando — usado
// antes de reinstalar/desinstalar, pra nunca tentar mexer num arquivo
// que o próprio ProjectMC ainda está usando (o Windows trava exclusão/
// substituição de um .exe em uso; fechar a janela dele não necessariamente
// mata o processo por completo, então isso não é incomum de acontecer).
function killRunningProcess(exeName) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /IM "${exeName}" /F`, { stdio: 'ignore' });
    } else {
      execSync(`pkill -f "${exeName}"`, { stdio: 'ignore' });
    }
  } catch {
    // Não achou nenhum processo rodando com esse nome — situação normal
    // (mais comum até), não um erro de verdade.
  }
}

// Instalar ou atualizar agora é: baixar o arquivo único (.exe/.AppImage)
// pra um nome temporário do lado, confirmar que baixou por completo
// (httpsGet acima já garante isso), matar qualquer processo antigo que
// ainda esteja rodando, e só então trocar pelo nome final — nunca
// escreve direto em cima do arquivo em uso, então nunca fica um estado
// "pela metade" visível mesmo se algo falhar no meio do caminho.
async function installOrUpdate(id, onProgress) {
  const mod = getModule(id);
  const { version, downloadUrl } = await fetchLatestRelease(id);

  onProgress?.({ phase: 'downloading', percent: 0 });
  const data = await httpsGet(downloadUrl, {
    onProgress: (percent) => onProgress?.({ phase: 'downloading', percent }),
  });

  const dir = moduleDir(id);
  fs.mkdirSync(dir, { recursive: true });

  if (mod.packageType === 'archive') {
    await installArchivePackage(mod, id, dir, data, version, onProgress);
  } else {
    await installSingleFilePackage(mod, dir, data, version);
  }

  onProgress?.({ phase: 'done', percent: 100 });
  return { version };
}

// Fluxo original do ProjectMC — um único arquivo (.exe/.AppImage) já
// pronto pra rodar, sem nenhuma extração.
async function installSingleFilePackage(mod, dir, data, version) {
  const finalExePath = path.join(dir, getExeName(mod));
  const tmpExePath = `${finalExePath}.downloading-${Date.now()}`;

  fs.writeFileSync(tmpExePath, data);
  if (process.platform !== 'win32') {
    // Item pedido: "Fassa funcionar no Linux" — sem isso, o AppImage
    // baixado fica sem permissão de execução na maioria dos casos (o
    // Linux não tem um equivalente confiável ao "clicar duas vezes pra
    // rodar" do Windows quando falta esse bit).
    try { fs.chmodSync(tmpExePath, 0o755); } catch { /* segue — launch() reporta o erro de verdade se isso importar */ }
  }

  killRunningProcess(getExeName(mod));
  try {
    fs.renameSync(tmpExePath, finalExePath);
  } catch {
    // O .exe antigo ainda travado mesmo depois de matar o processo —
    // raro, mas possível (antivírus escaneando, por exemplo). Espera só
    // um instante e tenta mais uma vez antes de desistir.
    await new Promise((r) => setTimeout(r, 500));
    fs.renameSync(tmpExePath, finalExePath);
  }
  fs.writeFileSync(path.join(dir, '.version'), version, 'utf-8');
}

// Item pedido: "adicione esse projeto... editor de imagem chamado
// PhotoProject" — pacote publicado como .zip (Windows) ou .tar.gz
// (Linux), precisa extrair pra pasta em vez de rodar direto. Mesmo
// padrão "instalar do lado, trocar depois" já comprovado com o
// ProjectMC (ver histórico do arquivo) — nunca mexe na instalação em
// uso até tudo já ter sido baixado e extraído com sucesso numa pasta
// separada.
async function installArchivePackage(mod, id, finalDir, data, version, onProgress) {
  const tmpArchivePath = path.join(app.getPath('temp'), `${mod.folder}-${version}-${process.platform}-${Date.now()}${mod.assetExt[process.platform]}`);
  fs.writeFileSync(tmpArchivePath, data);

  const stagingDir = `${finalDir}.installing-${Date.now()}`;
  fs.mkdirSync(stagingDir, { recursive: true });
  onProgress?.({ phase: 'extracting', percent: 0 });
  try {
    if (process.platform === 'win32') {
      await extractZip(tmpArchivePath, { dir: stagingDir });
    } else {
      // tar já vem instalado em qualquer distribuição Linux normal —
      // sem precisar de nenhuma biblioteca npm extra só pra isso.
      execFileSync('tar', ['-xzf', tmpArchivePath, '-C', stagingDir]);
    }
  } finally {
    fs.unlink(tmpArchivePath, () => {});
  }

  const exePath = path.join(stagingDir, getExeName(mod));
  if (!fs.existsSync(exePath)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw new Error(`O pacote baixado de ${mod.displayName} não contém "${getExeName(mod)}" — o release publicado pode não estar empacotado no formato esperado.`);
  }
  if (process.platform !== 'win32') {
    try { fs.chmodSync(exePath, 0o755); } catch { /* segue */ }
  }
  fs.writeFileSync(path.join(stagingDir, '.version'), version, 'utf-8');

  onProgress?.({ phase: 'finishing', percent: 100 });
  killRunningProcess(getExeName(mod));
  const oldDir = `${finalDir}.old-${Date.now()}`;
  if (fs.existsSync(finalDir)) {
    try {
      fs.renameSync(finalDir, oldDir);
    } catch {
      await new Promise((r) => setTimeout(r, 500));
      fs.renameSync(finalDir, oldDir);
    }
  }
  fs.renameSync(stagingDir, finalDir);
  fs.rmSync(oldDir, { recursive: true, force: true });
}

// Item pedido: "o launcher também deve poder ser iniciado separadamente
// através do próprio Project Club... quando clicar em jogar ele abre o
// .exe" — processo do sistema operacional desanexado (detached +
// unref), não uma segunda janela do MESMO Electron: o ProjectMC é, por
// si só, outro app Electron com seu próprio processo principal — é
// assim que ele roda de qualquer jeito, exatamente como abrir qualquer
// outro programa instalado no PC. Fechar o Project Club depois não
// derruba o ProjectMC junto (nem vice-versa).
function launch(id) {
  const mod = getModule(id);
  const exe = path.join(moduleDir(id), getExeName(mod));
  if (!fs.existsSync(exe)) throw new Error(`${mod.displayName} não está instalado.`);
  const child = spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
  child.unref();
}

function uninstall(id) {
  const mod = getModule(id);
  killRunningProcess(getExeName(mod));
  const dir = moduleDir(id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// Item pedido: "faça atualizações em segundo plano do Project Club e/ou
// outros apps que tiver baixados junto com o Project Club, deixe ele
// atualizando em segundo plano que o usuário não fica vendo para não
// atrapalhar ele" — checa e atualiza sozinho, sem nenhum indicador
// visual (sem barra de progresso na tela, sem notificação), TODOS os
// módulos do catálogo (MODULES acima) que a pessoa JÁ tem instalado —
// nunca instala algo do zero sozinho (só quem clica em "Instalar" faz
// isso de propósito), só mantém o que já existe atualizado. Chamado
// periodicamente pelo main.js, do mesmo jeito que o autoUpdater do
// próprio Project Club já roda em segundo plano.
async function checkAndUpdateInstalledModules() {
  for (const id of Object.keys(MODULES)) {
    try {
      if (!isInstalled(id)) continue; // nunca instala algo que a pessoa nunca baixou
      const { updateAvailable } = await checkForUpdate(id);
      if (!updateAvailable) continue;
      await installOrUpdate(id);
    } catch (err) {
      // Rede instável, release fora do ar, etc. — normal, sem alarde
      // nenhum; a próxima checagem periódica tenta de novo sozinha.
      console.error(`[atualização de apps] falha ao atualizar ${id} em segundo plano:`, err?.message || err);
    }
  }
}

module.exports = { getStatus, checkForUpdate, installOrUpdate, launch, uninstall, checkAndUpdateInstalledModules };
