"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseArgs = void 0;
const parseArgs = (args, types) => {
    if (types === 'string') {
        return args;
    }
    if (types === 'number') {
        const numbers = args.map(arg => Number(arg));
        if (numbers.every(n => !Number.isNaN(n))) {
            return numbers;
        }
        else {
            return null;
        }
    }
    if (args.length !== types.length) {
        return null;
    }
    const converted = args.map((arg, i) => types[i] === 'number' ? Number(arg) : arg);
    if (converted.every(arg => typeof arg === 'string' || !Number.isNaN(arg))) {
        return converted;
    }
    return null;
};
exports.parseArgs = parseArgs;
