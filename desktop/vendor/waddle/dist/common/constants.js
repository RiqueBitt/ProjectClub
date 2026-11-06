"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEBSITE = exports.IS_DEV = exports.HTTP_PORT = exports.NAME = exports.VERSION = void 0;
// Versão do Waddle Forever que foi incorporada ao Project Club (base do
// código em server/waddle). Mantida como constante em vez de ler o
// package.json do WF, que não existe mais aqui.
exports.VERSION = '1.5.1';
exports.NAME = 'Waddle Forever';
/** Porta padrão só do modo avulso (server/waddle/standalone). No Project
 * Club o jogo é servido pelo mesmo servidor HTTP do site. */
exports.HTTP_PORT = 24105;
exports.IS_DEV = process.env.NODE_ENV === 'dev' || process.env.NODE_ENV === 'development';
exports.WEBSITE = 'https://waddleforever.com';
