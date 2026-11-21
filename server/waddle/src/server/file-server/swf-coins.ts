/**
 * Moeda única (Project Club): troca a moeda do Club Penguin pela moeda "PC"
 * nos catálogos do jogo (o preço "200 🪙" de cada item).
 *
 * Nos catálogos de 2012 a moeda de cada preço são DOIS desenhos (shapes):
 * o corpo da moeda (dourado, deitado) e o rosto do pinguim por cima, cada um
 * posto na página com uma matriz que "levanta" a moeda. Os desenhos são
 * reconhecidos pelo retângulo exato (em twips) — é a mesma arte em todos os
 * catálogos. Aqui:
 *  - o corpo vira um retângulo preenchido com a imagem da moeda PC
 *    (DefineBitsLossless2 novo), com a matriz do preenchimento desfazendo a
 *    rotação/inclinação de como a moeda é posta na página → ela aparece
 *    redonda e em pé, no mesmo lugar e tamanho;
 *  - o rosto vira um desenho vazio.
 * Só mexe em DefineShape do nível de cima; o resto do SWF fica igual.
 */
import { COIN_BITMAP } from './praca-coin-bitmap';

type Rect = [number, number, number, number];

const SHAPE_CODES = new Set([2, 22, 32, 83]);
const PLACE2 = 26;
const PLACE3 = 70;
const SPRITE = 39;
const BITMAP_ID = 65531;

// retângulos (xMin, xMax, yMin, yMax) da arte da moeda
const BODY: Rect[] = [[-1785, 1786, -1289, 1291], [-1407, 1476, -1290, 794], [-361, 361, -262, 262]];
const FACE: Rect[] = [[-484, 487, -451, 459], [-2420, 2434, -2257, 2298], [-2390, 2434, -2257, 2368]];
const near = (a: Rect, b: Rect) => a.every((v, i) => Math.abs(v - b[i]) <= 3);

// ---------------------------------------------------------------- bits

class BitReader {
  private pos: number;
  constructor(private buf: Buffer, byteOffset: number) { this.pos = byteOffset * 8; }
  u(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) { v = v * 2 + ((this.buf[this.pos >> 3] >> (7 - (this.pos & 7))) & 1); this.pos++; }
    return v;
  }
  s(n: number): number { if (n === 0) return 0; const v = this.u(n); return v >= 2 ** (n - 1) ? v - 2 ** n : v; }
  get byteEnd(): number { return Math.ceil(this.pos / 8); }
}

class BitWriter {
  private bits: number[] = [];
  u(v: number, n: number) { for (let i = n - 1; i >= 0; i--) this.bits.push(Math.floor(v / 2 ** i) & 1); }
  s(v: number, n: number) { this.u(v < 0 ? v + 2 ** n : v, n); }
  bytes(): Buffer {
    const out = Buffer.alloc(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => { if (b) out[i >> 3] |= 0x80 >> (i & 7); });
    return out;
  }
}

const sbits = (...vs: number[]) => Math.max(1, ...vs.map((v) => (v === 0 ? 1 : Math.floor(Math.log2(Math.abs(v < 0 ? -v - 1 : v) || 1)) + 2)));

function readRect(buf: Buffer, off: number): { rect: Rect; end: number } {
  const r = new BitReader(buf, off);
  const n = r.u(5);
  const rect: Rect = [r.s(n), r.s(n), r.s(n), r.s(n)];
  return { rect, end: r.byteEnd };
}

function writeRect(w: BitWriter, r: Rect) {
  const n = sbits(...r);
  w.u(n, 5); r.forEach((v) => w.s(v, n));
}

/** MATRIX → [a, b, c, d] (sem translação). */
function readMatrix(buf: Buffer, off: number): number[] {
  const r = new BitReader(buf, off);
  let a = 1; let d = 1; let b = 0; let c = 0;
  if (r.u(1)) { const n = r.u(5); a = r.s(n) / 65536; d = r.s(n) / 65536; }
  if (r.u(1)) { const n = r.u(5); b = r.s(n) / 65536; c = r.s(n) / 65536; }
  return [a, b, c, d];
}

