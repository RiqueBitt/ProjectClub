// Praça do Project Club = Club Penguin completo, rodando em cima do Waddle
// Forever (MIT, https://github.com/nhaar/Waddle-Forever) incorporado em
// server/waddle. Este módulo é a cola entre os dois:
//
//   - HTTP: o jogo pede os SWFs/configs por caminhos absolutos ("/boots.swf",
//     "/play/v2/...", "/setup/..."). O router do WF é montado na raiz do
//     Express do site (depois dos estáticos, antes do fallback do React) e só
//     responde ao que conhece; o resto cai no site normalmente.
//   - WebSocket: o cliente (Flash emulado pelo Ruffle) fala XMLSocket; o Ruffle
//     encaminha por WebSocket pra /waddle/ws/login e /waddle/ws/world no MESMO
//     servidor HTTP do site. Cada conexão é autenticada com o token de acesso
//     do Project Club e o <nick> do login é FORÇADO pro pinguim da conta — o
//     que a pessoa digita no formulário do jogo não importa.
//   - Conta: um pinguim por usuário (tabela WaddlePenguin), criado na primeira
//     visita com a cor do mascote do perfil.
//   - Moderação: a fala no jogo passa pelo automod da comunidade (links de
//     convite, palavras bloqueadas...), igual à Praça antiga.
//
// Configuração (.env): ver docs/praca-club-penguin.md.
const path = require('path');
const { URL } = require('url');
const WebSocket = require('ws');
const env = require('../../config/env');
const prisma = require('../../config/prisma');
const jwt = require('jsonwebtoken');
const { PrismaPenguinStore } = require('./penguinStore');

// Mídia (SWFs): cache em disco + bucket público. Sem WADDLE_MEDIA_URL, usa a
// pasta "waddle/" do mesmo bucket B2 dos anexos do site.
if (!process.env.WADDLE_MEDIA_URL && env.B2_PUBLIC_URL) {
  process.env.WADDLE_MEDIA_URL = `${env.B2_PUBLIC_URL.replace(/\/+$/, '')}/waddle`;
}
if (!process.env.WADDLE_DATA_DIR) {
  process.env.WADDLE_DATA_DIR = path.resolve(__dirname, '../../../data/waddle');
}

const WS_PREFIX = '/waddle/ws/';
// Prefixos que NUNCA são do jogo (evita até a consulta ao mapa de arquivos).
const SKIP_PREFIXES = ['/api/', '/socket.io/', '/uploads/', '/media/', '/assets/', '/waddle/', '/ruffle/', '/minigames/'];
// IP/portas "de fachada": só rotulam o socketProxy do Ruffle (host:porta →
// wss do site). Nenhuma porta é aberta de verdade.
const FAKE_IP = '127.0.0.1';
const FAKE_HTTP_PORT = 24105;

// Cor do mascote do perfil (PetPenguin.color) → id de cor do Club Penguin.
const COLOR_IDS = { blue: 1, green: 2, pink: 3, black: 4, red: 5, orange: 6, yellow: 7, brown: 8, purple: 9 };

let instancePromise = null;
let instance = null;
let store = null;
const sessions = new Map(); // userId -> { ws, done }
let lastError = null;

function loadWaddle() {
  // compilado de server/waddle/src (npm run waddle:build)
  return require('../../../waddle/dist/server/boot.js');
}

async function boot() {
  const { createWaddle } = loadWaddle();
  store = new PrismaPenguinStore(prisma);
  const w = await createWaddle({ db: store, targetIP: FAKE_IP, targetPort: FAKE_HTTP_PORT });
  const { manifestSize } = require('../../../waddle/dist/common/media-store.js');
  const mediaUrl = process.env.WADDLE_MEDIA_URL || '(só cache local)';
  console.log(`[praça] Club Penguin ${w.settings.settings.version} pronto — mídia: ${mediaUrl}, manifesto com ${manifestSize()} arquivos`);
  return w;
}

/** Instância única do jogo (sobe na primeira chamada). */
function getWaddle() {
  if (!instancePromise) {
    instancePromise = boot().then((w) => { instance = w; return w; }).catch((err) => {
      lastError = err;
      console.error('[praça] falha ao iniciar o Club Penguin:', err?.message || err);
      instancePromise = null;
      throw err;
    });
  }
  return instancePromise;
}

