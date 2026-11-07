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
 *
 * Também no interface.swf: um DoAction a mais no 1º quadro (depois do script
 * principal) põe os botões de voz Falar/Ouvir DENTRO da barra do jogo — ver
 * praca-voice-action.ts (gerado de server/waddle/praca-voice/).
 *
 * shell.swf: um DoAction a mais no 1º quadro conserta o teleporte saindo do
 * Pátio do Dojo (o shell mandava pra uma sala de 2013 que prende o pinguim) —
 * ver praca-shell-action.ts (gerado de server/waddle/praca-voice/shell.as).
 *
 * igloo.swf: um DoAction a mais no 1º quadro mostra, ao soltar um móvel no
 * editor do iglu, um painel com o móvel em cada direção (antes só dava pra
 * girar com as setas do teclado enquanto arrastava) — praca-igloo-action.ts.
 *
 * backyard.swf: um DoAction a mais no 1º quadro põe o cenário do LOCAL do
 * iglu atrás do quintal (a mídia só tem o 1_backyard.swf, então trocar o fundo
 * do iglu não mudava o quintal) — praca-backyard-action.ts.
 *
 * map.swf: os cenários do Project Club (server/waddle/praca-lago/icons.json) —
 * no 1º quadro entram os ícones (símbolos exportados) e um DoAction que os põe
 * clicáveis em MAP.id_0 — praca-lago-map-tags.ts.
 *
 * Salas de expedição (monte1-6, cavex1-3, wilder1, jam10, copas, pirata): são as
 * salas ORIGINAIS de festas de 2010-2011 servidas como cenários fixos
 * (services/waddle/island.js EXTRA_ROOMS). Dentro delas os gatilhos mandam pra
 * "party1".."party6"/"party" (chaves que as festas usam); aqui essas strings
 * viram as chaves novas, do MESMO tamanho, pra cadeia continuar andando.
 *
 * catalog_viewer.swf (AS3): ao mostrar uma página o catálogo faz
 * `closeButton.buttonMode = true`; no Catálogo de Puffles o botão de fechar é
 * um SimpleButton (que não tem buttonMode) → erro #1056 no meio da função e
 * o catálogo ficava travado (sem fechar, sem virar página). Os bytes
 * `pushtrue; setproperty buttonMode` (linha 70 de CatalogView.showPage)
 * viram `pop; nop; nop; nop` — mesmo tamanho, só pula essa linha.
 */
