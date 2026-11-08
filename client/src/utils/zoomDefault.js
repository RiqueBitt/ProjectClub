// Migração do zoom padrão da interface: 120% (1.2) → 100% (1.0).
//
// BUG CORRIGIDO ("o zoom da interface começa em 120%, deveria ser
// 100%"): o padrão histórico do app era 1.2. Agora, quando o zoom nunca
// foi escolhido (primeira vez / valor ainda no padrão antigo), ele deve
// valer 1.0. Quem ESCOLHEU outro zoom de propósito (1.5, 0.8, etc.) não é
// mexido. Como o valor histórico 1.2 era o padrão de quem nunca mexeu,
// essa migração troca um 1.2 "de padrão" por 1.0 UMA vez só (guardada por
// um flag), e deixa qualquer outro valor como está.
const FLAG = 'pc_iface_zoom_migrated_v2';
const LEGACY_DEFAULT = 1.2;
export const NEW_DEFAULT = 1;

function near(a, b) { return Number.isFinite(a) && Math.abs(a - b) < 1e-6; }

export function zoomMigrationDone() {
  try { return !!localStorage.getItem(FLAG); } catch { return false; }
}

export function markZoomMigrationDone() {
  try { localStorage.setItem(FLAG, '1'); } catch { /* localStorage indisponível — sem problema */ }
}

// Retorna o valor a usar. Se a migração ainda não rodou e o valor é
// exatamente o padrão antigo (1.2), devolve 1.0; senão, devolve o valor
// como está. NÃO marca o flag (quem chama decide quando marcar, depois de
// já ter consultado a fonte de verdade — a conta).
export function migrateZoomValue(value) {
  if (zoomMigrationDone()) return value;
  if (near(Number(value), LEGACY_DEFAULT)) return NEW_DEFAULT;
  return value;
}
