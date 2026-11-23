import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { folderModpacks } from '../../utils/mods';
import { Icon, EmptyState } from './shared.jsx';
import { formatBytes } from './unifiedApi.js';
import '../../styles/modpacks.css';

// Modpacks em pasta própria: Project Club → ModManager → <Jogo> → Modpacks → <Modpack>.
// "Jogar com este modpack" põe os mods na pasta do jogo e abre o jogo;
// quando o jogo fecha, os mods voltam pra pasta do modpack sozinhos
// (desktop/folderModpacks.js). Assim a pasta do jogo fica sempre limpa.

function launchInfo(game) {
  const platforms = game.platforms || ['steam'];
  const platform = platforms.includes('steam') ? 'steam' : platforms[0];
  return { platform, steamAppId: game.steamAppId || null, epicAppName: game.storeIds?.epic || null };
}

export default function FolderModpacks({ game, installedState, onChanged }) {
  const gameName = game.displayName;
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [picking, setPicking] = useState(null); // pack em que está adicionando mods
  const [live, setLive] = useState(null); // estado vindo do app: waiting | running | purged

  const refresh = useCallback(async () => {
    try { setData(await folderModpacks.list(gameName)); setError(''); } catch (e) { setError(e.message); }
  }, [gameName]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => folderModpacks.onState((s) => {
    setLive(s);
    if (s.state === 'purged') { refresh(); onChanged?.(); }
  }), [refresh, onChanged]);

  const deployed = data?.deployed;
  const deployedHere = deployed && deployed.gameName === gameName;
  const run = async (key, fn) => {
    setBusy(key); setError('');
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(''); }
  };

  const create = () => run('create', async () => {
    const name = newName.trim();
    if (!name) return;
    await folderModpacks.create(gameName, name, game.steamAppId);
    setNewName(''); setCreating(false); refresh();
  });
  const play = (p) => run(`play:${p.id}`, async () => {
    const r = await folderModpacks.play({ gameName, packId: p.id, gameInstallPath: game.installPath, gameKey: String(game.steamAppId || game.key || ''), ...launchInfo(game) });
    setLive({ state: 'waiting', gameName, packId: p.id, launched: r.launched });
    refresh();
  });
  const collect = () => run('collect', async () => { await folderModpacks.collect(); refresh(); onChanged?.(); });
  const remove = (p) => {
    if (!window.confirm(`Apagar o modpack "${p.name}" e os ${p.fileCount} arquivos dele? Isso não tem volta.`)) return;
    run(`del:${p.id}`, async () => { await folderModpacks.remove(gameName, p.id); refresh(); });
  };

  const liveText = live && deployedHere && (
    live.state === 'running' ? 'Jogo aberto com o modpack. Quando você fechar o jogo, os mods voltam pra pasta do modpack.'
      : live.launched === false ? 'Mods aplicados. Abra o jogo pelo launcher dele — quando fechar, os mods voltam pro modpack.'
        : 'Abrindo o jogo com o modpack…'
  );

  return (
    <section className="mdx-fpacks">
      <div className="mdx-home-head">
        <span className="mdx-home-head-icon"><Icon name="folder" size={17} /></span>
        <div>
          <h2>Modpacks no seu PC</h2>
          <p>Cada modpack é uma pasta do Project Club. Ao jogar, os mods entram no jogo; ao fechar, voltam pro modpack.</p>
        </div>
        <div className="mdx-fpacks-head-actions">
          <button type="button" className="mdx-btn ghost sm" onClick={() => folderModpacks.openFolder(gameName).catch((e) => setError(e.message))}><Icon name="folder" size={14} /> Abrir pasta</button>
          <button type="button" className="mdx-btn primary sm" onClick={() => setCreating((v) => !v)}><Icon name="plus" size={14} /> Novo modpack</button>
        </div>
      </div>

      {deployed && (
        <div className={`mdx-fpack-live ${live?.state === 'running' ? 'running' : ''}`} role="status">
          <span className="mdx-fpack-pulse" aria-hidden="true" />
          <div>
            <strong>{deployedHere ? `Modpack "${deployed.packId}" aplicado` : `Modpack aplicado em ${deployed.gameName}`}</strong>
            <span>{liveText || 'Quando o jogo fechar, os mods voltam pra pasta do modpack.'}</span>
          </div>
          <button type="button" className="mdx-btn ghost sm" disabled={busy === 'collect'} onClick={collect} title="Só funciona com o jogo fechado">
            <Icon name="refresh" size={14} /> {busy === 'collect' ? 'Guardando...' : 'Guardar mods agora'}
          </button>
        </div>
      )}

      {creating && (
        <form className="mdx-fpack-create" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value.slice(0, 60))} placeholder="Nome do modpack (ex.: Modpack 1)" aria-label="Nome do modpack" />
          <button type="submit" className="mdx-btn primary" disabled={!newName.trim() || busy === 'create'}>Criar</button>
          <button type="button" className="mdx-btn ghost" onClick={() => setCreating(false)}>Cancelar</button>
        </form>
      )}

      {error && <p className="mdx-error mdx-error-banner">{error}</p>}

      {data && data.packs.length === 0 && !creating && (
        <EmptyState icon="layers" title="Nenhum modpack ainda" action={<button type="button" className="mdx-btn primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> Criar o primeiro</button>}>
          Crie um modpack, coloque nele os mods que você já instalou e jogue com ele quando quiser — o jogo fica sem mods no resto do tempo.
        </EmptyState>
      )}

      {data?.packs.length > 0 && (
        <div className="mdx-fpack-grid">
          {data.packs.map((p, i) => (
            <article key={p.id} className={`mdx-fpack mdx-rise ${p.active ? 'active' : ''}`} style={{ '--i': i }}>
              <header>
                <span className="mdx-fpack-icon"><Icon name="layers" size={18} /></span>
                <div>
                  <strong title={p.path}>{p.name}</strong>
                  <span>{p.mods.length} {p.mods.length === 1 ? 'mod' : 'mods'} · {p.fileCount} arquivos · {formatBytes(p.size)}</span>
                </div>
                {p.active && <span className="mdx-status on">Aplicado</span>}
              </header>
              {p.mods.length > 0 && <p className="mdx-fpack-mods">{p.mods.slice(0, 6).join(' · ')}{p.mods.length > 6 ? ` e mais ${p.mods.length - 6}` : ''}</p>}
              <div className="mdx-fpack-actions">
                <button type="button" className="mdx-btn play sm" disabled={!!deployed || !p.fileCount || busy === `play:${p.id}`} onClick={() => play(p)} title={!p.fileCount ? 'Adicione mods primeiro' : deployed ? 'Já tem um modpack aplicado' : 'Põe os mods no jogo e abre o jogo'}>
                  <Icon name="play" size={14} filled /> {busy === `play:${p.id}` ? 'Aplicando...' : 'Jogar com este modpack'}
                </button>
                <button type="button" className="mdx-btn ghost sm" disabled={!!deployed} onClick={() => setPicking(p)}><Icon name="plus" size={14} /> Adicionar mods</button>
                <button type="button" className="mdx-icon-btn" aria-label="Abrir a pasta do modpack" title="Abrir a pasta do modpack" onClick={() => folderModpacks.openFolder(gameName, p.id).catch((e) => setError(e.message))}><Icon name="folder" size={15} /></button>
                <button type="button" className="mdx-icon-btn danger" aria-label="Apagar modpack" title="Apagar modpack" disabled={p.active} onClick={() => remove(p)}><Icon name="trash" size={15} /></button>
              </div>
            </article>
          ))}
        </div>
      )}

      {picking && (
        <AddModsDialog
          pack={picking} game={game} installedState={installedState}
          onClose={() => setPicking(null)}
          onDone={() => { setPicking(null); refresh(); onChanged?.(); }}
        />
      )}
    </section>
  );
}

