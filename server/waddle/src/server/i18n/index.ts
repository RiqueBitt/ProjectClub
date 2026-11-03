/**
 * Tradução PT-BR da Praça (Club Penguin).
 *
 * O Waddle Forever só tem os arquivos em inglês. Os textos que o SERVIDOR
 * gera ou entrega em JSON (interface do cliente moderno, carimbos, itens,
 * salas, chat seguro, mascotes, guia turístico, móveis...) passam por
 * dicionários inglês → português em ./pt-BR/*.json. A tradução é aplicada
 * nas folhas de texto dos JSONs (gerados ou estáticos da mídia) e nas
 * mensagens embutidas no local_crumbs.swf (LANG e afins).
 *
 * O que está desenhado dentro dos SWFs (letreiros das salas, botões
 * gráficos, catálogos em imagem) não passa por aqui.
 *
 * WADDLE_LANG=en desliga.
 */
import fs from 'fs';
import path from 'path';

// Os dicionários ficam em src/server/i18n/pt-BR (o tsc não copia JSON pro
// dist): funciona rodando do src ou do dist.
const DIR = [path.resolve(__dirname, 'pt-BR'), path.resolve(__dirname, '..', '..', '..', 'src', 'server', 'i18n', 'pt-BR')]
  .find((d) => fs.existsSync(d)) || path.resolve(__dirname, 'pt-BR');

let dict: Map<string, string> | null = null;

export function translationEnabled(): boolean {
  return (process.env.WADDLE_LANG || 'pt-BR').toLowerCase() !== 'en';
}

/** Carrega (uma vez) todos os dicionários da pasta pt-BR. */
export function getDictionary(): Map<string, string> {
  if (dict !== null) return dict;
  dict = new Map();
  if (!translationEnabled()) return dict;
  let files: string[] = [];
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort(); } catch { return dict; }
  for (const f of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf-8'));
      for (const [en, pt] of Object.entries(parsed)) {
        if (typeof pt === 'string' && pt.trim() !== '' && !dict.has(en)) dict.set(en, pt);
      }
    } catch (err: any) {
      console.error(`[waddle] dicionário ${f} inválido: ${err?.message}`);
    }
  }
  return dict;
}

/** Traduz uma string (igual se não houver tradução). */
export function t(en: string): string {
  const d = getDictionary();
  return d.get(en) ?? en;
}

/** Traduz todas as folhas de texto de um JSON (caminhos/códigos ficam intactos). */
export function translateJson(value: any): any {
  const d = getDictionary();
  if (d.size === 0) return value;
  const walk = (v: any): any => {
    if (typeof v === 'string') return d.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, any> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value);
}

/** Traduz um texto JSON serializado; devolve o original se não for JSON. */
export function translateJsonText(text: string | Buffer): string | Buffer {
  const d = getDictionary();
  if (d.size === 0) return text;
  const str = typeof text === 'string' ? text : text.toString('utf-8');
  try {
    return JSON.stringify(translateJson(JSON.parse(str)));
  } catch {
    return text;
  }
}

/** Traduz os valores de um Record<string,string> (chaves intactas). */
export function translateRecord<T extends Record<string, string>>(rec: T): T {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = t(v);
  return out as T;
}

export function dictionarySize(): number {
  return getDictionary().size;
}
