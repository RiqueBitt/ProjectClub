// Perfis de instalação de mods por jogo — item pedido: "cada jogo tem
// seu jeito de instalar mods, arrume isso". Antes o instalador só sabia
// "BepInEx/plugins se existir BepInEx, senão uma pasta Mods genérica".
// Agora cada jogo conhecido (chave = Steam AppID) diz:
// - qual loader/framework ele usa (BepInEx, MelonLoader, UE4SS, SMAPI,
//   tModLoader, ModEngine2, Script Hook V...), como saber se já está
//   instalado e se dá pra instalar sozinho;
// - ONDE os mods ficam (pasta do jogo ou pastas de dados do usuário,
//   tipo %APPDATA%, %LOCALAPPDATA% e Documentos — resolvidas por
//   sistema, inclusive dentro do prefixo do Proton no Linux);
// - COMO cada arquivo é encaminhado (rotas por estrutura/extensão);
// - o que olhar pra detectar mods que já estavam instalados.
// Jogos sem perfil caem numa detecção automática (BepInEx, MelonLoader,
// Unreal, Bethesda, pasta Mods...) — ver resolveProfile no final.
//
// Este arquivo é só DADOS + resolução de caminhos (sem Electron), pra
// poder ser testado com `node -e`. Quem usa é desktop/modRouter.js.
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------- Rotas ----------
// Cada rota é tentada em ordem pra cada arquivo extraído:
// - anchor: o caminho do arquivo contém a sequência de pastas `match`
//   (topOnly = só no começo). keep=true mantém a âncora no destino
//   ("BepInEx/plugins/x.dll" → <raiz>/BepInEx/plugins/x.dll); keep=false
//   descarta ("plugins/x.dll" → <alvo>/<mod>/x.dll se sub='{mod}').
// - marker: uma pasta que contém o arquivo `file` (ou extensão '*.ext')
//   é UM mod inteiro → <alvo>/<nome da pasta>.
// - ext: arquivos com essas extensões → <alvo>[/<mod>]/<nome do arquivo>.
// O que sobrar vai pra `fallback` (ou é ignorado, se for só leia-me/
// imagem — ver DOC_EXTS em modRouter.js).
const A = (match, target, opts = {}) => ({ type: 'anchor', match: [].concat(match), target, keep: true, ...opts });
const M = (file, target, opts = {}) => ({ type: 'marker', file, target, ...opts });
const E = (exts, target, opts = {}) => ({ type: 'ext', exts, target, ...opts });

// ---------- Construtores de perfil por "família" ----------
function bepinex(name, extra = {}) {
  return {
    name,
    family: 'bepinex',
    loader: {
      id: 'bepinex', label: 'BepInEx', required: true,
      check: ['BepInEx/core/BepInEx.dll', 'BepInEx/core/BepInEx.Preloader.dll', 'BepInEx/core/BepInEx.Core.dll'],
      autoInstall: 'thunderstore',
      howTo: 'Instale o BepInExPack deste jogo (o Project Club instala sozinho junto com o primeiro mod do Thunderstore).',
      signature: { anchor: ['BepInEx', 'core'] },
    },
    targets: {
      root: { base: 'game', path: '' },
      plugins: { base: 'game', path: 'BepInEx/plugins', label: 'BepInEx/plugins' },
      patchers: { base: 'game', path: 'BepInEx/patchers', label: 'BepInEx/patchers' },
      config: { base: 'game', path: 'BepInEx/config', label: 'BepInEx/config' },
      core: { base: 'game', path: 'BepInEx/core' },
      monomod: { base: 'game', path: 'BepInEx/monomod' },
    },
    primary: 'plugins',
    routes: [
      A(['BepInEx'], 'root'),
      A(['plugins'], 'plugins', { topOnly: true, keep: false, sub: '{mod}' }),
      A(['patchers'], 'patchers', { topOnly: true, keep: false, sub: '{mod}' }),
      A(['monomod'], 'monomod', { topOnly: true, keep: false, sub: '{mod}' }),
      A(['config'], 'config', { topOnly: true, keep: false }),
      A(['core'], 'core', { topOnly: true, keep: false }),
    ],
    fallback: { target: 'plugins', sub: '{mod}' },
    scan: [{ target: 'plugins' }, { target: 'patchers', skip: ['BepInEx.MultiFolderLoader.dll'] }],
    configDir: 'BepInEx/config',
    notes: ['Os mods (.dll) ficam em BepInEx/plugins, cada um na sua pasta.'],
    certainty: 'known',
    ...extra,
  };
}

function melonloader(name, extra = {}) {
  return {
    name,
    family: 'melonloader',
    loader: {
      id: 'melonloader', label: 'MelonLoader', required: true,
      check: ['MelonLoader/net6/MelonLoader.dll', 'MelonLoader/MelonLoader.dll', 'MelonLoader/net35/MelonLoader.dll', 'version.dll'],
      autoInstall: null,
      howTo: 'Instale o MelonLoader uma vez pelo instalador oficial (MelonLoader.Installer) e abra o jogo uma vez.',
      signature: { anchor: ['MelonLoader'] },
    },
    targets: {
      root: { base: 'game', path: '' },
      mods: { base: 'game', path: 'Mods', label: 'Mods' },
      plugins: { base: 'game', path: 'Plugins', label: 'Plugins' },
      userlibs: { base: 'game', path: 'UserLibs' },
    },
    primary: 'mods',
    routes: [
      A(['Mods'], 'root', { topOnly: true }),
      A(['Plugins'], 'root', { topOnly: true }),
      A(['UserLibs'], 'root', { topOnly: true }),
      A(['UserData'], 'root', { topOnly: true }),
      // MelonLoader só lê .dll soltos direto em Mods/ (sem subpasta).
      E(['.dll'], 'mods'),
    ],
    fallback: null,
    scan: [{ target: 'mods', exts: ['.dll'] }, { target: 'plugins', exts: ['.dll'] }],
    configDir: 'UserData',
    notes: ['MelonLoader só carrega os .dll que estão soltos direto na pasta Mods.'],
    certainty: 'known',
    ...extra,
  };
}

