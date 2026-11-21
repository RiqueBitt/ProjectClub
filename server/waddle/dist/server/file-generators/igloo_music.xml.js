"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIglooMusicXml = getIglooMusicXml;
const game_data_1 = require("../timelines/game-data.js");
/** Get the XML used by the dynamic igloo list tool for a given list */
function getListXml(list) {
    const flattened = [];
    // it is read from top to bottom, then left to right, so each column first
    for (let j = 0; j < game_data_1.COLS; j++) {
        for (let i = 0; i < game_data_1.ROWS; i++) {
            flattened.push(list[i][j]);
        }
    }
    return `<?xml version="1.0" encoding="utf-8"?>
<music>
  ${flattened.map((song) => {
        return `<song name="${song.display}" id="${song.id}" ${song.new ? 'bold="true"' : ''} />`;
    }).join('')}
</music>`;
}
/** Get the raw data for the dynamic music list in a given day */
function getIglooMusicXml(d) {
    const list = d.getIglooList();
    if (list === null) {
        return '';
    }
    return getListXml(list);
}
