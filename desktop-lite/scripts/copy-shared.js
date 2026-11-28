'use strict';
// O Lite reaproveita três módulos do app completo (desktop/), que não
// dependem de nada além do próprio Electron: regras de segurança, links
// projectclub:// e a janelinha de "Entrar com Discord/GitHub". Eles são
// copiados pra shared/ antes de rodar ou gerar o instalador (o
// electron-builder só empacota o que está dentro desta pasta).
const fs = require('fs');
const path = require('path');

const FILES = ['security.js', 'deepLinks.js', 'oauthWindow.js'];
const from = path.join(__dirname, '..', '..', 'desktop');
const to = path.join(__dirname, '..', 'shared');
fs.mkdirSync(to, { recursive: true });
for (const f of FILES) {
  fs.copyFileSync(path.join(from, f), path.join(to, f));
  console.log(`shared/${f}`);
}
