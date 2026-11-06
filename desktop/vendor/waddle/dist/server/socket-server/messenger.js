"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PenguinMessenger = void 0;
const logger_1 = require("../logger.js");
const world_penguin_1 = require("./world/world-penguin.js");
const getXtMessageLastless = (handler, ...args) => {
    return `%xt%${handler}%-1%` + args.join('%');
};
const getXtMessage = (handler, ...args) => {
    return getXtMessageLastless(handler, ...args) + '%';
};
class PenguinMessenger {
    _clients = new Map();
    _penguins = new Map();
    getPenguin(client) {
        return this._penguins.get(client);
    }
    linkClient(client, penguin) {
        this._clients.set(penguin, client);
        this._penguins.set(client, penguin);
    }
    unlinkClient(penguin) {
        const client = this._clients.get(penguin);
        if (client !== undefined) {
            this._penguins.delete(client);
        }
        this._clients.delete(penguin);
    }
    async write(ps, message) {
        if (!Array.isArray(ps)) {
            ps = [ps];
        }
        await Promise.all(ps.map(p => (p instanceof world_penguin_1.WorldPenguin ? this._clients.get(p) : p)?.write(message)));
    }
    async send(penguins, message, ...args) {
        (0, logger_1.logverbose)((0, logger_1.getGreenString)('sending XT: '), message, args);
        await this.write(penguins, getXtMessage(message, ...args));
    }
    async sendXml(client, action, body, room) {
        const roomString = room === undefined ? '' : ` r="${room}"`;
        const xml = `<msg t="sys"><body action="${action}"${roomString}>${body}</body></msg>`;
        (0, logger_1.logverbose)((0, logger_1.getYellowString)('Sending XML: '), xml);
        await this.write(client, xml);
    }
    close() {
        for (const client of this._clients.values()) {
            client.end();
        }
    }
    getClients() {
        return [...this._clients.values()];
    }
    getClient(p) {
        const cs = this._clients.get(p);
        if (cs === undefined) {
            throw new Error('No client socket bound to penguin');
        }
        return cs;
    }
}
exports.PenguinMessenger = PenguinMessenger;