function writeMatrix(w: BitWriter, a: number, b: number, c: number, d: number, tx: number, ty: number) {
  const fx = (v: number) => Math.round(v * 65536);
  const [A, B, C, D] = [fx(a), fx(b), fx(c), fx(d)];
  if (A !== 65536 || D !== 65536) { const n = sbits(A, D); w.u(1, 1); w.u(n, 5); w.s(A, n); w.s(D, n); } else w.u(0, 1);
  if (B !== 0 || C !== 0) { const n = sbits(B, C); w.u(1, 1); w.u(n, 5); w.s(B, n); w.s(C, n); } else w.u(0, 1);
  const T = [Math.round(tx), Math.round(ty)];
  const n = sbits(...T); w.u(n, 5); w.s(T[0], n); w.s(T[1], n);
}

// ---------------------------------------------------------------- tags

type Tag = { code: number; start: number; headLen: number; len: number };

function readTags(buf: Buffer, off: number, end: number): Tag[] {
  const tags: Tag[] = [];
  while (off + 2 <= end) {
    const h = buf.readUInt16LE(off);
    const code = h >> 6; let len = h & 63; let headLen = 2;
    if (len === 63) { len = buf.readUInt32LE(off + 2); headLen = 6; }
    tags.push({ code, start: off, headLen, len });
    off += headLen + len;
    if (code === 0) break;
  }
  return tags;
}

function tagBytes(code: number, body: Buffer): Buffer {
  const head = Buffer.alloc(6);
  head.writeUInt16LE((code << 6) | 63, 0);
  head.writeUInt32LE(body.length, 2);
  return Buffer.concat([head, body]);
}

/** Matrizes com que os desenhos `ids` são postos (raiz e dentro de sprites). */
function placementMatrices(buf: Buffer, tags: Tag[], ids: Set<number>, out: number[][] = []): number[][] {
  for (const t of tags) {
    const off = t.start + t.headLen;
    if (t.code === SPRITE) placementMatrices(buf, readTags(buf, off + 4, off + t.len), ids, out);
    else if (t.code === PLACE2 || t.code === PLACE3) {
      const flags = buf[off];
      if (!(flags & 2) || !(flags & 4)) continue; // sem personagem ou sem matriz
      let p = off + 1;
      if (t.code === PLACE3) {
        const flags2 = buf[p]; p += 1;
        p += 2; // depth
        if (flags2 & 8) { while (buf[p]) p++; p++; } // class name
      } else p += 2; // depth
      const id = buf.readUInt16LE(p); p += 2;
      if (ids.has(id)) out.push(readMatrix(buf, p));
    }
  }
  return out;
}

// ---------------------------------------------------------------- moeda

function bitmapTag(): Buffer {
  const head = Buffer.alloc(7);
  head.writeUInt16LE(BITMAP_ID, 0);
  head[2] = 5; // ARGB 32 bits
  head.writeUInt16LE(COIN_BITMAP.width, 3);
  head.writeUInt16LE(COIN_BITMAP.height, 5);
  return tagBytes(36, Buffer.concat([head, COIN_BITMAP.zlib]));
}

