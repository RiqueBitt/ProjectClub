import { useEffect, useState } from 'react';
import { listThunderstoreCategories, listThunderstorePackages, getThunderstorePackage } from '../../api/endpoints';
import { isDesktopModsAvailable, installThunderstorePackageLocally, modFolderName } from '../../utils/mods';
import {
  Icon, formatCount, EmptyState, SkeletonGrid, SearchField, ChipRow, ModTile, LoadMore,
  ModDetailLayout, DetailStat, Section, ProgressBar, progressLabel, useModsManager,
} from './shared.jsx';

// ---------- Thunderstore (aba "Explorar") ----------
// Item pedido: "pegue a interface e tudo do Gale [Thunderstore Mod
// Manager] e funda com o que eu já tenho" — Thunderstore é o
// repositório de mods usado por jogos com BepInEx (Lethal Company,
// Risk of Rain 2, Content Warning...). Implementação própria, direto
// contra a API pública do Thunderstore, nenhum código do Gale (GPL-3.0)
// foi copiado.
//
// Aqui o backend já devolve a dependência RESOLVIDA em árvore inteira
// (ver resolveDependencyTree em thunderstoreService.js), então
// "Instalar" já instala TUDO que o mod precisa de uma vez, na ordem certa.
const THUNDERSTORE_SORT_OPTIONS = [
  { value: 'popular', label: 'Populares' },
  { value: 'downloads', label: 'Mais baixados' },
  { value: 'new', label: 'Novos' },
  { value: 'updated', label: 'Atualizados' },
];

function isThunderstoreLoaderPackage(name) {
  return /bepinexpack/i.test(name || '');
}

