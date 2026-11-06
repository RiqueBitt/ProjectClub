// Página do Club Penguin offline (servida por host.js em 127.0.0.1). Versão
// enxuta da PracaPage do site: pede /pc-offline/config, espera a mídia (na
// primeira vez ela é baixada do GitHub), sobe o Ruffle com o socketProxy
// apontando pros WebSockets locais e entra sozinha com o pinguim da conta.
(function () {
  'use strict';
  var STAGE = { w: 760, h: 480 };
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage'); var overlay = $('overlay'); var actions = $('actions');
  var player = null; var cfg = null; var drops = [];

  function show(title, msg, opts) {
    opts = opts || {};
    overlay.hidden = false;
    $('title').textContent = title;
    $('msg').textContent = msg || '';
    $('bar').hidden = !(typeof opts.progress === 'number');
    if (typeof opts.progress === 'number') $('fill').style.width = Math.round(Math.max(0, Math.min(1, opts.progress)) * 100) + '%';
    actions.replaceChildren();
    (opts.buttons || []).forEach(function (b) {
      var el = document.createElement('button'); el.type = 'button'; el.textContent = b.label; if (b.ghost) el.className = 'ghost';
      el.addEventListener('click', b.onClick); actions.appendChild(el);
    });
    if (opts.spinner) { var s = document.createElement('span'); s.className = 'spin'; actions.appendChild(s); }
  }
  function hide() { overlay.hidden = true; }

  // Encaixa o palco 760x480 no espaço da janela (sem distorcer).
  function fit() {
    var w = window.innerWidth; var h = window.innerHeight;
    var scale = Math.max(0.3, Math.min(w / STAGE.w, h / STAGE.h));
    stage.style.transform = 'scale(' + scale.toFixed(4) + ')';
  }
  window.addEventListener('resize', fit); fit();

  function mediaText(m) {
    if (!m) return 'Conferindo os arquivos do jogo…';
    if (m.state === 'checking') return 'Conferindo os arquivos do jogo neste computador…';
    if (m.state === 'downloading') return 'Baixando o pacote "' + (m.current || 'jogo') + '"' + (m.missing ? ' · faltam ' + m.missing + ' arquivos' : '') + '. Precisa de internet só desta vez (não precisa do servidor do Project Club).';
    if (m.state === 'extracting') return 'Instalando o pacote "' + (m.current || 'jogo') + '"…';
    if (m.state === 'error') return 'Não deu pra preparar os arquivos: ' + (m.error || 'erro desconhecido') + '. Sem internet, o jogo só abre depois que a mídia estiver no computador.';
    return '';
  }

  function getJson(url) { return fetch(url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }

  // ---- Ruffle ----
  var rufflePromise = null;
  function loadRuffle() {
    if (window.RufflePlayer && window.RufflePlayer.newest) return Promise.resolve(window.RufflePlayer);
    if (!rufflePromise) {
      rufflePromise = new Promise(function (resolve, reject) {
        window.RufflePlayer = window.RufflePlayer || {};
        window.RufflePlayer.config = { publicPath: '/ruffle/', polyfills: false, autoplay: 'on', unmuteOverlay: 'hidden' };
        var s = document.createElement('script'); s.src = '/ruffle/ruffle.js';
        s.onload = function () { (window.RufflePlayer && window.RufflePlayer.newest) ? resolve(window.RufflePlayer) : reject(new Error('Ruffle não carregou')); };
        s.onerror = function () { reject(new Error('Ruffle não carregou')); };
        document.head.appendChild(s);
      }).catch(function (e) { rufflePromise = null; throw e; });
    }
    return rufflePromise;
  }

  // O cliente 2012 lê o "estado" inicial pelo SWFAddress da página: "/login"
  // pula a abertura e, com nau/nal nas flashvars, entra sozinho.
  function installSwfAddressShim() {
    var noop = function () {};
    window.SWFAddress = {
      getValue: function () { return '/login'; }, getPath: function () { return '/login'; }, getIds: function () { return ['praca']; }, getStrict: function () { return true; },
      getStatus: function () { return ''; }, getTitle: function () { return document.title; }, getTracker: function () { return ''; }, getHistory: function () { return true; }, getBaseURL: function () { return '/praca'; }, getAutoUpdate: function () { return false; },
      setValue: noop, setTitle: noop, setStatus: noop, setHistory: noop, setStrict: noop, setTracker: noop, setAutoUpdate: noop, addId: noop, back: noop, forward: noop, up: noop, popup: noop, href: noop, onInit: noop, onChange: noop,
    };
  }
  // "OK" dos avisos do jogo manda abrir o site antigo do Club Penguin; aqui a
  // página responde: pedido de recomeçar → reinicia; o resto é ignorado.
  var RESTART = /^https?:\/\/(play|www)\.clubpenguin\.com\/?$|^https?:\/\/(support|www)\.clubpenguin\.com\/help\/.*(connect|connection)/i;
  function installNavigationGuard() {
    if (window.__pcNavGuard) return; window.__pcNavGuard = true;
    var orig = window.confirm;
    window.confirm = function (message) {
      var m = /^The SWF file wants to open the website ([\s\S]+)$/.exec(String(message == null ? '' : message));
      if (!m) return orig.call(window, message);
      if (RESTART.test(m[1].trim())) setTimeout(function () { window.dispatchEvent(new CustomEvent('praca:world-closed', { detail: { code: 'restart' } })); }, 0);
      return false;
    };
  }
  // Mundo caiu (processo reiniciou): a página reconecta sozinha.
  function installWorldSocketWatch() {
    if (window.__pcWsWatch || typeof window.WebSocket !== 'function') return; window.__pcWsWatch = true;
    var Orig = window.WebSocket;
    function Watched(url, protocols) {
      var ws = protocols === undefined ? new Orig(url) : new Orig(url, protocols);
      if (/\/waddle\/ws\/world/.test(String(url))) {
        var origClose = ws.close.bind(ws); var byClient = false;
        ws.close = function () { byClient = true; return origClose.apply(null, arguments); };
        ws.addEventListener('close', function (ev) { if (!byClient) window.dispatchEvent(new CustomEvent('praca:world-closed', { detail: { code: ev.code } })); });
      }
      return ws;
    }
    Watched.prototype = Orig.prototype; Watched.CONNECTING = 0; Watched.OPEN = 1; Watched.CLOSING = 2; Watched.CLOSED = 3;
    window.WebSocket = Watched;
  }

  function wsBase() { return 'ws://' + location.host; }

  function startGame(c) {
    cfg = c;
    show('Abrindo a ilha…', 'Carregando o jogo do seu computador.', { spinner: true });
    return loadRuffle().then(function (RufflePlayer) {
      var socketProxy = c.socketProxy.map(function (p) { return { host: p.host, port: p.port, proxyUrl: wsBase() + p.path }; });
      RufflePlayer.config = Object.assign({}, RufflePlayer.config || {}, { socketProxy: socketProxy, publicPath: '/ruffle/', polyfills: false });
      if (c.autoEntry === 'flashvars') installSwfAddressShim();
      installNavigationGuard(); installWorldSocketWatch();
      if (player) { try { player.remove(); } catch (e) { /* ok */ } }
      player = RufflePlayer.newest().createPlayer();
      player.className = 'praca-player';
      stage.replaceChildren(player);
      var p = typeof player.ruffle === 'function' ? player.ruffle() : player;
      return p.load({
        url: c.entry.swf, parameters: c.entry.flashvars, base: '/', autoplay: 'on', unmuteOverlay: 'hidden', splashScreen: false,
        letterbox: 'on', scale: 'showAll', quality: 'best', backgroundColor: '#0b2a4a', warnOnUnsupportedContent: false, showSwfDownload: false,
        contextMenu: 'off', allowScriptAccess: true, allowNetworking: 'all', openUrlMode: 'confirm', logLevel: 'error', locale: 'pt-BR',
        publicPath: '/ruffle/', polyfills: false, socketProxy: socketProxy,
      }).then(function () {
        hide();
        $('hud').hidden = false; $('pname').textContent = c.penguin.name; $('pcoins').textContent = String(c.penguin.coins);
        $('pparty').textContent = c.party ? 'Festa: ' + c.party : '';
      });
    });
  }

  window.addEventListener('praca:world-closed', function () {
    var now = Date.now(); drops = drops.filter(function (t) { return now - t < 120000; }).concat(now);
    if (drops.length > 3) { show('A ilha caiu várias vezes', 'Feche e abra a Praça de novo pela tela offline.', { buttons: [{ label: 'Tentar de novo', onClick: boot }] }); return; }
    show('Reconectando…', 'A ilha reiniciou. Entrando de novo com o seu pinguim.', { spinner: true });
    setTimeout(boot, 1200);
  });

  function restartHost() {
    show('Reiniciando…', 'Conferindo os arquivos de novo.', { spinner: true });
    fetch('/pc-offline/restart', { method: 'POST' }).catch(function () {});
  }
  function waitMedia() {
    return getJson('/pc-offline/config').then(function (c) {
      if (c.needsMedia) {
        var m = c.media || {};
        show('Faltam arquivos do jogo', (m.missing ? 'Faltam ' + m.missing + ' arquivos. ' : '') + 'Eles são baixados do GitHub na primeira vez — precisa de internet (não do servidor do Project Club). Conecte e tente de novo.' + (m.error ? ' Último erro: ' + m.error : ''), { buttons: [{ label: 'Tentar de novo', onClick: restartHost }] });
        return new Promise(function () {}); // fica na tela até a pessoa agir
      }
      if (c.error) throw new Error(c.error);
      if (!c.preparing) return c;
      var m = c.media || {};
      var progress = typeof m.progress === 'number' ? m.progress : undefined;
      show(m.state === 'downloading' ? 'Baixando o Club Penguin (1,7 GB)' : 'Preparando a ilha…', mediaText(m), { progress: progress, spinner: typeof progress !== 'number' });
      return new Promise(function (r) { setTimeout(r, 1500); }).then(waitMedia);
    });
  }

  function boot() {
    show('Preparando a ilha…', 'Conferindo os arquivos do jogo neste computador.', { spinner: true });
    waitMedia().then(function (c) {
      // O som só é liberado depois de um clique: a entrada espera um toque.
      show('Pinguim ' + c.penguin.name + ' · ' + c.penguin.coins + ' moedas', 'Você está sem conexão com o Project Club. A ilha abre só pra você neste computador; o que fizer aqui fica salvo localmente até a próxima sincronização.', {
        buttons: [{ label: 'Entrar na ilha', onClick: function () { startGame(c).catch(function (e) { show('Não deu pra abrir o jogo', e && e.message ? e.message : String(e), { buttons: [{ label: 'Tentar de novo', onClick: boot }] }); }); } }],
      });
    }).catch(function (e) {
      show('A Praça não abriu', (e && e.message ? e.message : String(e)), { buttons: [{ label: 'Tentar de novo', onClick: boot }] });
    });
  }
  boot();
})();
