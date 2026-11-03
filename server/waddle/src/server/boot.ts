import { DataFolder, ensureMascots, FilePenguinRepository, PenguinRepository } from './database/database';
import { VERSION } from '@common/constants';
import { USER_DATA_FOLDER } from '@common/paths';
import settingsManager, { SettingsManager } from './settings';
import { GameData } from './timelines/game-data';

import { HttpServer } from './http';
import { setupWorldServer, WorldServer } from './socket-server/world-server';
import { LoginServer, setupLoginServer } from './socket-server/login-server';
import { attachWebSocket, ClientSocket, MessageHandler, PacketTransform } from './socket-server/socket-server';
import type WebSocket from 'ws';

/** Initialize the mods. Returns a list of any that failed to start. */
export function startMods(): string[] {
  return settingsManager.mods.initializeMods();
}

/** Initialize the db, game data, and the 3 services (http, login, world). Returns the world server. */
export async function startServices() {
  const data = new DataFolder(USER_DATA_FOLDER);
  data.init(VERSION);

  const gameData = new GameData(settingsManager);

  const db = new FilePenguinRepository(data.getPath());
  await ensureMascots(db);

  await setupLoginServer(settingsManager, db, gameData);

  const world = await setupWorldServer(settingsManager, db, gameData);

  await (new HttpServer(gameData, settingsManager, db)).setupServer();

  return world;
}

export type WaddleInstance = {
  settings: SettingsManager;
  gameData: GameData;
  db: PenguinRepository;
  world: WorldServer;
  login: LoginServer;
  http: HttpServer;
  /** Liga um WebSocket já aceito ao servidor de login ou de mundo */
  attach: (kind: 'login' | 'world', ws: WebSocket, transform?: PacketTransform) => ClientSocket;
};

/**
 * Modo embutido (Project Club): monta tudo SEM abrir porta nenhuma. Quem chama
 * pendura o router HTTP no Express do site e entrega os WebSockets via attach().
 */
export async function createWaddle(options: {
  db?: PenguinRepository;
  /** IP/porta que o jogo "acha" que usa — só rotulam o socketProxy do Ruffle */
  targetIP?: string;
  targetPort?: number;
} = {}): Promise<WaddleInstance> {
  const settings = settingsManager;
  if (options.targetIP) settings.targetIP = options.targetIP;
  if (options.targetPort) settings.targetPort = options.targetPort;

  startMods();

  let db = options.db;
  if (db === undefined) {
    const data = new DataFolder(USER_DATA_FOLDER);
    data.init(VERSION);
    db = new FilePenguinRepository(data.getPath());
  }
  await ensureMascots(db);

  const gameData = new GameData(settings);
  const world = new WorldServer(settings, gameData, db);
  const login = new LoginServer(gameData, settings, db);
  const http = new HttpServer(gameData, settings, db);

  const handlers: Record<'login' | 'world', MessageHandler> = { login, world };

  return {
    settings,
    gameData,
    db,
    world,
    login,
    http,
    attach: (kind, ws, transform) => attachWebSocket(kind, ws, handlers[kind], transform),
  };
}
