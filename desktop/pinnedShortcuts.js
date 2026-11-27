'use strict';
// Quando o instalador muda o app de pasta, o ícone que a pessoa fixou na barra de tarefas
// continua apontando pro .exe antigo, e o Windows avisa que "este item foi movido ou alterado".
// Os ícones fixados são atalhos .lnk comuns numa pasta do perfil: aqui os que apontavam pro
// .exe antigo passam a apontar pro novo. Atalho de outro programa não é tocado.
const path = require('path').win32;

const samePath = (a, b) => !!a && !!b && path.normalize(String(a)).toLowerCase() === path.normalize(String(b)).toLowerCase();

// Devolve quantos atalhos foram corrigidos. `fs` e `shell` (do Electron) vêm de fora pra dar pra testar.
function repointPinnedShortcuts({ oldExe, newExe, appData, fs, shell }) {
  if (!oldExe || !newExe || !appData || samePath(oldExe, newExe)) return 0;
  const root = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned');
  const dirs = [path.join(root, 'TaskBar')];
  try {
    for (const sub of fs.readdirSync(path.join(root, 'ImplicitAppShortcuts'))) dirs.push(path.join(root, 'ImplicitAppShortcuts', sub));
  } catch { /* pasta não existe: normal */ }

  let fixed = 0;
  for (const dir of dirs) {
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!/\.lnk$/i.test(name)) continue;
      const lnk = path.join(dir, name);
      try {
        const current = shell.readShortcutLink(lnk);
        if (!samePath(current.target, oldExe)) continue;
        const change = { target: newExe, cwd: path.dirname(newExe) };
        if (samePath(current.icon, oldExe)) { change.icon = newExe; change.iconIndex = current.iconIndex || 0; }
        if (shell.writeShortcutLink(lnk, 'update', change)) fixed += 1;
      } catch { /* atalho que não dá pra ler: fica como está */ }
    }
  }
  return fixed;
}

module.exports = { repointPinnedShortcuts, samePath };
