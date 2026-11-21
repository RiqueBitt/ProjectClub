"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGamesJson = getGamesJson;
const utils_1 = require("../../common/utils.js");
const games_1 = require("../game-data/games.js");
const game_crumbs_1 = require("../game-data/game-crumbs");
function getGamesJson(d) {
    const json = JSON.parse(JSON.stringify(game_crumbs_1.GAME_CRUMBS));
    const music = d.getGamesMusic();
    (0, utils_1.iterateEntries)(games_1.GAMES, (name) => {
        const id = music.get(name);
        if (id !== undefined) {
            if (name in json) {
                json[name].music_id = String(id);
            }
        }
    });
    return JSON.stringify(json);
}
