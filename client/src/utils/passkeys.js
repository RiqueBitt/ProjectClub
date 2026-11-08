// Chaves de acesso (passkeys): entrar com digital, rosto ou PIN do aparelho.
// Servidor: server/src/controllers/passkeyController.js.
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { api } from '../api/client';

export const passkeysSupported = () => {
  try { return browserSupportsWebAuthn(); } catch { return false; }
};

// Cancelou na janela do sistema: não é erro pra mostrar em vermelho.
export const isCancel = (e) => e?.name === 'NotAllowedError' || e?.name === 'AbortError';

export async function loginWithPasskey() {
  const { data: { options, flowId } } = await api.post('/auth/passkeys/login/options');
  const response = await startAuthentication({ optionsJSON: options });
  const { data } = await api.post('/auth/passkeys/login/verify', { flowId, response });
  return data;
}

export async function addPasskey(name) {
  const { data: options } = await api.post('/auth/passkeys/register/options');
  const response = await startRegistration({ optionsJSON: options });
  const { data } = await api.post('/auth/passkeys/register/verify', { response, name });
  return data.passkey;
}

export const listPasskeys = () => api.get('/auth/passkeys').then((r) => r.data.passkeys || []);
export const removePasskey = (id) => api.delete(`/auth/passkeys/${id}`);
