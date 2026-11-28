import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { listMyModpacks, setFeaturedModpack } from '../api/endpoints';
import { proxyImage } from '../utils/imageProxy';
import { MODPACK_SOURCE_LABEL, steamHeaderUrl, requestOpenModpack } from '../pages/mods/modpackShared.js';
import '../styles/modpacks.css';
import { useLiveRefresh } from '../utils/liveRefresh';
import { isDesktopModsAvailable } from '../utils/mods';

// Item pedido: coluna "Modpack preferido" no perfil — mostra o modpack
// (ou um mod avulso) que a pessoa escolheu destacar: jogo, likes,
// dislikes e quantas pessoas baixaram. No próprio perfil tem "Escolher",
// que abre a lista dos seus modpacks (e uma aba "Mods").

const P = {
  layers: 'm12 3 9 5-9 5-9-5 9-5ZM3 12.5l9 5 9-5M3 16.5l9 5 9-5',
  thumb: 'M7 11v9H4v-9h3Zm0 0 4-7a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.3 20H7',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M4 20h16',
  puzzle: 'M9.5 4.5a2.5 2.5 0 0 1 5 0V6H18a1 1 0 0 1 1 1v3.5h-1.5a2.5 2.5 0 0 0 0 5H19V19a1 1 0 0 1-1 1h-3.5v-1.5a2.5 2.5 0 0 0-5 0V20H6a1 1 0 0 1-1-1v-3.5h1.5a2.5 2.5 0 0 0 0-5H5V7a1 1 0 0 1 1-1h3.5V4.5Z',
  close: 'M6 6l12 12M18 6 6 18',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
};
function I({ name, size = 15, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      <path d={P[name]} />
    </svg>
  );
}
const hue = (text) => { let h = 0; for (const ch of String(text || '')) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const fmt = (n) => (n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));
const steamPoster = (id) => `/api/proxy/steam/${id}/cover`;

// Imagem com uma fila de alternativas (capa vertical -> horizontal -> gradiente com o nome).
function Poster({ urls, label, className = '' }) {
  const list = useMemo(() => urls.filter(Boolean), [urls]);
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [list]);
  const h = hue(label);
  return (
    <div className={`pfm-poster ${className}`} style={{ '--h1': h, '--h2': (h + 50) % 360 }}>
      {idx < list.length
        ? <img src={list[idx]} alt="" loading="lazy" onError={() => setIdx((i) => i + 1)} />
        : <span className="pfm-poster-fallback">{label}</span>}
    </div>
  );
}

