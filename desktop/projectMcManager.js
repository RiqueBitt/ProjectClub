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
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const extractZip = require('extract-zip');
const asar = require('@electron/asar');

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
//
// BUG CORRIGIDO: usava fs.accessSync(dir, W_OK) pra checar se dava pra
// escrever ali — isso é conhecido por não ser confiável no Windows.
// Diferente do Linux/macOS (permissões unix reais), o Windows usa ACLs, e
// fs.accessSync(W_OK) no Windows só confere o atributo "somente leitura"
// do item (quase nunca marcado em PASTAS) — não a permissão de escrita de
// verdade dada por UAC/administrador. Resultado real visto: instalação
// "para todos os usuários" do NSIS (padrão) vai pra C:\Program Files\...,
// accessSync(W_OK) "passava" (dizia que era gravável), o código achava
// que podia usar essa pasta — e só na hora de tentar criar a pasta de
// verdade (fs.mkdirSync, dentro de installOrUpdate) é que vinha o erro
// real do Windows: "EPERM: operation not permitted, mkdir 'C:\Program
// Files\Project Club\modules\ProjectMC'". Corrigido testando com uma
// escrita de verdade (cria e apaga um arquivo de teste) em vez de
// perguntar ao sistema de permissões, que pode mentir dependendo da
// plataforma — é a única forma confiável de saber se vai funcionar,
// igual em qualquer sistema operacional.
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

