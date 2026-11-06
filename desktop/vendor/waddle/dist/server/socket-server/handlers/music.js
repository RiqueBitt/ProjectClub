"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MUSIC_HANDLERS = exports.handleRefreshTrackLikes = exports.handleGetLikeCount = exports.handleLikeTrack = exports.handleCanLikeTrack = exports.handleBroadcastingTracks = exports.handleGetSharedTracks = exports.handleDeleteMusicTrack = exports.handleShareMusicTrack = exports.handleLoadMusicTrack = exports.handleSaveMusicTrack = exports.handleGetMusicTracks = void 0;
exports.musicOnDisconnect = musicOnDisconnect;
const igloo_1 = require("./igloo");
const DANCE_ROOM = 120;
const MAX_TRACKS = 12;
const LIKE_PERIOD_MS = 24 * 60 * 60 * 1000;
const queue = [];
let current = null;
let timer = null;
let ctxRef = null;
function cleanName(name) {
    return String(name ?? '').replace(/[%|,\r\n]+/g, ' ').trim().slice(0, 30) || 'Música';
}
/** Duração em ms: o último bloco das notas é "FFFF|<ms em hexa>". */
function trackLength(notes) {
    const last = String(notes).split(',').pop() ?? '';
    const ms = parseInt(last.split('|')[1] ?? '', 16);
    return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 10 * 60 * 1000) : 60_000;
}
const trackLine = (t, shared) => [t.id, t.name, shared ? 1 : 0, t.likes].join('|');
const queueString = () => queue.map(({ penguin, track }) => [penguin.id, penguin.name, (0, igloo_1.swidOf)(penguin.id), track.id, track.likes].join('|')).join(',');
const isShared = (p, id) => queue.some((s) => s.penguin === p && s.track.id === id);
function sendBroadcastState() {
    if (!ctxRef)
        return;
    const { world, msg } = ctxRef;
    const players = world.getRoom(DANCE_ROOM).players;
    const str = queueString();
    for (const p of players) {
        const myIndex = queue.findIndex((s) => s.penguin === p);
        msg.send(p, 'broadcastingmusictracks', queue.length, myIndex >= 0 ? myIndex + 1 : -1, str);
    }
}
function playNext() {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    if (current) {
        const i = queue.indexOf(current);
        if (i >= 0)
            queue.splice(i, 1);
        current = null;
    }
    if (queue.length > 0) {
        current = queue[0];
        timer = setTimeout(playNext, trackLength(current.track.notes) + 1500);
        timer.unref?.();
    }
    sendBroadcastState();
}
function unshareAll(p, silent = false) {
    const wasCurrent = current?.penguin === p;
    for (let i = queue.length - 1; i >= 0; i--)
        if (queue[i].penguin === p)
            queue.splice(i, 1);
    if (wasCurrent) {
        current = null;
        if (!silent)
            playNext();
    }
    else if (!silent)
        sendBroadcastState();
}
/** Ao sair do jogo, as músicas dele saem da fila. */
function musicOnDisconnect(p) {
    if (queue.some((s) => s.penguin === p))
        unshareAll(p);
}
function findTrack(world, penguinId, trackId) {
    const owner = world.getById(penguinId);
    const track = owner?.musicTracks.find((t) => t.id === trackId);
    return owner && track ? [owner, track] : null;
}
const handleGetMusicTracks = ({ msg, penguin, world }) => {
    ctxRef = { world, msg };
    const list = penguin.musicTracks.map((t) => trackLine(t, isShared(penguin, t.id)));
    msg.send(penguin, 'getmymusictracks', list.length, list.join(','));
};
exports.handleGetMusicTracks = handleGetMusicTracks;
const handleSaveMusicTrack = ({ msg, penguin, prst }, name, notes, hash) => {
    if (!notes || notes === '0' || (String(notes).split(',').pop() ?? '').split('|')[0] !== 'FFFF' || String(notes).length > 60_000) {
        return;
    }
    if (penguin.musicTracks.length >= MAX_TRACKS) {
        msg.send(penguin, 'e', 1002);
        return;
    }
    const id = penguin.musicTracks.reduce((m, t) => Math.max(m, t.id), 0) + 1;
    penguin.musicTracks.push({ id, name: cleanName(name), notes: String(notes).replace(/%/g, ''), hash: String(hash ?? '').replace(/[%|]/g, ''), likes: 0 });
    prst(penguin);
    msg.send(penguin, 'savemymusictrack', id);
};
exports.handleSaveMusicTrack = handleSaveMusicTrack;
const handleLoadMusicTrack = ({ msg, penguin, world }, penguinId, trackId) => {
    const hit = findTrack(world, Number(penguinId), Number(trackId));
    if (!hit)
        return;
    const [owner, t] = hit;
    msg.send(penguin, 'loadmusictrack', t.id, t.name, isShared(owner, t.id) ? 1 : 0, t.notes, t.hash, t.likes);
};
exports.handleLoadMusicTrack = handleLoadMusicTrack;
const handleShareMusicTrack = ({ msg, penguin, world }, trackId, shareOn) => {
    ctxRef = { world, msg: ctxRef?.msg ?? msg };
    const track = penguin.musicTracks.find((t) => t.id === Number(trackId));
    if (!track) {
        msg.send(penguin, 'sharemymusictrack', 0);
        return;
    }
    unshareAll(penguin, true);
    if (Number(shareOn) === 1)
        queue.push({ penguin, track });
    if (!current)
        playNext();
    else
        sendBroadcastState();
    msg.send(penguin, 'sharemymusictrack', 1);
};
exports.handleShareMusicTrack = handleShareMusicTrack;
const handleDeleteMusicTrack = ({ msg, penguin, prst }, trackId) => {
    const i = penguin.musicTracks.findIndex((t) => t.id === Number(trackId));
    if (i < 0) {
        msg.send(penguin, 'deletetrack', 0);
        return;
    }
    if (isShared(penguin, penguin.musicTracks[i].id))
        unshareAll(penguin);
    penguin.musicTracks.splice(i, 1);
    prst(penguin);
    msg.send(penguin, 'deletetrack', 1);
};
exports.handleDeleteMusicTrack = handleDeleteMusicTrack;
const handleGetSharedTracks = ({ msg, penguin, world }) => {
    ctxRef = { world, msg };
    msg.send(penguin, 'getsharedmusictracks', queue.length, queueString());
};
exports.handleGetSharedTracks = handleGetSharedTracks;
const handleBroadcastingTracks = ({ msg, penguin, world }) => {
    ctxRef = { world, msg };
    const myIndex = queue.findIndex((s) => s.penguin === penguin);
    msg.send(penguin, 'broadcastingmusictracks', queue.length, myIndex >= 0 ? myIndex + 1 : -1, queueString());
};
exports.handleBroadcastingTracks = handleBroadcastingTracks;
function canLike(penguin, owner, t, now = Date.now()) {
    if (owner === penguin)
        return false;
    const last = t.likedBy?.[String(penguin.id)] ?? 0;
    return now - last >= LIKE_PERIOD_MS;
}
const handleCanLikeTrack = ({ msg, penguin, world }, penguinId, trackId) => {
    const hit = findTrack(world, Number(penguinId), Number(trackId));
    msg.send(penguin, 'canliketrack', Number(trackId), hit && canLike(penguin, hit[0], hit[1]) ? 1 : 0);
};
exports.handleCanLikeTrack = handleCanLikeTrack;
const handleLikeTrack = ({ msg, penguin, world, prst }, penguinId, trackId) => {
    const hit = findTrack(world, Number(penguinId), Number(trackId));
    if (!hit || !canLike(penguin, hit[0], hit[1]))
        return;
    const [owner, t] = hit;
    t.likes += 1;
    (t.likedBy ??= {})[String(penguin.id)] = Date.now();
    prst(owner);
    msg.send(world.getRoom(DANCE_ROOM).players, 'liketrack', owner.id, t.id, t.likes);
};
exports.handleLikeTrack = handleLikeTrack;
const handleGetLikeCount = ({ msg, penguin, world }, penguinId, trackId) => {
    const hit = findTrack(world, Number(penguinId), Number(trackId));
    if (hit)
        msg.send(penguin, 'getlikecountfortrack', hit[0].id, hit[1].id, hit[1].likes);
};
exports.handleGetLikeCount = handleGetLikeCount;
const handleRefreshTrackLikes = ({ msg, penguin }) => {
    for (const t of penguin.musicTracks)
        msg.send(penguin, 'getlikecountfortrack', penguin.id, t.id, t.likes);
};
exports.handleRefreshTrackLikes = handleRefreshTrackLikes;
exports.MUSIC_HANDLERS = [
    ['musictrack#getmymusictracks', exports.handleGetMusicTracks],
    ['musictrack#savemymusictrack', exports.handleSaveMusicTrack],
    ['musictrack#loadmusictrack', exports.handleLoadMusicTrack],
    ['musictrack#sharemymusictrack', exports.handleShareMusicTrack],
    ['musictrack#deletetrack', exports.handleDeleteMusicTrack],
    ['musictrack#getsharedmusictracks', exports.handleGetSharedTracks],
    ['musictrack#broadcastingmusictracks', exports.handleBroadcastingTracks],
    ['musictrack#canliketrack', exports.handleCanLikeTrack],
    ['musictrack#liketrack', exports.handleLikeTrack],
    ['musictrack#getlikecountfortrack', exports.handleGetLikeCount],
    ['musictrack#refreshmytracklikes', exports.handleRefreshTrackLikes],
];
