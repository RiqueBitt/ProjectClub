const express = require('express');

// Item pedido: "com VPN as imagens (foto de perfil, banners, ícones de
// Clube) acabam bugando e não aparecendo". Causa provável: hoje essas
// imagens apontam DIRETO pro domínio do Backblaze B2 (um provedor
// terceiro) — e é muito comum VPNs, bloqueadores de rastreadores
// embutidos, ou DNS de operadora falharem em resolver/liberar domínios
// de CDN de terceiros específicos, mesmo com o resto da internet
// funcionando normal. A correção: servir essas imagens através do
// NOSSO PRÓPRIO domínio (que a pessoa já está usando o site inteiro
// sem problema nenhum) — o navegador nunca precisa falar com o B2
// diretamente, só o nosso servidor fala, por trás.
//
// Só permite proxiar URLs de domínios reais do Backblaze B2 — nunca uma
// URL arbitrária qualquer (isso abriria a porta pra alguém usar esse
// endpoint pra mascarar/ocultar a origem de outra coisa completamente
// diferente, um jeito clássico de abusar de proxies abertos).
//
// BUG CORRIGIDO ("insígnias sumiram do perfil, mas continuam aparecendo
// no modal de lista completa"): a validação antes exigia que a URL
// começasse EXATAMENTE com B2_PUBLIC_URL (o balde configurado no
// .env) — mas nem toda imagem enviada ao longo do tempo necessariamente
// usa sempre o mesmo domínio/balde exato (podem existir uploads
// antigos com um endereço um pouco diferente, mesmo sendo todos B2 de
// verdade). Isso rejeitava com erro 403 qualquer imagem que não
// batesse LETRA POR LETRA com o que está configurado agora — mesmo
// sendo uma imagem legítima do B2. O modal antigo (BadgeListModal)
// continuava funcionando porque nem passa pelo proxy, vai direto no
// B2 (só funciona sem VPN). Agora aceita qualquer domínio
// *.backblazeb2.com — o mesmo padrão, já testado, que o PRÓPRIO
// cliente usa pra decidir o que proxiar (ver utils/imageProxy.js) —
// os dois lados concordam exatamente no que é "do B2", sem exigir que
// bata com uma URL configurada específica.
const router = express.Router();

router.get('/image', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string') return res.status(400).send('URL obrigatória.');
    if (!/^https:\/\/[a-z0-9.-]*backblazeb2\.com\//i.test(url)) {
      return res.status(403).send('Origem não permitida.');
    }

    const upstream = await fetch(url);
    if (!upstream.ok || !upstream.body) return res.status(upstream.status || 502).send('Não foi possível buscar a imagem.');

    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    // Cache generoso do lado do navegador/CDN — a imagem em si não muda
    // de conteúdo pra uma mesma URL (uploads geram um nome novo a cada
    // troca), só o CAMINHO pra buscar ela mudou de "direto no B2" pra
    // "através de nós".
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    const reader = upstream.body.getReader();
    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      res.write(Buffer.from(value));
      pump();
    };
    pump();
  } catch (err) {
    res.status(502).send('Falha ao buscar a imagem.');
  }
});

module.exports = router;
