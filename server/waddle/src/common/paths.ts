import path from 'path';
import fs from 'fs';

/**
 * Pasta de dados do jogo no Project Club (configurações, mods, pinguins no
 * modo avulso). Em produção os pinguins ficam no MySQL (ver
 * server/src/services/waddle/penguinStore.js); aqui só ficam coisas leves.
 *
 * WADDLE_DATA_DIR  → caminho absoluto (padrão: server/data/waddle)
 */
export const USER_DATA_FOLDER = process.env.WADDLE_DATA_DIR
  ? path.resolve(process.env.WADDLE_DATA_DIR)
  : path.resolve(__dirname, '..', '..', '..', 'data', 'waddle');

export const MODS_DIRECTORY = path.join(USER_DATA_FOLDER, 'mods');
/** name of the file that contains custom items in a mod */
export const MOD_ITEMS_FILE = 'items.json';
/** name of the file that contains the custom frame hacks in a mod */
export const MOD_HACKS_FILE = 'frames.json';
export const MOD_MUSIC_FILE = 'music.json';
export const SETTINGS_PATH = path.join(USER_DATA_FOLDER, 'settings.json');

fs.mkdirSync(USER_DATA_FOLDER, { recursive: true });