// Jogos Unreal: .pak/.utoc/.ucas vão em <Projeto>/Content/Paks/~mods (a
// Unreal monta qualquer .pak dentro de Paks, inclusive em subpastas).
// Mods de script (Lua/C++) usam o UE4SS, em <Projeto>/Binaries/Win64/Mods
// (ou .../ue4ss/Mods nas versões novas).
const UE4SS_BUILTIN = ['shared', 'ActorDumperMod', 'BPML_GenericFunctions', 'BPModLoaderMod', 'CheatManagerEnablerMod', 'ConsoleCommandsMod', 'ConsoleEnablerMod', 'Keybinds', 'LineTraceMod', 'SplitScreenMod', 'jsbLuaProfilerMod', 'mods.txt', 'mods.json'];
function unreal(name, project, extra = {}) {
  const bin = `${project}/Binaries/Win64`;
  return {
    name,
    family: 'unreal',
    loader: {
      id: 'ue4ss', label: 'UE4SS', required: false,
      check: [`${bin}/ue4ss/UE4SS.dll`, `${bin}/UE4SS.dll`, `${bin}/dwmapi.dll`],
      autoInstall: null,
      howTo: 'Só mods de script (Lua) precisam do UE4SS — mods .pak funcionam sem nada extra.',
      signature: { file: 'UE4SS.dll' },
      installTo: bin,
    },
    targets: {
      root: { base: 'game', path: '' },
      paks: { base: 'game', path: `${project}/Content/Paks/~mods`, label: `${project}/Content/Paks/~mods` },
      ue4ss: { base: 'game', path: [`${bin}/ue4ss/Mods`, `${bin}/Mods`], label: 'Mods do UE4SS' },
      logicmods: { base: 'game', path: `${project}/Content/Paks/LogicMods`, label: 'LogicMods' },
    },
    primary: 'paks',
    routes: [
      A([project, 'Content'], 'root'),
      A([project, 'Binaries'], 'root'),
      A(['Content', 'Paks'], 'root', { keep: false, prefix: `${project}/Content/Paks` }),
      A(['~mods'], 'paks', { keep: false }),
      A(['LogicMods'], 'logicmods', { keep: false }),
      M('Scripts/main.lua', 'ue4ss', { touch: 'enabled.txt' }),
      M('dlls/main.dll', 'ue4ss', { touch: 'enabled.txt' }),
      E(['.pak', '.utoc', '.ucas', '.sig'], 'paks', { sub: '{mod}' }),
    ],
    fallback: null,
    unsupportedExts: ['.exe'],
    scan: [{ target: 'paks' }, { target: 'logicmods' }, { target: 'ue4ss', skip: UE4SS_BUILTIN }],
    notes: ['Mods .pak/.utoc/.ucas vão em ~mods. Mods de script (Lua) precisam do UE4SS.'],
    certainty: 'known',
    ...extra,
  };
}

// Bethesda (Creation Engine): tudo dentro de Data. A ordem de carga
// (plugins.txt/loadorder.txt) NÃO é mexida pelo Project Club.
const BETHESDA_VANILLA = /^(skyrim|update|dawnguard|hearthfires|dragonborn|fallout4|falloutnv|fallout3|oblivion|starfield|morrowind|tribunal|bloodmoon|deadmoney|honesthearts|oldworldblues|lonesomeroad|gunrunnersarsenal|caravanpack|classicpack|mercenarypack|tribalpack|anchorage|thepitt|brokensteel|pointlookout|zeta|knights|dlc[\w-]*|blueprintships-starfield|constellation|oldmars|sfbgs[\w-]*|shatteringisles|_resourcepack)\.(esm|esp|esl)$|^cc[\w-]*\.(esm|esl|esp)$/i;
function bethesda(name, scriptExtender, extra = {}) {
  const dataDir = extra.dataDir || 'Data';
  return {
    name,
    family: 'bethesda',
    loader: scriptExtender ? {
      id: scriptExtender.id, label: scriptExtender.label, required: false,
      check: [scriptExtender.exe], autoInstall: null,
      howTo: `Alguns mods precisam do ${scriptExtender.label} — instale manualmente e abra o jogo pelo ${scriptExtender.exe}.`,
      signature: { file: scriptExtender.exe },
    } : null,
    targets: {
      root: { base: 'game', path: '' },
      data: { base: 'game', path: dataDir, label: dataDir },
    },
    primary: 'data',
    routes: [
      A([dataDir], 'root', { topOnly: false }),
      A(['meshes'], 'data', { topOnly: true }), A(['textures'], 'data', { topOnly: true }),
      A(['scripts'], 'data', { topOnly: true }), A(['interface'], 'data', { topOnly: true }),
      A(['sound'], 'data', { topOnly: true }), A(['music'], 'data', { topOnly: true }),
      A(['strings'], 'data', { topOnly: true }), A(['seq'], 'data', { topOnly: true }),
      A(['materials'], 'data', { topOnly: true }), A(['skse'], 'data', { topOnly: true }),
      A(['f4se'], 'data', { topOnly: true }), A(['nvse'], 'data', { topOnly: true }),
      A(['sfse'], 'data', { topOnly: true }), A(['obse'], 'data', { topOnly: true }),
      A(['shadersfx'], 'data', { topOnly: true }), A(['lodsettings'], 'data', { topOnly: true }),
      A(['grass'], 'data', { topOnly: true }), A(['video'], 'data', { topOnly: true }),
      E(['.esp', '.esm', '.esl', '.bsa', '.ba2'], 'data'),
    ],
    fallback: { target: 'data' },
    unsupportedExts: ['.fomod'],
    scan: [{ target: 'data', exts: ['.esp', '.esm', '.esl'], exclude: BETHESDA_VANILLA }],
    notes: [
      'Mods vão na pasta Data. A ordem de carga (plugins.txt) não é alterada pelo Project Club — ative os plugins no launcher/menu de mods do jogo.',
      'Instaladores FOMOD com opções não são suportados: o Project Club copia os arquivos como vieram.',
    ],
    certainty: 'known',
    ...extra,
  };
}

