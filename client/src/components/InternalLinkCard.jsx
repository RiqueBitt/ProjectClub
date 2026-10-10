import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { loadLinkPreview, peekLinkPreview } from '../utils/internalLinks';
import { requestOpenModpack } from '../pages/mods/modpackShared.js';
import { proxyImage } from '../utils/imageProxy';
import UserAvatar from './UserAvatar.jsx';
import '../styles/socialx.css';

// Cartão de prévia pra links internos colados no chat (post, modpack,
// mod, perfil, evento, canal, Tema). Busca uma vez (com cache) usando os
// endpoints que já existem; se o item sumiu ou é privado, não mostra nada.

const KIND_ICON = {
  post: 'M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h6',
  modpack: 'M12 3 3 7.5 12 12l9-4.5L12 3ZM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5',
  mod: 'M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4h2a2 2 0 1 0 0-4H6V6h4z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  event: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  channel: 'M5 9h14M5 15h14M10 4 8 20M16 4l-2 16',
  club: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
};

export function LinkKindIcon({ kind, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={KIND_ICON[kind] || KIND_ICON.post} />
    </svg>
  );
}

export default function InternalLinkCard({ link }) {
  const navigate = useNavigate();
  const [data, setData] = useState(() => peekLinkPreview(link));

  useEffect(() => {
    let alive = true;
    const cached = peekLinkPreview(link);
    if (cached !== undefined) { setData(cached); return undefined; }
    setData(undefined);
    loadLinkPreview(link).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [link.kind, link.id, link.extra]); // eslint-disable-line react-hooks/exhaustive-deps

  if (data === null) return null;
  if (data === undefined) {
    return (
      <div className="ilc ilc-loading" aria-hidden="true">
        <span className="ilc-skel ilc-skel-img" />
        <span className="ilc-skel-lines"><span className="ilc-skel" /><span className="ilc-skel short" /></span>
      </div>
    );
  }

  const act = (e) => {
    e?.stopPropagation();
    if (data.modpack) { requestOpenModpack(data.modpack.steamAppId, data.modpack.id); navigate('/jogos/mods'); return; }
    if (data.userId) { useStore.getState().openProfile(data.userId); return; }
    if (data.path) navigate(data.path);
  };

  return (
    <div
      className={`ilc ilc-${data.kind} ilc-shape-${data.imageShape || 'square'}`}
      role="link" tabIndex={0}
      onClick={act}
      onKeyDown={(e) => { if (e.key === 'Enter') act(e); }}
    >
      <div className="ilc-media">
        {data.kind === 'user' ? (
          <UserAvatar user={data.user} size={56} />
        ) : data.image ? (
          <img src={data.image.startsWith('/') ? data.image : proxyImage(data.image)} alt="" loading="lazy" />
        ) : (
          <span className="ilc-media-fallback"><LinkKindIcon kind={data.kind} size={26} /></span>
        )}
      </div>
      <div className="ilc-body">
        <span className="ilc-label">
          <LinkKindIcon kind={data.kind} size={12} />
          {data.live && <span className="ilc-live" aria-hidden="true" />}
          {data.label}
        </span>
        <span className="ilc-title">{data.title}</span>
        {data.text && <span className="ilc-text">{data.text}</span>}
        <span className="ilc-foot">
          {data.author && (
            <span className="ilc-author"><UserAvatar user={data.author} size={16} /> {data.author.displayName}</span>
          )}
          {data.meta?.map((m) => <span key={m} className="ilc-chip">{m}</span>)}
        </span>
      </div>
      <button type="button" className="ilc-action" onClick={act}>{data.action}</button>
    </div>
  );
}

// Vários cartões de uma mensagem (até 3, já sem repetidos).
export function InternalLinkCards({ links }) {
  if (!links?.length) return null;
  return (
    <div className="ilc-stack">
      {links.map((l) => <InternalLinkCard key={`${l.kind}:${l.extra || ''}:${l.id}`} link={l} />)}
    </div>
  );
}
