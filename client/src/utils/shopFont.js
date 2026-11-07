// Fonte do nome comprada na Loja (User.profileFont = JSON {id, family, url}).
// Fonte do Google Fonts: carrega o CSS da família; arquivo enviado pela
// staff: registra com FontFace. Cada fonte é carregada uma vez só.
const loaded = new Map();

export function parseShopFont(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw.family ? raw : null;
  try { const f = JSON.parse(raw); return f && f.family ? f : null; } catch { return null; }
}

// Nome interno da família (o arquivo enviado ganha um nome próprio pra não
// brigar com uma fonte de mesmo nome instalada no computador).
const familyName = (f) => (f.url && !/fonts\.gstatic\.com/.test(f.url) ? `PCShopFont-${f.id || f.family}` : f.family);

export function ensureShopFont(f) {
  if (!f || typeof document === 'undefined') return;
  const key = f.id || f.family;
  if (loaded.has(key)) return;
  loaded.set(key, true);
  try {
    if (f.url && !/fonts\.gstatic\.com/.test(f.url)) {
      const face = new FontFace(familyName(f), `url(${JSON.stringify(f.url)})`, { display: 'swap' });
      face.load().then((ff) => document.fonts.add(ff)).catch(() => {});
    } else {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.family).replace(/%20/g, '+')}&display=swap`;
      document.head.appendChild(link);
    }
  } catch { /* fonte é só enfeite */ }
}

// font-family pronta pra usar (já pede pra carregar).
export function shopFontFamily(raw) {
  const f = parseShopFont(raw);
  if (!f) return undefined;
  ensureShopFont(f);
  return `'${familyName(f).replace(/'/g, '')}', system-ui, sans-serif`;
}
