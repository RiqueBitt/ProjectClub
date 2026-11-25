import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getShop } from '../../api/decorations';
import { proxyImage } from '../../utils/imageProxy';
import { eventPath } from '../../utils/prettyLinks';
import { shortText } from '../../pages/AnunciosPage.jsx';
import { PLANS } from '../../utils/subscriptionPlans';
import '../../styles/central-carousel.css';

// Topo da Central (nov/2026): carrossel que passa por evento ao vivo/próximo,
// novidades recentes, coleções da Loja e a Assinatura. Troca sozinho a cada
// 7 s (para com o mouse em cima ou com "menos movimento" ligado).

const ICON = {
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  crown: 'M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8Z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2V5Zm13 4h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5',
  bag: 'M5 8h14l-1 12H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2',
};
function Svg({ d, size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

const cheapest = PLANS.reduce((m, p) => (!m || Number(p.price.replace(',', '.')) < Number(m.price.replace(',', '.')) ? p : m), null);

export default function CentralCarousel({ events, news, onOpenNews }) {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  useEffect(() => {
    let alive = true;
    getShop().then((d) => { if (alive) setCollections((d?.collections || []).filter((c) => c.active !== false)); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const slides = useMemo(() => {
    const out = [];
    const evs = (events || []).filter((e) => e.status !== 'ENDED').sort((a, b) => new Date(a.startsAt || 0) - new Date(b.startsAt || 0));
    const live = evs.find((e) => e.status === 'ACTIVE');
    const next = evs.find((e) => e.status !== 'ACTIVE');
    const evSlide = (e, isLive) => ({
      key: `e-${e.id}`, kind: 'event', live: isLive, icon: 'calendar',
      kicker: isLive ? 'Evento ao vivo' : `Próximo evento${e.startsAt ? ` · ${new Date(e.startsAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}` : ''}`,
      title: e.title, sub: shortText(e.description, 140), art: e.bannerUrl,
      cta: isLive ? 'Entrar no evento' : 'Ver evento', go: () => navigate(eventPath(e)),
    });
    if (live) out.push(evSlide(live, true));
    (news || []).filter((a) => a.published !== false).slice(0, 2).forEach((a) => out.push({
      key: `a-${a.id}`, kind: 'news', icon: 'news', kicker: 'Novidade', title: a.title, sub: shortText(a.body, 140), art: a.bannerUrl,
      cta: 'Ler novidade', go: () => onOpenNews?.(`a-${a.id}`),
    }));
    if (next) out.push(evSlide(next, false));
    [...collections].sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0)).slice(0, 2).forEach((c) => out.push({
      key: `c-${c.id}`, kind: 'collection', icon: 'bag', kicker: 'Coleção da Loja', title: c.name, sub: shortText(c.description, 140), art: c.bannerUrl, logo: c.logoUrl,
      accent: c.accentColor, cta: 'Ver coleção', go: () => navigate(`/loja/colecao/${encodeURIComponent(c.id)}`),
    }));
    out.push({
      key: 'assinatura', kind: 'sub', icon: 'crown', kicker: 'Assinatura', title: 'Apoie o Project Club',
      sub: `A partir de R$ ${cheapest?.price || '13,50'}/mês: desconto na Loja, bônus de XP, insígnia e loja exclusiva.`,
      cta: 'Conhecer os planos', go: () => navigate('/assinatura'),
    });
    return out;
  }, [events, news, collections, navigate, onOpenNews]);

  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = slides.length;
  const cur = Math.min(idx, n - 1);
  const go = useCallback((i) => setIdx(((i % n) + n) % n), [n]);
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (paused || reduced || n < 2) return undefined;
    const t = setTimeout(() => go(cur + 1), 7000);
    return () => clearTimeout(t);
  }, [cur, paused, reduced, n, go]);

  // Arrastar pro lado (celular).
  const drag = useRef(null);
  const onDown = (e) => { drag.current = { x: e.clientX, moved: false }; };
  const onUp = (e) => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 50) { go(cur + (dx < 0 ? 1 : -1)); d.moved = true; }
  };

  return (
    <header
      className="home-hero home-carousel" aria-roledescription="carrossel" aria-label="Destaques"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      onPointerDown={onDown} onPointerUp={onUp}
    >
      <div className="hc-track" style={{ transform: `translateX(-${cur * 100}%)` }}>
        {slides.map((s, i) => (
          <section
            key={s.key} className={`hc-slide hc-${s.kind}${s.live ? ' is-live' : ''}${s.art ? ' has-art' : ''}`}
            aria-roledescription="slide" aria-label={`${i + 1} de ${n}: ${s.title}`} aria-hidden={i !== cur}
            style={s.accent ? { '--hc-accent': s.accent } : undefined}
          >
            {s.art && <img className="hc-art" src={proxyImage(s.art)} alt="" loading={i === 0 ? 'eager' : 'lazy'} draggable="false" />}
            {s.kind === 'sub' && <span className="hc-sub-art" aria-hidden="true"><Svg d={ICON.crown} size={150} /></span>}
            <div className="hc-shade" />
            <div className="hc-content">
              <span className="hc-kicker"><Svg d={ICON[s.icon]} size={14} /> {s.kicker}</span>
              <h2 className="hc-title">{s.title}</h2>
              {s.sub && <p className="hc-text">{s.sub}</p>}
              <button type="button" className="hc-cta" tabIndex={i === cur ? 0 : -1} onClick={s.go}>{s.cta}</button>
            </div>
          </section>
        ))}
      </div>
      {n > 1 && (
        <>
          <button type="button" className="hc-arrow prev" aria-label="Anterior" onClick={() => go(cur - 1)}><Svg d={ICON.left} size={22} /></button>
          <button type="button" className="hc-arrow next" aria-label="Próximo" onClick={() => go(cur + 1)}><Svg d={ICON.right} size={22} /></button>
          <div className="hc-dots" role="tablist" aria-label="Escolher destaque">
            {slides.map((s, i) => (
              <button
                key={s.key} type="button" role="tab" aria-selected={i === cur} aria-label={s.title}
                className={`hc-dot${i === cur ? ' on' : ''}${i === cur && !paused && !reduced ? ' run' : ''}`} onClick={() => go(i)}
              ><span /></button>
            ))}
          </div>
        </>
      )}
    </header>
  );
}
