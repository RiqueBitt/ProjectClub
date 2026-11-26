import { Link } from 'react-router-dom';
import { GUIDE_SECTIONS, Note } from '../public/blogContent.jsx';
import { PRIVACY_SECTIONS } from '../public/privacyContent.jsx';

// Catálogo do Blog (/blog e /blog/:slug).
//
// Três fontes, um formato só ({ slug, category, title, excerpt, date, mark, body }).
// O banner de cada artigo é uma cena desenhada em blog/bannerArt.jsx (chave =
// slug); artigo novo sem cena usa a placa com o `mark`.
//  - NEWS: novidades escritas aqui (o que mudou e como usar);
//  - o guia (public/blogContent.jsx): cada seção vira um artigo de tutorial;
//  - termos e privacidade (public/privacyContent.jsx): dois artigos.
// O endereço do artigo é /blog/<slug> — o slug nunca muda depois de publicado
// (links compartilhados dependem dele). Ao criar um artigo novo, ponha no
// topo de NEWS com a data do dia.

export const CATEGORIES = [
  { id: 'novidades', label: 'Novidades' },
  { id: 'primeiros-passos', label: 'Primeiros passos' },
  { id: 'tutoriais', label: 'Tutoriais' },
  { id: 'apps', label: 'Apps e aparelhos' },
  { id: 'seguranca', label: 'Segurança e privacidade' },
];
export const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || id;

const GUIDE_DATE = '2026-10-12';
const NEWS_DATE = '2026-11-24';

// Texto puro de um pedaço de JSX (pra tirar o resumo do primeiro parágrafo).
function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}
function firstLead(body) {
  const kids = [].concat(body?.props?.children || []);
  const lead = kids.find((k) => k?.props?.className === 'wk-lead') || kids.find((k) => k?.type === 'p');
  const t = textOf(lead).replace(/\s+/g, ' ').trim();
  return t.length > 170 ? `${t.slice(0, 167).replace(/\s+\S*$/, '')}…` : t;
}

