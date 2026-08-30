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
  // Discord e Steam removidos de propósito (item pedido) — os dois
  // ficam abertos o tempo todo em segundo plano pra praticamente todo
  // mundo (o próprio Discord é o app que a pessoa já está usando pra
  // ver essa atividade, e o Steam fica sempre rodando por trás dos
  // jogos), mostrar isso como "atividade" vira ruído sem sentido, igual
  // já tirei os navegadores antes.
  { name: 'Docker Desktop', process: { win: 'Docker Desktop.exe' }, imageUrl: 'https://cdn.simpleicons.org/docker' },
  { name: 'Postman', process: { win: 'Postman.exe' }, imageUrl: 'https://cdn.simpleicons.org/postman' },
  { name: 'GIMP', process: { win: 'gimp-2.10.exe', linux: 'gimp' }, imageUrl: 'https://cdn.simpleicons.org/gimp' },
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
  // Item pedido: "adicione mais apps, foque totalmente nisso" — mais
  // nomes de marca de uma palavra só, slugs confirmados na lista
  // oficial do Simple Icons.
  { name: 'Epic Games Launcher', process: { win: 'EpicGamesLauncher.exe' }, imageUrl: 'https://cdn.simpleicons.org/epicgames' },
  { name: 'Battle.net', process: { win: 'Battle.net.exe' }, imageUrl: 'https://cdn.simpleicons.org/battledotnet' },
  { name: 'TeamViewer', process: { win: 'TeamViewer.exe' }, imageUrl: 'https://cdn.simpleicons.org/teamviewer' },
  { name: 'AnyDesk', process: { win: 'AnyDesk.exe' }, imageUrl: 'https://cdn.simpleicons.org/anydesk' },
  { name: 'qBittorrent', process: { win: 'qbittorrent.exe', linux: 'qbittorrent' }, imageUrl: 'https://cdn.simpleicons.org/qbittorrent' },
  { name: 'CapCut', process: { win: 'CapCut.exe' }, imageUrl: 'https://cdn.simpleicons.org/capcut' },
  { name: 'Streamlabs', process: { win: 'Streamlabs OBS.exe' }, imageUrl: 'https://cdn.simpleicons.org/streamlabs' },
  { name: '7-Zip', process: { win: '7zFM.exe' }, imageUrl: 'https://cdn.simpleicons.org/7zip' },
  { name: 'Paint.NET', process: { win: 'paintdotnet.exe' }, imageUrl: 'https://cdn.simpleicons.org/paintdotnet' },
  { name: 'FL Studio', process: { win: 'FL64.exe' }, imageUrl: 'https://cdn.simpleicons.org/flstudio' },
  { name: 'GitHub Desktop', process: { win: 'GitHubDesktop.exe' }, imageUrl: 'https://cdn.simpleicons.org/github' },
  // Item pedido: "adicione mais apps" — mais marcas de nome único
  // confirmadas no Simple Icons.
  { name: 'Obsidian', process: { win: 'Obsidian.exe', linux: 'obsidian' }, imageUrl: 'https://cdn.simpleicons.org/obsidian' },
  { name: 'Evernote', process: { win: 'Evernote.exe' }, imageUrl: 'https://cdn.simpleicons.org/evernote' },
  { name: 'Todoist', process: { win: 'Todoist.exe' }, imageUrl: 'https://cdn.simpleicons.org/todoist' },
  { name: 'DBeaver', process: { win: 'dbeaver.exe' }, imageUrl: 'https://cdn.simpleicons.org/dbeaver' },
  { name: 'MongoDB Compass', process: { win: 'MongoDBCompass.exe' }, imageUrl: 'https://cdn.simpleicons.org/mongodb' },
  { name: 'HeidiSQL', process: { win: 'heidisql.exe' }, imageUrl: 'https://cdn.simpleicons.org/mysql' },
  { name: 'Wireshark', process: { win: 'Wireshark.exe', linux: 'wireshark' }, imageUrl: 'https://cdn.simpleicons.org/wireshark' },
  { name: 'Warp Terminal', process: { win: 'Warp.exe' }, imageUrl: 'https://cdn.simpleicons.org/warp' },
  // PowerToys removido de propósito (item pedido) — fica rodando em
  // segundo plano o tempo todo pra quem usa, mesmo raciocínio do
  // Discord/Steam/navegadores já removidos antes.
  { name: 'Rufus', process: { win: 'rufus.exe' } },
  { name: 'HandBrake', process: { win: 'HandBrake.exe', linux: 'HandBrake' }, imageUrl: 'https://cdn.simpleicons.org/handbrake' },
  { name: 'ShareX', process: { win: 'ShareX.exe' }, imageUrl: 'https://cdn.simpleicons.org/sharex' },
  { name: 'MSI Afterburner', process: { win: 'MSIAfterburner.exe' } },
  { name: 'CPU-Z', process: { win: 'cpuz.exe', linux: 'cpuz' }, imageUrl: 'https://cdn.simpleicons.org/cpuz' },
  { name: 'Bitwarden', process: { win: 'Bitwarden.exe' }, imageUrl: 'https://cdn.simpleicons.org/bitwarden' },
  { name: 'Signal', process: { win: 'Signal.exe' }, imageUrl: 'https://cdn.simpleicons.org/signal' },
  { name: 'Element', process: { win: 'Element.exe' }, imageUrl: 'https://cdn.simpleicons.org/element' },
  { name: 'ClickUp', process: { win: 'ClickUp.exe' }, imageUrl: 'https://cdn.simpleicons.org/clickup' },
  { name: 'Linear', process: { win: 'Linear.exe' }, imageUrl: 'https://cdn.simpleicons.org/linear' },
  { name: 'Canva', process: { win: 'Canva.exe' }, imageUrl: 'https://cdn.simpleicons.org/canva' },
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
