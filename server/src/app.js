const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createRateLimitStore } = require('./config/rateLimitStore');
const { verifyAccessToken } = require('./services/tokens');
const env = require('./config/env');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { timingMiddleware } = require('./middleware/timing');
const { invalidateOnWrite } = require('./services/sharedCache');
const { maskInvisibleResponses } = require('./utils/presenceVisibility');
const { honeypotMiddleware, blockedIpGuard } = require('./middleware/honeypot');
const { getB2Client, isB2Configured } = require('./config/b2');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const friendRoutes = require('./routes/friends');
const testimonialRoutes = require('./routes/testimonials');
const scrapRoutes = require('./routes/scraps');
const fanRoutes = require('./routes/fans');
const rankingRoutes = require('./routes/rankings');
const profileVisitRoutes = require('./routes/profileVisits');
const photoRoutes = require('./routes/photos');
const traitRoutes = require('./routes/traits');
const relationshipRoutes = require('./routes/relationships');
const birthdayRoutes = require('./routes/birthdays');
const profilePollRoutes = require('./routes/profilePolls');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const pollRoutes = require('./routes/polls');
const communityRoutes = require('./routes/community');
const economyRoutes = require('./routes/economy');
const housesRoutes = require('./routes/houses');
const stickersRoutes = require('./routes/stickers');
const missionsRoutes = require('./routes/missions'); // missões diárias/semanais (Economia)
const ticketsRoutes = require('./routes/tickets');
const applicationsRoutes = require('./routes/applications');
const uiEditorRoutes = require('./routes/uiEditor');
const platformRoutes = require('./routes/platform');
const adminRoutes = require('./routes/admin');
const appCatalogRoutes = require('./routes/appCatalog');
// Sistema de Mods (Apps → Mods) — proxy autenticado pro mod.io + dados
// sociais próprios (favoritos, ups, comentários, denúncias). Ver
// services/modioService.js e controllers/modController.js.
const modsRoutes = require('./routes/mods');
const modpacksRoutes = require('./routes/modpacks');
// Steam Workshop (Terraria/tModLoader, Payday 2, Payday 3 etc) — mesma
// ideia do modsRoutes, mas falando com a Steamworks Web API em vez do
// mod.io. Ver services/steamWorkshopService.js.
const workshopRoutes = require('./routes/workshop');
// GameBanana (gamebanana.com) — API semi-oficial, sem login/chave
// nenhuma, cobre vários jogos da Steam (Garry's Mod, GTA San Andreas,
// Half-Life, Left 4 Dead, etc). Ver services/gamebananaService.js.
const gamebananaRoutes = require('./routes/gamebanana');
const nexusRoutes = require('./routes/nexus');
// Thunderstore (thunderstore.io) — repositório de mods usado por jogos
// com BepInEx (Lethal Company, Risk of Rain 2, Content Warning, etc.),
// mesma fonte que ferramentas como o Gale gerenciam — API pública
// própria, sem login/chave. Ver services/thunderstoreService.js.
const thunderstoreRoutes = require('./routes/thunderstore');
const communitiesRoutes = require('./routes/communities');
const postsRoutes = require('./routes/posts');
const achievementsRoutes = require('./routes/achievements');
const systemRoutes = require('./routes/system');
const pushRoutes = require('./routes/push');
const voiceRoutes = require('./routes/voice');
const imageProxyRoutes = require('./routes/imageProxy');
const { servePrecompressed } = require('./middleware/precompressed');
const updatesRoutes = require('./routes/updates');
const eventsRoutes = require('./routes/events');
const activityRoutes = require('./routes/activity');
const gamesLibraryRoutes = require('./routes/games'); // biblioteca de jogos (tempo de jogo)
const decorationsRoutes = require('./routes/decorations');
const supportersRoutes = require('./routes/supporters');
const youtubeRoutes = require('./routes/youtube');
const { requireFeature, isFeatureEnabled } = require('./config/features');
const archiveRoutes = require('./routes/archive');
const catalogRoutes = require('./routes/catalog');
const clansRoutes = require('./routes/clans');
const minigamesRoutes = require('./routes/minigames');

