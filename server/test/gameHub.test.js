// Game Hub: promoções, clipes, builds, partidas, hotlist e dados dos jogos
// (banco e APIs de fora falsos — nada de rede).
const test = require('node:test');
const assert = require('node:assert/strict');

const deals = require('../src/services/gameHub/deals');
const remote = require('../src/services/gameHub/remote');
const clips = require('../src/services/gameHub/clips');
const builds = require('../src/services/gameHub/builds');
const parties = require('../src/services/gameHub/parties');
const hotlist = require('../src/services/gameHub/hotlist');
const gameData = require('../src/services/gameHub/gameData');

// ---------- Promoções ----------
const STEAM = {
  specials: { items: [
    { id: 1174180, name: 'Red Dead Redemption 2', discounted: true, discount_percent: 75, original_price: 29990, final_price: 7497, currency: 'BRL', large_capsule_image: 'https://x/rdr2.jpg', discount_expiration: 1796000000 },
    { id: 10, name: 'Sem desconto', discounted: false, discount_percent: 0, original_price: 1000, final_price: 1000, currency: 'BRL' },
  ] },
  top_sellers: { items: [{ id: 1174180, name: 'Red Dead Redemption 2', discounted: true, discount_percent: 75, original_price: 29990, final_price: 7497 }] },
};
const GOG = { products: [{ id: '1', title: 'Cyberpunk 2077', coverHorizontal: 'https://x/c.png', storeLink: 'https://www.gog.com/en/game/cyberpunk', price: { discount: '-60%', finalMoney: { amount: '105.99', currency: 'BRL' }, baseMoney: { amount: '265.00', currency: 'BRL' } } }] };
const NOW = new Date('2026-11-26T18:00:00Z');
const EPIC = { data: { Catalog: { searchStore: { elements: [
  { id: 'a', title: 'Jogo Grátis', price: { totalPrice: { originalPrice: 5999, currencyCode: 'BRL' } }, keyImages: [{ type: 'Thumbnail', url: 'https://x/t.jpg' }, { type: 'OfferImageWide', url: 'https://x/w.jpg' }], catalogNs: { mappings: [{ pageSlug: 'jogo-gratis', pageType: 'productHome' }] },
    promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: '2026-11-26T16:00:00.000Z', endDate: '2026-12-03T16:00:00.000Z', discountSetting: { discountPercentage: 0 } }] }], upcomingPromotionalOffers: [] } },
  { id: 'b', title: 'Próximo Grátis', price: { totalPrice: { originalPrice: 3999 } }, keyImages: [], offerMappings: [{ pageSlug: 'proximo' }],
    promotions: { promotionalOffers: [], upcomingPromotionalOffers: [{ promotionalOffers: [{ startDate: '2026-12-03T16:00:00.000Z', endDate: '2026-12-10T16:00:00.000Z', discountSetting: { discountPercentage: 0 } }] }] } },
  { id: 'c', title: 'Só desconto', promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: '2026-11-20T00:00:00Z', endDate: '2026-12-20T00:00:00Z', discountSetting: { discountPercentage: 50 } }] }] } },
] } } } };
const CHEAP = [
  { title: 'Jogo Grátis', dealID: 'AAA%3D', salePrice: '0.00', normalPrice: '9.99', savings: '100', steamAppID: '1' },
  { title: 'Hades', dealID: 'BBB%2F', gameID: '9', salePrice: '12.49', normalPrice: '24.99', savings: '50.02', steamAppID: '1145360', thumb: 'https://x/h.jpg' },
];

test('Steam: só o que está com desconto, em reais, sem repetir', () => {
  const out = deals.parseSteam(STEAM);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].price, { final: 74.97, base: 299.9, currency: 'BRL', discount: 75 });
  assert.equal(out[0].url, 'https://store.steampowered.com/app/1174180/');
  assert.ok(out[0].endsAt);
});

test('GOG: preço em reais e desconto em número', () => {
  const [g] = deals.parseGog(GOG);
  assert.equal(g.price.final, 105.99);
  assert.equal(g.price.discount, 60);
  assert.equal(g.store, 'gog');
});

test('Epic: grátis agora e os próximos; desconto comum não entra', () => {
  const { free, upcoming } = deals.parseEpicFree(EPIC, NOW);
  assert.deepEqual(free.map((f) => f.title), ['Jogo Grátis']);
  assert.equal(free[0].url, 'https://store.epicgames.com/pt-BR/p/jogo-gratis');
  assert.equal(free[0].image, 'https://x/w.jpg');
  assert.equal(free[0].price.base, 59.99);
  assert.deepEqual(upcoming.map((f) => f.title), ['Próximo Grátis']);
});

