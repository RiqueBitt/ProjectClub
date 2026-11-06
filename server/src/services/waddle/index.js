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
//   - Mídia: os SWFs ficam no disco (server/data/waddle/media); se faltar
//     algo, o servidor baixa os pacotes da release waddle-media do GitHub e
//     extrai — em segundo plano, sem segurar o resto do site.
//
// Configuração (.env): ver docs/praca-club-penguin.md.
const path = require('path');
const fs = require('fs');
const { URL } = require('url');
const WebSocket = require('ws');
const env = require('../../config/env');
const prisma = require('../../config/prisma');
const jwt = require('jsonwebtoken');
const { PrismaPenguinStore } = require('./penguinStore');
const news = require('./news');

// Mídia (SWFs): fica no disco do servidor; na primeira inicialização é
// baixada da release "waddle-media" do repositório (ver media-store.ts).
if (!process.env.WADDLE_DATA_DIR) {
  process.env.WADDLE_DATA_DIR = path.resolve(__dirname, '../../../data/waddle');
}

const WS_PREFIX = '/waddle/ws/';
// Prefixos que NUNCA são do jogo (evita até a consulta ao mapa de arquivos).
// Caminhos que são só do jogo: arquivo inexistente aqui é 404, nunca a página do site.
const GAME_PREFIXES = ['/play/', '/playstart/', '/artwork/', '/games/', '/web_service/', '/mobile/'];
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
const penguinUser = new Map(); // penguinId (online) -> userId da conta
let lastError = null;

function loadWaddle() {
  // compilado de server/waddle/src (npm run waddle:build)
  return require('../../../waddle/dist/server/boot.js');
}

// Amizade entre duas contas mudou no site: põe/tira um do outro na lista de
// amigos do Club Penguin (online: na hora, com o aviso do jogo; offline: no JSON).
async function syncFriendPair(w, ids) {
  const [a, b] = ids;
  if (!a || !b || a === b) return;
  const [pa, pb] = await Promise.all([store.idForUser(a), store.idForUser(b)]);
  if (!pa || !pb) return;
  const friends = !!(await prisma.friendship.findFirst({ where: { status: 'ACCEPTED', OR: [{ requesterId: a, addresseeId: b }, { requesterId: b, addresseeId: a }] }, select: { id: true } }));
  for (const [me, other] of [[pa, pb], [pb, pa]]) {
    const live = w.world.getOnline(me);
    if (live) {
      if (friends && !live.buddy.isBuddy(other) && !live.buddy.ignored.includes(other)) {
        const otherJson = await store.get(other);
        live.buddy.add(other);
        w.world.notify(live, 'ba', other, otherJson?.name || 'Amigo');
        if (!w.world.getOnline(other)) w.world.notify(live, 'bof', other);
        w.world.persist(live);
      } else if (!friends && live.buddy.isBuddy(other)) {
        live.buddy.remove(other);
        w.world.notify(live, 'rb', other);
        w.world.persist(live);
      }
    } else {
      const json = await store.get(me);
      if (!json) continue;
      const list = new Set((Array.isArray(json.buddies) ? json.buddies : []).map(Number));
      const ignored = new Set((Array.isArray(json.ignored) ? json.ignored : []).map(Number));
      const before = list.size;
      if (friends && !ignored.has(other)) list.add(other); else if (!friends) list.delete(other);
      if (list.size !== before) { json.buddies = [...list]; await store.write(me, json); }
    }
  }
}

