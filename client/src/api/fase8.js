import { api } from './client';

// Fase 8: mascote pinguim, Loja dos criadores (a Praça é só socket).

// ---- Mascote pinguim ----
export const getPetCatalog = () => api.get('/pets/catalog').then((r) => r.data);
export const getMyPet = () => api.get('/pets/me').then((r) => r.data);
export const updateMyPet = (data) => api.patch('/pets/me', data).then((r) => r.data);
export const careForPet = () => api.post('/pets/me/care').then((r) => r.data);
export const buyPetAccessory = (id) => api.post(`/pets/me/accessories/${encodeURIComponent(id)}/buy`).then((r) => r.data);
export const equipPetAccessory = (slot, accessoryId) => api.post('/pets/me/equip', { slot, accessoryId }).then((r) => r.data);
export const getUserPet = (userId) => api.get(`/pets/user/${encodeURIComponent(userId)}`).then((r) => r.data);

// ---- Loja dos criadores ----
export const listCreatorItems = (params = {}) => api.get('/creator-shop', { params }).then((r) => r.data);
export const getMyCreatorStuff = () => api.get('/creator-shop/mine').then((r) => r.data);
export const listCreatorStickers = () => api.get('/creator-shop/stickers').then((r) => r.data);
export const getCreatorEmojiMap = () => api.get('/creator-shop/emoji-map').then((r) => r.data);
export const submitCreatorItem = ({ kind, name, price, description, file }) => {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('name', name);
  fd.append('price', String(price));
  if (description) fd.append('description', description);
  fd.append('image', file);
  return api.post('/creator-shop/submit', fd).then((r) => r.data);
};
export const buyCreatorItem = (id) => api.post(`/creator-shop/${id}/buy`).then((r) => r.data);
export const reportCreatorItem = (id, reason) => api.post(`/creator-shop/${id}/report`, { reason }).then((r) => r.data);
export const withdrawCreatorItem = (id) => api.delete(`/creator-shop/${id}`).then((r) => r.data);

// Equipe
export const adminCreatorQueue = (status = 'PENDING') => api.get('/creator-shop/admin/queue', { params: { status } }).then((r) => r.data);
export const adminApproveCreatorItem = (id) => api.post(`/creator-shop/admin/${id}/approve`).then((r) => r.data);
export const adminRejectCreatorItem = (id, reason) => api.post(`/creator-shop/admin/${id}/reject`, { reason }).then((r) => r.data);
export const adminRemoveCreatorItem = (id, reason) => api.post(`/creator-shop/admin/${id}/remove`, { reason }).then((r) => r.data);
export const adminResolveCreatorReport = (id) => api.post(`/creator-shop/admin/reports/${id}/resolve`).then((r) => r.data);
