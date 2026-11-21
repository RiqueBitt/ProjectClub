"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TagType = void 0;
exports.emitCrumbSwf = emitCrumbSwf;
exports.emitSwf = emitSwf;
const bytes_1 = require("./bytes");
function createHeader(header, headerlessFileSize) {
    const headerBytes = 12 + header.rect.length;
    return new Uint8Array([
        0x46, // F
        0x57, // W
        0x53, // S
        header.version,
        ...(0, bytes_1.to4BytesLittleEndian)(headerlessFileSize + headerBytes),
        ...header.rect,
        0x00, // ignored byte
        header.framerate, // FPS
        ...(0, bytes_1.to2BytesLittleEndian)(header.frameCount)
    ]);
}
var TagType;
(function (TagType) {
    TagType[TagType["FileAttributes"] = 69] = "FileAttributes";
    TagType[TagType["SetBackgroundColor"] = 9] = "SetBackgroundColor";
    TagType[TagType["DoAction"] = 12] = "DoAction";
    TagType[TagType["ShowFrame"] = 1] = "ShowFrame";
    TagType[TagType["End"] = 0] = "End";
})(TagType || (exports.TagType = TagType = {}));
function emitCrumbSwf(code) {
    return emitSwf({
        header: {
            version: 9,
            framerate: 24,
            frameCount: 1,
            // hardcoded rect
            rect: new Uint8Array([
                0x78,
                0x00,
                0x07,
                0x6C,
                0x00,
                0x00,
                0x12,
                0xC0,
                0x00
            ])
        },
        tags: [
            {
                type: TagType.FileAttributes,
                content: new Uint8Array([0, 0, 0, 0])
            },
            {
                type: TagType.SetBackgroundColor,
                content: new Uint8Array([0xFF, 0xFF, 0xFF])
            },
            {
                type: TagType.DoAction,
                content: code
            },
            {
                type: TagType.ShowFrame,
                content: new Uint8Array([])
            },
            {
                type: TagType.End,
                content: new Uint8Array([])
            }
        ]
    });
}
function emitSwf(content) {
    const bytes = [];
    const headerless = content.tags.flatMap(tag => {
        const bytes = [];
        const length = tag.content.length;
        bytes.push(((tag.type & 0x03) << 6) | (length < 0x3F ? length : 0x3F));
        bytes.push(tag.type >> 2);
        if (length >= 0x3F) {
            bytes.push(...(0, bytes_1.to4BytesLittleEndian)(length));
        }
        tag.content.forEach(byte => bytes.push(byte));
        return bytes;
    });
    createHeader(content.header, headerless.length).forEach(byte => bytes.push(byte));
    headerless.forEach(value => {
        bytes.push(value);
    });
    return new Uint8Array(bytes);
}
