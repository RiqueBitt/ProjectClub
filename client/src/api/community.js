import { api } from './client';

// Fase 4 — comunidade e economia (rotas em server/src/routes/communityExtras.js,
// clans.js e posts.js).
const data = (r) => r.data;

// Início: tudo numa chamada (temporada, metas, Clubes).
export const getCommunityHome = () => api.get('/community-home').then(data);

// Competição semanal dos Clubes.
export const getClanWeekly = () => api.get('/clans/weekly').then(data);

// Post da semana.
export const getPostOfWeek = () => api.get('/posts/post-of-week').then(data);


// Metas coletivas.
export const getCommunityGoals = () => api.get('/community-goals').then(data);
export const adminListGoals = () => api.get('/community-goals/admin').then(data);
export const adminSaveGoal = (payload) => api.post('/community-goals/admin', payload).then(data);
export const adminRemoveGoal = (id) => api.delete(`/community-goals/admin/${id}`).then(data);

// Temporadas temáticas.
export const getSeason = () => api.get('/seasons/current').then(data);
export const claimSeasonGift = () => api.post('/seasons/claim').then(data);

// Cupons.
export const previewCoupon = (code, price) => api.post('/coupons/preview', { code, price }).then(data);
export const adminListCoupons = () => api.get('/coupons/admin').then(data);
export const adminCreateCoupon = (payload) => api.post('/coupons/admin', payload).then(data);
export const adminSetCouponActive = (id, active) => api.patch(`/coupons/admin/${id}`, { active }).then(data);

// Reputação.
export const thankTarget = (targetType, targetId) => api.post('/reputation/thanks', { targetType, targetId }).then(data);
export const getReputation = (userId) => api.get(`/reputation/user/${userId}`).then(data);

// Gorjetas.
export const getTipStatus = () => api.get('/tips/status').then(data);
export const sendTip = (messageId, amount) => api.post('/tips', { messageId, amount }).then(data);

// Mensagem de erro amigável vinda do servidor.
export const errText = (e, fallback = 'Algo deu errado. Tente de novo.') => e?.response?.data?.error || fallback;