function createApp() {
  const app = express();

  // Square Cloud (and most PaaS providers) sit their own reverse proxy in
  // front of the app, which sets X-Forwarded-For on every request. Without
  // this, Express doesn't know it's behind a trusted proxy and both req.ip
  // and express-rate-limit's per-IP bucketing break (rate-limit throws
  // ERR_ERL_UNEXPECTED_X_FORWARDED_FOR and silently falls back to a shared
  // bucket for everyone). `1` means "trust exactly one hop" — the
  // platform's own proxy — which matches this deployment topology.
  app.set('trust proxy', 1);
  // ETag fraco (padrão do Express, deixado explícito): todo GET de JSON
  // sai com ETag e, se o cliente mandar If-None-Match igual, volta 304 sem
  // corpo — o refresh ao vivo que não mudou nada quase não gasta banda.
  app.set('etag', 'weak');

  // Sistema de segurança "isca" (honeypot) — ver middleware/honeypot.js.
  // blockedIpGuard roda primeiro que QUALQUER outra coisa (antes até do
  // CORS/helmet abaixo), pra um IP já banido nunca chegar perto de rota
  // nenhuma de verdade. honeypotMiddleware vem logo depois, pra pegar
  // scanners tentando /wp-admin, /.env etc antes de cair no 404 normal
  // do app — devolve dado falso em vez de confirmar "essa rota não
  // existe aqui".
  // Server-Timing + log [lento] (> 500ms) — primeiro de tudo, pra medir
  // o tempo inteiro da requisição. Ver middleware/timing.js.
  app.use(timingMiddleware());
  app.use(blockedIpGuard);
  app.use(honeypotMiddleware);

  // Sets a battery of standard security headers (X-Content-Type-Options,
  // X-Frame-Options, HSTS on HTTPS, hides X-Powered-By, etc.), plus a real
  // Content-Security-Policy — this used to be turned off entirely ("would
  // risk breaking styles/scripts"), which meant a stored-XSS bug anywhere
  // in the app (a message, a bio, a server name...) had nothing stopping
  // it from running. Calibrated to what this app actually does, not a
  // generic template:
  //  - script-src 'self' only — the built client itself is one same-origin
  //    bundle with no inline scripts and no third-party scripts loaded at
  //    all (reCAPTCHA was removed by request — see the "remova totalmente
  //    a verificação" item).
  //  - style-src needs 'unsafe-inline' — this app sets a lot of *inline*
  //    style attributes directly (role colors, profile gradients, etc, all
  //    computed per-render), which isn't practical to nonce.
  //  - connect-src covers the app's own API/websocket, the GIF picker
  //    (api.klipy.com — see client/src/components/GifPicker.jsx), and
  //    Google Fonts.
  //  - img-src/media-src allow any https: source, since avatars, custom
  //    emoji, attachments, and GIF results can legitimately point at many
  //    different external hosts.
  // `crossOriginEmbedderPolicy` stays off for the same reason — this
  // legitimately embeds cross-origin media.
  //
  // Jitsi (provedor de voz RESERVA final): quando o servidor de mídia
  // próprio (e as outras reservas) não estão disponíveis, a chamada conecta
  // por uma conferência embutida do Jitsi (IFrame External API). Pra isso o navegador precisa
  // poder: BAIXAR o external_api.js do domínio do Jitsi (script-src) e
  // EMBUTIR a página de reunião num iframe (frame-src). O domínio é
  // configurável (JITSI_DOMAIN, padrão meet.jit.si) — liberamos o padrão e,
  // se configurado outro, ele também. A mídia em si roda DENTRO do iframe
  // (origem do próprio Jitsi), então não precisa de connect-src nosso.
  const jitsiHost = (process.env.JITSI_DOMAIN || 'meet.jit.si').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const jitsiOrigins = [...new Set([`https://${jitsiHost}`, 'https://meet.jit.si', 'https://8x8.vc'])];
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // 'wasm-unsafe-eval': o Ruffle (emulador de Flash dos Mini-Jogos,
        // servido em /ruffle) roda em WebAssembly. Só libera compilar WASM,
        // não libera eval() de JS.
        // YouTube "Assistir juntos" (chamada de voz): IFrame Player API.
        scriptSrc: ["'self'", "'wasm-unsafe-eval'", 'https://www.youtube.com', ...jitsiOrigins],
        scriptSrcElem: ["'self'", 'https://www.youtube.com', ...jitsiOrigins],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        // SDKs de mídia (ex.: LiveKit) e o processamento de áudio rodam
        // parte do trabalho em Web Workers criados a partir de blob: — sem
        // isso liberado explicitamente, o navegador bloqueia em silêncio.
        workerSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        mediaSrc: ["'self'", 'data:', 'blob:', 'https:'],
        // BUG CORRIGIDO: 'stun:'/'turn:'/'turns:' faltavam aqui — o
        // RTCPeerConnection do canal de voz está sujeito ao connect-src
        // igual qualquer outra conexão de rede feita pela página (é o
        // navegador aplicando a CSP na tentativa de contatar os servidores
        // ICE, não uma questão de CORS do servidor STUN/TURN em si). Sem
        // esses esquemas liberados, o CSP bloqueava silenciosamente toda
        // tentativa de contato com STUN/TURN — entrar no canal (via
        // Socket.IO, já coberto por 'wss:'/'ws:' acima) continuava
        // funcionando normal, mas nenhum candidato ICE nunca era coletado,
        // então a chamada nunca tinha como conectar. Isso sozinho já
        // produzia exatamente o sintoma relatado (entra no canal, nunca
        // ouve/é ouvido por ninguém).
        connectSrc: [
          "'self'", 'https://api.klipy.com', 'https://fonts.googleapis.com',
          // Voz: sinalização por wss: (servidor de mídia próprio/LiveKit) e
          // ICE (STUN/TURN) pelos esquemas genéricos logo abaixo.
          'wss:', 'ws:', 'stun:', 'turn:', 'turns:',
        ],
        // Navegador do Project Club no site (quando ligado em
        // config/features.js): páginas que PERMITEM ser abertas dentro de
        // outro site aparecem num iframe isolado. Desligado = só YouTube.
        frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://www.youtube.com', ...jitsiOrigins, ...(isFeatureEnabled('browser') ? ['https:'] : [])],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
  }));

  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
  // Item pedido: otimização/velocidade — o pacote "compression" já
  // estava instalado no projeto (server/package.json) mas nunca tinha
  // sido de fato ligado como middleware. Sem isso, toda resposta JSON
  // da API (lista de mensagens, posts, notificações...) saía sem
  // nenhuma compressão — em conexões mais lentas/celular, isso é uma
  // fatia e tanto de tempo de carregamento jogada fora à toa. `filter`
  // customizado evita comprimir o que já é binário/comprimido (imagens
  // já servidas via proxy, por exemplo) — comprimir de novo algo que
  // já não comprime desperdiça CPU sem ganhar nada.
  app.use(compression({
    filter: (req, res) => {
      if (req.path.startsWith('/api/proxy/')) return false;
      return compression.filter(req, res);
    },
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  // Otimização (item pedido): em produção não loga request de arquivo
  // estático (assets com hash, uploads, emoji, sons, minijogos, polling do
  // Socket.IO) nem respostas 304 (cache validado) — cada linha "combined"
  // é escrita síncrona no stdout, e com muita gente isso vira I/O e CPU
  // gastos à toa (eram a maioria absoluta das linhas). As requests da API
  // continuam logadas iguais, que é o que serve pra depurar.
  const LOG_SKIP = /^\/(assets|uploads|emoji-sets|sounds|minigames|ruffle|socket\.io|favicon\.ico|manifest\.webmanifest|robots\.txt|sw\.js)\b/;
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    skip: (req, res) => env.NODE_ENV === 'production' && (res.statusCode === 304 || LOG_SKIP.test(req.path)),
  }));

  // Blanket ceiling across the whole API, on top of the tighter per-route
  // limiters (auth/login) applied below — mitigates scripted abuse/DoS
  // against any endpoint, not just auth.
  //
  // Bug fix: this used to also cover /api/auth/* — since it's one shared
  // bucket per IP across every /api route, a runaway client-side loop
  // hammering some OTHER endpoint (e.g. GET /api/servers firing hundreds
  // of times a second from a stuck effect) could exhaust the whole 600
  // budget and then make login/refresh/register 429 too, for anyone on
  // that IP — looking exactly like "got logged out and can't log back in"
  // even though their credentials were fine the whole time. Auth already
  // has its own, much tighter limiters (see routes/auth.js's authLimiter/
  // loginLimiter) that make sense for auth specifically; this blanket one
  // no longer piles on top of them. /platform/status is skipped too since
  // that's what tells the client whether to even show the login page vs a
  // maintenance screen — it needs to always be reachable.
  // Bug fix: this used to be ONE blanket limit covering every single /api
  // request — GET included. That meant a burst of message-sending (the
  // actual thing worth throttling) also ate into the exact same budget as
  // just scrolling/loading channels, and once exhausted, someone couldn't
  // even *view* messages anymore, only actually stopping them from
  // spamming for a few of those minutes. Split into two tiers instead:
  // reads (GET — browsing, loading history, checking for updates) get a
  // much more generous ceiling since they're not what spam protection is
  // actually for, while writes (POST/PUT/PATCH/DELETE — sending messages,
  // creating channels, reacting, etc) keep a tighter one, since that's the
  // traffic a real spam burst is actually made of.
  // Tempo real: o cliente agora re-sincroniza a tela aberta a cada 11s
  // (só com a aba visível — ver client/src/utils/liveRefresh.js), uns
  // ~6-10 GETs por tick. 1500 ficava apertado pra quem divide IP (casa,
  // escola); 4000 cobre isso com folga e ainda barra loop descontrolado.
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000, max: 4000, standardHeaders: true, legacyHeaders: false,
    store: createRateLimitStore('reads'),
    skip: (req) => req.method !== 'GET' || req.path.startsWith('/auth') || req.path === '/platform/status',
  }));
  // Escritas: a chave é a CONTA quando dá pra identificar (token válido no
  // Authorization) — antes era por IP, e uma casa/escola inteira dividia
  // os mesmos 400. "Marcar como lido" (canal/DM) também não conta mais:
  // é disparado sozinho ao abrir/rolar o chat e esgotava o limite à toa
  // (o próprio markRead já agrupa as gravações no servidor).
  const READ_MARK_RE = /^\/(conversations\/[^/]+\/read|community\/channels\/[^/]+\/read)$/;
  const userOrIpKey = (req) => {
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      try {
        const payload = verifyAccessToken(header.slice(7));
        if (payload?.sub) return `u:${payload.sub}`;
      } catch { /* token inválido/expirado: cai pro IP */ }
    }
    return `ip:${req.ip}`;
  };
  // Teto próprio (bem folgado) só pros "marcar como lido".
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000, max: 3000, standardHeaders: false, legacyHeaders: false,
    store: createRateLimitStore('readmarks'),
    skip: (req) => !(req.method === 'POST' && READ_MARK_RE.test(req.path)),
    keyGenerator: userOrIpKey,
  }));
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000, max: 400, standardHeaders: true, legacyHeaders: false,
    store: createRateLimitStore('writes'),
    skip: (req) => req.method === 'GET' || req.path.startsWith('/auth') || req.path === '/platform/status'
      || (req.method === 'POST' && READ_MARK_RE.test(req.path)),
    keyGenerator: userOrIpKey,
  }));

  app.use('/uploads', express.static(path.resolve(__dirname, '../', env.UPLOAD_DIR), {
    setHeaders: (res, filePath) => {
      // Defense in depth: uploads are already filtered by mimetype at write
      // time (see middleware/upload.js), but this makes sure that even a
      // file that somehow slips through — or was uploaded before that filter
      // existed — can't execute in-browser (e.g. an HTML/SVG file with an
      // embedded <script>) when someone opens its /uploads URL directly.
      // Only the small set of types the UI actually renders inline
      // (images/video/audio) are left as inline; everything else forces a
      // download instead.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (!/\.(png|jpe?g|gif|webp|mp4|webm|mov|mp3|wav|ogg)$/i.test(filePath)) {
        res.setHeader('Content-Disposition', 'attachment');
      }
      // Cada upload ganha um nome novo (UUID — ver fileStorage.js), então
      // o navegador pode guardar em cache: sem isso, toda foto/anexo era
      // revalidado a cada carregamento. O conteúdo de um nome nunca muda
      // (arquivo novo = UUID novo), então pode ser immutable (1 ano).
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));

  // BUG CORRIGIDO ("imagens não aparecem com VPN" + "carregamento mais
  // rápido"): antes, toda foto/insígnia/anexo apontava direto pro domínio
  // do Backblaze B2 (f005.backblazeb2.com) — um domínio de terceiro que
  // várias VPNs/redes corporativas/DNS de bloqueio de anúncios tratam como
  // "CDN desconhecido" e derrubam silenciosamente, mesmo o site principal
  // carregando normal. Essa rota busca o arquivo no B2 POR TRÁS do nosso
  // próprio servidor e entrega pelo MESMO domínio do site
  // (projectclub.squareweb.app/media/<chave>) — o navegador nunca precisa
  // falar direto com o B2, então nenhum bloqueio de domínio de terceiro
  // consegue impedir a imagem de aparecer. De brinde, isso também acelera
  // o carregamento: `Cache-Control: immutable` é seguro aqui porque cada
  // chave é um UUID gerado uma vez (ver fileStorage.js) — o mesmo arquivo
  // nunca muda de conteúdo, só um arquivo NOVO ganha uma chave nova, então
  // o navegador pode guardar em cache local por 1 ano sem nunca servir
  // algo desatualizado, e visitas seguintes nem precisam baixar de novo.
  app.get('/media/:key', async (req, res) => {
    if (!isB2Configured()) return res.status(404).end();
    try {
      const client = getB2Client();
      const result = await client.send(new GetObjectCommand({ Bucket: env.B2_BUCKET, Key: req.params.key }));
      // SEGURANÇA (auditoria de upload/storage): essa rota é quem serve
      // TUDO em produção (B2 configurado) — avatares, banners, anexos de
      // mensagem — e não tinha a mesma proteção que a rota /uploads (modo
      // sem B2) já tinha. Content-Type aqui vem do que foi validado por
      // magic bytes no upload (ver middleware/upload.js), não mais do
      // que o navegador declarou — mas mesmo assim, nosniff + forçar
      // download pra qualquer coisa que não seja mídia renderizável é
      // uma segunda camada: garante que o navegador nunca tenta
      // "adivinhar" o tipo real do arquivo e executá-lo (ex: um HTML
      // disfarçado que de alguma forma tenha passado pelo filtro).
      const contentType = result.ContentType || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const INLINE_SAFE_RE = /^(image\/(png|jpe?g|gif|webp)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp3|wav|ogg|webm|aac|mp4|x-m4a))$/i;
      if (!INLINE_SAFE_RE.test(contentType)) {
        res.setHeader('Content-Disposition', 'attachment');
      }
      if (result.ContentLength) res.setHeader('Content-Length', result.ContentLength);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      result.Body.pipe(res);
    } catch (err) {
      res.status(404).end();
    }
  });

  // Escrita bem-sucedida em comunidade/perfil/staff/eventos/layout apaga
  // o cache compartilhado do carregamento (ver services/sharedCache.js).
  app.use('/api', invalidateOnWrite);
  // Status "invisível" nunca sai pra outra pessoa: toda resposta da API
  // passa por maskDeep (INVISIBLE -> OFFLINE em quem não é você). Ver
  // utils/presenceVisibility.js.
  app.use('/api', maskInvisibleResponses);

  app.get('/api/health', (req, res) => res.json({ ok: true, env: env.NODE_ENV }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/friends', friendRoutes);
  // Item pedido: sistemas estilo Orkut.
  app.use('/api/testimonials', testimonialRoutes);
  app.use('/api/scraps', scrapRoutes);
  app.use('/api/fans', fanRoutes);
  app.use('/api/rankings', rankingRoutes);
  app.use('/api/profile-visits', profileVisitRoutes);
  app.use('/api/photos', photoRoutes);
  app.use('/api/traits', traitRoutes);
  app.use('/api/relationships', relationshipRoutes);
  app.use('/api/birthdays', birthdayRoutes);
  app.use('/api/profile-polls', profilePollRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/polls', pollRoutes);
  app.use('/api/community', communityRoutes);
  app.use('/api/economy', economyRoutes);
  app.use('/api/houses', housesRoutes);
  app.use('/api/stickers', stickersRoutes);
  app.use('/api/missions', missionsRoutes);
  app.use('/api/tickets', ticketsRoutes);
  app.use('/api/applications', applicationsRoutes);
  app.use('/api/ui-layout', uiEditorRoutes);
  app.use('/api/platform', platformRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/app-catalog', appCatalogRoutes);
  app.use('/api/mods', modsRoutes);
  app.use('/api/modpacks', modpacksRoutes);
  app.use('/api/workshop', workshopRoutes);
  app.use('/api/gamebanana', gamebananaRoutes);
  app.use('/api/nexus', nexusRoutes);
  app.use('/api/thunderstore', thunderstoreRoutes);
  // Fusão com o Reddit clone (fase 1) — "/api/community" (singular) já é a
  // comunidade única existente da plataforma, por isso essas novas rotas
  // (comunidades tipo subreddit, dentro delas) usam nomes no plural.
  app.use('/api/communities', communitiesRoutes);
  app.use('/api/posts', postsRoutes);
  app.use('/api/achievements', achievementsRoutes);
  app.use('/api/system', systemRoutes);
  // Atualizações do app Android (ver docs/android-updates.md).
  app.use('/api/mobile', require('./routes/mobile'));
  app.use('/api/push', pushRoutes);
  app.use('/api/voice', voiceRoutes);
  // Sem requireAuth de propósito — <img src="..."> do navegador nunca
  // manda o cabeçalho Authorization (só fetch/axios conseguem fazer
  // isso), então colocar autenticação aqui quebraria TODA imagem do
  // site. Isso não reduz segurança nenhuma: as URLs do B2 que isso
  // substitui já eram públicas (qualquer um com o link já conseguia ver
  // a imagem direto), só ficou um passo a mais no meio agora.
  app.use('/api/proxy', imageProxyRoutes);
  app.use('/api/unfurl', require('./routes/unfurl'));
  app.use('/api/updates', updatesRoutes);
  app.use('/api/events', eventsRoutes);
  // Links bonitos (/canal/<nome>, /perfil/<@>...): resolve endereço → id.
  app.use('/api/links', require('./routes/links'));
  // Avisos pessoais salvos e Galeria (curtidas/álbuns).
  app.use('/api/notices', require('./routes/notices'));
  app.use('/api/reminders', require('./routes/reminders'));
  app.use('/api/notification-overrides', require('./routes/notificationOverrides'));
  app.use('/api/gallery', require('./routes/gallery'));
  app.use('/api/activity', activityRoutes);
  app.use('/api/games', gamesLibraryRoutes);
  app.use('/api/decorations', decorationsRoutes);
  app.use('/api/supporters', supportersRoutes);
  app.use('/api/youtube', youtubeRoutes);
  // Filmes e Séries e Navegador: desligados no código (config/features.js),
  // respondem 404 sem carregar nada; o código fica guardado pra religar.
  app.use('/api/archive', requireFeature('cinema'), archiveRoutes);
  app.use('/api/catalog', requireFeature('cinema'), catalogRoutes);
  app.use('/api/browser', requireFeature('browser'), require('./routes/browser'));
  app.use('/api/clans', clansRoutes);
  app.use('/api/minigames', minigamesRoutes);
  app.use('/api/anuncios', require('./routes/staffAnnouncements'));
  app.use('/api/section-badges', require('./routes/sectionBadges'));
  // Guerra das Cartas: desligada temporariamente no código (config/features.js)
  // — 503 antes de carregar o router (nem a varredura de turnos liga).
  app.use('/api/cards', requireFeature('cardsWar', { status: 503, message: require('./config/features').CARDS_WAR_OFF_MSG }), require('./routes/cards'));
  // Pacote de abertura (várias seções numa requisição só) — ver bootstrapController.
  app.get('/api/bootstrap', require('./middleware/auth').requireAuth, require('./controllers/bootstrapController').getBootstrap);
  // Primeiros passos (checklist com moedas + tour) e painel de saúde/backup da staff.
  app.use('/api/onboarding', require('./routes/onboarding'));
  app.use('/api/staff-ops', require('./routes/staffOps'));

  // In production, serve the built React client from a single process
  // (this is what SquareCloud runs — one MAIN process, one port).
  const clientDist = path.resolve(__dirname, '../../client/dist');
  // Cache do site: os arquivos em /assets têm o hash do conteúdo no nome
  // (o Vite gera um nome novo a cada mudança), então podem ficar em cache
  // por 1 ano sem nunca ficar desatualizados — o app (inclusive o de
  // desktop) não baixa de novo JS/CSS/imagens a cada abertura. O
  // index.html sempre revalida (no-cache), pra versão nova chegar na hora.
  const staticCacheHeader = (filePath) => {
    if (/[\\/]assets[\\/]/.test(filePath)) return 'public, max-age=31536000, immutable';
    if (filePath.endsWith('.html')) return 'no-cache';
    // version.json: o site pergunta de tempos em tempos "tem versão nova?"
    // (aviso "Nova versão disponível") — nunca pode vir de cache.
    if (/[\\/]version\.json$/.test(filePath)) return 'no-store, max-age=0';
    // Service worker e manifest: o navegador precisa ver a versão nova logo.
    if (/[\\/](sw\.js|manifest\.webmanifest)$/.test(filePath)) return 'no-cache';
    // Pacotes de emoji, sons e arquivos dos Mini-Jogos (menos os .html,
    // que caem no no-cache acima): nome fixo, mudam raramente — 1 dia.
    if (/[\\/](emoji-sets|sounds|minigames|ruffle|loja)[\\/]/.test(filePath)) return 'public, max-age=86400';
    return null;
  };
  // Otimização (item pedido): assets PRÉ-COMPRIMIDOS no build
  // (client/scripts/precompress.js gera um .br e um .gz ao lado de cada
  // js/css/svg/json/wasm). Em vez de o middleware `compression` gastar
  // CPU gzipando o mesmo arquivo a cada request, entregamos o já
  // comprimido direto do disco — brotli quando o navegador aceita (menor
  // que gzip), gzip como reserva. Sem o arquivo .br/.gz, cai no
  // express.static normal (e no gzip na hora) como antes.
  app.use(servePrecompressed(clientDist, staticCacheHeader));
  app.use(express.static(clientDist, {
    setHeaders: (res, filePath) => {
      const cc = staticCacheHeader(filePath);
      if (cc) res.setHeader('Cache-Control', cc);
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDist, 'index.html'), (err) => { if (err) next(); });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
