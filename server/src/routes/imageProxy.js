const express = require('express');
const env = require('../config/env');

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
//
// Item pedido: "sistema de otimização... carregar banner, placa de
// identificação etc mais rápido": antes, CADA requisição que passava
// por aqui buscava a imagem no B2 de novo, mesmo sendo a mesmíssima
// imagem que outra pessoa qualquer já tinha pedido segundos antes —
// o Cache-Control abaixo só evita que o MESMO navegador peça nossa
// URL de novo, não evita esse servidor ter que buscar tudo de novo no
// B2 pra cada pessoa diferente que vê aquele avatar/banner/ícone.
// Cache em memória, com limite de tamanho total (pra nunca crescer
// sem controle) e um tempo de vida curto (uploads trocam de nome a
// cada troca de arquivo, então uma imagem já em cache nunca fica
// desatualizada de verdade — o TTL aqui é só uma rede de segurança
// pra liberar memória de imagens que pararam de ser vistas).
// Otimização de memória (item pedido): 80MB → 48MB. O navegador já guarda
// cada imagem por 1 ano (Cache-Control imutável), então este cache só
// serve pra NÃO buscar de novo no upstream quando várias pessoas abrem a
// mesma imagem ao mesmo tempo — 48MB cobre isso com folga e libera ~32MB
// de heap pros usuários.
const CACHE_MAX_BYTES = 48 * 1024 * 1024; // 48MB de imagens guardadas ao mesmo tempo, no máximo
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos
const cache = new Map(); // url -> { buffer, contentType, size, expiresAt }
let cacheBytes = 0;

function evictExpired() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt < now) {
      cache.delete(key);
      cacheBytes -= entry.size;
    }
  }
}

function evictOldestUntilFits(incomingSize) {
  // Map preserva a ordem de inserção — a primeira chave é sempre a
  // mais antiga ainda guardada, então dá pra ir liberando por ali
  // sem precisar rastrear "quem foi visto por último" separadamente.
  for (const [key, entry] of cache) {
    if (cacheBytes + incomingSize <= CACHE_MAX_BYTES) break;
    cache.delete(key);
    cacheBytes -= entry.size;
  }
}

// Item pedido: "os ícones dos mods e as capas dos jogos não aparecem".
// Além do B2, passa pelo nosso servidor também as imagens das fontes de
// mods e da Steam — CDNs de terceiro que VPN/bloqueador/operadora às
// vezes barram, ou que bloqueiam imagem "linkada" de outro site. Só
// esses domínios exatos (nunca uma URL qualquer).
const ALLOWED_HOSTS = [
  /(^|\.)backblazeb2\.com$/i,
  /(^|\.)modcdn\.io$/i, // mod.io
  /(^|\.)mod\.io$/i,
  /(^|\.)gamebanana\.com$/i,
  /(^|\.)thunderstore\.io$/i,
  /(^|\.)nexusmods\.com$/i,
  /(^|\.)nexus-cdn\.com$/i,
  // Artes da Steam: cdn./shared.akamai./shared.cloudflare.steamstatic.com
  // (capa vertical/header da atividade "Jogando X" e da biblioteca).
  /(^|\.)steamstatic\.com$/i,
  /(^|\.)steamusercontent\.com$/i,
  /(^|\.)akamaihd\.net$/i, // imagens antigas do Workshop
];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;

// SEGURANÇA: no Backblaze, qualquer pessoa pode ter um balde público em
// *.backblazeb2.com — sem isso o proxy servia arquivo de QUALQUER balde
// (inclusive de terceiros) pelo nosso domínio. Quando o nome do nosso
// balde está configurado, só ele passa: estilo caminho
// (f00X.backblazeb2.com/file/<balde>/..., s3.<região>.backblazeb2.com/<balde>/...)
// ou estilo host virtual (<balde>.s3.<região>.backblazeb2.com/...).
function isOwnB2Bucket(u) {
  const bucket = env.B2_BUCKET;
  if (!bucket) return true; // sem configuração, mantém o comportamento antigo
  const host = u.hostname.toLowerCase();
  const b = bucket.toLowerCase();
  if (host.startsWith(`${b}.`)) return true;
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts[0] === 'file' && parts[1]?.toLowerCase() === b) return true;
  return parts[0]?.toLowerCase() === b;
}

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false;
    if (!ALLOWED_HOSTS.some((re) => re.test(u.hostname))) return false;
    if (/(^|\.)backblazeb2\.com$/i.test(u.hostname) && !isOwnB2Bucket(u)) return false;
    return true;
  } catch { return false; }
}

