// Processo do Club Penguin offline (ver ../pracaOffline.js). Roda como
// utilityProcess do Electron (ambiente Node), separado da janela: sobe o
// Waddle Forever embutido (dist em PC_OFFLINE_WADDLE) com os pinguins em
// arquivo, importa a cópia do pinguim da conta (PC_OFFLINE_SNAPSHOT) e serve
// em 127.0.0.1, numa porta livre:
//
//   /pc-offline/praca.html   página do jogo (Ruffle de PC_OFFLINE_RUFFLE)
//   /pc-offline/config       o que a página precisa (SWF de entrada, flashvars,
//                            socketProxy, pinguim, estado da mídia)
//   /pc-offline/status       mídia + quantos pinguins online (= 1)
//   /ruffle/*                emulador
//   /*                       arquivos e "PHP" do jogo (router do Waddle)
//   ws://…/waddle/ws/login|world   login e mundo (Ruffle → socketProxy)
//
// Variáveis: WADDLE_DATA_DIR, WADDLE_MEDIA_DIR, WADDLE_CALENDAR_YEAR,
// PC_OFFLINE_WADDLE, PC_OFFLINE_RUFFLE, PC_OFFLINE_SNAPSHOT.
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');

// Raiz do Waddle embutido: <raiz>/dist (código), <raiz>/node_modules (express,
// ws, dotenv — vendor/waddle gerado por scripts/prepare-waddle.js). Rodando do
// código-fonte sem o vendor, a raiz é server/waddle e as dependências estão
// em server/node_modules.
const WADDLE_ROOT = process.env.PC_OFFLINE_WADDLE;
const WADDLE = WADDLE_ROOT ? path.join(WADDLE_ROOT, 'dist') : null;
function dep(name) {
  const paths = WADDLE_ROOT ? [WADDLE_ROOT, path.join(WADDLE_ROOT, '..')] : [];
  try { return require(require.resolve(name, { paths: [...paths, __dirname] })); } catch { return require(name); }
}

const RUFFLE = process.env.PC_OFFLINE_RUFFLE;
const SNAPSHOT = process.env.PC_OFFLINE_SNAPSHOT;
const WS_PREFIX = '/waddle/ws/';
const FAKE_IP = '127.0.0.1';
const FAKE_HTTP_PORT = 24105;

const parent = process.parentPort;
const send = (msg) => { try { parent?.postMessage(msg); } catch { /* pai fechou */ } };
const log = (m) => console.log(`[praça offline] ${m}`);

function fail(error) {
  console.error(`[praça offline] ${error}`);
  send({ type: 'error', error: String(error && error.message ? error.message : error) });
  setTimeout(() => process.exit(1), 50);
}

process.on('uncaughtException', (err) => fail(err));
process.on('unhandledRejection', (err) => fail(err));

if (!WADDLE_ROOT || !RUFFLE || !SNAPSHOT) fail('faltou PC_OFFLINE_WADDLE / PC_OFFLINE_RUFFLE / PC_OFFLINE_SNAPSHOT');

const express = dep('express');
const WebSocket = dep('ws');

const req = (rel) => require(path.join(WADDLE, rel));

/** Copia o pinguim do arquivo da conta pro repositório em arquivos do jogo. */
function importSnapshot() {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  if (snap.format !== 'projectclub-praca-offline' || !snap.penguin?.id || !snap.penguin?.data) throw new Error('cópia do pinguim inválida');
  const dir = path.join(process.env.WADDLE_DATA_DIR, 'penguins');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${snap.penguin.id}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snap.penguin.data));
  fs.renameSync(tmp, file);
  return { id: Number(snap.penguin.id), json: snap.penguin.data, user: snap.user || null, game: snap.game || null };
}

function partyCode(party) {
  if (!party) return '';
  let h = 7;
  for (const ch of String(party)) h = (h * 31 + ch.charCodeAt(0)) % 90;
  return String(10 + h);
}

/** SWF de entrada + flashvars (igual a server/src/services/waddle/index.js getEntry). */
async function getEntry(w) {
  const html = await w.http.getFileServer().resolve('');
  const text = typeof html === 'string' ? html : html ? html.toString('utf-8') : '';
  const data = text.match(/<object[^>]*\sdata="([^"]+)"/i);
  const flashvars = text.match(/name="flashvars"\s+value="([^"]*)"/i);
  let fv = flashvars ? flashvars[1] : 'lang=en';
  const party = w.gameData.getPartyName ? w.gameData.getPartyName() : null;
  if (party) fv = fv.replace(/(contentVersion=)(\d+)/, (_, k, v) => `${k}${v}${partyCode(party)}`);
  return { swf: data ? data[1] : '/boots.swf', flashvars: fv, party };
}

// Identidade forçada: o que a página digita no login não importa — é sempre o
// pinguim da conta (mesma regra do servidor, sem a moderação de chat, que
// aqui não tem com quem falar).
function makeTransform(penguinName, penguinId) {
  return async (packet) => {
    if (packet.startsWith('<') && (packet.includes("action='login'") || packet.includes('action="login"'))) {
      const sent = (packet.match(/<nick><!\[CDATA\[([\s\S]*?)\]\]><\/nick>/) || [])[1] || '';
      const identity = /^\d+$/.test(sent.trim()) ? String(penguinId) : penguinName;
      return packet
        .replace(/<nick><!\[CDATA\[[\s\S]*?\]\]><\/nick>/, `<nick><![CDATA[${identity}]]></nick>`)
        .replace(/<pword><!\[CDATA\[[\s\S]*?\]\]><\/pword>/, '<pword><![CDATA[projectclub]]></pword>');
    }
    return packet;
  };
}