function source(name, gameDir, extra = {}) {
  return {
    name,
    family: 'source',
    loader: null,
    targets: {
      root: { base: 'game', path: '' },
      addons: { base: 'game', path: `${gameDir}/${extra.addonsDir || 'addons'}`, label: `${gameDir}/${extra.addonsDir || 'addons'}` },
      game: { base: 'game', path: gameDir },
    },
    primary: 'addons',
    routes: [
      A([gameDir], 'root', { topOnly: true }),
      A([extra.addonsDir || 'addons'], 'game', { topOnly: true }),
      E(['.vpk', '.gma'], 'addons'),
    ],
    fallback: { target: 'addons', sub: '{mod}' },
    scan: [{ target: 'addons', skip: ['workshop', 'addonlist.txt', 'addonimage.jpg', 'readme.txt', 'sourcemod'] }],
    notes: [`Addons (.vpk ou pastas) ficam em ${gameDir}/${extra.addonsDir || 'addons'}.`],
    certainty: 'known',
    ...extra,
  };
}

function modEngine(name, extra = {}) {
  return {
    name,
    family: 'modengine2',
    loader: {
      id: 'modengine2', label: 'ModEngine2', required: true,
      check: ['Game/modengine2_launcher.exe', 'Game/ModEngine2/modengine2_launcher.exe', 'Game/ModEngine2/launchmod_eldenring.bat', 'Game/launchmod_eldenring.bat', 'Game/launchmod_darksouls3.bat', 'Game/launchmod_armoredcore6.bat'],
      autoInstall: null,
      howTo: 'Instale o ModEngine2 dentro da pasta Game e abra o jogo pelo launchmod_*.bat (sem o anti-cheat, só offline).',
      signature: { file: 'modengine2_launcher.exe' },
      installTo: 'Game',
    },
    targets: {
      root: { base: 'game', path: '' },
      mod: { base: 'game', path: ['Game/ModEngine2/mod', 'Game/mod'], label: 'Game/mod (ModEngine2)' },
      dllmods: { base: 'game', path: 'Game/mods', label: 'Game/mods (Mod Loader)' },
    },
    primary: 'mod',
    routes: [
      A(['Game'], 'root', { topOnly: true }),
      A(['mod'], 'mod', { topOnly: true, keep: false }),
      ...['parts', 'chr', 'sfx', 'menu', 'msg', 'param', 'event', 'map', 'script', 'action', 'asset', 'font', 'material', 'movie', 'other', 'shader', 'sound', 'cutscene'].map((d) => A([d], 'mod', { topOnly: true })),
      E(['.bin', '.dcx', '.bdt', '.bhd'], 'mod'),
      E(['.dll'], 'dllmods'),
    ],
    fallback: null,
    scan: [{ target: 'mod' }, { target: 'dllmods', exts: ['.dll'] }],
    notes: ['Mods de arquivo vão em Game/mod (usado pelo ModEngine2). Use só offline — o anti-cheat bane quem joga online com mods.'],
    certainty: 'partial',
    ...extra,
  };
}

function folderMods(name, targetSpec, extra = {}) {
  return {
    name,
    family: extra.family || 'folder',
    loader: extra.loader || null,
    targets: { root: { base: 'game', path: '' }, mods: targetSpec },
    primary: 'mods',
    routes: extra.routes || [],
    fallback: extra.fallback === undefined ? { target: 'mods', sub: '{mod}' } : extra.fallback,
    scan: extra.scan || [{ target: 'mods' }],
    notes: extra.notes || [],
    certainty: extra.certainty || 'known',
    ...extra,
  };
}