test('CheapShark (Epic): em dólar, sem os grátis, link pelo redirect', () => {
  const out = deals.parseEpicDeals(CHEAP);
  assert.equal(out.length, 1);
  assert.equal(out[0].price.currency, 'USD');
  assert.equal(out[0].price.discount, 50);
  assert.equal(out[0].url, 'https://www.cheapshark.com/redirect?dealID=BBB%2F');
  assert.match(out[0].image, /1145360\/header\.jpg$/);
});

test('getDeals: uma loja fora do ar não derruba as outras', async () => {
  remote._resetForTests();
  const fetchImpl = async (url) => {
    if (url.includes('steampowered')) return { ok: true, json: async () => STEAM };
    if (url.includes('gog.com')) return { ok: false, status: 503 };
    if (url.includes('epicgames')) return { ok: true, json: async () => EPIC };
    if (url.includes('cheapshark')) return { ok: true, json: async () => CHEAP };
    throw new Error('url inesperada');
  };
  const warn = console.warn; console.warn = () => {};
  try {
    const out = await deals.getDeals({ fetchImpl });
    assert.equal(out.stores.gog, false);
    assert.equal(out.stores.steam, true);
    assert.ok(out.deals.some((d) => d.store === 'steam'));
    assert.ok(out.deals.some((d) => d.title === 'Hades'));
    assert.ok(out.deals.every((d, i, a) => i === 0 || a[i - 1].price.discount >= d.price.discount));
  } finally { console.warn = warn; remote._resetForTests(); }
});

test('cache: devolve o valor antigo se a fonte cair', async () => {
  remote._resetForTests();
  let t = 0;
  const a = await remote.cached('k', 10, async () => 'velho', { now: () => t });
  assert.equal(a, 'velho');
  t = 100;
  const b = await remote.cached('k', 10, async () => { throw new Error('caiu'); }, { now: () => t });
  assert.equal(b, 'velho');
  remote._resetForTests();
});

