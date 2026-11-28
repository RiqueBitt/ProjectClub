const prisma = require('../config/prisma');
const { auditReason, auditMetadata, parseAuditMetadata } = require('../utils/auditFields');

// Todo evento relevante de moderação passa por aqui, então o log fica
// completo por construção. `actorId` é 'system' para ações que o AutoMod
// toma sozinho (ver services/automod.js).
async function logAction(io, { actorId, action, targetType = null, targetId = null, reason = null, metadata = null }) {
  const entry = await prisma.auditLogEntry.create({
    data: {
      actorId,
      action,
      targetType,
      targetId,
      reason: auditReason(reason), // VARCHAR(191) — ver utils/auditFields.js
      metadata: auditMetadata(metadata),
    },
  });
  io?.to('community').emit('audit:new', { id: entry.id });
  return entry;
}

function shapeAuditEntry(entry) {
  // JSON.parse sem proteção: uma linha corrompida derrubava o registro inteiro.
  return { ...entry, metadata: parseAuditMetadata(entry.metadata) };
}

module.exports = { logAction, shapeAuditEntry };