// SVG pode carregar <script> — servido pelo NOSSO domínio, viraria XSS.
const BLOCKED_IMAGE_TYPES = /^image\/(svg\+xml|svg)\b/i;

// Segue redirecionamento na mão: só pra outro endereço que TAMBÉM passa
// em isAllowedUrl (antes o fetch seguia pra qualquer host).
async function fetchFollowingAllowed(url) {
  let current = url;
  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(current, {
      headers: { 'User-Agent': 'ProjectClub/1.0', Accept: 'image/*' },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location'), current).toString();
      if (!isAllowedUrl(next)) return { status: 403 };
      current = next;
      continue;
    }
    return { res };
  }
  return { status: 508 };
}

// Busca (ou pega do cache) e devolve { buffer, contentType } ou null.
async function loadImage(url) {
  evictExpired();
  const cached = cache.get(url);
  if (cached) return { ...cached, hit: true };
  const { res: upstream, status } = await fetchFollowingAllowed(url);
  if (!upstream) return { status };
  if (!upstream.ok) return { status: upstream.status };
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  if (!/^image\//i.test(contentType) || BLOCKED_IMAGE_TYPES.test(contentType)) return { status: 415 };
  const declared = Number(upstream.headers.get('content-length') || 0);
  if (declared > MAX_IMAGE_BYTES) return { status: 413 };
  const buffer = Buffer.from(await upstream.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) return { status: 413 };
  // Imagens gigantes não entram no cache — não vale gastar uma fatia
  // grande do limite numa imagem só; ainda é servida normalmente.
  if (buffer.length <= CACHE_MAX_BYTES / 4) {
    evictOldestUntilFits(buffer.length);
    cache.set(url, { buffer, contentType, size: buffer.length, expiresAt: Date.now() + CACHE_TTL_MS });
    cacheBytes += buffer.length;
  }
  return { buffer, contentType, hit: false };
}

function sendImage(res, img) {
  res.setHeader('Content-Type', img.contentType);
  // Defesa extra: nunca adivinhar o tipo e, se algo for aberto direto,
  // nada roda (sem script, sem formulário, origem isolada).
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  // A imagem não muda de conteúdo pra uma mesma URL.
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.setHeader('X-Cache', img.hit ? 'HIT' : 'MISS');
  res.end(img.buffer);
}

const router = express.Router();

router.get('/image', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string') return res.status(400).send('URL obrigatória.');
    if (!isAllowedUrl(url)) return res.status(403).send('Origem não permitida.');
    const img = await loadImage(url);
    if (!img.buffer) return res.status(img.status || 502).send('Não foi possível buscar a imagem.');
    sendImage(res, img);
  } catch {
    res.status(502).send('Falha ao buscar a imagem.');
  }
});

// Capa / fundo / cabeçalho de um jogo da Steam pelo AppID. A Steam mudou
// o endereço das artes (agora com um código no meio do caminho), então o
// link antigo dá 404 em muitos jogos — steamArtService descobre o certo.
const steamArt = require('../services/steamArtService');
router.get('/steam/:appId/:kind', async (req, res) => {
  try {
    const appId = Number(req.params.appId);
    const { kind } = req.params;
    if (!Number.isInteger(appId) || appId <= 0 || !steamArt.KINDS.includes(kind)) return res.status(400).send('Pedido inválido.');
    const url = await steamArt.resolve(appId, kind, loadImage);
    if (!url) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(404).send('Sem arte pra esse jogo.');
    }
    const img = await loadImage(url);
    if (!img.buffer) return res.status(404).send('Sem arte pra esse jogo.');
    sendImage(res, img);
  } catch {
    res.status(502).send('Falha ao buscar a imagem.');
  }
});

module.exports = router;
// Pros testes (server/test/steam-cover.test.js): a mesma checagem da rota.
module.exports.isAllowedUrl = isAllowedUrl;
