"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.overrideLoadSwf = overrideLoadSwf;
const manipulate_1 = require("../../../common/flash/manipulate.js");
async function overrideLoadSwf(_, s, b) {
    if (typeof b === 'string') {
        b = Buffer.from(b);
    }
    return (0, manipulate_1.replaceConstants)(b, {
        PORT: String(s.worldPort),
        IP: s.targetIP,
        URLPRE: `http://${s.targetIP.slice(0, 3)}`
    });
}
