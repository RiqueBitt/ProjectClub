// Apps do ecossistema Project Club que entram na aba Apps sozinhos (sem
// a staff precisar cadastrar). Cada um tem o próprio repositório no GitHub
// (código + releases) e um módulo com o mesmo id em
// desktop/projectMcManager.js (download, instalação e abertura).
//
// Regras do "seed":
// - só cria a linha quando `released: true` (já existe release publicada,
//   senão o botão Instalar falharia);
// - nunca sobrescreve o que a staff editou: só preenche campos vazios e só
//   adiciona capturas de tela se o app ainda não tiver nenhuma.
const prisma = require('../config/prisma');

const shots = (id, names) => names.map((n) => `/apps/${id}/shots/${n}`);

const BUILTIN_APPS = [
  {
    moduleId: 'waveproject',
    released: true,
    pageRev: 1,
    order: 30,
    name: 'WaveProject',
    version: '1.0.0',
    description: 'Editor de áudio do Project Club: grave, corte, mixe e aplique efeitos em músicas, podcasts e vozes. Baseado no Audacity 4 (código aberto, GPL v3), com o tema do Project Club e atualizações pela aba Apps.',
    featuresText: [
      'Gravação de microfone e entrada de linha com medidores de nível',
      'Edição multipista: cortar, copiar, colar, dividir e mover clipes',
      'Efeitos em tempo real por faixa e efeitos aplicados (equalizador, compressor, reverb, redução de ruído, tom e tempo)',
      'Forma de onda e espectrograma',
      'Importa e exporta WAV, MP3, FLAC, OGG, AIFF e Opus',
      'Plugins VST3, LV2 e Nyquist',
      'Abre projetos .aup3 do Audacity e salva em .aup4',
      'Windows 10/11 (64 bits) e Linux (AppImage)',
      'Tecnologias: C++20, Qt 6 (QML), PortAudio, libsndfile — versão 1.0.0 (base Audacity 4.0)',
    ].join('\n'),
    sizeLabelWin: '~70 MB (download) · ~230 MB instalado',
    sizeLabelLinux: '~70 MB (AppImage)',
    requirementsWin: 'Windows 10 ou 11 (64 bits)\nCPU: 2 núcleos 2 GHz (recomendado 4)\nRAM: 2 GB mínimo — o app usa ~250–500 MB (8 GB para projetos longos)\nGPU: Direct3D 11 / OpenGL 3.3, uso leve\nDisco: ~230 MB + espaço dos projetos',
    requirementsLinux: 'Linux x86_64 com glibc 2.35+ (Ubuntu 22.04, Fedora 36, Debian 12 ou mais novo)\nCPU: 2 núcleos 2 GHz (recomendado 4)\nRAM: 2 GB mínimo — o app usa ~250–500 MB\nGPU: OpenGL 3.3, uso leve\nDisco: ~70 MB + espaço dos projetos\nÁudio: PulseAudio, PipeWire ou ALSA',
    screenshots: shots('waveproject', ['01-abertura-assistente.jpg', '02-assistente-1.jpg', '03-assistente-2.jpg', '07-projeto-com-audio.jpg', '08-ajustar-a-tela.jpg', '09-selecao.jpg', '10-zoom.jpg', '11-efeitos-em-tempo-real.jpg', '12-nova-faixa.jpg', '13-exportar.jpg', '16-importar.jpg', '17-novo-projeto.jpg']),
  },
  {
    moduleId: 'texelproject',
    released: true,
    pageRev: 2,
    order: 31,
    name: 'TexelProject',
    version: '1.0.0',
    description: 'Pintura de texturas 3D do Project Club: pinte direto em modelos 3D com materiais PBR, camadas, máscaras e pincéis, e exporte as texturas para jogos, mods e renders. Baseado no ArmorPaint (código aberto, licença zlib).',
    featuresText: [
      'Pintura em tempo real sobre modelos 3D (OBJ, FBX, glTF/GLB, BLEND)',
      'Materiais PBR (cor, rugosidade, metal, relevo) e editor de nós',
      'Camadas, grupos, máscaras e modos de mistura',
      'Pincel, borracha, preenchimento, decalque, texto, clonagem e desfoque',
      'Vista 2D da textura e vista 3D com iluminação HDR',
      'Exporta PNG/JPG/EXR com predefinições para Unreal, Unity e glTF',
      'Path tracing para pré-visualização em GPUs compatíveis',
      'Windows 10/11 (64 bits) e Linux (AppImage, Vulkan)',
      'Tecnologias: C, Iron/Kong (motor próprio), Direct3D 12 / Vulkan — versão 1.0.0 (base ArmorPaint 1.1)',
    ].join('\n'),
    sizeLabelWin: '~18 MB (download) · ~60 MB instalado',
    sizeLabelLinux: '~18 MB (AppImage)',
    requirementsWin: 'Windows 10 ou 11 (64 bits)\nCPU: 4 núcleos (recomendado 6+)\nRAM: 4 GB mínimo — o app usa ~0,8–2 GB (8–16 GB recomendado)\nGPU: Direct3D 12, 2 GB de VRAM (4 GB+ recomendado; ray tracing para o path tracer)\nDisco: ~60 MB + projetos',
    requirementsLinux: 'Linux x86_64 com driver Vulkan 1.1 (Mesa 22+, NVIDIA 470+)\nCPU: 4 núcleos\nRAM: 4 GB mínimo — o app usa ~0,8–2 GB\nGPU: Vulkan 1.1, 2 GB de VRAM\nDisco: ~18 MB + projetos\nBibliotecas: GTK 3 e ALSA (já vêm na maioria das distribuições)',
    screenshots: shots('texelproject', ['01-modelo-importado.jpg', '02-base-roxa.jpg', '03-cobre-metalico.jpg', '04-camadas.jpg', '05-detalhes-rosa.jpg', '06-editor-de-materiais.jpg', '07-vista-lateral.jpg', '08-vista-de-cima.jpg', '09-textura-2d.jpg', '10-navegador-de-arquivos.jpg', '11-exportar-texturas.jpg', '12-sem-distracoes.jpg']),
  },
  {
    moduleId: 'forgeproject',
    released: true,
    pageRev: 1,
    order: 32,
    name: 'ForgeProject',
    version: '1.0.0',
    description: 'Estúdio 3D do Project Club: modelagem, escultura, UV, materiais, animação, simulação, render (Cycles e EEVEE), composição e edição de vídeo. Baseado no Bforartists e no Blender (código aberto, GPL).',
    featuresText: [
      'Modelagem poligonal, modificadores, nós de geometria e escultura',
      'UV, pintura de texturas e materiais por nós',
      'Animação com esqueleto, restrições e editor de gráficos',
      'Render Cycles (path tracing) e EEVEE (tempo real)',
      'Física: tecido, fluidos, partículas e corpos rígidos',
      'Grease Pencil para desenho 2D/3D, composição e editor de vídeo',
      'Importa/exporta FBX, OBJ, glTF, USD, STL e Alembic',
      'Windows 10/11 (64 bits) e Linux (AppImage)',
      'Tecnologias: C/C++, Python 3.13, OpenGL/Vulkan, OpenImageIO, OpenVDB — versão 1.0.0 (base Bforartists / Blender 5)',
    ].join('\n'),
    sizeLabelWin: '~382 MB (download) · ~1,2 GB instalado',
    sizeLabelLinux: '~427 MB (AppImage)',
    requirementsWin: 'Windows 10 ou 11 (64 bits)\nCPU: 4 núcleos com SSE4.2 (8+ recomendado)\nRAM: 8 GB mínimo — o app usa ~0,5–2 GB; cenas grandes muito mais (16–32 GB recomendado)\nGPU: OpenGL 4.3, 2 GB de VRAM (8 GB recomendado; NVIDIA RTX / AMD RDNA2 para Cycles na GPU)\nDisco: ~1,2 GB + projetos',
    requirementsLinux: 'Linux x86_64 com glibc 2.28+\nCPU: 4 núcleos com SSE4.2\nRAM: 8 GB mínimo\nGPU: OpenGL 4.3, 2 GB de VRAM\nDisco: ~430 MB + projetos',
    screenshots: shots('forgeproject', ['01-tela-inicial.jpg', '02-cena-3d.jpg', '03-objeto-em-foco.jpg', '04-menu-adicionar.jpg', '05-materiais.jpg', '06-uv.jpg', '07-shading.jpg', '08-animacao.jpg', '09-nos-de-geometria.jpg', '10-scripting.jpg', '11-render.jpg']),
  },
  {
    moduleId: 'gameproject',
    released: true,
    pageRev: 1,
    order: 34,
    name: 'GameProject',
    version: '1.0.0',
    description: 'Criação de jogos do Project Club: monte jogos 2D e 3D num editor completo, com cenas, física, animação, interface, áudio e scripts, teste com um clique e exporte para várias plataformas. Baseado no Godot Engine (código aberto, MIT).',
    featuresText: [
      'Editor visual de cenas 2D e 3D com nós, cenas reutilizáveis e herança de cenas',
      'GDScript (parecido com Python) com autocompletar e depurador; C++ via GDExtension',
      'Física 2D e 3D, navegação, partículas, iluminação e pós-processamento',
      'Editor de animações, tilemaps e interface (UI) com temas',
      'Shaders visuais e em código, materiais PBR e importação de glTF, FBX e OBJ',
      'Áudio com barramentos, efeitos e som posicional',
      'Roda o jogo dentro do editor (aba Jogo) e exporta para Windows, Linux, Android e Web',
      'Windows 10/11 (64 bits) e Linux (AppImage) — tema do Project Club, interface em português e atualizações pela aba Apps',
      'Tecnologias: C++, Vulkan / Direct3D 12 / OpenGL — versão 1.0.0 (base Godot 4.8)',
    ].join('\n'),
    sizeLabelWin: '~86 MB (zip)',
    sizeLabelLinux: '~76 MB (AppImage)',
    requirementsWin: 'Windows 10 ou 11 (64 bits)\nCPU: 2 núcleos com SSE4.2 (4+ recomendado)\nRAM: 4 GB mínimo — o editor usa ~300 MB–1,5 GB conforme o projeto (8 GB recomendado)\nGPU: OpenGL 3.3 no modo Compatibilidade; Vulkan ou Direct3D 12 para Forward+\nDisco: ~150 MB + projetos',
    requirementsLinux: 'Linux x86_64 com glibc 2.35+ (Ubuntu 22.04 ou mais novo)\nCPU: 2 núcleos com SSE4.2\nRAM: 4 GB mínimo\nGPU: OpenGL 3.3 (Compatibilidade) ou Vulkan 1.0\nDisco: ~80 MB + projetos',
    screenshots: shots('gameproject', ['01-editor-3d.jpg', '02-inspetor.jpg', '03-editor-2d.jpg', '04-editor-de-script.jpg', '05-adicionar-no.jpg', '06-menu-projeto.jpg', '07-menu-editor.jpg', '08-menu-ajuda.jpg', '09-jogo-rodando.jpg', '10-gerenciador-de-projetos.jpg', '11-criar-projeto.jpg']),
  },
  {
    moduleId: 'canvasproject',
    released: false,
    order: 33,
    name: 'CanvasProject',
    version: '1.0.0',
    description: 'Pintura digital e ilustração do Project Club: pincéis realistas, camadas, mesa digitalizadora, animação quadro a quadro, quadrinhos e pixel art. Baseado no Krita (código aberto, GPL v3).',
    featuresText: [
      'Mais de 100 pincéis prontos e vários motores de pincel',
      'Camadas de pintura, vetor, filtro, preenchimento, máscaras e grupos',
      'Estabilizador de traço, assistentes de perspectiva e régua',
      'Animação quadro a quadro com papel cebola e linha do tempo',
      'Ferramentas para quadrinhos, texto e balões',
      'Gerenciamento de cor (ICC, OCIO) e HDR',
      'Abre e salva KRA, PSD, PNG, JPEG, WebP, TIFF e EXR',
      'Windows 10/11 (64 bits) e Linux (AppImage)',
      'Tecnologias: C++17, Qt, KDE Frameworks, OpenGL — versão 1.0.0 (base Krita 6)',
    ].join('\n'),
    sizeLabelWin: '~180 MB (download) · ~600 MB instalado',
    sizeLabelLinux: '~250 MB (AppImage)',
    requirementsWin: 'Windows 10 ou 11 (64 bits)\nCPU: 2 núcleos com SSE4.1 (4+ recomendado)\nRAM: 4 GB mínimo — o app usa ~400 MB–2 GB conforme o tamanho da tela (8–16 GB recomendado)\nGPU: OpenGL 3.0 / Direct3D 11\nDisco: ~600 MB + projetos\nMesa digitalizadora opcional (Wacom, XP-Pen, Huion)',
    requirementsLinux: 'Linux x86_64 com glibc 2.35+\nCPU: 2 núcleos com SSE4.1\nRAM: 4 GB mínimo — o app usa ~400 MB–2 GB\nGPU: OpenGL 3.0\nDisco: ~250 MB + projetos',
    screenshots: [],
  },
];

