import { useEffect, useMemo, useRef, useState } from 'react';
import { upsertModProfileItem } from '../../api/endpoints';
import {
  setModEnabledLocally, uninstallModLocally, scanInstalledModsLocally, listInstalledModsLocally,
} from '../../utils/mods';
import { proxyImage } from '../../utils/imageProxy';
import { Icon, EmptyState, SearchField, ChipRow, Section, SourceChip, hashHue, ProgressBar, progressLabel, useModsManager } from './shared.jsx';
import { identifyInstalledMods, formatBytes } from './unifiedApi.js';
import { checkUpdatesForItems, updateKey, updateInstalledMod } from './modUpdates.js';

// Aba "Instalados" — item pedido: "identificar mods JÁ instalados nos
// arquivos do jogo e usar as APIs pra achar quais são". Junta numa lista
// só o que o Project Club instalou (manifesto local) e o que já estava
// nas pastas de mods do jogo (varredura do app desktop, só leitura), e
// pergunta pro servidor qual mod é cada pasta/arquivo (miniatura + nome).

const ORIGIN = {
  managed: { label: 'Instalado pelo Project Club', short: 'Project Club', icon: 'check' },
  detected: { label: 'Detectado nos arquivos', short: 'Detectado', icon: 'search' },
  vortex: { label: 'Instalado por outro gerenciador de mods', short: 'Outro gerenciador', icon: 'link' },
};

// Mod detectado que ainda não está no manifesto local.
const isLoose = (row) => String(row.key || '').startsWith('detected:');

