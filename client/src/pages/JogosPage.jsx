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

// Item pedido: "melhore também essa aba de apps, adicione ícone,
// banner melhorando a interface tudo sendo configurado do painel da
// staff" — o catálogo (nome, descrição, banner, ícone, espaço
// necessário) agora vem do backend (ver server/src/controllers/
// appCatalogController.js), editável na aba "Apps" do painel da
// staff, em vez de uma lista fixa no código. moduleId em cada item
// ainda precisa bater com MODULES no desktop/projectMcManager.js —
// é o que liga "o card bonito que a staff configurou" com "o módulo
// que o Electron sabe instalar/abrir de verdade".
export default function JogosPage() {
  const [tab, setTab] = useState('games'); // 'games' | 'apps'
  const [catalog, setCatalog] = useState([]);
  // Item pedido: "clique no banner... abre outra aba... parecida com
  // a aba de downloads da Steam" — detailModuleId controla se estamos
  // vendo a grade principal (null) ou a tela de detalhe de um item
  // específico (o moduleId dele).
  const [detailModuleId, setDetailModuleId] = useState(null);
  // Item pedido: "ao clicar em uma screenshot, abra a imagem em
  // tamanho grande" — estado global da página (não da tela de
  // detalhe), pra sobrepor tudo, inclusive a barra de ação, sem outro
  // z-index pra gerenciar.
  const [lightboxUrl, setLightboxUrl] = useState(null);

  useEffect(() => {
    listAppCatalog().then((d) => setCatalog(d.items)).catch(() => {});
  }, []);

  const detailItem = catalog.find((c) => c.moduleId === detailModuleId);

  if (detailItem) {
    return (
      <>
        <AppDetailView item={detailItem} onBack={() => setDetailModuleId(null)} onOpenScreenshot={setLightboxUrl} />
        {lightboxUrl && <ScreenshotLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
      </>
    );
  }

  return (
    <div className="jogos-page">
      <div className="jogos-page-header">
        <h1>Apps</h1>
        <p className="dim">Módulos opcionais que rodam dentro da instalação do Project Club — instale só o que você usa.</p>
      </div>

      <div className="jogos-page-tabs">
        <button type="button" className={`jogos-page-tab ${tab === 'games' ? 'active' : ''}`} onClick={() => setTab('games')}>Jogos</button>
        <button type="button" className={`jogos-page-tab ${tab === 'apps' ? 'active' : ''}`} onClick={() => setTab('apps')}>Aplicativos</button>
      </div>

      {tab === 'games' && (
        catalog.length === 0 ? (
          <div className="jogos-page-empty">
            <span className="jogos-page-empty-icon">🧩</span>
            <p>Nenhum módulo disponível ainda — a staff pode adicionar um no painel administrativo.</p>
          </div>
        ) : (
          <div className="jogos-page-grid">
            {catalog.map((item) => (
              <ModuleCard key={item.moduleId} item={item} onOpenDetail={() => setDetailModuleId(item.moduleId)} />
            ))}
          </div>
        )
      )}

      {tab === 'apps' && (
        <div className="jogos-page-empty">
          <span className="jogos-page-empty-icon">🧩</span>
          <p>Nenhum aplicativo disponível ainda — esta aba já está pronta para receber os próximos módulos.</p>
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
// hora, sem precisar entrar em mais nada).
function ModuleCard({ item, onOpenDetail }) {
  const { desktopReady, installed, busy, progress, open } = useModuleState(item.moduleId);

  const onQuickAction = (e) => {
    e.stopPropagation();
    if (installed && !busy) open();
    else onOpenDetail();
  };

  return (
    <div className="app-card" onClick={onOpenDetail} role="button" tabIndex={0}>
      <div className="app-card-banner" style={item.bannerUrl ? { backgroundImage: `url(${proxyImage(item.bannerUrl)})` } : undefined}>
        {!item.bannerUrl && <span className="app-card-banner-fallback">🧩</span>}
        <div className="app-card-banner-gradient" />
        {item.version && <span className="app-card-version-badge">v{item.version}</span>}
        <div className="app-card-title-row">
          {item.iconUrl && <img className="app-card-icon" src={proxyImage(item.iconUrl)} alt="" />}
          <span className="app-card-name">{item.name}</span>
        </div>
        {desktopReady && (
          <button
            type="button"
            className={`app-card-quick-btn ${installed ? 'is-play' : 'is-download'}`}
            onClick={onQuickAction}
            title={installed ? 'Jogar' : 'Baixar'}
            aria-label={installed ? 'Jogar' : 'Baixar'}
          >
            {installed ? '▶' : '⬇'}
          </button>
        )}
      </div>
      {item.description && <p className="app-card-description">{item.description}</p>}
      {!desktopReady && <p className="app-card-hint dim">Disponível apenas no app de desktop do Project Club.</p>}
      {desktopReady && busy && progress && (
        <div className="app-card-progress"><div style={{ width: `${progress.percent}%` }} /></div>
      )}
    </div>
  );
}

// Item pedido: "adicione uma seção de screenshots... ao clicar em uma
// screenshot, abra a imagem em tamanho grande" — carrossel simples de
// miniaturas; cada uma abre o lightbox (ver ScreenshotLightbox) por
// cima de tudo.
function ScreenshotGallery({ screenshots, onOpen }) {
  if (!screenshots?.length) return null;
  return (
    <div className="app-detail-screenshots">
      <h3>Screenshots</h3>
      <div className="app-detail-screenshots-row">
        {screenshots.map((s) => (
          <button key={s.id} type="button" className="app-detail-screenshot-thumb" onClick={() => onOpen(proxyImage(s.imageUrl))}>
            <img src={proxyImage(s.imageUrl)} alt="" />
          </button>
        ))}
      </div>
    </div>
  );
}

// Item pedido: "ao clicar fora da imagem, feche a visualização" —
// fundo escuro clicável fecha; a própria imagem tem stopPropagation
// pra não fechar clicando nela sem querer.
function ScreenshotLightbox({ url, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="screenshot-lightbox" onClick={onClose}>
      <img src={url} alt="" onClick={(e) => e.stopPropagation()} />
      <button type="button" className="screenshot-lightbox-close" onClick={onClose} aria-label="Fechar">×</button>
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
      return (
        <div className="app-detail-progress">
          <div className="app-detail-progress-label dim">
            {progress.phase === 'downloading' ? `Baixando... ${progress.percent}%` : progress.phase === 'extracting' ? 'Extraindo arquivos...' : 'Concluindo instalação...'}
          </div>
          <div className="app-detail-progress-bar"><div style={{ width: `${progress.percent}%` }} /></div>
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
