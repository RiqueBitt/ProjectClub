// Entrada automática na Praça (Club Penguin).
//
// O jogo em Flash tem tela inicial → formulário de login → escolha de
// servidor. Como a pessoa já está logada no Project Club (o servidor força o
// pinguim da conta e aceita qualquer senha), essas telas não têm razão de
// existir. O Ruffle não tem API de automação, mas processa eventos de
// ponteiro e teclado do DOM — exatamente o que o teclado virtual dele faz —
// então este módulo "aperta" os botões e "digita" sozinho, nas posições fixas
// das telas do jogo (palco de 760x480), enquanto a página mostra "Entrando…"
// por cima. Se algo não bater (tela diferente, versão nova), desiste e
// devolve o controle pra pessoa: nada fica travado.
//
// As telas são detectadas pelo que o jogo baixa (PerformanceObserver de
// recursos): start_module.swf → tela inicial; login.swf → formulário;
// rooms/… → entrou no mundo.

const STAGE = { w: 760, h: 480 };

// Posições (em coordenadas do palco 760x480) por cliente.
const LAYOUTS = {
  // cliente moderno (AS3, nov/2010 em diante)
  as3: {
    start: { login: [490, 426] },
    form: { name: [415, 72], pass: [415, 102], submit: [381, 213] },
    servers: { first: [304, 114] },
  },
  // cliente clássico (AS2)
  as2: {
    start: { login: [382, 414] },
    form: { name: [416, 103], pass: [416, 134], submit: [382, 245] },
    servers: { first: [304, 114] },
  },
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function makeDriver(player) {
  const canvas = () => player.shadowRoot?.querySelector('canvas') || player;
  const toClient = (sx, sy) => {
    const r = player.getBoundingClientRect();
    return [r.left + (sx / STAGE.w) * r.width, r.top + (sy / STAGE.h) * r.height];
  };
  const pointer = (type, x, y, extra = {}) => {
    const c = canvas();
    const base = { bubbles: true, composed: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true, ...extra };
    c.dispatchEvent(new PointerEvent(type, base));
    const mouse = { pointerdown: 'mousedown', pointerup: 'mouseup', pointermove: 'mousemove' }[type];
    if (mouse) c.dispatchEvent(new MouseEvent(mouse, base));
  };
  return {
    async click([sx, sy]) {
      const [x, y] = toClient(sx, sy);
      pointer('pointermove', x, y);
      await wait(40);
      pointer('pointerdown', x, y, { buttons: 1 });
      await wait(70);
      pointer('pointerup', x, y);
      canvas().dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: x, clientY: y, button: 0 }));
      await wait(120);
    },
    async type(text) {
      // igual ao teclado virtual do Ruffle: keydown/keyup com `key` no elemento do player
      for (const ch of text) {
        for (const n of ['keydown', 'keyup']) player.dispatchEvent(new KeyboardEvent(n, { key: ch, bubbles: true }));
        await wait(35);
      }
    },
    async key(key, mods = {}) {
      for (const n of ['keydown', 'keyup']) player.dispatchEvent(new KeyboardEvent(n, { key, bubbles: true, ...mods }));
      await wait(60);
    },
  };
}

/**
 * Observa os recursos que o jogo baixa e resolve quando um deles bate com
 * `test`. Rejeita no timeout.
 */
function waitForResource(test, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const seen = performance.getEntriesByType('resource').some((e) => test(e.name));
    if (seen) return resolve();
    let done = false;
    const obs = new PerformanceObserver((list) => {
      if (done) return;
      if (list.getEntries().some((e) => test(e.name))) { done = true; obs.disconnect(); resolve(); }
    });
    obs.observe({ type: 'resource', buffered: false });
    const t = setTimeout(() => { if (!done) { done = true; obs.disconnect(); reject(new Error('timeout')); } }, timeoutMs);
    signal?.addEventListener('abort', () => { done = true; obs.disconnect(); clearTimeout(t); reject(new Error('abort')); });
  });
}

/**
 * Roda a entrada automática. `onStep(nome)` recebe o progresso; resolve true
 * quando o pinguim entrou numa sala, false se desistiu (a pessoa continua
 * manualmente). Nunca lança.
 */
export async function autoLogin({ player, as3, name, signal, onStep = () => {} }) {
  const L = LAYOUTS[as3 ? 'as3' : 'as2'];
  const d = makeDriver(player);
  // já entrou no mundo? (recarregou a página com o jogo em cache, por ex.)
  const inWorld = () => performance.getEntriesByType('resource').some((e) => /\/rooms\/[a-z_0-9]+\.swf/i.test(e.name));
  try {
    // 1) tela inicial
    onStep('start');
    await waitForResource((u) => /start_module\.swf|login\/backgrounds\/|startscreen\.xml/i.test(u), 90_000, signal);
    await wait(as3 ? 2500 : 1800); // o módulo ainda desenha depois de baixar
    await d.click(L.start.login);

    // 2) formulário
    onStep('form');
    await waitForResource((u) => /\/login\.swf/i.test(u), 20_000, signal).catch(() => {});
    await wait(as3 ? 2200 : 1500);
    // O primeiro clique só dá foco ao campo (o texto digitado logo em seguida
    // se perde); o segundo clique, com o campo já ativo, aceita a digitação.
    const fill = async (pos, text) => {
      await d.click(pos); await wait(500);
      await d.click(pos); await wait(300);
      await d.type(text); await wait(250);
    };
    await fill(L.form.name, name);
    await fill(L.form.pass, 'projectclub');
    await d.click(L.form.submit);

    // 3) servidor (único): primeiro da lista
    onStep('server');
    await wait(as3 ? 3500 : 2500);
    for (let attempt = 0; attempt < 3 && !inWorld(); attempt++) {
      await d.click(L.servers.first);
      try {
        await waitForResource((u) => /\/rooms\/[a-z_0-9]+\.swf/i.test(u), 12_000, signal);
        break;
      } catch (err) {
        if (err.message === 'abort') throw err;
      }
    }
    onStep(inWorld() ? 'world' : 'manual');
    return inWorld();
  } catch (err) {
    onStep('manual');
    return false;
  }
}
