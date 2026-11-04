"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGeneratorsMap = getGeneratorsMap;
exports.postGeneratorsMap = postGeneratorsMap;
const utils_1 = require("../../common/utils.js");
const chunking_map_json_1 = require("./chunking_map.json");
const dependencies_json_1 = __importDefault(require("./dependencies.json"));
const environment_data_xml_1 = require("./environment_data.xml");
const games_json_1 = require("./games.json");
const game_strings_json_1 = require("./game_strings.json");
const general_json_1 = require("./general.json");
const global_crumbs_swf_1 = require("./global_crumbs.swf");
const igloo_music_xml_1 = require("./igloo_music.xml");
const local_crumbs_swf_1 = require("./local_crumbs.swf");
const news_txt_1 = require("./news.txt");
const newspapers_json_1 = require("./newspapers.json");
const news_crumbs_swf_1 = require("./news_crumbs.swf");
const paper_items_json_1 = require("./paper_items.json");
const paths_json_1 = require("./paths.json");
const penguin_action_frames_json_1 = require("./penguin_action_frames.json");
const rooms_json_1 = require("./rooms.json");
const setup_txt_1 = require("./setup.txt");
const setup_xml_1 = require("./setup.xml");
const stage_script_messages_json_1 = __importDefault(require("./stage_script_messages.json"));
const stamps_json_1 = require("./stamps.json");
const startscreen_xml_1 = require("./startscreen.xml");
const version_txt_1 = require("./version.txt");
const worldachievements_xml_1 = require("./worldachievements.xml");
const GET_GENERATORS = {
    'en/web_service/stamps.json': stamps_json_1.getStampsJson,
    'play/en/web_service/game_configs/stamps.json': stamps_json_1.getStampsJson,
    'play/en/web_service/game_configs/chunking_map.json': chunking_map_json_1.getChunkingMapJson,
    'play/en/web_service/game_configs/general.json': general_json_1.getGeneralJson,
    'play/v2/client/dependencies.json': dependencies_json_1.default,
    'play/v2/content/local/en/crumbs/local_crumbs.swf': local_crumbs_swf_1.getLocalCrumbsSwf,
    'play/en/web_service/game_configs/stage_script_messages.json': stage_script_messages_json_1.default,
    'play/en/web_service/game_configs/paths.json': paths_json_1.getPathsJson,
    'play/v2/content/global/crumbs/global_crumbs.swf': global_crumbs_swf_1.getGlobalCrumbsSwf,
    'play/en/web_service/game_configs/games.json': games_json_1.getGamesJson,
    'en/web_service/games.json': games_json_1.getGamesJson,
    'play/en/web_service/game_configs/paper_items.json': paper_items_json_1.getPaperItemsJson,
    'play/en/web_service/game_configs/rooms.json': rooms_json_1.getRoomsJson,
    'setup.xml': setup_xml_1.getSetupXml,
    'play/v2/content/local/en/news/news_crumbs.swf': news_crumbs_swf_1.getNewsCrumbsSwf,
    'play/v2/content/local/en/login/startscreen.xml': startscreen_xml_1.getStartscreenXML,
    'playstart/xml/start_module_config.xml': startscreen_xml_1.getStartscreenXML,
    'web_service/worldachievements.xml': worldachievements_xml_1.getWorldAchievementsXml,
    'play/v2/content/global/stampbook/world_stamps.xml': worldachievements_xml_1.getWorldAchievementsXml,
    'play/en/web_service/game_configs/game_strings.json': game_strings_json_1.getGameStrings,
    'play/en/web_service/game_configs/newspapers.json': newspapers_json_1.getNewspapersJson,
    'play/en/web_service/game_configs/penguin_action_frames.json': penguin_action_frames_json_1.getPenguinActionFramesJson,
    'version.txt': version_txt_1.getVersionTxt,
    'play/web_service/environment_data.xml': environment_data_xml_1.getEnvironmentDataXml,
    'play/v2/content/global/en/igloo_music.xml': igloo_music_xml_1.getIglooMusicXml,
    // Cliente 2012 (AS3): ao abrir, pede a "lista de serviços" da Disney
    // (/services). Ninguém usa a resposta, mas sem um JSON válido o shell
    // mostra a caixa laranja "shell.DEFAULT_ERROR" antes do jogo carregar.
    'services': () => '{"services":[]}',
    'play/services': () => '{"services":[]}'
};
const POST_GENERATORS = {
    // telemetria da Playdom (cliente 2012): aceita e descarta
    'datatech/serverlog/v1/json': () => '{}',
    'setup.txt': setup_txt_1.getSetupTxt,
    'news.txt': news_txt_1.getNewsTxt
};
function createGeneratorsMap(obj) {
    const map = new Map();
    (0, utils_1.iterateEntries)(obj, (key, value) => map.set(key, value));
    return map;
}
function getGeneratorsMap() {
    return createGeneratorsMap(GET_GENERATORS);
}
function postGeneratorsMap() {
    return createGeneratorsMap(POST_GENERATORS);
}