const FIELDS = ['name', 'description', 'version', 'featuresText', 'sizeLabelWin', 'sizeLabelLinux', 'requirementsWin', 'requirementsLinux'];

async function seedBuiltinApps() {
  for (const a of BUILTIN_APPS.filter((x) => x.released)) {
    try {
      const assets = { iconUrl: `/apps/${a.moduleId}/icon.png`, bannerUrl: `/apps/${a.moduleId}/banner.jpg` };
      const row = await prisma.appCatalogItem.findUnique({ where: { moduleId: a.moduleId }, include: { screenshots: true } });
      if (!row) {
        const data = { moduleId: a.moduleId, order: a.order, enabled: true, ...assets };
        for (const f of FIELDS) if (a[f]) data[f] = a[f];
        const created = await prisma.appCatalogItem.create({ data });
        if (a.screenshots.length) {
          await prisma.appScreenshot.createMany({ data: a.screenshots.map((imageUrl, i) => ({ appCatalogItemId: created.id, imageUrl, order: i })) });
        }
        console.log(`[apps] ${a.name} adicionado à aba Apps.`);
        continue;
      }
      // Já existe: só completa o que estiver vazio.
      const patch = {};
      for (const [k, v] of Object.entries(assets)) if (!row[k]) patch[k] = v;
      for (const f of FIELDS) if (!row[f] && a[f]) patch[f] = a[f];
      if (Object.keys(patch).length) await prisma.appCatalogItem.update({ where: { id: row.id }, data: patch });
      if (!row.screenshots.length && a.screenshots.length) {
        await prisma.appScreenshot.createMany({ data: a.screenshots.map((imageUrl, i) => ({ appCatalogItemId: row.id, imageUrl, order: i })) });
      }
    } catch (e) {
      console.error(`[apps] não consegui registrar ${a.name}:`, e?.message);
    }
  }
}

