"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.monthNames = exports.doubleFilter = exports.EventListener = exports.Vector = exports.modulo = exports.DEFAULT_DIRECTORY = exports.MEDIA_DIRECTORY = exports.logError = exports.postJSON = void 0;
exports.makeUrl = makeUrl;
exports.addDispatchEventListeners = addDispatchEventListeners;
exports.parseURL = parseURL;
exports.getDateString = getDateString;
exports.runCommand = runCommand;
exports.randomInt = randomInt;
exports.choose = choose;
exports.chooseN = chooseN;
exports.isPositiveInteger = isPositiveInteger;
exports.findIndexLeftOf = findIndexLeftOf;
exports.getFilesInDirectory = getFilesInDirectory;
exports.iterateEntries = iterateEntries;
exports.readFile = readFile;
exports.writeFile = writeFile;
exports.toForwardSlash = toForwardSlash;
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const constants_1 = require("./constants");
const paths_1 = require("./paths");
const child_process_1 = require("child_process");
function makeUrl(ip, port) {
    return `http://${ip}:${port}`;
}
function addDispatchEventListeners(events, ipcRenderer) {
    events.forEach((eName) => {
        ipcRenderer.on(eName, (e, arg) => {
            const newEvent = new CustomEvent(eName, { detail: arg });
            window.dispatchEvent(newEvent);
        });
    });
}
function parseURL(url) {
    const [protocol, rest] = url.split('://');
    if (protocol !== 'http' && protocol !== 'https') {
        throw new Error('');
    }
    const slashSplit = rest.split('/');
    const urlBody = slashSplit.shift();
    if (urlBody === undefined) {
        throw new Error('This error should be impossible.');
    }
    const portSplit = urlBody.split(':');
    const host = portSplit[0];
    const portString = portSplit[1];
    let port;
    if (portString === undefined) {
        port = protocol === 'http' ? 80 : 443;
    }
    else {
        port = Number(portString);
    }
    const path = '/' + slashSplit.join('/');
    return {
        protocol: protocol,
        host,
        path,
        port
    };
}
const postJSON = async (path, body) => {
    const urlData = parseURL(`${constants_1.WEBSITE}${path}`);
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await new Promise((resolve, reject) => {
            let output = '';
            const requestModule = urlData.protocol === 'https' ? https_1.default : http_1.default;
            const req = requestModule.request({
                host: urlData.host,
                path: urlData.path,
                port: urlData.port,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Nodejs'
                }
            }, (res) => {
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                    output += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Request failed with status ${res.statusCode}: ${output}`));
                        return;
                    }
                    try {
                        const obj = JSON.parse(output);
                        resolve(obj);
                    }
                    catch (error) {
                        reject(`The endpoint was successful but returned invalid JSON data: ${output}`);
                    }
                });
            });
            req.on('error', (err) => {
                reject(err);
            });
            req.write(JSON.stringify(body));
            req.end();
        });
    }
    catch (error) {
        console.log(`There was an error with the POST request to path ${path}: ${error}`);
        return undefined;
    }
};
exports.postJSON = postJSON;
function getDateString(timestamp) {
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    return `${year}-${month}-${day}`;
}
/** Runs a command in the current shell, asynchronously. */
async function runCommand(command) {
    await new Promise((resolve, reject) => {
        (0, child_process_1.exec)(command, (err, stdout, stder) => {
            if (err === null) {
                resolve();
            }
            else {
                reject(err);
            }
        });
    });
}
/** Function for logging more silent errors in production */
const logError = (message, error) => {
    const logDir = path_1.default.join(paths_1.USER_DATA_FOLDER, 'logs');
    if (!fs_1.default.existsSync(logDir)) {
        fs_1.default.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path_1.default.join(logDir, 'logs.txt');
    fs_1.default.appendFileSync(logFile, `${message}: ${error}\n`);
};
exports.logError = logError;
/**
 * Pasta local com a mídia do jogo (SWFs). No Project Club ela é um CACHE:
 * o que não estiver aqui é baixado do bucket (ver ./media-store).
 * WADDLE_MEDIA_DIR → caminho absoluto (padrão: server/data/waddle/media)
 */
exports.MEDIA_DIRECTORY = process.env.WADDLE_MEDIA_DIR
    ? path_1.default.resolve(process.env.WADDLE_MEDIA_DIR)
    : path_1.default.join(paths_1.USER_DATA_FOLDER, 'media');
exports.DEFAULT_DIRECTORY = path_1.default.join(exports.MEDIA_DIRECTORY, 'default');
/** Gets a random integer between minimum and max, both included */
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}
/** Gets random element from an array */
function choose(array) {
    return array[randomInt(0, array.length - 1)];
}
const modulo = (a, b) => a - Math.floor(a / b) * b;
exports.modulo = modulo;
function chooseN(array, n) {
    const chosen = [];
    for (let i = 0; i < n; i++) {
        if (array.length === 0) {
            return chosen;
        }
        const randomIndex = randomInt(0, array.length - 1);
        const element = array.splice(randomIndex, 1)[0];
        chosen.push(element);
    }
    return chosen;
}
function isPositiveInteger(n) {
    return n > 0 && !isNaN(n) && Number.isInteger(n);
}
/**
 * Find in an array that is sorted, the first index that corresponds to a value which is the last one that is "smaller"
 * than the value being compared.
 *
 * For example, with numbers, if you had [1, 3, 5, 8], and you search for the value "4", it would return index 1 since 4 >= 3, 4 < 5.
 * @param value Value to compare
 * @param array Array that is sorted to some capacity
 * @param isGreaterOrEqual Function that evaluates if the value is greater or equal to the given index of the array
 * @returns Index found, or -1 if the value given is "smaller" than everything in the array
 */
function findIndexLeftOf(value, array, isGreaterOrEqual) {
    let index = -1;
    // TODO binary searching instead of this
    for (let i = 0; i < array.length; i++) {
        if (!isGreaterOrEqual(value, array, i)) {
            break;
        }
        index = i;
    }
    return index;
}
/**
 * Given a directory, returns a list of all the files in the directory as paths relative to the given directory
 */
function getFilesInDirectory(basePath, relativePath = '') {
    const fileNames = [];
    const absolutePath = path_1.default.join(basePath, relativePath);
    const files = fs_1.default.readdirSync(absolutePath);
    files.forEach((file) => {
        const fileAbsolutePath = path_1.default.join(absolutePath, file);
        const fileRelativePath = path_1.default.join(relativePath, file);
        if (fs_1.default.lstatSync(fileAbsolutePath).isDirectory()) {
            const childFiles = getFilesInDirectory(basePath, fileRelativePath);
            fileNames.push(...childFiles);
        }
        else {
            fileNames.push(fileRelativePath);
        }
    });
    return fileNames;
}
/**
 * Iterate through all entries of an object, calling a function that takes the key and value as arguments
 */
function iterateEntries(obj, callback) {
    Object.entries(obj).forEach((pair) => {
        const [key, value] = pair;
        callback(key, value);
    });
}
/** 2-Dimensional vector */
class Vector {
    _vector;
    constructor(x, y) {
        this._vector = [x, y];
    }
    get vector() {
        return this._vector;
    }
    get length() {
        return this._vector.length;
    }
    copy() {
        return new Vector(...this.vector);
    }
    add(other) {
        const vector = this.copy();
        for (let i = 0; i < this._vector.length; i++) {
            vector.vector[i] += other.vector[i];
        }
        return vector;
    }
}
exports.Vector = Vector;
/** Helper class for building an event with functions to fire when the event happens */
class EventListener {
    listeners = [];
    addListener(callback) {
        this.listeners.push(callback);
    }
    fire() {
        this.listeners.forEach(callback => callback());
    }
}
exports.EventListener = EventListener;
async function readFile(filePath) {
    return new Promise((resolve, reject) => {
        fs_1.default.readFile(filePath, (err, data) => {
            if (err) {
                reject(err);
            }
            resolve(data);
        });
    });
}
async function writeFile(filePath, content) {
    return new Promise((resolve, reject) => {
        fs_1.default.writeFile(filePath, content, (err) => {
            if (err) {
                reject(err);
            }
            resolve();
        });
    });
}
function toForwardSlash(s) {
    return s.replaceAll('\\', '/');
}
const doubleFilter = (predicate, arr) => {
    const include = [];
    const exclude = [];
    arr.forEach(e => predicate(e) ? include.push(e) : exclude.push(e));
    return [include, exclude];
};
exports.doubleFilter = doubleFilter;
exports.monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
];
