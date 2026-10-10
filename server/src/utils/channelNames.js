// Nomes e ícones de canais/categorias.
//
// Nomes: agora aceitam maiúsculas, minúsculas e espaços normais (antes o
// app forçava "tudo-minusculo-com-hifen"). Aqui só limpamos o básico:
// tira caracteres de controle, junta espaços repetidos, apara as pontas e
// limita o tamanho. Nomes antigos continuam valendo do jeito que estão.

const NAME_MAX = 100;

// Caracteres de controle (Cc) e de formatação invisíveis (Cf) — exceto o
// ZWJ (‍), que emojis compostos usam (ex.: 👨‍👩‍👧).
const CONTROL_RE = /[\p{Cc}\p{Cf}]/gu;
const ZWJ = '‍';

function sanitizeName(value, { max = NAME_MAX } = {}) {
  if (value === undefined || value === null) return '';
  let s = String(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(CONTROL_RE, (ch) => (ch === ZWJ ? ch : ''))
    .replace(/\s+/g, ' ')
    .trim();
  // Corta por "caractere visível" (não por unidade UTF-16), pra nunca
  // partir um emoji no meio.
  const chars = Array.from(s);
  if (chars.length > max) s = chars.slice(0, max).join('').trim();
  return s;
}

// Ícone em emoji: um emoji Unicode (pode ser composto, com tom de pele,
// bandeira etc). Recusa texto comum, espaços e coisas longas demais.
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3/u;
function sanitizeIconEmoji(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const s = String(value).trim();
  if (!s || s.length > 32 || /\s/.test(s) || !EMOJI_RE.test(s)) {
    const err = new Error('Ícone inválido: escolha um emoji.');
    err.status = 400;
    throw err;
  }
  if (/[\p{L}\p{N}]/u.test(s.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '').replace(/[0-9#*]️?⃣/gu, ''))) {
    const err = new Error('Ícone inválido: escolha um emoji.');
    err.status = 400;
    throw err;
  }
  return s;
}

// Ícone em imagem por URL: só aceita a URL de um emoji personalizado da
// comunidade (escolhido no seletor) ou a que o canal já tem. Imagens
// novas entram pelo endpoint de upload (ver uploadChannelIcon).
async function resolveIconUrl(prisma, value, currentUrl) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const url = String(value);
  if (url === currentUrl) return url;
  const emoji = await prisma.emoji.findFirst({ where: { url } });
  if (!emoji) {
    const err = new Error('Imagem de ícone inválida. Envie uma imagem ou escolha um emoji.');
    err.status = 400;
    throw err;
  }
  return url;
}

// Upload de ícone: PNG, GIF ou WebP pequeno (JPG também passa — o filtro
// de imagem já valida o conteúdo real do arquivo).
const ICON_MAX_BYTES = 1024 * 1024;
const ICON_MIME_RE = /^image\/(png|gif|webp|jpeg)$/i;
function checkIconUpload(file) {
  if (!file) return 'Envie uma imagem.';
  if (!ICON_MIME_RE.test(file.mimetype || '')) return 'Use PNG, GIF ou WebP.';
  if ((file.size || 0) > ICON_MAX_BYTES) return 'Imagem grande demais (máximo 1 MB).';
  return null;
}

// Canais em destaque no topo da lista da comunidade.
const FEATURED_KEYS = ['eventos', 'feed', 'galeria', 'loja']; // 'feed' aparece como "Fórum"
function parseHiddenFeatured(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((k) => FEATURED_KEYS.includes(k)) : [];
  } catch { return []; }
}
function featuredVisibility(raw) {
  const hidden = new Set(parseHiddenFeatured(raw));
  return Object.fromEntries(FEATURED_KEYS.map((k) => [k, !hidden.has(k)]));
}

module.exports = {
  NAME_MAX, sanitizeName, sanitizeIconEmoji, resolveIconUrl, checkIconUpload,
  ICON_MAX_BYTES, FEATURED_KEYS, parseHiddenFeatured, featuredVisibility,
};
