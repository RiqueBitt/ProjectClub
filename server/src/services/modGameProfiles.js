// Perfil de COMPATIBILIDADE de mods por jogo (lado do servidor) — item
// pedido: "mostre quais mods são compatíveis e quais não". É a versão
// resumida do perfil de instalação do app desktop
// (desktop/modInstallProfiles.js): aqui só interessa qual loader o jogo
// usa, se dá pra instalar o loader sozinho (BepInExPack do
// Thunderstore), que tipos de arquivo o instalador sabe encaminhar e se
// o jogo bloqueia mods. O cliente refina depois com o que só o PC sabe
// (ex: o loader já está instalado?).
const BEPINEX = {
  loader: { id: 'bepinex', label: 'BepInEx', autoInstall: true, required: true },
  // Pacote do loader no Thunderstore (BepInExPack, BepInExPack_Valheim...).
  loaderPackage: /^bepinexpack/i,
  installableExts: ['.dll', '.zip', '.7z'],
};
const MELON = { loader: { id: 'melonloader', label: 'MelonLoader', autoInstall: false, required: true }, installableExts: ['.dll', '.zip', '.7z'] };
const UNREAL = { loader: { id: 'ue4ss', label: 'UE4SS', autoInstall: false, required: false }, installableExts: ['.pak', '.utoc', '.ucas', '.zip', '.7z'], scriptTags: /\b(ue4ss|lua)\b/i };
const BETHESDA = { loader: null, installableExts: ['.esp', '.esm', '.esl', '.bsa', '.ba2', '.zip', '.7z'], unsupportedExts: ['.fomod'] };
const SOURCE = { loader: null, installableExts: ['.vpk', '.gma', '.zip', '.7z'] };

const P = (name, base, extra = {}) => ({ name, ...base, ...extra });

