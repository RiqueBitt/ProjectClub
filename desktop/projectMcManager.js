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

// Item pedido: "os arquivos necessários devem ser adicionados dentro da
// própria pasta de instalação do Project Club... Project Club → arquivos
// principais → pasta/arquivos do ProjectMC → executável" — a instalação
// NSIS "por usuário" (o padrão deste projeto, ver desktop/package.json)
// grava em %LOCALAPPDATA%\Programs\..., que é gravável sem elevar
// permissão nenhuma, então dá pra criar uma subpasta "modules" ali
// dentro de verdade. Se por algum motivo a pasta de instalação NÃO for
// gravável (ex: alguém trocou pra instalação "por máquina", feita como
// administrador), cai pros dados do próprio usuário (userData) em vez
// de falhar silenciosamente — só muda ONDE fica, nunca quebra.
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
const MODULES = {
  projectmc: {
    displayName: 'ProjectMC',
    description: 'Launcher de Minecraft do Project Club',
    folder: 'ProjectMC',
    manifestUrl: 'https://api.github.com/repos/RiqueBitt/goldapple-launcher-releases/releases/latest',
    exeName: 'ProjectMC.exe',
  },
};

function getModule(id) {
  const mod = MODULES[id];
  if (!mod) throw new Error(`Módulo desconhecido: ${id}`);
  return mod;
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
  return fs.existsSync(path.join(moduleDir(id), getModule(id).exeName));
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
async function fetchLatestRelease(id) {
  const mod = getModule(id);
  const release = await httpsGet(mod.manifestUrl, { asJson: true });
  const asset = (release.assets || []).find((a) => a.name.toLowerCase().endsWith('.zip'));
  if (!asset) throw new Error(`Nenhum pacote .zip encontrado na versão mais recente de ${mod.displayName}.`);
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

// Extrai um .zip usando o "Expand-Archive" do próprio PowerShell — sem
// adicionar nenhuma biblioteca de descompactação nova ao projeto
// (Windows é a plataforma alvo deste app, ver desktop/README.md).
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      reject(new Error('A instalação de módulos como o ProjectMC só é suportada no Windows por enquanto.'));
      return;
    }
    fs.mkdirSync(destDir, { recursive: true });
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`,
    ]);
    let stderr = '';
    ps.stderr.on('data', (d) => { stderr += d.toString(); });
    ps.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Falha ao extrair (código ${code}): ${stderr}`))));
    ps.on('error', reject);
  });
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
async function installOrUpdate(id, onProgress) {
  const mod = getModule(id);
  const { version, downloadUrl } = await fetchLatestRelease(id);

  onProgress?.({ phase: 'downloading', percent: 0 });
  const data = await httpsGet(downloadUrl, {
    onProgress: (percent) => onProgress?.({ phase: 'downloading', percent }),
  });
  const tmpZip = path.join(app.getPath('temp'), `${mod.folder}-${version}.zip`);
  fs.writeFileSync(tmpZip, data);

  const dir = moduleDir(id);
  onProgress?.({ phase: 'extracting', percent: 0 });
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  await extractZip(tmpZip, dir);
  fs.writeFileSync(versionFilePath(id), version, 'utf-8');
  fs.unlink(tmpZip, () => {});

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
// da MESMA pasta de instalação.
function launch(id) {
  const mod = getModule(id);
  const exe = path.join(moduleDir(id), mod.exeName);
  if (!fs.existsSync(exe)) throw new Error(`${mod.displayName} não está instalado.`);
  const child = spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
  child.unref();
}

function uninstall(id) {
  const dir = moduleDir(id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { getStatus, checkForUpdate, installOrUpdate, launch, uninstall };