// ---------- Clipes ----------
test('clipes: aceita YouTube, Twitch, Medal e Streamable e limpa o link', () => {
  const c = (u) => clips.parseClipUrl(u);
  assert.deepEqual(c('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s&si=x'), { provider: 'youtube', embedId: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
  assert.equal(c('https://youtu.be/dQw4w9WgXcQ?si=abc').embedId, 'dQw4w9WgXcQ');
  assert.equal(c('https://youtube.com/shorts/dQw4w9WgXcQ').embedId, 'dQw4w9WgXcQ');
  assert.deepEqual(c('https://www.twitch.tv/gaules/clip/FunnyClipSlug-AbC_123'), { provider: 'twitch', embedId: 'FunnyClipSlug-AbC_123', url: 'https://clips.twitch.tv/FunnyClipSlug-AbC_123' });
  assert.equal(c('https://clips.twitch.tv/OutroSlug').provider, 'twitch');
  assert.equal(c('https://medal.tv/games/valorant/clips/jx8cK2s/um-ace?invite=cr').url, 'https://medal.tv/games/valorant/clips/jx8cK2s/um-ace');
  assert.equal(c('https://streamable.com/e/abc12').url, 'https://streamable.com/abc12');
  for (const bad of ['https://evil.com/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'https://www.youtube.com/watch?v=curto', 'nada', 'https://www.twitch.tv/gaules']) assert.equal(c(bad), null, bad);
});

test('clipes: miniatura só do YouTube', () => {
  assert.equal(clips.thumbOf('youtube', 'dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(clips.thumbOf('twitch', 'x'), null);
});

// ---------- Builds ----------
test('builds: LoL guarda só ids válidos e a ordem de habilidades', () => {
  const b = builds.parseInput({
    game: 'lol', title: '  Ahri   mid\n burst ', data: {
      champion: 'Ahri', role: 'mid', primaryTree: 8100, keystone: 8112, secondaryTree: 8100,
      spells: ['SummonerFlash', 'SummonerDot', 'SummonerHeal', '<b>'], start: ['1056', '2003', 'x'], core: ['6655', '3020', '6655'], skills: 'qweqqrqwqwrwweee<>',
    },
  });
  assert.equal(b.title, 'Ahri mid burst');
  const d = JSON.parse(b.data);
  assert.equal(d.secondaryTree, null); // igual à principal não vale
  assert.deepEqual(d.spells, ['SummonerFlash', 'SummonerDot']);
  assert.deepEqual(d.start, ['1056', '2003']);
  assert.deepEqual(d.core, ['6655', '3020']);
  assert.equal(d.skills, 'QWEQQRQWQWRWWEEE');
  assert.equal(b.hero, 'Ahri');
  assert.equal(b.role, 'mid');
});

test('builds: Deadlock, Darktide e outro jogo', () => {
  const dl = JSON.parse(builds.parseInput({ game: 'deadlock', title: 'Haze bala', data: { hero: 13, early: [1, 2, 2, -1, 'x'], abilityOrder: [3, 1, 9] } }).data);
  assert.deepEqual(dl.early, [1, 2]);
  assert.deepEqual(dl.abilityOrder, [3, 1]);
  const dt = builds.parseInput({ game: 'darktide', title: 'Psíquico de cajado', data: { klass: 'psyker', melee: 'Espada', curios: ['a', 'b', 'c', 'd'] } });
  assert.equal(dt.heroName, 'Psíquico');
  assert.equal(JSON.parse(dt.data).curios.length, 3);
  const o = builds.parseInput({ game: 'outro', gameName: 'Elden Ring', title: 'Sangramento', data: { character: 'Samurai', items: ['Uchigatana', '', 'Escudo'] } });
  assert.equal(o.gameKey, 'elden-ring');
  assert.deepEqual(JSON.parse(o.data).items, ['Uchigatana', 'Escudo']);
});

test('builds: pede o que falta', () => {
  assert.throws(() => builds.parseInput({ game: 'xadrez', title: 'abc' }), /jogo/);
  assert.throws(() => builds.parseInput({ game: 'lol', title: 'ab', data: { champion: 'Ahri' } }), /nome/);
  assert.throws(() => builds.parseInput({ game: 'lol', title: 'Ahri', data: {} }), /campeão/);
  assert.throws(() => builds.parseInput({ game: 'deadlock', title: 'abc', data: {} }), /herói/);
  assert.throws(() => builds.parseInput({ game: 'darktide', title: 'abc', data: { klass: 'mago' } }), /classe/);
  assert.throws(() => builds.parseInput({ game: 'outro', title: 'abc', data: {} }), /jogo/);
});

// ---------- Partidas (banco falso) ----------
function fakeDb() {
  const parties = []; const members = []; const users = [
    { id: 'u1', displayName: 'Rique', username: 'rique', avatarUrl: null },
    { id: 'u2', displayName: 'Lia', username: 'lia', avatarUrl: null },
    { id: 'u3', displayName: 'Bia', username: 'bia', avatarUrl: null },
  ];
  const channels = [];
  let n = 0;
  const withInc = (p) => p && ({ ...p, host: users.find((u) => u.id === p.hostId), members: members.filter((m) => m.partyId === p.id).map((m) => ({ ...m, user: users.find((u) => u.id === m.userId) })) });
  const match = (p, w) => (!w.status || p.status === w.status) && (!w.hostId || p.hostId === w.hostId) && (!w.expiresAt?.gt || p.expiresAt > w.expiresAt.gt);
  return {
    _parties: parties, _members: members,
    gameParty: {
      count: async ({ where }) => parties.filter((p) => match(p, where)).length,
      create: async ({ data }) => { const { members: m, ...rest } = data; const p = { id: `p${++n}`, status: 'open', channelId: null, createdAt: new Date(), ...rest }; parties.push(p); if (m?.create) members.push({ id: `m${++n}`, partyId: p.id, createdAt: new Date(), ...m.create }); return withInc(p); },
      findUnique: async ({ where }) => withInc(parties.find((p) => p.id === where.id)),
      findMany: async ({ where }) => parties.filter((p) => match(p, where)).map(withInc),
      update: async ({ where, data }) => { const p = parties.find((x) => x.id === where.id); Object.assign(p, data); return p; },
    },
    gamePartyMember: {
      upsert: async ({ where, create, update }) => { const k = where.partyId_userId; const m = members.find((x) => x.partyId === k.partyId && x.userId === k.userId); if (m) Object.assign(m, update); else members.push({ id: `m${++n}`, createdAt: new Date(), ...create }); },
      create: async ({ data }) => { members.push({ id: `m${++n}`, createdAt: new Date(), ...data }); },
      deleteMany: async ({ where }) => { for (let i = members.length - 1; i >= 0; i -= 1) if (members[i].partyId === where.partyId && members[i].userId === where.userId) members.splice(i, 1); },
    },
    user: {
      findMany: async ({ where }) => users.filter((u) => where.id.in.includes(u.id)).map((u) => ({ id: u.id })),
      findUnique: async ({ where }) => users.find((u) => u.id === where.id),
    },
    channel: { findUnique: async ({ where }) => channels.find((c) => c.id === where.id) || null },
    _channels: channels,
  };
}
const T0 = Date.parse('2026-11-26T20:00:00Z');

test('partidas: abrir, entrar, encher, sair e fechar', async () => {
  const db = fakeDb();
  const u1 = { id: 'u1', displayName: 'Rique' }; const u2 = { id: 'u2' }; const u3 = { id: 'u3' };
  const p = await parties.create(u1, { gameName: 'Valorant', slots: 2, title: '' }, { db, now: T0 });
  assert.equal(p.title, 'Valorant');
  assert.equal(p.myStatus, 'host');
  assert.equal(p.filled, 1);
  assert.equal(new Date(p.expiresAt).getTime(), T0 + parties.LIVE_MS);
  const j = await parties.join(u2, p.id, { db, now: T0 });
  assert.equal(j.filled, 2);
  assert.equal(j.myStatus, 'joined');
  await assert.rejects(parties.join(u3, p.id, { db, now: T0 }), /cheia/);
  await parties.leave(u2, p.id, { db, now: T0 });
  assert.equal((await parties.join(u3, p.id, { db, now: T0 })).filled, 2);
  await assert.rejects(parties.close(u3, p.id, { db, now: T0 }), /Só quem abriu/);
  await parties.leave(u1, p.id, { db, now: T0 }); // anfitrião saindo fecha
  await assert.rejects(parties.join(u2, p.id, { db, now: T0 }), /acabou/);
  assert.deepEqual(await parties.list('u1', { db, now: T0 }), []);
});

test('partidas: horário, vagas e limite por pessoa', async () => {
  assert.throws(() => parties.parseInput({ gameName: 'X', slots: 1 }, T0), /vagas/);
  assert.throws(() => parties.parseInput({ gameName: '' }, T0), /jogo/);
  assert.throws(() => parties.parseInput({ gameName: 'X', startsAt: new Date(T0 - 3600_000).toISOString() }, T0), /passou/);
  assert.throws(() => parties.parseInput({ gameName: 'X', startsAt: new Date(T0 + 30 * 86400_000).toISOString() }, T0), /14 dias/);
  const later = parties.parseInput({ gameName: 'X', startsAt: new Date(T0 + 3600_000).toISOString() }, T0);
  assert.equal(later.expiresAt.getTime(), T0 + 3600_000 + parties.LIVE_MS);
  const db = fakeDb();
  for (let i = 0; i < parties.MAX_OPEN_PER_HOST; i += 1) await parties.create({ id: 'u1' }, { gameName: `Jogo ${i}` }, { db, now: T0 });
  await assert.rejects(parties.create({ id: 'u1' }, { gameName: 'Mais um' }, { db, now: T0 }), /partidas abertas/);
});

test('partidas: convite avisa quem foi chamado (uma vez só)', async () => {
  const db = fakeDb();
  const sent = [];
  const notify = async (_io, userId, notice) => { sent.push({ userId, ...notice }); };
  const p = await parties.create({ id: 'u1', displayName: 'Rique' }, { gameName: 'CS2', invite: ['u2', 'u2', 'u1', 'nao-existe'] }, { db, now: T0, notify, isBlocked: async () => false });
  assert.deepEqual(sent.map((s) => s.userId), ['u2']);
  assert.equal(sent[0].kind, 'PARTY_INVITE');
  assert.match(sent[0].title, /Rique te chamou pra jogar CS2/);
  assert.equal(sent[0].link, `/jogos/partidas?p=${p.id}`);
  assert.equal(p.invitedCount, 1);
  const again = await parties.invite({ id: 'u1', displayName: 'Rique' }, p.id, ['u2'], { db, now: T0, notify, isBlocked: async () => false });
  assert.equal(again.invited, 0);
  await assert.rejects(parties.invite({ id: 'u3' }, p.id, ['u2'], { db, now: T0, notify, isBlocked: async () => false }), /Entre na partida/);
  const view = await parties.list('u2', { db, now: T0 });
  assert.equal(view[0].myStatus, 'invited');
  assert.equal(view[0].invitedCount, undefined); // só o anfitrião vê
});

test('partidas: call cria a sala do anfitrião uma vez e reaproveita', async () => {
  const db = fakeDb();
  let created = 0;
  const tempVoice = { createRoom: async (host, opts) => { created += 1; const ch = { id: 'vc1', name: opts.name, userLimit: opts.userLimit, tempOwnerId: host.id }; db._channels.push(ch); return { channel: ch }; } };
  const p = await parties.create({ id: 'u1' }, { gameName: 'Deadlock', slots: 6 }, { db, now: T0 });
  await assert.rejects(parties.call({ id: 'u2' }, p.id, { db, now: T0, tempVoice }), /Entre na partida/);
  await parties.join({ id: 'u2' }, p.id, { db, now: T0 });
  const a = await parties.call({ id: 'u2' }, p.id, { db, now: T0, tempVoice });
  assert.equal(a.channel.tempOwnerId, 'u1');
  assert.equal(a.channel.userLimit, 6);
  assert.equal(a.channel.name, 'Partida · Deadlock');
  const b = await parties.call({ id: 'u1' }, p.id, { db, now: T0, tempVoice });
  assert.equal(b.channel.id, 'vc1');
  assert.equal(created, 1);
});

// ---------- Hotlist ----------
test('hotlist: soma o mês (Brasília), conta pessoas e deixa "ninguém" de fora', async () => {
  const calls = [];
  const db = {
    userSettings: { findMany: async () => [{ userId: 'oculto' }] },
    gamePlayDay: {
      groupBy: async (args) => {
        calls.push(args);
        if (args.by.length === 1) return [{ gameKey: 'valorant', _sum: { seconds: 7200 } }, { gameKey: 'cs2', _sum: { seconds: 3600 } }];
        return [{ gameKey: 'valorant', userId: 'a' }, { gameKey: 'valorant', userId: 'b' }, { gameKey: 'cs2', userId: 'a' }];
      },
    },
    gamePlaytime: { findMany: async () => [{ gameKey: 'valorant', name: 'VALORANT', steamAppId: null, iconUrl: null }, { gameKey: 'cs2', name: 'Counter-Strike 2', steamAppId: 730, iconUrl: null }] },
  };
  // 1º de dezembro 01:00 em UTC ainda é 30/11 em Brasília.
  const out = await hotlist.computeHotlist({ db, now: Date.parse('2026-12-01T01:00:00Z') });
  assert.equal(out.month, '2026-11');
  assert.equal(calls[0].where.day.gte, '2026-11-01');
  assert.deepEqual(calls[0].where.userId, { notIn: ['oculto'] });
  assert.deepEqual(out.games.map((g) => [g.position, g.name, g.players, g.seconds]), [[1, 'VALORANT', 2, 7200], [2, 'Counter-Strike 2', 1, 3600]]);
});

// ---------- Dados dos jogos ----------
test('LoL: só itens de Summoner\'s Rift compráveis, runas e feitiços do modo clássico', () => {
  const out = gameData.shapeLol({
    version: '15.23.1',
    champions: { data: { Ahri: { id: 'Ahri', name: 'Ahri', title: 'a raposa', tags: ['Mage'], image: { full: 'Ahri.png' } } } },
    items: { data: {
      1056: { name: 'Anel de Doran', gold: { total: 400, purchasable: true }, maps: { 11: true }, image: { full: '1056.png' } },
      3070: { name: 'Lágrima', gold: { total: 400, purchasable: true }, maps: { 11: false }, image: { full: '3070.png' } },
      3600: { name: 'Só Kalista', gold: { total: 0, purchasable: true }, maps: { 11: true }, requiredChampion: 'Kalista' },
      223020: { name: 'Arena', gold: { total: 1, purchasable: true }, maps: { 11: true } },
    } },
    runes: [{ id: 8100, key: 'Domination', name: 'Dominação', icon: 'perk/d.png', slots: [{ runes: [{ id: 8112, name: 'Eletrocutar', icon: 'perk/e.png' }] }] }],
    spells: { data: { SummonerFlash: { id: 'SummonerFlash', name: 'Flash', modes: ['CLASSIC'], image: { full: 'SummonerFlash.png' } }, SummonerSnowball: { id: 'SummonerSnowball', name: 'Bola', modes: ['ARAM'] } } },
  });
  assert.deepEqual(out.items.map((i) => i.id), ['1056']);
  assert.equal(out.champions[0].img, 'https://ddragon.leagueoflegends.com/cdn/15.23.1/img/champion/Ahri.png');
  assert.equal(out.runes[0].slots[0][0].img, 'https://ddragon.leagueoflegends.com/cdn/img/perk/e.png');
  assert.deepEqual(out.spells.map((s) => s.id), ['SummonerFlash']);
});

test('Deadlock: heróis jogáveis com as 4 habilidades e itens da loja', () => {
  const out = gameData.shapeDeadlock(
    [
      { id: 1, name: 'Infernus', player_selectable: true, images: { icon_image_small: 'https://x/i.png' }, items: { signature2: 'ab_b', signature1: 'ab_a', weapon_primary: 'w' } },
      { id: 2, name: 'Em teste', player_selectable: true, in_development: true, items: {} },
    ],
    [
      { type: 'ability', class_name: 'ab_a', name: 'Catalisador', image: 'https://x/a.png' },
      { type: 'ability', class_name: 'ab_b', name: 'Rastro', image_webp: 'https://x/b.webp' },
      { type: 'upgrade', id: 7, name: 'Extended Magazine', item_slot_type: 'weapon', item_tier: 1, cost: 800, shopable: true, shop_image: 'https://x/m.png' },
      { type: 'upgrade', id: 8, name: 'Escondido', shopable: false },
    ],
  );
  assert.deepEqual(out.heroes.map((h) => h.name), ['Infernus']);
  assert.deepEqual(out.heroes[0].abilities.map((a) => [a.slot, a.name]), [[1, 'Catalisador'], [2, 'Rastro']]);
  assert.deepEqual(out.items.map((i) => [i.id, i.slot, i.cost]), [[7, 'weapon', 800]]);
});

// ---------- Celular: addons do Bedrock (CurseForge) e jogos com mods ----------
const bedrock = require('../src/services/gameHub/bedrock');

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), headers: init?.headers || {} });
    const u = new URL(url);
    const hit = routes[u.pathname];
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => (typeof hit === 'function' ? hit(u) : hit) };
  };
  return { impl, calls };
}