// ---------------------------------------------------------------------------
// Pinguim da conta

function sanitizeName(raw) {
  // Nome no padrão do jogo: letras, números e espaço, até 12 caracteres.
  const base = String(raw || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base.slice(0, 12).trim();
}

async function uniqueName(preferred, fallback) {
  const candidates = [preferred, fallback].map(sanitizeName).filter((n) => n.length >= 3);
  if (!candidates.length) candidates.push('Pinguim');
  for (const c of candidates) {
    if (!(await store.exists(c))) return c;
  }
  const stem = candidates[0].slice(0, 9);
  for (let i = 2; i < 10000; i++) {
    const n = `${stem}${i}`;
    if (!(await store.exists(n))) return n;
  }
  throw new Error('Não achei um nome livre pro pinguim.');
}

/** Garante que o usuário tem um pinguim e devolve { id, json }. */
async function ensurePenguin(user) {
  const w = await getWaddle();
  let id = await store.idForUser(user.id);
  if (id !== null) {
    const json = await store.get(id);
    if (json) return { id, json };
  }
  const { getDefaultPenguin } = require('../../../waddle/dist/server/database/database.js');
  const pet = await prisma.petPenguin.findUnique({ where: { userId: user.id }, select: { color: true } }).catch(() => null);
  const color = COLOR_IDS[pet?.color] || 1;
  const name = await uniqueName(user.displayName, user.username);
  const json = getDefaultPenguin(name, color, w.settings.settings.always_member, w.settings.getVirtualDate(0).getTime());
  id = await store.create(json, user.id);
  console.log(`[praça] pinguim "${json.name}" (#${id}) criado para @${user.username}`);
  return { id, json };
}

// ---------------------------------------------------------------------------
// Autenticação do WebSocket

// Ticket da Praça: o token de acesso do site dura 15 min, mas a sessão do
// jogo pode durar horas e o Ruffle reconecta sozinho (trocar de servidor,
// cair a rede). Então /api/plaza/config emite um ticket próprio, assinado com
// o mesmo segredo mas com escopo "plaza" (não serve pra API) e 12 h de vida.
const TICKET_TTL = '12h';
function issueTicket(userId) {
  return jwt.sign({ sub: userId, scope: 'plaza' }, env.JWT_ACCESS_SECRET, { expiresIn: TICKET_TTL });
}

function verifyCredential(token) {
  // aceita o ticket OU o token de acesso normal (testes/ferramentas)
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  if (payload.scope && payload.scope !== 'plaza') throw new Error('escopo errado');
  return payload;
}

async function authenticate(req) {
  const url = new URL(req.url, 'http://x');
  const token = url.searchParams.get('token');
  if (!token) return null;
  let payload;
  try { payload = verifyCredential(token); } catch { return null; }
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, username: true, displayName: true, isPlatformBanned: true, suspendedUntil: true, accountDisabledAt: true },
  });
  if (!user || user.isPlatformBanned || user.accountDisabledAt) return null;
  if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) return null;
  return user;
}

async function moderateSpeech(userId, text) {
  try {
    if (require('../dmAutomod').containsInviteLink(text)) return false;
    const hit = await require('../automod').checkMessage({ channelId: 'plaza', userId, content: text });
    if (hit) return false;
  } catch { /* automod indisponível: deixa passar */ }
  return true;
}

// Transform dos pacotes vindos do cliente: identidade forçada + moderação.
function makeTransform(user, penguinName) {
  return async (packet) => {
    if (packet.startsWith('<')) {
      if (packet.includes("action='login'") || packet.includes('action="login"')) {
        return packet
          .replace(/<nick><!\[CDATA\[[\s\S]*?\]\]><\/nick>/, `<nick><![CDATA[${penguinName}]]></nick>`)
          .replace(/<pword><!\[CDATA\[[\s\S]*?\]\]><\/pword>/, '<pword><![CDATA[projectclub]]></pword>');
      }
      return packet;
    }
    // fala: %xt%s%m#sm%-1%<id>%<texto>%
    if (packet.startsWith('%xt%s%m#sm%')) {
      const parts = packet.split('%');
      const text = parts[6] || '';
      if (!(await moderateSpeech(user.id, text))) return null;
    }
    return packet;
  };
}

