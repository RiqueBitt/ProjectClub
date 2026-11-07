"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVersionTxt = getVersionTxt;
/** Get the version.txt file used in preCPIP */
function getVersionTxt(d) {
    const version = d.getChatVersion();
    return `&v=${version}\n`;
}
