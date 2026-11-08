"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.XtHandler = exports.unhandledXt = void 0;
const arg_parser_1 = require("./arg-parser.js");
const logger_1 = require("../logger.js");
const parseXtMessage = (message) => {
    const values = message.split('%');
    if (values[1] !== 'xt') {
        throw new Error(`Invalid XT message: ${message}`);
    }
    const name = values.slice(2, 4).join('%');
    const args = values.slice(5, values.length - 1); // last is empty
    return [name, args];
};
class CallbackManager {
    _callback;
    _cooldown = null;
    _once = false;
    _handled = new Map();
    _timestamps = new Map();
    constructor(_callback, params) {
        this._callback = _callback;
        if (params?.cooldown !== undefined) {
            this._cooldown = params.cooldown;
        }
        if (params?.once !== undefined) {
            this._once = params.once;
        }
    }
    call(client, ctx, ...args) {
        if (this._cooldown !== null) {
            const last = this._timestamps.get(client);
            if (last !== undefined && last + this._cooldown > Date.now()) {
                console.log('Rate limited');
                return;
            }
        }
        if (this._once) {
            if (this._handled.get(client)) {
                console.log('Already handled');
                return;
            }
        }
        this._callback(ctx, ...args);
    }
}
/** Comandos que o jogo mandou e o servidor não tratou (pra achar sistemas faltando). */
exports.unhandledXt = new Map();
function reportUnhandled(key) {
    const n = (exports.unhandledXt.get(key) ?? 0) + 1;
    exports.unhandledXt.set(key, n);
    if (n === 1 && exports.unhandledXt.size <= 500)
        console.log('[waddle] XT sem tratamento:', key);
}
class XtHandler {
    _disconnect;
    _callbacks;
    constructor(callbacks, _disconnect) {
        this._disconnect = _disconnect;
        this._callbacks = new Map(callbacks.map(([key, value]) => [key, value.map(([pair, args, callback, params]) => [pair, args, new CallbackManager(callback, params)])]));
    }
    handle(client, context, message) {
        const [name, args] = parseXtMessage(message);
        if ('penguin' in context) {
            (0, logger_1.logverbose)((0, logger_1.getBlueString)(`incoming XT [${context.penguin.name}]: `), name, args);
        }
        const callbacks = this._callbacks.get(name);
        if (callbacks !== undefined) {
            const callbackInfo = callbacks.find(([[contextTester, guard]]) => contextTester(context) ? guard(context) : false);
            if (callbackInfo === undefined) {
                reportUnhandled(name + ' (contexto)');
                (0, logger_1.logverbose)((0, logger_1.getRedString)('unhandled XT for given context: ' + Object.keys(context).join(';')));
                return;
            }
            const [_, signature, callback] = callbackInfo;
            const parsedArgs = (0, arg_parser_1.parseArgs)(args, signature);
            if (parsedArgs === null) {
                reportUnhandled(name + ' (argumentos: ' + args.join('|').slice(0, 80) + ')');
                (0, logger_1.logverbose)((0, logger_1.getRedString)('incorrect type signature: ' + name));
            }
            else {
                callback.call(client, context, ...parsedArgs);
            }
        }
        else {
            reportUnhandled(name);
            (0, logger_1.logverbose)((0, logger_1.getRedString)('unhandled XT: ' + name));
        }
    }
    async disconnect(context) {
        await this._disconnect(context);
    }
}
exports.XtHandler = XtHandler;
