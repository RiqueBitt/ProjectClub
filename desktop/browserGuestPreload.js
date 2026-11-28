// Roda nas páginas do navegador do Project Club (mundo isolado, sem acesso
// do site a nada daqui). Só faz duas coisas, e só na página principal:
//   1) quando você ENVIA um formulário de login, avisa o app (que pergunta se
//      você quer salvar a senha — nada é salvo sem você aceitar);
//   2) quando você pede, preenche o login salvo DESTE site.
// Nada daqui é enviado para a internet: vai só para o app, que guarda em
// arquivo criptografado no seu computador.
const { ipcRenderer } = require('electron');

if (window.top === window && /^(https:|http:\/\/(localhost|127\.0\.0\.1))/.test(location.href)) {
  const visible = (el) => !!el && el.offsetParent !== null && !el.disabled && el.type !== 'hidden';
  const pwFields = (root = document) => [...root.querySelectorAll('input[type="password"]')].filter(visible);
  const userField = (pw) => {
    const scope = pw?.form || document;
    const cands = [...scope.querySelectorAll('input')].filter((i) => visible(i) && /^(text|email|tel)?$/.test(i.type || 'text'));
    const named = cands.find((i) => /username|email/i.test(i.autocomplete || '') || /user|login|email|mail|usuario|conta|account|cpf/i.test(`${i.name} ${i.id}`));
    if (named) return named;
    // O campo de texto logo antes da senha.
    let best = null;
    for (const i of cands) { if (pw && i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) best = i; }
    return best || cands[0] || null;
  };

  let sentAt = 0;
  const capture = (form) => {
    const pws = pwFields(form || document).filter((p) => p.value);
    if (!pws.length) {
      // Login em duas etapas (e-mail numa página, senha na outra): guarda o usuário.
      const u = userField(null);
      if (u && u.value && /email|user|login|identifier|usuario/i.test(`${u.name} ${u.id} ${u.autocomplete} ${u.type}`)) ipcRenderer.send('pcb:pw-username', u.value);
      return;
    }
    // Cadastro/troca de senha com campos repetidos: usa a última (nova senha).
    const pw = pws[pws.length - 1];
    const u = userField(pw);
    if (Date.now() - sentAt < 1500) return;
    sentAt = Date.now();
    ipcRenderer.send('pcb:pw-submit', { username: u?.value || '', password: pw.value });
  };

  document.addEventListener('submit', (e) => capture(e.target), true);
  document.addEventListener('click', (e) => {
    const b = e.target?.closest?.('button, input[type="submit"], [role="button"]');
    if (!b) return;
    const form = b.form || b.closest('form');
    if ((form && pwFields(form).length) || /entrar|login|log in|sign in|acessar|continuar|próximo|next/i.test(b.textContent || b.value || '')) setTimeout(() => capture(form), 0);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target?.matches?.('input')) setTimeout(() => capture(e.target.form), 0);
  }, true);

  // Avisa que a página tem um campo de senha (o app mostra a chave se houver login salvo).
  let told = false;
  const check = () => { if (!told && pwFields().length) { told = true; ipcRenderer.send('pcb:pw-form'); } };
  window.addEventListener('DOMContentLoaded', () => { check(); setTimeout(check, 1500); setTimeout(check, 4000); });

  // Preencher (só quando você pede, e o app confere que é o mesmo site).
  const setVal = (el, v) => {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc?.set) desc.set.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  ipcRenderer.on('pcb:pw-fill', (_e, { username, password }) => {
    const pw = pwFields()[0];
    const u = userField(pw);
    if (u && username) setVal(u, username);
    if (pw && password) { setVal(pw, password); pw.focus(); }
  });
}
