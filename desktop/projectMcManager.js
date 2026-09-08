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
const { spawn } = require('child_process');
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
function resolveModulesRoot() {
  const installDir = path.dirname(app.getPath('exe'));
  try {
    fs.accessSync(installDir, fs.constants.W_OK);
    return path.join(installDir, 'modules');
  } catch {
    return path.join(app.getPath('userData'), 'modules');
  }
}

// Catálogo dos módulos "jogo/app" que o Project Club sabe gerenciar.
// IMPORTANTE SOBRE O NOME: o repositório de onde os pacotes .zip publicados
// são baixados ainda se chama "goldapple-launcher-releases" no GitHub —
// renomear esse repositório em si está fora do que esta integração
// consegue fazer (é uma ação de administração da conta do GitHub, não
// uma mudança de código) — mas em qualquer lugar que o Project Club
// MOSTRA ou GRAVA esse módulo (nome exibido, nome da pasta, nome do
// executável esperado), ele já é tratado como "ProjectMC" de ponta a
// ponta, como pedido.
//
// Item pedido: "Fassa funcionar no Linux" — exeName agora depende da
// plataforma: no Windows é um .exe comum; no Linux, o formato de
// distribuição de app único mais simples pra um app Electron é um
// AppImage (mesmo formato que o próprio Project Club já usa pra si, ver
// "linux" em desktop/package.json) — um arquivo binário só, que só
// precisa de permissão de execução (chmod +x) pra rodar, sem precisar
// "instalar" nada no sistema. Quem publica os pacotes do ProjectMC
// precisa nomear os arquivos exatamente assim dentro do .zip de cada
// plataforma.
const MODULES = {
  projectmc: {
    displayName: 'ProjectMC',
    description: 'Launcher de Minecraft do Project Club',
    folder: 'ProjectMC',
    manifestUrl: 'https://api.github.com/repos/RiqueBitt/goldapple-launcher-releases/releases/latest',
    exeName: { win32: 'ProjectMC.exe', linux: 'ProjectMC.AppImage' },
  },
};

function getModule(id) {
  const mod = MODULES[id];
  if (!mod) throw new Error(`Módulo desconhecido: ${id}`);
  return mod;
}

// Item pedido: "Fassa funcionar no Linux" — resolve o nome de arquivo
// certo pra plataforma atual. Sem entrada pra plataforma atual
// (ex: macOS, que este projeto não distribui) — erro claro em vez de
// tentar rodar um binário que não existe.
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
// quanto pra baixar o pacote em si (arquivo grande) — sem precisar de
// nenhuma biblioteca nova além do "https" nativo do Node.
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
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

// Item pedido: "Project Club deve conseguir detectar a atualização" —
// traduz a resposta da API de releases do GitHub num formato simples e
// neutro (version/downloadUrl). Se o manifest de origem mudar de lugar
// no futuro (um domínio próprio, por exemplo), só esta função precisa
// mudar — o resto do módulo não sabe nem se importa de onde isso veio.
//
// Item pedido: "Fassa funcionar no Linux" — cada plataforma publica seu
// próprio pacote .zip dentro da mesma release (ex:
// "projectmc-1.2.0-win.zip" e "projectmc-1.2.0-linux.zip") — escolhe o
// asset certo pelo sufixo do nome do arquivo. Só cai pro primeiro .zip
// da lista quando existir exatamente UM .zip na release inteira
// (compatibilidade com uma release "de transição" que ainda não
// distingue plataforma nenhuma) — nunca quando já existem VÁRIOS .zips
// e nenhum bate com a plataforma atual.
//
// BUG CORRIGIDO: antes, "match || zips[0]" caía pro primeiro .zip da
// lista mesmo com vários presentes — numa release como a
// "goldapple-launcher-1.0.27-win32-ia32.zip" +
// "goldapple-launcher-1.0.27-win32-x64.zip" (dois pacotes, nenhum com
// "linux" no nome), rodando no LINUX isso baixava silenciosamente um
// .zip de WINDOWS (~130MB por engano) em vez de avisar que não tem
// pacote pra essa plataforma — a extração terminava "com sucesso"
// (nenhum erro), só que sem o ProjectMC.AppImage esperado lá dentro,
// deixando isInstalled()/launch() reportando "não instalado" depois
// de um download inteiro desperdiçado, sem explicar o motivo real.
function pickAssetForPlatform(assets) {
  const zips = assets.filter((a) => a.name.toLowerCase().endsWith('.zip'));
  const platformSuffix = process.platform === 'win32' ? 'win' : process.platform === 'linux' ? 'linux' : null;
  const match = platformSuffix && zips.find((a) => a.name.toLowerCase().includes(platformSuffix));
  if (match) return match;
  if (zips.length === 1) return zips[0];
  return null;
}

async function fetchLatestRelease(id) {
  const mod = getModule(id);
  const release = await httpsGet(mod.manifestUrl, { asJson: true });
  const asset = pickAssetForPlatform(release.assets || []);
  if (!asset) {
    const hasAnyZip = (release.assets || []).some((a) => a.name.toLowerCase().endsWith('.zip'));
    throw new Error(
      hasAnyZip
        ? `A versão mais recente de ${mod.displayName} não tem um pacote publicado para esta plataforma (${process.platform}).`
        : `Nenhum pacote .zip encontrado na versão mais recente de ${mod.displayName}.`
    );
  }
  return { version: (release.tag_name || '').replace(/^v/i, ''), downloadUrl: asset.browser_download_url };
}

