import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBrowser } from './browserStore';
import BrowserChrome, { B, Ico, useBrowserShortcuts } from './BrowserChrome.jsx';
import { nativeBrowser, hostOf } from './urlTools';
import { useStore } from '../store/useStore';
import { sendMessage } from '../api/endpoints';
import Modal from '../components/Modal.jsx';
import '../styles/browser.css';

// ============================================================
// Navegador fundido ao Project Club:
//  - /navegador: o navegador em tela cheia, como uma seção do app;
//  - painel ao lado do chat (dock), redimensionável;
//  - links do app abrindo em abas; compartilhar página com amigos/canais.
// ============================================================

const isChatPath = (p) => p === '/' || p.startsWith('/channels/') || p.startsWith('/conversations/') || p === '/dms';

// Página /navegador (seção do app).
export function BrowserPage() {
  const available = useBrowser((s) => s.available);
  if (!available) {
    return (
      <div className="pcb-unavailable">
        <Ico d={B.globe} size={48} />
        <h2>O navegador do Project Club roda no app para computador</h2>
        <p>No app você navega em abas dentro do Project Club, ao lado do chat, com bloqueio de anúncios e rastreadores.</p>
        {window.electronAPI ? <p className="pcb-muted">Atualize o app (botão verde na barra de cima) para liberar o navegador.</p> : <a className="pcb-btn is-primary" href="/jogos">Baixar o app</a>}
      </div>
    );
  }
  return <div className="pcb-page-full"><BrowserChrome /></div>;
}