async function main() {
  const penguin = importSnapshot();
  const { createWaddle } = req('server/boot.js');
  const { FilePenguinRepository } = req('server/database/database.js');
  const media = req('common/media-store.js');

  const db = new FilePenguinRepository(process.env.WADDLE_DATA_DIR);
  const w = await createWaddle({ db, targetIP: FAKE_IP, targetPort: FAKE_HTTP_PORT });
  log(`Club Penguin ${w.settings.settings.version} pronto — pinguim "${penguin.json.name}" (#${penguin.id})`);

  // Mídia: confere o disco; se faltar, baixa da release do GitHub (internet,
  // sem precisar do servidor do Project Club). Não segura o resto.
  let mediaState = media.getMediaState();
  const pushMedia = () => { const st = media.getMediaState(); if (JSON.stringify(st) !== JSON.stringify(mediaState)) { mediaState = st; send({ type: 'media', media: st }); } };
  media.ensureMedia((msg) => log(msg)).then(pushMedia).catch((err) => log(`mídia: ${err?.message || err}`));
  setInterval(pushMedia, 1500).unref();

  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.get('/pc-offline/config', async (_req, res) => {
    try {
      const st = media.getMediaState();
      const base = { penguin: { id: penguin.id, name: penguin.json.name, color: penguin.json.color, coins: penguin.json.coins, member: !!penguin.json.is_member }, user: penguin.user, media: st, online: w.world.getAllPlayersInfo().length, offline: true };
      if (['checking', 'downloading', 'extracting'].includes(st.state)) return res.json({ ...base, preparing: true });
      let entry;
      try { entry = await getEntry(w); } catch (err) {
        // Mídia incompleta e sem como baixar (sem internet / release fora):
        // a página explica e oferece tentar de novo (reinicia o processo —
        // a conferência/baixa da mídia só roda uma vez por processo).
        return res.json({ ...base, needsMedia: true, error: err?.message || String(err) });
      }
      let autoEntry = 'synthetic';
      if (/(^|&)nau=/.test(entry.flashvars)) {
        entry.flashvars = entry.flashvars.replace(/(^|&)nau=[^&]*/, `$1nau=${encodeURIComponent(penguin.json.name)}`).replace(/(^|&)nal=[^&]*/, '$1nal=projectclub').replace(/(^|&)nad=[^&]*/, '$1nad=');
        autoEntry = 'flashvars';
      }
      entry.flashvars = entry.flashvars.replace(/(^|&)phrasechat=[^&]*/, '$1phrasechat=');
      const s = w.settings;
      return res.json({
        ...base, entry, autoEntry, version: s.settings.version, as3: !!w.gameData.getAs3(), party: entry.party || null,
        lang: (entry.flashvars.match(/lang=(\w+)/) || [])[1] || 'en', stage: { width: 760, height: 480 },
        socketProxy: [
          { host: FAKE_IP, port: s.loginPort, path: `${WS_PREFIX}login` },
          { host: FAKE_IP, port: s.worldPort, path: `${WS_PREFIX}world` },
        ],
      });
    } catch (err) { return res.status(500).json({ error: err?.message || String(err) }); }
  });
  app.get('/pc-offline/status', (_req, res) => res.json({ media: media.getMediaState(), online: w.world.getAllPlayersInfo().length, version: w.settings.settings.version }));
  // A página pede pra recomeçar (tentar baixar a mídia de novo): o processo
  // principal (pracaOffline.js) desliga este e sobe outro.
  app.post('/pc-offline/restart', (_req, res) => { res.json({ ok: true }); send({ type: 'restart' }); });
  // Só a página do jogo e o script dela (nunca este host.js).
  const PAGE_FILES = { 'praca.html': 'text/html; charset=utf-8', 'praca.js': 'application/javascript; charset=utf-8' };
  app.get('/pc-offline/:file', (request, res) => {
    const type = PAGE_FILES[request.params.file];
    if (!type) return res.status(404).end();
    return res.type(type).sendFile(path.join(__dirname, request.params.file));
  });
  app.use('/ruffle', express.static(RUFFLE, { immutable: true, maxAge: '30d' }));
  app.use(w.http.getRouter());
  app.use((_req, res) => res.status(404).type('text').send('Arquivo do jogo não encontrado.'));

  const server = http.createServer(app);
  const wss = new WebSocket.Server({ noServer: true, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    const pathname = (request.url || '').split('?')[0];
    if (!pathname.startsWith(WS_PREFIX)) { socket.destroy(); return; }
    const kind = pathname.slice(WS_PREFIX.length);
    if (kind !== 'login' && kind !== 'world') { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (ws) => {
      w.attach(kind, ws, makeTransform(penguin.json.name, penguin.id));
      ws.on('close', () => send({ type: 'online', online: w.world.getAllPlayersInfo().length }));
      send({ type: 'online', online: w.world.getAllPlayersInfo().length + (kind === 'world' ? 1 : 0) });
    });
  });

  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).on('error', reject));
  const { port } = server.address();
  log(`servindo em http://127.0.0.1:${port}`);
  send({ type: 'ready', port, media: mediaState });

  const stop = () => { log('encerrando'); try { server.close(); } catch { /* ok */ } setTimeout(() => process.exit(0), 200); };
  parent?.on('message', (e) => { if (e?.data?.type === 'stop') stop(); });
  process.on('SIGTERM', stop);
}

main().catch(fail);
