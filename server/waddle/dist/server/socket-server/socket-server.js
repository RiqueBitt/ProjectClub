"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSocketServer = void 0;
exports.attachWebSocket = attachWebSocket;
const net_1 = __importDefault(require("net"));
const ws_1 = require("ws");
const parseHeaders = (data) => {
    const lines = data.split('\r\n');
    const entries = lines.slice(1)
        .map(line => line.split(': '))
        .filter(([key, value]) => key && value)
        .map(([key, value]) => [key.toLowerCase(), value]);
    return Object.fromEntries(entries);
};
function attachWebSocket(name, ws, handler, transform) {
    const cs = {
        write: async (message) => {
            return new Promise((resolve, reject) => {
                if (ws.readyState !== ws.OPEN) {
                    resolve();
                    return;
                }
                ws.send(Buffer.from(message + '\0', 'utf8'), { binary: true }, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
            });
        },
        end: (d) => {
            try {
                ws.close(undefined, d);
            }
            catch {
                // já fechado
            }
        },
        buffer: ''
    };
    // pacotes processados em ordem, um por vez (o transform pode ser assíncrono)
    let queue = Promise.resolve();
    ws.on('message', (data) => {
        // um frame pode trazer mais de um pacote (ou meio pacote): junta pelo \0
        const packets = (cs.buffer + data.toString()).split('\0');
        cs.buffer = packets.pop() ?? '';
        for (const packet of packets) {
            if (packet.length === 0 || packet.startsWith('GET'))
                continue;
            queue = queue.then(async () => {
                let final = packet;
                if (transform !== undefined) {
                    final = await transform(packet);
                }
                if (final !== null) {
                    handler.handle(cs, final);
                }
            }).catch((err) => console.error(`[waddle] erro tratando pacote de ${name}:`, err?.message ?? err));
        }
    });
    let closed = false;
    ws.on('close', () => {
        if (closed)
            return;
        closed = true;
        handler.disconnect(cs).then(() => {
            cs.end();
            console.log(`[waddle] cliente saiu de ${name} (WebSocket)`);
        });
    });
    ws.on('error', (err) => console.error(`[waddle] erro no WebSocket de ${name}:`, err?.message ?? err));
    return cs;
}
const setupSocketServer = async (name, port, handler) => {
    await new Promise((resolve, reject) => {
        const wsServer = new ws_1.WebSocketServer({ noServer: true });
        wsServer.on('connection', (ws) => {
            console.log(`A client has connected to ${name} (WebSocket)`);
            attachWebSocket(name, ws, handler);
        });
        net_1.default.createServer((socket) => {
            socket.once('data', (buffer) => {
                const dataStr = buffer.toString();
                if (dataStr.startsWith('GET')) {
                    const headerEnd = dataStr.indexOf('\r\n\r\n');
                    if (headerEnd === -1) {
                        socket.destroy();
                        return;
                    }
                    const requestText = dataStr.slice(0, headerEnd + 4);
                    const head = Buffer.from(dataStr.slice(headerEnd + 4), 'binary');
                    // This is a websocket connection.
                    // Only the bytes after the HTTP upgrade headers belong in the ws "head" buffer.
                    // objeto mínimo no lugar do IncomingMessage (o ws só lê headers/method/url)
                    wsServer.handleUpgrade({
                        headers: parseHeaders(requestText),
                        method: 'GET',
                        socket,
                        url: '/',
                    }, socket, head, (ws) => {
                        wsServer.emit('connection', ws, { headers: parseHeaders(requestText), method: 'GET' });
                    });
                }
                else {
                    socket.setEncoding('utf8');
                    console.log(`A client has connected to ${name}`);
                    const cs = {
                        write: async (message) => {
                            return new Promise((resolve, reject) => {
                                socket.write(message + '\0', (err) => {
                                    if (err) {
                                        reject(err);
                                    }
                                    resolve();
                                });
                            });
                        },
                        end: (d) => {
                            if (d === undefined) {
                                socket.end();
                            }
                            else {
                                socket.end(d);
                            }
                        },
                        buffer: ''
                    };
                    socket.on('data', (data) => {
                        const packets = (cs.buffer + data.toString()).split('\0');
                        cs.buffer = packets.pop() ?? '';
                        for (const packet of packets) {
                            if (packet.length > 0) {
                                handler.handle(cs, packet);
                            }
                        }
                    });
                    socket.on('close', () => {
                        handler.disconnect(cs).then(() => {
                            cs.end();
                            console.log('A client has disconnected');
                        });
                    });
                    // Re-emit the data so the TCP handler gets the first packet too
                    socket.emit('data', buffer);
                    socket.on('error', console.error);
                }
            });
        }).listen(port, () => {
            console.log(`${name} server listening on port ${port}`);
            resolve();
        }).on('error', (err) => {
            reject(err);
        });
    });
};
exports.setupSocketServer = setupSocketServer;
