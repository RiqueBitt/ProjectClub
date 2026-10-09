import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  getModioGameTags, listMods, getMod, getModDownload,
  toggleModFavorite, toggleModUp, listModComments, addModComment, reportMod,
  listModProfiles, upsertModProfileItem, listModCollections, addModCollectionItem,
} from '../../api/endpoints';
import { isDesktopModsAvailable, installModLocally, modFolderName } from '../../utils/mods';
import {
  Icon, formatCount, EmptyState, SkeletonGrid, SearchField, ChipRow, ModTile, LoadMore,
  ModDetailLayout, DetailStat, Section, ProgressBar, progressLabel, useModsManager, formatModDate,
} from './shared.jsx';

// ---------- mod.io: lista de mods (aba "Explorar") ----------
const SORT_OPTIONS = [
  { value: 'popular', label: 'Populares' },
  { value: 'downloads', label: 'Mais baixados' },
  { value: 'rating', label: 'Melhor avaliados' },
  { value: 'new', label: 'Novos' },
  { value: 'updated', label: 'Atualizados' },
];

export function ModioBrowse({ game, onOpenMod }) {
  const { installedFolders } = useModsManager();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('popular');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState([]);
  const [mods, setMods] = useState(null);
  const [resultTotal, setResultTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    getModioGameTags(game.modioGameId).then((d) => {
      // A API devolve grupos de tags (ex: categoria "Categoria" com
      // opções Gameplay/Gráficos/Mapas/...) — achata pro primeiro grupo
      // pra um filtro simples de categoria (item pedido 10).
      const firstGroup = d.tags?.[0];
      setTags(firstGroup?.tags || []);
    }).catch(() => setTags([]));
  }, [game.modioGameId]);

  useEffect(() => {
    setMods(null);
    setLoadError('');
    const timeout = setTimeout(() => {
      listMods(game.modioGameId, { q: query || undefined, sort, category: category || undefined, offset: 0 })
        .then((d) => { setMods(d.mods); setResultTotal(d.resultTotal); })
        .catch((err) => { setMods([]); setLoadError(err.response?.data?.error || 'Não foi possível buscar mods agora.'); });
    }, 250); // pequeno debounce pra não disparar uma busca a cada tecla
    return () => clearTimeout(timeout);
  }, [game.modioGameId, query, sort, category]);

  // Item pedido: "adicione páginas em cada jogo para poder ver mais" —
  // "carregar mais" no final da grade em vez de páginas numeradas.
  const loadMoreMods = async () => {
    setLoadingMore(true);
    try {
      const d = await listMods(game.modioGameId, { q: query || undefined, sort, category: category || undefined, offset: mods.length });
      setMods((prev) => [...prev, ...d.mods]);
      setResultTotal(d.resultTotal);
    } catch {
      setLoadError('Não foi possível carregar mais mods agora.');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <div className="mdx-toolbar">
        <SearchField value={query} onChange={setQuery} placeholder="Pesquisar mods ou criadores..." />
        <ChipRow options={SORT_OPTIONS} value={sort} onChange={setSort} label="Ordenar" />
      </div>
      {tags.length > 0 && (
        <ChipRow
          label="Categoria"
          options={[{ value: '', label: 'Todas categorias' }, ...tags.map((t) => ({ value: t.name, label: t.name }))]}
          value={category}
          onChange={setCategory}
        />
      )}
      {mods !== null && mods.length > 0 && (
        <p className="mdx-result-count">{resultTotal} {resultTotal === 1 ? 'mod disponível' : 'mods disponíveis'}</p>
      )}

      {mods === null ? (
        <SkeletonGrid count={8} />
      ) : mods.length === 0 ? (
        <EmptyState icon={loadError ? 'alert' : 'search'} tone={loadError ? 'danger' : undefined} title={loadError ? 'Não foi possível buscar' : 'Nenhum mod encontrado'}>
          {loadError || 'Tente outra busca ou outro filtro.'}
        </EmptyState>
      ) : (
        <>
          <div className="mdx-mod-grid">
            {mods.map((m) => (
              <ModTile
                key={m.id}
                thumb={m.logo?.thumb_320x180}
                title={m.name}
                author={m.submitted_by?.username ? `por ${m.submitted_by.username}` : null}
                installed={installedFolders.has(modFolderName(m.name))}
                stats={[
                  { icon: 'download', value: formatCount(m.stats?.downloads_total) },
                  m.stats?.ratings_positive > 0 && { icon: 'thumb', value: formatCount(m.stats.ratings_positive) },
                ]}
                onClick={() => onOpenMod(m.id)}
              />
            ))}
          </div>
          {mods.length < resultTotal && (
            <LoadMore busy={loadingMore} onClick={loadMoreMods} label={`Ver mais (${mods.length} de ${resultTotal})`} />
          )}
        </>
      )}
    </>
  );
}