const PROFILES = {
  1966720: P('Lethal Company', BEPINEX), 892970: P('Valheim', BEPINEX), 632360: P('Risk of Rain 2', BEPINEX),
  1337520: P('Risk of Rain Returns', BEPINEX), 2881650: P('Content Warning', BEPINEX), 3241660: P('R.E.P.O.', BEPINEX),
  1604030: P('V Rising', BEPINEX), 1366540: P('Dyson Sphere Program', BEPINEX), 1092790: P('Inscryption', BEPINEX),
  1432860: P('Sun Haven', BEPINEX), 1625450: P('Muck', BEPINEX), 1557740: P('ROUNDS', BEPINEX), 794260: P('Outward', BEPINEX),
  311690: P('Enter the Gungeon', BEPINEX), 264710: P('Subnautica', BEPINEX), 848450: P('Subnautica: Below Zero', BEPINEX),
  1229490: P('ULTRAKILL', BEPINEX), 1562430: P('DREDGE', BEPINEX), 945360: P('Among Us', BEPINEX), 1533390: P('Gorilla Tag', BEPINEX),
  960090: P('Bloons TD 6', MELON), 305620: P('The Long Dark', MELON), 1592190: P('BONELAB', MELON),
  1623730: P('Palworld', UNREAL), 990080: P('Hogwarts Legacy', UNREAL), 2358720: P('Black Myth: Wukong', UNREAL),
  1272080: P('PAYDAY 3', UNREAL), 1144200: P('Ready or Not', UNREAL), 1332010: P('Stray', UNREAL), 1627720: P('Lies of P', UNREAL),
  1778820: P('TEKKEN 8', UNREAL), 1774580: P('STAR WARS Jedi: Survivor', UNREAL), 1282100: P('Remnant II', UNREAL),
  668580: P('Atomic Heart', UNREAL), 1817230: P('Hi-Fi RUSH', UNREAL), 962130: P('Grounded', UNREAL), 1462040: P('FINAL FANTASY VII REMAKE', UNREAL),
  489830: P('Skyrim Special Edition', BETHESDA), 72850: P('Skyrim', BETHESDA), 377160: P('Fallout 4', BETHESDA),
  22380: P('Fallout: New Vegas', BETHESDA), 22370: P('Fallout 3', BETHESDA), 22330: P('Oblivion', BETHESDA),
  1716740: P('Starfield', BETHESDA), 22320: P('Morrowind', BETHESDA),
  4000: P("Garry's Mod", SOURCE), 550: P('Left 4 Dead 2', SOURCE), 440: P('Team Fortress 2', SOURCE),
  730: P('Counter-Strike 2', { loader: null, blocked: 'Counter-Strike 2 não aceita mods de arquivo no online (VAC).' }),
  413150: P('Stardew Valley', { loader: { id: 'smapi', label: 'SMAPI', autoInstall: false, required: true }, installableExts: ['.zip', '.7z'] }),
  294100: P('RimWorld', { loader: null, installableExts: ['.zip', '.7z'] }),
  261550: P('Mount & Blade II: Bannerlord', { loader: null, installableExts: ['.zip', '.7z'] }),
  367520: P('Hollow Knight', { loader: { id: 'hkapi', label: 'Modding API', autoInstall: false, required: true }, installableExts: ['.dll', '.zip', '.7z'] }),
  105600: P('Terraria', { loader: { id: 'tmodloader', label: 'tModLoader', autoInstall: false, required: true }, installableExts: ['.tmod', '.zip', '.7z'] }),
  1281930: P('tModLoader', { loader: null, installableExts: ['.tmod', '.zip', '.7z'] }),
  427520: P('Factorio', { loader: null, installableExts: ['.zip'] }),
  292030: P('The Witcher 3', { loader: null, installableExts: ['.zip', '.7z'] }),
  1091500: P('Cyberpunk 2077', { loader: null, installableExts: ['.archive', '.xl', '.reds', '.zip', '.7z'] }),
  1086940: P("Baldur's Gate 3", { loader: null, installableExts: ['.pak', '.zip', '.7z'], loadOrderNote: 'A ordem de carga (modsettings.lsx) é feita no jogo, não pelo Project Club.' }),
  1222670: P('The Sims 4', { loader: null, installableExts: ['.package', '.ts4script', '.zip', '.7z'] }),
  504230: P('Celeste', { loader: { id: 'everest', label: 'Everest', autoInstall: false, required: true }, installableExts: ['.zip'] }),
  271590: P('Grand Theft Auto V', { loader: { id: 'scripthookv', label: 'Script Hook V', autoInstall: false, required: true }, installableExts: ['.asi', '.dll', '.cs', '.vb', '.zip', '.7z'], unsupportedExts: ['.oiv', '.rpf'] }),
  1174180: P('Red Dead Redemption 2', { loader: { id: 'scripthookrdr2', label: 'Script Hook RDR2', autoInstall: false, required: false }, installableExts: ['.asi', '.zip', '.7z'] }),
  1245620: P('ELDEN RING', { loader: { id: 'modengine2', label: 'ModEngine2', autoInstall: false, required: true }, installableExts: ['.zip', '.7z', '.dll'] }),
  374320: P('DARK SOULS III', { loader: { id: 'modengine2', label: 'ModEngine2', autoInstall: false, required: true }, installableExts: ['.zip', '.7z', '.dll'] }),
  1888160: P('ARMORED CORE VI', { loader: { id: 'modengine2', label: 'ModEngine2', autoInstall: false, required: true }, installableExts: ['.zip', '.7z', '.dll'] }),
  218620: P('PAYDAY 2', { loader: { id: 'superblt', label: 'SuperBLT', autoInstall: false, required: true }, installableExts: ['.zip', '.7z'] }),
};

// Formatos de pacote que o app desktop NÃO sabe abrir (ver
// desktop/modArchive.js) — valem pra todo jogo.
const UNSUPPORTED_ARCHIVES = ['.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz'];

const DEFAULT_PROFILE = { name: null, loader: null, installableExts: null, unsupportedExts: [], generic: true };

function getGameProfile(steamAppId) {
  const p = PROFILES[Number(steamAppId)];
  return p ? { ...DEFAULT_PROFILE, ...p, generic: false } : { ...DEFAULT_PROFILE };
}

module.exports = { getGameProfile, UNSUPPORTED_ARCHIVES, PROFILES };