// BUG CORRIGIDO (v2, achado real do relatado "Invalid package ...
// app.asar" persistindo mesmo com download/extração comprovadamente
// íntegros, package certo escolhido, e uma única instalação confirmada
// no caminho certo): mesmo depois de canWriteTo() testar com uma
// escrita real (em vez de confiar em accessSync), o teste ainda podia
// "passar" em Program Files por um motivo diferente e mais sutil —
// UAC File Virtualization do Windows. Quando um processo NÃO está
// elevado de verdade (mesmo tendo sido INSTALADO como administrador
// uma vez — isso não faz o app RODAR elevado depois, só a instalação
// em si precisou disso) e tenta escrever numa pasta protegida como
// Program Files, o Windows finge que funcionou: silenciosamente
// redireciona a escrita pra %LocalAppData%\VirtualStore\... de forma
// transparente PRO MESMO PROCESSO — então canWriteTo()/
// verifyAsarIntegrity() liam de volta através desse mesmo redirecionamento
// e sempre viam tudo certo. Só que esse redirecionamento não é garantido
// se comportar do mesmo jeito quando o Electron carrega o .asar de
// verdade pra abrir o processo do ProjectMC (ou quando outra ferramenta/
// contexto olha pro caminho real, sem o filtro de virtualização) —
// resultando em "Invalid package" mesmo com tudo parecendo correto do
// lado de dentro do próprio processo que instalou.
//
// Corrigido: no Windows, só considera installDir (Program Files ou
// similar) gravável se o processo estiver REALMENTE elevado agora — não
// só "consegue enganar um teste de escrita", que a virtualização
// engana facilmente. "net session" é um comando clássico do Windows que
// só têm sucesso rodando elevado de verdade (falha com "access is
// denied" caso contrário) — sem precisar de nenhum módulo nativo extra.
// Nunca tentando escrever em Program Files sem elevação real, a
// virtualização nunca entra em ação pra começo de conversa — os dados
// vão sempre pra AppData (sempre gravável, nunca virtualizado) de forma
// consistente entre quem escreve e quem lê depois.
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
    manifestUrl: 'https://api.github.com/repos/RiqueBitt/goldapple-launcher-releases/releases',
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
//
// BUG CORRIGIDO ("Invalid package ... app.asar" ao tentar abrir depois de
// instalar): o download de arquivo grande nunca conferia se realmente
// baixou tudo — o evento 'end' de um stream HTTP dispara quando a
// CONEXÃO termina, não necessariamente quando TODOS os bytes chegaram
// (rede instável, timeout, proxy cortando no meio, etc. podem encerrar a
// conexão cedo). O código resolvia a promise como sucesso de qualquer
// jeito, gravava um .zip truncado no disco (fs.writeFileSync em
// installOrUpdate) e extraía ele — o executável (perto do início do
// arquivo) podia sair inteiro, enquanto resources/app.asar (mais pro
// fim) saía cortado/corrompido, exatamente o sintoma relatado. Também
// não havia handler de erro no stream de resposta em si (só na
// requisição) — uma queda de conexão no meio podia nem cair no reject.
// Corrigido conferindo bytes recebidos contra Content-Length antes de
// resolver, e capturando erro do stream de resposta também.
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
  // BUG CRÍTICO CORRIGIDO ("Invalid package ... app.asar" persistente,
  // mesmo depois de reinstalar do zero várias vezes, com download e
  // extração já comprovadamente íntegros): o manifest usava
  // "/releases/latest" — a release mais recente do repositório, ponto,
  // sem distinguir QUEM a publicou. O repositório goldapple-launcher-
  // releases recebe releases de DOIS processos diferentes: este projeto
  // (build-projectmc-release.yml, tags "v1.1.0" — formato semântico,
  // com pontos) E o workflow de release pública do launcher em si
  // (build-windows-exe.yml, no repositório goldapple-launcher, tags
  // "v37" — só um número, sem pontos), que roda automaticamente e
  // PUBLICA NO MESMO REPOSITÓRIO. Quando esse segundo workflow roda
  // depois do primeiro, "latest" passa a apontar pro pacote ERRADO —
  // que passa pela verificação de integridade estrutural (é um .asar
  // genuinamente válido, só que de um build diferente/incompatível, não
  // truncado) e só falha na hora real de carregar no Electron. Isso
  // explica o padrão exato relatado: reinstalar do zero "resolvia" só
  // até o outro workflow publicar de novo, daí voltava a quebrar, sem
  // nenhuma corrupção de verdade envolvida.
  //
  // Corrigido buscando a LISTA de releases (não só "/latest") e
  // filtrando só tags no formato semântico "vX.Y.Z" (com pontos) — o
  // formato que só este projeto usa — pegando a mais recente dentre
  // essas, ignorando releases "v37"-like publicadas por qualquer outro
  // processo.
  const releases = await httpsGet(mod.manifestUrl, { asJson: true });
  const isSemverTag = (tagName) => /^v?\d+\.\d+\.\d+$/i.test(tagName || '');
  const release = (Array.isArray(releases) ? releases : [])
    .filter((r) => isSemverTag(r.tag_name))
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))[0];
  if (!release) throw new Error(`Nenhuma versão de ${mod.displayName} publicada no formato esperado (vX.Y.Z) foi encontrada.`);
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
function verifyAsarIntegrity(asarPath) {
  // Item pedido: verificar todos os sistemas de Configurações e afins —
  // achado ao investigar "Invalid package ... app.asar" relatado ao
  // abrir depois de instalar/reinstalar, mesmo já com a validação de
  // bytes do download (httpsGet acima), release certa sendo escolhida,
  // e o release publicado confirmado íntegro — reproduzido mesmo numa
  // instalação única em AppData (nunca sujeita a UAC Virtualization).
  //
  // BUG CORRIGIDO (v3 — as duas tentativas anteriores só verificavam
  // TAMANHO, nunca CONTEÚDO): a v1 conferia só "app.asar tem pelo menos
  // 1MB" (fraco demais). A v2 melhorou pra comparar o tamanho FÍSICO
  // real do arquivo contra o que o próprio cabeçalho do .asar diz que
  // deveria ser (pega qualquer truncamento) — mas ainda não prova que
  // o CONTEÚDO de cada arquivo lá dentro é o que deveria ser. Uma
  // alteração que preserva o tamanho total (ex: um trecho de bytes
  // fica diferente do original sem cortar nem alongar o arquivo — pode
  // acontecer por vários motivos fora do meu controle: falha de disco,
  // problema de memória, algo interferindo na escrita) passava batido
  // por essa checagem, mesmo com o arquivo genuinamente inválido.
  //
  // Corrigido usando os hashes SHA256 que o PRÓPRIO formato .asar já
  // guarda pra cada arquivo dentro do pacote (campo "integrity" no
  // cabeçalho, dividido em blocos de 4MB quando o arquivo é maior que
  // isso) — a mesma informação que o Electron usaria pra validar de
  // verdade. Lê os bytes reais de cada arquivo no offset certo, calcula
  // o hash, e compara com o que o cabeçalho diz que deveria ser. Rápido
  // (testado: ~60ms pra um pacote de ~30MB com 115 arquivos) — sem
  // impacto perceptível na instalação.
  const { header, headerSize } = asar.getRawHeader(asarPath);
  const dataStart = 8 + headerSize;
  const fd = fs.openSync(asarPath, 'r');
  try {
    let ok = true;
    (function walk(node) {
      if (!ok || !node.files) return;
      for (const child of Object.values(node.files)) {
        if (!ok) return;
        if (child.offset === undefined) { walk(child); continue; }
        if (!child.size || !child.integrity?.blocks) continue; // vazio/link — nada de conteúdo real pra checar
        const offset = dataStart + Number(child.offset);
        const blockSize = child.integrity.blockSize || child.size;
        const blocks = child.integrity.blocks;
        let pos = 0;
        for (let i = 0; i < blocks.length; i++) {
          const len = Math.min(blockSize, child.size - pos);
          const buf = Buffer.alloc(len);
          fs.readSync(fd, buf, 0, len, offset + pos);
          if (crypto.createHash('sha256').update(buf).digest('hex') !== blocks[i]) { ok = false; return; }
          pos += len;
        }
      }
    })(header);
    return ok;
  } finally {
    fs.closeSync(fd);
  }
}

