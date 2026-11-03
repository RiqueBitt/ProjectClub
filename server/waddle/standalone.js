#!/usr/bin/env node
// Modo avulso (desenvolvimento): sobe o Club Penguin sozinho, sem o resto do
// Project Club — HTTP na porta 24105 e os servidores de login/mundo nas
// portas seguintes, pinguins em arquivos JSON (server/data/waddle/data).
// Útil pra testar o jogo em si; a página do site não é usada aqui.
//   WADDLE_MEDIA_DIR=/caminho/da/midia npm run waddle:standalone
require('./dist/server/main.js');
