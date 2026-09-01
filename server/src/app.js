const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { createRateLimitStore } = require('./config/rateLimitStore');
const env = require('./config/env');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { honeypotMiddleware, blockedIpGuard } = require('./middleware/honeypot');
const { getB2Client, isB2Configured } = require('./config/b2');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const friendRoutes = require('./routes/friends');
const testimonialRoutes = require('./routes/testimonials');
const scrapRoutes = require('./routes/scraps');
const fanRoutes = require('./routes/fans');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const pollRoutes = require('./routes/polls');
const communityRoutes = require('./routes/community');
const economyRoutes = require('./routes/economy');
const housesRoutes = require('./routes/houses');
const stickersRoutes = require('./routes/stickers');
const ticketsRoutes = require('./routes/tickets');
const applicationsRoutes = require('./routes/applications');
const uiEditorRoutes = require('./routes/uiEditor');
const platformRoutes = require('./routes/platform');
const adminRoutes = require('./routes/admin');
const communitiesRoutes = require('./routes/communities');
const postsRoutes = require('./routes/posts');
const achievementsRoutes = require('./routes/achievements');
const systemRoutes = require('./routes/system');
const pushRoutes = require('./routes/push');
const agoraRoutes = require('./routes/agora');
const imageProxyRoutes = require('./routes/imageProxy');
const updatesRoutes = require('./routes/updates');

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

  // Sistema de segurança "isca" (honeypot) — ver middleware/honeypot.js.
  // blockedIpGuard roda primeiro que QUALQUER outra coisa (antes até do
  // CORS/helmet abaixo), pra um IP já banido nunca chegar perto de rota
  // nenhuma de verdade. honeypotMiddleware vem logo depois, pra pegar
  // scanners tentando /wp-admin, /.env etc antes de cair no 404 normal
  // do app — devolve dado falso em vez de confirmar "essa rota não
  // existe aqui".
  app.use(blockedIpGuard);
  app.use(honeypotMiddleware);

  // Sets a battery of standard security headers (X-Content-Type-Options,
  // X-Frame-Options, HSTS on HTTPS, hides X-Powered-By, etc.), plus a real
  // Content-Security-Policy — this used to be turned off entirely ("would
  // risk breaking styles/scripts"), which meant a stored-XSS bug anywhere
  // in the app (a message, a bio, a server name...) had nothing stopping
  // it from running. Calibrated to what this app actually does, not a
  // generic template:
  //  - script-src 'self' plus Google's own recaptcha domains — the built
  //    client itself is one same-origin bundle with no inline scripts, the
  //    only third-party script this app loads at all is reCAPTCHA v3 (see
  //    client/src/utils/recaptcha.js), and only when a site key is
  //    actually configured.
  //  - style-src needs 'unsafe-inline' — this app sets a lot of *inline*
  //    style attributes directly (role colors, profile gradients, etc, all
  //    computed per-render), which isn't practical to nonce.
  //  - connect-src covers the app's own API/websocket, the GIF picker
  //    (api.klipy.com — see client/src/components/GifPicker.jsx), Google
  //    Fonts, and reCAPTCHA's own verification calls.
  //  - frame-src allows reCAPTCHA's own (invisible) challenge iframe.
  //  - img-src/media-src allow any https: source, since avatars, custom
  //    emoji, attachments, and GIF results can legitimately point at many
  //    different external hosts.
  // `crossOriginEmbedderPolicy` stays off for the same reason — this
  // legitimately embeds cross-origin media.
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // BUG CORRIGIDO: "Refused to execute inline script (script-src-elem)"
        // — o próprio script do Google (recaptcha/api.js, ver
        // client/src/utils/recaptcha.js) injeta um pequeno <script> inline
        // na página pra terminar de se inicializar; sem esse hash explícito
        // (é o mesmo que o Chrome sugeriu no erro) o CSP bloqueava esse
        // script inline. É gerado sempre igual pelo próprio Google (não
        // depende de nada dinâmico desta página), então o hash é estável —
        // liberar só ele é mais seguro que 'unsafe-inline' (que liberaria
        // QUALQUER script inline, inclusive um injetado por XSS).
        // 'wasm-unsafe-eval' removido — só existia pro RNNoise (redução de
        // ruído do canal de voz, rodava via WebAssembly/AudioWorklet), que
        // foi removido por completo do sistema de voz. Sem nenhum outro
        // WASM no projeto, essa permissão só ficaria aberta à toa.
        // BUG CORRIGIDO DE VEZ ("hash muda toda hora, sempre um
        // navegador diferente bloqueado"): a causa raiz era o script do
        // Google (recaptcha/api.js) ser carregado SEM idioma fixo — o
        // Google detecta o idioma do navegador de cada visitante e serve
        // um pacote diferente por idioma, cada um com um hash SHA-256
        // diferente pro <script> inline que ele injeta sozinho. Isso
        // significa que esse hash NUNCA teria fim — sempre apareceria um
        // idioma novo não coberto. A correção de verdade foi em
        // utils/recaptcha.js: forçar "hl=pt-BR" no carregamento do
        // script, fazendo TODO mundo (não importa o idioma do navegador)
        // sempre receber o MESMO pacote — daqui pra frente só existe UM
        // hash de verdade. Os hashes antigos ficam só como transição
        // (cobrem quem ainda tem a versão de JS antiga em cache).
        scriptSrc: [
          "'self'",
          "'sha256-jAqbMQnElBz/iSQ8cCTZfa8xKxguIXKuhiyFWJDytDw='",
          "'sha256-ZHvsZ0yrFu4ps+iqJKRCcUdZVhxvyI7coQ2Q12nUe04='",
          "'sha256-zpE07RWenMqP9vyL/VdTzx38ZyLrGgjd6KjHdVkPaoQ='",
          'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/',
        ],
        scriptSrcElem: [
          "'self'",
          "'sha256-jAqbMQnElBz/iSQ8cCTZfa8xKxguIXKuhiyFWJDytDw='",
          "'sha256-ZHvsZ0yrFu4ps+iqJKRCcUdZVhxvyI7coQ2Q12nUe04='",
          "'sha256-zpE07RWenMqP9vyL/VdTzx38ZyLrGgjd6KjHdVkPaoQ='",
          'https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        // Item pedido (migração pro Agora.io): o SDK deles roda parte do
        // processamento de áudio (cancelamento de eco etc) dentro de Web
        // Workers, criados a partir de blob: — sem isso liberado
        // explicitamente, o navegador bloqueia silenciosamente e a
        // chamada nunca chega a conectar de verdade.
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
          "'self'", 'https://api.klipy.com', 'https://fonts.googleapis.com', 'https://www.google.com',
          // Agora.io (chamadas de voz) — domínios reais deles pra
          // sinalização/relatório de qualidade via HTTPS; a mídia em si
          // (áudio) já passa pelos wss:/turn: genéricos logo abaixo.
          'https://*.agora.io', 'https://*.sd-rtn.com',
          'wss:', 'ws:', 'stun:', 'turn:', 'turns:',
        ],
        frameSrc: ["'self'", 'https://www.google.com/recaptcha/'],
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
      if (req.path.startsWith('/api/proxy/image')) return false;
      return compression.filter(req, res);
    },
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

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
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000, max: 1500, standardHeaders: true, legacyHeaders: false,
    store: createRateLimitStore('reads'),
    skip: (req) => req.method !== 'GET' || req.path.startsWith('/auth') || req.path === '/platform/status',
  }));
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000, max: 400, standardHeaders: true, legacyHeaders: false,
    store: createRateLimitStore('writes'),
    skip: (req) => req.method === 'GET' || req.path.startsWith('/auth') || req.path === '/platform/status',
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

  app.get('/api/health', (req, res) => res.json({ ok: true, env: env.NODE_ENV }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/friends', friendRoutes);
  // Item pedido: sistemas estilo Orkut.
  app.use('/api/testimonials', testimonialRoutes);
  app.use('/api/scraps', scrapRoutes);
  app.use('/api/fans', fanRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/polls', pollRoutes);
  app.use('/api/community', communityRoutes);
  app.use('/api/economy', economyRoutes);
  app.use('/api/houses', housesRoutes);
  app.use('/api/stickers', stickersRoutes);
  app.use('/api/tickets', ticketsRoutes);
  app.use('/api/applications', applicationsRoutes);
  app.use('/api/ui-layout', uiEditorRoutes);
  app.use('/api/platform', platformRoutes);
  app.use('/api/admin', adminRoutes);
  // Fusão com o Reddit clone (fase 1) — "/api/community" (singular) já é a
  // comunidade única existente da plataforma, por isso essas novas rotas
  // (comunidades tipo subreddit, dentro delas) usam nomes no plural.
  app.use('/api/communities', communitiesRoutes);
  app.use('/api/posts', postsRoutes);
  app.use('/api/achievements', achievementsRoutes);
  app.use('/api/system', systemRoutes);
  app.use('/api/push', pushRoutes);
  app.use('/api/agora', agoraRoutes);
  // Sem requireAuth de propósito — <img src="..."> do navegador nunca
  // manda o cabeçalho Authorization (só fetch/axios conseguem fazer
  // isso), então colocar autenticação aqui quebraria TODA imagem do
  // site. Isso não reduz segurança nenhuma: as URLs do B2 que isso
  // substitui já eram públicas (qualquer um com o link já conseguia ver
  // a imagem direto), só ficou um passo a mais no meio agora.
  app.use('/api/proxy', imageProxyRoutes);
  app.use('/api/updates', updatesRoutes);

  // In production, serve the built React client from a single process
  // (this is what SquareCloud runs — one MAIN process, one port).
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(path.join(clientDist, 'index.html'), (err) => { if (err) next(); });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
