const crypto = require('crypto');
const prisma = require('../config/prisma');

// Item pedido: "SecurityLog... Não armazenar informações sensíveis
// desnecessárias no log" — nunca guarda o IP em si, só um hash dele
// (sha256) — dá pra reconhecer "mesmo IP de sempre" vs "IP diferente"
// sem guardar o endereço de verdade em texto puro no banco.
function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

// Item pedido: "Senha alterada, Sessão encerrada, E-mail alterado,
// Conexão adicionada, Conexão removida" — chamado pelos controllers
// relevantes conforme cada fase for implementada (ver settingsController.js
// pra "SETTINGS_RESET", e os próximos: authController.js pra senha/
// e-mail, connectionController.js pra conexões, quando essas fases
// chegarem).
async function logSecurityEvent(req, action) {
  try {
    await prisma.securityLog.create({
      data: {
        userId: req.user.id,
        action,
        device: (req.headers['user-agent'] || '').slice(0, 200) || null,
        ipHash: hashIp(req.ip),
      },
    });
  } catch (err) {
    // Log de segurança nunca deve derrubar a ação principal que
    // disparou ele (trocar senha, resetar configurações, etc) — se
    // falhar, só registra no console do servidor e segue a vida.
    console.error('[securityLog] falha ao registrar evento:', err.message);
  }
}

module.exports = { logSecurityEvent, hashIp };