// ---------- Tabela por Steam AppID ----------
const PROFILES = {
  // Unity + BepInEx (Thunderstore)
  1966720: bepinex('Lethal Company'),
  892970: bepinex('Valheim'),
  632360: bepinex('Risk of Rain 2'),
  1337520: bepinex('Risk of Rain Returns'),
  2881650: bepinex('Content Warning'),
  3241660: bepinex('R.E.P.O.'),
  1604030: bepinex('V Rising'),
  1366540: bepinex('Dyson Sphere Program'),
  1092790: bepinex('Inscryption'),
  1432860: bepinex('Sun Haven'),
  1625450: bepinex('Muck'),
  1557740: bepinex('ROUNDS'),
  794260: bepinex('Outward'),
  311690: bepinex('Enter the Gungeon'),
  264710: bepinex('Subnautica'),
  848450: bepinex('Subnautica: Below Zero'),
  1229490: bepinex('ULTRAKILL'),
  1562430: bepinex('DREDGE'),
  945360: bepinex('Among Us', { certainty: 'partial' }),
  1533390: bepinex('Gorilla Tag', { certainty: 'partial' }),

  // Unity + MelonLoader
  960090: melonloader('Bloons TD 6'),
  305620: melonloader('The Long Dark'),
  1592190: melonloader('BONELAB', { certainty: 'partial' }),

  // Unreal
  1623730: unreal('Palworld', 'Pal'),
  990080: unreal('Hogwarts Legacy', 'Phoenix'),
  2358720: unreal('Black Myth: Wukong', 'b1'),
  1272080: unreal('PAYDAY 3', 'PAYDAY3'),
  1144200: unreal('Ready or Not', 'ReadyOrNot'),
  1332010: unreal('Stray', 'Hk_project', { certainty: 'partial' }),
  1627720: unreal('Lies of P', 'LiesofP', { certainty: 'partial' }),
  1778820: unreal('TEKKEN 8', 'Polaris', { certainty: 'partial' }),
  1774580: unreal('STAR WARS Jedi: Survivor', 'SwGame', { certainty: 'partial' }),
  1282100: unreal('Remnant II', 'Remnant2', { certainty: 'partial' }),
  668580: unreal('Atomic Heart', 'AtomicHeart', { certainty: 'partial' }),
  1817230: unreal('Hi-Fi RUSH', 'Hibiki', { certainty: 'partial' }),
  962130: unreal('Grounded', 'Maine', { certainty: 'partial' }),
  1462040: unreal('FINAL FANTASY VII REMAKE INTERGRADE', 'End', { certainty: 'partial' }),

  // Bethesda
  489830: bethesda('The Elder Scrolls V: Skyrim Special Edition', { id: 'skse', label: 'SKSE', exe: 'skse64_loader.exe' }),
  72850: bethesda('The Elder Scrolls V: Skyrim', { id: 'skse', label: 'SKSE', exe: 'skse_loader.exe' }),
  377160: bethesda('Fallout 4', { id: 'f4se', label: 'F4SE', exe: 'f4se_loader.exe' }),
  22380: bethesda('Fallout: New Vegas', { id: 'nvse', label: 'xNVSE', exe: 'nvse_loader.exe' }),
  22370: bethesda('Fallout 3', { id: 'fose', label: 'FOSE', exe: 'fose_loader.exe' }),
  22330: bethesda('The Elder Scrolls IV: Oblivion', { id: 'obse', label: 'OBSE', exe: 'obse_loader.exe' }),
  1716740: bethesda('Starfield', { id: 'sfse', label: 'SFSE', exe: 'sfse_loader.exe' }, {
    certainty: 'partial',
    notes: ['Plugins (.esm/.esp) vão em Data. Arquivos soltos podem precisar de "bInvalidateOlderFiles=1" no StarfieldCustom.ini.', 'A ordem de carga não é alterada pelo Project Club.'],
  }),
  22320: bethesda('The Elder Scrolls III: Morrowind', null, { dataDir: 'Data Files', certainty: 'partial' }),

  // Source
  4000: source("Garry's Mod", 'garrysmod'),
  550: source('Left 4 Dead 2', 'left4dead2'),
  440: source('Team Fortress 2', 'tf', { addonsDir: 'custom' }),
  730: {
    name: 'Counter-Strike 2', family: 'none', loader: null,
    targets: { root: { base: 'game', path: '' } }, primary: null, routes: [], fallback: null, scan: [],
    blocked: 'Counter-Strike 2 não aceita mods de arquivo no jogo online (VAC). Use só mapas/servidores pela própria Steam.',
    notes: ['Counter-Strike 2 não aceita mods de arquivo no online (risco de ban VAC).'],
    certainty: 'known',
  },

  // Jogos com estrutura própria
  413150: folderMods('Stardew Valley', { base: 'game', path: 'Mods', label: 'Mods' }, {
    family: 'smapi',
    loader: {
      id: 'smapi', label: 'SMAPI', required: true,
      check: ['StardewModdingAPI.exe', 'StardewModdingAPI', 'StardewModdingAPI.dll', 'Contents/MacOS/StardewModdingAPI'],
      autoInstall: null,
      howTo: 'Baixe o instalador do SMAPI (smapi.io), rode uma vez e abra o jogo pelo SMAPI.',
    },
    routes: [A(['Mods'], 'root', { topOnly: true }), M('manifest.json', 'mods')],
    scan: [{ target: 'mods', skip: ['ConsoleCommands', 'SaveBackup', 'ErrorHandler'] }],
    notes: ['Cada mod é uma pasta com manifest.json dentro de Mods. Precisa do SMAPI.'],
  }),
  294100: folderMods('RimWorld', { base: 'game', path: 'Mods', label: 'Mods' }, {
    routes: [A(['Mods'], 'root', { topOnly: true }), M('About/About.xml', 'mods')],
    notes: ['Cada mod é uma pasta com About/About.xml. Ative na lista de mods dentro do jogo (a ordem não é alterada aqui).'],
  }),
  261550: folderMods('Mount & Blade II: Bannerlord', { base: 'game', path: 'Modules', label: 'Modules' }, {
    routes: [A(['Modules'], 'root', { topOnly: true }), M('SubModule.xml', 'mods')],
    scan: [{ target: 'mods', skip: ['Native', 'SandBox', 'SandBoxCore', 'StoryMode', 'CustomBattle', 'BirthAndDeath', 'Multiplayer', 'NavalDLC'] }],
    notes: ['Cada mod é uma pasta com SubModule.xml em Modules. Ative no launcher do jogo.'],
  }),
  48700: folderMods('Mount & Blade: Warband', { base: 'game', path: 'Modules', label: 'Modules' }, {
    routes: [A(['Modules'], 'root', { topOnly: true }), M('module.ini', 'mods')],
    scan: [{ target: 'mods', skip: ['Native', 'Napoleonic Wars', 'Viking Conquest', 'Sandbox'] }],
    certainty: 'partial',
  }),
  367520: folderMods('Hollow Knight', { base: 'game', path: 'hollow_knight_Data/Managed/Mods', label: 'hollow_knight_Data/Managed/Mods' }, {
    family: 'hkapi',
    loader: {
      id: 'hkapi', label: 'Modding API', required: true,
      check: ['hollow_knight_Data/Managed/MMHOOK_Assembly-CSharp.dll', 'hollow_knight_Data/Managed/Mods'],
      autoInstall: null,
      howTo: 'Instale a Modding API uma vez (pelo Lumafly/Scarab).',
    },
    routes: [A(['hollow_knight_Data'], 'root', { topOnly: true }), A(['Mods'], 'mods', { topOnly: true, keep: false })],
    scan: [{ target: 'mods', skip: ['Disabled', 'Vasi'] }],
    notes: ['Cada mod fica numa pasta em hollow_knight_Data/Managed/Mods. Precisa da Modding API.'],
  }),
  105600: folderMods('Terraria (tModLoader)', {
    base: 'documents', path: 'My Games/Terraria/tModLoader/Mods', label: 'Documentos/My Games/Terraria/tModLoader/Mods',
    native: { base: 'home', path: '.local/share/Terraria/tModLoader/Mods' },
  }, {
    family: 'tmodloader',
    loader: {
      id: 'tmodloader', label: 'tModLoader', required: true,
      check: ['../tModLoader/tModLoader.dll', '../tModLoader/tModLoader.exe', '../tModLoader/start-tModLoader.bat'],
      autoInstall: null,
      howTo: 'Mods de Terraria rodam no tModLoader — instale-o (grátis) pela Steam.',
    },
    routes: [E(['.tmod'], 'mods')],
    fallback: null,
    scan: [{ target: 'mods', exts: ['.tmod'] }],
    notes: ['Mods (.tmod) ficam em Documentos/My Games/Terraria/tModLoader/Mods. Ative no menu Mods do tModLoader.'],
  }),
  1281930: folderMods('tModLoader', {
    base: 'documents', path: 'My Games/Terraria/tModLoader/Mods', label: 'Documentos/My Games/Terraria/tModLoader/Mods',
    native: { base: 'home', path: '.local/share/Terraria/tModLoader/Mods' },
  }, {
    family: 'tmodloader',
    routes: [E(['.tmod'], 'mods')],
    fallback: null,
    scan: [{ target: 'mods', exts: ['.tmod'] }],
    notes: ['Mods (.tmod) ficam em Documentos/My Games/Terraria/tModLoader/Mods. Ative no menu Mods do jogo.'],
  }),
  427520: folderMods('Factorio', {
    base: 'appdata', path: 'Factorio/mods', label: '%APPDATA%/Factorio/mods',
    native: { base: 'home', path: '.factorio/mods' },
  }, {
    keepArchive: ['.zip'],
    routes: [E(['.zip'], 'mods')],
    fallback: null,
    scan: [{ target: 'mods', exts: ['.zip'], dirs: true, skip: ['mod-list.json', 'mod-settings.dat'] }],
    notes: ['Factorio lê o .zip do mod direto (não extrai). A lista de ativos fica no próprio jogo (mod-list.json).'],
  }),
  292030: folderMods('The Witcher 3', { base: 'game', path: 'mods', label: 'mods' }, {
    targets: { root: { base: 'game', path: '' }, mods: { base: 'game', path: 'mods', label: 'mods' }, dlc: { base: 'game', path: 'dlc', label: 'dlc' } },
    routes: [
      A(['mods'], 'root', { topOnly: true }), A(['dlc'], 'root', { topOnly: true }), A(['bin'], 'root', { topOnly: true }),
      M('content', 'mods', { dirMarker: true, prefix: 'mod' }),
    ],
    fallback: { target: 'mods', sub: 'mod{mod}' },
    scan: [{ target: 'mods' }],
    notes: ['Cada mod é uma pasta "modNome" dentro de mods. Conflitos de script (Script Merger) não são resolvidos aqui.'],
  }),
  1091500: folderMods('Cyberpunk 2077', { base: 'game', path: 'archive/pc/mod', label: 'archive/pc/mod' }, {
    targets: {
      root: { base: 'game', path: '' },
      mods: { base: 'game', path: 'archive/pc/mod', label: 'archive/pc/mod' },
      reds: { base: 'game', path: 'r6/scripts', label: 'r6/scripts' },
      redmod: { base: 'game', path: 'mods', label: 'mods (REDmod)' },
      cet: { base: 'game', path: 'bin/x64/plugins/cyber_engine_tweaks/mods', label: 'CET mods' },
    },
    routes: [
      A(['archive'], 'root', { topOnly: true }), A(['bin'], 'root', { topOnly: true }), A(['r6'], 'root', { topOnly: true }),
      A(['red4ext'], 'root', { topOnly: true }), A(['engine'], 'root', { topOnly: true }), A(['mods'], 'root', { topOnly: true }),
      A(['archive', 'pc', 'mod'], 'root'),
      E(['.archive', '.xl'], 'mods'),
      E(['.reds'], 'reds', { sub: '{mod}' }),
    ],
    fallback: null,
    scan: [{ target: 'mods', exts: ['.archive'] }, { target: 'reds' }, { target: 'redmod' }, { target: 'cet' }],
    notes: ['.archive vão em archive/pc/mod; scripts .reds em r6/scripts (precisam do redscript). Mods do CET precisam do Cyber Engine Tweaks.'],
  }),
  1086940: folderMods("Baldur's Gate 3", {
    base: 'localappdata', path: "Larian Studios/Baldur's Gate 3/Mods", label: "%LOCALAPPDATA%/Larian Studios/Baldur's Gate 3/Mods",
  }, {
    routes: [A(['bin'], 'root', { topOnly: true }), E(['.pak'], 'mods')],
    fallback: null,
    scan: [{ target: 'mods', exts: ['.pak'] }],
    loadOrderUnsupported: true,
    notes: [
      "Mods (.pak) vão em %LOCALAPPDATA%/Larian Studios/Baldur's Gate 3/Mods.",
      'A ordem de carga (modsettings.lsx) NÃO é feita pelo Project Club — ative os mods no gerenciador de mods do jogo ou no BG3 Mod Manager.',
    ],
  }),
  1222670: folderMods('The Sims 4', {
    base: 'documents', path: 'Electronic Arts/The Sims 4/Mods', label: 'Documentos/Electronic Arts/The Sims 4/Mods',
  }, {
    routes: [A(['Mods'], 'mods', { topOnly: true, keep: false }), E(['.package', '.ts4script'], 'mods', { sub: '{mod}' })],
    fallback: null,
    scan: [{ target: 'mods', skip: ['Resource.cfg'] }],
    notes: ['Mods (.package/.ts4script) vão em Documentos/Electronic Arts/The Sims 4/Mods. Ative "Mods de script" nas opções do jogo.'],
  }),
  255710: folderMods('Cities: Skylines', {
    base: 'localappdata', path: 'Colossal Order/Cities_Skylines/Addons/Mods', label: '%LOCALAPPDATA%/Colossal Order/Cities_Skylines/Addons/Mods',
    native: { base: 'home', path: '.local/share/Colossal Order/Cities_Skylines/Addons/Mods' },
  }, {
    targets: {
      root: { base: 'game', path: '' },
      mods: { base: 'localappdata', path: 'Colossal Order/Cities_Skylines/Addons/Mods', label: 'Addons/Mods', native: { base: 'home', path: '.local/share/Colossal Order/Cities_Skylines/Addons/Mods' } },
      assets: { base: 'localappdata', path: 'Colossal Order/Cities_Skylines/Addons/Assets', label: 'Addons/Assets', native: { base: 'home', path: '.local/share/Colossal Order/Cities_Skylines/Addons/Assets' } },
    },
    routes: [E(['.crp'], 'assets')],
    scan: [{ target: 'mods' }, { target: 'assets', exts: ['.crp'] }],
    certainty: 'partial',
  }),
  289070: folderMods("Sid Meier's Civilization VI", {
    base: 'documents', path: "My Games/Sid Meier's Civilization VI/Mods", label: "Documentos/My Games/Sid Meier's Civilization VI/Mods",
    native: { base: 'home', path: ".local/share/aspyr-media/Sid Meier's Civilization VI/Mods" },
  }, { routes: [M('*.modinfo', 'mods')], certainty: 'partial' }),
  457140: folderMods('Oxygen Not Included', {
    base: 'documents', path: 'Klei/OxygenNotIncluded/mods/Local', label: 'Documentos/Klei/OxygenNotIncluded/mods/Local',
    native: { base: 'home', path: '.config/unity3d/Klei/Oxygen Not Included/mods/Local' },
  }, { certainty: 'partial' }),
  322330: folderMods("Don't Starve Together", { base: 'game', path: 'mods', label: 'mods' }, {
    routes: [M('modinfo.lua', 'mods')],
    scan: [{ target: 'mods', skip: ['dedicated_server_mods_setup.lua', 'modsettings.lua'] }],
  }),
  108600: folderMods('Project Zomboid', { base: 'home', path: 'Zomboid/mods', label: '~/Zomboid/mods' }, {
    routes: [A(['mods'], 'mods', { topOnly: true, keep: false })],
    certainty: 'partial',
  }),
  251570: folderMods('7 Days to Die', { base: 'game', path: 'Mods', label: 'Mods' }, {
    routes: [A(['Mods'], 'root', { topOnly: true }), M('ModInfo.xml', 'mods')],
    scan: [{ target: 'mods', skip: ['0_TFP_Harmony', 'TFP_CommandExtensions', 'TFP_MapRendering', 'TFP_WebServer', 'Xample_MarkersMod'] }],
  }),
  220200: folderMods('Kerbal Space Program', { base: 'game', path: 'GameData', label: 'GameData' }, {
    routes: [A(['GameData'], 'root')],
    scan: [{ target: 'mods', skip: ['Squad', 'SquadExpansion', 'ModuleManager.ConfigCache', 'ModuleManager.ConfigSHA', 'ModuleManager.Physics', 'ModuleManager.TechTree'] }],
  }),
  233860: folderMods('Kenshi', { base: 'game', path: 'mods', label: 'mods' }, { routes: [A(['mods'], 'root', { topOnly: true }), M('*.mod', 'mods')], certainty: 'partial' }),
  268500: folderMods('XCOM 2', { base: 'game', path: 'XComGame/Mods', label: 'XComGame/Mods' }, { routes: [M('*.XComMod', 'mods')], certainty: 'partial' }),
  262060: folderMods('Darkest Dungeon', { base: 'game', path: 'mods', label: 'mods' }, { routes: [M('project.xml', 'mods')], certainty: 'partial' }),
  629730: folderMods('Blade & Sorcery', { base: 'game', path: 'BladeAndSorcery_Data/StreamingAssets/Mods', label: 'StreamingAssets/Mods' }, {
    routes: [A(['Mods'], 'mods', { topOnly: true, keep: false }), M('manifest.json', 'mods')], certainty: 'partial',
  }),
  646570: folderMods('Slay the Spire', { base: 'game', path: 'mods', label: 'mods' }, {
    routes: [E(['.jar'], 'mods')], fallback: null, scan: [{ target: 'mods', exts: ['.jar'] }],
    notes: ['Mods (.jar) precisam do ModTheSpire (pela Steam Workshop).'], certainty: 'partial',
  }),
  504230: folderMods('Celeste', { base: 'game', path: 'Mods', label: 'Mods' }, {
    family: 'everest',
    loader: {
      id: 'everest', label: 'Everest', required: true,
      check: ['MiniInstaller.exe', 'Celeste.Mod.mm.dll', 'everest-lib'],
      autoInstall: null,
      howTo: 'Instale o Everest (pelo Olympus) uma vez.',
    },
    keepArchive: ['.zip'],
    routes: [E(['.zip'], 'mods')],
    scan: [{ target: 'mods', skip: ['Cache', 'blacklist.txt', 'updaterblacklist.txt', 'favorites.txt'] }],
    notes: ['O Everest lê o .zip do mod direto da pasta Mods (não precisa extrair).'],
  }),
  218620: folderMods('PAYDAY 2', { base: 'game', path: 'mods', label: 'mods' }, {
    family: 'superblt',
    targets: {
      root: { base: 'game', path: '' },
      mods: { base: 'game', path: 'mods', label: 'mods (SuperBLT)' },
      overrides: { base: 'game', path: 'assets/mod_overrides', label: 'assets/mod_overrides' },
    },
    loader: {
      id: 'superblt', label: 'SuperBLT', required: true,
      check: ['WSOCK32.dll', 'IPHLPAPI.dll'],
      autoInstall: null,
      howTo: 'Instale o SuperBLT (coloque o WSOCK32.dll na pasta do jogo) uma vez.',
      signature: { file: 'WSOCK32.dll' },
    },
    routes: [A(['mods'], 'root', { topOnly: true }), A(['assets'], 'root', { topOnly: true }), M('mod.txt', 'mods'), M('main.xml', 'mods')],
    fallback: { target: 'overrides', sub: '{mod}' },
    scan: [{ target: 'mods', skip: ['base', 'logs', 'downloads', 'saves'] }, { target: 'overrides' }],
    certainty: 'partial',
  }),
  1142710: folderMods('Total War: WARHAMMER III', { base: 'game', path: 'data', label: 'data' }, {
    routes: [E(['.pack'], 'mods')], fallback: null,
    scan: [{ target: 'mods', exts: ['.pack'], exclude: /^(audio|boot|campaign_variants|data|db|local_\w+|models|movies|shaders|terrain|variants|warmachines)[\w-]*\.pack$/i }],
    notes: ['Mods .pack vão em data. Ative e ordene no launcher do jogo.'], certainty: 'partial',
  }),
  227300: folderMods('Euro Truck Simulator 2', {
    base: 'documents', path: 'Euro Truck Simulator 2/mod', label: 'Documentos/Euro Truck Simulator 2/mod',
    native: { base: 'home', path: '.local/share/Euro Truck Simulator 2/mod' },
  }, { keepArchive: ['.scs'], routes: [E(['.scs'], 'mods')], fallback: null, scan: [{ target: 'mods', exts: ['.scs', '.zip'] }], notes: ['Mods .scs vão em Documentos/Euro Truck Simulator 2/mod. Ative no Gerenciador de mods do jogo.'] }),
  270880: folderMods('American Truck Simulator', {
    base: 'documents', path: 'American Truck Simulator/mod', label: 'Documentos/American Truck Simulator/mod',
    native: { base: 'home', path: '.local/share/American Truck Simulator/mod' },
  }, { keepArchive: ['.scs'], routes: [E(['.scs'], 'mods')], fallback: null, scan: [{ target: 'mods', exts: ['.scs', '.zip'] }] }),

  // Script Hook (Rockstar)
  271590: {
    name: 'Grand Theft Auto V', family: 'scripthook',
    loader: {
      id: 'scripthookv', label: 'Script Hook V', required: true,
      check: ['ScriptHookV.dll'],
      autoInstall: null,
      howTo: 'Baixe o Script Hook V (dev-c.com) e coloque ScriptHookV.dll e dinput8.dll na pasta do jogo.',
      signature: { file: 'ScriptHookV.dll' },
    },
    targets: { root: { base: 'game', path: '' }, scripts: { base: 'game', path: 'scripts', label: 'scripts' } },
    primary: 'root',
    routes: [A(['scripts'], 'root', { topOnly: true }), E(['.asi'], 'root'), E(['.cs', '.vb'], 'scripts')],
    fallback: null,
    unsupportedExts: ['.oiv', '.rpf'],
    scan: [{ target: 'root', exts: ['.asi'] }, { target: 'scripts' }],
    notes: ['Plugins .asi vão na pasta do jogo e scripts em "scripts" (Script Hook V + ScriptHookVDotNet).', 'Pacotes .oiv/.rpf precisam do OpenIV — não suportados. Nunca jogue online com mods.'],
    certainty: 'known',
  },
  1174180: {
    name: 'Red Dead Redemption 2', family: 'scripthook',
    loader: {
      id: 'scripthookrdr2', label: 'Script Hook RDR2', required: false,
      check: ['ScriptHookRDR2.dll'], autoInstall: null,
      howTo: 'Mods .asi precisam do Script Hook RDR2 (dev-c.com) na pasta do jogo.',
      signature: { file: 'ScriptHookRDR2.dll' },
    },
    targets: { root: { base: 'game', path: '' }, lml: { base: 'game', path: 'lml', label: 'lml (Lenny\'s Mod Loader)' } },
    primary: 'lml',
    routes: [A(['lml'], 'root', { topOnly: true }), E(['.asi'], 'root')],
    fallback: { target: 'lml', sub: '{mod}' },
    scan: [{ target: 'root', exts: ['.asi'] }, { target: 'lml' }],
    notes: ['.asi vão na pasta do jogo; mods de arquivo vão em lml (precisa do Lenny\'s Mod Loader). Só offline.'],
    certainty: 'partial',
  },

  // FromSoftware (ModEngine2)
  1245620: modEngine('ELDEN RING'),
  374320: modEngine('DARK SOULS III'),
  1888160: modEngine('ARMORED CORE VI'),

  // Paradox (pasta de mods em Documentos; o .mod descritor é gerado)
  281990: paradox('Stellaris', 'Stellaris'),
  394360: paradox('Hearts of Iron IV', 'Hearts of Iron IV'),
  1158310: paradox('Crusader Kings III', 'Crusader Kings III'),
  236850: paradox('Europa Universalis IV', 'Europa Universalis IV'),
};