const zlib_1 = __importDefault(require("zlib"));
const praca_voice_action_1 = require("./praca-voice-action");
const praca_shell_action_1 = require("./praca-shell-action");
const praca_igloo_action_1 = require("./praca-igloo-action");
const praca_backyard_action_1 = require("./praca-backyard-action");
const praca_lago_map_tags_1 = require("./praca-lago-map-tags");
const swf_coins_1 = require("./swf-coins");
const PATCHES = [
    {
        // catálogos: a moeda dos preços vira a moeda "PC" (moeda única) — swf-coins.ts
        test: (route) => /(^|\/)play\/v2\/content\/local\/[a-z]{2}\/catalogues\/[^/]+\.swf$/.test(route),
        patches: [],
        transform: swf_coins_1.replaceCoins,
    },
    {
        test: (route) => /(^|\/)play\/v2\/content\/global\/content\/interface\.swf$/.test(route),
        patches: [{ from: 'autoLogin\0', to: 'autoLogXn\0' }],
        frame1Tags: [praca_voice_action_1.PRACA_VOICE_DOACTION],
    },
    {
        test: (route) => /(^|\/)play\/v2\/client\/catalog_viewer\.swf$/.test(route),
        patches: [{
                from: '\xf0\x46\xd0\x66\xf6\x03\x66\xe4\x19\x26\x61\xe7\x19\xf0\x48',
                to: '\xf0\x46\xd0\x66\xf6\x03\x66\xe4\x19\x29\x02\x02\x02\xf0\x48',
            }],
    },
    {
        test: (route) => /(^|\/)play\/v2\/client\/igloo\.swf$/.test(route),
        patches: [],
        frame1Tags: [praca_igloo_action_1.PRACA_IGLOO_DOACTION],
    },
    {
        test: (route) => /(^|\/)play\/v2\/client\/backyard\.swf$/.test(route),
        patches: [],
        frame1Tags: [praca_backyard_action_1.PRACA_BACKYARD_DOACTION],
    },
    {
        test: (route) => /(^|\/)play\/v2\/client\/shell\.swf$/.test(route),
        patches: [],
        frame1Tags: [praca_shell_action_1.PRACA_SHELL_DOACTION],
    },
    {
        test: (route) => /(^|\/)play\/v2\/content\/global\/content\/map\.swf$/.test(route),
        patches: [],
        frame1Tags: [praca_lago_map_tags_1.PRACA_LAGO_MAP_TAGS],
    },
    {
        test: (route) => /(^|\/)play\/v2\/content\/global\/rooms\/monte1\.swf$/.test(route),
        patches: [{ from: 'party2\0', to: 'monte2\0' }, { from: 'party5\0', to: 'monte5\0' }],
    },
    {
        test: (route) => /(^|\/)play\/v2\/content\/global\/rooms\/monte2\.swf$/.test(route),
        patches: [{ from: 'party3\0', to: 'monte3\0' }, { from: 'party1\0', to: 'monte1\0' }],
    },
    {
        test: (route) => /(^|\/)play\/v2\/content\/global\/rooms\/monte3\.swf$/.test(route),
        patches: [{ from: 'party4\0', to: 'monte4\0' }, { from: 'party2\0', to: 'monte2\0' }],
    },
    {
        test: (route) => /(^|\/)play\/v2\/content\/global\/rooms\/monte4\.swf$/.test(route),
        patches: [{ from: 'party3\0', to: 'monte3\0' }, { from: 'party6\0', to: 'monte6\0' }, { from: 'party5\0', to: 'monte5\0' }],
    },
    {
        test: (route) => /(^|\/)play\/v2\/content\/global\/rooms\/monte5\.swf$/.test(route),
        patches: [{ from: 'party4\0', to: 'monte4\0' }],
    },
    {
        test: (route) => /(^|\/)play\/v2\/content\/global\/rooms\/monte6\.swf$/.test(route),
        patches: [{ from: 'party4\0', to: 'monte4\0' }],
    },
    {
        test: (route) => /(^|\/)play\/v2\/content\/global\/rooms\/cavex1\.swf$/.test(route),
        patches: [{ from: 'party2\0', to: 'cavex2\0' }],
    },
    {
        test: (route) => /(^|\/)play\/v2\/content\/global\/rooms\/cavex2\.swf$/.test(route),
        patches: [{ from: 'party1\0', to: 'cavex1\0' }, { from: 'party3\0', to: 'cavex3\0' }],
    },
    {
        test: (route) => /(^|\/)play\/v2\/content\/global\/rooms\/cavex3\.swf$/.test(route),
        patches: [{ from: 'party2\0', to: 'cavex2\0' }],
    },
    {
        test: (route) => /(^|\/)play\/v2\/content\/global\/rooms\/wilder1\.swf$/.test(route),
        patches: [{ from: 'party12\0', to: 'wilder1\0' }],
    },
];
/** Insere `tags` no fim do 1º quadro da linha do tempo principal (antes do 1º ShowFrame). */
function insertIntoFrame1(body, tags) {
    const nbits = body[0] >> 3;
    let off = Math.ceil((5 + 4 * nbits) / 8) + 4; // RECT + frameRate + frameCount
    while (off + 2 <= body.length) {
        const h = body.readUInt16LE(off);
        const code = h >> 6;
        let len = h & 63;
        let hl = 2;
        if (len === 63) {
            len = body.readUInt32LE(off + 2);
            hl = 6;
        }
        if (code === 1)
            return Buffer.concat([body.subarray(0, off), ...tags, body.subarray(off)]);
        if (code === 0)
            break;
        off += hl + len;
    }
    return body; // sem ShowFrame: deixa como está
}
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
    if (rule.frame1Tags?.length)
        body = insertIntoFrame1(body, rule.frame1Tags);
    if (rule.transform) {
        try {
            body = rule.transform(body);
        }
        catch { /* arquivo diferente do esperado: fica como está */ }
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
