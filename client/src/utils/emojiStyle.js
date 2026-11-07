import { useSyncExternalStore } from 'react';

// Item pedido: "5 variantes de como vai ser o visual dos meus emoji...
// um deles é o mesmo tema de emoji do Discord" — sem tema, cada pessoa
// vê o desenho da fonte de emoji do próprio sistema. Os outros 4 trocam
// isso por um conjunto de imagens FIXO, igual em qualquer tela (o
// Twemoji é o mesmo conjunto que o Discord usa).
export const EMOJI_STYLE_OPTIONS = [
  { value: 'native', label: 'Padrão do sistema' },
  { value: 'twemoji', label: 'Estilo Discord' },
  { value: 'noto', label: 'Estilo Google' },
  { value: 'fluent', label: 'Estilo Microsoft' },
  { value: 'openmoji', label: 'Estilo OpenMoji' },
];

// BUG CORRIGIDO ("os temas de emoji estão bugados"): os links antigos do
// Discord e da Microsoft apontavam pra repositórios do GitHub que o CDN
// não entrega (grandes demais) e cada conjunto nomeia os arquivos de um
// jeito (com/sem FE0F, com/sem zeros à esquerda, maiúsculo/minúsculo).
// Agora todos vêm de pacotes npm com versão fixa, e o nome exato de
// cada arquivo vem de um índice gerado a partir do próprio pacote
// (public/emoji-sets/<tema>.json). Emoji que o tema não tem cai pro
// emoji do sistema sem nem tentar baixar uma imagem que não existe.
const SETS = {
  twemoji: { base: 'https://cdn.jsdelivr.net/npm/@twemoji/svg@15.0.0/' },
  noto: { base: 'https://cdn.jsdelivr.net/npm/@svgmoji/noto@0.2.0/svg/' },
  openmoji: { base: 'https://cdn.jsdelivr.net/npm/@svgmoji/openmoji@2.0.0/svg/' },
  fluent: { base: 'https://cdn.jsdelivr.net/npm/@lobehub/fluent-emoji-flat@1.1.0/assets/' },
};

// Chave neutra: codepoints em hexa minúsculo, sem FE0F e sem zeros à esquerda.
function keyFromCodepoints(cps) {
  return cps
    .map((cp) => cp.toLowerCase().replace(/^0+(?=.)/, ''))
    .filter((cp) => cp !== 'fe0f')
    .join('-');
}

function emojiKey(emoji) {
  return keyFromCodepoints([...emoji].map((c) => c.codePointAt(0).toString(16)));
}

const indexes = {}; // style -> Map(chave -> nome do arquivo)
const loading = {};
const listeners = new Set();
let version = 0;

function notify() {
  version += 1;
  listeners.forEach((l) => l());
}

export function loadEmojiSet(style) {
  if (!SETS[style] || indexes[style] || loading[style]) return;
  loading[style] = fetch(`${import.meta.env.BASE_URL}emoji-sets/${style}.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((files) => {
      const map = new Map();
      for (const file of files) {
        const key = keyFromCodepoints(file.split('-'));
        // Se existir com e sem FE0F, tanto faz — é o mesmo desenho.
        if (!map.has(key)) map.set(key, file);
      }
      indexes[style] = map;
      notify();
    })
    .catch(() => {
      // Sem índice (offline etc.): fica no emoji do sistema e tenta de novo depois.
      delete loading[style];
    });
}

// Re-renderiza quem usa emoji quando o índice de um tema termina de carregar.
export function useEmojiSet(style) {
  if (SETS[style] && !indexes[style]) loadEmojiSet(style);
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => version,
  );
}

// URL da imagem do emoji no tema, ou null (tema nativo, índice ainda
// carregando, ou emoji que esse tema não tem).
export function emojiImageUrl(emoji, style) {
  const set = SETS[style];
  const index = indexes[style];
  if (!set || !index || !emoji) return null;
  const file = index.get(emojiKey(emoji));
  return file ? `${set.base}${file}.svg` : null;
}
