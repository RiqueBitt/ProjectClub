"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchSwf = patchSwf;
exports.isPatchedRoute = isPatchedRoute;
/**
 * Pequenos consertos binários em SWFs do jogo (Project Club).
 *
 * interface.swf (2011+): o Project Club entra pela "entrada automática" do
 * próprio cliente (flashvars nau/nal) pra pular a tela de login. Em 2012 a
 * Disney só usava isso logo depois de criar um pinguim, pra rodar o guia de
 * novato — e a interface ESCONDE a barra do jogo (chat, frases prontas,
 * emotes, jornal, correio) quando `_localLoginServerData.autoLogin` está
 * ligado, esperando o módulo do guia (intro_to_cp.swf, que não existe na
 * mídia) mandar mostrar de volta. Resultado: jogo sem chat.
 *
 * Conserto: dentro do interface.swf o nome da propriedade `autoLogin` vira
 * `autoLogXn` (mesmo tamanho). Todas as checagens de "novato" da interface
 * leem undefined → comportamento de jogador normal. O shell (que faz o
 * login automático de verdade) continua igual.
 */
const zlib_1 = __importDefault(require("zlib"));
const PATCHES = [
    {
        test: (route) => /(^|\/)play\/v2\/content\/global\/content\/interface\.swf$/.test(route),
        patches: [{ from: 'autoLogin\0', to: 'autoLogXn\0' }],
    },
];
const cache = new Map(); // route+tamanho → resultado
function replaceAll(buf, from, to) {
    let out = buf;
    let i = out.indexOf(from);
    while (i !== -1) {
        out = Buffer.concat([out.subarray(0, i), to, out.subarray(i + from.length)]);
        i = out.indexOf(from, i + to.length);
    }
    return out;
}
/** Aplica os consertos de `route` (se houver). Mantém compressão e cabeçalho do SWF. */
function patchSwf(route, data) {
    const rule = PATCHES.find((p) => p.test(route));
    if (rule === undefined || typeof data === 'string' || data.length < 8)
        return data;
    const key = `${route}:${data.length}`;
    const hit = cache.get(key);
    if (hit !== undefined)
        return hit;
    const sig = data.subarray(0, 3).toString('latin1');
    if (sig !== 'CWS' && sig !== 'FWS')
        return data;
    let body = sig === 'CWS' ? zlib_1.default.inflateSync(data.subarray(8)) : data.subarray(8);
    for (const p of rule.patches) {
        const from = Buffer.from(p.from, 'latin1');
        const to = Buffer.from(p.to, 'latin1');
        if (from.length !== to.length)
            continue; // só troca do mesmo tamanho (não mexe em offsets)
        body = replaceAll(body, from, to);
    }
    const header = Buffer.from(data.subarray(0, 8));
    header.writeUInt32LE(body.length + 8, 4); // tamanho descomprimido (igual ao original)
    const out = sig === 'CWS' ? Buffer.concat([header, zlib_1.default.deflateSync(body, { level: 9 })]) : Buffer.concat([header, body]);
    cache.set(key, out);
    return out;
}
function isPatchedRoute(route) {
    return PATCHES.some((p) => p.test(route));
}
