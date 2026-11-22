// Ícone pequeno da atividade na linha de status (lista de membros, DMs,
// miniperfil): jogando, usando um app ou ouvindo música.
//
// Antes eram PNGs de contorno fino em verde-escuro: a 13px, em cima do fundo
// escuro (ou do banner do cartão de nome), quase sumiam. Agora é SVG cheio,
// no mesmo tamanho e no mesmo lugar, numa cor que aparece em qualquer fundo
// (ver .activity-inline-icon em global.css). Formas cheias com os detalhes
// vazados leem melhor que traço quando o ícone é tão pequeno.
const SHAPES = {
  // Controle: corpo cheio, direcional em cruz e dois botões vazados.
  game: 'M7.2 6h9.6a5.2 5.2 0 0 1 5.1 4.2l1 5.3a3.1 3.1 0 0 1-5.4 2.6L15.4 16H8.6l-2.1 2.1a3.1 3.1 0 0 1-5.4-2.6l1-5.3A5.2 5.2 0 0 1 7.2 6Z'
    + 'M7.1 8.4h1.8v1.7h1.7v1.8H8.9v1.7H7.1v-1.7H5.4v-1.8h1.7Z'
    + 'M16.5 12.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z'
    + 'M19 9.7a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z',
  // Janela de programa: barra de título cheia (com os dois botõezinhos) e a área de dentro vazada.
  app: 'M5.5 4h13a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-13a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z'
    + 'M5.9 10.6h12.2a.9.9 0 0 1 .9.9v5a.9.9 0 0 1-.9.9H5.9a.9.9 0 0 1-.9-.9v-5a.9.9 0 0 1 .9-.9Z'
    + 'M7.3 7.3a1.05 1.05 0 1 1-2.1 0 1.05 1.05 0 0 1 2.1 0Z'
    + 'M10.5 7.3a1.05 1.05 0 1 1-2.1 0 1.05 1.05 0 0 1 2.1 0Z',
  // Nota musical dupla.
  spotify: 'M9 17.5a3 3 0 1 1-2-2.83V5.2a1 1 0 0 1 .76-.97l10-2.5A1 1 0 0 1 19 2.7v11.8a3 3 0 1 1-2-2.83V7.28l-8 2Z',
};

export default function ActivityGlyph({ type, title, className = 'activity-inline-icon' }) {
  const d = SHAPES[type] || SHAPES.app;
  return (
    <svg className={`${className} is-${SHAPES[type] ? type : 'app'}`} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : 'true'}>
      {title && <title>{title}</title>}
      <path d={d} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}
