import { useCallback, useEffect, useState } from 'react';
import { getNexusMod, getNexusDownload } from '../../api/endpoints';
import { isDesktopModsAvailable, installModLocally, modFolderName, onModsProgress } from '../../utils/mods';
import {
  Icon, formatCount, EmptyState, ModDetailLayout, formatModDate, DetailStat, Section, ProgressBar, progressLabel, useModsManager,
} from './shared.jsx';
import { formatBytes } from './unifiedApi.js';
import { proxyImage } from '../../utils/imageProxy';

// ---------- Nexus Mods (a fonte do Vortex) ----------
// Item pedido: "adicione a API de mods e o Vortex". A busca vem junto
// com as outras fontes (Explorar). Aqui ficam: a página do mod, a
// instalação de um arquivo e o recebimento dos links nxm:// (botão
// "Mod Manager Download" do site — o mesmo que abre o Vortex).

const UNSUPPORTED_ARCHIVE = /\.(rar|tar|gz|tgz|bz2|xz|exe|msi)$/i;

export function nexusIds(sourceId) {
  const [domain, id] = String(sourceId || '').split(':');
  return { domain, modId: Number(id) };
}

// Links da CDN da Nexus às vezes vêm com espaço no nome do arquivo.
const safeUrl = (u) => (/\s/.test(u) ? encodeURI(u) : u);

// Baixa (link do servidor) e instala um arquivo. Conta grátis sem link
// nxm:// → erro com needsManager + managerUrl pra mandar pro site.
export async function installNexusFile({ game, domain, modId, file, modName, key, expires }) {
  if (!game?.installPath) throw new Error('Não sabemos onde este jogo está instalado.');
  let link;
  try {
    link = await getNexusDownload(domain, modId, file.id, { key, expires });
  } catch (err) {
    const data = err.response?.data || {};
    const e = new Error(data.error || 'A Nexus Mods não liberou o download agora.');
    e.needsManager = !!data.needsManager;
    e.managerUrl = data.managerUrl || null;
    throw e;
  }
  const result = await installModLocally({
    downloadUrl: safeUrl(link.url), filename: file.filename || `${modName}.zip`,
    gameInstallPath: game.installPath, modName, modioModId: modId,
    steamAppId: game.steamAppId, source: 'nexus', sourceId: `${domain}:${modId}`, version: file.version || undefined,
  });
  if (!result.success) throw new Error(result.error || 'Falha desconhecida.');
  return result;
}

function openExternal(url) {
  if (window.electronAPI?.openExternal) window.electronAPI.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

// Liga/desliga o Project Club como quem abre os links nxm:// (no lugar
// do Vortex). Só aparece no app desktop novo (que tem essa ponte).
export function NexusLinkToggle() {
  const bridge = window.electronAPI?.nexus;
  const [enabled, setEnabled] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    bridge.getLinkHandler().then((r) => setEnabled(!!r?.enabled)).catch(() => setEnabled(false));
  }, [bridge]);
  if (!bridge || enabled === null) return null;
  const toggle = async () => {
    setBusy(true);
    try { const r = await bridge.setLinkHandler(!enabled); setEnabled(!!r?.enabled); } finally { setBusy(false); }
  };
  return (
    <div className="mdx-nexus-toggle">
      <span className="mdx-nexus-toggle-icon"><Icon name="link" size={17} /></span>
      <div className="mdx-nexus-toggle-text">
        <strong>Downloads da Nexus Mods pelo Project Club</strong>
        <span>{enabled
          ? 'O botão "Mod Manager Download" do site abre aqui e instala direto no jogo.'
          : 'Hoje o botão "Mod Manager Download" do site abre o Vortex (ou nada). Ligue pra instalar pelo Project Club.'}</span>
      </div>
      <button type="button" className={`mdx-switch ${enabled ? 'on' : ''}`} role="switch" aria-checked={enabled} disabled={busy} onClick={toggle}>
        <span />
      </button>
    </div>
  );
}

