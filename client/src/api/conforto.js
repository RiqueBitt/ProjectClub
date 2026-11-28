import { api } from './client';

// Primeiros passos (checklist com moedas) + tour de boas-vindas.
// Quem pede junto (tour, checklist, voltar pra aba) recebe a MESMA resposta:
// a abertura do app pedia /onboarding 3 vezes seguidas. `fresh` (aviso do
// servidor de que mudou) ignora o que foi buscado há instantes.
let onboardingInflight = null;
let onboardingLast = null;
let onboardingAt = 0;
export const getOnboarding = ({ fresh = false } = {}) => {
  if (onboardingInflight) return onboardingInflight;
  // 15 s: a abertura do app ainda pedia de novo 2 s depois (ao ganhar foco).
  // Mudança de verdade chega pelo socket (fresh) ou pelo resgate (limpa).
  if (!fresh && onboardingLast && Date.now() - onboardingAt < 15000) return Promise.resolve(onboardingLast);
  onboardingInflight = api.get('/onboarding')
    .then((r) => { onboardingLast = r.data; onboardingAt = Date.now(); return r.data; })
    .finally(() => { onboardingInflight = null; });
  return onboardingInflight;
};
const forgetOnboarding = (d) => { onboardingLast = null; return d; };
export const claimOnboardingStep = (step) => api.post(`/onboarding/claim/${encodeURIComponent(step)}`).then((r) => forgetOnboarding(r.data));
// key: 'tour' (tour visto) | 'dismiss' (checklist escondido)
export const setOnboardingMeta = (key, on = true) => api.post(`/onboarding/meta/${key}`, { on }).then((r) => forgetOnboarding(r.data));

// Painel de saúde da staff + backups do banco.
export const getStaffOpsHealth = () => api.get('/staff-ops/health').then((r) => r.data);
export const getStaffBackups = () => api.get('/staff-ops/backups').then((r) => r.data);
export const runStaffBackup = () => api.post('/staff-ops/backups/run').then((r) => r.data);
