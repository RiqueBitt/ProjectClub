"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOGIN_PORT = exports.WORLD_PORT = exports.LOGIN_DELTA = exports.WORLD_DELTA = void 0;
exports.getServerPopulation = getServerPopulation;
const constants_1 = require("../../common/constants");
exports.WORLD_DELTA = 2;
exports.LOGIN_DELTA = 1;
exports.WORLD_PORT = constants_1.HTTP_PORT + exports.WORLD_DELTA;
exports.LOGIN_PORT = constants_1.HTTP_PORT + exports.LOGIN_DELTA;
function getServerPopulation() {
    const seed = Math.random();
    if (seed < 0.1) {
        return 1;
    }
    else if (seed < 0.2) {
        return 2;
    }
    else if (seed < 0.3) {
        return 3;
    }
    else if (seed < 0.6) {
        return 4;
    }
    else if (seed < 0.8) {
        return 5;
    }
    else {
        return 6;
    }
}
// Project Club: um servidor só, em todos os idiomas (o jogo não oferece
// escolha; o nome aparece na tela de "servidores sugeridos" e no cartão).
const SERVER_NAME = process.env.WADDLE_SERVER_NAME || 'Project Club';
const Languages = [
    { lang: 'en', servers: [SERVER_NAME] },
    { lang: 'pt', servers: [SERVER_NAME] },
    { lang: 'fr', servers: [SERVER_NAME] },
    { lang: 'es', servers: [SERVER_NAME] }
];
let i = 0;
const locales = Languages.map((locale) => {
    return {
        lang: locale.lang,
        servers: locale.servers.map((name) => {
            const id = 3000 + i;
            i++;
            return { name, id };
        })
    };
});
const serverList = locales.reduce((accumulator, currentValue) => {
    return [...accumulator, ...currentValue.servers];
}, []);
exports.default = serverList;
