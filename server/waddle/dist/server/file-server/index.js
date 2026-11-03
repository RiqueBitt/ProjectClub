"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileServer = void 0;
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const paths_1 = require("../../common/paths.js");
const file_generators_1 = require("../file-generators/index.js");
const utils_1 = require("../../common/utils.js");
const media_store_1 = require("../../common/media-store.js");
const i18n_1 = require("../i18n/index.js");
const overriders_1 = require("./overriders");
const logger_1 = require("../logger.js");
/** Server that serves files to the game webpage and files in the game */
class FileServer {
    gameData;
    settings;
    /** Maps file route -> name of the mod that is using this route */
    modFiles = new Map();
    overrider;
    dynamicFiles;
    postGenerators;
    constructor(gameData, settings) {
        this.gameData = gameData;
        this.settings = settings;
        this.dynamicFiles = (0, file_generators_1.getGeneratorsMap)();
        this.postGenerators = (0, file_generators_1.postGeneratorsMap)();
        this.updateModFiles();
        settings.mods.addListener(() => {
            this.updateModFiles();
        });
        this.overrider = new overriders_1.FileOverrider(gameData, settings, overriders_1.OVERRIDERS, overriders_1.REGEX_OVERRIDERS);
    }
    updateModFiles() {
        this.modFiles = new Map();
        for (const mod of this.settings.mods.getActiveMods()) {
            mod.getFiles().forEach(file => {
                this.modFiles.set((0, utils_1.toForwardSlash)(file), mod.getName());
            });
        }
    }
    async getFile(route) {
        const modName = this.modFiles.get(route);
        if (modName !== undefined) {
            (0, logger_1.logverbose)((0, logger_1.getYellowString)(`requesting ${route}, sending MODDED file`));
            return await (0, utils_1.readFile)(path_1.default.join(paths_1.MODS_DIRECTORY, modName, route));
        }
        let mediaPath = this.gameData.lookupFile(route);
        if (mediaPath !== undefined) {
            if (typeof mediaPath !== 'string') {
                mediaPath = mediaPath(this.settings);
            }
            (0, logger_1.logverbose)(`req ${route} -> send ${mediaPath}`);
            return await (0, media_store_1.readMediaFile)(mediaPath);
        }
        const generator = this.dynamicFiles.get(route);
        if (generator !== undefined) {
            return generator(this.gameData, this.settings);
        }
        const websiteFile = `default/websites/${this.gameData.getWebsite()}/${route}`;
        if ((0, media_store_1.mediaFileExists)(websiteFile)) {
            return await (0, media_store_1.readMediaFile)(websiteFile);
        }
        return undefined;
    }
    /** Conteúdo final de uma rota (com os overrides aplicados), ou undefined se não existir */
    async resolve(route) {
        const binary = await this.getFile(route);
        if (binary === undefined)
            return undefined;
        return await this.overrider.override(route, binary);
    }
    /** Esse caminho é do jogo? (mídia, arquivo gerado, mod ou site) */
    knowsRoute(route) {
        return this.modFiles.has(route)
            || this.gameData.lookupFile(route) !== undefined
            || this.dynamicFiles.has(route)
            || (0, media_store_1.mediaFileExists)(`default/websites/${this.gameData.getWebsite()}/${route}`);
    }
    getExpressRouter() {
        const router = (0, express_1.Router)();
        // generic files (swfs, json, etc.)
        router.get('/*', (req, res, next) => {
            const route = req.params[0];
            this.getFile(route).then((binary) => {
                if (binary === undefined) {
                    next();
                }
                else {
                    // mídia de verdade (não gerada) pode ficar em cache no navegador
                    const isMedia = this.gameData.lookupFile(route) !== undefined && !this.modFiles.has(route);
                    // mídia: 30 dias (as URLs mudam de versão quando o conteúdo muda); gerados: revalidam por ETag
                    res.set('Cache-Control', isMedia ? 'public, max-age=2592000, immutable' : 'no-cache');
                    const split = route.split('.');
                    // if less than 1, then there was no file extension
                    // route with no file extension -> a GET request for an HTML file
                    const type = split.length < 2 ? '.html' : route.split('.').pop();
                    if (type === undefined) {
                        throw new Error('Split somehow returned empty list');
                    }
                    this.overrider.override(route, binary).then((value) => {
                        // Tradução PT-BR: todo JSON (gerado ou da mídia) passa pelo dicionário
                        if (type === 'json')
                            value = (0, i18n_1.translateJsonText)(value);
                        res.status(200).type(type).send(value);
                    }).catch(next);
                }
            }).catch((err) => {
                if (err?.code === 'ENOENT') {
                    next();
                }
                else if (err?.code === 'EMEDIA') {
                    console.error(`[waddle] ${err.message}`);
                    res.status(503).set('Cache-Control', 'no-store').type('text').send('Mídia do jogo indisponível no momento.');
                }
                else {
                    next(err);
                }
            });
        });
        router.post('/*', (req, res, next) => {
            const generator = this.postGenerators.get(req.params[0]);
            if (generator === undefined) {
                next();
            }
            else {
                res.send(generator(this.gameData, this.settings));
            }
        });
        return router;
    }
}
exports.FileServer = FileServer;
