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

  // ---- Som ----------------------------------------------------------------
  // Mudo vindo do Project Club (postMessage do app pai, mesma origem).
  var muted = false;
  try { muted = !!(w.parent && w.parent !== w && w.parent.__pcMuted); } catch (e) { /* ignora */ }
  var isFrame = !!(document.body && document.body.classList.contains('frame'));
  var touchDevice = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in w;
  var AC = w.AudioContext || w.webkitAudioContext;

  // Todo AudioContext criado aqui (pelo jogo ou pela ponte de som) fica
  // registrado pra ser destravado no primeiro toque.
  var audioCtxs = [];
  ['AudioContext', 'webkitAudioContext'].forEach(function (name) {
    var Orig = w[name];
    if (!Orig) return;
    var Wrapped = function (opts) { var c = new Orig(opts); audioCtxs.push(c); return c; };
    Wrapped.prototype = Orig.prototype;
    try { w[name] = Wrapped; } catch (e) { /* ignora */ }
  });

  // Ponte de som (celular/tablet, só no Game.html): os jogos tocam cada
  // efeito criando um <audio autoplay> novo. No app Android (WebView) e em
  // vários navegadores de celular cada <audio> novo precisa de um toque
  // próprio pra tocar — a música até voltava no primeiro toque, mas os
  // efeitos criados no meio da partida ficavam mudos. Aqui esses <audio> são
  // tocados pelo Web Audio (um AudioContext só, destravado no primeiro
  // toque): o elemento continua no DOM (o jogo remove/troca src/loop como
  // antes), mas quem toca é um AudioBufferSourceNode.
  var bridge = null;
  if (isFrame && touchDevice && AC && w.fetch) {
    try {
      var bctx = new w.AudioContext();
      var bgain = bctx.createGain();
      bgain.gain.value = muted ? 0 : 1;
      bgain.connect(bctx.destination);
      bridge = { ctx: bctx, gain: bgain, buffers: {}, playing: [] };
    } catch (e) { bridge = null; }
  }
  function bridgeBuffer(src) {
    var url;
    try { url = new URL(src, location.href).href; } catch (e) { return Promise.reject(e); }
    if (!bridge.buffers[url]) {
      bridge.buffers[url] = fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (ab) {
        return new Promise(function (ok, fail) { bridge.ctx.decodeAudioData(ab, ok, fail); });
      });
      bridge.buffers[url].catch(function () { delete bridge.buffers[url]; });
    }
    return bridge.buffers[url];
  }
  function bridgeForget(el) {
    var i = bridge.playing.indexOf(el);
    if (i !== -1) bridge.playing.splice(i, 1);
  }
  function bridgeStop(el) {
    var node = el.__pcSrc;
    el.__pcSrc = null;
    el.__pcToken = (el.__pcToken || 0) + 1;
    if (node) {
      try { node.stop(); } catch (e) { /* ignora */ }
      try { node.disconnect(); } catch (e) { /* ignora */ }
    }
    bridgeForget(el);
  }
  function bridgeStart(el) {
    bridgeStop(el);
    var src = el.getAttribute('src');
    if (!src) return;
    var token = el.__pcToken;
    var loop = el.hasAttribute('loop');
    // Efeito curto com o som ainda travado: não acumula pra tocar tudo junto depois.
    if (!loop && bridge.ctx.state !== 'running') return;
    bridge.playing.push(el);
    bridgeBuffer(src).then(function (buf) {
      if (el.__pcToken !== token || !el.isConnected) { if (el.__pcToken === token) bridgeStop(el); return; }
      var node = bridge.ctx.createBufferSource();
      node.buffer = buf;
      node.loop = loop;
      var g = bridge.ctx.createGain();
      g.gain.value = typeof el.volume === 'number' ? el.volume : 1;
      node.connect(g); g.connect(bridge.gain);
      node.onended = function () { if (el.__pcSrc === node) { el.__pcSrc = null; bridgeForget(el); } };
      el.__pcSrc = node;
      node.start(0);
    }).catch(function () { if (el.__pcToken === token) bridgeForget(el); });
  }
  // <audio> que o jogo quer tocando (autoplay ou play()) passa pra ponte.
  function bridgeAdopt(el) {
    if (el.__pcBridged) return;
    el.__pcBridged = true;
    // o elemento em si fica mudo e parado (só a ponte toca)
    el.autoplay = false;
    el.muted = true;
    try { origPause.call(el); } catch (e) { /* ignora */ }
    bridgeStart(el);
  }

  function applyMute(root) {
    if (bridge) {
      try { bridge.gain.gain.value = muted ? 0 : 1; } catch (e) { /* ignora */ }
      return;
    }
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
  function onMediaAdded(n) {
    if (bridge && n.tagName === 'AUDIO') {
      if (n.autoplay) bridgeAdopt(n);
      else if (n.getAttribute('src')) bridgeBuffer(n.getAttribute('src')).catch(function () {}); // pré-carrega
    } else {
      n.muted = muted || n.hasAttribute('muted');
    }
  }
  if (w.MutationObserver) {
    new MutationObserver(function (list) {
      list.forEach(function (m) {
        if (m.type === 'attributes') {
          // trenó: a música vira o som de chegada trocando src/loop no mesmo <audio>
          if (bridge && m.target.__pcBridged && m.target.isConnected) bridgeStart(m.target);
          return;
        }
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'AUDIO' || n.tagName === 'VIDEO') onMediaAdded(n);
          else if (n.querySelectorAll) n.querySelectorAll('audio,video').forEach(onMediaAdded);
        });
        if (bridge) {
          m.removedNodes.forEach(function (n) {
            if (n.nodeType !== 1) return;
            if (n.__pcBridged) bridgeStop(n);
            else if (n.querySelectorAll) n.querySelectorAll('audio').forEach(function (a) { if (a.__pcBridged) bridgeStop(a); });
          });
        }
      });
    }).observe(document.documentElement, bridge
      ? { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'loop'] }
      : { childList: true, subtree: true });
  }

  // Áudios criados depois (música/efeitos) também respeitam o mudo.
  var blockedMedia = [];
  var origPlay = w.HTMLMediaElement && w.HTMLMediaElement.prototype.play;
  var origPause = w.HTMLMediaElement && w.HTMLMediaElement.prototype.pause;
  if (origPlay) {
    w.HTMLMediaElement.prototype.play = function () {
      if (bridge && this.tagName === 'AUDIO' && this.isConnected) {
        if (!this.__pcBridged) bridgeAdopt(this); else bridgeStart(this);
        return Promise.resolve();
      }
      this.muted = muted;
      var el = this;
      var res = origPlay.apply(this, arguments);
      if (res && res.catch) {
        res.catch(function (err) {
          if (err && err.name === 'NotAllowedError' && blockedMedia.indexOf(el) === -1) blockedMedia.push(el);
        });
      }
      return res;
    };
    w.HTMLMediaElement.prototype.pause = function () {
      if (bridge && this.__pcBridged) bridgeStop(this);
      return origPause.apply(this, arguments);
    };
  }

  // Som no celular: AudioContext e música em autoplay só tocam depois de um
  // toque de verdade (o navegador conta o gesto no touchend/pointerup/click,
  // não no touchstart). O Project Club chama __pcResumeAudio() quando os
  // controles na tela são tocados e aqui tentamos a cada toque/tecla.
  var silentPlayed = false;
  w.__pcResumeAudio = function () {
    audioCtxs.forEach(function (c) {
      try {
        if (c.state === 'closed') return;
        if (c.state !== 'running') { var p = c.resume(); if (p && p.catch) p.catch(function () {}); }
        // buffer mudo: destrava o áudio de vez nos navegadores mais chatos (iOS/WebView)
        if (!silentPlayed) {
          var b = c.createBuffer(1, 1, 22050); var s = c.createBufferSource();
          s.buffer = b; s.connect(c.destination); s.start(0);
        }
      } catch (e) { /* ignora */ }
    });
    silentPlayed = audioCtxs.length > 0;
    try {
      // só o que o navegador barrou (play() recusado ou autoplay que nem começou)
      var list = blockedMedia.splice(0);
      document.querySelectorAll('audio[autoplay]').forEach(function (a) {
        if (a.paused && a.currentTime === 0 && list.indexOf(a) === -1) list.push(a);
      });
      list.forEach(function (a) {
        if (!a.isConnected || !a.paused) return;
        var p = a.play(); if (p && p.catch) p.catch(function () {});
      });
    } catch (e) { /* ignora */ }
    // repassa pro Game.html (iframe interno)
    try {
      var f = document.querySelector('iframe.game-box');
      if (f && f.contentWindow && f.contentWindow.__pcResumeAudio) f.contentWindow.__pcResumeAudio();
    } catch (e) { /* ignora */ }
  };
  // Estado do som (testes e depuração): AudioContexts deste jogo + ponte.
  w.__pcAudioState = function () {
    var out = { contexts: audioCtxs.map(function (c) { return c.state; }), bridge: !!bridge, playing: bridge ? bridge.playing.length : 0 };
    try {
      var f = document.querySelector('iframe.game-box');
      var inner = f && f.contentWindow && f.contentWindow.__pcAudioState && f.contentWindow.__pcAudioState();
      if (inner) { out.contexts = out.contexts.concat(inner.contexts); out.bridge = out.bridge || inner.bridge; out.playing += inner.playing; }
    } catch (e) { /* ignora */ }
    return out;
  };
  ['touchend', 'pointerup', 'pointerdown', 'click', 'keydown'].forEach(function (t) {
    document.addEventListener(t, function () { w.__pcResumeAudio(); }, true);
  });

  // Sem zoom de toque duplo, sem menu de toque longo e sem "puxar" a página.
  try {
    var st = document.createElement('style');
    st.textContent = 'html,body{touch-action:none;overscroll-behavior:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}';
    (document.head || document.documentElement).appendChild(st);
  } catch (e) { /* ignora */ }

  // Project Club — toque vira mouse (celular/tablet). Os jogos foram feitos
  // para mouse: arrastar ingrediente, mover o pinguim, clicar nos botões.
  // Toque e arraste geram mousedown/mousemove/mouseup/click no ponto tocado.
  if (document.body && document.body.classList.contains('frame') && ('ontouchstart' in w || navigator.maxTouchPoints > 0)) {
    var tStart = null, tMoved = false, tLast = null, tLastPos = null;
    var fire = function (type, t, el) {
      try {
        var ev = new MouseEvent(type, {
          bubbles: true, cancelable: true, view: w, clientX: t.clientX, clientY: t.clientY,
          screenX: t.screenX, screenY: t.screenY, button: 0, buttons: type === 'mouseup' || type === 'click' ? 0 : 1,
        });
        // Botão esquerdo: o Pizzatron pega o ingrediente só se e.which == 1,
        // e o jQuery calcula which a partir de button (0 → which 0) quando o
        // evento não traz which. Num MouseEvent criado na mão o which fica 0,
        // então travava o "pegar". Forçamos which = 1 (botão esquerdo).
        try { Object.defineProperty(ev, 'which', { configurable: true, get: function () { return 1; } }); } catch (e2) { /* ignora */ }
        el.dispatchEvent(ev);
      } catch (e) { /* ignora */ }
    };
    var at = function (t) { return document.elementFromPoint(t.clientX, t.clientY) || document.body; };
    document.addEventListener('touchstart', function (e) {
      if (e.touches.length > 1) return;
      var t = e.changedTouches[0]; var el = at(t);
      tStart = { x: t.clientX, y: t.clientY }; tMoved = false; tLast = el; tLastPos = t;
      fire('mouseover', t, el); fire('mousemove', t, el); fire('mousedown', t, el);
      e.preventDefault();
    }, { passive: false });
    document.addEventListener('touchmove', function (e) {
      if (!tStart) return;
      var t = e.changedTouches[0]; var el = at(t);
      if (Math.abs(t.clientX - tStart.x) + Math.abs(t.clientY - tStart.y) > 10) tMoved = true;
      fire('mousemove', t, el); tLast = el; tLastPos = t;
      e.preventDefault();
    }, { passive: false });
    var end = function (e) {
      if (!tStart) return;
      // Alguns navegadores (e automações) mandam o touchend sem a posição do
      // dedo. Nesse caso usamos a última posição conhecida — senão o "soltar"
      // não acontecia e o ingrediente nunca caía na pizza.
      var t = (e.changedTouches && e.changedTouches[0]) || tLastPos;
      if (!t) { tStart = null; return; }
      var el = at(t) || tLast;
      fire('mouseup', t, el);
      // toque cancelado (sistema/gesto) solta o "botão", mas não vira clique
      if (!tMoved && e.type !== 'touchcancel') fire('click', t, el);
      tStart = null;
      e.preventDefault();
    };
    document.addEventListener('touchend', end, { passive: false });
    document.addEventListener('touchcancel', end, { passive: false });
  }
})();
