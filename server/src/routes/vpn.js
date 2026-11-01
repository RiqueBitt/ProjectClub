// VPN do Project Club (app de PC): lista de servidores do VPN Gate e a
// configuração OpenVPN do servidor escolhido. Só para quem está logado.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { createRateLimitStore } = require('../config/rateLimitStore');
const vpnGate = require('../services/vpnGate');

const router = express.Router();
router.use(requireAuth);
// Pedir configuração é raro (uma por conexão): limite folgado por pessoa.
const configLimit = rateLimit({
  windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user.id}`, store: createRateLimitStore('vpn-config'),
  message: { error: 'Muitas conexões seguidas. Espere um minutinho.' },
});

router.get('/servers', async (req, res) => {
  try {
    res.set('Cache-Control', 'private, max-age=60');
    res.json(await vpnGate.listServers());
  } catch (err) {
    console.warn('[vpn] lista indisponível:', err.message);
    res.status(503).json({ error: 'A lista de servidores de VPN está indisponível agora. Tente de novo em alguns minutos.' });
  }
});

router.get('/servers/:id/config', configLimit, async (req, res) => {
  try {
    const s = await vpnGate.getConfig(req.params.id);
    if (!s) return res.status(404).json({ error: 'Esse servidor saiu do ar. Atualize a lista e escolha outro.' });
    res.set('Cache-Control', 'no-store');
    res.json({ id: s.id, country: s.country, countryName: s.countryName, config: s.config });
  } catch (err) {
    console.warn('[vpn] configuração indisponível:', err.message);
    res.status(503).json({ error: 'Não deu pra buscar o servidor de VPN agora. Tente de novo.' });
  }
});

module.exports = router;
