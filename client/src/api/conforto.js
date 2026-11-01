import { api } from './client';

// Primeiros passos (checklist com moedas) + tour de boas-vindas.
export const getOnboarding = () => api.get('/onboarding').then((r) => r.data);
export const claimOnboardingStep = (step) => api.post(`/onboarding/claim/${encodeURIComponent(step)}`).then((r) => r.data);
// key: 'tour' (tour visto) | 'dismiss' (checklist escondido)
export const setOnboardingMeta = (key, on = true) => api.post(`/onboarding/meta/${key}`, { on }).then((r) => r.data);

// Painel de saúde da staff + backups do banco.
export const getStaffOpsHealth = () => api.get('/staff-ops/health').then((r) => r.data);
export const getStaffBackups = () => api.get('/staff-ops/backups').then((r) => r.data);
export const runStaffBackup = () => api.post('/staff-ops/backups/run').then((r) => r.data);