const CF_MOD = {
  id: 1234, gameId: 78022, name: 'Actions & Stuff', summary: 'Animações novas', classId: 4984,
  logo: { thumbnailUrl: 'https://media.forgecdn.net/t.png', url: 'https://media.forgecdn.net/f.png' },
  links: { websiteUrl: 'https://www.curseforge.com/minecraft-bedrock/addons/actions-stuff' },
  downloadCount: 98765.0, categories: [{ name: 'Animações' }, { name: 'Utilidades' }], authors: [{ name: 'Oreville' }],
  dateModified: '2026-11-20T10:00:00Z', allowModDistribution: true, mainFileId: 2,
  latestFiles: [
    { id: 1, displayName: 'v1 beta', fileName: 'actions-beta.zip', releaseType: 2, fileDate: '2026-10-01T00:00:00Z', fileLength: 100, downloadUrl: 'https://edge.forgecdn.net/1/a.zip', gameVersions: ['1.21.40', 'Bedrock'] },
    { id: 2, displayName: 'v2', fileName: 'Actions.mcaddon', releaseType: 1, fileDate: '2026-11-20T00:00:00Z', fileLength: 2048, downloadUrl: 'https://edge.forgecdn.net/2/Actions.mcaddon', gameVersions: ['1.21.50'] },
  ],
};

