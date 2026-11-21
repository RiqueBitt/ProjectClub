"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpServer = void 0;
const express_1 = __importDefault(require("express"));
const file_server_1 = require("../file-server/index.js");
const constants_1 = require("../../common/constants.js");
const php_server_1 = require("./php-server");
class HttpServer {
    fileServer;
    phpServer;
    constructor(gameData, settings, db) {
        this.fileServer = new file_server_1.FileServer(gameData, settings);
        this.phpServer = new php_server_1.PhpServer(settings, db, gameData);
    }
    /** Router com tudo que o jogo pede por HTTP (arquivos, PHP emulado). */
    getRouter() {
        const router = express_1.default.Router();
        router.use(this.fileServer.getExpressRouter());
        router.use(this.phpServer.getExpressRouter());
        return router;
    }
    getFileServer() {
        return this.fileServer;
    }
    async setupServer() {
        const app = (0, express_1.default)();
        app.use(this.fileServer.getExpressRouter());
        app.use(this.phpServer.getExpressRouter());
        await new Promise((resolve, reject) => {
            app.listen(constants_1.HTTP_PORT, () => {
                console.log(`HTTP server listening on port ${constants_1.HTTP_PORT}`);
                resolve();
            }).on('error', (err) => {
                reject(err);
            });
        });
    }
}
exports.HttpServer = HttpServer;