// Os apps que já estavam no catálogo (cadastrados pela staff) ganharam
// ícone e banner novos, no mesmo padrão dos apps acima, e o "DaVinci
// Project" passou a se chamar CutProject. Isso é aplicado UMA vez: só nas
// linhas que ninguém editou depois de REBRAND_CUTOFF. Depois de aplicada, a
// linha fica com updatedAt mais novo que o corte e nunca mais é tocada — se
// a staff trocar o ícone ou o texto depois, vale o que a staff colocou.
const REBRAND_CUTOFF = new Date('2026-10-12T06:00:00Z');
const REBRANDED_APPS = ['projectmc', 'photoproject', 'hyproject', 'davinciproject'];
const OLD_NAME = /DaVinci[ -]?Project/g;

async function rebrandLegacyApps() {
  try {
    const rows = await prisma.appCatalogItem.findMany({ where: { moduleId: { in: REBRANDED_APPS }, updatedAt: { lt: REBRAND_CUTOFF } } });
    for (const row of rows) {
      const id = row.moduleId;
      const data = { iconUrl: `/apps/${id}/icon.png`, bannerUrl: `/apps/${id}/banner.jpg` };
      if (id === 'davinciproject') {
        for (const f of ['name', 'description', 'featuresText']) {
          if (typeof row[f] === 'string' && OLD_NAME.test(row[f])) data[f] = row[f].replace(OLD_NAME, 'CutProject');
          OLD_NAME.lastIndex = 0;
        }
      }
      await prisma.appCatalogItem.update({ where: { id: row.id }, data });
      console.log(`[apps] ${data.name || row.name}: ícone e banner novos aplicados.`);
    }
  } catch (e) {
    console.error('[apps] não consegui atualizar ícones/nomes dos apps antigos:', e?.message);
  }
}


