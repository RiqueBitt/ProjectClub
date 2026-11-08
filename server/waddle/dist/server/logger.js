"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logdebugerr = exports.getBlueString = exports.getYellowString = exports.getGreenString = exports.getRedString = void 0;
exports.logdebug = logdebug;
exports.logverbose = logverbose;
exports.templog = templog;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const constants_1 = require("../common/constants.js");
const getRedString = (str) => `${'\x1b[31m'}${str}${'\x1b[0m'}`;
exports.getRedString = getRedString;
const getGreenString = (str) => `${'\x1b[32m'}${str}${'\x1b[0m'}`;
exports.getGreenString = getGreenString;
const getYellowString = (str) => `${'\x1b[33m'}${str}${'\x1b[0m'}`;
exports.getYellowString = getYellowString;
const getBlueString = (str) => `${'\x1b[34m'}${str}${'\x1b[0m'}`;
exports.getBlueString = getBlueString;
/**
 * Used to log things in debugging
 */
function logdebug(...args) {
    if (constants_1.IS_DEV) {
        console.log(...args);
    }
}
const logdebugerr = (msg) => {
    logdebug((0, exports.getRedString)(msg));
};
exports.logdebugerr = logdebugerr;
function logverbose(...args) {
    if (process.env.VERBOSE === 'true') {
        console.log(...args);
    }
}
/** Use this for things that should be removed before commiting */
function templog(...args) {
    console.log(...args);
}
