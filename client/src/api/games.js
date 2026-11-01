import { api } from './client';

// Biblioteca de jogos (tempo de jogo). userId = 'me' pra própria.
export const getGameLibrary = (userId = 'me', params = {}) =>
  api.get(`/games/library/${encodeURIComponent(userId)}`, { params }).then((r) => r.data);
export const searchGames = (q) => api.get('/games/search', { params: { q } }).then((r) => r.data);