function paradox(name, docsName) {
  return folderMods(name, {
    base: 'documents', path: `Paradox Interactive/${docsName}/mod`, label: `Documentos/Paradox Interactive/${docsName}/mod`,
    native: { base: 'home', path: `.local/share/Paradox Interactive/${docsName}/mod` },
  }, {
    family: 'paradox',
    paradoxDescriptor: true,
    routes: [E(['.mod'], 'mods')],
    notes: ['Mods ficam em Documentos/Paradox Interactive/.../mod (o arquivo .mod é criado sozinho). Ative no launcher da Paradox.'],
    certainty: 'partial',
  });
}

// ---------- Resolução de bases (pasta do jogo / dados do usuário) ----------
function steamappsDirOf(gameInstallPath) {
  // <biblioteca>/steamapps/common/<pasta> → <biblioteca>/steamapps
  return path.dirname(path.dirname(gameInstallPath));
}

function electronDocuments() {
  try {
    // eslint-disable-next-line global-require
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') return app.getPath('documents');
  } catch { /* fora do Electron (testes) */ }
  return null;
}

// No Linux, jogo de Windows rodando pelo Proton guarda os dados do
// usuário dentro do prefixo do Proton: steamapps/compatdata/<appid>/pfx.
function protonUserDir(gameInstallPath, steamAppId) {
  if (!steamAppId) return null;
  const pfx = path.join(steamappsDirOf(gameInstallPath), 'compatdata', String(steamAppId), 'pfx', 'drive_c', 'users', 'steamuser');
  return fs.existsSync(pfx) ? pfx : null;
}