/** Retângulo preenchido com a moeda PC, em pé na tela depois da matriz `m`. */
function coinShape(id: number, rect: Rect, m: number[]): Buffer {
  const [a, b, c, d] = m;
  const det = a * d - b * c;
  const cx = (rect[0] + rect[1]) / 2; const cy = (rect[2] + rect[3]) / 2;
  // tamanho na tela (twips) do corpo original, sob a matriz da página
  const corners = [[rect[0], rect[2]], [rect[1], rect[2]], [rect[1], rect[3]], [rect[0], rect[3]]];
  const sx = corners.map(([x, y]) => a * x + c * y); const sy = corners.map(([x, y]) => b * x + d * y);
  const W = Math.max(...sx) - Math.min(...sx); const H = Math.max(...sy) - Math.min(...sy);
  const D = Math.sqrt(W * H) * 0.95; // diâmetro da moeda na tela
  const q = D / COIN_BITMAP.width; // twips da tela por pixel da imagem
  // B = q · M⁻¹ (pixel da imagem → espaço do desenho)
  const ia = d / det; const ib = -b / det; const ic = -c / det; const id_ = a / det;
  const B = [q * ia, q * ib, q * ic, q * id_];
  const hw = COIN_BITMAP.width / 2; const hh = COIN_BITMAP.height / 2;
  const tx = cx - (B[0] * hw + B[2] * hh); const ty = cy - (B[1] * hw + B[3] * hh);
  const map = (u: number, v: number) => [B[0] * u + B[2] * v + tx, B[1] * u + B[3] * v + ty].map(Math.round);
  const pts = [map(0, 0), map(COIN_BITMAP.width, 0), map(COIN_BITMAP.width, COIN_BITMAP.height), map(0, COIN_BITMAP.height)];
  const bounds: Rect = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];

  const w = new BitWriter();
  writeRect(w, bounds);
  const head = w.bytes();
  const fill = new BitWriter();
  writeMatrix(fill, B[0], B[1], B[2], B[3], tx, ty);
  const styles = Buffer.concat([Buffer.from([1, 0x41, BITMAP_ID & 255, BITMAP_ID >> 8]), fill.bytes(), Buffer.from([0])]); // 1 preenchimento, 0 linhas
  const rec = new BitWriter();
  rec.u(1, 4); rec.u(0, 4); // NumFillBits=1, NumLineBits=0
  // move até o 1º canto com FillStyle0 = 1
  const mb = sbits(pts[0][0], pts[0][1]);
  rec.u(0, 1); rec.u(0b00011, 5); rec.u(mb, 5); rec.s(pts[0][0], mb); rec.s(pts[0][1], mb); rec.u(1, 1);
  for (let i = 1; i <= 4; i++) {
    const p = pts[i % 4]; const q0 = pts[i - 1];
    const dx = p[0] - q0[0]; const dy = p[1] - q0[1];
    const nb = Math.max(2, sbits(dx, dy));
    rec.u(1, 1); rec.u(1, 1); rec.u(nb - 2, 4); rec.u(1, 1); rec.s(dx, nb); rec.s(dy, nb);
  }
  rec.u(0, 6); // fim
  const idb = Buffer.alloc(2); idb.writeUInt16LE(id, 0);
  return tagBytes(2, Buffer.concat([idb, head, styles, rec.bytes()]));
}

function emptyShape(id: number, rect: Rect): Buffer {
  const w = new BitWriter(); writeRect(w, rect);
  const idb = Buffer.alloc(2); idb.writeUInt16LE(id, 0);
  return tagBytes(2, Buffer.concat([idb, w.bytes(), Buffer.from([0, 0, 0, 0])]));
}

/** Corpo do SWF (depois do cabeçalho de 8 bytes) com a moeda trocada; igual se não achar a moeda. */
export function replaceCoins(body: Buffer): Buffer {
  const { end: headerEnd } = readRect(body, 0);
  const tagsStart = headerEnd + 4; // frameRate + frameCount
  const tags = readTags(body, tagsStart, body.length);
  const bodies = new Map<number, { tag: Tag; rect: Rect }>();
  const faces = new Map<number, { tag: Tag; rect: Rect }>();
  for (const t of tags) {
    if (!SHAPE_CODES.has(t.code)) continue;
    const off = t.start + t.headLen;
    const id = body.readUInt16LE(off);
    if (id === BITMAP_ID) return body; // já tem esse id: não mexe
    const { rect } = readRect(body, off + 2);
    if (BODY.some((r) => near(r, rect))) bodies.set(id, { tag: t, rect });
    else if (FACE.some((r) => near(r, rect))) faces.set(id, { tag: t, rect });
  }
  if (!bodies.size || !faces.size) return body;
  // matriz mais comum com que o corpo é posto na página
  const mats = placementMatrices(body, tags, new Set(bodies.keys()));
  if (!mats.length) return body;
  const count = new Map<string, { m: number[]; n: number }>();
  for (const m of mats) { const k = m.map((v) => v.toFixed(3)).join(','); const e = count.get(k) || { m, n: 0 }; e.n++; count.set(k, e); }
  const main = [...count.values()].sort((x, y) => y.n - x.n)[0].m;
  if (Math.abs(main[0] * main[3] - main[1] * main[2]) < 1e-6) return body;

  const parts: Buffer[] = [body.subarray(0, tagsStart)];
  let addedBitmap = false;
  for (const t of tags) {
    const raw = body.subarray(t.start, t.start + t.headLen + t.len);
    if (SHAPE_CODES.has(t.code)) {
      const id = body.readUInt16LE(t.start + t.headLen);
      const b = bodies.get(id);
      if (b) {
        if (!addedBitmap) { parts.push(bitmapTag()); addedBitmap = true; }
        parts.push(coinShape(id, b.rect, main));
        continue;
      }
      const f = faces.get(id);
      if (f) { parts.push(emptyShape(id, f.rect)); continue; }
    }
    parts.push(raw);
  }
  return Buffer.concat(parts);
}
