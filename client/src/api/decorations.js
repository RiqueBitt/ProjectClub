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
