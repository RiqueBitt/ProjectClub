// Localização aproximada de um IP (país, estado, cidade, provedor) pra
// staff ver de onde veio cada inscrição. Só roda no servidor e só pra
// quem é admin da plataforma — o IP nunca é mostrado pra outros membros.
//
// Usa o ipwho.is (HTTPS, sem chave) e, se ele falhar, o ip-api.com. O
// resultado fica guardado na própria inscrição (MembershipApplication.ipGeo)
// e num cache em memória, então cada IP é consultado no máximo uma vez.
// É sempre aproximado: IP de celular/CGNAT costuma apontar pra cidade da
// operadora, não da pessoa.

const net = require('net');

const TIMEOUT_MS = 4000;
const CACHE_MAX = 2000;
const cache = new Map(); // ip -> geo (objeto) | null

// IP que não tem localização pública (rede local, loopback, CGNAT...).
function isPrivateIp(ip) {
  const v = String(ip || '').replace(/^::ffff:/, '');
  if (!net.isIP(v)) return true;
  if (net.isIPv4(v)) {
    const [a, b] = v.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const low = v.toLowerCase();
  return low === '::1' || low === '::' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80');
}

// Só IP de verdade (v4/v6), sem porta nem lixo — o que vai pro banco e pro BlockedIp.
function normalizeIp(ip) {
  const v = String(ip || '').trim().replace(/^::ffff:/, '');
  return net.isIP(v) ? v.slice(0, 64) : null;
}

const clip = (v, n = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

async function fetchJson(url, fetchImpl) {
  const r = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'ProjectClub/1.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function fromIpwho(ip, fetchImpl) {
  const d = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}?lang=pt-BR`, fetchImpl);
  if (!d || d.success === false) throw new Error(d?.message || 'falhou');
  return {
    country: clip(d.country), countryCode: clip(d.country_code, 4), region: clip(d.region), regionCode: clip(d.region_code, 8),
    city: clip(d.city), postal: clip(d.postal, 16), continent: clip(d.continent),
    lat: typeof d.latitude === 'number' ? d.latitude : null, lon: typeof d.longitude === 'number' ? d.longitude : null,
    timezone: clip(d.timezone?.id, 64), isp: clip(d.connection?.isp, 120), org: clip(d.connection?.org, 120),
    asn: d.connection?.asn ? `AS${d.connection.asn}` : null,
    proxy: null, mobile: null, source: 'ipwho.is',
  };
}

async function fromIpApi(ip, fetchImpl) {
  const fields = 'status,message,continent,country,countryCode,region,regionName,city,district,zip,lat,lon,timezone,isp,org,as,mobile,proxy,hosting';
  const d = await fetchJson(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=pt-BR&fields=${fields}`, fetchImpl);
  if (!d || d.status !== 'success') throw new Error(d?.message || 'falhou');
  return {
    country: clip(d.country), countryCode: clip(d.countryCode, 4), region: clip(d.regionName), regionCode: clip(d.region, 8),
    city: clip(d.city), district: clip(d.district), postal: clip(d.zip, 16), continent: clip(d.continent),
    lat: typeof d.lat === 'number' ? d.lat : null, lon: typeof d.lon === 'number' ? d.lon : null,
    timezone: clip(d.timezone, 64), isp: clip(d.isp, 120), org: clip(d.org, 120), asn: clip(String(d.as || '').split(' ')[0], 16),
    proxy: typeof d.proxy === 'boolean' ? d.proxy || !!d.hosting : null, mobile: typeof d.mobile === 'boolean' ? d.mobile : null,
    source: 'ip-api.com',
  };
}

// null quando não dá pra localizar (IP privado ou os dois serviços falharam).
async function lookupIp(rawIp, { fetchImpl = fetch } = {}) {
  const ip = normalizeIp(rawIp);
  if (!ip || isPrivateIp(ip)) return null;
  if (cache.has(ip)) return cache.get(ip);
  let geo = null;
  for (const fn of [fromIpwho, fromIpApi]) {
    try { geo = await fn(ip, fetchImpl); break; } catch { /* tenta o próximo */ }
  }
  if (geo) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(ip, geo);
  }
  return geo;
}

module.exports = { lookupIp, isPrivateIp, normalizeIp };