// Páginas completas (versão, descrição, recursos, tamanhos, requisitos e
// capturas reais) dos apps que já estavam no catálogo antes. Cada página tem
// uma revisão (pageRev): as capturas são gravadas com "?rev=N" no endereço e
// a página só é reaplicada quando o código traz uma revisão MAIOR que a do
// banco — depois disso, o que a staff editar continua valendo.
const LEGACY_APP_PAGES = [
  {
    moduleId: 'photoproject',
    pageRev: 1,
    order: 20,
    name: 'PhotoProject',
    version: '0.98.3',
    description: 'Editor de imagem do Project Club: retoque fotos, monte artes com camadas, edite arquivos do Photoshop (PSD/PSB) e automatize tarefas, com o tema do Project Club. Baseado no Patchy Image Editor (código aberto, MIT).',
    featuresText: [
      'Abre e salva PSD/PSB com camadas, máscaras, estilos de camada, texto e vetores editáveis',
      'Smart Objects e Smart Filters, ajustes não destrutivos e modos de mistura',
      'Curvas, níveis, matiz/saturação e dezenas de filtros',
      'Pincéis, seleção, recorte, clonagem, correção (healing), liquify, warp e gradientes',
      'Texto e formas vetoriais editáveis',
      'Camera RAW, HEIF/AVIF, WebP, JPEG XL, TIFF, PNG, SVG e PDF',
      'Plug-ins 8BF, scripts em JavaScript e automação pela linha de comando',
      'Windows 10/11 (64 bits) e Linux (AppImage) — tema do Project Club, atualizações pela aba Apps',
      'Tecnologias: C++20, Qt 6 — versão 0.98.3 (base Patchy)',
    ].join('\n'),
    sizeLabelWin: '~58 MB (zip)',
    sizeLabelLinux: '~51 MB (AppImage)',
    requirementsWin: 'Windows 10 ou 11 (64 bits)\nCPU: 2 núcleos com SSE4.1 (4+ recomendado)\nRAM: 4 GB mínimo — o app usa ~300 MB–2 GB conforme a imagem (8–16 GB para PSDs grandes)\nGPU: OpenGL 3.3\nDisco: ~250 MB + espaço das imagens',
    requirementsLinux: 'Linux x86_64 (glibc 2.35+, Ubuntu 22.04 ou mais novo)\nCPU: 2 núcleos com SSE4.1\nRAM: 4 GB mínimo\nGPU: OpenGL 3.3\nDisco: ~250 MB + espaço das imagens',
    shots: ['01-inicio', '02-novo-documento', '03-foto-aberta', '04-curvas', '05-niveis', '06-matiz-saturacao', '07-menu-filtro', '08-pincel-camadas', '09-selecao', '10-texto', '11-menu-camada', '12-menu-imagem', '13-menu-editar'],
  },
  {
    moduleId: 'projectmc',
    pageRev: 1,
    order: 21,
    name: 'ProjectMC',
    version: '1.6.0',
    description: 'Launcher de Minecraft do Project Club: organize instâncias, instale mods, modpacks, resource packs e shaders e entre no jogo com a sua conta, tudo em um só lugar. Baseado no X Minecraft Launcher (código aberto, MIT).',
    featuresText: [
      'Várias instâncias isoladas, cada uma com versão, mods e configurações próprias',
      'Instala Forge, NeoForge, Fabric, Quilt e OptiFine automaticamente',
      'Busca e instala mods, modpacks, resource packs e shaders do Modrinth e do CurseForge',
      'Importa e exporta modpacks (Modrinth .mrpack e CurseForge)',
      'Login com conta Microsoft e várias contas e skins',
      'Gerencia o Java automaticamente para cada versão do jogo',
      'Multiplayer entre amigos (P2P) e lista de servidores',
      'Tema do Project Club e atualizações pela aba Apps',
      'Windows 10/11 (64 bits) e Linux (AppImage)',
      'Tecnologias: Electron, TypeScript, Vue 3 — versão 1.6.0 (base X Minecraft Launcher)',
    ].join('\n'),
    sizeLabelWin: '~96 MB (download) · ~300 MB instalado',
    sizeLabelLinux: '~114 MB (AppImage)',
    requirementsWin: 'Windows 10 ou 11 (64 bits)\nCPU: 2 núcleos (4+ recomendado)\nRAM: 4 GB mínimo — o launcher usa ~200–400 MB; o jogo usa o que você reservar (8–16 GB para modpacks)\nGPU: OpenGL 3.3 (exigência do Minecraft Java)\nDisco: ~300 MB + espaço das instâncias',
    requirementsLinux: 'Linux x86_64 (Ubuntu 22.04, Fedora 36, Debian 12 ou mais novo)\nCPU: 2 núcleos (4+ recomendado)\nRAM: 4 GB mínimo\nGPU: OpenGL 3.3\nDisco: ~114 MB + espaço das instâncias',
    shots: ['01-idioma', '02-aparencia', '03-pasta-de-dados', '04-conta', '05-primeiros-passos', '06-instancia', '07-inicio-e-noticias', '08-loja-de-mods', '09-instancia-minecraft', '10-criar-jogo'],
  },
  {
    moduleId: 'hyproject',
    pageRev: 1,
    order: 22,
    name: 'HyProject',
    version: '1.1.0',
    description: 'Launcher de Hytale do Project Club: instale e atualize o jogo, organize perfis, gerencie mods e acompanhe as novidades, com o tema do Project Club. Baseado no HyPrism (código aberto, GPL v3).',
    featuresText: [
      'Instala, atualiza e repara o jogo',
      'Vários perfis, cada um com seus mods e configurações',
      'Gerenciador de mods: busca, instala, atualiza e ativa/desativa',
      'Notícias e notas de atualização do jogo dentro do launcher',
      'Gerencia o Java usado pelo jogo',
      'Memória, resolução e argumentos de inicialização configuráveis',
      'Interface em vários idiomas, tema do Project Club e atualizações pela aba Apps',
      'Windows 10/11 (64 bits) e Linux (AppImage)',
      'Tecnologias: .NET 10, React, TypeScript — versão 1.1.0 (base HyPrism)',
    ].join('\n'),
    sizeLabelWin: '~543 MB (download, portátil)',
    sizeLabelLinux: '~182 MB (AppImage)',
    requirementsWin: 'Windows 10 ou 11 (64 bits)\nCPU: 4 núcleos (6+ recomendado)\nRAM: 8 GB mínimo — o launcher usa ~200–400 MB; o jogo usa bem mais (16 GB recomendado)\nGPU: OpenGL 4.1, 2 GB de VRAM (4 GB+ recomendado)\nDisco: ~550 MB + espaço do jogo',
    requirementsLinux: 'Linux x86_64 (Ubuntu 22.04 ou mais novo)\nCPU: 4 núcleos\nRAM: 8 GB mínimo\nGPU: OpenGL 4.1, 2 GB de VRAM\nDisco: ~182 MB + espaço do jogo',
    shots: ['01-abertura', '02-autenticacao', '03-boas-vindas-idioma', '04-boas-vindas-2', '05-boas-vindas-3', '06-boas-vindas-4', '07-painel', '08-noticias', '09-perfis', '10-instancias', '11-configuracoes', '12-painel-2'],
  },
  {
    moduleId: 'davinciproject',
    pageRev: 2,
    order: 23,
    name: 'CutProject',
    version: '1.1.0',
    description: 'Editor de vídeo do Project Club: monte vídeos com várias faixas, corte, aplique efeitos, títulos e transições, corrija as cores e exporte para redes sociais ou em alta qualidade. Baseado no Sprocket (código aberto, MIT).',
    featuresText: [
      'Edição não destrutiva em linha do tempo multipista (miniaturas, forma de onda, encaixe e zoom)',
      'Qualquer formato de sequência, inclusive vertical para redes sociais',
      'Efeitos na GPU com keyframes, títulos, geradores, camadas de ajuste e transições',
      'Correção de cor: balanço de branco, rodas de cor, curvas, qualificador HSL e LUTs',
      'Mixer de áudio com envelopes de ganho, pan, mute e solo por faixa',
      'Mídia proxy e cache de render para editar com fluidez',
      'Exporta MP4 (H.264/AAC) e outros formatos, além de áudio (WAV/FLAC/MP3), com predefinições',
      'Salvamento automático, recuperação após falha e desfazer/refazer completo',
      'Windows 10/11 (64 bits) e Linux (AppImage) — tema do Project Club, atualizações pela aba Apps',
      'Tecnologias: C#/.NET 10, Avalonia, SkiaSharp, FFmpeg 8 — versão 1.1.0 (base Sprocket)',
    ].join('\n'),
    sizeLabelWin: '~141 MB (download) · ~400 MB instalado',
    sizeLabelLinux: '~131 MB (AppImage)',
    requirementsWin: 'Windows 10 ou 11 (64 bits)\nCPU: 4 núcleos (6–8 para 4K)\nRAM: 8 GB mínimo — o app usa ~0,5–3 GB conforme o projeto (16 GB recomendado)\nGPU: Direct3D 11 / OpenGL 3.3 com 2 GB de VRAM (4 GB+ recomendado)\nDisco: ~400 MB + mídia, proxies e cache',
    requirementsLinux: 'Linux x86_64 com glibc 2.35+ (Ubuntu 22.04 ou mais novo)\nCPU: 4 núcleos\nRAM: 8 GB mínimo\nGPU: OpenGL 3.3 com 2 GB de VRAM\nDisco: ~131 MB + mídia, proxies e cache',
    shots: ['01-projeto-de-exemplo', '02-reproduzindo', '03-clipe-selecionado', '04-menu-arquivo', '05-menu-clip', '06-menu-efeitos', '07-painel-efeitos', '08-painel-transicoes', '09-exportar', '10-menu-sequencia', '11-menu-janela'],
  },
];

