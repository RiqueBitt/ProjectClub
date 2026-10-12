// Player dos mini-jogos em Flash (.swf) usando o Ruffle (emulador de Flash
// em WebAssembly, servido pelo próprio app em /ruffle — nada de CDN).
// Uso: player.html?swf=<pasta>/<arquivo>.swf  (caminho relativo a esta pasta)
// Comunicação com o Project Club (janela pai, mesma origem):
//  - recebe {type:'pc-minigame-mute', muted}
//  - envia  {type:'pc-minigame-score', score} quando o jogo termina (via shell)
//  - envia  {type:'pc-minigame-ready'} quando o jogo começa a rodar
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var swf = params.get('swf') || '';
  var stage = document.getElementById('stage');
  function fail() { document.getElementById('err').style.display = 'flex'; }
  // Só aceita caminhos simples dentro desta pasta (sem "..", sem URL externa).
  if (!/^[A-Za-z0-9_\-/. ']+\.swf$/.test(swf) || swf.indexOf('..') !== -1 || swf.charAt(0) === '/') { fail(); return; }

  var parentOrigin = location.origin;
  function toParent(msg) {
    try { if (window.parent && window.parent !== window) window.parent.postMessage(msg, parentOrigin); } catch (e) { /* ignora */ }
  }

  // Celular: o Ruffle desenha na resolução real da tela (DPR 2,6–3,5 em
  // muitos Androids), o que pesa e esquenta. Limita a 2 — a diferença não
  // aparece nesses jogos de 760x480. No PC fica como sempre foi.
  var coarse = (navigator.maxTouchPoints || 0) > 0 && !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  if (coarse && (window.devicePixelRatio || 1) > 2) {
    try { Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: function () { return 2; } }); } catch (e) { /* ignora */ }
  }

  var dir = swf.indexOf('/') === -1 ? '' : swf.slice(0, swf.lastIndexOf('/') + 1);
  var ruffle = window.RufflePlayer && window.RufflePlayer.newest && window.RufflePlayer.newest();
  if (!ruffle) { fail(); return; }
  var player = ruffle.createPlayer();
  stage.appendChild(player);

  var muted = false;
  try { muted = !!window.__pcMuted; } catch (e) { /* ignora */ }
  function applyMute() { try { player.volume = muted ? 0 : 1; } catch (e) { /* ignora */ } }

  // O pcshell.swf (gerado pra cada jogo) define o "shell" do Club Penguin que os
  // jogos chamam no fim da partida e manda o resultado por fscommand.
  var lastSent = 0;
  function sendScore(raw) {
    var n = Math.floor(Number(raw));
    if (!isFinite(n) || n <= 0) return;
    var now = Date.now();
    if (now - lastSent < 1500) return; // alguns jogos chamam 2x no fim
    lastSent = now;
    toParent({ type: 'pc-minigame-score', score: n });
  }
  player.onFSCommand = function (cmd, args) {
    cmd = String(cmd || '').toLowerCase();
    var parts = String(args == null ? '' : args).split('|');
    if (params.get('debug') === '1') toParent({ type: 'pc-minigame-fs', cmd: cmd, args: String(args) });
    if (cmd === 'pcwin') {
      // showWindow(nome, {score, coins})
      if (/game\s*over/i.test(parts[0] || '')) sendScore(parts[1] !== 'undefined' && parts[1] !== '' ? parts[1] : parts[2]);
    } else if (cmd === 'pcover' || cmd === 'pcscore' || cmd === 'pctix') {
      // pctix = jogos do Pet Shop (Puffle Paddle, Soaker...) que mandam os tickets no fim
      sendScore(parts[0]);
    }
    return true;
  };

  // Som: o navegador do celular só deixa o AudioContext tocar depois de um
  // toque. O Project Club chama window.__pcResumeAudio() no primeiro toque
  // (nos controles ou no jogo) e aqui também tentamos a cada toque/tecla.
  function audioCtx() {
    try { var inst = player.instance; return inst && inst.audio_context ? inst.audio_context() : null; } catch (e) { return null; }
  }
  window.__pcResumeAudio = function () {
    var ctx = audioCtx();
    try { if (ctx && ctx.state !== 'running' && ctx.resume) ctx.resume(); } catch (e) { /* ignora */ }
  };
  ['pointerdown', 'touchend', 'keydown'].forEach(function (t) {
    document.addEventListener(t, window.__pcResumeAudio, true);
  });

  // Toque: o Ruffle usa o primeiro toque só pra "acordar" o jogo (o botão
  // tocado não reage). Em vez de parecer travado, mostramos "Toque para
  // começar" até esse primeiro toque — o próximo já vale no jogo.
  var touchDevice = coarse;
  var tapHint = null;
  function hideTapHint() {
    if (!tapHint) return;
    tapHint.classList.add('is-gone');
    var el = tapHint; tapHint = null;
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
  }
  if (touchDevice) document.addEventListener('pointerdown', hideTapHint, true);

  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    var d = e.data;
    if (d && d.type === 'pc-minigame-mute') { muted = !!d.muted; applyMute(); }
  });

  (typeof player.ruffle === "function" ? player.ruffle() : player).load({
    url: swf,
    base: dir || './',
    autoplay: 'on',
    unmuteOverlay: 'hidden',
    splashScreen: false,
    letterbox: 'on',
    warnOnUnsupportedContent: false,
    showSwfDownload: false,
    contextMenu: 'rightClickOnly',
    allowScriptAccess: true,
    allowNetworking: 'all',
    openUrlMode: 'deny',
    logLevel: 'error',
    locale: 'pt-BR',
    publicPath: '/ruffle/',
    polyfills: false,
  }).then(function () {
    applyMute();
    toParent({ type: 'pc-minigame-ready' });
    if (touchDevice && !tapHint) {
      tapHint = document.createElement('div');
      tapHint.id = 'tap-hint';
      tapHint.textContent = 'Toque para começar';
      document.body.appendChild(tapHint);
    }
    try { player.focus(); } catch (e) { /* ignora */ }
  }).catch(function () { fail(); });
})();