function resolveBaseDir(base, ctx) {
  const { gameInstallPath, platform = process.platform, steamAppId } = ctx;
  const home = ctx.home || os.homedir();
  if (base === 'game') return gameInstallPath;
  if (base === 'home') return home;
  if (platform === 'win32') {
    if (base === 'appdata') return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    if (base === 'localappdata') return process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    if (base === 'documents') return electronDocuments() || path.join(home, 'Documents');
  }
  const pfx = ctx.protonDir !== undefined ? ctx.protonDir : protonUserDir(gameInstallPath, steamAppId);
  if (pfx) {
    if (base === 'appdata') return path.join(pfx, 'AppData', 'Roaming');
    if (base === 'localappdata') return path.join(pfx, 'AppData', 'Local');
    if (base === 'documents') {
      const docs = path.join(pfx, 'Documents');
      return fs.existsSync(docs) ? docs : path.join(pfx, 'My Documents');
    }
  }
  // Sem Proton (ou macOS): melhor palpite nas pastas padrão do sistema.
  if (base === 'appdata') return platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : path.join(home, '.config');
  if (base === 'localappdata') return platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : path.join(home, '.local', 'share');
  if (base === 'documents') return electronDocuments() || path.join(home, 'Documents');
  return gameInstallPath;
}

