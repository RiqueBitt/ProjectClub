/* Mini-Jogos do Project Club — substituto local do "sbd.js" (framework
   externo dns.switchbru.com que os jogos originais carregavam).
   Implementa só o que os jogos usam: app (estado, loop, onLoad), device,
   input (teclado mapeado pros botões de controle) e include (no-op: os
   scripts agora vêm em <script src> na ordem certa no Game.html).
   Sem chamadas externas: tudo funciona offline e passa no CSP 'self'. */
(function () {
  'use strict';
  var w = window;

  // Game.html só roda dentro do index.html (era um <script> inline).
  if (document.body && document.body.classList.contains('frame') && w === w.top) {
    location.href = './';
    return;
  }

  // Bloqueia o menu de contexto (antes era oncontextmenu inline).
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  w.include = function () { /* scripts já carregados via <script src> */ };

  // Recordes do Project Club: o jogo chama pcReportScore(n) no fim da partida
  // e isso sobe pra página do Project Club (mesma origem), que salva o placar.
  w.pcReportScore = function (n) {
    n = Math.floor(Number(n));
    if (!isFinite(n) || n <= 0) return;
    try { w.top.postMessage({ type: 'pc-minigame-score', score: n }, location.origin); } catch (e) { /* ignora */ }
  };

  var state = 'Init';
  var loadFns = [];
  var loaded = document.readyState === 'complete';
  w.addEventListener('load', function () {
    loaded = true;
    loadFns.splice(0).forEach(function (fn) { try { fn(); } catch (err) { console.error(err); } });
  });

  w.app = {
    setState: function (s) { state = s; },
    currentState: function () { return state; },
    onLoad: function (fn) { if (loaded) setTimeout(fn, 0); else loadFns.push(fn); },
    mainLoop: function (fn, opts) {
      var fps = (opts && opts.fps) || 60;
      return setInterval(function () {
        try { fn(); } catch (err) { console.error(err); }
      }, Math.round(1000 / fps));
    },
  };

  w.device = {
    isSwitch: /Nintendo Switch/i.test(navigator.userAgent),
    // inteiro aleatório entre min e max (inclusive)
    randomNum: function (min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; },
  };

  // Controle: setas/A/D = direcional, Espaço/Enter = botão A.
  var KEYMAP = {
    ArrowLeft: 'DPadLeft', KeyA: 'DPadLeft',
    ArrowRight: 'DPadRight', KeyD: 'DPadRight',
    Space: 'A', Enter: 'A', NumpadEnter: 'A',
  };
  var held = {};
  var pressed = [];
  var released = [];
  w.addEventListener('keydown', function (e) {
    var b = KEYMAP[e.code];
    if (!b) return;
    if (e.code === 'Space') e.preventDefault();
    if (held[b]) return;
    held[b] = true;
    pressed.push(b);
  });
  w.addEventListener('keyup', function (e) {
    var b = KEYMAP[e.code];
    if (!b) return;
    held[b] = false;
    released.push(b);
  });
  w.addEventListener('blur', function () {
    Object.keys(held).forEach(function (b) { if (held[b]) { held[b] = false; released.push(b); } });
  });

  w.input = {
    A: 'A', B: 'B', X: 'X', Y: 'Y',
    DPadLeft: 'DPadLeft', DPadRight: 'DPadRight', DPadUp: 'DPadUp', DPadDown: 'DPadDown',
    LStickLeft: 'LStickLeft', LStickRight: 'LStickRight',
    getHeld: function () { for (var b in held) if (held[b]) return b; return null; },
    getPressed: function () { return pressed.length ? pressed.shift() : null; },
    getReleased: function () { return released.length ? released.shift() : null; },
  };

  // Mudo vindo do Project Club (postMessage do app pai, mesma origem).
  var muted = false;
  try { muted = !!(w.parent && w.parent !== w && w.parent.__pcMuted); } catch (e) { /* ignora */ }
  function applyMute(root) {
    try {
      root.querySelectorAll('audio,video').forEach(function (m) { m.muted = muted || m.hasAttribute('muted'); });
    } catch (e) { /* ignora */ }
  }
  w.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'pc-minigame-mute') return;
    muted = !!e.data.muted;
    w.__pcMuted = muted;
    applyMute(document);
    // repassa pro iframe interno (Game.html)
    var f = document.querySelector('iframe.game-box');
    if (f && f.contentWindow) f.contentWindow.postMessage(e.data, location.origin);
  });
  if (w.MutationObserver) {
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'AUDIO' || n.tagName === 'VIDEO') n.muted = muted || n.hasAttribute('muted');
          else if (n.querySelectorAll) applyMute(n);
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  // Áudios criados depois (música/efeitos) também respeitam o mudo.
  var origPlay = w.HTMLMediaElement && w.HTMLMediaElement.prototype.play;
  if (origPlay) {
    w.HTMLMediaElement.prototype.play = function () {
      this.muted = muted;
      return origPlay.apply(this, arguments);
    };
  }

  // Project Club — toque vira mouse (celular/tablet). Os jogos foram feitos
  // para mouse: arrastar ingrediente, mover o pinguim, clicar nos botões.
  // Toque e arraste geram mousedown/mousemove/mouseup/click no ponto tocado.
  if (document.body && document.body.classList.contains('frame') && ('ontouchstart' in w || navigator.maxTouchPoints > 0)) {
    var tStart = null, tMoved = false, tLast = null;
    var fire = function (type, t, el) {
      try {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, view: w, clientX: t.clientX, clientY: t.clientY,
          screenX: t.screenX, screenY: t.screenY, button: 0, buttons: type === 'mouseup' || type === 'click' ? 0 : 1,
        }));
      } catch (e) { /* ignora */ }
    };
    var at = function (t) { return document.elementFromPoint(t.clientX, t.clientY) || document.body; };
    document.addEventListener('touchstart', function (e) {
      if (e.touches.length > 1) return;
      var t = e.changedTouches[0]; var el = at(t);
      tStart = { x: t.clientX, y: t.clientY }; tMoved = false; tLast = el;
      fire('mouseover', t, el); fire('mousemove', t, el); fire('mousedown', t, el);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', function (e) {
      if (!tStart) return;
      var t = e.changedTouches[0]; var el = at(t);
      if (Math.abs(t.clientX - tStart.x) + Math.abs(t.clientY - tStart.y) > 10) tMoved = true;
      fire('mousemove', t, el); tLast = el;
      e.preventDefault();
    }, { passive: false });
    var end = function (e) {
      if (!tStart) return;
      var t = e.changedTouches[0]; var el = at(t) || tLast;
      fire('mouseup', t, el);
      if (!tMoved) fire('click', t, el);
      tStart = null;
      e.preventDefault();
    };
    document.addEventListener('touchend', end, { passive: false });
    document.addEventListener('touchcancel', end, { passive: false });
  }
})();
