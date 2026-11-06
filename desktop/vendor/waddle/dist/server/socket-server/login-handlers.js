"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLoginXmlHandler = void 0;
const login_1 = require("./handlers/login");
const xml_handler_1 = require("./xml-handler");
const createLoginXmlHandler = () => {
    return new xml_handler_1.XmlHandler(new Map([
        ['policy', login_1.filePolicy],
        ['verChk', login_1.checkVersion],
        ['rndK', login_1.getKey],
        ['login', login_1.login]
    ]));
};
exports.createLoginXmlHandler = createLoginXmlHandler;