const PAGE_FIELDS = ['name', 'description', 'version', 'featuresText', 'sizeLabelWin', 'sizeLabelLinux', 'requirementsWin', 'requirementsLinux'];
const revOf = (url) => Number((String(url).match(/[?&]rev=(\d+)/) || [])[1] || 0);

async function applyAppPages() {
  const pages = [
    ...BUILTIN_APPS.filter((a) => a.released && a.pageRev).map((a) => ({ ...a, shotUrls: a.screenshots })),
    ...LEGACY_APP_PAGES.map((a) => ({ ...a, shotUrls: shots(a.moduleId, a.shots.map((n) => `${n}.jpg`)) })),
  ];
  for (const pg of pages) {
    try {
      let row = await prisma.appCatalogItem.findUnique({ where: { moduleId: pg.moduleId }, include: { screenshots: true } });
      if (!row) {
        // App publicado que ainda não estava no catálogo: entra na aba Apps.
        row = await prisma.appCatalogItem.create({ data: { moduleId: pg.moduleId, name: pg.name, order: pg.order ?? 50, enabled: true } });
        row.screenshots = [];
        console.log(`[apps] ${pg.name} adicionado à aba Apps.`);
      }
      const applied = Math.max(0, ...row.screenshots.map((sc) => revOf(sc.imageUrl)));
      if (applied >= pg.pageRev) continue;
      const data = { iconUrl: `/apps/${pg.moduleId}/icon.png`, bannerUrl: `/apps/${pg.moduleId}/banner.jpg` };
      for (const f of PAGE_FIELDS) if (pg[f]) data[f] = pg[f];
      await prisma.appCatalogItem.update({ where: { id: row.id }, data });
      if (pg.shotUrls?.length) {
        await prisma.appScreenshot.deleteMany({ where: { appCatalogItemId: row.id } });
        await prisma.appScreenshot.createMany({
          data: pg.shotUrls.map((u, i) => ({ appCatalogItemId: row.id, imageUrl: `${u}?rev=${pg.pageRev}`, order: i })),
        });
      }
      console.log(`[apps] página do ${pg.name} atualizada (revisão ${pg.pageRev}, ${pg.shotUrls?.length || 0} capturas).`);
    } catch (e) {
      console.error(`[apps] não consegui atualizar a página do ${pg.name}:`, e?.message);
    }
  }
}

module.exports = { BUILTIN_APPS, LEGACY_APP_PAGES, seedBuiltinApps, rebrandLegacyApps, applyAppPages, shots };