test('Bedrock: sem chave responde 503 com code no_key (sem chamar a CurseForge)', async () => {
  remote._resetForTests();
  const { impl, calls } = fakeFetch({});
  await assert.rejects(bedrock.search({ q: 'casa' }, { key: '', fetchImpl: impl }), (e) => e.status === 503 && e.code === 'no_key');
  assert.equal(calls.length, 0);
});

test('Bedrock: busca monta a URL certa e manda a chave no cabeçalho', async () => {
  remote._resetForTests();
  const { impl, calls } = fakeFetch({ '/v1/mods/search': { data: [CF_MOD], pagination: { totalCount: 45 } } });
  const out = await bedrock.search({ q: '  furniture ', classId: '4984', sort: 'popular', page: '1' }, { key: 'k-test', fetchImpl: impl });
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('gameId'), '78022');
  assert.equal(u.searchParams.get('classId'), '4984');
  assert.equal(u.searchParams.get('searchFilter'), 'furniture');
  assert.equal(u.searchParams.get('sortField'), '13'); // com texto, ordena por relevância
  assert.equal(u.searchParams.get('index'), '20');
  assert.equal(calls[0].headers['x-api-key'], 'k-test');
  assert.equal(out.page, 1);
  assert.equal(out.hasMore, true); // 45 resultados, página 2 de 3
  const m = out.mods[0];
  assert.equal(m.name, 'Actions & Stuff');
  assert.equal(m.icon, 'https://media.forgecdn.net/t.png');
  assert.deepEqual(m.categories, ['Animações', 'Utilidades']);
  assert.equal(m.mainFile.id, 2);
  assert.equal(m.mainFile.installable, true);
  assert.deepEqual(m.mainFile.versions, ['1.21.50']);
});