export function ThunderstoreBrowse({ game, onOpenMod }) {
  const { installedFolders } = useModsManager();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('popular');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [packages, setPackages] = useState(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');

  const community = game.thunderstoreCommunity;

  useEffect(() => {
    listThunderstoreCategories(community).then((d) => setCategories(d.categories || [])).catch(() => setCategories([]));
  }, [community]);

  useEffect(() => {
    setPackages(null);
    setLoadError('');
    const timeout = setTimeout(() => {
      listThunderstorePackages(community, { q: query || undefined, sort, category: category || undefined, offset: 0 })
        .then((d) => { setPackages(d.packages); setTotal(d.total); })
        .catch((err) => { setPackages([]); setLoadError(err.response?.data?.error || 'Não foi possível buscar mods agora.'); });
    }, 250);
    return () => clearTimeout(timeout);
  }, [community, query, sort, category]);

  const loadMorePackages = async () => {
    setLoadingMore(true);
    try {
      const d = await listThunderstorePackages(community, { q: query || undefined, sort, category: category || undefined, offset: packages.length });
      setPackages((prev) => [...prev, ...d.packages]);
      setTotal(d.total);
    } catch {
      setLoadError('Não foi possível carregar mais mods agora.');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <>
      <div className="mdx-toolbar">
        <SearchField value={query} onChange={setQuery} placeholder="Pesquisar mods ou autores..." />
        <ChipRow options={THUNDERSTORE_SORT_OPTIONS} value={sort} onChange={setSort} label="Ordenar" />
      </div>
      {categories.length > 0 && (
        <ChipRow
          label="Categoria"
          options={[{ value: '', label: 'Todas categorias' }, ...categories.map((c) => ({ value: c.name, label: c.name }))]}
          value={category}
          onChange={setCategory}
        />
      )}
      {packages !== null && packages.length > 0 && (
        <p className="mdx-result-count">{total} {total === 1 ? 'mod disponível' : 'mods disponíveis'} · Thunderstore</p>
      )}

      {packages === null ? (
        <SkeletonGrid count={8} />
      ) : packages.length === 0 ? (
        <EmptyState icon={loadError ? 'alert' : 'search'} tone={loadError ? 'danger' : undefined} title={loadError ? 'Não foi possível buscar' : 'Nenhum mod encontrado'}>
          {loadError || 'Tente outra busca ou outro filtro.'}
        </EmptyState>
      ) : (
        <>
          <div className="mdx-mod-grid">
            {packages.map((p) => (
              <ModTile
                key={p.fullName}
                thumb={p.version?.icon}
                fallbackIcon="bolt"
                title={p.name}
                author={`por ${p.owner}`}
                pinned={p.isPinned}
                installed={installedFolders.has(modFolderName(p.fullName))}
                stats={[
                  { icon: 'download', value: formatCount(p.downloadCount) },
                  p.rating > 0 && { icon: 'thumb', value: formatCount(p.rating) },
                ]}
                onClick={() => onOpenMod(p.fullName)}
              />
            ))}
          </div>
          {packages.length < total && (
            <LoadMore busy={loadingMore} onClick={loadMorePackages} label={`Ver mais (${packages.length} de ${total})`} />
          )}
        </>
      )}
    </>
  );
}

// ---------- Thunderstore: página individual do mod ----------
export function ThunderstoreModDetail({ game, fullName, onBack }) {
  const desktopReady = isDesktopModsAvailable();
  const { installedFolders, trackInstall, untrackInstall, completeInstall, progressById } = useModsManager();
  const [data, setData] = useState(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installStep, setInstallStep] = useState(null); // { fullName, name, index, count }
  const [installError, setInstallError] = useState('');
  const [justInstalled, setJustInstalled] = useState(false);

  const community = game.thunderstoreCommunity;

  const refresh = () => {
    getThunderstorePackage(community, fullName).then(setData).catch(() => setData({ error: true }));
  };
  useEffect(refresh, [community, fullName]);

  if (!data) return <div className="mdx-detail"><div className="mdx-skel mdx-skel-detail" /></div>;
  if (data.error) return (
    <div className="mdx-detail">
      <button type="button" className="mdx-back-link" onClick={onBack}><Icon name="back" size={16} /> Voltar para os mods</button>
      <EmptyState icon="alert" tone="danger" title="Não foi possível carregar este mod" />
    </div>
  );

  const { package: pkg, dependencies } = data;
  const installed = justInstalled || installedFolders.has(modFolderName(fullName));
  const stepProgress = installStep ? progressById[installStep.fullName] : null;

  // Item pedido: "pegue a interface e tudo do Gale..." — instalação "de
  // um clique só": instala TODA a árvore de dependências (já resolvida
  // pelo backend) uma de cada vez, na ordem certa, ANTES do mod pedido —
  // inclusive o BepInExPack (o framework), marcado como "isLoader" pra
  // desktop/modsManager.js instalar na RAIZ do jogo em vez de
  // BepInEx/plugins.
  const doInstall = async () => {
    if (!game.installPath) { setInstallError('Não sabemos onde este jogo está instalado — abra-o pela Steam pra detectarmos de novo.'); return; }
    setInstallError('');
    setInstallBusy(true);
    let current = null;
    try {
      const toInstall = [...dependencies, { fullName: pkg.fullName, name: pkg.name, downloadUrl: pkg.version.downloadUrl }];
      for (let i = 0; i < toInstall.length; i += 1) {
        const item = toInstall[i];
        current = item;
        setInstallStep({ fullName: item.fullName, name: item.name, index: i + 1, count: toInstall.length });
        trackInstall(item.fullName, item.name);
        const result = await installThunderstorePackageLocally({
          downloadUrl: item.downloadUrl,
          filename: `${item.fullName}.zip`,
          gameInstallPath: game.installPath,
          fullName: item.fullName,
          isLoader: isThunderstoreLoaderPackage(item.name),
        });
        if (!result.success) throw new Error(`${item.name}: ${result.error || 'falha desconhecida'}`);
        completeInstall(item.fullName);
      }
      setJustInstalled(true);
    } catch (err) {
      setInstallError(err.message);
      if (current) untrackInstall(current.fullName);
    } finally {
      setInstallBusy(false);
      setInstallStep(null);
    }
  };

  const installArea = !desktopReady ? (
    <p className="mdx-note"><Icon name="monitor" size={15} /> Instalar mods só funciona pelo app de desktop do Project Club.</p>
  ) : installBusy ? (
    <div className="mdx-inline-progress">
      <span>
        {installStep?.count > 1 ? `(${installStep.index}/${installStep.count}) ` : ''}{installStep?.name} — {progressLabel(stepProgress || { phase: 'downloading', percent: 0 })}
      </span>
      <ProgressBar percent={stepProgress?.percent} indeterminate={!stepProgress || stepProgress.phase !== 'downloading'} />
    </div>
  ) : installed ? (
    <button type="button" className="mdx-btn ghost" onClick={doInstall}><Icon name="refresh" size={16} /> Reinstalar / atualizar</button>
  ) : (
    <button type="button" className="mdx-btn primary lg" onClick={doInstall}>
      <Icon name="download" size={17} /> Instalar{dependencies?.length > 0 ? ` (+${dependencies.length} ${dependencies.length === 1 ? 'dependência' : 'dependências'})` : ''}
    </button>
  );

  return (
    <ModDetailLayout
      onBack={onBack}
      backLabel="Voltar para os mods"
      thumb={pkg.version?.icon}
      fallbackIcon="bolt"
      title={pkg.name}
      subtitle={<>por <strong>{pkg.owner}</strong> · v{pkg.version?.versionNumber || '?'}</>}
      stats={(
        <>
          {installed && <span className="mdx-installed-pill"><Icon name="check" size={13} strokeWidth={2.6} /> Instalado</span>}
          <DetailStat icon="download">{formatCount(pkg.downloadCount)} downloads</DetailStat>
          {pkg.rating > 0 && <DetailStat icon="thumb">{formatCount(pkg.rating)}</DetailStat>}
          <DetailStat icon="clock">Atualizado em {pkg.dateUpdated ? new Date(pkg.dateUpdated).toLocaleDateString('pt-BR') : '—'}</DetailStat>
        </>
      )}
      actions={(
        <>
          {installArea}
          {pkg.packageUrl && (
            <a href={pkg.packageUrl} target="_blank" rel="noreferrer" className="mdx-btn ghost">
              <Icon name="external" size={15} /> Ver no Thunderstore
            </a>
          )}
        </>
      )}
      notices={installError && <p className="mdx-error">Não foi possível instalar este mod: {installError}</p>}
      main={(
        <Section title="Sobre" icon="info">
          {pkg.version?.description ? <p className="mdx-desc">{pkg.version.description}</p> : <p className="mdx-muted">Sem descrição.</p>}
          {pkg.categories?.length > 0 && (
            <div className="mdx-tags">{pkg.categories.map((c) => <span key={c} className="mdx-tag">{c}</span>)}</div>
          )}
        </Section>
      )}
      side={dependencies?.length > 0 && (
        <Section title="Dependências" icon="link" className="mdx-deps">
          <p className="mdx-muted">Instaladas automaticamente junto com este mod.</p>
          <ul className="mdx-dep-list">
            {dependencies.map((d) => (
              <li key={d.fullName}>
                <Icon name={isThunderstoreLoaderPackage(d.name) ? 'box' : 'puzzle'} size={14} /> {d.name}
                {isThunderstoreLoaderPackage(d.name) && <span className="mdx-tag sm">framework BepInEx</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    />
  );
}
