import axios from 'axios';
import { noteMutationStart, noteMutationEnd } from '../utils/liveRefresh';

let accessToken = null;
let onUnauthorized = null;

export function setAccessToken(token) {
  accessToken = token;
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

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry && !original.url.includes('/auth/')) {
      original._retry = true;
      try {
        if (!refreshPromise) {
          refreshPromise = api.post('/auth/refresh').finally(() => { refreshPromise = null; });
        }
        const { data } = await refreshPromise;
        setAccessToken(data.accessToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (refreshErr) {
        onUnauthorized?.();
        return Promise.reject(refreshErr);
      }
    }
    return Promise.reject(error);
  }
);
