"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fromLE = fromLE;
exports.decompress = decompress;
exports.compress = compress;
exports.getSwfRectSizeBytes = getSwfRectSizeBytes;
exports.getFrameRateOffset = getFrameRateOffset;
exports.parseSwf = parseSwf;
const zlib_1 = __importDefault(require("zlib"));
function fromLE(...bytes) {
    let value = 0;
    bytes.forEach((byte, i) => {
        value += byte * 2 ** (8 * i);
    });
    return value;
}
function decompress(data) {
    const signature = String.fromCharCode(...data.slice(0, 3));
    if (signature === 'CWS') {
        return [signature, new Uint8Array([...data.slice(0, 8), ...zlib_1.default.inflateSync(data.slice(8))])];
    }
    return [signature, data];
}
function compress(signature, data) {
    if (signature === 'CWS') {
        return new Uint8Array([...data.slice(0, 8), ...zlib_1.default.deflateSync(data.slice(8))]);
    }
    return data;
}
function getSwfRectSizeBytes(data) {
    const byte = data[8];
    const rectSize = byte >> 3;
    return Math.ceil((rectSize * 4 + 5) / 8);
}
function getFrameRateOffset(rectSize) {
    return 9 + rectSize;
}
function parseSwf(data) {
    data = decompress(data)[1];
    const version = data[3];
    const rectByteSize = getSwfRectSizeBytes(data);
    const frameRate = data[getFrameRateOffset(rectByteSize)];
    const frameCount = fromLE(...data.slice(10 + rectByteSize, 12 + rectByteSize));
    const header = {
        rect: data.slice(8, 8 + rectByteSize),
        frameCount,
        version,
        framerate: frameRate
    };
    const tags = [];
    let i = 12 + rectByteSize;
    while (i < data.length) {
        const tagBytes = data.slice(i, i + 2);
        const tagType = (tagBytes[1] << 2) + (tagBytes[0] >> 6);
        let tagLength = tagBytes[0] & 0x3F;
        let tagOffset = i + 2;
        if (tagLength === 0x3F) {
            tagLength = fromLE(...data.slice(i + 2, i + 6));
            tagOffset += 4;
        }
        const tagContent = data.slice(tagOffset, tagOffset + tagLength);
        tags.push({
            type: tagType,
            content: new Uint8Array(tagContent)
        });
        i = tagOffset + tagLength;
    }
    return {
        header,
        tags
    };
}
