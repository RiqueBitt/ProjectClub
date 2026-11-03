import { Router, Request } from 'express';
import { GameData } from '@server/timelines/game-data';
import path from 'path';
import { MODS_DIRECTORY } from '@common/paths';
import { FileGenerator, getGeneratorsMap, postGeneratorsMap } from '@server/file-generators';
import { readFile, toForwardSlash } from '@common/utils';
import { mediaFileExists, readMediaFile } from '@common/media-store';
import { translateJsonText } from '@server/i18n';
import { SettingsManager } from '@server/settings';
import { FileOverrider, OVERRIDERS, REGEX_OVERRIDERS } from './overriders';
import { getYellowString, logverbose } from '@server/logger';

/** Server that serves files to the game webpage and files in the game */
export class FileServer {
  /** Maps file route -> name of the mod that is using this route */
  private modFiles = new Map<string, string>();

  private overrider: FileOverrider;

  private dynamicFiles: Map<string, FileGenerator>

  private postGenerators: Map<string, FileGenerator>

  constructor(private gameData: GameData, private settings: SettingsManager) {
    this.dynamicFiles = getGeneratorsMap();
    this.postGenerators = postGeneratorsMap();

    this.updateModFiles();
    settings.mods.addListener(() => {
      this.updateModFiles();
    });

    this.overrider = new FileOverrider(gameData, settings, OVERRIDERS, REGEX_OVERRIDERS);
  }

  private updateModFiles() {
    this.modFiles = new Map<string, string>();
    for (const mod of this.settings.mods.getActiveMods()) {
      mod.getFiles().forEach(file => {
        this.modFiles.set(toForwardSlash(file), mod.getName());
      })        
    }
  }

  private async getFile(route: string): Promise<Buffer | string | undefined> {
    const modName = this.modFiles.get(route);
    if (modName !== undefined) {
      logverbose(getYellowString(`requesting ${route}, sending MODDED file`));
      return await readFile(path.join(MODS_DIRECTORY, modName, route));
    }

    let mediaPath = this.gameData.lookupFile(route);
    if (mediaPath !== undefined) {
      if (typeof mediaPath !== 'string') {
        mediaPath = mediaPath(this.settings);
      }
      logverbose(`req ${route} -> send ${mediaPath}`);
      return await readMediaFile(mediaPath);
    }

    const generator = this.dynamicFiles.get(route);
    if (generator !== undefined) {
      return generator(this.gameData, this.settings);
    }

    const websiteFile = `default/websites/${this.gameData.getWebsite()}/${route}`;
    if (mediaFileExists(websiteFile)) {
      return await readMediaFile(websiteFile);
    }

    return undefined;
  }

  /** Conteúdo final de uma rota (com os overrides aplicados), ou undefined se não existir */
  public async resolve(route: string): Promise<Buffer | string | undefined> {
    const binary = await this.getFile(route);
    if (binary === undefined) return undefined;
    return await this.overrider.override(route, binary);
  }

  /** Esse caminho é do jogo? (mídia, arquivo gerado, mod ou site) */
  public knowsRoute(route: string): boolean {
    return this.modFiles.has(route)
      || this.gameData.lookupFile(route) !== undefined
      || this.dynamicFiles.has(route)
      || mediaFileExists(`default/websites/${this.gameData.getWebsite()}/${route}`);
  }

  public getExpressRouter(): Router {
    const router = Router();

    // generic files (swfs, json, etc.)
    router.get('/*', (req: Request, res, next) => {
      const route = req.params[0];
      this.getFile(route).then((binary) => {
        if (binary === undefined) {
          next();
        } else {
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
            if (type === 'json') value = translateJsonText(value);
            res.status(200).type(type).send(value);
          }).catch(next);
        }
      }).catch((err) => {
        if (err?.code === 'ENOENT') {
          next();
        } else if (err?.code === 'EMEDIA') {
          console.error(`[waddle] ${err.message}`);
          res.status(503).set('Cache-Control', 'no-store').type('text').send('Mídia do jogo indisponível no momento.');
        } else {
          next(err);
        }
      });
    });
    router.post('/*', (req: Request, res, next) => {
      const generator = this.postGenerators.get(req.params[0]);
      if (generator === undefined) {
        next();
      } else {
        res.send(generator(this.gameData, this.settings));
      }
    });

    return router;
  }
}