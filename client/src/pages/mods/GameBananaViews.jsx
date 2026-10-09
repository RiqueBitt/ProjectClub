import { useEffect, useState } from 'react';
import { browseGameBanana, getGameBananaMod } from '../../api/endpoints';
import { isDesktopModsAvailable, installModLocally, modFolderName } from '../../utils/mods';
import {
  Icon, formatCount, EmptyState, SkeletonGrid, SearchField, ChipRow, ModTile, LoadMore,
  ModDetailLayout, DetailStat, Section, ProgressBar, progressLabel, useModsManager, formatModDate,
} from './shared.jsx';

// ---------- GameBanana (aba "Explorar") ----------
// Item pedido: "GameBanana... sem precisar de login". API semi-oficial,
// sem chave nenhuma. Mods do GameBanana não têm uma convenção única de
// instalação (varia MUITO de jogo pra jogo — item pedido 26: "não criar
// uma regra universal") — por isso, além de "Instalar", cada arquivo
// também tem "Baixar" (link direto, a própria GameBanana serve o
// download) pra quem preferir extrair na mão.
const GAMEBANANA_SORT_OPTIONS = [
  { value: 'default', label: 'Em destaque' },
  { value: 'new', label: 'Novos' },
];

export function GameBananaBrowse({ game, onOpenMod }) {
  const desktopReady = isDesktopModsAvailable();
  const { installedFolders } = useModsManager();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('default');
  const [items, setItems] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    setItems(null);
    setLoadError('');
    setPage(1);
    const timeout = setTimeout(() => {
      browseGameBanana(game.gameBananaGameId, { q: query || undefined, sort, page: 1 })
        .then((d) => { setItems(d.items); setHasMore(!!d.hasMore); })
        .catch((err) => { setItems([]); setLoadError(err.response?.data?.error || 'Não foi possível buscar no GameBanana agora.'); });
    }, 250);
    return () => clearTimeout(timeout);
  }, [game.gameBananaGameId, query, sort]);

  // Item pedido: "adicione páginas em cada jogo para poder ver mais".
  const loadMoreItems = async () => {
    const nextPage = page + 1;
    setLoadingMore(true);
    try {
      const d = await browseGameBanana(game.gameBananaGameId, { q: query || undefined, sort, page: nextPage });
      setItems((prev) => [...prev, ...d.items]);
      setHasMore(!!d.hasMore);
      setPage(nextPage);
    } catch {
      setLoadError('Não foi possível carregar mais itens agora.');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <div className="mdx-toolbar">
        <SearchField value={query} onChange={setQuery} placeholder="Pesquisar no GameBanana..." />
        <ChipRow options={GAMEBANANA_SORT_OPTIONS} value={sort} onChange={setSort} label="Ordenar" />
      </div>

      {items === null ? (
        <SkeletonGrid count={8} />
      ) : items.length === 0 ? (
        <EmptyState icon={loadError ? 'alert' : 'search'} tone={loadError ? 'danger' : undefined} title={loadError ? 'Não foi possível buscar' : 'Nenhum item encontrado'}>
          {loadError || 'Tente outra busca.'}
        </EmptyState>
      ) : (
        <>
          <div className="mdx-mod-grid">
            {items.map((item) => (
              <ModTile
                key={item.id}
                thumb={item.thumbUrl}
                title={item.name}
                author={item.submitter ? `por ${item.submitter}` : null}
                installed={desktopReady && installedFolders.has(modFolderName(item.name))}
                stats={[
                  !!item.viewCount && { icon: 'eye', value: formatCount(item.viewCount) },
                  !!item.likeCount && { icon: 'heart', value: formatCount(item.likeCount) },
                ]}
                onClick={() => onOpenMod(item.id)}
              />
            ))}
          </div>
          {hasMore && <LoadMore busy={loadingMore} onClick={loadMoreItems} />}
        </>
      )}
    </>
  );
}

// Pacotes que o app desktop não sabe abrir (ver desktop/modArchive.js).
const UNSUPPORTED_ARCHIVE = /\.(rar|tar|gz|tgz|bz2|xz)$/i;

