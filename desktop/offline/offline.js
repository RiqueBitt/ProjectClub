// Tela offline do app de computador (pcapp://offline). Quem decide que o
// servidor está fora, testa a volta e reabre o Project Club é o processo
// principal (connectionWindow.js). Aqui: as seções Apps, Navegador, VPN e
// Praça, usando as pontes do offlinePreload.js.
(function () {
  'use strict';
  var conexao = window.pcConexao; var off = window.pcOffline; var api = window.electronAPI;
  if (!conexao || !off || !api) return;
  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  var REASON = { network: 'falha de rede ao abrir a página', server: 'o servidor respondeu com erro', timeout: 'o servidor não respondeu a tempo', offline: 'computador sem internet', repeated: 'a página falhou várias vezes seguidas' };
  var state = { network: null, account: null, apps: [], vpn: null, praca: null };

  // ---------- janela / conexão ----------
  $('min').addEventListener('click', function () { conexao.minimize(); });
  $('max').addEventListener('click', function () { conexao.maximize(); });
  $('hide').addEventListener('click', function () { conexao.hide(); });
  $('retry').addEventListener('click', function () { if ($('retry').onclick) return; renderConn({ checking: true }); conexao.check(); });

  function renderConn(s) {
    var conn = $('conn');
    if (s.checking) { conn.className = 'conn'; $('connText').textContent = 'Verificando…'; $('retry').disabled = true; return; }
    $('retry').disabled = false;
    if (s.serverBack) {
      conn.className = 'conn ok'; $('connText').textContent = 'O Project Club voltou';
      $('retry').textContent = 'Voltar ao Project Club'; $('retry').onclick = function () { conexao.restore(); };
      $('title').textContent = 'O Project Club voltou';
      $('msg').textContent = 'Como a Praça offline está aberta, a volta não foi automática. Feche a Praça ou clique em "Voltar ao Project Club".';
      return;
    }
    $('retry').textContent = 'Tentar agora'; $('retry').onclick = null;
    if (s.network === false) {
      conn.className = 'conn off'; $('connText').textContent = 'Sem internet · testando a cada 5 s';
      $('title').textContent = 'Sem internet';
      $('msg').textContent = 'Seu computador está sem conexão. O que não precisa de internet continua aqui; quando ela voltar, o Project Club reabre sozinho.';
    } else if (s.network === true) {
      conn.className = 'conn'; $('connText').textContent = 'Servidor fora · testando a cada 5 s';
      $('title').textContent = 'Sem conexão com o Project Club';
      $('msg').textContent = 'A internet está funcionando, mas o servidor do Project Club não respondeu. Enquanto isso, o que não depende dele continua aqui.';
    }
    if (typeof s.network === 'boolean' && s.network !== state.network) { state.network = s.network; renderApps(); renderVpn(); renderPracaHome(); }
    if (s.reason) $('detail').textContent = 'Motivo: ' + (REASON[s.reason] || s.reason);
  }
  conexao.onStatus(renderConn);

  // ---------- navegação entre seções ----------
  function go(name) {
    document.querySelectorAll('.rail-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.section === name); });
    document.querySelectorAll('.section').forEach(function (s) { s.classList.toggle('active', s.id === 'sec-' + name); });
    if (name === 'navegador' && !tabs.length) newTab();
  }
  document.querySelectorAll('.rail-btn').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.section); }); });
  document.querySelectorAll('.card.go').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.go); }); });

  // ---------- conta ----------
  function renderAccount(a) {
    state.account = a;
    $('accName').textContent = a ? a.displayName : 'Ninguém logado';
    $('accUser').textContent = a ? '@' + a.username : '';
    var av = $('avatar');
    if (a && a.avatarUrl) { av.style.backgroundImage = 'url("' + a.avatarUrl.replace(/"/g, '') + '")'; av.textContent = ''; }
    else { av.style.backgroundImage = ''; av.textContent = a ? (a.displayName || '?').slice(0, 1).toUpperCase() : '?'; }
  }

  // ---------- apps ----------
  var appProgress = {}; var appErrors = {};
  function renderApps() {
    var grid = $('appsGrid'); grid.replaceChildren();
    if (!state.apps.length) { grid.appendChild(el('p', 'hint', 'Nenhum app conhecido neste computador ainda.')); return; }
    state.apps.forEach(function (a) {
      var c = el('div', 'card');
      var head = el('div', 'row'); head.appendChild(el('b', null, a.displayName));
      head.appendChild(el('span', 'badge' + (a.installed ? '' : ' off'), a.installed ? 'INSTALADO' + (a.version ? ' · ' + a.version : '') : 'NÃO INSTALADO'));
      c.appendChild(head);
      c.appendChild(el('small', null, a.description || ''));
      var foot = el('div', 'foot');
      if (a.installed) {
        var open = el('button', 'primary small', 'Abrir');
        open.addEventListener('click', function () { open.disabled = true; api.projectMc.launch(a.id).then(function (r) { if (r && r.error) note(c, r.error); }).finally(function () { open.disabled = false; }); });
        foot.appendChild(open);
      }
      var inst = el('button', 'ghost small', a.installed ? 'Atualizar' : 'Instalar');
      inst.disabled = state.network === false;
      inst.title = state.network === false ? 'Precisa de internet' : '';
      inst.addEventListener('click', function () { installApp(a.id, c, inst); });
      foot.appendChild(inst);
      c.appendChild(foot);
      var p = appProgress[a.id];
      if (p) { var bar = el('div', 'bar-prog'); var i = el('i'); i.style.width = Math.round((p.ratio || 0) * 100) + '%'; bar.appendChild(i); c.appendChild(bar); c.appendChild(el('small', null, p.label || '')); }
      if (appErrors[a.id]) note(c, appErrors[a.id]);
      grid.appendChild(c);
    });
  }
  function note(card, text) { var n = card.querySelector('.err') || el('p', 'err'); n.textContent = text; card.appendChild(n); }
  function installApp(id, card, btn) {
    btn.disabled = true; appProgress[id] = { ratio: 0, label: 'Preparando…' }; renderApps();
    api.projectMc.install(id).then(function (r) {
      delete appProgress[id];
      appErrors[id] = (!r || r.success === false) ? ((r && r.error) || 'Não deu pra instalar.') : null;
      refreshApps();
    });
  }
  api.projectMc.onProgress(function (p) {
    if (!p || !p.id) return;
    var ratio = typeof p.percent === 'number' ? p.percent / 100 : 0;
    var PHASE = { downloading: 'Baixando', extracting: 'Extraindo', finishing: 'Finalizando', done: 'Pronto' };
    appProgress[p.id] = { ratio: ratio, label: (PHASE[p.phase] || p.phase || '') + ' · ' + Math.round(ratio * 100) + '%' };
    renderApps();
  });
  function refreshApps() { off.apps().then(function (list) { state.apps = list || []; renderApps(); }).catch(function () {}); }

  // ---------- VPN ----------
  var FLAG = function (cc) { if (!cc || cc.length !== 2) return '🌍'; var A = 0x1F1E6; return String.fromCodePoint(A + cc.toUpperCase().charCodeAt(0) - 65, A + cc.toUpperCase().charCodeAt(1) - 65); };
  function renderVpn() {
    var v = state.vpn; var box = $('vpnState'); box.replaceChildren();
    if (!v) return;
    if (!v.supported) { box.appendChild(el('b', null, 'VPN indisponível neste sistema')); $('vpnList').replaceChildren(); return; }
    var status = { connected: 'Conectada', connecting: 'Conectando…', disconnecting: 'Desligando…', error: 'Erro', idle: 'Desligada', disconnected: 'Desligada' }[v.status] || (v.status || 'Desligada');
    var head = el('div', 'row'); head.appendChild(el('b', null, 'Estado: ' + status));
    head.appendChild(el('span', 'badge' + (v.status === 'connected' ? '' : v.status === 'connecting' ? ' warn' : ' off'), (v.status || 'off').toUpperCase()));
    box.appendChild(head);
    if (v.server && (v.server.countryName || v.server.ip)) box.appendChild(el('small', null, (v.server.countryName ? FLAG(v.server.country) + ' ' + v.server.countryName : '') + (v.server.ip ? ' · ' + v.server.ip : '')));
    if (v.ip) box.appendChild(el('small', null, 'Seu IP pela VPN: ' + v.ip));
    if (v.error) box.appendChild(el('p', 'err', v.error));
    if (state.network === false) box.appendChild(el('small', null, 'Sem internet a VPN não tem como conectar.'));
    var foot = el('div', 'foot');
    if (['connected', 'connecting'].includes(v.status)) { var d = el('button', 'ghost small', 'Desconectar'); d.addEventListener('click', function () { api.vpn.disconnect(); }); foot.appendChild(d); }
    box.appendChild(foot);
    var list = $('vpnList'); list.replaceChildren();
    if (!v.servers || !v.servers.length) { list.appendChild(el('p', 'hint', 'Nenhum servidor salvo ainda. Conecte uma vez pelo Project Club (com o servidor online) e ele fica guardado aqui.')); return; }
    v.servers.forEach(function (s) {
      var row = el('div', 'srv'); row.appendChild(el('span', 'flag', FLAG(s.country)));
      var name = el('div', 'name'); name.appendChild(el('b', null, s.countryName || s.id)); name.appendChild(el('small', null, 'usado em ' + new Date(s.usedAt).toLocaleString('pt-BR')));
      row.appendChild(name);
      var b = el('button', 'primary small', 'Conectar'); b.disabled = state.network === false || ['connecting', 'disconnecting'].includes(v.status);
      b.addEventListener('click', function () { b.disabled = true; off.vpnConnectSaved(s.id).then(function (r) { if (r && !r.ok) { state.vpn.error = r.error; renderVpn(); } }); });
      row.appendChild(b); list.appendChild(row);
    });
  }
  api.vpn.onState(function (st) { state.vpn = Object.assign({}, state.vpn || {}, st); renderVpn(); });

  // ---------- Praça ----------
  var pracaView = null;
  function fmtGB(b) { return (b / 1073741824).toFixed(1).replace('.', ',') + ' GB'; }
  function renderPracaHome() {
    var p = state.praca; if (!p) return;
    var pg = $('pracaPenguin'); pg.replaceChildren();
    var s = p.summary;
    if (!s) {
      pg.appendChild(el('b', null, 'Ainda sem cópia do seu pinguim'));
      pg.appendChild(el('small', null, 'Entre na Praça com internet pelo menos uma vez: o Project Club salva aqui o seu pinguim (e atualiza a cada 5 minutos enquanto você joga).'));
    } else {
      var head = el('div', 'row'); head.appendChild(el('b', null, '🐧 ' + s.name)); head.appendChild(el('span', 'badge' + (s.member ? '' : ' off'), s.member ? 'MEMBRO' : 'PINGUIM')); pg.appendChild(head);
      [['Moedas', String(s.coins)], ['Itens', String(s.items)], ['Puffles', String(s.puffles)], ['Carimbos', String(s.stamps)], ['Cópia salva em', new Date(s.savedAt).toLocaleString('pt-BR')]].forEach(function (r) { var row = el('div', 'row'); row.appendChild(el('span', null, r[0])); row.appendChild(el('span', null, r[1])); pg.appendChild(row); });
    }
    var md = $('pracaMedia'); md.replaceChildren();
    md.appendChild(el('b', null, 'Arquivos do jogo neste computador'));
    if (!p.available) md.appendChild(el('small', null, 'Esta versão do app veio sem o Club Penguin embutido.'));
    else if (p.disk) {
      var ratio = p.disk.total ? p.disk.present / p.disk.total : 0;
      var bar = el('div', 'bar-prog'); var i = el('i'); i.style.width = Math.round(ratio * 100) + '%'; bar.appendChild(i); md.appendChild(bar);
      md.appendChild(el('small', null, Math.round(ratio * 100) + '% · ' + (p.disk.bytes ? fmtGB(p.disk.bytes) + ' no total' : '')));
      md.appendChild(el('small', null, ratio >= 0.99 ? 'Tudo no disco: a ilha abre sem internet.' : (state.network === false ? 'Faltam arquivos e não há internet — o download continua quando ela voltar (não precisa do servidor do Project Club).' : 'Faltam arquivos: ao abrir, o jogo baixa o que falta do GitHub (não precisa do servidor do Project Club).')));
    }
    var btn = $('pracaOpen');
    btn.disabled = !s || !p.available;
    var err = $('pracaErr'); err.hidden = !p.error; err.textContent = p.error || '';
  }
  function renderPracaGame(st) {
    state.praca = Object.assign({}, state.praca || {}, st);
    var running = st.status === 'running' && st.pageUrl;
    $('pracaGame').hidden = !(st.status === 'starting' || running);
    $('pracaHome').hidden = !$('pracaGame').hidden;
    $('pracaStatus').textContent = st.status === 'starting' ? 'Ligando a ilha…' : running ? 'Ilha ligada · ' + (st.online || 0) + ' na ilha (só você)' : '';
    if (running) {
      if (!pracaView || pracaView.getAttribute('src') !== st.pageUrl) {
        $('pracaView').replaceChildren();
        pracaView = document.createElement('webview');
        pracaView.setAttribute('partition', 'persist:pc-offline-praca');
        pracaView.setAttribute('src', st.pageUrl);
        $('pracaView').appendChild(pracaView);
      }
    } else if (!$('pracaGame').hidden) { /* ligando */ } else { $('pracaView').replaceChildren(); pracaView = null; }
    renderPracaHome();
  }
  $('pracaOpen').addEventListener('click', function () {
    $('pracaOpen').disabled = true;
    off.pracaStart().then(function (r) { if (r && !r.ok) { state.praca.error = r.error; renderPracaHome(); } else if (r && r.state) renderPracaGame(r.state); }).finally(function () { $('pracaOpen').disabled = false; });
  });
  $('pracaClose').addEventListener('click', function () { off.pracaStop().then(renderPracaGame); });
  $('pracaFolder').addEventListener('click', function () { off.openFolder('praca'); });
  off.onPraca(renderPracaGame);

  // ---------- Navegador ----------
  var tabs = []; var active = null; var bookmarks = []; var historyList = [];
  var isUrl = function (q) { return /^(https?:\/\/|view-source:)/i.test(q) || (/^[\w.-]+\.[a-z]{2,}(\/|$|:\d+)/i.test(q) && !/\s/.test(q)) || /^localhost(:\d+)?/.test(q) || /^\d{1,3}(\.\d{1,3}){3}/.test(q); };
  function toUrl(q) { q = q.trim(); if (!q) return 'about:blank'; if (isUrl(q)) return /^(https?:\/\/|view-source:)/i.test(q) ? q : 'https://' + q; return 'https://duckduckgo.com/?q=' + encodeURIComponent(q); }
  function newTab(url, background) {
    var id = 't' + Date.now() + Math.random().toString(36).slice(2, 6);
    var wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:pcbrowser');
    wv.setAttribute('src', url || 'https://duckduckgo.com/');
    wv.setAttribute('allowpopups', 'true');
    var tab = { id: id, wv: wv, title: 'Nova aba', url: url || 'https://duckduckgo.com/' };
    wv.addEventListener('page-title-updated', function (e) { tab.title = e.title; renderTabs(); });
    wv.addEventListener('did-navigate', function (e) { tab.url = e.url; if (active === tab) $('url').value = e.url; pushHistory(tab); renderTabs(); });
    wv.addEventListener('did-navigate-in-page', function (e) { if (e.isMainFrame) { tab.url = e.url; if (active === tab) $('url').value = e.url; } });
    wv.addEventListener('did-stop-loading', function () { updateNav(); });
    $('views').appendChild(wv); tabs.push(tab);
    if (!background) activate(tab); else renderTabs();
    return tab;
  }
  function activate(tab) { active = tab; tabs.forEach(function (t) { t.wv.classList.toggle('active', t === tab); }); $('url').value = tab.url === 'about:blank' ? '' : tab.url; renderTabs(); updateNav(); }
  function closeTab(tab) {
    var i = tabs.indexOf(tab); if (i < 0) return;
    tabs.splice(i, 1); tab.wv.remove();
    if (active === tab) { active = null; if (tabs.length) activate(tabs[Math.max(0, i - 1)]); }
    renderTabs(); updateNav();
  }
  function renderTabs() {
    var bar = $('tabs'); [].slice.call(bar.querySelectorAll('.tab')).forEach(function (t) { t.remove(); });
    tabs.forEach(function (t) {
      var b = el('div', 'tab' + (t === active ? ' active' : '')); b.setAttribute('role', 'button'); b.tabIndex = 0;
      b.appendChild(el('span', 't', t.title || t.url));
      var x = el('button', 'x', '×'); x.title = 'Fechar aba'; x.addEventListener('click', function (e) { e.stopPropagation(); closeTab(t); });
      b.appendChild(x); b.addEventListener('click', function () { activate(t); });
      bar.insertBefore(b, $('newTab'));
    });
    $('browserEmpty').classList.toggle('show', !tabs.length);
    $('star').textContent = active && bookmarks.some(function (f) { return f.url === active.url; }) ? '★' : '☆';
  }
  function updateNav() {
    var wv = active && active.wv; var can = function (fn) { try { return wv && wv[fn](); } catch (e) { return false; } };
    $('back').disabled = !can('canGoBack'); $('fwd').disabled = !can('canGoForward'); $('reload').disabled = !wv;
  }
  $('newTab').addEventListener('click', function () { newTab(); });
  $('browserOpen').addEventListener('click', function () { newTab(); });
  $('back').addEventListener('click', function () { try { active.wv.goBack(); } catch (e) { /* ok */ } });
  $('fwd').addEventListener('click', function () { try { active.wv.goForward(); } catch (e) { /* ok */ } });
  $('reload').addEventListener('click', function () { try { active.wv.reload(); } catch (e) { /* ok */ } });
  $('urlForm').addEventListener('submit', function (e) { e.preventDefault(); var u = toUrl($('url').value); if (!active) newTab(u); else active.wv.loadURL(u); });
  $('star').addEventListener('click', function () {
    if (!active) return;
    var i = bookmarks.findIndex(function (f) { return f.url === active.url; });
    if (i >= 0) bookmarks.splice(i, 1); else bookmarks.unshift({ url: active.url, title: active.title || active.url, at: Date.now() });
    api.browser.profile.save('bookmarks', bookmarks).catch(function () {}); renderFavs(); renderTabs();
  });
  function renderFavs() { var fb = $('favbar'); fb.replaceChildren(); bookmarks.slice(0, 30).forEach(function (f) { var b = el('button', null, f.title || f.url); b.title = f.url; b.addEventListener('click', function () { if (!active) newTab(f.url); else active.wv.loadURL(f.url); }); fb.appendChild(b); }); }
  function pushHistory(tab) { if (!tab.url || /^about:/.test(tab.url)) return; historyList.unshift({ url: tab.url, title: tab.title || tab.url, at: Date.now() }); if (historyList.length > 5000) historyList.length = 5000; clearTimeout(pushHistory.t); pushHistory.t = setTimeout(function () { api.browser.profile.save('history', historyList).catch(function () {}); }, 1500); }
  api.browser.on('open-tab', function (d) { if (d && d.url) newTab(d.url, !!d.background); });
  api.browser.on('context-action', function (d) { if (d && d.action === 'open-tab' && d.url) newTab(d.url, !!d.background); });
  api.browser.on('shortcut', function (d) {
    var k = d && d.key;
    if (k === 't') newTab(); else if (k === 'w' && active) closeTab(active); else if (k === 'l') { $('url').focus(); $('url').select(); } else if (k === 'r' && active) active.wv.reload();
  });
  window.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || !$('sec-navegador').classList.contains('active')) return;
    var k = e.key.toLowerCase();
    if (k === 't') { e.preventDefault(); newTab(); } else if (k === 'w' && active) { e.preventDefault(); closeTab(active); } else if (k === 'l') { e.preventDefault(); $('url').focus(); $('url').select(); }
  });
  api.browser.profile.load().then(function (p) {
    bookmarks = Array.isArray(p && p.bookmarks) ? p.bookmarks : []; historyList = Array.isArray(p && p.history) ? p.history : [];
    renderFavs();
  }).catch(function () {});

  // ---------- estado inicial ----------
  off.getState().then(function (s) {
    renderAccount(s.account);
    state.apps = s.apps || []; renderApps();
    state.vpn = s.vpn; renderVpn();
    state.praca = s.praca; renderPracaHome();
    if (s.praca && (s.praca.status === 'running' || s.praca.status === 'starting')) renderPracaGame(s.praca);
    if (typeof s.network === 'boolean') { state.network = s.network; }
  }).catch(function () {});
  conexao.check();
})();
