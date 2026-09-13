import { useEffect, useState } from 'react';
import {
  isProjectMcAvailable, getProjectMcStatus, checkProjectMcUpdate,
  installProjectMc, launchProjectMc, uninstallProjectMc, onProjectMcProgress,
} from '../utils/projectMc';
import { listAppCatalog } from '../api/endpoints';
import { proxyImage } from '../utils/imageProxy';
import '../styles/jogos-page.css';

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
        <span className="jogos-page-header-icon">🧩</span>
        <div className="jogos-page-header-text">
          <h1>Apps</h1>
          <p className="dim">Módulos opcionais que rodam dentro da instalação do Project Club — instale só o que você usa.</p>
        </div>
        {catalog && catalog.length > 0 && (
          <span className="jogos-page-header-count">{catalog.length} {catalog.length === 1 ? 'app disponível' : 'apps disponíveis'}</span>
        )}
      </div>

      {catalog === null ? (
        // Item pedido: "melhore as partes vazias da tela" — enquanto
        // carrega, cards-esqueleto no lugar de uma tela em branco.
        <div className="jogos-page-grid">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="app-card-skeleton" />)}
        </div>
      ) : catalog.length === 0 ? (
        <div className="jogos-page-empty">
          <span className="jogos-page-empty-icon">🧩</span>
          <h3>Nenhum app disponível ainda</h3>
          <p>A staff pode adicionar novos módulos a qualquer momento pelo painel administrativo.</p>
        </div>
      ) : (
        <div className="jogos-page-grid">
          {catalog.map((item) => (
            <ModuleCard key={item.moduleId} item={item} onOpenDetail={() => setDetailModuleId(item.moduleId)} />
          ))}
        </div>
      )}
    </div>
  );
}

// Hook compartilhado entre o card da grade e a tela de detalhe — status
// de instalação, progresso, e as 3 ações (instalar, abrir, desinstalar)
// vivem aqui pra não duplicar essa lógica nos dois lugares que precisam
// dela.
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
    checkProjectMcUpdate(moduleId).then((d) => (d.error ? setError(d.error) : setUpdateInfo(d))).catch((err) => setError(err.message));
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

  // Item pedido: "mude o botão de reinstalar para Desinstalar aí apaga
  // o arquivo, não quero isso de reinstalar" — antes desinstalava E
  // reinstalava em seguida (recuperação de instalação corrompida);
  // agora só apaga mesmo, sem nenhum download de volta. Quem quiser
  // instalar de novo usa o botão "Instalar" normal, que já aparece
  // sozinho depois que installed vira false.
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

// Item pedido: "a imagem quando abrir a aba apps vai mostrar o banner
// com o botão de download, se tiver baixado vai mostrar um botão
// verde com a icon de play... clique no banner e em outro lugar não
// sendo a caixinha de play aí abre a outra aba" — card inteiro é
// clicável e sempre abre o detalhe (estilo Steam); só a caixinha no
// canto tem ação PRÓPRIA e direta: baixar (não instalado, entra no
// detalhe pra acompanhar o progresso) ou jogar (instalado, abre na
// hora). Item pedido: "melhore quando tiver fazendo o download" — o
// botão de ação vira o próprio indicador de porcentagem enquanto
// baixa, em vez de só a barrinha fina embaixo.
function ModuleCard({ item, onOpenDetail }) {
  const { desktopReady, installed, updateAvailable, busy, progress, open } = useModuleState(item.moduleId);

  const onQuickAction = (e) => {
    e.stopPropagation();
    if (installed && !busy) open();
    else if (!busy) onOpenDetail();
  };

  return (
    <div className="app-card" onClick={onOpenDetail} role="button" tabIndex={0}>
      <div className="app-card-banner" style={item.bannerUrl ? { backgroundImage: `url(${proxyImage(item.bannerUrl)})` } : undefined}>
        {!item.bannerUrl && <span className="app-card-banner-fallback">🧩</span>}
        <div className="app-card-banner-gradient" />
        <div className="app-card-badges">
          {item.version && <span className="app-card-version-badge">v{item.version}</span>}
          {installed && !busy && updateAvailable && <span className="app-card-update-badge">Atualização</span>}
        </div>
        <div className="app-card-title-row">
          {item.iconUrl && <img className="app-card-icon" src={proxyImage(item.iconUrl)} alt="" />}
          <span className="app-card-name">{item.name}</span>
        </div>
        {desktopReady && (
          <button
            type="button"
            className={`app-card-quick-btn ${installed ? 'is-play' : 'is-download'} ${busy ? 'is-busy' : ''}`}
            onClick={onQuickAction}
            title={busy ? 'Baixando...' : installed ? 'Jogar' : 'Baixar'}
            aria-label={busy ? 'Baixando' : installed ? 'Jogar' : 'Baixar'}
          >
            {busy && progress ? <span className="app-card-quick-btn-percent">{progress.percent}%</span> : installed ? '▶' : '⬇'}
          </button>
        )}
      </div>
      {item.description && <p className="app-card-description">{item.description}</p>}
      {!desktopReady && <p className="app-card-hint dim">Disponível apenas no app de desktop do Project Club.</p>}
      {desktopReady && installed && !busy && (
        <div className="app-card-installed-tag">✓ Instalado</div>
      )}
      {desktopReady && busy && progress && (
        <div className="app-card-progress">
          <div className="app-card-progress-fill" style={{ width: `${progress.percent}%` }} />
        </div>
      )}
    </div>
  );
}

