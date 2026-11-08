import { PenguinMessenger } from "../../socket-server/messenger";
import { ClientSocket } from "@server/socket-server/socket-server";
import { getDefaultPenguin } from "@server/database/database";
import { logdebug } from "@server/logger";
import { WorldPenguin } from "@server/socket-server/world/world-penguin";
import serverList from "@server/servers";
import { LoginContext } from "@server/socket-server/xml-handler";



export function sendError(msg: PenguinMessenger, p: WorldPenguin | ClientSocket | Array<WorldPenguin | ClientSocket>, error: number) {
  msg.send(p, 'e', error);
}

type LoginHandler = (ctx: LoginContext, message: string) => void;

export const filePolicy: LoginHandler = ({ client }) => {
  client.end('<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>');
};

export const checkVersion: LoginHandler = ({ msg, client }) => {
  // version checking
  // this is irrelevant for us, we just always send an OK response
  msg.sendXml(client, 'apiOK', '', 0);
}

export const getKey: LoginHandler = ({ msg, client }) => {
  // random key generation
  // this is used for authentication, so it is not needed for us, we just send any key
  msg.sendXml(client, 'rndK', '<k>key</k>', -1);
}

export const login: LoginHandler = async (ctx, message: string) => {
  const { msg, data, settings, db, client } = ctx;

  const joinMatch = message.match(/<login z='j'>/);
  if (data.isPreCpip() && joinMatch) {
    // join.swf sends 'j' as the login
    msg.sendXml(client, 'logOK', '');
    return;
  }

  const nicknameMatch = message.match(/<nick><!\[CDATA\[(.*)\]\]><\/nick>/);
  if (nicknameMatch === null) {
    logdebug('No nickname provided during Login, terminating.');
  } else {
    const nickname = data.isPreCpip() ? nicknameMatch[1].replace(/_/g, ' ') : nicknameMatch[1];
    // in the LOGIN world of modern clients, nickname -> ID
    // everywhere else, nickname -> name

    // account creation only happens when given name, not when given ID
    const modernLogin = ('world' in ctx && data.isVanillaEngine());
    if (!modernLogin) {
      if (!await db.exists(nickname)) {
        // todo: error 101 is incorrect password
        if (settings.settings.no_create_via_login) {
          sendError(msg, client, 100);
          return
        }

        const json = getDefaultPenguin(nickname, 1 /* blue */, settings.settings.always_member, settings.getVirtualDate(0).getTime());
        await db.create(json);
      }
    }

    const idTest = modernLogin ? Number(nickname) : await db.fromName(nickname);
    if (idTest === null || (typeof idTest === 'number' && !Number.isInteger(idTest))) {
      // pinguim inexistente: erro pro cliente em vez de derrubar o servidor
      logdebug(`Login: penguin not found (${nickname})`);
      sendError(msg, client, 100);
      return;
    }
    const id = typeof idTest === 'number' ? idTest : idTest[0];

    if ('world' in ctx) {
      const offline = await ctx.off.getPenguin(id);
      if (offline === undefined) {
        logdebug(`Login: penguin #${id} has no data`);
        sendError(msg, client, 100);
        return;
      }
      const p = new WorldPenguin(id, offline.getJSON(), settings);
      ctx.off.removePenguin(offline.id);
      ctx.world.addPenguin(p);
      msg.linkClient(client, p);
    }
    console.log(`${nickname} is logging in`);
    /*
    TODO
    buddies
    how will server size be handled after NPCs?
    */
    // information regarding how many populations are in each server
    // população: quem está online de verdade (barra do servidor), mínimo 1
    const online = 'world' in ctx ? ctx.world.players.length : 0;
    const population = Math.max(1, Math.min(6, Math.ceil(online / 20)));
    msg.send(client, 'l', id, id, '', serverList.map((server) => `${server.id},${population}`).join('|'));
  }
}