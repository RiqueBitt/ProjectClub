// Chamadas do Project Club Dev (/api/dev) e os rascunhos no navegador.
import { api } from '../../api/client.js';

const get = (url, params) => api.get(`/dev${url}`, { params }).then((r) => r.data);
const post = (url, body) => api.post(`/dev${url}`, body).then((r) => r.data);

export const devApi = {
  status: () => get('/status'),
  tree: () => get('/tree'),
  file: (path) => get('/file', { path }),
  save: (files, message) => post('/save', { files, message }),
  changes: () => get('/changes'),
  sync: () => post('/sync'),
  reset: () => post('/reset'),
  publish: (title, description) => post('/publish', { title, description }),
  updates: (state) => get('/updates', { state }),
  approve: (n) => post(`/updates/${n}/approve`),
  reject: (n, reason) => post(`/updates/${n}/reject`, { reason }),
  logs: (after) => get('/logs', { after }),
  uploads: (prefix, token) => get('/uploads', { prefix, token }),
  config: () => get('/config'),
  saveConfig: (data) => api.put('/dev/config', data).then((r) => r.data),
};

export const errMsg = (err, fallback = 'Algo deu errado.') => err?.response?.data?.error || err?.message || fallback;

// Rascunhos: o que o admin mudou e ainda não salvou no GitHub. Ficam só no
// navegador (localStorage), por branch: { [path]: { content, original, isNew, deleted, at } }.
const KEY = (branch) => `pcdev.drafts.${branch}`;

export function loadDrafts(branch) {
  try { return JSON.parse(localStorage.getItem(KEY(branch)) || '{}') || {}; } catch { return {}; }
}

export function saveDrafts(branch, drafts) {
  try {
    if (Object.keys(drafts).length) localStorage.setItem(KEY(branch), JSON.stringify(drafts));
    else localStorage.removeItem(KEY(branch));
    return true;
  } catch { return false; }
}

export function fmtBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
