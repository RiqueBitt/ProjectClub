import { api } from './client';

export const listDecorations = () => api.get('/decorations').then((r) => r.data);
export const buyDecoration = (id, currency) => api.post(`/decorations/${id}/buy`, { currency }).then((r) => r.data);
export const equipDecoration = (id) => api.post('/decorations/equip', { id }).then((r) => r.data);
export const adminListDecorations = () => api.get('/decorations/admin/all').then((r) => r.data);
export const adminSaveDecoration = (id, fields, file) => {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v === null || v === undefined ? '' : String(v)));
  if (file) fd.append('image', file);
  return (id ? api.patch(`/decorations/admin/${id}`, fd) : api.post('/decorations/admin', fd)).then((r) => r.data);
};
export const adminDeleteDecoration = (id) => api.delete(`/decorations/admin/${id}`).then((r) => r.data);
