'use strict';
// Leitura/escrita mínima de SWF pro tradutor do jornal (news/index.js):
// tags, bits, RECT/MATRIX, fontes (tabela de códigos) e textos estáticos
// (DefineText/DefineText2), e montagem de DefineFont3 + DefineEditText.

const zlib = require('zlib');

// ---------------------------------------------------------------- bits

class BitReader {
  constructor(buf, pos = 0) { this.buf = buf; this.pos = pos; this.bit = 0; }
  align() { if (this.bit) { this.bit = 0; this.pos += 1; } }
  ub(n) {
    let v = 0;
    for (let i = 0; i < n; i += 1) {
      const byte = this.buf[this.pos];
      v = (v * 2) + ((byte >> (7 - this.bit)) & 1);
      this.bit += 1;
      if (this.bit === 8) { this.bit = 0; this.pos += 1; }
    }
    return v;
  }
  sb(n) {
    if (n === 0) return 0;
    const v = this.ub(n);
    return v >= 2 ** (n - 1) ? v - 2 ** n : v;
  }
  u8() { this.align(); const v = this.buf[this.pos]; this.pos += 1; return v; }
  u16() { this.align(); const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  s16() { this.align(); const v = this.buf.readInt16LE(this.pos); this.pos += 2; return v; }
}

class BitWriter {
  constructor() { this.bytes = []; this.cur = 0; this.n = 0; }
  ub(v, n) {
    for (let i = n - 1; i >= 0; i -= 1) {
      this.cur = (this.cur << 1) | (Math.floor(v / 2 ** i) & 1);
      this.n += 1;
      if (this.n === 8) { this.bytes.push(this.cur); this.cur = 0; this.n = 0; }
    }
  }
  sb(v, n) { this.ub(v < 0 ? v + 2 ** n : v, n); }
  align() { if (this.n) { this.bytes.push(this.cur << (8 - this.n)); this.cur = 0; this.n = 0; } }
  buffer() { this.align(); return Buffer.from(this.bytes); }
}

const bitsFor = (...vals) => Math.max(1, ...vals.map((v) => (v >= 0 ? v.toString(2).length + 1 : (-v - 1).toString(2).length + 1)));

function readRect(r) {
  r.align();
  const n = r.ub(5);
  const rect = { xmin: r.sb(n), xmax: r.sb(n), ymin: r.sb(n), ymax: r.sb(n) };
  r.align();
  return rect;
}

function writeRect({ xmin, xmax, ymin, ymax }) {
  const w = new BitWriter();
  const n = bitsFor(xmin, xmax, ymin, ymax);
  w.ub(n, 5);
  for (const v of [xmin, xmax, ymin, ymax]) w.sb(v, n);
  return w.buffer();
}

function readMatrix(r) {
  r.align();
  const m = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  if (r.ub(1)) { const n = r.ub(5); m.a = r.sb(n) / 65536; m.d = r.sb(n) / 65536; }
  if (r.ub(1)) { const n = r.ub(5); m.b = r.sb(n) / 65536; m.c = r.sb(n) / 65536; }
  const n = r.ub(5); m.tx = r.sb(n); m.ty = r.sb(n);
  r.align();
  return m;
}

// ---------------------------------------------------------------- arquivo

function parse(data) {
  const sig = data.subarray(0, 3).toString('latin1');
  if (sig !== 'CWS' && sig !== 'FWS') return null;
  const body = sig === 'CWS' ? zlib.inflateSync(data.subarray(8)) : Buffer.from(data.subarray(8));
  const nbits = body[0] >> 3;
  const headLen = Math.ceil((5 + 4 * nbits) / 8) + 4;
  const tags = [];
  let off = headLen;
  while (off + 2 <= body.length) {
    const h = body.readUInt16LE(off);
    const code = h >> 6; let len = h & 63; let hl = 2;
    if (len === 63) { len = body.readUInt32LE(off + 2); hl = 6; }
    tags.push({ code, body: body.subarray(off + hl, off + hl + len) });
    off += hl + len;
    if (code === 0) break;
  }
  return { sig, version: data[3], head: body.subarray(0, headLen), tags };
}

function tagBytes(code, body) {
  if (body.length < 63 && code !== 37 && code !== 75) { const h = Buffer.alloc(2); h.writeUInt16LE((code << 6) | body.length); return Buffer.concat([h, body]); }
  const h = Buffer.alloc(6); h.writeUInt16LE((code << 6) | 63); h.writeUInt32LE(body.length, 2);
  return Buffer.concat([h, body]);
}

function build(swf) {
  const body = Buffer.concat([swf.head, ...swf.tags.map((t) => tagBytes(t.code, t.body))]);
  const header = Buffer.alloc(8);
  header.write(swf.sig, 0, 'latin1'); header[3] = swf.version; header.writeUInt32LE(body.length + 8, 4);
  return Buffer.concat([header, swf.sig === 'CWS' ? zlib.deflateSync(body, { level: 9 }) : body]);
}

// ---------------------------------------------------------------- fontes

/** DefineFont2/3: { id, name, codes[], bold, italic } (só o que o tradutor precisa). */
function parseFont(tag) {
  const b = tag.body;
  const id = b.readUInt16LE(0);
  const flags = b[2];
  const nameLen = b[4];
  const name = b.subarray(5, 5 + nameLen).toString('utf-8').replace(/\0+$/, '');
  let p = 5 + nameLen;
  const n = b.readUInt16LE(p); p += 2;
  const wideOffsets = !!(flags & 0x08);
  const wideCodes = !!(flags & 0x04);
  const tableStart = p;
  let codes = [];
  if (n > 0) {
    const codeOff = wideOffsets ? b.readUInt32LE(tableStart + 4 * n) : b.readUInt16LE(tableStart + 2 * n);
    let cp = tableStart + codeOff;
    for (let i = 0; i < n; i += 1) {
      if (wideCodes) { codes.push(b.readUInt16LE(cp)); cp += 2; } else { codes.push(b[cp]); cp += 1; }
    }
  }
  return { id, name, codes, bold: !!(flags & 0x01), italic: !!(flags & 0x02) };
}

// ---------------------------------------------------------------- textos

/** DefineText/DefineText2 → { id, bounds, matrix, records[{fontId,color,x,y,height,glyphs[{index,advance}]}] } */
function parseText(tag) {
  const rgba = tag.code === 33;
  const r = new BitReader(tag.body);
  const id = r.u16();
  const bounds = readRect(r);
  const matrix = readMatrix(r);
  const glyphBits = r.u8();
  const advanceBits = r.u8();
  const records = [];
  let fontId = null; let color = 0; let x = 0; let y = 0; let height = 0;
  for (;;) {
    const flags = r.u8();
    if (flags === 0 || r.pos >= r.buf.length) break;
    if (flags & 0x08) fontId = r.u16();
    if (flags & 0x04) {
      const cr = r.u8(); const cg = r.u8(); const cb = r.u8();
      if (rgba) r.u8();
      color = (cr << 16) | (cg << 8) | cb;
    }
    if (flags & 0x01) x = r.s16();
    if (flags & 0x02) y = r.s16();
    if (flags & 0x08) height = r.u16();
    const count = r.u8();
    const glyphs = [];
    let adv = 0;
    for (let i = 0; i < count; i += 1) {
      const index = r.ub(glyphBits);
      const advance = r.sb(advanceBits);
      glyphs.push({ index, advance });
      adv += advance;
    }
    r.align();
    records.push({ fontId, color, x, y, height, glyphs });
    x += adv;
  }
  return { id, bounds, matrix, records };
}

function writeString(s) { return Buffer.concat([Buffer.from(s, 'utf-8'), Buffer.from([0])]); }

/**
 * DefineEditText (texto de só leitura, sem seleção, desenhado com as fontes
 * embutidas): { id, bounds, fontId, height, color, align(0 esq,1 dir,2 centro),
 * leading, html, text }
 */
function editTextTag({ id, bounds, fontId, height, color, align = 0, leading = 0, html = true, text, wrap = true }) {
  const parts = [];
  const h = Buffer.alloc(2); h.writeUInt16LE(id); parts.push(h);
  parts.push(writeRect(bounds));
  // HasText | WordWrap | Multiline | ReadOnly | HasTextColor | HasFont
  parts.push(Buffer.from([0x80 | (wrap ? 0x40 : 0) | 0x20 | 0x08 | 0x04 | 0x01]));
  // HasLayout | NoSelect | WasStatic | HTML? | UseOutlines
  parts.push(Buffer.from([0x20 | 0x10 | 0x04 | (html ? 0x02 : 0) | 0x01]));
  const f = Buffer.alloc(4); f.writeUInt16LE(fontId, 0); f.writeUInt16LE(Math.max(1, Math.min(65535, Math.round(height))), 2); parts.push(f);
  parts.push(Buffer.from([(color >> 16) & 255, (color >> 8) & 255, color & 255, 255]));
  const lay = Buffer.alloc(9);
  lay[0] = align; lay.writeUInt16LE(0, 1); lay.writeUInt16LE(0, 3); lay.writeUInt16LE(0, 5);
  lay.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(leading))), 7);
  parts.push(lay);
  parts.push(writeString(''));
  parts.push(writeString(text));
  return { code: 37, body: Buffer.concat(parts) };
}

/** DefineFont3 pronta (corpo gerado por build_fonts.py) com o FontID trocado. */
function fontTag(fontBody, id) {
  const body = Buffer.from(fontBody);
  body.writeUInt16LE(id, 0);
  return { code: 75, body };
}

/** Maior id de personagem usado no SWF (pra criar ids novos). */
function maxCharacterId(swf) {
  let max = 0;
  const DEF = new Set([2, 6, 7, 10, 11, 14, 20, 21, 22, 32, 33, 34, 35, 36, 37, 39, 46, 48, 60, 75, 83, 84, 87, 90, 91]);
  for (const t of swf.tags) {
    if (DEF.has(t.code) && t.body.length >= 2) max = Math.max(max, t.body.readUInt16LE(0));
  }
  return max;
}

module.exports = { parse, build, parseFont, parseText, editTextTag, fontTag, maxCharacterId, BitReader, writeRect };