// ---------- mod.io: página individual do mod ----------
export function ModioModDetail({ game, modioModId, onBack }) {
  const { user } = useAuth();
  const desktopReady = isDesktopModsAvailable();
  const { installedFolders, trackInstall, untrackInstall, completeInstall, progressById } = useModsManager();
  const [data, setData] = useState(null);
  const [comments, setComments] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [busyFavorite, setBusyFavorite] = useState(false);
  const [busyUp, setBusyUp] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState('');
  const [justInstalled, setJustInstalled] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportSent, setReportSent] = useState(false);
  const [depsBusy, setDepsBusy] = useState(false);
  const [depsError, setDepsError] = useState('');
  const [profiles, setProfiles] = useState(null);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [addToProfileMsg, setAddToProfileMsg] = useState('');
  const [collections, setCollections] = useState(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [addToCollectionMsg, setAddToCollectionMsg] = useState('');

  const refresh = () => {
    getMod(game.modioGameId, modioModId).then(setData).catch(() => setData({ error: true }));
    listModComments(modioModId).then((d) => setComments(d.comments)).catch(() => setComments([]));
  };
  useEffect(refresh, [game.modioGameId, modioModId]);

  // Item pedido 15: "Adicionar a um perfil" — só com o app desktop
  // (perfis sem app desktop não têm como ser ativados de qualquer forma).
  useEffect(() => {
    if (!desktopReady) return;
    listModProfiles(game.modioGameId).then((d) => setProfiles(d.profiles)).catch(() => setProfiles([]));
  }, [desktopReady, game.modioGameId]);

  // Item pedido 19: "Adicionar a uma coleção" — só as coleções que a
  // PRÓPRIA pessoa criou (só o autor pode adicionar item).
  useEffect(() => {
    listModCollections(game.modioGameId).then((d) => setCollections(d.collections.filter((c) => c.authorId === user.id))).catch(() => setCollections([]));
  }, [game.modioGameId, user.id]);

  // O progresso chega pelo gerenciador (onModsProgress) — quando chega
  // em "done", a lista de instalados é recarregada e o botão vira
  // "Reinstalar".
  const progress = progressById[modioModId];
  useEffect(() => {
    if (progress?.phase === 'done') { setInstallBusy(false); setJustInstalled(true); }
  }, [progress?.phase]);

  if (!data) return <div className="mdx-detail"><div className="mdx-skel mdx-skel-detail" /></div>;
  if (data.error) return (
    <div className="mdx-detail">
      <button type="button" className="mdx-back-link" onClick={onBack}><Icon name="back" size={16} /> Voltar para os mods</button>
      <EmptyState icon="alert" tone="danger" title="Não foi possível carregar este mod" />
    </div>
  );

  const { mod, dependencies, isFavorited, isUpped } = data;
  const installed = justInstalled || installedFolders.has(modFolderName(mod.name));

  const doFavorite = async () => {
    setBusyFavorite(true);
    try { await toggleModFavorite(game.modioGameId, modioModId); refresh(); } finally { setBusyFavorite(false); }
  };
  const doUp = async () => {
    setBusyUp(true);
    try { await toggleModUp(game.modioGameId, modioModId); refresh(); } finally { setBusyUp(false); }
  };
  const doComment = async () => {
    const content = commentText.trim();
    if (!content) return;
    await addModComment(game.modioGameId, modioModId, content);
    setCommentText('');
    listModComments(modioModId).then((d) => setComments(d.comments));
  };
  const doReport = async () => {
    if (!reportReason.trim()) return;
    await reportMod(modioModId, reportReason.trim());
    setReportReason('');
    setReportOpen(false);
    setReportSent(true);
  };

  // Item pedido 12: instalação automática — pede a URL assinada pro
  // backend (nunca baixa o arquivo por aqui) e manda pro app desktop
  // instalar de verdade.
  const doInstall = async () => {
    if (!game.installPath) { setInstallError('Não sabemos onde este jogo está instalado — abra-o pela Steam pra detectarmos de novo.'); return; }
    setInstallError('');
    setInstallBusy(true);
    trackInstall(modioModId, mod.name);
    try {
      const download = await getModDownload(game.modioGameId, modioModId);
      const result = await installModLocally({
        downloadUrl: download.downloadUrl,
        filename: download.filename,
        gameInstallPath: game.installPath,
        modName: mod.name,
        modioModId,
        steamAppId: game.steamAppId, source: 'modio', sourceId: modioModId, version: mod.modfile?.version || null,
      });
      if (!result.success) throw new Error(result.error || 'Falha desconhecida.');
      setInstallBusy(false);
      setJustInstalled(true);
      completeInstall(modioModId);
    } catch (err) {
      setInstallError(err.message);
      setInstallBusy(false);
      untrackInstall(modioModId);
    }
  };

  // Item pedido 16: "botão Instalar dependências" — uma de cada vez
  // (sequencial), mais fácil de mostrar progresso e saber qual falhou.
  const doInstallDependencies = async () => {
    if (!game.installPath) { setDepsError('Não sabemos onde este jogo está instalado.'); return; }
    setDepsBusy(true);
    setDepsError('');
    try {
      for (const dep of dependencies) {
        const depMod = await getMod(game.modioGameId, dep.mod_id);
        trackInstall(dep.mod_id, depMod.mod.name);
        const download = await getModDownload(game.modioGameId, dep.mod_id);
        const result = await installModLocally({
          downloadUrl: download.downloadUrl,
          filename: download.filename,
          gameInstallPath: game.installPath,
          modName: depMod.mod.name,
          modioModId: dep.mod_id,
          steamAppId: game.steamAppId, source: 'modio', sourceId: dep.mod_id,
        });
        if (!result.success) { untrackInstall(dep.mod_id); throw new Error(`${depMod.mod.name}: ${result.error || 'falha desconhecida'}`); }
        completeInstall(dep.mod_id);
      }
    } catch (err) {
      setDepsError(`Não foi possível instalar todas as dependências: ${err.message}`);
    } finally {
      setDepsBusy(false);
    }
  };

  // Item pedido 15: adiciona o mod atual ao perfil selecionado (upsert).
  const doAddToProfile = async () => {
    if (!selectedProfileId) return;
    await upsertModProfileItem(selectedProfileId, {
      modioModId, modioModfileId: mod.modfile?.id, modName: mod.name, version: mod.modfile?.version, enabled: true,
    });
    setAddToProfileMsg('Adicionado ao modpack!');
    setTimeout(() => setAddToProfileMsg(''), 2500);
  };

  const doAddToCollection = async () => {
    if (!selectedCollectionId) return;
    await addModCollectionItem(selectedCollectionId, { modioModId, modName: mod.name });
    setAddToCollectionMsg('Adicionado à coleção!');
    setTimeout(() => setAddToCollectionMsg(''), 2500);
  };

  const installArea = !desktopReady ? (
    <p className="mdx-note"><Icon name="monitor" size={15} /> Instalar mods só funciona pelo app de desktop do Project Club.</p>
  ) : installBusy ? (
    <div className="mdx-inline-progress">
      <span>{progressLabel(progress || { phase: 'downloading', percent: 0 })}</span>
      <ProgressBar percent={progress?.percent} indeterminate={progress && progress.phase !== 'downloading'} />
    </div>
  ) : installed ? (
    <button type="button" className="mdx-btn ghost" onClick={doInstall}><Icon name="refresh" size={16} /> Reinstalar / atualizar</button>
  ) : (
    <button type="button" className="mdx-btn primary lg" onClick={doInstall}><Icon name="download" size={17} /> Instalar</button>
  );

  return (
    <ModDetailLayout
      onBack={onBack}
      backLabel="Voltar para os mods"
      thumb={mod.logo?.thumb_640x360 || mod.logo?.original || mod.logo?.thumb_320x180}
      title={mod.name}
      subtitle={<>por <strong>{mod.submitted_by?.username}</strong> · v{mod.modfile?.version || '?'}</>}
      gallery={(mod.media?.images || []).map((img) => ({ thumb: img.thumb_1280x720 || img.thumb_320x180 || img.original, full: img.original }))}
      info={[
        { label: 'Última atualização', value: formatModDate(mod.date_updated) },
        { label: 'Enviado originalmente', value: formatModDate(mod.date_added) },
        { label: 'Enviado por', value: mod.submitted_by?.username, tone: 'accent' },
        mod.modfile && { label: 'Verificação de vírus', value: mod.modfile.virus_positive === 1 ? 'Arquivo marcado como inseguro' : mod.modfile.virus_status === 1 ? 'Seguro para usar' : 'Ainda não verificado', tone: mod.modfile.virus_positive === 1 ? 'bad' : mod.modfile.virus_status === 1 ? 'ok' : undefined },
      ]}
      stats={(
        <>
          {installed && <span className="mdx-installed-pill"><Icon name="check" size={13} strokeWidth={2.6} /> Instalado</span>}
          <DetailStat icon="download">{formatCount(mod.stats?.downloads_total)} downloads</DetailStat>
          {mod.stats?.ratings_positive > 0 && <DetailStat icon="thumb">{formatCount(mod.stats.ratings_positive)}</DetailStat>}
          <DetailStat icon="clock">Atualizado em {mod.date_updated ? new Date(mod.date_updated * 1000).toLocaleDateString('pt-BR') : '—'}</DetailStat>
        </>
      )}
      actions={(
        <>
          {installArea}
          <button type="button" className={`mdx-btn ghost ${isFavorited ? 'on' : ''}`} disabled={busyFavorite} onClick={doFavorite}>
            <Icon name="star" size={16} filled={isFavorited} /> {isFavorited ? 'Favoritado' : 'Favoritar'}
          </button>
          <button type="button" className={`mdx-btn ghost ${isUpped ? 'on' : ''}`} disabled={busyUp} onClick={doUp}>
            <Icon name="thumb" size={16} /> Up {mod.stats?.ratings_positive ? `(${formatCount(mod.stats.ratings_positive)})` : ''}
          </button>
          <button type="button" className="mdx-btn ghost danger icon-only" title="Denunciar" aria-label="Denunciar" onClick={() => setReportOpen((v) => !v)}>
            <Icon name="flag" size={16} />
          </button>
        </>
      )}
      notices={(
        <>
          {installError && <p className="mdx-error">Não foi possível instalar este mod: {installError}</p>}
          {reportSent && <p className="mdx-note ok"><Icon name="check" size={15} /> Denúncia enviada. Obrigado!</p>}
          {reportOpen && (
            <div className="mdx-report">
              <textarea placeholder="Descreva o motivo da denúncia..." value={reportReason} onChange={(e) => setReportReason(e.target.value)} />
              <div className="mdx-row-end">
                <button type="button" className="mdx-btn ghost sm" onClick={() => setReportOpen(false)}>Cancelar</button>
                <button type="button" className="mdx-btn danger-solid sm" onClick={doReport}>Enviar denúncia</button>
              </div>
            </div>
          )}
        </>
      )}
      main={(
        <>
          <Section title="Sobre" icon="info">
            {mod.summary ? <p className="mdx-desc">{mod.summary}</p> : <p className="mdx-muted">Sem descrição.</p>}
            {mod.tags?.length > 0 && (
              <div className="mdx-tags">{mod.tags.map((t) => <span key={t.name} className="mdx-tag">{t.name}</span>)}</div>
            )}
          </Section>


          <Section title="Comentários" icon="chat">
            <div className="mdx-comment-form">
              <textarea placeholder="Escreva um comentário..." value={commentText} onChange={(e) => setCommentText(e.target.value)} />
              <button type="button" className="mdx-btn primary" disabled={!commentText.trim()} onClick={doComment}>Comentar</button>
            </div>
            {comments === null ? <div className="mdx-skel mdx-skel-line" /> : comments.length === 0 ? (
              <p className="mdx-muted">Nenhum comentário ainda.</p>
            ) : (
              <div className="mdx-comments">
                {comments.map((c) => (
                  <div key={c.id} className="mdx-comment">
                    <div><strong>{c.user?.displayName}</strong> <span className="mdx-muted">@{c.user?.username}</span></div>
                    <p>{c.content}</p>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
      side={(
        <>
          {dependencies?.length > 0 && (
            <Section title="Dependências" icon="link" className="mdx-deps">
              <p className="mdx-muted">Este mod precisa de {dependencies.length} {dependencies.length === 1 ? 'outro mod' : 'outros mods'} pra funcionar.</p>
              <ul className="mdx-dep-list">
                {dependencies.map((d) => <li key={d.mod_id}><Icon name="puzzle" size={14} /> {d.name || `Mod #${d.mod_id}`}</li>)}
              </ul>
              {desktopReady && (
                <button type="button" className="mdx-btn primary block" disabled={depsBusy} onClick={doInstallDependencies}>
                  <Icon name="download" size={16} /> {depsBusy ? 'Instalando dependências...' : 'Instalar dependências'}
                </button>
              )}
              {depsError && <p className="mdx-error">{depsError}</p>}
            </Section>
          )}
          {desktopReady && profiles && profiles.length > 0 && (
            <Section title="Adicionar a um modpack" icon="layers">
              <div className="mdx-select-row">
                <select value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
                  <option value="">Escolha um modpack...</option>
                  {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button type="button" className="mdx-btn ghost sm" disabled={!selectedProfileId} onClick={doAddToProfile}>Adicionar</button>
              </div>
              {addToProfileMsg && <p className="mdx-note ok">{addToProfileMsg}</p>}
            </Section>
          )}
          {collections && collections.length > 0 && (
            <Section title="Adicionar a uma coleção" icon="box">
              <div className="mdx-select-row">
                <select value={selectedCollectionId} onChange={(e) => setSelectedCollectionId(e.target.value)}>
                  <option value="">Escolha uma coleção sua...</option>
                  {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button type="button" className="mdx-btn ghost sm" disabled={!selectedCollectionId} onClick={doAddToCollection}>Adicionar</button>
              </div>
              {addToCollectionMsg && <p className="mdx-note ok">{addToCollectionMsg}</p>}
            </Section>
          )}
          {mod.profile_url && (
            <a href={mod.profile_url} target="_blank" rel="noreferrer" className="mdx-btn ghost block">
              <Icon name="external" size={15} /> Ver no mod.io
            </a>
          )}
        </>
      )}
    />
  );
}
