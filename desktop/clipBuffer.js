// Clipes (Fase 7): buffer circular dos últimos ~30 s de vídeo, em memória.
//
// O MediaRecorder (janela escondida, ver clips/recorder.js) entrega um
// fluxo WebM contínuo em pedaços de ~1 s. Num WebM ao vivo só o COMEÇO do
// fluxo tem o cabeçalho (EBML + Segment + Info + Tracks); depois vêm
// "Clusters" (blocos de quadros com um carimbo de tempo). Cortar pedaços
// do meio não dá um arquivo tocável — então este módulo lê o fluxo, guarda
// o cabeçalho uma vez e uma fila de Clusters inteiros, e na hora de salvar
// monta: cabeçalho + Clusters a partir de um QUADRO-CHAVE (sem ele o vídeo
// começa cinza/quebrado), com os carimbos de tempo deslocados pra o clipe
// começar em 0:00.
//
// Só Buffer/números — sem Electron, sem disco. Testado em
// test/clipBuffer.test.js com WebM sintético.

const ID = {
  EBML: 0x1A45DFA3,
  SEGMENT: 0x18538067,
  CLUSTER: 0x1F43B675,
  TIMECODE: 0xE7,
  SIMPLE_BLOCK: 0xA3,
  BLOCK_GROUP: 0xA0,
  BLOCK: 0xA1,
  REFERENCE_BLOCK: 0xFB,
  TRACKS: 0x1654AE6B,
  TRACK_ENTRY: 0xAE,
  TRACK_NUMBER: 0xD7,
  TRACK_TYPE: 0x83,
  INFO: 0x1549A966,
  TIMECODE_SCALE: 0x2AD7B1,
};
// Elementos de nível 1 (filhos do Segment) — se aparecer um desses dentro
// de um Cluster de tamanho desconhecido, o Cluster acabou.
const LEVEL1 = new Set([0x114D9B74, 0x1549A966, 0x1654AE6B, 0x1F43B675, 0x1C53BB6B, 0x1941A469, 0x1043A770, 0x1254C367]);

const DEFAULT_KEEP_MS = 30_000;
const DEFAULT_MAX_BYTES = 300 * 1024 * 1024;
// Elemento "normal" acima disso = fluxo corrompido (protege a memória).
const MAX_ELEMENT_BYTES = 64 * 1024 * 1024;

// ---------- EBML: números de tamanho variável ----------
function vintLength(first) {
  for (let i = 0; i < 8; i += 1) if (first & (0x80 >> i)) return i + 1;
  return 0; // inválido
}

// ID do elemento (com o bit marcador, como na especificação). null = faltam bytes.
function readId(buf, pos) {
  if (pos >= buf.length) return null;
  const len = vintLength(buf[pos]);
  if (!len || len > 4) throw new Error('WebM inválido (ID)');
  if (pos + len > buf.length) return null;
  let v = 0;
  for (let i = 0; i < len; i += 1) v = (v * 256) + buf[pos + i];
  return { id: v, len };
}

// Tamanho do elemento. unknown = todos os bits 1 (fluxo ao vivo).
function readSize(buf, pos) {
  if (pos >= buf.length) return null;
  const len = vintLength(buf[pos]);
  if (!len) throw new Error('WebM inválido (tamanho)');
  if (pos + len > buf.length) return null;
  let v = buf[pos] & (0xFF >> len);
  let allOnes = v === (0xFF >> len);
  for (let i = 1; i < len; i += 1) {
    v = (v * 256) + buf[pos + i];
    if (buf[pos + i] !== 0xFF) allOnes = false;
  }
  return { size: allOnes ? null : v, len };
}

function readHeader(buf, pos) {
  const id = readId(buf, pos);
  if (!id) return null;
  const size = readSize(buf, pos + id.len);
  if (!size) return null;
  return { id: id.id, size: size.size, headerLen: id.len + size.len };
}

function readUInt(buf, start, len) {
  let v = 0;
  for (let i = 0; i < len; i += 1) v = (v * 256) + buf[start + i];
  return v;
}

function writeUInt(buf, start, len, value) {
  let v = Math.max(0, Math.floor(value));
  for (let i = len - 1; i >= 0; i -= 1) { buf[start + i] = v % 256; v = Math.floor(v / 256); }
}

// Número da faixa no começo de um (Simple)Block (vint sem marcador).
function blockTrack(buf, start) {
  const len = vintLength(buf[start]);
  if (!len) return null;
  let v = buf[start] & (0xFF >> len);
  for (let i = 1; i < len; i += 1) v = (v * 256) + buf[start + i];
  return { track: v, len };
}

// Percorre os filhos (todos com tamanho conhecido) de um elemento completo.
function* children(buf, start, end) {
  let pos = start;
  while (pos < end) {
    const h = readHeader(buf, pos);
    if (!h || h.size == null) return;
    const dataStart = pos + h.headerLen;
    const dataEnd = dataStart + h.size;
    if (dataEnd > end) return;
    yield { id: h.id, dataStart, dataEnd };
    pos = dataEnd;
  }
}

