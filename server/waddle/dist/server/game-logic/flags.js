"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFlag = isFlag;
function isFlag(item) {
    return ((item >= 500 && item <= 548) ||
        (item >= 7095 && item <= 7096) ||
        (item === 7148) ||
        (item >= 7182 && item <= 7189));
}
