"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultIgloo = exports.FilePenguinRepository = exports.DataFolder = void 0;
exports.getDefaultPenguin = getDefaultPenguin;
exports.ensureMascots = ensureMascots;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const utils_1 = require("../../common/utils.js");
const mascots_1 = require("../game-data/mascots.js");
function capitalizeName(name) {
    return name.split(' ').map((name => {
        return name.slice(0, 1).toUpperCase() + name.slice(1).toLowerCase();
    })).join(' ');
}
function getDefaultPenguin(name, color, member, virtualTimestamp) {
    return {
        name: capitalizeName(name),
        mascot: 0,
        is_member: member,
        is_agent: false,
        color: color,
        head: 0,
        face: 0,
        neck: 0,
        body: 0,
        hand: 0,
        feet: 0,
        background: 0,
        pin: 0,
        inventory: [color],
        coins: 500,
        registration_date: Date.now(),
        minutes_played: 0,
        virtualRegistrationTimestamp: virtualTimestamp,
        stamps: [],
        stampbook: {
            color: 1,
            highlight: 1,
            pattern: 0,
            icon: 1,
            stamps: [],
            recent_stamps: []
        },
        puffleSeq: 0,
        puffles: [],
        backyard: [],
        puffleItems: {},
        hasDug: false,
        treasureFinds: [],
        rainbow: {
            adoptability: false,
            currentTask: 0,
            coinsCollected: []
        },
        igloo: 1,
        igloos: [(0, exports.getDefaultIgloo)(1)],
        furniture: {},
        iglooFloorings: [],
        iglooTypes: [1],
        iglooLocations: [1],
        iglooSeq: 1,
        mail: [],
        mailSeq: 0,
        ownedMedals: 0,
        careerMedals: 0,
        nuggets: 0,
        cards: {},
        cardProgress: 0,
        isNinja: false,
        senseiAttempts: 0,
        cardWins: 0,
        battleOfDoom: false
    };
}
class DataFolder {
    _folderPath;
    constructor(userFolder) {
        this._folderPath = path_1.default.join(userFolder, 'data');
    }
    getPath() {
        return this._folderPath;
    }
    init(version) {
        let exists = true;
        if (!fs_1.default.existsSync(this._folderPath)) {
            exists = false;
            fs_1.default.mkdirSync(this._folderPath);
        }
        const migrator = new DatabaseMigrator(this._folderPath, version);
        if (exists) {
            migrator.migrateDatabase();
        }
        else {
            migrator.cache();
        }
    }
}
exports.DataFolder = DataFolder;
class DatabaseMigrator {
    _folderPath;
    _currentVersion;
    _versionPath;
    constructor(_folderPath, _currentVersion) {
        this._folderPath = _folderPath;
        this._currentVersion = _currentVersion;
        this._versionPath = path_1.default.join(_folderPath, '.version');
    }
    writeVersion() {
        fs_1.default.writeFileSync(this._versionPath, this._currentVersion);
    }
    cache() {
        this.writeVersion();
    }
    migrate_0_2_0() {
        const penguinsDir = path_1.default.join(this._folderPath, 'penguins');
        const penguins = fs_1.default.readdirSync(penguinsDir);
        for (const penguin of penguins) {
            if (penguin.match(/\d+\.json/) !== null) {
                const penguinDir = path_1.default.join(penguinsDir, penguin);
                const content = JSON.parse(fs_1.default.readFileSync(penguinDir, { encoding: 'utf-8' }));
                content.is_member = true;
                const inventory = {};
                for (const item of content.inventory) {
                    inventory[item] = 1;
                }
                content.inventory = inventory;
                content.furniture = {};
                content.iglooTypes = { 1: 1 };
                fs_1.default.writeFileSync(penguinDir, JSON.stringify(content));
            }
        }
    }
    migrate_0_3_3() {
        const penguinsDir = path_1.default.join(this._folderPath, 'penguins');
        const penguins = fs_1.default.readdirSync(penguinsDir);
        const penguinIds = [];
        const hashMapToArray = (hashMap) => {
            const array = [];
            for (const item in hashMap) {
                array.push(Number(item));
            }
            return array;
        };
        for (const penguin of penguins) {
            const penguinmatch = penguin.match(/(\d+)\.json/);
            if (penguinmatch !== null) {
                penguinIds.push(Number(penguinmatch[1]));
                const penguinDir = path_1.default.join(penguinsDir, penguin);
                const content = JSON.parse(fs_1.default.readFileSync(penguinDir, { encoding: 'utf-8' }));
                content.inventory = hashMapToArray(content.inventory);
                content.iglooTypes = hashMapToArray(content.iglooTypes);
                const previousIgloo = content.igloo;
                const newIgloo = {
                    ...previousIgloo,
                    id: 1,
                    locked: true,
                    location: 1,
                    type: previousIgloo.type === 0 ? 1 : previousIgloo.type
                };
                content.igloo = 1;
                content.igloos = [newIgloo];
                content.iglooSeq = 1;
                content.iglooFloorings = [];
                content.iglooLocations = [1];
                content.careerMedals = 0;
                content.ownedMedals = 0;
                content.nuggets = 0;
                content.backyard = [];
                content.puffleItems = {};
                content.hasDug = false;
                content.treasureFinds = [];
                content.rainbow = {
                    adoptability: false,
                    currentTask: 0,
                    coinsCollected: []
                };
                content.id = undefined;
                fs_1.default.writeFileSync(penguinDir, JSON.stringify(content));
            }
        }
        penguinIds.forEach((penguinId) => {
            fs_1.default.renameSync(path_1.default.join(penguinsDir, `${penguinId}.json`), path_1.default.join(penguinsDir, `${penguinId + 100}.json`));
        });
        // in this versions, penguins seq now starts at 100 instead of 0 (fix mascot IDs)
        const seqDir = path_1.default.join(penguinsDir, 'seq');
        const previousSeq = fs_1.default.readFileSync(seqDir, { encoding: 'utf-8' });
        fs_1.default.writeFileSync(seqDir, String(Number(previousSeq) + 100));
    }
    migrate_1_1_2() {
        const penguinsDir = path_1.default.join(this._folderPath, 'penguins');
        const penguins = fs_1.default.readdirSync(penguinsDir);
        for (const penguin of penguins) {
            if (penguin.match(/\d+\.json/) !== null) {
                const penguinDir = path_1.default.join(penguinsDir, penguin);
                const content = JSON.parse(fs_1.default.readFileSync(penguinDir, { encoding: 'utf-8' }));
                content.cards = {};
                content.cardProgress = 0;
                content.isNinja = false;
                content.senseiAttempts = 0;
                content.cardWins = 0;
                fs_1.default.writeFileSync(penguinDir, JSON.stringify(content));
            }
        }
    }
    migrate_1_2_2() {
        const penguinsDir = path_1.default.join(this._folderPath, 'penguins');
        const penguins = fs_1.default.readdirSync(penguinsDir);
        for (const penguin of penguins) {
            if (penguin.match(/\d+\.json/) !== null) {
                const penguinDir = path_1.default.join(penguinsDir, penguin);
                const content = JSON.parse(fs_1.default.readFileSync(penguinDir, { encoding: 'utf-8' }));
                content.battleOfDoom = false;
                fs_1.default.writeFileSync(penguinDir, JSON.stringify(content));
            }
        }
    }
    migrate_1_3_0() {
        const penguinsDir = path_1.default.join(this._folderPath, 'penguins');
        const penguins = fs_1.default.readdirSync(penguinsDir);
        for (const penguin of penguins) {
            if (penguin.match(/\d+\.json/) !== null) {
                const penguinDir = path_1.default.join(penguinsDir, penguin);
                const content = JSON.parse(fs_1.default.readFileSync(penguinDir, { encoding: 'utf-8' }));
                content.virtualRegistrationTimestamp = content.registration_date;
                fs_1.default.writeFileSync(penguinDir, JSON.stringify(content));
            }
        }
    }
    migrateVersion(version) {
        switch (version) {
            case '0.2.0':
                this.migrate_0_2_0();
                return '0.2.1';
            case '0.2.1':
                return '0.2.2';
            case '0.2.2':
                return '0.2.3';
            case '0.2.3':
                return '0.3.0';
            case '0.3.0':
                return '0.3.1';
            case '0.3.1':
                return '0.3.2';
            case '0.3.2':
                return '0.3.3';
            case '0.3.3':
                this.migrate_0_3_3();
                return '1.0.0';
            case '1.0.0':
                return '1.1.0';
            case '1.1.0':
                return '1.1.1';
            case '1.1.1':
                return '1.1.2';
            case '1.1.2':
                this.migrate_1_1_2();
                return '1.2.0';
            case '1.2.0':
                return '1.2.1';
            case '1.2.1':
                return '1.2.2';
            case '1.2.2':
                this.migrate_1_2_2();
                return '1.3.0';
            case '1.3.0':
                this.migrate_1_3_0();
                return '1.3.1';
            case '1.3.1':
                return '1.3.2';
            case '1.3.2':
                return '1.3.3';
            case '1.3.3':
                return '1.4.0';
            case '1.4.0':
                return '1.4.1';
            case '1.4.1':
                return '1.4.2';
            case '1.4.2':
                return '1.4.3';
            case '1.4.3':
                return '1.4.4';
            case '1.4.4':
                return '1.4.5';
            case '1.4.5':
                return '1.5.0';
            case '1.5.0':
                return '1.5.1';
            default:
                throw new Error('Invalid database version: ' + version);
        }
    }
    migrateDatabase() {
        let curVersion = fs_1.default.existsSync(this._versionPath) ? fs_1.default.readFileSync(this._versionPath, 'utf-8').trim() : '0.2.0';
        // version 0.2.0 didnt have a .version file
        // any version before is not compatible with migration
        while (curVersion !== this._currentVersion) {
            curVersion = this.migrateVersion(curVersion);
        }
        this.writeVersion();
    }
}
/** Garante que os mascotes (Rockhopper, Aunt Arctic...) existam no repositório */
async function ensureMascots(db) {
    await Promise.all(mascots_1.MASCOTS.map(async (mascot) => {
        if (await db.get(mascot.id) === null) {
            const penguin = {
                ...getDefaultPenguin(mascot.name, 1, true, new Date(2005, 9, 24).getTime()),
                inventory: [...mascot.starterItems]
            };
            await db.createWithId(mascot.id, penguin);
        }
    }));
}
class FilePenguinRepository {
    _path;
    _seq;
    _writes = new Map();
    constructor(userFolder) {
        this._path = path_1.default.join(userFolder, 'penguins');
        if (!fs_1.default.existsSync(this._path)) {
            fs_1.default.mkdirSync(this._path, { recursive: true });
        }
        this._seq = new SeqFile(this._path, 100);
    }
    getFolderPath(id) {
        return path_1.default.join(this._path, `${id}.json`);
    }
    async get(id) {
        const file = this.getFolderPath(id);
        if (fs_1.default.existsSync(file)) {
            return JSON.parse((await (0, utils_1.readFile)(file)).toString('utf-8'));
        }
        else {
            return null;
        }
    }
    async createWithId(id, data) {
        await (0, utils_1.writeFile)(this.getFolderPath(id), JSON.stringify(data));
    }
    async create(data) {
        const id = this._seq.reserve();
        await this.createWithId(id, data);
        return id;
    }
    write(id, data) {
        const filePath = this.getFolderPath(id);
        const content = JSON.stringify(data);
        const previous = this._writes.get(id) ?? Promise.resolve();
        const temporaryPath = path_1.default.join(this._path, `.${id}.tmp`);
        const queued = previous.catch(() => undefined).then(async () => {
            await (0, utils_1.writeFile)(temporaryPath, content);
            await fs_1.default.promises.rename(temporaryPath, filePath);
        });
        this._writes.set(id, queued);
        const cleanUp = () => {
            if (this._writes.get(id) === queued) {
                this._writes.delete(id);
            }
        };
        queued.then(cleanUp, cleanUp);
        return queued;
    }
    async fromName(name) {
        const files = await fs_1.default.promises.readdir(this._path);
        for (const file of files) {
            const idMatch = file.match(/(\d+)\.json/);
            if (idMatch !== null) {
                const content = JSON.parse((await (0, utils_1.readFile)(path_1.default.join(this._path, file))).toString('utf-8'));
                const n = content?.name;
                if (typeof n === 'string' && n.toLowerCase() === name.toLowerCase()) {
                    return [Number(idMatch[1]), content];
                }
            }
        }
        return null;
    }
    async exists(name) {
        return await this.fromName(name) !== null;
    }
}
exports.FilePenguinRepository = FilePenguinRepository;
class SeqFile {
    _seq;
    _path;
    constructor(databaseFolder, initialValue) {
        this._path = path_1.default.join(databaseFolder, 'seq');
        if (fs_1.default.existsSync(this._path)) {
            this._seq = Number(fs_1.default.readFileSync(this._path, 'utf-8'));
        }
        else {
            this._seq = initialValue;
            this.writeFile();
        }
    }
    writeFile() {
        (0, utils_1.writeFile)(this._path, String(this._seq)).catch(err => { throw err; });
    }
    reserve() {
        this._seq++;
        this.writeFile();
        return this._seq;
    }
}
const getDefaultIgloo = (id) => {
    return {
        id,
        type: 1,
        flooring: 0,
        location: 0,
        music: 0,
        furniture: [],
        locked: true
    };
};
exports.getDefaultIgloo = getDefaultIgloo;
