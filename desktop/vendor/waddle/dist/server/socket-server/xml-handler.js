"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.XmlHandler = void 0;
const logger_1 = require("../logger.js");
const parseXmlMessage = (message) => {
    if (message === '<policy-file-request/>') {
        return ['policy', message];
    }
    else {
        const actionMatch = message.match(/action='(\w+)'/);
        const action = actionMatch === null ? '' : actionMatch[1];
        return [action, message];
    }
};
class XmlHandler {
    _callbacks;
    constructor(_callbacks) {
        this._callbacks = _callbacks;
    }
    handle(context, message) {
        (0, logger_1.logverbose)((0, logger_1.getYellowString)('Incoming XML data: '), message);
        const [action, data] = parseXmlMessage(message);
        const callback = this._callbacks.get(action);
        if (callback !== undefined) {
            callback(context, data);
        }
    }
}
exports.XmlHandler = XmlHandler;
