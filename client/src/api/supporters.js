import { api } from './client';

// Gerenciamento de Apoio (Painel da staff). O servidor confere se quem
// chama é administrador; aqui é só o transporte.
export const adminSearchSupporters = (q) => api.get('/supporters/admin/users', { params: { q } }).then((r) => r.data);
export const adminSupporterHistory = (params = {}) => api.get('/supporters/admin/history', { params }).then((r) => r.data);
export const adminSetSupporterTier = (userId, tier, reason) => api.post(`/supporters/admin/${userId}`, { tier, reason }).then((r) => r.data);