// Faixas de vídeo descritas no elemento Tracks.
function parseVideoTracks(buf, start, end) {
  const video = new Set();
  for (const entry of children(buf, start, end)) {
    if (entry.id !== ID.TRACK_ENTRY) continue;
    let number = null;
    let type = null;
    for (const c of children(buf, entry.dataStart, entry.dataEnd)) {
      if (c.id === ID.TRACK_NUMBER) number = readUInt(buf, c.dataStart, c.dataEnd - c.dataStart);
      if (c.id === ID.TRACK_TYPE) type = readUInt(buf, c.dataStart, c.dataEnd - c.dataStart);
    }
    if (number != null && type === 1) video.add(number);
  }
  return video;
}

class WebmClipBuffer {
  constructor({ keepMs = DEFAULT_KEEP_MS, maxBytes = DEFAULT_MAX_BYTES, marginMs = 6000 } = {}) {
    this.keepMs = keepMs;
    this.maxBytes = maxBytes;
    this.marginMs = marginMs;
    this.reset();
  }

  reset() {
    this.pending = Buffer.alloc(0);
    this.phase = 'top'; // top → segment → cluster
    this.headerParts = [];
    this.header = null;
    this.videoTracks = null; // Set | null (sem Tracks: considera a faixa 1)
    // Carimbos de tempo do WebM vêm em "ticks" (TimecodeScale, em ns). O
    // MediaRecorder usa 1 ms; se vier outro, converte.
    this.msPerTick = 1;
    this.clusters = [];
    this.bytes = 0;
    this.current = null;
    this.error = null;
  }

  get headerReady() { return !!this.header; }

  // Recebe mais um pedaço do fluxo. Nunca lança: fluxo corrompido zera o
  // buffer e espera o próximo começo de gravação.
  push(chunk) {
    if (!chunk || !chunk.length) return;
    this.pending = this.pending.length ? Buffer.concat([this.pending, Buffer.from(chunk)]) : Buffer.from(chunk);
    try {
      this._parse();
    } catch (err) {
      this.reset();
      this.error = err.message;
    }
  }

  _isVideo(track) {
    return this.videoTracks && this.videoTracks.size ? this.videoTracks.has(track) : track === 1;
  }

  _consume(n) {
    const part = this.pending.subarray(0, n);
    this.pending = this.pending.subarray(n);
    return Buffer.from(part);
  }

  _parse() {
    for (;;) {
      if (this.phase === 'top') {
        const h = readHeader(this.pending, 0);
        if (!h) return;
        if (h.id === ID.EBML) {
          if (h.size == null || h.size > MAX_ELEMENT_BYTES) throw new Error('WebM inválido (EBML)');
          if (this.pending.length < h.headerLen + h.size) return;
          this.headerParts.push(this._consume(h.headerLen + h.size));
          continue;
        }
        if (h.id === ID.SEGMENT) {
          this.headerParts.push(this._consume(h.headerLen));
          this.phase = 'segment';
          continue;
        }
        throw new Error('WebM inválido (começo)');
      }

      if (this.phase === 'segment') {
        const h = readHeader(this.pending, 0);
        if (!h) return;
        if (h.id === ID.CLUSTER) {
          if (!this.header) this.header = Buffer.concat(this.headerParts);
          this._startCluster(h);
          continue;
        }
        if (h.size == null || h.size > MAX_ELEMENT_BYTES) throw new Error('WebM inválido (nível 1)');
        if (this.pending.length < h.headerLen + h.size) return;
        const el = this._consume(h.headerLen + h.size);
        if (!this.header) {
          if (h.id === ID.TRACKS) this.videoTracks = parseVideoTracks(el, h.headerLen, el.length);
          if (h.id === ID.INFO) {
            for (const ch of children(el, h.headerLen, el.length)) {
              if (ch.id === ID.TIMECODE_SCALE) {
                const ns = readUInt(el, ch.dataStart, ch.dataEnd - ch.dataStart);
                if (ns > 0) this.msPerTick = ns / 1e6;
              }
            }
          }
          this.headerParts.push(el);
        }
        // Depois dos Clusters (Cues/Tags no fim): não interessa pro clipe.
        continue;
      }

      // phase === 'cluster'
      const c = this.current;
      if (c.remaining === 0) { this._finishCluster(); this.phase = 'segment'; continue; }
      const h = readHeader(this.pending, 0);
      if (!h) return;
      if (c.remaining == null && LEVEL1.has(h.id)) { this._finishCluster(); this.phase = 'segment'; continue; }
      if (h.size == null || h.size > MAX_ELEMENT_BYTES) throw new Error('WebM inválido (cluster)');
      const total = h.headerLen + h.size;
      if (this.pending.length < total) return;
      const el = this._consume(total);
      const offset = c.length;
      c.parts.push(el);
      c.length += total;
      if (c.remaining != null) c.remaining -= total;
      this._inspectChild(c, h, el, offset);
    }
  }

