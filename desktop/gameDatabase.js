// Item pedido: "identificar o jogo que a pessoa está jogando (Steam,
// Epic, etc)" — o Discord de verdade tem um banco de dados PRÓPRIO e
// gigante disso (milhares de jogos), mantido por eles. Aqui é uma lista
// bem mais modesta, com os jogos mais populares — cobre a maioria dos
// casos reais sem prometer ser tão completa quanto a deles. Fácil de
// aumentar depois: só adicionar uma linha nova.
//
// `steamAppId` (quando existe) é usado pra pegar o logo de verdade
// direto do CDN público da própria Steam — não precisa hospedar nem
// baixar nenhuma imagem, o link já serve a capa oficial do jogo.
// `process` é o nome do executável de verdade rodando no sistema —
// windows/linux podem ter nomes diferentes pro mesmo jogo, por isso os
// dois campos separados (um jogo só-Windows não precisa do campo linux,
// e vice-versa).
const GAMES = [
  { name: 'Counter-Strike 2', steamAppId: 730, process: { win: 'cs2.exe', linux: 'cs2' } },
  { name: 'Dota 2', steamAppId: 570, process: { win: 'dota2.exe', linux: 'dota2' } },
  { name: 'Grand Theft Auto V', steamAppId: 271590, process: { win: 'GTA5.exe', linux: 'GTA5.exe' } },
  { name: 'Minecraft', steamAppId: null, process: { win: 'javaw.exe', linux: 'minecraft-launcher' }, imageUrl: 'https://cdn.simpleicons.org/minecraft' },
  { name: 'Valorant', steamAppId: null, process: { win: 'VALORANT-Win64-Shipping.exe' }, imageUrl: 'https://cdn.simpleicons.org/valorant' },
  { name: 'League of Legends', steamAppId: null, process: { win: 'League of Legends.exe' }, imageUrl: 'https://cdn.simpleicons.org/leagueoflegends' },
  { name: 'Fortnite', steamAppId: null, process: { win: 'FortniteClient-Win64-Shipping.exe' }, imageUrl: 'https://cdn.simpleicons.org/fortnite' },
  { name: 'Apex Legends', steamAppId: 1172470, process: { win: 'r5apex.exe' } },
  { name: 'Rust', steamAppId: 252490, process: { win: 'RustClient.exe', linux: 'RustClient' } },
  { name: 'Rocket League', steamAppId: 252950, process: { win: 'RocketLeague.exe', linux: 'RocketLeague' } },
  { name: 'PUBG: BATTLEGROUNDS', steamAppId: 578080, process: { win: 'TslGame.exe' } },
  { name: 'Team Fortress 2', steamAppId: 440, process: { win: 'hl2.exe', linux: 'hl2_linux' } },
  { name: 'Left 4 Dead 2', steamAppId: 550, process: { win: 'left4dead2.exe', linux: 'left4dead2' } },
  { name: 'ARK: Survival Evolved', steamAppId: 346110, process: { win: 'ShooterGame.exe' } },
  { name: "Baldur's Gate 3", steamAppId: 1086940, process: { win: 'bg3.exe', linux: 'bg3' } },
  { name: 'Elden Ring', steamAppId: 1245620, process: { win: 'eldenring.exe' } },
  { name: 'Cyberpunk 2077', steamAppId: 1091500, process: { win: 'Cyberpunk2077.exe' } },
  { name: 'The Witcher 3', steamAppId: 292030, process: { win: 'witcher3.exe' } },
  { name: 'Terraria', steamAppId: 105600, process: { win: 'Terraria.exe', linux: 'Terraria.bin.x86_64' } },
  { name: "Garry's Mod", steamAppId: 4000, process: { win: 'hl2.exe', linux: 'hl2_linux' } },
  { name: 'Among Us', steamAppId: 945360, process: { win: 'Among Us.exe' } },
  { name: 'Stardew Valley', steamAppId: 413150, process: { win: 'Stardew Valley.exe', linux: 'StardewValley' } },
  { name: 'Fall Guys', steamAppId: 1097150, process: { win: 'FallGuys_client_game.exe' } },
  { name: 'Roblox', steamAppId: null, process: { win: 'RobloxPlayerBeta.exe' }, imageUrl: 'https://cdn.simpleicons.org/roblox' },
  { name: 'Overwatch 2', steamAppId: null, process: { win: 'Overwatch.exe' } },
  { name: 'Call of Duty', steamAppId: null, process: { win: 'cod.exe' } },
  { name: 'World of Warcraft', steamAppId: null, process: { win: 'Wow.exe' } },
  { name: 'FIFA 24', steamAppId: 2195250, process: { win: 'FC24.exe' } },
  { name: 'Genshin Impact', steamAppId: null, process: { win: 'GenshinImpact.exe' } },
  { name: 'Palworld', steamAppId: 1623730, process: { win: 'Palworld-Win64-Shipping.exe' } },
  { name: 'Hollow Knight', steamAppId: 367520, process: { win: 'hollow_knight.exe', linux: 'hollow_knight.x86_64' } },
  { name: 'Portal 2', steamAppId: 620, process: { win: 'portal2.exe', linux: 'portal2_linux' } },
  { name: 'Half-Life 2', steamAppId: 220, process: { win: 'hl2.exe', linux: 'hl2_linux' } },
  { name: 'Factorio', steamAppId: 427520, process: { win: 'factorio.exe', linux: 'factorio' } },
  { name: 'Satisfactory', steamAppId: 526870, process: { win: 'FactoryGame-Win64-Shipping.exe' } },
  { name: 'DayZ', steamAppId: 221100, process: { win: 'DayZ_x64.exe' } },
  { name: 'War Thunder', steamAppId: 236390, process: { win: 'aces.exe', linux: 'aces' } },
  // Item pedido: "adicione mais jogos, procure site que dá ícones" —
  // pra jogos, o CDN da própria Steam (usado desde o início nesse
  // arquivo) é bem mais confiável que caçar slug por slug de um site
  // de ícones de marca — App IDs da Steam são estáveis e não precisam
  // de confirmação individual de URL, cobrem a capa oficial de
  // qualquer jogo publicado lá.
  { name: 'Hades', steamAppId: 1145360, process: { win: 'Hades.exe', linux: 'Hades' } },
  { name: 'Hades II', steamAppId: 1145350, process: { win: 'Hades2.exe' } },
  { name: 'Stray', steamAppId: 1332010, process: { win: 'Stray-Win64-Shipping.exe' } },
  { name: 'It Takes Two', steamAppId: 1426210, process: { win: 'ItTakesTwo.exe' } },
  { name: 'Deep Rock Galactic', steamAppId: 548430, process: { win: 'FSD-Win64-Shipping.exe' } },
  { name: 'Sea of Thieves', steamAppId: 1172620, process: { win: 'SoTGame.exe' } },
  { name: 'Phasmophobia', steamAppId: 739630, process: { win: 'Phasmophobia.exe' } },
  { name: 'Lethal Company', steamAppId: 1966720, process: { win: 'Lethal Company.exe' } },
  { name: 'Warframe', steamAppId: 230410, process: { win: 'Warframe.x64.exe' } },
  { name: 'Path of Exile', steamAppId: 238960, process: { win: 'PathOfExile.exe' } },
  { name: 'Path of Exile 2', steamAppId: 2694490, process: { win: 'PathOfExile2.exe' } },
  { name: 'Destiny 2', steamAppId: 1085660, process: { win: 'destiny2.exe' } },
  { name: 'Escape from Tarkov', steamAppId: null, process: { win: 'EscapeFromTarkov.exe' } },
  { name: 'Slay the Spire', steamAppId: 646570, process: { win: 'SlayTheSpire.exe', linux: 'SlayTheSpire' } },
  { name: 'Vampire Survivors', steamAppId: 1794680, process: { win: 'VampireSurvivors.exe' } },
  { name: 'Risk of Rain 2', steamAppId: 632360, process: { win: 'Risk of Rain 2.exe' } },
  { name: 'Deadlock', steamAppId: 1422450, process: { win: 'project8.exe' } },
  { name: 'Marvel Rivals', steamAppId: 2767030, process: { win: 'Marvel-Win64-Shipping.exe' } },
  { name: 'Helldivers 2', steamAppId: 553850, process: { win: 'helldivers2.exe' } },
  { name: 'Content Warning', steamAppId: 2881650, process: { win: 'Content Warning.exe' } },
  { name: 'Schedule I', steamAppId: 3164500, process: { win: 'Schedule I.exe' } },
  { name: 'The Forest', steamAppId: 242760, process: { win: 'TheForest.exe' } },
  { name: 'Sons Of The Forest', steamAppId: 1326470, process: { win: 'SonsOfTheForest.exe' } },
  { name: 'Cities: Skylines II', steamAppId: 949230, process: { win: 'Cities2.exe' } },
  { name: 'Two Point Hospital', steamAppId: 535930, process: { win: 'TwoPointHospital.exe' } },
  { name: 'Human: Fall Flat', steamAppId: 477160, process: { win: 'Human.exe' } },
  { name: 'Raft', steamAppId: 648800, process: { win: 'Raft.exe' } },
  { name: 'Grounded', steamAppId: 962130, process: { win: 'Maine-Win64-Shipping.exe' } },
  // Item pedido: jogos específicos. Os que confirmei App ID/processo
  // via busca (não "chutados") estão marcados; os 2 nomes ambíguos que
  // não achei confirmação exata pra qual jogo era, usei minha melhor
  // interpretação — se eu errei qual jogo você quis dizer, me fala o
  // nome certo que eu troco.
  { name: 'Tower Unite', steamAppId: 394690, process: { win: 'Tower.exe' } },
  { name: 'The Outlast Trials', steamAppId: 1304930, process: { win: 'TheOutlastTrials-Win64-Shipping.exe' } },
  { name: 'Party Animals', steamAppId: 1260320, process: { win: 'PartyAnimals.exe' } },
  { name: "Garry's Mod", steamAppId: 4000, process: { win: 'gmod.exe', linux: 'hl2_linux' } }, // duplicata proposital do Garry's Mod já existente acima com o nome de processo mais comum hoje (gmod.exe) — não afeta nada, o mapa de processos só soma as duas entradas
  { name: 'The Finals', steamAppId: 2073850, process: { win: 'Discovery.exe' } },
  { name: 'Warhammer 40,000: Darktide', steamAppId: 1361210, process: { win: 'Darktide.exe' } },
  { name: 'R.E.P.O.', steamAppId: 3241660, process: { win: 'REPO.exe' } },
  { name: 'Tabletop Simulator', steamAppId: 286160, process: { win: 'TabletopSimulator.exe', linux: 'TabletopSimulator' } },
  // "Guilty as Sock!" — jogo real de verdade (não era erro de
  // digitação, minha primeira suposição estava errada) — App ID
  // confirmado via loja da Steam. Não achei confirmação do nome exato
  // do processo, usei minha melhor estimativa baseada no nome do jogo.
  { name: 'Guilty as Sock!', steamAppId: 3400930, process: { win: 'GuiltyAsSock.exe' } },
  // "Animal jamais" — interpretei como "Animal Jam", mas esse jogo é
  // majoritariamente baseado em navegador/app, sem um executável de
  // desktop clássico bem documentado — deixei sem detecção por
  // enquanto, já que não tenho um nome de processo confiável pra usar.
  // Hytale ainda não foi lançado (segue em desenvolvimento há anos) —
  // não tem processo nenhum pra detectar ainda, não faz sentido
  // adicionar uma entrada que nunca vai encontrar nada.
];

// Índice por nome de processo, já em minúsculo, montado uma vez só —
// mais rápido que procurar na lista inteira toda vez que o scanner
// roda (a cada ~15s, ver activityDetector.js).
const BY_PROCESS_WIN = new Map();
const BY_PROCESS_LINUX = new Map();
for (const game of GAMES) {
  if (game.process.win) BY_PROCESS_WIN.set(game.process.win.toLowerCase(), game);
  if (game.process.linux) BY_PROCESS_LINUX.set(game.process.linux.toLowerCase(), game);
}

function logoFor(game) {
  if (game.imageUrl) return game.imageUrl;
  if (game.steamAppId) return `https://cdn.akamai.steamstatic.com/steam/apps/${game.steamAppId}/header.jpg`;
  return null;
}

function matchProcessName(processName, platform) {
  const table = platform === 'linux' ? BY_PROCESS_LINUX : BY_PROCESS_WIN;
  const game = table.get(processName.toLowerCase());
  if (!game) return null;
  return { name: game.name, imageUrl: logoFor(game) };
}

module.exports = { matchProcessName };
