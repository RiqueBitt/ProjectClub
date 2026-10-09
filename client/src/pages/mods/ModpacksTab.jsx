import { useLiveRefresh, mergeFirstPage } from '../../utils/liveRefresh';
import { searchUnifiedMods } from './unifiedApi.js';
import { getNexusMod } from '../../api/endpoints';
import { installNexusFile, nexusIds } from './NexusViews.jsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  listPublicModpacks, listMyModpacks, getModpack, createModpack, updateModpack, deleteModpack, uploadModpackCover,
  voteModpack, registerModpackDownload,
  getMod, getModDownload, listMods, getGameBananaMod, browseGameBanana, getThunderstorePackage, listThunderstorePackages, listWorkshopItems,
} from '../../api/endpoints';
import {
  installModLocally, installThunderstorePackageLocally, applyProfileLocally, saveModpackLocal, modFolderName, openWorkshopItemInSteam,
} from '../../utils/mods';
import { proxyImage } from '../../utils/imageProxy';
import UserAvatar from '../../components/UserAvatar.jsx';
import {
  Icon, EmptyState, SearchField, ChipRow, Section, ProgressBar, progressLabel, hashHue, formatCount, useModsManager, SOURCE_META,
} from './shared.jsx';
import { MODPACK_SOURCE_LABEL, steamHeaderUrl, itemFolderName, consumePendingModpack, peekPendingModpack } from './modpackShared.js';
import '../../styles/modpacks.css';

// Item pedido: "sistema de criar modpacks e postar pra outras pessoas
// baixarem, com like, dislike e quantas pessoas já baixaram". Vale pra
// QUALQUER jogo (chave = steamAppId). Três partes:
// - Meus modpacks: criar/editar (mods instalados + mods buscados em cada
//   fonte), publicar/despublicar, ativar/jogar (applyProfileLocally).
// - Da comunidade: modpacks públicos do jogo, com like/dislike, contagem
//   de downloads e "Baixar modpack" (instala item por item com o
//   instalador de cada fonte, em sequência).
// - Perfis e coleções (só mod.io): a aba antiga continua acessível.

// Ícones que não existem no mapa compartilhado (shared.jsx).
const MP_PATHS = {
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01',
  minus: 'M5 12h14',
};
function MpIcon({ name, size = 16, strokeWidth = 1.8 }) {
  if (!MP_PATHS[name]) return <Icon name={name} size={size} strokeWidth={strokeWidth} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mdx-icon">
      <path d={MP_PATHS[name]} />
    </svg>
  );
}

const SORTS = [
  { value: 'popular', label: 'Populares' },
  { value: 'new', label: 'Novos' },
  { value: 'downloads', label: 'Mais baixados' },
];

const isLoaderPackage = (name) => /bepinexpack/i.test(name || '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Capa do modpack: a imagem dele (ou do 1º mod) -> arte da Steam -> gradiente.
export function ModpackCover({ modpack, className = '' }) {
  const candidates = useMemo(() => [
    modpack.coverUrl ? proxyImage(modpack.coverUrl) : null,
    steamHeaderUrl(modpack.steamAppId),
  ].filter(Boolean), [modpack.coverUrl, modpack.steamAppId]);
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [candidates]);
  const hue = hashHue(modpack.name);
  return (
    <div className={`mpk-cover ${className}`} style={{ '--h1': hue, '--h2': (hue + 50) % 360 }}>
      {idx < candidates.length
        ? <img src={candidates[idx]} alt="" loading="lazy" onError={() => setIdx((i) => i + 1)} />
        : <span className="mpk-cover-glyph"><Icon name="layers" size={30} /></span>}
    </div>
  );
}

function ItemThumb({ item }) {
  const [failed, setFailed] = useState(!item.thumbnailUrl);
  return (
    <span className="mpk-item-thumb" style={{ '--h1': hashHue(item.name) }}>
      {!failed && <img src={proxyImage(item.thumbnailUrl)} alt="" loading="lazy" onError={() => setFailed(true)} />}
      {failed && <Icon name={item.source === 'local' ? 'folder' : 'puzzle'} size={15} />}
    </span>
  );
}

function SourceTag({ source }) {
  // Origem do mod não aparece mais (item pedido) — só marca o que é arquivo local.
  if (source !== 'local') return null;
  return <span className="mpk-source" style={{ '--src': 'var(--text-muted)' }}>Arquivo local</span>;
}

