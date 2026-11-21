// VPN do Project Club (botão ao lado do globo no app de PC).
//
// Os servidores são os do VPN Gate (projeto acadêmico da Universidade de
// Tsukuba, servidores de voluntários, OpenVPN): o tráfego NÃO passa pelos
// servidores do Project Club. Aqui o servidor só busca a lista pública, guarda
// em cache e entrega ao app a configuração do servidor escolhido.
//
// Os voluntários guardam registro das conexões (IP, horário, destinos) por
// meses — o app avisa isso; não é uma VPN anônima.
const LIST_URL = 'https://www.vpngate.net/api/iphone/';
const TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_CONFIG_BYTES = 64 * 1024;
// Brasil primeiro, depois os mais perto (menos ping daqui).
const COUNTRY_ORDER = ['BR', 'US', 'UY', 'AR', 'CL', 'CA', 'MX', 'PT', 'ES'];

let cache = { at: 0, list: null, byId: new Map() };
let inflight = null;

// Campos: HostName,IP,Score,Ping,Speed,CountryLong,CountryShort,NumVpnSessions,
// Uptime,TotalUsers,TotalTraffic,LogType,Operator,Message,OpenVPN_ConfigData_Base64
function parseCsv(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line || line.startsWith('*') || line.startsWith('#')) continue;
    const f = line.split(',');
    if (f.length < 15) continue;
    const [host, ip, score, ping, speed, countryLong, country, sessions, uptime] = f;
    const configB64 = f[14];
    if (!/^[\d.]+$/.test(ip) || !/^[A-Z]{2}$/.test(country) || !configB64) continue;
    let config;
    try { config = Buffer.from(configB64, 'base64').toString('utf8'); } catch { continue; }
    if (!/^\s*remote\s+\S+\s+\d+/m.test(config) || Buffer.byteLength(config) > MAX_CONFIG_BYTES) continue;
    const proto = (config.match(/^\s*proto\s+(tcp|udp)/m) || [])[1] || 'udp';
    out.push({
      id: `${String(host).replace(/[^\w-]/g, '').slice(0, 40)}-${ip.replace(/\./g, '_')}`,
      country, countryName: String(countryLong || country).replace(/\s*\(.*\)\s*$/, '').trim(),
      ping: Number(ping) || null, speedMbps: Math.round((Number(speed) || 0) / 1e6),
      sessions: Number(sessions) || 0, uptimeDays: Math.floor((Number(uptime) || 0) / 86_400_000),
      score: Number(score) || 0, proto,
      config,
    });
  }
  return out;
}

const countryRank = (c) => { const i = COUNTRY_ORDER.indexOf(c); return i === -1 ? COUNTRY_ORDER.length : i; };

/** Lista pública (sem a configuração), ordenada: países perto primeiro, depois os mais rápidos. */
function publicList(list) {
  return list
    .slice()
    .sort((a, b) => countryRank(a.country) - countryRank(b.country) || a.countryName.localeCompare(b.countryName) || b.speedMbps - a.speedMbps)
    .map(({ config, score, ...rest }) => rest); // eslint-disable-line no-unused-vars
}

async function refresh() {
  const res = await fetch(LIST_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'User-Agent': 'ProjectClub/1.0 (+https://projectclub.shardweb.app)' } });
  if (!res.ok) throw new Error(`VPN Gate respondeu HTTP ${res.status}`);
  const list = parseCsv(await res.text());
  if (!list.length) throw new Error('lista do VPN Gate vazia');
  cache = { at: Date.now(), list, byId: new Map(list.map((s) => [s.id, s])) };
  return cache;
}

async function getCache() {
  if (cache.list && Date.now() - cache.at < TTL_MS) return cache;
  if (!inflight) inflight = refresh().finally(() => { inflight = null; });
  try { return await inflight; } catch (err) {
    if (cache.list) return cache; // VPN Gate fora do ar: usa a última lista boa
    throw err;
  }
}

async function listServers() {
  const c = await getCache();
  return { updatedAt: new Date(c.at).toISOString(), servers: publicList(c.list) };
}

async function getConfig(id) {
  const c = await getCache();
  return c.byId.get(String(id || '')) || null;
}

module.exports = { listServers, getConfig, _test: { parseCsv, publicList } };
