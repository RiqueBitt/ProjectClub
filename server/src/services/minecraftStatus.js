// Status do servidor de Minecraft ao vivo (item "Status do Minecraft ao
// vivo"): consulta pelo protocolo público do Minecraft Java ("Server List
// Ping") — o mesmo que a lista de servidores do jogo usa. Não precisa de
// plugin nem senha. Resposta em cache por CACHE_MS.
const net = require('net');
const dns = require('dns').promises;

const DEFAULT = { enabled: true, host: 'redesun.minesrv.net', port: 25565, name: 'RedeSun' };
const CACHE_MS = 60_000;
const TIMEOUT_MS = 5000;
const HOST_RE = /^[a-z0-9.-]{1,253}$/i;

let cache = { key: null, at: 0, value: null };

function varint(n) {
  const out = [];
  let v = n >>> 0;
  do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v);
  return Buffer.from(out);
}
function readVarint(buf, offset = 0) {
  let num = 0; let shift = 0; let i = offset;
  for (;;) {
    if (i >= buf.length) return null;
    const b = buf[i++];
    num |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return { value: num, size: i - offset };
    shift += 7;
    if (shift > 35) throw new Error('varint grande demais');
  }
}
function packet(id, payload) {
  const body = Buffer.concat([varint(id), payload]);
  return Buffer.concat([varint(body.length), body]);
}
function handshake(host, port) {
  const h = Buffer.from(host, 'utf8');
  const p = Buffer.alloc(2); p.writeUInt16BE(port);
  return packet(0x00, Buffer.concat([varint(767), varint(h.length), h, p, varint(1)]));
}

/** Tira cores/formatação "§x" do MOTD (texto ou componente JSON). */
function motdText(desc) {
  const flat = (d) => {
    if (d == null) return '';
    if (typeof d === 'string') return d;
    return `${d.text || ''}${Array.isArray(d.extra) ? d.extra.map(flat).join('') : ''}`;
  };
  return flat(desc).replace(/§[0-9a-fk-or]/gi, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function parseStatus(json) {
  const players = json?.players || {};
  return {
    online: true,
    players: { online: Number(players.online) || 0, max: Number(players.max) || 0, sample: (players.sample || []).slice(0, 12).map((p) => String(p?.name || '').replace(/§./g, '').slice(0, 32)).filter(Boolean) },
    version: String(json?.version?.name || '').replace(/§./g, '').slice(0, 60) || null,
    motd: motdText(json?.description),
  };
}

function ping(host, port, { connect = net.connect, timeoutMs = TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port });
    let buf = Buffer.alloc(0);
    const done = (err, val) => { clearTimeout(t); sock.destroy(); if (err) reject(err); else resolve(val); };
    const t = setTimeout(() => done(new Error('tempo esgotado')), timeoutMs);
    sock.on('error', (e) => done(e));
    sock.on('connect', () => { sock.write(handshake(host, port)); sock.write(packet(0x00, Buffer.alloc(0))); });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > 1024 * 1024) return done(new Error('resposta grande demais'));
      try {
        const len = readVarint(buf, 0); if (!len || buf.length < len.size + len.value) return undefined;
        const id = readVarint(buf, len.size); if (!id || id.value !== 0) return done(new Error('resposta inesperada'));
        const strLen = readVarint(buf, len.size + id.size);
        const start = len.size + id.size + strLen.size;
        return done(null, JSON.parse(buf.subarray(start, start + strLen.value).toString('utf8')));
      } catch (e) { return done(e); }
    });
  });
}

async function resolveTarget(host, port) {
  if (port === 25565) {
    try {
      const [srv] = await dns.resolveSrv(`_minecraft._tcp.${host}`);
      if (srv?.name) return { host: srv.name, port: srv.port };
    } catch { /* sem SRV */ }
  }
  return { host, port };
}

async function getStatus(cfg, { pingImpl = ping, resolver = resolveTarget, now = Date.now() } = {}) {
  const c = { ...DEFAULT, ...(cfg || {}) };
  if (!c.enabled) return { enabled: false };
  if (!HOST_RE.test(c.host) || !(c.port > 0 && c.port < 65536)) return { enabled: true, name: c.name, host: c.host, online: false, error: 'endereço inválido' };
  const key = `${c.host}:${c.port}`;
  if (cache.key === key && now - cache.at < CACHE_MS) return cache.value;
  let value;
  try {
    const t = await resolver(c.host, c.port);
    value = { enabled: true, name: c.name, host: c.host, port: c.port, ...parseStatus(await pingImpl(t.host, t.port)) };
  } catch {
    value = { enabled: true, name: c.name, host: c.host, port: c.port, online: false };
  }
  value.checkedAt = new Date(now).toISOString();
  cache = { key, at: now, value };
  return value;
}

function _reset() { cache = { key: null, at: 0, value: null }; }

module.exports = { DEFAULT, getStatus, parseStatus, motdText, ping, handshake, varint, readVarint, HOST_RE, _reset };
