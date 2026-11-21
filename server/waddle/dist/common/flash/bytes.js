"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.to2BytesLittleEndian = to2BytesLittleEndian;
exports.to4BytesLittleEndian = to4BytesLittleEndian;
function to2BytesLittleEndian(num) {
    return [num & 0xff, (num >> 8) & 0xff];
}
function to4BytesLittleEndian(num) {
    return [
        num & 0xff,
        (num >> 8) & 0xff,
        (num >> 16) & 0xff,
        (num >> 24) & 0xff,
    ];
}
