import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrowser } from './browserStore';
import { wvOf } from './BrowserHost.jsx';
import {
  NEW_TAB, INTERNAL, SEARCH_ENGINES, isInternal, displayUrl, searchTermOf, hostOf, nativeBrowser, PERMISSION_TEXT, fmtBytes, isYouTubeWatch, toUrl,
} from './urlTools';
import { InternalPage, ErrorPage } from './BrowserPages.jsx';
import { useYouTubeApp } from '../youtube/youtubeStore';

// Ícones (traço 24×24, mesmo estilo do resto do app).
export const B = {
  back: 'M15 5l-7 7 7 7', fwd: 'M9 5l7 7-7 7', reload: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7', stop: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M18 6 6 18', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  shield: 'M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z', shieldOff: 'M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6zM4 4l16 16',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3', unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v12M7 8l5-5 5 5', down: 'M12 4v11M7 10l5 5 5-5M5 20h14', menu: 'M12 5h.01M12 12h.01M12 19h.01',
  dock: 'M4 5h16v14H4zM14 5v14', full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  mask: 'M3 10c0-2 2-3 4-3h10c2 0 4 1 4 3 0 4-2 6-5 6-2 0-2.5-2-4-2s-2 2-4 2c-3 0-5-2-5-6zM8 11h.01M16 11h.01',
  speaker: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6', mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6', pin: 'M9 3h6l-1 6 4 4H6l4-4zM12 13v8',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v5l3 2', bookmarks: 'M6 3h12v18l-6-4-6 4z', settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6', zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5', print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z',
  yt: 'M3.5 8.2c.2-1.6 1.3-2.7 2.9-2.8C8.2 5.2 10 5.1 12 5.1s3.8.1 5.6.3c1.6.1 2.7 1.2 2.9 2.8.2 1.3.2 2.5.2 3.8s0 2.5-.2 3.8c-.2 1.6-1.3 2.7-2.9 2.8-1.8.2-3.6.3-5.6.3s-3.8-.1-5.6-.3c-1.6-.1-2.7-1.2-2.9-2.8C3.3 14.5 3.3 13.3 3.3 12s0-2.5.2-3.8ZM10 9v6l5-3-5-3Z',
  up: 'M6 15l6-6 6 6', downArrow: 'M6 9l6 6 6-6', home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
};
export const Ico = ({ d, size = 16, fill = false, className }) => (
  <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export function Favicon({ tab, size = 16 }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [tab?.favicon]);
  if (tab?.loading && !isInternal(tab.url)) return <span className="pcb-spin" style={{ width: size, height: size }} aria-hidden="true" />;
  if (isInternal(tab?.url)) return <span className="pcb-fav-int" style={{ width: size, height: size }}><Ico d={tab.url === NEW_TAB ? B.home : tab.url === 'pc://historico' ? B.history : tab.url === 'pc://favoritos' ? B.bookmarks : tab.url === 'pc://downloads' ? B.down : B.settings} size={size - 2} /></span>;
  if (tab?.favicon && !bad) return <img className="pcb-fav" src={tab.favicon} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBad(true)} />;
  const letter = (hostOf(tab?.url) || '?').slice(0, 1).toUpperCase();
  return <span className="pcb-fav-letter" style={{ width: size, height: size, fontSize: size * 0.62 }}>{letter}</span>;
}

const tabTitle = (t) => (isInternal(t.url) ? INTERNAL[t.url] || 'Página' : t.title || displayUrl(t.url) || 'Carregando…');

