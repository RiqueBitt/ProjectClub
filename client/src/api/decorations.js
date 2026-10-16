import { api } from './client';

export const listDecorations = () => api.get('/decorations').then((r) => r.data);
// expectedPrice = preço que a pessoa confirmou; o servidor recusa (409) se o real for outro.
export const buyDecoration = (id, currency, expectedPrice) => api.post(`/decorations/${id}/buy`, { currency, expectedPrice }).then((r) => r.data);
export const equipDecoration = (id) => api.post('/decorations/equip', { id }).then((r) => r.data);
export const adminListDecorations = () => api.get('/decorations/admin/all').then((r) => r.data);
export const adminSaveDecoration = (id, fields, file) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v === null || v === undefined ? '' : String(v)));
  if (file) fd.append('image', file);
  return (id ? api.patch(`/decorations/admin/${id}`, fd) : api.post('/decorations/admin', fd)).then((r) => r.data);
};
export const adminDeleteDecoration = (id) => api.delete(`/decorations/admin/${id}`).then((r) => r.data);

// Loja completa: molduras + efeitos de perfil + coleções.
export const getShop = () => api.get('/decorations/shop').then((r) => r.data);
export const buyEffect = (id, currency, expectedPrice) => api.post(`/decorations/effects/${id}/buy`, { currency, expectedPrice }).then((r) => r.data);
export const equipEffect = (id) => api.post('/decorations/effects/equip', { id }).then((r) => r.data);
export const buyCollection = (id, currency, expectedPrice) => api.post(`/decorations/collections/${id}/buy`, { currency, expectedPrice }).then((r) => r.data);

const toForm = (fields, files) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v === null || v === undefined ? '' : String(v)));
  Object.entries(files || {}).forEach(([k, f]) => { if (f) fd.append(k, f); });
  return fd;
};
export const adminListEffects = () => api.get('/decorations/admin/effects').then((r) => r.data);
export const adminSaveEffect = (id, fields, file) => {
  const fd = toForm(fields, { image: file });
  return (id ? api.patch(`/decorations/admin/effects/${id}`, fd) : api.post('/decorations/admin/effects', fd)).then((r) => r.data);
};
export const adminDeleteEffect = (id) => api.delete(`/decorations/admin/effects/${id}`).then((r) => r.data);
export const adminListCollections = () => api.get('/decorations/admin/collections').then((r) => r.data);
export const adminSaveCollection = (id, fields, files) => {
  const fd = toForm(fields, files);
  return (id ? api.patch(`/decorations/admin/collections/${id}`, fd) : api.post('/decorations/admin/collections', fd)).then((r) => r.data);
};
export const adminDeleteCollection = (id) => api.delete(`/decorations/admin/collections/${id}`).then((r) => r.data);

// Fontes do nome e estilos de perfil.
export const buyFont = (id, currency, expectedPrice) => api.post(`/decorations/fonts/${id}/buy`, { currency, expectedPrice }).then((r) => r.data);
export const equipFont = (id) => api.post('/decorations/fonts/equip', { id }).then((r) => r.data);
export const buyStyle = (id, currency, expectedPrice) => api.post(`/decorations/styles/${id}/buy`, { currency, expectedPrice }).then((r) => r.data);
export const equipStyle = (id) => api.post('/decorations/styles/equip', { id }).then((r) => r.data);

// Itens limitados e trocas.
export const getLimiteds = (userId = 'me') => api.get(`/decorations/limiteds/${encodeURIComponent(userId)}`).then((r) => r.data);
export const getTrades = () => api.get('/decorations/trades').then((r) => r.data);
export const createTrade = (body) => api.post('/decorations/trades', body).then((r) => r.data);
export const acceptTrade = (id) => api.post(`/decorations/trades/${id}/accept`).then((r) => r.data);
export const declineTrade = (id) => api.post(`/decorations/trades/${id}/decline`).then((r) => r.data);
export const cancelTrade = (id) => api.post(`/decorations/trades/${id}/cancel`).then((r) => r.data);

// Staff: fontes/estilos, catálogo completo e dar/tirar itens.
export const adminListShopItems = (kind) => api.get('/decorations/admin/items', { params: { kind } }).then((r) => r.data);
export const adminSaveShopItem = (id, fields, files) => {
  const fd = toForm(fields, files);
  return (id ? api.patch(`/decorations/admin/items/${id}`, fd) : api.post('/decorations/admin/items', fd)).then((r) => r.data);
};
export const adminDeleteShopItem = (id) => api.delete(`/decorations/admin/items/${id}`).then((r) => r.data);
export const adminShopCatalog = () => api.get('/decorations/admin/catalog').then((r) => r.data);
export const adminGrantItem = (body) => api.post('/decorations/admin/grant', body).then((r) => r.data);
export const adminRevokeItem = (body) => api.delete('/decorations/admin/grant', { data: body }).then((r) => r.data);

// Códigos de resgate, insígnia de presentes e (staff) gerenciar códigos.
export const redeemShopCode = (code) => api.post('/decorations/redeem', { code }).then((r) => r.data);
export const getGiftsSummary = () => api.get('/decorations/gifts-summary').then((r) => r.data);
export const adminListCodes = () => api.get('/decorations/admin/codes').then((r) => r.data);
export const adminCreateCode = (payload) => api.post('/decorations/admin/codes', payload).then((r) => r.data);
export const adminRemoveCode = (id) => api.delete(`/decorations/admin/codes/${id}`).then((r) => r.data);
export const buySupporterCredit = (id) => api.post(`/decorations/credits/${id}/buy`).then((r) => r.data);
export const adminListBanners = () => api.get('/decorations/admin/banners').then((r) => r.data);
export const adminSaveBanner = (id, fields, file) => {
  const fd = toForm(fields, { image: file });
  return (id ? api.patch(`/decorations/admin/banners/${id}`, fd) : api.post('/decorations/admin/banners', fd)).then((r) => r.data);
};
export const adminDeleteBanner = (id) => api.delete(`/decorations/admin/banners/${id}`).then((r) => r.data);
