// Filtro de segurança dos pedidos de imagem do Pingu (português + inglês).
// Puro e barato: roda ANTES de qualquer IA/provedor. Recusa:
//   - conteúdo sexual / nudez;
//   - menores em QUALQUER contexto sexualizado ou violento (e termos que já
//     são abuso por si só);
//   - gore / violência explícita;
//   - símbolos de ódio;
//   - imitação de pessoas reais conhecidas (políticos, celebridades…);
//   - automutilação / suicídio.
// O provedor (Pollinations) ainda tem o próprio filtro (safe=true).

/** minúsculas, sem acento, leetspeak básico desfeito, só letras/números. */
function foldSafety(text) {
  return ` ${String(text || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[@4]/g, 'a').replace(/3/g, 'e').replace(/[1!|]/g, 'i').replace(/0/g, 'o').replace(/[$5]/g, 's').replace(/7/g, 't')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

// Cada termo é um começo de palavra (casa "pelad" em "pelada", "peladas").
// Termo com espaço = expressão.
const SEXUAL = [
  'nu', 'nua', 'nus', 'nuas', 'pelad', 'sem roupa', 'semi nu', 'seminu', 'nude', 'nudes', 'nudez', 'naked', 'nudity', 'topless',
  'nsfw', 'sexo', 'sexual', 'sexy', 'sensual', 'erotic', 'erotica', 'porn', 'porno', 'pornografi', 'hentai', 'ecchi', 'rule34', 'r34',
  'seios', 'mamilo', 'nipple', 'genital', 'penis', 'vagina', 'boobs', 'tits', 'bunda de fora', 'lingerie', 'calcinha', 'fetiche', 'fetish',
  'bdsm', 'orgasm', 'stripper', 'striptease', 'transando', 'transar', 'gozando', 'onlyfans', 'provocante', 'seductive', 'lewd', 'xxx',
  'undress', 'tirando a roupa', 'without clothes', 'no clothes',
];
const MINORS = [
  'crianca', 'criancas', 'criancinha', 'menino', 'menina', 'meninos', 'meninas', 'garotinh', 'bebe', 'bebes', 'infantil', 'adolescente',
  'novinha', 'novinho', 'pre adolescente', 'colegial', 'estudante do fundamental', 'child', 'children', 'kid', 'kids', 'boy', 'girl',
  'toddler', 'baby', 'teen', 'teenager', 'minor', 'underage', 'schoolgirl', 'schoolboy', 'young girl', 'young boy',
];
// Sempre recusados (já são exploração de menores por si só).
const ABUSE = ['loli', 'lolicon', 'shota', 'shotacon', 'pedofil', 'pedo', 'cp', 'jailbait', 'csam'];
const VIOLENCE = [
  'sangue', 'sangrando', 'sangrent', 'blood', 'bloody', 'morto', 'morta', 'mortos', 'dead', 'corpse', 'cadaver', 'ferid', 'machucad',
  'apanhando', 'espancad', 'beaten', 'arma', 'armas', 'gun', 'faca', 'knife', 'tiro', 'baleado', 'shot', 'violencia', 'violence',
  'abuso', 'abuse', 'tortura', 'torture', 'acorrentad', 'chained', 'amarrad', 'tied up', 'chorando de dor',
];
const GORE = [
  'gore', 'gory', 'decapit', 'desmembr', 'dismember', 'behead', 'mutilad', 'mutilat', 'viscera', 'visceras', 'tripas', 'entrails',
  'guts', 'cabeca cortada', 'corpo mutilado', 'cabeca decepada', 'decepad', 'massacre', 'carnificina', 'esquartejad', 'tortura', 'torture',
  'empalad', 'impaled', 'execucao', 'execution', 'sangue jorrando', 'blood splatter', 'cadaver aberto',
];
const HATE = [
  'suastica', 'swastika', 'simbolo nazista', 'bandeira nazista', 'nazi flag', 'nazi symbol', 'heil hitler', 'sieg heil', 'kkk', 'ku klux',
  'white power', 'supremacia branca', 'white supremacy', '1488', 'sol negro nazista', 'ss nazista', 'odio racial', 'racial hate',
  'hitler', 'nazismo', 'nazista', 'nazi',
];
const SELF_HARM = [
  'suicid', 'se matar', 'se matando', 'automutil', 'auto mutil', 'self harm', 'selfharm', 'cortando os pulsos', 'corte nos pulsos',
  'cortar os pulsos', 'slit wrist', 'cutting wrists', 'se enforcando', 'enforcad', 'hanging himself', 'hanging herself', 'kill myself',
  'kill yourself', 'kys', 'overdose',
];
// Pessoas reais muito conhecidas (lista curta e mantida aqui; a equipe pode
// estender com PINGU_IMAGE_BLOCKED_NAMES, nomes separados por vírgula).
const PUBLIC_FIGURES = [
  'presidente lula', 'lula presidente', 'luiz inacio', 'bolsonaro', 'dilma', 'michel temer', 'alexandre de moraes', 'xandao', 'haddad', 'tarcisio', 'michelle bolsonaro', 'janja',
  'trump', 'donald trump', 'biden', 'joe biden', 'obama', 'kamala', 'putin', 'zelensky', 'xi jinping', 'kim jong', 'netanyahu', 'macron',
  'papa francisco', 'pope francis', 'papa leao', 'pope leo', 'elon musk', 'bill gates', 'zuckerberg', 'jeff bezos',
  'neymar', 'messi', 'cristiano ronaldo', 'pele jogador', 'rei pele', 'vini jr', 'vinicius junior', 'anitta', 'taylor swift', 'beyonce', 'rihanna',
  'kanye', 'kim kardashian', 'billie eilish', 'ariana grande', 'selena gomez', 'xuxa', 'silvio santos', 'faustao', 'luciano huck',
  'casimiro', 'felipe neto', 'whindersson', 'mrbeast', 'mr beast', 'pewdiepie', 'ronaldinho', 'ayrton senna', 'michael jackson',
  'presidente do brasil', 'presidente dos eua', 'presidente americano', 'pessoa real', 'foto real de uma pessoa famosa', 'celebridade',
  'deepfake', 'deep fake',
];

// Palavras curtas que precisam casar inteiras (senão "nu" pegaria "nuvem").
const WHOLE = new Set(['nu', 'nua', 'nus', 'nuas', 'nude', 'kid', 'boy', 'girl', 'teen', 'minor', 'baby', 'bebe', 'gun', 'shot', 'arma', 'guts', 'dead', 'kys', 'kkk', 'cp', 'pedo', 'loli', 'nazi', 'xxx', 'sexy', 'porn', 'tits', 'r34']);

function matchList(text, list) {
  for (const term of list) {
    const t = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = WHOLE.has(term) ? new RegExp(` ${t} `) : new RegExp(` ${t}`);
    if (re.test(text)) return term;
  }
  return null;
}

const MESSAGES = {
  sexual: 'Não posso criar imagens com nudez ou conteúdo sexual. Que tal outra ideia? 🐧',
  minors: 'Não crio imagens com crianças ou adolescentes nesse tipo de situação. Tenta outra ideia! 🐧',
  abuse: 'Esse pedido não dá. Nada de conteúdo envolvendo menores dessa forma. 🐧',
  gore: 'Não crio imagens violentas ou com gore. Bora pensar em algo mais leve? 🐧',
  hate: 'Não crio símbolos ou imagens de ódio. 🐧',
  person: 'Não faço imagens de pessoas reais (políticos, famosos…). Posso criar um personagem inventado! 🐧',
  selfHarm: 'Não posso criar esse tipo de imagem. Se você estiver passando por um momento difícil, fale com alguém de confiança ou ligue 188 (CVV, 24 h, de graça). 💙',
};

function extraNames(raw = process.env.PINGU_IMAGE_BLOCKED_NAMES) {
  return String(raw || '').split(',').map((s) => foldSafety(s).trim()).filter((s) => s.length >= 3).slice(0, 200);
}

/**
 * Confere um pedido de imagem. Devolve { ok: true } ou
 * { ok: false, category, term, message }.
 */
function checkImagePrompt(prompt, { blockedNames = extraNames() } = {}) {
  const t = foldSafety(prompt);
  if (!t.trim()) return { ok: false, category: 'empty', message: 'Me diz o que desenhar! Ex.: "@pingu desenhe um pinguim astronauta". 🐧' };
  const fail = (category, term) => ({ ok: false, category, term, message: MESSAGES[category] });
  let term = matchList(t, ABUSE);
  if (term) return fail('abuse', term);
  const minor = matchList(t, MINORS);
  const sexual = matchList(t, SEXUAL);
  if (minor && sexual) return fail('minors', `${minor}+${sexual}`);
  const violent = matchList(t, VIOLENCE);
  if (minor && violent) return fail('minors', `${minor}+${violent}`);
  if (sexual) return fail('sexual', sexual);
  term = matchList(t, SELF_HARM);
  if (term) return fail('selfHarm', term);
  term = matchList(t, GORE);
  if (term) return fail('gore', term);
  term = matchList(t, HATE);
  if (term) return fail('hate', term);
  term = matchList(t, [...PUBLIC_FIGURES, ...blockedNames]);
  if (term) return fail('person', term);
  return { ok: true };
}

module.exports = { checkImagePrompt, foldSafety, MESSAGES, _lists: { SEXUAL, MINORS, ABUSE, VIOLENCE, GORE, HATE, SELF_HARM, PUBLIC_FIGURES } };
