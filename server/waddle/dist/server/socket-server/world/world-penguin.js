"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldEntity = exports.OfflinePenguin = exports.WorldPenguin = void 0;
exports.realAgeDays = realAgeDays;
const database_1 = require("../../database/database.js");
const mascots_1 = require("../../game-data/mascots.js");
const ninja_progress_1 = require("../../game-logic/ninja-progress.js");
const versions_1 = require("../../routes/versions.js");
function getVirtualDate(date, offset) {
    // simulating PST time for the current day
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const second = now.getSeconds();
    const [year, month, day] = date;
    // date generates this time thinking in the same timezone as the user
    // an arbitrary offset may be applied depending on how each client behaves
    return new Date(year, month - 1, day, hour + offset, minute, second);
}
/** Dias inteiros desde `registeredAt` (ms), nunca negativo. */
function realAgeDays(registeredAt, now = Date.now()) {
    if (!Number.isFinite(registeredAt) || registeredAt <= 0) {
        return 0;
    }
    return Math.max(0, Math.floor((now - registeredAt) / 86400000));
}
class Profile {
    _id;
    _name;
    _displayName;
    _mascot;
    constructor(_id, data) {
        this._id = _id;
        this._name = data.name;
        this._mascot = data.mascot;
        this._displayName = mascots_1.MASCOTS.find(m => this._id === m.id)?.display ?? this._name;
    }
    get name() {
        return this._name;
    }
    get displayName() {
        return this._displayName;
    }
    changeName(name) {
        this._name = name;
    }
    get mascot() {
        return this._mascot;
    }
    get id() {
        return this._id;
    }
}
class Membership {
    _member;
    constructor(data) {
        this._member = data.is_member;
    }
    swap() {
        this._member = !this._member;
    }
    /** Painel da equipe: define a assinatura diretamente. */
    set(member) {
        this._member = member;
    }
    get isMember() {
        return this._member;
    }
}
class PSA {
    _isAgent;
    _pending = false;
    constructor(data) {
        this._isAgent = data.is_agent;
    }
    get isAgent() {
        return this._isAgent;
    }
    /** Painel da equipe: define se é agente. */
    set(agent) {
        this._isAgent = agent;
        if (!agent)
            this._pending = false;
    }
    setAgent() {
        this._isAgent = true;
    }
    setAgentPending() {
        this._pending = true;
    }
    get isPending() {
        return this._pending;
    }
}
class Inventory {
    _equipped;
    _items;
    constructor(data) {
        this._equipped = {
            color: data.color,
            head: data.head,
            face: data.face,
            neck: data.neck,
            body: data.body,
            feet: data.feet,
            pin: data.pin,
            background: data.background,
            hand: data.hand
        };
        this._items = new Set(data.inventory);
    }
    get color() {
        return this._equipped.color;
    }
    get head() {
        return this._equipped.head;
    }
    get face() {
        return this._equipped.face;
    }
    get neck() {
        return this._equipped.neck;
    }
    get body() {
        return this._equipped.body;
    }
    get feet() {
        return this._equipped.feet;
    }
    get hand() {
        return this._equipped.hand;
    }
    get pin() {
        return this._equipped.pin;
    }
    get background() {
        return this._equipped.background;
    }
    get items() {
        return [...this._items.values()];
    }
    updateWear(items) {
        this._equipped = { ...this._equipped, ...items };
    }
    has(id) {
        return this._items.has(id);
    }
    add(id) {
        this._items.add(id);
    }
    /** Painel da equipe: tira um item (e desequipa se estava vestido). */
    remove(id) {
        this._items.delete(id);
        for (const slot of Object.keys(this._equipped)) {
            if (slot !== 'color' && this._equipped[slot] === id)
                this._equipped[slot] = 0;
        }
    }
}
class Currency {
    _coins;
    constructor(data) {
        this._coins = data.coins;
    }
    get coins() {
        return this._coins;
    }
    discount(coins) {
        this._coins -= coins;
        return this._coins;
    }
    add(coins) {
        this._coins += coins;
        return this._coins;
    }
    /** Painel da equipe: define o saldo. */
    set(coins) {
        this._coins = Math.max(0, Math.floor(coins));
        return this._coins;
    }
}
class Meta {
    _registrationDate;
    constructor(data) {
        this._registrationDate = data.registration_date;
    }
    get registrationTime() {
        return this._registrationDate;
    }
}
class Time {
    _virtualDay;
    _previousPlaytime;
    _sessionStart = Date.now();
    _virtualRegistrationTimestamp;
    _registrationDate;
    constructor(data, _virtualDay) {
        this._virtualDay = _virtualDay;
        this._previousPlaytime = data.minutes_played;
        this._virtualRegistrationTimestamp = data.virtualRegistrationTimestamp;
        this._registrationDate = data.registration_date;
    }
    get minutesPlayed() {
        return this._previousPlaytime + (Date.now() - this._sessionStart) / (1000 * 60);
    }
    get virtualRegistrationTimestamp() {
        return this._virtualRegistrationTimestamp;
    }
    get age() {
        // Idade de verdade: dias desde que o pinguim foi criado (relógio real).
        // A conta antiga usava a data "virtual" de 2012 menos o registro virtual,
        // o que dava números sem sentido (ex.: 742 dias num pinguim de semanas).
        // Mascotes (Rockhopper, Gary…) vêm registrados na abertura do CP (2005):
        // mantêm a idade "lendária" calculada na data do jogo.
        if (this._virtualRegistrationTimestamp > 0 && this._virtualRegistrationTimestamp < Date.UTC(2006, 0, 1)) {
            return Math.max(0, Math.floor((getVirtualDate(this._virtualDay, 0).getTime() - this._virtualRegistrationTimestamp) / 1000 / 86400));
        }
        return realAgeDays(this._registrationDate);
    }
    getDate() {
        return getVirtualDate(this._virtualDay, 0).getTime();
    }
    setVirtualRegistrationToNow() {
        this._virtualRegistrationTimestamp = this.getDate();
    }
}
class BuddyInventory {
    _buddies;
    _ignored;
    constructor(data) {
        this._buddies = new Set(data.buddies);
        this._ignored = new Set(data.ignored);
    }
    get buddies() {
        return [...this._buddies.values()];
    }
    isBuddy(id) {
        return this._buddies.has(id);
    }
    add(id) {
        this._buddies.add(id);
    }
    remove(id) {
        return this._buddies.delete(id);
    }
    ignore(id) {
        this._ignored.add(id);
    }
    unignore(id) {
        this._ignored.delete(id);
    }
    get ignored() {
        return [...this._ignored.values()];
    }
}
class Stampbook {
    _stamps;
    _cover;
    _sessionStamps = new Set();
    constructor(data) {
        this._stamps = new Set(data.stamps);
        this._cover = data.stampbook;
    }
    get stamps() {
        return [...this._stamps.values()];
    }
    get cover() {
        return JSON.parse(JSON.stringify(this._cover));
    }
    setCover(color, highlight, pattern, icon, stamps) {
        this._cover = { ...this._cover, color, highlight, pattern, icon, stamps };
    }
    add(stamp) {
        if (!this.has(stamp)) {
            if (!this._cover.recent_stamps.includes(stamp)) {
                this._cover.recent_stamps.push(stamp);
            }
            this._sessionStamps.add(stamp);
            this._stamps.add(stamp);
        }
    }
    has(stamp) {
        return this._stamps.has(stamp);
    }
    /** Painel da equipe: tira um carimbo (também da capa). */
    remove(stamp) {
        this._stamps.delete(stamp);
        this._sessionStamps.delete(stamp);
        this._cover.recent_stamps = this._cover.recent_stamps.filter((s) => s !== stamp);
        this._cover.stamps = this._cover.stamps.filter((s) => s.stamp !== stamp);
    }
    get recentStamps() {
        return [...this._cover.recent_stamps];
    }
    clearRecentStamps() {
        this._cover.recent_stamps = [];
    }
    get sessionStamps() {
        return [...this._sessionStamps.values()];
    }
    resetSessionStamps() {
        console.log('resetting...');
        this._sessionStamps = new Set();
    }
}
class PuffleInventory {
    _seq;
    _puffles;
    _backyard;
    _items;
    _walking = null;
    constructor(data) {
        this._seq = data.puffleSeq;
        this._puffles = new Map(data.puffles.map(p => [p.id, p]));
        this._backyard = new Set(data.backyard);
        this._items = new Map(Object.entries(data.puffleItems).map(([k, v]) => [Number(k), v]));
    }
    get seq() {
        return this._seq;
    }
    get puffles() {
        return [...this._puffles.values()];
    }
    get backyard() {
        return [...this._backyard.values()];
    }
    get items() {
        return Object.fromEntries(this._items.entries());
    }
    getItemAmount(item) {
        return this._items.get(item) ?? 0;
    }
    get walking() {
        return this._walking;
    }
    getWalking() {
        if (this._walking === null) {
            return undefined;
        }
        return this._puffles.get(this._walking);
    }
    unwalk() {
        this._walking = null;
    }
    walk(id) {
        this._walking = id;
    }
    isInBackyard(id) {
        return this._backyard.has(id);
    }
    addPuffle(name, puffleType) {
        this._seq += 1;
        const id = this._seq;
        const puffle = {
            id,
            name,
            type: puffleType,
            clean: 100,
            rest: 100,
            food: 100
        };
        this._puffles.set(id, puffle);
        return puffle;
    }
    toBackyard(id) {
        this._backyard.add(id);
    }
    fromBackyard(id) {
        this._backyard.delete(id);
    }
    addItem(itemId, amount) {
        const owned = (this._items.get(itemId) ?? 0) + amount;
        this._items.set(itemId, owned);
        return owned;
    }
    getAllItems() {
        return [...this._items.entries()];
    }
    getPuffle(id) {
        return this._puffles.get(id);
    }
    /** Painel da equipe: remove um puffle. */
    removePuffle(id) {
        this._puffles.delete(id);
        this._backyard.delete(id);
        if (this._walking === id)
            this._walking = null;
    }
}
class DigData {
    _hasDug;
    _treasureFinds;
    _colors = new Set();
    constructor(data) {
        this._hasDug = data.hasDug;
        this._treasureFinds = [...data.treasureFinds];
    }
    get hasDug() {
        return this._hasDug;
    }
    get treasureFinds() {
        return [...this._treasureFinds];
    }
    addColor(color) {
        this._colors.add(color);
    }
    get colorsDug() {
        return this._colors.size;
    }
    addFind() {
        this._treasureFinds.push(Date.now());
    }
    get treasuresInLastDay() {
        const now = Date.now();
        const treasures = this._treasureFinds.filter(time => now - time < 24 * 3600 * 1000);
        this._treasureFinds = treasures;
        return treasures.length;
    }
    clearFinds() {
        this._treasureFinds = [];
    }
    setDug() {
        this._hasDug = true;
    }
}
class RainbowQuest {
    _canAdopt;
    _task;
    _lastTaskCompletionTimestamp;
    _collected;
    constructor(data) {
        this._canAdopt = data.rainbow.adoptability;
        this._task = data.rainbow.currentTask;
        this._lastTaskCompletionTimestamp = data.rainbow.latestTaskCompletionTime ?? null;
        this._collected = new Set(data.rainbow.coinsCollected);
    }
    get canAdopt() {
        return this._canAdopt;
    }
    setAdoptable() {
        this._canAdopt = true;
    }
    resetQuest() {
        this._canAdopt = false;
        this._task = 0;
        this._collected = new Set();
    }
    get task() {
        return this._task;
    }
    get lastCompletionTime() {
        return this._lastTaskCompletionTimestamp;
    }
    setCompleted(task) {
        this._task = task + 1;
        this._lastTaskCompletionTimestamp = Date.now() / 1000;
    }
    setCollected(task) {
        this._collected.add(task);
    }
    get coinsCollected() {
        return [...this._collected.values()];
    }
}
class IglooInventory {
    _selected;
    _layouts;
    _seq;
    _furniture;
    _types;
    _locations;
    _floorings;
    constructor(data) {
        this._selected = data.igloo;
        this._layouts = new Map(data.igloos.map(i => [i.id, i]));
        this._seq = data.iglooSeq;
        this._furniture = new Map(Object.entries(data.furniture).map(([k, v]) => [Number(k), v]));
        this._types = new Set(data.iglooTypes);
        this._locations = new Set(data.iglooLocations);
        this._floorings = new Set(data.iglooFloorings);
    }
    get selectedIgloo() {
        return this._selected;
    }
    get activeIgloo() {
        const layout = this._layouts.get(this._selected);
        if (layout === undefined) {
            throw new Error('Selected igloo layout doesn\'t exist');
        }
        return layout;
    }
    setActiveIgloo(index) {
        this._selected = index;
    }
    setLocked(index, locked) {
        const prev = this._layouts.get(index);
        if (prev !== undefined && prev.locked !== locked) {
            this._layouts.set(index, { ...prev, locked });
        }
    }
    addIglooLayout() {
        this._seq++;
        const id = this._seq;
        const igloo = (0, database_1.getDefaultIgloo)(id);
        this._layouts.set(id, igloo);
        return [id, igloo];
    }
    addIglooLocation(location) {
        this._locations.add(location);
    }
    get layouts() {
        return [...this._layouts.values()];
    }
    get seq() {
        return this._seq;
    }
    get furniture() {
        return [...this._furniture.entries()];
    }
    getFurnitureAmount(furnitureId) {
        return this._furniture.get(furnitureId) ?? 0;
    }
    getAllFurniture() {
        return [...this._furniture.entries()];
    }
    getAllLayouts() {
        return [...this._layouts.entries()];
    }
    addFurniture(furnitureId, amount) {
        this._furniture.set(furnitureId, this.getFurnitureAmount(furnitureId) + amount);
    }
    addIglooType(iglooType) {
        this._types.add(iglooType);
    }
    addFlooring(flooringId) {
        this._floorings.add(flooringId);
    }
    /** Painel da equipe: define a quantidade de um móvel (0 remove). */
    setFurnitureAmount(furnitureId, amount) {
        if (amount <= 0)
            this._furniture.delete(furnitureId);
        else
            this._furniture.set(furnitureId, Math.min(99, Math.floor(amount)));
    }
    removeIglooType(iglooType) {
        if (this._types.size > 1)
            this._types.delete(iglooType);
    }
    removeFlooring(flooringId) {
        this._floorings.delete(flooringId);
    }
    addLocation(location) {
        this._locations.add(location);
    }
    removeLocation(location) {
        if (this._locations.size > 1)
            this._locations.delete(location);
    }
    updateIgloo(features) {
        const igloo = this.activeIgloo;
        this._layouts.set(this._selected, { ...igloo, ...features });
    }
    get types() {
        return [...this._types.values()];
    }
    get locations() {
        return [...this._locations.values()];
    }
    get floorings() {
        return [...this._floorings.values()];
    }
}
class MailInventory {
    _seq;
    _mail;
    constructor(data) {
        this._seq = data.mailSeq;
        this._mail = JSON.parse(JSON.stringify(data.mail));
    }
    get seq() {
        return this._seq;
    }
    get mail() {
        return JSON.parse(JSON.stringify(this._mail));
    }
    get unread() {
        return this._mail.filter(m => !m.postcard.read).length;
    }
    get total() {
        return this._mail.length;
    }
    receivePostcard(postcard, info) {
        this._seq += 1;
        const uid = this._seq;
        const senderName = info.senderName ?? 'sys';
        const senderId = info.senderId ?? 0;
        const details = info.details ?? '';
        const timestamp = Date.now();
        const mail = {
            sender: {
                name: senderName,
                id: senderId
            },
            postcard: {
                postcardId: postcard,
                uid,
                details,
                timestamp,
                read: false
            }
        };
        this._mail.push(mail);
        return mail;
    }
    setRead() {
        this._mail = this._mail.map(mail => ({ ...mail, postcard: { ...mail.postcard, read: true } }));
    }
    deleteMail(predicate) {
        this._mail = this._mail.filter(m => !predicate(m));
    }
}
class PuffleLaunchData {
    _data;
    constructor(data) {
        this._data = data.puffleLaunchGameData === undefined ? (null) : (Buffer.from(data.puffleLaunchGameData, 'base64'));
    }
    get data() {
        return this._data;
    }
    set(data) {
        this._data = data;
    }
}
class EpfInventory {
    _careerMedals;
    _medals;
    constructor(data) {
        this._careerMedals = data.careerMedals;
        this._medals = data.ownedMedals;
    }
    get careerMedals() {
        return this._careerMedals;
    }
    get medals() {
        return this._medals;
    }
    removeMedals(medals) {
        this._medals -= medals;
        return this._medals;
    }
    addMedals(medals) {
        this._medals += medals;
        this._careerMedals += medals;
    }
}
class GoldPuffleInventory {
    _nuggets;
    _nuggetState = false;
    constructor(data) {
        this._nuggets = data.nuggets;
    }
    get nuggets() {
        return this._nuggets;
    }
    reset() {
        this._nuggets = 0;
        this._nuggetState = false;
    }
    get goldNuggetState() {
        return this._nuggetState;
    }
    add(nuggets) {
        this._nuggets += nuggets;
    }
    setState() {
        this._nuggetState = true;
    }
}
class NinjaProfile {
    _cards;
    _cardProgress;
    _cardWins;
    _fireProgress;
    _fireWins;
    _water;
    _snow;
    constructor(data) {
        this._cards = new Map(Object.entries(data.cards).map(([k, v]) => [Number(k), v]));
        this._cardProgress = new ninja_progress_1.CardJitsuProgress(data.cardProgress, data.senseiAttempts, data.isNinja);
        this._fireProgress = new ninja_progress_1.CardJitsuFireProgress(data.fireXP ?? 0, data.fireNinja ?? false);
        this._cardWins = data.cardWins;
        this._water = data.waterNinja ?? false;
        this._snow = data.snowNinja ?? false;
        this._fireWins = data.fireWins ?? 0;
    }
    get cards() {
        return [...this._cards.entries()];
    }
    get xp() {
        return this._cardProgress.xp;
    }
    get cardRank() {
        return this._cardProgress.rank;
    }
    get cardPercentage() {
        return this._cardProgress.percentage;
    }
    get isNinja() {
        return this._cardProgress.isNinja;
    }
    get senseiAttempts() {
        return this._cardProgress.senseiAttempts;
    }
    get cardWins() {
        return this._cardWins;
    }
    get isWaterNinja() {
        return this._water;
    }
    get isSnowNinja() {
        return this._snow;
    }
    setWaterNinja(value) {
        this._water = value;
    }
    setSnowNinja(value) {
        this._snow = value;
    }
    addCard(cardId, amount = 1) {
        this._cards.set(cardId, (this._cards.get(cardId) ?? 0) + amount);
    }
    addMatchProgress(won) {
        this._cardProgress.earnXP(won ? 5 : 1);
    }
    getDeck() {
        return [...this._cards.entries()].flatMap(([id, amount]) => new Array(amount).fill(id));
    }
    addWin() {
        this._cardWins++;
    }
    earnXP(xp) {
        this._cardProgress.earnXP(xp);
    }
    becomeNinja() {
        this._cardProgress.becomeNinja();
    }
    addAttempt() {
        this._cardProgress.addAttempt();
    }
    get fireProgress() {
        return this._fireProgress;
    }
    get fireWins() {
        return this._fireWins;
    }
    addFireWin() {
        this._fireWins++;
    }
}
class BattleOfDoomStatus {
    _completed;
    constructor(data) {
        this._completed = data.battleOfDoom;
    }
    get completed() {
        return this._completed;
    }
    setComplete() {
        this._completed = true;
    }
}
class Medieval2012Status {
    _message;
    constructor(data) {
        this._message = data.medieval2012Message ?? 0;
    }
    get message() {
        return this._message;
    }
    setViewed(message) {
        this._message = message + 1;
    }
}
class UserPreference {
    _save;
    _safeChat;
    constructor(data) {
        this._save = !(data.noSave ?? false);
        this._safeChat = data.safeChat ?? false;
    }
    get canSave() {
        return this._save;
    }
    get isSafeChat() {
        return this._safeChat;
    }
    disableSave() {
        this._save = false;
    }
    enableSave() {
        this._save = true;
    }
    setSafeChat(value) {
        this._safeChat = value;
    }
}
class Avatar {
    _id = 0;
    get id() {
        return this._id;
    }
    transform(id) {
        this._id = id;
    }
}
class WorldPenguin {
    _profile;
    _membership;
    _psa;
    _inventory;
    _currency;
    _meta;
    _time;
    _buddies;
    _stampbook;
    _puffles;
    _dig;
    _rainbow;
    _igloo;
    _mail;
    _puffleLaunch;
    _epf;
    _gold;
    _ninja;
    _battleOfDoom;
    _medieval2012;
    _preference;
    _avatar = new Avatar();
    constructor(id, json, settings) {
        this._profile = new Profile(id, json);
        this._membership = new Membership(json);
        this._psa = new PSA(json);
        this._inventory = new Inventory(json);
        this._currency = new Currency(json);
        this._meta = new Meta(json);
        this._time = new Time(json, (0, versions_1.processVersion)(settings.settings.version));
        this._buddies = new BuddyInventory(json);
        this._stampbook = new Stampbook(json);
        this._puffles = new PuffleInventory(json);
        this._dig = new DigData(json);
        this._rainbow = new RainbowQuest(json);
        this._igloo = new IglooInventory(json);
        this._mail = new MailInventory(json);
        this._puffleLaunch = new PuffleLaunchData(json);
        this._epf = new EpfInventory(json);
        this._gold = new GoldPuffleInventory(json);
        this._ninja = new NinjaProfile(json);
        this._battleOfDoom = new BattleOfDoomStatus(json);
        this._medieval2012 = new Medieval2012Status(json);
        this._preference = new UserPreference(json);
    }
    get id() {
        return this._profile.id;
    }
    get name() {
        return this._profile.displayName;
    }
    changeName(name) {
        this._profile.changeName(name);
    }
    get mascot() {
        return this._profile.mascot;
    }
    get puffle() {
        return this._puffles;
    }
    get inventory() {
        return this._inventory;
    }
    get psa() {
        return this._psa;
    }
    get epf() {
        return this._epf;
    }
    get battleOfDoom() {
        return this._battleOfDoom;
    }
    get medieval2012() {
        return this._medieval2012;
    }
    get igloo() {
        return this._igloo;
    }
    get buddy() {
        return this._buddies;
    }
    get mail() {
        return this._mail;
    }
    get currency() {
        return this._currency;
    }
    get stampbook() {
        return this._stampbook;
    }
    get membership() {
        return this._membership;
    }
    get time() {
        return this._time;
    }
    get preference() {
        return this._preference;
    }
    get avatar() {
        return this._avatar;
    }
    get puffleLaunch() {
        return this._puffleLaunch;
    }
    get ninja() {
        return this._ninja;
    }
    get rainbow() {
        return this._rainbow;
    }
    get gold() {
        return this._gold;
    }
    get dig() {
        return this._dig;
    }
    getJSON() {
        return {
            name: this._profile.name,
            mascot: this._profile.mascot,
            is_member: this._membership.isMember,
            is_agent: this._psa.isAgent,
            color: this._inventory.color,
            head: this._inventory.head,
            face: this._inventory.face,
            neck: this._inventory.neck,
            body: this._inventory.body,
            hand: this._inventory.hand,
            feet: this._inventory.feet,
            pin: this._inventory.pin,
            background: this._inventory.background,
            inventory: this._inventory.items,
            coins: this._currency.coins,
            registration_date: this._meta.registrationTime,
            minutes_played: this._time.minutesPlayed,
            virtualRegistrationTimestamp: this._time.virtualRegistrationTimestamp,
            buddies: this._buddies.buddies,
            ignored: this._buddies.ignored,
            stamps: this._stampbook.stamps,
            stampbook: this._stampbook.cover,
            puffleSeq: this._puffles.seq,
            puffles: this._puffles.puffles,
            backyard: this._puffles.backyard,
            puffleItems: this._puffles.items,
            hasDug: this._dig.hasDug,
            treasureFinds: this._dig.treasureFinds,
            rainbow: {
                adoptability: this._rainbow.canAdopt,
                currentTask: this._rainbow.task,
                latestTaskCompletionTime: this._rainbow.lastCompletionTime ?? undefined,
                coinsCollected: this._rainbow.coinsCollected
            },
            igloo: this._igloo.selectedIgloo,
            igloos: this._igloo.layouts,
            iglooSeq: this._igloo.seq,
            furniture: Object.fromEntries(this._igloo.furniture),
            iglooTypes: this._igloo.types,
            iglooLocations: this._igloo.locations,
            iglooFloorings: this._igloo.floorings,
            mail: this._mail.mail,
            mailSeq: this._mail.seq,
            puffleLaunchGameData: this._puffleLaunch.data === null ? undefined : this._puffleLaunch.data.toString('base64'),
            careerMedals: this._epf.careerMedals,
            ownedMedals: this._epf.medals,
            nuggets: this._gold.nuggets,
            cards: Object.fromEntries(this._ninja.cards),
            cardProgress: this._ninja.xp,
            isNinja: this._ninja.isNinja,
            senseiAttempts: this._ninja.senseiAttempts,
            cardWins: this._ninja.cardWins,
            fireXP: this._ninja.fireProgress.xp,
            fireNinja: this._ninja.fireProgress.isFireNinja,
            fireWins: this._ninja.fireWins,
            waterNinja: this._ninja.isWaterNinja,
            snowNinja: this._ninja.isSnowNinja,
            battleOfDoom: this._battleOfDoom.completed,
            medieval2012Message: this._medieval2012.message,
            noSave: !this._preference.canSave,
            safeChat: this._preference.isSafeChat
        };
    }
    get canSave() {
        return this._preference.canSave;
    }
}
exports.WorldPenguin = WorldPenguin;
class OfflinePenguin {
    _id;
    _data;
    _mail;
    _buddy;
    constructor(_id, _data) {
        this._id = _id;
        this._data = _data;
        this._mail = new MailInventory(_data);
        this._buddy = new BuddyInventory(_data);
    }
    get mail() {
        return this._mail;
    }
    get buddy() {
        return this._buddy;
    }
    getJSON() {
        return {
            ...this._data,
            buddies: this._buddy.buddies,
            mail: this._mail.mail,
            mailSeq: this._mail.seq
        };
    }
    get canSave() {
        return true;
    }
    get id() {
        return this._id;
    }
}
exports.OfflinePenguin = OfflinePenguin;
class WorldEntity {
    onAdd;
    onRemove;
    constructor(onAdd, onRemove) {
        this.onAdd = onAdd;
        this.onRemove = onRemove;
    }
    addClient(client) {
        this.onAdd(client, this);
    }
    removeClient(client) {
        this.onRemove(client);
    }
}
exports.WorldEntity = WorldEntity;