// ---------------- abas ----------------
function TabStrip({ compact }) {
  const tabs = useBrowser((s) => s.tabs);
  const activeId = useBrowser((s) => s.activeId);
  const st = useBrowser.getState;
  const [menu, setMenu] = useState(null);
  const dragId = useRef(null);
  const stripRef = useRef(null);
  useEffect(() => { stripRef.current?.querySelector('.pcb-tab.is-active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [activeId]);
  useEffect(() => {
    if (!menu) return undefined;
    const off = () => setMenu(null);
    window.addEventListener('mousedown', off);
    return () => window.removeEventListener('mousedown', off);
  }, [menu]);
  return (
    <div className={`pcb-tabs${compact ? ' is-compact' : ''}`} role="tablist" aria-label="Abas do navegador" ref={stripRef}
      onWheel={(e) => { if (e.deltaY && stripRef.current) stripRef.current.scrollLeft += e.deltaY; }}>
      {tabs.map((t, i) => (
        <div key={t.id} role="tab" aria-selected={t.id === activeId} tabIndex={0} title={`${tabTitle(t)}${t.private ? ' (privada)' : ''}`}
          className={`pcb-tab${t.id === activeId ? ' is-active' : ''}${t.private ? ' is-private' : ''}${t.pinned ? ' is-pinned' : ''}${t.sleeping ? ' is-sleeping' : ''}`}
          draggable onDragStart={() => { dragId.current = t.id; }} onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (dragId.current && dragId.current !== t.id) st().moveTab(dragId.current, i); dragId.current = null; }}
          onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); st().closeTab(t.id); } }}
          onClick={() => st().activate(t.id)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') st().activate(t.id); }}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ id: t.id, x: e.clientX, y: e.clientY }); }}>
          <Favicon tab={t} size={16} />
          {!t.pinned && <span className="pcb-tab-t" data-no-translate>{tabTitle(t)}</span>}
          {(t.audible || t.muted) && (
            <button type="button" className="pcb-tab-audio" onClick={(e) => { e.stopPropagation(); const m = !t.muted; wvOf(t.id)?.setAudioMuted(m); st().update(t.id, { muted: m }); }} title={t.muted ? 'Ativar som da aba' : 'Silenciar aba'} aria-label={t.muted ? 'Ativar som' : 'Silenciar'}>
              <Ico d={t.muted ? B.mute : B.speaker} size={13} />
            </button>
          )}
          {!t.pinned && <button type="button" className="pcb-tab-x" onClick={(e) => { e.stopPropagation(); st().closeTab(t.id); }} title="Fechar aba (Ctrl+W)" aria-label="Fechar aba"><Ico d={B.close} size={12} /></button>}
        </div>
      ))}
      <button type="button" className="pcb-newtab" onClick={() => st().openTab()} title="Nova aba (Ctrl+T)" aria-label="Nova aba"><Ico d={B.plus} size={16} /></button>
      {menu && (() => {
        const t = tabs.find((x) => x.id === menu.id);
        if (!t) return null;
        const item = (label, fn) => <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => { fn(); setMenu(null); }}>{label}</button>;
        return (
          <div className="pcb-ctx" style={{ left: menu.x, top: menu.y }} role="menu">
            {item('Nova aba à direita', () => st().openTab(null, { afterId: t.id }))}
            {item('Recarregar', () => wvOf(t.id)?.reload())}
            {item('Duplicar', () => st().openTab(t.url, { afterId: t.id, private: t.private }))}
            {item(t.pinned ? 'Desafixar' : 'Fixar aba', () => st().togglePin(t.id))}
            {item(t.muted ? 'Ativar som' : 'Silenciar', () => { wvOf(t.id)?.setAudioMuted(!t.muted); st().update(t.id, { muted: !t.muted }); })}
            {!isInternal(t.url) && item('Compartilhar no Project Club…', () => useBrowser.setState({ share: { url: t.url, title: t.title } }))}
            <hr />
            {item('Fechar', () => st().closeTab(t.id))}
            {item('Fechar outras abas', () => tabs.filter((x) => x.id !== t.id && !x.pinned).forEach((x) => st().closeTab(x.id)))}
            {item('Fechar abas à direita', () => tabs.slice(tabs.indexOf(t) + 1).filter((x) => !x.pinned).forEach((x) => st().closeTab(x.id)))}
            {item('Reabrir aba fechada', () => st().reopenClosed())}
          </div>
        );
      })()}
    </div>
  );
}