function replaceSession(userId) {
  const old = sessions.get(userId);
  if (!old) return Promise.resolve();
  try { old.ws.close(4001, 'Praça aberta em outro lugar'); } catch { /* já fechado */ }
  return old.done;
}

/** Trata o upgrade HTTP → WebSocket dos caminhos /waddle/ws/login e /waddle/ws/world. */
function attachUpgrade(httpServer) {
  const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });
  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (!pathname.startsWith(WS_PREFIX)) return; // socket.io etc. cuidam dos outros
    const kind = pathname.slice(WS_PREFIX.length);
    if (kind !== 'login' && kind !== 'world') { socket.destroy(); return; }
    (async () => {
      const user = await authenticate(req);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const w = await getWaddle();
      const { json } = await ensurePenguin(user);
      if (kind === 'world') await replaceSession(user.id);
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (kind === 'world') {
          let finish;
          const done = new Promise((r) => { finish = r; });
          const entry = { ws, done };
          sessions.set(user.id, entry);
          ws.on('close', () => {
            if (sessions.get(user.id) === entry) sessions.delete(user.id);
            // dá tempo do WF tirar o pinguim do mundo antes de outra entrada
            setTimeout(finish, 150);
          });
        }
        w.attach(kind, ws, makeTransform(user, json.name));
      });
    })().catch((err) => {
      console.error('[praça] erro no upgrade do WebSocket:', err?.message || err);
      try { socket.destroy(); } catch { /* ignora */ }
    });
  });
}

// ---------------------------------------------------------------------------
// HTTP do jogo dentro do Express do site

function mountHttp(app) {
  app.use((req, res, next) => {
    if (req.path === '/' || SKIP_PREFIXES.some((p) => req.path.startsWith(p))) return next();
    if (req.method !== 'GET' && req.method !== 'POST') return next();
    getWaddle().then((w) => {
      const route = req.path.replace(/^\/+/, '');
      // só entra no router do WF se a rota for do jogo (evita custo nos 404 do site)
      if (req.method === 'GET' && !w.http.getFileServer().knowsRoute(route)) return next();
      cachedRouter(w)(req, res, next);
    }).catch(() => next());
  });
}

// Router cacheado (o WF cria um novo a cada getRouter(); um só basta).
const routerCache = new WeakMap();
function cachedRouter(w) {
  let r = routerCache.get(w);
  if (!r) { r = w.http.getRouter(); routerCache.set(w, r); }
  return r;
}

// ---------------------------------------------------------------------------
// Dados pro cliente (PracaPage)

/** Entrada do jogo pra data configurada: o SWF que a página original do WF embute. */
async function getEntry(w) {
  const html = await w.http.getFileServer().resolve('');
  const text = typeof html === 'string' ? html : html ? html.toString('utf-8') : '';
  const data = text.match(/<object[^>]*\sdata="([^"]+)"/i);
  const flashvars = text.match(/name="flashvars"\s+value="([^"]*)"/i);
  return { swf: data ? data[1] : '/boots.swf', flashvars: flashvars ? flashvars[1] : 'lang=en' };
}

async function getConfig(user) {
  const w = await getWaddle();
  const { id, json } = await ensurePenguin(user);
  const entry = await getEntry(w);
  const s = w.settings;
  return {
    entry,
    version: s.settings.version,
    lang: (entry.flashvars.match(/lang=(\w+)/) || [])[1] || 'en',
    stage: { width: 760, height: 480 },
    // Ruffle: host:porta que o SWF tenta abrir → WebSocket do site
    socketProxy: [
      { host: FAKE_IP, port: s.loginPort, path: `${WS_PREFIX}login` },
      { host: FAKE_IP, port: s.worldPort, path: `${WS_PREFIX}world` },
    ],
    penguin: { id, name: json.name, color: json.color, coins: json.coins, member: !!json.is_member },
    online: w.world.getAllPlayersInfo().length,
    ticket: issueTicket(user.id),
  };
}

async function getStatus() {
  if (!instance) return { ready: false, online: 0, error: lastError ? String(lastError.message || lastError) : null };
  return { ready: true, online: instance.world.getAllPlayersInfo().length, version: instance.settings.settings.version };
}

module.exports = { getWaddle, mountHttp, attachUpgrade, getConfig, getStatus, ensurePenguin, cachedRouter };
