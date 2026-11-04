/**
 * Pequenos consertos binários em SWFs do jogo (Project Club).
 *
 * interface.swf (2011+): o Project Club entra pela "entrada automática" do
 * próprio cliente (flashvars nau/nal) pra pular a tela de login. Em 2012 a
 * Disney só usava isso logo depois de criar um pinguim, pra rodar o guia de
 * novato — e a interface ESCONDE a barra do jogo (chat, frases prontas,
 * emotes, jornal, correio) quando `_localLoginServerData.autoLogin` está
 * ligado, esperando o módulo do guia (intro_to_cp.swf, que não existe na
 * mídia) mandar mostrar de volta. Resultado: jogo sem chat.
 *
 * Conserto: dentro do interface.swf o nome da propriedade `autoLogin` vira
 * `autoLogXn` (mesmo tamanho). Todas as checagens de "novato" da interface
 * leem undefined → comportamento de jogador normal. O shell (que faz o
 * login automático de verdade) continua igual.
 *
 * Também no interface.swf: um DoAction a mais no 1º quadro (depois do script
 * principal) põe os botões de voz Falar/Ouvir DENTRO da barra do jogo — ver
 * praca-voice-action.ts (gerado de server/waddle/praca-voice/).
 */
import zlib from 'zlib';
import { PRACA_VOICE_DOACTION } from './praca-voice-action';

type Patch = { from: string; to: string };

const PATCHES: Array<{ test: (route: string) => boolean; patches: Patch[]; frame1Tags?: Buffer[] }> = [
  {
    test: (route) => /(^|\/)play\/v2\/content\/global\/content\/interface\.swf$/.test(route),
    patches: [{ from: 'autoLogin\0', to: 'autoLogXn\0' }],
    frame1Tags: [PRACA_VOICE_DOACTION],
  },
];

/** Insere `tags` no fim do 1º quadro da linha do tempo principal (antes do 1º ShowFrame). */
function insertIntoFrame1(body: Buffer, tags: Buffer[]): Buffer {
  const nbits = body[0] >> 3;
  let off = Math.ceil((5 + 4 * nbits) / 8) + 4; // RECT + frameRate + frameCount
  while (off + 2 <= body.length) {
    const h = body.readUInt16LE(off);
    const code = h >> 6; let len = h & 63; let hl = 2;
    if (len === 63) { len = body.readUInt32LE(off + 2); hl = 6; }
    if (code === 1) return Buffer.concat([body.subarray(0, off), ...tags, body.subarray(off)]);
    if (code === 0) break;
    off += hl + len;
  }
  return body; // sem ShowFrame: deixa como está
}

const cache = new Map<string, Buffer>(); // route+tamanho → resultado

function replaceAll(buf: Buffer, from: Buffer, to: Buffer): Buffer {
  let out = buf;
  let i = out.indexOf(from);
  while (i !== -1) {
    out = Buffer.concat([out.subarray(0, i), to, out.subarray(i + from.length)]);
    i = out.indexOf(from, i + to.length);
  }
  return out;
}

/** Aplica os consertos de `route` (se houver). Mantém compressão e cabeçalho do SWF. */
export function patchSwf(route: string, data: Buffer | string): Buffer | string {
  const rule = PATCHES.find((p) => p.test(route));
  if (rule === undefined || typeof data === 'string' || data.length < 8) return data;
  const key = `${route}:${data.length}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const sig = data.subarray(0, 3).toString('latin1');
  if (sig !== 'CWS' && sig !== 'FWS') return data;
  let body = sig === 'CWS' ? zlib.inflateSync(data.subarray(8)) : data.subarray(8);
  for (const p of rule.patches) {
    const from = Buffer.from(p.from, 'latin1'); const to = Buffer.from(p.to, 'latin1');
    if (from.length !== to.length) continue; // só troca do mesmo tamanho (não mexe em offsets)
    body = replaceAll(body, from, to);
  }
  if (rule.frame1Tags?.length) body = insertIntoFrame1(body, rule.frame1Tags);
  const header = Buffer.from(data.subarray(0, 8));
  header.writeUInt32LE(body.length + 8, 4); // tamanho descomprimido (igual ao original)
  const out = sig === 'CWS' ? Buffer.concat([header, zlib.deflateSync(body, { level: 9 })]) : Buffer.concat([header, body]);
  cache.set(key, out);
  return out;
}

export function isPatchedRoute(route: string): boolean {
  return PATCHES.some((p) => p.test(route));
}
