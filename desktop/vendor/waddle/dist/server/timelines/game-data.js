"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameData = exports.COLS = exports.ROWS = void 0;
exports.getNewspaperDate = getNewspaperDate;
const utils_1 = require("../../common/utils.js");
const news_txt_1 = require("../file-generators/news.txt.js");
const as3_static_1 = require("../game-data/as3-static.js");
const clothing_1 = require("../game-data/clothing.js");
const cpip_as3_static_1 = require("../game-data/cpip-as3-static.js");
const cpip_static_1 = require("../game-data/cpip-static.js");
const files_1 = require("../game-data/files.js");
const furniture_1 = require("../game-data/furniture.js");
const music_1 = require("../game-data/music.js");
const precpip_static_1 = require("../game-data/precpip-static.js");
const stage_plays_1 = require("../game-data/stage-plays.js");
const stamps_1 = require("../game-data/stamps.js");
const furniture_2 = require("../game-logic/furniture.js");
const items_1 = require("../game-logic/items.js");
const versions_1 = require("../routes/versions.js");
const updates_1 = require("../updates/updates.js");
const path_1 = __importDefault(require("path"));
const SCAVENGER_ICON_PATH = 'scavenger_hunt/scavenger_hunt_icon.swf';
const TICKET_INFO_PATH = 'close_ups/tickets.swf';
function getNewspaperDate(year, month, day) {
    return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}