export function NexusModDetail({ game, domain, modId, onBack }) {
  const desktopReady = isDesktopModsAvailable();
  const { installedFolders, trackInstall, untrackInstall, completeInstall, progressById } = useModsManager();
  const [data, setData] = useState(null);
  const [justInstalled, setJustInstalled] = useState(false);
  const [installingFileId, setInstallingFileId] = useState(null);
  const [installError, setInstallError] = useState(null);

  useEffect(() => {
    setData(null);
    getNexusMod(domain, modId).then((d) => setData(d.mod)).catch((err) => setData({ error: err.response?.data?.error || true }));
  }, [domain, modId]);

  const progress = progressById[modId];

  if (!data) return <div className="mdx-detail"><div className="mdx-skel mdx-skel-detail" /></div>;
  if (data.error) return (
    <div className="mdx-detail">
      <button type="button" className="mdx-back-link" onClick={onBack}><Icon name="back" size={16} /> Voltar para os mods</button>
      <EmptyState icon="alert" tone="danger" title="Não foi possível carregar este mod">{typeof data.error === 'string' ? data.error : null}</EmptyState>
    </div>
  );

  const installed = justInstalled || (desktopReady && installedFolders.has(modFolderName(data.name)));
  const installable = (data.files || []).filter((f) => !UNSUPPORTED_ARCHIVE.test(f.filename || ''));
  const mainFile = installable.find((f) => f.primary) || installable.find((f) => f.category === 'MAIN') || installable[0];

  const doInstall = async (file) => {
    setInstallError(null);
    setInstallingFileId(file.id);
    trackInstall(modId, data.name);
    try {
      await installNexusFile({ game, domain, modId, file, modName: data.name });
      setJustInstalled(true);
      completeInstall(modId);
    } catch (err) {
      untrackInstall(modId);
      setInstallError({ text: err.message, managerUrl: err.managerUrl });
    } finally {
      setInstallingFileId(null);
    }
  };

  return (
    <ModDetailLayout
      onBack={onBack}
      backLabel="Voltar para os mods"
      thumb={data.thumbUrl}
      title={data.name}
      subtitle={data.author ? <>por <strong>{data.author}</strong>{data.version ? <> · v{data.version}</> : null}</> : null}
      gallery={data.images}
      info={[
        { label: 'Última atualização', value: formatModDate(data.updatedAt) },
        { label: 'Enviado originalmente', value: formatModDate(data.createdAt) },
        { label: 'Criado por', value: data.creator },
        { label: 'Enviado por', value: data.uploadedBy, tone: 'accent' },
        data.virusScan && { label: 'Verificação de vírus', value: data.virusScan.safe ? 'Seguro para usar' : data.virusScan.danger ? 'Arquivo em quarentena' : 'Ainda não verificado', tone: data.virusScan.safe ? 'ok' : data.virusScan.danger ? 'bad' : undefined },
      ]}
      stats={(
        <>
          {installed && !installingFileId && <span className="mdx-installed-pill"><Icon name="check" size={13} strokeWidth={2.6} /> Instalado</span>}
          <DetailStat icon="download">{formatCount(data.downloads)} downloads</DetailStat>
          <DetailStat icon="thumb">{formatCount(data.endorsements)} recomendações</DetailStat>
        </>
      )}
      actions={(
        <>
          {mainFile && desktopReady && !installingFileId && (
            <button type="button" className={`mdx-btn ${installed ? 'ghost' : 'primary'} lg`} onClick={() => doInstall(mainFile)}>
              <Icon name={installed ? 'refresh' : 'download'} size={17} /> {installed ? 'Reinstalar' : 'Instalar'}
            </button>
          )}
          {installingFileId && (
            <div className="mdx-inline-progress">
              <span>{progressLabel(progress || { phase: 'downloading', percent: 0 })}</span>
              <ProgressBar percent={progress?.percent} indeterminate={progress && progress.phase !== 'downloading'} />
            </div>
          )}
          <button type="button" className="mdx-btn ghost" onClick={() => openExternal(data.pageUrl)}>
            <Icon name="external" size={15} /> Ver na Nexus Mods
          </button>
        </>
      )}
      notices={(
        <>
          {!desktopReady && <p className="mdx-note"><Icon name="monitor" size={15} /> Instalar direto na pasta do jogo só funciona pelo app de desktop.</p>}
          {!data.available && <p className="mdx-note warn"><Icon name="alert" size={15} /> Este mod está oculto ou foi removido pelo autor.</p>}
          {desktopReady && data.files?.length > 0 && installable.length === 0 && <p className="mdx-note warn"><Icon name="alert" size={15} /> Formato não suportado: os arquivos deste mod são .rar/.exe, que o Project Club ainda não sabe instalar.</p>}
          {installError && (
            <div className="mdx-note warn mdx-nexus-manager-note">
              <Icon name="alert" size={15} />
              <span>
                {installError.text}
                {installError.managerUrl && <> Abra a página, clique em <strong>Mod Manager Download</strong> e o Project Club instala sozinho (ligue “Downloads da Nexus Mods pelo Project Club” no álbum de jogos).</>}
              </span>
              {installError.managerUrl && (
                <button type="button" className="mdx-btn primary sm" onClick={() => openExternal(installError.managerUrl)}>
                  <Icon name="external" size={14} /> Abrir na Nexus
                </button>
              )}
            </div>
          )}
        </>
      )}
      main={(
        <Section title="Sobre" icon="info">
          {data.summary && <p className="mdx-desc"><strong>{data.summary}</strong></p>}
          {data.description ? <p className="mdx-desc">{data.description}</p> : <p className="mdx-muted">Sem descrição.</p>}
        </Section>
      )}
      side={data.files?.length > 0 && (
        <Section title="Arquivos" icon="box">
          <div className="mdx-file-list">
            {data.files.map((f) => {
              const bad = UNSUPPORTED_ARCHIVE.test(f.filename || '');
              return (
                <div key={f.id} className="mdx-file-row">
                  <div className="mdx-file-info">
                    <strong title={f.filename}>{f.name || f.filename}</strong>
                    <span className="mdx-muted">
                      {[f.category === 'MAIN' ? 'Principal' : f.category === 'OPTIONAL' ? 'Opcional' : f.category === 'UPDATE' ? 'Atualização' : f.category === 'MISCELLANEOUS' ? 'Extra' : f.category === 'OLD_VERSION' ? 'Versão antiga' : null,
                        f.version && `v${f.version}`, f.size && formatBytes(f.size)].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <div className="mdx-file-actions">
                    {installingFileId === f.id ? (
                      <span className="mdx-muted">{progressLabel(progress || { phase: 'downloading', percent: 0 })}</span>
                    ) : bad ? (
                      <span className="mdx-compat bad"><span>Formato não suportado</span></span>
                    ) : desktopReady ? (
                      <button type="button" className="mdx-btn primary sm" disabled={!!installingFileId} onClick={() => doInstall(f)}>
                        <Icon name="download" size={14} /> Instalar
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    />
  );
}

// ---------- Links nxm:// (Mod Manager Download) ----------
// Fica no ModsPage: recebe o link do app desktop, acha o jogo no álbum
// pelo domínio da Nexus e instala com a chave temporária do link.
export function NxmLinkHandler({ games, loading }) {
  const bridge = window.electronAPI?.nexus;
  const [queue, setQueue] = useState([]);
  const [job, setJob] = useState(null); // { link, game, mod, file, status, error, percent }

  useEffect(() => {
    if (!bridge) return undefined;
    const push = (link) => link && setQueue((q) => [...q, link]);
    bridge.consumePending?.().then((links) => (links || []).forEach(push)).catch(() => {});
    return bridge.onLink?.(push);
  }, [bridge]);

  useEffect(() => onModsProgress((p) => {
    setJob((j) => (j && j.status === 'installing' && p?.modioModId === j.link.modId ? { ...j, progress: p } : j));
  }), []);

  const run = useCallback(async (link) => {
    const game = games.find((g) => g.sources?.nexus?.nexusDomain === link.domain);
    if (!game) { setJob({ link, status: 'error', error: 'Esse jogo não foi encontrado no seu PC (ou não está na Nexus Mods pelo Project Club).' }); return; }
    setJob({ link, game, status: 'loading' });
    try {
      const { mod } = await getNexusMod(link.domain, link.modId);
      const file = (mod.files || []).find((f) => f.id === link.fileId) || { id: link.fileId, filename: null };
      setJob({ link, game, mod, file, status: 'installing' });
      await installNexusFile({ game, domain: link.domain, modId: link.modId, file, modName: mod.name, key: link.key, expires: link.expires });
      setJob({ link, game, mod, file, status: 'done' });
    } catch (err) {
      setJob((j) => ({ ...j, status: 'error', error: err.message }));
    }
  }, [games]);

  useEffect(() => {
    if (loading || queue.length === 0) return;
    if (job && (job.status === 'loading' || job.status === 'installing')) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    run(next);
  }, [queue, loading, job, run]);

  if (!job) return null;
  const busy = job.status === 'loading' || job.status === 'installing';
  return (
    <div className="mdx-nxm-toast" role="status">
      <div className="mdx-nxm-thumb">
        {job.mod?.thumbUrl ? <img src={proxyImage(job.mod.thumbUrl)} alt="" /> : <Icon name="download" size={20} />}
      </div>
      <div className="mdx-nxm-body">
        <span className="mdx-nxm-kicker">Nexus Mods{job.game ? ` · ${job.game.displayName}` : ''}</span>
        <strong>{job.mod?.name || 'Preparando download…'}</strong>
        {busy && (
          <>
            <span className="mdx-muted">{job.status === 'loading' ? 'Buscando o arquivo…' : progressLabel(job.progress || { phase: 'downloading', percent: 0 })}</span>
            <ProgressBar percent={job.progress?.percent} indeterminate={!job.progress || job.progress.phase !== 'downloading'} />
          </>
        )}
        {job.status === 'done' && <span className="mdx-nxm-ok"><Icon name="check" size={13} strokeWidth={2.6} /> Instalado no jogo</span>}
        {job.status === 'error' && <span className="mdx-error">{job.error}</span>}
      </div>
      {!busy && (
        <button type="button" className="mdx-icon-btn" aria-label="Fechar" onClick={() => setJob(null)}>
          <Icon name="close" size={16} />
        </button>
      )}
    </div>
  );
}