test('Bedrock: página e ordem fora do esperado viram valores seguros', () => {
  const { path, page } = bedrock.searchPath({ sort: 'qualquer', page: '-3', classId: 'abc' });
  const u = new URL(`https://x${path}`);
  assert.equal(page, 0);
  assert.equal(u.searchParams.get('sortField'), '2');
  assert.equal(u.searchParams.get('classId'), null);
  assert.equal(bedrock.searchPath({ page: '99999' }).page, 499); // index + pageSize ≤ 10.000
  assert.equal(new URL(`https://x${bedrock.searchPath({ sort: 'name' }).path}`).searchParams.get('sortOrder'), 'asc');
});

test('Bedrock: arquivos mais novos primeiro; autor que proíbe download fica sem link', async () => {
  remote._resetForTests();
  const locked = { ...CF_MOD, id: 77, allowModDistribution: false };
  const { impl } = fakeFetch({
    '/v1/mods/77': { data: locked },
    '/v1/mods/77/files': { data: [
      { ...CF_MOD.latestFiles[0], downloadUrl: null },
      { ...CF_MOD.latestFiles[1], downloadUrl: null },
    ] },
  });
  const out = await bedrock.files('77', { key: 'k', fetchImpl: impl });
  assert.equal(out.mod.canDownload, false);
  assert.deepEqual(out.files.map((f) => f.id), [2, 1]);
  assert.equal(out.files[0].downloadUrl, null);
  assert.equal(out.files[1].installable, false); // .zip o Minecraft não importa sozinho
  assert.equal(out.files[1].channel, 'beta');
});