function isMusicList(arr) {
    return !('pos' in arr[0]);
}
/** Number of rows in a 2D music list */
exports.ROWS = 7;
/** Number of columns in a 2D music list */
exports.COLS = 2;
/** Applies a patch to a music list */
function applyPatch(list, songs) {
    // clear all previous "news"
    for (let i = 0; i < exports.ROWS; i++) {
        for (let j = 0; j < exports.COLS; j++) {
            list[i][j].new = undefined;
        }
    }
    songs.forEach((song) => {
        const [row, col] = song.pos;
        list[row - 1][col - 1] = { id: song.id, display: song.display, new: true };
    });
}
function getFreshState() {
    return {
        files: new Map(),
        stampbook: [],
        hunt: null,
        fair: false,
        partyIcon: false,
        partyName: null,
        migrator: false,
        mapNote: false,
        unlockedDay: null,
        preCpip: true,
        vanillaEngine: false,
        indexHtml: '',
        as3: false,
        website: '',
        scavenger: false,
        stamps: false,
        stageScript: [],
        localPaths: new Map(),
        compositePaths: true,
        newShell2009: false,
        roomMusic: new Map(),
        roomMember: new Map(),
        gameMusic: new Map(),
        furniturePrices: new Map(),
        itemPrices: new Map(),
        globalPaths: new Map(),
        school: false,
        mall: false,
        vr: true,
        issues: [],
        roomsFrame: new Map(),
        chatVersion: 0,
        iglooVersion: 0,
        startscreens: [],
        as3Startscreen: false,
        worldStamps: [],
        gameStrings: new Map(),
        iglooMusic: null,
        egg: 0,
        activeFeatures: null,
        coinsForChange: false,
        bakery: false,
        cfcValues: null,
        clientItems: new Set(),
        partyOp: null,
        freeBrownPuffle: false,
        gameStamps: new Map(),
        releasedStamps: new Set(),
        extraWaddleRooms: [],
        iglooMusicReleased: false,
        ownedIgloos: false,
        isSpOnJr: false,
        puffleHandItems: true
    };
}
/** Manages all the data related to the game at a particular point in time */
class GameData {
    state = getFreshState();
    updateListener = new utils_1.EventListener();
    date;
    updates;
    items;
    constructor(settings) {
        this.updates = (0, updates_1.getUpdates)();
        // todo: remove global state
        this.items = items_1.ITEMS;
        this.date = settings.settings.version;
        this.update(settings.settings.version);
        settings.addListener(() => {
            this.update(settings.settings.version);
        });
    }
    addRoom(room, file) {
        const roomRoute = (this.state.preCpip ? 'artwork/rooms/' : 'play/v2/content/global/rooms/') + room + '.swf';
        this.addRoute(roomRoute, file);
    }
    addRoute(route, file) {
        this.state.files.set((0, utils_1.toForwardSlash)(route), (0, files_1.getMediaFilePath)(file));
    }
    addCatalog(input, paths) {
        const file = typeof input === 'string' ? input : input.file;
        if (file !== undefined) {
            paths.forEach(p => this.addRoute(p, file));
        }
    }
    addCrumbChange(baseRoute, route, info) {
        const fileRef = typeof info === 'string' ? info : info[0];
        const fullRoute = path_1.default.join(baseRoute, route);
        this.addRoute(fullRoute, fileRef);
    }
    addIdMap(parentDir, directory, idMap) {
        (0, utils_1.iterateEntries)(idMap, (id, file) => {
            this.addRoute(path_1.default.join(parentDir, directory, `${id}.swf`), file);
        });
    }
    addRouteMap(routeMap) {
        (0, utils_1.iterateEntries)(routeMap, (route, file) => {
            this.addRoute(route, file);
        });
    }
    addDefaultInfo() {
        ['play/v2/content/global', ''].forEach((parentDir) => this.addIdMap(parentDir, 'music', music_1.MUSIC_IDS));
        const clothingDir = 'play/v2/content/global/clothing';
        const preCpipClothingDir = 'artwork';
        this.addIdMap(clothingDir, 'icons', clothing_1.ICONS);
        this.addIdMap(clothingDir, 'paper', clothing_1.PAPER);
        const preCpipPhotos = {};
        (0, utils_1.iterateEntries)(clothing_1.PHOTOS, (id, file) => {
            preCpipPhotos[Number(id) - 900] = file;
        });
        this.addIdMap(clothingDir, 'photos', clothing_1.PHOTOS);
        this.addIdMap(preCpipClothingDir, 'photos', preCpipPhotos);
        this.addIdMap(clothingDir, 'sprites', clothing_1.SPRITES);
        this.addIdMap(preCpipClothingDir, 'items', clothing_1.SPRITES);
        const furnitureDir = 'play/v2/content/global/furniture';
        this.addIdMap(furnitureDir, 'icons', furniture_1.FURNITURE_ICONS);
        this.addIdMap(furnitureDir, 'sprites', furniture_1.FURNITURE_SPRITES);
        this.addRouteMap(precpip_static_1.PRE_CPIP_STATIC_FILES);
        // furniture prices
        furniture_2.FURNITURE.rows.forEach((furniture) => {
            this.state.furniturePrices.set(furniture.id, furniture.cost);
        });
        this.items.rows.forEach((item) => {
            this.state.itemPrices.set(item.id, item.cost);
        });
    }
    addStampCategory(category) {
        const stampRoom = stamps_1.STAMP_ROOMS[category.group_id];
        if (stampRoom !== undefined) {
            this.state.gameStamps.set(stampRoom, new Set(category.stamps.map(s => s.stamp_id)));
        }
        category.stamps.forEach(stamp => {
            this.state.releasedStamps.add(stamp.stamp_id);
        });
    }
    addListener(callback) {
        this.updateListener.addListener(callback);
    }
    update(date) {
        this.date = date;
        this.state = getFreshState();
        this.addDefaultInfo();
        let pinRoom = null;
        const scripts = new Map();
        let currentList = null;
        const actions = {
            'dateReference': (v) => {
                switch (v) {
                    case 'stamps-release':
                        this.state.stampbook = JSON.parse(JSON.stringify(stamps_1.ORIGINAL_STAMPBOOK));
                        this.state.stamps = true;
                        stamps_1.ORIGINAL_STAMPBOOK.forEach(category => {
                            this.addStampCategory(category);
                        });
                        break;
                    case 'cpip':
                        this.state.preCpip = false;
                        this.addRouteMap(cpip_static_1.CPIP_STATIC_FILES);
                        this.addRouteMap(cpip_as3_static_1.CPIP_AS3_STATIC_FILES);
                        break;
                    case 'vanilla-engine':
                        this.state.vanillaEngine = true;
                        this.state.isSpOnJr = true;
                        // intersection until the 2012 PR is added
                        this.state.puffleHandItems = false;
                        this.addRouteMap(as3_static_1.AS3_STATIC_FILES);
                        break;
                    case 'as3':
                        this.state.as3 = true;
                        break;
                    case 'composite-paths':
                        this.state.compositePaths = false;
                        break;
                    case 'string-verify':
                        this.state.newShell2009 = true;
                        break;
                    case 'placeholder-2016':
                        this.state.school = true;
                        break;
                    case 'mall':
                        this.state.mall = true;
                        break;
                    case 'vr-room':
                        this.state.vr = false;
                        break;
                    case 'as3-startscreen':
                        this.state.as3Startscreen = true;
                        break;
                    case 'igloo-music':
                        this.state.iglooMusicReleased = true;
                        break;
                    case 'owned-igloos':
                        this.state.ownedIgloos = true;
                        break;
                    default:
                        break;
                }
            },
            'fileChanges': (v) => {
                (0, utils_1.iterateEntries)(v, (route, fileRef) => {
                    this.addRoute(route, fileRef);
                });
            },
            'stampUpdates': (v) => {
                v.forEach(u => {
                    if ('category' in u) {
                        this.state.stampbook.push(JSON.parse(JSON.stringify(u.category)));
                        this.addStampCategory(u.category);
                    }
                    else {
                        for (let i = 0; i < this.state.stampbook.length; i++) {
                            if (this.state.stampbook[i].group_id === u.categoryId) {
                                this.state.stampbook[i].stamps.push(...u.stamps);
                                break;
                            }
                        }
                        const stampRoom = stamps_1.STAMP_ROOMS[u.categoryId];
                        const gameStampSet = this.state.gameStamps.get(stampRoom);
                        if (gameStampSet !== undefined) {
                            u.stamps.forEach(stamp => gameStampSet.add(stamp.stamp_id));
                        }
                        u.stamps.forEach(stamp => {
                            this.state.releasedStamps.add(stamp.stamp_id);
                        });
                    }
                });
            },
            'scavengerHunt2011': (v) => {
                this.state.hunt = v;
                this.addRoute(path_1.default.join('play/v2/content/global', SCAVENGER_ICON_PATH), v.icon);
                this.state.globalPaths.set('scavenger_hunt_icon', SCAVENGER_ICON_PATH);
            },
            'fairCpip': (v) => {
                if (!this.state.vanillaEngine) {
                    this.addRoute('play/v2/client/fair.swf', 'tool:fair_icon_adder.swf');
                }
                this.state.fair = true;
                this.addRoute(`play/v2/content/global/${SCAVENGER_ICON_PATH}`, v.iconFileId);
                this.addRoute(`play/v2/content/local/en/${TICKET_INFO_PATH}`, v.infoFile);
                this.state.localPaths.set('tickets', TICKET_INFO_PATH);
                this.state.globalPaths.set('ticket_icon', SCAVENGER_ICON_PATH);
            },
            'partyIconFile': (v) => {
                this.state.partyIcon = true;
                this.addRoute(`play/v2/content/global/${SCAVENGER_ICON_PATH}`, v);
            },
            'migrator': (v) => {
                this.state.migrator = v === false ? false : true;
                if (typeof v === 'string') {
                    this.addRoute('play/v2/content/local/en/catalogues/pirate.swf', v);
                }
            },
            'mapNote': (v) => {
                this.state.mapNote = true;
                this.addRoute('play/v2/content/local/en/close_ups/party_map_note.swf', v);
            },
            'unlockedDay': (v) => {
                this.state.unlockedDay = v;
            },
            'pinRoom': (v) => {
                pinRoom = v.room;
                if (v.frame !== undefined) {
                    this.state.roomsFrame.set(v.room, v.frame);
                }
            },
            'rooms': (v) => {
                (0, utils_1.iterateEntries)(v, (room, value) => {
                    this.addRoom(room, value);
                });
            },
            'pinRoomUpdate': (v) => {
                if (pinRoom !== null) {
                    this.addRoom(pinRoom, v);
                }
            },
            'map': (v) => {
                if (this.state.preCpip) {
                    this.addRoute('artwork/maps/island5.swf', v);
                    this.addRoute('artwork/maps/16_forest.swf', v);
                }
                else {
                    this.addRoute('play/v2/content/global/content/map.swf', v);
                }
            },
            'clothingCatalog': (v) => {
                this.addCatalog(v, this.state.preCpip ? ['artwork/catalogue/clothing.swf', 'artwork/catalogue/clothing_.swf'] : ['play/v2/content/local/en/catalogues/clothing.swf']);
            },
            'postcardCatalog': (v) => {
                this.addRoute('artwork/catalogue/cards.swf', v);
                this.addRoute('artwork/catalogue/cards_0712.swf', v);
            },
            'hairCatalog': (v) => {
                this.addRoute('play/v2/content/local/en/catalogues/hair.swf', v);
            },
            'petFurniture': (v) => {
                if (this.state.preCpip) {
                    this.addRoute('artwork/catalogue/pets_.swf', v);
                }
                else {
                    this.addRoute('play/v2/content/local/en/catalogues/pets.swf', v);
                }
            },
            'puffleCatalog': (v) => {
                if (this.state.preCpip) {
                    this.addRoute('artwork/catalogue/adopt_.swf', v);
                    this.addRoute('artwork/catalogue/puffle_.swf', v);
                }
                else {
                    this.addRoute('play/v2/content/local/en/catalogues/adopt.swf', v);
                }
            },
            'martialArtworks': (v) => {
                this.addCatalog(v, ['play/v2/content/local/en/catalogues/ninja.swf']);
            },
            'furnitureCatalog': (v) => {
                if (this.state.preCpip) {
                    this.addRoute('artwork/catalogue/furniture.swf', v);
                    this.addRoute('artwork/catalogue/furniture_.swf', v);
                }
                else {
                    this.addRoute('play/v2/content/local/en/catalogues/furniture.swf', v);
                }
            },
            'iglooCatalog': (v) => {
                if (this.state.preCpip) {
                    this.addRoute('artwork/catalogue/igloo_.swf', v);
                    this.addRoute('play/v2/content/local/en/catalogues/igloo.swf', v);
                }
            },
            'startscreens': (v) => {
                const screenFiles = [];
                const resolvedScreens = v.map((screen, i) => {
                    if (typeof screen === 'string') {
                        screenFiles.push(screen);
                        return `background${i}.swf`;
                    }
                    else {
                        screenFiles.push(screen[1]);
                        return screen[0];
                    }
                });
                this.state.startscreens = resolvedScreens;
                screenFiles.forEach((file, i) => {
                    const screen = resolvedScreens[i];
                    this.addRoute(`play/v2/content/local/en/login/backgrounds/${screen}`, file);
                    this.addRoute(`play/start/billboards/login/backgrounds/${screen}`, file);
                });
            },
            'localChanges': (v) => {
                (0, utils_1.iterateEntries)(v, (route, languages) => {
                    (0, utils_1.iterateEntries)(languages, (language, info) => {
                        // updating the route file
                        this.addCrumbChange(path_1.default.join('play/v2/content/local', language), route, info);
                        // updating the key -> route
                        if (typeof info !== 'string') {
                            const [_, ...paths] = info;
                            paths.forEach((path) => {
                                this.state.localPaths.set(path, route);
                            });
                        }
                    });
                });
            },
            'globalChanges': (v) => {
                (0, utils_1.iterateEntries)(v, (route, info) => {
                    // add file to the routes
                    this.addCrumbChange('play/v2/content/global', route, info);
                    // add routes to the keys
                    if (typeof info !== 'string') {
                        const [_, ...paths] = info;
                        paths.forEach((globalPath) => {
                            this.state.globalPaths.set(globalPath, route);
                        });
                    }
                });
            },
            'iglooList': (v) => {
                // not boolean or string: is igloo list
                if (v !== true && typeof v !== 'string') {
                    const route = 'play/v2/content/global/content/igloo_music.swf';
                    // has file: non dynamic
                    if ('file' in v) {
                        this.addRoute(route, v.file);
                    }
                    else {
                        // dynamic
                        this.addRoute(route, 'tool:dynamic_igloo_music.swf');
                        if (isMusicList(v)) {
                            currentList = v;
                        }
                        else {
                            if (currentList === null) {
                                throw new Error('Patch came before a list');
                            }
                            applyPatch(currentList, v);
                        }
                    }
                }
            },
            'scavengerHunt2007': (v) => {
                this.addRoute('artwork/eggs/1.swf', v);
                this.state.egg = 1;
            },
            'scavengerHunt2010': (v) => {
                this.state.scavenger = true;
                this.addRoute(path_1.default.join('play/v2/content/global', v.iconFilePath ?? SCAVENGER_ICON_PATH), v.iconFileId);
                const huntIconPath = v.iconFilePath ?? SCAVENGER_ICON_PATH;
                this.state.globalPaths.set('scavenger_hunt_icon', huntIconPath);
            },
            'stagePlay': (v) => {
                // costume trunk
                this.addCatalog(v.costumeTrunk, [
                    'artwork/catalogue/costume_0712.swf',
                    'play/v2/content/local/en/catalogues/costume.swf'
                ]);
                // stage script
                let script = scripts.get(v.name);
                if (script === undefined) {
                    script = v.script ?? [];
                    scripts.set(v.name, script);
                }
                else {
                    if (v.script !== undefined) {
                        script = v.script;
                        scripts.set(v.name, script);
                    }
                }
                this.state.stageScript = script;
                // room music
                this.state.roomMusic.set('stage', (0, stage_plays_1.getStagePlayMusic)(v.name));
            },
            'sportCatalog': (v) => {
                this.addCatalog(v, [
                    'artwork/catalogue/sport_.swf',
                    'play/v2/content/local/en/catalogues/sport.swf'
                ]);
            },
            'indexHtml': (v) => {
                this.addRoute('', `websites:${v}.html`);
            },
            'websiteFolder': (v) => {
                this.state.website = v;
            },
            'playScript': (v) => {
                this.state.stageScript = v;
            },
            'music': (v) => {
                (0, utils_1.iterateEntries)(v, (room, music) => {
                    this.state.roomMusic.set(room, music);
                });
            },
            'memberRooms': (v) => {
                (0, utils_1.iterateEntries)(v, (room, member) => {
                    this.state.roomMember.set(room, member);
                });
            },
            'gameMusic': (v) => {
                (0, utils_1.iterateEntries)(v, (game, music) => {
                    this.state.gameMusic.set(game, music);
                });
            },
            'furniturePrices': (v) => {
                (0, utils_1.iterateEntries)(v, (key, value) => {
                    this.state.furniturePrices.set(Number(key), value);
                });
            },
            'prices': (v) => {
                (0, utils_1.iterateEntries)(v, (key, value) => {
                    this.state.itemPrices.set(Number(key), value);
                });
            },
            'issue': (v) => {
                if (this.state.issues.length >= 7) {
                    this.state.issues.pop();
                }
                this.state.issues.splice(0, 0, { ...v, as3: this.state.as3 });
                if (v.type === 'as2'
                // typeof update.info === 'string' || 'file' in update.info
                ) {
                    const file = v.file;
                    const issue = v.edition;
                    // pre-cpip, before rewrite
                    this.addRoute(`artwork/news/news${issue}.swf`, file);
                    // pre-cpip, post rewrite
                    const route2007 = (0, news_txt_1.getNewspaperName)(v.year, v.month, v.day).replace('|', '/') + '.swf';
                    this.addRoute(path_1.default.join('artwork/news', route2007), file);
                    // 2006 boiler room (likely inaccurate, this artwork/archives was probably not a newspaper but a bundle of papers)
                    if (typeof issue === 'number') {
                        this.addRoute(path_1.default.join('artwork/archives', `news${issue + 1}.swf`), file);
                    }
                    // post-cpip
                    const date = getNewspaperDate(v.year, v.month, v.day);
                    this.addRoute(`play/v2/content/local/en/news/${date}/${date}.swf`, file);
                }
                else {
                    const baseNewsPath = 'play/v2/content/local/en/news/';
                    const oldNewsPath = `${baseNewsPath}${getNewspaperDate(v.year, v.month, v.day)}`;
                    const newNewsPath = `${baseNewsPath}papers/${getNewspaperDate(v.year, v.month, v.day)}`;
                    const configXmlPath = 'tool:news_config.xml';
                    this.addRoute(path_1.default.join(oldNewsPath, 'config.xml'), configXmlPath);
                    this.addRoute(path_1.default.join(newNewsPath, 'config.xml'), configXmlPath);
                    const newspaperComponenets = [
                        ['front/header.swf', v.headerFront ?? 'archives:News285HeaderFront.swf'],
                        ['front/featureStory.swf', v.featureStory],
                        ['front/supportStory.swf', v.supportStory],
                        ['front/upcomingEvents.swf', v.upcomingEvents],
                        ['front/newsFlash.swf', v.newsFlash],
                        ['front/askAuntArctic.swf', v.askFront],
                        ['front/dividers.swf', v.dividersFront ?? 'approximation:dividers_blank.swf'],
                        ['front/navigation.swf', v.navigationFront ?? 'archives:News268NavigationFront.swf'],
                        ['back/header.swf', v.headerBack ?? 'archives:News285HeaderBack.swf'],
                        ['back/askAuntArctic.swf', v.askBack],
                        ['back/secrets.swf', v.secrets ?? 'archives:News285Secrets.swf'],
                        ['back/submitYourContent.swf', v.submit ?? 'archives:News268SubmitYourContent.swf'],
                        ['back/jokesAndRiddles.swf', v.jokes ?? 'archives:News285JokesAndRiddles.swf'],
                        ['back/dividers.swf', v.dividersBack ?? 'approximation:dividers_blank.swf'],
                        ['back/navigation.swf', v.navigationBack ?? 'archives:News268NavigationBack.swf']
                    ];
                    if (v.answers !== undefined) {
                        newspaperComponenets.push(['overlays/riddlesAnswers.swf', v.answers]);
                    }
                    if (v.extraJokes !== undefined) {
                        newspaperComponenets.push(['overlays/extraJokes.swf', v.extraJokes]);
                    }
                    if (v.secret !== undefined && v.secret !== null) {
                        newspaperComponenets.push(['overlays/secret.swf', v.secret]);
                    }
                    if (v.iglooWinners !== undefined) {
                        newspaperComponenets.push(['overlays/iglooWinners.swf', v.iglooWinners]);
                    }
                    if (v.featureMore !== undefined) {
                        newspaperComponenets.push(['overlays/featureMore.swf', v.featureMore ?? 'archives:News284FeatureMore.swf']);
                    }
                    if (v.supportMore !== undefined) {
                        newspaperComponenets.push(['overlays/supportMore.swf', v.supportMore ?? 'archives:News282SupportMore.swf']);
                    }
                    if (v.extra !== undefined) {
                        newspaperComponenets.push(['overlays/extra.swf', v.extra]);
                    }
                    newspaperComponenets.forEach((pair) => {
                        const [route, file] = pair;
                        this.addRoute(path_1.default.join(oldNewsPath, 'content', route), file);
                        this.addRoute(path_1.default.join(newNewsPath, 'content', route), file);
                    });
                }
            },
            'chatVersion': (v) => {
                this.state.chatVersion = v;
            },
            'iglooVersion': (v) => {
                this.state.iglooVersion = v;
            },
            'worldStamps': (v) => {
                v.forEach(e => this.state.worldStamps.push(e));
            },
            'gameStrings': (v) => {
                this.state.gameStrings = new Map(Object.entries(v));
            },
            'activeFeatures': (v) => {
                this.state.activeFeatures = v;
            },
            'coinsForChange': () => {
                this.state.coinsForChange = true;
            },
            'bakery': () => {
                this.state.bakery = true;
            },
            'cfcValues': (v) => {
                this.state.cfcValues = v;
            },
            'clientFiles': (v) => {
                v.forEach(id => this.state.clientItems.add(id));
            },
            'removeClientFiles': (v) => {
                v.forEach(id => this.state.clientItems.delete(id));
            },
            'battleOp': (v) => {
                this.state.partyOp = v;
            },
            'frames': (v) => {
                (0, utils_1.iterateEntries)(v, (room, frame) => {
                    this.state.roomsFrame.set(room, frame);
                });
            },
            'freeBrownPuffle': (v) => {
                this.state.freeBrownPuffle = v;
            },
            'newWaddleRooms': (v) => {
                this.state.extraWaddleRooms = v;
            }
        };
        for (const update of this.updates) {
            // check every update until the current date
            if ((0, versions_1.isGreater)(update.date, date)) {
                break;
            }
            // don't include temporary events that finished already
            if (update.end !== undefined && (0, versions_1.isGreaterOrEqual)(date, update.end)) {
                continue;
            }
            const u = update.update;
            if (typeof u.partyName === 'string') {
                this.state.partyName = u.partyName;
            }
            for (const key in actions) {
                const value = update.update[key];
                if (value !== undefined) {
                    const callback = actions[key];
                    callback(value, this.state);
                }
            }
            this.updateListener.fire();
        }
    }
    /**
     * Project Club — "camada de festa": salas de uma festa que o Waddle Forever
     * não tem na linha do tempo (2013-2017, baixadas da Club Penguin Archives)
     * por cima da ilha da data atual. Usada pelo rodízio de anos e pelas festas
     * que a staff liga no painel. Sobrevive às trocas de data (update()).
     */
    overlay = null;
    /**
     * Liga (ou desliga, com null) a camada de festa.
     * `rooms`: sala → arquivo da mídia (caminho relativo); `music`: sala → id da
     * música; `musicFiles`: id da música → arquivo (músicas que o WF não tem);
     * `extraRoutes`: rota → arquivo (ex.: play/v2/content/global/content/map.swf).
     */
    setPartyOverlay(name, rooms = {}, music = {}, musicFiles = {}, extraRoutes = {}) {
        if (name === null) {
            this.overlay = null;
        }
        else {
            const routes = new Map();
            for (const room in rooms) {
                routes.set(`play/v2/content/global/rooms/${room}.swf`, rooms[room]);
            }
            // outras rotas (ex.: o mapa da ilha decorado da festa)
            for (const route in extraRoutes) {
                routes.set(route, extraRoutes[route]);
            }
            for (const id in musicFiles) {
                routes.set(`play/v2/content/global/music/${id}.swf`, musicFiles[id]);
                routes.set(`music/${id}.swf`, musicFiles[id]);
            }
            const roomMusic = new Map();
            for (const room in music) {
                roomMusic.set(room, music[room]);
            }
            this.overlay = { name, routes, music: roomMusic };
        }
        this.updateListener.fire();
    }
    getPartyOverlayName() {
        return this.overlay?.name ?? null;
    }
    lookupFile(route) {
        return this.overlay?.routes.get(route) ?? this.state.files.get(route);
    }
    /** Todas as rotas de arquivos servidas na data atual (rota → arquivo da mídia). */
    getAllRoutes() {
        if (this.overlay === null) {
            return this.state.files;
        }
        const all = new Map(this.state.files);
        this.overlay.routes.forEach((file, route) => all.set(route, file));
        return all;
    }
    getDate() {
        return this.date;
    }
    getStampbook() {
        return this.state.stampbook;
    }
    getItems() {
        return this.items.rows;
    }
    getHunt() {
        return this.state.hunt;
    }
    getFair() {
        return this.state.fair;
    }
    getMigrator() {
        return this.state.migrator;
    }
    /** Festa (da linha do tempo do WF) ativa numa data qualquer, sem mudar a data atual. */
    getPartyAt(date) {
        let name = null;
        for (const update of this.updates) {
            if ((0, versions_1.isGreater)(update.date, date)) {
                break;
            }
            if (update.end !== undefined && (0, versions_1.isGreaterOrEqual)(date, update.end)) {
                continue;
            }
            const u = update.update;
            if (typeof u.partyName === 'string') {
                name = u.partyName;
            }
        }
        return name;
    }
    /** Festa ativa na data atual (ex.: "Halloween Party"), ou null */
    getPartyName() {
        return this.overlay?.name ?? this.state.partyName;
    }
    getPartyIcon() {
        return this.state.partyIcon;
    }
    getMapNote() {
        return this.state.mapNote;
    }
    getUnlockedDay() {
        return this.state.unlockedDay;
    }
    getIndexHtml() {
        return this.state.indexHtml;
    }
    getAs3() {
        return this.state.as3;
    }
    isPreCpip() {
        return this.state.preCpip;
    }
    getWebsite() {
        return this.state.website;
    }
    isHuntActive() {
        return this.state.scavenger;
    }
    isVanillaEngine() {
        return this.state.vanillaEngine;
    }
    stampsReleased() {
        return this.state.stamps;
    }
    getStageScript() {
        return this.state.stageScript;
    }
    getLocalPaths() {
        return this.state.localPaths;
    }
    useCompositePaths() {
        return this.state.compositePaths;
    }
    isNewShell2009() {
        return this.state.newShell2009;
    }
    getRoomsMusic(overrides) {
        return new Map([...this.state.roomMusic, ...(this.overlay?.music ?? []), ...overrides]);
    }
    getRoomsMember() {
        return this.state.roomMember;
    }
    getGamesMusic() {
        return this.state.gameMusic;
    }
    getFurniturePrices() {
        return this.state.furniturePrices;
    }
    getItemPrices() {
        return this.state.itemPrices;
    }
    getGlobalPaths() {
        return this.state.globalPaths;
    }
    /**
     * Chaves de paths.json das festas de 2013-2017 (paths.json originais do
     * Wayback + as que as salas usam). Não substituem as de 2012.
     */
    _extraPaths = { global: {}, local: {} };
    setExtraPaths(global, local) {
        this._extraPaths = { global: { ...global }, local: { ...local } };
    }
    getExtraPaths() {
        return this._extraPaths;
    }
    _extraStrings = new Map();
    /** Textos do game_strings.json das festas de 2013-2017. */
    setExtraStrings(strings) {
        this._extraStrings = new Map(Object.entries(strings).filter(([k, v]) => typeof k === 'string' && typeof v === 'string'));
    }
    getExtraStrings() {
        return this._extraStrings;
    }
    hasSchool() {
        return this.state.school;
    }
    hasMall() {
        return this.state.mall;
    }
    hasVRRoom() {
        return this.state.vr;
    }
    getIssue() {
        if (this.state.issues.length === 0) {
            return undefined;
        }
        return this.state.issues[0].edition;
    }
    getRoomsFrame() {
        return this.state.roomsFrame;
    }
    getChatVersion() {
        return this.state.chatVersion;
    }
    getIglooVersion() {
        return this.state.iglooVersion;
    }
    getActiveIssues() {
        return this.state.issues;
    }
    getStartScreens() {
        return this.state.startscreens;
    }
    afterAs3Startscreen() {
        return this.state.as3Startscreen;
    }
    getWorldStamps() {
        return this.state.worldStamps;
    }
    getGameStrings() {
        return this.state.gameStrings;
    }
    getIglooList() {
        return this.state.iglooMusic;
    }
    getEgg() {
        return this.state.egg;
    }
    getActiveFeatures() {
        return this.state.activeFeatures;
    }
    hasCoinsForChange() {
        return this.state.coinsForChange;
    }
    hasBakery() {
        return this.state.bakery;
    }
    getCoinsForChangeDonations() {
        return this.state.cfcValues;
    }
    getClientItems() {
        return this.state.clientItems;
    }
    getPartyOp() {
        return this.state.partyOp;
    }
    isBrownPuffleFree() {
        return this.state.freeBrownPuffle;
    }
    getGameStamps(room) {
        return this.state.gameStamps.get(room) ?? new Set();
    }
    isStampAvailable(stamp) {
        return this.state.releasedStamps.has(stamp);
    }
    getExtraWaddleRooms() {
        return this.state.extraWaddleRooms;
    }
    getItem(id) {
        return this.items.get(id);
    }
    hasIglooMusicReleased() {
        return this.state.iglooMusicReleased;
    }
    isAfterOwnedIgloos() {
        return this.state.ownedIgloos;
    }
    isSpOnJr() {
        return this.state.isSpOnJr;
    }
    puffleHandItems() {
        return this.state.puffleHandItems;
    }
}
exports.GameData = GameData;
