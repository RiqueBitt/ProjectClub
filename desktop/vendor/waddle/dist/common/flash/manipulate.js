"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replaceConstants = replaceConstants;
exports.changeFrameRate = changeFrameRate;
const parser_1 = require("./parser");
const emitter_1 = require("./emitter");
const bytes_1 = require("./bytes");
const avm1_1 = require("./avm1");
/**
 * This function allows to replace the string constants of a SWF file. This is used to serve a SWF file but changing the value of certain strings when the server gives the file (dynamically changing)
 * Keep in mind for this to work you just have to make sure that you have a string in the constant pool starting with the given prefix below
 */
function replaceConstants(binary, constantValues) {
    const swf = (0, parser_1.parseSwf)(new Uint8Array(binary));
    const PREFIX = "##";
    swf.tags.forEach(tag => {
        if (tag.type === emitter_1.TagType.DoAction) {
            if (tag.content[0] === avm1_1.Action.ConstantPool) {
                const content = [...tag.content];
                const length = (0, parser_1.fromLE)(...content.splice(1, 2));
                const countLength = 2;
                const count = (0, parser_1.fromLE)(...content.splice(1, countLength));
                const constantBytes = content.splice(1, length - countLength);
                const strings = [];
                let current = [];
                constantBytes.forEach(byte => {
                    if (byte === 0) {
                        strings.push(new TextDecoder().decode(new Uint8Array(current)));
                        current = [];
                    }
                    else {
                        current.push(byte);
                    }
                });
                for (let i = 0; i < strings.length; i++) {
                    if (strings[i].startsWith(PREFIX)) {
                        const key = strings[i].slice(PREFIX.length);
                        const replacement = constantValues[key];
                        if (replacement !== undefined) {
                            strings[i] = replacement;
                        }
                    }
                }
                const constantPool = [...(0, bytes_1.to2BytesLittleEndian)(count)];
                strings.forEach(str => {
                    constantPool.push(...new TextEncoder().encode(str), 0x0);
                });
                constantPool.splice(0, 0, ...(0, bytes_1.to2BytesLittleEndian)(constantPool.length));
                content.splice(1, 0, ...constantPool);
                tag.content = new Uint8Array(content);
            }
        }
    });
    return Buffer.from((0, emitter_1.emitSwf)(swf));
}
function changeFrameRate(binary, framerate) {
    const [signature, data] = (0, parser_1.decompress)(new Uint8Array(binary));
    data[(0, parser_1.getFrameRateOffset)((0, parser_1.getSwfRectSizeBytes)(data))] = framerate;
    return Buffer.from((0, parser_1.compress)(signature, data));
}
