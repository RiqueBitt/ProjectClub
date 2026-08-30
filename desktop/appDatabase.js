// Item pedido: "tem um chamado app, quero que mostre apps abertos
// também, tipo VS Code etc" — mesma ideia do gameDatabase.js (processo
// do sistema -> nome de exibição), mas pra PROGRAMAS comuns em vez de
// jogos. Aparece como uma atividade do tipo "app" (ícone genérico de
// aplicativo, ver ActivityBadge.jsx) — só é checado quando NENHUM jogo
// foi encontrado rodando (jogo sempre tem prioridade, igual o Discord).
const APPS = [
  { name: 'Visual Studio Code', process: { win: 'Code.exe', linux: 'code' } },
  { name: 'Visual Studio', process: { win: 'devenv.exe' } },
  { name: 'IntelliJ IDEA', process: { win: 'idea64.exe', linux: 'idea' } },
  { name: 'WebStorm', process: { win: 'webstorm64.exe', linux: 'webstorm' } },
  { name: 'PyCharm', process: { win: 'pycharm64.exe', linux: 'pycharm' } },
  { name: 'Android Studio', process: { win: 'studio64.exe', linux: 'studio' } },
  { name: 'Sublime Text', process: { win: 'sublime_text.exe', linux: 'sublime_text' } },
  { name: 'Notepad++', process: { win: 'notepad++.exe' } },
  { name: 'Photoshop', process: { win: 'Photoshop.exe' } },
  { name: 'Illustrator', process: { win: 'Illustrator.exe' } },
  { name: 'Premiere Pro', process: { win: 'Adobe Premiere Pro.exe' } },
  { name: 'After Effects', process: { win: 'AfterFX.exe' } },
  { name: 'Blender', process: { win: 'blender.exe', linux: 'blender' } },
  { name: 'OBS Studio', process: { win: 'obs64.exe', linux: 'obs' } },
  { name: 'Figma', process: { win: 'Figma.exe' } },
  { name: 'Discord', process: { win: 'Discord.exe' } },
  { name: 'Docker Desktop', process: { win: 'Docker Desktop.exe' } },
  { name: 'Postman', process: { win: 'Postman.exe' } },
  { name: 'GIMP', process: { win: 'gimp-2.10.exe', linux: 'gimp' } },
  { name: 'Steam', process: { win: 'steam.exe', linux: 'steam' } },
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
  return app ? { name: app.name } : null;
}

module.exports = { matchProcessName };
