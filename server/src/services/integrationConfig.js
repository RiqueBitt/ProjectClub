// Configurações das integrações (model IntegrationConfig), com cache curto.
const getPrisma = () => require('../config/prisma');
const cache = new Map(); // key -> { at, data }
const TTL_MS = 30_000;

async function getConfig(key, defaults = {}, { db = getPrisma() } = {}) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { ...defaults, ...hit.data };
  let data = {};
  try {
    const row = await db.integrationConfig.findUnique({ where: { key } });
    data = row ? JSON.parse(row.data || '{}') : {};
  } catch { data = {}; }
  cache.set(key, { at: Date.now(), data });
  return { ...defaults, ...data };
}

async function setConfig(key, data, userId, { db = getPrisma() } = {}) {
  const json = JSON.stringify(data || {});
  await db.integrationConfig.upsert({ where: { key }, create: { key, data: json, updatedBy: userId || null }, update: { data: json, updatedBy: userId || null } });
  cache.set(key, { at: Date.now(), data: data || {} });
  return data;
}

function _reset() { cache.clear(); }

module.exports = { getConfig, setConfig, _reset };