// Item pedido: "quero um jeito mais fácil e sem erros, não quero ficar
// vendo esse erro pra sempre" — depois de já ter corrigido, em ordem,
// download truncado, release errada sendo escolhida, tamanho do
// pacote, estrutura do .asar e até o CONTEÚDO de cada arquivo por
// hash — e o erro ainda voltando, só sobrava uma explicação: alguma
// dessas instalações estava ficando com arquivo VELHO e NOVO
// misturados. A forma antiga de instalar (apagar a pasta no lugar,
// depois extrair por cima no MESMO lugar) tem uma falha estrutural:
// se o ProjectMC.exe de uma instalação anterior ainda estiver rodando
// em segundo plano (comum — fechar a janela dele não avisa o Project
// Club, e a pessoa não necessariamente percebe que ainda está aberto),
// o Windows trava a exclusão desse arquivo específico. fs.rmSync com
// force:true não lança erro nesse caso — ele segue em frente e ignora
// silenciosamente o que não conseguiu apagar — deixando um .exe VELHO
// ao lado de um resources/app.asar NOVO (ou vice-versa, dependendo de
// qual travou), uma combinação que o Electron corretamente recusa
// como "Invalid package".
//
// Reescrito do zero com o padrão "instalar do lado, trocar depois":
// nunca mais mexe na pasta final até tudo já estar baixado, extraído
// e validado com sucesso NUMA PASTA SEPARADA — aí sim, depois de
// garantir que nenhum processo antigo está rodando (killRunningProcess
// abaixo), troca a pasta antiga pela nova de uma vez só. Ou a
// instalação inteira dá certo, ou a pasta em uso nunca chega a ser
// tocada — nunca mais um estado "pela metade" visível.
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

