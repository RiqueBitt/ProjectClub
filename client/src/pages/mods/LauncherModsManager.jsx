import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { launcherMods, onModsProgress } from '../../utils/mods';
import { Icon, EmptyState, SkeletonGrid, SearchField, ModTile, LoadMore, formatCount, hashHue } from './shared.jsx';
import { formatBytes } from './unifiedApi.js';

// Mod Manager único — Minecraft (instâncias do ProjectMC) e Hytale
// (instâncias do HyProject) no mesmo lugar que os jogos da Steam/Epic/GOG.
// Os launchers continuam só abrindo o jogo; instalar, ligar/desligar,
// atualizar e remover mods fica aqui. Tudo passa pelo app de PC
// (desktop/launcherMods.js): a tela nunca manda caminho de pasta, só o id
// da instância, e os downloads só aceitam o catálogo de mods.

const LOADER_LABEL = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt', vanilla: 'Vanilla' };
const MC_SORTS = [
  { value: 'relevance', label: 'Relevância' },
  { value: 'downloads', label: 'Mais baixados' },
  { value: 'follows', label: 'Mais seguidos' },
  { value: 'updated', label: 'Atualizados' },
];
const PAGE = 24;

export default function LauncherModsManager({ game, onBack }) {
  const isMc = game.kind === 'minecraft';
  const [instances, setInstances] = useState(game.instances || []);
  const [instanceId, setInstanceId] = useState(() => {
    try { const last = localStorage.getItem(`pc-mm-inst:${game.kind}`); if (last && (game.instances || []).some((i) => i.id === last)) return last; } catch { /* ok */ }
    return game.instances?.[0]?.id || '';
  });
  const instance = instances.find((i) => i.id === instanceId) || instances[0] || null;
  const [tab, setTab] = useState(isMc ? 'explore' : 'installed');
  const [installed, setInstalled] = useState(null);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState([]);
  const [updates, setUpdates] = useState({}); // file -> versão nova
  const [progress, setProgress] = useState({}); // chave -> 0..1

  const toast = useCallback((text, tone = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  useEffect(() => {
    try { if (instanceId) localStorage.setItem(`pc-mm-inst:${game.kind}`, instanceId); } catch { /* ok */ }
  }, [game.kind, instanceId]);
  useEffect(() => onModsProgress?.((p) => {
    if (!p?.modioModId || !p.total) return;
    setProgress((cur) => ({ ...cur, [p.modioModId]: Math.min(1, p.received / p.total) }));
  }), []);

  const refreshInstances = useCallback(async () => {
    try { setInstances(await launcherMods.instances(game.kind)); } catch { /* fica a lista de antes */ }
  }, [game.kind]);

  const refresh = useCallback(async () => {
    if (!instance) return;
    setError('');
    try {
      const r = await launcherMods.list(game.kind, instance.id);
      setInstalled(r.mods);
    } catch (e) { setError(e.message); setInstalled([]); }
  }, [game.kind, instance]);
  useEffect(() => { setInstalled(null); setUpdates({}); refresh(); }, [refresh]);

  // Minecraft: pergunta ao catálogo se há versão nova de cada mod (pelo hash do arquivo).
  const checkUpdates = useCallback(async (list) => {
    if (!isMc || !instance || !list?.length) return;
    const hashes = list.filter((m) => m.sha1).map((m) => m.sha1);
    if (!hashes.length) return;
    try {
      const body = { hashes, algorithm: 'sha1', loaders: instance.loader && instance.loader !== 'vanilla' ? [instance.loader] : undefined, game_versions: instance.gameVersion ? [instance.gameVersion] : undefined };
      const data = await launcherMods.catalog(game.kind, 'version_files/update', { body });
      const next = {};
      for (const m of list) {
        const v = m.sha1 && data?.[m.sha1];
        const file = v?.files?.find((f) => f.primary) || v?.files?.[0];
        if (file && file.hashes?.sha1 !== m.sha1) next[m.file] = { version: v.version_number, url: file.url, fileName: file.filename, sha1: file.hashes?.sha1, projectId: v.project_id };
      }
      setUpdates(next);
    } catch { /* sem rede: sem aviso de atualização */ }
  }, [game.kind, instance, isMc]);
  useEffect(() => { if (installed) checkUpdates(installed); }, [installed, checkUpdates]);

  const installedNames = useMemo(() => new Set((installed || []).map((m) => m.file.replace(/\.disabled$/, '').toLowerCase())), [installed]);

  const doToggle = async (m) => {
    try { await launcherMods.setEnabled(game.kind, instance.id, m.file, !m.enabled); refresh(); } catch (e) { toast(e.message, 'bad'); }
  };
  const doRemove = async (m) => {
    if (!window.confirm(`Remover ${m.name}? O arquivo vai pra Lixeira.`)) return;
    try { await launcherMods.remove(game.kind, instance.id, m.file); toast(`${m.name} removido.`); refresh(); } catch (e) { toast(e.message, 'bad'); }
  };
  const doUpdate = async (m) => {
    const u = updates[m.file];
    if (!u) return;
    try {
      await launcherMods.installUrl(game.kind, instance.id, { url: u.url, fileName: u.fileName, sha1: u.sha1, replace: m.file, progressKey: u.fileName });
      // Mod desligado continua desligado depois de atualizar.
      if (!m.enabled) await launcherMods.setEnabled(game.kind, instance.id, u.fileName, false);
      toast(`${m.name} atualizado pra ${u.version}.`);
      refresh();
    } catch (e) { toast(e.message, 'bad'); }
  };
  const doUpdateAll = async () => {
    for (const m of installed || []) if (updates[m.file]) await doUpdate(m); // eslint-disable-line no-await-in-loop
  };
  const doAddFile = async () => {
    try {
      const r = await launcherMods.installFile(game.kind, instance.id);
      if (r.files?.length) { toast(r.files.length === 1 ? `${r.files[0]} adicionado.` : `${r.files.length} mods adicionados.`); refresh(); }
    } catch (e) { toast(e.message, 'bad'); }
  };

  const updateCount = Object.keys(updates).length;
  const tabs = [
    ...(isMc ? [{ key: 'explore', label: 'Explorar', icon: 'compass' }] : []),
    { key: 'installed', label: 'Instalados', icon: 'check', count: installed?.length ?? null },
  ];
  const hue = hashHue(game.displayName);

  return (
    <div className="mdx-manager mdx-launcher">
      <header className={`mdx-hero mdx-hero-${game.kind}`} style={{ '--h1': hue, '--h2': (hue + 48) % 360 }}>
        <div className="mdx-hero-bg" aria-hidden="true"><div className="mdx-hero-gen" /><div className="mdx-hero-shade" /></div>
        <button type="button" className="mdx-hero-back" onClick={onBack}><Icon name="back" size={16} /> Biblioteca</button>
        <div className="mdx-hero-content">
          <div className="mdx-hero-poster mdx-launcher-poster"><img src={game.iconUrl} alt="" /></div>
          <div className="mdx-hero-main">
            <div className="mdx-hero-text">
              <span className="mdx-eyebrow light">Gerenciador de mods · {game.launcher}</span>
              <h1>{game.displayName}</h1>
              <div className="mdx-hero-chips">
                {instance && isMc && instance.loader && <span className="mdx-hero-chip"><Icon name="layers" size={13} /> {LOADER_LABEL[instance.loader] || instance.loader}{instance.gameVersion ? ` ${instance.gameVersion}` : ''}</span>}
                {installed && <span className="mdx-hero-chip"><Icon name="puzzle" size={13} /> {installed.length} {installed.length === 1 ? 'mod instalado' : 'mods instalados'}</span>}
                {updateCount > 0 && <span className="mdx-hero-chip upd"><Icon name="refresh" size={13} /> {updateCount} {updateCount === 1 ? 'atualização' : 'atualizações'}</span>}
              </div>
            </div>
            <div className="mdx-hero-actions">
              {instance && (
                <>
                  <button type="button" className="mdx-btn glass" onClick={() => launcherMods.openFolder(game.kind, instance.id).catch((e) => toast(e.message, 'bad'))}><Icon name="folder" size={16} /> Abrir pasta de mods</button>
                  <button type="button" className="mdx-btn glass" onClick={doAddFile}><Icon name="upload" size={16} /> Adicionar mod do PC</button>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {instances.length > 0 && (
        <div className="mdx-instance-bar">
          <span className="mdx-instance-label"><Icon name="layers" size={15} /> Instância</span>
          <div className="mdx-instance-list" role="radiogroup" aria-label="Instância">
            {instances.map((i) => (
              <button
                key={i.id} type="button" role="radio" aria-checked={i.id === instance?.id}
                className={`mdx-instance ${i.id === instance?.id ? 'active' : ''}`} onClick={() => setInstanceId(i.id)}
              >
                <strong>{i.name}</strong>
                <span>{isMc ? (i.loader ? `${LOADER_LABEL[i.loader] || i.loader}${i.gameVersion ? ` · ${i.gameVersion}` : ''}` : 'Launcher oficial · qualquer versão') : i.launcher}</span>
              </button>
            ))}
          </div>
          <button type="button" className="mdx-icon-btn" aria-label="Procurar instâncias de novo" title="Procurar instâncias de novo" onClick={refreshInstances}><Icon name="refresh" size={15} /></button>
        </div>
      )}

      <nav className="mdx-tabs" aria-label="Seções do jogo">
        {tabs.map((t) => (
          <button key={t.key} type="button" className={`mdx-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} size={16} /> {t.label}
            {t.count != null && <span className="mdx-tab-count">{t.count}</span>}
          </button>
        ))}
      </nav>

      {!instance && (
        <EmptyState icon="layers" title="Nenhuma instância encontrada">
          Abra o {game.launcher}, crie uma instância e volte aqui — os mods de cada instância aparecem neste gerenciador.
        </EmptyState>
      )}

      {instance && tab === 'explore' && isMc && (
        <MinecraftExplore instance={instance} installedNames={installedNames} progress={progress} onInstalled={(msg) => { toast(msg); refresh(); }} onError={(m) => toast(m, 'bad')} />
      )}

      {instance && tab === 'installed' && (
        <div className="mdx-tab-body">
          {error && <p className="mdx-error mdx-error-banner">{error}</p>}
          {installed === null && <SkeletonGrid count={4} variant="pack" />}
          {installed?.length === 0 && (
            <EmptyState icon="puzzle" title="Nenhum mod nesta instância" action={(
              <div className="mdx-empty-actions">
                {isMc && <button type="button" className="mdx-btn primary" onClick={() => setTab('explore')}><Icon name="compass" size={16} /> Explorar mods</button>}
                <button type="button" className="mdx-btn ghost" onClick={doAddFile}><Icon name="upload" size={16} /> Adicionar do PC</button>
              </div>
            )}
            >
              {isMc ? 'Explore o catálogo e instale com um clique, ou adicione um .jar do seu PC.' : 'Adicione o arquivo do mod (.jar ou .zip) e ele entra na pasta da instância.'}
            </EmptyState>
          )}
          {installed?.length > 0 && (
            <>
              <div className="mdx-installed-head">
                <span className="mdx-muted">{installed.filter((m) => m.enabled).length} ativados · {installed.filter((m) => !m.enabled).length} desativados</span>
                {updateCount > 0 && <button type="button" className="mdx-btn primary sm" onClick={doUpdateAll}><Icon name="refresh" size={14} /> Atualizar tudo ({updateCount})</button>}
              </div>
              <div className="mdx-rows">
                {installed.map((m, i) => {
                  const u = updates[m.file];
                  const p = u && progress[u.fileName];
                  return (
                    <div key={m.file} className={`mdx-row mdx-irow mdx-rise ${m.enabled ? '' : 'off'}`} style={{ '--i': Math.min(i, 20) }}>
                      <span className="mdx-row-icon" style={{ '--h1': hashHue(m.name) }}><Icon name="puzzle" size={18} /></span>
                      <div className="mdx-row-text">
                        <strong title={m.file}>{m.name}</strong>
                        <span className="mdx-irow-meta">
                          <span className={m.enabled ? 'mdx-status on' : 'mdx-status'}>{m.enabled ? 'Ativado' : 'Desativado'}</span>
                          {u && <span className="mdx-upd-chip"><Icon name="refresh" size={11} strokeWidth={2.4} /> Atualização: {u.version}</span>}
                          <span className="mdx-irow-file">{formatBytes(m.size)}</span>
                        </span>
                        {p > 0 && p < 1 && <span className="mdx-progress"><span style={{ width: `${Math.round(p * 100)}%` }} /></span>}
                      </div>
                      <div className="mdx-row-actions">
                        {u && <button type="button" className="mdx-btn primary sm" onClick={() => doUpdate(m)}><Icon name="refresh" size={14} /> Atualizar</button>}
                        <button type="button" role="switch" aria-checked={m.enabled} aria-label={m.enabled ? 'Desativar' : 'Ativar'} title={m.enabled ? 'Desativar' : 'Ativar'} className={`mdx-switch ${m.enabled ? 'on' : ''}`} onClick={() => doToggle(m)}><span /></button>
                        <button type="button" className="mdx-btn ghost danger sm icon-only-mobile" onClick={() => doRemove(m)} title="Remover"><Icon name="trash" size={15} /> <span>Remover</span></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {toasts.length > 0 && (
        <div className="mdx-toasts" role="status">
          {toasts.map((t) => (
            <div key={t.id} className={`mdx-toast ${t.tone}`}>
              <span className="mdx-toast-icon"><Icon name={t.tone === 'bad' ? 'alert' : 'check'} size={15} /></span>
              <span className="mdx-toast-body">{t.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MinecraftExplore({ instance, installedNames, progress, onInstalled, onError }) {
  const [query, setQuery] = useState('');
  const kind = 'mod';
  const [sort, setSort] = useState('relevance');
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState({});
  const reqId = useRef(0);

  const facets = useMemo(() => {
    const f = [[`project_type:${kind}`]];
    if (instance.gameVersion) f.push([`versions:${instance.gameVersion}`]);
    if (kind === 'mod' && instance.loader && instance.loader !== 'vanilla') f.push([`categories:${instance.loader}`]);
    return JSON.stringify(f);
  }, [kind, instance]);

  const load = useCallback(async (offset) => {
    const id = ++reqId.current;
    setBusy(true);
    try {
      const data = await launcherMods.catalog('minecraft', 'search', { query: { query: query.trim() || undefined, facets, index: sort, offset, limit: PAGE } });
      if (id !== reqId.current) return;
      setTotal(data?.total_hits || 0);
      setItems((cur) => (offset ? [...(cur || []), ...(data?.hits || [])] : (data?.hits || [])));
    } catch (e) {
      if (id === reqId.current) { setItems((cur) => cur || []); onError(e.message); }
    } finally { if (id === reqId.current) setBusy(false); }
  }, [query, facets, sort, onError]);
  useEffect(() => {
    const t = setTimeout(() => load(0), query ? 350 : 0);
    return () => clearTimeout(t);
  }, [load, query]);

  // Instala a melhor versão pra esta instância + as dependências obrigatórias.
  const install = async (hit) => {
    setInstalling((s) => ({ ...s, [hit.project_id]: true }));
    try {
      const done = new Set();
      const installOne = async (projectId, top) => {
        if (done.has(projectId)) return;
        done.add(projectId);
        const query2 = {};
        if (instance.gameVersion) query2.game_versions = JSON.stringify([instance.gameVersion]);
        if (kind === 'mod' && instance.loader && instance.loader !== 'vanilla') query2.loaders = JSON.stringify([instance.loader]);
        const versions = await launcherMods.catalog('minecraft', `project/${projectId}/version`, { query: query2 });
        const v = versions?.[0];
        if (!v) { if (top) throw new Error('Não há versão desse mod pra esta instância.'); return; }
        const file = v.files?.find((f) => f.primary) || v.files?.[0];
        if (!file) return;
        if (!installedNames.has(file.filename.toLowerCase())) {
          await launcherMods.installUrl('minecraft', instance.id, { url: file.url, fileName: file.filename, sha1: file.hashes?.sha1, progressKey: file.filename });
        }
        if (kind === 'mod') {
          for (const d of v.dependencies || []) if (d.dependency_type === 'required' && d.project_id) await installOne(d.project_id, false); // eslint-disable-line no-await-in-loop
        }
      };
      await installOne(hit.project_id, true);
      onInstalled(done.size > 1 ? `${hit.title} instalado (com ${done.size - 1} dependência${done.size > 2 ? 's' : ''}).` : `${hit.title} instalado.`);
    } catch (e) { onError(e.message); }
    finally { setInstalling((s) => ({ ...s, [hit.project_id]: false })); }
  };

  return (
    <div className="mdx-tab-body">
      <div className="mdx-lib-toolbar">
        <SearchField value={query} onChange={setQuery} placeholder="Procurar mods de Minecraft..." />
        <div className="mdx-lib-toolbar-row">
          <label className="mdx-sort">
            <Icon name="sort" size={15} />
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
              {MC_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>
        {instance.loader && <p className="mdx-muted">Mostrando só o que funciona em {LOADER_LABEL[instance.loader] || instance.loader}{instance.gameVersion ? ` ${instance.gameVersion}` : ''} — o mesmo da instância “{instance.name}”.</p>}
      </div>
      {items === null && <SkeletonGrid count={8} />}
      {items?.length === 0 && !busy && <EmptyState icon="search" title="Nada encontrado">Tente outra busca.</EmptyState>}
      {items?.length > 0 && (
        <>
          <div className="mdx-mod-grid">
            {items.map((h, i) => {
              const installedHere = installedNames.has(`${h.slug}.jar`) || [...installedNames].some((n) => n.startsWith(`${h.slug}-`) || n.startsWith(`${h.slug}_`));
              const p = Object.entries(progress).find(([k]) => k.toLowerCase().startsWith(h.slug))?.[1];
              return (
                <div key={h.project_id} className="mdx-rise" style={{ '--i': Math.min(i % PAGE, 20) }}>
                  <ModTile
                    thumb={h.icon_url} title={h.title} author={h.author}
                    stats={[{ icon: 'download', value: formatCount(h.downloads) }, h.follows > 0 && { icon: 'heart', value: formatCount(h.follows) }]}
                    installed={installedHere}
                  >
                    <p className="mdx-tile-desc">{h.description}</p>
                    {installing[h.project_id] && p > 0 && p < 1 && <span className="mdx-progress"><span style={{ width: `${Math.round(p * 100)}%` }} /></span>}
                    <button type="button" className="mdx-btn primary sm" disabled={!!installing[h.project_id] || installedHere} onClick={() => install(h)}>
                      <Icon name={installedHere ? 'check' : 'download'} size={14} /> {installedHere ? 'Instalado' : installing[h.project_id] ? 'Instalando...' : 'Instalar'}
                    </button>
                  </ModTile>
                </div>
              );
            })}
          </div>
          {items.length < total && <LoadMore busy={busy} onClick={() => load(items.length)} />}
        </>
      )}
    </div>
  );
}
