// Item pedido: "identificar apps abertos também, tipo VS Code etc" —
// mesma ideia do gameDatabase.js (processo do sistema -> nome de
// exibição), mas pra PROGRAMAS comuns em vez de jogos. Aparece como
// uma atividade do tipo "app" — só é checado quando NENHUM jogo foi
// encontrado rodando (jogo sempre tem prioridade, igual o Discord).
//
// `imageUrl` usa o CDN oficial do projeto Simple Icons
// (cdn.simpleicons.org/<slug>) — uma biblioteca de +1500 logos de
// marca de verdade, de licença aberta, com nomes de slug CONFIRMADOS
// (não adivinhados) direto na lista oficial deles antes de usar aqui.
const APPS = [
  { name: 'Visual Studio Code', process: { win: 'Code.exe', linux: 'code' }, imageUrl: 'https://cdn.simpleicons.org/visualstudiocode' },
  { name: 'Visual Studio', process: { win: 'devenv.exe' }, imageUrl: 'https://cdn.simpleicons.org/visualstudio' },
  { name: 'IntelliJ IDEA', process: { win: 'idea64.exe', linux: 'idea' }, imageUrl: 'https://cdn.simpleicons.org/intellijidea' },
  { name: 'WebStorm', process: { win: 'webstorm64.exe', linux: 'webstorm' }, imageUrl: 'https://cdn.simpleicons.org/webstorm' },
  { name: 'PyCharm', process: { win: 'pycharm64.exe', linux: 'pycharm' }, imageUrl: 'https://cdn.simpleicons.org/pycharm' },
  { name: 'Android Studio', process: { win: 'studio64.exe', linux: 'studio' }, imageUrl: 'https://cdn.simpleicons.org/androidstudio' },
  { name: 'Sublime Text', process: { win: 'sublime_text.exe', linux: 'sublime_text' }, imageUrl: 'https://cdn.simpleicons.org/sublimetext' },
  { name: 'Notepad++', process: { win: 'notepad++.exe' } },
  { name: 'Photoshop', process: { win: 'Photoshop.exe' }, imageUrl: 'https://cdn.simpleicons.org/adobephotoshop' },
  { name: 'Illustrator', process: { win: 'Illustrator.exe' }, imageUrl: 'https://cdn.simpleicons.org/adobeillustrator' },
  { name: 'Premiere Pro', process: { win: 'Adobe Premiere Pro.exe' }, imageUrl: 'https://cdn.simpleicons.org/adobepremierepro' },
  { name: 'After Effects', process: { win: 'AfterFX.exe' }, imageUrl: 'https://cdn.simpleicons.org/adobeaftereffects' },
  { name: 'Blender', process: { win: 'blender.exe', linux: 'blender' }, imageUrl: 'https://cdn.simpleicons.org/blender' },
  { name: 'OBS Studio', process: { win: 'obs64.exe', linux: 'obs' }, imageUrl: 'https://cdn.simpleicons.org/obsstudio' },
  { name: 'Figma', process: { win: 'Figma.exe' }, imageUrl: 'https://cdn.simpleicons.org/figma' },
  { name: 'Discord', process: { win: 'Discord.exe' }, imageUrl: 'https://cdn.simpleicons.org/discord' },
  { name: 'Docker Desktop', process: { win: 'Docker Desktop.exe' }, imageUrl: 'https://cdn.simpleicons.org/docker' },
  { name: 'Postman', process: { win: 'Postman.exe' }, imageUrl: 'https://cdn.simpleicons.org/postman' },
  { name: 'GIMP', process: { win: 'gimp-2.10.exe', linux: 'gimp' }, imageUrl: 'https://cdn.simpleicons.org/gimp' },
  { name: 'Steam', process: { win: 'steam.exe', linux: 'steam' }, imageUrl: 'https://cdn.simpleicons.org/steam' },
];

const BY_PROCESS_WIN = new Map();
const BY_PROCESS_LINUX = new Map();
for (const app of APPS) {
  if (app.process.win) BY_PROCESS_WIN.set(app.process.win.toLowerCase(), app);
  if (app.process.linux) BY_PROCESS_LINUX.set(app.process.linux.toLowerCase(), app);
}

function matchProcessName(processName, platform) {
  const table = platform === 'linux' ? BY_PROCESS_LINUX : BY_PROCESS_WIN;
  const app = table.get(processName.toLowerCase());
  return app ? { name: app.name, imageUrl: app.imageUrl || undefined } : null;
}

module.exports = { matchProcessName };
