import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  isProjectMcAvailable, getProjectMcStatus, checkProjectMcUpdate,
  installProjectMc, launchProjectMc, uninstallProjectMc, onProjectMcProgress,
} from '../utils/projectMc';
import { listAppCatalog } from '../api/endpoints';
import PageIcon from '../components/PageIcons.jsx';
import { proxyImage } from '../utils/imageProxy';
import '../styles/jogos-page.css';

// Ícones locais (traço) no lugar dos símbolos ▶ ⬇ 🔍 que viravam caixinha no Linux.
const JP_ICONS = {
  play: 'M8 5v14l11-7L8 5Z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  zoom: 'm20 20-4.2-4.2M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM11 8v6M8 11h6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  check: 'm5 12 5 5L20 7',
  back: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  close: 'M6 6l12 12M18 6 6 18',
  windows: 'M3 5.5 10 4.5v7H3zM12 4.2 21 3v8.5h-9zM3 13h7v6.5L3 18.5zM12 13h9V21l-9-1.2z',
  linux: 'M12 3c-2.2 0-3.5 1.8-3.5 4.3 0 1.5-.6 2.6-1.6 4C5.6 13 5 14.6 5 16c0 2.8 3 5 7 5s7-2.2 7-5c0-1.4-.6-3-1.9-4.7-1-1.4-1.6-2.5-1.6-4C15.5 4.8 14.2 3 12 3Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5M12 8h.01',
  cpu: 'M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  shield: 'M12 3 5 6v6c0 4.5 3 7.8 7 9 4-1.2 7-4.5 7-9V6l-7-3Z',
};
function JpIcon({ name, size = 16, filled = false, strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="jp-icon"><path d={JP_ICONS[name]} /></svg>
  );
}
import { useLiveRefresh } from '../utils/liveRefresh';

// Item pedido: "separe claramente os downloads para Windows e Linux"
// — o botão de instalar/jogar só funciona pra plataforma em que o
// app desktop já está rodando de qualquer forma (window.electronAPI
// só existe nessa instância específica) — isso só serve pra saber
// QUAL das duas seções (Windows/Linux) é "a sua", pra destacar.
function currentPlatform() {
  const p = typeof window !== 'undefined' ? window.electronAPI?.platform : null;
  return p === 'linux' ? 'linux' : 'win32'; // Electron nesse projeto só roda Windows ou Linux
}