// ---------- Novidades ----------
const NEWS = [
  {
    slug: 'efeitos-de-texto-na-loja', category: 'novidades', date: NEWS_DATE, mark: 'Aa', featured: true,
    title: 'Efeitos de texto chegaram na Loja',
    excerpt: 'Oito efeitos animados para o seu nome, de Aurora a Ouro, no lugar dos efeitos de perfil.',
    body: (
      <>
        <p className="wk-lead">Os efeitos de perfil saíram. No lugar deles, a Loja ganhou uma categoria nova: <b>Efeitos de texto</b>, que deixam o seu nome animado no perfil, no miniperfil e no chat.</p>
        <h2>Os oito efeitos</h2>
        <div className="tm-table" role="table" aria-label="Efeitos de texto">
          <div className="tm-row is-head" role="row"><span role="columnheader">Efeito</span><span role="columnheader">Como fica</span><span role="columnheader">Preço</span></div>
          {[
            ['Doce', 'Rosa e azul de algodão-doce', '2.000 moedas · Incomum'],
            ['Aurora', 'Verde e roxo correndo pelas letras', '2.500 moedas · Rara'],
            ['Lava', 'Laranja quente que sobe', '2.500 moedas · Rara'],
            ['Elétrico', 'Faísca azul piscando', '3.000 moedas · Épica'],
            ['Synthwave', 'Rosa e ciano com brilho neon', '3.000 moedas · Épica'],
            ['Galáxia', 'Estrelas passando dentro do nome', '3.500 moedas · Épica'],
            ['Holográfico', 'Arco-íris metálico', '3.500 moedas · Épica'],
            ['Ouro', 'Dourado com um brilho que passa', '5.000 moedas · Lendária'],
          ].map(([a, b, c]) => <div className="tm-row" role="row" key={a}><span role="cell"><b>{a}</b></span><span role="cell">{b}</span><span role="cell">{c}</span></div>)}
        </div>
        <h2>Como comprar e usar</h2>
        <ol className="wk-steps">
          <li><strong>Abra a Loja</strong><span>No menu da comunidade, entre em Economia e depois na aba Loja.</span></li>
          <li><strong>Escolha em Efeitos de texto</strong><span>A prévia mostra o seu nome do tamanho do perfil, pequeno e numa mensagem de chat.</span></li>
          <li><strong>Equipe</strong><span>Depois de comprar, toque em Equipar ali mesmo, ou vá em Configurações → Perfil → Efeito do nome.</span></li>
        </ol>
        <Note title="Quem tinha efeito de perfil">Os efeitos de perfil foram desligados para todo mundo. Os efeitos de texto têm cores próprias, então a cor do nome fica guardada e volta se você trocar para o Sólido.</Note>
      </>
    ),
  },
  {
    slug: 'mesa-de-rpg-na-call', category: 'tutoriais', date: NEWS_DATE, mark: 'D20',
    title: 'Mesa de RPG na call: como jogar',
    excerpt: 'Mestre em cima, quatro jogadores embaixo, fichas e dados que todo mundo vê. O passo a passo para a primeira sessão.',
    body: (
      <>
        <p className="wk-lead">A mesa de RPG não é um jogo pronto com regras automáticas: ela é a mesa da sessão. Uma pessoa narra como mestre, as outras jogam, e a mesa guarda as fichas e os dados.</p>
        <h2>1. Entre numa call com a mesa ligada</h2>
        <p>Canais de voz com mesa mostram um 🎲 e o contador "x/5" do lado do nome: cabem um mestre e quatro jogadores. Quem administra liga em editar o canal de voz → <b>Call modo RPG</b>.</p>
        <h2>2. Escolha o seu lugar</h2>
        <p>Ao entrar aparece "Escolha seu lugar": <b>Mestre</b> (se ninguém pegou) ou <b>Jogador</b>. Também dá para tocar num lugar vazio da mesa.</p>
        <h2>3. Monte o personagem</h2>
        <p>Toque no seu nome e escreva o do personagem. A ficha rápida tem três partes:</p>
        <ul className="tm-short">
          <li><b>PV:</b> a vida. Use − e + quando levar dano ou se curar.</li>
          <li><b>Estresse:</b> seis espaços. Encheu, o personagem entra em BURNOUT.</li>
          <li><b>PA:</b> três pontos de ação por turno, mais a Ação Rápida. O ↻ começa um turno novo.</li>
        </ul>
        <p>O mestre mexe na ficha de todo mundo; cada jogador mexe só na própria.</p>
        <h2>4. Jogue</h2>
        <p>O mestre conta a história e pode transmitir a tela no meio da mesa (mapa, imagem da cena) ou pôr música em Atividades. Os jogadores falam o que o personagem faz e, quando o mestre pedir um teste, tocam em <b>Rolar dados</b>. O resultado aparece para todos no histórico de rolagens. Para sair, <b>Levantar da mesa</b>.</p>
        <Note title="No celular">A mesa existe no app a partir da versão 1.44.40. Se o seu não atualizou sozinho, veja <Link to="/blog/atualizacao-automatica">como deixar a atualização automática funcionando</Link>.</Note>
      </>
    ),
  },
  {
    slug: 'molduras-em-hd', category: 'novidades', date: NEWS_DATE, mark: 'HD',
    title: 'Molduras repaginadas em alta definição',
    excerpt: 'As molduras de avatar foram redesenhadas, redondas e em 768 px, com as coleções Nostalgia e Cromado novinhas.',
    body: (
      <>
        <p className="wk-lead">As molduras da Loja ganharam arte nova: redondas de verdade, mais detalhadas e em 768 px, para ficarem nítidas até no perfil em tela cheia.</p>
        <p>Cada moldura entra um pouco por cima da beirada da foto, do jeito das decorações de avatar que você já conhece. As coleções <b>Nostalgia</b> (CD, corações e a janela Perfil.exe) e <b>Cromado</b> (anel holográfico e triângulos) foram desenhadas do zero.</p>
        <h2>Comprei de uma coleção que saiu da Loja</h2>
        <p>Continua seu. Quando uma coleção ou um item sai da vitrine, ele para de ser vendido, mas quem comprou, ganhou ou recebeu da staff continua vendo no inventário e equipando normalmente.</p>
      </>
    ),
  },
  {
    slug: 'atualizacao-automatica', category: 'apps', date: NEWS_DATE, mark: '↻',
    title: 'Atualização automática no celular e no computador',
    excerpt: 'O app se atualiza sozinho. Se o seu ficou parado numa versão antiga, quase sempre é o Bloqueador automático da Samsung.',
    body: (
      <>
        <p className="wk-lead">O Project Club busca a versão nova quando abre e instala sozinho, no computador e no Android. Os mods dos seus jogos também passaram a se atualizar sozinhos por padrão.</p>
        <h2>Meu celular ficou numa versão antiga</h2>
        <p>Em aparelhos Samsung, o <b>Bloqueador automático</b> impede apps instalados fora da loja de se atualizarem. Para liberar:</p>
        <ol className="wk-steps">
          <li><strong>Abra as Configurações</strong><span>Do próprio celular.</span></li>
          <li><strong>Segurança e privacidade</strong><span>Procure por "Bloqueador automático".</span></li>
          <li><strong>Desligue</strong><span>Abra o Project Club de novo: ele baixa e instala a versão nova.</span></li>
        </ol>
        <p>Se preferir, baixe o APK mais recente na <Link to="/#download">página de download</Link> e instale por cima. Nada da sua conta se perde.</p>
        <Note title="Mods">Em Mod Manager → Configurações dá para desligar a atualização automática de um jogo específico.</Note>
      </>
    ),
  },
  {
    slug: 'calls-mais-limpas', category: 'novidades', date: NEWS_DATE, mark: '◉',
    title: 'Calls mais limpas e tela compartilhada estável',
    excerpt: 'As reações na call saíram e a tela compartilhada parou de pular no celular quando alguém fala.',
    body: (
      <>
        <p className="wk-lead">Duas mudanças nas chamadas de voz, no site, no computador e no app.</p>
        <h2>Sem reações na call</h2>
        <p>Quase ninguém usava as reações flutuantes durante a chamada, e elas tampavam a tela. Saíram. Reações nas mensagens do chat continuam iguais.</p>
        <h2>Tela compartilhada parada</h2>
        <p>No celular, o anel verde de quem fala aumentava a fileira de fotos e espremia a tela compartilhada, que ficava subindo e descendo. Agora o anel tem tamanho fixo e nada se mexe.</p>
        <p>Também corrigimos um caso em que o app fechava sozinho ao entrar ou sair de uma chamada no Android 12 ou mais novo.</p>
      </>
    ),
  },
];