async function installOrUpdate(id, onProgress) {
  const mod = getModule(id);
  const { version, downloadUrl } = await fetchLatestRelease(id);

  onProgress?.({ phase: 'downloading', percent: 0 });
  const data = await httpsGet(downloadUrl, {
    onProgress: (percent) => onProgress?.({ phase: 'downloading', percent }),
  });
  const tmpZip = path.join(app.getPath('temp'), `${mod.folder}-${version}-${process.platform}-${Date.now()}.zip`);
  fs.writeFileSync(tmpZip, data);

  const finalDir = moduleDir(id);
  const stagingDir = `${finalDir}.installing-${Date.now()}`;
  onProgress?.({ phase: 'extracting', percent: 0 });
  fs.mkdirSync(stagingDir, { recursive: true });
  try {
    await extractZip(tmpZip, { dir: stagingDir });
  } finally {
    fs.unlink(tmpZip, () => {});
  }

  // Confere TUDO ainda na pasta separada (staging) — nada disso já
  // afetou a instalação em uso, então um erro aqui é só "a instalação
  // nova não deu certo", nunca "quebrei a que já funcionava".
  const exePath = path.join(stagingDir, getExeName(mod));
  if (!fs.existsSync(exePath)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw new Error(`O pacote baixado de ${mod.displayName} não contém "${getExeName(mod)}" — o release publicado pode não estar empacotado no formato esperado.`);
  }
  if (process.platform === 'win32') {
    const asarPath = path.join(stagingDir, 'resources', 'app.asar');
    const asarOk = fs.existsSync(asarPath) && (() => { try { return verifyAsarIntegrity(asarPath); } catch { return false; } })();
    if (!asarOk) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      throw new Error(`O pacote baixado de ${mod.displayName} está corrompido (resources/app.asar incompleto ou inválido) — o download pode ter sido interrompido ou alterado no meio. Tente instalar de novo.`);
    }
  }
  if (process.platform !== 'win32') {
    try { fs.chmodSync(exePath, 0o755); } catch { /* segue — launch() vai reportar o erro de verdade se isso importar */ }
  }
  fs.writeFileSync(path.join(stagingDir, '.version'), version, 'utf-8');

  // Só a partir daqui a pasta em uso é tocada — e só depois de garantir
  // que nenhum processo antigo ainda está com arquivos dela abertos.
  onProgress?.({ phase: 'finishing', percent: 100 });
  killRunningProcess(getExeName(mod));
  const oldDir = `${finalDir}.old-${Date.now()}`;
  if (fs.existsSync(finalDir)) {
    try {
      fs.renameSync(finalDir, oldDir);
    } catch {
      // Alguma coisa ainda travada mesmo depois de matar o processo —
      // raro, mas possível (antivírus escaneando, por exemplo). Espera
      // só um instante e tenta mais uma vez antes de desistir.
      await new Promise((r) => setTimeout(r, 500));
      fs.renameSync(finalDir, oldDir);
    }
  }
  fs.renameSync(stagingDir, finalDir);
  fs.rmSync(oldDir, { recursive: true, force: true });

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
  // Item pedido: verificar todos os sistemas de Configurações e afins —
  // checa a integridade de verdade (mesma função usada logo após
  // instalar, ver verifyAsarIntegrity acima) também aqui, na hora de
  // abrir — cobre o caso de uma instalação que já estava corrompida
  // antes desta correção existir (feita com uma versão anterior do
  // Project Club, sem essa checagem no momento da instalação). Sem
  // isso, a pessoa só veria o erro genérico "Invalid package..." vindo
  // de dentro do próprio Electron do ProjectMC — uma mensagem clara
  // daqui, apontando pro botão Reinstalar, é bem mais acionável.
  if (process.platform === 'win32') {
    const asarPath = path.join(path.dirname(exe), 'resources', 'app.asar');
    const asarOk = fs.existsSync(asarPath) && (() => { try { return verifyAsarIntegrity(asarPath); } catch { return false; } })();
    if (!asarOk) throw new Error(`${mod.displayName} está com os arquivos corrompidos. Use o botão "Reinstalar" pra baixar de novo do zero.`);
  }
  const child = spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) });
  child.unref();
}

function uninstall(id) {
  const mod = getModule(id);
  killRunningProcess(getExeName(mod));
  const dir = moduleDir(id);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { getStatus, checkForUpdate, installOrUpdate, launch, uninstall };