export default function FeaturedModpackSection({ Card, item, isMe, onChanged, onOpenModpack }) {
  const [picking, setPicking] = useState(false);
  const [needsApp, setNeedsApp] = useState(false);
  const action = isMe && <button type="button" className="pf-link" onClick={() => setPicking(true)}>Escolher</button>;
  const mp = item?.type === 'modpack' ? item.modpack : null;
  const mod = item?.type === 'mod' ? item.mod : null;

  return (
    <Card icon="layers" title="Modpack preferido" action={item && action}>
      {mp && (
        <div className="pfm">
          <Poster urls={[steamPoster(mp.steamAppId), steamHeaderUrl(mp.steamAppId)]} label={mp.gameName} />
          <div className="pfm-info">
            <span className="pfm-game">{mp.gameName}</span>
            <h4 className="pfm-name">{mp.name}</h4>
            <div className="pfm-stats">
              <span className="pfm-stat up" title="Curtidas"><I name="thumb" size={13} /> {fmt(mp.likeCount)}</span>
              <span className="pfm-stat down" title="Não curtidas"><I name="thumb" size={13} style={{ transform: 'rotate(180deg)' }} /> {fmt(mp.dislikeCount)}</span>
              <span className="pfm-stat" title="Pessoas que baixaram"><I name="download" size={13} /> {fmt(mp.downloadCount)}</span>
              <span className="pfm-stat" title="Mods no modpack"><I name="puzzle" size={13} /> {mp.itemCount} {mp.itemCount === 1 ? 'mod' : 'mods'}</span>
            </div>
            {!mp.isPublic && <span className="pfm-private"><I name="lock" size={12} /> Privado — só você vê este card até publicar.</span>}
            <div className="pfm-actions">
              {mp.itemCount > 0 && (
                <button
                  type="button"
                  className="pf-btn pfm-install"
                  onClick={() => {
                    // Um clique: no app do PC abre o jogo e já começa o
                    // "Baixar modpack"; no navegador explica que precisa do app.
                    if (!isDesktopModsAvailable()) { setNeedsApp(true); return; }
                    requestOpenModpack(mp.steamAppId, mp.id, { autoInstall: true, name: mp.gameName });
                    onOpenModpack?.();
                  }}
                >
                  <I name="download" size={14} /> Instalar modpack
                </button>
              )}
              <button type="button" className="pf-btn pfm-ghost" onClick={() => { requestOpenModpack(mp.steamAppId, mp.id); onOpenModpack?.(); }}>
                Ver modpack <I name="arrow" size={14} />
              </button>
            </div>
            {needsApp && (
              <div className="pfm-needs-app" role="note">
                <I name="monitor" size={15} />
                <span>Instalar modpacks precisa do app do Project Club no PC — ele coloca os mods direto na pasta do jogo. Abra este perfil pelo app e clique em "Instalar modpack" de novo.</span>
                <button type="button" className="pfm-needs-close" aria-label="Fechar" onClick={() => setNeedsApp(false)}><I name="close" size={13} /></button>
              </div>
            )}
          </div>
        </div>
      )}
      {mod && (
        <div className="pfm">
          <Poster className="mod" urls={[mod.thumbnailUrl ? proxyImage(mod.thumbnailUrl) : null, mod.steamAppId ? steamHeaderUrl(mod.steamAppId) : null]} label={mod.name} />
          <div className="pfm-info">
            {mod.gameName && <span className="pfm-game">{mod.gameName}</span>}
            <h4 className="pfm-name">{mod.name}</h4>
            <div className="pfm-stats">
              <span className="pfm-stat"><I name="puzzle" size={13} /> Mod</span>
            </div>
          </div>
        </div>
      )}
      {!item && (
        <div className="pf-empty">
          <span className="pf-empty-icon"><I name="layers" size={18} /></span>
          <span className="pf-empty-text">Destaque aqui um modpack seu (ou um mod) — quem visitar vê o jogo, os likes e quantas pessoas baixaram.</span>
          {isMe && <button type="button" className="pf-btn" onClick={() => setPicking(true)}>Escolher modpack</button>}
        </div>
      )}
      {picking && <FeaturedPicker current={item} onClose={() => setPicking(false)} onChanged={(f) => { onChanged?.(f); setPicking(false); }} />}
    </Card>
  );
}

