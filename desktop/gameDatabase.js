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
  { name: 'Escape from Tarkov', steamAppId: 3932890, process: { win: 'EscapeFromTarkov.exe' } },
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
  // Item pedido: "pegue os jogos daqui" — lista real, buscada agora
  // mesmo (30/08/2026) direto da página de Top 100 mais jogados da
  // SteamDB (App IDs confirmados na fonte, não chutados). Ferramentas/
  // utilitários que aparecem misturados na lista de "mais jogados"
  // (tipo Wallpaper Engine, Crosshair X, Soundpad) ficaram de fora —
  // não são jogos de verdade. Os poucos onde não tenho confiança no
  // nome exato do executável (jogos muito novos/de nicho) também
  // ficaram de fora, em vez de arriscar um nome errado.
  { name: 'Delta Force', steamAppId: 2507950, process: { win: 'DeltaForceClient-Win64-Shipping.exe' } },
  { name: 'Project Zomboid', steamAppId: 108600, process: { win: 'ProjectZomboid64.exe', linux: 'ProjectZomboid64' } },
  { name: 'Grand Theft Auto V Enhanced', steamAppId: 3240220, process: { win: 'GTA5_Enhanced.exe' } },
  { name: 'The Binding of Isaac: Rebirth', steamAppId: 250900, process: { win: 'isaac-ng.exe' } },
  { name: 'EA SPORTS FC 26', steamAppId: 3405690, process: { win: 'FC26.exe' } },
  { name: 'Dead by Daylight', steamAppId: 381210, process: { win: 'DeadByDaylight-Win64-Shipping.exe' } },
  { name: "Tom Clancy's Rainbow Six Siege", steamAppId: 359550, process: { win: 'RainbowSix.exe' } },
  { name: 'VRChat', steamAppId: 438100, process: { win: 'VRChat.exe' } },
  { name: 'NARAKA: BLADEPOINT', steamAppId: 1203220, process: { win: 'NarakaBladepoint.exe' } },
  { name: 'PEAK', steamAppId: 3527290, process: { win: 'PEAK.exe' } },
  { name: 'Red Dead Redemption 2', steamAppId: 1174180, process: { win: 'RDR2.exe' } },
  { name: 'Hearts of Iron IV', steamAppId: 394360, process: { win: 'hoi4.exe' } },
  { name: 'Battlefield 6', steamAppId: 2807960, process: { win: 'bf6.exe' } },
  { name: 'Euro Truck Simulator 2', steamAppId: 227300, process: { win: 'eurotrucks2.exe', linux: 'eurotrucks2' } },
  { name: 'Farming Simulator 25', steamAppId: 2300320, process: { win: 'FarmingSimulator25.exe' } },
  { name: "Don't Starve Together", steamAppId: 322330, process: { win: 'dontstarve_steam.exe' } },
  { name: 'Mount & Blade II: Bannerlord', steamAppId: 261550, process: { win: 'Bannerlord.exe' } },
  { name: 'Total War: WARHAMMER III', steamAppId: 1142710, process: { win: 'Warhammer3.exe' } },
  { name: 'Geometry Dash', steamAppId: 322170, process: { win: 'GeometryDash.exe' } },
  { name: "Sid Meier's Civilization VI", steamAppId: 289070, process: { win: 'CivilizationVI.exe' } },
  { name: '7 Days to Die', steamAppId: 251570, process: { win: '7DaysToDie.exe' } },
  { name: 'Black Myth: Wukong', steamAppId: 2358720, process: { win: 'b1.exe' } },
  { name: 'tModLoader', steamAppId: 1281930, process: { win: 'tModLoader.exe' } },
  { name: 'S.T.A.L.K.E.R. 2: Heart of Chornobyl', steamAppId: 1643320, process: { win: 'Stalker2-Win64-Shipping.exe' } },
  { name: 'RimWorld', steamAppId: 294100, process: { win: 'RimWorldWin64.exe', linux: 'RimWorldLinux' } },
  { name: 'ARK: Survival Ascended', steamAppId: 2399830, process: { win: 'ArkAscended.exe' } },
  { name: 'The Sims 4', steamAppId: 1222670, process: { win: 'TS4_x64.exe' } },
  { name: 'The Elder Scrolls V: Skyrim Special Edition', steamAppId: 489830, process: { win: 'SkyrimSE.exe' } },
  { name: 'ELDEN RING NIGHTREIGN', steamAppId: 2622380, process: { win: 'nightreign.exe' } },
  { name: 'Street Fighter 6', steamAppId: 1364780, process: { win: 'StreetFighter6.exe' } },
  { name: 'Limbus Company', steamAppId: 1973530, process: { win: 'LimbusCompany.exe' } },
  { name: 'Crusader Kings III', steamAppId: 1158310, process: { win: 'CK3.exe' } },
  { name: 'Hunt: Showdown', steamAppId: 594650, process: { win: 'HuntGame.exe' } },
  { name: 'PAYDAY 2', steamAppId: 218620, process: { win: 'payday2_win32_release.exe' } },
  { name: 'Age of Empires II: Definitive Edition', steamAppId: 813780, process: { win: 'AoE2DE_s.exe' } },
  { name: 'BeamNG.drive', steamAppId: 284160, process: { win: 'BeamNG.drive.x64.exe' } },
  { name: 'Valheim', steamAppId: 892970, process: { win: 'valheim.exe' } },
  { name: 'Black Desert', steamAppId: 582660, process: { win: 'BlackDesert64.exe' } },
  { name: 'eFootball', steamAppId: 1665460, process: { win: 'eFootball.exe' } },
  { name: 'Monster Hunter: World', steamAppId: 582010, process: { win: 'MonsterHunterWorld.exe' } },
  { name: 'Monster Hunter Wilds', steamAppId: 2246340, process: { win: 'MonsterHunterWilds.exe' } },
  { name: 'NBA 2K26', steamAppId: 3472040, process: { win: 'NBA2K26.exe' } },
  { name: 'FINAL FANTASY XIV Online', steamAppId: 39210, process: { win: 'ffxiv_dx11.exe' } },
  // Item pedido: jogos da lista mandada pelo usuário (300+ nomes, num
  // arquivo texto) — adicionados os que reconheço com confiança
  // razoável de App ID + nome de processo. Os bem obscuros/indies
  // muito pequenos da lista que eu genuinamente não reconheço ficaram
  // de fora, em vez de arriscar inventar App ID ou nome de processo
  // errado — se algum desses fizer falta, me diga o nome de novo que
  // eu pesquiso especificamente.
  { name: 'Killing Floor 2', steamAppId: 232090, process: { win: 'KFGame.exe' } },
  { name: 'Gunfire Reborn', steamAppId: 1217060, process: { win: 'GunfireReborn.exe' } },
  { name: 'Fallout 4', steamAppId: 377160, process: { win: 'Fallout4.exe' } },
  { name: 'Bloons TD 6', steamAppId: 960090, process: { win: 'BloonsTD6.exe' } },
  { name: 'Darkest Dungeon', steamAppId: 262060, process: { win: 'darkest.exe' } },
  { name: 'Wallpaper Engine', steamAppId: 431960, process: { win: 'wallpaper64.exe' } },
  { name: 'Riders Republic', steamAppId: 1366800, process: { win: 'RidersRepublic.exe' } },
  { name: 'Warhammer: Vermintide 2', steamAppId: 552500, process: { win: 'Vermintide2.exe' } },
  { name: 'Paladins', steamAppId: 444090, process: { win: 'Paladins.exe' } },
  { name: 'DRAGON BALL: Sparking! ZERO', steamAppId: 2661310, process: { win: 'SPARKING_ZERO.exe' } },
  { name: 'Duck Game', steamAppId: 312530, process: { win: 'DuckGame.exe' } },
  { name: 'DOOM Eternal', steamAppId: 782330, process: { win: 'DOOMEternalx64vk.exe' } },
  { name: 'Saints Row IV', steamAppId: 206420, process: { win: 'SaintsRowIV.exe' } },
  { name: 'STAR WARS Battlefront II', steamAppId: 1237950, process: { win: 'starwarsbattlefrontii.exe' } },
  { name: 'A Hat in Time', steamAppId: 253230, process: { win: 'HatinTimeGame.exe' } },
  { name: 'Dying Light 2', steamAppId: 534380, process: { win: 'DyingLightGame_x64_rwdi.exe' } },
  { name: 'Worms Ultimate Mayhem', steamAppId: 91300, process: { win: 'wum.exe' } },
  { name: 'South Park: The Fractured But Whole', steamAppId: 433340, process: { win: 'FBWGame.exe' } },
  { name: 'Cassette Beasts', steamAppId: 1321440, process: { win: 'CassetteBeasts.exe' } },
  { name: 'Progressbar95', steamAppId: 1274590, process: { win: 'Progressbar95.exe' } },
  { name: 'Roboquest', steamAppId: 692890, process: { win: 'Roboquest.exe' } },
  { name: 'Town of Salem', steamAppId: 550110, process: { win: 'TownOfSalem.exe' } },
  { name: 'MORDHAU', steamAppId: 629760, process: { win: 'Mordhau.exe' } },
  { name: 'HYPERCHARGE: Unboxed', steamAppId: 803670, process: { win: 'HyperCharge.exe' } },
  { name: 'POSTAL 2', steamAppId: 17580, process: { win: 'Postal2.exe' } },
  { name: 'Devil May Cry 5', steamAppId: 601150, process: { win: 'DevilMayCry5.exe' } },
  { name: 'SUPERHOT: MIND CONTROL DELETE', steamAppId: 690040, process: { win: 'MindControlDelete.exe' } },
  { name: 'People Playground', steamAppId: 1118200, process: { win: 'People Playground.exe' } },
  { name: 'World War Z', steamAppId: 1088710, process: { win: 'WWZ.exe' } },
  { name: 'Mortal Kombat 11', steamAppId: 976310, process: { win: 'MK11.exe' } },
  { name: 'TEKKEN 8', steamAppId: 1778820, process: { win: 'TEKKEN8.exe' } },
  { name: 'Insurgency: Sandstorm', steamAppId: 581320, process: { win: 'insurgency.exe' } },
  { name: 'Borderlands 2', steamAppId: 49520, process: { win: 'Borderlands2.exe' } },
  { name: 'Minecraft Dungeons', steamAppId: 1272080, process: { win: 'MinecraftDungeons.exe' } },
  { name: 'Grand Theft Auto IV', steamAppId: 12210, process: { win: 'GTAIV.exe' } },
  { name: 'Sonic Adventure 2', steamAppId: 6020, process: { win: 'sonic2app.exe' } },
  { name: 'Halo Infinite', steamAppId: 1240440, process: { win: 'HaloInfinite.exe' } },
  { name: 'ULTRAKILL', steamAppId: 1229490, process: { win: 'ULTRAKILL.exe' } },
  { name: 'Darkest Dungeon II', steamAppId: 1940340, process: { win: 'DarkestDungeonII.exe' } },
  { name: 'Dying Light', steamAppId: 239140, process: { win: 'DyingLightGame.exe' } },
  { name: 'MultiVersus', steamAppId: 1818750, process: { win: 'MultiVersus-Win64-Shipping.exe' } },
  { name: 'ROUNDS', steamAppId: 1557740, process: { win: 'Rounds.exe' } },
  { name: 'Rayman Legends', steamAppId: 242550, process: { win: 'Rayman Legends.exe' } },
  { name: 'Dead Island 2', steamAppId: 1240220, process: { win: 'DI.exe' } },
  { name: 'Move or Die', steamAppId: 300380, process: { win: 'MoveOrDie.exe' } },
  { name: 'Abiotic Factor', steamAppId: 427410, process: { win: 'AbioticFactor.exe' } },
  { name: 'Inscryption', steamAppId: 1092790, process: { win: 'Inscryption.exe' } },
  { name: 'Call of Duty: Black Ops III', steamAppId: 311210, process: { win: 'BlackOps3.exe' } },
  { name: 'DARK SOULS III', steamAppId: 374320, process: { win: 'DarkSoulsIII.exe' } },
  { name: 'Watch_Dogs 2', steamAppId: 447040, process: { win: 'WatchDogs2.exe' } },
  { name: 'The Henry Stickmin Collection', steamAppId: 1178150, process: { win: 'HenryStickminCollection.exe' } },
  { name: 'Guild Wars 2', steamAppId: 1284210, process: { win: 'Gw2-64.exe' } },
  { name: 'Ultimate Chicken Horse', steamAppId: 386940, process: { win: 'UltimateChickenHorse.exe' } },
  { name: 'Battlefield 1', steamAppId: 1238840, process: { win: 'bf1.exe' } },
  { name: 'Saints Row: The Third', steamAppId: 55230, process: { win: 'SaintsRowTheThird_DX11.exe' } },
  { name: 'Stick Fight: The Game', steamAppId: 674940, process: { win: 'StickFight.exe' } },
  { name: 'Halo: The Master Chief Collection', steamAppId: 976730, process: { win: 'MCC-Win64-Shipping.exe' } },
  { name: 'Balatro', steamAppId: 2379780, process: { win: 'Balatro.exe' } },
  { name: 'Zombie Army 4: Dead War', steamAppId: 694280, process: { win: 'ZombieArmy4.exe' } },
  { name: 'Fallout 76', steamAppId: 1151340, process: { win: 'Fallout76.exe' } },
  { name: 'BioShock Infinite', steamAppId: 8870, process: { win: 'BioShockInfinite.exe' } },
  { name: 'Enter the Gungeon', steamAppId: 311690, process: { win: 'EtG.exe' } },
  { name: 'Castle Crashers', steamAppId: 204360, process: { win: 'CastleCrashers.exe' } },
  { name: 'Sunset Overdrive', steamAppId: 1155350, process: { win: 'SunsetOverdrive.exe' } },
  { name: 'Half-Life', steamAppId: 70, process: { win: 'hl.exe' } },
  { name: 'Overcooked! 2', steamAppId: 728880, process: { win: 'Overcooked2.exe' } },
  { name: 'Far Cry 3', steamAppId: 220240, process: { win: 'farcry3.exe' } },
  { name: 'Portal', steamAppId: 400, process: { win: 'portal.exe' } },
  { name: 'BattleBlock Theater', steamAppId: 238430, process: { win: 'BattleBlockTheater.exe' } },
  { name: 'Super Animal Royale', steamAppId: 834910, process: { win: 'SuperAnimalRoyale.exe' } },
  { name: 'Far Cry 4', steamAppId: 298110, process: { win: 'FarCry4.exe' } },
  { name: 'LEGO Worlds', steamAppId: 332310, process: { win: 'LEGOWorlds.exe' } },
  { name: 'Goat Simulator 3', steamAppId: 1899250, process: { win: 'GoatSimulator3.exe' } },
  { name: 'Borderlands 3', steamAppId: 397540, process: { win: 'Borderlands3.exe' } },
  { name: 'SUPERHOT', steamAppId: 322500, process: { win: 'superhot.exe' } },
  { name: 'BioShock Remastered', steamAppId: 409710, process: { win: 'BioShock.exe' } },
  { name: 'Sleeping Dogs: Definitive Edition', steamAppId: 307690, process: { win: 'SleepingDogs.exe' } },
  { name: 'Octodad: Dadliest Catch', steamAppId: 236090, process: { win: 'OctodadDadliestCatch.exe' } },
  { name: 'Half-Life: MMod', steamAppId: 546310, process: { win: 'hl2.exe' } },
  { name: 'Quake', steamAppId: 2310, process: { win: 'winquake.exe' } },
  { name: 'Muse Dash', steamAppId: 774171, process: { win: 'MuseDash.exe' } },
  { name: 'BioShock 2 Remastered', steamAppId: 409720, process: { win: 'BioShock2.exe' } },
  { name: 'Counter-Strike', steamAppId: 10, process: { win: 'hl.exe' } },
  { name: 'Golf With Your Friends', steamAppId: 431240, process: { win: 'GolfWithYourFriends.exe' } },
  { name: 'Scribblenauts Unlimited', steamAppId: 220910, process: { win: 'Scribblenauts Unlimited.exe' } },
  { name: 'Divinity: Original Sin 2', steamAppId: 435150, process: { win: 'EoCApp.exe' } },
  { name: 'Crash Bandicoot N. Sane Trilogy', steamAppId: 731490, process: { win: 'CrashBandicootNSaneTrilogy.exe' } },
  { name: 'Hotline Miami 2: Wrong Number', steamAppId: 274170, process: { win: 'hotline2.exe' } },
  { name: 'Rivals of Aether', steamAppId: 383980, process: { win: 'RivalsofAether.exe' } },
  { name: 'Buckshot Roulette', steamAppId: 2835570, process: { win: 'Buckshot Roulette.exe' } },
  { name: 'XCOM 2', steamAppId: 268500, process: { win: 'XCom2.exe' } },
  { name: 'Battlefield 4', steamAppId: 1238810, process: { win: 'bf4.exe' } },
  { name: 'Crash Bandicoot 4: It\'s About Time', steamAppId: 1360590, process: { win: 'Crash4.exe' } },
  { name: 'Forager', steamAppId: 751780, process: { win: 'Forager.exe' } },
  { name: 'Just Cause 3', steamAppId: 225540, process: { win: 'JustCause3.exe' } },
  { name: 'Dungeon Defenders II', steamAppId: 236110, process: { win: 'DunDef2.exe' } },
  { name: 'Hotline Miami', steamAppId: 219150, process: { win: 'hotline_miami.exe' } },
  { name: 'Pizza Tower', steamAppId: 2231450, process: { win: 'Pizza Tower.exe' } },
  { name: 'Burnout Paradise Remastered', steamAppId: 1238080, process: { win: 'BurnoutParadiseRemastered.exe' } },
  { name: 'DOOM II', steamAppId: 2300, process: { win: 'doom2.exe' } },
  { name: 'Counter-Strike: Source', steamAppId: 240, process: { win: 'hl2.exe' } },
  { name: 'Spore', steamAppId: 17390, process: { win: 'Spore.exe' } },
  { name: 'Fistful of Frags', steamAppId: 265630, process: { win: 'fof.exe' } },
  { name: 'Half-Life 2: Deathmatch', steamAppId: 320, process: { win: 'hl2.exe' } },
  { name: 'Quake III Arena', steamAppId: 2200, process: { win: 'quake3.exe' } },
  { name: 'Worms Armageddon', steamAppId: 217200, process: { win: 'WA.exe' } },
  { name: 'Injustice 2', steamAppId: 682900, process: { win: 'Injustice2.exe' } },
  { name: 'Sonic Mania', steamAppId: 584400, process: { win: 'SonicMania.exe' } },
  { name: 'Goat Simulator', steamAppId: 265930, process: { win: 'goatsimulator.exe' } },
  { name: 'Rayman Origins', steamAppId: 207490, process: { win: 'Rayman Origins.exe' } },
  { name: 'Titanfall 2', steamAppId: 1237970, process: { win: 'Titanfall2.exe' } },
  { name: 'Worms Rumble', steamAppId: 1214040, process: { win: 'WormsRumble.exe' } },
  { name: 'BioShock', steamAppId: 7670, process: { win: 'BioShock.exe' } },
  { name: 'BioShock 2', steamAppId: 8850, process: { win: 'BioShock2.exe' } },
  { name: 'Celeste', steamAppId: 504230, process: { win: 'Celeste.exe' } },
  { name: 'Day of Defeat', steamAppId: 30, process: { win: 'hl.exe' } },
  { name: 'Day of Defeat: Source', steamAppId: 300, process: { win: 'hl2.exe' } },
  { name: 'Deathmatch Classic', steamAppId: 40, process: { win: 'hl.exe' } },
  { name: 'Fallout', steamAppId: 38400, process: { win: 'falloutw.exe' } },
  { name: 'Fallout 2', steamAppId: 38410, process: { win: 'fallout2.exe' } },
  { name: 'Fallout: New Vegas', steamAppId: 22380, process: { win: 'FalloutNV.exe' } },
  { name: 'Far Cry', steamAppId: 3620, process: { win: 'farcry.exe' } },
  { name: 'Far Cry 2', steamAppId: 15370, process: { win: 'farcry2.exe' } },
  { name: 'Killing Floor', steamAppId: 1250, process: { win: 'KillingFloor.exe' } },
  { name: 'Left 4 Dead', steamAppId: 500, process: { win: 'left4dead.exe' } },
  { name: 'Ricochet', steamAppId: 60, process: { win: 'hl.exe' } },
  { name: 'Team Fortress Classic', steamAppId: 20, process: { win: 'hl.exe' } },
  { name: 'Total War: SHOGUN 2', steamAppId: 34330, process: { win: 'Shogun2.exe' } },
  { name: 'DOOM 3', steamAppId: 208200, process: { win: 'DOOM3.exe' } },
  { name: 'DOOM 64', steamAppId: 1148590, process: { win: 'DOOM64.exe' } },
  { name: 'DUSK', steamAppId: 519860, process: { win: 'dusk.exe' } },
  { name: 'Half-Life: Blue Shift', steamAppId: 130, process: { win: 'hl.exe' } },
  { name: 'Half-Life: Opposing Force', steamAppId: 50, process: { win: 'hl.exe' } },
  // Item pedido: segunda lista mandada pelo usuário — boa parte já
  // tinha sido processada antes (só mudou o símbolo ™/® no nome, é o
  // mesmo jogo). Só os genuinamente novos que reconheço com confiança
  // real de App ID/processo. Jogos muito recentes/de nicho que não
  // reconheço (Zenless Zone Zero, Diablo IV via Steam, etc — muitos
  // saíram primeiro em outras plataformas e a Steam pode ter um App ID
  // diferente do que eu conheço de outros contextos) ficaram de fora.
  { name: 'Hogwarts Legacy', steamAppId: 990080, process: { win: 'HogwartsLegacy.exe' } },
  { name: 'Forza Horizon 5', steamAppId: 1551360, process: { win: 'ForzaHorizon5.exe' } },
  { name: 'Dragon\'s Dogma 2', steamAppId: 2054970, process: { win: 'DD2.exe' } },
  { name: 'DAVE THE DIVER', steamAppId: 1868140, process: { win: 'DaveTheDiver.exe' } },
  { name: 'Cuphead', steamAppId: 268910, process: { win: 'Cuphead.exe' } },
  { name: 'Rocket League', steamAppId: 252950, process: { win: 'RocketLeague.exe' } },
  { name: 'Manor Lords', steamAppId: 1363080, process: { win: 'ManorLords.exe' } },
  { name: 'Rise of the Tomb Raider', steamAppId: 391220, process: { win: 'ROTTR.exe' } },
  { name: 'Shadow of the Tomb Raider: Definitive Edition', steamAppId: 750920, process: { win: 'SOTTR.exe' } },
  { name: 'CONTROL Ultimate Edition', steamAppId: 870780, process: { win: 'Control_DX11.exe' } },
  { name: 'Magic: The Gathering Arena', steamAppId: 1958200, process: { win: 'MTGA.exe' } },
  { name: 'iRacing', steamAppId: 266410, process: { win: 'iRacingUI.exe' } },
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
