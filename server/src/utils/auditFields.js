// Campos dos registros de auditoria (AuditLogEntry / PlatformAuditLog).
//
// `reason` é VARCHAR(191) no MySQL (String sem @db.* no schema) e vem do
// que a staff digitou — um motivo de banimento mais longo fazia o
// prisma.*.create estourar ("value too long for the column") DEPOIS da
// ação já ter sido aplicada: a pessoa era banida, mas a tela mostrava erro
// 500 e o aviso em tempo real nunca saía. Aqui o texto é cortado no limite.
// `metadata` virou TEXT, mas ainda assim tem um teto pra nunca gravar um
// objeto gigante por engano.
const REASON_MAX = 191;
const METADATA_MAX = 16000;

function auditReason(reason) {
  if (reason === undefined || reason === null || reason === '') return null;
  const text = String(reason).trim();
  return text ? text.slice(0, REASON_MAX) : null;
}

function auditMetadata(metadata) {
  if (metadata === undefined || metadata === null) return null;
  let json;
  try { json = JSON.stringify(metadata); } catch { return null; }
  if (!json) return null;
  return json.length > METADATA_MAX ? JSON.stringify({ truncated: true, preview: json.slice(0, 500) }) : json;
}

// Leitura tolerante: uma linha antiga/corrompida não derruba a lista toda.
function parseAuditMetadata(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

module.exports = { auditReason, auditMetadata, parseAuditMetadata, REASON_MAX, METADATA_MAX };