// ---------- Guia → artigos ----------
const GUIDE_CATEGORY = { 'Começo': 'primeiros-passos', 'Comunidade': 'tutoriais', 'Você': 'tutoriais', 'Diversão': 'tutoriais', 'Apps': 'apps', 'Aparelhos': 'apps', 'Segurança': 'seguranca' };
const GUIDE_MARK = {
  'o-que-e': 'PC', conta: '@', comunidade: '#', chat: 'Aa', dms: '✉', voz: '◉', perfil: '☺', economia: '¢', casas: '⌂', clas: '⚑',
  'assistir-juntos': '▶', biblioteca: '▤', mods: '⚙', apps: '▦', 'app-pc': '⌘', android: '▯', moderacao: '⛨', atalhos: '⌨', duvidas: '?',
};
const GUIDE_SLUG = { 'o-que-e': 'o-que-e-o-project-club', conta: 'conta-e-inscricao', dms: 'dms-e-grupos', voz: 'voz-e-chamadas', perfil: 'amigos-e-perfil', economia: 'economia-e-progresso', clas: 'clas', 'assistir-juntos': 'cinema-e-youtube-juntos', biblioteca: 'biblioteca-de-jogos', mods: 'mods-e-modpacks', apps: 'aba-apps', 'app-pc': 'app-para-computador', android: 'app-de-android', moderacao: 'seguranca-e-moderacao', duvidas: 'duvidas-comuns' };

const GUIDE_POSTS = GUIDE_SECTIONS.map((s) => ({
  slug: GUIDE_SLUG[s.id] || s.id,
  category: s.id === 'duvidas' ? 'primeiros-passos' : (GUIDE_CATEGORY[s.group] || 'tutoriais'),
  date: GUIDE_DATE,
  mark: GUIDE_MARK[s.id] || s.title[0],
  title: s.title,
  excerpt: firstLead(s.body),
  body: s.body,
}));

// ---------- Termos e privacidade → dois artigos ----------
const sectionsBody = (list) => (
  <>
    {list.map((s) => (
      <section key={s.id} id={s.id} className="bl-sub">
        <h2>{s.title}</h2>
        <div className="wk-prose">{s.body}</div>
      </section>
    ))}
  </>
);
const TERMS_IDS = ['resumo', 'termos', 'mudancas', 'contato'];
const PRIVACY_POSTS = [
  {
    slug: 'politica-de-privacidade', category: 'seguranca', date: GUIDE_DATE, mark: 'LGPD', toc: true,
    title: 'Política de privacidade',
    excerpt: 'Quais dados ficam guardados, para quê, por quanto tempo, com quem e como pedir uma cópia, uma correção ou a exclusão.',
    body: sectionsBody(PRIVACY_SECTIONS.filter((s) => !TERMS_IDS.includes(s.id) || s.id === 'resumo')),
  },
  {
    slug: 'termos-de-uso', category: 'seguranca', date: GUIDE_DATE, mark: '§', toc: true,
    title: 'Termos de uso',
    excerpt: 'O que você combina com a gente ao usar o Project Club: regras da comunidade, conta, conteúdo e mudanças nos termos.',
    body: sectionsBody(PRIVACY_SECTIONS.filter((s) => TERMS_IDS.includes(s.id))),
  },
];

export const POSTS = [...NEWS, ...GUIDE_POSTS, ...PRIVACY_POSTS];
export const postBySlug = (slug) => POSTS.find((p) => p.slug === slug) || null;
export const featuredPost = () => POSTS.find((p) => p.featured) || POSTS[0];

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} de ${MONTHS[m - 1]} de ${y}`;
}
