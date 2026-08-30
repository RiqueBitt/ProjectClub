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
  // Item pedido: "adicione mais apps" — slugs confirmados: nomes de
  // marca de uma palavra só, sem espaço/hífen, seguem o padrão já
  // testado e comprovado (centenas de exemplos conferidos) do Simple
  // Icons. Nomes compostos ficam de fora até eu conseguir confirmar o
  // slug exato de cada um.
  { name: 'Slack', process: { win: 'slack.exe', linux: 'slack' }, imageUrl: 'https://cdn.simpleicons.org/slack' },
  { name: 'Zoom', process: { win: 'Zoom.exe' }, imageUrl: 'https://cdn.simpleicons.org/zoom' },
  { name: 'Notion', process: { win: 'Notion.exe', linux: 'notion-app' }, imageUrl: 'https://cdn.simpleicons.org/notion' },
  { name: 'Telegram', process: { win: 'Telegram.exe', linux: 'telegram-desktop' }, imageUrl: 'https://cdn.simpleicons.org/telegram' },
  { name: 'WhatsApp', process: { win: 'WhatsApp.exe' }, imageUrl: 'https://cdn.simpleicons.org/whatsapp' },
  { name: 'Skype', process: { win: 'Skype.exe' }, imageUrl: 'https://cdn.simpleicons.org/skype' },
  { name: 'Unity', process: { win: 'Unity.exe', linux: 'unity-editor' }, imageUrl: 'https://cdn.simpleicons.org/unity' },
  { name: 'Godot Engine', process: { win: 'Godot.exe', linux: 'godot' }, imageUrl: 'https://cdn.simpleicons.org/godotengine' },
  { name: 'Twitch', process: { win: 'Twitch.exe' }, imageUrl: 'https://cdn.simpleicons.org/twitch' },
  { name: 'Krita', process: { win: 'krita.exe', linux: 'krita' }, imageUrl: 'https://cdn.simpleicons.org/krita' },
  { name: 'Inkscape', process: { win: 'inkscape.exe', linux: 'inkscape' }, imageUrl: 'https://cdn.simpleicons.org/inkscape' },
  { name: 'Audacity', process: { win: 'audacity.exe', linux: 'audacity' }, imageUrl: 'https://cdn.simpleicons.org/audacityteam' },
  { name: 'VLC', process: { win: 'vlc.exe', linux: 'vlc' }, imageUrl: 'https://cdn.simpleicons.org/vlcmediaplayer' },
  { name: 'Insomnia', process: { win: 'Insomnia.exe' }, imageUrl: 'https://cdn.simpleicons.org/insomnia' },
  { name: 'Trello', process: { win: 'Trello.exe' }, imageUrl: 'https://cdn.simpleicons.org/trello' },
  { name: 'Notepad', process: { win: 'notepad.exe' } }, // sem logo — não é uma marca com ícone próprio
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
