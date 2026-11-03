import { api } from './client';

// Fase 4 — comunidade e economia (rotas em server/src/routes/communityExtras.js,
// clans.js, posts.js e birthdays.js).
const data = (r) => r.data;

// Início: tudo numa chamada (temporada, metas, aniversariantes, Clubes, sorteio).
export const getCommunityHome = () => api.get('/community-home').then(data);

// Competição semanal dos Clubes.
export const getClanWeekly = () => api.get('/clans/weekly').then(data);

// Indicação de amigos.
export const getMyReferrals = () => api.get('/referrals/mine').then(data);

// Retrospectiva mensal.
export const getRecap = (month) => api.get(month ? `/recap/${encodeURIComponent(month)}` : '/recap').then(data);

// Post da semana.
export const getPostOfWeek = () => api.get('/posts/post-of-week').then(data);

// Sorteio semanal.
export const getRaffle = () => api.get('/raffle').then(data);
export const buyRaffleTickets = (quantity) => api.post('/raffle/tickets', { quantity }).then(data);

// Bora Jogar.
export const listPlayGroups = () => api.get('/play-groups').then(data);
export const createPlayGroup = (payload) => api.post('/play-groups', payload).then(data);
export const joinPlayGroup = (id) => api.post(`/play-groups/${id}/join`).then(data);
export const leavePlayGroup = (id) => api.post(`/play-groups/${id}/leave`).then(data);
export const cancelPlayGroup = (id) => api.delete(`/play-groups/${id}`).then(data);

// Cargos por interesse.
export const getInterestRoles = () => api.get('/interest-roles').then(data);
export const setMyInterestRoles = (roleIds) => api.put('/interest-roles/mine', { roleIds }).then(data);
export const setRoleInterestFlag = (roleId, selfAssignable) => api.patch(`/interest-roles/admin/${roleId}`, { selfAssignable }).then(data);

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
export const getReputationRanking = (period = '30d') => api.get('/reputation/ranking', { params: { period } }).then(data);

// Gorjetas.
export const getTipStatus = () => api.get('/tips/status').then(data);
export const sendTip = (messageId, amount) => api.post('/tips', { messageId, amount }).then(data);

// Padrinhos + preferências (padrinho e aniversário).
export const getMentorship = () => api.get('/mentors').then(data);
export const saveCommunityPrefs = (prefs) => api.patch('/mentors/prefs', prefs).then(data);

// Aniversariantes de hoje (só quem ligou a opção).
export const getBirthdaysToday = () => api.get('/birthdays/today').then(data);

// Mensagem de erro amigável vinda do servidor.
export const errText = (e, fallback = 'Algo deu errado. Tente de novo.') => e?.response?.data?.error || fallback;