// Item pedido: "melhore o menu das screenshots do app, deixa mais no
// pc e mais bonito e organizado" — grade responsiva (mais colunas em
// telas largas de PC) em vez da fileira que precisava arrastar de
// lado pra ver tudo; sem rolagem horizontal em lugar nenhum.
function ScreenshotGallery({ screenshots, onOpen }) {
  if (!screenshots?.length) return null;
  return (
    <div className="app-detail-screenshots">
      <h3>Screenshots <span className="app-detail-screenshots-count dim">{screenshots.length}</span></h3>
      <div className="app-detail-screenshots-grid">
        {screenshots.map((s, i) => (
          <button key={s.id} type="button" className="app-detail-screenshot-thumb" onClick={() => onOpen(i)}>
            <img src={proxyImage(s.imageUrl)} alt="" loading="lazy" />
            <span className="app-detail-screenshot-thumb-zoom">🔍</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Item pedido: "ao clicar fora da imagem, feche a visualização" —
// fundo escuro clicável fecha; a própria imagem tem stopPropagation
// pra não fechar clicando nela sem querer. Agora com setas pra
// navegar entre as screenshots sem precisar fechar e abrir de novo.
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
    <div className="screenshot-lightbox" onClick={onClose}>
      <button type="button" className="screenshot-lightbox-close" onClick={onClose} aria-label="Fechar">×</button>
      {total > 1 && (
        <button type="button" className="screenshot-lightbox-nav screenshot-lightbox-prev" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label="Anterior">‹</button>
      )}
      <img src={proxyImage(current.imageUrl)} alt="" onClick={(e) => e.stopPropagation()} />
      {total > 1 && (
        <button type="button" className="screenshot-lightbox-nav screenshot-lightbox-next" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label="Próxima">›</button>
      )}
      {total > 1 && <div className="screenshot-lightbox-counter">{index + 1} / {total}</div>}
    </div>
  );
}

// Item pedido: "adicione mais informações sobre cada app, como...
// recursos principais" — featuresText é texto livre (um recurso por
// linha, configurado pela staff); linhas vazias são ignoradas.
function FeaturesList({ featuresText }) {
  const features = (featuresText || '').split('\n').map((f) => f.trim()).filter(Boolean);
  if (!features.length) return null;
  return (
    <div className="app-detail-features">
      <h3>Recursos principais</h3>
      <ul>{features.map((f, i) => <li key={i}>{f}</li>)}</ul>
    </div>
  );
}

// Item pedido: "separe claramente os downloads para Windows e Linux,
// já que os dois sistemas possuem formatos e requisitos diferentes" —
// duas seções lado a lado, cada uma com seu próprio tamanho e
// requisitos; a que bate com a plataforma que o app desktop já está
// rodando ganha destaque visual e é a única com um botão que faz
// algo de verdade (a outra plataforma não tem como instalar daqui,
// já que window.electronAPI só existe pra a que já está rodando).
function PlatformSection({ platformKey, label, sizeLabel, requirements, isCurrent, children }) {
  return (
    <div className={`app-detail-platform ${isCurrent ? 'is-current' : ''}`}>
      <div className="app-detail-platform-header">
        <span className="app-detail-platform-name">{label}</span>
        {isCurrent && <span className="app-detail-platform-tag">Seu sistema</span>}
      </div>
      {sizeLabel && <div className="app-detail-platform-row"><span className="dim">Espaço necessário</span><strong>{sizeLabel}</strong></div>}
      {requirements && <div className="app-detail-platform-row app-detail-platform-requirements"><span className="dim">Requisitos</span><span>{requirements}</span></div>}
      <div className="app-detail-platform-actions">{children}</div>
    </div>
  );
}

// Item pedido: "clique no botão download vai abrir outra aba que é
// parecida com a outra foto que te mandei (a página do jogo na Steam)
// mostra do download etc, aí quando baixar vai mostrar um botão
// Jogar" — banner grande, "espaço necessário" configurado pela staff,
// progresso durante o download, Jogar + Desinstalar depois de pronto.
// Item pedido: "melhore quando tiver fazendo o download de algum
// app" — barra de progresso com fase nomeada + porcentagem grande em
// destaque, em vez de só um texto pequeno acima da barra.
function AppDetailView({ item, onBack, onOpenScreenshot }) {
  const { desktopReady, installed, updateAvailable, updateInfo, busy, progress, error, install, open, uninstall } = useModuleState(item.moduleId);
  const platform = currentPlatform();

  const sizeWin = item.sizeLabelWin || (platform !== 'linux' ? item.sizeLabel : null);
  const sizeLinux = item.sizeLabelLinux || (platform === 'linux' ? item.sizeLabel : null);

  const renderActions = (forPlatform) => {
    if (!desktopReady || platform !== forPlatform) {
      return <p className="dim app-detail-platform-hint">Abra o Project Club nesse sistema pra instalar por aqui.</p>;
    }
    if (busy && progress) {
      const phaseLabel = progress.phase === 'downloading' ? 'Baixando' : progress.phase === 'extracting' ? 'Extraindo arquivos' : 'Concluindo instalação';
      return (
        <div className="app-detail-progress">
          <div className="app-detail-progress-top">
            <span className="app-detail-progress-label">{phaseLabel}...</span>
            <span className="app-detail-progress-percent">{progress.percent}%</span>
          </div>
          <div className="app-detail-progress-bar"><div className="app-detail-progress-bar-fill" style={{ width: `${progress.percent}%` }} /></div>
        </div>
      );
    }
    if (installed) {
      return (
        <div className="app-detail-installed-row">
          <button type="button" className="btn-play app-detail-play-btn" onClick={open}>▶ Jogar</button>
          {updateAvailable && <button type="button" className="btn-primary" onClick={install}>Atualizar para {updateInfo.latest}</button>}
          <button type="button" className="btn-danger-outline" onClick={uninstall}>Desinstalar</button>
        </div>
      );
    }
    return <button type="button" className="btn-primary app-detail-install-btn" onClick={install}>⬇ Instalar</button>;
  };

  return (
    <div className="app-detail-view">
      <button type="button" className="app-detail-back" onClick={onBack}>‹ Voltar para Apps</button>

      <div className="app-detail-banner" style={item.bannerUrl ? { backgroundImage: `url(${proxyImage(item.bannerUrl)})` } : undefined}>
        {!item.bannerUrl && <span className="app-detail-banner-fallback">🧩</span>}
        <div className="app-detail-banner-gradient" />
        <div className="app-detail-title-row">
          {item.iconUrl && <img className="app-detail-icon" src={proxyImage(item.iconUrl)} alt="" />}
          <div>
            <h1>{item.name}</h1>
            {item.version && <span className="app-detail-version">Versão {item.version}</span>}
          </div>
        </div>
      </div>

      {error && <p className="app-detail-error app-detail-error-top">{error}</p>}

      <div className="app-detail-platforms">
        <PlatformSection platformKey="win32" label="Windows" sizeLabel={sizeWin} requirements={item.requirementsWin} isCurrent={platform === 'win32'}>
          {renderActions('win32')}
        </PlatformSection>
        <PlatformSection platformKey="linux" label="Linux" sizeLabel={sizeLinux} requirements={item.requirementsLinux} isCurrent={platform === 'linux'}>
          {renderActions('linux')}
        </PlatformSection>
      </div>

      {!desktopReady && <p className="dim app-detail-web-hint">Baixe e abra o app de desktop do Project Club (Windows ou Linux) pra instalar aplicativos.</p>}

      <div className="app-detail-body">
        {item.description && <p className="app-detail-description">{item.description}</p>}
        <FeaturesList featuresText={item.featuresText} />
        <ScreenshotGallery screenshots={item.screenshots} onOpen={onOpenScreenshot} />
      </div>
    </div>
  );
}
