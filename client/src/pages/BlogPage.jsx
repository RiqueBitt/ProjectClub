import DocShell from './public/DocShell.jsx';
import { GUIDE_APPS, GUIDE_SECTIONS } from './public/blogContent.jsx';

// Blog (/blog): o guia completo do Project Club, estilo wiki, numa página
// só. O conteúdo fica em public/blogContent.jsx; o esqueleto (índice,
// filtro, âncoras) em public/DocShell.jsx.

function HeroArt() {
  // Faixa com as telas reais de alguns apps, passando devagar.
  const picks = GUIDE_APPS.slice(0, 6);
  return (
    <div className="wk-strip" aria-hidden="true">
      {picks.map((a) => (
        <figure key={a.id} style={{ '--c': a.color }}>
          <img src={`/apps/${a.id}/shots/${a.shot}.jpg`} alt="" width="1600" height="1000" loading="eager" decoding="async" />
          <figcaption><img src={`/apps/${a.id}/icon.png`} alt="" width="20" height="20" />{a.name}</figcaption>
        </figure>
      ))}
    </div>
  );
}

export default function BlogPage() {
  return (
    <DocShell
      page="blog"
      kicker={`Blog · guia completo · ${GUIDE_SECTIONS.length} seções`}
      title="Tudo sobre o Project Club"
      lede="Da inscrição aos atalhos de teclado: como funciona a comunidade, o chat, a voz, a economia, os clãs, os minijogos, os mods e cada um dos nove apps."
      meta="Atualizado em 12 de outubro de 2026"
      heroArt={<HeroArt />}
      sections={GUIDE_SECTIONS}
      search
      searchPlaceholder="Filtrar o guia: 2FA, enquete, gemas, modpack…"
    />
  );
}