// ---------------- barra de endereço ----------------
function Omnibox({ tab }) {
  const prefs = useBrowser((s) => s.prefs);
  const history = useBrowser((s) => s.history);
  const bookmarks = useBrowser((s) => s.bookmarks);
  const focusTick = useBrowser((s) => s.focusOmnibox);
  const inputRef = useRef(null);
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState('');
  const [sel, setSel] = useState(-1);
  const [remote, setRemote] = useState([]);
  const url = tab?.url || NEW_TAB;
  const term = searchTermOf(url);

  useEffect(() => { if (!focused) setText(term || displayUrl(url)); }, [url, focused, term]);
  useEffect(() => { if (focusTick && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [focusTick]);
  useEffect(() => { if (tab?.url === NEW_TAB && !tab.loading) setTimeout(() => inputRef.current?.focus(), 30); }, [tab?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sugestões do buscador (via app, sem expor nada ao site).
  useEffect(() => {
    if (!focused) return undefined;
    const q = text.trim();
    if (!q || q.length < 2 || /^\S+\.\S+$/.test(q)) { setRemote([]); return undefined; }
    let alive = true;
    const t = setTimeout(() => { nativeBrowser()?.suggest(q).then((r) => alive && setRemote(r || [])).catch(() => {}); }, 140);
    return () => { alive = false; clearTimeout(t); };
  }, [text, focused]);

  const local = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!focused || !q) return [];
    const seen = new Set();
    const pool = [...bookmarks.map((b) => ({ ...b, kind: 'bookmark' })), ...history.map((h) => ({ ...h, kind: 'history' }))];
    const out = [];
    for (const it of pool) {
      if (out.length >= 5) break;
      if (seen.has(it.url)) continue;
      if (it.url.toLowerCase().includes(q) || (it.title || '').toLowerCase().includes(q)) { seen.add(it.url); out.push(it); }
    }
    return out;
  }, [text, focused, bookmarks, history]);

  const typed = text.trim();
  const items = focused && typed ? [
    { kind: 'go', label: typed, url: toUrl(typed, prefs.searchEngine) },
    ...local.map((x) => ({ kind: x.kind, label: x.title || displayUrl(x.url), sub: displayUrl(x.url), url: x.url })),
    ...remote.filter((r) => r.toLowerCase() !== typed.toLowerCase()).slice(0, 6).map((r) => ({ kind: 'search', label: r, url: toUrl(r, prefs.searchEngine) })),
  ] : [];

  const go = (u) => { if (!tab) return; useBrowser.getState().navigate(tab.id, u); setFocused(false); inputRef.current?.blur(); setTimeout(() => wvOf(tab.id)?.focus(), 50); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(-1, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[sel]; go(it ? it.url : typed); }
    else if (e.key === 'Escape') { setText(term || displayUrl(url)); setFocused(false); inputRef.current?.blur(); }
  };
  const secure = /^https:/.test(url);
  const engine = SEARCH_ENGINES[prefs.searchEngine] || SEARCH_ENGINES.ddg;
  return (
    <div className={`pcb-omni${focused ? ' is-focused' : ''}`}>
      <span className={`pcb-omni-ico${secure ? ' is-secure' : isInternal(url) ? '' : ' is-insecure'}`} title={secure ? 'Conexão segura (HTTPS)' : isInternal(url) ? 'Página do Project Club' : 'Conexão não segura'}>
        <Ico d={isInternal(url) ? B.globe : secure ? B.lock : B.unlock} size={14} />
      </span>
      <input ref={inputRef} className="pcb-omni-in" value={text} spellCheck={false} autoComplete="off" aria-label="Endereço ou busca"
        placeholder={`Pesquise com ${engine.name} ou digite um endereço`}
        onFocus={(e) => { setFocused(true); setSel(-1); if (!term) setText(isInternal(url) && url === NEW_TAB ? '' : url); setTimeout(() => e.target.select(), 0); }}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onChange={(e) => { setText(e.target.value); setSel(-1); }}
        onKeyDown={onKey} />
      {tab?.private && <span className="pcb-omni-private" title="Aba privada: nada fica salvo"><Ico d={B.mask} size={14} /> Privada</span>}
      {items.length > 0 && (
        <ul className="pcb-sugg" role="listbox">
          {items.map((it, i) => (
            <li key={`${it.kind}-${it.url}`} role="option" aria-selected={i === sel} className={i === sel ? 'is-sel' : ''} onMouseDown={(e) => { e.preventDefault(); go(it.url); }} onMouseEnter={() => setSel(i)}>
              <Ico d={it.kind === 'bookmark' ? B.star : it.kind === 'history' ? B.history : it.kind === 'go' && !/\s/.test(it.label) && /\./.test(it.label) ? B.globe : B.search} size={14} />
              <span className="pcb-sugg-t" data-no-translate>{it.label}</span>
              {it.sub && <span className="pcb-sugg-s" data-no-translate>{it.sub}</span>}
              {it.kind === 'go' && <span className="pcb-sugg-s">{/\s/.test(it.label) || !/\./.test(it.label) ? `— pesquisar com ${engine.name}` : '— abrir'}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------- proteção (escudo) ----------------
function ShieldPanel({ tab, onClose }) {
  const prefs = useBrowser((s) => s.prefs);
  const siteAllow = useBrowser((s) => s.siteAllow);
  const total = useBrowser((s) => s.totalBlocked);
  const engine = useBrowser((s) => s.engine);
  const host = hostOf(tab?.url);
  const allowed = siteAllow.some((h) => host === h || host.endsWith(`.${h}`));
  const toggleSite = async () => {
    const nb = nativeBrowser(); if (!nb || !host) return;
    await nb.setSiteAdblock(host, allowed);
    await useBrowser.getState().loadNative();
    wvOf(tab.id)?.reload();
  };
  return (
    <div className="pcb-pop is-shield" role="dialog" aria-label="Proteção">
      <div className="pcb-pop-h"><Ico d={allowed ? B.shieldOff : B.shield} size={18} /> <strong>Proteção {host ? <span data-no-translate>de {host}</span> : ''}</strong></div>
      {host && (
        <label className="pcb-switch-row">
          <span><strong>Bloquear anúncios e rastreadores aqui</strong><small>{allowed ? 'Desligado neste site.' : `${tab?.blocked || 0} bloqueado${(tab?.blocked || 0) === 1 ? '' : 's'} nesta página.`}</small></span>
          <input type="checkbox" className="pcb-switch" checked={!allowed && prefs.adblock} disabled={!prefs.adblock} onChange={toggleSite} />
        </label>
      )}
      <ul className="pcb-shield-list">
        <li className={prefs.httpsOnly ? 'is-on' : ''}>Só HTTPS</li>
        <li className={prefs.block3pCookies ? 'is-on' : ''}>Cookies de terceiros bloqueados</li>
        <li className={prefs.stripTracking ? 'is-on' : ''}>Rastreio removido dos links</li>
        <li className={prefs.gpc ? 'is-on' : ''}>“Não venda meus dados” (GPC)</li>
        <li className={prefs.cookieBanners ? 'is-on' : ''}>Avisos de cookies escondidos</li>
      </ul>
      <p className="pcb-pop-foot">
        {total.toLocaleString('pt-BR')} bloqueios no total · listas {engine.state === 'on' ? 'ativas' : engine.state === 'loading' ? 'carregando…' : 'indisponíveis'}
        <button type="button" className="pcb-link" onClick={() => { onClose(); useBrowser.getState().openTab('pc://config'); }}>Configurar</button>
      </p>
    </div>
  );
}

function DownloadsPanel({ onClose }) {
  const downloads = useBrowser((s) => s.downloads);
  const list = [...downloads].reverse().slice(0, 6);
  const nb = nativeBrowser();
  return (
    <div className="pcb-pop is-downloads" role="dialog" aria-label="Downloads">
      <div className="pcb-pop-h"><Ico d={B.down} size={18} /> <strong>Downloads</strong></div>
      {!list.length && <p className="pcb-muted">Nada baixado ainda. Os arquivos vão para a pasta Downloads.</p>}
      {list.map((d) => (
        <div key={d.id} className={`pcb-dl is-${d.state}`}>
          <div className="pcb-dl-t"><strong data-no-translate>{d.filename}</strong>
            <small>{d.state === 'completed' ? fmtBytes(d.total || d.received) : d.state === 'cancelled' ? 'Cancelado' : d.state === 'interrupted' ? 'Falhou' : `${fmtBytes(d.received)} de ${d.total ? fmtBytes(d.total) : '?'}`}</small>
            {d.state === 'progressing' && <span className="pcb-bar"><i style={{ width: `${d.total ? Math.round((d.received / d.total) * 100) : 30}%` }} /></span>}
          </div>
          <div className="pcb-dl-a">
            {d.state === 'completed' && <button type="button" className="pcb-mini" onClick={() => nb?.downloadAction(d.id, 'open')}>Abrir</button>}
            {d.state === 'completed' && <button type="button" className="pcb-mini" onClick={() => nb?.downloadAction(d.id, 'show')}>Pasta</button>}
            {d.state === 'progressing' && <button type="button" className="pcb-mini" onClick={() => nb?.downloadAction(d.id, 'cancel')}>Cancelar</button>}
          </div>
        </div>
      ))}
      <p className="pcb-pop-foot"><button type="button" className="pcb-link" onClick={() => { onClose(); useBrowser.getState().openTab('pc://downloads'); }}>Ver todos os downloads</button></p>
    </div>
  );
}

function MainMenu({ tab, onClose, docked, onToggleDock }) {
  const st = useBrowser.getState;
  const wv = tab ? wvOf(tab.id) : null;
  const zoom = tab?.zoom || 1;
  const setZoom = (z) => { const v = Math.min(3, Math.max(0.3, Math.round(z * 10) / 10)); wv?.setZoomFactor(v); st().update(tab.id, { zoom: v }); };
  const item = (icon, label, fn, hint) => <button type="button" role="menuitem" onClick={() => { fn(); onClose(); }}><Ico d={icon} size={15} /> <span>{label}</span>{hint && <kbd>{hint}</kbd>}</button>;
  return (
    <div className="pcb-pop is-menu" role="menu">
      {item(B.plus, 'Nova aba', () => st().openTab(), 'Ctrl+T')}
      {item(B.mask, 'Nova aba privada', () => st().openTab(null, { private: true }), 'Ctrl+Shift+N')}
      <hr />
      <div className="pcb-zoom" role="group" aria-label="Zoom">
        <span>Zoom</span>
        <button type="button" onClick={() => setZoom(zoom - 0.1)} disabled={!wv} aria-label="Diminuir zoom"><Ico d={B.zoomOut} size={15} /></button>
        <button type="button" className="pcb-zoom-v" onClick={() => setZoom(1)} disabled={!wv} title="Voltar a 100%">{Math.round(zoom * 100)}%</button>
        <button type="button" onClick={() => setZoom(zoom + 0.1)} disabled={!wv} aria-label="Aumentar zoom"><Ico d={B.zoomIn} size={15} /></button>
      </div>
      <hr />
      {item(B.history, 'Histórico', () => st().openTab('pc://historico'), 'Ctrl+H')}
      {item(B.bookmarks, 'Favoritos', () => st().openTab('pc://favoritos'))}
      {item(B.down, 'Downloads', () => st().openTab('pc://downloads'), 'Ctrl+J')}
      <hr />
      {item(B.search, 'Procurar na página', () => useBrowser.setState({ findOpen: true }), 'Ctrl+F')}
      {item(B.print, 'Imprimir…', () => wv?.print(), 'Ctrl+P')}
      {tab && !isInternal(tab.url) && item(B.ext, 'Abrir no navegador do sistema', () => nativeBrowser()?.openSystem(tab.url))}
      {item(docked ? B.full : B.dock, docked ? 'Abrir em tela cheia' : 'Abrir ao lado do chat', onToggleDock)}
      <hr />
      {item(B.settings, 'Configurações do navegador', () => st().openTab('pc://config'))}
    </div>
  );
}

// ---------------- barras dentro da aba ----------------
function FindBar({ tab }) {
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  const wv = wvOf(tab.id);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  useEffect(() => () => { try { wvOf(tab.id)?.stopFindInPage('clearSelection'); } catch { /* ok */ } }, [tab.id]);
  const find = (forward = true, next = true) => { if (!q || !wv) return; try { wv.findInPage(q, { forward, findNext: next }); } catch { /* ok */ } };
  useEffect(() => { if (q && wv) { try { wv.findInPage(q); } catch { /* ok */ } } else if (wv) { try { wv.stopFindInPage('clearSelection'); } catch { /* ok */ } } }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => useBrowser.setState({ findOpen: false });
  return (
    <div className="pcb-find" role="search">
      <Ico d={B.search} size={14} />
      <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar na página" aria-label="Procurar na página"
        onKeyDown={(e) => { if (e.key === 'Enter') find(!e.shiftKey, true); if (e.key === 'Escape') close(); }} />
      <span className="pcb-find-n">{q ? `${tab.find?.active || 0}/${tab.find?.total || 0}` : ''}</span>
      <button type="button" onClick={() => find(false)} aria-label="Anterior"><Ico d={B.up} size={14} /></button>
      <button type="button" onClick={() => find(true)} aria-label="Próximo"><Ico d={B.downArrow} size={14} /></button>
      <button type="button" onClick={close} aria-label="Fechar busca"><Ico d={B.close} size={14} /></button>
    </div>
  );
}

function PermissionBar({ tab }) {
  const p = tab.permission;
  const [remember, setRemember] = useState(true);
  if (!p) return null;
  const host = hostOf(p.origin) || p.origin;
  const what = (PERMISSION_TEXT[p.permission] || (() => p.permission))(p.extra);
  const reply = (allow) => { nativeBrowser()?.permissionReply(p.id, allow, remember && !tab.private); useBrowser.getState().update(tab.id, { permission: null }); };
  return (
    <div className="pcb-perm" role="alertdialog" aria-label="Pedido de permissão">
      <Ico d={B.shield} size={16} />
      <span><strong data-no-translate>{host}</strong> quer {what}.</span>
      {p.permission !== 'openExternal' && !tab.private && <label className="pcb-perm-rem"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Lembrar</label>}
      <button type="button" className="pcb-btn" onClick={() => reply(false)}>Bloquear</button>
      <button type="button" className="pcb-btn is-primary" onClick={() => reply(true)}>Permitir</button>
    </div>
  );
}

// ---------------- atalhos ----------------
function runShortcut(k, { shift, alt, mod }) {
  const s = useBrowser.getState();
  const tab = s.active();
  const wv = tab ? wvOf(tab.id) : null;
  const zoom = (z) => { if (!wv || !tab) return; const v = Math.min(3, Math.max(0.3, Math.round(z * 10) / 10)); wv.setZoomFactor(v); s.update(tab.id, { zoom: v }); };
  if (mod) {
    if (k === 't') return s.openTab(), true;
    if (k === 'n') return s.openTab(null, { private: shift }), true;
    if (k === 'w') return tab && s.closeTab(tab.id), true;
    if (k === 'l' || k === 'k') return useBrowser.setState({ focusOmnibox: Date.now() }), true;
    if (k === 'f') return useBrowser.setState({ findOpen: true }), true;
    if (k === 'r') { if (wv) { shift ? wv.reloadIgnoringCache() : wv.reload(); } return true; }
    if (k === 'd') return tab && !isInternal(tab.url) && s.toggleBookmark(tab.url, tab.title, tab.favicon), true;
    if (k === 'h') return s.openTab('pc://historico'), true;
    if (k === 'j') return s.openTab('pc://downloads'), true;
    if (k === 'p') return wv?.print(), true;
    if (k === 'tab') return s.cycle(shift ? -1 : 1), true;
    if (k === '=' || k === '+') return zoom((tab?.zoom || 1) + 0.1), true;
    if (k === '-') return zoom((tab?.zoom || 1) - 0.1), true;
    if (k === '0') return zoom(1), true;
    if (/^[1-9]$/.test(k)) { const t = k === '9' ? s.tabs[s.tabs.length - 1] : s.tabs[Number(k) - 1]; if (t) s.activate(t.id); return true; }
  }
  if (k === 'f5') { if (wv) { shift ? wv.reloadIgnoringCache() : wv.reload(); } return true; }
  if (k === 'f6') return useBrowser.setState({ focusOmnibox: Date.now() }), true;
  if (alt && k === 'arrowleft') return wv?.canGoBack() && wv.goBack(), true;
  if (alt && k === 'arrowright') return wv?.canGoForward() && wv.goForward(), true;
  if (alt && k === 'home') return tab && s.navigate(tab.id, NEW_TAB), true;
  if (k === 'escape') { if (s.findOpen) useBrowser.setState({ findOpen: false }); else if (tab?.loading) wv?.stop(); return true; }
  return false;
}

export function useBrowserShortcuts(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    const nb = nativeBrowser();
    // Ctrl+Shift+T sem conflito com Ctrl+T.
    const fix = (k, o) => (o.mod && o.shift && k === 't' ? (useBrowser.getState().reopenClosed(), true) : runShortcut(k, o));
    const off = nb?.on('shortcut', (e) => fix(e.key, e));
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const tag = (e.target?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
      const inBrowser = !!e.target?.closest?.('.pcb-chrome');
      // Fora do navegador (digitando no chat etc.) só os atalhos de aba.
      if (!inBrowser && (typing || !mod)) return;
      if (mod && k === 'k' && !inBrowser) return; // Ctrl+K é a busca rápida do app
      if (inBrowser && typing && !mod && k !== 'f5' && k !== 'escape') return;
      if (fix(k, { mod, shift: e.shiftKey, alt: e.altKey })) { if (k !== 'escape') e.preventDefault(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { off?.(); document.removeEventListener('keydown', onKey); };
  }, [enabled]);
}

// ---------------- conjunto completo ----------------
export default function BrowserChrome({ docked = false }) {
  const tab = useBrowser((s) => s.tabs.find((t) => t.id === s.activeId) || null);
  const tabsCount = useBrowser((s) => s.tabs.length);
  const panel = useBrowser((s) => s.panel);
  const findOpen = useBrowser((s) => s.findOpen);
  const bookmarked = useBrowser((s) => !!tab && s.bookmarks.some((b) => b.url === tab.url));
  const downloadsActive = useBrowser((s) => s.downloads.filter((d) => d.state === 'progressing').length);
  const prefs = useBrowser((s) => s.prefs);
  const navigate = useNavigate();
  const st = useBrowser.getState;

  // Sem abas: abre a página inicial.
  useEffect(() => { if (!tabsCount) st().openTab(); }, [tabsCount]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!panel) return undefined;
    const onDown = (e) => { if (!e.target.closest?.('.pcb-pop') && !e.target.closest?.('.pcb-tool-pop')) useBrowser.setState({ panel: null }); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [panel]);

  const wv = tab ? wvOf(tab.id) : null;
  const internal = tab ? isInternal(tab.url) : true;
  const back = () => {
    if (!tab) return;
    if (internal && wv) { try { st().update(tab.id, { url: wv.getURL(), error: null }); } catch { /* ok */ } return; }
    if (tab.error && wv?.canGoBack()) { st().update(tab.id, { error: null }); wv.goBack(); return; }
    wv?.goBack();
  };
  const ytId = tab ? isYouTubeWatch(tab.url) : null;
  const toggleDock = () => {
    if (docked) { st().setDock(false); navigate('/navegador'); } else { st().setDock(true); navigate(useBrowser.getState().lastAppPath || '/'); }
  };
  const tool = (icon, label, fn, { on = false, disabled = false, badge = null, cls = '' } = {}) => (
    <button type="button" className={`pcb-tool${on ? ' is-on' : ''}${cls ? ` ${cls}` : ''}`} onClick={fn} disabled={disabled} title={label} aria-label={label}>
      <Ico d={icon} size={17} fill={on && icon === B.star} />
      {badge != null && <span className="pcb-badge">{badge}</span>}
    </button>
  );

  return (
    <div className={`pcb-chrome${docked ? ' is-docked' : ''}`}>
      <TabStrip compact={docked} />
      <div className="pcb-toolbar">
        {tool(B.back, 'Voltar (Alt+←)', back, { disabled: !(tab?.canBack || (internal && wv) || (tab?.error && wv?.canGoBack?.())) })}
        {tool(B.fwd, 'Avançar (Alt+→)', () => wv?.goForward(), { disabled: !tab?.canForward || internal })}
        {tab?.loading && !internal ? tool(B.stop, 'Parar', () => wv?.stop()) : tool(B.reload, 'Recarregar (Ctrl+R)', () => (internal ? null : tab?.error ? (st().update(tab.id, { error: null }), wv ? wv.reload() : st().navigate(tab.id, tab.url)) : wv?.reload()), { disabled: internal })}
        <Omnibox tab={tab} />
        {!internal && tool(B.star, bookmarked ? 'Remover dos favoritos (Ctrl+D)' : 'Adicionar aos favoritos (Ctrl+D)', () => st().toggleBookmark(tab.url, tab.title, tab.favicon), { on: bookmarked, cls: 'is-star' })}
        {ytId && tool(B.yt, 'Assistir no player do Project Club', () => {
          try { wv?.executeJavaScript('document.querySelectorAll("video").forEach(v=>v.pause())', true); } catch { /* ok */ }
          useYouTubeApp.getState().play({ videoId: ytId, title: tab.title.replace(/ - YouTube$/, '') });
        }, { cls: 'is-yt' })}
        <span className="pcb-tool-pop">{tool(prefs.adblock ? B.shield : B.shieldOff, 'Proteção', () => st().setPanel('shield'), { on: panel === 'shield', badge: !internal && tab?.blocked ? (tab.blocked > 99 ? '99+' : tab.blocked) : null, cls: 'is-shield' })}</span>
        {!internal && tool(B.share, 'Compartilhar no Project Club', () => useBrowser.setState({ share: { url: tab.url, title: tab.title } }))}
        <span className="pcb-tool-pop">{tool(B.down, 'Downloads', () => st().setPanel('downloads'), { on: panel === 'downloads', badge: downloadsActive || null })}</span>
        {tool(docked ? B.full : B.dock, docked ? 'Tela cheia' : 'Abrir ao lado do chat', toggleDock)}
        <span className="pcb-tool-pop">{tool(B.menu, 'Menu', () => st().setPanel('menu'), { on: panel === 'menu' })}</span>
        {panel === 'shield' && <ShieldPanel tab={tab} onClose={() => st().setPanel(null)} />}
        {panel === 'downloads' && <DownloadsPanel onClose={() => st().setPanel(null)} />}
        {panel === 'menu' && <MainMenu tab={tab} docked={docked} onToggleDock={toggleDock} onClose={() => useBrowser.setState({ panel: null })} />}
      </div>
      {tab && findOpen && !internal && <FindBar key={tab.id} tab={tab} />}
      {tab?.permission && <PermissionBar tab={tab} />}
      {tab?.loading && !internal && <div className="pcb-progress" aria-hidden="true"><i /></div>}
      <div className={`pcb-viewport${tab?.private ? ' is-private' : ''}`}>
        {tab && internal && <InternalPage tab={tab} />}
        {tab && !internal && tab.error && <ErrorPage tab={tab} />}
        {tab && !internal && tab.sleeping && <div className="pcb-sleep">Aba em descanso para economizar memória…</div>}
        {tab?.hoverUrl && !internal && <div className="pcb-status" data-no-translate>{tab.hoverUrl}</div>}
      </div>
    </div>
  );
}

export { tabTitle };