// Resolve UM alvo pra um caminho absoluto. `path` pode ser uma lista
// (usa a primeira que já existir, senão a primeira). `native` é usado no
// Linux quando o jogo roda nativo (sem prefixo do Proton).
function resolveTarget(target, ctx) {
  let spec = target;
  const platform = ctx.platform || process.platform;
  if (target.native && platform !== 'win32') {
    const pfx = ctx.protonDir !== undefined ? ctx.protonDir : protonUserDir(ctx.gameInstallPath, ctx.steamAppId);
    if (!pfx && target.base !== 'game') spec = { ...target, ...target.native };
  }
  const baseDir = resolveBaseDir(spec.base, ctx);
  const candidates = [].concat(spec.path).map((p) => (p ? path.join(baseDir, ...p.split('/')) : baseDir));
  const dir = candidates.find((c) => fs.existsSync(c)) || candidates[0];
  // "Raiz" do alvo: até onde o instalador pode criar pastas novas e onde
  // fica a área de mods desativados (.projectclub-disabled). Pra pasta do
  // jogo é a própria pasta do jogo; pra dados do usuário é a pasta-mãe do
  // alvo (ex: ".../Baldur's Gate 3" pra ".../Baldur's Gate 3/Mods").
  const root = spec.base === 'game' ? ctx.gameInstallPath : path.dirname(dir);
  return { dir, root, base: spec.base, label: target.label || [].concat(target.path)[0] || '(pasta do jogo)' };
}