  _startCluster(h) {
    const head = this._consume(h.headerLen);
    this.current = {
      parts: [head], length: head.length, remaining: h.size, unknownSize: h.size == null,
      timecode: null, tcOffset: -1, tcLen: 0, hasKey: null, maxRel: 0, blocks: 0,
    };
    this.phase = 'cluster';
  }

  _inspectChild(c, h, el, offset) {
    const data = h.headerLen;
    if (h.id === ID.TIMECODE) {
      c.timecode = readUInt(el, data, h.size);
      c.tcOffset = offset + data;
      c.tcLen = h.size;
      return;
    }
    let blockStart = -1;
    let keyFromGroup = null;
    if (h.id === ID.SIMPLE_BLOCK) blockStart = data;
    else if (h.id === ID.BLOCK_GROUP) {
      let hasRef = false;
      for (const ch of children(el, data, el.length)) {
        if (ch.id === ID.BLOCK && blockStart < 0) blockStart = ch.dataStart;
        if (ch.id === ID.REFERENCE_BLOCK) hasRef = true;
      }
      keyFromGroup = !hasRef;
    }
    if (blockStart < 0 || blockStart + 4 > el.length) return;
    const t = blockTrack(el, blockStart);
    if (!t) return;
    const relPos = blockStart + t.len;
    const rel = el.readInt16BE(relPos);
    const flags = el[relPos + 2];
    c.blocks += 1;
    if (rel > c.maxRel) c.maxRel = rel;
    if (c.hasKey == null && this._isVideo(t.track)) {
      c.hasKey = keyFromGroup != null ? keyFromGroup : !!(flags & 0x80);
    }
  }

  _finishCluster() {
    const c = this.current;
    this.current = null;
    if (!c || c.timecode == null || c.blocks === 0) return;
    const buf = Buffer.concat(c.parts);
    this.clusters.push({
      buf, timecode: c.timecode, tcOffset: c.tcOffset, tcLen: c.tcLen,
      hasKey: c.hasKey === true, end: c.timecode + Math.max(0, c.maxRel),
    });
    this.bytes += buf.length;
    this._prune();
  }

  _latest() {
    let latest = 0;
    for (const c of this.clusters) if (c.end > latest) latest = c.end;
    const cur = this.current;
    if (cur && cur.timecode != null) latest = Math.max(latest, cur.timecode + cur.maxRel);
    return latest;
  }

  // Joga fora o que ficou velho, mas sempre mantendo um quadro-chave no
  // começo da janela (senão o clipe começaria quebrado).
  _prune() {
    const cutoff = this._latest() - (this.keepMs + this.marginMs) / this.msPerTick;
    let keepFrom = 0;
    for (let i = 0; i < this.clusters.length; i += 1) {
      if (this.clusters[i].hasKey && this.clusters[i].timecode <= cutoff) keepFrom = i;
    }
    while (keepFrom > 0) { this.bytes -= this.clusters.shift().buf.length; keepFrom -= 1; }
    // Teto de memória (vídeo com taxa muito alta): corta do começo.
    while (this.bytes > this.maxBytes && this.clusters.length > 1) this.bytes -= this.clusters.shift().buf.length;
  }

  // Quanto vídeo tem guardado agora (ms) — pra a interface mostrar.
  bufferedMs() {
    if (!this.clusters.length) return 0;
    return Math.max(0, (this._latest() - this.clusters[0].timecode) * this.msPerTick);
  }

  // Monta o arquivo do clipe com os últimos `windowMs`. null = ainda não
  // tem vídeo tocável (sem cabeçalho ou sem nenhum quadro-chave).
  exportClip(windowMs = this.keepMs) {
    if (!this.header) return null;
    const list = [...this.clusters];
    // Cluster em andamento (tamanho desconhecido = já é válido como está).
    const cur = this.current;
    if (cur && cur.unknownSize && cur.timecode != null && cur.blocks > 0) {
      list.push({ buf: Buffer.concat(cur.parts), timecode: cur.timecode, tcOffset: cur.tcOffset, tcLen: cur.tcLen, hasKey: cur.hasKey === true, end: cur.timecode + cur.maxRel });
    }
    if (!list.length) return null;
    const latest = list.reduce((m, c) => Math.max(m, c.end), 0);
    const target = latest - windowMs / this.msPerTick;
    let start = -1;
    for (let i = 0; i < list.length; i += 1) if (list[i].hasKey && list[i].timecode <= target) start = i;
    if (start < 0) start = list.findIndex((c) => c.hasKey);
    if (start < 0) return null;
    const base = list[start].timecode;
    const parts = [this.header];
    for (const c of list.slice(start)) {
      const copy = Buffer.from(c.buf);
      if (c.tcOffset >= 0) writeUInt(copy, c.tcOffset, c.tcLen, c.timecode - base);
      parts.push(copy);
    }
    return { buffer: Buffer.concat(parts), durationMs: Math.max(0, (latest - base) * this.msPerTick), clusters: list.length - start };
  }
}

module.exports = { WebmClipBuffer, ID, readId, readSize, readHeader, DEFAULT_KEEP_MS };