export function GameBananaModDetail({ game, modId, onBack }) {
  const desktopReady = isDesktopModsAvailable();
  const { installedFolders, trackInstall, untrackInstall, completeInstall, progressById } = useModsManager();
  const [data, setData] = useState(null);
  const [justInstalled, setJustInstalled] = useState(false);
  const [installingFileId, setInstallingFileId] = useState(null);
  const [installError, setInstallError] = useState('');

  useEffect(() => {
    getGameBananaMod(modId).then((d) => setData(d.mod)).catch(() => setData({ error: true }));
  }, [modId]);

  const progress = progressById[modId];
  useEffect(() => {
    if (progress?.phase === 'done') { setInstallingFileId(null); setJustInstalled(true); }
  }, [progress?.phase]);

  if (!data) return <div className="mdx-detail"><div className="mdx-skel mdx-skel-detail" /></div>;
  if (data.error) return (
    <div className="mdx-detail">
      <button type="button" className="mdx-back-link" onClick={onBack}><Icon name="back" size={16} /> Voltar para os mods</button>
      <EmptyState icon="alert" tone="danger" title="Não foi possível carregar este mod" />
    </div>
  );

  const installed = justInstalled || (desktopReady && installedFolders.has(modFolderName(data.name)));
  const installableFile = (data.files || []).find((f) => !UNSUPPORTED_ARCHIVE.test(f.filename || ''));

  // Item pedido: "faça o GameBanana... já baixa o mod na pasta do jogo
  // com o que precisa pra funcionar" — reaproveita o MESMO instalador do
  // mod.io (installModLocally → desktop/modsManager.js). Continua
  // oferecendo "Baixar" (alguns mods vêm em .rar/.7z, que ainda não
  // sabemos abrir sozinhos).
  const doInstallFile = async (file) => {
    if (!game?.installPath) { setInstallError('Não sabemos onde este jogo está instalado.'); return; }
    setInstallError('');
    setInstallingFileId(file.id);
    trackInstall(modId, data.name);
    try {
      const result = await installModLocally({
        downloadUrl: file.downloadUrl, filename: file.filename,
        gameInstallPath: game.installPath, modName: data.name, modioModId: modId,
        steamAppId: game.steamAppId, source: 'gamebanana', sourceId: modId,
      });
      if (!result.success) throw new Error(result.error || 'Falha desconhecida.');
      setJustInstalled(true);
      setInstallingFileId(null);
      completeInstall(modId);
    } catch (err) {
      setInstallError(err.message);
      setInstallingFileId(null);
      untrackInstall(modId);
    }
  };

  return (
    <ModDetailLayout
      onBack={onBack}
      backLabel="Voltar para os mods"
      thumb={data.thumbUrl}
      title={data.name}
      subtitle={data.submitter ? <>por <strong>{data.submitter}</strong></> : null}
      gallery={data.images}
      info={[
        { label: 'Última atualização', value: formatModDate(data.dateModified) },
        { label: 'Enviado originalmente', value: formatModDate(data.dateAdded) },
        { label: 'Enviado por', value: data.submitter, tone: 'accent' },
      ]}
      stats={(
        <>
          {installed && !installingFileId && <span className="mdx-installed-pill"><Icon name="check" size={13} strokeWidth={2.6} /> Instalado</span>}
          {!!data.viewCount && <DetailStat icon="eye">{formatCount(data.viewCount)} visualizações</DetailStat>}
          {!!data.likeCount && <DetailStat icon="heart">{formatCount(data.likeCount)}</DetailStat>}
        </>
      )}
      actions={(
        <>
          {installableFile && desktopReady && !installingFileId && (
            <button type="button" className={`mdx-btn ${installed ? 'ghost' : 'primary'} lg`} onClick={() => doInstallFile(installableFile)}>
              <Icon name={installed ? 'refresh' : 'download'} size={17} /> {installed ? 'Reinstalar' : 'Instalar'}
            </button>
          )}
          {installingFileId && (
            <div className="mdx-inline-progress">
              <span>{progressLabel(progress || { phase: 'downloading', percent: 0 })}</span>
              <ProgressBar percent={progress?.percent} indeterminate={progress && progress.phase !== 'downloading'} />
            </div>
          )}
          {data.profileUrl && (
            <a href={data.profileUrl} target="_blank" rel="noreferrer" className="mdx-btn ghost">
              <Icon name="external" size={15} /> Ver no GameBanana
            </a>
          )}
        </>
      )}
      notices={(
        <>
          {!desktopReady && <p className="mdx-note"><Icon name="monitor" size={15} /> Instalar direto na pasta do jogo só funciona pelo app de desktop — o "Baixar" de cada arquivo funciona em qualquer lugar.</p>}
          {desktopReady && data.files?.length > 0 && !installableFile && <p className="mdx-note warn"><Icon name="alert" size={15} /> Formato não suportado: este mod só tem arquivos .rar (ou parecidos), que o Project Club ainda não sabe abrir.</p>}
          {installError && <p className="mdx-error">Não foi possível instalar: {installError}</p>}
        </>
      )}
      main={(
        <>
          <Section title="Sobre" icon="info">
            {data.description ? <p className="mdx-desc">{data.description}</p> : <p className="mdx-muted">Sem descrição.</p>}
            {data.categories?.length > 0 && (
              <div className="mdx-tags">{data.categories.map((c) => <span key={c} className="mdx-tag">{c}</span>)}</div>
            )}
          </Section>
        </>
      )}
      side={data.files?.length > 0 && (
        <Section title="Arquivos" icon="box">
          <div className="mdx-file-list">
            {data.files.map((f) => (
              <div key={f.id} className="mdx-file-row">
                <div className="mdx-file-info">
                  <strong title={f.filename}>{f.filename}</strong>
                  {f.filesize ? <span className="mdx-muted">{(f.filesize / 1024 / 1024).toFixed(1)} MB</span> : null}
                </div>
                <div className="mdx-file-actions">
                  {desktopReady && installingFileId === f.id ? (
                    <span className="mdx-muted">{progressLabel(progress || { phase: 'downloading', percent: 0 })}</span>
                  ) : (
                    <>
                      {desktopReady && !UNSUPPORTED_ARCHIVE.test(f.filename || '') && (
                        <button type="button" className="mdx-btn primary sm" disabled={!!installingFileId} onClick={() => doInstallFile(f)}>
                          <Icon name="download" size={14} /> Instalar
                        </button>
                      )}
                      {desktopReady && UNSUPPORTED_ARCHIVE.test(f.filename || '') && <span className="mdx-compat bad"><span>Formato não suportado</span></span>}
                      {/* No app tudo instala por aqui; "Baixar" fica só no navegador. */}
                      {!desktopReady && <a href={f.downloadUrl} target="_blank" rel="noreferrer" className="mdx-btn ghost sm">Baixar</a>}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    />
  );
}