// ---------- Detecção automática (jogos sem perfil) ----------
function safeReaddir(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

function findUnrealProject(gameInstallPath) {
  for (const e of safeReaddir(gameInstallPath)) {
    if (!e.isDirectory() || e.name === 'Engine') continue;
    if (fs.existsSync(path.join(gameInstallPath, e.name, 'Content', 'Paks'))) return e.name;
  }
  return null;
}

function genericProfile(gameInstallPath) {
  const has = (p) => fs.existsSync(path.join(gameInstallPath, p));
  if (has('BepInEx')) return { ...bepinex('Jogo Unity com BepInEx'), id: 'generic:bepinex', certainty: 'generic' };
  if (has('MelonLoader')) return { ...melonloader('Jogo Unity com MelonLoader'), id: 'generic:melonloader', certainty: 'generic' };
  const ueProject = findUnrealProject(gameInstallPath);
  if (ueProject) return { ...unreal('Jogo Unreal Engine', ueProject), id: 'generic:unreal', certainty: 'generic' };
  if (has('Data') && safeReaddir(path.join(gameInstallPath, 'Data')).some((e) => /\.esm$/i.test(e.name))) {
    return { ...bethesda('Jogo da Bethesda', null), id: 'generic:bethesda', certainty: 'generic' };
  }
  const unityData = safeReaddir(gameInstallPath).find((e) => e.isDirectory() && /_Data$/.test(e.name) && fs.existsSync(path.join(gameInstallPath, e.name, 'Managed')));
  const modsDirName = ['Mods', 'mods'].find((d) => has(d)) || 'Mods';
  const notes = ['Não temos um perfil específico deste jogo — os mods vão numa pasta "Mods" genérica. Confira a página do mod pra saber se precisa de algo a mais.'];
  if (unityData) notes.push('Este é um jogo Unity: a maioria dos mods dele precisa do BepInEx ou do MelonLoader instalado antes.');
  return {
    ...folderMods('Jogo sem perfil', { base: 'game', path: modsDirName, label: modsDirName }),
    id: 'generic:folder',
    family: unityData ? 'unity' : 'folder',
    loader: unityData ? {
      id: 'bepinex', label: 'BepInEx', required: false,
      check: ['BepInEx/core/BepInEx.dll', 'MelonLoader'], autoInstall: null,
      howTo: 'Se o mod pedir BepInEx/MelonLoader, instale o loader certo pra este jogo antes.',
    } : null,
    notes,
    certainty: 'generic',
  };
}

// Perfil final do jogo: tabela por AppID → senão detecção automática.
function resolveProfile({ gameInstallPath, steamAppId }) {
  const known = steamAppId ? PROFILES[Number(steamAppId)] : null;
  if (known) return { id: `app:${steamAppId}`, ...known };
  return genericProfile(gameInstallPath);
}

function isLoaderInstalled(profile, gameInstallPath) {
  if (!profile.loader) return null;
  return profile.loader.check.some((p) => fs.existsSync(path.resolve(gameInstallPath, ...p.split('/'))));
}

// Resumo pra UI ("Como este jogo usa mods") e pro servidor (o cliente
// manda isto junto quando precisa refinar compatibilidade).
function describeProfile(profile, ctx) {
  const folders = Object.entries(profile.targets)
    .filter(([key]) => key !== 'root' || profile.primary === 'root')
    .filter(([key]) => (profile.scan || []).some((s) => s.target === key) || key === profile.primary)
    .map(([key, t]) => {
      const r = resolveTarget(t, ctx);
      return { id: key, label: r.label, path: r.dir, exists: fs.existsSync(r.dir), primary: key === profile.primary };
    });
  const loaderInstalled = isLoaderInstalled(profile, ctx.gameInstallPath);
  const exts = new Set();
  for (const r of profile.routes || []) if (r.type === 'ext') r.exts.forEach((e) => exts.add(e));
  return {
    id: profile.id,
    name: profile.name,
    family: profile.family,
    certainty: profile.certainty,
    loader: profile.loader ? {
      id: profile.loader.id, label: profile.loader.label, required: !!profile.loader.required,
      installed: !!loaderInstalled, autoInstall: profile.loader.autoInstall || null, howTo: profile.loader.howTo,
    } : null,
    folders,
    fileTypes: [...exts],
    unsupportedExts: profile.unsupportedExts || [],
    keepArchive: profile.keepArchive || [],
    blocked: profile.blocked || null,
    loadOrderUnsupported: !!profile.loadOrderUnsupported,
    notes: profile.notes || [],
    disableMethod: 'Desativar move os arquivos do mod para a pasta ".projectclub-disabled" (fora do alcance do jogo); ativar devolve cada arquivo pro lugar exato.',
  };
}

module.exports = {
  PROFILES, resolveProfile, resolveTarget, resolveBaseDir, describeProfile, isLoaderInstalled, genericProfile,
  BETHESDA_VANILLA,
};