export default function InstalledPanel({
  game, installedState, refreshInstalled, profiles, refreshProfiles, localProfile, onExplore, onAddLocal, localInstallBusy, onUpdatesChanged,
}) {
  const mgr = useModsManager();
  const [scan, setScan] = useState(null); // { items, unsupported }
  const [matches, setMatches] = useState({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState(null);
  const identifiedRef = useRef(new Set());
  // Atualizações: { 'source:sourceId': { latestVersion, updateAvailable, needsAccount } }
  const [updates, setUpdates] = useState({});
  const [updateRun, setUpdateRun] = useState(null); // { list, index, current, done, results }
  const [updatingKey, setUpdatingKey] = useState(null);

  // Re-varre sempre que a lista simples muda (instalou/ativou/apagou).
  useEffect(() => {
    let alive = true;
    scanInstalledModsLocally(game.installPath, game.steamAppId).then((d) => {
      if (!alive) return;
      if (d.success) { setScan({ items: d.items || [], vortex: d.vortex || null }); return; }
      if (d.unsupported) {
        // App de desktop antigo: só os nomes, sem distinguir a origem.
        listInstalledModsLocally(game.installPath, game.steamAppId).then((l) => {
          if (!alive) return;
          const rows = [
            ...(l.enabled || []).map((n) => ({ key: n, name: n, enabled: true, managedByProjectClub: true })),
            ...(l.disabled || []).map((n) => ({ key: n, name: n, enabled: false, managedByProjectClub: true })),
          ];
          setScan({ items: rows, unsupported: true });
        });
        return;
      }
      setScan({ items: [] });
      setError(d.error || 'Não foi possível ler as pastas de mods.');
    }).catch((err) => { if (alive) { setScan({ items: [] }); setError(err.message); } });
    return () => { alive = false; };
  }, [game.installPath, game.steamAppId, installedState]);

  // Identificação pelas APIs (só nomes ainda não perguntados).
  useEffect(() => {
    if (!scan?.items?.length || !game.steamAppId) return;
    const names = scan.items.filter((i) => !i.isLoader).map((i) => i.vortexMod || i.name).filter((n) => !identifiedRef.current.has(n)).slice(0, 60);
    if (names.length === 0) return;
    names.forEach((n) => identifiedRef.current.add(n));
    identifyInstalledMods(game.steamAppId, names, game.displayName)
      .then((d) => setMatches((prev) => ({ ...prev, ...(d.matches || {}) })))
      .catch(() => {});
  }, [scan, game.steamAppId]);

  // Versão mais nova de cada mod instalado pelo Project Club (em lote).
  useEffect(() => {
    if (!scan?.items?.length || scan.unsupported) return undefined;
    let alive = true;
    checkUpdatesForItems(game, scan.items)
      .then((r) => { if (alive) setUpdates(r); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, game.steamAppId]);

  const rows = useMemo(() => (scan?.items || []).map((i) => {
    const upd = i.managedByProjectClub && i.source ? updates[updateKey(i)] : null;
    return {
      ...i,
      origin: i.managedByProjectClub ? 'managed' : i.managedBy === 'vortex' ? 'vortex' : 'detected',
      match: matches[i.vortexMod || i.name] || (i.vortexMod ? { name: i.vortexMod } : null) || (upd?.name ? { name: upd.name, thumbnailUrl: upd.thumbnailUrl } : null),
      update: upd?.updateAvailable ? upd : null,
    };
  }), [scan, matches, updates]);

  const counts = {
    all: rows.length,
    on: rows.filter((r) => r.enabled).length,
    off: rows.filter((r) => !r.enabled).length,
    managed: rows.filter((r) => r.origin === 'managed').length,
    detected: rows.filter((r) => r.origin === 'detected').length,
    vortex: rows.filter((r) => r.origin === 'vortex').length,
    updates: rows.filter((r) => r.update).length,
  };
  const q = query.trim().toLowerCase();
  const shown = rows
    .filter((r) => filter === 'all' || (filter === 'on' && r.enabled) || (filter === 'off' && !r.enabled) || (filter === 'updates' && r.update) || r.origin === filter)
    .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.match?.name || '').toLowerCase().includes(q))
    .sort((a, b) => (b.isLoader ? 1 : 0) - (a.isLoader ? 1 : 0) || (b.update ? 1 : 0) - (a.update ? 1 : 0) || (a.match?.name || a.name).localeCompare(b.match?.name || b.name, 'pt-BR'));

  const afterChange = () => refreshInstalled();

  // Atualiza um mod (reinstala a versão nova por cima).
  const updateOne = async (row) => {
    setUpdatingKey(row.key);
    setError('');
    try {
      const r = await updateInstalledMod({ game, row, mgr });
      if (r.status === 'skipped') setError(`"${row.match?.name || row.name}": ${r.reason}`);
      afterChange();
      onUpdatesChanged?.();
    } catch (err) {
      setError(`Não foi possível atualizar "${row.match?.name || row.name}": ${err.response?.data?.error || err.message}`);
    } finally {
      setUpdatingKey(null);
    }
  };

  // "Atualizar tudo": um por vez, com progresso; pula (e explica) os que
  // precisam do login no site do mod.
  const updateAll = async () => {
    const list = rows.filter((r) => r.update);
    if (list.length === 0) return;
    setError('');
    setUpdateRun({ list, index: 0, current: list[0], done: false, results: [] });
    const results = [];
    for (let i = 0; i < list.length; i += 1) {
      const row = list[i];
      setUpdateRun((r) => ({ ...r, index: i, current: row }));
      if (row.update.needsAccount) {
        results.push({ row, status: 'skipped', needsAccount: true, reason: 'precisa do login no site do mod' });
        continue;
      }
      try {
        const r = await updateInstalledMod({ game, row, mgr });
        results.push({ row, ...r });
      } catch (err) {
        results.push({ row, status: 'failed', reason: err.response?.data?.error || err.message });
      }
      setUpdateRun((r) => ({ ...r, results: [...results] }));
    }
    setUpdateRun((r) => ({ ...r, done: true, current: null, results }));
    afterChange();
    onUpdatesChanged?.();
  };

  const toggle = async (row) => {
    setBusyKey(row.key);
    setError('');
    try {
      const payload = { gameInstallPath: game.installPath, steamAppId: game.steamAppId, enabled: !row.enabled };
      // Detectado (fora do manifesto): identifica pelo caminho exato; os
      // outros (inclusive detectado já "adotado" ao desativar) pela chave.
      const r = await setModEnabledLocally(isLoose(row) ? { ...payload, modName: row.name, path: row.path } : { ...payload, modName: row.key });
      if (r && r.success === false) throw new Error(r.error || 'Falha desconhecida.');
      afterChange();
    } catch (err) {
      setError(`Não foi possível ${row.enabled ? 'desativar' : 'ativar'} "${row.name}": ${err.message}`);
    } finally {
      setBusyKey(null);
    }
  };

  // Apagar remove os arquivos do disco (desativar só tira do alcance do jogo).
  const remove = async (row) => {
    const what = row.origin === 'detected' ? `Apagar "${row.name}" da pasta do jogo?` : `Apagar "${row.match?.name || row.name}"?`;
    if (!confirm(`${what} Isso remove os arquivos dele do disco — não dá pra desfazer.`)) return;
    setError('');
    try {
      const payload = { gameInstallPath: game.installPath, steamAppId: game.steamAppId };
      const r = await uninstallModLocally(isLoose(row) ? { ...payload, modName: row.name, path: row.path } : { ...payload, modName: row.key });
      if (!r.success) throw new Error(r.error || 'Falha desconhecida.');
      afterChange();
    } catch (err) {
      setError(`Não foi possível apagar "${row.name}": ${err.message}`);
    }
  };

  const addToProfile = async (row, profileId) => {
    if (!profileId) return;
    await upsertModProfileItem(profileId, { modName: row.key.replace(/^detected:/, ''), enabled: true });
    refreshProfiles?.();
  };

  return (
    <div className="mdx-tab-body">
      <LoaderBanner profile={localProfile} />
      {localProfile?.loadOrderUnsupported && (
        <p className="mdx-note"><Icon name="info" size={15} /> A ordem de carga destes mods não é feita pelo Project Club — ative e ordene no gerenciador de mods do próprio jogo.</p>
      )}
      <Section
        title="Mods instalados"
        icon="puzzle"
        right={scan && <span className="mdx-muted">{counts.on} ativos · {counts.off} desativados</span>}
      >
        {error && <p className="mdx-error">{error}</p>}
        {(counts.updates > 0 || updateRun) && (
          <UpdatesBanner
            count={counts.updates}
            run={updateRun}
            progress={updateRun?.current ? mgr.progressById?.[progressIdOf(updateRun.current)] : null}
            busy={!!updatingKey}
            onUpdateAll={updateAll}
            onShow={() => setFilter('updates')}
            onClose={() => setUpdateRun(null)}
          />
        )}
        {scan === null ? (
          <div className="mdx-rows">{[0, 1, 2].map((i) => <div key={i} className="mdx-skel mdx-skel-row" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="puzzle"
            title="Nenhum mod instalado ainda"
            action={(
              <div className="mdx-row-center">
                {onExplore && <button type="button" className="mdx-btn primary" onClick={onExplore}><Icon name="compass" size={16} /> Explorar mods</button>}
                <button type="button" className="mdx-btn ghost" disabled={localInstallBusy} onClick={onAddLocal}><Icon name="upload" size={16} /> Adicionar mod do PC</button>
              </div>
            )}
          >
            Procuramos nas pastas de mods deste jogo e não achamos nada. Instale pela aba "Explorar" ou adicione um arquivo do seu PC.
          </EmptyState>
        ) : (
          <>
            <div className="mdx-toolbar compact">
              <SearchField value={query} onChange={setQuery} placeholder="Pesquisar nos mods instalados..." />
              <ChipRow
                label="Mostrar"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'Todos', count: counts.all },
                  { value: 'on', label: 'Ativos', count: counts.on },
                  { value: 'off', label: 'Desativados', count: counts.off },
                  counts.updates > 0 && { value: 'updates', label: 'Com atualização', count: counts.updates },
                  !scan.unsupported && counts.managed > 0 && { value: 'managed', label: 'Do Project Club', count: counts.managed },
                  !scan.unsupported && counts.detected > 0 && { value: 'detected', label: 'Detectados', count: counts.detected },
                  !scan.unsupported && counts.vortex > 0 && { value: 'vortex', label: 'Outro gerenciador', count: counts.vortex },
                ].filter(Boolean)}
              />
            </div>
            {scan.vortex && (
              <p className="mdx-note small"><Icon name="link" size={15} /> <span>Outro gerenciador de mods também cuida de {scan.vortex.modCount === 1 ? '1 mod' : `${scan.vortex.modCount} mods`} deste jogo. Pra desinstalar esses, prefira o próprio gerenciador — se apagar por aqui, ele vai avisar que os arquivos sumiram.</span></p>
            )}
            {counts.detected > 0 && filter !== 'managed' && (
              <p className="mdx-note small"><Icon name="search" size={15} /> <span>{counts.detected === 1 ? '1 mod foi detectado' : `${counts.detected} mods foram detectados`} nas pastas do jogo (instalados antes ou por outro programa). Dá pra ativar, desativar e apagar do mesmo jeito.</span></p>
            )}
            {shown.length === 0 ? (
              <p className="mdx-muted mdx-pad">Nenhum mod com esse filtro.</p>
            ) : (
              <div className="mdx-rows">
                {shown.map((r) => (
                  <InstalledRow
                    key={`${r.origin}-${r.key}-${r.path || ''}`}
                    row={r}
                    busy={busyKey === r.key}
                    updating={updatingKey === r.key || (updateRun && !updateRun.done && updateRun.current?.key === r.key)}
                    updateLocked={!!updatingKey || (!!updateRun && !updateRun.done)}
                    onUpdate={() => updateOne(r)}
                    profiles={profiles}
                    showOrigin={!scan.unsupported}
                    onToggle={() => toggle(r)}
                    onRemove={() => remove(r)}
                    onAddToProfile={(id) => addToProfile(r, id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </Section>
    </div>
  );
}

// Id usado no progresso (onModsProgress) de cada fonte.
function progressIdOf(row) {
  if (row.source === 'modio') return Number(row.sourceId);
  if (row.source === 'nexus') return Number(String(row.sourceId).split(':')[1]);
  return row.sourceId;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Faixa "Atualizações disponíveis" + progresso do "Atualizar tudo".
function UpdatesBanner({ count, run, progress, busy, onUpdateAll, onShow, onClose }) {
  if (run && !run.done) {
    const name = run.current?.update?.name || run.current?.match?.name || run.current?.name;
    return (
      <div className="mdx-upd-banner working" role="status" aria-live="polite">
        <span className="mdx-upd-icon"><Icon name="refresh" size={18} /></span>
        <div className="mdx-upd-text">
          <strong>Atualizando {run.index + 1} de {run.list.length}</strong>
          <span>{name}{progress ? ` — ${progressLabel(progress)}` : ''}</span>
          <ProgressBar percent={progress?.phase === 'downloading' ? progress.percent : ((run.index) / run.list.length) * 100} indeterminate={!progress} />
        </div>
      </div>
    );
  }
  if (run?.done) {
    const ok = run.results.filter((r) => r.status === 'updated').length;
    const skipped = run.results.filter((r) => r.status === 'skipped');
    const failed = run.results.filter((r) => r.status === 'failed');
    return (
      <div className={`mdx-upd-banner ${failed.length ? 'warn' : 'ok'}`} role="status">
        <span className="mdx-upd-icon"><Icon name={failed.length ? 'alert' : 'check'} size={18} strokeWidth={2.2} /></span>
        <div className="mdx-upd-text">
          <strong>{ok > 0 ? `${plural(ok, 'mod atualizado', 'mods atualizados')}` : 'Nenhum mod foi atualizado'}</strong>
          {skipped.length > 0 && (
            <span>
              {plural(skipped.length, 'mod ficou', 'mods ficaram')} de fora: {skipped.map((r) => r.row.update?.name || r.row.match?.name || r.row.name).join(', ')}.
              {skipped.some((r) => r.needsAccount) && ' Esses só baixam com login no site do mod — abra cada um na aba "Explorar" e use "Baixar pela página".'}
            </span>
          )}
          {failed.length > 0 && <span>Falharam: {failed.map((r) => `${r.row.update?.name || r.row.name} (${r.reason})`).join('; ')}.</span>}
        </div>
        <button type="button" className="mdx-icon-btn" aria-label="Fechar" onClick={onClose}><Icon name="close" size={14} /></button>
      </div>
    );
  }
  return (
    <div className="mdx-upd-banner">
      <span className="mdx-upd-icon"><Icon name="refresh" size={18} /></span>
      <div className="mdx-upd-text">
        <strong>{count === 1 ? '1 atualização disponível' : `${count} atualizações disponíveis`}</strong>
        <span>Versões novas dos mods que você instalou pelo Project Club.</span>
      </div>
      <div className="mdx-upd-actions">
        <button type="button" className="mdx-btn ghost sm" onClick={onShow}>Ver quais</button>
        <button type="button" className="mdx-btn primary sm" disabled={busy} onClick={onUpdateAll}><Icon name="download" size={14} /> Atualizar tudo</button>
      </div>
    </div>
  );
}

function InstalledRow({ row, busy, updating, updateLocked, profiles, showOrigin, onToggle, onRemove, onAddToProfile, onUpdate }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const [selected, setSelected] = useState('');
  const [added, setAdded] = useState(false);
  const title = row.match?.name || row.name;
  const thumb = row.match?.thumbnailUrl && !thumbFailed ? proxyImage(row.match.thumbnailUrl) : null;
  const origin = ORIGIN[row.origin];
  const doAdd = async (id) => {
    if (!id) return;
    await onAddToProfile(id);
    setSelected('');
    setAdded(true);
    setTimeout(() => setAdded(false), 2200);
  };
  return (
    <div className={`mdx-row mdx-irow ${row.enabled ? '' : 'off'}`}>
      <span className="mdx-row-icon" style={{ '--h1': hashHue(row.name) }}>
        {thumb ? <img src={thumb} alt="" onError={() => setThumbFailed(true)} /> : <Icon name={row.isLoader ? 'layers' : row.kind === 'file' ? 'file' : 'puzzle'} size={18} />}
      </span>
      <div className="mdx-row-text">
        <strong title={row.path || title}>{title}</strong>
        <span className="mdx-irow-meta">
          <span className={row.enabled ? 'mdx-status on' : 'mdx-status'}>{row.enabled ? 'Ativado' : 'Desativado'}</span>
          {showOrigin && (
            <span className={`mdx-origin ${row.origin}`} title={origin.label}><Icon name={origin.icon} size={11} strokeWidth={2.4} /> {origin.short}</span>
          )}
          {row.isLoader && <span className="mdx-origin loader">Loader</span>}
          {row.update && (
            <span className="mdx-upd-chip" title={`Instalada: v${row.version || '?'} · Nova: v${row.update.latestVersion || '?'}`}>
              <Icon name="refresh" size={11} strokeWidth={2.4} /> Atualização disponível
              {row.update.latestVersion && <em>v{row.version} → v{row.update.latestVersion}</em>}
            </span>
          )}
          {row.match?.source && <SourceChip source={row.match.source} />}
          {row.match && row.match.name !== row.name && <span className="mdx-irow-file" title={row.name}>{row.name}</span>}
          {row.location && <span className="mdx-irow-file" title={row.path}>{row.location}</span>}
          {row.size > 0 && <span className="mdx-irow-file">{formatBytes(row.size)}</span>}
          {row.missingFiles > 0 && <span className="mdx-irow-warn">{row.missingFiles} arquivo(s) sumiram</span>}
          {added && <span className="mdx-status on">adicionado ao modpack</span>}
        </span>
      </div>
      <div className="mdx-row-actions">
        {row.update && (
          <button type="button" className="mdx-btn primary sm" disabled={updateLocked} onClick={onUpdate} title={row.update.needsAccount ? 'Este mod pode precisar do login no site do mod' : `Atualizar para v${row.update.latestVersion}`}>
            <Icon name="refresh" size={14} /> {updating ? 'Atualizando...' : 'Atualizar'}
          </button>
        )}
        {profiles?.length > 0 && (
          <select className="mdx-mini-select" value={selected} onChange={(e) => { setSelected(e.target.value); doAdd(e.target.value); }} aria-label="Adicionar a um modpack">
            <option value="">+ Modpack</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={row.enabled}
          aria-label={row.enabled ? 'Desativar' : 'Ativar'}
          title={row.enabled ? 'Desativar' : 'Ativar'}
          className={`mdx-switch ${row.enabled ? 'on' : ''}`}
          disabled={busy}
          onClick={onToggle}
        >
          <span />
        </button>
        <button type="button" className="mdx-btn ghost danger sm icon-only-mobile" onClick={onRemove} title="Apagar">
          <Icon name="trash" size={15} /> <span>Apagar</span>
        </button>
      </div>
    </div>
  );
}

// Faixa com o estado do loader do jogo (BepInEx, SMAPI, MelonLoader...).
export function LoaderBanner({ profile }) {
  if (!profile) return null;
  if (profile.blocked) {
    return <div className="mdx-loader-banner bad"><Icon name="alert" size={18} /><div><strong>Mods bloqueados neste jogo</strong><span>{profile.blocked}</span></div></div>;
  }
  const l = profile.loader;
  if (!l) return null;
  if (l.installed) {
    return (
      <div className="mdx-loader-banner ok">
        <Icon name="check" size={18} strokeWidth={2.4} />
        <div><strong>{l.label} instalado</strong><span>Tudo pronto pra usar mods que precisam do {l.label}.</span></div>
      </div>
    );
  }
  return (
    <div className={`mdx-loader-banner ${l.required ? 'warn' : 'info'}`}>
      <Icon name={l.required ? 'alert' : 'info'} size={18} />
      <div>
        <strong>{l.required ? `${l.label} não encontrado` : `${l.label} (opcional) não encontrado`}</strong>
        <span>{l.autoInstall ? `O Project Club instala o ${l.label} sozinho junto com o primeiro mod que precisar dele.` : l.howTo}</span>
      </div>
    </div>
  );
}

// "Como este jogo usa mods" (aba Arquivos): loader, pastas e avisos.
export function InstallProfileCard({ profile, loading }) {
  if (loading) return <div className="mdx-skel mdx-skel-editor" style={{ minHeight: 160 }} />;
  if (!profile) {
    return <p className="mdx-muted">Atualize o app de desktop pra ver como este jogo usa mods.</p>;
  }
  const certainty = {
    known: 'Perfil conhecido',
    partial: 'Perfil parcial — pode faltar algum caso',
    generic: 'Sem perfil específico — detecção automática',
  }[profile.certainty] || null;
  return (
    <div className="mdx-howto">
      <div className="mdx-howto-head">
        <span className="mdx-howto-icon"><Icon name="layers" size={20} /></span>
        <div>
          <strong>{profile.name}</strong>
          {certainty && <span className={`mdx-howto-cert ${profile.certainty}`}>{certainty}</span>}
        </div>
      </div>
      <dl className="mdx-howto-grid">
        <div>
          <dt>Loader</dt>
          <dd>
            {profile.loader ? (
              <>
                {profile.loader.label}{' '}
                <span className={`mdx-origin ${profile.loader.installed ? 'managed' : 'warn'}`}>{profile.loader.installed ? 'instalado' : profile.loader.required ? 'falta instalar' : 'opcional'}</span>
              </>
            ) : 'Nenhum — os mods vão direto nas pastas do jogo'}
          </dd>
        </div>
        {profile.fileTypes?.length > 0 && (
          <div>
            <dt>Tipos de arquivo</dt>
            <dd className="mdx-howto-exts">{profile.fileTypes.map((e) => <code key={e}>{e}</code>)}{(profile.keepArchive || []).length > 0 && <span className="mdx-muted"> (o .zip fica como está)</span>}</dd>
          </div>
        )}
      </dl>
      {profile.folders?.length > 0 && (
        <div className="mdx-howto-folders">
          {profile.folders.map((f) => (
            <div key={f.id} className="mdx-howto-folder">
              <Icon name="folder" size={15} />
              <div>
                <strong>{f.label}{f.primary && <span className="mdx-origin managed">principal</span>}{!f.exists && <span className="mdx-origin">ainda não existe</span>}</strong>
                <code title={f.path}>{f.path}</code>
              </div>
            </div>
          ))}
        </div>
      )}
      <ul className="mdx-howto-notes">
        {(profile.notes || []).map((n) => <li key={n}>{n}</li>)}
        {profile.unsupportedExts?.length > 0 && <li>Não suportado: {profile.unsupportedExts.join(', ')}.</li>}
        {profile.disableMethod && <li>{profile.disableMethod}</li>}
      </ul>
    </div>
  );
}