// Item pedido: "remova as categorias Jogos, Aplicativos e deixe todos
// os apps em um só menu" — antes esta página tinha duas abas internas
// (Jogos / Aplicativos); a aba "Aplicativos" nunca mostrava nada de
// verdade (ficava sempre com a mensagem de "nenhum aplicativo
// disponível", já que o catálogo inteiro sempre ia pra aba "Jogos",
// sem nenhum jeito real de categorizar um item pra lá) — virou uma
// aba morta. Removidas as duas: agora é uma grade única com tudo que
// a staff cadastrar no catálogo, sem divisão nenhuma.
export default function JogosPage() {
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState(null); // null = carregando ainda
  // Item pedido: "clique no banner... abre outra aba... parecida com
  // a aba de downloads da Steam" — detailModuleId controla se estamos
  // vendo a grade principal (null) ou a tela de detalhe de um item
  // específico (o moduleId dele).
  const [detailModuleId, setDetailModuleId] = useState(null);
  // Item pedido: "ao clicar em uma screenshot, abra a imagem em
  // tamanho grande" — guarda o ÍNDICE (não só a url) pra dar pra
  // navegar entre as screenshots com as setas dentro do lightbox.
  const [lightboxIndex, setLightboxIndex] = useState(null);

  useEffect(() => {
    listAppCatalog().then((d) => setCatalog(d.items)).catch(() => setCatalog([]));
  }, []);

  // Tempo real (11s): catálogo (versões, banners, screenshots novas) sem
  // sair da tela de detalhe aberta.
  useLiveRefresh(({ put }) => listAppCatalog().then((d) => put(setCatalog)(d.items)), { enabled: catalog !== null });

  const detailItem = catalog?.find((c) => c.moduleId === detailModuleId);

  if (detailItem) {
    return (
      <>
        <AppDetailView item={detailItem} onBack={() => setDetailModuleId(null)} onOpenScreenshot={setLightboxIndex} />
        {lightboxIndex !== null && (
          <ScreenshotLightbox
            screenshots={detailItem.screenshots}
            index={lightboxIndex}
            onIndexChange={setLightboxIndex}
            onClose={() => setLightboxIndex(null)}
          />
        )}
      </>
    );
  }

  return (
    <div className="jogos-page">
      <div className="jogos-page-header">
        <span className="jogos-page-header-icon"><PageIcon name="grid" size={26} /></span>
        <div className="jogos-page-header-text">
          <h1>Apps</h1>
          <p className="dim">Módulos opcionais que rodam dentro da instalação do Project Club — instale só o que você usa.</p>
        </div>
        {catalog && catalog.length > 0 && (
          <span className="jogos-page-header-count">{catalog.length} {catalog.length === 1 ? 'app disponível' : 'apps disponíveis'}</span>
        )}
      </div>

      {/* Item pedido: "Project Club → Apps → Mods... não crie uma nova
          categoria principal Jogos" — Mods é uma FERRAMENTA dentro de
          Apps (não um item da barra lateral, não uma aba de catálogo
          baixável como os cards abaixo), por isso vira um cartão
          destacado próprio, separado da grade de apps/módulos. */}
      <button type="button" className="jogos-page-mods-entry" onClick={() => navigate('/jogos/mods')}>
        <span className="jogos-page-mods-entry-icon"><PageIcon name="bolt" size={22} /></span>
        <span className="jogos-page-mods-entry-text">
          <strong>Mods</strong>
          <span className="dim">Descubra e gerencie mods dos seus jogos da Steam</span>
        </span>
        <span className="jogos-page-mods-entry-arrow" style={{ transform: 'scaleX(-1)', display: 'inline-flex' }}><PageIcon name="back" size={20} /></span>
      </button>
      {/* Biblioteca de jogos (tempo de jogo, estilo Steam). */}
      <button type="button" className="jogos-page-mods-entry" onClick={() => navigate('/jogos/biblioteca')}>
        <span className="jogos-page-mods-entry-icon"><PageIcon name="gamepad" size={22} /></span>
        <span className="jogos-page-mods-entry-text">
          <strong>Biblioteca de jogos</strong>
          <span className="dim">Seu tempo de jogo, jogos recentes e o que está jogando agora</span>
        </span>
        <span className="jogos-page-mods-entry-arrow" style={{ transform: 'scaleX(-1)', display: 'inline-flex' }}><PageIcon name="back" size={20} /></span>
      </button>

      {catalog === null ? (
        // Item pedido: "melhore as partes vazias da tela" — enquanto
        // carrega, cards-esqueleto no lugar de uma tela em branco.
        <div className="jogos-page-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="app-card-skeleton"><span /><span /><span /></div>
          ))}
        </div>
      ) : catalog.length === 0 ? (
        <div className="jogos-page-empty">
          <span className="jogos-page-empty-icon"><PageIcon name="grid" size={30} /></span>
          <h3>Nenhum app disponível ainda</h3>
          <p>A staff pode adicionar novos módulos a qualquer momento pelo painel administrativo.</p>
        </div>
      ) : (
        <div className="jogos-page-grid">
          {catalog.map((item, i) => (
            <ModuleCard key={item.moduleId} item={item} index={i} onOpenDetail={() => setDetailModuleId(item.moduleId)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ===== Identidade de cada app =====
// Cor de destaque de cada app (a mesma dos ícones e banners). Apps novos
// cadastrados pela staff usam a cor do tema do Project Club.
const APP_THEMES = {
  photoproject: ['#A855F7', '#6366F1'],
  projectmc: ['#A3E635', '#22C55E'],
  hyproject: ['#FACC15', '#F97316'],
  davinciproject: ['#F87171', '#FB923C'],
  waveproject: ['#22D3EE', '#3B82F6'],
  texelproject: ['#FB923C', '#EF4444'],
  forgeproject: ['#4ADE80', '#14B8A6'],
  canvasproject: ['#F472B6', '#A855F7'],
  gameproject: ['#818CF8', '#4F46E5'],
};
function themeVars(moduleId) {
  const t = APP_THEMES[moduleId];
  return t ? { '--app-accent': t[0], '--app-accent-2': t[1] } : undefined;
}

// A descrição cadastrada segue o padrão "Editor de imagem do Project Club:
// retoque fotos, ... Baseado no Patchy (código aberto, MIT)." — separa o
// slogan (antes dos dois-pontos), o resumo e o crédito da base, para cada
// parte aparecer no lugar certo em vez de repetir o mesmo texto.
function splitDescription(description = '') {
  const text = description.trim();
  const colon = text.indexOf(':');
  const tagline = colon > 0 && colon < 70 ? text.slice(0, colon).trim() : '';
  let body = tagline ? text.slice(colon + 1).trim() : text;
  let base = '';
  const m = /\s*Baseado no (.+?)\.?$/i.exec(body);
  if (m) { base = m[1].trim(); body = body.slice(0, m.index).trim(); }
  if (body) body = body.charAt(0).toUpperCase() + body.slice(1);
  return { tagline, body, base };
}

// "~58 MB (zip)" -> "~58 MB"; "~96 MB (download) · ~300 MB instalado" -> "~96 MB"
const shortSize = (label) => (label || '').split(/\s+[·|]\s+/)[0].replace(/\s*\(.*?\)\s*/g, ' ').trim();

function sizesFor(item, platform) {
  const win = item.sizeLabelWin || (platform !== 'linux' ? item.sizeLabel : null);
  const linux = item.sizeLabelLinux || (platform === 'linux' ? item.sizeLabel : null);
  return { win, linux, current: platform === 'linux' ? linux : win };
}

// Hook compartilhado entre o card da grade e a tela de detalhe — status
// de instalação, progresso, e as ações (instalar/atualizar, abrir,
// desinstalar) vivem aqui pra não duplicar a lógica.
function useModuleState(moduleId) {
  const desktopReady = isProjectMcAvailable();
  const [status, setStatus] = useState(null);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');

  const refreshStatus = () => {
    if (!desktopReady) return;
    getProjectMcStatus(moduleId).then(setStatus).catch(() => {});
    checkProjectMcUpdate(moduleId).then((d) => (d.error ? setError(d.error) : (setError(''), setUpdateInfo(d)))).catch((err) => setError(err.message));
  };

  useEffect(() => {
    refreshStatus();
    onProjectMcProgress((data) => {
      if (data.id !== moduleId) return;
      setProgress(data);
      if (data.phase === 'done') {
        setBusy(false);
        setProgress(null);
        refreshStatus();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  const install = async () => {
    setError('');
    setBusy(true);
    setProgress({ phase: 'downloading', percent: 0 });
    try {
      const result = await installProjectMc(moduleId);
      if (!result.success) throw new Error(result.error || 'Falha desconhecida.');
    } catch (err) {
      setError(err.message);
      setBusy(false);
      setProgress(null);
    }
  };

  const open = async () => {
    setError('');
    try {
      const result = await launchProjectMc(moduleId);
      if (!result.success) throw new Error(result.error || 'Falha desconhecida.');
    } catch (err) {
      setError(err.message);
    }
  };

  // Só desinstala (apaga os arquivos); para instalar de novo é o botão
  // "Instalar" normal, que volta a aparecer sozinho.
  const uninstall = async () => {
    if (!confirm(`Isso vai desinstalar ${status?.displayName || 'este app'} e apagar os arquivos dele. Continuar?`)) return;
    setError('');
    setBusy(true);
    try {
      await uninstallProjectMc(moduleId);
      refreshStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return {
    desktopReady, status, updateInfo, busy, progress, error,
    installed: status?.installed, updateAvailable: updateInfo?.updateAvailable,
    install, open, uninstall,
  };
}

const PHASE_LABEL = { downloading: 'Baixando', extracting: 'Extraindo', installing: 'Instalando' };
const phaseLabel = (phase) => PHASE_LABEL[phase] || 'Concluindo';

// Botão principal (o mesmo no card e no detalhe): mostra o que vai
// acontecer ao clicar — Instalar, Atualizar ou Abrir — e vira a própria
// barra de progresso enquanto baixa.
function PrimaryAction({ state, size = 'md', onClick }) {
  const { installed, updateAvailable, busy, progress, install, open } = state;
  if (busy) {
    const pct = progress?.percent ?? 0;
    return (
      <div className={`pc-action is-${size} is-busy`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span className="pc-action-fill" style={{ width: `${progress ? pct : 100}%` }} />
        <span className="pc-action-label">{progress ? `${phaseLabel(progress.phase)} ${pct}%` : 'Aguarde...'}</span>
      </div>
    );
  }
  const run = (fn) => (e) => { e.stopPropagation(); onClick?.(); fn(); };
  if (installed && updateAvailable) {
    return <button type="button" className={`pc-action is-${size} is-update`} onClick={run(install)}><JpIcon name="refresh" size={size === 'lg' ? 18 : 15} /> Atualizar</button>;
  }
  if (installed) {
    return <button type="button" className={`pc-action is-${size} is-open`} onClick={run(open)}><JpIcon name="play" size={size === 'lg' ? 17 : 14} filled /> Abrir</button>;
  }
  return <button type="button" className={`pc-action is-${size} is-install`} onClick={run(install)}><JpIcon name="download" size={size === 'lg' ? 18 : 15} /> Instalar</button>;
}

// ===== Card da grade =====
// Banner inteiro (sem cortar o ícone da arte), resumo do que o app faz,
// versão + tamanho e um botão claro com a ação. Clicar no resto do card
// abre a página do app.
function ModuleCard({ item, index, onOpenDetail }) {
  const state = useModuleState(item.moduleId);
  const { desktopReady, installed, updateAvailable, busy, error } = state;
  const platform = currentPlatform();
  const { body } = splitDescription(item.description);
  const size = shortSize(sizesFor(item, platform).current);

  return (
    <article
      className={`app-card ${installed ? 'is-installed' : ''}`}
      style={{ ...themeVars(item.moduleId), '--i': index }}
      onClick={onOpenDetail}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(); } }}
      role="button"
      tabIndex={0}
      aria-label={`Abrir a página do ${item.name}`}
    >
      <div className="app-card-media">
        {item.bannerUrl
          ? <img src={proxyImage(item.bannerUrl)} alt="" loading="lazy" />
          : <span className="app-card-media-fallback"><PageIcon name="grid" size={40} /></span>}
        <div className="app-card-chips">
          {installed && !busy && !updateAvailable && <span className="app-chip is-ok"><JpIcon name="check" size={12} strokeWidth={3} /> Instalado</span>}
          {installed && !busy && updateAvailable && <span className="app-chip is-accent"><JpIcon name="refresh" size={12} strokeWidth={2.5} /> Atualização</span>}
        </div>
      </div>

      <div className="app-card-body">
        {body && <p className="app-card-description">{body}</p>}
        {error && <p className="app-card-error" title={error}>{error}</p>}
        <div className="app-card-foot">
          <div className="app-card-meta">
            {item.version && <span>v{item.version}</span>}
            {size && <span>{size}</span>}
          </div>
          {desktopReady
            ? <PrimaryAction state={state} />
            : <span className="app-card-more">Ver detalhes <JpIcon name="next" size={14} /></span>}
        </div>
      </div>
    </article>
  );
}

// ===== Página do app =====

// Galeria estilo loja: uma captura grande em destaque + miniaturas
// (sem rolagem lateral). Clicar na grande abre em tela cheia.
function ScreenshotGallery({ screenshots, onOpen }) {
  const [active, setActive] = useState(0);
  if (!screenshots?.length) return null;
  const total = screenshots.length;
  const current = screenshots[Math.min(active, total - 1)];
  const go = (d) => setActive((i) => (i + d + total) % total);
  return (
    <section className="app-section">
      <h2 className="app-section-title"><JpIcon name="image" size={18} /> Capturas de tela <span className="app-section-count">{total}</span></h2>
      <div className="app-gallery">
        <div className="app-gallery-stage">
          <button type="button" className="app-gallery-main" onClick={() => onOpen(active)} aria-label="Ampliar captura">
            <img key={current.id} src={proxyImage(current.imageUrl)} alt={`Captura ${active + 1} de ${total}`} />
            <span className="app-gallery-zoom"><JpIcon name="zoom" size={16} /> Ampliar</span>
          </button>
          {total > 1 && (
            <>
              <button type="button" className="app-gallery-nav is-prev" onClick={() => go(-1)} aria-label="Anterior"><JpIcon name="back" size={20} /></button>
              <button type="button" className="app-gallery-nav is-next" onClick={() => go(1)} aria-label="Próxima"><JpIcon name="next" size={20} /></button>
              <span className="app-gallery-counter">{active + 1} / {total}</span>
            </>
          )}
        </div>
        {total > 1 && (
          <div className="app-gallery-thumbs">
            {screenshots.map((s, i) => (
              <button key={s.id} type="button" className={`app-gallery-thumb ${i === active ? 'is-active' : ''}`} onClick={() => setActive(i)} aria-label={`Ver captura ${i + 1}`}>
                <img src={proxyImage(s.imageUrl)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// Tela cheia: Esc fecha, setas navegam, clicar fora fecha.
function ScreenshotLightbox({ screenshots, index, onIndexChange, onClose }) {
  const total = screenshots.length;
  const go = (delta) => onIndexChange((i) => (i + delta + total) % total);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && total > 1) go(1);
      if (e.key === 'ArrowLeft' && total > 1) go(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, total]);

  const current = screenshots[index];
  if (!current) return null;

  return (
    <div className="screenshot-lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <button type="button" className="screenshot-lightbox-close" onClick={onClose} aria-label="Fechar"><JpIcon name="close" size={20} /></button>
      {total > 1 && (
        <button type="button" className="screenshot-lightbox-nav screenshot-lightbox-prev" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Anterior"><JpIcon name="back" size={24} /></button>
      )}
      <img key={current.id} src={proxyImage(current.imageUrl)} alt="" onClick={(e) => e.stopPropagation()} />
      {total > 1 && (
        <button type="button" className="screenshot-lightbox-nav screenshot-lightbox-next" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Próxima"><JpIcon name="next" size={24} /></button>
      )}
      {total > 1 && <div className="screenshot-lightbox-counter">{index + 1} / {total}</div>}
    </div>
  );
}

// Recursos (um por linha, cadastrados pela staff). A linha "Tecnologias: ..."
// vai para o quadro de detalhes ao lado, não para a lista.
function parseFeatures(featuresText) {
  const lines = (featuresText || '').split('\n').map((f) => f.trim()).filter(Boolean);
  const techLine = lines.find((l) => /^tecnologias\s*:/i.test(l));
  const features = lines.filter((l) => l !== techLine);
  const tech = techLine ? techLine.replace(/^tecnologias\s*:\s*/i, '').replace(/\s+—\s+vers[ãa]o.*$/i, '').trim() : '';
  return { features, tech };
}

function FeaturesList({ features }) {
  if (!features.length) return null;
  return (
    <section className="app-section">
      <h2 className="app-section-title"><JpIcon name="sparkle" size={18} /> Recursos principais</h2>
      <ul className="app-features">
        {features.map((f, i) => (
          <li key={i}><span className="app-features-check"><JpIcon name="check" size={13} strokeWidth={3} /></span><span>{f}</span></li>
        ))}
      </ul>
    </section>
  );
}

// "CPU: 4 núcleos" -> { label: 'Processador', value: '4 núcleos' }; a
// primeira linha sem rótulo é o sistema operacional.
const REQ_LABELS = { cpu: 'Processador', ram: 'Memória', gpu: 'Placa de vídeo', disco: 'Armazenamento', 'áudio': 'Áudio', audio: 'Áudio', sistema: 'Sistema' };
function parseRequirements(text) {
  return (text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const m = /^([\wÀ-ú ]{2,20}):\s*(.+)$/.exec(line);
    if (m) return { label: REQ_LABELS[m[1].toLowerCase()] || m[1], value: m[2] };
    return { label: i === 0 ? 'Sistema' : '', value: line };
  });
}

function RequirementsCard({ item, platform }) {
  const options = [
    { key: 'win32', label: 'Windows', icon: 'windows', text: item.requirementsWin },
    { key: 'linux', label: 'Linux', icon: 'linux', text: item.requirementsLinux },
  ].filter((o) => o.text);
  const [tab, setTab] = useState(options.some((o) => o.key === platform) ? platform : options[0]?.key);
  if (!options.length) return null;
  const current = options.find((o) => o.key === tab) || options[0];
  return (
    <section className="app-side-card">
      <h3 className="app-side-title"><JpIcon name="cpu" size={16} /> Requisitos</h3>
      {options.length > 1 && (
        <div className="app-segmented" role="tablist">
          {options.map((o) => (
            <button key={o.key} type="button" role="tab" aria-selected={o.key === current.key} className={o.key === current.key ? 'is-active' : ''} onClick={() => setTab(o.key)}>
              <JpIcon name={o.icon} size={14} /> {o.label}{o.key === platform && <span className="app-segmented-dot" title="Seu sistema" />}
            </button>
          ))}
        </div>
      )}
      <dl className="app-reqs">
        {parseRequirements(current.text).map((r, i) => (
          <div key={i} className="app-reqs-row">
            {r.label && <dt>{r.label}</dt>}
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function DetailsCard({ item, sizes, tech, base }) {
  const rows = [
    item.version && ['Versão', item.version],
    sizes.win && ['Download Windows', sizes.win],
    sizes.linux && ['Download Linux', sizes.linux],
    ['Atualizações', 'Automáticas pela aba Apps'],
    tech && ['Tecnologias', tech],
    base && ['Baseado em', base],
  ].filter(Boolean);
  return (
    <section className="app-side-card">
      <h3 className="app-side-title"><JpIcon name="info" size={16} /> Detalhes</h3>
      <dl className="app-facts">
        {rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>
    </section>
  );
}

function AppDetailView({ item, onBack, onOpenScreenshot }) {
  const state = useModuleState(item.moduleId);
  const { desktopReady, installed, updateAvailable, updateInfo, busy, error, uninstall } = state;
  const platform = currentPlatform();
  const sizes = sizesFor(item, platform);
  const { tagline, body, base } = splitDescription(item.description);
  const { features, tech } = parseFeatures(item.featuresText);
  const platformName = platform === 'linux' ? 'Linux' : 'Windows';
  const hasPlatformBuild = platform === 'linux' ? !!(item.sizeLabelLinux || item.requirementsLinux) : !!(item.sizeLabelWin || item.requirementsWin);

  return (
    <div className="app-detail-view" style={themeVars(item.moduleId)}>
      <div className="app-detail-inner">
        <button type="button" className="app-detail-back" onClick={onBack}><JpIcon name="back" size={16} /> Apps</button>

        <div className="app-detail-hero">
          {item.bannerUrl
            ? <img className="app-detail-hero-img" src={proxyImage(item.bannerUrl)} alt={item.name} />
            : <div className="app-detail-hero-fallback"><PageIcon name="grid" size={56} /></div>}
        </div>

        <header className="app-detail-head">
          <div className="app-detail-id">
            {item.iconUrl && <img className="app-detail-icon" src={proxyImage(item.iconUrl)} alt="" />}
            <div className="app-detail-id-text">
              <h1>{item.name}</h1>
              {tagline && <p className="app-detail-tagline">{tagline}</p>}
              <div className="app-detail-pills">
                {item.version && <span className="app-pill">v{item.version}</span>}
                {(item.sizeLabelWin || item.requirementsWin) && <span className="app-pill"><JpIcon name="windows" size={12} /> Windows</span>}
                {(item.sizeLabelLinux || item.requirementsLinux) && <span className="app-pill"><JpIcon name="linux" size={12} /> Linux</span>}
                {installed && !busy && <span className="app-pill is-ok"><JpIcon name="check" size={12} strokeWidth={3} /> Instalado</span>}
              </div>
            </div>
          </div>

          <div className="app-detail-cta">
            {!desktopReady ? (
              <div className="app-detail-cta-note">
                <strong>Instale pelo app para computador</strong>
                <span>Abra o Project Club no Windows ou no Linux para instalar este app.</span>
              </div>
            ) : !hasPlatformBuild ? (
              <div className="app-detail-cta-note">
                <strong>Indisponível no {platformName}</strong>
                <span>Este app ainda não tem versão para o seu sistema.</span>
              </div>
            ) : (
              <>
                <PrimaryAction state={state} size="lg" />
                <div className="app-detail-cta-sub">
                  {busy ? <span>Não feche o Project Club até terminar.</span>
                    : updateAvailable ? <span>Nova versão {updateInfo?.latest} disponível</span>
                    : installed ? <span>Pronto para usar no {platformName}</span>
                    : <span>{shortSize(sizes.current) ? `${shortSize(sizes.current)} · ` : ''}{platformName}</span>}
                  {installed && !busy && (
                    <button type="button" className="app-detail-uninstall" onClick={uninstall}><JpIcon name="trash" size={13} /> Desinstalar</button>
                  )}
                </div>
              </>
            )}
          </div>
        </header>

        {error && <div className="app-detail-error" role="alert"><JpIcon name="info" size={16} /> {error}</div>}

        <div className="app-detail-layout">
          <main className="app-detail-main">
            {body && (
              <section className="app-section">
                <h2 className="app-section-title"><JpIcon name="info" size={18} /> Sobre</h2>
                <p className="app-detail-about">{body}</p>
              </section>
            )}
            <ScreenshotGallery screenshots={item.screenshots} onOpen={onOpenScreenshot} />
            <FeaturesList features={features} />
          </main>
          <aside className="app-detail-side">
            <RequirementsCard item={item} platform={platform} />
            <DetailsCard item={item} sizes={sizes} tech={tech} base={base} />
            <p className="app-detail-trust"><JpIcon name="shield" size={14} /> App oficial do Project Club, de código aberto. Atualizações chegam só por aqui.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
