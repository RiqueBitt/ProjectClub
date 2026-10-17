// "Trocar de conta" (até 5 contas salvas neste aparelho). Cada conta salva
// guarda um token próprio (criado pelo servidor depois de um login normal);
// trocar usa esse token e recarrega o app já na outra conta.
import { api } from '../api/client';

const KEY = 'pc-accounts';
const ADD_FLAG = 'pc-adding-account';
export const MAX_ACCOUNTS = 5;

export function savedAccounts() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function write(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ACCOUNTS))); } catch { /* sem storage */ } }

// Salva (ou atualiza) a conta logada agora.
export async function rememberAccount(user) {
  if (!user) return;
  const list = savedAccounts();
  const has = list.find((a) => a.id === user.id);
  const info = { id: user.id, displayName: user.displayName, username: user.username, avatarUrl: user.avatarUrl || null };
  if (has?.token) { write(list.map((a) => (a.id === user.id ? { ...a, ...info } : a))); return; }
  const { data } = await api.post('/auth/switch/remember');
  write([{ ...info, token: data.token }, ...list.filter((a) => a.id !== user.id)]);
}

export async function switchTo(account) {
  const { data } = await api.post('/auth/switch', { token: account.token });
  if (!data?.user) throw new Error('falhou');
  window.location.assign('/');
}

export async function forgetAccount(account) {
  write(savedAccounts().filter((a) => a.id !== account.id));
  await api.post('/auth/switch/forget', { token: account.token }).catch(() => {});
}

// "Adicionar conta": guarda a atual e vai pro login (sem apagar as salvas).
export async function startAddAccount(user, logout) {
  await rememberAccount(user);
  try { sessionStorage.setItem(ADD_FLAG, '1'); } catch { /* sem storage */ }
  await logout();
  window.location.assign('/login');
}

// Depois do login: se a pessoa estava adicionando conta (ou já usa a troca),
// salva a conta nova também.
export function afterLogin(user) {
  let adding = false;
  try { adding = sessionStorage.getItem(ADD_FLAG) === '1'; sessionStorage.removeItem(ADD_FLAG); } catch { /* sem storage */ }
  if (adding || savedAccounts().length > 0) rememberAccount(user).catch(() => {});
}

export function markAccountGone(id) { write(savedAccounts().filter((a) => a.id !== id)); }
