// Progresso das festas de 2013-2017 ("party cookie"): cada festa guarda um JSON
// por pinguim (mensagens vistas, tarefas da missão, flocos achados…). O cliente
// pede com "<festa>#partycookie" e recebe "partycookie" com o JSON; cada ação
// ("msgviewed", "qtaskcomplete", "collectquestitem"…) marca um campo e o
// servidor manda o JSON de novo. Junto vai o "partyservice" da festa com todos
// os dias liberados (no jogo original as missões abriam dia a dia).
import { PARTY_COOKIES } from "@server/game-data/party-cookies";
import { PenguinHandler } from "./handlers";
import { WorldPenguin } from "@server/socket-server/world/world-penguin";

type Cookie = Record<string, unknown>;

/** Comando → o que faz no cookie. */
type Rule =
  | { kind: 'get' }
  | { kind: 'array', field: string, arg?: number }
  | { kind: 'flag', field: string, value: unknown }
  | { kind: 'keyFlag', field: string }
  | { kind: 'transform' }
  | { kind: 'none' };

const RULES: Record<string, Record<string, Rule>> = {};
function rule(handler: string, command: string, r: Rule) {
  (RULES[handler] ??= {})[command] = r;
}

for (const h of Object.keys(PARTY_COOKIES)) {
  rule(h, 'partycookie', { kind: 'get' });
  rule(h, h, { kind: 'get' });
  rule(h, 'viewpartycookie', { kind: 'get' });
  for (const c of ['msgviewed', 'fpmsgviewed', 'mpmsgviewed']) rule(h, c, { kind: 'array', field: 'msgViewedArray' });
  const qc = 'qcMsgViewedArray' in PARTY_COOKIES[h].defaults ? 'qcMsgViewedArray' : 'communicatorMsgArray';
  rule(h, 'qcmsgviewed', { kind: 'array', field: qc });
  rule(h, 'qtaskcomplete', { kind: 'array', field: 'questTaskStatus' });
  rule(h, 'collectquestitem', { kind: 'array', field: 'questTaskStatus' });
  for (const c of ['itransform', 'ftransform', 'fptransform', 'pptransform']) rule(h, c, { kind: 'transform' });
}
rule('halloween', 'visitedfloor12', { kind: 'flag', field: 'visitedFloor12', value: 1 });
rule('christmas', 'msetlogin', { kind: 'flag', field: 'loginMsgViewed', value: true });
rule('muppets', 'msetlogin', { kind: 'flag', field: 'login', value: 1 });
rule('muppets', 'mmsgviewed', { kind: 'keyFlag', field: 'muppets' });
rule('frozen', 'fpfindsnowflake', { kind: 'array', field: 'snowflakes' });
rule('i', 'qpc', { kind: 'get' });

// Ações das festas que ainda não têm servidor (duelos, partidas, contagens…):
// ficam registradas pra não aparecerem como "sem tratamento".
const KNOWN_NOOP: Array<[string, string[]]> = [
  ['halloween', ['puzzlecomplete', 'spiglooitem']],
  ['school', ['spiglooitem']],
  ['frozen', ['fpactivatefreezingpower', 'fpcountdown', 'fpfurniturepack', 'fpupdateroomstate']],
  ['future', ['fpdefeatprotobot', 'fphit', 'fppaint', 'fpprotobotcountdown', 'fpusepoints']],
  ['fair', ['fawardtickets', 'fendgame', 'fsilverjr', 'fstartgame', 'fusetickets']],
  ['muppets', ['mperformancecancel', 'mperformanceclose', 'mperformancejoin', 'mperformanceopen']],
  ['musicparty', ['mpcountdown']],
  ['pirate', ['collectswordreward', 'piratejoin', 'pirateopen', 'pirateselect']],
  ['soccerparty', ['getteamscores', 'spgamecancel', 'spgameclose', 'spgamejoin', 'spgameopen', 'spsetteam', 'spvictorydance']],
  ['christmas', ['christmastrain', 'traingame', 'totaldonation']],
  ['tnbch', ['tnbchshow', 'tnbchslide']],
  ['shp', ['shphp', 'shprh', 'shpvp']],
];
for (const [h, cmds] of KNOWN_NOOP) for (const c of cmds) if (!RULES[h]?.[c]) rule(h, c, { kind: 'none' });

/** Nome da resposta de cada festa (quase todas usam "partycookie"). */
const RECEIVE: Record<string, string> = { christmas: 'christmasc', shp: 'shppc', i: 'qpc' };

function cookieOf(p: WorldPenguin, handler: string): Cookie {
  const all = p.partyCookies;
  return (all[handler] ??= {}) as Cookie;
}

function sendCookie(ctx: Parameters<PenguinHandler<string[]>>[0], handler: string, withService = false) {
  const { msg, penguin } = ctx;
  const service = PARTY_COOKIES[handler]?.service;
  if (withService && service) {
    msg.send(penguin, 'partyservice', JSON.stringify(service));
  }
  msg.send(penguin, RECEIVE[handler] ?? 'partycookie', JSON.stringify(cookieOf(penguin, handler)));
}

function defaultArray(handler: string, field: string, minLength: number): number[] {
  const d = PARTY_COOKIES[handler]?.defaults?.[field];
  const base = Array.isArray(d) ? d.map((v) => Number(v) || 0) : [];
  while (base.length < minLength) base.push(0);
  return base;
}

function makeHandler(handler: string, command: string, r: Rule): PenguinHandler<string[]> {
  return (ctx, ...args) => {
    const { penguin, prst, msg } = ctx;
    const nums = args.map((a) => Number(a));
    switch (r.kind) {
      case 'get':
        sendCookie(ctx, handler, true);
        return;
      case 'none':
        return;
      case 'transform': {
        const avatar = nums[0];
        if (!Number.isInteger(avatar) || avatar < 0 || avatar > 100000) return;
        penguin.avatar.transform(avatar);
        const room = ctx.world.getPenguinRoom(penguin);
        msg.send(room?.players ?? [penguin], 'spts', penguin.id, avatar);
        return;
      }
      case 'array': {
        const i = nums[r.arg ?? 0];
        if (!Number.isInteger(i) || i < 0 || i > 63) return;
        const c = cookieOf(penguin, handler);
        const arr = Array.isArray(c[r.field]) ? (c[r.field] as number[]) : defaultArray(handler, r.field, i + 1);
        while (arr.length <= i) arr.push(0);
        arr[i] = 1;
        c[r.field] = arr;
        break;
      }
      case 'flag':
        cookieOf(penguin, handler)[r.field] = r.value;
        break;
      case 'keyFlag': {
        const key = nums[0];
        if (!Number.isInteger(key) || key < 0 || key > 999) return;
        const c = cookieOf(penguin, handler);
        const obj = (c[r.field] && typeof c[r.field] === 'object' ? c[r.field] : {}) as Record<string, number>;
        obj[String(key)] = 1;
        c[r.field] = obj;
        break;
      }
    }
    prst(penguin);
    sendCookie(ctx, handler);
  };
}

/** Todos os comandos de festa, pra registrar no servidor. */
export function getPartyCookieHandlers(): Array<[string, PenguinHandler<string[]>]> {
  const out: Array<[string, PenguinHandler<string[]>]> = [];
  for (const [h, cmds] of Object.entries(RULES)) {
    for (const [c, r] of Object.entries(cmds)) {
      out.push([`${h}#${c}`, makeHandler(h, c, r)]);
    }
  }
  return out;
}
