// Game Hub → dados dos jogos pras builds, buscados das fontes públicas e
// enxugados (o cliente recebe só o que a tela usa, uns 60 KB):
//  - League of Legends: Data Dragon (oficial da Riot) — campeões, itens de
//    Summoner's Rift, runas, feitiços e as habilidades de cada campeão;
//  - Deadlock: deadlock-api.com (aberto, da comunidade) — heróis com as 4
//    habilidades e os itens da loja (arma, vitalidade, espírito).
// Guardado 6 h em memória; se a fonte cair, fica a última versão boa.
const { fetchJson, cached } = require('./remote');

const TTL = 6 * 60 * 60 * 1000;
const DD = 'https://ddragon.leagueoflegends.com';
const DL = 'https://api.deadlock-api.com/v1/assets';

// ---------- League of Legends ----------
function shapeLol({ version, champions, items, runes, spells }) {
  const cdn = `${DD}/cdn/${version}`;
  const champs = Object.values(champions?.data || {}).map((c) => ({
    id: c.id, name: c.name, title: c.title, tags: c.tags || [], img: `${cdn}/img/champion/${c.image?.full || `${c.id}.png`}`,
  })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const seen = new Set();
  const its = Object.entries(items?.data || {})
    .filter(([id, it]) => id.length <= 4 && it?.maps?.['11'] && it?.gold?.purchasable && it.inStore !== false && !it.requiredChampion && !it.requiredAlly && !it.hideFromAll)
    .map(([id, it]) => ({ id, name: it.name, gold: it.gold?.total || 0, tags: it.tags || [], depth: it.depth || 1, into: (it.into || []).length, img: `${cdn}/img/item/${it.image?.full || `${id}.png`}` }))
    .filter((it) => { const k = it.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.gold - b.gold || a.name.localeCompare(b.name, 'pt-BR'));
  const trees = (runes || []).map((t) => ({
    id: t.id, key: t.key, name: t.name, img: `${DD}/cdn/img/${t.icon}`,
    slots: (t.slots || []).map((s) => (s.runes || []).map((r) => ({ id: r.id, name: r.name, img: `${DD}/cdn/img/${r.icon}` }))),
  }));
  const sps = Object.values(spells?.data || {})
    .filter((s) => (s.modes || []).includes('CLASSIC'))
    .map((s) => ({ id: s.id, name: s.name, img: `${cdn}/img/spell/${s.image?.full || `${s.id}.png`}` }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return { version, champions: champs, items: its, runes: trees, spells: sps };
}

async function lolData(deps = {}) {
  return cached('data:lol', TTL, async () => {
    const versions = await fetchJson(`${DD}/api/versions.json`, deps);
    const version = String(versions?.[0] || '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('versão do Data Dragon inválida');
    const base = `${DD}/cdn/${version}/data/pt_BR`;
    const [champions, items, runes, spells] = await Promise.all([
      fetchJson(`${base}/champion.json`, deps), fetchJson(`${base}/item.json`, deps),
      fetchJson(`${base}/runesReforged.json`, deps), fetchJson(`${base}/summoner.json`, deps),
    ]);
    return shapeLol({ version, champions, items, runes, spells });
  });
}

// Habilidades de um campeão (Q, W, E, R + passiva) pra ordem de habilidades.
async function lolChampion(id, deps = {}) {
  const safe = String(id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 30);
  if (!safe) return null;
  const { version } = await lolData(deps);
  return cached(`data:lol:champ:${version}:${safe}`, TTL, async () => {
    const json = await fetchJson(`${DD}/cdn/${version}/data/pt_BR/champion/${safe}.json`, deps);
    const c = json?.data?.[safe];
    if (!c) throw new Error('campeão não encontrado');
    const cdn = `${DD}/cdn/${version}`;
    return {
      id: c.id, name: c.name,
      passive: c.passive ? { name: c.passive.name, img: `${cdn}/img/passive/${c.passive.image?.full}` } : null,
      spells: (c.spells || []).slice(0, 4).map((s, i) => ({ key: 'QWER'[i], name: s.name, img: `${cdn}/img/spell/${s.image?.full}` })),
    };
  });
}

// ---------- Deadlock ----------
function shapeDeadlock(heroes, items) {
  const byClass = new Map((items || []).map((it) => [it.class_name, it]));
  const hs = (heroes || [])
    .filter((h) => h?.player_selectable && !h.disabled && !h.in_development)
    .map((h) => ({
      id: h.id, name: h.name,
      img: h.images?.icon_image_small_webp || h.images?.icon_image_small || h.images?.icon_hero_card_webp || h.images?.icon_hero_card || null,
      abilities: Object.entries(h.items || {})
        .filter(([k]) => /^signature[1-4]$/.test(k))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, cls]) => { const a = byClass.get(cls); return { slot: Number(k.slice(-1)), name: a?.name || cls, img: a?.image_webp || a?.image || null }; }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const its = (items || [])
    .filter((it) => it?.type === 'upgrade' && it.shopable)
    .map((it) => ({
      id: it.id, name: it.name, slot: it.item_slot_type || 'weapon', tier: it.item_tier || 1, cost: it.cost || 0,
      active: !!it.is_active_item, img: it.shop_image_webp || it.shop_image || it.image_webp || it.image || null,
    }))
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name, 'pt-BR'));
  return { heroes: hs, items: its };
}

async function deadlockData(deps = {}) {
  return cached('data:deadlock', TTL, async () => {
    const [heroes, items] = await Promise.all([fetchJson(`${DL}/heroes`, { ...deps, timeoutMs: 20_000 }), fetchJson(`${DL}/items`, { ...deps, timeoutMs: 20_000 })]);
    const shaped = shapeDeadlock(heroes, items);
    if (!shaped.heroes.length || !shaped.items.length) throw new Error('dados do Deadlock vieram vazios');
    return shaped;
  });
}

// ---------- Darktide (sem API: classes fixas, o resto é texto) ----------
const DARKTIDE_CLASSES = [
  { id: 'veteran', name: 'Veterano' },
  { id: 'zealot', name: 'Zelote' },
  { id: 'psyker', name: 'Psíquico' },
  { id: 'ogryn', name: 'Ogryn' },
  { id: 'arbitrator', name: 'Arbitrador' },
  { id: 'hivescum', name: 'Escória da Colmeia' },
];

module.exports = { lolData, lolChampion, deadlockData, shapeLol, shapeDeadlock, DARKTIDE_CLASSES };
