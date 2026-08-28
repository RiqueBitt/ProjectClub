const prisma = require('../config/prisma');

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
      reason: reason || null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    },
  });
  io?.to('community').emit('audit:new', { id: entry.id });
  return entry;
}

function shapeAuditEntry(entry) {
  return { ...entry, metadata: entry.metadata ? JSON.parse(entry.metadata) : null };
}

module.exports = { logAction, shapeAuditEntry };
