import { api } from './client';

// Endpoints novos do round 7 (Fórum, Galeria, Loja, avisos). Ficam num
// arquivo próprio pra não disputar o endpoints.js com outras áreas.

// --- Fórum ---
export const pinPost = (id, pinned) => api.post(`/posts/${id}/pin`, { pinned }).then((r) => r.data);
export const updatePostTags = (id, tags) => api.patch(`/posts/${id}/tags`, { tags }).then((r) => r.data);
export const updateClubTags = (slug, postTags) => api.patch(`/communities/${slug}`, { postTags }).then((r) => r.data);

// --- Galeria ---
export const lookupGalleryLikes = (keys) => api.post('/gallery/likes/lookup', { keys }).then((r) => r.data);
export const toggleGalleryLike = (key) => api.post('/gallery/likes/toggle', { key }).then((r) => r.data);
export const listTopGallery = (params = {}) => api.get('/gallery/top', { params }).then((r) => r.data);
export const listGalleryAlbums = () => api.get('/gallery/albums').then((r) => r.data);
export const getGalleryAlbum = (id) => api.get(`/gallery/albums/${id}`).then((r) => r.data);
export const createGalleryAlbum = (payload) => api.post('/gallery/albums', payload).then((r) => r.data);
export const updateGalleryAlbum = (id, payload) => api.patch(`/gallery/albums/${id}`, payload).then((r) => r.data);
export const deleteGalleryAlbum = (id) => api.delete(`/gallery/albums/${id}`).then((r) => r.data);
export const addToGalleryAlbum = (id, key) => api.post(`/gallery/albums/${id}/items`, { key }).then((r) => r.data);
export const removeFromGalleryAlbum = (id, key) => api.delete(`/gallery/albums/${id}/items/${encodeURIComponent(key)}`).then((r) => r.data);

// --- Loja ---
export const getShopHistory = (params = {}) => api.get('/decorations/history', { params }).then((r) => r.data);
export const giftShopItem = (payload) => api.post('/decorations/gift', payload).then((r) => r.data);

// --- Avisos salvos (lembrete de evento, presente recebido) ---
export const listNotices = () => api.get('/notices').then((r) => r.data);
export const readAllNotices = () => api.post('/notices/read-all').then((r) => r.data);
export const readNotice = (id) => api.post(`/notices/${id}/read`).then((r) => r.data);
export const deleteNotice = (id) => api.delete(`/notices/${id}`).then((r) => r.data);