async function boot() {
  const { createWaddle } = loadWaddle();
  store = new PrismaPenguinStore(prisma);
  const w = await createWaddle({ db: store, targetIP: FAKE_IP, targetPort: FAKE_HTTP_PORT });
  // Moeda única (ver penguinStore.js): saldo mudou no site → o pinguim online
  // recebe a diferença na hora (e o jogo mostra o saldo novo).
  store.onCoins = (id, diff) => {
    const live = w.world.getOnline(id);
    if (!live) return;
    live.currency.add(diff);
    if (live.currency.coins < 0) live.currency.set(0);
    try { w.world.notify(live, 'gtc', live.currency.coins); } catch { /* cliente saindo */ }
  };
  store.onUserCoins = (userId, coins) => {
    try { io?.to(`user:${userId}`).emit('user:update', { id: userId, coins }); } catch { /* ok */ }
  };
  store.onCoinCap = (userId, cap) => {
    try { io?.to(`user:${userId}`).emit('praca:coin-cap', { cap }); } catch { /* ok */ }
  };
  // saldo mudou no site (loja, baú, missão…): o pinguim online recebe na hora
  require('../coinEvents').onCoinsChanged((userId) => {
    for (const [pid, uid] of penguinUser) if (uid === userId) store.refreshCoins(pid, { force: true }).catch(() => {});
  });
  // amigos do Project Club = amigos no jogo: aceitou/desfez no site → muda na hora
  require('../friendEvents').onFriendsChanged((ids) => { syncFriendPair(w, ids).catch((err) => console.warn('[praça] amigos:', err?.message || err)); });
  // e, por garantia, confere de tempos em tempos
  setInterval(() => {
    for (const id of penguinUser.keys()) store.refreshCoins(id, { force: true }).catch(() => {});
  }, 4000).unref?.();
  // festas de 2013-2017 (rodízio de anos + festas ligadas pela staff)
  try { require('./parties').attach(w); } catch (err) { console.warn('[festas] não iniciou:', err?.message || err); }
  // mensagens da EPF no telefone espião (escritas pela staff)
  try { require('./epf').attach(w); } catch (err) { console.warn('[epf] não iniciou:', err?.message || err); }
  const media = require('../../../waddle/dist/common/media-store.js');
  console.log(`[praça] Club Penguin ${w.settings.settings.version} pronto — manifesto com ${media.manifestSize()} arquivos; conferindo a mídia no disco…`);
  // Não espera: o site sobe normal; a Praça mostra "preparando" até terminar.
  media.ensureMedia((msg) => console.log(`[praça] ${msg}`)).then((st) => {
    if (st.state === 'ready') console.log('[praça] mídia pronta');
  });
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
// O cliente clássico (AS2) manda o NOME no login; o moderno (AS3, 2011+) manda
// o ID numérico do pinguim no login do mundo — a troca respeita o formato.
function makeTransform(user, penguinName, penguinId) {
  return async (packet) => {
    if (packet.startsWith('<')) {
      if (packet.includes("action='login'") || packet.includes('action="login"')) {
        const sent = (packet.match(/<nick><!\[CDATA\[([\s\S]*?)\]\]><\/nick>/) || [])[1] || '';
        const identity = /^\d+$/.test(sent.trim()) ? String(penguinId) : penguinName;
        return packet
          .replace(/<nick><!\[CDATA\[[\s\S]*?\]\]><\/nick>/, `<nick><![CDATA[${identity}]]></nick>`)
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
      const { id: penguinId, json } = await ensurePenguin(user);
      if (kind === 'world') await replaceSession(user.id);
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (kind === 'world') {
          penguinUser.set(penguinId, user.id);
          let finish;
          const done = new Promise((r) => { finish = r; });
          const entry = { ws, done };
          sessions.set(user.id, entry);
          ws.on('close', () => {
            if (sessions.get(user.id) === entry) { sessions.delete(user.id); penguinUser.delete(penguinId); }
            // dá tempo do WF tirar o pinguim do mundo antes de outra entrada
            setTimeout(finish, 150);
          });
        }
        w.attach(kind, ws, makeTransform(user, json.name, penguinId));
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
      if (req.method === 'GET' && !w.http.getFileServer().knowsRoute(route)) {
        // Arquivo do JOGO que não existe: 404 de verdade. Antes caía na página
        // do site (HTML com 200) — o cliente 2012 tentava abrir aquilo como
        // Flash e travava (ex.: intro_to_cp.swf, carregado a cada login antes
        // de mostrar a barra do jogo: sem ele a barra de chat nunca aparecia).
        if (GAME_PREFIXES.some((pre) => req.path.startsWith(pre))) {
          res.status(404).set('Cache-Control', 'no-store').type('text').send('Arquivo do jogo não encontrado.');
          return undefined;
        }
        return next();
      }
      // Jornal: em português (news/), o resto vai pro servidor do jogo
      if (req.method === 'GET' && news.isNewsRoute(route)) {
        news.handle(w, route, req, res)
          .then((done) => { if (!done) cachedRouter(w)(req, res, next); })
          .catch((err) => { console.warn('[jornal] erro:', err?.message || err); cachedRouter(w)(req, res, next); });
        return undefined;
      }
      cachedRouter(w)(req, res, next);
      return undefined;
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

/** Nomes das festas em português (o nome original continua sendo a chave). */
const PARTY_PT = {
  'Halloween Party': 'Festa de Halloween', 'Holiday Party': 'Festa de Natal', 'Operation: Blackout': 'Operação: Blecaute',
  'Puffle Party': 'Festa dos Puffles', 'Medieval Party': 'Festa Medieval', 'Marvel Super Hero Takeover': 'Invasão dos Super-Heróis Marvel',
  'Card-Jitsu Party': 'Festa do Card-Jitsu', 'Music Jam': 'Festival de Música', 'Make Your Mark: Ultimate Jam': 'Deixe Sua Marca: Festival Supremo',
  'Fair': 'A Feira', 'The Fair': 'A Feira', 'April Fools': 'Dia da Mentira', 'Earth Day': 'Dia da Terra', 'Easter Egg Hunt': 'Caça aos Ovos de Páscoa',
  'Underwater Expedition': 'Expedição Submarina', 'Fashion Show': 'Desfile de Moda', 'Adventure Party: Temple of Fruit': 'Festa da Aventura: Templo das Frutas',
  'Island Adventure Party': 'Festa da Aventura na Ilha', 'Wilderness Expedition': 'Expedição Selvagem', '6th Anniversary Party': 'Festa de 6º Aniversário',
  '7th Anniversary Party': 'Festa de 7º Aniversário', 'Battle of Doom': 'Batalha da Perdição', 'Great Snow Race': 'Grande Corrida na Neve',
};
const partyLabel = (name) => (name ? PARTY_PT[name] || require('./parties').labelOf(name) || name : null);

/** Código numérico estável (2 dígitos) pra festa: entra na contentVersion. */
function partyCode(party) {
  if (!party) return '';
  let h = 7;
  for (const ch of String(party)) h = (h * 31 + ch.charCodeAt(0)) % 90;
  return String(10 + h);
}

/**
 * Entrada do jogo pra data configurada: o SWF que a página original do WF
 * embute e as flashvars. Durante uma festa a `contentVersion` ganha o código
 * da festa: as salas/crumbs mudam de conteúdo na MESMA rota, e sem isso o
 * cache do navegador (30 dias) mostraria a ilha sem a decoração. Quando a
 * festa acaba, volta à versão original — e os arquivos normais já estão no
 * cache.
 */
async function getEntry(w) {
  const html = await w.http.getFileServer().resolve('');
  const text = typeof html === 'string' ? html : html ? html.toString('utf-8') : '';
  const data = text.match(/<object[^>]*\sdata="([^"]+)"/i);
  const flashvars = text.match(/name="flashvars"\s+value="([^"]*)"/i);
  let fv = flashvars ? flashvars[1] : 'lang=en';
  const party = w.gameData.getPartyName ? w.gameData.getPartyName() : null;
  const baseContent = (fv.match(/contentVersion=(\d+)/) || [])[1] || '';
  if (party) fv = fv.replace(/(contentVersion=)(\d+)/, (_, k, v) => `${k}${v}${partyCode(party)}`);
  return { swf: data ? data[1] : '/boots.swf', flashvars: fv, party, baseContent };
}

// ---------------------------------------------------------------------------
// Pacotes de download ("jogo base" e "evento")
//
// O navegador baixa o jogo arquivo por arquivo conforme o Flash pede, o que
// deixa a primeira abertura lenta. A página "instala" o jogo base uma vez
// (baixa estes arquivos com barra de progresso; ficam no cache HTTP por 30
// dias) e só pede o pacote de evento quando há festa na ilha. As URLs levam
// as mesmas query strings que o cliente usa (senão o cache não bate).

const BASE_CLIENT = ['club_penguin.swf', 'load.swf', 'shell.swf', 'dependencies.json', 'airtower.swf', 'sentry.swf', 'stamps.swf', 'login.swf', 'engine.swf', 'gridview.swf', 'mail.swf', 'book.swf', 'stampbook.swf', 'buddies.swf', 'rooms_common.swf', 'phone.swf', 'music/Music.swf', 'notifications.swf', 'banning.swf', 'world.swf', 'igloo.swf', 'map.swf', 'puffle_adoption.swf', 'puffle_care.swf', 'penguin.swf', 'interface.swf', 'fonts/en/FontLibrary.swf'];
const BASE_CONTENT = ['global/crumbs/global_crumbs.swf', 'local/en/crumbs/local_crumbs.swf', 'local/en/news/news_crumbs.swf', 'global/content/map_triggers.json', 'global/logo/logo.swf', 'global/content/party.swf', 'global/content/map.swf', 'global/penguin/penguin.swf', 'global/igloo/assets/igloo_background.swf'];
const BASE_CONFIGS = ['game_strings', 'games', 'stamps', 'paths', 'paper_items', 'rooms', 'igloos', 'puffle_items', 'puffles', 'furniture_items', 'newspapers', 'postcards', 'safe_chat_messages', 'mascot_messages', 'tour_guide_messages', 'penguin_action_frames', 'general', 'chunking_map', 'stage_script_messages', 'polaroids', 'cover', 'mascots', 'jokes', 'igloo_floors', 'igloo_locations', 'player_colors'];
const BASE_ROOMS = ['town', 'coffee', 'book', 'dance', 'lounge', 'shop', 'village', 'lodge', 'attic', 'mtn', 'plaza', 'pet', 'dojo', 'dojoext', 'pizza', 'stage', 'beach', 'light', 'beacon', 'dock', 'forts', 'rink', 'forest', 'cove', 'berg', 'cave', 'mine', 'shack', 'boiler', 'party'];

function parseFlashvars(fv) {
  const out = {};
  for (const part of String(fv || '').split('&')) { const [k, v = ''] = part.split('='); if (k) out[k] = v; }
  return out;
}

async function sizeOf(w, route) {
  // tamanho só de arquivos da mídia (os gerados são pequenos)
  try {
    let rel = w.gameData.lookupFile(route);
    if (typeof rel === 'function') rel = rel(w.settings);
    if (!rel) return 0;
    const st = await fs.promises.stat(path.join(process.env.WADDLE_MEDIA_DIR || path.join(process.env.WADDLE_DATA_DIR, 'media'), rel)).catch(() => null);
    return st ? st.size : 0;
  } catch { return 0; }
}

/**
 * Arquivos do "jogo completo" (2012) na data atual: tudo que o cliente AS3
 * serve em /play, menos o que é por demanda e enorme — roupas (650 MB, cada
 * item baixa quando alguém veste) e o arquivo de jornais antigos (170 MB).
 * Devolve [rota, query] já com a query string que o cliente usa.
 */
function completeRoutes(w, q) {
  const out = [];
  for (const route of w.gameData.getAllRoutes().keys()) {
    if (!(route.startsWith('play/v2/') || route.startsWith('playstart/') || route.startsWith('play/start/'))) continue;
    if (route.startsWith('play/v2/content/global/clothing/')) continue;
    if (route.startsWith('play/v2/content/local/') && !route.startsWith('play/v2/content/local/en/')) continue;
    if (route.startsWith('play/v2/content/local/en/news/')) continue;
    const query = route.startsWith('play/v2/client/') ? q.client : route.startsWith('play/v2/content/') ? q.content : route.startsWith('play/v2/games/') ? q.games : route.startsWith('playstart/swf/') ? '?cacheVersion=' : '';
    out.push([route, query]);
  }
  return out;
}

const FRESH_KEY = `${(process.env.GIT_SHA || '').slice(0, 7)}${Date.now().toString(36)}`;

const bundleCache = new Map(); // version → bundles (lista grande; calculada uma vez por versão)

async function getBundles(w) {
  const entry = await getEntry(w);
  const fv = parseFlashvars(entry.flashvars);
  const q = { client: fv.clientVersion ? `?clientVersion=${fv.clientVersion}` : '', content: fv.contentVersion ? `?contentVersion=${fv.contentVersion}` : '', config: fv.configVersion ? `?configVersion=${fv.configVersion}` : '', games: fv.minigameVersion ? `?minigameVersion=${fv.minigameVersion}` : '' };
  const party = entry.party;
  const year = w.settings.settings.version.slice(0, 4);
  // muda só quando o cliente/conteúdo muda de verdade (não a cada festa)
  const version = `${year}|${fv.clientVersion || ''}|${(fv.contentVersion || '').slice(0, party ? -2 : undefined)}|${fv.configVersion || ''}`;
  const cacheKey = `${version}|${party || ''}|${w.settings.settings.version}`;
  if (bundleCache.has(cacheKey)) return bundleCache.get(cacheKey);

  const files = [];
  const seen = new Set();
  const add = async (route, query) => {
    if (seen.has(route) || !w.http.getFileServer().knowsRoute(route)) return;
    // o jornal é traduzido aos poucos (news/): sempre vem do servidor, não do pacote
    if (news.isNewsRoute(route)) return;
    seen.add(route);
    files.push({ url: `/${route}${query}`, size: await sizeOf(w, route) });
  };
  const take = () => files.splice(0);
  let base; let content; let complete;
  if (entry.swf !== '/boots.swf') {
    for (const f of BASE_CLIENT) await add(`play/v2/client/${f}`, q.client);
    for (const f of BASE_CONFIGS) await add(`play/en/web_service/game_configs/${f}.json`, q.config);
    await add('play/web_service/environment_data.xml', q.config);
    await add('playstart/xml/start_module_config.xml', '');
    await add('playstart/swf/start_module.swf', '?cacheVersion=');
    base = take();
    // conteúdo da ilha (crumbs, mapa, salas, catálogos): fora de festa é parte
    // do jogo; em festa muda de versão e vira o pacote do evento
    for (const f of BASE_CONTENT) await add(`play/v2/content/${f}`, q.content);
    for (const r of BASE_ROOMS) await add(`play/v2/content/global/rooms/${r}.swf`, q.content);
    for (const [route, query] of completeRoutes(w, q)) {
      if (/^play\/v2\/content\/(global\/(rooms|crumbs|content|music)|local\/en\/(crumbs|catalogues))\//.test(route)) await add(route, query);
    }
    content = take();
    // o resto do jogo completo (minigames, iglu, puffles, cartões, livros...)
    for (const [route, query] of completeRoutes(w, q)) await add(route, query);
    complete = take();
  } else {
    for (const f of ['boots.swf', 'play/v2/load.swf', 'play/v2/shell/shell.swf', 'play/v2/client/engine.swf', 'play/v2/client/interface.swf', 'play/v2/login/login.swf']) await add(f, '');
    base = take();
    for (const f of ['play/v2/content/global/crumbs/global_crumbs.swf', 'play/v2/content/local/en/crumbs/local_crumbs.swf']) await add(f, '');
    for (const r of BASE_ROOMS) await add(`play/v2/content/global/rooms/${r}.swf`, '');
    content = take();
    complete = [];
  }
  const total = (list) => list.reduce((n, f) => n + f.size, 0);
  // pacote base (instalação única): com festa, o conteúdo da festa fica fora
  // dele (vira o pacote do evento); o resto do jogo completo entra sempre
  const baseList = (party ? base : base.concat(content)).concat(complete);
  const result = {
    version,
    base: { files: baseList, bytes: total(baseList), pack: { url: `/api/plaza/pack/base?v=${encodeURIComponent(cacheKey)}`, files: baseList.length, bytes: total(baseList) } },
    event: party ? { name: partyLabel(party), key: `${party}@${year}`, files: content, bytes: total(content), pack: { url: `/api/plaza/pack/event?v=${encodeURIComponent(cacheKey)}`, files: content.length, bytes: total(content) } } : null,
  };
  bundleCache.clear();
  bundleCache.set(cacheKey, result);
  return result;
}

const MIME = { swf: 'application/x-shockwave-flash', json: 'application/json', xml: 'text/xml', txt: 'text/plain', html: 'text/html', mp3: 'audio/mpeg', png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', css: 'text/css', js: 'text/javascript' };

/**
 * Pacote de instalação: todos os arquivos de um pacote num único fluxo
 * (cabeçalho de 4 bytes + JSON {u,s,t} + bytes, repetido). A página grava
 * cada um no cache do navegador. Um pedido só, em vez de milhares.
 */
async function streamPack(kind, res) {
  const w = await getWaddle();
  const b = await getBundles(w);
  const list = kind === 'event' ? (b.event ? b.event.files : []) : b.base.files;
  const fsrv = w.http.getFileServer();
  const { translateJsonText } = require('../../../waddle/dist/server/i18n/index.js');
  res.status(200).set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Pack-Files': String(list.length), 'X-Pack-Bytes': String(list.reduce((n, f) => n + f.size, 0)) });
  for (const f of list) {
    if (res.destroyed || res.writableEnded) return;
    const route = f.url.slice(1).split('?')[0];
    let body;
    try { body = await fsrv.resolve(route); } catch { body = undefined; }
    if (body === undefined) continue;
    const ext = route.split('.').pop();
    if (ext === 'json') body = translateJsonText(body);
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf-8');
    const head = Buffer.from(JSON.stringify({ u: f.url, s: buf.length, t: MIME[ext] || 'application/octet-stream' }), 'utf-8');
    const len = Buffer.alloc(4); len.writeUInt32BE(head.length, 0);
    const ok = res.write(Buffer.concat([len, head, buf]));
    if (!ok) await new Promise((r) => res.once('drain', r));
  }
  res.end();
}

// ---------------------------------------------------------------------------
// Centro de Download (PracaPage → DownloadCenter): pacotes por categoria.
//
// Cada pacote é uma lista de arquivos com as MESMAS URLs que o jogo pede; a
// página baixa num fluxo só (streamPack) e grava no Cache Storage. `from`
// continua de onde parou (pausar/retomar). As festas de 2013-2017 entram com a
// contentVersion que o jogo vai usar quando cada festa estiver na ilha.

const PACK_INFO = {
  evento: { category: 'evento', name: 'Evento atual', desc: 'Decoração, salas e músicas da festa que está na ilha agora', icon: 'evento' },
  essenciais: { category: 'essenciais', name: 'Jogo base', desc: 'O jogo, a interface e as salas da ilha', icon: 'base' },
  minigames: { category: 'ilha', name: 'Minigames', desc: 'Todos os jogos da ilha (Hydro Hopper, Card-Jitsu, Puffle Rescue…)', icon: 'games' },
  iglus: { category: 'ilha', name: 'Iglus, móveis e puffles', desc: 'Editor de iglu, móveis, pisos e os puffles', icon: 'igloo' },
  extras: { category: 'ilha', name: 'Extras da ilha', desc: 'Cartões-postais, livros, telas especiais e o resto do jogo', icon: 'extras' },
  'roupas-icones': { category: 'roupas', name: 'Ícones das roupas', desc: 'As figurinhas do inventário e dos catálogos', icon: 'icons' },
  'roupas-cartao': { category: 'roupas', name: 'Roupas no cartão', desc: 'Como cada roupa aparece no cartão do pinguim', icon: 'paper' },
  'roupas-pinguim': { category: 'roupas', name: 'Roupas no pinguim', desc: 'Como cada roupa aparece no pinguim andando pela ilha', icon: 'sprites' },
};
const PACK_CATEGORIES = [
  { id: 'evento', name: 'Eventos' },
  { id: 'essenciais', name: 'Essenciais' },
  { id: 'ilha', name: 'Ilha' },
  { id: 'festas', name: 'Festas 2013–2017' },
  { id: 'roupas', name: 'Roupas e itens' },
];
const packCache = new Map();

async function getPacks(w) {
  const entry = await getEntry(w);
  const b = await getBundles(w);
  const fv = parseFlashvars(entry.flashvars);
  const q = { client: fv.clientVersion ? `?clientVersion=${fv.clientVersion}` : '', content: fv.contentVersion ? `?contentVersion=${fv.contentVersion}` : '', config: fv.configVersion ? `?configVersion=${fv.configVersion}` : '', games: fv.minigameVersion ? `?minigameVersion=${fv.minigameVersion}` : '' };
  const key = `${b.version}|${entry.party || ''}|${w.settings.settings.version}`;
  if (packCache.has(key)) return packCache.get(key);
  const packs = new Map();
  const put = (id, files, extra = {}) => {
    if (!files.length) return;
    packs.set(id, { id, ...PACK_INFO[id], ...extra, files, bytes: files.reduce((n, f) => n + (f.size || 0), 0) });
  };
  // essenciais / evento: os mesmos do instalador de sempre
  const baseSet = new Set();
  const complete = [];
  for (const [route, query] of completeRoutes(w, q)) complete.push({ route, url: `/${route}${query}` });
  const completeUrls = new Set(complete.map((f) => f.url));
  const essentials = b.base.files.filter((f) => !completeUrls.has(f.url));
  essentials.forEach((f) => baseSet.add(f.url));
  put('essenciais', essentials);
  if (b.event) put('evento', b.event.files, { name: b.event.name, required: true, key: b.event.key });
  (b.event?.files || []).forEach((f) => baseSet.add(f.url));
  // o resto do jogo completo, por assunto
  const rest = b.base.files.filter((f) => completeUrls.has(f.url) && !baseSet.has(f.url));
  put('minigames', rest.filter((f) => f.url.startsWith('/play/v2/games/')));
  put('iglus', rest.filter((f) => /^\/play\/v2\/(content\/global\/(igloo|furniture|puffle)\/|client\/(igloo|puffle))/.test(f.url)));
  put('extras', rest.filter((f) => !f.url.startsWith('/play/v2/games/') && !/^\/play\/v2\/(content\/global\/(igloo|furniture|puffle)\/|client\/(igloo|puffle))/.test(f.url)));
  // roupas (fora do jogo base: ~650 MB, cada item baixa quando alguém veste)
  const clothing = { icons: [], paper: [], sprites: [] };
  for (const route of w.gameData.getAllRoutes().keys()) {
    const m = route.match(/^play\/v2\/content\/global\/clothing\/(icons|paper|sprites)\//);
    if (m) clothing[m[1]].push({ url: `/${route}${q.content}`, size: await sizeOf(w, route) });
  }
  put('roupas-icones', clothing.icons);
  put('roupas-cartao', clothing.paper);
  put('roupas-pinguim', clothing.sprites);
  // festas 2013-2017: um pacote por ano, com a URL de quando cada festa estiver na ilha
  const parties = require('./parties');
  const byYear = new Map();
  for (const p of parties._data.parties) {
    const cv = `${entry.baseContent}${partyCode(p.name)}`;
    for (const e of parties.downloadEntries(p.slug)) {
      if (!byYear.has(p.year)) byYear.set(p.year, []);
      byYear.get(p.year).push({ url: `/${e.route}?contentVersion=${cv}`, size: e.size, file: e.file });
    }
  }
  for (const [year, files] of [...byYear.entries()].sort((a, c) => a[0] - c[0])) {
    const n = parties._data.parties.filter((p) => p.year === year && Object.keys(p.rooms || {}).length).length;
    PACK_INFO[`festas-${year}`] = { category: 'festas', name: `Festas de ${year}`, desc: `${n} festa${n === 1 ? '' : 's'}: salas decoradas, músicas e mapas`, icon: 'party' };
    put(`festas-${year}`, files);
  }
  // arquivos gerados/consertados pelo servidor não têm tamanho no disco: mede
  // os dos pacotes pequenos (essenciais/evento) pra barra de progresso bater
  const fsrv = w.http.getFileServer();
  for (const id of ['essenciais', 'evento']) {
    const p = packs.get(id);
    if (!p) continue;
    for (const f of p.files) {
      if (f.size) continue;
      try { const body = await fsrv.resolve(f.url.slice(1).split('?')[0]); f.size = body ? Buffer.byteLength(body) : 0; } catch { /* ok */ }
    }
    p.bytes = p.files.reduce((n, f) => n + (f.size || 0), 0);
  }
  const list = [...packs.values()].map((p) => ({ ...p, version: `${p.id}|${p.key || key}|${p.files.length}|${p.bytes}` }));
  const out = { categories: PACK_CATEGORIES, packs: list, party: entry.party ? partyLabel(entry.party) : null };
  packCache.clear();
  packCache.set(key, out);
  return out;
}

/** Resumo dos pacotes pra página (sem a lista de arquivos). */
async function listPacks() {
  const w = await getWaddle();
  const { categories, packs, party } = await getPacks(w);
  return { categories, party, packs: packs.map(({ files, ...rest }) => ({ ...rest, files: files.length })) };
}

/** URLs de um pacote (a página usa pra apagar do cache). */
async function packUrls(id) {
  const w = await getWaddle();
  const p = (await getPacks(w)).packs.find((x) => x.id === id);
  return p ? p.files.map((f) => f.url) : null;
}

/** Fluxo de um pacote do Centro de Download, a partir do arquivo `from`. */
async function streamNamedPack(id, from, res) {
  const w = await getWaddle();
  const p = (await getPacks(w)).packs.find((x) => x.id === id);
  if (!p) { res.status(404).json({ error: 'Pacote não encontrado.' }); return; }
  const start = Math.max(0, Math.min(p.files.length, Number(from) || 0));
  const list = p.files.slice(start);
  const fsrv = w.http.getFileServer();
  const { translateJsonText } = require('../../../waddle/dist/server/i18n/index.js');
  res.status(200).set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Pack-Files': String(list.length), 'X-Pack-Bytes': String(list.reduce((n, f) => n + (f.size || 0), 0)), 'X-Pack-Start': String(start) });
  for (const f of list) {
    if (res.destroyed || res.writableEnded) return;
    const route = f.url.slice(1).split('?')[0];
    let body;
    try { body = f.file ? await fs.promises.readFile(f.file) : await fsrv.resolve(route); } catch { body = undefined; }
    if (body === undefined) body = Buffer.alloc(0); // mantém a contagem (o retomar usa o índice)
    const ext = route.split('.').pop();
    if (ext === 'json' && body.length) body = translateJsonText(body);
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf-8');
    const head = Buffer.from(JSON.stringify({ u: f.url, s: buf.length, t: MIME[ext] || 'application/octet-stream' }), 'utf-8');
    const len = Buffer.alloc(4); len.writeUInt32BE(head.length, 0);
    const ok = res.write(Buffer.concat([len, head, buf]));
    if (!ok) await new Promise((r) => res.once('drain', r));
  }
  res.end();
}

async function getConfig(user) {
  const w = await getWaddle();
  const { id, json } = await ensurePenguin(user);
  const media = mediaState();
  // 'partial' (mídia incompleta sem release configurada) ainda serve o que
  // tem no disco; só as fases de download/extração seguram a página.
  if (['checking', 'downloading', 'extracting'].includes(media.state)) {
    // Primeira inicialização: os arquivos do jogo ainda estão sendo baixados
    // no servidor. Sem entry/ticket — a página espera e pede de novo.
    return { preparing: true, media, penguin: { id, name: json.name, color: json.color, coins: json.coins, member: !!json.is_member }, online: w.world.getAllPlayersInfo().length };
  }
  const entry = await getEntry(w);
  const s = w.settings;
  // Entrada automática do próprio cliente (2012): com nau/nal nas flashvars
  // o shell faz o login sozinho e escolhe o servidor — sem tela de login.
  // A senha é ignorada pelo servidor (o ticket do WebSocket é a credencial).
  let autoEntry = 'synthetic'; // a página "clica" nas telas de login
  if (/(^|&)nau=/.test(entry.flashvars)) {
    entry.flashvars = entry.flashvars.replace(/(^|&)nau=[^&]*/, `$1nau=${encodeURIComponent(json.name)}`).replace(/(^|&)nal=[^&]*/, '$1nal=projectclub').replace(/(^|&)nad=[^&]*/, '$1nad=');
    autoEntry = 'flashvars';
  }
  // Chat livre: com "phrasechat" preenchido o cliente 2012 consulta o serviço
  // de frases da Disney (/social/autocomplete) antes de mandar cada fala — e
  // sem ele a mensagem some. Vazio = chat normal do jogo (a fala passa pelo
  // automod do Project Club no servidor, ver makeTransform).
  entry.flashvars = entry.flashvars.replace(/(^|&)phrasechat=[^&]*/, '$1phrasechat=');
  return {
    entry,
    autoEntry,
    version: s.settings.version,
    as3: !!w.gameData.getAs3(),
    party: entry.party || null,
    partyLabel: partyLabel(entry.party),
    lang: (entry.flashvars.match(/lang=(\w+)/) || [])[1] || 'en',
    stage: { width: 760, height: 480 },
    // Ruffle: host:porta que o SWF tenta abrir → WebSocket do site
    socketProxy: [
      { host: FAKE_IP, port: s.loginPort, path: `${WS_PREFIX}login` },
      { host: FAKE_IP, port: s.worldPort, path: `${WS_PREFIX}world` },
    ],
    penguin: { id, name: json.name, color: json.color, coins: json.coins, member: !!json.is_member },
    online: w.world.getAllPlayersInfo().length,
    media,
    bundles: await getBundles(w),
    ticket: issueTicket(user.id),
    // Arquivos consertados/traduzidos no servidor (interface, shell, jornal)
    // têm a mesma URL do original — e a CDN guardou cópias antigas por até
    // 30 dias. A página pede esses arquivos com ?pcf=<isto>: muda a cada
    // versão do servidor, então nenhuma cópia velha é usada.
    fresh: FRESH_KEY,
  };
}

function mediaState() {
  try { return require('../../../waddle/dist/common/media-store.js').getMediaState(); } catch { return { state: 'error', error: 'servidor do jogo não carregou' }; }
}

async function getStatus() {
  if (!instance) return { ready: false, online: 0, media: mediaState(), error: lastError ? String(lastError.message || lastError) : null };
  const media = mediaState();
  return { ready: media.state === 'ready' || media.state === 'partial', online: instance.world.getAllPlayersInfo().length, version: instance.settings.settings.version, party: instance.gameData.getPartyName ? instance.gameData.getPartyName() : null, partyLabel: partyLabel(instance.gameData.getPartyName ? instance.gameData.getPartyName() : null), media };
}

const getStore = () => store;

// ---------------------------------------------------------------------------
// Voz por proximidade (página da Praça).
//
// O jogo já sabe quem está em qual sala e onde (x,y no palco 760x480). A
// cada ~300 ms cada jogador recebe, pelo Socket.IO do site, a lista de quem
// está NA MESMA SALA com as posições ('praca:presence') — a página usa isso
// pra baixar/subir o volume de cada pessoa na voz da ilha conforme a
// distância entre os pinguins. O chat de texto é o do próprio jogo.

let io = null;
let presenceTimer = null;
const lastPresence = new Map(); // userId -> json enviado por último
const lastRoom = new Map(); // userId -> sala em que estava no último tique
const roomListeners = new Set(); // fn(userId, deSala, praSala) — ex.: jukebox da Danceteria

/** Avisa quando alguém troca de sala (ou sai do jogo: praSala = null). */
function onRoomChange(fn) { roomListeners.add(fn); return () => roomListeners.delete(fn); }
function emitRoomChange(userId, from, to) {
  for (const fn of roomListeners) { try { fn(userId, from, to); } catch (err) { console.error('[praça] troca de sala:', err?.message || err); } }
}

/** Quem está na sala agora: [{ penguinId, userId, name, x, y }]. */
function roomPlayers(room) {
  return presenceByRoom().get(Number(room)) || [];
}
/** Sala do jogador da conta (ou null fora do jogo). */
function roomOfUser(userId) {
  for (const [room, players] of presenceByRoom()) if (players.some((p) => p.userId === userId)) return room;
  return null;
}

function setIo(socketIo) {
  io = socketIo;
  if (presenceTimer) return;
  presenceTimer = setInterval(() => { try { tickPresence(); } catch (err) { console.error('[praça] presença:', err?.message || err); } }, 300);
  presenceTimer.unref?.();
}

function presenceByRoom() {
  if (!instance || !instance.world.getPresence) return new Map();
  const rooms = new Map();
  for (const p of instance.world.getPresence()) {
    const userId = penguinUser.get(p.id) || null;
    const entry = { penguinId: p.id, userId, name: p.name, x: Math.round(p.x), y: Math.round(p.y) };
    if (!rooms.has(p.room)) rooms.set(p.room, []);
    rooms.get(p.room).push(entry);
  }
  return rooms;
}

function tickPresence() {
  if (!io) return;
  const rooms = presenceByRoom();
  const seen = new Set();
  for (const [room, players] of rooms) {
    for (const me of players) {
      if (!me.userId) continue;
      seen.add(me.userId);
      if (lastRoom.get(me.userId) !== room) {
        const from = lastRoom.has(me.userId) ? lastRoom.get(me.userId) : null;
        lastRoom.set(me.userId, room);
        emitRoomChange(me.userId, from, room);
      }
      const payload = { room, me: me.penguinId, players };
      const json = JSON.stringify(payload);
      if (lastPresence.get(me.userId) === json) continue;
      lastPresence.set(me.userId, json);
      io.to(`user:${me.userId}`).emit('praca:presence', payload);
    }
  }
  for (const userId of [...lastRoom.keys()]) {
    if (seen.has(userId)) continue;
    const from = lastRoom.get(userId);
    lastRoom.delete(userId);
    emitRoomChange(userId, from, null);
  }
  for (const userId of [...lastPresence.keys()]) {
    if (seen.has(userId)) continue;
    lastPresence.delete(userId);
    io.to(`user:${userId}`).emit('praca:presence', { room: null, me: null, players: [] });
  }
}

module.exports = { getWaddle, mountHttp, attachUpgrade, getConfig, getStatus, ensurePenguin, cachedRouter, streamPack, listPacks, packUrls, streamNamedPack, getStore, setIo, onRoomChange, roomPlayers, roomOfUser };