// Painel ao lado do chat.
export function BrowserDock() {
  const available = useBrowser((s) => s.available);
  const dockOpen = useBrowser((s) => s.dockOpen);
  const width = useBrowser((s) => s.dockWidth);
  const location = useLocation();
  const show = available && dockOpen && !location.pathname.startsWith('/navegador');
  const dragRef = useRef(null);
  // O chat sempre fica com pelo menos ~400px: o painel encolhe se precisar.
  const [maxW, setMaxW] = useState(1200);
  useEffect(() => {
    if (!show) return undefined;
    const main = document.querySelector('.app-main');
    if (!main) return undefined;
    const measure = () => setMaxW(Math.max(320, main.getBoundingClientRect().width - 400));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [show]);
  const w = Math.min(width, maxW);
  useEffect(() => {
    const root = document.documentElement;
    if (show) { root.classList.add('pcb-docked'); root.style.setProperty('--pcb-dock-w', `${w}px`); }
    else root.classList.remove('pcb-docked');
    return () => root.classList.remove('pcb-docked');
  }, [show, w]);
  if (!show) return null;
  const onDown = (e) => {
    e.preventDefault();
    const startX = e.clientX; const startW = w;
    dragRef.current = true;
    document.documentElement.classList.add('pcb-resizing');
    const move = (ev) => useBrowser.getState().setDockWidth(Math.min(maxW, startW + (startX - ev.clientX)));
    const up = () => { document.documentElement.classList.remove('pcb-resizing'); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <aside className="pcb-dock" style={{ width: w }} aria-label="Navegador">
      <div className="pcb-dock-resize" onMouseDown={onDown} role="separator" aria-orientation="vertical" aria-label="Redimensionar navegador" title="Arraste para redimensionar" />
      <div className="pcb-dock-head">
        <span><Ico d={B.globe} size={14} /> Navegador</span>
        <button type="button" className="pcb-tool" onClick={() => useBrowser.getState().setDock(false)} title="Fechar painel (as abas continuam abertas)" aria-label="Fechar painel"><Ico d={B.close} size={15} /></button>
      </div>
      <BrowserChrome docked />
    </aside>
  );
}

// Compartilhar página no Project Club (DM ou canal).
function ShareModal() {
  const share = useBrowser((s) => s.share);
  const conversations = useStore((s) => s.conversations);
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const me = useStore((s) => s.user);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { setQ(''); setNote(''); setSent(null); setErr(''); }, [share?.url]);
  useEffect(() => {
    if (!share) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') useBrowser.setState({ share: null }); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [share]);
  const targets = useMemo(() => {
    const dms = (conversations || []).map((c) => {
      const other = !c.isGroup ? (c.members || []).find((m) => m.id !== me?.id) : null;
      return { kind: 'dm', id: c.id, name: c.isGroup ? (c.name || (c.members || []).map((m) => m.displayName).join(', ')) : (other?.displayName || 'Conversa'), avatar: other?.avatarUrl || null };
    });
    const chans = [...(channels || []), ...(categories || []).flatMap((c) => c.channels || [])]
      .filter((c, i, a) => c && a.findIndex((x) => x.id === c.id) === i && !/voice|voz|stage|forum/i.test(String(c.type || '')))
      .map((c) => ({ kind: 'channel', id: c.id, name: `# ${c.name}` }));
    const all = [...dms, ...chans];
    const t = q.trim().toLowerCase();
    return (t ? all.filter((x) => x.name.toLowerCase().includes(t)) : all).slice(0, 40);
  }, [conversations, categories, channels, q, me?.id]);
  if (!share) return null;
  const close = () => useBrowser.setState({ share: null });
  const send = async (target) => {
    setBusy(target.id); setErr('');
    try {
      const fd = new FormData();
      if (target.kind === 'dm') fd.append('conversationId', target.id); else fd.append('channelId', target.id);
      const parts = [];
      if (note.trim()) parts.push(note.trim());
      if (share.quote) parts.push(`> ${share.quote.replace(/\n+/g, ' ').slice(0, 400)}`);
      if (share.title && !note.trim()) parts.push(share.title);
      parts.push(share.url);
      fd.append('content', parts.join('\n'));
      await sendMessage(fd);
      setSent(target);
    } catch (e) {
      setErr(e?.response?.data?.error || 'Não consegui enviar agora.');
    } finally { setBusy(null); }
  };
  return (
    <Modal title="Compartilhar no Project Club" onClose={close} width="460px">
      <div className="pcb-share">
        <div className="pcb-share-preview">
          <Ico d={B.globe} size={18} />
          <span><strong data-no-translate>{share.title || hostOf(share.url)}</strong><small data-no-translate>{share.url}</small></span>
        </div>
        {sent ? (
          <div className="pcb-share-done">
            <p>Enviado para <strong data-no-translate>{sent.name}</strong>.</p>
            <div className="modal-actions">
              <button type="button" className="btn-link" onClick={close}>Fechar</button>
              <button type="button" className="btn-primary" onClick={() => { close(); navigate(sent.kind === 'dm' ? `/conversations/${sent.id}` : `/channels/${sent.id}`); }}>Ir para a conversa</button>
            </div>
          </div>
        ) : (
          <>
            <input className="pcb-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Escreva algo (opcional)" maxLength={500} />
            <input className="pcb-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar amigo, grupo ou canal" autoFocus />
            {err && <p className="pcb-share-err">{err}</p>}
            <div className="pcb-share-list">
              {!targets.length && <p className="pcb-muted">Nenhuma conversa encontrada.</p>}
              {targets.map((t) => (
                <div key={`${t.kind}-${t.id}`} className="pcb-share-item">
                  {t.avatar ? <img src={t.avatar} alt="" /> : <span className="pcb-share-av">{t.kind === 'channel' ? '#' : t.name.slice(0, 1)}</span>}
                  <span data-no-translate>{t.name}</span>
                  <button type="button" className="pcb-btn is-primary" disabled={!!busy} onClick={() => send(t)}>{busy === t.id ? 'Enviando…' : 'Enviar'}</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// Liga o navegador ao resto do app: links abertos pelo app, menu de contexto,
// atalhos e onde mostrar a aba quando um link é aberto.
export function BrowserBridge() {
  const available = useBrowser((s) => s.available);
  const reveal = useBrowser((s) => s.reveal);
  const location = useLocation();
  const navigate = useNavigate();
  const dockOpen = useBrowser((s) => s.dockOpen);
  useBrowserShortcuts(available && (location.pathname.startsWith('/navegador') || dockOpen));

  // Lembra a última tela do app (para "abrir ao lado do chat").
  useEffect(() => { if (!location.pathname.startsWith('/navegador')) useBrowser.setState({ lastAppPath: location.pathname + location.search }); }, [location.pathname, location.search]);

  // Link aberto pelo app: no chat abre ao lado; no resto, vai pro navegador.
  const lastReveal = useRef(reveal);
  useEffect(() => {
    if (!reveal || reveal === lastReveal.current) return;
    lastReveal.current = reveal;
    const p = location.pathname;
    if (p.startsWith('/navegador')) return;
    if (isChatPath(p)) useBrowser.getState().setDock(true);
    else navigate('/navegador');
  }, [reveal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const nb = nativeBrowser();
    if (!nb) return undefined;
    const st = useBrowser.getState;
    const offs = [
      nb.on('open-tab', ({ url, background, openerId, private: priv, reveal: rv }) => {
        const opener = openerId ? st().byWc(openerId) : null;
        st().openTab(url, { background: !!background, afterId: opener?.id || null, private: !!priv, reveal: !!rv || (!opener && !background) });
      }),
      nb.on('context-action', ({ webContentsId, action, url, background, title, quote, text }) => {
        const tab = st().byWc(webContentsId);
        if (action === 'open-tab') st().openTab(url, { background: !!background, afterId: tab?.id, private: !!tab?.private });
        else if (action === 'open-private') st().openTab(url, { private: true });
        else if (action === 'search') st().openTab(text, { afterId: tab?.id, private: !!tab?.private });
        else if (action === 'share') useBrowser.setState({ share: { url, title, quote } });
        else if (action === 'pdf') nb.savePdf(webContentsId).catch(() => {});
      }),
    ];
    return () => offs.forEach((off) => off && off());
  }, []);

  if (!available) return null;
  return <ShareModal />;
}