function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="mpk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`mpk-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="mpk-modal-head">
          <h3>{title}</h3>
          <button type="button" className="mdx-icon-btn" aria-label="Fechar" onClick={onClose}><Icon name="close" size={16} /></button>
        </header>
        <div className="mpk-modal-body">{children}</div>
        {footer && <footer className="mpk-modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

// Like / dislike com contagem; o meu voto fica destacado.
function VoteButtons({ modpack, disabled, onVote, size = 'sm' }) {
  return (
    <div className={`mpk-votes ${size}`}>
      <button type="button" className={`mpk-vote up ${modpack.myVote === 1 ? 'on' : ''}`} disabled={disabled} onClick={() => onVote(1)} aria-pressed={modpack.myVote === 1} title={disabled ? 'Curtidas' : 'Curtir'}>
        <Icon name="thumb" size={15} /> {formatCount(modpack.likeCount)}
      </button>
      <button type="button" className={`mpk-vote down ${modpack.myVote === -1 ? 'on' : ''}`} disabled={disabled} onClick={() => onVote(-1)} aria-pressed={modpack.myVote === -1} title={disabled ? 'Não curtidas' : 'Não curti'}>
        <span className="mpk-flip"><Icon name="thumb" size={15} /></span> {formatCount(modpack.dislikeCount)}
      </button>
    </div>
  );
}

export default function ModpacksTab({ game, desktopReady, installedState, legacyProfiles, legacy }) {
  const { user } = useAuth();
  const mgr = useModsManager();
  const pending = useRef(peekPendingModpack(game.steamAppId));
  const [view, setView] = useState(pending.current ? 'community' : 'mine');

  const [mine, setMine] = useState(null);
  const [community, setCommunity] = useState(null);
  const [communityTotal, setCommunityTotal] = useState(0);
  const [communityPage, setCommunityPage] = useState(1);
  const [communityHasMore, setCommunityHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('popular');
  const [communityError, setCommunityError] = useState('');
  const [communityReload, setCommunityReload] = useState(0);

  const [editing, setEditing] = useState(null); // modpack (ou {} pra novo)
  const [opened, setOpened] = useState(null); // modpack aberto no detalhe
  const [run, setRun] = useState(null); // download em andamento
  const [notice, setNotice] = useState(null); // { tone, text }
  const [activatingId, setActivatingId] = useState(null);

  const refreshMine = useCallback(() => {
    listMyModpacks(game.steamAppId).then((d) => setMine(d.modpacks || [])).catch(() => setMine([]));
  }, [game.steamAppId]);
  useEffect(refreshMine, [refreshMine]);

  // Ao vivo (a cada 11 s): meus modpacks e a 1ª página da comunidade
  // (curtidas, downloads, novos modpacks), sem perder o que já carregou.
  useLiveRefresh(async (ctx) => {
    const [m, c] = await Promise.all([
      listMyModpacks(game.steamAppId),
      listPublicModpacks({ steamAppId: game.steamAppId, q: query.trim() || undefined, sort, page: 1 }),
    ]);
    if (!ctx.ok()) return;
    ctx.put(setMine)(m.modpacks || []);
    setCommunity((prev) => (prev ? mergeFirstPage(prev, c.modpacks || []) : prev));
    setCommunityTotal(c.total || 0);
  }, { key: `${game.steamAppId}:${query}:${sort}` });

  useEffect(() => {
    setCommunity(null);
    setCommunityError('');
    const t = setTimeout(() => {
      listPublicModpacks({ steamAppId: game.steamAppId, q: query.trim() || undefined, sort, page: 1 })
        .then((d) => { setCommunity(d.modpacks || []); setCommunityTotal(d.total || 0); setCommunityPage(1); setCommunityHasMore(!!d.hasMore); })
        .catch((err) => { setCommunity([]); setCommunityError(err.response?.data?.error || 'Não foi possível carregar os modpacks agora.'); });
    }, 250);
    return () => clearTimeout(t);
  }, [game.steamAppId, query, sort, communityReload]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const d = await listPublicModpacks({ steamAppId: game.steamAppId, q: query.trim() || undefined, sort, page: communityPage + 1 });
      setCommunity((prev) => [...prev, ...(d.modpacks || [])]);
      setCommunityPage(d.page); setCommunityHasMore(!!d.hasMore);
    } catch { /* fica como está */ } finally { setLoadingMore(false); }
  };

  // Abrir direto um modpack (vindo do "Ver modpack" no perfil).
  useEffect(() => {
    const req = consumePendingModpack(game.steamAppId);
    if (!req?.modpackId) return;
    getModpack(req.modpackId).then((d) => { if (d.modpack) { setOpened(d.modpack); if (d.modpack.authorId === user.id) setView('mine'); } }).catch(() => {});
  }, [game.steamAppId, user.id]);

  // Atualiza o mesmo modpack em todas as listas abertas.
  const patchEverywhere = useCallback((id, patch) => {
    const apply = (list) => (list ? list.map((m) => (m.id === id ? { ...m, ...patch } : m)) : list);
    setMine(apply); setCommunity(apply);
    setOpened((o) => (o && o.id === id ? { ...o, ...patch } : o));
  }, []);

  const doVote = async (mp, value) => {
    try {
      const r = await voteModpack(mp.id, value);
      patchEverywhere(mp.id, r);
    } catch (err) {
      setNotice({ tone: 'error', text: err.response?.data?.error || 'Não foi possível votar agora.' });
    }
  };

  const itemInstalled = useCallback((item) => {
    if (item.source === 'workshop') return mgr.workshopIds?.includes(item.sourceId);
    const folder = itemFolderName(item);
    return !!folder && mgr.installedFolders.has(folder);
  }, [mgr.installedFolders, mgr.workshopIds]);

  // ---------- Baixar modpack: instala cada item em sequência ----------
  const installOne = async (item, onStep) => {
    if (item.source === 'local') {
      return itemInstalled(item) ? { status: 'already' } : { status: 'skipped', reason: 'Mod local de quem criou — não pode ser baixado.' };
    }
    if (item.source === 'workshop') {
      if (!game.sources.workshop) return { status: 'skipped', reason: 'Este jogo não usa o Steam Workshop aqui.' };
      if (itemInstalled(item)) return { status: 'already' };
      return { status: 'skipped', reason: 'Inscreva-se pela Steam.', steam: true };
    }
    if (item.source === 'modio') {
      const modioGameId = game.sources.modio?.modioGameId;
      if (!modioGameId) return { status: 'skipped', reason: 'Este mod não está disponível para este jogo.' };
      const id = Number(item.sourceId);
      const detail = await getMod(modioGameId, id);
      const name = detail.mod?.name || item.name;
      if (mgr.installedFolders.has(modFolderName(name))) return { status: 'already' };
      onStep(id);
      mgr.trackInstall(id, name);
      const download = await getModDownload(modioGameId, id);
      const result = await installModLocally({ downloadUrl: download.downloadUrl, filename: download.filename, gameInstallPath: game.installPath, modName: name, modioModId: id });
      if (!result.success) { mgr.untrackInstall(id); throw new Error(result.error || 'falha desconhecida'); }
      mgr.completeInstall(id);
      return { status: 'installed' };
    }
    if (item.source === 'gamebanana') {
      if (!game.sources.gamebanana) return { status: 'skipped', reason: 'Este mod não está disponível para este jogo.' };
      const id = Number(item.sourceId);
      const d = await getGameBananaMod(id);
      const data = d.mod || {};
      const name = data.name || item.name;
      if (mgr.installedFolders.has(modFolderName(name))) return { status: 'already' };
      const file = data.files?.[0];
      if (!file) return { status: 'skipped', reason: 'Sem arquivo pra baixar.' };
      onStep(id);
      mgr.trackInstall(id, name);
      const result = await installModLocally({ downloadUrl: file.downloadUrl, filename: file.filename, gameInstallPath: game.installPath, modName: name, modioModId: id });
      if (!result.success) { mgr.untrackInstall(id); throw new Error(result.error || 'falha desconhecida'); }
      mgr.completeInstall(id);
      return { status: 'installed' };
    }
    if (item.source === 'thunderstore') {
      const community = game.sources.thunderstore?.thunderstoreCommunity;
      if (!community) return { status: 'skipped', reason: 'Este mod não está disponível para este jogo.' };
      const d = await getThunderstorePackage(community, item.sourceId);
      const pkg = d.package;
      const queue = [...(d.dependencies || []), { fullName: pkg.fullName, name: pkg.name, downloadUrl: pkg.version?.downloadUrl }]
        .filter((p) => !mgr.installedFolders.has(modFolderName(p.fullName)));
      if (queue.length === 0) return { status: 'already' };
      for (const p of queue) {
        onStep(p.fullName);
        mgr.trackInstall(p.fullName, p.name);
        const result = await installThunderstorePackageLocally({
          downloadUrl: p.downloadUrl, filename: `${p.fullName}.zip`, gameInstallPath: game.installPath, fullName: p.fullName, isLoader: isLoaderPackage(p.name),
        });
        if (!result.success) { mgr.untrackInstall(p.fullName); throw new Error(`${p.name}: ${result.error || 'falha desconhecida'}`); }
        mgr.completeInstall(p.fullName);
      }
      return { status: 'installed' };
    }
    if (item.source === 'nexus') {
      const { domain, modId } = nexusIds(item.sourceId);
      if (!domain || !modId) return { status: 'skipped', reason: 'Mod inválido.' };
      const { mod } = await getNexusMod(domain, modId);
      const name = mod?.name || item.name;
      if (mgr.installedFolders.has(modFolderName(name))) return { status: 'already' };
      const file = (mod.files || []).find((f) => f.primary) || (mod.files || []).find((f) => f.category === 'MAIN') || mod.files?.[0];
      if (!file) return { status: 'skipped', reason: 'Sem arquivo pra baixar.' };
      onStep(modId);
      mgr.trackInstall(modId, name);
      try {
        await installNexusFile({ game, domain, modId, file, modName: name });
      } catch (err) {
        mgr.untrackInstall(modId);
        // Conta grátis: precisa do botão "Mod Manager Download" do site.
        if (err.needsManager) return { status: 'skipped', reason: 'Este mod precisa ser baixado pela página dele (abra o mod e use "Baixar pela página").' };
        throw err;
      }
      mgr.completeInstall(modId);
      return { status: 'installed' };
    }
    return { status: 'skipped', reason: 'Fonte desconhecida.' };
  };

  const startDownload = async (mp) => {
    if (!desktopReady) { setNotice({ tone: 'error', text: 'Baixar modpacks só funciona pelo app de desktop do Project Club.' }); return; }
    if (!game.installPath) { setNotice({ tone: 'error', text: 'Não sabemos onde este jogo está instalado — abra-o pela Steam pra detectarmos de novo.' }); return; }
    let items = mp.items;
    if (!items) {
      try { items = (await getModpack(mp.id)).modpack.items; } catch { setNotice({ tone: 'error', text: 'Não foi possível abrir este modpack.' }); return; }
    }
    const rows = items.map((item) => ({ item, status: 'pending' }));
    setRun({ modpack: mp, rows, index: 0, stepId: null, done: false });
    for (let i = 0; i < rows.length; i += 1) {
      setRun((r) => ({ ...r, index: i, stepId: null, rows: r.rows.map((x, j) => (j === i ? { ...x, status: 'working' } : x)) }));
      let res;
      try {
        res = await installOne(rows[i].item, (stepId) => setRun((r) => ({ ...r, stepId })));
      } catch (err) {
        res = { status: 'failed', reason: err.response?.data?.error || err.message };
      }
      setRun((r) => ({ ...r, rows: r.rows.map((x, j) => (j === i ? { ...x, ...res } : x)) }));
    }
    mgr.refreshInstalled();
    let downloadCount = mp.downloadCount;
    try { downloadCount = (await registerModpackDownload(mp.id)).downloadCount; } catch { /* não trava o resumo */ }
    patchEverywhere(mp.id, { downloadCount, downloadedByMe: mp.authorId !== user.id ? true : mp.downloadedByMe });
    setRun((r) => ({ ...r, done: true, stepId: null }));
  };

  // ---------- Meus modpacks: ativar / publicar / apagar ----------
  const activate = async (mp, alsoPlay) => {
    if (!game.installPath) { setNotice({ tone: 'error', text: 'Não sabemos onde este jogo está instalado.' }); return; }
    setActivatingId(mp.id);
    setNotice(null);
    try {
      const enabledModNames = (mp.items || []).map(itemFolderName).filter(Boolean);
      const result = await applyProfileLocally({ gameInstallPath: game.installPath, enabledModNames });
      mgr.refreshInstalled();
      saveModpackLocal({ gameKey: game.steamAppId, gameDisplayName: game.displayName, packName: mp.name, mods: enabledModNames }).catch(() => {});
      const missing = result?.missing?.length || 0;
      setNotice({ tone: missing ? 'warn' : 'ok', text: missing ? `Modpack ativado, mas ${plural(missing, 'mod dele ainda não está instalado', 'mods dele ainda não estão instalados')} neste computador.` : `Modpack "${mp.name}" ativado.` });
      if (alsoPlay && game.steamAppId) window.electronAPI?.openExternal?.(`steam://run/${game.steamAppId}`);
    } catch (err) {
      setNotice({ tone: 'error', text: `Não foi possível ativar: ${err.message}` });
    } finally {
      setActivatingId(null);
    }
  };

  const togglePublic = async (mp) => {
    try {
      const d = await updateModpack(mp.id, { isPublic: !mp.isPublic });
      patchEverywhere(mp.id, d.modpack);
      setNotice({ tone: 'ok', text: d.modpack.isPublic ? `"${mp.name}" agora é público — qualquer pessoa com o jogo pode baixar.` : `"${mp.name}" voltou a ser privado.` });
      setCommunityReload((n) => n + 1);
    } catch (err) {
      setNotice({ tone: 'error', text: err.response?.data?.error || 'Não foi possível salvar.' });
    }
  };

  const remove = async (mp) => {
    if (!confirm(`Apagar o modpack "${mp.name}"? Isso não desinstala nenhum mod, só apaga o modpack.`)) return;
    try {
      await deleteModpack(mp.id);
      setMine((list) => list.filter((m) => m.id !== mp.id));
      setCommunity((list) => (list ? list.filter((m) => m.id !== mp.id) : list));
      setOpened((o) => (o?.id === mp.id ? null : o));
    } catch (err) {
      setNotice({ tone: 'error', text: err.response?.data?.error || 'Não foi possível apagar.' });
    }
  };

  const onSaved = (saved, isNew) => {
    setMine((list) => (isNew ? [saved, ...(list || [])] : (list || []).map((m) => (m.id === saved.id ? saved : m))));
    patchEverywhere(saved.id, saved);
    setEditing(null);
    setCommunityReload((n) => n + 1);
    setNotice({ tone: 'ok', text: isNew ? `Modpack "${saved.name}" criado.` : 'Alterações salvas.' });
  };

  const views = [
    { key: 'mine', label: 'Meus modpacks', icon: 'layers', count: mine?.length || null },
    { key: 'community', label: 'Da comunidade', icon: 'users', count: communityTotal || null },
    legacy && { key: 'legacy', label: 'Perfis e coleções', icon: 'box' },
  ].filter(Boolean);

  return (
    <div className="mdx-tab-body mpk">
      <div className="mpk-pills" role="tablist" aria-label="Modpacks">
        {views.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={`mpk-pill ${view === v.key ? 'active' : ''}`} onClick={() => setView(v.key)}>
            <Icon name={v.icon} size={15} /> {v.label}
            {v.count != null && <span className="mpk-pill-count">{v.count}</span>}
          </button>
        ))}
      </div>

      {notice && (
        <p className={`mpk-notice ${notice.tone}`}>
          <Icon name={notice.tone === 'ok' ? 'check' : notice.tone === 'warn' ? 'info' : 'alert'} size={15} />
          <span>{notice.text}</span>
          <button type="button" className="mdx-icon-btn" aria-label="Fechar aviso" onClick={() => setNotice(null)}><Icon name="close" size={13} /></button>
        </p>
      )}

      {view === 'mine' && (
        <Section
          title="Meus modpacks"
          icon="layers"
          right={<button type="button" className="mdx-btn primary sm" onClick={() => setEditing({})}><Icon name="plus" size={15} /> Criar modpack</button>}
        >
          <p className="mdx-muted mpk-lead">
            Junte mods deste jogo num pacote, ative tudo de uma vez e, se quiser, publique pra outras pessoas baixarem.
          </p>
          {mine === null ? (
            <div className="mpk-grid">{[0, 1, 2].map((i) => <div key={i} className="mdx-skel mpk-skel-card" />)}</div>
          ) : mine.length === 0 ? (
            <EmptyState
              icon="layers"
              title="Você ainda não tem modpacks"
              action={<div className="mdx-row-center"><button type="button" className="mdx-btn primary" onClick={() => setEditing({})}><Icon name="plus" size={16} /> Criar o primeiro</button></div>}
            >
              Escolha mods que você já instalou ou busque nas fontes deste jogo.
            </EmptyState>
          ) : (
            <div className="mpk-grid">
              {mine.map((mp) => (
                <article key={mp.id} className="mpk-card">
                  <button type="button" className="mpk-card-media" onClick={() => setOpened(mp)} aria-label={`Abrir ${mp.name}`}>
                    <ModpackCover modpack={mp} />
                    <span className={`mpk-badge ${mp.isPublic ? 'public' : ''}`}>
                      <MpIcon name={mp.isPublic ? 'globe' : 'lock'} size={12} /> {mp.isPublic ? 'Público' : 'Privado'}
                    </span>
                  </button>
                  <div className="mpk-card-body">
                    <button type="button" className="mpk-card-title" onClick={() => setOpened(mp)}>{mp.name}</button>
                    <div className="mpk-card-stats">
                      <span><Icon name="puzzle" size={13} /> {plural(mp.itemCount, 'mod', 'mods')}</span>
                      {mp.isPublic && <span><Icon name="thumb" size={13} /> {formatCount(mp.likeCount)}</span>}
                      {mp.isPublic && <span><span className="mpk-flip"><Icon name="thumb" size={13} /></span> {formatCount(mp.dislikeCount)}</span>}
                      {mp.isPublic && <span><Icon name="download" size={13} /> {formatCount(mp.downloadCount)}</span>}
                    </div>
                    <ItemChips items={mp.items} itemInstalled={itemInstalled} />
                    <div className="mpk-card-actions">
                      {desktopReady && (
                        <>
                          <button type="button" className="mdx-btn ghost sm" disabled={activatingId === mp.id || !mp.itemCount} onClick={() => activate(mp, false)}>
                            <Icon name="check" size={14} /> {activatingId === mp.id ? 'Ativando...' : 'Ativar'}
                          </button>
                          <button type="button" className="mdx-btn play sm" disabled={activatingId === mp.id || !mp.itemCount} onClick={() => activate(mp, true)}>
                            <Icon name="play" size={13} filled /> Jogar
                          </button>
                        </>
                      )}
                      <span className="mpk-spacer" />
                      <button type="button" className={`mdx-btn ghost sm ${mp.isPublic ? 'on' : ''}`} onClick={() => togglePublic(mp)} title={mp.isPublic ? 'Tornar privado' : 'Publicar pra comunidade'}>
                        <MpIcon name={mp.isPublic ? 'lock' : 'globe'} size={14} /> {mp.isPublic ? 'Despublicar' : 'Publicar'}
                      </button>
                      <button type="button" className="mdx-icon-btn" title="Editar" aria-label="Editar" onClick={() => setEditing(mp)}><MpIcon name="edit" size={15} /></button>
                      <button type="button" className="mdx-icon-btn danger" title="Apagar" aria-label="Apagar" onClick={() => remove(mp)}><Icon name="trash" size={15} /></button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {!desktopReady && <p className="mdx-note"><Icon name="monitor" size={15} /> Ativar e baixar modpacks só funciona pelo app de desktop — aqui dá pra criar, editar e publicar.</p>}
        </Section>
      )}

      {view === 'community' && (
        <Section title="Da comunidade" icon="users" right={community && <span className="mdx-muted">{plural(communityTotal, 'modpack', 'modpacks')}</span>}>
          <div className="mdx-toolbar compact">
            <SearchField value={query} onChange={setQuery} placeholder="Pesquisar modpacks deste jogo..." />
            <ChipRow options={SORTS} value={sort} onChange={setSort} label="Ordenar" />
          </div>
          {community === null ? (
            <div className="mpk-grid">{[0, 1, 2].map((i) => <div key={i} className="mdx-skel mpk-skel-card" />)}</div>
          ) : community.length === 0 ? (
            <EmptyState icon={communityError ? 'alert' : 'users'} tone={communityError ? 'danger' : undefined} title={communityError ? 'Não foi possível carregar' : query ? 'Nenhum modpack com esse nome' : 'Ninguém publicou um modpack ainda'}>
              {communityError || (query ? 'Tente outra busca.' : 'Crie um em "Meus modpacks" e publique — ele aparece aqui pra todo mundo.')}
            </EmptyState>
          ) : (
            <>
              <div className="mpk-grid">
                {community.map((mp) => (
                  <article key={mp.id} className="mpk-card">
                    <button type="button" className="mpk-card-media" onClick={() => setOpened(mp)} aria-label={`Abrir ${mp.name}`}>
                      <ModpackCover modpack={mp} />
                      {mp.downloadedByMe && <span className="mpk-badge public"><Icon name="check" size={12} strokeWidth={2.6} /> Baixado</span>}
                    </button>
                    <div className="mpk-card-body">
                      <button type="button" className="mpk-card-title" onClick={() => setOpened(mp)}>{mp.name}</button>
                      <div className="mpk-author">
                        {mp.author && <UserAvatar user={mp.author} size={20} />}
                        <span>por <strong>{mp.author?.displayName || 'alguém'}</strong></span>
                        <span className="mpk-dot" />
                        <span>{plural(mp.itemCount, 'mod', 'mods')}</span>
                      </div>
                      {mp.description && <p className="mpk-desc">{mp.description}</p>}
                      <div className="mpk-card-actions">
                        <VoteButtons modpack={mp} disabled={mp.authorId === user.id} onVote={(v) => doVote(mp, v)} />
                        <span className="mpk-downloads" title="Pessoas que baixaram"><Icon name="download" size={14} /> {formatCount(mp.downloadCount)}</span>
                        <span className="mpk-spacer" />
                        <button type="button" className="mdx-btn primary sm" disabled={!!run && !run.done} onClick={() => startDownload(mp)} title={desktopReady ? undefined : 'Só no app de desktop'}>
                          <Icon name="download" size={14} /> Baixar modpack
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {communityHasMore && (
                <button type="button" className="mdx-load-more" disabled={loadingMore} onClick={loadMore}>
                  {loadingMore ? 'Carregando...' : `Ver mais (${community.length} de ${communityTotal})`}
                </button>
              )}
            </>
          )}
          {!desktopReady && <p className="mdx-note"><Icon name="monitor" size={15} /> Baixar modpacks só funciona pelo app de desktop do Project Club.</p>}
        </Section>
      )}

      {view === 'legacy' && legacy}

      {editing && (
        <ModpackEditor
          game={game}
          initial={editing}
          installedState={installedState}
          legacyProfiles={legacyProfiles}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      {opened && (
        <ModpackDetail
          modpack={opened}
          isMine={opened.authorId === user.id}
          itemInstalled={itemInstalled}
          desktopReady={desktopReady}
          busy={!!run && !run.done}
          onClose={() => setOpened(null)}
          onVote={(v) => doVote(opened, v)}
          onDownload={() => { const mp = opened; setOpened(null); startDownload(mp); }}
          onEdit={() => { setEditing(opened); setOpened(null); }}
        />
      )}

      {run && (
        <DownloadRun run={run} progressById={mgr.progressById} onClose={() => setRun(null)} />
      )}
    </div>
  );
}

// Primeiros mods do modpack como chips (+N no fim).
function ItemChips({ items = [], itemInstalled, max = 5 }) {
  if (items.length === 0) return <p className="mdx-muted mdx-small">Nenhum mod ainda — clique em editar pra adicionar.</p>;
  return (
    <div className="mpk-chips">
      {items.slice(0, max).map((i) => (
        <span key={`${i.source}:${i.sourceId}`} className={`mpk-chip ${itemInstalled?.(i) ? 'installed' : ''}`} title={i.name}>
          {i.name}
        </span>
      ))}
      {items.length > max && <span className="mpk-chip more">+{items.length - max}</span>}
    </div>
  );
}

// ---------- Detalhe (lista completa de mods + votar + baixar) ----------
function ModpackDetail({ modpack, isMine, itemInstalled, desktopReady, busy, onClose, onVote, onDownload, onEdit }) {
  const [items, setItems] = useState(modpack.items || null);
  useEffect(() => {
    if (modpack.items) { setItems(modpack.items); return; }
    getModpack(modpack.id).then((d) => setItems(d.modpack.items)).catch(() => setItems([]));
  }, [modpack.id, modpack.items]);
  const list = items || [];
  const localCount = list.filter((i) => i.source === 'local').length;
  return (
    <Modal
      title={modpack.name}
      onClose={onClose}
      wide
      footer={(
        <>
          {modpack.isPublic && <VoteButtons modpack={modpack} disabled={isMine} onVote={onVote} />}
          <span className="mpk-downloads"><Icon name="download" size={14} /> {plural(modpack.downloadCount, 'download', 'downloads')}</span>
          <span className="mpk-spacer" />
          {isMine && <button type="button" className="mdx-btn ghost sm" onClick={onEdit}><MpIcon name="edit" size={14} /> Editar</button>}
          <button type="button" className="mdx-btn primary" disabled={busy || !desktopReady || list.length === 0} onClick={onDownload}>
            <Icon name="download" size={16} /> Baixar modpack
          </button>
        </>
      )}
    >
      <div className="mpk-detail-hero">
        <ModpackCover modpack={modpack} className="wide" />
        <div className="mpk-detail-info">
          <span className="mpk-eyebrow">{modpack.gameName}</span>
          <div className="mpk-author">
            {modpack.author && <UserAvatar user={modpack.author} size={22} />}
            <span>por <strong>{modpack.author?.displayName || 'alguém'}</strong></span>
          </div>
          <div className="mpk-detail-chips">
            <span className="mpk-chip"><Icon name="puzzle" size={12} /> {plural(list.length, 'mod', 'mods')}</span>
            <span className={`mpk-chip ${modpack.isPublic ? 'installed' : ''}`}><MpIcon name={modpack.isPublic ? 'globe' : 'lock'} size={12} /> {modpack.isPublic ? 'Público' : 'Privado'}</span>
          </div>
          {modpack.description && <p className="mpk-desc full">{modpack.description}</p>}
        </div>
      </div>
      {!desktopReady && <p className="mdx-note"><Icon name="monitor" size={15} /> Baixar só funciona pelo app de desktop.</p>}
      {localCount > 0 && (
        <p className="mdx-note"><Icon name="info" size={15} /> {plural(localCount, 'mod é arquivo local', 'mods são arquivos locais')} de quem criou — {localCount === 1 ? 'aparece' : 'aparecem'} na lista mas não {localCount === 1 ? 'pode' : 'podem'} ser {localCount === 1 ? 'baixado' : 'baixados'}.</p>
      )}
      {items === null ? (
        <div className="mdx-rows">{[0, 1, 2].map((i) => <div key={i} className="mdx-skel mdx-skel-row" />)}</div>
      ) : (
        <ul className="mpk-items">
          {list.map((i) => {
            const installed = itemInstalled(i);
            return (
              <li key={`${i.source}:${i.sourceId}`} className="mpk-item">
                <ItemThumb item={i} />
                <div className="mpk-item-text">
                  <strong title={i.name}>{i.name}</strong>
                  <span><SourceTag source={i.source} />{i.version && <span className="mdx-muted"> · v{i.version}</span>}</span>
                </div>
                {installed ? (
                  <span className="mpk-state ok"><Icon name="check" size={13} strokeWidth={2.6} /> {i.source === 'workshop' ? 'Inscrito' : 'Instalado'}</span>
                ) : i.source === 'local' ? (
                  <span className="mpk-state muted">Não pode ser baixado</span>
                ) : i.source === 'workshop' ? (
                  <button type="button" className="mdx-btn ghost sm" onClick={() => openWorkshopItemInSteam(i.sourceId)}><Icon name="external" size={13} /> Steam</button>
                ) : (
                  <span className="mpk-state">Não instalado</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

// ---------- Progresso do "Baixar modpack" + resumo final ----------
function DownloadRun({ run, progressById, onClose }) {
  const { rows, index, done, stepId, modpack } = run;
  const count = (s) => rows.filter((r) => r.status === s).length;
  const installed = count('installed') + count('already');
  const skipped = count('skipped');
  const failed = count('failed');
  const finished = rows.filter((r) => !['pending', 'working'].includes(r.status)).length;
  const step = stepId != null ? progressById[stepId] : null;
  const steamRows = rows.filter((r) => r.steam);
  return (
    <Modal title={done ? 'Modpack baixado' : `Baixando "${modpack.name}"`} onClose={done ? onClose : () => {}} footer={done && <><span className="mpk-spacer" /><button type="button" className="mdx-btn primary" onClick={onClose}>Fechar</button></>}>
      {done ? (
        <div className="mpk-summary">
          <div className="mpk-summary-tile ok"><strong>{installed}</strong><span>instalados</span></div>
          <div className="mpk-summary-tile"><strong>{skipped}</strong><span>pulados</span></div>
          <div className={`mpk-summary-tile ${failed ? 'bad' : ''}`}><strong>{failed}</strong><span>com erro</span></div>
        </div>
      ) : (
        <div className="mpk-run-head">
          <span>{finished} de {rows.length} · {rows[index]?.item.name}{step ? ` — ${progressLabel(step)}` : ''}</span>
          <ProgressBar percent={rows.length ? Math.round((finished / rows.length) * 100) : 100} />
          {step && <ProgressBar percent={step.percent} indeterminate={step.phase !== 'downloading'} />}
        </div>
      )}
      <ul className="mpk-items compact">
        {rows.map((r) => (
          <li key={`${r.item.source}:${r.item.sourceId}`} className={`mpk-item ${r.status}`}>
            <span className={`mpk-run-icon ${r.status}`}>
              {r.status === 'working' ? <span className="mpk-spinner" /> : (
                <Icon name={r.status === 'installed' || r.status === 'already' ? 'check' : r.status === 'failed' ? 'alert' : r.status === 'skipped' ? 'next' : 'clock'} size={14} strokeWidth={2.2} />
              )}
            </span>
            <div className="mpk-item-text">
              <strong title={r.item.name}>{r.item.name}</strong>
              <span>
                <SourceTag source={r.item.source} />
                {r.status === 'already' && <span className="mdx-muted"> · já estava instalado</span>}
                {r.status === 'installed' && <span className="mdx-muted"> · instalado</span>}
                {r.reason && <span className={r.status === 'failed' ? 'mpk-err' : 'mdx-muted'}> · {r.reason}</span>}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {done && steamRows.length > 0 && (
        <p className="mdx-note"><Icon name="info" size={15} /> {plural(steamRows.length, 'item é', 'itens são')} do Steam Workshop — abra cada um ({steamRows.map((r, i) => (
          <button key={r.item.sourceId} type="button" className="mdx-inline-link" onClick={() => openWorkshopItemInSteam(r.item.sourceId)}>{i > 0 ? ', ' : ''}{r.item.name}</button>
        ))}) e clique em "Inscrever-se" — a Steam baixa sozinha.</p>
      )}
    </Modal>
  );
}

// ---------- Criar / editar ----------
function ModpackEditor({ game, initial, installedState, legacyProfiles, onClose, onSaved }) {
  const isNew = !initial.id;
  const [name, setName] = useState(initial.name || '');
  const [description, setDescription] = useState(initial.description || '');
  const [isPublic, setIsPublic] = useState(!!initial.isPublic);
  const [items, setItems] = useState(initial.items || []);
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (!coverFile) { setCoverPreview(null); return undefined; }
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const keyOf = (i) => `${i.source}:${i.sourceId}`;
  const selectedKeys = useMemo(() => new Set(items.map(keyOf)), [items]);
  const toggleItem = (item) => setItems((list) => (list.some((x) => keyOf(x) === keyOf(item)) ? list.filter((x) => keyOf(x) !== keyOf(item)) : [...list, item]));
  const removeItem = (item) => setItems((list) => list.filter((x) => keyOf(x) !== keyOf(item)));

  const save = async () => {
    if (!name.trim()) { setError('Dê um nome pro modpack.'); return; }
    setSaving(true);
    setError('');
    try {
      const payload = { name: name.trim(), description: description.trim(), isPublic, items };
      let saved = isNew
        ? (await createModpack({ ...payload, steamAppId: game.steamAppId, gameName: game.displayName })).modpack
        : (await updateModpack(initial.id, payload)).modpack;
      if (coverFile) {
        try { saved = (await uploadModpackCover(saved.id, coverFile)).modpack; } catch { /* capa é opcional */ }
      }
      onSaved(saved, isNew);
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível salvar agora.');
    } finally {
      setSaving(false);
    }
  };

  if (picking) {
    return (
      <ModPicker
        game={game}
        installedState={installedState}
        legacyProfiles={legacyProfiles}
        selectedKeys={selectedKeys}
        onToggle={toggleItem}
        count={items.length}
        onDone={() => setPicking(false)}
      />
    );
  }

  const previewMp = { name: name || 'Modpack', steamAppId: game.steamAppId, coverUrl: initial.hasCustomCover ? initial.coverUrl : items.find((i) => i.thumbnailUrl)?.thumbnailUrl };
  return (
    <Modal
      title={isNew ? 'Criar modpack' : 'Editar modpack'}
      onClose={onClose}
      wide
      footer={(
        <>
          {error && <span className="mpk-err">{error}</span>}
          <span className="mpk-spacer" />
          <button type="button" className="mdx-btn ghost" onClick={onClose}>Cancelar</button>
          <button type="button" className="mdx-btn primary" disabled={saving || !name.trim()} onClick={save}>
            <Icon name="save" size={15} /> {saving ? 'Salvando...' : isNew ? 'Criar modpack' : 'Salvar'}
          </button>
        </>
      )}
    >
      <div className="mpk-form">
        <div className="mpk-form-cover">
          {coverPreview ? <div className="mpk-cover"><img src={coverPreview} alt="" /></div> : <ModpackCover modpack={previewMp} />}
          <button type="button" className="mdx-btn ghost sm" onClick={() => fileRef.current?.click()}><MpIcon name="image" size={14} /> {coverFile || initial.hasCustomCover ? 'Trocar capa' : 'Escolher capa'}</button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
          <span className="mdx-muted mdx-small">Opcional — sem capa, usamos a imagem do primeiro mod.</span>
        </div>
        <div className="mpk-form-fields">
          <label className="mpk-field">
            <span>Nome</span>
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Ex: Terror com os amigos, Vanilla+..." />
          </label>
          <label className="mpk-field">
            <span>Descrição <em>(opcional)</em></span>
            <textarea value={description} maxLength={2000} rows={3} onChange={(e) => setDescription(e.target.value)} placeholder="Pra que serve, com quem jogar, dicas..." />
          </label>
          <div className="mpk-toggle-row">
            <div>
              <strong>Público</strong>
              <span className="mdx-muted">Qualquer pessoa com {game.displayName} pode ver, votar e baixar.</span>
            </div>
            <button type="button" role="switch" aria-checked={isPublic} aria-label="Público" className={`mdx-switch ${isPublic ? 'on' : ''}`} onClick={() => setIsPublic((v) => !v)}><span /></button>
          </div>
        </div>
      </div>

      <div className="mpk-items-head">
        <h4>Mods <span className="mpk-pill-count">{items.length}</span></h4>
        <button type="button" className="mdx-btn primary sm" onClick={() => setPicking(true)}><Icon name="plus" size={14} /> Adicionar mods</button>
      </div>
      {items.length === 0 ? (
        <EmptyState icon="puzzle" title="Nenhum mod ainda">Adicione mods instalados ou busque mods deste jogo.</EmptyState>
      ) : (
        <ul className="mpk-items">
          {items.map((i) => (
            <li key={keyOf(i)} className="mpk-item">
              <ItemThumb item={i} />
              <div className="mpk-item-text">
                <strong title={i.name}>{i.name}</strong>
                <span>
                  <SourceTag source={i.source} />
                  {i.source === 'local' && <span className="mdx-muted"> · não pode ser baixado por outras pessoas</span>}
                </span>
              </div>
              <button type="button" className="mdx-icon-btn danger" title="Tirar do modpack" aria-label="Tirar do modpack" onClick={() => removeItem(i)}><Icon name="close" size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ---------- "Adicionar mods": instalados + busca em cada fonte ----------
function ModPicker({ game, installedState, legacyProfiles, selectedKeys, onToggle, count, onDone }) {
  // Item pedido: "não mostrar de onde vêm os mods" — uma busca só,
  // a mesma da aba Explorar, em vez de uma aba por fonte.
  const hasSources = Object.keys(game.sources || {}).length > 0;
  const tabs = [{ key: 'installed', label: 'Instalados' }, ...(hasSources ? [{ key: 'search', label: 'Buscar mods' }] : [])];
  const [tab, setTab] = useState('installed');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  // Instalados (pasta no disco = mod "local") + mods dos perfis antigos
  // do mod.io (esses têm id do mod.io, então dá pra baixar).
  const installedItems = useMemo(() => {
    const out = [];
    const seen = new Set();
    (legacyProfiles || []).forEach((p) => p.items.forEach((i) => {
      if (!i.modioModId) return;
      const key = `modio:${i.modioModId}`;
      if (seen.has(key)) return; seen.add(key);
      out.push({ source: 'modio', sourceId: String(i.modioModId), name: i.modName || `Mod #${i.modioModId}`, from: `Perfil "${p.name}"` });
    }));
    [...(installedState?.enabled || []), ...(installedState?.disabled || [])].forEach((folder) => {
      const key = `local:${folder}`;
      if (seen.has(key)) return; seen.add(key);
      out.push({ source: 'local', sourceId: folder, name: folder.replace(/_/g, ' ').trim() || folder });
    });
    return out;
  }, [installedState, legacyProfiles]);

  useEffect(() => {
    if (tab === 'installed') { setResults(null); return undefined; }
    setResults(null);
    setError('');
    const q = query.trim() || undefined;
    const t = setTimeout(async () => {
      try {
        let list = [];
        if (tab === 'search') {
          const d = await searchUnifiedMods(game.steamAppId, { q, sort: 'popular', gameName: game.displayName });
          list = (d.items || []).filter((m) => m.compatibility?.status !== 'incompatible')
            .map((m) => ({ source: m.source, sourceId: m.sourceId, name: m.name, thumbnailUrl: m.thumbnailUrl || undefined, version: m.version || undefined, by: m.author || undefined }));
        } else if (tab === 'modio') {
          const d = await listMods(game.sources.modio.modioGameId, { q, sort: 'popular', offset: 0 });
          list = (d.mods || []).map((m) => ({ source: 'modio', sourceId: String(m.id), name: m.name, thumbnailUrl: m.logo?.thumb_320x180, version: m.modfile?.version || undefined, by: m.submitted_by?.username }));
        } else if (tab === 'thunderstore') {
          const d = await listThunderstorePackages(game.sources.thunderstore.thunderstoreCommunity, { q, sort: 'popular', offset: 0 });
          list = (d.packages || []).map((p) => ({ source: 'thunderstore', sourceId: p.fullName, name: p.name, thumbnailUrl: p.version?.icon, version: p.version?.versionNumber || undefined, by: p.owner }));
        } else if (tab === 'gamebanana') {
          const d = await browseGameBanana(game.sources.gamebanana.gameBananaGameId, { q, sort: 'default', page: 1 });
          list = (d.items || []).map((i) => ({ source: 'gamebanana', sourceId: String(i.id), name: i.name, thumbnailUrl: i.thumbUrl, by: i.submitter }));
        } else if (tab === 'workshop') {
          const d = await listWorkshopItems(game.sources.workshop.workshopAppId, { q, sort: 'popular' });
          list = (d.items || []).map((i) => ({ source: 'workshop', sourceId: String(i.publishedfileid), name: i.title, thumbnailUrl: i.preview_url }));
        }
        setResults(list);
      } catch (err) {
        setResults([]);
        setError(err.response?.data?.error || 'Não foi possível buscar agora.');
      }
    }, 300);
    return () => clearTimeout(t);
  }, [tab, query, game.sources]);

  const shown = tab === 'installed'
    ? installedItems.filter((i) => !query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase()))
    : results;
  // Sem os campos só de exibição (by/from) no que vai pro servidor.
  const clean = ({ by, from, ...rest }) => rest; // eslint-disable-line no-unused-vars

  return (
    <Modal
      title="Adicionar mods"
      onClose={onDone}
      wide
      footer={(
        <>
          <span className="mdx-muted">{plural(count, 'mod no modpack', 'mods no modpack')}</span>
          <span className="mpk-spacer" />
          <button type="button" className="mdx-btn primary" onClick={onDone}><Icon name="check" size={15} /> Pronto</button>
        </>
      )}
    >
      <div className="mpk-pills small" role="tablist" aria-label="De onde">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`mpk-pill ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <Icon name={t.key === 'installed' ? 'puzzle' : 'search'} size={14} />
            {t.label}
          </button>
        ))}
      </div>
      <SearchField value={query} onChange={setQuery} placeholder={tab === 'installed' ? 'Filtrar mods instalados...' : `Buscar mods de ${game.displayName}...`} />
      {tab === 'installed' && (
        <p className="mdx-muted mdx-small mpk-hint">Mods instalados só pela pasta contam como "arquivo local" — outras pessoas não conseguem baixar. Pra um modpack que todo mundo baixa, use "Buscar mods".</p>
      )}
      {shown === null ? (
        <div className="mdx-rows">{[0, 1, 2, 3].map((i) => <div key={i} className="mdx-skel mdx-skel-row" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState icon={error ? 'alert' : 'search'} tone={error ? 'danger' : undefined} title={error ? 'Não foi possível buscar' : tab === 'installed' ? 'Nenhum mod instalado encontrado' : 'Nenhum mod encontrado'}>
          {error || (tab === 'installed' ? 'Instale mods pela aba "Explorar" ou busque nas outras abas daqui.' : 'Tente outra busca.')}
        </EmptyState>
      ) : (
        <ul className="mpk-items pick">
          {shown.map((i) => {
            const key = `${i.source}:${i.sourceId}`;
            const on = selectedKeys.has(key);
            return (
              <li key={key} className={`mpk-item ${on ? 'selected' : ''}`}>
                <ItemThumb item={i} />
                <div className="mpk-item-text">
                  <strong title={i.name}>{i.name}</strong>
                  <span><SourceTag source={i.source} />{(i.by || i.from) && <span className="mdx-muted"> · {i.from || `por ${i.by}`}</span>}</span>
                </div>
                <button type="button" className={`mdx-btn sm ${on ? 'ghost on' : 'primary'}`} aria-pressed={on} onClick={() => onToggle(clean(i))}>
                  <Icon name={on ? 'check' : 'plus'} size={14} /> {on ? 'Adicionado' : 'Adicionar'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
