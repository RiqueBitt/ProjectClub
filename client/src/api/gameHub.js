import { api } from './client';

// Game Hub (/api/game-hub): promoções, hotlist, partidas, clipes e builds.
const get = (url, params) => api.get(`/game-hub${url}`, params ? { params } : undefined).then((r) => r.data);
const post = (url, body) => api.post(`/game-hub${url}`, body || {}).then((r) => r.data);

export const getDeals = () => get('/deals');
export const getHotlist = () => get('/hotlist');

export const listParties = () => get('/parties').then((d) => d.parties || []);
export const createParty = (body) => post('/parties', body).then((d) => d.party);
export const joinParty = (id) => post(`/parties/${id}/join`).then((d) => d.party);
export const leaveParty = (id) => post(`/parties/${id}/leave`);
export const closeParty = (id) => post(`/parties/${id}/close`);
export const kickFromParty = (id, userId) => post(`/parties/${id}/kick`, { userId }).then((d) => d.party);
export const inviteToParty = (id, userIds) => post(`/parties/${id}/invite`, { userIds });
export const partyCall = (id) => post(`/parties/${id}/call`).then((d) => d.channel);

export const listClips = (params) => get('/clips', params);
export const createClip = (body) => post('/clips', body).then((d) => d.clip);
export const deleteClip = (id) => api.delete(`/game-hub/clips/${id}`).then((r) => r.data);
export const likeClip = (id) => post(`/clips/${id}/like`);

export const listBuilds = (params) => get('/builds', params);
export const getBuild = (id) => get(`/builds/${id}`).then((d) => d.build);
export const createBuild = (body) => post('/builds', body).then((d) => d.build);
export const updateBuild = (id, body) => api.put(`/game-hub/builds/${id}`, body).then((r) => r.data.build);
export const deleteBuild = (id) => api.delete(`/game-hub/builds/${id}`).then((r) => r.data);
export const likeBuild = (id) => post(`/builds/${id}/like`);

export const getGameData = (game) => get(`/data/${game}`);
export const getLolChampion = (id) => get(`/data/lol/champion/${encodeURIComponent(id)}`);

export const searchGames = (q) => api.get('/games/search', { params: { q } }).then((r) => r.data?.games || []);