// Modal "Escolher": aba Modpacks (todos os meus, de qualquer jogo) e aba
// Mods (os mods que estão nos meus modpacks).
function FeaturedPicker({ current, onClose, onChanged }) {
  const [tab, setTab] = useState(current?.type === 'mod' ? 'mods' : 'modpacks');
  const [packs, setPacks] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    listMyModpacks().then((d) => setPacks(d.modpacks || [])).catch(() => setPacks([]));
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Tempo real (11s): meus modpacks na lista de escolha.
  useLiveRefresh(({ put }) => listMyModpacks().then((d) => put(setPacks)(d.modpacks || [])), { enabled: packs !== null });

  const mods = useMemo(() => {
    const seen = new Set();
    const out = [];
    (packs || []).forEach((p) => (p.items || []).forEach((i) => {
      const key = `${i.source}:${i.sourceId}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ ...i, steamAppId: p.steamAppId, gameName: p.gameName });
    }));
    return out;
  }, [packs]);

  const choose = async (payload) => {
    setBusy(true);
    setError('');
    try {
      const d = await setFeaturedModpack(payload);
      onChanged(d.featured || null);
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível salvar agora.');
    } finally {
      setBusy(false);
    }
  };

  const currentModpackId = current?.type === 'modpack' ? current.modpack.id : null;
  const currentModKey = current?.type === 'mod' ? `${current.mod.source}:${current.mod.sourceId}` : null;

  return createPortal(
    <div className="mpk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mpk-modal wide" role="dialog" aria-modal="true" aria-label="Escolher modpack preferido">
        <header className="mpk-modal-head">
          <h3>Modpack preferido</h3>
          <button type="button" className="mpk-icon-btn" aria-label="Fechar" onClick={onClose}><I name="close" size={16} /></button>
        </header>
        <div className="mpk-modal-body">
          <div className="mpk-pills small" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'modpacks'} className={`mpk-pill ${tab === 'modpacks' ? 'active' : ''}`} onClick={() => setTab('modpacks')}>
              <I name="layers" size={14} /> Modpacks {packs && <span className="mpk-pill-count">{packs.length}</span>}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'mods'} className={`mpk-pill ${tab === 'mods' ? 'active' : ''}`} onClick={() => setTab('mods')}>
              <I name="puzzle" size={14} /> Mods {packs && <span className="mpk-pill-count">{mods.length}</span>}
            </button>
          </div>
          {error && <p className="mpk-err">{error}</p>}
          {packs === null ? (
            <ul className="pfm-pick-list">{[0, 1, 2].map((i) => <li key={i}><div className="mpk-skel mpk-skel-card" style={{ height: 170 }} /></li>)}</ul>
          ) : tab === 'modpacks' ? (
            packs.length === 0 ? (
              <div className="mpk-empty">
                <span className="mpk-empty-icon"><I name="layers" size={26} /></span>
                <h3>Você ainda não tem modpacks</h3>
                <p>Crie um em Jogos → Mods → (jogo) → Modpacks.</p>
              </div>
            ) : (
              <ul className="pfm-pick-list">
                {packs.map((p) => (
                  <li key={p.id}>
                    <button type="button" disabled={busy} className={`pfm-pick ${p.id === currentModpackId ? 'current' : ''}`} onClick={() => choose({ modpackId: p.id })}>
                      <PickCover urls={[p.coverUrl ? proxyImage(p.coverUrl) : null, steamHeaderUrl(p.steamAppId)]} label={p.name} />
                      <span className="pfm-pick-body">
                        <strong>{p.name}</strong>
                        <span>{p.gameName} · {p.itemCount} {p.itemCount === 1 ? 'mod' : 'mods'}</span>
                        <span>{p.isPublic ? `${fmt(p.likeCount)} likes · ${fmt(p.downloadCount)} downloads` : 'Privado'}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : mods.length === 0 ? (
            <div className="mpk-empty">
              <span className="mpk-empty-icon"><I name="puzzle" size={26} /></span>
              <h3>Nenhum mod pra destacar</h3>
              <p>Os mods que estão nos seus modpacks aparecem aqui.</p>
            </div>
          ) : (
            <ul className="mpk-items pick">
              {mods.map((m) => {
                const key = `${m.source}:${m.sourceId}`;
                const on = key === currentModKey;
                return (
                  <li key={key} className={`mpk-item ${on ? 'selected' : ''}`}>
                    <span className="mpk-item-thumb" style={{ '--h1': hue(m.name) }}>
                      {m.thumbnailUrl ? <img src={proxyImage(m.thumbnailUrl)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <I name="puzzle" size={15} />}
                    </span>
                    <div className="mpk-item-text">
                      <strong title={m.name}>{m.name}</strong>
                      <span>{m.gameName}</span>
                    </div>
                    <button type="button" className={`mpk-btn sm ${on ? 'ghost on' : 'primary'}`} disabled={busy || on} onClick={() => choose({ mod: m })}>
                      {on ? <><I name="check" size={14} /> Escolhido</> : 'Destacar'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <footer className="mpk-modal-foot">
          {current && <button type="button" className="mpk-btn ghost danger sm" disabled={busy} onClick={() => choose({})}>Tirar do perfil</button>}
          <span className="mpk-spacer" />
          <button type="button" className="mpk-btn ghost" onClick={onClose}>Fechar</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function PickCover({ urls, label }) {
  const list = useMemo(() => urls.filter(Boolean), [urls]);
  const [idx, setIdx] = useState(0);
  const h = hue(label);
  return (
    <span className="mpk-cover" style={{ '--h1': h, '--h2': (h + 50) % 360 }}>
      {idx < list.length && <img src={list[idx]} alt="" loading="lazy" onError={() => setIdx((i) => i + 1)} />}
    </span>
  );
}
