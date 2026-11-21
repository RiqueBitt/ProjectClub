// Conversões do Pingu — só unidades de fator FIXO (comprimento, massa,
// volume, velocidade, tempo, dados, área e temperatura). Moeda só com as
// cotações FIXAS que a equipe configurar em PINGU_FX_RATES (JSON com o valor
// de 1 unidade em reais, ex.: {"USD":5.4,"EUR":5.9}); sem isso o Pingu diz
// que não tem a cotação do dia (nunca inventa valor de dinheiro).
// Puro e testável: nada de rede.
const { formatNumber } = require('./calc');

// unidade → [grupo, fator pra unidade-base do grupo]
const UNITS = {};
function def(group, factor, names) { names.forEach((n) => { UNITS[n] = [group, factor]; }); }

// Comprimento (base: metro)
def('len', 1000, ['km', 'quilometro', 'quilometros', 'kilometro', 'kilometros']);
def('len', 1, ['m', 'metro', 'metros']);
def('len', 0.01, ['cm', 'centimetro', 'centimetros']);
def('len', 0.001, ['mm', 'milimetro', 'milimetros']);
def('len', 1609.344, ['mi', 'milha', 'milhas', 'mile', 'miles']);
def('len', 0.3048, ['pe', 'pes', 'ft', 'feet', 'foot']);
def('len', 0.0254, ['pol', 'polegada', 'polegadas', 'in', 'inch', 'inches']);
def('len', 0.9144, ['jarda', 'jardas', 'yd', 'yard', 'yards']);
def('len', 1852, ['milha nautica', 'milhas nauticas', 'nmi']);
// Massa (base: grama)
def('mass', 1e6, ['t', 'tonelada', 'toneladas']);
def('mass', 1000, ['kg', 'quilo', 'quilos', 'quilograma', 'quilogramas', 'kilo', 'kilos']);
def('mass', 1, ['g', 'grama', 'gramas']);
def('mass', 0.001, ['mg', 'miligrama', 'miligramas']);
def('mass', 453.59237, ['lb', 'lbs', 'libra', 'libras', 'pound', 'pounds']);
def('mass', 28.349523125, ['oz', 'onca', 'oncas', 'ounce', 'ounces']);
// Volume (base: litro)
def('vol', 1, ['l', 'litro', 'litros']);
def('vol', 0.001, ['ml', 'mililitro', 'mililitros']);
def('vol', 1000, ['m3', 'metro cubico', 'metros cubicos']);
def('vol', 3.785411784, ['gal', 'galao', 'galoes', 'gallon', 'gallons']);
def('vol', 0.24, ['xicara', 'xicaras', 'cup', 'cups']);
def('vol', 0.015, ['colher de sopa', 'colheres de sopa']);
def('vol', 0.005, ['colher de cha', 'colheres de cha']);
// Velocidade (base: m/s)
def('speed', 1 / 3.6, ['km/h', 'kmh', 'kph']);
def('speed', 1, ['m/s']);
def('speed', 0.44704, ['mph']);
def('speed', 0.514444, ['no', 'nos', 'knot', 'knots']);
// Tempo (base: segundo)
def('time', 1, ['s', 'seg', 'segundo', 'segundos']);
def('time', 60, ['min', 'minuto', 'minutos']);
def('time', 3600, ['h', 'hora', 'horas']);
def('time', 86400, ['dia', 'dias']);
def('time', 604800, ['semana', 'semanas']);
def('time', 31557600, ['ano', 'anos']);
// Dados (base: byte; 1 KB = 1024 B, como o Windows mostra)
def('data', 1, ['b', 'byte', 'bytes']);
def('data', 1024, ['kb', 'kilobyte', 'kilobytes']);
def('data', 1024 ** 2, ['mb', 'megabyte', 'megabytes']);
def('data', 1024 ** 3, ['gb', 'gigabyte', 'gigabytes']);
def('data', 1024 ** 4, ['tb', 'terabyte', 'terabytes']);
// Área (base: m²)
def('area', 1, ['m2', 'metro quadrado', 'metros quadrados']);
def('area', 1e6, ['km2', 'quilometro quadrado', 'quilometros quadrados']);
def('area', 10000, ['ha', 'hectare', 'hectares']);
def('area', 4046.8564224, ['acre', 'acres']);
// Temperatura (tratada à parte)
const TEMPS = {
  c: 'C', celsius: 'C', 'graus celsius': 'C', 'grau celsius': 'C', graus: 'C', grau: 'C',
  f: 'F', fahrenheit: 'F', 'graus fahrenheit': 'F', 'grau fahrenheit': 'F',
  k: 'K', kelvin: 'K',
};
const TEMP_LABEL = { C: '°C', F: '°F', K: 'K' };

