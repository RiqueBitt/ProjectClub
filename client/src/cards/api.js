import { api } from '../api/client';

// Jogo de Cartas — chamadas da API (servidor é autoritativo em tudo).
const d = (r) => r.data;
export const cardsHome = () => api.get('/cards/home').then(d);
export const cardsClaimStarter = () => api.post('/cards/starter').then(d);
export const cardsCollection = () => api.get('/cards/collection').then(d);
export const cardsUserCollection = (userId) => api.get(`/cards/users/${userId}/collection`).then(d);
export const cardsUserSummary = (userId) => api.get(`/cards/users/${userId}/summary`).then(d);
export const cardsSell = (cardId, qty) => api.post(`/cards/collection/${cardId}/sell`, { qty }).then(d);
export const cardsLevelUp = (cardId) => api.post(`/cards/collection/${cardId}/level-up`).then(d);
export const cardsPacks = () => api.get('/cards/packs').then(d);
export const cardsOpenPack = (id, currency) => api.post(`/cards/packs/${id}/open`, { currency }).then(d);
export const cardsDecks = () => api.get('/cards/decks').then(d);
export const cardsSuggestDeck = () => api.get('/cards/decks/suggest').then(d);
export const cardsSaveDeck = (deck) => (deck.id ? api.put(`/cards/decks/${deck.id}`, deck) : api.post('/cards/decks', deck)).then(d);
export const cardsDeleteDeck = (id) => api.delete(`/cards/decks/${id}`).then(d);
export const cardsActivateDeck = (id) => api.post(`/cards/decks/${id}/activate`).then(d);
export const cardsHistory = () => api.get('/cards/matches').then(d);
export const cardsStartPve = (difficulty) => api.post('/cards/matches/pve', { difficulty }).then(d);
export const cardsChallenge = (userId) => api.post('/cards/matches/challenge', { userId }).then(d);
export const cardsAcceptChallenge = (id) => api.post(`/cards/matches/${id}/accept`).then(d);
export const cardsDeclineChallenge = (id) => api.post(`/cards/matches/${id}/decline`).then(d);
export const cardsMatch = (id) => api.get(`/cards/matches/${id}`).then(d);
export const cardsAction = (id, action) => api.post(`/cards/matches/${id}/action`, action).then(d);
export const cardsRanking = (by) => api.get('/cards/ranking', { params: { by } }).then(d);
export const cardsTrades = () => api.get('/cards/trades').then(d);
export const cardsCreateTrade = (payload) => api.post('/cards/trades', payload).then(d);
export const cardsTradeAction = (id, kind) => api.post(`/cards/trades/${id}/${kind}`).then(d);
export const cardsSellFoil = (cardId) => api.post(`/cards/collection/${cardId}/sell`, { qty: 1, foil: true }).then(d);
export const cardsCampaign = () => api.get('/cards/campaign').then(d);
export const cardsStartCampaign = (id) => api.post(`/cards/campaign/${id}/start`).then(d);
export const cardsQueue = () => api.post('/cards/queue').then(d);
export const cardsLeaveQueue = () => api.delete('/cards/queue').then(d);
export const cardsLive = () => api.get('/cards/live').then(d);
export const cardsReplay = (id) => api.get(`/cards/matches/${id}/replay`).then(d);
export const cardsWatch = (id, params) => api.get(`/cards/matches/${id}/watch`, { params }).then(d);
export const cardsStopWatch = (id) => api.delete(`/cards/matches/${id}/watch`).then(d).catch(() => {});
export const cardsMarket = (params) => api.get('/cards/market', { params }).then(d);
export const cardsCreateListing = (body) => api.post('/cards/market', body).then(d);
export const cardsBuyListing = (id) => api.post(`/cards/market/${id}/buy`).then(d);
export const cardsCancelListing = (id) => api.post(`/cards/market/${id}/cancel`).then(d);
export const cardsTournaments = () => api.get('/cards/tournaments').then(d);
export const cardsJoinTournament = (id) => api.post(`/cards/tournaments/${id}/join`).then(d);
export const cardsLeaveTournament = (id) => api.post(`/cards/tournaments/${id}/leave`).then(d);

// Staff
export const cardsAdmin = {
  cards: () => api.get('/cards/admin/cards').then(d),
  createCard: (fd) => api.post('/cards/admin/cards', fd).then(d),
  updateCard: (id, fd) => api.patch(`/cards/admin/cards/${id}`, fd).then(d),
  deleteCard: (id, force) => api.delete(`/cards/admin/cards/${id}`, { params: force ? { force: 1 } : {} }).then(d),
  packs: () => api.get('/cards/admin/packs').then(d),
  createPack: (fd) => api.post('/cards/admin/packs', fd).then(d),
  updatePack: (id, fd) => api.patch(`/cards/admin/packs/${id}`, fd).then(d),
  deletePack: (id) => api.delete(`/cards/admin/packs/${id}`).then(d),
  simulatePack: (id, n) => api.get(`/cards/admin/packs/${id}/simulate`, { params: { n } }).then(d),
  settings: () => api.get('/cards/admin/settings').then(d),
  saveSettings: (s) => api.put('/cards/admin/settings', s).then(d),
  players: (q) => api.get('/cards/admin/players', { params: { q } }).then(d),
  player: (id) => api.get(`/cards/admin/players/${id}`).then(d),
  grant: (id, body) => api.post(`/cards/admin/players/${id}/grant`, body).then(d),
  updatePlayer: (id, body) => api.patch(`/cards/admin/players/${id}`, body).then(d),
  trades: (status) => api.get('/cards/admin/trades', { params: { status } }).then(d),
  cancelTrade: (id) => api.post(`/cards/admin/trades/${id}/cancel`).then(d),
  matches: (status) => api.get('/cards/admin/matches', { params: { status } }).then(d),
  cancelMatch: (id) => api.post(`/cards/admin/matches/${id}/cancel`).then(d),
  stats: (days) => api.get('/cards/admin/stats', { params: { days } }).then(d),
  exportCards: () => api.get('/cards/admin/export').then(d),
  importCards: (cards) => api.post('/cards/admin/import', { cards }).then(d),
  campaign: () => api.get('/cards/admin/campaign').then(d),
  createStage: (b) => api.post('/cards/admin/campaign', b).then(d),
  updateStage: (id, b) => api.patch(`/cards/admin/campaign/${id}`, b).then(d),
  deleteStage: (id) => api.delete(`/cards/admin/campaign/${id}`).then(d),
  tournaments: () => api.get('/cards/admin/tournaments').then(d),
  createTournament: (b) => api.post('/cards/admin/tournaments', b).then(d),
  updateTournament: (id, b) => api.patch(`/cards/admin/tournaments/${id}`, b).then(d),
  startTournament: (id) => api.post(`/cards/admin/tournaments/${id}/start`).then(d),
  cancelTournament: (id) => api.post(`/cards/admin/tournaments/${id}/cancel`).then(d),
  boards: () => api.get('/cards/admin/boards').then(d),
  createBoard: (fd) => api.post('/cards/admin/boards', fd).then(d),
  updateBoard: (id, fd) => api.patch(`/cards/admin/boards/${id}`, fd).then(d),
  deleteBoard: (id) => api.delete(`/cards/admin/boards/${id}`).then(d),
};

export const errMsg = (e, fb = 'Algo deu errado.') => e?.response?.data?.error || fb;
