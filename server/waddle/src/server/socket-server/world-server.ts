// ZAAAA WAAAARUDO!

import { EffectService } from "@common/utils";
import { WORLD_PORT } from "@server/servers";

import { SettingsManager } from "@server/settings";
import { PenguinRepository } from "@server/database/database";
import { GameData } from "@server/timelines/game-data";

import { ClientSocket, MessageHandler, setupSocketServer } from "./socket-server";

import { PenguinMessenger } from "@server/socket-server/messenger";

import { World } from "./world/world";
import { WorldPenguin } from "./world/world-penguin";

import { addBakeryListener } from "./handlers/party";
import { addMatchmakerListeners } from "./handlers/ninja";

import { XtHandler } from "./xt-handler";
import { XmlHandler } from "./xml-handler";
import { createWorldXtHandler } from "./world-handlers";
import { createLoginXmlHandler } from "./login-handlers";
import { PenguinPersister, WorldContext } from "@server/socket-server/handlers/handlers";
import { CommandsHandler, getCommandsHandler } from "@server/commands/commands";
import { OfflineWorld } from "./offline-world";

export class WorldServer implements MessageHandler {
  private _world: World;
  private _msg = new PenguinMessenger();
  private _off: OfflineWorld;
  private _commandsHandler: CommandsHandler;
  private _xtHandler: XtHandler;
  private _xmlHandler: XmlHandler;
  private _persister: PenguinPersister;
  
  constructor(private _settings: SettingsManager, private _gameData: GameData, private _db: PenguinRepository) {
    this._off = new OfflineWorld(_db);
    this._world = new World(_gameData);

    this._commandsHandler = getCommandsHandler();

    this._persister = (p, force = false) => { 
      if (p.canSave || force) {
        this._db.write(p.id, p.getJSON());
      }
    };

    this._xtHandler = createWorldXtHandler();
    this._xmlHandler = createLoginXmlHandler();

    this.init();
  }

  // ---- Painel da equipe (Project Club) ----
  /** Pinguim conectado agora (undefined se offline). */
  public getOnline(penguinId: number): WorldPenguin | undefined {
    return this._world.getById(penguinId);
  }

  /** Grava o pinguim online no banco (depois de mexer nele pelo painel). */
  public persist(penguin: WorldPenguin) {
    this._persister(penguin, true);
  }

  /** Manda um pacote xt pro cliente (ex.: 'ai' item adicionado). */
  public notify(penguin: WorldPenguin, message: string, ...args: Array<string | number>) {
    this._msg.send(penguin, message, ...args);
  }

  /** Derruba a conexão do pinguim (ele entra de novo pela página). */
  public kick(penguinId: number): boolean {
    const penguin = this._world.getById(penguinId);
    if (penguin === undefined) return false;
    try { this._msg.getClient(penguin).end(); } catch { return false; }
    return true;
  }

  /**
   * Quem está em qual sala e onde (pro chat de texto e a voz por
   * proximidade do Project Club). Pinguim em minijogo/sem sala fica de fora.
   */
  // frame = animação atual (26 = dançando, 27 = acenando…); walking = puffle
  // passeando (tipo). Usados pelas quests da Praça (Project Club).
  public getPresence(): Array<{ id: number; name: string; room: number; x: number; y: number; frame: number; walking: number | null }> {
    const out: Array<{ id: number; name: string; room: number; x: number; y: number; frame: number; walking: number | null }> = [];
    for (const p of this._world.players) {
      const room = this._world.getPenguinRoom(p);
      if (room === undefined) continue;
      let st: { x: number; y: number; frame?: number } | undefined;
      try { st = room.getState(p); } catch { st = undefined; }
      if (st === undefined) continue;
      let walking: number | null = null;
      try { const w = p.puffle.getWalking(); walking = w ? w.type : null; } catch { walking = null; }
      out.push({ id: p.id, name: p.name, room: room.id, x: st.x, y: st.y, frame: Number(st.frame) || 0, walking });
    }
    return out;
  }

  /** Fala como o pinguim (balão no jogo pra sala toda), igual ao chat do próprio jogo. */
  public say(penguinId: number, text: string): boolean {
    const penguin = this._world.getById(penguinId);
    if (penguin === undefined) return false;
    let client: ClientSocket;
    try { client = this._msg.getClient(penguin); } catch { return false; }
    const clean = String(text).replace(/[%\r\n\0]/g, ' ').trim().slice(0, 64);
    if (!clean) return false;
    this.handle(client, `%xt%s%m#sm%-1%${penguinId}%${clean}%`);
    return true;
  }

  public runCommand(penguinId: number, name: string, args: string[]) {
    const penguin = this._world.getById(penguinId);
    if (penguin !== undefined) {
      const client = this._msg.getClient(penguin);
      this._commandsHandler.run({
        world: this._world,
        penguin,
        prst: this._persister,
        msg: this._msg,
        data: this._gameData,
        db: this._db,
        settings: this._settings,
        off: this._off,
        client,
        room: this._world.getPenguinRoom(penguin)
      }, name, args);
    }
  }

  public getAllPlayersInfo() {
    return this._world.players.map(p => ({
      name: p.name,
      id: p.id
    }));
  }

  private init() {
    addBakeryListener(this._world, this._msg);
    addMatchmakerListeners(this._world, this._msg);
  }

  public async reset() {
    await Promise.all(this._msg.getClients().map(client => this.disconnect(client)));
    this._msg.close();
    this._msg = new PenguinMessenger();
    this._world = new World(this._gameData);
    this.init();
  }

  private getContext(client: ClientSocket): WorldContext {
    const penguin = this._msg.getPenguin(client);
    return {
      world: this._world,
      msg: this._msg,
      data: this._gameData,
      settings: this._settings,
      db: this._db,
      prst: this._persister,
      off: this._off,

      client,

      ...(penguin === undefined ? {} : {
        penguin, ...this._world.getContext(penguin)
      })
    };
  }

  public handle(client: ClientSocket, message: string): void {
    if (message.startsWith('<')) {
      this._xmlHandler.handle({ 
        msg: this._msg,
        data: this._gameData,
        settings: this._settings,
        db: this._db,
        off: this._off,
        client,
        world: this._world
      }, message);
    } else {
      this._xtHandler.handle(client, this.getContext(client), message);
    }
  }

  public async disconnect(client: ClientSocket): Promise<void> {
    const context = this.getContext(client);
    await this._xtHandler.disconnect(context);
  }
}

export const setupWorldServer = async (settings: SettingsManager, db: PenguinRepository, gameData: GameData): Promise<EffectService<WorldServer>> => {
  const world = new WorldServer(settings, gameData, db);
  await setupSocketServer('world', WORLD_PORT, world);
  return world;
}