async function checkForUpdate(id) {
  const installed = getInstalledVersion(id);
  const latest = await fetchLatestRelease(id);
  return {
    id,
    installed,
    latest: latest.version,
    updateAvailable: !installed || installed !== latest.version,
  };
}

// Item pedido: "quando o usuário escolher instalar o ProjectMC, os
// arquivos necessários devem ser adicionados dentro da própria pasta de
// instalação do Project Club" + "atualizar somente os arquivos
// necessários do launcher" — baixa o pacote mais recente e substitui a
// pasta do módulo por completo (apagar-e-extrair de novo é bem mais
// simples e confiável do que tentar mesclar arquivo por arquivo entre
// versões — o mesmo pacote sempre contém TODOS os arquivos necessários
// daquela versão, então "atualizar" e "instalar pela primeira vez" são
// literalmente a mesma operação aqui). onProgress recebe { phase,
// percent } pra alimentar uma barra de progresso na tela.
//
// Item pedido: "Fassa funcionar no Linux" — a extração em si (extractZip,
// via a biblioteca extract-zip) já é 100% multiplataforma sozinha; a
// única coisa extra que o Linux precisa é marcar o arquivo final como
// executável depois de extrair (chmod +x) — o Windows não tem esse
// conceito de permissão, e o próprio .zip nem sempre preserva esse bit
// corretamente dependendo de como foi empacotado.
async function installOrUpdate(id, onProgress) {
  const mod = getModule(id);
  const { version, downloadUrl } = await fetchLatestRelease(id);

  onProgress?.({ phase: 'downloading', percent: 0 });
  const data = await httpsGet(downloadUrl, {
    onProgress: (percent) => onProgress?.({ phase: 'downloading', percent }),
  });
  const tmpZip = path.join(app.getPath('temp'), `${mod.folder}-${version}-${process.platform}.zip`);
  fs.writeFileSync(tmpZip, data);

  const dir = moduleDir(id);
  onProgress?.({ phase: 'extracting', percent: 0 });
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await extractZip(tmpZip, { dir });
  fs.unlink(tmpZip, () => {});

  // BUG CORRIGIDO ("instalação que termina 'com sucesso' mas não
  // instala nada de verdade"): antes daqui, o código seguia direto pra
  // gravar o .version e reportar done/100% mesmo que o .zip baixado
  // não tivesse o executável esperado lá dentro (ex: um pacote
  // publicado com o nome original "GoldApple Launcher.exe" em vez de
  // "ProjectMC.exe", ou um .zip da plataforma errada) — a barra de
  // progresso completava normalmente, sem erro nenhum, e só depois,
  // silenciosamente, isInstalled()/launch() passavam a reportar "não
  // instalado" sem explicar por quê. Falha alto e claro aqui, no
  // momento exato em que dá pra saber com certeza o que faltou —
  // apaga a pasta extraída incompleta também, pra não deixar restos
  // pela metade.
  const exePath = path.join(dir, getExeName(mod));
  if (!fs.existsSync(exePath)) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`O pacote baixado de ${mod.displayName} não contém "${getExeName(mod)}" — o release publicado pode não estar empacotado no formato esperado.`);
  }

  // Item pedido: "Fassa funcionar no Linux" — sem isso, o AppImage
  // extraído fica sem permissão de execução na maioria dos casos (o
  // Linux não tem um equivalente confiável ao "clicar duas vezes pra
  // rodar" do Windows quando falta esse bit) e o próximo launch()
  // falharia com "Permission denied", mesmo com o arquivo certo no
  // lugar certo.
  if (process.platform !== 'win32') {
    try { fs.chmodSync(exePath, 0o755); } catch { /* segue — launch() vai reportar o erro de verdade se isso importar */ }
  }

  fs.writeFileSync(versionFilePath(id), version, 'utf-8');

  onProgress?.({ phase: 'done', percent: 100 });
  return { version };
}

// Item pedido: "o launcher também deve poder ser iniciado separadamente
// através do próprio Project Club... deve iniciar o módulo/janela
// própria do launcher, sem precisar abrir uma segunda instalação
// completa do Project Club" — processo do sistema operacional
// desanexado (detached + unref), não uma segunda janela do MESMO
// Electron: o ProjectMC é, por si só, outro app Electron com seu
// próprio processo principal — é assim que ele roda de qualquer jeito,
// exatamente como abrir qualquer outro programa instalado no PC.
// Fechar o Project Club depois não derruba o ProjectMC junto (nem
// vice-versa) — são dois processos de verdade, só que morando dentro
// da MESMA pasta de instalação. Funciona igual no Windows (.exe) e no
// Linux (AppImage com permissão de execução, ver installOrUpdate acima).
function launch(id) {
  const mod = getModule(id);
  const exe = path.join(moduleDir(id), getExeName(mod));
  if (!fs.existsSync(exe)) throw new Error(`${mod.displayName} não está instalado.`);
  const child = spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
  child.unref();
}

function uninstall(id) {
  const dir = moduleDir(id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { getStatus, checkForUpdate, installOrUpdate, launch, uninstall };
