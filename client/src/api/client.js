import axios from 'axios';
import { noteMutationStart, noteMutationEnd } from '../utils/liveRefresh';

let accessToken = null;
let onUnauthorized = null;

export function setAccessToken(token) {
  accessToken = token;
}

// Token atual (o socket lê daqui a cada (re)conexão — ver SocketContext).
export function getAccessToken() {
  return accessToken;
}

export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // send the httpOnly refresh-token cookie
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  // Marca escritas em andamento pro refresh ao vivo não aplicar dado velho
  // por cima de uma mudança otimista (ver utils/liveRefresh.js).
  const method = (config.method || 'get').toLowerCase();
  if (method !== 'get' && method !== 'head' && !config._mutationTracked) {
    config._mutationTracked = true;
    noteMutationStart();
  }
  return config;
});

const endMutation = (config) => {
  if (config?._mutationTracked && !config._mutationEnded) {
    config._mutationEnded = true;
    noteMutationEnd();
  }
};
api.interceptors.response.use(
  (res) => { endMutation(res.config); return res; },
  (error) => { endMutation(error.config); return Promise.reject(error); },
);

let refreshPromise = null;

// Renova o access token reaproveitando o mesmo pedido em andamento (o
// refresh token é rotacionado — dois pedidos ao mesmo tempo brigariam).
// Um único POST /auth/refresh por vez em toda a aba (interceptor, abertura
// do app e renovações manuais compartilham a mesma promessa).
export function sharedRefresh() {
  if (!refreshPromise) {
    refreshPromise = api.post('/auth/refresh').finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function refreshAccessToken() {
  const { data } = await sharedRefresh();
  if (data?.accessToken) setAccessToken(data.accessToken);
  return data?.accessToken || null;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && !original.url.includes('/auth/')) {
      original._retry = true;
      try {
        const { data } = await sharedRefresh();
        setAccessToken(data.accessToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (refreshErr) {
        // Só desloga se o servidor recusou a sessão de verdade (401/403).
        // Se ele estiver fora do ar (deploy), mantém a pessoa logada e a
        // próxima requisição tenta renovar de novo.
        const st = refreshErr?.response?.status;
        const json = String(refreshErr?.response?.headers?.['content-type'] || '').includes('application/json');
        if ((st === 401 || st === 403) && json) onUnauthorized?.();
        return Promise.reject(refreshErr);
      }
    }
    return Promise.reject(error);
  }
);
