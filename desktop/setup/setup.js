/* Instalador / desinstalador do Project Club (janela pequena, sem moldura).
   Quem faz o trabalho de verdade é o processo principal (desktop/setupWindow.js);
   aqui é só a tela. window.pcSetup vem de setupPreload.js. */
const api = window.pcSetup;
const $ = (id) => document.getElementById(id);
const win = $('win');
const info = api.info();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function show(name) {
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.dataset.screen !== name; });
  win.classList.toggle('plain', name === 'options' || name === 'progress');
  win.classList.toggle('split', name === 'uninstall');
  const first = document.querySelector(`.screen[data-screen="${name}"] .btn.primary`);
  first?.focus({ preventScroll: true });
}

/* ---------- arte: fitas onduladas em perspectiva (desenhadas em código) ---------- */
const cv = $('art');
const ctx = cv.getContext('2d');
let t0 = performance.now();
function drawArt(now) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = cv.clientWidth; const h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#07080c'); g.addColorStop(0.55, '#101422'); g.addColorStop(1, '#1a2034');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const t = reduced ? 0 : (now - t0) / 1000;
  const LINES = 64;
  for (let i = 0; i < LINES; i++) {
    const k = i / LINES;                    // 0 longe (em cima) → 1 perto (embaixo)
    const depth = 0.25 + k * 0.75;
    const baseY = h * (0.42 + k * 0.62);
    ctx.beginPath();
    for (let x = -20; x <= w + 20; x += 8) {
      const u = x / w;
      const y = baseY
        - Math.sin(u * 3.1 + k * 4.2 + t * 0.35) * 26 * depth
        - Math.sin(u * 7.3 - k * 2.6 + t * 0.22) * 9 * depth
        - (1 - u) * 60 * (1 - k);
      if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    const hot = Math.abs(((i * 7) % 23) - 11) < 2;     // algumas fitas acesas na cor da marca
    ctx.strokeStyle = hot ? `rgba(76,159,255,${0.35 + k * 0.5})` : `rgba(170,182,210,${0.06 + k * 0.22})`;
    ctx.lineWidth = hot ? 1.6 + k * 1.4 : 0.8 + k * 1.2;
    ctx.stroke();
  }
  // escurece a esquerda pra o texto ler bem (menos na tela de desinstalar,
  // em que a arte fica sozinha no painel da esquerda)
  if (win.classList.contains('split')) { if (!reduced) requestAnimationFrame(drawArt); return; }
  const s = ctx.createLinearGradient(0, 0, w * 0.62, 0);
  s.addColorStop(0, 'rgba(8,9,13,.96)'); s.addColorStop(0.7, 'rgba(8,9,13,.55)'); s.addColorStop(1, 'rgba(8,9,13,0)');
  ctx.fillStyle = s; ctx.fillRect(0, 0, w, h);
  if (!reduced) requestAnimationFrame(drawArt);
}
requestAnimationFrame(drawArt);

/* ---------- links e fechar ---------- */
document.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); api.openSite(a.dataset.open); }));
$('close').addEventListener('click', () => (info.mode === 'uninstall' ? api.cancel() : api.cancelInstall()));
addEventListener('keydown', (e) => { if (e.key === 'Escape') $('close').click(); });

/* ---------- instalar ---------- */
const TOUR = [
  ['Chat, voz e tela', 'Converse, entre nas calls e compartilhe a tela com a sua comunidade, direto do PC.'],
  ['Loja e coleções', 'Molduras, efeitos e estilos pro seu perfil. Pendure na cesta e pague com o seu cartão.'],
  ['Progresso', 'Suba de nível, desbloqueie conquistas e apareça no pódio do ranking.'],
  ['Sempre por perto', 'Fica na bandeja, avisa quando alguém te chama e abre num clique.'],
];
let tourI = 0;
function tourStep() {
  const el = $('tour');
  const [h, p] = TOUR[tourI % TOUR.length];
  el.querySelector('h3').textContent = h;
  el.querySelector('p').textContent = p;
  el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
  tourI += 1;
}

if (info.platform !== 'win32') {
  $('row-menu').hidden = false;
  $('opt-desktop').closest('label').hidden = true;
  $('autostart-label').textContent = 'Iniciar junto com o sistema (minimizado)';
}

$('go-options').addEventListener('click', (e) => { e.preventDefault(); show('options'); });
$('back').addEventListener('click', () => show('welcome'));
$('confirm').addEventListener('click', () => show('welcome'));
$('install').addEventListener('click', () => {
  show('progress');
  tourStep();
  const tour = setInterval(tourStep, 3200);
  api.onProgress(({ pct, label, done }) => {
    $('bar-fill').style.width = `${pct}%`;
    $('bar').setAttribute('aria-valuenow', String(Math.round(pct)));
    $('prog-label').textContent = label;
    if (done) clearInterval(tour);
  });
  api.install({
    desktop: $('opt-desktop').checked, menu: $('opt-menu').checked,
    autostart: $('opt-autostart').checked, open: $('opt-open').checked,
  });
});

/* ---------- desinstalar ---------- */
function busy(label) {
  document.querySelectorAll('.btn').forEach((b) => { b.disabled = true; });
  $('un-label').hidden = false; $('un-bar').hidden = false;
  $('un-label').textContent = label;
}
$('uninstall').addEventListener('click', () => { busy('Desinstalando…'); $('un-fill').style.width = '100%'; api.uninstall({ wipe: $('opt-wipe').checked }); });
$('cancel').addEventListener('click', () => api.cancel());
$('reinstall').addEventListener('click', () => {
  busy('Baixando a versão mais nova…');
  api.onProgress(({ pct, label }) => { $('un-fill').style.width = `${pct}%`; if (label) $('un-label').textContent = label; });
  api.reinstall();
});

show(info.mode === 'uninstall' ? 'uninstall' : 'welcome');