function AddModsDialog({ pack, game, installedState, onClose, onDone }) {
  const names = [...new Set([...(installedState?.enabled || []), ...(installedState?.disabled || [])])].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const [sel, setSel] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toggle = (n) => setSel((s) => { const c = new Set(s); if (c.has(n)) c.delete(n); else c.add(n); return c; });
  const go = async () => {
    setBusy(true); setErr('');
    try {
      for (const modName of sel) {
        // eslint-disable-next-line no-await-in-loop
        await folderModpacks.addMod({ gameName: game.displayName, packId: pack.id, gameInstallPath: game.installPath, steamAppId: game.steamAppId, modName });
      }
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  return createPortal(
    <div className="mpk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="mpk-modal" role="dialog" aria-modal="true" aria-label={`Adicionar mods ao ${pack.name}`}>
        <header className="mpk-modal-head">
          <h3>Adicionar mods ao “{pack.name}”</h3>
          <button type="button" className="mdx-icon-btn" aria-label="Fechar" disabled={busy} onClick={onClose}><Icon name="close" size={16} /></button>
        </header>
        <div className="mpk-modal-body">
          <p className="mdx-muted">Os mods escolhidos saem da pasta do jogo e vão pra pasta do modpack. Eles só voltam pro jogo quando você jogar com este modpack.</p>
          {names.length === 0 ? (
            <EmptyState icon="puzzle" title="Nenhum mod instalado neste jogo">Instale mods pela aba Explorar (ou adicione do PC) e depois coloque eles aqui.</EmptyState>
          ) : (
            <ul className="mdx-fpack-pick">
              {names.map((n) => (
                <li key={n}>
                  <label>
                    <input type="checkbox" checked={sel.has(n)} onChange={() => toggle(n)} disabled={busy} />
                    <span>{n}</span>
                    {installedState?.disabled?.includes(n) && <em>desativado</em>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {err && <p className="mdx-error">{err}</p>}
        </div>
        <footer className="mpk-modal-foot">
          <button type="button" className="mdx-btn ghost" disabled={busy} onClick={onClose}>Cancelar</button>
          <button type="button" className="mdx-btn primary" disabled={!sel.size || busy} onClick={go}>
            {busy ? 'Movendo...' : `Mover ${sel.size || ''} pro modpack`}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
