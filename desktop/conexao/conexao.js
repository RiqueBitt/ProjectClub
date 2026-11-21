// Tela "Project Club · Conexão" (computador). Quem testa a conexão é o
// processo principal (connectionWindow.js); aqui só mostramos o estado.
(function () {
  var api = window.pcConexao;
  var $ = function (id) { return document.getElementById(id); };
  var REASON = { network: 'falha de rede ao abrir a página', server: 'o servidor respondeu com erro', timeout: 'o servidor não respondeu a tempo', offline: 'computador sem internet', repeated: 'a página falhou várias vezes seguidas' };

  function render(s) {
    if (s.checking) {
      $('status').classList.add('busy');
      $('statusText').textContent = 'Verificando…';
      $('retry').disabled = true;
      return;
    }
    $('status').classList.remove('busy');
    $('retry').disabled = false;
    $('statusText').textContent = 'Tentando de novo a cada 5 segundos';
    if (s.network === false) {
      $('title').textContent = 'Sem internet';
      $('msg').textContent = 'Seu computador está sem conexão. Assim que a internet voltar, o Project Club abre sozinho.';
    } else if (s.network === true) {
      $('title').textContent = 'Sem conexão com o Project Club';
      $('msg').textContent = 'A internet está funcionando, mas o servidor não respondeu. O app tenta de novo sozinho.';
    }
    if (s.reason) $('detail').textContent = 'Motivo: ' + (REASON[s.reason] || s.reason);
  }

  if (!api) return;
  api.onStatus(render);
  $('retry').addEventListener('click', function () { render({ checking: true }); api.check(); });
  $('min').addEventListener('click', function () { api.minimize(); });
  $('hide').addEventListener('click', function () { api.hide(); });
  api.check();
})();