test('Bedrock: item de outro jogo e id inválido são recusados', async () => {
  remote._resetForTests();
  const { impl } = fakeFetch({ '/v1/mods/5': { data: { ...CF_MOD, id: 5, gameId: 432 } }, '/v1/mods/5/files': { data: [] } });
  await assert.rejects(bedrock.files('5', { key: 'k', fetchImpl: impl }), (e) => e.status === 404);
  await assert.rejects(bedrock.files('abc', { key: 'k', fetchImpl: impl }), (e) => e.status === 400);
});

test('Bedrock: tipos de conteúdo só com as classes, na ordem do site', async () => {
  remote._resetForTests();
  const { impl } = fakeFetch({ '/v1/categories': { data: [
    { id: 6913, name: 'Maps', slug: 'maps', isClass: true, displayIndex: 2 },
    { id: 4984, name: 'Addons', slug: 'addons', isClass: true, displayIndex: 1 },
    { id: 9, name: 'Sub', classId: 4984, isClass: false },
  ] } });
  const out = await bedrock.classes({ key: 'k', fetchImpl: impl });
  assert.deepEqual(out.classes.map((c) => c.slug), ['addons', 'maps']);
});

test('Jogos de Android: lista sem pacote repetido e com o que fazer em cada um', () => {
  const { games } = bedrock.androidGames();
  const pkgs = games.flatMap((g) => g.packages);
  assert.equal(new Set(pkgs).size, pkgs.length);
  assert.ok(games.find((g) => g.packages.includes('com.mojang.minecraftpe'))?.support === 'install');
  for (const g of games) {
    assert.ok(['install', 'ingame', 'loader'].includes(g.support), g.id);
    assert.ok(g.tip && g.name, g.id);
    if (g.support === 'loader') assert.ok(g.loaderPackages.length && g.url, g.id);
  }
});