// Moedas (código ISO → nomes)
const CURRENCIES = {
  BRL: ['real', 'reais', 'brl', 'r$'],
  USD: ['dolar', 'dolares', 'usd', 'us$', 'dollar', 'dollars'],
  EUR: ['euro', 'euros', 'eur'],
  GBP: ['libra esterlina', 'libras esterlinas', 'gbp'],
  ARS: ['peso argentino', 'pesos argentinos', 'ars'],
  JPY: ['iene', 'ienes', 'yen', 'jpy'],
};
const CUR_BY_NAME = Object.fromEntries(Object.entries(CURRENCIES).flatMap(([code, names]) => names.map((n) => [n, code])));

function norm(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/°\s*/g, ' ').replace(/²/g, '2').replace(/³/g, '3').replace(/\s+/g, ' ').trim();
}

const ALL_NAMES = [...Object.keys(UNITS), ...Object.keys(TEMPS), ...Object.keys(CUR_BY_NAME)]
  .sort((a, b) => b.length - a.length)
  .map((n) => n.replace(/[.*+?^${}()|[\]\\/$]/g, '\\$&'));
const UNIT_ALT = ALL_NAMES.join('|');
// "10 km em milhas", "quanto é 5 pés em metros", "converte 100 f para c", "30 dólares em reais"
const CONVERT_RE = new RegExp(`(?:^|\\s)(-?\\d+(?:[.,]\\d+)?)\\s*(${UNIT_ALT})\\s+(?:em|para|pra|in|to|=|->)\\s+(${UNIT_ALT})(?=\\s|$|[?.!])`);

function lookup(name) {
  if (TEMPS[name]) return { kind: 'temp', unit: TEMPS[name] };
  if (CUR_BY_NAME[name]) return { kind: 'cur', unit: CUR_BY_NAME[name] };
  if (UNITS[name]) return { kind: 'unit', group: UNITS[name][0], factor: UNITS[name][1], unit: name };
  return null;
}

function toC(v, u) { return u === 'C' ? v : u === 'F' ? (v - 32) * (5 / 9) : v - 273.15; }
function fromC(v, u) { return u === 'C' ? v : u === 'F' ? v * (9 / 5) + 32 : v + 273.15; }

/** Cotações fixas da equipe: { USD: 5.4, … } (valor de 1 unidade em reais). */
function parseRates(raw = process.env.PINGU_FX_RATES) {
  if (!raw) return null;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const out = { BRL: 1 };
    for (const [k, v] of Object.entries(obj || {})) {
      const n = Number(v);
      if (/^[A-Z]{3}$/.test(k) && Number.isFinite(n) && n > 0) out[k] = n;
    }
    return Object.keys(out).length > 1 ? out : null;
  } catch { return null; }
}

const fmt = (n) => formatNumber(Math.abs(n) >= 100 ? Math.round(n * 100) / 100 : Math.round(n * 10000) / 10000);

/**
 * Tenta converter. Devolve { text } ou null (não é conversão).
 * opts.rates: cotações fixas (padrão: PINGU_FX_RATES).
 */
function convert(input, { rates } = {}) {
  const t = norm(input);
  const m = t.match(CONVERT_RE);
  if (!m) return null;
  const value = Number(m[1].replace(',', '.'));
  const a = lookup(m[2]);
  const b = lookup(m[3]);
  if (!a || !b || !Number.isFinite(value)) return null;
  if (a.kind === 'temp' && b.kind === 'temp') {
    const out = fromC(toC(value, a.unit), b.unit);
    return { text: `${fmt(value)} ${TEMP_LABEL[a.unit]} = ${fmt(out)} ${TEMP_LABEL[b.unit]}` };
  }
  if (a.kind === 'cur' && b.kind === 'cur') {
    const table = rates === undefined ? parseRates() : rates;
    if (!table || !table[a.unit] || !table[b.unit]) {
      return { text: 'Não tenho a cotação do dia aqui (a equipe não configurou valores fixos). Confira num banco ou buscador. 🐧', noRate: true };
    }
    const out = (value * table[a.unit]) / table[b.unit];
    return { text: `${fmt(value)} ${a.unit} ≈ ${fmt(out)} ${b.unit} (cotação fixa de referência da equipe, pode estar desatualizada)` };
  }
  if (a.kind === 'unit' && b.kind === 'unit') {
    if (a.group !== b.group) return { text: `Não dá pra converter ${m[2]} em ${m[3]}: são medidas de tipos diferentes. 🐧` };
    const out = (value * a.factor) / b.factor;
    return { text: `${fmt(value)} ${m[2]} = ${fmt(out)} ${m[3]}` };
  }
  return { text: `Não dá pra converter ${m[2]} em ${m[3]}. 🐧` };
}

module.exports = { convert, parseRates };
